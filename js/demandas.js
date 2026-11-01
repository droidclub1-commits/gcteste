import { PRIORIDADES, deadlineState, applyDemandaFilters } from './demanda-fields.js';
import { formatarData } from './utils.js';
import { escapeHtml } from './utils.js';
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
let viewingDemandaVersion = null;
let demandaModalGeneration = 0;
let currentEditingDemandaId = null;
let editingUpdatedAt = null;
let savingDemanda = false;
let demandGeneration = 0;
let demandLoading = null;
let currentCidadaoIdForDemanda = null;

export async function handleDemandaFormSubmit(e) {
    e.preventDefault();
    if (!state.user) {
        showToast("Sessão expirada.", "error");
        return;
    }
    if (savingDemanda) return;
    savingDemanda = true;
    const saveBtn = $('save-demanda-btn'); saveBtn.disabled = true;
    try {
        const payload = {
            cidadao_id: $('demanda-cidadao-select').value,
            title: $('demanda-title').value.trim(),
            description: $('demanda-description').value.trim(),
            responsavel: $('demanda-responsavel').value.trim() || null,
            prazo: $('demanda-prazo').value || null,
            prioridade: $('demanda-prioridade').value || 'normal',
            status: currentEditingDemandaId ? $('demanda-edit-status').value : 'pending'
        };
        if (!payload.cidadao_id || !payload.title) throw new Error('Selecione o solicitante e informe o título.');
        const { error } = await sb.rpc('salvar_demanda_v1', {
            p_id: currentEditingDemandaId, p_data: payload, p_expected_updated_at: editingUpdatedAt
        });
        if (error) throw error;
        showToast(currentEditingDemandaId ? 'Demanda atualizada.' : 'Demanda adicionada!', 'success');
        closeDemandaModal();
        await loadDemandasPage(true); await _onDashboardChanged();
    } catch (error) {
        showToast(error.message || 'Erro ao salvar demanda.', 'error');
    } finally { savingDemanda = false; saveBtn.disabled = false; }
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
    if (!demanda || viewingDemandaId !== demandaId) return;
    viewingDemandaVersion = demanda.updated_at || null;
    const nomeSolicitante = demanda.cidadao ? demanda.cidadao.name : (state.allCidadaos.find(c => c.id === demanda.cidadao_id)?.name || 'Desconhecido');
    $('details-demanda-title').textContent = demanda.title;
    $('details-demanda-cidadao').textContent = `Solicitante: ${nomeSolicitante}`;
    $('details-demanda-description').textContent = demanda.description || 'Sem descrição.';
    renderDemandaTracking($('details-demanda-tracking'), demanda);
    $('edit-demanda-btn').onclick = () => { closeDemandaDetailsModal(); openDemandaModal(null, demandaId); };
    $('delete-demanda-btn').classList.toggle('hidden', state.userRole !== 'admin');
    const statusSelect = $('details-demanda-status');
    statusSelect.value = demanda.status;
    statusSelect.onchange = null;
    statusSelect.onchange = (e) => updateDemandaStatus(demandaId, e.target.value);
    $('delete-demanda-btn').onclick = () => _onRequestDelete(demandaId, 'demanda');
    await loadDemandaNotes(demandaId);
    $('demanda-details-modal').classList.remove('hidden');
}

export async function updateDemandaStatus(demandaId, newStatus) {
    if (!state.user || savingDemanda) return;
    savingDemanda = true;
    const control = $('details-demanda-status'); if (control) control.disabled = true;
    const previous = state.allDemandas.find(d=>d.id===demandaId);
    try {
        const { error } = await sb.rpc('salvar_demanda_v1', {
            p_id: demandaId, p_data: { status:newStatus }, p_expected_updated_at:viewingDemandaId===demandaId ? viewingDemandaVersion : (previous?.updated_at || null)
        });
        if (error) throw error;
        await loadDemandasPage(true); await _onDashboardChanged();
        await openDemandaDetailsModal(demandaId);
        showToast('Status atualizado.', 'success');
    } catch (error) {
        if (control && previous) control.value=previous.status;
        showToast(error.message || 'Erro ao atualizar status.', 'error');
        if (error.code==='40001') { await loadDemandasPage(true); await openDemandaDetailsModal(demandaId); }
    } finally { savingDemanda=false; if (control) control.disabled=false; }
}

