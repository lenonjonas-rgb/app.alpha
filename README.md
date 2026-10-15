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
- Clientes: cadastro e edicao; ao informar um CNPJ valido, consulta automatica dos dados publicos disponiveis (nome, telefone, e-mail e endereco). CPF recebe validacao de digitos; consulta de dados pessoais exige um provedor autorizado e nao e feita por uma API publica aberta.
- Equipamentos: cadastro e edicao com associacoes validadas.
- Catalogo opcional de marcas e modelos, independente das unidades fisicas dos clientes, reutilizavel em tarefas e orcamentos de montagem, manutencao ou outro atendimento.
- OS: cadastro, edicao, agendamento, prioridade, tecnico, status, relato e historico.
- Questionarios: catalogo reutilizavel com atualizacao automatica nas tarefas abertas, padrao por tipo de tarefa, respostas independentes por OS, fotos e assinaturas por pergunta.
- Na criacao/edicao de OS, o campo Cliente oferece sugestoes enquanto voce digita partes do nome, CPF ou CNPJ, ignorando acentos e pontuacao. Selecione por clique ou com setas e Enter; somente um cliente cadastrado selecionado pode ser salvo, e os equipamentos acompanham o cliente escolhido.
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

## Questionarios reutilizaveis

1. Abra **Cadastros > Questionarios > Novo questionario**. Informe titulo, cabecalho/rodape em texto simples e de 1 a 200 perguntas. Cada pergunta possui enunciado, descricao, tipo e obrigatoriedade.
   No editor, **Exigir preenchimento para fazer check-out** define se as perguntas obrigatorias bloqueiam a finalizacao. Desmarque para permitir check-out com o questionario incompleto. Editar o questionario atualiza tambem esta regra nas tarefas vinculadas nao finalizadas ou arquivadas. Modelos e tarefas anteriores sem esta opcao preservam o bloqueio original ate uma nova edicao do questionario.
2. Tipos: Texto, Area de texto, Numero, Escolha, Multipla escolha, Check, Sim ou Não, Data, Hora, Monetaria, CPF/CNPJ, Foto e Assinatura. Escolhas exigem pelo menos duas opcoes distintas, uma por linha. Perguntas podem ser reordenadas, duplicadas e excluidas.
   No tipo **Sim ou Não**, escolha **Exigir justificativa quando responder** (Sim ou Nao). Ao selecionar essa resposta, o tecnico ve uma caixa de texto obrigatoria e as opcoes **Tirar foto** e **Enviar imagem**, ambas opcionais. A justificativa vazia gera pendencia quando o questionario exige preenchimento para check-out; questionarios opcionais mantem a regra de nao bloquear finalizacao. Rascunhos incompletos podem ser salvos. Trocar para a outra resposta limpa o texto e o vinculo da foto dessa justificativa, sem remover o anexo da OS. Respostas, justificativas e fotos aparecem tambem na administracao, impressao e relatorios/CSV. Replica de OS limpa esses dados de execucao, preservando a resposta que exige justificativa.
3. Configure apresentacao na OS: visibilidade, 1 a 4 perguntas por linha, pergunta/resposta na mesma linha, perguntas sem resposta e habilitacao de resposta por equipamento. Cabecalhos e rodapes nao aceitam HTML; nao ha Central do Cliente nesta versao.
4. No catalogo, defina o questionario padrao e a obrigatoriedade para cada tipo de tarefa. Na **Nova OS**, selecionar o tipo preenche o modelo, permitindo substitui-lo. OS criadas por conversao de orcamento tambem recebem o padrao de Corretiva.
5. Em **Mais informacoes > Editar informacoes > Questionarios**, adicione modelos gerais ou escolha um modelo por equipamento associado. Perguntas avulsas continuam disponiveis. Editar o questionario no catalogo atualiza as instancias vinculadas em tarefas abertas, em atendimento ou pausadas, sem criar outro questionario. Tarefas finalizadas e arquivadas preservam sua estrutura original; ao replicar uma tarefa, a nova OS usa o cadastro atual dos questionarios ativos, sem respostas. Duplicatas por equipamento precisam ser resolvidas antes de replicar a tarefa. Respostas sao preservadas pelo identificador da pergunta quando o tipo permanece igual; perguntas novas ou com tipo alterado comecam vazias, perguntas removidas deixam a tarefa, e opcoes removidas deixam de ser respostas validas. Fotos anexadas nao sao excluidas. A revisao interna permanece apenas para controle de concorrencia, nao como versoes selecionaveis. Cada equipamento possui no maximo um questionario por tarefa; instancias duplicadas antigas nao sao excluidas automaticamente para evitar perda de respostas.
6. Com questionarios associados, a aba **Relatorio** do tecnico mostra somente esses questionarios, sem relato padrao, quilometragem, anexos gerais ou assinatura geral. As perguntas iniciam recolhidas, mostrando apenas o titulo e a indicacao de obrigatoriedade; toque no titulo para abrir ou fechar os campos de resposta. Recolher uma pergunta nao apaga a resposta nem altera as pendencias. Sem questionario, mostra o relatorio padrao com esses campos. Dados padrao ja salvos sao preservados mesmo quando ficam ocultos. O tecnico preenche as perguntas, salva e sincroniza antes de registrar atividades. Cada pergunta de assinatura nova coleta seu proprio desenho e nome; a assinatura geral da OS nao responde automaticamente a essas perguntas. Fotos sao vinculadas individualmente a perguntas.

