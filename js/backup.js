// Backup dos dados da aplicação. Não substitui backup do projeto Supabase.
import { showToast, formatarData } from './utils.js';
import { sb, SUPABASE_URL } from './config.js';
import { state } from './state.js';
import { csvCell, downloadBlob, fetchAllRows } from './data.js';
import { collectBackupTables, collectBackupPhotos, buildBackup } from './backup-core.js';

let backupRunning = false;
function encodeBlob(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Falha ao codificar uma foto.'));
        reader.readAsDataURL(blob);
    });
}

export async function backupData(format) {
    if (state.userRole !== 'admin') { showToast('Apenas administradores podem exportar o backup.', 'warning'); return false; }
    if (backupRunning) return false;
    if (!['json', 'csv'].includes(format)) return false;
    backupRunning = true;
    const buttons = ['backup-json-btn', 'backup-csv-btn'].map(id => document.getElementById(id)).filter(Boolean);
    const status = document.getElementById('backup-status');
    const progress = message => {
        if (!status) return;
        status.className = 'bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800';
        status.textContent = message;
    };
    buttons.forEach(btn => { btn.disabled = true; });
    const startedAt = new Date().toISOString();
    try {
        progress('Iniciando exportação... Mantenha esta aba aberta.');
        let total, partial = false;
        const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        if (format === 'json') {
            const tables = await collectBackupTables(sb, progress);
            const photos = await collectBackupPhotos(sb, tables.cidadaos, SUPABASE_URL, encodeBlob, progress);
            const payload = buildBackup(tables, photos, startedAt);
            partial = photos.external.length > 0;
            downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `backup_aplicacao_${hoje}.json`);
            total = tables.cidadaos.length;
            progress(`JSON gerado: ${Object.entries(payload.manifest.counts).map(([table, n]) => `${n} ${table}`).join('; ')}; ${photos.files.length} foto(s).${partial ? ` Atenção: ${photos.external.length} imagem(ns) externa(s) têm somente o link; consulte o manifesto.` : ''}`);
        } else {
            const cidadaos = await fetchAllRows(() => sb.from('cidadaos').select('*', { count: 'exact' }).order('name').order('id'));
            const leaders = new Map(cidadaos.map(c => [c.id, c.name]));
            const columns = [
                ['Nome','name'],['CPF','cpf'],['RG','rg'],['Título Eleitor','voterid'],['Zona','zona'],['Seção','secao'],
                ['Data Nasc.','dob'],['Sexo','sexo'],['Tipo','type'],['Telefone','phone'],['WhatsApp','whatsapp'],['Email','email'],
                ['Profissão','profissao'],['Local Trabalho','localtrabalho'],['Nome da Mãe','nome_mae'],['Nome do Pai','nome_pai'],
                ['Logradouro','logradouro'],['Número','numero'],['Complemento','complemento'],['Bairro','bairro'],['Cidade','cidade'],
                ['Estado','estado'],['CEP','cep'],['Liderança','leader'],['Filhos','sons'],['Filhas','daughters'],['Cadastrado em','created_at']
            ];
            const rows = cidadaos.map(c => columns.map(([, key]) => {
                if (key === 'leader') return leaders.get(c.leader) || '';
                if (key === 'dob') return c.dob ? formatarData(c.dob) : '';
                if (key === 'whatsapp') return c.whatsapp ? 'Sim' : 'Não';
                return c[key] ?? '';
            }));
            const csv = '\uFEFF' + [columns.map(([title]) => csvCell(title)).join(';'), ...rows.map(row => row.map(csvCell).join(';'))].join('\r\n');
            downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `cadastro_cidadaos_${hoje}.csv`);
            total = cidadaos.length;
            progress(`CSV gerado com ${total} cidadãos. Este arquivo não inclui os demais módulos nem fotos. Use o JSON para exportar os dados da aplicação.`);
        }
        if (status) status.className = `${partial ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-800'} border rounded-lg p-4 text-sm`;
        // O histórico é auxiliar; uma falha de localStorage não invalida o download.
        try {
            const raw = JSON.parse(localStorage.getItem('backupHistory') || '[]');
            const hist = Array.isArray(raw) ? raw : [];
            hist.unshift({ data: new Date().toLocaleString('pt-BR'), formato: format.toUpperCase(), total, parcial: partial });
            localStorage.setItem('backupHistory', JSON.stringify(hist.slice(0, 10)));
            renderBackupHistory();
        } catch (error) { console.warn('Não foi possível registrar o histórico local.', error); }
        showToast(partial ? 'Exportação gerada com ressalvas nas imagens externas.' : 'Exportação gerada com sucesso.', partial ? 'warning' : 'success');
        return !partial;
    } catch (error) {
        console.error(error);
        if (status) { status.className = 'bg-red-50 border rounded-lg p-4 text-sm text-red-800'; status.textContent = 'Exportação interrompida. Nenhum arquivo parcial foi gerado. ' + error.message; }
        showToast('Erro na exportação: ' + error.message, 'error');
        return false;
    } finally {
        backupRunning = false;
        buttons.forEach(btn => { btn.disabled = false; });
    }
}

export function renderBackupHistory() {
    const container = document.getElementById('backup-history');
    if (!container) return;
    let hist = [];
    try { const raw = JSON.parse(localStorage.getItem('backupHistory') || '[]'); if (Array.isArray(raw)) hist = raw; } catch { /* histórico inválido */ }
    container.textContent = '';
    if (!hist.length) { container.textContent = 'Nenhuma exportação registrada neste dispositivo.'; return; }
    hist.slice(0, 10).forEach(h => {
        const row = document.createElement('div');
        row.className = 'py-2 border-b text-sm text-gray-700';
        row.textContent = `${h.data} · ${h.formato} · ${h.total} cidadãos${h.parcial ? ' · com ressalvas' : ''}`;
        container.appendChild(row);
    });
}
