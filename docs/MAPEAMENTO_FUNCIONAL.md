# Mapeamento funcional de referencia: Auvo

## 1. Escopo e confiabilidade

- Inspecao realizada em 05/10/2026, com sessao autenticada fornecida pelo usuario.
- Referencia: interface web em https://app2.auvo.com.br, versao exibida 3.54.1.
- Objetivo: especificar funcionalidades equivalentes para um sistema independente de assistencia tecnica, com identidade visual propria.
- Foram percorridos os destinos principais dos menus Operacao, Cadastros e Relatorios, formularios centrais e configuracoes gerais.
- Nao foram executados salvamentos, exclusoes, finalizacoes, restauracoes, envios, faturamentos, contratacoes ou alteracoes de configuracao.
- Este documento nao contem credenciais, chaves de API, dados pessoais de clientes, arquivos da conta ou codigo proprietario.
- A inspecao da interface nao comprova regras internas, calculos do servidor, validacoes no salvamento ou funcionamento ponta a ponta.
- Nao equivale a um mapeamento completo de todo o produto Auvo: modulos bloqueados, aplicativo movel e fluxos inacessiveis permanecem pendentes.

Legenda de evidencia:

- **Tela inspecionada**: destino aberto e controles principais observados.
- **Formulario inspecionado**: campos de criacao ou configuracao observados, sem salvar.
- **Acao visivel**: botao, aba ou opcao observado; seu resultado nao foi necessariamente aberto ou testado.
- **Bloqueado**: interface apresentou oferta de contratacao em vez do modulo.
- **Pendente**: acesso, carregamento ou comportamento nao foi confirmado.

## 2. Inventario de navegacao

Os caminhos abaixo sao relativos ao dominio de referencia, nao rotas ja implementadas no novo sistema.

| Area | Tela | Caminho | Evidencia |
| --- | --- | --- | --- |
| Operacao | Agenda | /planejamento | Tela e formulario de tarefa inspecionados |
| Operacao | Projetos | /ordemServico | Lista inspecionada; formulario pendente |
| Operacao | Mapa | /mapa | Estrutura inspecionada; carregamento dos usuarios/tarefas incompleto |
| Operacao | Orcamentos | /Orcamentos | Lista inspecionada; Kanban como acao visivel |
| Operacao | Novo orcamento | /Orcamentos/NovoOrcamento | Formulario inspecionado |
| Operacao | Roteirizacao | /roteiroDeTarefas | Formulario inspecionado |
| Cadastros | Clientes | /gerenciarClientes | Lista inspecionada |
| Cadastros | Novo cliente | /gerenciarClientes/cliente | Formulario inspecionado |
| Cadastros | Equipamentos | /gerenciarEquipamentos | Lista inspecionada |
| Cadastros | Novo equipamento | /GerenciarEquipamentos/Equipamento | Formulario e abas visiveis |
| Cadastros | Colaboradores | /gerenciarColaboradores | Lista inspecionada |
| Cadastros | Novo colaborador | /gerenciarColaboradores/colaborador | Formulario e abas visiveis |
| Cadastros | Equipes | /gerenciarEquipes | Lista inspecionada |
| Cadastros | Nova equipe | /gerenciarEquipes/equipe | Formulario inspecionado |
| Cadastros | Produtos | /gerenciarProdutos | Lista inspecionada |
| Cadastros | Novo produto | /gerenciarProdutos/produto | Formulario e abas visiveis |
| Cadastros | Servicos | /servico | Lista inspecionada; formulario pendente |
| Cadastros | Formas de pagamento | /formasPagamentos | Lista inspecionada; formulario pendente |
| Cadastros | Tipos de tarefa | /gerenciarTipoDeTarefa | Lista inspecionada; formulario pendente |
| Cadastros | Questionarios | /gerenciarQuestionarios | Lista inspecionada |
| Cadastros | Novo questionario | /gerenciarQuestionarios/questionario | Formulario inspecionado |
| Cadastros | Tipos de despesa | /gerenciarTipoDeDespesa/ | Lista inspecionada |
| Cadastros | Grupos de clientes | /gerenciarGruposClientes | Lista inspecionada |
| Cadastros | Segmentos | /gerenciarSegmentos | Lista inspecionada |
| Cadastros | Palavras-chave | /gerenciarTags | Lista inspecionada |
| Cadastros | Pesquisa de satisfacao | /gerenciarPesquisaSatisfacao | Editor inspecionado |
| Cadastros | Motivos de pausa | /MotivoPausaTarefa | Lista inspecionada; formulario pendente |
| Relatorios | Dashboard | /dashboard | Estrutura e indicadores inspecionados; dados parcialmente carregados |
| Relatorios | Tarefas | /relatorioTarefas | Tela inspecionada; detalhamento pendente |
| Relatorios | Questionarios | /relatorioQuestionario | Selecao e geracao visiveis |
| Relatorios | Km rodado | /kmRodado | Formulario de filtros inspecionado |
| Relatorios | Despesas | /relatoriodespesas | Lista e controles inspecionados |
| Relatorios | Pesquisa de satisfacao | /relatorioPesquisaSatisfacao | Tela sem respostas no recorte atual |
| Relatorios | Monitoramento | /monitoramento | Tela inspecionada |
| Relatorios | Apontamento de horas | /apontamentoDeHoras | Tela e regras explicitas inspecionadas |
| Relatorios | Central de downloads | /centralDownload | Tela e estados inspecionados |
| Relatorios | Equipamentos | /equipamentos | Lista/Dashboard e controles visiveis; sem resultados no recorte |
| Administracao | Configuracoes gerais | /configuracoesGerais | Abas centrais inspecionadas |
| Administracao | Recuperacao de dados | /lixeira | Tipos de registro inspecionados; restauracao nao executada |
| Administracao | Integracoes | /integracao | Catalogo e controles inspecionados; segredos nao coletados |
| Administracao | Adicionais | /Content/Marketplace/index.html | Catalogo comercial inspecionado |