export function renderDemandaTracking(container, demanda) {
    if (!container) return;
    container.textContent = '';
    const priority = document.createElement('span');
    const kind = demanda.prioridade || 'normal';
    priority.className = 'inline-block px-2 py-1 rounded text-xs font-semibold '+({baixa:'bg-gray-100 text-gray-700',normal:'bg-blue-100 text-blue-800',alta:'bg-orange-100 text-orange-800',urgente:'bg-red-100 text-red-800'}[kind] || 'bg-gray-100');
    priority.textContent = 'Prioridade '+(PRIORIDADES[kind] || 'Normal'); container.appendChild(priority);
    const owner = document.createElement('p'); owner.className='text-sm text-gray-600 mt-2';
    owner.textContent='Responsável: '+(demanda.responsavel || 'Não definido'); container.appendChild(owner);
    const deadline = document.createElement('p'); const status=deadlineState(demanda);
    deadline.className='text-sm mt-1 '+(status==='atrasada'?'text-red-700 font-semibold':status==='hoje'?'text-orange-700 font-semibold':'text-gray-600');
    deadline.textContent=demanda.prazo ? 'Prazo: '+formatarData(demanda.prazo)+(status==='atrasada'?' · Em atraso':status==='hoje'?' · Vence hoje':'') : 'Prazo: Não definido';
    container.appendChild(deadline);
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
        if (viewingDemandaId!==demandaId) return;
        if (!notes || notes.length === 0) {
            notesListEl.innerHTML = '<p class="text-sm text-gray-500">Nenhum registo.</p>';
            return;
        }
        notesListEl.innerHTML = '';
        notes.forEach(note => {
            const noteEl = document.createElement('div');
            noteEl.className = 'p-3 bg-gray-100 rounded-lg';
            noteEl.innerHTML = `<p class="text-sm text-gray-800">${escapeHtml(note.text)}</p><p class="text-xs text-gray-500 text-right">${escapeHtml(note.author || 'Utilizador')} - ${new Date(note.created_at).toLocaleString('pt-BR')}</p>`;
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
    const tracking=document.createElement('div'); tracking.className='mt-3';
    renderDemandaTracking(tracking,demanda); infoDiv.appendChild(tracking);
    const statusSpan = document.createElement('span');
    statusSpan.className = statusInfo.classes;
    statusSpan.textContent = statusInfo.text;
    item.appendChild(infoDiv);
    item.appendChild(statusSpan);
    item.addEventListener('click', () => openDemandaDetailsModal(demanda.id));
    return item;
}

export async function loadDemandasPage(reset = true) {
    const list=$('all-demandas-list'); if (!list) return;
    if (reset) demandGeneration++;
    const generation=demandGeneration;
    if (!reset && demandLoading===generation) return;
    demandLoading=generation;
    if (reset) { demandasServerOffset=0; state.allDemandas=[]; list.textContent='Carregando demandas...'; }
    demandasSearchState={
        status:$('demanda-filter-status')?.value || '', leader:$('demanda-filter-leader')?.value || '',
        nome:$('demanda-search-nome')?.value.trim() || '', responsavel:$('demanda-filter-responsavel')?.value.trim() || '',
        prioridade:$('demanda-filter-prioridade')?.value || '', prazo:$('demanda-filter-prazo')?.value || '', ordem:$('demanda-order')?.value || ''
    };
    try {
        // !inner filtra a relação no servidor sem carregar milhares de IDs no navegador.
        const inner=Boolean(demandasSearchState.leader || demandasSearchState.nome);
        let query=sb.from('demandas').select('*, cidadao:cidadaos'+(inner?'!inner':'')+'(id,name,leader)',{count:'exact'});
        query=applyDemandaFilters(query,demandasSearchState)
            .range(demandasServerOffset,demandasServerOffset+DEMANDAS_PAGE_SIZE-1);
        const {data,error,count}=await query;
        if (generation!==demandGeneration) return;
        if (error) throw error;
        totalDemandasCount=count ?? 0;
        state.allDemandas=reset?(data || []):[...state.allDemandas,...(data || [])];
        demandasServerOffset+=(data || []).length;
        if (reset) list.textContent='';
        if (!state.allDemandas.length) list.textContent='Nenhuma demanda encontrada.';
        else for (const demanda of data || []) list.appendChild(buildDemandaCard(demanda));
        const label=$('demandas-count-label');
        if (label) label.textContent=`Exibindo ${state.allDemandas.length} de ${totalDemandasCount} demanda(s)`;
        $('demandas-load-more-wrap')?.classList.toggle('hidden',demandasServerOffset>=totalDemandasCount);
    } catch (error) {
        if (generation!==demandGeneration) return;
        list.textContent='Não foi possível carregar as demandas.';
        if ($('demandas-count-label')) $('demandas-count-label').textContent='';
        $('demandas-load-more-wrap')?.classList.add('hidden');
        showToast(error.message || 'Erro ao carregar demandas.', 'error');
    } finally { if (demandLoading===generation) demandLoading=null; }
}

// NOTA: sem chamadas no app.js atual (mantida por paridade com o app.js original).
export function renderAllDemandas() { return loadDemandasPage(true); }

export function clearDemandaFilters() {
    $('demanda-filter-status').value = '';
    $('demanda-filter-leader').value = '';
    for (const id of ['demanda-filter-responsavel','demanda-filter-prioridade','demanda-filter-prazo','demanda-order']) if ($(id)) $(id).value='';
    const demandaSearchNome = $('demanda-search-nome');
    if (demandaSearchNome) demandaSearchNome.value = '';
    return loadDemandasPage(true);
}

export async function openDemandaModal(cidadaoId = null, demandaId = null) {
    if (savingDemanda || !state.user) return;
    const generation=++demandaModalGeneration;
    let editing = null;
    if (demandaId) {
        const {data,error}=await sb.from('demandas').select('*, cidadao:cidadaos(id,name)').eq('id',demandaId).single();
        if (generation!==demandaModalGeneration) return;
        if (error || !data) { showToast('Não foi possível abrir a demanda.', 'error'); return; }
        editing=data; cidadaoId=data.cidadao_id;
    }
    currentEditingDemandaId = demandaId; editingUpdatedAt=editing?.updated_at || null;
    const demandaForm = $('demanda-form'), demandaModal = $('demanda-modal');
    demandaForm.reset();
    $('demanda-modal-title').textContent=editing?'Editar demanda':'Adicionar demanda';
    $('demanda-responsavel').value=editing?.responsavel || '';
    $('demanda-prazo').value=editing?.prazo || '';
    $('demanda-prioridade').value=editing?.prioridade || 'normal';
    $('demanda-edit-status').value=editing?.status || 'pending';
    $('demanda-edit-status-group').classList.toggle('hidden',!editing);
    $('demanda-title').value=editing?.title || '';
    $('demanda-description').value=editing?.description || '';
    currentCidadaoIdForDemanda = cidadaoId;
    const searchEl = $('demanda-cidadao-search');
    const demandaCidadaoSelect = $('demanda-cidadao-select');
    searchEl.value = '';
    demandaCidadaoSelect.innerHTML = '<option value="" disabled selected>Digite o nome para buscar...</option>';

    // Se veio com um cidadão específico (botão "Demanda" no card), pré-carrega ele
    if (cidadaoId) {
        let cidadao = editing?.cidadao || state.allCidadaos.find(c => c.id === cidadaoId);
        if (!cidadao) {
            const {data}=await sb.from('cidadaos').select('id,name').eq('id',cidadaoId).single();
            cidadao=data;
        }
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

    if (generation===demandaModalGeneration) demandaModal.classList.remove('hidden');
}

export function closeDemandaModal() {
    demandaModalGeneration++;
    $('demanda-modal').classList.add('hidden');
}

export function closeDemandaDetailsModal() {
    $('demanda-details-modal').classList.add('hidden');
    viewingDemandaId = null; viewingDemandaVersion = null;
}
