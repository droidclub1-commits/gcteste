// ═══════════════════════════════════════════════════════════════
// COTAS DE COMBUSTÍVEL — registo, histórico (geral e por cidadão)
// e relatório agregado por liderança.
//
// Padrão igual a cobertura.js/backup.js: consulta a Supabase direto
// sob demanda em vez de depender de state.allCidadaos (que não guarda
// a lista completa — só a página atual). A busca de cidadão no modal
// de nova cota é feita no servidor (ilike + limit), pelo mesmo motivo:
// não dá pra pré-carregar 25k+ cidadãos só pra um autocomplete.
// ═══════════════════════════════════════════════════════════════

import { showToast, formatarData } from './utils.js';
import { sb } from './config.js';
import { state } from './state.js';

const $ = id => document.getElementById(id);

export function resetCotas() {
    // Nenhum estado local persistente hoje — mantido por paridade com
    // resetUsers()/o padrão do app, caso passe a cachear algo no futuro.
}

// ── Modal "Nova Cota" ────────────────────────────────────────────
export function openCotaModal() {
    const form = $('cota-form');
    form.reset();
    $('cota-cidadao-id').value = '';
    $('cota-data').value = new Date().toISOString().slice(0, 10);
    setupCotaCidadaoAutocomplete();
    const modal = $('cota-modal'), content = $('cota-modal-content');
    modal.classList.remove('hidden');
    setTimeout(() => content.classList.remove('scale-95', 'opacity-0'), 10);
}

export function closeCotaModal() {
    const modal = $('cota-modal'), content = $('cota-modal-content');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
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
        const { error } = await sb.from('cotas_combustivel').insert({
            cidadao_id: cidadaoId,
            data: $('cota-data').value,
            litros: litrosVal ? parseFloat(litrosVal) : null,
            valor: valorVal ? parseFloat(valorVal) : null,
            posto: $('cota-posto').value.trim() || null,
            observacao: $('cota-observacao').value.trim() || null,
            registrado_por: state.user?.email || null
        });
        if (error) throw error;
        showToast('Cota registada com sucesso!', 'success');
        closeCotaModal();
        await loadCotasPage();
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Erro ao registar cota.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Salvar';
    }
}

// ── Página "Cotas de Combustível" — lista geral ─────────────────
// Mostra os 500 registos mais recentes (aviso já fica no rodapé da
// página em index.html). Para relatórios completos, ver o botão
// "Relatório por Liderança", que busca tudo, paginado.
export async function loadCotasPage() {
    const tbody = $('cotas-tbody');
    const empty = $('cotas-empty');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">A carregar...</td></tr>';
    if (empty) empty.classList.add('hidden');

    const { data, error } = await sb.from('cotas_combustivel')
        .select('id, data, litros, valor, posto, registrado_por, cidadao:cidadaos(id, name, leader)')
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);

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
            <td class="px-4 py-3 text-xs text-gray-500">${c.registrado_por || '—'}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Histórico dentro da ficha do cidadão (modal de detalhes) ────
// Chamado via callback (onRenderCotas) a partir de cidadaos.js — ver
// initCidadaos() em app.js — pra evitar import circular entre módulos.
export async function renderCotasHistoryFor(cidadao) {
    const listEl = $('details-cotas-list');
    const totalEl = $('details-cotas-total');
    if (!listEl || !totalEl) return;
    listEl.innerHTML = '<p class="text-gray-400 text-xs">A carregar...</p>';
    totalEl.textContent = '';

    const { data, error } = await sb.from('cotas_combustivel')
        .select('data, litros, valor, posto')
        .eq('cidadao_id', cidadao.id)
        .order('data', { ascending: false });

    if (error) {
        console.error(error);
        listEl.innerHTML = '<p class="text-red-500 text-xs">Erro ao carregar histórico.</p>';
        return;
    }
    if (!data || data.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400 text-xs">Nenhuma cota registada.</p>';
        return;
    }
    const totalLitros = data.reduce((s, c) => s + (Number(c.litros) || 0), 0);
    const totalValor = data.reduce((s, c) => s + (Number(c.valor) || 0), 0);
    const totalParts = [];
    if (totalLitros > 0) totalParts.push(`${totalLitros.toFixed(1)} L`);
    if (totalValor > 0) totalParts.push(`R$ ${totalValor.toFixed(2)}`);
    totalEl.textContent = totalParts.length ? `Total: ${totalParts.join(' · ')}` : '';

    listEl.innerHTML = data.map(c => {
        const parts = [];
        if (c.litros) parts.push(`${c.litros} L`);
        if (c.valor) parts.push(`R$ ${Number(c.valor).toFixed(2)}`);
        if (c.posto) parts.push(c.posto);
        return `<div class="flex justify-between border-b border-gray-100 py-1"><span>${formatarData(c.data)}</span><span class="text-gray-600">${parts.join(' · ') || '—'}</span></div>`;
    }).join('');
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