## 3. Agenda e ordens de servico

### 3.1 Visualizacoes e consulta

- Modos visiveis: Lista, Calendario e Linha do tempo. Apenas o calendario inicial foi inspecionado em detalhe.
- Periodos: dia, semana e mes; navegacao entre periodos.
- Area de tarefas sem agendamento, com tabela e filtros.
- Indicacao de colaboradores e situacao de conexao.
- Legenda de tarefas em atraso, visita no dia, em atendimento e com pendencia.
- Campos de filtro observados: cliente, CPF/CNPJ, tipo, responsavel, equipamento, data de abertura, palavra-chave, orientacao, codigo externo, codigo, grupo de clientes, equipe e criador.
- O filtro por codigo informa aceitar varios codigos separados por virgula e desconsiderar os demais filtros.
- Acoes visiveis nos menus: importar, roteirizar, transferir, reagendar, finalizar, remover, enviar OS digital por email e enviar pesquisa por email.
- Acoes em massa visiveis; selecao, efeitos e confirmacoes nao testados.
- Importacao possui referencia a planilha modelo. Arquivos nao foram baixados nem importados.

### 3.2 Criacao de tarefa

Abas observadas: Geral, Equipamentos, Valores e Anexos.

**Geral**

- Destino: cliente cadastrado ou endereco; atalho para novo cliente.
- Executor: colaborador ou equipe.
- Agendamento: data e hora; opcao de repetir tarefa.
- Descricao obrigatoria, tipo de tarefa, questionario e duracao estimada.
- Palavra-chave, prioridade alta/media/baixa e codigo externo.
- Check-in: padrao do colaborador, automatico ou manual.
- Opcoes de pesquisa de satisfacao e envio automatico da OS.
- Acoes: fechar, salvar e salvar incluindo outra tarefa.
- Recorrencia foi observada como opcao; frequencias e limites nao foram expandidos.

**Equipamentos**

- Selecao de equipamentos associados ao colaborador, equipe ou cliente.
- Busca por nome/identificador e filtros por associacao e especificacoes.
- Atalho comercial para compra de pecas, nao executado.

**Valores**

- Produtos e servicos: quantidade, valor unitario, desconto e valor total.
- Cadastro e inclusao de produtos/servicos a partir da tarefa.
- Custos adicionais: descricao e valor.
- Resumo com produtos, servicos, custos, desconto geral e total.
- Seletor de desconto exibe R$; outras modalidades e arredondamento nao confirmados.

**Anexos**

- Lista de anexos e acao de adicionar arquivo.
- Upload, validacoes e persistencia nao executados.

