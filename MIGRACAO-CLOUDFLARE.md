# Migração gratuita para Cloudflare Pages

## Publicação configurada

- Endereço principal: https://gestorcidadao.pages.dev
- Projeto Pages principal: `gestorcidadao`.
- Endereço anterior preservado: https://gestor-cidadao-danillo.pages.dev (projeto renomeado no painel para `gestor-cidadao`). Os dois projetos continuam ligados à mesma branch e ao mesmo Supabase; não são bases separadas.
- Repositório conectado: `droidclub1-commits/gcteste`, branch `main`.
- Build: `npm run build`; saída `dist`; Node 22; instalação de dependências desativada.
- Publicação automática de produção ativa; previews automáticos desativados.
- Publicação estática, sem Pages Functions ou contratação de plano pago.
- Verificados via HTTP: página inicial, cadastro público, privacidade, módulos e ícone; arquivos SQL, testes, package.json e este guia retornam 404 no site publicado.
- O banco, as contas e as fotos continuam no mesmo Supabase. É necessário entrar novamente no endereço novo.
- A mudança do repositório para privado e a desativação do GitHub Pages ainda precisam ser concluídas nas configurações do GitHub; os recursos disponíveis nesta integração não oferecem esses ajustes administrativos. O endereço antigo foi mantido até essa etapa. Novas publicações continuam sendo verificáveis pelo painel Cloudflare.

Este procedimento muda a hospedagem da interface. O banco, as contas, as fotos, as funções e as regras de acesso continuam no mesmo projeto Supabase. Nenhuma assinatura, domínio pago, Workers Paid ou outro produto pago é necessário para esta migração.

## 1. Preparar o código

Use o repositório `droidclub1-commits/gcteste`, branch `main`, com `scripts/build-site.mjs` e o comando `build` do package.json. Para conferir no computador, instale Node.js 22 ou superior, abra a pasta do projeto e execute:

```sh
npm run build
```

A pasta `dist` é gerada com a interface, módulos JavaScript e ícones. O build não precisa instalar dependências. Nunca publique a raiz inteira do repositório: scripts SQL, testes, documentação, arquivos do projeto e dependências ficam fora de `dist`. A chave anon/publicável do Supabase no cliente é pública; senhas e chaves service_role nunca devem ir para a interface.

## 2. Conectar o Cloudflare ao GitHub

1. Acesse https://dash.cloudflare.com/ e escolha sua conta.
2. Abra **Workers & Pages > Create application > Pages**. Escolha a opção de importar/conectar um repositório Git existente. Evite selecionar uma implantação de Worker, pois este projeto usa Pages estático.
3. Se solicitado, instale/autorize o aplicativo **Cloudflare Workers and Pages** no GitHub. Selecione apenas o repositório `gcteste`.
4. Escolha o repositório e configure:

| Campo | Valor |
|---|---|
| Nome do projeto | Um nome disponível para seu endereço `nome.pages.dev` |
| Branch de produção | `main` |
| Framework | `None` / nenhum |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Raiz do repositório; deixe em branco |
| Variável `SKIP_DEPENDENCY_INSTALL` | `true` |
| Variável `NODE_VERSION` | `22` |

5. Desative publicações automáticas de branches de preview se não precisar delas. Mantenha a publicação automática de `main` ativa.
6. Salve e publique. Use o endereço gratuito `https://nome.pages.dev`; não compre um domínio ou plano para esta etapa.

Não coloque senhas do Supabase nem chaves administrativas nas variáveis do build. O projeto atual mantém os endpoints e a chave pública de cliente em `js/config.js` e `cadastro-publico.js`. Não altere essas conexões ao apenas mudar a hospedagem.

## 3. Conferir a nova publicação

1. Abra o endereço `pages.dev` e confirme a tela de login e a identificação da campanha.
2. Entre usando sua conta existente. A sessão do endereço antigo não é transferida automaticamente: o navegador guarda a sessão por origem, por isso é necessário entrar novamente.
3. Confira os cadastros existentes, demandas e menus do seu perfil. Não restaure backups para fazer a migração da interface; o banco já é o mesmo.
4. Confira `cadastro-publico.html` e a página de privacidade. Gere novos links de liderança no novo endereço e atualize links divulgados anteriormente. Links antigos continuam apontando para o GitHub Pages e deixam de funcionar quando ele for desativado.
5. Confira se páginas, estilos, módulos JavaScript e ícones carregam sem erro.
6. Tente abrir `/sql/007_configuracao_campanha.sql`, `/tests/browser-check.cjs`, `/package.json` e `/MIGRACAO-CLOUDFLARE.md` no novo site: devem retornar 404. O arquivo 404.html evita que o Pages retorne a página principal para caminhos inexistentes.
7. O login atual usa e-mail/senha, sem redirecionamento. Se configurar convites, recuperação de senha ou OAuth no futuro, ajuste Site URL e Redirect URLs em **Supabase > Authentication > URL Configuration** para o endereço autorizado novo, preservando URLs ainda utilizadas. Não use curingas amplos desnecessários.

## 4. Tornar o repositório privado

Só depois de a publicação no Cloudflare estar validada:

1. No GitHub, abra o repositório e vá a **Settings > General > Danger Zone > Change repository visibility > Make private**.
2. Leia e confirme as consequências. No GitHub Free, a publicação GitHub Pages de repositório privado deixa de estar disponível. O Cloudflare permanece separado dessa hospedagem.
3. Confira em https://github.com/settings/installations se o aplicativo Cloudflare Workers and Pages continua autorizado a acessar o repositório privado.
4. Faça uma pequena atualização ou tente novamente a última publicação no Cloudflare para confirmar que ele ainda consegue ler o repositório.
5. Confira que o repositório aparece como **Private**. Repositório privado não recolhe cópias anteriormente baixadas nem esconde HTML/CSS/JavaScript que o navegador precisa receber.

Se quiser desativar o GitHub Pages explicitamente, use **Settings > Pages > Unpublish site** ou a opção de remover a publicação disponível no painel. Preserve o histórico do código e o repositório. Não exclua o banco Supabase ou seus arquivos de Storage.

## 5. Atualizações e recuperação

Depois de conectado, alterações publicadas na branch `main` disparam um novo build no Cloudflare. O site anterior permanece servindo até a nova publicação estar pronta. Confira os logs em **Workers & Pages > seu projeto > Deployments**. Em falha de build, corrija o código e repita; em falha da interface após publicação, use a opção de rollback para uma implantação de produção que já funcionava. Rollback da interface não reverte o banco.

Para uma publicação manual por upload, execute `npm run build` e envie somente o conteúdo de `dist` pela opção de upload do Pages. Verifique a compatibilidade do modo Git/Direct Upload antes de criar outro projeto: não substitua a integração Git sem necessidade. Nunca envie um ZIP com a raiz do repositório inteiro.

## Custos e limites

Esta configuração usa a faixa gratuita do Pages e mantém o plano do Supabase existente. Nenhuma compra é necessária. Gratuidade não significa uso ilimitado de todos os produtos: acompanhe limites de builds no Pages e de banco, fotos e tráfego no Supabase. Não ative produtos ou planos pagos para concluir o procedimento. Backups e revisão de segurança continuam necessários, independentemente da hospedagem.

## Referências oficiais

- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/build-configuration/
- https://developers.cloudflare.com/pages/configuration/build-image/
- https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
