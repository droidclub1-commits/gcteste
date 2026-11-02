import {cp,mkdir,readdir,realpath,rm,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const SITE_FILES=['index.html','app.js','style.css','cadastro-publico.html','cadastro-publico.js','privacidade.html'];
export const SITE_DIRS=['js','favicon'];
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function checkTree(source){const stat=await lstat(source);if(stat.isSymbolicLink())throw new Error(`Link simbólico não permitido na publicação: ${source}`);if(stat.isDirectory())for(const item of await readdir(source))await checkTree(path.join(source,item));else if(!stat.isFile())throw new Error(`Arquivo inválido: ${source}`);}
export async function buildSite(output=path.join(project,'dist')){
 const target=path.resolve(output),source=await realpath(project);
 if(target===source||!target.startsWith(source+path.sep))throw new Error('A saída deve ser uma subpasta do projeto.');
 if(!['dist','.test-site-build'].some(d=>target===path.join(source,d)))throw new Error('A saída deve ser dist ou .test-site-build.');
 // Lista positiva: todo arquivo de infraestrutura ou documentação fica fora do site.
 await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
 for(const item of [...SITE_FILES,...SITE_DIRS]){await checkTree(path.join(source,item));await cp(path.join(source,item),path.join(target,item),{recursive:true,dereference:false});}
 await writeFile(path.join(target,'404.html'),'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title><h1>Página não encontrada</h1><p><a href="/">Voltar ao sistema</a></p></html>\n');
 await writeFile(path.join(target,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n');
 return target;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(`Site preparado em ${await buildSite()}`);
