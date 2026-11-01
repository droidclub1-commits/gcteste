# Atualização do sistema — 30/10/2026

Este pacote mantém o layout e a configuração de conexão do ZIP recebido. A instalação da função SQL e sua verificação transacional foram concluídas. Veja VERIFICACAO.md para os resultados dos testes.

## Instalação

1. Guarde o ZIP anterior e faça um backup do projeto Supabase pelo seu procedimento habitual. A exportação da versão anterior não cobre veículos, combustível e notas.
2. Teste primeiro em uma cópia do projeto/banco. No SQL Editor, execute `sql/000_diagnostico.sql` para conferir tipos das colunas, políticas e tabelas.
3. Execute `sql/001_salvamento_atomico.sql`. O script exige `cidadaos.id` UUID e RLS ativo em cidadãos e veículos. Se houver divergência, ele interrompe a instalação; não desative RLS para contornar o erro.
4. Publique TODOS os arquivos da pasta, mantendo `js`, `favicon` e demais subpastas. Não publique apenas `app.js`: há módulos novos e dependências entre eles. As pastas `tests` e `sql` e os arquivos de documentação podem ficar fora da hospedagem pública.
5. Recarregue o navegador sem cache. Teste administrador e cadastrador antes de liberar à equipe.

A partir desta versão, salvar cidadãos exige a nova função SQL. Se ela não estiver instalada, o formulário exibe uma mensagem e não tenta o método antigo que poderia apagar veículos. Nenhuma política RLS é criada ou ampliada por esta atualização.

## Alterações

- Cidadão e veículos são gravados numa única transação PostgreSQL, com rollback se qualquer operação falhar.
- Veículos existentes mantêm seus IDs; somente os removidos no formulário são excluídos. Uma falha ao carregar os veículos bloqueia o envio do cadastro.
- A autoria `user_id` do cidadão existente é preservada. O usuário que edita não assume automaticamente a propriedade do cadastro.
- Tela, CSV e impressão compartilham os filtros, inclusive idade não informada e faixas etárias com limites corrigidos.
- As exportações de cidadãos, cobertura e relatórios completos de combustível percorrem todas as páginas. A cobertura por liderança não corta em 5 mil registros.
- O dashboard busca cidadãos e demandas independentemente dos filtros das listagens. Gráficos e aniversariantes usam a base visível completa. Em erro de leitura, o total aparece como indisponível, em vez de zero.
- O gráfico de bairros agrupa município e bairro e não depende de uma função SQL externa para calcular seus valores.
- Campos dinâmicos foram protegidos nas telas de veículos, combustível, cobertura, família e notas; avisos usam texto e fotos são montadas com elementos DOM.
- CSVs neutralizam entradas que poderiam ser interpretadas como fórmulas pelo Excel.

## Escopo do backup JSON

O JSON de versão 2 inclui as linhas visíveis de `cidadaos`, `demandas`, `notes`, `veiculos`, `cotas_combustivel` e `profiles`, além do conteúdo base64 das fotos referenciadas do bucket `fotos-cidadaos`. O manifesto informa contagens, horários e exclusões.

- As permissões do banco continuam valendo. Mesmo um administrador da aplicação só exporta o que suas políticas RLS permitem consultar. Verifique se elas dão a visibilidade esperada.
- Imagens de outros sites ficam apenas como referências externas no manifesto, e a interface avisa que há ressalvas. Se uma foto do próprio sistema falhar ao baixar, nenhum arquivo parcial é gerado.
- Há um limite de 100 MB de fotos antes da codificação. Acima disso, é necessário backup de Storage no servidor; a exportação no navegador é interrompida com mensagem.
- As tabelas são consultadas sequencialmente: não há snapshot transacional entre tabelas. Pause cadastros, edições e exclusões enquanto exporta.
- Não inclui senhas/contas Supabase Auth, políticas, funções SQL, configuração do projeto ou arquivos de Storage sem referência. Um backup de recuperação integral do projeto deve ser feito no servidor.
- CSV é apenas uma exportação de cidadãos, sem os outros módulos e sem fotos.
- O histórico local registra a geração do download, não comprova que o arquivo foi guardado ou validado posteriormente.

Não foi acrescentado um botão de restauração automática. Para restaurar o JSON, um administrador técnico deve validar o esquema, recuperar contas de acesso por seu backup próprio, importar registros mantendo IDs e relações e repor `files[].base64` nos caminhos originais do bucket. Faça isso primeiro em uma cópia do projeto. Sem a estrutura SQL e as funções de servidor originais, não é possível garantir a recuperação integral apenas com este pacote.

## Roteiro de conferência no banco real

- Criar um cidadão sem veículos; criar outro com carro e moto.
- Editar apenas um modelo e confirmar que os IDs dos veículos não mudam.
- Adicionar e remover um veículo; conferir que os demais permanecem.
- Em homologação, provocar erro de constraint num veículo e confirmar que nem o cidadão nem os veículos foram parcialmente alterados.
- Confirmar o bloqueio de edição dos registros de outra pessoa conforme as políticas do cadastrador.
- Testar edição por administrador e confirmar que `user_id` do criador é preservado.
- Comparar contagens da tela, CSV e impressão em cada faixa etária, inclusive N/A.
- Exportar JSON; conferir `manifest.counts`, presença de veículos, combustível, notas e fotos.
- Testar com mais registros que o limite de resposta do Supabase, para confirmar paginação no seu ambiente.

## Limitações mantidas

- O reset pós-eleição continua apagando combustível. Não o execute sem backup verificado; arquivamento por campanha é uma evolução posterior.
- Combustível continua ligado ao cidadão, sem atribuição por veículo, aprovação ou controle de saldo.
- A listagem geral de cotas continua limitada aos últimos 500 lançamentos; histórico individual e relatório por liderança buscam todos.
- O mapa global mantém o limite de 5 mil pontos. Não o utilize como conferência do total de cadastros.
- Não houve revisão das Edge Functions nem das políticas RLS existentes: esses códigos não vieram no ZIP.
- O upload da foto é uma operação de Storage anterior à transação SQL. Se a gravação no banco falhar, pode restar uma foto sem referência no bucket; isso não apaga a foto anterior.
- O salvamento atômico impede gravação parcial, mas não oferece comparação de versões de formulários abertos simultaneamente. A última gravação pode substituir alterações de outro editor.

## Verificação local

Instale as dependências de desenvolvimento com `npm ci`. Execute `npm test`, `npm run test:sql` e `npm run test:dom` com Node.js. Os testes SQL usam PostgreSQL isolado via PGlite com esquema e políticas simulados; os de DOM usam LinkeDOM, sem navegador real. Os testes cobrem paginação com limite reduzido do servidor, erros parciais, idade, filtros, CSV e composição do backup. O script `tests/browser-check.cjs` (`npm run test:browser`) é uma conferência adicional com dados simulados e exige instalar Playwright (`npm install --no-save playwright`) e Chromium (`npx playwright install chromium`). Nenhum teste usa dados reais.

## Combustível: acesso exclusivo do administrador

Aplique também `sql/002_combustivel_somente_admin.sql` antes de publicar esta atualização. Menu, histórico, lançamentos e relatórios de combustível são exclusivos do administrador. A regra também é aplicada no banco, inclusive contra acesso direto à API. Os acessos dos demais módulos não são alterados.
