// ═══════════════════════════════════════════════════════════════
// DEMANDAS — listagem/paginação server-side, filtros, CRUD, modal
// de cadastro, modal de detalhes/notas e cartão da demanda.
// Extraído do app.js (Fase 8 da modularização)
//
// Mesmo padrão de cidadaos.js: consulta o DOM sob demanda via
// getElementById (helper $) em vez de depender de referências
// cacheadas em app.js; estado de paginação/busca fica encapsulado
// aqui dentro. app.js cuida do wiring dos listeners e de excluir
// registos (requestDelete, compartilhado com cidadaos) — por isso
// esse comportamento é injetado via initDemandas().
// ═══════════════════════════════════════════════════════════════

import { showToast, getStatusInfo } from './utils.js';
import { sb } from './config.js';
import { state } from './state.js';

const $ = id => document.getElementById(id);

// ── Callbacks injetados por app.js (ver initDemandas) ───────────────
let _onRequestDelete = () => {};
let _onDashboardChanged = () => {};

export function initDemandas({ onRequestDelete, onDashboardChanged } = {}) {
    if (onRequestDelete)   _onRequestDelete   = onRequestDelete;
    if (onDashboardChanged) _onDashboardChanged = onDashboardChanged;
}

// ── Estado de paginação/busca server-side (encapsulado) ────────────
const DEMANDAS_PAGE_SIZE = 15;
let demandasServerOffset = 0;
let totalDemandasCount = 0;
let demandasSearchState = { status: '', leader: '' };
let viewingDemandaId = null;
let currentEditingDemandaId = null;
let currentCidadaoIdForDemanda = null;

export async function handleDemandaFormSubmit(e) {
    e.preventDefault();
    if (!state.user) {
        showToast("Sessão expirada.", "error");
        return;
    }
    const saveBtn = $('save-demanda-btn');
    saveBtn.disabled = true;
    try {
        const demandaData = {
            cidadao_id: $('demanda-cidadao-select').value,
            title: $('demanda-title').value,
            description: $('demanda-description').value,
            status: 'pending',
            user_id: state.user.id
        };
        const { error } = await sb.from('demandas').insert(demandaData);
        if (error) throw error;
        showToast("Demanda adicionada!", "success");
        closeDemandaModal();
        // Recarrega demandas com JOIN para manter nome do solicitante
        await loadDemandasPage(true);
        await _onDashboardChanged();
    } catch (error) {
        console.error(error);
        showToast("Erro ao salvar.", "error");
    } finally {
        saveBtn.disabled = false;
    }
}

export async function openDemandaDetailsModal(demandaId) {
    viewingDemandaId = demandaId;
    let demanda = state.allDemandas.find(d => d.id === demandaId);
    if (!demanda) {
        // Não está no cache da página actual — busca do servidor
        const { data } = await sb.from('demandas')
            .select('*, cidadao:cidadaos(id, name, leader)')
            .eq('id', demandaId).single();
        demanda = data;
    }
    if (!demanda) return;
    const nomeSolicitante = demanda.cidadao ? demanda.cidadao.name : (state.allCidadaos.find(c => c.id === demanda.cidadao_id)?.name || 'Desconhecido');
    $('details-demanda-title').textContent = demanda.title;
    $('details-demanda-cidadao').textContent = `Solicitante: ${nomeSolicitante}`;
    $('details-demanda-description').textContent = demanda.description || 'Sem descrição.';
    const statusSelect = $('details-demanda-status');
    statusSelect.value = demanda.status;
    statusSelect.onchange = null;
    statusSelect.onchange = (e) => updateDemandaStatus(demandaId, e.target.value);
    $('delete-demanda-btn').onclick = () => _onRequestDelete(demandaId, 'demanda');
    await loadDemandaNotes(demandaId);
    $('demanda-details-modal').classList.remove('hidden');
}

