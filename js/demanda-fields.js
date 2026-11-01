import { dateOnly } from './data.js';
export const PRIORIDADES={baixa:'Baixa',normal:'Normal',alta:'Alta',urgente:'Urgente'};
export function deadlineState(demanda,today=dateOnly(new Date())) {
    if (!demanda.prazo) return 'sem-prazo';
    if (demanda.status==='completed') return 'concluida';
    if (demanda.prazo<today) return 'atrasada';
    if (demanda.prazo===today) return 'hoje';
    return 'futura';
}
export function applyDemandaFilters(query,filters={},today=new Date()) {
    if(filters.status)query=query.eq('status',filters.status);
    if(filters.prioridade)query=query.eq('prioridade',filters.prioridade);
    if(filters.responsavel)query=query.ilike('responsavel',`%${filters.responsavel}%`);
    if(filters.leader)query=query.eq('cidadao.leader',filters.leader);
    if(filters.nome)query=query.ilike('cidadao.name',`%${filters.nome}%`);
    const day=dateOnly(today);
    if(filters.prazo==='atrasadas')query=query.lt('prazo',day).neq('status','completed');
    if(filters.prazo==='hoje')query=query.eq('prazo',day).neq('status','completed');
    if(filters.prazo==='sem-prazo')query=query.is('prazo',null);
    if(filters.prazo==='sete-dias') {
        const end=new Date(today);end.setDate(today.getDate()+6);
        query=query.gte('prazo',day).lte('prazo',dateOnly(end)).neq('status','completed');
    }
    if(filters.ordem==='prazo')query=query.order('prazo',{ascending:true,nullsFirst:false});
    return query.order('created_at',{ascending:false}).order('id');
}