### 3.3 Execucao e OS digital

- As configuracoes/automacoes mostram estados: aberta, a caminho, em execucao, pausada e finalizada, com ou sem pendencia.
- Transicoes e permissoes de cada estado nao foram testadas.
- Relatorio de tarefas oferece copiar link, finalizar, enviar pesquisa, enviar por email, faturar OS e detalhar tarefa.
- O botao Detalhar tarefa foi acionado, mas nao disponibilizou conteudo novo na aba compartilhada. Detalhes de historico/execucao permanecem pendentes.
- Fotos, assinatura, relato, pausas, equipamentos, anexos e valores aparecem entre os campos configuraveis da OS digital. Sua coleta em uma tarefa real nao foi executada.

## 4. Projetos

- Lista com codigo, cliente, descricao, primeira visita, ultima visita, status das visitas, valor e status.
- Indicadores de atraso e visitas no dia.
- Pesquisa, filtros, downloads, mais acoes e criacao de projeto visiveis.
- Configuracoes exibem status de projeto e numeracao inicial do codigo.
- Status observados nas configuracoes: rascunho, aberta, em andamento e finalizada.
- A interface sugere agrupamento de visitas/tarefas por projeto; regras de vinculacao, agregacao de valores e formulario de criacao nao confirmados.
- Indicadores de faturamento/pagamento direcionam ao modulo de cobranca.

## 5. Orcamentos

- Lista e alternancia para Kanban, filtros, download, mais acoes e novo orcamento.
- Destinatario: cliente ou lead, com contatos.
- Solicitacao, expiracao, colaborador responsavel, codigo externo e status.
- Status existentes na conta incluem abertos, enviados, aprovados, faturar, aguardando pagamento, pagamento concluido e cancelados. Ha tambem status personalizado; nomes nao sao uma lista fixa do produto.
- Abas: Geral, Tarefas e Anexos; conteudo inicial de Geral inspecionado.
- Produtos, servicos, custos adicionais, descontos e resumo de valores.
- Forma e condicao de pagamento; opcao de multiplas formas.
- Observacao externa e nota interna.
- Acoes visiveis: salvar, salvar e enviar, cancelar e faturar.
- Configuracoes: status com cor no Kanban, motivos de recusa, assinatura/aprovacao pelo cliente, destinos de aprovado/recusado, prazo de expiracao, bloqueio de aprovacao apos expiracao e observacao padrao.
- Nao foram enviados orcamentos, abertas paginas publicas de aprovacao ou realizados faturamentos.

## 6. Mapa e roteirizacao

### 6.1 Mapa

- Mapa com zoom e filtros; interface identifica Leaflet/HERE como referencia cartografica.
- Usuarios/tarefas permaneceram em carregamento durante a leitura. Posicoes, trajetos, atualizacao em tempo real e filtros completos nao confirmados.
- Nao foi coletado historico de localizacao de pessoas.

### 6.2 Roteirizacao

- Colaborador, ponto base e data da primeira tarefa obrigatorios.
- Jornada por dia da semana, com horario de trabalho e almoco.
- Inclusao de tarefa existente ou nova tarefa; acao de finalizar roteirizacao.
- Busca de destino por cliente cadastrado, HERE, URL Google Maps ou Foursquare.
- Campos da tarefa: endereco, tipo, palavras-chave, duracao estimada obrigatoria, check-in, questionario, prioridade, equipamentos, satisfacao, envio automatico de OS, descricao obrigatoria, anexos e codigo externo.
- Area de upload informa limite de 20 MB nesse formulario.
- Algoritmo de ordenacao, estimativas, restricoes de capacidade e recalculo nao testados.

## 7. Cadastros operacionais

### 7.1 Clientes

