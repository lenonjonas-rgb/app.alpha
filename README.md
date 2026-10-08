# Alpha Tec

Primeira entrega do sistema independente de gestao de assistencia tecnica.

## Executar

Requisito: Node.js 22.12 ou superior. Ambiente verificado com Node.js 24.

Na raiz deste projeto:

```powershell
npm --prefix app install
npm --prefix app run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Endereco: http://127.0.0.1:5173/

A tarefa `Alpha Tec: servidor local` tambem esta disponivel no VS Code.

## Verificar

```powershell
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
```

## Entrega 0.1

- Agenda em mes, semana, dia e lista; filtros, busca e criacao de OS por data.
- Clientes e equipamentos: cadastro e edicao com associacoes validadas.
- OS: cadastro, edicao, agendamento, prioridade, tecnico, status, relato e historico.
- Conflitos de horario do mesmo tecnico bloqueados no formulario de OS.
- Produtos e servicos: cadastro, edicao, precos, custos e alerta de estoque minimo.
- Estoque: entradas/saidas manuais, motivo, historico e bloqueio de saldo negativo.
- Orcamentos: itens, quantidades, desconto em reais, validade, status e geracao unica de OS apos aprovacao.
- OS e orcamentos com visualizacao de documento e estilos de impressao.
- Configuracoes da empresa, logo PNG/JPG/WebP de ate 1 MB e tecnico padrao.
- Backup JSON, importacao validada e recuperacao sem sobrescrever automaticamente dados invalidos.
- Layout adaptado a desktop e celular.

## Atualizacao 0.2 - Mais informacoes da OS

Abra uma OS na agenda ou na lista e escolha **Mais informacoes**. A nova tela possui nove areas: detalhes, relato/assinatura, anexos/fotos, questionarios, equipamentos, pendencias, controle de horas, envios e valores.

- Edicao em rascunho entre abas, com salvar/cancelar e protecao contra alteracao concorrente dos detalhes em outra aba.
- Relato independente das orientacoes, assinatura desenhada local e evidencias de data/nome.
- Fotos PNG/JPG/WebP e arquivos PDF/TXT de ate 500 KB por arquivo; armazenamento ainda local.
- Modelos de questionario e perguntas personalizadas; respostas obrigatorias geram pendencias quando vazias.
- Pendencias manuais resolviveis e questionarios associados a equipamentos.
- Deslocamento, check-in, pausa com motivo, retorno e check-out; totais e historico de alteracoes.
- Itens, desconto por item em reais, custos adicionais e desconto geral em reais ou percentual.
- Criacao/associacao de orcamento a OS do mesmo cliente.
- Replicacao sem copiar provas de execucao, arquivamento reversivel e link interno por OS.
- Impressao com os dados completos, independentemente da aba aberta.

22 testes de dominio e fluxos de navegador verificados. Os campos novos sao opcionais na base existente e o formulario de reagendamento preserva os detalhes. Veja `docs/OS_DETALHADA.md` para a matriz de referencia e limitacoes.

## Entrega 0.3 - Relatorios operacionais

- Dashboard com totais de tarefas, situacoes, pendencias, horas e quilometragem para os dados filtrados.
- Relatorios de tarefas e questionarios com filtros por periodo, cliente, colaborador e busca; respostas podem ser exportadas em CSV.
- Quilometragem por OS, com valor por km configuravel em Configuracoes e estimativa sem caracterizar faturamento.
- Despesas com cadastro, colaborador, tipo, data, valor, descricao e comprovante PNG/JPG/WebP/PDF/TXT de ate 500 KB; listagem, filtros e CSV.
- Apontamento de horas derivado da sequencia de atividades da OS, com modo parcial ou somente finalizadas com check-out.
- Relatorio de equipamentos com cliente, garantia, tarefas relacionadas e ultima visita registrada.
- Resumo financeiro operacional distingue valores registrados em OS e despesas; nao representa faturamento, recebimento ou conciliacao.
- Downloads CSV feitos no navegador. A tela informa que nao existe fila remota persistente nesta versao.
- Formatos antigos de backup permanecem compativeis; despesas e valor por km recebem valores padrao ao importar.

## Limites da versao local

Esta e uma versao local de validacao, nao um sistema pronto para producao.

Os dados ficam no `localStorage` do navegador, na chave `alpha-tec.database.v1`. Nao ha servidor, conta de usuario, sincronizacao entre dispositivos, criptografia ou backup remoto. Limpar os dados do navegador pode apagar os registros. Portas, navegadores e origens diferentes possuem bases diferentes. Use apenas dados ficticios nesta etapa e exporte backups antes de testar substituicoes da base.

Os relatorios de satisfacao nao possuem respostas ate existir um fluxo de convite e resposta. Monitoramento GPS, bateria e conectividade nao e coletado. A tela nao cria esses dados ficticiamente. A Central de downloads gera CSV local, sem fila de processamento no servidor.

## Fundacao de nuvem (preparada; nao conectada)

O codigo inclui um cliente Supabase Auth, provisionamento inicial de uma empresa sem registros de demonstracao, persistencia por empresa, protecao RLS e controle de concorrencia por revisao. A migracao fica em `supabase/migrations/20261008010000_tenant_auth_and_company_data.sql`. O deploy Vercel espera a pasta `app` como diretorio raiz e as variaveis de build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (ou a chave `anon` legada)

Para preparar um projeto Supabase, crie o projeto na sua conta e aplique as migracoes:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Crie a primeira conta autorizada no painel Supabase Auth, sem habilitar cadastro publico para esta etapa. Configure as duas variaveis acima no projeto Vercel, importe o repositorio `lenonjonas-rgb/app.alpha` e defina o diretorio raiz como `app`. A chave publishable/anon pode estar no frontend; nunca configure `service_role` como variavel `VITE_*` ou a inclua no Git. `.env.example` e somente um modelo sem credenciais.

**Ainda nao e uma aplicacao multiusuario de producao.** Este ambiente nao esta autenticado no Supabase/Vercel e nenhuma migracao ou deploy remoto foi executado. Somente membros `owner`/`admin` conseguem ler e gravar o documento da empresa; convites, gestao de membros, permissoes para tecnicos/gestores, recuperacao de senha, migracao dos dados locais, armazenamento seguro de anexos, limites/retencao e testes reais de isolamento ainda precisam ser implementados/validados. O armazenamento cloud atual e um documento JSONB de ate 5 MB por empresa, nao um modelo relacional normalizado; o cliente valida as regras de negocio, portanto nao se deve usar para registros operacionais reais antes de migrar as operacoes criticas e regras para o servidor.

Resend, email transacional, link de aprovacao por codigo e assinatura nao estao ligados. Nao envie dados reais nem considere este foundation como autorizacao para lancar a aplicacao a clientes.

Converter um orcamento cria uma OS com horario inicial padrao; revise o agendamento. A conversao nao baixa estoque. Marcacao de status `Enviado` apenas registra a situacao: nao envia email ou WhatsApp. `Imprimir` usa a impressao do navegador; nao gera arquivo PDF no servidor.

O logotipo enviado no chat nao estava disponivel como arquivo no projeto. A interface usa um wordmark provisório e permite carregar a imagem original em Configuracoes. Ao salvar, a imagem aparece no menu e nos documentos.

Envios reais, GPS, check-in automatico e confirmacao de recebimento no aplicativo nao estao conectados. A aba Envios registra somente preparacao/exportacao local, sem simular envio ao cliente. Links de OS abrem dados da mesma origem/navegador; nao sao links publicos. A assinatura local nao tem autenticacao de identidade, codigo de email ou validade juridica certificada. Arquivos locais consomem a cota do navegador; falha ao salvar nao substitui os dados persistidos.

## Estrutura

- `app/src/domain.ts`: tipos, esquemas, regras, valores monetarios em centavos e dados ficticios.
- `app/src/domain.test.ts`: testes de validacao, estoque, orcamentos e status de OS.
- `app/src/useDatabase.ts`: persistencia, sincronizacao entre abas da mesma origem e geracao de arquivos.
- `app/src/Forms.tsx`: formularios e movimentacao de estoque.
- `app/src/components.tsx`: modal, estados vazios e indicadores de status.
- `app/src/App.tsx`: navegacao, telas e documentos.
- `app/src/OrderWorkspace.tsx`: tela completa de OS, assinatura, questionarios, horas e documento de impressao.
- `app/src/App.css` e `index.css`: identidade e responsividade.
- `docs/MAPEAMENTO_FUNCIONAL.md`: referencia funcional observada no Auvo e suas lacunas.
- `docs/PLANO_DE_ENTREGAS.md`: roteiro de validacao e proximas etapas.
- `docs/OS_DETALHADA.md`: complemento do mapeamento da tarefa existente e adaptacao implementada.

FullCalendar e seus modulos estao alinhados na serie 6.1.21. Fontes e icones sao fornecidos por dependencias locais, sem carregamento de CDNs.