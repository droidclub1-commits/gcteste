import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, sealBackup, databasePayload } from '../js/backup-format.js';
import { restoreBackup } from '../js/restore-service.js';
const cid='11111111-1111-4111-8111-111111111111';
function sample() { return {application:'gcteste',schema_version:3,manifest:{counts:{cidadaos:1,demandas:0,notes:0,veiculos:0,cotas_combustivel:0}},cidadaos:[{id:cid,name:'Teste'}],demandas:[],notes:[],veiculos:[],cotas_combustivel:[],files:[]}; }
async function withPhoto() {
 const b=sample();b.cidadaos[0].photourl='storage://fotos-cidadaos/u/f.png';
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
 b.files=[{bucket:'fotos-cidadaos',path:'u/f.png',source_url:b.cidadaos[0].photourl,base64,size_bytes:atob(base64).length,mime_type:'image/png'}];
 return sealBackup(b);
}
test('backup íntegro é aceito e Auth/perfis não entram no payload',async()=>{
 const b=await sealBackup(sample());b.profiles=[{role:'admin'}];
 assert.equal((await validateBackup(b)).counts.cidadaos,1);assert.equal('profiles' in databasePayload(b),false);
});
test('arquivo alterado, contagens falsas e ID duplicado são recusados',async()=>{
 const b=await sealBackup(sample());b.cidadaos[0].name='Mudou';await assert.rejects(validateBackup(b),/corrompidos/);
 const c=await sealBackup(sample());c.manifest.counts.cidadaos=9;await assert.rejects(validateBackup(c),/Contagem/);
 const d=sample();d.cidadaos.push(d.cidadaos[0]);d.manifest.counts.cidadaos=2;await assert.rejects(validateBackup(await sealBackup(d)),/duplicado/);
});
test('vínculos ausentes e módulos incompletos não podem apagar dados',async()=>{
 const b=sample();b.notes=[{id:crypto.randomUUID(),demanda_id:crypto.randomUUID()}];b.manifest.counts.notes=1;
 await assert.rejects(validateBackup(await sealBackup(b)),/Demanda não encontrada/);
 const c=await sealBackup(sample());delete c.veiculos;await assert.rejects(validateBackup(c),/Módulo ausente/);
});
test('foto íntegra é aceita; foto adulterada ou ausente é recusada',async()=>{
 const b=await withPhoto();assert.equal((await validateBackup(b)).photos,1);
 b.files[0].sha256='0'.repeat(64);await assert.rejects(validateBackup(b),/foto foi alterada/);
 const c=await withPhoto();c.files=[];await assert.rejects(validateBackup(c),/não contém uma foto/);
});
test('v2 completo informa ausência de checksum; legado incompleto é recusado',async()=>{
 const b=sample();b.schema_version=2;assert.equal((await validateBackup(b)).warnings.length,1);
 delete b.notes;await assert.rejects(validateBackup(b),/Módulo ausente/);
});
test('fotos são copiadas antes do banco sem alterar o objeto original',async()=>{
 const b=await withPhoto(),original=b.cidadaos[0].photourl;let sent,uploaded;
 const client={storage:{from(){return{async upload(path,blob,opts){uploaded={path,opts};return{error:null};}};}},async rpc(name,args){sent=args;return{data:{restored:true}};}};
 const done=await restoreBackup(client,b,{expected_state:'state'},cid,'RESTAURAR');
 assert.equal(done.restored,true);assert.equal(uploaded.opts.upsert,false);assert.ok(uploaded.path.startsWith(cid+'/restauracoes/'));
 assert.notEqual(sent.p_backup.cidadaos[0].photourl,original);assert.equal(b.cidadaos[0].photourl,original);
});
test('upload com falha não chama restauração; confirmação errada não envia dados',async()=>{
 const b=await withPhoto();let calls=0;
 const client={storage:{from(){return{upload:async()=>({error:{message:'offline'}})};}},rpc:async()=>{calls++;}};
 await assert.rejects(restoreBackup(client,b,{expected_state:'state'},cid,'RESTAURAR'),/banco não foi alterado/);assert.equal(calls,0);
 await assert.rejects(restoreBackup(client,b,{expected_state:'state'},cid,'restaurar'),/digite RESTAURAR/);
});
test('perda de resposta consulta recibo em vez de repetir restauração',async()=>{
 const b=await sealBackup(sample());const calls=[];
 const client={async rpc(name){calls.push(name);return name==='restaurar_aplicacao_v1'?{error:{message:'rede'}}:{data:{restored:true}};}};
 assert.equal((await restoreBackup(client,b,{expected_state:'state'},cid,'RESTAURAR')).restored,true);
 assert.deepEqual(calls,['restaurar_aplicacao_v1','resultado_restauracao_v1']);
});
test('resultado desconhecido mantém operação pendente',async()=>{
 const b=await sealBackup(sample());const client={rpc:async()=>({error:{message:'rede'}})};
 await assert.rejects(restoreBackup(client,b,{expected_state:'state'},cid,'RESTAURAR'),e=>Boolean(e.pendingOperation));
});
