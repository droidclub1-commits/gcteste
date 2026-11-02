import {sb} from './config.js';
import {state} from './state.js';
export const canEditCampaign=()=>Boolean(state.user&&state.userRole==='admin'&&state.campaignSupplier===true);
export async function loadCampaignCapability(){
 const user=state.user?.id;state.campaignSupplier=false;
 if(!user||state.userRole!=='admin')return false;
 try{const {data,error}=await sb.rpc('pode_configurar_campanha_v1');if(state.user?.id!==user||state.userRole!=='admin')return false;if(error)throw error;state.campaignSupplier=data===true;return state.campaignSupplier;}
 catch(error){console.warn('Permissão de configuração indisponível; mantido acesso somente consulta.');return false;}
}
