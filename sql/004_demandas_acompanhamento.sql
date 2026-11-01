BEGIN;
ALTER TABLE public.demandas ADD COLUMN IF NOT EXISTS responsavel text;
ALTER TABLE public.demandas ADD COLUMN IF NOT EXISTS prazo date;
ALTER TABLE public.demandas ADD COLUMN IF NOT EXISTS prioridade text NOT NULL DEFAULT 'normal';
ALTER TABLE public.demandas DROP CONSTRAINT IF EXISTS demandas_prioridade_check;
ALTER TABLE public.demandas ADD CONSTRAINT demandas_prioridade_check CHECK(prioridade IN ('baixa','normal','alta','urgente'));
ALTER TABLE public.demandas DROP CONSTRAINT IF EXISTS demandas_responsavel_length;
ALTER TABLE public.demandas ADD CONSTRAINT demandas_responsavel_length CHECK(responsavel IS NULL OR char_length(responsavel)<=120);
CREATE INDEX IF NOT EXISTS demandas_prazo_abertas_idx ON public.demandas(prazo) WHERE status<>'completed' AND prazo IS NOT NULL;

CREATE OR REPLACE FUNCTION public.salvar_demanda_v1(p_id uuid,p_data jsonb,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE old_row public.demandas%ROWTYPE; row_data public.demandas%ROWTYPE; changes text[]:=ARRAY[]::text[];
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) NOT IN ('admin','cadastrador')
   OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid()) THEN
  RAISE EXCEPTION 'Sessão sem permissão.' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('cidadao_id','title','description','status','responsavel','prazo','prioridade')) THEN
  RAISE EXCEPTION 'Campos de demanda inválidos.'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old_row FROM public.demandas WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demanda não encontrada ou sem acesso.' USING ERRCODE='42501'; END IF;
  IF old_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION 'A demanda foi alterada. Reabra os detalhes antes de salvar.' USING ERRCODE='40001'; END IF;
  p_data:=to_jsonb(old_row)||p_data;
 ELSE
  p_data:=jsonb_build_object('prioridade','normal','status','pending')||p_data;
 END IF;
 SELECT * INTO row_data FROM jsonb_populate_record(NULL::public.demandas,p_data);
 row_data.title:=btrim(row_data.title);
 row_data.responsavel:=nullif(btrim(row_data.responsavel),'');
 IF nullif(row_data.title,'') IS NULL THEN RAISE EXCEPTION 'Informe o título.'; END IF;
 IF row_data.prioridade IS NULL OR row_data.prioridade NOT IN ('baixa','normal','alta','urgente') THEN RAISE EXCEPTION 'Prioridade inválida.'; END IF;
 IF row_data.status IS NULL OR row_data.status NOT IN ('pending','inprogress','completed') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cidadaos WHERE id=row_data.cidadao_id) THEN RAISE EXCEPTION 'Solicitante não encontrado ou sem acesso.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.demandas(cidadao_id,title,description,status,user_id,responsavel,prazo,prioridade)
   VALUES(row_data.cidadao_id,row_data.title,row_data.description,row_data.status,auth.uid(),row_data.responsavel,row_data.prazo,row_data.prioridade)
   RETURNING * INTO row_data;
 ELSE
  IF old_row.responsavel IS DISTINCT FROM row_data.responsavel THEN changes:=array_append(changes,'responsável'); END IF;
  IF old_row.prazo IS DISTINCT FROM row_data.prazo THEN changes:=array_append(changes,'prazo'); END IF;
  IF old_row.prioridade IS DISTINCT FROM row_data.prioridade THEN changes:=array_append(changes,'prioridade'); END IF;
  IF old_row.status IS DISTINCT FROM row_data.status THEN changes:=array_append(changes,'status'); END IF;
  IF old_row.title IS DISTINCT FROM row_data.title THEN changes:=array_append(changes,'título'); END IF;
  IF old_row.description IS DISTINCT FROM row_data.description THEN changes:=array_append(changes,'descrição'); END IF;
  IF old_row.cidadao_id IS DISTINCT FROM row_data.cidadao_id THEN changes:=array_append(changes,'solicitante'); END IF;
  UPDATE public.demandas SET cidadao_id=row_data.cidadao_id,title=row_data.title,description=row_data.description,
   status=row_data.status,responsavel=row_data.responsavel,prazo=row_data.prazo,prioridade=row_data.prioridade,updated_at=clock_timestamp()
   WHERE id=p_id RETURNING * INTO row_data;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sem permissão para atualizar.' USING ERRCODE='42501'; END IF;
  IF cardinality(changes)>0 THEN
   INSERT INTO public.notes(demanda_id,text,author,user_id) VALUES(p_id,'Atualizado: '||array_to_string(changes,', ')||'.','Sistema',auth.uid());
  END IF;
 END IF;
 RETURN to_jsonb(row_data);
END;
$$;
REVOKE ALL ON FUNCTION public.salvar_demanda_v1(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.salvar_demanda_v1(uuid,jsonb,timestamptz) TO authenticated;
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
  INSERT INTO public.demandas SELECT * FROM jsonb_populate_recordset(NULL::public.demandas,
   coalesce((SELECT jsonb_agg(jsonb_build_object('prioridade','normal','responsavel',NULL,'prazo',NULL)||r) FROM jsonb_array_elements(p_backup->'demandas') r),'[]'::jsonb));
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
NOTIFY pgrst,'reload schema';
COMMIT;
