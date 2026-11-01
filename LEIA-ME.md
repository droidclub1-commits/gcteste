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

## Backup e restauração da aplicação

Instale também `sql/003_backup_restauracao.sql` antes de publicar esta versão. O administrador encontra as ações na página Backup.

1. **Baixar JSON:** lê os cinco módulos em um snapshot transacional e copia as fotos referenciadas. O formato v3 inclui verificadores SHA-256 de integridade.
2. **Conferir arquivo:** valida módulos, identificadores, vínculos, contagens e fotos. O servidor testa os tipos e constraints em uma execução revertida. A tabela compara quantidades atuais e futuras.
3. **Restaurar:** exige a marcação de ciência e o texto RESTAURAR. Substitui cidadãos, demandas, notas, veículos e combustível em uma única transação. Preserva IDs, autoria, datas e vínculos. Não importa perfis nem executa SQL do arquivo.
4. **Cópia anterior:** o estado dos registros imediatamente anterior à restauração fica em uma área privada do banco. A lista permite conferir e restaurar essa cópia pelo mesmo fluxo. Fotos anteriores não são apagadas.

As fotos recuperadas são enviadas para caminhos novos. Um bucket de fotos inexistente é criado privado; a interface usa URLs temporárias assinadas para exibir fotos internas. As políticas permitem ao administrador recuperar fotos e ao cadastrador visualizar as fotos de cidadãos aos quais tem acesso. Imagens externas continuam dependentes de seus sites de origem; o arquivo e a conferência avisam sobre essa limitação.

### Proteções e limites

- A restauração é exclusiva do administrador no servidor. Contas/senhas Auth, perfis, políticas, funções e configuração do projeto não são importados. Para recuperar um projeto perdido por completo, é necessário também o backup da infraestrutura e das contas de acesso.
- Os usuários referenciados pelo campo de autoria precisam existir no projeto de destino. A ausência é recusada pela constraint; não se transfere autoria silenciosamente ao administrador.
- Se os registros mudarem entre a conferência e a execução, a restauração é recusada. Reconfira o arquivo antes de tentar de novo.
- Falhas de constraint revertem a transação inteira. Falha de rede consulta o recibo da operação; se o resultado continuar incerto, a tela bloqueia nova execução e oferece Verificar operação.
- Fotos são preparadas antes da transação. Falhas de rede ou gravação podem deixar cópias sem referência no Storage. Elas são preservadas para não apagar fotos de uma operação que possa ter sido concluída. Não há exclusão automática de arquivos antigos.
- Limites no navegador: JSON de até 160 MB; até 100 MB de fotos no total; até 5 MB por foto, em PNG, JPEG, GIF ou WebP; registros de até 30 MB e até 50 mil linhas por módulo. Acima disso, use recuperação no servidor.
- Backups completos v2 são aceitos com aviso sobre ausência de checksum original. Arquivos legados sem todos os cinco módulos são recusados para impedir que uma exportação parcial apague os outros módulos.
- SHA-256 verifica integridade, não comprova a origem ou assinatura do arquivo. Use apenas arquivos sob seu controle.
- Cópias anteriores ocupam espaço no mesmo banco e são mantidas sem exclusão automática. Não substituem um JSON externo nem um backup integral do projeto.
- CSV contém somente cidadãos e não é aceito para restauração.

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
- Esta entrega não altera as Edge Functions. A restauração mantém a regra de combustível exclusivo do administrador.
- O upload da foto é uma operação de Storage anterior à transação SQL. Se a gravação no banco falhar, pode restar uma foto sem referência no bucket; isso não apaga a foto anterior.
- O salvamento atômico impede gravação parcial, mas não oferece comparação de versões de formulários abertos simultaneamente. A última gravação pode substituir alterações de outro editor.

## Verificação local

Instale as dependências de desenvolvimento com `npm ci`. Execute `npm test`, `npm run test:sql` e `npm run test:dom` com Node.js. Os testes SQL usam PostgreSQL isolado via PGlite com esquema e políticas simulados; os de DOM usam LinkeDOM, sem navegador real. Os testes cobrem paginação com limite reduzido do servidor, erros parciais, idade, filtros, CSV e composição do backup. O script `tests/browser-check.cjs` (`npm run test:browser`) é uma conferência adicional com dados simulados e exige instalar Playwright (`npm install --no-save playwright`) e Chromium (`npx playwright install chromium`). Nenhum teste usa dados reais.

## Combustível: acesso exclusivo do administrador

Aplique também `sql/002_combustivel_somente_admin.sql` antes de publicar esta atualização. Menu, histórico, lançamentos e relatórios de combustível são exclusivos do administrador. A regra também é aplicada no banco, inclusive contra acesso direto à API. Os acessos dos demais módulos não são alterados.

## Acompanhamento das demandas

Antes de publicar esta etapa, aplique `sql/004_demandas_acompanhamento.sql` após as instalações anteriores.

- Responsável é um nome livre de até 120 caracteres e pode identificar uma pessoa sem login. Esse campo não concede acesso a registros.
- Prazo é opcional. Demandas concluídas não são destacadas como atrasadas.
- Prioridade aceita Baixa, Normal, Alta e Urgente. Registros anteriores recebem Normal; responsável e prazo começam vazios.
- Nos detalhes, Editar acompanhamento permite alterar os campos e o status. Há filtros por responsável, prioridade e prazo e ordenação pelo prazo mais próximo. O painel resume atrasos, vencimentos do dia e urgências abertas.
- As gravações preservam a autoria original. Alterações e sua nota de acompanhamento ocorrem na mesma transação. Uma versão desatualizada é recusada para impedir que uma edição sobrescreva outra.
- As permissões de leitura e edição dos perfis permanecem as mesmas. Combustível continua exclusivo do administrador.
- Backups novos incluem os campos. Na restauração de arquivos anteriores, as demandas recuperadas recebem os valores padrão dos campos que ainda não existiam.

O histórico completo de alterações e exclusões do sistema continua como um item separado do checklist.
