-- Somente leitura. Confira o resultado antes de instalar a migração.
SELECT table_name, column_name, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('cidadaos','veiculos','profiles','demandas','notes','cotas_combustivel')
ORDER BY table_name, ordinal_position;

SELECT relname AS tabela, relrowsecurity AS rls_ativo, relforcerowsecurity AS rls_forcado
FROM pg_class JOIN pg_namespace n ON n.oid = relnamespace
WHERE n.nspname = 'public' AND relname IN ('cidadaos','veiculos','profiles','demandas','notes','cotas_combustivel');

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('cidadaos','veiculos','profiles','demandas','notes','cotas_combustivel')
ORDER BY tablename, policyname;