Cada vinculo armazena uma copia do modelo e de sua versao dentro da tarefa. Edicao, duplicacao, arquivamento ou restauracao do catalogo nao altera tarefas existentes. Arquivar remove o modelo dos padroes por tipo, mantendo a obrigatoriedade e o historico; a tarefa pode receber outro modelo. Replica de OS limpa respostas, fotos e assinaturas, preservando a estrutura. Backup JSON inclui catalogo e padroes; backups antigos sem esses campos continuam abrindo. Assinaturas de questionarios legados preservam o vinculo anterior com a assinatura geral.

Respostas numericas, datas, horas, CPF/CNPJ, opcoes, referencias de fotos e assinaturas sao validadas inclusive em questionarios opcionais. Salvar rascunhos incompletos e permitido; perguntas obrigatorias geram pendencias apenas nos questionarios que exigem preenchimento para check-out. Pendencias manuais e a exigencia de associar um questionario pelo tipo de tarefa continuam bloqueando o check-out independentemente dessa opcao. Novas tarefas com configuracao de questionario tambem bloqueiam finalizacao manual com pendencias; a regra antiga de finalizacao administrativa de tarefas legadas e preservada.

A opcao de carimbo na foto exige GPS no momento do upload e grava coordenadas, precisao, data/hora da captura no desenho da imagem. Nao permite substituir a resposta por um anexo sem passar pelo preparo da foto. Trata-se de localizacao informada pelo dispositivo no momento do upload, nao de certificacao de presenca ou da data original da fotografia. Os limites de 500 KB por anexo e 5 MB por empresa continuam aplicando-se.

Relatorios/CSV identificam equipamento, mostram nome do arquivo de foto e assinante em vez de IDs internos. A impressao da OS inclui cabecalho, rodape, fotos e assinaturas por pergunta, respeitando a apresentacao do questionario na tarefa.

## Marcas, modelos e unidades dos clientes

Em **Equipamentos > Catalogo de marcas e modelos**, crie uma **Nova marca** e selecione-a. Dentro da marca, use **Novo modelo** para cadastrar nome, categoria e observacoes. Marcas e modelos podem ser editados, arquivados e restaurados. Arquivar impede novas selecoes, sem apagar unidades, tarefas ou orcamentos existentes.

O modelo tambem possui **Linha**, independente da categoria (ex.: marca Konnen, linha Cardio, modelo Esteira E8, categoria Esteiras). Digite uma linha nova ou escolha uma sugestao ja utilizada na marca. Os seletores de catalogo seguem marca > linha > modelo; modelos antigos sem linha continuam acessiveis por **Sem linha cadastrada**.

Em **Clientes**, clique no nome do cliente ou em **Vincular equipamento / historico** para abrir seu cadastro. Use **Vincular equipamento**, selecione marca e linha e marque os modelos da lista com suas quantidades. Cada unidade e criada em uma linha separada: quantidade 2 de Esteira E8 gera duas entradas, cada uma com codigo aleatorio `EQ-<UUID>`, validado contra os equipamentos de todos os clientes da empresa. O catalogo permanece compartilhado; o mesmo modelo pode ser vinculado novamente ao mesmo cliente ou a outros clientes. Os codigos nao sao editaveis e sao preservados no backup e na sincronizacao. Unidades antigas mantem seus identificadores; novos cadastros manuais tambem recebem codigo unico.

No cadastro do cliente, **Historico** de cada unidade mostra tarefas em que ela foi selecionada como equipamento principal ou associado, com data, tecnico, tipo, situacao, solicitacao, relato e respostas de questionarios daquela unidade ou gerais da tarefa. Tarefas arquivadas tambem aparecem. Tarefas em andamento sao identificadas como nao finalizadas; o sistema nao inventa manutencoes quando nao ha relato. Questionarios gerais sao identificados como tal. O botao da tarefa abre o atendimento completo.

Use **Criar tarefa** ao lado de uma unidade para preencher automaticamente cliente e equipamento. Tambem e possivel selecionar a unidade pelo codigo ao criar/editar uma OS ou associa-la em **Mais informacoes > Equipamentos**. Selecionar apenas um modelo generico do catalogo nao atribui manutencao a todas as unidades daquele modelo: o historico individual exige o vinculo da unidade correta. A selecao continua opcional.

