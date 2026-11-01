BEGIN;
CREATE SCHEMA IF NOT EXISTS audit_private;
REVOKE ALL ON SCHEMA audit_private FROM PUBLIC,anon,service_role;
GRANT USAGE ON SCHEMA audit_private TO authenticated;
CREATE TABLE IF NOT EXISTS audit_private.events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 table_name text NOT NULL CHECK(table_name IN ('cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles')),
 record_id text NOT NULL,
 record_label text NOT NULL,
 action text NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
 actor_id uuid,
 actor_label text NOT NULL,
 origin text NOT NULL,
 operation_id text,
 changed_fields text[] NOT NULL,
 before_data jsonb,
 after_data jsonb
);
ALTER TABLE audit_private.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit_private.events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE audit_private.events_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON audit_private.events TO authenticated;
DROP POLICY IF EXISTS audit_admin_read ON audit_private.events;
CREATE POLICY audit_admin_read ON audit_private.events FOR SELECT TO authenticated
 USING ((SELECT role FROM public.profiles WHERE id=(SELECT auth.uid()))='admin');
CREATE INDEX IF NOT EXISTS audit_events_recent_idx ON audit_private.events(occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_events_record_idx ON audit_private.events(table_name,record_id,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_events_module_idx ON audit_private.events(table_name,occurred_at DESC,id DESC);

-- A função privilegiada é privada e só funciona como trigger. Não há API para inserir ou alterar eventos.
CREATE OR REPLACE FUNCTION audit_private.capture_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit_private,pg_temp AS $$
DECLARE cols text[]; old_data jsonb; new_data jsonb; fields text[]; uid uuid; claims jsonb;
 label text; actor text; source text; operation text;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles') THEN
  RAISE EXCEPTION 'Tabela não autorizada para captura de histórico.'; END IF;
 cols:=CASE TG_TABLE_NAME
 WHEN 'cidadaos' THEN ARRAY['id','name','email','dob','sexo','type','leader','cpf','rg','voterid','phone','whatsapp','profissao','localtrabalho','cep','logradouro','numero','complemento','bairro','cidade','estado','latitude','longitude','sons','daughters','children','photourl','user_id','created_at','updated_at','zona','secao','lgpd_consent_at','nome_mae','nome_pai']
 WHEN 'demandas' THEN ARRAY['id','cidadao_id','title','description','status','user_id','created_at','updated_at','responsavel','prazo','prioridade']
 WHEN 'notes' THEN ARRAY['id','demanda_id','text','author','user_id','created_at']
 WHEN 'veiculos' THEN ARRAY['id','cidadao_id','tipo','placa','modelo','cor','adesivado','created_at']
 WHEN 'cotas_combustivel' THEN ARRAY['id','cidadao_id','data','litros','valor','posto','observacao','registrado_por','created_at']
 WHEN 'profiles' THEN ARRAY['id','role','created_at'] END;
 IF TG_OP<>'INSERT' THEN SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO old_data FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(cols); END IF;
 IF TG_OP<>'DELETE' THEN SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO new_data FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(cols); END IF;
 SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[]) INTO fields
 FROM jsonb_object_keys(coalesce(old_data,'{}')||coalesce(new_data,'{}')) k
 WHERE k<>'updated_at' AND (old_data->k) IS DISTINCT FROM (new_data->k);
 IF TG_OP='UPDATE' AND cardinality(fields)=0 THEN RETURN NULL; END IF;
 uid:=auth.uid();
 claims:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
 operation:=nullif(current_setting('app.audit_restore',true),'');
 source:=CASE WHEN operation IS NOT NULL THEN 'restauracao' WHEN uid IS NOT NULL THEN 'aplicacao' WHEN claims->>'role' IS NOT NULL THEN 'integracao' ELSE 'banco' END;
 actor:=CASE WHEN uid IS NOT NULL THEN coalesce(nullif(claims->>'email',''),uid::text)
  WHEN claims->>'role' IS NOT NULL THEN 'Sistema/integração' ELSE 'Manutenção no banco' END;
 label:=coalesce(new_data->>'name',old_data->>'name',new_data->>'title',old_data->>'title',
  new_data->>'placa',old_data->>'placa',new_data->>'modelo',old_data->>'modelo',
  new_data->>'posto',old_data->>'posto',new_data->>'text',old_data->>'text',
  new_data->>'role',old_data->>'role',coalesce(new_data,old_data)->>'id');
 INSERT INTO audit_private.events(table_name,record_id,record_label,action,actor_id,actor_label,origin,operation_id,changed_fields,before_data,after_data)
 VALUES(TG_TABLE_NAME,coalesce(new_data,old_data)->>'id',left(label,160),TG_OP,uid,left(actor,320),source,operation,fields,old_data,new_data);
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION audit_private.capture_change() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS app_audit_capture ON public.%I',t);
  EXECUTE format('CREATE TRIGGER app_audit_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_private.capture_change()',t);
 END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.auditoria_listar_v1(
 p_tabela text DEFAULT NULL,p_acao text DEFAULT NULL,p_busca text DEFAULT NULL,
 p_inicio timestamptz DEFAULT NULL,p_fim timestamptz DEFAULT NULL,p_registro text DEFAULT NULL,
 p_after_time timestamptz DEFAULT NULL,p_after_id bigint DEFAULT NULL,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Histórico exclusivo do administrador.' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Limite de consulta inválido.'; END IF;
 IF p_tabela IS NOT NULL AND p_tabela NOT IN ('cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles') THEN RAISE EXCEPTION 'Módulo inválido.'; END IF;
 IF p_acao IS NOT NULL AND p_acao NOT IN ('INSERT','UPDATE','DELETE') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
 IF (p_after_time IS NULL)<>(p_after_id IS NULL) THEN RAISE EXCEPTION 'Cursor inválido.'; END IF;
 IF p_inicio IS NOT NULL AND p_fim IS NOT NULL AND p_fim<=p_inicio THEN RAISE EXCEPTION 'Período inválido.'; END IF;
 IF char_length(coalesce(p_busca,''))>160 OR char_length(coalesce(p_registro,''))>100 THEN RAISE EXCEPTION 'Busca muito longa.'; END IF;
 WITH candidates AS MATERIALIZED (
  SELECT e.id,e.occurred_at,e.table_name,e.record_id,e.record_label,e.action,e.actor_id,e.actor_label,e.origin,e.operation_id,e.changed_fields FROM audit_private.events e WHERE
   (p_tabela IS NULL OR e.table_name=p_tabela) AND (p_acao IS NULL OR e.action=p_acao)
   AND (p_inicio IS NULL OR e.occurred_at>=p_inicio) AND (p_fim IS NULL OR e.occurred_at<p_fim)
   AND (p_registro IS NULL OR e.record_id=p_registro)
   AND (nullif(p_busca,'') IS NULL OR e.record_label ILIKE '%'||p_busca||'%' OR e.actor_label ILIKE '%'||p_busca||'%' OR e.record_id ILIKE '%'||p_busca||'%')
   AND (p_after_time IS NULL OR (e.occurred_at,e.id)<(p_after_time,p_after_id))
  ORDER BY e.occurred_at DESC,e.id DESC LIMIT p_limit+1
 ), page AS (SELECT * FROM candidates ORDER BY occurred_at DESC,id DESC LIMIT p_limit)
 SELECT jsonb_build_object('events',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',id::text,'occurred_at',occurred_at,'table_name',table_name,'record_id',record_id,'record_label',record_label,
  'action',action,'actor_id',actor_id,'actor_label',actor_label,'origin',origin,'operation_id',operation_id,'changed_fields',changed_fields
 ) ORDER BY occurred_at DESC,id DESC) FROM page),'[]'),
 'has_more',(SELECT count(*)>p_limit FROM candidates),
 'next_cursor',CASE WHEN (SELECT count(*)>p_limit FROM candidates) THEN (SELECT jsonb_build_object('time',occurred_at,'id',id::text) FROM page ORDER BY occurred_at,id LIMIT 1) ELSE NULL END)
 INTO result;
 RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION public.auditoria_detalhe_v1(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Histórico exclusivo do administrador.' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(e)||jsonb_build_object('id',e.id::text) INTO result FROM audit_private.events e WHERE id=p_id;
 IF result IS NULL THEN RAISE EXCEPTION 'Registro de histórico não encontrado.'; END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_listar_v1(text,text,text,timestamptz,timestamptz,text,timestamptz,bigint,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.auditoria_detalhe_v1(bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.auditoria_listar_v1(text,text,text,timestamptz,timestamptz,text,timestamptz,bigint,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auditoria_detalhe_v1(bigint) TO authenticated;
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
 result jsonb; saved backup_private.restore_points%ROWTYPE; old_audit_context text;
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
 old_audit_context:=current_setting('app.audit_restore',true);
 BEGIN
  PERFORM set_config('app.audit_restore',CASE WHEN p_validar_apenas THEN '' ELSE p_operation_id::text END,true);
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
 PERFORM set_config('app.audit_restore',coalesce(old_audit_context,''),true);
 result:=jsonb_build_object('restored',true,'operation_id',p_operation_id,'safety_copy_id',p_operation_id,'counts',counts);
 INSERT INTO backup_private.restore_points(id,actor,before_data,request_hash,result)
  VALUES(p_operation_id,auth.uid(),before_data,request_hash,result);
 RETURN result;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
