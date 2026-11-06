BEGIN;

-- Preserva a implementação de reset instalada e retira sua entrada direta da API.
DO $$
BEGIN
    IF to_regprocedure('platform_private.reset_veiculos_pos_eleicao()') IS NULL THEN
        IF to_regprocedure('public.reset_veiculos_pos_eleicao()') IS NULL THEN
            RAISE EXCEPTION 'A função de reset pós-eleição ainda não foi instalada.';
        END IF;
        ALTER FUNCTION public.reset_veiculos_pos_eleicao() SET SCHEMA platform_private;
    END IF;
    IF to_regprocedure('public.reset_veiculos_pos_eleicao()') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.reset_veiculos_pos_eleicao() FROM PUBLIC, anon, authenticated, service_role;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION platform_private.reset_veiculos_pos_eleicao() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reset_veiculos_pos_eleicao_fornecedor_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.pode_configurar_campanha_v1() THEN
        RAISE EXCEPTION 'Acesso restrito ao administrador geral.' USING ERRCODE = '42501';
    END IF;
    RETURN to_jsonb(platform_private.reset_veiculos_pos_eleicao());
END;
$$;

REVOKE ALL ON FUNCTION public.reset_veiculos_pos_eleicao_fornecedor_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_veiculos_pos_eleicao_fornecedor_v1() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