Na criacao da OS, ao escolher um cliente com unidades cadastradas, o botao **Equipamentos** abre a lista completa com caixas de selecao e **Selecionar todos**. Para cada unidade marcada, escolha seu questionario; podem ser modelos diferentes ou o mesmo modelo com respostas independentes. O padrao do tipo de atendimento e sugerido quando permite resposta por equipamento. Apenas questionarios ativos com essa opcao habilitada aparecem. Com unidades selecionadas, o questionario e criado por unidade, sem duplicar um questionario geral na tarefa. Sem unidades, o questionario geral continua disponivel. Trocar o cliente limpa a selecao. Na edicao, questionarios e respostas existentes sao preservados; a remocao de uma unidade com questionario exige ajustar o vinculo em **Mais informacoes** primeiro.

- **Unidade do cliente:** em **Novo equipamento**, a escolha de marca/modelo e opcional. Ao selecionar o modelo, nome e categoria sao preenchidos; informe o identificador/numero de serie e o cliente. E possivel cadastrar varias unidades do mesmo modelo, com series distintas, ou continuar cadastrando equipamentos manualmente, sem catalogo.
- **Tarefa e orcamento:** na criacao/edicao, use **Equipamentos do catalogo (opcional)**, selecione marca e modelo e clique em **Incluir modelo**. Informe quantidade e finalidade (Montagem, Manutencao ou Outro). Voce pode incluir varios modelos, sem exigir uma unidade fisica previamente cadastrada no cliente. A OS continua permitindo tambem o equipamento especifico do cliente e associacoes adicionais em **Mais informacoes > Equipamentos**.
- Modelos indicam quais equipamentos serao atendidos; nao geram valores ou itens financeiros automaticamente. No orcamento, inclua produtos/servicos normalmente. Ao gerar a OS de um orcamento aprovado, os modelos, quantidades e finalidades sao copiados. A replica da OS preserva essa selecao sem copiar provas de execucao.
- As selecoes aparecem nos documentos/impressao da OS e do orcamento, na exportacao textual da OS e nos detalhes do app tecnico. Nome/marca/categoria ficam registrados como uma copia no vinculo para preservar o historico; editar o catalogo nao renomeia automaticamente unidades ou documentos ja criados. Para substituir um modelo selecionado, remova-o e inclua o novo.
- As novas colecoes e selecoes iniciam vazias em bases antigas e fazem parte do backup JSON e do payload da empresa. Nao e necessaria migracao SQL: o tecnico recebe os dados dos modelos vinculados nas tarefas/unidades, sem acesso ao catalogo completo. A selecao de modelo nao cria nem altera automaticamente o cadastro do cliente.

No cadastro do modelo em **Catalogo de marcas e modelos**, selecione o **Questionario padrao do equipamento**. Apenas questionarios ativos com resposta por equipamento podem ser vinculados. Ao selecionar uma unidade na Nova OS (inclusive **Selecionar todos** ou **Criar tarefa** pelo cliente), o padrao e consultado no modelo atual, inclusive para unidades vinculadas anteriormente. Cada unidade recebe suas proprias respostas. A escolha pode ser alterada somente naquela OS, sem mudar o catalogo. Sem padrao do modelo, permanece a sugestao compativel do tipo da tarefa; a escolha manual continua disponivel. Arquivar o questionario remove seu uso como padrao nos modelos, mas preserva os questionarios das tarefas. Para desabilitar resposta por equipamento, remova primeiro seus vinculos nos modelos.

Alterar o padrao do modelo nao modifica tarefas existentes, suas respostas ou escolhas manuais. Editar as perguntas do proprio questionario continua atualizando suas instancias nas tarefas abertas conforme as regras acima.

Cada unidade pode ter **apenas um questionario de manutencao por tarefa**, independentemente do modelo. Na edicao da OS ou em **Mais informacoes > Questionarios > Adicionar questionario**, escolher outro modelo para uma unidade ja atendida substitui o atual, apos confirmacao, sem criar outra manutencao. Modelos novos comecam sem respostas; se o modelo escolhido ja estiver vinculado, suas respostas sao preservadas. Outros equipamentos e arquivos anexados permanecem intactos. Reatribuir um questionario a uma unidade que ja possui outro e bloqueado.

Duplicatas antigas continuam legiveis, sem exclusao automatica de respostas. Ao editar, aparece um aviso: use **Manter somente este questionario** no vinculo correto e salve; somente os outros questionarios daquela unidade sao removidos, apos confirmacao. Alternativamente, escolha o modelo correto no editor da OS para consolidar os vinculos. Se houver duas instancias do mesmo modelo com respostas diferentes, escolha explicitamente qual manter. A edicao nao pode ser salva enquanto restarem duplicatas por equipamento. Questionarios gerais (sem equipamento) continuam podendo ter modelos distintos; nao representam outra manutencao da unidade. O campo **Questionario geral da tarefa** substitui o vinculo geral selecionado, sem alterar equipamentos.

