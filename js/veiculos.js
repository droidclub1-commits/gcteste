// ═══════════════════════════════════════════════════════════════
// VEÍCULOS — aba dedicada com o total de veículos cadastrados, quantos
// estão adesivados, filtro por tipo (Carro/Moto) e acesso rápido ao
// histórico de abastecimento de cada dono.
//
// Mesmo padrão de cobertura.js/cotas.js: busca direto na Supabase sob
// demanda. O histórico de abastecimento continua vinculado ao CIDADÃO
// (não ao veículo específico — decisão tomada para manter o registo de
// cota simples), então o botão "Ver abastecimento" aqui reabre o mesmo
// modal de cotas.js (openCotaHistoryModal), evitando duplicar lógica.
// ═══════════════════════════════════════════════════════════════

import { sb } from './config.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { openCotaHistoryModal } from './cotas.js';

const $ = id => document.getElementById(id);

let veiculosFiltroTipo = '';

export function resetVeiculos() {
    veiculosFiltroTipo = '';
}

export function setupVeiculosFiltro() {
    const filtro = $('veiculos-filter-tipo');
    if (!filtro || filtro._ready) return;
    filtro._ready = true;
    filtro.addEventListener('change', () => {
        veiculosFiltroTipo = filtro.value;
        loadVeiculosPage(veiculosFiltroTipo);
    });
}

export async function loadVeiculosPage(tipoFiltro = veiculosFiltroTipo) {
    veiculosFiltroTipo = tipoFiltro;
    const tbody = $('veiculos-tbody');
    const empty = $('veiculos-empty');
    const summary = $('veiculos-summary');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400">A carregar...</td></tr>';
    if (empty) empty.classList.add('hidden');

    let query = sb.from('veiculos')
        .select('id, tipo, placa, modelo, cor, adesivado, cidadao:cidadaos(id, name, leader)')
        .order('tipo', { ascending: true });
    if (tipoFiltro) query = query.eq('tipo', tipoFiltro);

    // Paginação server-side: chunks de 1000, suporta bases grandes
    let data = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
        const { data: chunk, error } = await query.range(offset, offset + PAGE - 1);
        if (error) {
            console.error(error);
            tbody.innerHTML = '';
            showToast('Erro ao carregar veículos: ' + error.message, 'error');
            return;
        }
        data = [...data, ...(chunk || [])];
        if (!chunk || chunk.length < PAGE) break;
        offset += PAGE;
    }

    const totalVeiculos = data.length;
    const totalAdesivados = data.filter(v => v.adesivado).length;
    const totalCarros = data.filter(v => v.tipo === 'Carro').length;
    const totalMotos = data.filter(v => v.tipo === 'Moto').length;

    if (summary) {
        summary.innerHTML = `
            <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                <p class="text-3xl font-bold text-blue-600">${totalVeiculos}</p>
                <p class="text-sm text-gray-500 mt-1">${tipoFiltro ? `Total de ${tipoFiltro === 'Carro' ? 'Carros' : 'Motos'}` : 'Total de Veículos'}</p>
            </div>
            <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                <p class="text-3xl font-bold text-green-600">${totalAdesivados}</p>
                <p class="text-sm text-gray-500 mt-1">Adesivados</p>
            </div>
            <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                <p class="text-3xl font-bold text-purple-600">${totalCarros}</p>
                <p class="text-sm text-gray-500 mt-1">Carros</p>
            </div>
            <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                <p class="text-3xl font-bold text-orange-600">${totalMotos}</p>
                <p class="text-sm text-gray-500 mt-1">Motos</p>
            </div>`;
    }

    tbody.innerHTML = '';
    if (data.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    const leaderName = id => state.allLeaders.find(l => l.id === id)?.name || '—';
    data.forEach(v => {
        const tr = document.createElement('tr');
        tr.className = 'border-b hover:bg-gray-50';
        tr.innerHTML = `
            <td class="px-4 py-3 font-medium text-gray-800">${v.cidadao?.name || '(cidadão removido)'}</td>
            <td class="px-4 py-3"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded font-semibold text-xs">${v.tipo}</span></td>
            <td class="px-4 py-3 font-mono text-xs">${v.placa || '—'}</td>
            <td class="px-4 py-3">${v.modelo || '—'}</td>
            <td class="px-4 py-3">${v.cor || '—'}</td>
            <td class="px-4 py-3">${v.adesivado ? '<span class="text-green-600 font-semibold text-xs">Sim</span>' : '<span class="text-gray-400 text-xs">Não</span>'}</td>
            <td class="px-4 py-3 text-gray-600 text-xs">${leaderName(v.cidadao?.leader)}</td>
            <td class="px-4 py-3"></td>`;
        const actionsTd = tr.lastElementChild;
        if (v.cidadao) {
            const btn = document.createElement('button');
            btn.className = 'text-blue-600 hover:text-blue-800 text-xs font-semibold whitespace-nowrap';
            btn.textContent = 'Ver abastecimento';
            btn.addEventListener('click', () => openCotaHistoryModal(v.cidadao));
            actionsTd.appendChild(btn);
        }
        tbody.appendChild(tr);
    });
}