- Lista: nome, endereco, telefone, responsavel, email, ultima visita e status.
- Busca e filtros; acoes visiveis para importar/exportar clientes, gerenciar responsaveis, enviar planilha de contatos, exportar contatos, consultar cadastros removidos e adicionar cliente.
- Formulario: consulta por CNPJ, nome, CPF/CNPJ, razao social, codigo externo, contato no local, telefone/email corporativos, colaborador/equipe responsavel, grupo, segmento e status.
- Observacao externa e observacao interna separadas.
- Enderecos do cliente e dados de cobranca; inclusao de endereco visivel.
- Areas relacionadas no cadastro/detalhe: anotacoes, tarefas, equipamentos, financeiro, tickets, orcamentos, enderecos e cobranca.
- Configuracoes: carteira por responsavel, obrigatoriedade de CPF/CNPJ, permissao de duplicidade, obrigatoriedade de segmento e grupo.
- O sistema avisa que impedir CPF/CNPJ duplicado limita cadastro offline no aplicativo.
- Importacao, exportacao, operacoes em lote e validacoes cadastrais nao foram executadas; comportamento e limites de cada acao permanecem sem teste ponta a ponta.
- Vinculos funcionais confirmados pela interface: cliente pode ser destino de tarefa/OS e orcamento, ter responsavel/equipe, grupo, segmento, contatos, enderecos e equipamentos relacionados.

### 7.2 Equipamentos

- Lista: nome, identificador, associacao, categoria, garantia e status.
- Categorias, filtros, mais acoes, planilha de importacao/exportacao, download de etiquetas e inclusao.
- Formulario: imagem, nome obrigatorio, identificador, validade, garantia, status, descricao e categoria.
- Associacao a estoque, colaborador ou cliente; associacao a outro equipamento visivel.
- Abas: Geral, Especificacoes, Anexos, Movimentacoes e Tarefas. A listagem tambem apresenta categoria, garantia e status.
- Configuracao de leitura por QR code: herdar configuracao ou personalizar por registro; a tela informa a possibilidade de leitura publica.
- Busca por nome/identificador e filtros por associacao e especificacoes; categorias sao gerenciadas separadamente.
- Conteudo completo das especificacoes, regras de movimentacao, impressao de etiqueta e pagina publica nao foram testados.
- Vinculos funcionais: equipamento pode ser associado a cliente/estoque/colaborador e outro equipamento, e reaparece em tarefas/OS, anexos, movimentacoes e historico.

### 7.3 Produtos e estoque

- Lista: nome, estoque minimo, estoque e valor unitario.
- Categorias, filtros e mais acoes: importar/exportar produtos, exportar relatorio detalhado de movimentacoes, exportar estoque por colaborador e adicionar produto.
- Formulario: imagem, nome obrigatorio, codigo externo, status, preco, custo, estoque minimo, estoque total e distribuicao entre empresa/colaboradores.
- Descricao, categoria, equipamento associado e unidade.
- Abas observadas: Geral, Especificacoes, Anexos, Estoque colaboradores, Movimentacoes e areas/dados fiscais.
- Foram vistos campos fiscais para ICMS, PIS, COFINS, IPI e IBS/CBS; regras, validacoes e calculos fiscais nao foram testados.
- Regra configuravel: movimentar estoque por orcamento ou por tarefa.
- Por orcamento, a configuracao referencia o status escolhido para movimentacao.
- Por tarefa, a interface informa movimentacao ao inserir, alterar ou remover produtos dos valores.
- Aviso explicito: alteracoes anteriores a ativacao da regra nao geram movimentacoes retroativas.
- Categorias, relatorios de estoque e movimentos por colaborador sao superficies distintas da manutencao do cadastro.
- Reserva, estoque negativo, estorno, inventario e concorrencia de baixas nao confirmados.
- Vinculos funcionais: produtos sao usados nos valores de tarefas/OS e orcamentos; o equipamento pode ser associado ao produto e o saldo possui historico de movimentacao.

### 7.4 Servicos

- Lista pesquisavel com descricao, status e remocao; acoes visiveis para importar/exportar servicos, manter template de observacao e adicionar servico.
- Formulario inspecionado: titulo e preco obrigatorios, codigo externo, status ativo, observacao padrao e controle para permitir editar a observacao em outras areas.
- Templates de observacao sao mantidos separadamente. A explicacao da tela indica que a observacao padrao pode ser apresentada em orcamentos e que sua edicao nao altera a descricao original do servico.
- Uso em tarefas/OS e orcamentos com quantidade, preco e desconto confirmado pelos respectivos formularios; importacao/exportacao nao executadas.

### 7.5 Colaboradores e equipes

