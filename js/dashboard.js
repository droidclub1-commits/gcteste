import { deadlineState } from './demanda-fields.js';
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
import { fetchAllRows } from './data.js';
import { openDetailsModal } from './cidadaos.js';
import { openDemandaDetailsModal } from './demandas.js';

let cidadaosChart = null, demandasChart = null;
let cidadaosBairroChart = null, cidadaosSexoChart = null,
    cidadaosFaixaEtariaChart = null, cidadaosMunicipioChart = null;

// ── Cache para o modal de aniversariantes (evita re-fetch ao paginar) ──
let _aniversariantesTodos = [];
let _anivModalPagina      = 1;
const ANIV_MODAL_POR_PAG  = 12;

let dashboardGeneration = 0;
export async function updateDashboard() {
    const generation = ++dashboardGeneration;
    const totalEl = document.getElementById('dashboard-total-cidadaos');
    const demandasEl = document.getElementById('dashboard-total-demandas');
    const abertasEl = document.getElementById('dashboard-demandas-abertas');
    const atrasadasEl = document.getElementById('dashboard-demandas-atrasadas');
    const tracking = document.getElementById('dashboard-demandas-prazos');
    try {
        // Independente dos filtros e caches das telas de cidadãos/demandas.
        const [cidadaos, demandas] = await Promise.all([
            fetchAllRows(() => sb.from('cidadaos').select('id, name, dob, type, cidade, bairro, sexo', { count: 'exact' }).order('id')),
            fetchAllRows(() => sb.from('demandas').select('id, title, status, created_at, responsavel, prazo, prioridade, cidadao:cidadaos(name)', { count: 'exact' }).order('created_at', { ascending: false }).order('id'))
        ]);
        if (generation !== dashboardGeneration) return;
        if (totalEl) { totalEl.textContent = cidadaos.length; totalEl.classList.remove('animate-pulse'); }
        if (demandasEl) { demandasEl.textContent = demandas.length; demandasEl.classList.remove('animate-pulse'); }
        const abertas = demandas.filter(d => d.status !== 'completed');
        if (abertasEl) abertasEl.textContent = abertas.length;
        if (atrasadasEl) atrasadasEl.textContent = abertas.filter(d => deadlineState(d) === 'atrasada').length;
        if (tracking) {
            const today = abertas.filter(d => deadlineState(d) === 'hoje').length;
            const urgent = abertas.filter(d => d.prioridade === 'urgente').length;
            tracking.textContent = `${today} vencem hoje · ${urgent} urgentes abertas`;
        }
        updateDemandasRecentes(demandas);
        await Promise.all([
            updateAniversariantes(cidadaos), updateCidadaosPorTipoChart(cidadaos),
            updateDemandasPorStatusChart(demandas), updateCidadaosPorBairroChart(cidadaos),
            updateCidadaosPorMunicipioChart(cidadaos), updateCidadaosPorSexoChart(cidadaos),
            updateCidadaosPorFaixaEtariaChart(cidadaos)
        ]);
    } catch (error) {
        if (generation !== dashboardGeneration) return;
        console.error('Dashboard:', error);
        for (const el of [totalEl, demandasEl, abertasEl, atrasadasEl]) {
            if (el) { el.textContent = 'Indisponível'; el.classList.remove('animate-pulse'); }
        }
        if (tracking) tracking.textContent = '';
        _aniversariantesTodos = [];
        const anivTotal = document.getElementById('aniversariantes-total');
        if (anivTotal) anivTotal.textContent = '';
        document.getElementById('aniversariantes-ver-mais')?.classList.add('hidden');
        for (const chart of [cidadaosChart, demandasChart, cidadaosBairroChart, cidadaosSexoChart, cidadaosFaixaEtariaChart, cidadaosMunicipioChart]) chart?.destroy();
        cidadaosChart = demandasChart = cidadaosBairroChart = cidadaosSexoChart = cidadaosFaixaEtariaChart = cidadaosMunicipioChart = null;
        for (const id of ['aniversariantes-list', 'demandas-recentes-list']) {
            const el = document.getElementById(id);
            if (el) el.textContent = 'Não foi possível atualizar os dados. Tente novamente.';
        }
    }
}

async function updateAniversariantes(data) {
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

        const doMes = (data || [])
            .filter(c => c.dob && parseInt(c.dob.split('-')[1], 10) === mes)
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

function updateDemandasRecentes(demandas) {
    const listEl = document.getElementById('demandas-recentes-list');
    if (!listEl) return;
    const recentes = demandas.slice(0, 5);
    listEl.innerHTML = '';
    if (recentes.length === 0) {
        listEl.innerHTML = '<p class="text-sm text-gray-500">Nenhuma demanda recente.</p>';
        return;
    }
    recentes.forEach(d => {
        const nomeSolicitante = d.cidadao ? d.cidadao.name : 'Desconhecido';
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

function dashboardChartOptions(legend = false) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 240 },
        plugins: { legend: { display: legend, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } }
    };
}

function rankingOptions(canvas, count) {
    canvas.parentElement.style.setProperty('--ranking-height', `${count * 30 + 30}px`);
    return {
        ...dashboardChartOptions(),
        indexAxis: 'y',
        scales: {
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: {
                grid: { display: false },
                afterFit(scale) { scale.width = Math.min(scale.width, scale.chart.width * 0.48); },
                ticks: {
                    callback(value) {
                        const label = this.getLabelForValue(value);
                        const maxLength = Math.max(12, Math.floor(this.chart.width / 17));
                        return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
                    }
                }
            }
        }
    };
}

const demandTotalLabel = {
    id: 'demandTotalLabel',
    afterDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const arc = chart.getDatasetMeta(0).data[0];
        const x = arc?.x ?? (chartArea.left + chartArea.right) / 2;
        const y = arc?.y ?? (chartArea.top + chartArea.bottom) / 2;
        const total = chart.data.datasets[0].data.reduce((sum, count) => sum + count, 0);
        const styles = getComputedStyle(chart.canvas);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = styles.getPropertyValue('--gc-ink').trim() || '#0F2A4A';
        ctx.font = '700 24px Inter, sans-serif';
        ctx.fillText(total.toLocaleString('pt-BR'), x, y - 8);
        ctx.fillStyle = styles.getPropertyValue('--gc-muted').trim() || '#6B7280';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText('Total', x, y + 14);
        ctx.restore();
    }
};

