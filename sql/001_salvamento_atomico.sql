-- Execute no SQL Editor do projeto Supabase, primeiro em homologação.
-- Não altera dados existentes nem as políticas RLS.
-- Pré-requisito: cidadaos.id UUID; tabelas cidadaos, veiculos e profiles existentes.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cidadaos'
          AND column_name = 'id' AND udt_name = 'uuid'
    ) THEN
        RAISE EXCEPTION 'Esta migração exige public.cidadaos.id do tipo UUID. Não aplique sem adaptar ao esquema real.';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cidadaos'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.veiculos'::regclass) THEN
        RAISE EXCEPTION 'Ative e revise RLS em cidadaos e veiculos antes de instalar esta função.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_cidadao_com_veiculos_v2(
    p_id uuid,
    p_cidadao jsonb,
    p_veiculos jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_payload jsonb;
    v_columns text;
    v_values text;
    v_assignments text;
    v_key text;
    v_json jsonb;
    v_vehicle public.veiculos%ROWTYPE;
    v_vehicle_id text;
    v_kept text[] := ARRAY[]::text[];
    v_seen text[] := ARRAY[]::text[];
    v_role text;
    v_count integer;
    v_allowed constant text[] := ARRAY[
        'name','email','dob','sexo','type','leader','cpf','rg','voterid','zona','secao',
        'phone','whatsapp','profissao','cep','logradouro','numero','complemento',
        'bairro','cidade','estado','sons','daughters','children','localtrabalho',
        'nome_mae','nome_pai','photourl','latitude','longitude'
    ];
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501'; END IF;
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'cadastrador') THEN
        RAISE EXCEPTION 'Perfil sem permissão para salvar.' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_cidadao) IS DISTINCT FROM 'object'
       OR nullif(btrim(p_cidadao->>'name'), '') IS NULL THEN
        RAISE EXCEPTION 'Informe o nome do cidadão.';
    END IF;
    IF jsonb_typeof(p_veiculos) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Lista de veículos inválida.';
    END IF;

    -- Somente campos conhecidos. Os tipos são os próprios tipos das colunas.
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      INTO v_payload FROM jsonb_each(p_cidadao) WHERE key = ANY(v_allowed);
    v_payload := jsonb_set(v_payload, '{name}', to_jsonb(btrim(v_payload->>'name')));
    IF p_id IS NULL THEN
        v_payload := v_payload || jsonb_build_object('user_id', auth.uid());
    ELSE
        -- Evita duas gravações simultâneas do mesmo cidadão dentro desta função.
        PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
        PERFORM 1 FROM public.cidadaos WHERE id = p_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cidadão não encontrado ou sem acesso.' USING ERRCODE = '42501'; END IF;
        -- user_id do criador é preservado. Não transfere propriedade ao editor.
        v_payload := v_payload || jsonb_build_object('updated_at', now());
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_payload) ORDER BY 1 LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'cidadaos'
              AND column_name = v_key AND is_generated = 'NEVER'
        ) THEN RAISE EXCEPTION 'Coluna esperada não encontrada: cidadaos.%', v_key; END IF;
    END LOOP;
    SELECT string_agg(format('%I', key), ', ' ORDER BY key),
           string_agg(format('r.%I', key), ', ' ORDER BY key),
           string_agg(format('%I = r.%I', key, key), ', ' ORDER BY key)
      INTO v_columns, v_values, v_assignments FROM jsonb_object_keys(v_payload) AS k(key);
    IF p_id IS NULL THEN
        EXECUTE format('INSERT INTO public.cidadaos (%s) SELECT %s FROM jsonb_populate_record(NULL::public.cidadaos, $1) r RETURNING id', v_columns, v_values)
            INTO v_id USING v_payload;
    ELSE
        EXECUTE format('UPDATE public.cidadaos c SET %s FROM jsonb_populate_record(NULL::public.cidadaos, $1) r WHERE c.id = $2 RETURNING c.id', v_assignments)
            INTO v_id USING v_payload, p_id;
        IF v_id IS NULL THEN RAISE EXCEPTION 'Sem permissão para editar o cidadão.' USING ERRCODE = '42501'; END IF;
    END IF;

    IF v_id IS NULL THEN RAISE EXCEPTION 'A gravação do cidadão não retornou um identificador.'; END IF;

    FOR v_json IN SELECT value FROM jsonb_array_elements(p_veiculos) LOOP
        IF jsonb_typeof(v_json) IS DISTINCT FROM 'object'
           OR (v_json->>'tipo') IS NULL OR (v_json->>'tipo') NOT IN ('Carro', 'Moto') THEN
            RAISE EXCEPTION 'Tipo de veículo inválido.';
        END IF;
        -- Remove campos inesperados e impede troca de proprietário.
        SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_json
          FROM jsonb_each(v_json) WHERE key IN ('id','tipo','placa','modelo','cor','adesivado');
        v_json := v_json || jsonb_build_object('cidadao_id', v_id);
        v_json := jsonb_set(v_json, '{adesivado}', coalesce(v_json->'adesivado', 'false'::jsonb));
        SELECT * INTO v_vehicle FROM jsonb_populate_record(NULL::public.veiculos, v_json);
        IF v_vehicle.id IS NULL THEN
            INSERT INTO public.veiculos(cidadao_id,tipo,placa,modelo,cor,adesivado)
                VALUES(v_id,v_vehicle.tipo,v_vehicle.placa,v_vehicle.modelo,v_vehicle.cor,v_vehicle.adesivado)
                RETURNING id::text INTO v_vehicle_id;
        ELSE
            IF v_vehicle.id::text = ANY(v_seen) THEN RAISE EXCEPTION 'Veículo repetido na solicitação.'; END IF;
            v_seen := array_append(v_seen, v_vehicle.id::text);
            UPDATE public.veiculos SET tipo=v_vehicle.tipo, placa=v_vehicle.placa,
                modelo=v_vehicle.modelo, cor=v_vehicle.cor, adesivado=v_vehicle.adesivado
                WHERE id=v_vehicle.id AND cidadao_id=v_id
                RETURNING id::text INTO v_vehicle_id;
            IF v_vehicle_id IS NULL THEN
                RAISE EXCEPTION 'Veículo não pertence ao cidadão ou não pode ser editado.' USING ERRCODE = '42501';
            END IF;
        END IF;
        v_kept := array_append(v_kept, v_vehicle_id);
    END LOOP;
    -- Somente os removidos explicitamente no formulário são excluídos.
    DELETE FROM public.veiculos WHERE cidadao_id=v_id AND NOT (id::text = ANY(v_kept));
    SELECT count(*) INTO v_count FROM public.veiculos WHERE cidadao_id=v_id AND NOT (id::text = ANY(v_kept));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Sem permissão para remover um dos veículos.' USING ERRCODE = '42501'; END IF;
    RETURN v_id;
    -- Qualquer erro reverte cidadão e veículos na mesma transação PostgreSQL.
END;
$$;
REVOKE ALL ON FUNCTION public.salvar_cidadao_com_veiculos_v2(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_cidadao_com_veiculos_v2(uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