- Colaboradores: lista com nome, telefone/login, cargo, tipo de usuario e modo de check-in; filtros, inclusao e exportacao de usuarios.
- Formulario: nome/login, cargo, contato, email, tipo de usuario, check-in, senha, valor por hora, valor por km, idioma, frequencia de monitoramento, ponto base e jornada.
- Tipos de usuario visiveis: usuario, gestor e administrador; a lista tambem distingue administrador principal e gestor de equipe.
- Jornada sempre ativa ou personalizada para monitoramento e opcao de baixo consumo de bateria.
- Abas: Detalhes, Configuracoes, Notificacoes, Interface e Anexos. Foi observada uma matriz extensa de permissoes envolvendo tarefas, clientes, orcamentos, estoque, equipamentos, projetos, despesas e dados do cliente, com opcoes para interface Web/email.
- Equipes: lista e formulario com descricao obrigatoria, gestores e membros; permite adicionar colaborador e remover membros.
- Tipos de despesas: lista pesquisavel de categorias, com inclusao/remocao.
- A matriz completa, heranca de permissoes, efeito de desativacao e regras de acesso por perfil nao foram testados. O controle apresentado na interface nao prova enforcement no servidor.
- Vinculos funcionais: equipe organiza membros e pode ser responsavel por clientes/tarefas; colaborador participa de tarefas, monitoramento, despesas e distribuicao de estoque.

### 7.6 Cadastros auxiliares

- Grupos de clientes e segmentos: listas pesquisaveis com criacao/manutencao de classificacoes associadas a clientes. Na conta consultada, nao foi confirmada uma estrutura de campos alem do nome/descricao.
- Tipos de tarefa: lista por codigo/descricao. Formulario com descricao obrigatoria, tolerancia, duracao estimada, questionario padrao, envio automatico de pesquisa de satisfacao e OS digital por email, status ativo e contabilizacao de km rodado.
- Formas de pagamento: lista pesquisavel com oito registros e acao para adicionar. A lista mostrou descricoes de formas como cartao, dinheiro, boleto, Pix e transferencia; campos internos, parcelamento e condicoes nao foram confirmados.
- Palavras-chave: lista pesquisavel com inclusao/remocao; usada como classificacao selecionavel em tarefas.
- Motivos de pausa: lista com motivo, status e remocao; nao havia registros visiveis e o formulario nao foi inspecionado.
- Tipos de despesas: categorias simples pesquisaveis, com inclusao/remocao; estrutura adicional nao observada.

### 7.7 Recursos indisponiveis ou nao confirmados

- Fornecedores abre uma oferta de acesso ao modulo Financeiro; nao foi possivel inspecionar lista ou formulario de cadastro na conta observada.
- PMOC abre uma oferta de modulo/plano exclusivo; nao foi possivel inspecionar suas funcoes. Sua presenca na lixeira ou no menu nao comprova disponibilidade.
- As operacoes de salvar, excluir, importar e exportar nao foram executadas durante o levantamento.
- A interface web permite descrever campos, abas, comandos e relacoes aparentes, mas nao revela o codigo-fonte do Auvo, endpoints, modelo interno do banco, regras efetivas do backend ou garantias de seguranca. Os dados e regras acima sao observacoes de interface, nao uma especificacao oficial da implementacao interna.

## 8. Questionarios e satisfacao

### 8.1 Questionarios tecnicos

- Lista com inclusao, remocao, duplicacao e importacao por planilha.
- Titulo, cabecalho, rodape e perguntas com descricao, obrigatoriedade, exclusao e duplicacao.
- Tipos de resposta visiveis: texto, numerica, check, monetaria, data, itens, CPF/CNPJ, hora, itens com multipla escolha, area de texto, assinatura e foto.
- Configuracoes: exibir na OS, quantidade de perguntas por linha, pergunta/resposta na mesma linha, exibir nao respondidas e habilitar resposta por equipamento.
- Questionario selecionavel em tarefas e roteirizacao.
- Validacao de respostas, condicionais, anexos e obrigatoriedade ao finalizar nao testados.

### 8.2 Pesquisa de satisfacao

- Editor com tres blocos de perguntas visiveis, obrigatoriedade, multipla escolha e itens.
- Salvar e visualizar formulario como acoes visiveis.
- Habilitacao em tarefa e envio no relatorio de tarefas.
- Relatorio com filtros e download de planilha; sem respostas no recorte consultado.
- Escalas, limites de perguntas, anonimato e envio automatico nao confirmados.

