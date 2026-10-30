import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRows, applyCidadaoFilters, csvCell } from '../js/data.js';
import { collectBackupTables, collectBackupPhotos, buildBackup, photoStoragePath, BACKUP_TABLES } from '../js/backup-core.js';
import { getFaixaEtaria } from '../js/utils.js';

function queryRecorder() {
    const calls = [];
    const query = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return query; } });
    return { query, calls };
}

test('paginação inclui 2.507 registros mesmo com teto real de 300 por chamada', async () => {
    const source = Array.from({ length: 2507 }, (_, id) => ({ id }));
    const rows = await fetchAllRows(() => ({ range: async start => ({ data: source.slice(start, start + 300), count: source.length, error: null }) }));
    assert.deepEqual(rows, source);
});

test('falha numa página rejeita a exportação inteira', async () => {
    await assert.rejects(fetchAllRows(() => ({ range: async start => start ? { error: new Error('offline') } : { data: [{ id: 1 }], count: 2 } })), /offline/);
});

test('fim prematuro com count informado não é aceito como sucesso', async () => {
    await assert.rejects(fetchAllRows(() => ({ range: async () => ({ data: [], count: 3 }) })), /incompleta/);
});

test('faixa etária usa limite inferior exclusivo e superior inclusivo', () => {
    const { query, calls } = queryRecorder();
    applyCidadaoFilters(query, { faixaEtaria: '18-25' }, new Date(2026, 9, 30));
    assert.deepEqual(calls, [['lte', 'dob', '2008-10-30'], ['gt', 'dob', '2000-10-30']]);
});

test('66+ não tem corte arbitrário em 150 anos e N/A filtra nulos', () => {
    const a = queryRecorder(); applyCidadaoFilters(a.query, { faixaEtaria: '66+' }, new Date(2026, 9, 30));
    assert.deepEqual(a.calls, [['lte', 'dob', '1960-10-30']]);
    const b = queryRecorder(); applyCidadaoFilters(b.query, { faixaEtaria: 'N/A' });
    assert.deepEqual(b.calls, [['is', 'dob', null]]);
});

test('datas de filtro são locais, inclusive no dia bissexto', () => {
    const { query, calls } = queryRecorder();
    applyCidadaoFilters(query, { faixaEtaria: '18-25' }, new Date(2024, 1, 29, 23, 59));
    assert.deepEqual(calls, [['lte', 'dob', '2006-02-28'], ['gt', 'dob', '1998-02-28']]);
});

test('todos os filtros são repassados e pesquisa OR cita caracteres especiais', () => {
    const { query, calls } = queryRecorder();
    applyCidadaoFilters(query, { search: 'A",cpf.eq.x', type: 'Eleitor', bairro: 'Centro', cidade: 'Macapá', leader: 'L', sexo: 'Outro', localTrabalho: 'Escola' });
    assert.equal(calls[0][1], ['name','email','cpf','voterid'].map(k => `${k}.ilike."%A\\",cpf.eq.x%"`).join(','));
    assert.equal(calls.filter(c => c[0] === 'eq').length, 5);
    assert.deepEqual(calls.at(-1), ['ilike', 'localtrabalho', '%Escola%']);
});

test('CSV protege fórmulas, delimitadores, aspas e novas linhas', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('A;B\r\nC'), '"A;B\r\nC"');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(' +123'), "' +123");
});

test('idade do widget respeita data sem conversão para UTC', () => {
    const now = new Date();
    const dob = `${now.getFullYear() - 18}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    assert.equal(getFaixaEtaria(dob), '18-25');
    assert.equal(getFaixaEtaria(null), 'N/A');
});

function mockBackupClient(failingTable) {
    return { from(table) { return { select() { return this; }, order() { return this; }, async range(start) {
        if (table === failingTable) return { error: new Error('sem acesso') };
        return { data: start ? [] : [{ id: table }], count: 1 };
    } }; } };
}

test('backup inclui notas, veículos, combustível e perfis além dos módulos básicos', async () => {
    const tables = await collectBackupTables(mockBackupClient());
    assert.deepEqual(Object.keys(tables), BACKUP_TABLES);
    const backup = buildBackup(tables, { files: [], external: [] }, 'inicio', 'fim');
    assert.equal(backup.manifest.counts.cotas_combustivel, 1);
    assert.equal(backup.notes[0].id, 'notes');
    assert.equal(backup.manifest.consistent_snapshot, false);
    assert.equal(backup.schema_version, 2);
});

test('backup falha se qualquer módulo não puder ser lido', async () => {
    await assert.rejects(collectBackupTables(mockBackupClient('veiculos')), /sem acesso/);
});

test('fotos do Storage são copiadas uma vez; referências externas são declaradas', async () => {
    const project = 'https://example.supabase.co';
    const url = project + '/storage/v1/object/public/fotos-cidadaos/u/foto%20a.png';
    const paths = [];
    const client = { storage: { from(bucket) { assert.equal(bucket, 'fotos-cidadaos'); return { async download(path) { paths.push(path); return { data: new Blob(['foto'], { type: 'image/png' }) }; } }; } } };
    const photos = await collectBackupPhotos(client, [{ photourl: url }, { photourl: url }, { photourl: 'https://externo.test/a.jpg' }], project, async () => 'Zm90bw==');
    assert.deepEqual(paths, ['u/foto a.png']);
    assert.equal(photos.files[0].base64, 'Zm90bw==');
    assert.equal(photos.files[0].size_bytes, 4);
    assert.equal(photos.external.length, 1);
    assert.equal(photoStoragePath('https://outro.test/storage/v1/object/public/fotos-cidadaos/a', project), null);
});

test('foto inacessível impede declarar um JSON concluído', async () => {
    const client = { storage: { from() { return { download: async () => ({ error: new Error('offline') }) }; } } };
    await assert.rejects(collectBackupPhotos(client, [{ photourl: 'https://example.test/storage/v1/object/public/fotos-cidadaos/x' }], 'https://example.test', async () => ''), /copiar a foto/);
});
