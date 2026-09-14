// ═══════════════════════════════════════════════════════════════
// STATE — estado compartilhado entre os módulos da aplicação
// Extraído do app.js (Fase 5 da modularização)
//
// state.userRole: 'admin' | 'cadastrador'
// Mutação: outros módulos alteram propriedades deste objeto
// diretamente (ex: state.user = x) — a própria referência ao
// objeto `state` nunca é reatribuída, só suas propriedades.
// ═══════════════════════════════════════════════════════════════

export const state = {
    user: null,
    userRole: null,
    allCidadaos: [],
    allDemandas: [],
    allLeaders: []
};
