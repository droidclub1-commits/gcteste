import { sb } from './config.js';
import { state } from './state.js';
const $ = id => document.getElementById(id);
const modules = {cidadaos:'Cidadãos',demandas:'Demandas',notes:'Anotações',veiculos:'Veículos',cotas_combustivel:'Combustível',profiles:'Perfis'};
const actions = {INSERT:'Criação',UPDATE:'Alteração',DELETE:'Exclusão'};
let generation=0, cursor=null, busy=false, filters=null;
const allowed=()=>Boolean(state.user && state.userRole==='admin');
function node(tag,text,classes='') { const el=document.createElement(tag);el.textContent=text;el.className=classes;return el; }
export function resetAudit(){ generation++;cursor=null;busy=false;filters=null;for(const id of ['audit-list','audit-detail-content']) if($(id)) $(id).replaceChildren();$('audit-detail')?.classList.add('hidden');$('audit-more')?.classList.add('hidden');if($('audit-status'))$('audit-status').textContent='';$('audit-filters')?.reset(); }
export function applyAuditAccessUI(){document.querySelectorAll('[data-audit-admin]').forEach(el=>el.classList.toggle('hidden',!allowed()));if(!allowed())resetAudit();}
function readFilters(){
 const start=$('audit-from').value,end=$('audit-to').value;
 if(start && end && start>end)throw new Error('A data final deve ser igual ou posterior à inicial.');
 let until=null;if(end){const d=new Date(`${end}T00:00:00`);d.setDate(d.getDate()+1);until=d.toISOString();}
 return {p_tabela:$('audit-table').value||null,p_acao:$('audit-action').value||null,p_busca:$('audit-search').value.trim()||null,p_registro:$('audit-record').value.trim()||null,p_inicio:start?new Date(`${start}T00:00:00`).toISOString():null,p_fim:until};
}
export async function loadAudit(more=false){
 if(!allowed())return;
 if(more&&busy)return;
 const token=more?generation:++generation;
 try{
 if(!more){filters=readFilters();cursor=null;$('audit-list').replaceChildren();$('audit-detail').classList.add('hidden');}
 busy=true;$('audit-more').disabled=true;$('audit-status').textContent='Carregando histórico…';
 const {data,error}=await sb.rpc('auditoria_listar_v1',{...filters,p_after_time:more?cursor?.time:null,p_after_id:more?cursor?.id:null,p_limit:25});
 if(token!==generation||!allowed())return;if(error)throw error;
 for(const event of data.events){const card=node('article','','border rounded p-3 bg-white');card.append(node('p',`${new Date(event.occurred_at).toLocaleString('pt-BR')} · ${modules[event.table_name]||event.table_name} · ${actions[event.action]||event.action}`,'font-semibold'),node('p',event.record_label),node('p',`Por: ${event.actor_label} · ${event.origin==='restauracao'?'Restauração':event.origin}`,'text-sm text-gray-600'));const button=node('button','Ver alterações','text-blue-700 underline');button.type='button';button.addEventListener('click',()=>detail(event.id));card.append(button);$('audit-list').append(card);}
 cursor=data.next_cursor;$('audit-more').classList.toggle('hidden',!data.has_more);$('audit-status').textContent=$('audit-list').children.length?'Operações mais recentes primeiro.':'Nenhuma operação encontrada neste filtro.';
 }catch(error){if(token===generation){$('audit-status').textContent=`Não foi possível carregar: ${error.message}`;$('audit-more').classList.add('hidden');}}
 finally{if(token===generation){busy=false;$('audit-more').disabled=false;}}
}
let detailVersion=0;
async function detail(id){const version=++detailVersion,token=generation;if(!allowed())return;try{
 const {data,error}=await sb.rpc('auditoria_detalhe_v1',{p_id:id});if(version!==detailVersion||token!==generation||!allowed())return;if(error)throw error;
 const box=$('audit-detail-content');box.replaceChildren(node('p',`Registro: ${data.record_id} · Usuário: ${data.actor_label}${data.operation_id?' · Operação: '+data.operation_id:''}`));
 const table=node('table','','w-full text-sm');const head=node('tr');for(const t of ['Campo','Antes','Depois'])head.append(node('th',t,'text-left border p-2'));table.append(head);
 const before=data.before_data||{},after=data.after_data||{};
 const keys=data.action==='UPDATE'?data.changed_fields:[...new Set([...Object.keys(before),...Object.keys(after)])].sort();
 for(const key of keys){const row=node('tr');for(const value of [key,before[key],after[key]])row.append(node('td',value===undefined?'—':typeof value==='string'?value:JSON.stringify(value),'border p-2 whitespace-pre-wrap break-all'));table.append(row);}
 box.append(table);$('audit-detail').classList.remove('hidden');$('audit-detail').scrollIntoView?.({behavior:'smooth'});
 }catch(error){if(token===generation&&allowed())$('audit-status').textContent=`Erro nos detalhes: ${error.message}`;}}
export function setupAuditUI(){const form=$('audit-filters');if(!form||form.dataset.ready)return;form.dataset.ready='true';form.addEventListener('submit',e=>{e.preventDefault();loadAudit();});$('audit-clear').addEventListener('click',()=>{form.reset();loadAudit();});$('audit-more').addEventListener('click',()=>loadAudit(true));$('audit-close').addEventListener('click',()=>{detailVersion++;$('audit-detail').classList.add('hidden');});}
