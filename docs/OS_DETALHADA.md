# Tarefa existente e Mais informacoes - referencia e adaptacao

## Inspecao

Complemento ao mapeamento inicial em 05/10/2026. Foi aberta uma tarefa existente pela agenda do Auvo e percorrida a pagina acessada por **Mais informacoes**, no caminho `/relatorioTarefas/DetalheTarefa/{codigo}`.

A tarefa consultada estava finalizada com pendencias. O botao **Editar** muda a propria pagina para modo editavel e habilita campos/acoes anteriormente ocultos. A edicao exploratoria foi cancelada: nao houve salvamento, exclusao, faturamento ou envio na conta Auvo. Um check-in adicionado apenas ao rascunho para inspecionar o menu foi descartado ao cancelar; a tabela voltou a ficar sem esse registro.

Nao foram copiados dados de cliente, respostas, fotos, anexos, assinatura ou codigo proprietario. Os modelos e exemplos do Alpha Tec sao independentes.

## Resumo da agenda

O resumo da tarefa possui abas Tarefa, Monitoramento, Equipamentos, Orcamentos e Valores. Acoes observadas: Mais informacoes, copiar link, reagendar, replicar, excluir, editar e faturar OS. A oferta de faturamento depende de modulo adicional.

## Pagina ampliada observada

| Area | Funcionalidades observadas no Auvo | Adaptacao no Alpha Tec |
| --- | --- | --- |
| Detalhes | Criador/data, executor, tipo/prioridade, endereco, orientacao, palavras-chave, codigo externo, cliente, orcamentos vinculados, monitoramento e km informado | Dados locais, orientacoes, tags, codigo externo/km, associacao e criacao de orcamento, eventos manuais; criacao nova registrada sem inventar datas antigas |
| Relato do usuario | Campo de relato de ate 10000 caracteres; assinatura coletada | Relato separado de orientacoes; canvas via SignaturePad, nome/data de coleta local e remocao confirmada |
| Anexos | Arquivos e fotos, inclusao em modo edicao | PNG/JPG/WebP/PDF/TXT, download de arquivo e fotos, remocao em rascunho; 500 KB por arquivo nesta fase |
| Questionarios | Adicionar/remover; diferentes respostas; foto; obrigatoriedade e dados de sincronizacao | Modelos proprios, perguntas personalizadas, texto/numero/escolha/multipla escolha/check/data/hora/monetaria/CPF-CNPJ/foto/assinatura; pendencias por campos vazios |
| Equipamentos | Associacoes e informacoes de equipamento, garantia; atalho comercial para pecas | Equipamento principal e associacoes adicionais do mesmo cliente; identificador, categoria, garantia e observacoes |
| Pendencias | Perguntas obrigatorias nao respondidas organizadas por questionario | Pendencias derivadas de questionarios e registros manuais que podem ser resolvidos/reabertos |
| Controle de horas | Colaborador, atividade/monitoramento, horario, tempo, motivo, justificativa, origem; historico completo; atividades variam conforme estado | Deslocamento/check-in/pausa/retorno/check-out com sequencia validada e totais; motivo de pausa, justificativa e historico local |
| Envios | OS digital, pesquisa de satisfacao, envio por email e historico de notificacoes | Estado nao enviado, exportacao local e historico de preparacao; nenhuma entrega de email simulada |
| Valores | Produtos, servicos, quantidade, unitario, desconto, custos adicionais, resumo e desconto geral R$/% | Itens e descontos em centavos, custos, desconto geral em R$ ou %, validacao de desconto excessivo; sem baixa automatica de estoque |

## Ramificacoes verificadas

