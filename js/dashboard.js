// ═══════════════════════════════════════════════════════════════
// DASHBOARD — gráficos, widget de aniversariantes e demandas recentes
// Extraído do app.js (Fase 12 da modularização — último bloco grande)
//
// Só updateDashboard() é exportada como orquestrador; as 6 funções
// updateXxxChart + updateDemandasRecentes são só chamadas
// internamente por ela, então ficam privadas. Instâncias de
// gráfico (Chart.js) e o cache do modal de aniversariantes ficam
// encapsulados aqui dentro.
// ═══════════════════════════════════════════════════════════════

import { getStatusInfo, getFaixaEtaria } from './utils.js';
import { sb } from './config.js';
import { state } from './state.js';
import { openDetailsModal, getTotalCidadaosCount } from './cidadaos.js';
import { openDemandaDetailsModal } from './demandas.js';

let cidadaosChart = null, demandasChart = null;
let cidadaosBairroChart = null, cidadaosSexoChart = null,
    cidadaosFaixaEtariaChart = null, cidadaosMunicipioChart = null;

// ── Cache para o modal de aniversariantes (evita re-fetch ao paginar) ──
let _aniversariantesTodos = [];
let _anivModalPagina      = 1;
const ANIV_MODAL_POR_PAG  = 12;

export async function updateDashboard() {
    const totalEl = document.getElementById('dashboard-total-cidadaos');
    // As duas contagens (cidadãos/demandas) em paralelo — nenhuma depende da outra
    await Promise.all([
        (async () => {
            // Admin vê totais globais; cadastrador vê só os seus (RLS já filtra automaticamente)
            if (state.userRole === 'admin' && getTotalCidadaosCount() > 0) {
                totalEl.textContent = getTotalCidadaosCount();
            } else {
                const { count } = await sb.from('cidadaos').select('*', { count: 'exact', head: true });
                totalEl.textContent = count || 0;
            }
            totalEl.classList.remove('animate-pulse');
        })(),
        (async () => {
            // Contador de demandas — busca do servidor para reflectir total real
            const totalDemandasEl = document.getElementById('dashboard-total-demandas');
            try {
                const { count: cntDemandas } = await sb
                    .from('demandas').select('*', { count: 'exact', head: true });
                totalDemandasEl.textContent = cntDemandas || 0;
            } catch(e) { /* mantém o valor anterior */ }
            totalDemandasEl.classList.remove('animate-pulse');
        })()
    ]);
    // Gráficos e widgets em paralelo — não dependem uns dos outros
    updateDemandasRecentes();
    updateCidadaosPorTipoChart();
    updateDemandasPorStatusChart(); // async — não bloqueia
    await Promise.all([
        updateAniversariantes(),
        updateCidadaosPorBairroChart(),
        updateCidadaosPorMunicipioChart(),
        updateCidadaosPorSexoChart(),
        updateCidadaosPorFaixaEtariaChart()
    ]);
}

