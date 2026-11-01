-- Combustível é exclusivo de administradores da aplicação.
-- A política restritiva impede que permissões permissivas existentes ampliem o acesso.
BEGIN;
ALTER TABLE public.cotas_combustivel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS combustivel_admin_gate ON public.cotas_combustivel;
DROP POLICY IF EXISTS combustivel_admin_access ON public.cotas_combustivel;
CREATE POLICY combustivel_admin_gate ON public.cotas_combustivel
    AS RESTRICTIVE FOR ALL TO PUBLIC
    USING ((SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'admin')
    WITH CHECK ((SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'admin');
CREATE POLICY combustivel_admin_access ON public.cotas_combustivel
    AS PERMISSIVE FOR ALL TO authenticated
    USING ((SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'admin')
    WITH CHECK ((SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'admin');
-- O reset tem checagem interna de admin; também retiramos a chamada anônima.
DO $$
BEGIN
    IF to_regprocedure('public.reset_veiculos_pos_eleicao()') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.reset_veiculos_pos_eleicao() FROM PUBLIC, anon;
        GRANT EXECUTE ON FUNCTION public.reset_veiculos_pos_eleicao() TO authenticated;
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
