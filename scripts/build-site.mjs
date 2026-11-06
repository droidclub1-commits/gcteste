import {cp,mkdir,readdir,realpath,rm,lstat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const SITE_FILES=['index.html','app.js','style.css','cadastro-publico.html','cadastro-publico.js','privacidade.html','primeiro-acesso.html','primeiro-acesso.js'];
export const SITE_DIRS=['js','favicon'];
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function checkTree(source){const stat=await lstat(source);if(stat.isSymbolicLink())throw new Error(`Link simbólico não permitido na publicação: ${source}`);if(stat.isDirectory())for(const item of await readdir(source))await checkTree(path.join(source,item));else if(!stat.isFile())throw new Error(`Arquivo inválido: ${source}`);}
function clientConnection({url,key}){
 const host=/^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url);
 let claims;
 try {
  if(!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(key))throw new Error();
  claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
 } catch { throw new Error('Informe a chave pública anon do projeto.'); }
 if(!host||claims?.role!=='anon'||claims.ref!==host[1])throw new Error('A URL e a chave pública anon precisam pertencer ao mesmo projeto Supabase.');
 return {url,key};
}
export async function buildSite(output=path.join(project,'dist'),connection){
 const client=connection&&clientConnection(connection);
 const target=path.resolve(output),source=await realpath(project);
 if(target===source||!target.startsWith(source+path.sep))throw new Error('A saída deve ser uma subpasta do projeto.');
 if(!['dist','.test-site-build'].some(d=>target===path.join(source,d)))throw new Error('A saída deve ser dist ou .test-site-build.');
 // Lista positiva: todo arquivo de infraestrutura ou documentação fica fora do site.
 await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
 for(const item of [...SITE_FILES,...SITE_DIRS]){await checkTree(path.join(source,item));await cp(path.join(source,item),path.join(target,item),{recursive:true,dereference:false});}
 if(client){
  for(const [file,keyName] of [['js/config.js','SUPABASE_KEY'],['cadastro-publico.js','SUPABASE_ANON_KEY']]){
   const location=path.join(target,file);
   const original=await readFile(location,'utf8');
   const urlPattern=/const SUPABASE_URL = '[^']+';/;
   const keyPattern=new RegExp(`const ${keyName} = '[^']+';`);
   if(!urlPattern.test(original)||!keyPattern.test(original))throw new Error(`Configuração esperada não encontrada em ${file}.`);
   const configured=original.replace(urlPattern,`const SUPABASE_URL = '${client.url}';`)
    .replace(keyPattern,`const ${keyName} = '${client.key}';`)
    .replace(/const EDGE_FUNCTION_URL = '[^']+';/,`const EDGE_FUNCTION_URL = '${client.url}/functions/v1/manage-users';`);
   await writeFile(location,configured);
  }
 }
 await writeFile(path.join(target,'404.html'),'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Página não encontrada</title><h1>Página não encontrada</h1><p><a href="/">Voltar ao sistema</a></p></html>\n');
 await writeFile(path.join(target,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Cache-Control: no-cache\n');
 return target;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {GC_CLIENT_SUPABASE_URL:url,GC_CLIENT_SUPABASE_ANON_KEY:key}=process.env;
 console.log(`Site preparado em ${await buildSite(undefined,url||key?{url,key}:undefined)}`);
}

