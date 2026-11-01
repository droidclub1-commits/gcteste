// Uma configuração pública por instalação. Sem credenciais ou permissões de usuários.
export const DEFAULT_CAMPAIGN={app_name:'GESTOR CIDADÃO',campaign_name:'',candidate_name:'',election_year:null,city:'Macapá',uf:'AP',municipalities:['Amapá','Calçoene','Cutias','Ferreira Gomes','Itaubal','Laranjal do Jari','Macapá','Mazagão','Oiapoque','Pedra Branca do Amapari','Porto Grande','Pracuúba','Santana','Serra do Navio','Tartarugalzinho','Vitória do Jari'],map_lat:-0.03964,map_lng:-51.18182,map_zoom:13,theme:'blue'};
export const CAMPAIGN_KEYS=Object.keys(DEFAULT_CAMPAIGN);
export const THEMES={blue:['#0C3E85','#0A3470'],green:['#166534','#14532d'],purple:['#6b21a8','#581c87'],burgundy:['#9f1239','#881337']};
export const textKey=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
let current=structuredClone(DEFAULT_CAMPAIGN),knownCities=[];
export const getCampaign=()=>structuredClone(current);
export function campaignPayload(value){return Object.fromEntries(CAMPAIGN_KEYS.map(k=>[k,value[k]]));}
export function validateCampaign(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Configuração inválida.');
 const data=campaignPayload(value);
 for(const [k,max,required] of [['app_name',80,true],['campaign_name',160,false],['candidate_name',120,false],['city',100,true]]){if(typeof data[k]!=='string')throw new Error(`Campo inválido: ${k}.`);data[k]=data[k].trim();if(data[k].length>max||(required&&!data[k]))throw new Error(`Preencha ${k} (máximo ${max} caracteres).`);}
 if(!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(data.uf))throw new Error('UF inválida.');
 if(!Array.isArray(data.municipalities)||!data.municipalities.length||data.municipalities.length>200||data.municipalities.some(n=>typeof n!=='string'||!n.trim()||n.trim().length>100))throw new Error('Informe de 1 a 200 municípios, com até 100 caracteres cada.');
 data.municipalities=data.municipalities.map(n=>n.trim());if(new Set(data.municipalities.map(textKey)).size!==data.municipalities.length)throw new Error('Há municípios repetidos.');
 const city=data.municipalities.find(n=>textKey(n)===textKey(data.city));if(!city)throw new Error('Inclua o município principal na lista de municípios atendidos.');data.city=city;
 for(const [k,min,max] of [['map_lat',-90,90],['map_lng',-180,180],['map_zoom',1,18]]){if(typeof data[k]!=='number'||!Number.isFinite(data[k])||data[k]<min||data[k]>max)throw new Error(`Valor inválido: ${k}.`);}
 if(!Number.isInteger(data.map_zoom))throw new Error('Zoom deve ser inteiro.');
 if(data.election_year!==null&&(!Number.isInteger(data.election_year)||data.election_year<2000||data.election_year>2100))throw new Error('Ano inválido.');
 if(!THEMES[data.theme])throw new Error('Tema inválido.');return data;
}
export function setCampaign(value){const data=validateCampaign(value);current={...data,revision:value.revision??null};return getCampaign();}
export function matchMunicipality(raw){return current.municipalities.find(n=>textKey(n)===textKey(raw))||'';}
export function setCityValue(select,raw){if(!select)return;const value=matchMunicipality(raw)||String(raw||'').trim();if(value&&![...select.querySelectorAll('option')].some(o=>o.value===value)){const option=select.ownerDocument.createElement('option');option.value=value;option.textContent=value;select.appendChild(option);}select.value=value;}
export function setKnownCities(values,root=document){knownCities=[...new Set(values.filter(Boolean))];applyMunicipalities(root);}
export function clearKnownCities(root=document){knownCities=[];for(const id of ['filter-cidade','cobertura-filter-cidade']){const el=root.getElementById(id);if(el)el.value='';}applyMunicipalities(root);}
export function applyMunicipalities(root=document){
 for(const id of ['cidadao-cidade','c-cidade','filter-cidade','cobertura-filter-cidade']){const select=root.getElementById(id);if(!select)continue;const old=select.value;const prompt=select.querySelector('option[value=""]')?.textContent||'Selecione o município…';select.replaceChildren();const option=root.createElement('option');option.value='';option.textContent=prompt;select.append(option);
 const cities=[...new Set([...current.municipalities,...(id.includes('filter')?knownCities:[])])];for(const city of cities){const op=root.createElement('option');op.value=city;op.textContent=city;select.append(op);}setCityValue(select,old);}
}
export function campaignLabel(){return [current.campaign_name,current.candidate_name,current.election_year].filter(Boolean).join(' · ');}
export function campaignReportLabel(){return [current.app_name,campaignLabel(),`${current.city}/${current.uf}`].filter(Boolean).join(' — ');}
export function applyCampaignDOM(root=document){
 root.title=current.app_name;
 for(const el of root.querySelectorAll('[data-campaign-app]'))el.textContent=current.app_name;
 for(const el of root.querySelectorAll('[data-campaign-label]')){el.textContent=campaignLabel();el.classList.toggle('hidden',!el.textContent);}
 for(const el of root.querySelectorAll('[data-campaign-scope]'))el.textContent=`${current.city}/${current.uf}`;
 const colors=THEMES[current.theme];root.documentElement.style.setProperty('--gc-blue',colors[0]);root.documentElement.style.setProperty('--gc-blue-dark',colors[1]);
 applyMunicipalities(root);
}
export function parseCampaignFile(text){if(new TextEncoder().encode(text).length>40000)throw new Error('Arquivo de configuração acima de 40 KB.');const file=JSON.parse(text);if(file.application!=='gcteste-config'||file.schema_version!==1)throw new Error('Selecione um arquivo de configuração do sistema.');return validateCampaign(file.settings);}
