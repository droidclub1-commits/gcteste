import test from 'node:test';import assert from 'node:assert/strict';import {parseImportCSV,CSV_MODEL} from '../js/import-format.js';
test('CSV aceita BOM, delimitadores, aspas e quebras internas sem converter CPF para número',()=>{
 const rows=parseImportCSV('\uFEFFnome;cpf;municipio\r\n"Maria; Silva";01234567890;"São\nPaulo"\r\n');assert.equal(rows[0].name,'Maria; Silva');assert.equal(rows[0].cpf,'01234567890');assert.equal(rows[0].cidade,'São\nPaulo');
 assert.equal(parseImportCSV('nome,email\n"Ana ""A""",ana@example.test')[0].name,'Ana "A"');assert(CSV_MODEL.startsWith('nome;'));
});
test('CSV recusa colunas inesperadas, repetidas, linhas quebradas e limites',()=>{
 for(const csv of ['nome;id\nAna;1','nome;nome\nAna;Bia','nome;cpf\nAna','nome\n"Ana','nome\n"Ana"abc','cpf\n123','nome\n', 'nome\n'+Array(501).fill('Ana').join('\n')])assert.throws(()=>parseImportCSV(csv));
 assert.throws(()=>parseImportCSV('x'.repeat(1048577)),/1 MB/);
});
