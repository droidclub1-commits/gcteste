// ═══════════════════════════════════════════════════════════════
// COTAS DE COMBUSTÍVEL — registo, histórico (geral e por cidadão),
// edição/remoção de registos, filtro por liderança e relatório
// agregado por liderança.
//
// Padrão igual a cobertura.js/backup.js: consulta a Supabase direto
// sob demanda em vez de depender de state.allCidadaos (que não guarda
// a lista completa — só a página atual). A busca de cidadão no modal
// de nova/editar cota é feita no servidor (ilike + limit), pelo mesmo
// motivo: não dá pra pré-carregar 25k+ cidadãos só pra um autocomplete.
//
// Editar/Apagar um registo de cota é restrito a admin (state.userRole)
// — igual à restrição de excluir cidadão em buildCidadaoCard.
// ═══════════════════════════════════════════════════════════════

import { showToast, formatarData } from './utils.js';
import { sb } from './config.js';
import { state } from './state.js';

const $ = id => document.getElementById(id);

let editingCotaId = null;
let cotaFiltroLiderId = '';

export function resetCotas() {
    editingCotaId = null;
    cotaFiltroLiderId = '';
}

// ── Modal "Nova Cota" / "Editar Cota" ───────────────────────────
export function openCotaModal(cotaToEdit = null) {
    const form = $('cota-form');
    form.reset();
    editingCotaId = cotaToEdit ? cotaToEdit.id : null;

    const titleEl = $('cota-modal-title');
    const searchInput = $('cota-cidadao-search');
    if (titleEl) titleEl.textContent = cotaToEdit ? 'Editar Cota de Combustível' : 'Nova Cota de Combustível';

    if (cotaToEdit) {
        $('cota-cidadao-id').value = cotaToEdit.cidadao?.id || cotaToEdit.cidadao_id || '';
        if (searchInput) searchInput.value = cotaToEdit.cidadao?.name || '';
        $('cota-data').value = cotaToEdit.data || new Date().toISOString().slice(0, 10);
        $('cota-posto').value = cotaToEdit.posto || '';
        $('cota-litros').value = cotaToEdit.litros ?? '';
        $('cota-valor').value = cotaToEdit.valor ?? '';
        $('cota-observacao').value = cotaToEdit.observacao || '';
    } else {
        $('cota-cidadao-id').value = '';
        $('cota-data').value = new Date().toISOString().slice(0, 10);
    }
    setupCotaCidadaoAutocomplete();
    const modal = $('cota-modal'), content = $('cota-modal-content');
    modal.classList.remove('hidden');
    setTimeout(() => content.classList.remove('scale-95', 'opacity-0'), 10);
}

export function closeCotaModal() {
    const modal = $('cota-modal'), content = $('cota-modal-content');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
    editingCotaId = null;
}

let cotaSearchTimeout = null;
export function setupCotaCidadaoAutocomplete() {
    const searchInput = $('cota-cidadao-search');
    const dropdown = $('cota-cidadao-dropdown');
    const hiddenInput = $('cota-cidadao-id');
    if (!searchInput || !dropdown || !hiddenInput || searchInput._autocompleteReady) return;
    searchInput._autocompleteReady = true;

    searchInput.addEventListener('input', () => {
        hiddenInput.value = '';
        const term = searchInput.value.trim();
        clearTimeout(cotaSearchTimeout);
        if (term.length < 2) { dropdown.classList.add('hidden'); return; }
        cotaSearchTimeout = setTimeout(async () => {
            const { data, error } = await sb.from('cidadaos')
                .select('id, name, cpf')
                .ilike('name', `%${term}%`)
                .order('name')
                .limit(10);
            if (error) { console.error(error); return; }
            dropdown.innerHTML = '';
            if (!data || data.length === 0) {
                dropdown.innerHTML = '<div class="px-3 py-2 text-sm text-gray-400 italic">Nenhum cidadão encontrado.</div>';
            } else {
                data.forEach(c => {
                    const item = document.createElement('div');
                    item.className = 'px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm';
                    item.textContent = c.cpf ? `${c.name} — ${c.cpf}` : c.name;
                    item.addEventListener('mousedown', () => {
                        hiddenInput.value = c.id;
                        searchInput.value = c.name;
                        dropdown.classList.add('hidden');
                    });
                    dropdown.appendChild(item);
                });
            }
            dropdown.classList.remove('hidden');
        }, 300);
    });
    searchInput.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
    });
}

