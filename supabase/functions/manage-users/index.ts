import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Verifica se quem chama é admin ─────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Cliente com token do utilizador chamador (para verificar o perfil)
    const sbCaller = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerError } = await sbCaller.auth.getUser()
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: 'Sessão inválida.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verifica se o chamador é admin
    const { data: profile, error: profileError } = await sbCaller
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (profileError || !profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Apenas administradores podem gerir utilizadores.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 2. Cliente admin com service_role ─────────────────────────────
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { action, userId, email, password, role } = await req.json()

    if ((action === 'create' || action === 'update_role') && !['admin', 'cadastrador'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Perfil inválido.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // Autoridade do fornecedor não é um perfil que um administrador possa conceder.
    if (action === 'update_role' || action === 'delete') {
      const { data: protectedSupplier, error: supplierError } = await sbAdmin
        .rpc('fornecedor_conta_protegida_v1', { p_user_id: userId })
      // Falha fechada: sem conferir a proteção, não modifica nem remove a conta.
      if (supplierError) throw supplierError
      if (protectedSupplier) {
        return new Response(JSON.stringify({ error: 'Conta do fornecedor protegida. A gestão é feita fora do painel do cliente.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // ── 3. Acções disponíveis ─────────────────────────────────────────
    if (action === 'list') {
      // Lista todos os utilizadores com perfil
      const { data: profiles, error } = await sbAdmin
        .from('profiles')
        .select('id, role, created_at')
      if (error) throw error

      // Busca emails dos utilizadores
      const { data: { users }, error: usersError } = await sbAdmin.auth.admin.listUsers()
      if (usersError) throw usersError

      const result = profiles.map(p => {
        const u = users.find(u => u.id === p.id)
        return {
          id: p.id,
          email: u?.email ?? 'desconhecido',
          role: p.role,
          created_at: p.created_at,
          last_sign_in: u?.last_sign_in_at ?? null
        }
      })

      return new Response(JSON.stringify({ users: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'create') {
      // Cria utilizador no Auth
      const { data: newUser, error: createError } = await sbAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
      if (createError) throw createError

      // Insere perfil
      const { error: profileInsertError } = await sbAdmin
        .from('profiles')
        .insert({ id: newUser.user.id, role })
      if (profileInsertError) throw profileInsertError

      return new Response(JSON.stringify({ success: true, userId: newUser.user.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'update_role') {
      // Impede que o admin se rebaixe
      if (userId === caller.id) {
        return new Response(JSON.stringify({ error: 'Não pode alterar o seu próprio perfil.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      const { error } = await sbAdmin
        .from('profiles')
        .update({ role })
        .eq('id', userId)
      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'delete') {
      // Impede auto-exclusão
      if (userId === caller.id) {
        return new Response(JSON.stringify({ error: 'Não pode excluir a sua própria conta.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      // Remove do Auth (cascade apaga o profile)
      const { error } = await sbAdmin.auth.admin.deleteUser(userId)
      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Acção desconhecida.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
