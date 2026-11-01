-- Restauração dos dados da aplicação. Não importa Auth, perfis, permissões ou SQL do arquivo.
BEGIN;
CREATE SCHEMA IF NOT EXISTS backup_private;
REVOKE ALL ON SCHEMA backup_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA backup_private TO authenticated;
CREATE TABLE IF NOT EXISTS backup_private.restore_points (
    id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    actor uuid NOT NULL,
    before_data jsonb NOT NULL,
    request_hash text NOT NULL,
    result jsonb NOT NULL
);
ALTER TABLE backup_private.restore_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_private.restore_points FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON backup_private.restore_points TO authenticated;
DROP POLICY IF EXISTS restore_points_admin ON backup_private.restore_points;
CREATE POLICY restore_points_admin ON backup_private.restore_points FOR ALL TO authenticated
 USING ((SELECT role FROM public.profiles WHERE id=(SELECT auth.uid()))='admin')
 WITH CHECK ((SELECT role FROM public.profiles WHERE id=(SELECT auth.uid()))='admin');

CREATE OR REPLACE FUNCTION public.exportar_aplicacao_v1() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Backup e restauração são exclusivos do administrador.' USING ERRCODE='42501';
 END IF;
 -- Um único SELECT usa o mesmo snapshot MVCC para os cinco módulos.
 SELECT jsonb_build_object(
  'cidadaos',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cidadaos c),'[]'::jsonb),
  'demandas',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.demandas d),'[]'::jsonb),
  'notes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notes n),'[]'::jsonb),
  'veiculos',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.veiculos v),'[]'::jsonb),
  'cotas_combustivel',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.cotas_combustivel f),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.restaurar_aplicacao_v1(
 p_backup jsonb,
 p_validar_apenas boolean DEFAULT true,
 p_confirmacao text DEFAULT NULL,
 p_expected_state text DEFAULT NULL,
 p_operation_id uuid DEFAULT NULL,
 p_actor uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
 names constant text[] := ARRAY['cidadaos','demandas','notes','veiculos','cotas_combustivel'];
 name text; col text; row_count integer; expected integer;
 before_data jsonb; counts jsonb := '{}'::jsonb; current_state text; request_hash text;
 result jsonb; saved backup_private.restore_points%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Backup e restauração são exclusivos do administrador.' USING ERRCODE='42501';
 END IF;
 IF p_validar_apenas IS NULL THEN RAISE EXCEPTION 'Informe o modo de validação.'; END IF;
 IF jsonb_typeof(p_backup) IS DISTINCT FROM 'object' OR octet_length(p_backup::text)>31457280 THEN
  RAISE EXCEPTION 'Dados inválidos ou superiores a 30 MB. Use recuperação no servidor para bases maiores.';
 END IF;
 -- Apenas os cinco módulos conhecidos são aceitos; dados de autenticação nunca são importados.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_backup) k WHERE NOT (k=ANY(names))) THEN
  RAISE EXCEPTION 'O conjunto de dados contém um módulo não permitido.';
 END IF;
 FOREACH name IN ARRAY names LOOP
  IF jsonb_typeof(p_backup->name) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Módulo ausente ou inválido: %',name; END IF;
  expected:=jsonb_array_length(p_backup->name);
  IF expected>50000 THEN RAISE EXCEPTION 'Módulo % excede 50 mil registros. Use recuperação no servidor.',name; END IF;
  counts:=counts||jsonb_build_object(name,expected);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_backup->name) r WHERE jsonb_typeof(r)<>'object' OR nullif(r->>'id','') IS NULL) THEN
   RAISE EXCEPTION 'Registro sem identificador em %.',name;
  END IF;
  IF (SELECT count(DISTINCT r->>'id') FROM jsonb_array_elements(p_backup->name) r)<>expected THEN
   RAISE EXCEPTION 'Identificador duplicado em %.',name;
  END IF;
  FOR col IN SELECT DISTINCT k FROM jsonb_array_elements(p_backup->name) r CROSS JOIN LATERAL jsonb_object_keys(r) k LOOP
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=name AND c.column_name=col AND c.is_generated='NEVER') THEN
    RAISE EXCEPTION 'Coluna incompatível em %: %.',name,col;
   END IF;
  END LOOP;
 END LOOP;
 request_hash:=encode(sha256(convert_to(p_backup::text,'UTF8')),'hex');
 IF NOT p_validar_apenas THEN
  IF p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'A sessão mudou. Valide novamente.' USING ERRCODE='42501'; END IF;
  IF p_operation_id IS NULL OR p_confirmacao IS DISTINCT FROM 'RESTAURAR' OR p_expected_state IS NULL THEN
   RAISE EXCEPTION 'Valide o arquivo e confirme RESTAURAR antes de executar.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO saved FROM backup_private.restore_points WHERE id=p_operation_id;
  IF FOUND THEN
   IF saved.request_hash<>request_hash THEN RAISE EXCEPTION 'Identificador de operação já utilizado com outro arquivo.'; END IF;
   RETURN saved.result;
  END IF;
 END IF;
 PERFORM set_config('lock_timeout','5s',true);
 -- Bloqueia novas gravações enquanto confere e substitui o conjunto, sem TRUNCATE/CASCADE.
 LOCK TABLE public.cidadaos, public.cotas_combustivel, public.demandas, public.notes, public.veiculos IN SHARE ROW EXCLUSIVE MODE;
 before_data:=public.exportar_aplicacao_v1();
 current_state:=encode(sha256(convert_to(before_data::text,'UTF8')),'hex');
 IF NOT p_validar_apenas AND p_expected_state<>current_state THEN
  RAISE EXCEPTION 'Os dados mudaram desde a conferência. Valide o arquivo novamente antes de restaurar.' USING ERRCODE='40001';
 END IF;
 BEGIN
  DELETE FROM public.notes;
  DELETE FROM public.demandas;
  DELETE FROM public.cotas_combustivel;
  DELETE FROM public.veiculos;
  UPDATE public.cidadaos SET leader=NULL WHERE leader IS NOT NULL;
  DELETE FROM public.cidadaos;
  INSERT INTO public.cidadaos SELECT * FROM jsonb_populate_recordset(NULL::public.cidadaos,
   coalesce((SELECT jsonb_agg(r||jsonb_build_object('leader',NULL)) FROM jsonb_array_elements(p_backup->'cidadaos') r),'[]'));
  UPDATE public.cidadaos c SET leader=r.leader FROM jsonb_populate_recordset(NULL::public.cidadaos,p_backup->'cidadaos') r WHERE c.id=r.id;
  INSERT INTO public.demandas SELECT * FROM jsonb_populate_recordset(NULL::public.demandas,p_backup->'demandas');
  INSERT INTO public.notes SELECT * FROM jsonb_populate_recordset(NULL::public.notes,p_backup->'notes');
  INSERT INTO public.veiculos SELECT * FROM jsonb_populate_recordset(NULL::public.veiculos,p_backup->'veiculos');
  INSERT INTO public.cotas_combustivel SELECT * FROM jsonb_populate_recordset(NULL::public.cotas_combustivel,p_backup->'cotas_combustivel');
  SET CONSTRAINTS ALL IMMEDIATE;
  FOREACH name IN ARRAY names LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',name) INTO row_count;
   IF row_count<>(counts->>name)::integer THEN RAISE EXCEPTION 'Quantidade restaurada divergente em %.',name; END IF;
  END LOOP;
  IF p_validar_apenas THEN RAISE EXCEPTION 'Validação concluída' USING ERRCODE='ZB001'; END IF;
 EXCEPTION WHEN SQLSTATE 'ZB001' THEN
  -- Reverte a execução de conferência, incluindo todas as inserções/exclusões.
  RETURN jsonb_build_object('valid',true,'counts',counts,'current_counts',
    (SELECT jsonb_object_agg(k,jsonb_array_length(v)) FROM jsonb_each(before_data) e(k,v)),
    'expected_state',current_state);
 END;
 result:=jsonb_build_object('restored',true,'operation_id',p_operation_id,'safety_copy_id',p_operation_id,'counts',counts);
 INSERT INTO backup_private.restore_points(id,actor,before_data,request_hash,result)
  VALUES(p_operation_id,auth.uid(),before_data,request_hash,result);
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.copias_recuperacao_v1(p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Acesso exclusivo do administrador.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at) ORDER BY created_at DESC),'[]') INTO result
   FROM (SELECT id,created_at FROM backup_private.restore_points ORDER BY created_at DESC LIMIT 20) p;
 ELSE
  SELECT before_data INTO result FROM backup_private.restore_points WHERE id=p_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Cópia de recuperação não encontrada.'; END IF;
 END IF;
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resultado_restauracao_v1(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Acesso exclusivo do administrador.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT p.result INTO result FROM backup_private.restore_points p WHERE id=p_id;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.exportar_aplicacao_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.restaurar_aplicacao_v1(jsonb,boolean,text,text,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.copias_recuperacao_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.resultado_restauracao_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exportar_aplicacao_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_aplicacao_v1(jsonb,boolean,text,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copias_recuperacao_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resultado_restauracao_v1(uuid) TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('fotos-cidadaos','fotos-cidadaos',false,5242880,ARRAY['image/png','image/jpeg','image/gif','image/webp']) ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS app_photos_read ON storage.objects;
CREATE POLICY app_photos_read ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='fotos-cidadaos' AND (
  (SELECT role FROM public.profiles WHERE id=(SELECT auth.uid()))='admin'
  OR (storage.foldername(name))[1]=(SELECT auth.uid())::text
  OR EXISTS(SELECT 1 FROM public.cidadaos c WHERE c.photourl='storage://fotos-cidadaos/'||storage.objects.name)
 ));
DROP POLICY IF EXISTS app_photos_insert ON storage.objects;
CREATE POLICY app_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id='fotos-cidadaos' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
 AND (SELECT role FROM public.profiles WHERE id=(SELECT auth.uid())) IN ('admin','cadastrador')
);
NOTIFY pgrst,'reload schema';
COMMIT;
