module.exports=(admin,user)=>`
 CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${admin}'),('${user}');
 CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users,role text); INSERT INTO profiles VALUES('${admin}','admin'),('${user}','cadastrador');
 ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; CREATE POLICY own ON profiles FOR SELECT TO authenticated USING(id=auth.uid());
 CREATE TABLE cidadaos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,leader uuid REFERENCES cidadaos,cpf text UNIQUE,user_id uuid REFERENCES auth.users,photourl text,updated_at timestamptz);
 CREATE TABLE demandas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cidadao_id uuid NOT NULL REFERENCES cidadaos,title text NOT NULL,user_id uuid NOT NULL REFERENCES auth.users);
 CREATE TABLE notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demanda_id uuid NOT NULL REFERENCES demandas,text text NOT NULL,user_id uuid NOT NULL REFERENCES auth.users);
 CREATE TABLE veiculos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cidadao_id uuid NOT NULL REFERENCES cidadaos,tipo text NOT NULL CHECK(tipo IN ('Carro','Moto')));
 CREATE TABLE cotas_combustivel(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cidadao_id uuid NOT NULL REFERENCES cidadaos,litros numeric);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$SELECT (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
 GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated; GRANT SELECT ON profiles TO authenticated;
 GRANT SELECT,INSERT,UPDATE,DELETE ON cidadaos,demandas,notes,veiculos,cotas_combustivel,storage.objects TO authenticated;
 DO $$DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['cidadaos','demandas','notes','veiculos','cotas_combustivel'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY admin_all ON %I TO authenticated USING((SELECT role FROM profiles WHERE id=auth.uid())=''admin'') WITH CHECK((SELECT role FROM profiles WHERE id=auth.uid())=''admin'')',t);
 END LOOP; END;$$;
`;