## Modelos de relatorio de atendimento

Em **Configuracoes > Relatorios de atendimento**, escolha um dos tres estilos proprios: **Tabelado**, **Limpo** ou **Marca-d'agua**. A marca-d'agua utiliza a logo da identidade da empresa; sem logo, utiliza o nome da empresa. Configure titulo, tamanho do texto, ordem dos questionarios (tarefa, nome ou codigo do equipamento) e as secoes visiveis. A pre-visualizacao usa uma OS existente e reflete as alteracoes ainda nao salvas. Clique em **Salvar configuracoes de relatorio** para aplicar.

O mesmo conteudo configurado e utilizado na impressao da OS resumida, na impressao em **Mais informacoes** e na exportacao textual em **Envios**. Para gerar PDF, utilize **Imprimir > Salvar como PDF** no navegador. A exportacao TXT inclui apenas texto; nao incorpora imagens. Orcamentos e relatorios gerenciais (dashboard, CSV etc.) continuam com suas apresentacoes e filtros independentes.

E possivel ocultar dados da empresa, dados do cliente/endereco, agendamento/tecnico, orientacoes, relato, equipamentos, questionarios, pendencias, horas/localizacao, valores, orcamentos, fotos, outros anexos e assinaturas. As secoes ocultas nao sao renderizadas no documento; fotos e assinaturas tambem sao omitidas dos questionarios quando desabilitadas. Ocultar valores remove os totais dos orcamentos vinculados. Textos livres, nomes de arquivos e anexos podem conter informacoes digitadas manualmente: revise o documento antes de compartilhar. Estas opcoes nao sao permissoes de acesso e nao ocultam os dados das telas operacionais.

Configuracoes antigas recebem o modelo Limpo e todas as secoes habilitadas, preservando os dados das OS. As preferencias fazem parte do backup e do payload sincronizado da empresa; nao exigem migracao SQL. Alterar o modelo nao altera respostas, assinaturas ou fotos e nao faz envio de email nem cria links publicos. Nenhum recurso comercial, imagem ou arquivo do Auvo foi copiado.

## Endereco e responsavel pelo atendimento

Na criacao e edicao da OS, selecionar o cliente exibe seu endereco cadastrado. A caixa **Atendimento no endereco cadastrado do cliente** vem marcada; desmarque para informar outro local. Digitar os oito digitos do CEP consulta o ViaCEP e preenche logradouro, bairro, cidade e UF. Informe o numero (ou S/N) e o complemento, se houver. CEPS gerais podem nao trazer logradouro; os campos permanecem editaveis e falhas da consulta sao exibidas, com opcao de tentar novamente ou preencher manualmente.

Nome e telefone do responsavel sao opcionais e independentes dos contatos do cliente. O endereco de atendimento e o responsavel sao salvos na OS, aparecem nos detalhes e na impressao/exportacao do documento; no app tecnico, Google Maps e Waze usam o local do atendimento e ha um link para ligar ao responsavel. Tarefas antigas sem local especifico continuam usando o endereco do cliente. Nao e necessaria migracao SQL para estes campos no payload JSON.

O app tecnico consulta atualizacoes automaticamente a cada 15 segundos enquanto esta visivel e ao recuperar o foco, sem sobrescrever rascunhos ou arquivos em preparo. Com alteracoes nao salvas, salve ou descarte o rascunho antes de sincronizar; o controle de concorrencia impede enviar respostas sobre uma estrutura desatualizada. A atualizacao exige conexao e o salvamento da empresa na nuvem.

**Publicacao:** aplique, em ordem, `supabase/migrations/20261010010000_questionnaires.sql`, `supabase/migrations/20261011010000_questionnaire_checkout_requirement.sql` e `supabase/migrations/20261011020000_yes_no_question_justification.sql` antes de publicar o frontend atualizado. Execute somente as migracoes ainda nao aplicadas; a nova migracao atualiza a RPC sem modificar os dados existentes. A RPC valida as respostas e impede o tecnico de modificar a estrutura, a obrigatoriedade ou a resposta que exige justificativa definida pelo gestor; horarios de assinaturas novas sao definidos pelo servidor. O catalogo completo nao e projetado para o tecnico, somente os questionarios das tarefas atribuidas. As migracoes nao copiam modelos ou dados do Auvo.

No navegador, contas Master e Administrativo sao encaminhadas ao painel de gestao mesmo ao abrir um link com `?tecnico=1`. O perfil e consultado na empresa antes de carregar o portal; falhas exibem uma mensagem e permitem tentar novamente. Contas de tecnico continuam no portal de atendimento, independentemente do tamanho da tela. O aplicativo Android preserva sua interface dedicada.

## Fundacao de nuvem

