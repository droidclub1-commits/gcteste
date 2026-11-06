BEGIN;

-- Esquema de partida para instalações vazias. Não inclui dados nem contas.

CREATE TABLE public.cidadaos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    dob date,
    sexo text,
    type text,
    leader uuid,
    cpf text,
    rg text,
    voterid text,
    phone text,
    whatsapp boolean DEFAULT false,
    profissao text,
    localtrabalho text,
    cep text,
    logradouro text,
    numero text,
    complemento text,
    bairro text,
    cidade text,
    estado text,
    latitude double precision,
    longitude double precision,
    sons integer DEFAULT 0,
    daughters integer DEFAULT 0,
    children jsonb,
    photourl text,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    zona text,
    secao text,
    lgpd_consent_at timestamp with time zone,
    nome_mae text,
    nome_pai text
);
ALTER TABLE public.cidadaos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cidadaos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cidadaos TO authenticated;
GRANT ALL ON public.cidadaos TO service_role;

CREATE TABLE public.cotas_combustivel (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cidadao_id uuid NOT NULL,
    data date DEFAULT CURRENT_DATE NOT NULL,
    litros numeric(10,2),
    valor numeric(10,2),
    posto text,
    observacao text,
    registrado_por text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.cotas_combustivel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cotas_combustivel FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cotas_combustivel TO authenticated;
GRANT ALL ON public.cotas_combustivel TO service_role;

CREATE TABLE public.demandas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cidadao_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.demandas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demandas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demandas TO authenticated;
GRANT ALL ON public.demandas TO service_role;

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    demanda_id uuid NOT NULL,
    text text NOT NULL,
    author text,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE TABLE public.veiculos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cidadao_id uuid NOT NULL,
    tipo text NOT NULL,
    placa text,
    modelo text,
    cor text,
    adesivado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.veiculos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.veiculos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veiculos TO authenticated;
GRANT ALL ON public.veiculos TO service_role;
ALTER TABLE public.cidadaos ADD CONSTRAINT cidadaos_cpf_key UNIQUE (cpf);
ALTER TABLE public.cidadaos ADD CONSTRAINT cidadaos_pkey PRIMARY KEY (id);
ALTER TABLE public.cidadaos ADD CONSTRAINT cidadaos_voterid_key UNIQUE (voterid);
ALTER TABLE public.cotas_combustivel ADD CONSTRAINT cotas_combustivel_pkey PRIMARY KEY (id);
ALTER TABLE public.demandas ADD CONSTRAINT demandas_pkey PRIMARY KEY (id);
ALTER TABLE public.notes ADD CONSTRAINT notes_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.veiculos ADD CONSTRAINT veiculos_pkey PRIMARY KEY (id);
ALTER TABLE public.veiculos ADD CONSTRAINT veiculos_tipo_check CHECK ((tipo = ANY (ARRAY['Carro'::text, 'Moto'::text])));
ALTER TABLE public.cidadaos ADD CONSTRAINT cidadaos_leader_fkey FOREIGN KEY (leader) REFERENCES public.cidadaos(id);
ALTER TABLE public.cidadaos ADD CONSTRAINT cidadaos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.cotas_combustivel ADD CONSTRAINT cotas_combustivel_cidadao_id_fkey FOREIGN KEY (cidadao_id) REFERENCES public.cidadaos(id) ON DELETE CASCADE;
ALTER TABLE public.demandas ADD CONSTRAINT demandas_cidadao_id_fkey FOREIGN KEY (cidadao_id) REFERENCES public.cidadaos(id);
ALTER TABLE public.demandas ADD CONSTRAINT demandas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.notes ADD CONSTRAINT notes_demanda_id_fkey FOREIGN KEY (demanda_id) REFERENCES public.demandas(id);
ALTER TABLE public.notes ADD CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.veiculos ADD CONSTRAINT veiculos_cidadao_id_fkey FOREIGN KEY (cidadao_id) REFERENCES public.cidadaos(id) ON DELETE CASCADE;

CREATE POLICY "utilizador lê o seu perfil" ON public.profiles FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY "admin_notes_tudo" ON public.notes FOR ALL TO authenticated
    USING (( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'admin'::text);

CREATE POLICY "cadastrador_notes_insert" ON public.notes FOR INSERT TO authenticated
    WITH CHECK ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()));

CREATE POLICY "cadastrador_notes_select" ON public.notes FOR SELECT TO authenticated
    USING ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()));

CREATE POLICY "admin_cidadaos_tudo" ON public.cidadaos FOR ALL TO authenticated
    USING (( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'admin'::text);

CREATE POLICY "cadastrador_cidadaos_insert" ON public.cidadaos FOR INSERT TO authenticated
    WITH CHECK ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()));

CREATE POLICY "cadastrador_cidadaos_select" ON public.cidadaos FOR SELECT TO authenticated
    USING ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()));

CREATE POLICY "cadastrador_cidadaos_update" ON public.cidadaos FOR UPDATE TO authenticated
    USING ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()))
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "admin_demandas_tudo" ON public.demandas FOR ALL TO authenticated
    USING (( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'admin'::text);

CREATE POLICY "cadastrador_demandas_insert" ON public.demandas FOR INSERT TO authenticated
    WITH CHECK ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()));

CREATE POLICY "cadastrador_demandas_select" ON public.demandas FOR SELECT TO authenticated
    USING ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()));

CREATE POLICY "cadastrador_demandas_update" ON public.demandas FOR UPDATE TO authenticated
    USING ((( SELECT profiles.role FROM public.profiles WHERE (profiles.id = auth.uid())) = 'cadastrador'::text) AND (user_id = auth.uid()))
    WITH CHECK (user_id = auth.uid());

-- O acesso ao veículo segue a visibilidade do cidadão vinculado.
CREATE POLICY veiculos_cidadao_visivel ON public.veiculos TO authenticated
    USING (EXISTS (SELECT 1 FROM public.cidadaos c WHERE c.id = cidadao_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.cidadaos c WHERE c.id = cidadao_id));

CREATE INDEX ON public.veiculos (cidadao_id);
CREATE INDEX ON public.cotas_combustivel (cidadao_id);
CREATE INDEX ON public.demandas (cidadao_id);
CREATE INDEX ON public.notes (demanda_id);
CREATE INDEX ON public.cidadaos (leader);

CREATE OR REPLACE FUNCTION public.reset_veiculos_pos_eleicao()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role           text;
  v_veiculos_count int;
  v_cotas_count    int;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'Apenas administradores podem executar esta ação.' using errcode = '42501';
  end if;

  update public.veiculos set adesivado = false where adesivado = true;
  get diagnostics v_veiculos_count = row_count;

  delete from public.cotas_combustivel where true;
  get diagnostics v_cotas_count = row_count;

  return json_build_object(
    'veiculos_atualizados', v_veiculos_count,
    'cotas_apagadas',       v_cotas_count
  );
end;
$function$
;
REVOKE ALL ON FUNCTION public.reset_veiculos_pos_eleicao() FROM PUBLIC, anon, authenticated;
COMMIT;

