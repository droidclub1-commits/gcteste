// ═══════════════════════════════════════════════════════════════
// CONFIG — cliente Supabase e constantes de configuração
// Extraído do app.js (Fase 2 da modularização)
// ═══════════════════════════════════════════════════════════════

export const SUPABASE_URL = 'https://gccxghayghuqrwdmtwnn.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjY3hnaGF5Z2h1cXJ3ZG10d25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MzA3NDcsImV4cCI6MjEwMzAwNjc0N30.kUaWnK6Wx-M6Y3BGZM1JYo0a80DF-tNPCsxvZN054CM';
export const EDGE_FUNCTION_URL = 'https://gccxghayghuqrwdmtwnn.supabase.co/functions/v1/manage-users';

const { createClient } = window.supabase;

export let sb;
try {
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
    });
} catch (error) {
    console.error("Erro ao inicializar:", error);
    alert("Erro crítico de conexão.");
}