O codigo inclui um cliente Supabase Auth, provisionamento inicial de uma empresa sem registros de demonstracao, consulta automatica do CNPJ pela BrasilAPI com fallback para CNPJ.ws, persistencia dos dados cadastrais retornados, protecao RLS e controle de concorrencia por revisao. A consulta exige CNPJ com dígitos verificadores válidos e depende da disponibilidade e dos limites das fontes públicas. A migracao fica em `supabase/migrations/20261008010000_tenant_auth_and_company_data.sql`. O deploy Vercel espera a pasta `app` como diretorio raiz e as variaveis de build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (ou a chave `anon` legada)

Para preparar um projeto Supabase, crie o projeto na sua conta e aplique as migracoes:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Crie a primeira conta autorizada no painel Supabase Auth, sem habilitar cadastro publico para esta etapa. Configure as duas variaveis acima no projeto Vercel, importe o repositorio `lenonjonas-rgb/app.alpha` e defina o diretorio raiz como `app`. A chave publishable/anon pode estar no frontend; nunca configure `service_role` como variavel `VITE_*` ou a inclua no Git. `.env.example` e somente um modelo sem credenciais.

O painel usa Supabase Auth e esta publicado na Vercel. Somente membros `owner`/`admin` conseguem ler e gravar o documento completo da empresa. A migracao Android adiciona vinculos de tecnicos, projecao das tarefas atribuidas e operacoes restritas no servidor; nao concede leitura do JSONB inteiro aos tecnicos. Convites automaticos, recuperacao de senha no app, migracao dos dados locais, armazenamento de anexos em Storage, limites/retencao e normalizacao relacional ainda nao estao implementados. O armazenamento cloud atual e um documento JSONB de ate 5 MB por empresa. Regras de edicao administrativa ainda dependem parcialmente da validacao do cliente; esta entrega continua sendo uma versao de validacao operacional.

Resend, email transacional, link de aprovacao por codigo e assinatura nao estao ligados. Nao envie dados reais nem considere este foundation como autorizacao para lancar a aplicacao a clientes.

Converter um orcamento cria uma OS com horario inicial padrao; revise o agendamento. A conversao nao baixa estoque. Marcacao de status `Enviado` apenas registra a situacao: nao envia email ou WhatsApp. `Imprimir` usa a impressao do navegador; nao gera arquivo PDF no servidor.

O logotipo enviado no chat nao estava disponivel como arquivo no projeto. A interface usa um wordmark provisório e permite carregar a imagem original em Configuracoes. Ao salvar, a imagem aparece no menu e nos documentos.

Envios reais, check-in automatico e confirmacao de recebimento no aplicativo nao estao conectados. O GPS pontual esta implementado no app Android, conforme a secao abaixo. A aba Envios registra somente preparacao/exportacao local, sem simular envio ao cliente. Links de OS nao sao links publicos. A assinatura desenhada nao tem autenticacao de identidade, codigo de email ou validade juridica certificada.

## App Android dos tecnicos

Aplicativo hibrido Capacitor 8, Android 7.0 ou superior, com interface dedicada em `https://app-alpha-theta.vercel.app/?tecnico=1`. O APK carrega a interface desse endereco HTTPS, recebendo as atualizacoes publicadas na Vercel. Os assets locais incluem uma tela de falha de conexao. **Internet e necessaria; nao ha fila offline e nenhum atendimento e registrado como sucesso antes de a RPC confirmar a gravacao.**

### Preparar contas e tarefas

1. Depois da migracao inicial, aplique `supabase/migrations/20261009010000_android_technicians.sql`, `supabase/migrations/20261009020000_technician_link_validation.sql` e `supabase/migrations/20261009030000_user_levels.sql`, nessa ordem. As migracoes incluem transacoes para nao deixar uma aplicacao parcial.
2. Publique a Edge Function `manage-users` do Supabase, conforme a secao de usuarios abaixo. O frontend nunca usa `service_role`.
3. No painel Alpha Tec, como Master, abra **Configuracoes > Usuarios e niveis**, informe nome, nivel Tecnico e senha inicial, e selecione **Criar usuario**. Contas Auth antigas ainda podem ser vinculadas na opcao **Vincular conta ja existente no Supabase**.
4. Ao criar ou editar uma OS, selecione a conta no campo **Tecnico**. Tarefas antigas com apenas nome em texto devem ser editadas para vincular uma conta; nao sao atribuidas automaticamente por coincidencia de nome.
5. Ao converter orcamento em OS, o editor abre para selecionar a conta e ajustar a agenda. Replicas de tarefas conservam a atribuicao.
6. O tecnico entra no APK com seu login `nome.aupha` e senha (contas antigas ainda aceitam e-mail). Tecnicos veem apenas tarefas atribuidas; contas de administrador veem todas as tarefas da empresa.

### Usuarios e niveis

