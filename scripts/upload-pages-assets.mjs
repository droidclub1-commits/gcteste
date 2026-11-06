import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

export async function uploadPagesAssets(directory, token) {
    if (!token) throw new Error('Token de upload do Pages ausente.');
    const root = path.resolve(directory);
    const manifest = {};
    const assets = new Map();
    async function collect(folder) {
        for (const name of await readdir(folder)) {
            const file = path.join(folder, name);
            const stat = await lstat(file);
            if (stat.isDirectory()) {
                await collect(file);
                continue;
            }
            const route = '/' + path.relative(root, file).split(path.sep).join('/');
            if (route === '/_headers') continue;
            const contentType = types[path.extname(name)];
            if (!stat.isFile() || !contentType) throw new Error(`Arquivo de publicação inválido: ${route}`);
            const bytes = await readFile(file);
            const key = createHash('sha256').update(contentType).update('\0').update(bytes).digest('hex').slice(0, 32);
            manifest[route] = key;
            assets.set(key, { key, value: bytes.toString('base64'), base64: true, metadata: { contentType } });
        }
    }
    await collect(root);
    if (!manifest['/index.html']) throw new Error('O build precisa conter index.html.');

    async function request(endpoint, body) {
        const response = await fetch(`https://api.cloudflare.com/client/v4/pages/assets/${endpoint}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000)
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(`Pages ${endpoint}: HTTP ${response.status} (${result.errors?.map(error => error.code).join(', ')})`);
        return result.result;
    }

    const hashes = [...assets.keys()];
    const missing = await request('check-missing', { hashes });
    for (let i = 0; i < missing.length; i += 10) {
        await request('upload', missing.slice(i, i + 10).map(key => assets.get(key)));
    }
    await request('upsert-hashes', { hashes });
    return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (!process.argv[2]) throw new Error('Informe a pasta do build para upload.');
    console.log(JSON.stringify(await uploadPagesAssets(process.argv[2], process.env.CF_PAGES_UPLOAD_JWT)));
}

