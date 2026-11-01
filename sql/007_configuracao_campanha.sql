BEGIN;
CREATE TABLE IF NOT EXISTS public.campanha_config (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
 app_name text NOT NULL DEFAULT 'GESTOR CIDADÃO' CHECK(char_length(btrim(app_name)) BETWEEN 1 AND 80),
 campaign_name text NOT NULL DEFAULT '' CHECK(char_length(campaign_name)<=160),
 candidate_name text NOT NULL DEFAULT '' CHECK(char_length(candidate_name)<=120),
 election_year integer CHECK(election_year BETWEEN 2000 AND 2100),
 city text NOT NULL CHECK(char_length(btrim(city)) BETWEEN 1 AND 100),
 uf text NOT NULL CHECK(uf IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 municipalities text[] NOT NULL CHECK(cardinality(municipalities) BETWEEN 1 AND 200),
 map_lat numeric NOT NULL CHECK(map_lat BETWEEN -90 AND 90),
 map_lng numeric NOT NULL CHECK(map_lng BETWEEN -180 AND 180),
 map_zoom integer NOT NULL CHECK(map_zoom BETWEEN 1 AND 18),
 theme text NOT NULL DEFAULT 'blue' CHECK(theme IN ('blue','green','purple','burgundy')),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.campanha_config(id,city,uf,municipalities,map_lat,map_lng,map_zoom)
VALUES(1,'Macapá','AP',ARRAY['Amapá','Calçoene','Cutias','Ferreira Gomes','Itaubal','Laranjal do Jari','Macapá','Mazagão','Oiapoque','Pedra Branca do Amapari','Porto Grande','Pracuúba','Santana','Serra do Navio','Tartarugalzinho','Vitória do Jari'],-0.03964,-51.18182,13)
ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.campanha_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campanha_config FROM PUBLIC,anon,authenticated,service_role;
-- Somente identificação pública; não há contas, senhas, tokens ou pessoas cadastradas nesta tabela.
GRANT SELECT ON public.campanha_config TO anon,authenticated;
GRANT UPDATE(app_name,campaign_name,candidate_name,election_year,city,uf,municipalities,map_lat,map_lng,map_zoom,theme) ON public.campanha_config TO authenticated;
DROP POLICY IF EXISTS campaign_public_read ON public.campanha_config;
CREATE POLICY campaign_public_read ON public.campanha_config FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS campaign_admin_update ON public.campanha_config;
CREATE POLICY campaign_admin_update ON public.campanha_config FOR UPDATE TO authenticated
 USING((SELECT role FROM public.profiles WHERE id=(SELECT auth.uid()))='admin')
 WITH CHECK((SELECT role FROM public.profiles WHERE id=(SELECT auth.uid()))='admin');
CREATE OR REPLACE FUNCTION public.validate_campaign_config() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE names text[]; item text;
BEGIN
 NEW.app_name:=btrim(NEW.app_name);NEW.campaign_name:=btrim(NEW.campaign_name);NEW.candidate_name:=btrim(NEW.candidate_name);NEW.city:=btrim(NEW.city);NEW.uf:=upper(btrim(NEW.uf));
 SELECT array_agg(btrim(n) ORDER BY pos) INTO names FROM unnest(NEW.municipalities) WITH ORDINALITY x(n,pos);
 FOREACH item IN ARRAY coalesce(names,ARRAY[]::text[]) LOOP
  IF item IS NULL OR char_length(item) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Município inválido na lista.';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT cadastro_private.text_key(n)) FROM unnest(names) n)<>cardinality(names) THEN RAISE EXCEPTION 'Há municípios repetidos na lista.';END IF;
 SELECT n INTO NEW.city FROM unnest(names) n WHERE cadastro_private.text_key(n)=cadastro_private.text_key(NEW.city);
 IF NEW.city IS NULL THEN RAISE EXCEPTION 'O município principal deve estar na lista de municípios atendidos.';END IF;
 NEW.municipalities:=names;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'revision'-'updated_at')=(to_jsonb(OLD)-'revision'-'updated_at') THEN RETURN OLD;END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_campaign_config() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS campaign_validate ON public.campanha_config;
CREATE TRIGGER campaign_validate BEFORE INSERT OR UPDATE ON public.campanha_config FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_config();
CREATE OR REPLACE FUNCTION public.salvar_configuracao_campanha_v1(p_data jsonb,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; current_version bigint;
BEGIN
 IF auth.uid() IS NULL OR (SELECT role FROM public.profiles WHERE id=auth.uid()) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Configuração exclusiva do administrador.' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>40000 THEN RAISE EXCEPTION 'Configuração inválida.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('app_name','campaign_name','candidate_name','election_year','city','uf','municipalities','map_lat','map_lng','map_zoom','theme')) THEN RAISE EXCEPTION 'Campo de configuração não permitido.';END IF;
 SELECT revision INTO current_version FROM public.campanha_config WHERE id=1 FOR UPDATE;
 IF current_version IS NULL OR p_revision IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'Configuração alterada por outra sessão. Recarregue antes de salvar.' USING ERRCODE='40001';END IF;
 UPDATE public.campanha_config c SET app_name=r.app_name,campaign_name=r.campaign_name,candidate_name=r.candidate_name,election_year=r.election_year,city=r.city,uf=r.uf,municipalities=r.municipalities,map_lat=r.map_lat,map_lng=r.map_lng,map_zoom=r.map_zoom,theme=r.theme
 FROM jsonb_populate_record(NULL::public.campanha_config,p_data) r WHERE c.id=1 RETURNING to_jsonb(c) INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'Sem permissão para salvar.' USING ERRCODE='42501';END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.salvar_configuracao_campanha_v1(jsonb,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.salvar_configuracao_campanha_v1(jsonb,bigint) TO authenticated;
ALTER TABLE audit_private.events DROP CONSTRAINT IF EXISTS events_table_name_check;
ALTER TABLE audit_private.events ADD CONSTRAINT events_table_name_check CHECK(table_name IN ('cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles','campanha_config'));
CREATE OR REPLACE FUNCTION audit_private.capture_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,audit_private,pg_temp AS $$
DECLARE cols text[]; old_data jsonb; new_data jsonb; fields text[]; uid uuid; claims jsonb;
 label text; actor text; source text; operation text;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles','campanha_config') THEN
  RAISE EXCEPTION 'Tabela não autorizada para captura de histórico.'; END IF;
 cols:=CASE TG_TABLE_NAME
 WHEN 'cidadaos' THEN ARRAY['id','name','email','dob','sexo','type','leader','cpf','rg','voterid','phone','whatsapp','profissao','localtrabalho','cep','logradouro','numero','complemento','bairro','cidade','estado','latitude','longitude','sons','daughters','children','photourl','user_id','created_at','updated_at','zona','secao','lgpd_consent_at','nome_mae','nome_pai']
 WHEN 'demandas' THEN ARRAY['id','cidadao_id','title','description','status','user_id','created_at','updated_at','responsavel','prazo','prioridade']
 WHEN 'notes' THEN ARRAY['id','demanda_id','text','author','user_id','created_at']
 WHEN 'veiculos' THEN ARRAY['id','cidadao_id','tipo','placa','modelo','cor','adesivado','created_at']
 WHEN 'cotas_combustivel' THEN ARRAY['id','cidadao_id','data','litros','valor','posto','observacao','registrado_por','created_at']
 WHEN 'campanha_config' THEN ARRAY['id','app_name','campaign_name','candidate_name','election_year','city','uf','municipalities','map_lat','map_lng','map_zoom','theme','revision','updated_at']
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
 label:=coalesce(new_data->>'app_name',old_data->>'app_name',new_data->>'name',old_data->>'name',new_data->>'title',old_data->>'title',
  new_data->>'placa',old_data->>'placa',new_data->>'modelo',old_data->>'modelo',
  new_data->>'posto',old_data->>'posto',new_data->>'text',old_data->>'text',
  new_data->>'role',old_data->>'role',coalesce(new_data,old_data)->>'id');
 INSERT INTO audit_private.events(table_name,record_id,record_label,action,actor_id,actor_label,origin,operation_id,changed_fields,before_data,after_data)
 VALUES(TG_TABLE_NAME,coalesce(new_data,old_data)->>'id',left(label,160),TG_OP,uid,left(actor,320),source,operation,fields,old_data,new_data);
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION audit_private.capture_change() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS app_audit_capture ON public.campanha_config;
CREATE TRIGGER app_audit_capture AFTER INSERT OR UPDATE OR DELETE ON public.campanha_config FOR EACH ROW EXECUTE FUNCTION audit_private.capture_change();
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
 IF p_tabela IS NOT NULL AND p_tabela NOT IN ('cidadaos','demandas','notes','veiculos','cotas_combustivel','profiles','campanha_config') THEN RAISE EXCEPTION 'Módulo inválido.'; END IF;
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
NOTIFY pgrst,'reload schema';
COMMIT;
