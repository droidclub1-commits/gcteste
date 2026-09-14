// ═══════════════════════════════════════════════════════════════
// CIDADAOS — listagem/paginação server-side, filtros, CRUD, modal
// de cadastro, modal de detalhes e cartão do cidadão.
// Extraído do app.js (Fase 7 da modularização)
//
// Padrão seguido (igual a backup.js/reports.js): consulta o DOM
// sob demanda via getElementById em vez de depender de referências
// cacheadas — o módulo não assume que app.js já resolveu os
// elementos. Estado de paginação/busca fica encapsulado aqui dentro
// (não vai para state.js) pelo mesmo motivo documentado em reports.js.
//
// app.js ainda cuida de: wiring dos listeners (addEventListener),
// abrir modal de demanda, excluir registos (requestDelete) e abrir
// o mapa — por isso este módulo recebe esses três comportamentos
// via initCidadaos(), evitando import circular com app.js.
// ═══════════════════════════════════════════════════════════════

import { showToast, getInitials, formatarData, getFaixaEtaria } from './utils.js';
import { sb } from './config.js';
import { state } from './state.js';

const $ = id => document.getElementById(id);

// ── Callbacks injetados por app.js (ver initCidadaos) ──────────────
let _onOpenDemanda    = () => {};
let _onRequestDelete  = () => {};
let _onLeadersChanged = () => {};
let _onOpenMap        = () => {};

export function initCidadaos({ onOpenDemanda, onRequestDelete, onLeadersChanged, onOpenMap } = {}) {
    if (onOpenDemanda)    _onOpenDemanda    = onOpenDemanda;
    if (onRequestDelete)  _onRequestDelete  = onRequestDelete;
    if (onLeadersChanged) _onLeadersChanged = onLeadersChanged;
    if (onOpenMap)        _onOpenMap        = onOpenMap;
}

// ── Estado de paginação/busca server-side (encapsulado) ────────────
const CIDADAOS_PAGE_SIZE = 12;
let totalCidadaosCount = 0;
let cidadaosServerOffset = 0;
let serverSearchState = { search: '', type: '', bairro: '', cidade: '', leader: '', sexo: '', faixaEtaria: '', localTrabalho: '' };
let currentEditingId = null;
let currentCidadaoIdForDetails = null;

// Usado pelo botão "Exportar Excel" e por generatePrintReport em app.js
// (essas funções recebem o filtro atual como parâmetro)
export function getCidadaosServerSearchState() {
    return serverSearchState;
}

// Usado por updateDashboard (app.js) para evitar uma query de contagem
// extra quando a página de Cidadãos já foi carregada nesta sessão.
export function getTotalCidadaosCount() {
    return totalCidadaosCount;
}

export async function loadBairrosDistintos() {
    try {
        const { data, error } = await sb
            .from('cidadaos')
            .select('bairro')
            .not('bairro', 'is', null)
            .order('bairro', { ascending: true });
        if (error) throw error;
        const bairrosUnicos = [...new Set(data.map(c => c.bairro).filter(Boolean))];
        // Guarda para o filtro sem precisar de state.allCidadaos
        window._bairrosDisponiveis = bairrosUnicos;
    } catch (e) {
        console.warn('Não foi possível carregar bairros:', e);
        window._bairrosDisponiveis = [];
    }
}

