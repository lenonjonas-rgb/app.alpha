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

## Regras locais e limites

- Campos novos opcionais preservam compatibilidade com a base anterior e backups da versao 1.
- Salvar detalhes valida referencias, valores, imagens e atividades antes de escrever no navegador.
- Alteracao concorrente dos detalhes em outra aba impede sobrescrever o rascunho antigo; backend/transacoes continuam pendentes.
- Pergunta obrigatoria sem resposta gera pendencia, sem impedir salvar um atendimento incompleto. A finalizacao identifica se ha pendencias, como observado na referencia.
- Atividade em andamento exige check-out antes de finalizacao manual. Pausa exige motivo e retorno antes de check-out.
- A contagem de horas inclui intervalos maiores que 24 horas. Horarios e autoria sao informados localmente, sem garantia de autenticidade.
- Assinatura local nao verifica identidade, nao envia codigo por email e nao fornece certificacao juridica.
- Anexos locais pequenos consomem a cota de localStorage; nao ha armazenamento remoto. Exportar backup e usar dados ficticios permanece necessario.
- Replica copia orientacoes, itens e estrutura de questionarios, mas limpa relato, respostas, fotos, assinatura, atividades e pendencias manuais.
- Modelos de questionarios sao proprios desta versao; nao ha catalogo compartilhado/versionado de modelos ainda.
- A selecao de CPF/CNPJ, data e numero como tipo de resposta nao equivale a validacao documental completa. A validacao avancada dos tipos e formatos segue pendente.
- Envio real, GPS, notificacoes push, calculo de rotas/km, PDF de servidor e cobranca dependem de backend/provedores e nao foram implementados como controles falsos.

## Validacao desta entrega

- 22 testes de dominio: base anterior, referencias, estoque, descontos, conversao, relato independente, pendencias, horas, sequencia de atividades, finalizacao e replicacao.
- Navegador: nova tela por Mais informacoes e por link interno; salvamento entre abas e persistencia apos recarregar.
- Navegador: foto carregada, questionario respondido, pendencia manual e total financeiro de teste conferidos.
- Navegador: assinatura desenhada com pixels de tinta, salva e reaberta.
- Navegador: atividades de deslocamento/check-in/pausa/retorno/check-out e totais conferidos.
- Navegador: reagendamento manteve relato, assinatura e atividades; orcamento criado pela OS ficou associado.
- Navegador: arquivamento, filtro Arquivadas e restauracao confirmados.
- Impressao verificada por emulacao da midia print: campos completos e assinatura presentes, sem quebras de linha literais. Impressora fisica/dialogo nativo ainda requerem teste manual.