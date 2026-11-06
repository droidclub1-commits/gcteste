BEGIN;

ALTER TABLE platform_private.client_installations
    ADD COLUMN IF NOT EXISTS provision_id uuid,
    ADD COLUMN IF NOT EXISTS provision_state text NOT NULL DEFAULT 'idle'
        CHECK (provision_state IN ('idle', 'queued', 'running', 'failed')),
    ADD COLUMN IF NOT EXISTS provision_note text,
    ADD COLUMN IF NOT EXISTS provision_updated_at timestamptz;

REVOKE UPDATE (stage) ON platform_private.client_installations FROM authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_instalacao_cliente_v1(p_slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT public.pode_configurar_campanha_v1() THEN
        RAISE EXCEPTION 'Acesso restrito ao administrador geral.' USING ERRCODE = '42501';
    END IF;
    UPDATE platform_private.client_installations SET
        provision_id = coalesce(provision_id, gen_random_uuid()),
        provision_state = 'queued', provision_note = NULL, provision_updated_at = now()
    WHERE slug = p_slug AND stage <> 'active'
        AND (provision_state IN ('idle', 'failed') OR
            (provision_state = 'running' AND provision_updated_at < now() - interval '25 minutes'));
END;
$$;

CREATE OR REPLACE FUNCTION public.reivindicar_instalacao_cliente_v1()
RETURNS SETOF platform_private.client_installations
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE platform_private.client_installations c SET
        provision_state = 'running', provision_updated_at = now()
    FROM (
        SELECT slug FROM platform_private.client_installations
        WHERE provision_state = 'queued'
           OR (stage = 'invited' AND provision_id IS NOT NULL AND provision_state = 'idle'
               AND provision_updated_at < now() - interval '10 minutes')
        ORDER BY (provision_state = 'queued') DESC, provision_updated_at
        LIMIT 1 FOR UPDATE SKIP LOCKED
    ) next
    WHERE c.slug = next.slug
    RETURNING c.*;
$$;

CREATE OR REPLACE FUNCTION public.registrar_provisionamento_cliente_v1(
    p_slug text, p_lease timestamptz, p_stage text, p_project_ref text,
    p_site_url text, p_state text, p_note text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE platform_private.client_installations SET
        stage = p_stage, project_ref = coalesce(p_project_ref, project_ref),
        site_url = coalesce(p_site_url, site_url),
        provision_state = p_state, provision_note = left(p_note, 240),
        provision_updated_at = CASE WHEN p_state = 'running' THEN provision_updated_at ELSE now() END
    WHERE slug = p_slug AND provision_state = 'running' AND provision_updated_at = p_lease;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_instalacao_cliente_v1(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.solicitar_instalacao_cliente_v1(text) TO authenticated;
REVOKE ALL ON FUNCTION public.reivindicar_instalacao_cliente_v1(),
    public.registrar_provisionamento_cliente_v1(text,timestamptz,text,text,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reivindicar_instalacao_cliente_v1(),
    public.registrar_provisionamento_cliente_v1(text,timestamptz,text,text,text,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