// ── PERFORMANCE: busca paginada no servidor ────────────────────────────────
export async function loadCidadaosPage(reset = false) {
    const cidadaosGrid = $('cidadaos-grid');
    if (!cidadaosGrid) return;
    if (reset) {
        cidadaosServerOffset = 0;
        cidadaosGrid.innerHTML = '';
        state.allCidadaos = []; // limpa cache local
    }

    const s = serverSearchState;
    let query = sb.from('cidadaos').select('*', { count: 'exact' });

    // Filtros aplicados no servidor
    if (s.search) {
        query = query.or(`name.ilike.%${s.search}%,email.ilike.%${s.search}%,cpf.ilike.%${s.search}%,voterid.ilike.%${s.search}%`);
    }
    if (s.type)    query = query.eq('type', s.type);
    if (s.bairro)  query = query.eq('bairro', s.bairro);
    if (s.cidade)  query = query.eq('cidade', s.cidade);
    if (s.leader)  query = query.eq('leader', s.leader);
    if (s.sexo)    query = query.eq('sexo', s.sexo);
    if (s.localTrabalho) query = query.ilike('localtrabalho', `%${s.localTrabalho}%`);

    // Faixa etária: calcula intervalo de datas no servidor
    if (s.faixaEtaria && s.faixaEtaria !== 'N/A') {
        const hoje = new Date();
        const faixas = {
            '0-17':  [0, 17], '18-25': [18, 25], '26-35': [26, 35],
            '36-50': [36, 50], '51-65': [51, 65], '66+':   [66, 150]
        };
        const [minAge, maxAge] = faixas[s.faixaEtaria] || [0, 150];
        const maxDate = new Date(hoje); maxDate.setFullYear(hoje.getFullYear() - minAge);
        const minDate = new Date(hoje); minDate.setFullYear(hoje.getFullYear() - maxAge - 1);
        query = query.gte('dob', minDate.toISOString().split('T')[0])
                     .lte('dob', maxDate.toISOString().split('T')[0]);
    }

    query = query
        .order('name', { ascending: true })
        .range(cidadaosServerOffset, cidadaosServerOffset + CIDADAOS_PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) { console.error(error); showToast('Erro ao carregar cidadãos.', 'error'); return; }

    totalCidadaosCount = count ?? totalCidadaosCount;
    state.allCidadaos = reset ? data : [...state.allCidadaos, ...data];
    cidadaosServerOffset += data.length;

    // Renderiza somente o batch novo
    if (reset) cidadaosGrid.innerHTML = '';
    if (state.allCidadaos.length === 0) {
        cidadaosGrid.innerHTML = '<p class="text-gray-500 col-span-full text-center">Nenhum cidadão encontrado.</p>';
    } else {
        data.forEach(cidadao => cidadaosGrid.appendChild(buildCidadaoCard(cidadao)));
    }

    const loadMoreContainer = $('load-more-container');
    if (cidadaosServerOffset < totalCidadaosCount) {
        loadMoreContainer.classList.remove('hidden');
    } else {
        loadMoreContainer.classList.add('hidden');
    }

    // Atualiza contador no topo
    const countEl = $('cidadaos-count');
    if (countEl) countEl.textContent = `${totalCidadaosCount} encontrado(s)`;
}

// Geocodifica o endereço tentando níveis progressivamente menos específicos.
// Sem isso, endereços não encontrados exatamente no OpenStreetMap (comum em
// municípios pequenos/rurais) ficavam sem nenhum pin no mapa — mesmo quando
// bairro/cidade eram encontráveis. Cada tentativa usa parâmetros estruturados
// do Nominatim (mais precisos que uma busca de texto livre) e o resultado
// mais específico que retornar algo é usado.
async function geocodeComFallback({ numero, logradouro, bairro, cidade, estado }) {
    const tentativas = [
        { street: `${numero ? numero + ' ' : ''}${logradouro}`.trim(), city: cidade, state: estado },
        { street: bairro, city: cidade, state: estado },
        { city: cidade, state: estado }
    ];
    for (const t of tentativas) {
        if (!t.city) continue;
        const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br' });
        if (t.street) params.set('street', t.street);
        params.set('city', t.city);
        if (t.state) params.set('state', t.state);
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
            const data = await response.json();
            if (data && data.length > 0) {
                return { lat: parseFloat(data[0].lat), long: parseFloat(data[0].lon) };
            }
        } catch (geocodeError) {
            console.error(geocodeError);
        }
    }
    return { lat: null, long: null };
}