export async function updateDemandaStatus(demandaId, newStatus) {
    if (!state.user) return;
    try {
        const { error } = await sb
            .from('demandas')
            .update({
                status: newStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', demandaId);
        if (error) throw error;
        const { error: noteError } = await sb
            .from('notes')
            .insert({
                text: `Status alterado para: ${getStatusInfo(newStatus).text}`,
                author: "Sistema",
                demanda_id: demandaId,
                user_id: state.user.id
            });
        if (noteError) throw noteError;
        showToast("Status atualizado!", "success");
        // PERFORMANCE: atualiza apenas o objeto local da demanda
        // Actualiza o card localmente sem re-fetch (performance)
        const idx = state.allDemandas.findIndex(d => d.id === demandaId);
        if (idx !== -1) {
            state.allDemandas[idx].status = newStatus;
            state.allDemandas[idx].updated_at = new Date().toISOString();
            // Actualiza o badge de status no card já renderizado
            const allDemandasList = $('all-demandas-list');
            const cards = allDemandasList?.querySelectorAll('.bg-white');
            const card = [...(cards || [])].find(el => el._demandaId === demandaId);
            if (card) {
                const badge = card.querySelector('span[class*="status"]');
                if (badge) { const si = getStatusInfo(newStatus); badge.className = si.classes; badge.textContent = si.text; }
            } else {
                // Card não visível na página actual — ignorar
            }
        }
        await _onDashboardChanged();
        await loadDemandaNotes(demandaId);
    } catch (error) {
        console.error(error);
        showToast("Erro ao atualizar status.", "error");
    }
}

export async function loadDemandaNotes(demandaId) {
    if (!state.user) return;
    const notesListEl = $('demanda-notes-list');
    notesListEl.innerHTML = '<p class="text-sm text-gray-500">A carregar...</p>';
    try {
        const { data: notes, error } = await sb
            .from('notes')
            .select('*')
            .eq('demanda_id', demandaId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        if (!notes || notes.length === 0) {
            notesListEl.innerHTML = '<p class="text-sm text-gray-500">Nenhum registo.</p>';
            return;
        }
        notesListEl.innerHTML = '';
        notes.forEach(note => {
            const noteEl = document.createElement('div');
            noteEl.className = 'p-3 bg-gray-100 rounded-lg';
            noteEl.innerHTML = `<p class="text-sm text-gray-800">${note.text}</p><p class="text-xs text-gray-500 text-right">${note.author || 'Utilizador'} - ${new Date(note.created_at).toLocaleString('pt-BR')}</p>`;
            notesListEl.appendChild(noteEl);
        });
        notesListEl.scrollTop = notesListEl.scrollHeight;
    } catch (error) {
        console.error(error);
        notesListEl.innerHTML = '<p class="text-sm text-red-500">Erro ao carregar.</p>';
    }
}

export async function handleAddNoteSubmit(e) {
    e.preventDefault();
    if (!state.user || !viewingDemandaId) return;
    const newNoteText = $('new-note-text');
    const text = newNoteText.value.trim();
    if (!text) return;
    try {
        const { error } = await sb
            .from('notes')
            .insert({
                text: text,
                author: state.user.email || "Utilizador",
                demanda_id: viewingDemandaId,
                user_id: state.user.id
            });
        if (error) throw error;
        newNoteText.value = '';
        await loadDemandaNotes(viewingDemandaId);
    } catch (error) {
        console.error(error);
        showToast("Erro ao salvar.", "error");
    }
}

export function buildDemandaCard(demanda) {
    const nomeSolicitante = demanda.cidadao ? demanda.cidadao.name : 'Desconhecido';
    const statusInfo = getStatusInfo(demanda.status);
    const item = document.createElement('div');
    item._demandaId = demanda.id; // usado por updateDemandaStatus para achar o card e atualizar o selo sem reload
    item.className = 'bg-white p-4 rounded-lg shadow-sm border flex justify-between items-center cursor-pointer hover:shadow-md transition-shadow';
    const titleEl = document.createElement('h3');
    titleEl.className = 'text-lg font-semibold text-gray-800';
    titleEl.textContent = demanda.title;
    const solicitanteEl = document.createElement('p');
    solicitanteEl.className = 'text-sm text-gray-600';
    solicitanteEl.innerHTML = 'Solicitante: <span class="font-medium text-blue-600"></span>';
    solicitanteEl.querySelector('span').textContent = nomeSolicitante;
    const dataEl = document.createElement('p');
    dataEl.className = 'text-sm text-gray-500';
    dataEl.textContent = `Data: ${demanda.created_at ? new Date(demanda.created_at).toLocaleDateString('pt-BR') : 'N/A'}`;
    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1';
    infoDiv.appendChild(titleEl);
    infoDiv.appendChild(solicitanteEl);
    infoDiv.appendChild(dataEl);
    const statusSpan = document.createElement('span');
    statusSpan.className = statusInfo.classes;
    statusSpan.textContent = statusInfo.text;
    item.appendChild(infoDiv);
    item.appendChild(statusSpan);
    item.addEventListener('click', () => openDemandaDetailsModal(demanda.id));
    return item;
}

export async function loadDemandasPage(reset = true) {
    const allDemandasList = $('all-demandas-list');
    if (!allDemandasList) return;

    if (reset) {
        demandasServerOffset = 0;
        state.allDemandas = [];
        allDemandasList.innerHTML = '<p class="text-gray-400 text-center py-6">A carregar...</p>';
    }

    const demandaFilterStatus = $('demanda-filter-status'), demandaFilterLeader = $('demanda-filter-leader'),
          demandaSearchNome = $('demanda-search-nome');
    demandasSearchState = {
        status: demandaFilterStatus?.value || '',
        leader: demandaFilterLeader?.value || '',
        nome:   demandaSearchNome?.value.trim() || ''
    };

    try {
        // ── PASSO 1: pré-filtro por liderança e/ou nome do solicitante ──
        // O Supabase NÃO suporta .eq() em colunas de relações (JOINs).
        // Filtrar por leader diretamente causaria cidadao: null nos resultados.
        // Solução: buscar os cidadao_ids que correspondem ao critério, depois .in()
        let cidadaoIdsFilter = null;

        if (demandasSearchState.leader || demandasSearchState.nome) {
            let qCid = sb.from('cidadaos').select('id');
            if (demandasSearchState.leader)
                qCid = qCid.eq('leader', demandasSearchState.leader);
            if (demandasSearchState.nome)
                qCid = qCid.ilike('name', `%${demandasSearchState.nome}%`);

            const { data: cids, error: eCid } = await qCid;
            if (eCid) throw eCid;

            cidadaoIdsFilter = (cids || []).map(c => c.id);

            // Zero correspondências — resultado imediato sem query adicional
            if (cidadaoIdsFilter.length === 0) {
                state.allDemandas = [];
                if (reset) allDemandasList.innerHTML = '';
                allDemandasList.innerHTML = '<p class="text-gray-500 text-center py-8">Nenhuma demanda encontrada para este filtro.</p>';
                const label = $('demandas-count-label');
                if (label) label.textContent = '0 demanda(s) encontrada(s)';
                $('demandas-load-more-wrap')?.classList.add('hidden');
                return;
            }
        }

        // ── PASSO 2: query principal com JOIN limpo ──────────────────────
        // O select do cidadao usa apenas id e name — sem filtros na relação,
        // garantindo que o JOIN sempre retorna os dados correctamente.
        let query = sb.from('demandas')
            .select('id, title, description, status, created_at, updated_at, cidadao_id, cidadao:cidadaos(id, name)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(demandasServerOffset, demandasServerOffset + DEMANDAS_PAGE_SIZE - 1);

        if (demandasSearchState.status)   query = query.eq('status', demandasSearchState.status);
        if (cidadaoIdsFilter !== null)     query = query.in('cidadao_id', cidadaoIdsFilter);

        const { data, error, count } = await query;
        if (error) throw error;

        // Guardar count total para o dashboard e gráfico
        if (reset || totalDemandasCount === 0) totalDemandasCount = count || 0;

        // Acrescentar ao cache local (só a página corrente)
        state.allDemandas = reset ? (data || []) : [...state.allDemandas, ...(data || [])];
        demandasServerOffset += (data || []).length;

        // Renderizar
        if (reset) allDemandasList.innerHTML = '';

        if (state.allDemandas.length === 0) {
            allDemandasList.innerHTML = '<p class="text-gray-500 text-center py-8">Nenhuma demanda encontrada.</p>';
        } else {
            const fragment = document.createDocumentFragment();
            (data || []).forEach(d => fragment.appendChild(buildDemandaCard(d)));
            allDemandasList.appendChild(fragment);
        }

        // Contador
        const label = $('demandas-count-label');
        if (label) {
            const temFiltro = demandasSearchState.status || demandasSearchState.leader || demandasSearchState.nome;
            label.textContent = temFiltro
                ? `${state.allDemandas.length} demanda(s) encontrada(s)`
                : `Exibindo ${state.allDemandas.length} de ${totalDemandasCount} demanda(s)`;
        }

        // Botão "Carregar Mais"
        const wrap = $('demandas-load-more-wrap');
        if (wrap) wrap.classList.toggle('hidden', demandasServerOffset >= totalDemandasCount);

    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar demandas: ' + e.message, 'error');
    }
}

// NOTA: sem chamadas no app.js atual (mantida por paridade com o app.js original).
export function renderAllDemandas() { return loadDemandasPage(true); }

export function clearDemandaFilters() {
    $('demanda-filter-status').value = '';
    $('demanda-filter-leader').value = '';
    const demandaSearchNome = $('demanda-search-nome');
    if (demandaSearchNome) demandaSearchNome.value = '';
    return loadDemandasPage(true);
}

export async function openDemandaModal(cidadaoId = null) {
    currentEditingDemandaId = null;
    const demandaForm = $('demanda-form'), demandaModal = $('demanda-modal');
    demandaForm.reset();
    currentCidadaoIdForDemanda = cidadaoId;
    const searchEl = $('demanda-cidadao-search');
    const demandaCidadaoSelect = $('demanda-cidadao-select');
    searchEl.value = '';
    demandaCidadaoSelect.innerHTML = '<option value="" disabled selected>Digite o nome para buscar...</option>';

    // Se veio com um cidadão específico (botão "Demanda" no card), pré-carrega ele
    if (cidadaoId) {
        const cidadao = state.allCidadaos.find(c => c.id === cidadaoId);
        if (cidadao) {
            const opt = document.createElement('option');
            opt.value = cidadao.id;
            opt.textContent = cidadao.name;
            demandaCidadaoSelect.appendChild(opt);
            demandaCidadaoSelect.value = cidadaoId;
        }
    }

    // PERFORMANCE: busca cidadãos dinamicamente conforme o usuário digita (não carrega 25k)
    let demandaSearchDebounce;
    searchEl.oninput = () => {
        clearTimeout(demandaSearchDebounce);
        demandaSearchDebounce = setTimeout(async () => {
            const term = searchEl.value.trim();
            if (term.length < 2) return;
            const { data } = await sb
                .from('cidadaos')
                .select('id, name')
                .ilike('name', `%${term}%`)
                .order('name')
                .limit(20);
            if (!data) return;
            const currentVal = demandaCidadaoSelect.value;
            demandaCidadaoSelect.innerHTML = '<option value="" disabled>Selecione...</option>';
            data.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                demandaCidadaoSelect.appendChild(opt);
            });
            if (currentVal) demandaCidadaoSelect.value = currentVal;
        }, 300);
    };

    demandaModal.classList.remove('hidden');
}

export function closeDemandaModal() {
    $('demanda-modal').classList.add('hidden');
}

export function closeDemandaDetailsModal() {
    $('demanda-details-modal').classList.add('hidden');
    viewingDemandaId = null;
}
