import { sb, SUPABASE_URL } from './config.js';
import { state } from './state.js';
import { MAX_BACKUP_BYTES, validateBackup, sealBackup } from './backup-format.js';
import { previewRestore, restoreBackup, tableLabels } from './restore-service.js';
import { collectBackupPhotos, buildBackup } from './backup-core.js';
import { encodeBlob } from './backup.js';

const $ = id => document.getElementById(id);
let candidate = null, preview = null, busy = false, pending = null;
const isAdmin = () => Boolean(state.user?.id && state.userRole === 'admin');
function status(message) { if ($('restore-status')) $('restore-status').textContent = message; }
function setBusy(value) {
    busy = value;
    for (const id of ['restore-file','restore-validate','restore-commit','restore-load-copy','restore-refresh-copies']) {
        if ($(id)) $(id).disabled = value || Boolean(pending) || (id==='restore-commit' && (!candidate || !preview));
    }
}
function clearReview() {
    candidate = preview = null;
    $('restore-review')?.classList.add('hidden');
    if ($('restore-confirm')) $('restore-confirm').value = '';
    if ($('restore-ack')) $('restore-ack').checked = false;
    if ($('restore-commit')) $('restore-commit').disabled = true;
}
export function resetRestoreUI() {
    clearReview(); pending = null;
    if ($('restore-file')) $('restore-file').value = '';
    if ($('restore-copies')) $('restore-copies').replaceChildren();
    $('restore-check-operation')?.classList.add('hidden');
    try {
        const saved=JSON.parse(sessionStorage.getItem('restore-pending')||'null');
        if (saved?.user===state.user?.id) { pending=saved.id; $('restore-check-operation')?.classList.remove('hidden'); }
    } catch {}
    status(pending ? 'Existe uma operação pendente. Verifique o resultado antes de continuar.' : 'Selecione um backup para conferir.');
}
async function reviewBackup(backup) {
    const result = await previewRestore(sb, backup);
    if (!isAdmin()) throw new Error('Sessão administrativa encerrada.');
    candidate = structuredClone(backup); preview = result;
    const tbody = $('restore-counts'); tbody.textContent = '';
    for (const [table, label] of Object.entries(tableLabels())) {
        const row = document.createElement('tr');
        for (const value of [label,result.current_counts?.[table] ?? '—',result.counts[table]]) {
            const cell = document.createElement('td'); cell.className='border px-3 py-2'; cell.textContent=String(value); row.appendChild(cell);
        }
        tbody.appendChild(row);
    }
    $('restore-warnings').textContent = result.warnings.join(' ');
    $('restore-review').classList.remove('hidden');
    status(`Arquivo validado: ${result.photos} foto(s). Confira as quantidades e confirme a substituição.`);
}
export async function refreshSafetyCopies() {
    if (!isAdmin()) return;
    const { data, error } = await sb.rpc('copias_recuperacao_v1');
    if (!isAdmin()) return;
    const select = $('restore-copies'); if (!select) return;
    select.textContent = '';
    const option = document.createElement('option'); option.value=''; option.textContent='Selecione uma cópia anterior'; select.appendChild(option);
    if (error) { status('Não foi possível listar cópias de recuperação. '+error.message); return; }
    for (const point of data || []) {
        const option = document.createElement('option'); option.value=point.id;
        option.textContent=new Date(point.created_at).toLocaleString('pt-BR'); select.appendChild(option);
    }
}
export function setupRestoreUI() {
    const button = $('restore-validate');
    if (!button || button._restoreReady) return;
    button._restoreReady = true;
    $('restore-file').addEventListener('change',()=>{ if (!busy) clearReview(); });
    button.addEventListener('click',async()=>{
        if (!isAdmin() || busy || pending) return;
        clearReview(); setBusy(true);
        try {
            const file = $('restore-file').files[0];
            if (!file || file.size > MAX_BACKUP_BYTES) throw new Error('Selecione um JSON de até 160 MB.');
            status('Conferindo o arquivo e os vínculos...');
            const backup = JSON.parse(await file.text());
            await reviewBackup(backup);
        } catch (error) { clearReview(); status('Conferência interrompida: '+error.message); }
        finally { setBusy(false); }
    });
    $('restore-commit').addEventListener('click',async()=>{
        if (!isAdmin() || busy || pending || !candidate || !preview) return;
        if ($('restore-confirm').value !== 'RESTAURAR' || !$('restore-ack').checked) {
            status('Marque a confirmação e digite RESTAURAR exatamente.'); return;
        }
        setBusy(true);
        try {
            const result = await restoreBackup(sb,candidate,preview,state.user.id,'RESTAURAR',status,id=>{
                pending=id; try { sessionStorage.setItem('restore-pending',JSON.stringify({ user:state.user.id,id })); } catch {}
            });
            if (result.restored) finishRestore();
        } catch(error) {
            if (error.pendingOperation) {
                pending=error.pendingOperation; $('restore-check-operation').classList.remove('hidden');
                status('O resultado não foi confirmado. Não inicie outra restauração: use Verificar operação.');
            } else {
                pending=null; try { sessionStorage.removeItem('restore-pending'); } catch {}
                clearReview(); status('Restauração recusada; valide novamente antes de tentar. '+error.message);
            }
        } finally { setBusy(false); }
    });
    $('restore-refresh-copies').addEventListener('click',()=>{ if (!busy) refreshSafetyCopies().catch(e=>status(e.message)); });
    $('restore-load-copy').addEventListener('click',async()=>{
        if (!isAdmin() || busy || pending || !$('restore-copies').value) return;
        clearReview(); setBusy(true);
        try {
            const { data, error } = await sb.rpc('copias_recuperacao_v1',{ p_id:$('restore-copies').value });
            if (error) throw error;
            const photos=await collectBackupPhotos(sb,data.cidadaos,SUPABASE_URL,encodeBlob,status);
            const backup=buildBackup(data,photos,new Date().toISOString());
            backup.schema_version=3; backup.manifest.consistent_snapshot=true;
            await reviewBackup(await sealBackup(backup));
        } catch(error) { clearReview(); status('Não foi possível carregar a cópia. '+error.message); }
        finally { setBusy(false); }
    });
    $('restore-check-operation').addEventListener('click',async()=>{
        if (!isAdmin() || !pending || busy) return;
        const { data,error }=await sb.rpc('resultado_restauracao_v1',{p_id:pending});
        if (!error && data?.restored) finishRestore();
        else status('Ainda não há confirmação de conclusão. Preserve esta aba e a identificação da operação: '+pending);
    });
    try {
        const saved=JSON.parse(sessionStorage.getItem('restore-pending')||'null');
        if (saved?.user===state.user?.id) { pending=saved.id; $('restore-check-operation').classList.remove('hidden'); }
    } catch {}
}
function finishRestore() {
    pending=null; try { sessionStorage.removeItem('restore-pending'); } catch {}
    clearReview(); status('Restauração concluída. Cópia anterior preservada. Recarregando o sistema...');
    setTimeout(()=>window.location.reload(),1800);
}
