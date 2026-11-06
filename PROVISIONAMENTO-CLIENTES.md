# Provisionamento automático de clientes

O proprietário inicia e acompanha cada instalação em **Utilizadores → Administração geral → Clientes**, no Gestor Cidadão central. Cada cliente recebe seu próprio projeto Supabase e seu próprio endereço no Cloudflare Pages. O nome curto `candidato1` sugere `gestorcidadao-candidato1.pages.dev`. O painel deve guardar e exibir o endereço efetivamente atribuído pelo Cloudflare.

## O que o piloto comprovou

- O Supabase criou o projeto **Cliente Piloto** (`eglcwqycebvsyptcpakh`) em São Paulo. O sistema atual continua apontando para **GV TESTES** (`gccxghayghuqrwdmtwnn`).
- O esquema foi instalado em um banco vazio com `sql/base_instalacao.sql` e os scripts SQL 001 a 009, em ordem. A tabela de acompanhamento do SQL 010 pertence ao projeto central.
- As funções `manage-users` e `public-cadastro` foram implantadas no piloto com verificação de JWT. O cadastro público por liderança funcionou e recusou envio sem consentimento. O cadastro administrativo foi verificado no banco em uma transação revertida. Os registros fictícios do teste público foram removidos.
- O build apontou o painel e o formulário público para o piloto usando `GC_CLIENT_SUPABASE_URL` e `GC_CLIENT_SUPABASE_ANON_KEY`. O build padrão manteve a configuração do sistema atual.
- O piloto foi publicado em [gestorcidadao-cliente-piloto.pages.dev](https://gestorcidadao-cliente-piloto.pages.dev). O Supabase confirmou o primeiro login do administrador. A ficha está registrada como **Ativo** no banco central, com o endereço confirmado e a referência do projeto.
- O piloto ocupa a segunda vaga gratuita da organização. Para ensaiar a criação de outro projeto do zero, confira a capacidade antes de iniciar.

## Etapas já executáveis

- `npm run build` gera a interface do cliente usando as duas variáveis públicas de conexão.
- `node scripts/upload-pages-assets.mjs dist` envia os arquivos com um token temporário do projeto Pages em `CF_PAGES_UPLOAD_JWT` e retorna o manifesto. Envie esse manifesto, a branch de produção e `dist/_headers` para o endpoint de criação do deployment do projeto registrado. Aguarde o status de publicação e confira a URL pública.
- Configure o Auth do projeto cliente com o endereço oficial do site e autorize a página `/primeiro-acesso.html` como retorno para convites e recuperação de senha. Configure a autenticação por convite e a política de senhas da instalação antes de enviar o e-mail.
- Para admitir contas por convite, bloqueie inscrições espontâneas com `disable_signup = true` na API de gerenciamento (ou `[auth] enable_signup = false` no CLI). Mantenha o provedor de e-mail ligado com `external_email_enabled = true` (no CLI v2, `[auth.email] enable_signup = true`; no v3, `enabled = true`). Desligar o provedor impede login e recuperação. Confira os dois estados em `/auth/v1/settings` e teste `/auth/v1/recover` antes da ativação.
- `node scripts/invite-client-admin.mjs` confere o site publicado, registra o convite e confirma o perfil do primeiro administrador. Use `GC_CLIENT_PROJECT_REF`, `GC_CLIENT_SITE_URL` e `GC_CLIENT_ADMIN_EMAIL` em ambiente privado com o CLI do Supabase autenticado. Uma nova execução para o mesmo convite registrado confirma o perfil sem enviar outro e-mail.

## Fluxo a implementar

| Etapa | Ação automática | Condição para avançar |
|---|---|---|
| Validar pedido | Receber nome, município, UF, nome curto e e-mail do primeiro administrador. Conferir a autorização do proprietário no servidor, reservar o nome curto e verificar a capacidade da organização. | Pedido único registrado. Qualquer contratação ou custo novo passa por aprovação explícita. |
| Criar banco | Criar o projeto Supabase e guardar a referência assim que o provedor responder. Aguardar o projeto ficar saudável. | O projeto registrado responde e é diferente do projeto central. |
| Preparar instalação | Aplicar o esquema e SQL 001–009, publicar as duas funções, gravar a identidade da campanha e conferir o bucket privado. | Configuração pública correta, funções ativas e banco isolado. |
| Publicar site | Gerar os arquivos com a URL e a chave pública do cliente. Criar o projeto Pages, publicar o build e guardar a URL confirmada. | Painel e formulário público respondem e apontam para o mesmo Supabase do cliente. |
| Preparar primeiro acesso | Configurar a URL de retorno do Auth, criar o primeiro usuário por convite e atribuir o perfil `admin` na instalação do cliente. | Convite aceito pelo provedor e perfil associado ao ID correto. |
| Confirmar ativação | Registrar o primeiro login bem-sucedido do administrador convidado. | Status **Ativo** e links da instalação e do cadastro público disponíveis. |

O botão **Criar instalação** inicia uma tarefa no servidor. A lista do painel mostra a etapa atual, a última atualização e uma mensagem de erro quando houver falha. A ação **Retomar** parte da última etapa confirmada, usando as referências salvas dos recursos. Se uma chamada de criação perder a resposta, reconcilie o recurso no provedor antes de tentar criá-lo novamente. O envio de um novo convite deve ser uma ação separada quando já houver um convite registrado.

Os tokens dos provedores ficam no servidor. O navegador recebe somente os dados do painel e as credenciais públicas da instalação. Cada build precisa de uma área de saída própria para que duas tarefas simultâneas não publiquem os arquivos uma da outra.

## Próximo teste

O piloto está **Ativo**. Para testar a criação de um projeto vazio, confirme a capacidade disponível antes do ensaio.

### Habilitar o executor

1. Aplique o SQL 011 apenas no projeto central, depois do SQL 010.
2. No repositório GitHub, configure as variáveis `GC_CONTROL_PROJECT_REF` (projeto central), `GC_SUPABASE_ORGANIZATION` (slug da organização) e `GC_CLOUDFLARE_ACCOUNT_ID`. Configure os segredos `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` (edição no Pages) e `GC_CLIENT_SMTP_JSON` (objeto com `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email` e `smtp_sender_name`, todos como texto).
3. Ative `GC_PROVISIONING_ENABLED=true`. O workflow consulta a fila a cada dez minutos e também pode ser iniciado manualmente. Mantenha `GC_ALLOW_PAID_PROJECTS` desativada até aprovar a criação de projetos em uma organização paga.
4. Em **Clientes**, cadastre a ficha e clique em **Criar instalação**. Use **Atualizar etapas** para acompanhar e **Retomar instalação** em caso de falha. O executor registra o primeiro acesso automaticamente quando consulta um convite pendente.

Para um ensaio interno, `GC_TEAM_PILOT_EMAIL` pode substituir a configuração SMTP para um único endereço que já faça parte da equipe da organização Supabase. O executor só usa essa exceção se o e-mail da ficha corresponder exatamente ao endereço autorizado. Para clientes externos, configure SMTP próprio.