- **Master** corresponde ao papel `owner` ja existente. Tem acesso completo, cria usuarios, vincula contas antigas e altera niveis. A conta Master nao pode ser rebaixada nem criada pelo formulario.
- **Administrativo** corresponde a `admin`. Pode operar o painel (agenda, clientes, equipamentos, orcamentos, estoque, relatorios e configuracoes da empresa), mas nao criar/vincular usuarios nem alterar niveis.
- **Tecnico** corresponde a `technician`. Recebe apenas a projecao das suas tarefas pelas RPCs mobile; nao pode ler o documento JSONB completo nem operar o painel administrativo. Ao entrar pelo site, e direcionado ao portal tecnico.
- O papel legado `manager` nao ganha acesso implicitamente; o Master pode ajusta-lo para um dos niveis suportados.

O login e globalmente unico e usa o primeiro nome sem acentos: `joao.aupha`, `joao2.aupha`, etc. A numeracao e reservada no banco sob trava, inclusive entre empresas; reservas falhas nao sao reutilizadas. Internamente, somente as contas novas usam o identificador Auth `login@users.aupha.invalid`, sem envio de e-mail para esse dominio. A conta Master existente continua com seu e-mail original.

O Master define uma senha inicial de 12 a 128 caracteres, que nunca e salva na base de cadastros nem retornada pela API. Cada usuario pode altera-la em **Alterar minha senha**, no painel ou app. Recuperacao automatica por e-mail nao esta disponivel para os logins sinteticos; uma senha esquecida deve ser redefinida pelo responsavel no Supabase Auth. A troca de senha inicial nao e obrigatoria nem forcada. Alteracoes de nivel sao impostas pelo servidor; o usuario deve recarregar/entrar novamente para atualizar a interface.

`userAccess.test.ts` testa login e o handler da Edge Function; `userLevelsServer.test.ts` executa as migracoes em PostgreSQL isolado e verifica os tres niveis, permissao de criacao, reservas, retry e protecao do Master. `node app\scripts\user-smoke.ts` disponibiliza respostas ficticias somente no loopback 5183 para validar a interface com `VITE_SUPABASE_URL=http://127.0.0.1:5183` e chave publica ficticia. Nao cria contas reais nem acessa producao; nao publique esse servidor.

Para publicar o backend com o Supabase CLI autenticado:

```powershell
supabase functions deploy manage-users --project-ref ippyxcxygatluaofuilk
```

`supabase/config.toml` desativa a verificacao JWT legada do gateway apenas nessa funcao para compatibilidade com as chaves atuais. A funcao **exige e valida** o Bearer token via Supabase Auth e a permissao Master no banco antes de executar qualquer operacao privilegiada. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sao disponibilizadas no ambiente privado das Edge Functions pelo Supabase; nao devem ser copiadas para variaveis `VITE_*`.

No editor do dashboard, publique `handler.ts` e `index.ts` da pasta `supabase/functions/manage-users` (ou seu conteudo combinado) e desative **Verify JWT with legacy secret** nessa funcao. Nunca habilite cadastro publico como substituto dessa operacao. Reservas usam identificador de operacao para evitar duplicacao no retry. Em erro de rede, confira a lista antes de repetir; falhas de limpeza da conta Auth sao apresentadas explicitamente para verificacao pelo Master.

### Recursos

- Dashboard com atalhos que filtram a agenda: tarefas de hoje, atrasadas (dias anteriores ainda nao finalizadas) e em execucao (atendimentos iniciados e pausados, independentemente da data). Sem atalho separado de concluidas.
- Inicio e agenda abrem somente com tarefas do dia atual. Na agenda por dia, use Dia anterior, Proximo dia e Hoje para consultar datas passadas e retornar ao dia atual; nao ha navegacao para datas futuras. Tarefas finalizadas continuam consultaveis na data agendada, mas nao aparecem em atrasadas ou em execucao.
- Detalhes do cliente, telefone, orientacoes, data, prioridade, equipamentos, tags, valores da OS e orcamentos associados.
- Navegacao por deep link no Google Maps ou Waze instalado, com fallback para a rota HTTPS no navegador; endereco ausente impede abrir a rota.
- Check-in inicia a tarefa (Em atendimento) e check-out a finaliza (Finalizada), com confirmacao do servidor; ambos solicitam localizacao apenas naquele momento. Pausas exigem motivo; retorno retoma a contagem antes do check-out. Nao ha permissao de localizacao em segundo plano ou rastreamento continuo.
- Horario de registro definido pelo servidor; coordenadas e precisao associadas ao evento. O GPS fornecido pelo dispositivo nao certifica presenca fisica e pode sofrer imprecisao.
- Cronometro calculado a partir dos eventos persistidos, excluindo pausas; continua correto ao reabrir o app e nao cresce apos o check-out.
- Relato, km, respostas dos questionarios definidos no painel, resolucao de pendencias, fotos/anexos e assinatura desenhada. Pendencias e respostas obrigatorias bloqueiam o check-out.
- Fotos de ate 15 MB sao reduzidas a JPEG para armazenar no maximo 500 KB. PDF/TXT seguem o limite de 500 KB; o limite total continua sendo 5 MB por empresa.
- Fotos aparecem no relatorio. No Android, o botao Compartilhar abre o seletor do sistema com uma copia do anexo no cache privado do app; no navegador, o link baixa o arquivo. Nao existe envio automatico por esse botao.
- Controle de concorrencia por revisao da empresa: um conflito exige sincronizacao explicita, sem sobrescrever o trabalho de outro usuario.
- A assinatura e armazenada na OS; envio de relatorio/link por e-mail ou WhatsApp ainda nao esta implementado.

