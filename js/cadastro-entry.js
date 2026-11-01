import { sb } from './config.js';
import { state } from './state.js';
import { parseImportCSV, CSV_MODEL } from './import-format.js';
const $=id=>document.getElementById(id);
const allowed=()=>Boolean(state.user&&['admin','cadastrador'].includes(state.userRole));
let mode='quick',rows=[],preview=null,pending=null,busy=false,version=0,onSaved=async()=>{};
const labels={invalid:'Inválido',existing:'CPF já cadastrado',duplicate_file:'CPF repetido no arquivo',review:'Possível duplicidade',ready:'Sem alerta'};
const node=(tag,text,cls='')=>{const el=document.createElement(tag);el.textContent=text;el.className=cls;return el;};
function setBusy(value){busy=value;for(const el of document.querySelectorAll('#entry-modal input,#entry-modal button'))el.disabled=value; if(!value){for(const el of document.querySelectorAll('[data-entry-select]'))el.disabled=!['ready','review'].includes(preview?.rows[Number(el.dataset.entrySelect)-1]?.status);if(pending)lockPending();}}
function lockPending(){for(const el of document.querySelectorAll('#entry-modal input,#entry-modal button'))el.disabled=true;$('entry-confirm').disabled=false;$('entry-close').disabled=false;$('entry-confirm').textContent='Tentar novamente / conferir resultado';}
export function resetEntryUI(){version++;busy=false;rows=[];preview=null;pending=null;$('entry-modal')?.classList.add('hidden');$('entry-rows')?.replaceChildren();$('entry-review')?.classList.add('hidden');$('entry-quick')?.reset();if($('entry-file'))$('entry-file').value='';if($('entry-status'))$('entry-status').textContent='';}
export function applyEntryAccessUI(){document.querySelectorAll('[data-import-admin]').forEach(el=>el.classList.toggle('hidden',!allowed()||state.userRole!=='admin'));if(!allowed())resetEntryUI();}
function open(nextMode){if(!allowed()||(nextMode==='import'&&state.userRole!=='admin'))return;
 if(!pending){resetEntryUI();mode=nextMode;$('entry-title').textContent=mode==='quick'?'Cadastro rápido':'Importar cidadãos';$('entry-quick').classList.toggle('hidden',mode!=='quick');$('entry-import').classList.toggle('hidden',mode!=='import');setBusy(false);}
 $('entry-modal').classList.remove('hidden');$(mode==='quick'?'entry-name':'entry-file')?.focus();
}
function invalidate(){if(busy||pending)return;version++;preview=null;rows=[];$('entry-review').classList.add('hidden');$('entry-rows').replaceChildren();$('entry-status').textContent='Dados alterados. Confira novamente antes de gravar.';}
async function check(data){if(!allowed()||busy||pending||(mode==='import'&&state.userRole!=='admin'))return;const token=++version;rows=data;preview=null;$('entry-review').classList.add('hidden');setBusy(true);$('entry-status').textContent='Conferindo dados e possíveis duplicidades…';
 try{const {data:result,error}=await sb.rpc('conferir_cadastro_v1',{p_rows:data,p_mode:mode});if(token!==version||!allowed())return;if(error)throw error;preview=result;render();}
 catch(error){if(token===version)$('entry-status').textContent=`Falha na conferência: ${error.message}`;}
 finally{if(token===version)setBusy(false);}
}
function selection(){return [...document.querySelectorAll('[data-entry-select]')].filter(el=>el.checked).map(el=>Number(el.dataset.entrySelect));}
function updateSelection(){const selected=selection();$('entry-selection').textContent=`${selected.length} de ${rows.length} selecionado(s).`;}
function render(){const list=$('entry-rows');list.replaceChildren();const counts={};
 for(const row of preview.rows){counts[row.status]=(counts[row.status]||0)+1;const card=node('article','','border rounded p-3');const selectable=['ready','review'].includes(row.status);
 const label=node('label','','flex gap-2 items-center font-semibold');const select=document.createElement('input');select.type='checkbox';select.dataset.entrySelect=row.line;select.disabled=!selectable;select.addEventListener('change',updateSelection);label.append(select,node('span',`${mode==='quick'?'Cadastro':`Registro ${row.line}`}: ${row.data?.name||'Sem nome'} · ${labels[row.status]}`));card.append(label);
 if(row.data){const dl=node('dl','','text-sm grid grid-cols-1 md:grid-cols-2 gap-1 my-2');for(const [key,title] of Object.entries({cpf:'CPF',phone:'Telefone',whatsapp:'WhatsApp',email:'E-mail',dob:'Nascimento',bairro:'Bairro',cidade:'Município',estado:'UF'})){let v=row.data[key];if(typeof v==='boolean')v=v?'Sim':'Não';dl.append(node('div',`${title}: ${v??'—'}`));}card.append(dl);}
 if(row.error)card.append(node('p',row.error,'text-red-700'));
 if(row.match_count){card.append(node('p',`${row.match_count} cadastro(s) com coincidências. Mostrando até 5:`,'text-amber-800 font-semibold'));for(const match of row.matches)card.append(node('p',`${match.name} · CPF: ${match.cpf||'—'} · Telefone: ${match.phone||'—'} · E-mail: ${match.email||'—'} · Nascimento: ${match.dob||'—'} · Município: ${match.cidade||'—'} · ID: ${match.id}`,'text-sm break-all'));}
 if(row.peers?.length)card.append(node('p',`Coincidência com registro(s) do arquivo: ${row.peers.join(', ')}.`,'text-amber-800'));
 if(row.status==='review'){const ackLabel=node('label','','flex gap-2 mt-2');const ack=document.createElement('input');ack.type='checkbox';ack.dataset.entryAck=row.line;ackLabel.append(ack,node('span','Revisei as coincidências: esta linha é de outra pessoa e deve criar um novo cadastro.'));card.append(ackLabel);}
 list.append(card);
 }
 $('entry-status').textContent=Object.entries(counts).map(([k,n])=>`${labels[k]}: ${n}`).join(' · ');$('entry-review').classList.remove('hidden');$('entry-confirm').textContent='Gravar selecionados';updateSelection();
}
async function confirm(){if(!allowed()||busy||!preview||(mode==='import'&&state.userRole!=='admin'))return;
 if(!pending){const selected=selection(),ack=[...document.querySelectorAll('[data-entry-ack]')].filter(el=>el.checked).map(el=>Number(el.dataset.entryAck));if(!selected.length){$('entry-status').textContent='Selecione pelo menos um cadastro.';return;}
 if(selected.some(i=>preview.rows[i-1].status==='review'&&!ack.includes(i))){$('entry-status').textContent='Confirme a revisão das possíveis duplicidades selecionadas.';return;}
 pending={p_rows:rows,p_selected:selected,p_ack:ack,p_expected_state:preview.expected_state,p_operation:crypto.randomUUID(),p_mode:mode};
 }
 const token=version;setBusy(true);$('entry-status').textContent='Gravando os cadastros selecionados…';
 try{const {data,error}=await sb.rpc('confirmar_cadastro_v1',pending);if(token!==version||!allowed())return;if(error)throw error;pending=null;preview=null;rows=[];$('entry-review').classList.add('hidden');$('entry-rows').replaceChildren();$('entry-quick').reset();$('entry-file').value='';$('entry-status').textContent=`Concluído: ${data.inserted} cidadão(s) criado(s). Cadastros existentes preservados.`;
 try{await onSaved();}catch{$('entry-status').textContent+=' Atualize a lista para consultar os novos registros.';}
 }catch(error){if(token===version){if(['40001','23505','P0001','42501','22023'].includes(error.code)){pending=null;preview=null;$('entry-review').classList.add('hidden');$('entry-status').textContent=`Nada foi gravado neste lote: ${error.message} Confira novamente.`;}else{$('entry-status').textContent='Resposta não confirmada. Tente novamente para conferir o resultado com o mesmo identificador, sem duplicar o lote.';}}}
 finally{if(token===version)setBusy(false);}
}
export function setupEntryUI(refresh){onSaved=refresh||onSaved;const form=$('entry-quick');if(!form||form.dataset.ready)return;form.dataset.ready='true';
 $('quick-citizen-btn').addEventListener('click',()=>open('quick'));$('import-citizens-btn').addEventListener('click',()=>open('import'));$('entry-close').addEventListener('click',()=>{if(!busy){$('entry-modal').classList.add('hidden');if(!pending)resetEntryUI();}});
 form.addEventListener('input',invalidate);form.addEventListener('submit',e=>{e.preventDefault();const data={};for(const k of ['name','cpf','phone','email','dob','bairro','cidade','estado'])data[k]=$(`entry-${k}`).value;data.whatsapp=$('entry-whatsapp').checked;check([data]);});
 $('entry-file').addEventListener('change',async e=>{if(busy||pending||!allowed()||state.userRole!=='admin')return;invalidate();const file=e.target.files[0];if(!file)return;const token=version;try{if(file.size>1048576)throw new Error('O limite é de 1 MB.');const content=await file.text();if(token!==version||!allowed())return;await check(parseImportCSV(content));}catch(error){if(token===version)$('entry-status').textContent=error.message;}});
 $('entry-model').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+CSV_MODEL],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='modelo-cidadaos.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 $('entry-select-ready').addEventListener('click',()=>{for(const el of document.querySelectorAll('[data-entry-select]'))el.checked=preview.rows[Number(el.dataset.entrySelect)-1].status==='ready';updateSelection();});
 $('entry-clear-selection').addEventListener('click',()=>{for(const el of document.querySelectorAll('[data-entry-select]'))el.checked=false;updateSelection();});$('entry-confirm').addEventListener('click',confirm);
}
