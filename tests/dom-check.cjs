// Executa os fluxos do formulário, indicadores e exportações em DOM simulado.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = path.join(__dirname, 'browser-check.cjs');
const source = fs.readFileSync(filename, 'utf8')
    .replace("require('playwright')", "require('./dom-runtime.cjs')")
    .replace('no navegador.', 'no DOM simulado.');
const runner = new Module(filename, module);
runner.filename = filename; runner.paths = module.paths;
runner._compile(source, filename);
