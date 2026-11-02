import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../supabase/functions/manage-users/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,'');
async function run(body,{protectedAccount=false,permissionError=false,role='admin'}={}){
 let handler,mutation=0,lookups=0;
 const caller={auth:{getUser:async()=>({data:{user:{id:'caller'}}})},from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{role}})})};
 const server={rpc:async()=>{lookups++;return {data:protectedAccount,error:permissionError?new Error('lookup unavailable'):null};},from:()=>({update(){return this;},eq:async()=>{mutation++;return{};}}),auth:{admin:{deleteUser:async()=>{mutation++;return{};}}}};
 vm.runInNewContext(source,{Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},createClient:(...args)=>args[2]?caller:server,Response,console});
 const response=await handler({method:'POST',headers:new Headers({Authorization:'Bearer test'}),json:async()=>body});return {status:response.status,mutation,lookups};
}
test('gestão de usuários bloqueia alteração e exclusão de fornecedor e falha fechada',async()=>{
 for(const action of ['delete','update_role']){const body={action,userId:'supplier',role:'admin'};const protectedResult=await run(body,{protectedAccount:true});assert.equal(protectedResult.status,403);assert.equal(protectedResult.mutation,0);const failed=await run(body,{permissionError:true});assert.equal(failed.status,500);assert.equal(failed.mutation,0);const ordinary=await run({...body,userId:'ordinary'});assert.equal(ordinary.status,200);assert.equal(ordinary.mutation,1);}
});
test('gestão de usuários não cria perfil de fornecedor nem aceita cadastrador',async()=>{
 const forged=await run({action:'update_role',userId:'ordinary',role:'fornecedor'});assert.equal(forged.status,400);assert.equal(forged.mutation,0);
 const denied=await run({action:'delete',userId:'supplier'},{role:'cadastrador'});assert.equal(denied.status,403);assert.equal(denied.lookups,0);
});
