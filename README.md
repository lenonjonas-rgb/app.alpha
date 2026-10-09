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
- OS: cadastro, edicao, agendamento, prioridade, tecnico, status, relato e historico.
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

- Dashboard, agenda, tarefas de hoje, atrasadas, em execucao e finalizadas.
- Detalhes do cliente, telefone, orientacoes, data, prioridade, equipamentos, tags, valores da OS e orcamentos associados.
- Navegacao por deep link no Google Maps ou Waze instalado, com fallback para a rota HTTPS no navegador; endereco ausente impede abrir a rota.
- Check-in/check-out solicitam localizacao apenas naquele momento. Pausas exigem motivo; retorno retoma a contagem. Nao ha permissao de localizacao em segundo plano ou rastreamento continuo.
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