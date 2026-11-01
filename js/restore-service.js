import { validateBackup, databasePayload, decodeImage, DATA_TABLES } from './backup-format.js';

export async function previewRestore(client, backup) {
    const review = await validateBackup(backup);
    const { data, error } = await client.rpc('restaurar_aplicacao_v1', { p_backup: databasePayload(backup), p_validar_apenas: true });
    if (error || !data?.valid || !data.expected_state) throw new Error(error?.message || 'O banco não validou este arquivo.');
    return { ...review, ...data };
}

export async function restoreBackup(client, backup, preview, userId, confirmation, onProgress = () => {}, onOperation = () => {}) {
    if (confirmation !== 'RESTAURAR' || !preview?.expected_state || !userId) throw new Error('Confira o arquivo e digite RESTAURAR.');
    await validateBackup(backup); // O arquivo não pode mudar entre conferência e envio.
    const operation = crypto.randomUUID();
    const payload = structuredClone(databasePayload(backup));
    const remap = new Map();
    for (let i=0; i<backup.files.length; i++) {
        const file = backup.files[i], { bytes, type } = decodeImage(file);
        const extension = { 'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp' }[type];
        const path = `${userId}/restauracoes/${operation}/${i}.${extension}`;
        onProgress(`Preparando foto ${i+1} de ${backup.files.length}...`);
        // Novos caminhos: fotos anteriores nunca são substituídas ou apagadas.
        const { error } = await client.storage.from('fotos-cidadaos').upload(path, new Blob([bytes], { type }), { contentType: type, upsert: false });
        if (error) throw new Error('Falha ao preparar fotos. O banco não foi alterado. '+error.message);
        remap.set(file.source_url, 'storage://fotos-cidadaos/'+path);
    }
    for (const citizen of payload.cidadaos) if (remap.has(citizen.photourl)) citizen.photourl = remap.get(citizen.photourl);
    onOperation(operation);
    onProgress('Restaurando registros e criando a cópia de recuperação...');
    let response;
    try {
        response = await client.rpc('restaurar_aplicacao_v1', {
            p_backup: payload, p_validar_apenas: false, p_confirmacao: confirmation,
            p_expected_state: preview.expected_state, p_operation_id: operation, p_actor: userId
        });
    } catch (error) { response = { error }; }
    if (response.error || !response.data?.restored) {
        // Uma falha de rede pode ocorrer depois do COMMIT. Não apagar fotos nem repetir a operação.
        let receipt;
        try { receipt = await client.rpc('resultado_restauracao_v1', { p_id: operation }); } catch { receipt = null; }
        if (receipt?.data?.restored) return receipt.data;
        const error = new Error(response.error?.message || 'Não foi possível confirmar o resultado.');
        if (!response.error?.code || receipt?.error) error.pendingOperation = operation;
        throw error;
    }
    return response.data;
}

export function tableLabels() {
    return Object.fromEntries(DATA_TABLES.map((table, i)=>[table,['Cidadãos','Demandas','Notas','Veículos','Combustível'][i]]));
}
