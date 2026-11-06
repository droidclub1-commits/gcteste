import { sb } from './config.js';
import { canEditCampaign } from './campaign-access.js';
import { state } from './state.js';
import { DEFAULT_CAMPAIGN, validateCampaign } from './campaign-model.js';

const stages = {
    draft: 'Rascunho',
    database: 'Banco preparado',
    published: 'Site publicado',
    invited: 'Convite enviado',
    active: 'Ativo'
};
const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const element = id => document.getElementById(id);
let generation = 0;

function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
}

function downloadConfiguration(client) {
    if (!canEditCampaign()) return;
    const settings = validateCampaign({
        ...DEFAULT_CAMPAIGN,
        campaign_name: client.name,
        city: client.municipality,
        uf: client.uf,
        municipalities: [client.municipality],
        map_lat: -14,
        map_lng: -52,
        map_zoom: 4
    });
    const file = { application: 'gcteste-config', schema_version: 1, settings };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `configuracao-${client.slug}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderClient(client) {
    const item = document.createElement('li');
    item.className = 'border rounded-lg p-3 space-y-2 text-sm';
    const title = document.createElement('h3');
    title.className = 'font-semibold';
    title.textContent = `${client.name} · ${client.municipality}/${client.uf}`;
    const detail = document.createElement('p');
    detail.textContent = client.site_url ? client.admin_email : `${client.admin_email} · Endereço previsto: gestorcidadao-${client.slug}.pages.dev`;
    detail.className = 'break-words text-gray-600';
    const label = document.createElement('label');
    label.textContent = 'Etapa registrada ';
    const select = document.createElement('select');
    select.className = 'border rounded p-2';
    for (const [value, text] of Object.entries(stages)) addOption(select, value, text);
    select.value = client.stage;
    select.addEventListener('change', async () => {
        if (!canEditCampaign()) return;
        const user = state.user.id;
        const next = select.value;
        select.disabled = true;
        try {
            const { error } = await sb.rpc('atualizar_etapa_cliente_v1', {
                p_slug: client.slug, p_stage: next, p_expected_stage: client.stage
            });
            if (error) throw error;
            client.stage = next;
            if (state.user?.id === user) element('client-installation-status').textContent = 'Etapa registrada.';
        } catch (error) {
            select.value = client.stage;
            if (state.user?.id === user) element('client-installation-status').textContent = error.message;
        } finally {
            select.disabled = false;
        }
    });
    label.append(select);
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'block text-blue-700 underline';
    download.textContent = 'Baixar configuração inicial';
    download.addEventListener('click', () => downloadConfiguration(client));
    item.append(title, detail, label, download);
    if (/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.pages\.dev$/.test(client.site_url)) {
        const link = document.createElement('a');
        link.href = client.site_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'block break-words text-blue-700 underline';
        link.textContent = `Abrir instalação · ${new URL(client.site_url).hostname}`;
        item.append(link);
    }
    return item;
}

async function loadClients() {
    if (!canEditCampaign()) return;
    const token = ++generation;
    const user = state.user.id;
    const status = element('client-installation-status');
    const list = element('client-installation-list');
    status.textContent = 'Carregando clientes…';
    list.replaceChildren();
    try {
        const { data, error } = await sb.rpc('listar_clientes_v1');
        if (token !== generation || state.user?.id !== user || !canEditCampaign()) return;
        if (error) throw error;
        list.replaceChildren(...data.map(renderClient));
        status.textContent = data.length ? '' : 'Nenhum cliente cadastrado.';
    } catch (error) {
        if (token === generation && state.user?.id === user) status.textContent = error.message;
    }
}

export function resetClientInstallations() {
    generation++;
    const panel = element('client-installations');
    if (!panel) return;
    panel.open = false;
    element('client-installation-form').reset();
    element('client-installation-list').replaceChildren();
    element('client-installation-status').textContent = '';
}

export function setupClientInstallations() {
    const panel = element('client-installations');
    const form = element('client-installation-form');
    if (!panel || form.dataset.ready) return;
    form.dataset.ready = 'true';
    addOption(form.elements.uf, '', 'Selecione');
    for (const uf of states) addOption(form.elements.uf, uf, uf);
    panel.addEventListener('toggle', () => {
        if (panel.open) loadClients();
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!canEditCampaign()) return;
        const user = state.user.id;
        const button = form.querySelector('button[type=submit]');
        const status = element('client-installation-status');
        const fields = new FormData(form);
        const payload = Object.fromEntries([...fields].map(([key, value]) => [`p_${key}`, value.trim()]));
        button.disabled = true;
        try {
            const { error } = await sb.rpc('cadastrar_cliente_v1', payload);
            if (error) throw error;
            if (state.user?.id !== user || !canEditCampaign()) return;
            form.reset();
            await loadClients();
        } catch (error) {
            if (state.user?.id === user) {
                status.textContent = error.code === '23505' ? 'Este nome curto já está em uso.' : error.message;
            }
        } finally {
            button.disabled = false;
        }
    });
}

