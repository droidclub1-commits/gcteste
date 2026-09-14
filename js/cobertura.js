// ═══════════════════════════════════════════════════════════════
// COBERTURA — cobertura eleitoral por município/zona/seção/liderança
// Extraído do app.js (Fase 10 da modularização)
//
// coberturaData fica encapsulado aqui (mesmo padrão de cidadaos.js
// com serverSearchState). app.js/reports.js acessam via
// getCoberturaData() em vez de ler a variável direto.
// ═══════════════════════════════════════════════════════════════

import { showToast } from './utils.js';
import { sb } from './config.js';
import { state } from './state.js';

let coberturaData = [];

export function getCoberturaData() {
    return coberturaData;
}

export function setupCoberturaLiderAutocomplete() {
    const searchInput = document.getElementById('cobertura-lider-search');
    const dropdown    = document.getElementById('cobertura-lider-dropdown');
    const hiddenInput = document.getElementById('cobertura-filter-lider');
    if (!searchInput || !dropdown || !hiddenInput) return;
    if (searchInput._autocompleteReady) return;
    searchInput._autocompleteReady = true;

    const sorted = [...state.allLeaders].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    function showDropdown(term) {
        const filtered = term
            ? sorted.filter(l => l.name.toLowerCase().includes(term.toLowerCase()))
            : sorted;
        dropdown.innerHTML = '';
        // Opção "Todas"
        const all = document.createElement('div');
        all.className = 'px-3 py-2 cursor-pointer hover:bg-gray-100 text-gray-500 text-sm italic';
        all.textContent = 'Todas as Lideranças';
        all.addEventListener('mousedown', () => {
            hiddenInput.value = '';
            searchInput.value = '';
            dropdown.classList.add('hidden');
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
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.toggle('hidden', filtered.length === 0 && !term);
    }

    searchInput.addEventListener('input', () => showDropdown(searchInput.value));
    searchInput.addEventListener('focus', () => showDropdown(searchInput.value));
    searchInput.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
        // Se o texto não bate com nenhuma liderança, limpa
        const match = sorted.find(l => l.name.toLowerCase() === searchInput.value.toLowerCase());
        if (!match) { hiddenInput.value = ''; searchInput.value = ''; }
    });
}

export function clearCoberturaFiltros() {
    const el = id => document.getElementById(id);
    if (el('cobertura-filter-cidade')) el('cobertura-filter-cidade').value = '';
    if (el('cobertura-filter-zona'))   el('cobertura-filter-zona').value   = '';
    if (el('cobertura-filter-secao'))  el('cobertura-filter-secao').value  = '';
    if (el('cobertura-filter-lider'))  el('cobertura-filter-lider').value  = '';
    const cobSearchInput = el('cobertura-lider-search');
    if (cobSearchInput) { cobSearchInput.value = ''; cobSearchInput._autocompleteReady = false; }
    // Limpa resultados
    const tbody = el('cobertura-tbody'); if (tbody) tbody.innerHTML = '';
    const liderTbody = el('cobertura-lider-tbody'); if (liderTbody) liderTbody.innerHTML = '';
    const summary = el('cobertura-summary'); if (summary) summary.innerHTML = '';
    el('cobertura-table-wrap')?.classList.remove('hidden');
    el('cobertura-lider-wrap')?.classList.add('hidden');
    el('cobertura-empty')?.classList.remove('hidden');
    el('cobertura-lider-empty')?.classList.add('hidden');
    coberturaData = [];
}