async function updateAniversariantes() {
    const listEl     = document.getElementById('aniversariantes-list');
    const totalEl    = document.getElementById('aniversariantes-total');
    const verMais    = document.getElementById('aniversariantes-ver-mais');
    const verMaisBtn = document.getElementById('aniversariantes-ver-mais-btn');
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-sm text-gray-400">A carregar...</p>';

    try {
        const now     = new Date();
        const mes     = now.getMonth() + 1;
        const diaHoje = now.getDate();

        const { data, error } = await sb
            .from('cidadaos')
            .select('id, name, dob')
            .not('dob', 'is', null)
            .order('dob', { ascending: true })
            .limit(2000);
        if (error) throw error;

        const doMes = (data || [])
            .filter(c => parseInt(c.dob.split('-')[1], 10) === mes)
            .sort((a, b) => parseInt(a.dob.split('-')[2], 10) - parseInt(b.dob.split('-')[2], 10));

        _aniversariantesTodos = doMes;

        const LIMITE_WIDGET = 10;
        const daqui = doMes.filter(c => parseInt(c.dob.split('-')[2], 10) >= diaHoje);
        const visiveis = daqui.slice(0, LIMITE_WIDGET);

        listEl.innerHTML = '';

        if (doMes.length === 0) {
            listEl.innerHTML = '<p class="text-sm text-gray-500">Nenhum aniversariante este mês.</p>';
            if (totalEl) totalEl.textContent = '';
            if (verMais) verMais.classList.add('hidden');
            return;
        }

        if (totalEl) totalEl.textContent = `${doMes.length} este mês`;

        if (daqui.length === 0) {
            listEl.innerHTML = '<p class="text-sm text-gray-500 italic">Nenhum aniversariante pelos próximos dias.</p>';
        } else {
            visiveis.forEach(c => {
                const dia   = parseInt(c.dob.split('-')[2], 10);
                const eHoje = dia === diaHoje;
                const item  = document.createElement('div');
                item.className = 'flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer'
                    + (eHoje ? ' bg-yellow-50 border border-yellow-200' : '');
                const nameSpan = document.createElement('span');
                nameSpan.className = 'font-medium text-gray-700 text-sm truncate mr-2';
                nameSpan.textContent = c.name + (eHoje ? ' 🎂' : '');
                const diaSpan = document.createElement('span');
                diaSpan.className = 'font-bold flex-shrink-0 text-sm '
                    + (eHoje ? 'text-yellow-600' : 'text-blue-600');
                diaSpan.textContent = `dia ${String(dia).padStart(2, '0')}`;
                item.appendChild(nameSpan);
                item.appendChild(diaSpan);
                item.addEventListener('click', () => openDetailsModal(c.id));
                listEl.appendChild(item);
            });
        }

        if (verMais) verMais.classList.remove('hidden');
        if (verMaisBtn) {
            const novo = verMaisBtn.cloneNode(true);
            verMaisBtn.replaceWith(novo);
            document.getElementById('aniversariantes-ver-mais-btn').textContent =
                `Ver todos os ${doMes.length} aniversariantes do mês →`;
            document.getElementById('aniversariantes-ver-mais-btn')
                .addEventListener('click', () => openAniversariantesModal());
        }

    } catch(e) {
        console.error(e);
        listEl.innerHTML = '<p class="text-sm text-red-500">Erro ao carregar.</p>';
    }
}

export function openAniversariantesModal() {
    _anivModalPagina = 1;
    renderAniversariantesModal();
    document.getElementById('aniversariantes-modal').classList.remove('hidden');
}

export function closeAniversariantesModal() {
    document.getElementById('aniversariantes-modal').classList.add('hidden');
}

export function prevAniversariantesPage() {
    _anivModalPagina--;
    renderAniversariantesModal();
}

export function nextAniversariantesPage() {
    _anivModalPagina++;
    renderAniversariantesModal();
}

function renderAniversariantesModal() {
    const lista   = _aniversariantesTodos;
    const total   = lista.length;
    const totPag  = Math.ceil(total / ANIV_MODAL_POR_PAG) || 1;
    const inicio  = (_anivModalPagina - 1) * ANIV_MODAL_POR_PAG;
    const fim     = Math.min(inicio + ANIV_MODAL_POR_PAG, total);
    const pagina  = lista.slice(inicio, fim);
    const diaHoje = new Date().getDate();
    const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long' });

    const subtitle = document.getElementById('aniv-modal-subtitle');
    if (subtitle) subtitle.textContent =
        `${total} aniversariante(s) em ${mesNome} — página ${_anivModalPagina} de ${totPag}`;

    const listEl = document.getElementById('aniv-modal-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    pagina.forEach(c => {
        const dia   = parseInt(c.dob.split('-')[2], 10);
        const eHoje = dia === diaHoje;
        const row   = document.createElement('div');
        row.className = 'flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors '
            + (eHoje ? 'bg-yellow-50 border border-yellow-200 hover:bg-yellow-100'
                     : 'hover:bg-gray-50 border border-transparent');
        const left = document.createElement('div');
        left.className = 'flex items-center gap-3';
        const av = document.createElement('div');
        av.className = 'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 '
            + (eHoje ? 'bg-yellow-500' : 'bg-blue-500');
        av.textContent = c.name.charAt(0).toUpperCase();
        const name = document.createElement('span');
        name.className = 'font-medium text-gray-800 text-sm';
        name.textContent = c.name + (eHoje ? ' 🎂' : '');
        left.appendChild(av);
        left.appendChild(name);
        const diaTag = document.createElement('span');
        diaTag.className = 'text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 '
            + (eHoje ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-50 text-blue-700');
        diaTag.textContent = `dia ${String(dia).padStart(2, '0')}`;
        row.appendChild(left);
        row.appendChild(diaTag);
        row.addEventListener('click', () => {
            closeAniversariantesModal();
            openDetailsModal(c.id);
        });
        listEl.appendChild(row);
    });

    const pagesEl = document.getElementById('aniv-modal-pages');
    if (pagesEl) pagesEl.textContent = `${_anivModalPagina} / ${totPag}`;
    const prevBtn = document.getElementById('aniv-modal-prev');
    const nextBtn = document.getElementById('aniv-modal-next');
    if (prevBtn) prevBtn.disabled = _anivModalPagina <= 1;
    if (nextBtn) nextBtn.disabled = _anivModalPagina >= totPag;
}