### Compilar e instalar

Requisitos: Node.js 22.12+, JDK 21, Android SDK 36 e build-tools 36.0.0. Configure `JAVA_HOME` e `ANDROID_HOME` no terminal. Configure as variaveis publicas Supabase no build web e publique o painel/interface mobile antes de distribuir o APK.

```powershell
npm --prefix app install
npm --prefix app run android:apk
npm --prefix app run android:package
```

Saida: `app\android\app\build\outputs\apk\debug\app-debug.apk`.

O comando `android:package` copia o APK e seu SHA256 para `app\public\downloads`, permitindo baixar pelo endereco `/downloads/alpha-tec-tecnicos-debug.apk` depois do deploy Vercel. O empacotamento Android exclui a pasta de downloads e arquivos `.apk` dos assets, evitando embutir o download dentro do proprio APK em recompilacoes.

Esse e um **APK de teste, assinado com chave debug**, nao uma release pronta para a Play Store. Transfira ao Android e autorize a instalacao dessa origem. Ao registrar entrada/saida, permita localizacao precisa e confirme que o GPS esta ligado. Para distribuicao definitiva e necessario configurar uma chave release privada e protegida; arquivos de chave sao ignorados pelo Git.

Os testes `mobile.test.ts` e `mobileServer.test.ts` verificam tempo, GPS, compatibilidade de backups, revisao, RLS e RPCs com PostgreSQL isolado via PGlite. `node app\scripts\mobile-smoke.ts` disponibiliza fixtures ficticias em `http://127.0.0.1:5180`; nao aponta para o banco de producao. A validacao de GPS no navegador usa localizacao simulada; o teste em um aparelho Android real deve validar a permissao, camera e abertura dos aplicativos instalados.

## Deslocamento: rotas, cobranca e combustivel

Em **Configuracoes > Deslocamento, combustivel e assistencia**, cadastre o preco do combustivel em R$/litro, o rendimento do veiculo em km/litro, a tarifa cobrada em R$/km e o endereco de saida da assistencia. As coordenadas sao preenchidas automaticamente apos uma pausa de 1,2 segundo no preenchimento. Na criacao/edicao da OS, o mesmo ocorre com o endereco do cliente ou o endereco especifico completo do atendimento. Confira o ponto e salve o formulario; nao e preciso confirmar manualmente as coordenadas automaticas.

A busca aceita somente um resultado completo do Google, com precisao de edificio ou interpolacao de numero. Endereco nao encontrado, parcial, ambiguo ou aproximado exibe erro: complete o endereco, tente novamente ou marque o ponto manualmente. Os campos de endereco especifico devem estar completos. O endereco pode ser salvo mesmo durante a consulta ou sem coordenadas; alterar o endereco descarta respostas anteriores. Pontos ja salvos para o mesmo endereco sao preservados sem nova consulta. A busca automatica exige login administrativo Supabase.

Pontos automaticos sao conferidos em mapa Google; a selecao manual continua disponivel em mapa OpenStreetMap ou pelos campos latitude/longitude. A chave privada permanece no servidor.

Em **Mais informacoes > Editar informacoes > Valores**, calcule a rota para habilitar **Cobranca de deslocamento: Sim/Nao** e os **pedagios totais de ida e volta**. Salve as alteracoes da OS.

