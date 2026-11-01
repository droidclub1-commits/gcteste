import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_CAMPAIGN,validateCampaign,setCampaign,getCampaign,matchMunicipality,campaignReportLabel,parseCampaignFile} from '../js/campaign-model.js';
test('configuração muda contexto, normaliza município e preserva cópias independentes',()=>{
 const settings={...structuredClone(DEFAULT_CAMPAIGN),app_name:'Gestão Municipal',campaign_name:'Campanha teste',city:'belem',uf:'PA',municipalities:['Belém','Ananindeua'],map_lat:-1.45,map_lng:-48.49,revision:4};
 setCampaign(settings);assert.equal(getCampaign().city,'Belém');assert.equal(matchMunicipality(' BELÉM '),'Belém');assert.equal(matchMunicipality('Macapá'),'');assert(campaignReportLabel().includes('Belém/PA'));const copy=getCampaign();copy.municipalities.push('Outra');assert.equal(getCampaign().municipalities.length,2);setCampaign(DEFAULT_CAMPAIGN);
});
test('configuração recusa municípios repetidos, coordenadas, anos e temas inválidos',()=>{
 for(const patch of [{app_name:''},{city:'Fora da lista'},{uf:'XX'},{municipalities:['Macapá','MACAPA']},{map_lat:91},{map_lng:Infinity},{map_zoom:2.5},{election_year:2200},{theme:'url(javascript:alert(1))'}])assert.throws(()=>validateCampaign({...structuredClone(DEFAULT_CAMPAIGN),...patch}));
 const text=JSON.stringify({application:'gcteste-config',schema_version:1,settings:DEFAULT_CAMPAIGN});assert.equal(parseCampaignFile(text).uf,'AP');assert.throws(()=>parseCampaignFile('{"application":"gcteste"}'));
});