export async function handleCidadaoFormSubmit(e) {
    e.preventDefault();
    if (!state.user) {
        showToast("Sessão expirada. Faça login novamente.", "error");
        return;
    }
    const saveBtn = $('save-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div>';
    const cidadaoCPF = $('cidadao-cpf'), cidadaoVoterId = $('cidadao-voterid');
    const cpf = cidadaoCPF.value.trim() || null;
    const voterid = cidadaoVoterId.value.trim() || null;
    try {
        const cidadaoPhotoUrl = $('cidadao-photo-url'), cidadaoPhotoUpload = $('cidadao-photo-upload');
        let photoUrl = cidadaoPhotoUrl.value;
        const file = cidadaoPhotoUpload.files[0];
        if (file) {
            const filePath = `${state.user.id}/${Date.now()}_${file.name}`;
            const { error: uploadError } = await sb.storage
                .from('fotos-cidadaos')
                .upload(filePath, file);
            if (uploadError) throw uploadError;
            const { data } = sb.storage
                .from('fotos-cidadaos')
                .getPublicUrl(filePath);
            photoUrl = data.publicUrl;
        }
        const cidadaoLogradouro = $('cidadao-logradouro'), cidadaoBairro = $('cidadao-bairro'),
              cidadaoCidade = $('cidadao-cidade'), cidadaoEstado = $('cidadao-estado');
        const cidadaoNumero = $('cidadao-numero');
        let lat = null, long = null;
        if (cidadaoLogradouro.value && cidadaoCidade.value) {
            const geo = await geocodeComFallback({
                numero: cidadaoNumero.value,
                logradouro: cidadaoLogradouro.value,
                bairro: cidadaoBairro.value,
                cidade: cidadaoCidade.value,
                estado: cidadaoEstado.value
            });
            lat = geo.lat;
            long = geo.long;
        }
        const v = s => s && s.trim() ? s.trim() : null; // helper: vazio → null
        const cidadaoType = $('cidadao-type');
        const cidadaoZona = $('cidadao-zona'), cidadaoSecao = $('cidadao-secao');
        const cidadaoData = {
            name: $('cidadao-name').value.trim(), // único obrigatório
            email: v($('cidadao-email').value),
            dob: $('cidadao-dob').value || null,
            sexo: $('cidadao-sexo').value || null,
            type: cidadaoType.value || 'Outro',
            leader: $('cidadao-leader')?.value || null,
            cpf: cpf,
            rg: v($('cidadao-rg').value),
            voterid: voterid,
            zona: cidadaoZona ? v(cidadaoZona.value) : null,
            secao: cidadaoSecao ? v(cidadaoSecao.value) : null,
            phone: v($('cidadao-phone').value),
            whatsapp: $('cidadao-whatsapp').checked,
            profissao: v($('cidadao-profissao').value),
            cep: v($('cidadao-cep').value),
            logradouro: v(cidadaoLogradouro.value),
            numero: v($('cidadao-numero').value),
            complemento: v($('cidadao-complemento').value),
            bairro: v(cidadaoBairro.value),
            cidade: v(cidadaoCidade.value),
            estado: v(cidadaoEstado.value),
            sons: parseInt($('cidadao-sons').value, 10) || 0,
            daughters: parseInt($('cidadao-daughters').value, 10) || 0,
            children: getChildrenData(),
            localtrabalho: v($('cidadao-local-trabalho').value),
            nome_mae: v($('cidadao-nome-mae').value),
            nome_pai: v($('cidadao-nome-pai').value),
            photourl: photoUrl || null,
            latitude: lat,
            longitude: long,
            updated_at: new Date().toISOString(),
            user_id: state.user.id
        };
        if (currentEditingId) {
            const { error } = await sb
                .from('cidadaos')
                .update(cidadaoData)
                .eq('id', currentEditingId);
            if (error) throw error;
            showToast("Atualizado com sucesso!", "success");
        } else {
            delete cidadaoData.updated_at;
            const { error } = await sb
                .from('cidadaos')
                .insert(cidadaoData);
            if (error) throw error;
            showToast("Adicionado com sucesso!", "success");
        }
        closeCidadaoModal();
        // Recarrega página e lista de bairros em paralelo (pode ter bairro novo)
        await Promise.all([
            renderCidadaos(),
            loadBairrosDistintos().then(() => updateBairroFilter())
        ]);
        // Atualiza os selects de lideranças se o tipo mudou
        if (cidadaoType.value === 'Liderança') {
            const { data } = await sb.from('cidadaos').select('id, name, type').eq('type', 'Liderança').order('name');
            if (data) { state.allLeaders = data; _onLeadersChanged(); }
        }
    } catch (error) {
        console.error(error);
        let msg = "Erro ao salvar.";
        if (error.message.includes('duplicate key value violates unique constraint "cidadaos_cpf_key"')) {
            msg = "Este CPF já está cadastrado.";
        } else if (error.message.includes('duplicate key value violates unique constraint "cidadaos_voterid_key"')) {
            msg = "Este Título já está cadastrado.";
        }
        showToast(msg, "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Salvar';
    }
}

// NOTA: sem chamadas no app.js atual (mantido por paridade com o app.js original).
export function getFilteredCidadaos() {
    const searchInput = $('search-input'), filterType = $('filter-type'), filterBairro = $('filter-bairro'),
          filterLeader = $('filter-leader'), filterSexo = $('filter-sexo'), filterFaixaEtaria = $('filter-faixa-etaria');
    const searchTerm = searchInput.value.toLowerCase();
    const type = filterType.value;
    const bairro = filterBairro.value;
    const leader = filterLeader.value;
    const sexo = filterSexo.value;
    const faixaEtaria = filterFaixaEtaria.value;
    const filtered = state.allCidadaos.filter(cidadao => {
        const nameMatch = searchInput.value && cidadao.name.toLowerCase().includes(searchTerm);
        const emailMatch = (cidadao.email || '').toLowerCase().includes(searchTerm);
        const cpfMatch = (cidadao.cpf || '').includes(searchTerm);
        const typeMatch = !type || cidadao.type === type;
        const bairroMatch = !bairro || cidadao.bairro === bairro;
        const leaderMatch = !leader || cidadao.leader === leader;
        const sexoMatch = !sexo || (cidadao.sexo || 'Não Informar') === sexo;
        const ageMatch = !faixaEtaria || getFaixaEtaria(cidadao.dob) === faixaEtaria;
        const generalMatch = !searchTerm || nameMatch || emailMatch || cpfMatch;
        return generalMatch && typeMatch && bairroMatch && leaderMatch && sexoMatch && ageMatch;
    });
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
}

// ── PERFORMANCE: card construído como elemento DOM (sem innerHTML com dados de usuário) ─
export function buildCidadaoCard(cidadao) {
    const card = document.createElement('div');
    card.className = 'bg-white p-5 rounded-lg shadow-md flex flex-col transition-shadow hover:shadow-lg';
    const initials = getInitials(cidadao.name);
    const photoUrl = cidadao.photourl;
    card.innerHTML = `
        <div class="flex items-center gap-4 mb-4">
            ${photoUrl
                ? `<img src="${photoUrl}" alt="" loading="lazy" class="w-16 h-16 rounded-full object-cover bg-gray-200" onerror="this.src='https://placehold.co/100x100/E2E8F0/64748B?text=${encodeURIComponent(initials)}'">`
                : `<div class="w-16 h-16 rounded-full bg-blue-500 text-white flex items-center justify-center text-2xl font-bold">${initials}</div>`}
            <div class="flex-1 min-w-0"><h3 class="text-lg font-bold text-gray-800 truncate"></h3><p class="text-sm text-gray-600 card-type"></p></div>
        </div>
        <div class="space-y-2 text-sm text-gray-700 mb-4 flex-1">
            <p class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0 1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span class="truncate email-cell"></span></p>
            <p class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span class="phone-cell"></span></p>
            <p class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><span class="bairro-cell"></span></p>
        </div>
        <div class="border-t pt-4 space-y-2">
            <div class="flex gap-2">
                <button class="btn-view-details flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-3 rounded-lg text-sm font-medium">Ver Detalhes</button>
                <button class="btn-edit flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded-lg text-sm font-medium">Editar</button>
            </div>
            <div class="flex gap-2">
                <button class="btn-add-demanda flex-1 bg-purple-500 hover:bg-purple-600 text-white py-2 px-3 rounded-lg text-sm font-medium">Demanda</button>
                <button class="btn-delete shrink-0 w-10 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            </div>
        </div>`;
    // textContent para prevenir XSS
    card.querySelector('h3').textContent = cidadao.name;
    card.querySelector('.card-type').textContent = cidadao.type;
    card.querySelector('.email-cell').textContent = cidadao.email || 'N/A';
    card.querySelector('.phone-cell').textContent = cidadao.phone || 'Não informado';
    card.querySelector('.bairro-cell').textContent = cidadao.bairro || 'Não informado';
    card.querySelector('.btn-view-details').addEventListener('click', () => openDetailsModal(cidadao.id));
    card.querySelector('.btn-edit').addEventListener('click', () => openCidadaoModal(cidadao.id));
    card.querySelector('.btn-add-demanda').addEventListener('click', () => _onOpenDemanda(cidadao.id));
    const deleteBtn = card.querySelector('.btn-delete');
    if (state.userRole === 'cadastrador') {
        deleteBtn.classList.add('hidden'); // cadastrador não pode excluir
    } else {
        deleteBtn.addEventListener('click', () => _onRequestDelete(cidadao.id, 'cidadao'));
    }
    return card;
}

// renderCidadaos dispara busca no servidor com os filtros atuais
export function renderCidadaos() {
    const searchInput = $('search-input'), filterType = $('filter-type'), filterBairro = $('filter-bairro'),
          filterCidade = $('filter-cidade'), filterLeader = $('filter-leader'), filterSexo = $('filter-sexo'),
          filterFaixaEtaria = $('filter-faixa-etaria'), filterLocalTrabalho = $('filter-local-trabalho');
    serverSearchState = {
        search:      searchInput.value.toLowerCase().trim(),
        type:        filterType.value,
        bairro:      filterBairro.value,
        cidade:      filterCidade ? filterCidade.value : '',
        leader:      filterLeader.value,
        sexo:        filterSexo.value,
        faixaEtaria: filterFaixaEtaria.value,
        localTrabalho: filterLocalTrabalho.value.trim()
    };
    return loadCidadaosPage(true);
}

// "Carregar mais" — próxima página server-side
export function renderMoreCidadaos() {
    return loadCidadaosPage(false);
}

export function updateBairroFilter() {
    const filterBairro = $('filter-bairro');
    if (!filterBairro) return;
    const currentValue = filterBairro.value;
    // PERFORMANCE: usa lista de bairros carregada uma única vez no servidor
    const bairros = window._bairrosDisponiveis || [];
    filterBairro.innerHTML = '<option value="">Filtrar por Bairro</option>';
    bairros.forEach(bairro => {
        const option = document.createElement('option');
        option.value = bairro;
        option.textContent = bairro;
        filterBairro.appendChild(option);
    });
    filterBairro.value = currentValue;
}

export function clearCidadaoFilters() {
    $('search-input').value = '';
    $('filter-type').value = '';
    $('filter-bairro').value = '';
    const filterCidade = $('filter-cidade');
    if (filterCidade) filterCidade.value = '';
    $('filter-leader').value = '';
    $('filter-sexo').value = '';
    $('filter-faixa-etaria').value = '';
    $('filter-local-trabalho').value = '';
    return renderCidadaos();
}

export async function openCidadaoModal(cidadaoId = null) {
    currentEditingId = cidadaoId;
    const cidadaoForm = $('cidadao-form'), fileNameDisplay = $('file-name-display'),
          childrenDetailsContainer = $('children-details-container');
    cidadaoForm.reset();
    fileNameDisplay.textContent = 'Nenhum ficheiro selecionado';
    childrenDetailsContainer.innerHTML = '';
    const titleEl = $('cidadao-modal-title');
    if (cidadaoId) {
        titleEl.textContent = 'Editar Cidadão';
        const cidadao = state.allCidadaos.find(c => c.id === cidadaoId);
        if (cidadao) {
            $('cidadao-name').value = cidadao.name || '';
            $('cidadao-email').value = cidadao.email || '';
            $('cidadao-dob').value = cidadao.dob || '';
            $('cidadao-sexo').value = cidadao.sexo || 'Não Informar';
            $('cidadao-type').value = cidadao.type || 'Outro';
            // Autocomplete liderança — preenche texto e valor oculto
            const leaderHidden = $('cidadao-leader');
            const leaderSearch = $('cidadao-leader-search');
            if (leaderHidden && leaderSearch) {
                leaderHidden.value = cidadao.leader || '';
                const ldr = state.allLeaders.find(l => l.id === cidadao.leader);
                leaderSearch.value = ldr ? ldr.name : '';
            }
            $('cidadao-cpf').value = cidadao.cpf || '';
            $('cidadao-rg').value = cidadao.rg || '';
            $('cidadao-voterid').value = cidadao.voterid || '';
            $('cidadao-phone').value = cidadao.phone || '';
            $('cidadao-whatsapp').checked = cidadao.whatsapp || false;
            $('cidadao-profissao').value = cidadao.profissao || '';
            $('cidadao-local-trabalho').value = cidadao.localtrabalho || '';
            $('cidadao-nome-mae').value = cidadao.nome_mae || '';
            $('cidadao-nome-pai').value = cidadao.nome_pai || '';
            $('cidadao-photo-url').value = cidadao.photourl || '';
            $('cidadao-lat').value = cidadao.latitude || '';
            $('cidadao-long').value = cidadao.longitude || '';
            $('cidadao-cep').value = cidadao.cep || '';
            $('cidadao-logradouro').value = cidadao.logradouro || '';
            $('cidadao-numero').value = cidadao.numero || '';
            $('cidadao-complemento').value = cidadao.complemento || '';
            $('cidadao-bairro').value = cidadao.bairro || '';
            $('cidadao-cidade').value = cidadao.cidade || '';
            $('cidadao-estado').value = cidadao.estado || '';
            $('cidadao-sons').value = cidadao.sons || 0;
            $('cidadao-daughters').value = cidadao.daughters || 0;
            updateChildrenInputs('filho', cidadao.children);
            updateChildrenInputs('filha', cidadao.children);
        }
    } else {
        titleEl.textContent = 'Adicionar Novo Cidadão';
    }
    const cidadaoModal = $('cidadao-modal'), modalContent = $('modal-content');
    cidadaoModal.classList.remove('hidden');
    setTimeout(() => { modalContent.classList.remove('scale-95', 'opacity-0'); }, 10);
}

export function closeCidadaoModal() {
    const leaderSearch = $('cidadao-leader-search');
    const leaderHidden = $('cidadao-leader');
    if (leaderSearch) { leaderSearch.value = ''; leaderSearch._autocompleteReady = false; }
    if (leaderHidden) leaderHidden.value = '';
    const cidadaoModal = $('cidadao-modal'), modalContent = $('modal-content');
    modalContent.classList.add('scale-95', 'opacity-0');
    setTimeout(() => { cidadaoModal.classList.add('hidden'); }, 300);
}

export function updateChildrenInputs(type, childrenData = null) {
    const count = (type === 'filho' ? $('cidadao-sons').value : $('cidadao-daughters').value) || 0;
    const containerId = type === 'filho' ? 'sons-inputs' : 'daughters-inputs';
    const label = type === 'filho' ? 'Filho' : 'Filha';
    let container = $(containerId);
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'space-y-3 p-4 bg-gray-50 rounded-lg';
        $('children-details-container').appendChild(container);
    }
    container.innerHTML = '';
    if (count > 0) {
        container.innerHTML += `<h4 class="font-medium text-gray-700">${label}s:</h4>`;
    }
    for (let i = 0; i < count; i++) {
        const existingChild = (childrenData || []).find(c => c.type === type && c.index === i);
        container.innerHTML += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-600">${label} ${i + 1} - Nome</label><input type="text" data-type="${type}" data-index="${i}" data-field="name" class="w-full border border-gray-300 p-2 rounded-lg mt-1" value="${existingChild?.name || ''}"></div><div><label class="block text-xs font-medium text-gray-600">${label} ${i + 1} - Data Nasc.</label><input type="date" data-type="${type}" data-index="${i}" data-field="dob" class="w-full border border-gray-300 p-2 rounded-lg mt-1" value="${existingChild?.dob || ''}"></div></div>`;
    }
}

export function getChildrenData() {
    const children = [];
    const inputs = $('children-details-container').querySelectorAll('input[data-type]');
    inputs.forEach(input => {
        const type = input.dataset.type;
        const index = parseInt(input.dataset.index, 10);
        const field = input.dataset.field;
        const value = input.value;
        let child = children.find(c => c.type === type && c.index === index);
        if (!child) {
            child = { type, index };
            children.push(child);
        }
        child[field] = value;
    });
    return children.filter(c => c.name && c.dob);
}

export async function handleCEPBlur(e) {
    const cep = e.target.value.replace(/\D/g, '');
    if (cep.length === 8) {
        try {
            const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            if (!response.ok) throw new Error('CEP não encontrado');
            const data = await response.json();
            if (data.erro) {
                showToast("CEP não encontrado.", "warning");
            } else {
                $('cidadao-logradouro').value = data.logradouro;
                $('cidadao-bairro').value = data.bairro;
                $('cidadao-cidade').value = data.localidade;
                $('cidadao-estado').value = data.uf;
                $('cidadao-numero').focus();
            }
        } catch (error) {
            console.error(error);
            showToast("Erro ao consultar o CEP.", "error");
        }
    }
}

export async function openDetailsModal(cidadaoId) {
    currentCidadaoIdForDetails = cidadaoId;
    // Tenta achar no cache local primeiro; se não estiver (paginação), busca no servidor
    let cidadao = state.allCidadaos.find(c => c.id === cidadaoId);
    if (!cidadao) {
        const { data, error } = await sb
            .from('cidadaos')
            .select('*')
            .eq('id', cidadaoId)
            .single();
        if (error || !data) return;
        cidadao = data;
    }
    const detailsModal = $('cidadao-details-modal');
    const content = detailsModal.querySelector('.transform');
    const photoEl = $('details-photo');
    if (cidadao.photourl) {
        photoEl.innerHTML = `<img src="${cidadao.photourl}" alt="${cidadao.name}" class="w-24 h-24 rounded-full object-cover bg-gray-200" onerror="this.src='https://placehold.co/100x100/E2E8F0/64748B?text=${getInitials(cidadao.name)}'">`;
    } else {
        photoEl.innerHTML = `<div class="w-24 h-24 rounded-full bg-blue-500 text-white flex items-center justify-center text-4xl font-bold">${getInitials(cidadao.name)}</div>`;
    }
    $('details-name').textContent = cidadao.name;
    $('details-type').textContent = cidadao.type;
    $('details-email').textContent = cidadao.email || 'Não informado';
    $('details-phone').textContent = cidadao.phone ? `${cidadao.phone} ${cidadao.whatsapp ? '(WhatsApp)' : ''}` : 'Não informado';
    const addressParts = [cidadao.logradouro, cidadao.numero, cidadao.complemento, cidadao.bairro, cidadao.cidade, cidadao.estado, cidadao.cep].filter(Boolean);
    $('details-address').textContent = addressParts.join(', ') || 'Não informado';
    $('details-cpf').textContent = cidadao.cpf || 'Não informado';
    $('details-rg').textContent = cidadao.rg || 'Não informado';
    $('details-nome-mae').textContent = cidadao.nome_mae || 'Não informado';
    $('details-nome-pai').textContent = cidadao.nome_pai || 'Não informado';
    const voterId = cidadao.voterid || '';
    const zona = cidadao.zona || '';
    const secao = cidadao.secao || '';
    let voterText = voterId || 'Não informado';
    if (zona || secao) voterText += ` | Zona: ${zona || '—'} | Seção: ${secao || '—'}`;
    $('details-voterid').textContent = voterText;
    $('details-dob').textContent = cidadao.dob ? formatarData(cidadao.dob) : 'Não informado';
    $('details-sexo').textContent = cidadao.sexo || 'Não Informar';
    $('details-profissao').textContent = cidadao.profissao || 'Não informado';
    $('details-local-trabalho').textContent = cidadao.localtrabalho || 'Não informado';
    const leader = state.allLeaders.find(l => l.id === cidadao.leader);
    $('details-leader').textContent = leader ? leader.name : 'Nenhuma';
    const childrenEl = $('details-children');
    const totalFilhos = (cidadao.sons || 0) + (cidadao.daughters || 0);
    childrenEl.innerHTML = `<strong>Família:</strong> ${totalFilhos} filho(s)`;
    if (cidadao.children && cidadao.children.length > 0) {
        const childrenList = cidadao.children.map(c => `<li class="text-sm ml-4">${c.name} (${formatarData(c.dob)})</li>`).join('');
        childrenEl.innerHTML += `<ul class="list-disc list-inside">${childrenList}</ul>`;
    }
    $('details-view-map-btn').onclick = () => {
        closeDetailsModal();
        _onOpenMap([cidadao]);
    };
    $('details-share-location-btn').onclick = () => shareLocation(cidadao);
    // Link de cadastro exclusivo — só faz sentido para cidadãos do tipo "Liderança".
    // Quem se cadastra por esse link já entra automaticamente sob essa liderança
    // (sem precisar de senha de acesso — ver cadastro-publico.js/public-cadastro).
    const copyLinkBtn = $('details-copy-link-btn');
    if (copyLinkBtn) {
        if (cidadao.type === 'Liderança') {
            copyLinkBtn.classList.remove('hidden');
            copyLinkBtn.onclick = () => copyLeaderCadastroLink(cidadao);
        } else {
            copyLinkBtn.classList.add('hidden');
            copyLinkBtn.onclick = null;
        }
    }
    detailsModal.classList.remove('hidden');
    setTimeout(() => { content.classList.remove('scale-95', 'opacity-0'); }, 10);
}

export function closeDetailsModal() {
    const detailsModal = $('cidadao-details-modal');
    const content = detailsModal.querySelector('.transform');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        detailsModal.classList.add('hidden');
        currentCidadaoIdForDetails = null;
    }, 300);
}

