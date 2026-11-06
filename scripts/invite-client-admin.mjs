import { execFileSync } from 'node:child_process';

const { GC_CLIENT_PROJECT_REF: ref, GC_CLIENT_SITE_URL: site, GC_CLIENT_ADMIN_EMAIL: email } = process.env;
if (!/^[a-z0-9]{20}$/.test(ref) || !/^https:\/\/gestorcidadao-[a-z0-9-]+\.pages\.dev$/.test(site) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe o projeto, a URL Pages e o e-mail do administrador do cliente.');
}

async function verifySite(path, expected) {
    const response = await fetch(site + path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !(await response.text()).includes(expected)) {
        throw new Error(`O site do cliente ainda não está pronto em ${path}.`);
    }
}

const base = `https://${ref}.supabase.co`;
await Promise.all([
    verifySite('/js/config.js', base),
    verifySite('/primeiro-acesso.html', 'first-access-form')
]);

let keys;
try {
    keys = JSON.parse(execFileSync('supabase', ['--workdir', '.', 'projects', 'api-keys',
        '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
    throw new Error('Não foi possível ler as chaves do projeto com o CLI do Supabase.');
}
const serviceKey = keys.find(key => key.name === 'service_role' && !key.disabled)?.api_key;
if (!serviceKey) throw new Error('A chave de servidor não está disponível para o projeto.');

async function request(path, method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(base + path, {
        method,
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...extraHeaders },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Falha na etapa ${path.split('?')[0]} (HTTP ${response.status}, ${error.error_code ?? error.code ?? 'sem código'}).`);
    }
    const content = await response.text();
    return content ? JSON.parse(content) : null;
}

const { users } = await request('/auth/v1/admin/users?page=1&per_page=2');
let admin = users.find(user => user.email?.toLowerCase() === email.toLowerCase());
if (users.length > 1 || (users.length === 1 && !admin?.invited_at)) {
    throw new Error('A instalação já possui contas. A criação do primeiro administrador foi interrompida.');
}
if (!admin) {
    const redirect = encodeURIComponent(`${site}/primeiro-acesso.html`);
    admin = await request(`/auth/v1/invite?redirect_to=${redirect}`, 'POST', { email });
}
await request('/rest/v1/profiles?on_conflict=id', 'POST', { id: admin.id, role: 'admin' },
    { Prefer: 'resolution=ignore-duplicates,return=minimal' });
const [profile] = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(admin.id)}&select=role`);
if (profile?.role !== 'admin') throw new Error('O perfil do primeiro administrador ainda não foi confirmado.');
console.log(admin.last_sign_in_at ? 'Primeiro acesso já realizado.' : 'Convite registrado e perfil de administrador confirmado.');

