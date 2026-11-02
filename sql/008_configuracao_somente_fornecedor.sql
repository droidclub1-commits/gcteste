BEGIN;
-- Autorização independente do perfil admin. Sem concessão automática na instalação.
CREATE SCHEMA IF NOT EXISTS platform_private;
REVOKE ALL ON SCHEMA platform_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA platform_private TO authenticated,service_role;
CREATE TABLE IF NOT EXISTS platform_private.suppliers (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_private.suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.suppliers FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON platform_private.suppliers TO authenticated,service_role;
DROP POLICY IF EXISTS supplier_own_read ON platform_private.suppliers;
CREATE POLICY supplier_own_read ON platform_private.suppliers FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS supplier_service_read ON platform_private.suppliers;
CREATE POLICY supplier_service_read ON platform_private.suppliers FOR SELECT TO service_role USING(true);
CREATE OR REPLACE FUNCTION public.pode_configurar_campanha_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL
 AND coalesce((SELECT role='admin' FROM public.profiles WHERE id=(SELECT auth.uid())),false)
 AND EXISTS(SELECT 1 FROM platform_private.suppliers WHERE user_id=(SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.pode_configurar_campanha_v1() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.pode_configurar_campanha_v1() TO authenticated;
-- Uso exclusivo da função de gestão de usuários no servidor; não expõe a lista ao cliente.
CREATE OR REPLACE FUNCTION public.fornecedor_conta_protegida_v1(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM platform_private.suppliers WHERE user_id=p_user_id);
$$;
REVOKE ALL ON FUNCTION public.fornecedor_conta_protegida_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fornecedor_conta_protegida_v1(uuid) TO service_role;
DROP POLICY IF EXISTS campaign_admin_update ON public.campanha_config;
DROP POLICY IF EXISTS campaign_supplier_update ON public.campanha_config;
CREATE POLICY campaign_supplier_update ON public.campanha_config FOR UPDATE TO authenticated
 USING((SELECT public.pode_configurar_campanha_v1())) WITH CHECK((SELECT public.pode_configurar_campanha_v1()));
-- Defesa contra políticas permissivas antigas ou futuras.
DROP POLICY IF EXISTS campaign_supplier_gate ON public.campanha_config;
CREATE POLICY campaign_supplier_gate ON public.campanha_config AS RESTRICTIVE FOR UPDATE TO authenticated
 USING((SELECT public.pode_configurar_campanha_v1())) WITH CHECK((SELECT public.pode_configurar_campanha_v1()));
CREATE OR REPLACE FUNCTION public.salvar_configuracao_campanha_v1(p_data jsonb,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; current_version bigint;
BEGIN
 IF NOT public.pode_configurar_campanha_v1() THEN RAISE EXCEPTION 'Configuração reservada ao fornecedor. Seu acesso é somente consulta.' USING ERRCODE='42501';END IF;
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
NOTIFY pgrst,'reload schema';
COMMIT;
