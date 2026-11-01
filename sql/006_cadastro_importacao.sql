BEGIN;
CREATE SCHEMA IF NOT EXISTS cadastro_private;
REVOKE ALL ON SCHEMA cadastro_private FROM PUBLIC,anon,service_role;
GRANT USAGE ON SCHEMA cadastro_private TO authenticated;
CREATE TABLE IF NOT EXISTS cadastro_private.receipts (
 id uuid PRIMARY KEY, actor uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cadastro_private.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cadastro_private.receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON cadastro_private.receipts TO authenticated;
DROP POLICY IF EXISTS own_receipt_read ON cadastro_private.receipts;
CREATE POLICY own_receipt_read ON cadastro_private.receipts FOR SELECT TO authenticated USING(actor=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_receipt_insert ON cadastro_private.receipts;
CREATE POLICY own_receipt_insert ON cadastro_private.receipts FOR INSERT TO authenticated WITH CHECK(actor=(SELECT auth.uid()));
CREATE OR REPLACE FUNCTION cadastro_private.text_key(v text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT lower(regexp_replace(btrim(translate(coalesce(v,''),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'\s+',' ','g'));
$$;
CREATE OR REPLACE FUNCTION cadastro_private.phone_key(v text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN length(d) IN (12,13) AND left(d,2)='55' THEN substr(d,3) ELSE d END FROM (SELECT regexp_replace(coalesce(v,''),'[^0-9]','','g') d) x;
$$;
CREATE OR REPLACE FUNCTION cadastro_private.normalize_row(v jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE r jsonb:='{}'; k text; t text; cpf text; n integer; j integer; digit integer; birth date;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Linha inválida.'; END IF;
 FOR k IN SELECT jsonb_object_keys(v) LOOP
  IF k NOT IN ('name','cpf','phone','whatsapp','email','dob','bairro','cidade','estado') THEN RAISE EXCEPTION 'Coluna não permitida: %',k; END IF;
  IF jsonb_typeof(v->k) NOT IN ('string','null') AND k<>'whatsapp' THEN RAISE EXCEPTION 'Use texto para o campo %.',k; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['name','cpf','phone','email','dob','bairro','cidade','estado'] LOOP
  t:=nullif(btrim(v->>k),'');
  IF char_length(t)>254 THEN RAISE EXCEPTION 'Campo % muito longo.',k; END IF;
  r:=r||jsonb_build_object(k,t);
 END LOOP;
 IF nullif(r->>'name','') IS NULL THEN RAISE EXCEPTION 'Nome obrigatório.'; END IF;
 IF char_length(r->>'name')>160 THEN RAISE EXCEPTION 'Nome excede 160 caracteres.'; END IF;
 IF r->>'cpf' IS NOT NULL THEN
  IF r->>'cpf' !~ '^[0-9.\- ]+$' THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  cpf:=regexp_replace(r->>'cpf','[^0-9]','','g');
  IF length(cpf)<>11 OR cpf=repeat(left(cpf,1),11) THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  FOR j IN 10..11 LOOP
   n:=0;FOR digit IN 1..j-1 LOOP n:=n+substr(cpf,digit,1)::int*(j+1-digit);END LOOP;
   n:=(n*10)%11;IF n=10 THEN n:=0;END IF;
   IF n<>substr(cpf,j,1)::int THEN RAISE EXCEPTION 'CPF inválido.';END IF;
  END LOOP;
  r:=r||jsonb_build_object('cpf',cpf);
 END IF;
 IF r->>'phone' IS NOT NULL THEN
  IF r->>'phone' !~ '^[+0-9() .\-]+$' THEN RAISE EXCEPTION 'Telefone inválido.';END IF;
  t:=cadastro_private.phone_key(r->>'phone');
  IF length(t) NOT IN (10,11) THEN RAISE EXCEPTION 'Telefone deve incluir DDD e 10 ou 11 dígitos.';END IF;
  r:=r||jsonb_build_object('phone',t);
 END IF;
 IF r->>'email' IS NOT NULL THEN
  t:=lower(r->>'email');IF t !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'E-mail inválido.';END IF;
  r:=r||jsonb_build_object('email',t);
 END IF;
 IF r->>'dob' IS NOT NULL THEN
  IF r->>'dob' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Nascimento deve usar AAAA-MM-DD.';END IF;
  birth:=(r->>'dob')::date;
  IF birth>current_date OR birth<date '1900-01-01' THEN RAISE EXCEPTION 'Data de nascimento inválida.';END IF;
 END IF;
 IF r->>'estado' IS NOT NULL THEN
  t:=upper(r->>'estado');
  IF t NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') THEN RAISE EXCEPTION 'UF inválida.';END IF;
  r:=r||jsonb_build_object('estado',t);
 END IF;
 t:=lower(btrim(coalesce(v->>'whatsapp','false')));
 IF t NOT IN ('true','false','sim','não','nao','1','0','') THEN RAISE EXCEPTION 'WhatsApp deve ser sim ou não.';END IF;
 r:=r||jsonb_build_object('whatsapp',t IN ('true','sim','1'),'type','Outro');
 RETURN r;
END;
$$;
CREATE OR REPLACE FUNCTION public.conferir_cadastro_v1(p_rows jsonb,p_mode text DEFAULT 'import') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE role_name text; raw jsonb; normalized jsonb:='[]'; output jsonb:='[]'; r jsonb; err text; i integer:=0; candidates jsonb; n integer; hard boolean; peers jsonb; same_cpf boolean;
BEGIN
 SELECT role INTO role_name FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR role_name IS NULL OR role_name NOT IN ('admin','cadastrador') THEN RAISE EXCEPTION 'Sessão sem permissão.' USING ERRCODE='42501';END IF;
 IF p_mode IS NULL OR p_mode NOT IN ('import','quick') OR (p_mode='import' AND role_name<>'admin') THEN RAISE EXCEPTION 'Importação exclusiva do administrador.' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR octet_length(p_rows::text)>1048576 THEN RAISE EXCEPTION 'Arquivo inválido ou maior que 1 MB.';END IF;
 IF jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>500 OR (p_mode='quick' AND jsonb_array_length(p_rows)<>1) THEN RAISE EXCEPTION 'Envie de 1 a 500 linhas; cadastro rápido aceita uma.';END IF;
 FOR raw IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  BEGIN r:=cadastro_private.normalize_row(raw);normalized:=normalized||jsonb_build_array(jsonb_build_object('data',r));
  EXCEPTION WHEN OTHERS THEN normalized:=normalized||jsonb_build_array(jsonb_build_object('error',SQLERRM));END;
 END LOOP;
 FOR raw IN SELECT value FROM jsonb_array_elements(normalized) LOOP
  i:=i+1;r:=raw->'data';err:=raw->>'error';candidates:='[]';peers:='[]';n:=0;hard:=false;same_cpf:=false;
  IF err IS NULL THEN
   WITH matches AS MATERIALIZED (
    SELECT c.id,c.name,c.cpf,c.phone,c.email,c.dob,c.cidade,c.bairro,c.updated_at,
      (r->>'cpf' IS NOT NULL AND regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g')=r->>'cpf') AS cpf_match
    FROM public.cidadaos c WHERE
      (r->>'cpf' IS NOT NULL AND regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g')=r->>'cpf') OR
      (r->>'phone' IS NOT NULL AND cadastro_private.phone_key(c.phone)=r->>'phone') OR
      (r->>'email' IS NOT NULL AND lower(btrim(c.email))=r->>'email') OR
      (cadastro_private.text_key(c.name)=cadastro_private.text_key(r->>'name') AND
       ((r->>'dob' IS NOT NULL AND c.dob=(r->>'dob')::date) OR
        (r->>'cidade' IS NOT NULL AND cadastro_private.text_key(c.cidade)=cadastro_private.text_key(r->>'cidade'))))
   ) SELECT (SELECT count(*)::int FROM matches),(SELECT coalesce(bool_or(cpf_match),false) FROM matches),
     (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM (SELECT * FROM matches ORDER BY id LIMIT 5) m)
     INTO n,hard,candidates;
   SELECT coalesce(jsonb_agg(idx ORDER BY idx),'[]'),coalesce(bool_or(r->>'cpf' IS NOT NULL AND other->'data'->>'cpf'=r->>'cpf'),false)
    INTO peers,same_cpf FROM jsonb_array_elements(normalized) WITH ORDINALITY x(other,idx)
    WHERE idx<>i AND other->>'error' IS NULL AND (
      (r->>'cpf' IS NOT NULL AND other->'data'->>'cpf'=r->>'cpf') OR
      (r->>'phone' IS NOT NULL AND other->'data'->>'phone'=r->>'phone') OR
      (r->>'email' IS NOT NULL AND other->'data'->>'email'=r->>'email') OR
      (cadastro_private.text_key(other->'data'->>'name')=cadastro_private.text_key(r->>'name') AND
       ((r->>'dob' IS NOT NULL AND other->'data'->>'dob'=r->>'dob') OR
        (r->>'cidade' IS NOT NULL AND cadastro_private.text_key(other->'data'->>'cidade')=cadastro_private.text_key(r->>'cidade')))));
  END IF;
  output:=output||jsonb_build_array(jsonb_build_object('line',i,'data',r,'error',err,'matches',candidates,'match_count',n,'peers',peers,
    'status',CASE WHEN err IS NOT NULL THEN 'invalid' WHEN hard THEN 'existing' WHEN same_cpf THEN 'duplicate_file' WHEN n>0 OR jsonb_array_length(peers)>0 THEN 'review' ELSE 'ready' END));
 END LOOP;
 RETURN jsonb_build_object('rows',output,'expected_state',encode(sha256(convert_to(output::text,'UTF8')),'hex'));
END;
$$;
CREATE OR REPLACE FUNCTION public.confirmar_cadastro_v1(p_rows jsonb,p_selected integer[],p_ack integer[],p_expected_state text,p_operation uuid,p_mode text DEFAULT 'import') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE checked jsonb; row_data jsonb; idx integer; inserted uuid; ids jsonb:='[]'; result jsonb; request_hash text; saved cadastro_private.receipts%ROWTYPE; role_name text;
BEGIN
 SELECT role INTO role_name FROM public.profiles WHERE id=auth.uid();
 IF auth.uid() IS NULL OR role_name IS NULL OR role_name NOT IN ('admin','cadastrador') OR p_mode IS NULL OR p_mode NOT IN ('import','quick') OR (p_mode='import' AND role_name<>'admin') THEN RAISE EXCEPTION 'Sessão sem permissão.' USING ERRCODE='42501';END IF;
 IF p_operation IS NULL OR p_expected_state IS NULL OR coalesce(cardinality(p_selected),0)=0 OR cardinality(p_selected)>500 THEN RAISE EXCEPTION 'Revise e selecione as linhas antes de confirmar.';END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_rows,p_selected,p_ack,p_expected_state,p_mode)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 SELECT * INTO saved FROM cadastro_private.receipts WHERE id=p_operation;
 IF FOUND THEN
  IF saved.request_hash<>request_hash THEN RAISE EXCEPTION 'Operação já usada com outros dados.';END IF;
  RETURN saved.result;
 END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.cidadaos IN SHARE ROW EXCLUSIVE MODE;
 checked:=public.conferir_cadastro_v1(p_rows,p_mode);
 IF checked->>'expected_state'<>p_expected_state THEN RAISE EXCEPTION 'Os dados mudaram. Confira novamente antes de gravar.' USING ERRCODE='40001';END IF;
 IF (SELECT count(DISTINCT x) FROM unnest(p_selected) x)<>cardinality(p_selected) THEN RAISE EXCEPTION 'Seleção repetida.';END IF;
 FOREACH idx IN ARRAY p_selected LOOP
  IF idx IS NULL OR idx<1 OR idx>jsonb_array_length(checked->'rows') THEN RAISE EXCEPTION 'Seleção inválida.';END IF;
  row_data:=checked->'rows'->(idx-1);
  IF row_data->>'status' NOT IN ('ready','review') THEN RAISE EXCEPTION 'Linha % bloqueada: corrija o arquivo ou mantenha o cadastro existente.',idx;END IF;
  IF row_data->>'status'='review' AND NOT coalesce(idx=ANY(p_ack),false) THEN RAISE EXCEPTION 'Revise a possível duplicidade da linha %.',idx;END IF;
  INSERT INTO public.cidadaos(name,cpf,phone,whatsapp,email,dob,bairro,cidade,estado,type,user_id)
  SELECT r.name,r.cpf,r.phone,r.whatsapp,r.email,r.dob,r.bairro,r.cidade,r.estado,r.type,auth.uid()
  FROM jsonb_populate_record(NULL::public.cidadaos,row_data->'data') r RETURNING id INTO inserted;
  ids:=ids||jsonb_build_array(inserted);
 END LOOP;
 result:=jsonb_build_object('inserted',jsonb_array_length(ids),'ids',ids,'operation_id',p_operation);
 INSERT INTO cadastro_private.receipts(id,actor,request_hash,result) VALUES(p_operation,auth.uid(),request_hash,result);
 RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Documento ou operação já cadastrado. Confira novamente; nenhuma linha deste lote foi gravada.' USING ERRCODE='23505';
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cadastro_private FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cadastro_private TO authenticated;
REVOKE ALL ON FUNCTION public.conferir_cadastro_v1(jsonb,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.confirmar_cadastro_v1(jsonb,integer[],integer[],text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.conferir_cadastro_v1(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_cadastro_v1(jsonb,integer[],integer[],text,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