export async function loadCoberturaEleitoral() {
    const el     = id => document.getElementById(id);
    const btn    = el('cobertura-load-btn');
    const summary = el('cobertura-summary');
    if (!btn) return;

    const cidade  = el('cobertura-filter-cidade')?.value || '';
    const zona    = el('cobertura-filter-zona')?.value.trim() || '';
    const secao   = el('cobertura-filter-secao')?.value.trim() || '';
    const liderId = el('cobertura-filter-lider')?.value || '';

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner mx-auto" style="display:inline-block"></div>';

    try {
        if (liderId) {
            // ── MODO LIDERANÇA: tabela individual com nome/título/zona/seção ──
            el('cobertura-table-wrap')?.classList.add('hidden');
            el('cobertura-lider-wrap')?.classList.remove('hidden');

            const liderTbody = el('cobertura-lider-tbody');
            const liderEmpty = el('cobertura-lider-empty');
            const liderHeader = el('cobertura-lider-header');
            liderTbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-400">A carregar...</td></tr>';
            if (liderEmpty) liderEmpty.classList.add('hidden');

            let query = sb.from('cidadaos')
                .select('name, voterid, zona, secao, cidade, type')
                .eq('leader', liderId)
                .not('zona', 'is', null)
                .not('zona', 'eq', '');
            if (cidade) query = query.eq('cidade', cidade);
            if (zona)   query = query.ilike('zona', `%${zona}%`);
            if (secao)  query = query.ilike('secao', `%${secao}%`);
            query = query.order('zona', { ascending: true }).order('secao', { ascending: true }).order('name', { ascending: true });

            // ── Paginação server-side: chunks de 1000, limite de segurança 5000 ──
            let data = [];
            let _lOffset = 0;
            const _LPAGE = 1000;
            const _LMAX  = 5000;
            let _lTruncated = false;
            while (true) {
                const { data: chunk, error } = await query.range(_lOffset, _lOffset + _LPAGE - 1);
                if (error) throw error;
                data = [...data, ...(chunk || [])];
                if (!chunk || chunk.length < _LPAGE) break;
                _lOffset += _LPAGE;
                if (data.length >= _LMAX) { _lTruncated = true; break; }
            }

            const liderNome = state.allLeaders.find(l => l.id === liderId)?.name || 'Liderança';
            if (liderHeader) {
                liderHeader.innerHTML = `<span class="font-semibold text-blue-800">Liderança: ${liderNome}</span> <span class="text-blue-600 ml-2">${(data||[]).length} cidadão(s) com zona/seção cadastrada</span>${_lTruncated ? ' <span class="text-orange-600 font-semibold ml-2">⚠️ Exibindo os primeiros 5.000 resultados — use filtros para refinar.</span>' : ''}`;
            }

            liderTbody.innerHTML = '';
            if (!data || data.length === 0) {
                if (liderEmpty) liderEmpty.classList.remove('hidden');
            } else {
                // Cards resumo por zona/seção
                const gruposLider = {};
                data.forEach(c => {
                    const key = `${c.zona}||${c.secao}`;
                    gruposLider[key] = (gruposLider[key] || 0) + 1;
                });
                if (summary) {
                    const zonas = new Set(data.map(c => c.zona)).size;
                    const secoes = Object.keys(gruposLider).length;
                    summary.innerHTML = `
                        <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                            <p class="text-3xl font-bold text-blue-600">${data.length}</p>
                            <p class="text-sm text-gray-500 mt-1">Cidadãos da Liderança</p>
                        </div>
                        <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                            <p class="text-3xl font-bold text-green-600">${zonas}</p>
                            <p class="text-sm text-gray-500 mt-1">Zonas</p>
                        </div>
                        <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                            <p class="text-3xl font-bold text-purple-600">${secoes}</p>
                            <p class="text-sm text-gray-500 mt-1">Seções</p>
                        </div>
                        <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                            <p class="text-xl font-bold text-orange-600 truncate">${liderNome.split(' ')[0]}</p>
                            <p class="text-sm text-gray-500 mt-1">Liderança Selecionada</p>
                        </div>`;
                }
                data.forEach(c => {
                    const tr = document.createElement('tr');
                    tr.className = 'hover:bg-gray-50';
                    tr.innerHTML = `
                        <td class="px-4 py-3 font-medium text-gray-800">${c.name}</td>
                        <td class="px-4 py-3 text-gray-600 font-mono text-xs">${c.voterid || '—'}</td>
                        <td class="px-4 py-3"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded font-semibold text-xs">${c.zona || '—'}</span></td>
                        <td class="px-4 py-3"><span class="bg-purple-100 text-purple-800 px-2 py-1 rounded font-semibold text-xs">${c.secao || '—'}</span></td>
                        <td class="px-4 py-3 text-gray-600 text-sm">${c.cidade || '—'}</td>
                        <td class="px-4 py-3 text-gray-500 text-xs">${c.type || 'Outro'}</td>`;
                    liderTbody.appendChild(tr);
                });
            }
        } else {
            // ── MODO PADRÃO: agrupado por município/zona/seção ──
            el('cobertura-lider-wrap')?.classList.add('hidden');
            el('cobertura-table-wrap')?.classList.remove('hidden');

            const tbody = el('cobertura-tbody');
            const empty = el('cobertura-empty');
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">A carregar...</td></tr>';
            if (empty) empty.classList.add('hidden');

            // ── Paginação server-side: chunks de 1000 para suportar 25k+ cadastros ──
            let data = [];
            let _offset = 0;
            const _PAGE = 1000;
            while (true) {
                let q = sb.from('cidadaos')
                    .select('cidade, zona, secao, type')
                    .not('zona', 'is', null)
                    .not('zona', 'eq', '');
                if (cidade) q = q.eq('cidade', cidade);
                if (zona)   q = q.ilike('zona', `%${zona}%`);
                if (secao)  q = q.ilike('secao', `%${secao}%`);
                q = q.range(_offset, _offset + _PAGE - 1);
                const { data: chunk, error } = await q;
                if (error) throw error;
                data = [...data, ...(chunk || [])];
                if (!chunk || chunk.length < _PAGE) break;
                _offset += _PAGE;
            }

            if (!data || data.length === 0) {
                tbody.innerHTML = '';
                if (empty) empty.classList.remove('hidden');
                if (summary) summary.innerHTML = '';
                coberturaData = [];
                return;
            }

            const grupos = {};
            data.forEach(c => {
                const key = `${c.cidade||'—'}||${c.zona||'—'}||${c.secao||'—'}`;
                if (!grupos[key]) grupos[key] = { cidade: c.cidade||'—', zona: c.zona||'—', secao: c.secao||'—', total: 0, tipos: {} };
                grupos[key].total++;
                grupos[key].tipos[c.type||'Outro'] = (grupos[key].tipos[c.type||'Outro'] || 0) + 1;
            });

            coberturaData = Object.values(grupos).sort((a, b) => {
                const cc = a.cidade.localeCompare(b.cidade, 'pt-BR');
                if (cc !== 0) return cc;
                const zn = String(a.zona).localeCompare(String(b.zona), 'pt-BR', { numeric: true });
                if (zn !== 0) return zn;
                return String(a.secao).localeCompare(String(b.secao), 'pt-BR', { numeric: true });
            });

            const totalCidadaos = coberturaData.reduce((s, g) => s + g.total, 0);
            const totalSecoes   = coberturaData.length;
            const totalZonas    = new Set(coberturaData.map(g => `${g.cidade}||${g.zona}`)).size;
            const topSecao      = coberturaData.reduce((a, b) => b.total > (a?.total||0) ? b : a, null);

            if (summary) {
                summary.innerHTML = `
                    <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                        <p class="text-3xl font-bold text-blue-600">${totalCidadaos}</p>
                        <p class="text-sm text-gray-500 mt-1">Cidadãos com Zona/Seção</p>
                    </div>
                    <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                        <p class="text-3xl font-bold text-green-600">${totalZonas}</p>
                        <p class="text-sm text-gray-500 mt-1">Zonas</p>
                    </div>
                    <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                        <p class="text-3xl font-bold text-purple-600">${totalSecoes}</p>
                        <p class="text-sm text-gray-500 mt-1">Seções</p>
                    </div>
                    <div class="bg-white rounded-lg shadow-sm p-4 text-center border">
                        <p class="text-3xl font-bold text-orange-600">${topSecao ? topSecao.total : 0}</p>
                        <p class="text-sm text-gray-500 mt-1">Maior Seção${topSecao ? ` (Z${topSecao.zona}/S${topSecao.secao})` : ''}</p>
                    </div>`;
            }

            tbody.innerHTML = '';
            coberturaData.forEach(g => {
                const tiposStr = Object.entries(g.tipos).sort((a, b) => b[1]-a[1]).map(([t,n]) => `${t}: ${n}`).join(' · ');
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-gray-50';
                tr.innerHTML = `
                    <td class="px-4 py-3 text-gray-800">${g.cidade}</td>
                    <td class="px-4 py-3 font-semibold">${g.zona}</td>
                    <td class="px-4 py-3 font-semibold">${g.secao}</td>
                    <td class="px-4 py-3 text-center"><span class="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded-full text-sm">${g.total}</span></td>
                    <td class="px-4 py-3 text-gray-500 text-xs">${tiposStr}</td>`;
                tbody.appendChild(tr);
            });
        }
    } catch(e) {
        console.error(e);
        showToast('Erro ao carregar cobertura: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Buscar';
    }
}