export async function handleCotaFormSubmit(e) {
    e.preventDefault();
    const saveBtn = $('save-cota-btn');
    const cidadaoId = $('cota-cidadao-id').value;
    if (!cidadaoId) {
        showToast('Selecione um cidadão da lista de sugestões.', 'warning');
        return;
    }
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div>';
    try {
        const litrosVal = $('cota-litros').value;
        const valorVal = $('cota-valor').value;
        const payload = {
            cidadao_id: cidadaoId,
            data: $('cota-data').value,
            litros: litrosVal ? parseFloat(litrosVal) : null,
            valor: valorVal ? parseFloat(valorVal) : null,
            posto: $('cota-posto').value.trim() || null,
            observacao: $('cota-observacao').value.trim() || null
        };
        if (editingCotaId) {
            const { error } = await sb.from('cotas_combustivel').update(payload).eq('id', editingCotaId);
            if (error) throw error;
            showToast('Cota atualizada com sucesso!', 'success');
        } else {
            payload.registrado_por = state.user?.email || null;
            const { error } = await sb.from('cotas_combustivel').insert(payload);
            if (error) throw error;
            showToast('Cota registada com sucesso!', 'success');
        }
        closeCotaModal();
        await loadCotasPage(cotaFiltroLiderId);
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Erro ao registar cota.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Salvar';
    }
}

export async function confirmDeleteCota(cota) {
    if (state.userRole !== 'admin') return;
    if (!confirm(`Apagar o registo de cota de "${cota.cidadao?.name || 'cidadão'}" em ${formatarData(cota.data)}? Esta ação não pode ser desfeita.`)) return;
    try {
        const { error } = await sb.from('cotas_combustivel').delete().eq('id', cota.id);
        if (error) throw error;
        showToast('Registo apagado.', 'success');
        await loadCotasPage(cotaFiltroLiderId);
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Erro ao apagar registo.', 'error');
    }
}

