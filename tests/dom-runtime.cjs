// Adaptador de DOM para executar as verificações de fluxo sem Chromium.
// Não verifica layout, comportamento de popup/download real nem renderização visual.
const { parseHTML } = require('linkedom');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const timer = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => { const handle = timer(fn, ms, ...args); handle.unref(); return handle; };
let pendingDownload;
let blobs = new Map(); let seq = 0;
const chromium = { async launch() { return { async close() {}, async newPage() {
    const { window } = parseHTML(fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    global.window = window; global.document = window.document;
    const storage = new Map();
    global.localStorage = window.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
    Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this.__value ?? this.querySelector('option')?.getAttribute('value') ?? ''; }, set(v) { this.__value = String(v); } });
    for (const select of document.querySelectorAll('select')) {
        let value = select.querySelector('option[selected]')?.getAttribute('value') ?? select.querySelector('option')?.getAttribute('value') ?? '';
        Object.defineProperty(select, 'value', { configurable: true, get: () => value, set: v => { value = String(v); } });
    }
    for (const el of document.querySelectorAll('input[type=file]')) el.files = [];
    for (const form of document.querySelectorAll('form')) form.reset = () => {
        for (const input of form.querySelectorAll('input, textarea')) { input.value = input.getAttribute('value') || ''; input.checked = input.hasAttribute('checked'); }
        for (const select of form.querySelectorAll('select')) select.value = select.querySelector('option')?.getAttribute('value') || '';
    };
    URL.createObjectURL = blob => { const key = 'blob:mock-' + (++seq); blobs.set(key, blob); return key; };
    URL.revokeObjectURL = key => blobs.delete(key);
    window.HTMLAnchorElement.prototype.click = function () {
        const blob = blobs.get(this.href);
        const temp = path.join('/tmp', 'campaign-download-' + seq);
        const saved = blob.arrayBuffer().then(buffer => fs.promises.writeFile(temp, Buffer.from(buffer)));
        pendingDownload?.({ path: async () => { await saved; return temp; } }); pendingDownload = null;
    };
    return {
        on() {}, route: async () => {}, goto: async () => {},
        async evaluate(fn) {
            const code = fn.toString().replace(/import\('([^']+)'\)/g, (_, target) => `import(${JSON.stringify(pathToFileURL(path.join(root, target)).href)})`);
            return new Function('return (' + code + ')()')();
        },
        locator: selector => ({
            textContent: async () => document.querySelector(selector).textContent,
            click: async () => document.querySelector(selector).click(),
            setInputFiles: async file => { const el=document.querySelector(selector); el.files=[{size:file.buffer.length,text:async()=>file.buffer.toString()}];el.dispatchEvent(new window.Event('change')); }
        }),
        waitForEvent: async () => new Promise(resolve => { pendingDownload = resolve; })
    };
} }; } };
module.exports = { chromium };