- O modo de consulta oculta os botoes de alterar valores, adicionar questionarios e adicionar atividades; **Editar** os revela.
- Antes de registrar atividade, o menu permite deslocamento ou check-in. Apos check-in, foram observadas opcoes de inicio de pausa e check-out. Foi implementado retorno de pausa como parte da sequencia local coerente; esta etapa especifica nao foi executada na conta de referencia.
- Historico completo abre outra janela com data, usuario, alteracao e origem, busca e paginacao.
- Valores oferece incluir/cadastrar produto/servico, remover todos, custo adicional e seletor de desconto geral R$/%. Nao foram cadastrados ou removidos itens na conta Auvo.
- Questionario em edicao revelou escolha simples, multipla escolha, foto e observacao; campos obrigatorios aparecem em Pendencias.
- A associacao de orcamento exibe codigo, etapa, solicitacao, expiracao, responsavel e valor. Nenhuma associacao foi salva na conta Auvo.
- As interfaces de email foram observadas apenas como acoes: nao foram executados envios para clientes.
- Recebimento/visualizacao no dispositivo, check-in automatico, localizacao, assinatura com confirmacao de email e regras do servidor nao foram testados.
- Acoes de replicar/reagendar/excluir da referencia foram inventariadas, nao executadas. No Alpha Tec, exclusao foi adaptada para arquivamento reversivel nesta fase.

## Funcionamento da nova tela

1. Abra a agenda ou Ordens de servico e selecione uma OS.
2. Clique em Mais informacoes.
3. Clique em Editar informacoes para iniciar um rascunho dos detalhes.
4. Navegue entre abas, altere campos e escolha Salvar alteracoes ou Cancelar edicao.
5. Controle de horas registra atividades imediatamente por formulario proprio, fora do rascunho dos detalhes.
6. Reagendar/dados basicos utiliza o formulario existente e preserva os detalhes adicionais.
7. Criar orcamento permite incluir itens e salva a associacao na mesma operacao. Outra opcao e associar um orcamento existente do mesmo cliente.
8. Arquivar remove a OS da agenda/lista normal. Na lista, selecione Arquivadas para acessar/restaurar o registro.
9. Copiar link interno gera `#orders/{id}`. O link depende dos dados da mesma origem/navegador e nao deve ser apresentado como link publico para clientes.
10. Imprimir prepara documento com dados, orientacoes, relato, equipamentos, questionarios, pendencias, atividades, valores, orcamentos, fotos/anexos e assinatura, independentemente da aba aberta.

## Integracao pendente: compartilhamento com o cliente

A referencia funcional tem duas opcoes no menu **Copiar link**:

- **OS Digital**: link para o cliente visualizar o relatorio do atendimento ou baixar o PDF.
- **Pesquisa de Satisfacao**: link para o cliente avaliar o atendimento e o servico recebido. As respostas devem ser relacionadas a OS e ao tecnico responsavel para acompanhar a percepcao dos clientes sobre a qualidade/solucao do servico e sua experiencia com o tecnico. Nao se trata dos questionarios tecnicos preenchidos durante a execucao.

Esses fluxos ainda nao existem como compartilhamento publico no Alpha Tec. O botao atual copia somente uma rota interna `#orders/{id}`, dependente dos dados locais da mesma origem/navegador. A impressao da OS e local; em **Envios**, a exportacao e texto local, e OS digital/pesquisa aparecem como nao enviadas. O catalogo de questionarios serve para coleta tecnica durante a execucao, nao para respostas de satisfacao do cliente. O relatorio de satisfacao nao recebe respostas integradas.

Mapa de dados a considerar na integracao:

| Registro | Dados que devem ser relacionados |
| --- | --- |
| Compartilhamento da OS | OS, cliente, tecnico responsavel, identificador do link, estado e datas de criacao/envio/acesso; documento renderizado com opcao de leitura e PDF |
| Compartilhamento da pesquisa | OS, cliente, tecnico responsavel, identificador do link, estado e datas de criacao/envio/resposta; formulario de avaliacao do atendimento |
| Resposta de satisfacao | Pesquisa, atendimento, tecnico, avaliacao e comentarios do cliente, data de submissao; base para indicadores e filtros por tecnico/periodo |