- Latitude/longitude nao sao obrigatorias para a rota: sem ponto confirmado para o endereco atual, o servidor envia o endereco salvo diretamente a Routes API, que faz a localizacao internamente. Nao depende da consulta separada a Geocoding API. Havendo um ponto confirmado para o mesmo endereco, ele continua sendo usado. Origem e destino podem combinar os dois modos; coordenadas de endereco antigo nao sao reutilizadas.
- Confira rua, numero, cidade, UF e CEP antes de salvar. A escolha do local pelo Google pode diferir da Geocoding API. A rota por endereco nao confirma o ponto GPS e nao cria coordenadas ficticias para check-in/check-out. Sem ponto confirmado, a distancia de monitoramento continua indisponivel.
- A Routes API do Google Maps calcula as duas pernas separadamente em modo carro, sem trafego em tempo real. O total e `(metros ida + metros volta) / 1000`, nao a distancia GPS em linha reta.
- Custo de combustivel: `(km totais / km por litro) x preco por litro`. Custo interno total: combustivel + pedagios, independentemente da opcao Sim/Nao.
- Sim: soma `km totais x tarifa por km + pedagios` ao total da OS. O desconto geral existente da OS tambem incide sobre essa cobranca.
- Nao: deslocamento cobrado igual a zero; combustivel e pedagios permanecem no registro interno.
- Exemplo: 70 km totais, 10 km/litro, R$6/litro e R$20 em pedagios: custo de R$42 de combustivel + R$20 = R$62. Com tarifa R$2,50/km e Sim, cobranca de R$195; com Nao, cobranca de R$0 e mesmo custo R$62.
- O documento/preview/TXT destinado ao cliente mostra apenas a cobranca de deslocamento quando Sim, nunca o novo custo interno ou consumo de combustivel.
- **Relatorios > Custos de deslocamento** apresenta km, litros, combustivel, pedagios, custo total, cobranca e saldo, com os filtros da OS e CSV. Sao estimativas, nao despesas comprovadas; nao ha soma duplicada com despesas manuais. O saldo e anterior ao desconto geral e nao representa lucro da OS.
- Cada calculo guarda rotas, pontos e precos historicos. Mudar configuracoes nao recalcula OS antigas; recalcular aplica os precos atuais explicitamente. Pontos alterados exibem aviso. Replicar OS limpa o calculo anterior.
- O km informado pelo tecnico continua separado. Falhas de rota nao sao substituidas por linha reta nem por zeros. No modo local, configuracoes e calculos antigos podem ser consultados, mas novos calculos Google Maps exigem login Supabase.

### Ativar Google Maps no servidor

1. No Google Cloud, habilite **Routes API** e **Geocoding API**, faturamento e uma chave restrita a essas duas APIs. Se a chave ja funciona para rotas, acrescente Geocoding API tanto nas APIs ativadas quanto nas restricoes da chave existente. Configure cotas e alertas de orcamento; cada calculo de rota consome duas consultas (ida e volta), e cada busca de endereco consome uma consulta de geocodificacao.
2. Aplique somente as migracoes ainda pendentes, inclusive `20261015010000_service_distance.sql`, `20261015020000_travel_route_limits.sql` e `20261015030000_address_lookup_limits.sql`. Se as rotas ja estao funcionando, execute apenas a nova `20261015030000_address_lookup_limits.sql` no SQL Editor. Nao repita migracoes antigas aplicadas manualmente nem use `db push` sem conciliar o historico. Os limites por empresa sao um calculo de rota a cada 10 segundos e 30 buscas de endereco por minuto, em tabelas privadas separadas, somente para administradores/Master.
3. Cadastre o secret **GOOGLE_MAPS_ROUTES_API_KEY** no painel Supabase, em Edge Functions > Secrets. Nao coloque a chave no frontend, em variaveis `VITE_*`, no documento da empresa ou no repositorio. Nao envie a chave por chat.
4. Publique a Edge Function `travel-route` usando a configuracao de `supabase/config.toml`. Exemplo, com Supabase CLI previamente configurado:

```powershell
npx supabase functions deploy travel-route
```

A funcao valida o JWT em `/auth/v1/user` e exige papel owner/admin na mesma empresa. Para rotas, o navegador envia apenas o ID da OS e o servidor consulta os enderecos/pontos salvos via RLS com o token do chamador; ao Google sao enviadas coordenadas ou enderecos, conforme a disponibilidade de ponto confirmado para o endereco atual. Para geocodificacao, o navegador envia o endereco em preenchimento (que ainda pode nao estar salvo), e o servidor envia esse texto ao Google. Nao sao enviados nomes de clientes, valores ou documento da empresa pela consulta; nao inclua dados pessoais extras no campo de endereco. A chave Google nunca e retornada. Pedagios sao informados manualmente, nao consultados automaticamente. Sem secret, migracao, API habilitada ou funcao publicada, o erro e exibido e nao e criado um ponto/calculo ficticio. Republique a funcao existente e a versao web atualizada para ativar a busca automatica; chamadas reais pagas ao provedor nao fazem parte dos testes.

Para atualizar uma instalacao que ja possui rotas, o modo por endereco nao exige nova chave nem SQL adicional: republique `travel-route` e o frontend. A Routes API e o faturamento continuam necessarios. Geocoding API e a migracao de buscas de endereco sao usadas apenas pela busca separada de coordenadas.

As RPCs de reserva de consultas/rotas retornam `void`: respostas HTTP bem-sucedidas sem corpo (200/204) sao aceitas sem tentar ler JSON. Se uma versao antiga mostrar erro de autorizacao mesmo com a migracao aplicada, republique `travel-route` com a correcao; nao e necessario executar novamente as migracoes. Limites e recusas HTTP continuam bloqueando chamadas ao Google.

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