async function updateCidadaosPorTipoChart(data) {
    const ctx = document.getElementById('cidadaos-por-tipo-chart');
    if (!ctx) return;
    try {

        const contagem = (data || []).reduce((acc, c) => {
            acc[c.type] = (acc[c.type] || 0) + 1;
            return acc;
        }, {});

        const labels = Object.keys(contagem);
        const values = Object.values(contagem);
        const cores = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#6B7280'];

        if (cidadaosChart) cidadaosChart.destroy();
        cidadaosChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ label: 'Cidadãos por Tipo', data: values, backgroundColor: cores.slice(0, labels.length) }] },
            options: { ...dashboardChartOptions(true), cutout: '65%' }
        });
    } catch(e) { console.warn('Chart tipo:', e); }
}

async function updateDemandasPorStatusChart(data) {
    const ctx = document.getElementById('demandas-por-status-chart');
    if (!ctx) return;
    try {
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
            options: { ...dashboardChartOptions(true), cutout: '72%' },
            plugins: [demandTotalLabel]
        });
    } catch(e) { console.error('Erro gráfico demandas:', e); }
}

async function updateCidadaosPorMunicipioChart(data) {
    const ctx = document.getElementById('cidadaos-por-municipio-chart');
    if (!ctx) return;
    try {
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
            type: 'bar',
            data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => colors[i % colors.length]), borderRadius: 5, maxBarThickness: 16 }] },
            options: {
                ...rankingOptions(ctx, labels.length),
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                                return ` ${c.label}: ${c.parsed.x} (${((c.parsed.x / total) * 100).toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
    } catch(e) { console.warn('Chart município:', e); }
}

async function updateCidadaosPorBairroChart(cidadaos) {
    const ctx = document.getElementById('cidadaos-por-bairro-chart');
    if (!ctx) return;
    try {
        const groups = new Map();
        for (const c of cidadaos) {
            const key = JSON.stringify([c.cidade || '', c.bairro || '']);
            const group = groups.get(key) || { cidade: c.cidade, bairro: c.bairro, total: 0 };
            group.total++; groups.set(key, group);
        }
        const data = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 10);
        const labels = data.map(r => r.bairro ? (r.cidade ? `${r.bairro} (${r.cidade})` : r.bairro) : 'N/A');
        const values = data.map(r => r.total);
        if (cidadaosBairroChart) cidadaosBairroChart.destroy();
        cidadaosBairroChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Cidadãos por Bairro (Top 10)', data: values, backgroundColor: '#10B981', borderRadius: 5, maxBarThickness: 16 }] },
            options: rankingOptions(ctx, labels.length)
        });
    } catch(e) { console.warn('Chart bairro:', e); }
}

async function updateCidadaosPorSexoChart(data) {
    const ctx = document.getElementById('cidadaos-por-sexo-chart');
    if (!ctx) return;
    try {
        const contagem = (data || []).reduce((acc, c) => {
            const sexo = c.sexo || 'Não Informar';
            acc[sexo] = (acc[sexo] || 0) + 1;
            return acc;
        }, {});
        const labels = Object.keys(contagem);
        const values = Object.values(contagem);
        if (cidadaosSexoChart) cidadaosSexoChart.destroy();
        cidadaosSexoChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ label: 'Cidadãos por Sexo', data: values, backgroundColor: ['#3B82F6', '#EC4899', '#F59E0B', '#6B7280'] }] },
            options: { ...dashboardChartOptions(true), cutout: '65%' }
        });
    } catch(e) { console.warn('Chart sexo:', e); }
}

async function updateCidadaosPorFaixaEtariaChart(data) {
    const ctx = document.getElementById('cidadaos-por-faixa-etaria-chart');
    if (!ctx) return;
    try {
        const faixas = { '0-17': 0, '18-25': 0, '26-35': 0, '36-50': 0, '51-65': 0, '66+': 0, 'N/A': 0 };
        (data || []).forEach(c => { const faixa = getFaixaEtaria(c.dob); faixas[faixa]++; });
        const labels = Object.keys(faixas);
        const values = Object.values(faixas);
        if (cidadaosFaixaEtariaChart) cidadaosFaixaEtariaChart.destroy();
        cidadaosFaixaEtariaChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Cidadãos por Faixa Etária', data: values, backgroundColor: '#8B5CF6', borderRadius: 5, maxBarThickness: 28 }] },
            options: { ...dashboardChartOptions(), scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });
    } catch(e) { console.warn('Chart faixa etária:', e); }
}