// ── Filtro por Liderança (autocomplete igual ao de cobertura.js) ───
export function setupCotasLiderancaFilter() {
    const searchInput = $('cotas-filter-lider-search');
    const dropdown = $('cotas-filter-lider-dropdown');
    const hiddenInput = $('cotas-filter-lider');
    if (!searchInput || !dropdown || !hiddenInput) return;
    if (searchInput._autocompleteReady) return;
    searchInput._autocompleteReady = true;

    const sorted = [...state.allLeaders].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    function showDropdown(term) {
        const filtered = term
            ? sorted.filter(l => l.name.toLowerCase().includes(term.toLowerCase()))
            : sorted;
        dropdown.innerHTML = '';
        const all = document.createElement('div');
        all.className = 'px-3 py-2 cursor-pointer hover:bg-gray-100 text-gray-500 text-sm italic';
        all.textContent = 'Todas as Lideranças';
        all.addEventListener('mousedown', () => {
            hiddenInput.value = '';
            searchInput.value = '';
            dropdown.classList.add('hidden');
            cotaFiltroLiderId = '';
            loadCotasPage('');
        });
        dropdown.appendChild(all);
        filtered.forEach(l => {
            const item = document.createElement('div');
            item.className = 'px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm';
            item.textContent = l.name;
            item.addEventListener('mousedown', () => {
                hiddenInput.value = l.id;
                searchInput.value = l.name;
                dropdown.classList.add('hidden');
                cotaFiltroLiderId = l.id;
                loadCotasPage(l.id);
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

export function clearCotasFiltro() {
    const searchInput = $('cotas-filter-lider-search');
    const hiddenInput = $('cotas-filter-lider');
    if (searchInput) { searchInput.value = ''; searchInput._autocompleteReady = false; }
    if (hiddenInput) hiddenInput.value = '';
    cotaFiltroLiderId = '';
    loadCotasPage('');
}

// ── Página "Cotas de Combustível" — lista geral ─────────────────
// Mostra os 500 registos mais recentes (aviso já fica no rodapé da
// página em index.html). Para relatórios completos, ver o botão
// "Relatório por Liderança", que busca tudo, paginado. Aceita um
// liderId opcional para filtrar só os cidadãos daquela liderança
// (usa !inner pra poder filtrar em cima da tabela unida).
export async function loadCotasPage(liderId = '') {
    const tbody = $('cotas-tbody');
    const empty = $('cotas-empty');
    if (!tbody) return;
    cotaFiltroLiderId = liderId;
    const acoesTh = document.getElementById('cotas-th-acoes');
    if (acoesTh) acoesTh.classList.toggle('hidden', state.userRole !== 'admin');
    const colspan = state.userRole === 'admin' ? 8 : 7;
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-8 text-gray-400">A carregar...</td></tr>`;
    if (empty) empty.classList.add('hidden');

    let query = sb.from('cotas_combustivel')
        .select(`id, data, litros, valor, posto, observacao, registrado_por, cidadao:cidadaos${liderId ? '!inner' : ''}(id, name, leader)`)
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
    if (liderId) query = query.eq('cidadao.leader', liderId);

    const { data, error } = await query;

    if (error) {
        console.error(error);
        tbody.innerHTML = '';
        showToast('Erro ao carregar cotas: ' + error.message, 'error');
        return;
    }
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    const leaderName = id => state.allLeaders.find(l => l.id === id)?.name || '—';
    const isAdmin = state.userRole === 'admin';
    data.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = 'border-b hover:bg-gray-50';
        tr.innerHTML = `
            <td class="px-4 py-3">${c.data ? formatarData(c.data) : '—'}</td>
            <td class="px-4 py-3 font-medium text-gray-800">${c.cidadao?.name || '(cidadão removido)'}</td>
            <td class="px-4 py-3 text-gray-600">${leaderName(c.cidadao?.leader)}</td>
            <td class="px-4 py-3">${c.litros != null ? c.litros + ' L' : '—'}</td>
            <td class="px-4 py-3">${c.valor != null ? 'R$ ' + Number(c.valor).toFixed(2) : '—'}</td>
            <td class="px-4 py-3">${c.posto || '—'}</td>
            <td class="px-4 py-3 text-xs text-gray-500">${c.registrado_por || '—'}</td>
            ${isAdmin ? '<td class="px-4 py-3 whitespace-nowrap"></td>' : ''}`;
        if (isAdmin) {
            const actionsTd = tr.lastElementChild;
            const editBtn = document.createElement('button');
            editBtn.className = 'text-blue-600 hover:text-blue-800 text-xs font-semibold mr-3';
            editBtn.textContent = 'Editar';
            editBtn.addEventListener('click', () => openCotaModal(c));
            const delBtn = document.createElement('button');
            delBtn.className = 'text-red-600 hover:text-red-800 text-xs font-semibold';
            delBtn.textContent = 'Apagar';
            delBtn.addEventListener('click', () => confirmDeleteCota(c));
            actionsTd.appendChild(editBtn);
            actionsTd.appendChild(delBtn);
        }
        tbody.appendChild(tr);
    });
}

// ── Histórico de abastecimento de um cidadão — modal dedicado ───
// Aberto via botão na ficha do cidadão (cidadaos.js, callback
// onOpenCotaHistory) ou via botão "Ver abastecimento" na aba
// Veículos (veiculos.js). Mostra tudo (sem limite de 500), com
// opção de baixar CSV ou imprimir.
let currentHistoryCidadao = null;
let currentHistoryData = [];

export async function openCotaHistoryModal(cidadao) {
    currentHistoryCidadao = cidadao;
    const modal = $('cota-history-modal');
    const content = $('cota-history-modal-content');
    const nameEl = $('cota-history-cidadao-nome');
    const listEl = $('cota-history-list');
    const totalEl = $('cota-history-total');
    if (!modal || !listEl) return;

    if (nameEl) nameEl.textContent = cidadao.name;
    listEl.innerHTML = '<p class="text-gray-400 text-sm text-center py-6">A carregar...</p>';
    if (totalEl) totalEl.textContent = '';
    modal.classList.remove('hidden');
    setTimeout(() => content?.classList.remove('scale-95', 'opacity-0'), 10);

    const { data, error } = await sb.from('cotas_combustivel')
        .select('id, data, litros, valor, posto, observacao')
        .eq('cidadao_id', cidadao.id)
        .order('data', { ascending: false });

    if (error) {
        console.error(error);
        listEl.innerHTML = '<p class="text-red-500 text-sm">Erro ao carregar histórico.</p>';
        return;
    }
    currentHistoryData = data || [];
    if (currentHistoryData.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400 text-sm text-center py-6">Nenhuma cota registada para este cidadão.</p>';
        return;
    }
    const totalLitros = currentHistoryData.reduce((s, c) => s + (Number(c.litros) || 0), 0);
    const totalValor = currentHistoryData.reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const totalParts = [];
    if (totalLitros > 0) totalParts.push(`${totalLitros.toFixed(1)} L`);
    if (totalValor > 0) totalParts.push(`R$ ${totalValor.toFixed(2)}`);
    if (totalEl) totalEl.textContent = totalParts.length ? `Total: ${totalParts.join(' · ')}` : '';

    listEl.innerHTML = `
        <table class="w-full text-sm text-left">
            <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th class="px-3 py-2">Data</th><th class="px-3 py-2">Litros</th><th class="px-3 py-2">Valor</th><th class="px-3 py-2">Posto</th><th class="px-3 py-2">Observação</th></tr>
            </thead>
            <tbody>
                ${currentHistoryData.map(c => `
                    <tr class="border-t border-gray-100">
                        <td class="px-3 py-2">${formatarData(c.data)}</td>
                        <td class="px-3 py-2">${c.litros != null ? c.litros + ' L' : '—'}</td>
                        <td class="px-3 py-2">${c.valor != null ? 'R$ ' + Number(c.valor).toFixed(2) : '—'}</td>
                        <td class="px-3 py-2">${c.posto || '—'}</td>
                        <td class="px-3 py-2 text-gray-500">${c.observacao || '—'}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
}

export function closeCotaHistoryModal() {
    const modal = $('cota-history-modal');
    const content = $('cota-history-modal-content');
    content?.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal?.classList.add('hidden'), 300);
    currentHistoryCidadao = null;
    currentHistoryData = [];
}

export function downloadCotaHistoryCSV() {
    if (!currentHistoryCidadao || !currentHistoryData.length) {
        showToast('Nenhum dado para baixar.', 'warning');
        return;
    }
    const headers = ['Data', 'Litros', 'Valor (R$)', 'Posto', 'Observação'];
    const esc = v => {
        const s = String(v ?? '');
        return (s.includes(';') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = currentHistoryData.map(c => [formatarData(c.data), c.litros ?? '', c.valor ?? '', c.posto || '', c.observacao || '']);
    const csv = ['\uFEFF', headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const nomeArquivo = currentHistoryCidadao.name.replace(/[^\p{L}\p{N}]+/gu, '_');
    a.download = `abastecimento_${nomeArquivo}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

export function printCotaHistory() {
    if (!currentHistoryCidadao || !currentHistoryData.length) {
        showToast('Nenhum dado para imprimir.', 'warning');
        return;
    }
    const totalLitros = currentHistoryData.reduce((s, c) => s + (Number(c.litros) || 0), 0);
    const totalValor = currentHistoryData.reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const rowsHtml = currentHistoryData.map(c => `
        <tr>
            <td>${formatarData(c.data)}</td>
            <td>${c.litros != null ? c.litros + ' L' : '—'}</td>
            <td>${c.valor != null ? 'R$ ' + Number(c.valor).toFixed(2) : '—'}</td>
            <td>${c.posto || '—'}</td>
            <td>${c.observacao || '—'}</td>
        </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { showToast('O navegador bloqueou a janela de impressão.', 'error'); return; }
    win.document.write(`
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Histórico de Abastecimento — ${currentHistoryCidadao.name}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 24px; color: #142235; }
                h1 { font-size: 18px; margin-bottom: 2px; }
                p.sub { color: #64748b; margin-top: 0; font-size: 13px; }
                table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
                th, td { border: 1px solid #e3e9f1; padding: 6px 8px; text-align: left; }
                th { background: #f4f6f9; }
                p.total { margin-top: 14px; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>Histórico de Abastecimento</h1>
            <p class="sub">Cidadão: ${currentHistoryCidadao.name} — gerado em ${new Date().toLocaleString('pt-BR')}</p>
            <table>
                <thead><tr><th>Data</th><th>Litros</th><th>Valor</th><th>Posto</th><th>Observação</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
            <p class="total">Total: ${totalLitros.toFixed(1)} L · R$ ${totalValor.toFixed(2)}</p>
        </body>
        </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
}

// ── Relatório por Liderança (Excel/CSV) ──────────────────────────
// Agrupa cada cota pelo "grupo" da liderança: se o cidadão da cota É
// uma liderança, o grupo é ele mesmo; senão, o grupo é a liderança
// dele (cidadao.leader). Isso soma o que a própria liderança pegou
// junto com o que todos os seus liderados pegaram, no mesmo total —
// exatamente o pedido original.
export async function generateCotasPorLiderancaExcel() {
    showToast('A gerar relatório...', 'info');
    let cotas = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
        const { data, error } = await sb.from('cotas_combustivel')
            .select('litros, valor, cidadao:cidadaos(id, name, type, leader)')
            .range(offset, offset + PAGE - 1);
        if (error) {
            console.error(error);
            showToast('Erro ao gerar relatório: ' + error.message, 'error');
            return;
        }
        cotas = [...cotas, ...(data || [])];
        if (!data || data.length < PAGE) break;
        offset += PAGE;
    }
    if (!cotas.length) {
        showToast('Nenhuma cota registada ainda.', 'warning');
        return;
    }

    const grupos = {};
    cotas.forEach(c => {
        const cid = c.cidadao;
        if (!cid) return;
        const groupId = cid.type === 'Liderança' ? cid.id : (cid.leader || 'sem_lideranca');
        if (!grupos[groupId]) {
            const nome = groupId === 'sem_lideranca'
                ? 'Sem Liderança'
                : (state.allLeaders.find(l => l.id === groupId)?.name || (cid.type === 'Liderança' ? cid.name : 'Liderança desconhecida'));
            grupos[groupId] = { nome, totalLitros: 0, totalValor: 0, registros: 0, pessoas: new Set() };
        }
        grupos[groupId].totalLitros += Number(c.litros) || 0;
        grupos[groupId].totalValor += Number(c.valor) || 0;
        grupos[groupId].registros += 1;
        grupos[groupId].pessoas.add(cid.id);
    });

    const headers = ['Liderança', 'Pessoas Atendidas', 'Total de Registos', 'Total Litros', 'Total (R$)'];
    const rows = Object.values(grupos)
        .sort((a, b) => (b.totalValor - a.totalValor) || (b.totalLitros - a.totalLitros))
        .map(g => [g.nome, g.pessoas.size, g.registros, g.totalLitros.toFixed(1), g.totalValor.toFixed(2)]);

    const esc = v => {
        const s = String(v ?? '');
        return (s.includes(';') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = ['\uFEFF', headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cotas_por_lideranca_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Relatório gerado!', 'success');
}
