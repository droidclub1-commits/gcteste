// Requer Playwright instalado no ambiente. Não acessa o Supabase real.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, pathname === '/tests/harness.html' ? 'index.html' : pathname === '/tests/public-harness.html' ? 'cadastro-publico.html' : pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
        let content = fs.readFileSync(file);
        if (pathname === '/tests/harness.html' || pathname === '/tests/public-harness.html') content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
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
                        eq(key, value) { filters.push(row => key.split('.').reduce((a,k)=>a?.[k],row) === value); return q; },
                        is(key, value) { filters.push(row => (row[key] ?? null) === value); return q; },
                        not(key, op, value) { filters.push(row => op === 'is' ? row[key] != null : row[key] !== value); return q; },
                        gt(key, value) { filters.push(row => row[key] > value); return q; },
                        lte(key, value) { filters.push(row => row[key] <= value); return q; },
                        ilike(key,value) { const needle=String(value).replace(/%/g,'').toLowerCase(); filters.push(row=>String(key.split('.').reduce((a,k)=>a?.[k],row) ?? '').toLowerCase().includes(needle));return q; },
                        lt(key,value) {filters.push(row=>row[key]!=null && row[key]<value);return q;},
                        gte(key,value) {filters.push(row=>row[key]!=null && row[key]>=value);return q;},
                        neq(key,value) {filters.push(row=>row[key]!==value);return q;},
                        or() { return q; },
                        order(key, options = {}) { sorts.push([key, options.ascending !== false]); return q; },
                        limit(n) { max = n; return q; },
                        range(a, b) { start = a; end = b; return q; },
                        single() { single = true; return q; },
                        insert() { window.__mutations++; throw new Error('Mutação direta inesperada'); },
                        update() { window.__mutations++; throw new Error('Mutação direta inesperada'); },
                        delete() { window.__mutations++; throw new Error('Mutação direta inesperada'); },
                        then(resolve, reject) {
                            if (window.__failTable === table) return Promise.resolve({ error: { message: 'simulated read failure' } }).then(resolve, reject);
                            const rows = window.__db[table].map(row=>table==='demandas'?{...row,cidadao:window.__db.cidadaos.find(c=>c.id===row.cidadao_id)||row.cidadao}:row).filter(row => filters.every(f => f(row))).slice();
                            rows.sort((a, b) => {
                                for (const [key, asc] of sorts) { const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (cmp) return asc ? cmp : -cmp; }
                                return 0;
                            });
                            const data = rows.slice(start, Math.min(end + 1, start + 300, max));
                            return Promise.resolve({ data: single ? data[0] : data, count: rows.length, error: null }).then(resolve, reject);
                        }
                    }; return q;
                },
                async rpc(name, args) {
                    window.__rpcCalls.push({ name, args });
                    if (name === 'salvar_demanda_v1') {
                        const old=window.__db.demandas.find(d=>d.id===args.p_id);
                        if (args.p_id && !old) return {error:{message:'Não encontrada'}};
                        if (args.p_expected_updated_at && old.updated_at!==args.p_expected_updated_at) return {error:{code:'40001',message:'A demanda foi alterada'}};
                        const row={status:'pending',prioridade:'normal',user_id:window.__state.user.id,...old,...args.p_data,id:old?.id || crypto.randomUUID(),updated_at:new Date(Date.now()+(window.__demClock=(window.__demClock||0)+1)*1000).toISOString()};
                        if(old)window.__db.demandas=window.__db.demandas.map(d=>d.id===row.id?row:d);else window.__db.demandas.push(row);
                        return {data:row};
                    }
                    if (name === 'exportar_aplicacao_v1') {
                        if (window.__failTable) return { error: { message: 'simulated read failure' } };
                        return { data: structuredClone(Object.fromEntries(['cidadaos','demandas','notes','veiculos','cotas_combustivel'].map(k=>[k,window.__db[k]]))) };
                    }
                    if (name === 'restaurar_aplicacao_v1') return args.p_validar_apenas
                        ? { data: { valid:true, counts:Object.fromEntries(Object.entries(args.p_backup).map(([k,v])=>[k,v.length])), current_counts:{cidadaos:1205},expected_state:'test-state' } }
                        : { data: {restored:true} };
                    if (name === 'copias_recuperacao_v1') return {data:[]};
                    return { data: args?.p_id || 'new-citizen', error: window.__rpcError || null };
                }
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

        const demand = await page.evaluate(async()=>{
            const mod=await import('/js/demandas.js');window.__dem=mod;
            const citizen=window.__db.cidadaos[0];window.__state.allCidadaos=[citizen];
            await mod.openDemandaModal(citizen.id);
            document.getElementById('demanda-title').value='Acompanhamento de teste';
            document.getElementById('demanda-responsavel').value='Ana';
            document.getElementById('demanda-prazo').value='2000-01-01';
            document.getElementById('demanda-prioridade').value='urgente';
            await mod.handleDemandaFormSubmit({preventDefault(){}});
            const created=window.__db.demandas.find(d=>d.title==='Acompanhamento de teste');
            await mod.openDemandaModal(null,created.id);
            document.getElementById('demanda-edit-status').value='completed';
            document.getElementById('demanda-responsavel').value='Bruna <img src=x onerror=alert(1)>';
            await mod.handleDemandaFormSubmit({preventDefault(){}});
            const edited=window.__db.demandas.find(d=>d.id===created.id);
            await mod.openDemandaDetailsModal(edited.id);
            return{created,edited,tracking:document.getElementById('details-demanda-tracking').textContent,injected:document.querySelectorAll('#details-demanda-tracking img').length};
        });
        assert.equal(demand.created.prioridade,'urgente');assert.equal(demand.created.responsavel,'Ana');
        assert.equal(demand.edited.prazo,'2000-01-01');assert.equal(demand.edited.status,'completed');assert.equal(demand.edited.prioridade,'urgente');
        assert.match(demand.tracking,/Bruna/);assert.doesNotMatch(demand.tracking,/Em atraso/);assert.equal(demand.injected,0);
        const filtered=await page.evaluate(async()=>{
            document.getElementById('demanda-filter-responsavel').value='Bruna';
            document.getElementById('demanda-filter-prioridade').value='urgente';
            await window.__dem.loadDemandasPage(true);
            const matching=window.__state.allDemandas.length;
            document.getElementById('demanda-filter-prazo').value='atrasadas';
            await window.__dem.loadDemandasPage(true);
            const overdue=window.__state.allDemandas.length;
            await window.__dem.clearDemandaFilters();
            return{matching,overdue};
        });
        assert.equal(filtered.matching,1);assert.equal(filtered.overdue,0);
        console.log('PASS: demandas criam/editam responsável, prazo e prioridade; filtros funcionam e concluídas não ficam em atraso.');

        // Exportação JSON completa sem dados reais e sem acessar servidores externos.
        await page.evaluate(() => {
            window.__db.profiles = [{ id: 'u1', role: 'admin' }];
            window.__db.cidadaos.forEach((c,i)=>{c.id='00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');});
            const owner=window.__db.cidadaos[0].id;
            window.__db.veiculos.forEach(v=>{v.id=crypto.randomUUID();v.cidadao_id=owner;});
            window.__db.cotas_combustivel.forEach(c=>{c.id=crypto.randomUUID();c.cidadao_id=owner;});
            window.__db.demandas.forEach(d=>{d.id=crypto.randomUUID();d.cidadao_id=owner;});
        });
        const backupDownload = page.waitForEvent('download');
        await page.evaluate(async () => { const { backupData } = await import('/js/backup.js'); await backupData('json'); });
        const backupFile = await backupDownload;
        const payload = JSON.parse(fs.readFileSync(await backupFile.path(), 'utf8'));
        assert.equal(payload.cidadaos.length, 1205); assert.equal(payload.cotas_combustivel.length, 1205);
        assert.equal(payload.veiculos.length, 1); assert.equal(payload.schema_version, 3); assert.equal(payload.manifest.consistent_snapshot, true);
        console.log('PASS: botão JSON exporta todos os módulos paginados.');
        await page.evaluate(async()=>{const ui=await import('/js/restore.js');ui.setupRestoreUI();});
        await page.locator('#restore-file').setInputFiles({ name:'backup.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(payload)) });
        await page.locator('#restore-validate').click();
        // Aguarda a conferência assíncrona do checksum e a prévia.
        for(let i=0;i<50;i++) {
            if (await page.evaluate(()=>!document.getElementById('restore-review').classList.contains('hidden'))) break;
            await new Promise(resolve=>require('node:timers').setTimeout(resolve,20));
        }
        assert.equal(await page.evaluate(()=>document.querySelectorAll('#restore-counts tr').length),5);
        await page.locator('#restore-commit').click();
        assert.match(await page.locator('#restore-status').textContent(),/Marque a confirmação/);
        console.log('PASS: arquivo conferido mostra cinco módulos; restauração exige confirmação explícita.');
        await page.evaluate(()=>{
            const timeout=window.setTimeout;
            window.setTimeout=(fn,ms,...args)=>ms===1800?0:timeout(fn,ms,...args);
            document.getElementById('restore-confirm').value='RESTAURAR';
            document.getElementById('restore-ack').checked=true;
        });
        await page.locator('#restore-commit').click();
        for(let i=0;i<50;i++) {
            if ((await page.locator('#restore-status').textContent()).includes('Restauração concluída')) break;
            await new Promise(resolve=>require('node:timers').setTimeout(resolve,20));
        }
        assert.match(await page.locator('#restore-status').textContent(),/Restauração concluída/);
        assert.equal(await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='restaurar_aplicacao_v1' && c.args.p_validar_apenas===false).length),1);
        console.log('PASS: confirmação envia uma única restauração e apresenta a conclusão.');


        const failedBackup = await page.evaluate(async () => {
            window.__failTable = 'veiculos';
            const { backupData } = await import('/js/backup.js');
            const result = await backupData('json'); window.__failTable = '';
            return { result, status: document.getElementById('backup-status').textContent };
        });
        assert.equal(failedBackup.result, false); assert.match(failedBackup.status, /Nenhum arquivo parcial/);
        console.log('PASS: falha num módulo interrompe o backup com aviso explícito.');

        const restricted = await page.evaluate(async () => {
            const access = await import('/js/fuel-access.js');
            window.__state.userRole = 'cadastrador'; access.applyFuelAccessUI();
            const before = window.__rpcCalls.length;
            await window.__cotas.openCotaHistoryModal({ id: 'c1', name: 'Negado' });
            window.__cotas.openCotaModal();
            await window.__cotas.loadCotasPage();
            await window.__cotas.generateCotasPorLiderancaExcel();
            const vehicles = await import('/js/veiculos.js');
            await vehicles.loadVeiculosPage();
            return {
                menuHidden: document.querySelector('[data-fuel-admin] a[href="#cotas"]').parentElement.classList.contains('hidden'),
                historyHidden: document.getElementById('cota-history-modal').classList.contains('hidden'),
                modalHidden: document.getElementById('cota-modal').classList.contains('hidden'),
                historyRows: document.querySelectorAll('#cota-history-list tbody tr').length,
                fuelButtons: [...document.querySelectorAll('#veiculos-tbody button')].filter(b => b.textContent === 'Ver abastecimento').length,
                rpcCalls: window.__rpcCalls.length - before
            };
        });
        assert.equal(restricted.menuHidden,true); assert.equal(restricted.historyHidden,true);
        assert.equal(restricted.modalHidden,true); assert.equal(restricted.historyRows,0);
        assert.equal(restricted.fuelButtons,0); assert.equal(restricted.rpcCalls,0);
        console.log('PASS: cadastrador não acessa menu, histórico, formulário ou relatório de combustível.');
        await page.evaluate(async () => {
            window.__state.userRole = 'admin';
            const access = await import('/js/fuel-access.js'); access.applyFuelAccessUI();
        });
        assert.equal(await page.evaluate(() => document.querySelector('[data-fuel-admin] a[href="#cotas"]').parentElement.classList.contains('hidden')),false);
        console.log('PASS: administrador mantém o acesso ao combustível.');
        const photo = await page.evaluate(async()=>{
            let requested;
            window.__client.storage={from:()=>({createSignedUrl:async(path)=>{requested=path;return{data:{signedUrl:'https://example.test/signed-image'}};}})};
            const {resolvePhotoUrl,renderCitizenPhoto}=await import('/js/photos.js');
            const signed=await resolvePhotoUrl('storage://fotos-cidadaos/owner/foto.png');
            const node=document.createElement('div');document.body.appendChild(node);
            renderCitizenPhoto(node,'javascript:alert(1)','<img onerror=alert(1)>');
            await Promise.resolve();await Promise.resolve();
            return{signed,requested,images:node.querySelectorAll('img').length};
        });
        assert.equal(photo.requested,'owner/foto.png');assert.equal(photo.signed,'https://example.test/signed-image');assert.equal(photo.images,0);
        console.log('PASS: fotos internas usam URL assinada; conteúdo inválido não injeta imagem ou código.');
        const audit=await page.evaluate(async()=>{
            const {setupAuditUI,loadAudit,applyAuditAccessUI}=await import('/js/audit.js');
            setupAuditUI();applyAuditAccessUI();
            const original=window.__client.rpc;let calls=0;
            window.__client.rpc=async(name,args)=>{calls++;return {data:name==='auditoria_detalhe_v1'?{record_id:'record',actor_label:'Admin',action:'UPDATE',changed_fields:['name'],before_data:{name:'Anterior'},after_data:{name:'<img src=x onerror=alert(1)>'}}:{events:[{id:args.p_after_id?'2':'1',occurred_at:'2026-11-01T12:00:00Z',table_name:'cidadaos',record_label:'<img src=x onerror=alert(1)>',action:'UPDATE',actor_label:'Admin',origin:'aplicacao'}],has_more:!args.p_after_id,next_cursor:{time:'2026-11-01T12:00:00Z',id:'1'}}};};
            await loadAudit();document.querySelector('#audit-list button').click();await Promise.resolve();await Promise.resolve();
            const safe=document.querySelectorAll('#audit-list img,#audit-detail img').length===0;
            const detail=document.getElementById('audit-detail-content').textContent;
            await loadAudit(true);const count=document.getElementById('audit-list').children.length;
            window.__state.userRole='cadastrador';applyAuditAccessUI();const prior=calls;await loadAudit();
            const blocked=calls===prior&&document.getElementById('audit-list').children.length===0;
            window.__state.userRole='admin';applyAuditAccessUI();window.__client.rpc=original;
            return{safe,detail,count,blocked};
        });
        assert.equal(audit.safe,true);assert(audit.detail.includes('<img'));assert.equal(audit.count,2);assert.equal(audit.blocked,true);
        console.log('PASS: histórico do administrador, paginação, comparação segura e bloqueio de cadastrador.');
        const entry=await page.evaluate(async()=>{
            const {setupEntryUI,applyEntryAccessUI,resetEntryUI}=await import('/js/cadastro-entry.js');let saved=0,calls=[];
            setupEntryUI(async()=>{saved++;});applyEntryAccessUI();const original=window.__client.rpc;
            window.__entryCalls=calls;
            window.__client.rpc=async(name,args)=>{calls.push({name,args});if(name==='conferir_cadastro_v1')return{data:{expected_state:'snapshot',rows:args.p_rows.map((r,i)=>({line:i+1,data:r,status:r.name==='Bloqueado'?'existing':r.name==='Possível'?'review':'ready',matches:r.name==='Possível'?[{name:'<img src=x onerror=alert(1)>',id:'match'}]:[],match_count:r.name==='Possível'?1:0,peers:[]}))}};
            if(!window.__entryLost){window.__entryLost=true;return{error:{message:'network'}};}return{data:{inserted:args.p_selected.length}};};
            document.getElementById('quick-citizen-btn').click();document.getElementById('entry-name').value='Cadastro rápido';
            document.getElementById('entry-quick').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve();
            const noAutoSelection=document.querySelector('[data-entry-select]').checked!==true;
            document.getElementById('entry-select-ready').click();document.getElementById('entry-confirm').click();await Promise.resolve();await Promise.resolve();
            const retryLabel=document.getElementById('entry-confirm').textContent;
            document.getElementById('entry-confirm').click();await Promise.resolve();await Promise.resolve();await Promise.resolve();
            const commits=calls.filter(x=>x.name==='confirmar_cadastro_v1');const same=commits.length===2&&commits[0].args.p_operation===commits[1].args.p_operation;
            window.__entrySaved=()=>saved;
            return{noAutoSelection,retryLabel,same,saved,status:document.getElementById('entry-status').textContent};
        });
        assert(entry.noAutoSelection);assert(entry.retryLabel.includes('Tentar'));assert(entry.same);assert.equal(entry.saved,1);assert(entry.status.includes('Concluído'));
        await page.evaluate(()=>document.getElementById('import-citizens-btn').click());
        await page.locator('#entry-file').setInputFiles({name:'cidadaos.csv',mimeType:'text/csv',buffer:Buffer.from('nome;cpf\nBloqueado;52998224725\nPossível;\nNovo;')});
        await page.evaluate(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('[data-entry-select]').length===3)return;await new Promise(r=>setTimeout(r,10));}throw new Error('CSV preview did not load');});
        const reviewed=await page.evaluate(async()=>{
            const invalid=document.querySelector('[data-entry-select="1"]').disabled;
            const safe=document.querySelectorAll('#entry-rows img').length===0;
            document.querySelector('[data-entry-select="2"]').checked=true;document.getElementById('entry-confirm').click();await Promise.resolve();
            const blocked=document.getElementById('entry-status').textContent.includes('Confirme a revisão');
            document.querySelector('[data-entry-ack="2"]').checked=true;document.getElementById('entry-confirm').click();await Promise.resolve();await Promise.resolve();await Promise.resolve();
            const last=window.__entryCalls.filter(c=>c.name==='confirmar_cadastro_v1').at(-1);
            const mod=await import('/js/cadastro-entry.js');mod.resetEntryUI();window.__state.userRole='cadastrador';mod.applyEntryAccessUI();
            document.getElementById('import-citizens-btn').click();const denied=document.getElementById('entry-modal').classList.contains('hidden');
            window.__state.userRole='admin';mod.applyEntryAccessUI();
            return{invalid,safe,blocked,ack:last.args.p_ack,selected:last.args.p_selected,denied};
        });
        assert(reviewed.invalid);assert(reviewed.safe);assert(reviewed.blocked);assert.deepEqual(reviewed.ack,[2]);assert.deepEqual(reviewed.selected,[2]);assert(reviewed.denied);
        console.log('PASS: cadastro rápido, CSV revisado, bloqueios, confirmação explícita e repetição com mesmo identificador.');
        const campaign=await page.evaluate(async()=>{
            const model=await import('/js/campaign-model.js');const ui=await import('/js/campaign-settings.js');
            const originalFrom=window.__client.from,originalRpc=window.__client.rpc;
            window.__campaign={...structuredClone(model.DEFAULT_CAMPAIGN),revision:1};
            window.__client.from=table=>table==='campanha_config'?{select(){return this;},eq(){return this;},async single(){return{data:structuredClone(window.__campaign)};}}:originalFrom(table);
            let writes=0;window.__client.rpc=async(name,args)=>{if(name!=='salvar_configuracao_campanha_v1')return originalRpc(name,args);writes++;if(args.p_revision!==window.__campaign.revision)return{error:{code:'40001',message:'Alterada por outra sessão'}};window.__campaign={...args.p_data,revision:args.p_revision+1};return{data:structuredClone(window.__campaign)};};
            ui.setupCampaignUI();ui.applyCampaignAccessUI();await ui.openCampaignSettings();
            document.getElementById('campaign-app_name').value='<img src=x onerror=alert(1)>';
            document.getElementById('campaign-city').value='Belém';document.getElementById('campaign-uf').value='PA';document.getElementById('campaign-municipalities').value='Belém\nAnanindeua';document.getElementById('campaign-theme').value='green';
            document.getElementById('campaign-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve();
            const safe=document.querySelector('[data-campaign-app]').textContent.includes('<img')&&document.querySelectorAll('[data-campaign-app] img').length===0;
            const options=[...document.querySelectorAll('#cidadao-cidade option')].map(o=>o.value);
            const city=document.getElementById('cidadao-cidade');model.setCityValue(city,'Macapá');model.applyCampaignDOM();const preserved=city.value==='Macapá';
            model.setKnownCities(['Santana']);const historical=[...document.querySelectorAll('#filter-cidade option')].some(o=>o.value==='Santana');
            window.__campaign.revision++;
            document.getElementById('campaign-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve();
            const stale=document.getElementById('campaign-status').textContent.includes('outra sessão');
            window.__state.userRole='cadastrador';ui.applyCampaignAccessUI();await ui.openCampaignSettings();document.getElementById('campaign-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();
            const blocked=writes===2&&document.querySelector('[data-campaign-admin]').classList.contains('hidden');
            window.__state.userRole='admin';ui.resetCampaignUI();ui.applyCampaignAccessUI();model.setCampaign(model.DEFAULT_CAMPAIGN);model.applyCampaignDOM();window.__client.from=originalFrom;window.__client.rpc=originalRpc;
            return{safe,options,preserved,historical,stale,blocked};
        });
        assert(campaign.safe);assert(campaign.options.includes('Belém'));assert(campaign.preserved);assert(campaign.historical);assert(campaign.stale);assert(campaign.blocked);
        console.log('PASS: configuração por admin, concorrência, identificação segura e municípios atuais/anteriores preservados.');
        if(typeof page.waitForFunction==='function'){
            const publicPage=await browser.newPage();const publicErrors=[];publicPage.on('pageerror',e=>publicErrors.push(e.message));
            await publicPage.route('**/*',route=>{
                const url=route.request().url();if(url.startsWith(origin))return route.continue();
                if(url.includes('/rest/v1/campanha_config'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify([{id:1,app_name:'Campanha pública teste',campaign_name:'Município teste',candidate_name:'',election_year:2028,city:'Belém',uf:'PA',municipalities:['Belém','Ananindeua'],map_lat:-1.45,map_lng:-48.49,map_zoom:12,theme:'green',revision:2}])});
                if(url.includes('viacep.com.br'))return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({logradouro:'Rua de teste',bairro:'Centro',localidade:'Cametá',uf:'PA'})});
                return route.abort();
            });
            await publicPage.goto(origin+'/tests/public-harness.html');
            await publicPage.evaluate(async()=>{await import('/cadastro-publico.js');document.dispatchEvent(new window.Event('DOMContentLoaded'));});
            await publicPage.waitForFunction(()=>document.title==='Campanha pública teste'&&!document.getElementById('save-btn-public').disabled);
            const pub=await publicPage.evaluate(()=>({city:document.getElementById('c-cidade').value,uf:document.getElementById('c-estado').value,label:document.querySelector('[data-campaign-label]').textContent}));
            assert.equal(pub.city,'Belém');assert.equal(pub.uf,'PA');assert(pub.label.includes('Município teste'));
            await publicPage.evaluate(()=>{const el=document.getElementById('c-cep');el.value='66000-000';el.dispatchEvent(new window.Event('blur'));});
            await publicPage.waitForFunction(()=>document.getElementById('c-cidade').value==='Cametá');
            assert.equal(await publicPage.locator('#c-estado').inputValue(),'PA');assert.deepEqual(publicErrors,[]);await publicPage.close();
            console.log('PASS: cadastro público carrega a configuração e preserva município/UF de CEP fora da lista.');
        }
        assert.deepEqual(errors, []);
        console.log('PASS: nenhum erro JavaScript não tratado no navegador.');
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
