// Requer Playwright instalado no ambiente. Não acessa o Supabase real.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, pathname === '/tests/harness.html' ? 'index.html' : pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
        let content = fs.readFileSync(file);
        if (pathname === '/tests/harness.html') content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(content);
    } catch { res.writeHead(404); res.end(); }
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ acceptDownloads: true, timezoneId: 'America/Sao_Paulo' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        await page.goto(origin + '/tests/harness.html');
        await page.evaluate(async () => {
            window.__db = { cidadaos: [], demandas: [], veiculos: [], notes: [], cotas_combustivel: [], profiles: [] };
            window.__rpcCalls = [];
            window.__charts = [];
            window.__mutations = 0;
            window.__failTable = '';
            window.__client = {
                from(table) {
                    const filters = [], sorts = [];
                    let start = 0, end = Infinity, single = false, max = Infinity;
                    const q = {
                        select() { return q; },
                        eq(key, value) { filters.push(row => row[key] === value); return q; },
                        is(key, value) { filters.push(row => (row[key] ?? null) === value); return q; },
                        not(key, op, value) { filters.push(row => op === 'is' ? row[key] != null : row[key] !== value); return q; },
                        gt(key, value) { filters.push(row => row[key] > value); return q; },
                        lte(key, value) { filters.push(row => row[key] <= value); return q; },
                        ilike() { return q; }, or() { return q; },
                        order(key, options = {}) { sorts.push([key, options.ascending !== false]); return q; },
                        limit(n) { max = n; return q; },
                        range(a, b) { start = a; end = b; return q; },
                        single() { single = true; return q; },
                        insert() { window.__mutations++; throw new Error('Mutação direta inesperada'); },
                        update() { window.__mutations++; throw new Error('Mutação direta inesperada'); },
                        delete() { window.__mutations++; throw new Error('Mutação direta inesperada'); },
                        then(resolve, reject) {
                            if (window.__failTable === table) return Promise.resolve({ error: { message: 'simulated read failure' } }).then(resolve, reject);
                            const rows = window.__db[table].filter(row => filters.every(f => f(row))).slice();
                            rows.sort((a, b) => {
                                for (const [key, asc] of sorts) { const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (cmp) return asc ? cmp : -cmp; }
                                return 0;
                            });
                            const data = rows.slice(start, Math.min(end + 1, start + 300, max));
                            return Promise.resolve({ data: single ? data[0] : data, count: rows.length, error: null }).then(resolve, reject);
                        }
                    }; return q;
                },
                async rpc(name, args) { window.__rpcCalls.push({ name, args }); return { data: args?.p_id || 'new-citizen', error: window.__rpcError || null }; }
            };
            window.supabase = { createClient: () => window.__client };
            window.Chart = class { constructor(ctx, config) { window.__charts.push({ id: ctx.id, config }); } destroy() {} };
            window.__state = (await import('/js/state.js')).state;
            window.__state.user = { id: 'u1', email: 'admin@example.test' }; window.__state.userRole = 'admin';
            window.__cit = await import('/js/cidadaos.js');
            window.__cit.setupVeiculoToggle();
            await import('/app.js'); // Verifica o grafo completo de imports.
        });
        await page.evaluate(async () => {
            const cid = { id: 'c1', name: 'Pessoa de teste', cidade: 'Macapá', type: 'Eleitor' };
            window.__state.allCidadaos = [cid]; window.__db.cidadaos = [cid];
            window.__db.veiculos = [{ id: 'v1', cidadao_id: 'c1', tipo: 'Carro', placa: 'AAA1B23', modelo: 'Teste', adesivado: true }];
            await window.__cit.openCidadaoModal('c1');
            document.querySelector('.veiculo-modelo').value = 'Modelo alterado';
            await window.__cit.handleCidadaoFormSubmit({ preventDefault() {} });
        });
        const save = await page.evaluate(() => ({ calls: window.__rpcCalls, direct: window.__mutations }));
        assert.equal(save.calls.length, 1);
        assert.equal(save.calls[0].name, 'salvar_cidadao_com_veiculos_v2');
        assert.equal(save.calls[0].args.p_veiculos[0].id, 'v1');
        assert.equal(save.calls[0].args.p_veiculos[0].modelo, 'Modelo alterado');
        assert.equal(save.direct, 0);
        console.log('PASS: formulário preserva ID do veículo e salva somente via RPC.');

        await page.evaluate(async () => {
            window.__failTable = 'veiculos';
            await window.__cit.openCidadaoModal('c1');
            await window.__cit.handleCidadaoFormSubmit({ preventDefault() {} });
            window.__failTable = '';
        });
        assert.equal(await page.evaluate(() => window.__rpcCalls.length), 1);
        console.log('PASS: falha ao carregar veículos impede gravação.');

        const dashboard = await page.evaluate(async () => {
            window.__db.cidadaos = Array.from({ length: 1205 }, (_, n) => ({ id: String(n).padStart(5, '0'), name: 'Pessoa ' + n, dob: n === 1204 ? `2000-${String(new Date().getMonth() + 1).padStart(2, '0')}-01` : null, type: 'Eleitor', cidade: 'Macapá', bairro: 'Centro', sexo: 'Outro' }));
            window.__db.demandas = [{ id: 'd1', title: 'Demanda global', status: 'pending', created_at: '2026-10-01', cidadao: { name: 'Pessoa 1' } }];
            window.__state.allDemandas = []; window.__state.allCidadaos = [];
            await window.__cit.loadCidadaosPage(true); // Contagem cacheada que não será usada pelo dashboard.
            const { updateDashboard } = await import('/js/dashboard.js');
            window.__updateDashboard = updateDashboard;
            await updateDashboard();
            return { total: document.getElementById('dashboard-total-cidadaos').textContent, demandas: document.getElementById('dashboard-total-demandas').textContent, charts: window.__charts.map(c => ({ id: c.id, values: c.config.data.datasets[0].data })), recent: document.getElementById('demandas-recentes-list').textContent, birthdays: document.getElementById('aniversariantes-total').textContent };
        });
        assert.equal(dashboard.total, '1205'); assert.equal(dashboard.demandas, '1');
        assert.equal(dashboard.charts.find(c => c.id === 'cidadaos-por-tipo-chart').values[0], 1205);
        assert.match(dashboard.recent, /Demanda global/); assert.equal(dashboard.birthdays, '1 este mês');
        console.log('PASS: dashboard considera todos os 1.205 registros e não depende do cache de demandas.');

        await page.evaluate(async () => { window.__failTable = 'cidadaos'; await window.__updateDashboard(); window.__failTable = ''; });
        assert.equal(await page.locator('#dashboard-total-cidadaos').textContent(), 'Indisponível');
        console.log('PASS: falha de consulta não aparece como total zero.');

        const history = await page.evaluate(async () => {
            window.__db.cotas_combustivel = Array.from({ length: 1205 }, (_, n) => ({ id: String(n).padStart(5, '0'), cidadao_id: 'c1', data: '2026-10-01', litros: 1, valor: 5, posto: '<img src=x onerror="window.__xss=1">', observacao: '=1+1' }));
            const cotas = await import('/js/cotas.js'); window.__cotas = cotas;
            await cotas.openCotaHistoryModal({ id: 'c1', name: '<svg onload="window.__xss=1">' });
            return { count: document.querySelectorAll('#cota-history-list tbody tr').length, total: document.getElementById('cota-history-total').textContent, injected: document.querySelectorAll('#cota-history-list img').length };
        });
        assert.equal(history.count, 1205); assert.match(history.total, /1205\.0 L/); assert.equal(history.injected, 0);
        const downloadPromise = page.waitForEvent('download');
        await page.evaluate(() => window.__cotas.downloadCotaHistoryCSV());
        const download = await downloadPromise;
        const csv = fs.readFileSync(await download.path(), 'utf8');
        assert.equal(csv.trim().split(/\r?\n/).length, 1206);
        assert.match(csv, /'=1\+1/);
        console.log('PASS: histórico e CSV incluem 1.205 cotas; HTML e fórmulas ficam neutralizados.');

        // Exportação JSON completa sem dados reais e sem acessar servidores externos.
        await page.evaluate(() => { window.__db.profiles = [{ id: 'u1', role: 'admin' }]; });
        const backupDownload = page.waitForEvent('download');
        await page.evaluate(async () => { const { backupData } = await import('/js/backup.js'); await backupData('json'); });
        const backupFile = await backupDownload;
        const payload = JSON.parse(fs.readFileSync(await backupFile.path(), 'utf8'));
        assert.equal(payload.cidadaos.length, 1205); assert.equal(payload.cotas_combustivel.length, 1205);
        assert.equal(payload.veiculos.length, 1); assert.equal(payload.manifest.counts.profiles, 1);
        console.log('PASS: botão JSON exporta todos os módulos paginados.');
        const failedBackup = await page.evaluate(async () => {
            window.__failTable = 'veiculos';
            const { backupData } = await import('/js/backup.js');
            const result = await backupData('json'); window.__failTable = '';
            return { result, status: document.getElementById('backup-status').textContent };
        });
        assert.equal(failedBackup.result, false); assert.match(failedBackup.status, /Nenhum arquivo parcial/);
        console.log('PASS: falha num módulo interrompe o backup com aviso explícito.');

        assert.deepEqual(errors, []);
        console.log('PASS: nenhum erro JavaScript não tratado no navegador.');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
