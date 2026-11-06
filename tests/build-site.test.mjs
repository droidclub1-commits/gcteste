import test from 'node:test';import assert from 'node:assert/strict';
import {readdir,readFile,rm,stat} from 'node:fs/promises';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {buildSite,SITE_FILES,SITE_DIRS} from '../scripts/build-site.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dest=path.join(root,'.test-site-build');
test('publicação contém só a interface, resolve imports e não inclui infraestrutura',async()=>{
 try{await buildSite(dest);const names=(await readdir(dest)).sort();assert.deepEqual(names,[...SITE_FILES,...SITE_DIRS,'404.html','_headers'].sort());
 for(const file of [...(await readdir(path.join(dest,'js'))).map(f=>'js/'+f),'app.js','cadastro-publico.js']){
 const source=await readFile(path.join(dest,file),'utf8');for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([.][^'"]+)['"]/g)){const module=path.resolve(path.dirname(path.join(dest,file)),match[1]);assert(module.startsWith(dest+path.sep));assert((await stat(module)).isFile());}}
 for(const file of ['index.html','cadastro-publico.html','privacidade.html']){const html=await readFile(path.join(dest,file),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"#?:]+)"/g)){if(match[1].includes('://'))continue;assert((await stat(path.join(dest,match[1]))).isFile(),`${file}: ${match[1]}`);}}
 assert((await readFile(path.join(dest,'_headers'),'utf8')).includes('nosniff'));
 }finally{await rm(dest,{recursive:true,force:true});}
});
test('publicação recusa saída que sobrescreveria código',async()=>{await assert.rejects(buildSite(root));await assert.rejects(buildSite(path.join(root,'js')));});
test('build por cliente configura o painel e o cadastro público para o mesmo projeto', async () => {
 const ref='abcdefghijklmnopqrst';
 const url=`https://${ref}.supabase.co`;
 const keyFor=role=>`e30.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.signature`;
 try {
  await assert.rejects(buildSite(dest,{url,key:keyFor('service_role')}),/chave pública anon/);
  await assert.rejects(buildSite(dest,{url:'https://zyxwvutsrqponmlkjihg.supabase.co',key:keyFor('anon')}),/mesmo projeto/);
  await buildSite(dest,{url,key:keyFor('anon')});
  const internal=await readFile(path.join(dest,'js/config.js'),'utf8');
  const publicForm=await readFile(path.join(dest,'cadastro-publico.js'),'utf8');
  for(const file of [internal,publicForm]){
   assert(file.includes(url));
   assert(file.includes(keyFor('anon')));
   assert(!file.includes('gccxghayghuqrwdmtwnn'));
  }
  assert(internal.includes(`${url}/functions/v1/manage-users`));
 } finally { await rm(dest,{recursive:true,force:true}); }
});