Regras de validade/revogacao, acesso publico ou autenticado, identificacao/anominato do respondente, limite de respostas, perguntas/escala e calculo dos indicadores nao foram confirmadas pela referencia. Definir essas regras antes de disponibilizar links externos; nao reutilizar o link interno nem confundir respostas do tecnico ao questionario de execucao com feedback do cliente.

## Regras locais e limites

- Campos novos opcionais preservam compatibilidade com a base anterior e backups da versao 1.
- Salvar detalhes valida referencias, valores, imagens e atividades antes de escrever no navegador.
- Alteracao concorrente dos detalhes em outra aba impede sobrescrever o rascunho antigo; backend/transacoes continuam pendentes.
- Pergunta obrigatoria sem resposta gera pendencia, sem impedir salvar um atendimento incompleto. A finalizacao identifica se ha pendencias, como observado na referencia.
- Atividade em andamento exige check-out antes de finalizacao manual. Pausa exige motivo e retorno antes de check-out.
- A contagem de horas inclui intervalos maiores que 24 horas. Horarios e autoria sao informados localmente, sem garantia de autenticidade.
- Assinatura local nao verifica identidade, nao envia codigo por email e nao fornece certificacao juridica.
- Anexos locais pequenos consomem a cota de localStorage; nao ha armazenamento remoto. Exportar backup e usar dados ficticios permanece necessario.
- Formularios abertos e edicoes incompletas da OS sao guardados como rascunhos temporarios na sessao do navegador e podem ser restaurados apos atualizar ou reabrir a pagina. Campos e selecoes sao recuperados; arquivos ainda nao enviados nos formularios de cadastro nao sao preservados. Ao cancelar ou apos confirmar a sincronizacao, o rascunho correspondente e removido.
- No modo de banco seguro, um cache temporario por usuario/empresa pode exibir os dados enquanto o servidor e revalidado em segundo plano. O cache e validado pela associacao ativa da conta, atualizado apos sincronizacao e removido ao sair; novas gravacoes aguardam a confirmacao do banco remoto.
- Replica copia orientacoes, itens e estrutura de questionarios, mas limpa relato, respostas, fotos, assinatura, atividades e pendencias manuais.
- Atualizacao em 10/10/2026: catalogo proprio compartilhado/versionado, padroes por tipo de tarefa e copias independentes dos modelos nas OS. Alteracoes no catalogo nao modificam respostas antigas.
- Perguntas novas de assinatura possuem desenho e nome independentes. Assinaturas legadas preservam a compatibilidade com a assinatura geral. Impressao e relatorios resolvem fotos/assinaturas por pergunta.
- CPF/CNPJ, data, hora, numero, check e opcoes recebem validacao de formato/digitos e referencias; isso nao certifica identidade ou validade juridica. Perguntas obrigatorias bloqueiam check-out somente quando o modelo associado exige preenchimento para check-out. A opcao e definida no editor e copiada para a tarefa, sem alterar associacoes anteriores. Pendencias manuais e a exigencia de associacao por tipo permanecem obrigatorias. Novas tarefas com configuracao de questionario bloqueiam finalizacao manual com pendencias, preservando a regra administrativa legada.
- No login do tecnico, a aba Relatorio mostra apenas os questionarios associados; sem questionario, apresenta relato, quilometragem, anexos e assinatura do relatorio padrao. Dados padrao anteriores permanecem salvos quando ocultos.
- Tipo Sim ou Não: o editor define a resposta que solicita justificativa (Sim ou Nao). Essa resposta exibe texto obrigatorio e foto opcional, via camera ou upload de imagem. Justificativas vazias bloqueiam check-out em questionarios obrigatorios; os opcionais preservam a dispensa. Administracao, impressao e CSV incluem justificativa/foto. Trocar para a outra resposta limpa a justificativa e o vinculo da foto; replicar tambem limpa esses dados, mantendo a configuracao.
- Envio real, notificacoes push, calculo de rotas/km, PDF de servidor e cobranca dependem de backend/provedores e nao foram implementados como controles falsos.

