import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSite } from './build-site.mjs';
import { uploadPagesAssets } from './upload-pages-assets.mjs';

const env = process.env;
const central = env.GC_CONTROL_PROJECT_REF;
const organization = env.GC_SUPABASE_ORGANIZATION;
const cloudflareAccount = env.GC_CLOUDFLARE_ACCOUNT_ID;
if (![central, organization, cloudflareAccount, env.SUPABASE_ACCESS_TOKEN, env.CLOUDFLARE_API_TOKEN].every(Boolean)) {
    throw new Error('Configure as credenciais do executor de provisionamento.');
}

async function json(url, token, { method = 'GET', body, apiKey = false, missing = false } = {}) {
    const multipart = body instanceof FormData;
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(apiKey ? { apikey: token } : {}),
            ...(body && !multipart ? { 'Content-Type': 'application/json' } : {})
        },
        body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
    });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Serviço externo recusou ${method} ${new URL(url).pathname} (HTTP ${response.status}).`);
    const data = await response.text();
    return data ? JSON.parse(data) : null;
}

const management = (route, options) => json('https://api.supabase.com/v1' + route, env.SUPABASE_ACCESS_TOKEN, options);
const query = (ref, sql) => management(`/projects/${ref}/database/query`, { method: 'POST', body: { query: sql } });
const pages = async (route, options) => {
    const data = await json(`https://api.cloudflare.com/client/v4/accounts/${cloudflareAccount}/pages/projects${route}`, env.CLOUDFLARE_API_TOKEN, options);
    if (data && !data.success) throw new Error('Cloudflare recusou a operação do Pages.');
    return data?.result ?? null;
};
const api = (ref, key, route, options) => json(`https://${ref}.supabase.co${route}`, key, { ...options, apiKey: true });
const keysFor = ref => management(`/projects/${ref}/api-keys?reveal=true`);
const keyFor = (keys, name) => {
    const key = keys.find(item => item.name === name && !item.disabled)?.api_key;
    if (!key) throw new Error(`Chave ${name} indisponível no projeto.`);
    return key;
};
const centralKey = keyFor(await keysFor(central), 'service_role');
const rpc = (name, body = {}) => api(central, centralKey, `/rest/v1/rpc/${name}`, { method: 'POST', body });
const [job] = await rpc('reivindicar_instalacao_cliente_v1');
if (!job) {
    await Promise.all([management('/projects'), management(`/organizations/${organization}`),
        query(central, 'SELECT 1 AS executor_check'), pages('')]);
    console.log('Fila vazia. Supabase e Cloudflare Pages acessíveis.');
    process.exit(0);
}

const { slug, provision_id: id, provision_updated_at: lease } = job;
let ref = job.project_ref;
let stage = job.stage;
let site = job.site_url;
const save = async (state, note = null) => {
    if (!await rpc('registrar_provisionamento_cliente_v1', {
        p_slug: slug, p_lease: lease, p_stage: stage, p_project_ref: ref ?? null,
        p_site_url: site ?? null, p_state: state, p_note: note
    })) throw new Error('A execução perdeu o controle desta instalação.');
};

async function poll(check, message) {
    for (let attempt = 0; attempt < 45; attempt++) {
        if (await check()) return;
        await delay(6000);
    }
    throw new Error(message);
}

async function ensureProject() {
    const name = `GC ${slug} ${id.slice(0, 12)}`;
    if (!ref) {
        const projects = await management('/projects');
        const existing = projects.filter(project => project.organization_slug === organization && project.name === name);
        if (existing.length > 1) throw new Error('Há projetos duplicados com a referência desta instalação.');
        ref = existing[0]?.ref;
        if (!ref) {
            const org = await management(`/organizations/${organization}`);
            if (org.plan === 'free' && projects.filter(project => project.status !== 'INACTIVE').length >= 2) {
                throw new Error('As vagas gratuitas do Supabase estão ocupadas.');
            }
            if (org.plan !== 'free' && env.GC_ALLOW_PAID_PROJECTS !== 'true') {
                throw new Error('Criação de projetos com cobrança ainda não autorizada no executor.');
            }
            const created = await management('/projects', { method: 'POST', body: {
                name, organization_slug: organization, region: 'sa-east-1',
                db_pass: randomBytes(36).toString('base64url')
            } });
            ref = created.ref;
        }
    }
    if (!/^[a-z0-9]{20}$/.test(ref) || ref === central) throw new Error('Referência do projeto cliente inválida.');
    await poll(async () => {
        const project = await management(`/projects/${ref}`);
        if (project.organization_slug !== organization || project.name !== name) throw new Error('O projeto pertence a outra instalação.');
        await save('running', 'Aguardando o banco Supabase.');
        return project.status === 'ACTIVE_HEALTHY';
    }, 'O banco ainda não ficou disponível. Retome esta instalação.');
}

