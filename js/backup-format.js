// Formato portátil dos dados da aplicação. Auth, perfis e permissões não são importados.
export const DATA_TABLES = ['cidadaos', 'demandas', 'notes', 'veiculos', 'cotas_combustivel'];
export const MAX_BACKUP_BYTES = 160 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
}
export async function digest(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function databasePayload(backup) {
    return Object.fromEntries(DATA_TABLES.map(table => [table, backup[table]]));
}
export function decodeImage(file) {
    if (typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) || file.base64.length % 4) throw new Error('Foto com codificação inválida.');
    const binary = atob(file.base64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (bytes.length !== file.size_bytes || bytes.length > 5 * 1024 * 1024 || !bytes.length) throw new Error('Foto com tamanho inválido ou acima de 5 MB.');
    let type;
    if (bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 && bytes[4]===13 && bytes[5]===10 && bytes[6]===26 && bytes[7]===10) type='image/png';
    else if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) type='image/jpeg';
    else if (binary.startsWith('GIF87a') || binary.startsWith('GIF89a')) type='image/gif';
    else if (binary.startsWith('RIFF') && binary.slice(8,12)==='WEBP') type='image/webp';
    if (!type) throw new Error('Formato de foto não suportado. Use PNG, JPEG, GIF ou WebP.');
    return { bytes, type };
}
export async function sealBackup(backup) {
    backup.manifest.data_sha256 = await digest(canonical(databasePayload(backup)));
    for (const file of backup.files) {
        const { bytes } = decodeImage(file);
        file.sha256 = await digest(bytes);
    }
    return backup;
}
export async function validateBackup(backup) {
    if (!backup || typeof backup !== 'object' || backup.application !== 'gcteste' || ![2,3].includes(backup.schema_version)) throw new Error('Selecione um backup JSON da aplicação, versão 2 ou 3.');
    if (!backup.manifest || !Array.isArray(backup.files)) throw new Error('Manifesto ou fotos ausentes. Backups antigos incompletos não podem substituir a base.');
    const ids = {}, counts = {}, warnings = [];
    for (const table of DATA_TABLES) {
        const rows = backup[table];
        if (!Array.isArray(rows) || rows.length > 50000) throw new Error('Módulo ausente ou acima do limite: ' + table);
        ids[table] = new Set(); counts[table] = rows.length;
        if (backup.manifest.counts?.[table] !== rows.length) throw new Error('Contagem do manifesto divergente: ' + table);
        for (const row of rows) {
            if (!row || typeof row !== 'object' || !UUID.test(row.id) || ids[table].has(row.id)) throw new Error('Identificador inválido ou duplicado em ' + table);
            ids[table].add(row.id);
        }
    }
    for (const row of backup.cidadaos) {
        if (typeof row.name !== 'string' || !row.name.trim()) throw new Error('Cidadão sem nome.');
        if (row.leader && !ids.cidadaos.has(row.leader)) throw new Error('Liderança não encontrada no backup.');
        if (row.photourl && !/^(https?:\/\/|storage:\/\/fotos-cidadaos\/)/i.test(row.photourl)) throw new Error('Referência de foto inválida.');
    }
    for (const table of ['demandas','veiculos','cotas_combustivel']) for (const row of backup[table]) {
        if (!ids.cidadaos.has(row.cidadao_id)) throw new Error('Cidadão não encontrado para ' + table);
    }
    for (const row of backup.notes) if (!ids.demandas.has(row.demanda_id)) throw new Error('Demanda não encontrada para uma nota.');
    const hash = await digest(canonical(databasePayload(backup)));
    if (backup.schema_version === 3 && !backup.manifest.data_sha256) throw new Error('Backup sem código de integridade.');
    if (backup.manifest.data_sha256 && backup.manifest.data_sha256 !== hash) throw new Error('Os dados do backup foram alterados ou corrompidos.');
    if (backup.schema_version === 2) warnings.push('Versão anterior: a conferência cobre estrutura e vínculos; o arquivo original não tinha código de integridade dos dados.');
    const sources = new Set(), referenced = new Set(backup.cidadaos.map(c=>c.photourl).filter(Boolean));
    let total = 0;
    for (const file of backup.files) {
        if (file.bucket !== 'fotos-cidadaos' || typeof file.source_url !== 'string' || !referenced.has(file.source_url) || sources.has(file.source_url)) throw new Error('Referência de foto repetida ou não reconhecida.');
        sources.add(file.source_url);
        const { bytes } = decodeImage(file); total += bytes.length;
        if (total > 100*1024*1024) throw new Error('As fotos excedem 100 MB.');
        if (backup.schema_version===3 && !file.sha256) throw new Error('Foto sem código de integridade.');
        if (file.sha256 && file.sha256 !== await digest(bytes)) throw new Error('Uma foto foi alterada ou corrompida.');
    }
    for (const url of referenced) if (!sources.has(url)) {
        if (url.startsWith('storage://') || /\/storage\/v1\/object\/public\/fotos-cidadaos\//.test(url)) throw new Error('O arquivo não contém uma foto armazenada pelo sistema.');
        warnings.push('Uma imagem externa será mantida somente pelo link e depende do site de origem.');
    }
    if (new TextEncoder().encode(JSON.stringify(databasePayload(backup))).length>30*1024*1024) throw new Error('Os registros excedem 30 MB. Use recuperação no servidor.');
    return { counts, photos: backup.files.length, warnings: [...new Set(warnings)], dataHash: hash };
}