function updateDemandasRecentes() {
    const listEl = document.getElementById('demandas-recentes-list');
    if (!listEl) return;
    const recentes = state.allDemandas.slice(0, 5);
    listEl.innerHTML = '';
    if (recentes.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-gray-500">Nenhuma demanda recente.</p>';
        return;
    }
    recentes.forEach(d => {
        const nomeSolicitante = d.cidadao ? d.cidadao.name : (state.allCidadaos.find(c => c.id === d.cidadao_id)?.name || 'Desconhecido');
        const statusInfo = getStatusInfo(d.status);
        const item = document.createElement('div');
        item.className = 'p-2 rounded-lg hover:bg-gray-50 border-b last:border-b-0 cursor-pointer';
        const topDiv = document.createElement('div');
        topDiv.className = 'flex justify-between items-center mb-1';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'font-semibold text-gray-800';
        titleSpan.textContent = d.title;
        const statusSpan = document.createElement('span');
        statusSpan.className = statusInfo.classes + ' !py-0.5 !px-2';
        statusSpan.textContent = statusInfo.text;
        topDiv.appendChild(titleSpan);
        topDiv.appendChild(statusSpan);
        const infoP = document.createElement('p');
        infoP.className = 'text-sm text-gray-600';
        infoP.textContent = `${nomeSolicitante} - ${d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : 'N/A'}`;
        item.appendChild(topDiv);
        item.appendChild(infoP);
        item.addEventListener('click', () => { openDemandaDetailsModal(d.id); });
        listEl.appendChild(item);
    });
}

