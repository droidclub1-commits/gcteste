// ═══════════════════════════════════════════════════════════════
// REPORTS — exportações em Excel/CSV (relatório de cidadãos e cobertura)
// Extraído do app.js (Fase 6 da modularização)
//
// Recebem o estado relevante (filtros atuais / dados de cobertura)
// como parâmetro, em vez de importar de state.js — mantém o módulo
// simples e evita expandir o estado compartilhado sem necessidade.
// ═══════════════════════════════════════════════════════════════

import { showToast, formatarData } from './utils.js';
import { sb } from './config.js';

export async function generateExcelReport(serverSearchState) {
    showToast("A gerar Excel...", "info");
    const s = serverSearchState;
    let query = sb.from('cidadaos').select(
        'name, cpf, rg, voterid, zona, secao, dob, sexo, type, phone, whatsapp, email, profissao, localtrabalho, nome_mae, nome_pai, logradouro, numero, complemento, bairro, cidade, estado, cep'
    );
    if (s.search)  query = query.or(`name.ilike.%${s.search}%,email.ilike.%${s.search}%,cpf.ilike.%${s.search}%,voterid.ilike.%${s.search}%`);
    if (s.type)    query = query.eq('type', s.type);
    if (s.bairro)  query = query.eq('bairro', s.bairro);
    if (s.cidade)  query = query.eq('cidade', s.cidade);
    if (s.leader)  query = query.eq('leader', s.leader);
    if (s.sexo)    query = query.eq('sexo', s.sexo);
    if (s.localTrabalho) query = query.ilike('localtrabalho', `%${s.localTrabalho}%`);
    query = query.order('name', { ascending: true });

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
        showToast("Nenhum cidadão encontrado.", "warning");
        return;
    }

    // Cabeçalhos do Excel
    const headers = [
        'Nome', 'CPF', 'RG', 'Título de Eleitor', 'Zona', 'Seção', 'Data Nasc.', 'Sexo', 'Tipo',
        'Telefone', 'WhatsApp', 'Email', 'Profissão', 'Local de Trabalho', 'Nome da Mãe', 'Nome do Pai',
        'Logradouro', 'Número', 'Complemento', 'Bairro', 'Cidade', 'Estado', 'CEP'
    ];

    const rows = data.map(c => [
        c.name || '',
        c.cpf || '',
        c.rg || '',
        c.voterid || '',
        c.zona || '',
        c.secao || '',
        c.dob ? formatarData(c.dob) : '',
        c.sexo || '',
        c.type || '',
        c.phone || '',
        c.whatsapp ? 'Sim' : 'Não',
        c.email || '',
        c.profissao || '',
        c.localtrabalho || '',
        c.nome_mae || '',
        c.nome_pai || '',
        c.logradouro || '',
        c.numero || '',
        c.complemento || '',
        c.bairro || '',
        c.cidade || '',
        c.estado || '',
        c.cep || ''
    ]);

    // Gera CSV compatível com Excel (separador ponto-e-vírgula para pt-BR)
    const esc = v => {
        const s = String(v);
        return (s.includes(';') || s.includes('"') || s.includes('\n'))
            ? ('"' + s.replace(/"/g, '""') + '"') : s;
    };
    const csvLines = [
        headers.map(esc).join(';'),
        ...rows.map(r => r.map(esc).join(';'))
    ];
    const csvContent = '\uFEFF' + csvLines.join('\r\n'); // BOM para Excel reconhecer UTF-8

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    a.download = `cidadaos_${hoje}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Excel gerado — ${data.length} cidadão(s).`, "success");
}

export function exportCoberturaExcel(coberturaData) {
    // Verifica qual modo está activo
    const liderWrap = document.getElementById('cobertura-lider-wrap');
    const isLiderMode = liderWrap && !liderWrap.classList.contains('hidden');
    if (isLiderMode) {
        // Exportar tabela de liderança
        const rows = [];
        document.querySelectorAll('#cobertura-lider-tbody tr').forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length) rows.push([tds[0].textContent, tds[1].textContent, tds[2].textContent, tds[3].textContent, tds[4].textContent, tds[5].textContent]);
        });
        if (!rows.length) { showToast('Sem dados para exportar.', 'warning'); return; }
        const headers = ['Nome','Título de Eleitor','Zona','Seção','Município','Tipo'];
        const esc = v => { const s = String(v??''); return (s.includes(';')||s.includes('"')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
        const csv = '\uFEFF' + [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
        a.download = `cobertura_lideranca_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showToast('Exportado!', 'success'); return;
    }
    if (!coberturaData.length) {
        showToast('Carregue os dados primeiro clicando em "Buscar".', 'warning');
        return;
    }
    const headers = ['Município', 'Zona', 'Seção', 'Total Cidadãos', 'Distribuição por Tipo'];
    const rows = coberturaData.map(g => [
        g.cidade, g.zona, g.secao, g.total,
        Object.entries(g.tipos).map(([t, n]) => `${t}: ${n}`).join(' | ')
    ]);
    const esc = v => {
        const s = String(v ?? '');
        return (s.includes(';') || s.includes('"') || s.includes('\n'))
            ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = ['\uFEFF',
        headers.map(esc).join(';'),
        ...rows.map(r => r.map(esc).join(';'))
    ].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cobertura_eleitoral_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    showToast('Cobertura exportada com sucesso!', 'success');
}
