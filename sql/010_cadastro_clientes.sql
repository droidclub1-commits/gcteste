BEGIN;

CREATE TABLE IF NOT EXISTS platform_private.client_installations (
    slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 40),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    municipality text NOT NULL CHECK (char_length(btrim(municipality)) BETWEEN 1 AND 100),
    uf text NOT NULL CHECK (uf IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
    admin_email text NOT NULL CHECK (char_length(admin_email) <= 254 AND admin_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    stage text NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft', 'database', 'published', 'invited', 'active')),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_private.client_installations
    ADD COLUMN IF NOT EXISTS project_ref text UNIQUE CHECK (project_ref ~ '^[a-z0-9]{20}$'),
    ADD COLUMN IF NOT EXISTS site_url text UNIQUE CHECK (site_url ~ '^https://[a-z0-9][a-z0-9-]{0,62}\.pages\.dev$');

ALTER TABLE platform_private.client_installations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.client_installations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT (slug, name, municipality, uf, admin_email), UPDATE (stage)
    ON platform_private.client_installations TO authenticated;

DROP POLICY IF EXISTS owner_installations ON platform_private.client_installations;
CREATE POLICY owner_installations ON platform_private.client_installations TO authenticated
    USING (public.pode_configurar_campanha_v1())
    WITH CHECK (public.pode_configurar_campanha_v1());

CREATE OR REPLACE FUNCTION public.listar_clientes_v1()
RETURNS SETOF platform_private.client_installations
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF NOT public.pode_configurar_campanha_v1() THEN
        RAISE EXCEPTION 'Acesso restrito ao administrador geral.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT c.* FROM platform_private.client_installations c ORDER BY c.created_at DESC, c.slug;
END;
$$;

CREATE OR REPLACE FUNCTION public.cadastrar_cliente_v1(
    p_slug text, p_name text, p_municipality text, p_uf text, p_admin_email text
) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    INSERT INTO platform_private.client_installations (slug, name, municipality, uf, admin_email)
    VALUES (lower(btrim(p_slug)), btrim(p_name), btrim(p_municipality), upper(btrim(p_uf)), lower(btrim(p_admin_email)));
$$;

CREATE OR REPLACE FUNCTION public.atualizar_etapa_cliente_v1(p_slug text, p_stage text, p_expected_stage text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF NOT public.pode_configurar_campanha_v1() THEN
        RAISE EXCEPTION 'Acesso restrito ao administrador geral.' USING ERRCODE = '42501';
    END IF;
    UPDATE platform_private.client_installations SET stage = p_stage
        WHERE slug = p_slug AND stage = p_expected_stage;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente ou etapa alterada. Atualize a lista e tente novamente.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_clientes_v1(), public.cadastrar_cliente_v1(text,text,text,text,text),
    public.atualizar_etapa_cliente_v1(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_clientes_v1(), public.cadastrar_cliente_v1(text,text,text,text,text),
    public.atualizar_etapa_cliente_v1(text,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