async function updateCidadaosPorTipoChart() {
    const ctx = document.getElementById('cidadaos-por-tipo-chart');
    if (!ctx) return;
    try {
        const { data, error } = await sb
            .from('cidadaos')
            .select('type')
            .not('type', 'is', null);
        if (error) throw error;

        const contagem = (data || []).reduce((acc, c) => {
            acc[c.type] = (acc[c.type] || 0) + 1;
            return acc;
        }, {});

        const labels = Object.keys(contagem);
        const values = Object.values(contagem);
        const cores = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#6B7280'];

        if (cidadaosChart) cidadaosChart.destroy();
        cidadaosChart = new Chart(ctx, {
            type: 'pie',
            data: { labels, datasets: [{ label: 'Cidadãos por Tipo', data: values, backgroundColor: cores.slice(0, labels.length) }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch(e) { console.warn('Chart tipo:', e); }
}

async function updateDemandasPorStatusChart() {
    const ctx = document.getElementById('demandas-por-status-chart');
    if (!ctx) return;
    try {
        const { data, error } = await sb
            .from('demandas')
            .select('status');
        if (error) throw error;
        const contagem = (data || []).reduce((acc, d) => {
            acc[d.status] = (acc[d.status] || 0) + 1;
            return acc;
        }, {});
        const labels = Object.keys(contagem).map(s => getStatusInfo(s).text);
        const values = Object.values(contagem);
        const colors = Object.keys(contagem).map(s => getStatusInfo(s).color);
        if (demandasChart) demandasChart.destroy();
        demandasChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ label: 'Demandas por Status', data: values, backgroundColor: colors }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch(e) { console.error('Erro gráfico demandas:', e); }
}

async function updateCidadaosPorMunicipioChart() {
    const ctx = document.getElementById('cidadaos-por-municipio-chart');
    if (!ctx) return;
    try {
        const { data, error } = await sb.from('cidadaos').select('cidade');
        if (error) throw error;
        const contagem = (data || []).reduce((acc, c) => {
            const cidade = c.cidade || 'Não Informado';
            acc[cidade] = (acc[cidade] || 0) + 1;
            return acc;
        }, {});
        const sorted = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
        const labels = sorted.map(([k]) => k);
        const values = sorted.map(([, v]) => v);
        const colors = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316'];
        if (cidadaosMunicipioChart) cidadaosMunicipioChart.destroy();
        cidadaosMunicipioChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length) }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                                return ` ${c.label}: ${c.parsed} (${((c.parsed/total)*100).toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
    } catch(e) { console.warn('Chart município:', e); }
}

async function updateCidadaosPorBairroChart() {
    const ctx = document.getElementById('cidadaos-por-bairro-chart');
    if (!ctx) return;
    try {
        const { data, error } = await sb.rpc('count_by_bairro');
        if (error || !data) {
            const bairros = window._bairrosDisponiveis || [];
            if (cidadaosBairroChart) cidadaosBairroChart.destroy();
            cidadaosBairroChart = new Chart(ctx, {
                type: 'bar',
                data: { labels: bairros.slice(0, 10), datasets: [{ label: 'Bairros', data: new Array(Math.min(bairros.length,10)).fill(0), backgroundColor: '#10B981' }] },
                options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true } } }
            });
            return;
        }
        const labels = data.map(r => r.bairro || 'N/A');
        const values = data.map(r => r.total);
        if (cidadaosBairroChart) cidadaosBairroChart.destroy();
        cidadaosBairroChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Cidadãos por Bairro (Top 10)', data: values, backgroundColor: '#10B981' }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
        });
    } catch(e) { console.warn('Chart bairro:', e); }
}

async function updateCidadaosPorSexoChart() {
    const ctx = document.getElementById('cidadaos-por-sexo-chart');
    if (!ctx) return;
    try {
        const { data, error } = await sb.from('cidadaos').select('sexo');
        if (error) throw error;
        const contagem = (data || []).reduce((acc, c) => {
            const sexo = c.sexo || 'Não Informar';
            acc[sexo] = (acc[sexo] || 0) + 1;
            return acc;
        }, {});
        const labels = Object.keys(contagem);
        const values = Object.values(contagem);
        if (cidadaosSexoChart) cidadaosSexoChart.destroy();
        cidadaosSexoChart = new Chart(ctx, {
            type: 'pie',
            data: { labels, datasets: [{ label: 'Cidadãos por Sexo', data: values, backgroundColor: ['#3B82F6', '#EC4899', '#F59E0B', '#6B7280'] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } catch(e) { console.warn('Chart sexo:', e); }
}

async function updateCidadaosPorFaixaEtariaChart() {
    const ctx = document.getElementById('cidadaos-por-faixa-etaria-chart');
    if (!ctx) return;
    try {
        const { data, error } = await sb.from('cidadaos').select('dob');
        if (error) throw error;
        const faixas = { '0-17': 0, '18-25': 0, '26-35': 0, '36-50': 0, '51-65': 0, '66+': 0, 'N/A': 0 };
        (data || []).forEach(c => { const faixa = getFaixaEtaria(c.dob); faixas[faixa]++; });
        const labels = Object.keys(faixas);
        const values = Object.values(faixas);
        if (cidadaosFaixaEtariaChart) cidadaosFaixaEtariaChart.destroy();
        cidadaosFaixaEtariaChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Cidadãos por Faixa Etária', data: values, backgroundColor: '#8B5CF6' }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });
    } catch(e) { console.warn('Chart faixa etária:', e); }
}