## Distancia do GPS no check-in e check-out

1. Nos dados basicos da OS, confira o endereco efetivo do atendimento (do cliente ou especifico).
2. Em **Ponto do atendimento para monitoramento**, aguarde a busca automatica pelo endereco completo e salve a OS. As coordenadas aceitas nao precisam de confirmacao extra. Se o endereco nao for encontrado com precisao suficiente, confira os campos e tente novamente; alternativamente, abra o mapa, clique no local exato ou informe latitude/longitude, selecione **Confirmar ponto deste endereco** e salve.
3. Os proximos check-ins e check-outs capturam o GPS do dispositivo e registram a distancia em metros ate esse ponto. No aplicativo do tecnico, o servidor calcula o resultado, sem confiar em distancias enviadas pelo aparelho.
4. Consulte **Controle de horas** na OS ou **Relatorios > Monitoramento**. Ambos exibem GPS/precisao, distancia, referencia historica e exportam CSV; a impressao da OS inclui essas informacoes. No Monitoramento, as datas filtram o momento da atividade e o colaborador e o registrado no evento, mesmo que a OS tenha sido reagendada ou reatribuida.

- Distancia em linha reta pela formula de Haversine, nao rota ou quilometragem percorrida. A precisao do GPS (ex.: +/-16 m) e uma incerteza separada; o valor nao comprova presenca. Nao ha bloqueio por raio nem rastreamento continuo.
- Cada evento guarda o ponto/endereco utilizado naquele momento. Alterar o ponto ou endereco nao recalcula eventos passados. Mudar o endereco invalida as coordenadas antigas e inicia nova busca; registros antigos sem referencia continuam explicitamente indisponiveis, nunca zero ficticio.
- Sem permissao/sinal de GPS, o registro de check-in/check-out informa o erro. Sem ponto confirmado, o GPS pode ser registrado mas a distancia nao fica disponivel.
- A busca envia o endereco ao Google Geocoding pelo servidor autenticado, sem expor a chave. Aceita um resultado completo de edificio ou numero interpolado, nao centro aproximado de cidade/rua. Pontos automaticos usam visualizacao Google; selecao manual usa OpenStreetMap, com atribuicao. Latitude/longitude manuais permitem confirmar um ponto mesmo se os mapas nao carregarem. Abrir o mapa nao e necessario para preencher automaticamente.
- O registro administrativo Web local captura o GPS do dispositivo do administrador e preserva essa origem, sem se passar por registro do tecnico no aplicativo. Data/autoria administrativas continuam informadas manualmente.
- Publicacao: aplicar `supabase/migrations/20261015010000_service_distance.sql` depois das migracoes anteriores e publicar a versao web/aplicativo atualizada. Sem essa migracao, o RPC antigo nao grava a distancia no servidor. O aplicativo Android instalado precisa receber a compilacao atualizada para exibir os novos campos; nao foram publicados nesta entrega.
- Validacao local: 199 testes passando, incluindo calculo geografico, calculo do servidor sem confiar no aparelho, preservacao da referencia historica e filtros por data/autoria do evento. No navegador foram conferidos clique no mapa, confirmacao/remocao, recuperacao do ponto apos atualizar, persistencia apos salvar, invalidacao por mudanca de endereco e conteudo CSV com registro simulado de 1112 m e precisao de 16 m. GPS fisico e publicacao remota nao foram testados.

## Cobranca e custo interno de deslocamento

