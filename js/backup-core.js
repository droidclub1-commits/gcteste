import { fetchAllRows } from './data.js';

export const BACKUP_TABLES = ['cidadaos', 'demandas', 'notes', 'veiculos', 'cotas_combustivel', 'profiles'];

export async function collectBackupTables(client, onProgress = () => {}) {
    const tables = {};
    for (const table of BACKUP_TABLES) {
        onProgress(`Exportando ${table}...`);
        tables[table] = await fetchAllRows(() => client.from(table).select('*', { count: 'exact' }).order('id'));
    }
    return tables;
}

export function photoStoragePath(rawUrl, projectUrl) {
    const url = new URL(rawUrl);
    if (url.origin !== new URL(projectUrl).origin) return null;
    const prefix = '/storage/v1/object/public/fotos-cidadaos/';
    if (!url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
}

export async function collectBackupPhotos(client, cidadaos, projectUrl, encodeBlob, onProgress = () => {}) {
    const files = [], external = [];
    const urls = [...new Set(cidadaos.map(c => c.photourl).filter(Boolean))];
    let bytes = 0;
    for (const url of urls) {
        let path;
        try { path = photoStoragePath(url, projectUrl); } catch { path = null; }
        if (!path) { external.push(url); continue; }
        onProgress(`Copiando foto ${files.length + 1} de ${urls.length}...`);
        const { data, error } = await client.storage.from('fotos-cidadaos').download(path);
        if (error || !data) throw new Error('Não foi possível copiar a foto: ' + path);
        bytes += data.size;
        // JSON+base64 em memória não é indicado para um acervo maior.
        if (bytes > 100 * 1024 * 1024) throw new Error('As fotos excedem 100 MB. Faça o backup do Storage no servidor antes de continuar.');
        files.push({ bucket: 'fotos-cidadaos', path, source_url: url, mime_type: data.type || 'application/octet-stream', size_bytes: data.size, base64: await encodeBlob(data) });
    }
    return { files, external };
}

export function buildBackup(tables, photos, startedAt, finishedAt = new Date().toISOString()) {
    return {
        schema_version: 2,
        application: 'gcteste',
        exportado_em: finishedAt,
        manifest: {
            started_at: startedAt,
            finished_at: finishedAt,
            consistent_snapshot: false,
            scope: 'Dados visíveis ao administrador pelas políticas do banco; fotos referenciadas do bucket fotos-cidadaos.',
            counts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
            files_count: photos.files.length,
            external_photo_urls: photos.external,
            excluded: ['Contas e senhas do Supabase Auth', 'Políticas RLS, funções SQL e configurações do projeto', 'Objetos de Storage não referenciados e imagens externas'],
            note: 'Pause os lançamentos durante a exportação. As tabelas são lidas sequencialmente, sem snapshot transacional.'
        },
        ...tables,
        files: photos.files
    };
}