## 9. Relatorios e indicadores

| Relatorio | Elementos observados | Limite da inspecao |
| --- | --- | --- |
| Dashboard | Graficos de tarefas/despesas, produtividade, tempo medio em atividades, atraso medio, custo medio; abas por colaborador/equipe/cliente | Parte dos dados em carregamento; formulas nao validadas |
| Tarefas | Totais abertas/pendentes/finalizadas, cards, filtros, visualizacao e download, acoes por OS | Envios/finalizacao nao executados; detalhe sem resposta |
| Questionarios | Selecao de questionario e geracao | Relatorio nao gerado |
| Km rodado | Valor/km, intervalo, filtro por colaborador/equipe | Calculo nao executado |
| Despesas | Lista/grafico, colaborador, tipo, data, valor, descricao, anexo, inclusao e download | Registro/exportacao nao executados |
| Satisfacao | Filtros e download de planilha | Sem respostas no recorte |
| Monitoramento | Ultimo registro, data, GPS, internet, bateria e versao do aplicativo | Historico nao inspecionado |
| Horas | Deslocamento, pausas, execucao e trabalho; modo finalizadas/parcial; exportacao Excel | Sem dados no recorte; calculos nao testados |
| Equipamentos | Lista/Dashboard, exportacao, filtros e configuracoes | Sem resultados no recorte; aparece tambem rotulo Relatorio de Colaboradores |
| Central de downloads | Solicitacao, descricao, data, status e download | Nao foram solicitados arquivos |

Regras explicitas do apontamento de horas:

- Valores acima de 24 horas sao apresentados em dias.
- Modo somente finalizadas considera execucao menos pausas.
- A tela alerta para possivel saldo negativo em tarefa pausada sem check-out.
- Consolidacao efetiva ocorre em tarefa finalizada com check-out.

Regras explicitas da central de downloads:

- Arquivo disponivel por sete dias apos solicitacao.
- Estados: na fila, em andamento e finalizado.
- Download disponivel quando a geracao termina.

### 9.1 Adaptacao implementada no Alpha Tec 0.3

- Dashboard operacional com filtros por intervalo, cliente, colaborador, situacao e busca; agrega tarefas, pendencias, horas e quilometragem registrada.
- Relatorio de tarefas com totais e acesso ao detalhe da OS; relatorio de questionarios consolida respostas gravadas nas OS.
- Relatorio de Km usa a distancia informada em cada OS e uma tarifa editavel nas configuracoes da empresa; sem tarifa, exibe o total de km e nao inventa valor.
- Despesas foram adicionadas ao modelo local com colaborador, tipo, data, valor, descricao e comprovante; lista e exportacao CSV usam os filtros.
- Apontamento de horas soma deslocamento, pausa e execucao a partir dos eventos da OS. O modo finalizado inclui somente OS finalizadas com check-out.
- Relatorio de equipamentos mostra garantia e quantidade/ultima visita derivadas dos atendimentos registrados.
- CSV e gerado no navegador. A lista da Central de downloads e apenas da sessao atual e nao representa uma fila de servidor.
- O resumo financeiro Alpha Tec separa valores registrados em OS de despesas; nao e faturamento, caixa, imposto ou conciliacao. O Dashboard financeiro do Auvo aparecia no menu, mas nao foi acessivel para levantamento funcional.
- Pesquisa de satisfacao informa que ainda nao ha fluxo de respostas integrado. Monitoramento informa que nao coleta localizacao, bateria ou conectividade. Esses relatorios nao fabricam registros nem alegam integrações inexistentes.
- Filtros, exportacao e calculos locais nao tornam esta entrega multiusuario. O Alpha Tec continua usando localStorage; Supabase, Vercel, Resend e aceite de cliente por codigo ainda precisam de implementacao/configuracao.

## 10. Configuracoes gerais

### 10.1 Marca, relatorios e OS digital

- Logo, titulo do relatorio, dados da empresa e idiomas portugues/ingles/espanhol.
- Selecao e renomeacao de campos exibidos na OS, sem mudar nomes no restante do sistema.
- Campos incluem cliente, tecnico, codigo, tipo, endereco, orientacao, relato, datas/horas, check-in/out, duracao, atrasos, deslocamento, km, questionarios, fotos, assinatura, pausas, equipamentos, garantia, anexos e valores.
- Tamanho de fonte, ordem de questionarios, modelo de relatorio e colaboradores removidos nos filtros.
- Modelo final, PDF, impressao e links publicos nao foram gerados.