- Configuracoes possui preco do combustivel (R$/litro), rendimento (km/litro), tarifa de cobranca (R$/km) e ponto confirmado de saida da assistencia.
- Latitude/longitude sao opcionais para calcular rotas. Sem ponto confirmado vinculado ao endereco atual, a Routes API recebe o endereco salvo da assistencia e/ou do atendimento e o localiza internamente, sem consulta separada a Geocoding API. Endereco da assistencia usa o campo de deslocamento, com compatibilidade para o antigo ponto ou endereco cadastral. Cada rota preserva os enderecos e, somente quando usados, os pontos. Coordenadas antigas nao sao aplicadas a endereco novo.
- Salvar a OS ou a assistencia nao depende mais de terminar a busca de coordenadas. Confira os enderecos completos, salve e calcule a rota em Valores. Um resultado por endereco nao fornece um ponto confirmado para monitoramento GPS; check-in/check-out continuam sem distancia quando nao ha referencia.
- Validacao do modo por endereco: 269 testes passando, build, tipos e lint aprovados. Testes cobrem ida/volta independentes sem Geocoding API, endereco especifico da OS, compatibilidade com endereco cadastral/pontos antigos, deteccao de alteracoes e backup sem coordenadas. Navegador com API simulada: calculo sem pontos, 70 km com custo interno R$62 em Sim/Nao e cobranca R$195 somente em Sim; falha preserva calculo anterior. Assistencia salva mesmo com geocodificacao pendente. Sem chamadas pagas ou deploy remoto.
- O endereco de saida da assistencia tambem e salvo separadamente, mesmo se a consulta falhar. Ao preencher/alterar esse endereco ou o endereco de atendimento da OS, uma pausa de 1,2 segundo inicia a busca automatica. Pontos ja salvos para o mesmo endereco nao geram nova consulta. Edicao manual, remocao e mudanca de endereco impedem que uma resposta atrasada sobrescreva a escolha atual. Falhas sao exibidas mesmo com o mapa fechado e possuem botao para tentar novamente.
- **Nova OS** e a edicao dos dados basicos possuem **Cobranca de deslocamento: Sim/Nao**, habilitada antes de calcular. O botao de previa consulta rota e pedagios; ao salvar uma nova OS sem calculo valido, a consulta e feita automaticamente para registrar os custos nas duas opcoes. Se houver erro ou pedagio sem preco nao confirmado, o formulario permanece aberto e nao cria OS incompleta. OS legadas sem calculo e com Nao permanecem editaveis. O painel tambem continua em **Valores**.
- **Valor total dos pedagios - ida + volta** soma as estimativas de ida e retorno, consultadas separadamente com `TOLLS`. Nao duplica o preco de uma perna. O Google estima veiculo de passeio a gasolina, sem tag; moeda diferente de BRL ou pedagio sem preco torna o total pendente, exigindo valor/confirmacao manual (incluindo zero quando aplicavel) antes de salvar. Ausencia de `tollInfo` na rota e tratada como sem pedagio informado pela API. O campo permite correcao manual e o historico preserva estimativas e total aplicado. Recalcular aplica a estimativa nova, descartando a correcao anterior. Consultas com pedagios podem ter tarifa superior de API.
- A previa autenticada aceita somente o destino em preenchimento, busca a origem na propria empresa via RLS e conserva o limite por empresa. Atualizar exige republicar `travel-route` e o site, sem SQL adicional nem nova chave.
- Validacao de criacao/pedagios: 296 testes passando, incluindo conversao BRL/centavos/nanos, ida e volta com precos diferentes, moeda nao suportada, ausencia de preco, autorizacao/limite da previa e compatibilidade de backups. Navegador com API simulada: criacao Sim e Nao salva com 70 km, pedagios R$12,50 + R$18,75 = R$31,25, custo R$73,25 nas duas opcoes, cobranca R$206,25 apenas em Sim. Preco incompleto impede salvar ate confirmacao manual; total manual de R$35 salvo e cobrado uma vez. Rascunho preserva o calculo e o total manual. Nao foram feitas consultas pagas nem deploy remoto.
- Com **Sim**, somente `km totais x tarifa/km + pedagios` entra no total cobrado, antes do desconto geral existente. Com **Nao**, nada de deslocamento e cobrado.
- Nos dois casos o custo de combustivel e `(km totais / km por litro) x preco por litro`; o custo interno total soma tambem os pedagios. O campo legado **Custos adicionais** continua sendo acrescimo cobrado da OS: nao e usado para inserir combustivel e nao deve receber o mesmo pedagio novamente.
- Precos, pontos, rotas, data do calculo e escolha de cobranca ficam na OS. Mudar os padroes nao altera calculos antigos. Recalcular aplica as configuracoes atuais; remover o calculo e replicar a OS nao reutilizam custos/cobrancas anteriores.
- **Relatorios > Custos de deslocamento** e seu CSV mostram custos e cobranca separadamente, com filtros por data da OS, cliente, colaborador e busca. OS sem calculo nao recebem custo zero ficticio; ficam fora dos totais, com quantidade informada. Custos estimados nao sao somados novamente as despesas manuais.
- Documento do cliente (impressao, previa e exportacao TXT) mostra o deslocamento cobrado apenas quando Sim. Consumo, preco do combustivel e custo interno permanecem fora desse documento.
- Falha no Google, configuracao ausente, endereco ausente e acesso indevido geram erro explicito, sem substituir por distancia em linha reta. Se havia calculo anterior, ele e preservado. Enderecos/pontos alterados exibem aviso na OS ate novo calculo.
- Consulte o README para habilitar Routes API e Geocoding API/faturamento, permitir ambas na chave, configurar o secret Google e publicar `travel-route`. Para quem ja ativou rotas, execute somente a nova migracao `20261015030000_address_lookup_limits.sql` e republique a funcao e o frontend; nao repita SQL antigo. A nova migracao reserva ate 30 buscas por minuto por empresa, sem expor a tabela; o limite de rotas continua separado. Nenhuma chave privada e salva no navegador. Novas consultas/calculos exigem banco seguro e acesso administrativo.
- Validacao local: 227 testes passando, incluindo formulas de 70 km, Sim/Nao, arredondamento, precos historicos, visibilidade do documento e duas pernas independentes da API simulada, alem do limite SQL por empresa. Navegador: configuracoes persistidas, cobranca Sim/Nao salva, rascunho recuperado apos atualizar, custo R$62 preservado nos dois casos, cobranca R$195 somente em Sim, documento sem custos internos, filtros e CSV. Os testes de navegador usaram rotas ficticias e restauraram a base demo; nao houve consulta paga ao Google nem publicacao remota.
- Busca automatica de coordenadas: 260 testes passando, build e lint aprovados. Cobertura de precisao/ambiguidade, erro do provedor, autorizacao, limite SQL de 30 consultas e renovacao da janela, cancelamento encaminhado ao cliente, vinculo exato do endereco e compatibilidade de backups. No navegador, com geocodificacao simulada: preenchimento e salvamento da assistencia, ausencia de nova consulta para ponto salvo, preenchimento da OS no endereco do cliente e especifico via CEP, recuperacao do ponto no rascunho, erro visivel com mapa fechado, bloqueio de salvar durante busca e correcao manual. Sem consulta paga ou publicacao remota.

## Validacao desta entrega

- 22 testes de dominio: base anterior, referencias, estoque, descontos, conversao, relato independente, pendencias, horas, sequencia de atividades, finalizacao e replicacao.
- Navegador: nova tela por Mais informacoes e por link interno; salvamento entre abas e persistencia apos recarregar.
- Navegador: foto carregada, questionario respondido, pendencia manual e total financeiro de teste conferidos.
- Navegador: assinatura desenhada com pixels de tinta, salva e reaberta.
- Navegador: atividades de deslocamento/check-in/pausa/retorno/check-out e totais conferidos.
- Navegador: reagendamento manteve relato, assinatura e atividades; orcamento criado pela OS ficou associado.
- Navegador: arquivamento, filtro Arquivadas e restauracao confirmados.
- Impressao verificada por emulacao da midia print: campos completos e assinatura presentes, sem quebras de linha literais. Impressora fisica/dialogo nativo ainda requerem teste manual.