const { PGlite } = require(process.env.CAMPAIGN_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
            CREATE TABLE profiles(id uuid PRIMARY KEY, role text);
            INSERT INTO profiles VALUES ('11111111-1111-4111-8111-111111111111','admin'),('22222222-2222-4222-8222-222222222222','cadastrador');
            ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
            CREATE POLICY own_profile ON profiles FOR SELECT TO PUBLIC USING(id=auth.uid());
            CREATE TABLE cotas_combustivel(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),posto text);
            ALTER TABLE cotas_combustivel ENABLE ROW LEVEL SECURITY;
            CREATE POLICY legacy_full_access ON cotas_combustivel TO PUBLIC USING(true) WITH CHECK(true);
            GRANT USAGE ON SCHEMA auth TO anon,authenticated;
            GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
            GRANT SELECT ON profiles TO anon,authenticated;
            GRANT SELECT,INSERT,UPDATE,DELETE ON cotas_combustivel TO anon,authenticated;
        `);
        const sql = fs.readFileSync(path.join(__dirname, '../sql/002_combustivel_somente_admin.sql'),'utf8');
        await db.exec(sql); await db.exec(sql);
        await db.exec("SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';");
        const id = (await db.query("INSERT INTO cotas_combustivel(posto) VALUES('admin') RETURNING id")).rows[0].id;
        await db.query("UPDATE cotas_combustivel SET posto='editado' WHERE id=$1",[id]);
        assert.equal((await db.query('SELECT posto FROM cotas_combustivel WHERE id=$1',[id])).rows[0].posto,'editado');
        await db.exec("SET request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';");
        assert.equal((await db.query('SELECT * FROM cotas_combustivel')).rows.length,0);
        await assert.rejects(db.query("INSERT INTO cotas_combustivel(posto) VALUES('negado')"),/row-level security/);
        assert.equal((await db.query("UPDATE cotas_combustivel SET posto='negado' RETURNING id")).rows.length,0);
        assert.equal((await db.query('DELETE FROM cotas_combustivel RETURNING id')).rows.length,0);
        await db.exec("RESET ROLE; SET ROLE anon; SET request.jwt.claim.sub='';");
        assert.equal((await db.query('SELECT * FROM cotas_combustivel')).rows.length,0);
        await assert.rejects(db.query("INSERT INTO cotas_combustivel(posto) VALUES('anon')"),/row-level security/);
        await db.exec("RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';");
        assert.equal((await db.query('SELECT posto FROM cotas_combustivel WHERE id=$1',[id])).rows[0].posto,'editado');
        assert.equal((await db.query('DELETE FROM cotas_combustivel WHERE id=$1 RETURNING id',[id])).rows.length,1);
        console.log('PASS: somente admin consulta, cria, edita e exclui, mesmo com política permissiva legada.');
    } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
