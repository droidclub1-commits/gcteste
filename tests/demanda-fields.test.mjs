import test from 'node:test';
import assert from 'node:assert/strict';
import {deadlineState,applyDemandaFilters} from '../js/demanda-fields.js';
function recorder(){const calls=[];const q=new Proxy({},{get:(_,k)=>(...args)=>{calls.push([k,...args]);return q;}});return{q,calls};}
test('prazo usa dia local e concluídas não ficam em atraso',()=>{
 assert.equal(deadlineState({prazo:'2026-11-01',status:'pending'},'2026-11-02'),'atrasada');
 assert.equal(deadlineState({prazo:'2026-11-01',status:'completed'},'2026-11-02'),'concluida');
 assert.equal(deadlineState({prazo:'2026-11-02',status:'pending'},'2026-11-02'),'hoje');
 assert.equal(deadlineState({},'2026-11-02'),'sem-prazo');
});
test('filtro de atraso exclui concluídas e mantém filtros de responsável/prioridade',()=>{
 const {q,calls}=recorder();applyDemandaFilters(q,{prazo:'atrasadas',responsavel:'Ana',prioridade:'urgente'},new Date(2026,10,2));
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['lt','prazo','2026-11-02'])));
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['neq','status','completed'])));
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['ilike','responsavel','%Ana%'])));
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['eq','prioridade','urgente'])));
});
test('próximos sete dias incluem hoje e atravessam o mês sem UTC',()=>{
 const {q,calls}=recorder();applyDemandaFilters(q,{prazo:'sete-dias'},new Date(2026,10,28,23,59));
 assert.ok(calls.some(c=>c[0]==='gte'&&c[2]==='2026-11-28'));assert.ok(calls.some(c=>c[0]==='lte'&&c[2]==='2026-12-04'));
});
test('ordenação por prazo deixa sem prazo no fim; relação filtra no servidor',()=>{
 const {q,calls}=recorder();applyDemandaFilters(q,{ordem:'prazo',nome:'Maria',leader:'id',prazo:'sem-prazo'});
 assert.deepEqual(calls.find(c=>c[0]==='order'),['order','prazo',{ascending:true,nullsFirst:false}]);
 assert.ok(calls.some(c=>c[0]==='is'&&c[1]==='prazo'));assert.ok(calls.some(c=>c[1]==='cidadao.name'));
 assert.equal(calls.at(-1)[1],'id');
});
