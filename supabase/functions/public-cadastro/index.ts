// supabase/functions/public-cadastro/index.ts
//
// Recebe pedidos do formulário público (cadastro-publico.html) e:
//   1. action "verify"        — só confere se a senha bate, sem gravar nada.
//                                (usado apenas no fluxo antigo "cadastro rápido"
//                                com senha genérica, ainda mantido por compatibilidade)
//   2. action "list-leaders"  — lista lideranças (id, name). Fica atrás da senha,
//                                é usada só pelo painel admin pra montar o link.
//   3. action "get-leader-info" — PÚBLICA (sem senha): dado um leaderId, confirma
//                                que é uma liderança válida e devolve o nome, pra
//                                exibir "Cadastro via indicação de: <nome>" na tela.
//   4. action "create"        — insere o cidadão. Autoriza de DUAS formas:
//                                a) senha de acesso correta (fluxo antigo, genérico), OU
//                                b) leaderId válido (link exclusivo da liderança, sem senha).
//                                Quando entra pela liderança, o campo `leader` do
//                                registo é sempre o leaderId validado no servidor —
//                                nunca o que vier (ou não vier) do corpo da requisição,
//                                pra ninguém conseguir se atribuir a outra liderança.
//
// A senha de acesso NUNCA fica no código — é lida de uma variável de
// ambiente (secret) configurada no painel/CLI do Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ACCESS_PASSWORD = Deno.env.get('PUBLIC_CADASTRO_PASSWORD') ?? '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Confere se o id informado é mesmo uma "Liderança" existente. Devolve o
// nome (ou null se inválido) — usado tanto por get-leader-info quanto
// para autorizar/atribuir o "create" via link de liderança.
async function fetchValidLeader(leaderId: string | undefined | null) {
    if (!leaderId || typeof leaderId !== 'string') return null;
    const { data, error } = await sbAdmin
        .from('cidadaos')
        .select('id, name')
        .eq('id', leaderId)
        .eq('type', 'Liderança')
        .maybeSingle();
    if (error || !data) return null;
    return data as { id: string; name: string };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405);

    let body: any;
    try {
        body = await req.json();
    } catch {
        return json({ ok: false, error: 'Corpo da requisição inválido.' }, 400);
    }

    const { action, password, leaderId } = body;
    const passwordOk = Boolean(ACCESS_PASSWORD) && password === ACCESS_PASSWORD;

    // ── Ação pública, sem senha: consulta o nome de uma liderança pelo id ──
    // Usada pela tela de cadastro quando aberta via link ?leader=<id>, pra
    // mostrar "Cadastro via indicação de: <nome>" antes de exibir o formulário.
    if (action === 'get-leader-info') {
        const leader = await fetchValidLeader(leaderId);
        if (!leader) return json({ ok: false, error: 'Link de liderança inválido ou expirado.' }, 404);
        return json({ ok: true, name: leader.name });
    }

    // ── Ações abaixo continuam exigindo autorização (senha OU liderança válida) ──
    const leader = await fetchValidLeader(leaderId);
    const authorized = passwordOk || !!leader;

    if (action === 'verify') {
        // Fluxo antigo (cadastro rápido genérico) — sempre por senha.
        if (!passwordOk) return json({ ok: false, error: 'Chave de acesso incorreta.' }, 401);
        return json({ ok: true });
    }

    if (action === 'list-leaders') {
        // Ferramenta de administração (montar o link) — mantém exigindo a senha,
        // nunca deve ficar acessível publicamente sem ela.
        if (!passwordOk) return json({ ok: false, error: 'Chave de acesso incorreta.' }, 401);
        const { data, error } = await sbAdmin
            .from('cidadaos')
            .select('id, name')
            .eq('type', 'Liderança')
            .order('name');
        if (error) {
            console.error('Erro ao listar lideranças:', error);
            return json({ ok: false, error: 'Erro ao carregar lideranças.' }, 500);
        }
        return json({ ok: true, leaders: data ?? [] });
    }

    if (action === 'create') {
        if (!authorized) {
            return json({ ok: false, error: leaderId ? 'Link de liderança inválido.' : 'Chave de acesso incorreta.' }, 401);
        }

        // Honeypot: bots preenchem campos escondidos. Se veio preenchido,
        // finge sucesso mas não grava nada — não dá pista pro bot.
        if (body.honeypot) {
            return json({ ok: true });
        }

        const c = body.cidadao ?? {};
        const name = (c.name ?? '').toString().trim();
        if (!name) {
            return json({ ok: false, error: 'Nome é obrigatório.' }, 400);
        }

        // Consentimento LGPD é obrigatório — nunca confiar só na validação do
        // navegador. Sem isso, nem chega a tentar geocodificar/inserir.
        if (body.lgpdConsent !== true) {
            return json({ ok: false, error: 'É necessário concordar com o uso dos dados para se cadastrar.' }, 400);
        }

        // Geocodificação best-effort — não bloqueia o cadastro se falhar.
        let latitude: number | null = null;
        let longitude: number | null = null;
        if (c.logradouro && c.cidade) {
            try {
                const address = `${c.logradouro}, ${c.bairro ?? ''}, ${c.cidade}, ${c.estado ?? ''}`;
                const geoRes = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
                    { headers: { 'User-Agent': 'GestorValente-CadastroPublico/1.0' } }
                );
                const geoData = await geoRes.json();
                if (geoData?.[0]) {
                    latitude = parseFloat(geoData[0].lat);
                    longitude = parseFloat(geoData[0].lon);
                }
            } catch (geoErr) {
                console.error('Falha na geocodificação:', geoErr);
            }
        }

        // Se entrou por um link de liderança válido, o leader é SEMPRE o
        // validado no servidor — nunca o que (ou não) veio no corpo da
        // requisição pública. Se entrou pela senha genérica (fluxo antigo,
        // sem liderança), respeita o que veio em c.leader (pode ser null).
        const effectiveLeader = leader ? leader.id : (c.leader || null);

        const insertPayload = {
            name,
            leader: effectiveLeader,
            email: c.email || null,
            dob: c.dob || null,
            sexo: c.sexo || null,
            type: c.type || 'Outro',
            cpf: c.cpf || null,
            rg: c.rg || null,
            voterid: c.voterid || null,
            zona: c.zona || null,
            secao: c.secao || null,
            phone: c.phone || null,
            whatsapp: !!c.whatsapp,
            profissao: c.profissao || null,
            localtrabalho: c.localtrabalho || null,
            nome_mae: c.nome_mae || null,
            nome_pai: c.nome_pai || null,
            cep: c.cep || null,
            logradouro: c.logradouro || null,
            numero: c.numero || null,
            complemento: c.complemento || null,
            bairro: c.bairro || null,
            cidade: c.cidade || null,
            estado: c.estado || null,
            photourl: c.photourl || null,
            latitude,
            longitude,
            // Registo do aceite — data/hora gerada no servidor (não confia no
            // relógio do navegador), serve de respaldo em caso de auditoria.
            lgpd_consent_at: new Date().toISOString(),
        };

        const { error } = await sbAdmin.from('cidadaos').insert(insertPayload);
        if (error) {
            console.error('Erro ao inserir cidadão:', error);
            // CPF/título duplicado é o erro mais comum — inclusive entre lideranças
            // diferentes, já que o índice único é sobre a tabela toda, não por leader.
            if (error.message?.includes('cidadaos_cpf_key')) {
                return json({ ok: false, error: 'Este CPF já está cadastrado.' }, 409);
            }
            if (error.message?.includes('cidadaos_voterid_key')) {
                return json({ ok: false, error: 'Este título de eleitor já está cadastrado.' }, 409);
            }
            return json({ ok: false, error: 'Erro ao gravar no banco de dados.' }, 500);
        }

        return json({ ok: true });
    }

    return json({ ok: false, error: 'Ação inválida.' }, 400);
});

