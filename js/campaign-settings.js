import {canEditCampaign,loadCampaignCapability} from './campaign-access.js';
import { sb } from './config.js';
import { state } from './state.js';
import { getCampaign,setCampaign,applyCampaignDOM,campaignPayload,validateCampaign,parseCampaignFile,clearKnownCities } from './campaign-model.js';
const $=id=>document.getElementById(id);
const fields=['app_name','campaign_name','candidate_name','election_year','city','uf','municipalities','map_lat','map_lng','map_zoom','theme'];
let formRevision=null,busy=false,epoch=0,request=null,loadEpoch=0;
const admin=()=>Boolean(state.user&&state.userRole==='admin');
export async function loadCampaign(force=false){
 if(request&&!force)return request;
 const loadToken=++loadEpoch;
 const task=(async()=>{const {data,error}=await sb.from('campanha_config').select('*').eq('id',1).single();if(error||!data)throw new Error('Não foi possível carregar a configuração da campanha.');if(loadToken===loadEpoch){setCampaign(data);applyCampaignDOM();}return data;})();
 request=task;try{return await task;}finally{if(request===task)request=null;}
}
export function resetCampaignUI(){epoch++;state.campaignSupplier=false;formRevision=null;busy=false;$('campaign-form')?.reset();if($('campaign-status'))$('campaign-status').textContent='';clearKnownCities();}
export function applyCampaignAccessUI(){
 document.querySelectorAll('[data-campaign-admin]').forEach(el=>el.classList.toggle('hidden',!admin()));
 document.querySelectorAll('[data-campaign-edit]').forEach(el=>el.classList.toggle('hidden',!canEditCampaign()));
 if($('campaign-mode'))$('campaign-mode').textContent=canEditCampaign()?'Acesso do fornecedor: edição autorizada.':'Somente consulta. Solicite ao fornecedor qualquer alteração da campanha ou localidade.';
 if(!admin()){$('campaign-page')?.classList.add('hidden');formRevision=null;state.campaignSupplier=false;}
 setBusy(busy);
}
function fill(data){for(const k of fields){const input=$(`campaign-${k}`);input.value=k==='municipalities'?data[k].join('\n'):data[k]??'';}}
function read(){const value={};for(const k of fields)value[k]=$(`campaign-${k}`).value;value.municipalities=value.municipalities.split(/\r?\n/).map(n=>n.trim()).filter(Boolean);value.uf=value.uf.toUpperCase().trim();for(const k of ['map_lat','map_lng','map_zoom']){if(!value[k].trim())throw new Error('Preencha as coordenadas e o zoom do mapa.');value[k]=Number(value[k]);}value.election_year=value.election_year.trim()?Number(value.election_year):null;return validateCampaign(value);}
function setBusy(value){busy=value;
 for(const el of document.querySelectorAll('#campaign-form input,#campaign-form select,#campaign-form textarea,#campaign-form button,#campaign-import'))el.disabled=value||!canEditCampaign();
 for(const id of ['campaign-reload','campaign-export'])if($(id))$(id).disabled=value;
}
export async function openCampaignSettings(){if(!admin()||busy)return;const token=++epoch;setBusy(true);$('campaign-status').textContent='Carregando configuração…';try{await loadCampaignCapability();if(token!==epoch||!admin())return;applyCampaignAccessUI();const data=await loadCampaign(true);if(token!==epoch||!admin())return;fill(data);formRevision=data.revision;$('campaign-status').textContent=canEditCampaign()?'Configuração atual carregada.':'Configuração atual carregada para consulta. Alterações são reservadas ao fornecedor.';}catch(error){if(token===epoch){formRevision=null;$('campaign-status').textContent=error.message;}}finally{if(token===epoch)setBusy(false);}}
async function save(event){event.preventDefault();if(!canEditCampaign()||busy)return;if(formRevision===null){$('campaign-status').textContent='Recarregue a configuração antes de salvar.';return;}const token=epoch;try{const payload=read();setBusy(true);$('campaign-status').textContent='Salvando configuração…';const {data,error}=await sb.rpc('salvar_configuracao_campanha_v1',{p_data:payload,p_revision:formRevision});if(token!==epoch||!admin())return;if(error)throw error;loadEpoch++;setCampaign(data);applyCampaignDOM();fill(data);formRevision=data.revision;$('campaign-status').textContent='Configuração salva. Dados existentes preservados. Outras abas recebem a mudança ao recarregar.';}catch(error){if(token===epoch){if(error.code==='42501'){state.campaignSupplier=false;applyCampaignAccessUI();}$('campaign-status').textContent=`Não foi possível confirmar o salvamento: ${error.message} Recarregue para conferir os valores atuais.`;}}finally{if(token===epoch)setBusy(false);}}
export function setupCampaignUI(){const form=$('campaign-form');if(!form||form.dataset.ready)return;form.dataset.ready='true';form.addEventListener('submit',save);$('campaign-reload').addEventListener('click',openCampaignSettings);
 $('campaign-export').addEventListener('click',()=>{if(!admin()||busy||formRevision===null)return;const data={application:'gcteste-config',schema_version:1,settings:campaignPayload(getCampaign())};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='configuracao-campanha.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 $('campaign-import').addEventListener('change',async e=>{if(!canEditCampaign()||busy)return;const file=e.target.files[0],token=epoch;if(!file)return;try{if(file.size>40000)throw new Error('Limite de 40 KB.');const data=parseCampaignFile(await file.text());if(token!==epoch||!canEditCampaign())return;fill(data);$('campaign-status').textContent='Arquivo carregado no formulário. Revise e clique em Salvar configuração para aplicar.';}catch(error){if(token===epoch)$('campaign-status').textContent=`Arquivo recusado: ${error.message}`;}finally{if(token===epoch)e.target.value='';}});
}