async function installDatabase() {
    const [schema] = await query(ref, "SELECT to_regclass('public.cidadaos') IS NOT NULL AS installed, to_regclass('platform_private.installation_origin') IS NOT NULL AS marked");
    if (schema.installed && !schema.marked) throw new Error('O banco contém um esquema de outra instalação.');
    if (schema.marked) {
        const [origin] = await query(ref, 'SELECT provision_id FROM platform_private.installation_origin');
        if (origin?.provision_id !== id) throw new Error('O banco foi inicializado para outro pedido.');
    } else {
        const files = ['base_instalacao.sql', ...(await readdir('sql')).filter(file => /^00[1-9]_.*\.sql$/.test(file)).sort()];
        const parts = await Promise.all(files.map(file => readFile(`sql/${file}`, 'utf8')));
        const schemaSql = parts.map(part => part.replace(/^\s*BEGIN;\s*/i, '').replace(/COMMIT;\s*$/i, '')).join('\n');
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Identificador de instalação inválido.');
        const settings = JSON.stringify({ name: job.name, city: job.municipality, uf: job.uf });
        let marker = '$client$';
        while (settings.includes(marker)) marker = marker.replace('$client', '$client_');
        await query(ref, `BEGIN;
${schemaSql}
CREATE TABLE platform_private.installation_origin (provision_id uuid PRIMARY KEY);
REVOKE ALL ON platform_private.installation_origin FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO platform_private.installation_origin VALUES ('${id}');
WITH cfg AS (SELECT ${marker}${settings}${marker}::jsonb AS value)
UPDATE public.campanha_config SET campaign_name=cfg.value->>'name', city=cfg.value->>'city', uf=cfg.value->>'uf',
municipalities=ARRAY[cfg.value->>'city'], map_lat=-14, map_lng=-52, map_zoom=4 FROM cfg WHERE campanha_config.id=1;
COMMIT;`);
    }
    for (const name of ['manage-users', 'public-cadastro']) {
        execFileSync('supabase', ['functions', 'deploy', name, '--project-ref', ref, '--use-api'], { stdio: 'ignore', timeout: 120000 });
    }
    stage = 'database';
    await save('running', 'Banco e funções preparados.');
}

async function publish(anon) {
    const name = `gestorcidadao-${slug}`;
    let project = await pages('/' + name, { missing: true });
    if (!project) {
        project = await pages('', { method: 'POST', body: {
            name, production_branch: 'main',
            deployment_configs: { production: { env_vars: { GC_INSTALLATION_ID: { type: 'plain_text', value: id } } } }
        } });
    }
    if (project.deployment_configs?.production?.env_vars?.GC_INSTALLATION_ID?.value !== id ||
        !/^gestorcidadao-[a-z0-9-]+\.pages\.dev$/.test(project.subdomain)) {
        throw new Error('O endereço do Pages pertence a outra instalação.');
    }
    site = `https://${project.subdomain}`;
    await save('running', 'Publicando a instalação.');
    const base = `https://${ref}.supabase.co`;
    const served = async () => {
        const files = [['/js/config.js', base], ['/cadastro-publico.js', base], ['/primeiro-acesso.html', 'password-recovery-form']];
        return (await Promise.all(files.map(async ([file, marker]) => {
            try {
                const result = await fetch(site + file, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
                return result.ok && (await result.text()).includes(marker);
            } catch { return false; }
        }))).every(Boolean);
    };
    if (!await served()) {
        const directory = await buildSite(undefined, { url: base, key: anon });
        const { jwt } = await pages(`/${name}/upload-token`);
        const manifest = await uploadPagesAssets(directory, jwt);
        const form = new FormData();
        form.append('branch', 'main');
        form.append('manifest', JSON.stringify(manifest));
        form.append('_headers', new Blob([await readFile(`${directory}/_headers`)], { type: 'text/plain' }), '_headers');
        await pages(`/${name}/deployments`, { method: 'POST', body: form });
        await poll(served, 'A publicação ainda não ficou disponível. Retome esta instalação.');
    }
    stage = 'published';
    await save('running', 'Site publicado.');
}

try {
    let smtp;
    if (stage !== 'invited') {
        try { smtp = JSON.parse(env.GC_CLIENT_SMTP_JSON || '{}'); }
        catch { throw new Error('A configuração SMTP do executor precisa ser JSON válido.'); }
        const required = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_admin_email', 'smtp_sender_name'];
        const configured = required.every(field => typeof smtp[field] === 'string' && smtp[field]);
        const teamPilot = env.GC_TEAM_PILOT_EMAIL?.trim().toLowerCase() === job.admin_email.toLowerCase();
        if (!configured && !teamPilot) {
            throw new Error('Configure o SMTP dos clientes antes de criar a instalação.');
        }
        smtp = configured ? Object.fromEntries(required.map(field => [field, smtp[field]])) : {};
    }
    await ensureProject();
    if (stage === 'draft') await installDatabase();
    const keys = await keysFor(ref);
    if (stage === 'database') await publish(keyFor(keys, 'anon'));
    if (stage === 'published') {
        await management(`/projects/${ref}/config/auth`, { method: 'PATCH', body: {
            ...smtp, site_url: site, uri_allow_list: `${site}/primeiro-acesso.html`,
            disable_signup: true, external_email_enabled: true, password_min_length: 12
        } });
        execFileSync(process.execPath, ['scripts/invite-client-admin.mjs'], {
            stdio: 'ignore', timeout: 120000, env: {
                ...env, GC_CLIENT_PROJECT_REF: ref, GC_CLIENT_SITE_URL: site, GC_CLIENT_ADMIN_EMAIL: job.admin_email
            }
        });
        stage = 'invited';
    }
    const [admin] = await query(ref, "SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE p.role='admin' AND u.invited_at IS NOT NULL AND u.last_sign_in_at IS NOT NULL) AS active");
    if (admin.active) stage = 'active';
    await save('idle', admin.active ? null : 'Aguardando o primeiro acesso.');
} catch (error) {
    const message = error.code || !error.message ? 'Falha em uma etapa externa. Confira as credenciais e retome a instalação.' : error.message;
    await save('failed', message);
    process.exitCode = 1;
}