### 10.2 Regras de tarefas

- Alertar horario fora da jornada e tarefa duplicada por cliente/equipamento/tipo.
- Exigir tipo de tarefa e bloquear tarefas no mesmo horario.
- Categoria financeira e multiplos executores configuraveis.
- Manter tarefas antigas em andamento na agenda atual do aplicativo por limite de dias.
- Assinatura da OS por link: desligada, sem confirmacao por email ou com codigo de seis digitos por email.
- Assinatura pelo portal Desk configuravel separadamente.
- Remocao de assinatura depende da configuracao geral e da permissao individual.
- A interface descreve auditoria de assinatura com data, hora, endereco de internet e dispositivo; coleta efetiva nao inspecionada.

### 10.3 Email, km, projetos e seguranca

- Emails de recebimento e templates por modulo; editor dos templates nao inspecionado.
- Km: colunas informado/entre tarefas/sistema/total diario, rota mais rapida ou menor distancia e valor/km.
- Alterar criterio de km afeta calculos novos, nao os anteriores, segundo a tela.
- Projetos: status, cores e numeracao inicial.
- Seguranca: email obrigatorio, troca de senha no primeiro acesso, expiracao, bloqueio apos tres erros e SSO.
- Login inicial mostrou usuario/senha, recuperacao de senha e SSO. Recuperacao e SSO nao executados.

### 10.4 Automacoes

- Abas de configuracao para Auvo Desk: Tarefas, Status e Atribuicao.
- Vinculacao observada entre estados de tarefa e status/coluna de ticket.
- Gatilho por alguma tarefa associada ou por todas as tarefas associadas.
- Estados de referencia: aberta, a caminho, em execucao, pausada e finalizada.
- Regras de Status/Atribuicao e execucao automatica nao inspecionadas em detalhe.
- Configuracao visivel nao significa que o modulo Desk esteja contratado.

## 11. Integracoes, recuperacao e modulos bloqueados

### 11.1 Integracoes

- API com documentacao externa e ativacao/configuracao de credenciais.
- Nenhuma chave ou token foi lido, copiado ou armazenado.
- Parceiros visiveis: Bling, Conta Azul, OMIE e Sigma; estados ativa/inativa apresentados na interface.
- AuvoPay oferece cobrancas por boleto/Pix e identificacao de pagamentos; aparece inativo na conta.
- Contratos da API, sincronizacao, webhooks, erros e conciliacao nao testados.

### 11.2 Recuperacao de dados

- Seletor de registros excluidos: cliente, equipamento, orcamento, PMOC, produto, questionario, servico e tarefa.
- Listas por tipo e restauracao nao executadas.
- A presenca de PMOC na lixeira nao comprova acesso ao modulo de PMOC.
- Prazo de retencao, dependencias e conflitos ao restaurar permanecem desconhecidos.

### 11.3 Restricoes comprovadas da conta

- Central do Cliente: modal de recurso exclusivo para contratantes.
- Cobranca: modal de recurso exclusivo para contratantes.
- Nota fiscal/Financeiro: modal de recurso exclusivo para contratantes.
- AuvoDesk: apresenta oferta comercial, nao a central de tickets.
- Menu Financeiro apresenta AuvoPay, bancos/conciliacoes, categorias e oferta do modulo completo; fluxos internos nao inspecionados.
- Nenhuma contratacao ou contato comercial foi executado.

### 11.4 Adicionais comerciais

- Catalogo: cabecalhos personalizados, dashboard BI, Power BI, Excel integrado, relatorio de pendencias por email e relatorio avancado de estoque.
- Central de contas, construtor de BI e construtor de relatorio aparecem como futuros recursos.
- Ofertas nao foram tratadas como funcionalidades operantes da conta.
- Links de suporte, treinamento, primeiros passos, cobranca da assinatura e comunidade sao externos ou auxiliares; nao foram percorridos como funcionalidades do novo sistema.

## 12. Modelo conceitual para o sistema independente

Esta secao e uma proposta de modelagem baseada na interface, nao uma descricao do banco de dados do Auvo.

