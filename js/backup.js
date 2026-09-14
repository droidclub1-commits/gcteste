// ═══════════════════════════════════════════════════════════════
// BACKUP — exportação completa (JSON/CSV) e histórico local
// Extraído do app.js (Fase 4 da modularização)
// ═══════════════════════════════════════════════════════════════

import { showToast, formatarData } from './utils.js';
import { sb } from './config.js';

export async function backupData(format) {
    const jsonBtn = document.getElementById('backup-json-btn');
    const csvBtn  = document.getElementById('backup-csv-btn');
    const status  = document.getElementById('backup-status');
    const btn = format === 'json' ? jsonBtn : csvBtn;
    if (!btn) return;

    btn.disabled = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="display:inline-block;margin-right:6px"></div> A exportar...';
    if (status) {
        status.className = 'bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800';
        status.textContent = 'A exportar todos os dados do Supabase... Aguarde, pode demorar alguns segundos.';
        status.classList.remove('hidden');
    }

    try {
        // Cidadãos — busca paginada para suportar 25k+ registos
        let cidadaos = [];
        let offset = 0;
        const PAGE = 1000;
        while (true) {
            const { data, error } = await sb.from('cidadaos')
                .select('*')
                .order('name', { ascending: true })
                .range(offset, offset + PAGE - 1);
            if (error) throw error;
            cidadaos = [...cidadaos, ...(data || [])];
            if (!data || data.length < PAGE) break;
            offset += PAGE;
        }

        // Mapa de líderes construído a partir do próprio lote de cidadãos
        // já buscado acima — evita depender de estado compartilhado externo.
        const leaderMap = new Map(cidadaos.map(c => [c.id, c.name]));

        // Demandas — todas de uma vez (geralmente menos registos)
        const { data: demandas, error: errDemandas } = await sb
            .from('demandas').select('*').order('created_at', { ascending: false });
        if (errDemandas) throw errDemandas;

        const hoje  = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        const agora = new Date().toLocaleString('pt-BR');

        if (format === 'json') {
            const payload = {
                exportado_em:    agora,
                total_cidadaos:  cidadaos.length,
                total_demandas:  (demandas||[]).length,
                cidadaos,
                demandas: demandas || []
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `backup_completo_${hoje}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);

        } else {
            // CSV com todos os campos dos cidadãos
            const headers = [
                'Nome','CPF','RG','Título Eleitor','Zona','Seção',
                'Data Nasc.','Sexo','Tipo','Telefone','WhatsApp','Email',
                'Profissão','Local Trabalho','Nome da Mãe','Nome do Pai',
                'Logradouro','Número',
                'Complemento','Bairro','Cidade','Estado','CEP',
                'Liderança','Filhos','Filhas','Cadastrado em'
            ];
            const esc = v => {
                const s = String(v ?? '');
                return (s.includes(';') || s.includes('"') || s.includes('\n'))
                    ? '"' + s.replace(/"/g, '""') + '"' : s;
            };
            const rows = cidadaos.map(c => [
                c.name, c.cpf, c.rg, c.voterid, c.zona, c.secao,
                c.dob ? formatarData(c.dob) : '',
                c.sexo, c.type,
                c.phone, c.whatsapp ? 'Sim' : 'Não', c.email,
                c.profissao, c.localtrabalho, c.nome_mae, c.nome_pai,
                c.logradouro, c.numero, c.complemento, c.bairro,
                c.cidade, c.estado, c.cep,
                leaderMap.get(c.leader) || '',
                c.sons ?? 0, c.daughters ?? 0,
                c.created_at ? new Date(c.created_at).toLocaleString('pt-BR') : ''
            ]);
            const csv = ['\uFEFF',
                headers.map(esc).join(';'),
                ...rows.map(r => r.map(esc).join(';'))
            ].join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `backup_cidadaos_${hoje}.csv`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        // Regista no histórico local
        const hist = JSON.parse(localStorage.getItem('backupHistory') || '[]');
        hist.unshift({ data: agora, formato: format.toUpperCase(), total: cidadaos.length });
        localStorage.setItem('backupHistory', JSON.stringify(hist.slice(0, 10)));
        renderBackupHistory();

        if (status) {
            status.className = 'bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800';
            status.textContent = `✅ Backup concluído! ${cidadaos.length} cidadãos exportados em ${agora}.`;
        }
        showToast(`Backup ${format.toUpperCase()} concluído!`, 'success');

    } catch(e) {
        console.error(e);
        if (status) {
            status.className = 'bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800';
            status.textContent = '❌ Erro ao exportar: ' + e.message;
            status.classList.remove('hidden');
        }
        showToast('Erro no backup: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

export function renderBackupHistory() {
    const el = document.getElementById('backup-history');
    if (!el) return;
    const hist = JSON.parse(localStorage.getItem('backupHistory') || '[]');
    if (!hist.length) {
        el.innerHTML = '<p class="text-gray-400 text-sm">Nenhum backup registado neste dispositivo.</p>';
        return;
    }
    el.innerHTML = hist.map(h =>
        `<div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <span class="text-gray-700 text-sm">${h.data}</span>
            <div class="flex gap-3 text-xs items-center">
                <span class="bg-gray-100 px-2 py-1 rounded font-medium">${h.formato}</span>
                <span class="text-gray-500">${h.total} cidadãos</span>
            </div>
        </div>`
    ).join('');
}