// Monta o link público de cadastro exclusivo desta liderança e copia
// para a área de transferência. Resolvido com base na própria URL do
// app, então funciona independente de domínio/subpasta de hospedagem.
export function copyLeaderCadastroLink(cidadao) {
    const link = new URL(`cadastro-publico.html?leader=${encodeURIComponent(cidadao.id)}`, window.location.href).toString();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link)
            .then(() => showToast(`Link de cadastro de ${cidadao.name} copiado!`, 'success'))
            .catch(() => showToast('Não foi possível copiar. Link: ' + link, 'error'));
    } else {
        showToast('Copie manualmente: ' + link, 'warning');
    }
}

export function shareLocation(cidadao) {
    if (!cidadao.logradouro || !cidadao.cidade) {
        showToast("Endereço incompleto.", "warning");
        return;
    }
    const address = `${cidadao.logradouro}, ${cidadao.numero || 'S/N'}, ${cidadao.bairro}, ${cidadao.cidade}, ${cidadao.estado}`;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    const text = `Olá! Aqui está a localização de ${cidadao.name}:\n${address}\n\nVer no mapa:\n${url}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
}

export function setupLeaderAutocomplete() {
    const searchInput = $('cidadao-leader-search');
    const dropdown = $('cidadao-leader-dropdown');
    const hiddenInput = $('cidadao-leader');
    if (!searchInput || !dropdown || !hiddenInput) return;
    if (searchInput._autocompleteReady) return;
    searchInput._autocompleteReady = true;

    const sorted = [...state.allLeaders].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    function showDropdown(term) {
        const filtered = term
            ? sorted.filter(l => l.name.toLowerCase().includes(term.toLowerCase()))
            : sorted;
        dropdown.innerHTML = '';
        const none = document.createElement('div');
        none.className = 'px-3 py-2 cursor-pointer hover:bg-gray-100 text-gray-500 text-sm';
        none.textContent = 'Nenhuma';
        none.addEventListener('mousedown', () => {
            hiddenInput.value = '';
            searchInput.value = '';
            dropdown.classList.add('hidden');
        });
        dropdown.appendChild(none);
        filtered.forEach(l => {
            const item = document.createElement('div');
            item.className = 'px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm';
            item.textContent = l.name;
            item.addEventListener('mousedown', () => {
                hiddenInput.value = l.id;
                searchInput.value = l.name;
                dropdown.classList.add('hidden');
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.toggle('hidden', filtered.length === 0 && !term);
    }

    searchInput.addEventListener('input', () => showDropdown(searchInput.value));
    searchInput.addEventListener('focus', () => showDropdown(searchInput.value));
    searchInput.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
        const match = sorted.find(l => l.name.toLowerCase() === searchInput.value.toLowerCase());
        if (!match) { hiddenInput.value = ''; searchInput.value = ''; }
    });
}