| Entidade | Relacoes propostas |
| --- | --- |
| Empresa | Usuarios, configuracoes e identidade visual |
| Cliente | Enderecos, contatos, grupos, segmento, responsaveis e equipamentos |
| Colaborador | Perfil de acesso, equipe, jornada, tarifas e estoque em posse |
| Equipe | Gestores, membros e tarefas |
| Equipamento | Cliente/colaborador/estoque, categoria, especificacoes, anexos e historico |
| Produto | Categoria, preco, custo, estoque e movimentacoes |
| Servico | Catalogo e itens de tarefa/orcamento |
| Tarefa/OS | Cliente/endereco, executores, equipamentos, questionarios, itens, anexos e eventos |
| Projeto | Conjunto de visitas/tarefas, status e valores; regras a confirmar |
| Orcamento | Cliente/lead, itens, contatos, pagamentos, status e tarefas vinculadas |
| Questionario | Perguntas e respostas por tarefa/equipamento |
| Despesa | Colaborador, tipo, data, valor e comprovante |
| Pesquisa | Perguntas, envio vinculado a tarefa e respostas |
| Movimentacao de estoque | Produto, origem/destino e documento gerador |
| Evento de execucao | Tarefa, colaborador, estado, horario, pausa e eventual localizacao |
| Exportacao | Solicitante, filtros, estado, arquivo e vencimento |

## 13. Proposta de etapas para a assistencia tecnica

Sugestao, ainda nao aprovada pelo usuario:

1. Base operacional: autenticacao, usuarios/permissoes, clientes, equipamentos, produtos/servicos e agenda/OS.
2. Atendimento completo: questionarios, fotos, assinatura, historico, orcamentos, pagamentos informativos e OS com a marca da assistencia.
3. Gestao: estoque/movimentacoes, recorrencia, projetos, despesas, horas, indicadores e exportacoes.
4. Campo e integracoes: mapa/roteiros, aplicativo ou PWA, operacao offline, notificacoes e integracoes contratadas.
5. Modulos novos opcionais: portal do cliente, tickets, cobranca e fiscal, mediante requisitos e provedores proprios.

O novo sistema devera ter implementacao, layout, textos, recursos visuais e infraestrutura proprios. Identidade visual aguarda o logo do usuario.

## 14. Lacunas e criterios de validacao futura

- Confirmar com o usuario quais modulos e fluxos sao indispensaveis; referencia completa nao significa escopo automaticamente aprovado.
- Inspecionar formulario e detalhes de projeto, conteudo das abas secundarias e formularios auxiliares que nao responderam.
- Inspecionar uma OS em execucao/finalizada e seu historico, preferencialmente com dados ficticios.
- Confirmar regras de recorrencia, conflitos de agenda, duracao, transicoes, pendencias e multiplo executor.
- Confirmar arredondamento, descontos, tributos, parcelamento, cancelamento e efeitos em estoque.
- Verificar permissoes com contas de teste de tecnico, gestor e administrador.
- Validar importacoes/exportacoes, uploads, limites de arquivos e comportamento das filas.
- Confirmar escopo movel: GPS, check-in/out, foto, assinatura, pausas, offline e sincronizacao.
- Obter demonstracao autorizada dos modulos bloqueados se forem necessarios; nao presumir seus campos ou regras.
- Definir canais de envio e provedores de email, mapas, pagamentos e notas fiscais antes de implementar essas integracoes.
- Definir privacidade, consentimento, auditoria, retencao, isolamento por empresa, backups e protecao de dados.
- Testes de persistencia e efeitos externos deverao usar ambiente de teste e autorizacao explicita, nunca a conta operacional por padrao.

## 15. Checklist de cobertura documental

- [x] Destinos principais de Operacao inventariados.
- [x] Destinos principais de Cadastros inventariados.
- [x] Destinos principais de Relatorios inventariados.
- [x] Formularios centrais e configuracoes registradas.
- [x] Restricoes de contratacao e carregamento registradas.
- [x] Dados pessoais e credenciais omitidos do documento.
- [ ] Todas as abas e formularios secundarios inspecionados.
- [ ] Aplicativo movel e modulos bloqueados inspecionados.
- [ ] Regras de negocio e fluxos ponta a ponta validados em ambiente de teste.
- [ ] Escopo de implementacao e identidade visual aprovados.