# Inventario funcional de referencia: Bling

## 1. Objetivo e limites

Este documento compara os modulos visiveis do Bling com o escopo do Alpha Tec para orientar uma evolucao funcional. A meta e estudar equivalencia de capacidades com implementacao, regras e identidade proprias; nao copiar codigo, textos, marca ou interface proprietarios.

- Referencia consultada em 02/11/2026, com sessao autenticada fornecida pelo usuario.
- Foram observados a pagina inicial, menus principais, atalhos, a lista de pedidos de venda, Preferencias e a Central de Extensoes.
- As listas de vendas e menus foram consultados sem criar, editar, excluir, importar, transmitir ou faturar registros. Nenhuma informacao de clientes foi incluida.
- A conta, o plano, as permissoes e as integracoes habilitadas podem alterar os menus. Um item de menu confirma somente que a opcao foi exibida; nao confirma disponibilidade contratual nem funcionamento completo.
- Nao foram inspecionados todos os formularios, telas de detalhe, regras de calculo, APIs, contratos de parceiros ou resultados de operacoes. As lacunas de regra estao marcadas como **nao inspecionadas**, e nao como comportamento confirmado.
- O inventario nao altera dados, credenciais, configuracoes ou historico do Bling.

Legenda do Alpha:

- **Implementado localmente**: funcionalidade encontrada no codigo/documentacao do Alpha; nao implica publicacao ou homologacao.
- **Parcial**: existe um fluxo relacionado, mas cobre apenas parte do modulo de referencia.
- **Ausente**: nao foi encontrado modulo equivalente na navegacao atual do Alpha.
- **Pendente de producao**: implementacao local sujeita a publicacao, infraestrutura, aprovacao externa ou homologacao.
- **A confirmar**: o menu do Bling foi observado, mas seus detalhes nao foram inspecionados.

## 2. Mapa dos menus observados

| Area no Bling | Opcoes observadas | Equivalencia no Alpha |
| --- | --- | --- |
| Inicio / Meu Negocio | Visao geral, eventos, conta digital; dashboards geral, vendas, margem por pedido, produtos, clientes, curva ABC e metas | **Parcial**: existem agenda, indicadores operacionais e relatorios financeiros/operacionais. Dashboards comerciais, margem por pedido/SKU, curva ABC e metas nao foram encontrados. Eventos e conta digital nao foram encontrados. |
| Cadastros | Produtos; clientes e fornecedores; vendedores; contas e categorias financeiras; formas de pagamento; categorias de produtos; listas de precos; relatorios de cadastros | **Parcial**: clientes, fornecedores, produtos/servicos e cadastros gerenciais existem. Vendedores, categorias de produto, listas de preco e relatorios cadastrais dedicados nao foram encontrados. Bancos e categorias financeiras cobrem parte das contas/categorias; equivalencia de formas de pagamento precisa ser detalhada. |
| Vendas - gestao | Gestao de anuncios, loja virtual, pedidos de venda, notas fiscais de saida, NFC-e, frente de caixa, importacao manual de pedidos, propostas comerciais e relatorio avancado | **Parcial**: pedidos de venda em etapa inicial, propostas/orcamentos compartilhados e notas fiscais de saida existem; o fluxo fiscal e limitado e nao homologado em producao. Anuncios, e-commerce, NFC-e, PDV, importacao de pedidos e relatorio avancado nao foram encontrados. |
| Vendas - logistica | Objetos de postagem, logistica reversa, checkout, impressao automatica de etiquetas e Bling Envios | **Ausente/parcial**: o Alpha possui rotas de atendimento tecnico, mas isso nao equivale a expedicao de vendas. Nao foram encontrados modulos de postagem, etiquetas ou checkout logistico. |
| Vendas - servicos | Contratos, ordens de servico, CT-e, notas de servico, cobrancas e relatorios de servico | **Local**: contratos com cobranca, Cobrancas, Notas de servico (NFS-e), OS com as 9 situacoes e menu de tres pontos e relatorios de servico implementados (secao 3.2.2). Transmissao da NFS-e, boletos/e-mail e CT-e permanecem pendentes. |
| Estoque - compras | Pedidos de compra, notas fiscais de entrada, fornecedores, sugestao de compras e check-in de recebimentos | **Parcial**: fornecedores, compras, cotacoes/aprovacoes, recebimentos e entradas no estoque existem. Importacao de NF-e de entrada e sugestao automatica de compras nao foram encontradas; regras detalhadas de sugestao e check-in do Bling nao foram inspecionadas. |
| Estoque | Lancamentos, conferencia de estoque, ordens de producao, depositos, multiempresa e relatorios de compras/estoque | **Parcial**: livro de movimentos, contagem, depositos, transferencias, saldos e custo medio existem. Ordens de producao e operacao multiempresa em uma mesma base nao foram encontrados. Um relatorio dedicado de compras/estoque nao foi identificado. |
| Financeiro - gestao | Caixas e bancos, contas a pagar/receber, remessas e retornos, ficha financeira, comissoes, controle de caixa e faturamento agrupado | **Parcial**: contas, bancos, faturamentos, transferencias, fluxo, conciliacao por CSV/OFX e arquivo CNAB base existem. Comissoes, controle de caixa de PDV e agrupamento de faturamentos nao foram encontrados. Retorno/baixa bancaria automatica e conciliacao por integracao permanecem pendentes. |
| Financeiro - tributos/solucoes | DAS MEI, GNRE/DARE-SP, espaco do contador, conta digital e relatorios financeiros | **Parcial/ausente**: relatorios e fluxo financeiro interno existem. DAS, GNRE/DARE, portal do contador e conta digital nao foram encontrados. |
| Preferencias | Empresa, sistema, cadastros, suprimentos, vendas, notas fiscais, certificado, financas, servicos, integracoes, logistica, contabilidade, importacao e backup/exportacao | **Parcial**: empresa, usuarios, atendimento, relatorios, fiscal/certificado e backup estao organizados no Alpha. As outras preferencias, importacao especializada, contabilidade e administracao de integracoes precisam ser avaliadas conforme os modulos forem especificados. |
| Central de Extensoes | Descoberta, integracoes, instalacoes, servicos e catalogo de marketplaces, plataformas de e-commerce, PDV, logistica e outros parceiros | **Ausente**: nao ha uma central de integracoes/marketplace no Alpha. Foram vistos exemplos como Mercado Livre, Shopee, Amazon, TikTok Shop, Tray, Bagy e servicos de logistica; a compatibilidade, cobertura e os contratos de API nao foram avaliados. |
| Navegacao global | Pesquisa no cabecalho e atalhos favoritos para telas frequentes | **Parcial/ausente**: ha busca contextual em algumas listas, mas nao foi encontrada pesquisa global de registros nem painel equivalente de favoritos configuraveis. |

## 3. Telas e regras observadas diretamente

### 3.1 Inicio

A pagina inicial exibe atalhos favoritos, eventos e acesso a dashboards. A lista de favoritos observada inclui pedidos de venda, notas fiscais, produtos, pedidos de compra, clientes/fornecedores e pedidos de lojas virtuais. Foram vistos paineis para vendas, margem, produtos, clientes, curva ABC e metas. Os criterios, formulas, filtros e acoes dos dashboards nao foram abertos; esses detalhes ficam **a confirmar**.

### 3.2 Pedidos de venda

A lista consultada exibiu busca por nome/e-mail/CPF-CNPJ/numero do pedido, periodo, situacao, filtro por loja e inclusao de pedido. A barra de acoes mencionou gerar NF-e, alterar situacao, imprimir, enviar dados para loja virtual e imprimir etiquetas. O painel tambem mostrava quantidade de vendas.

O recorte exibido estava sem resultados. O formulario de inclusao foi aberto e cancelado sem salvar. Campos e secoes observados:

- **Cliente** obrigatorio, com busca e atalho para adicionar cadastro; **vendedor** opcional; loja, unidade de negocio e lista de preco.
- Itens pesquisaveis por codigo, descricao ou GTIN, com codigo, unidade, quantidade, preco de lista, desconto percentual, preco unitario e total. A tela informa que alguns tipos de produto nao aparecem na selecao.
- Totais com quantidade de itens, quantidade agregada, desconto (a ajuda aceita valor ou percentual), prazo de entrega em dias, outras despesas, descontos, comissao, total de itens e total da venda.
- Detalhes com numero do pedido, data da venda, data de saida, data prevista e numero do pedido de compra do cliente.
- Pagamento por condicao (a ajuda cita formas cadastradas, parcelas ou prazos, por exemplo 30/60 ou 3x), acao **Gerar parcelas** e categoria financeira.
- Secao **Comissoes** com base, adicionais da base, aliquota percentual e valor da comissao.
- Secao **Transportador** com nome, responsabilidade pelo frete (opcoes CIF/FOB, terceiros, transporte proprio ou sem ocorrencia), quantidade, peso bruto, valor do frete, seletor de integracao logistica e endereco de entrega alternativo.
- Observacoes destinadas a impressao/fatura/observacoes da nota e observacoes internas nao impressas.
- Acoes **Salvar** e **Cancelar**.

Esses campos e textos de ajuda sao evidencia da interface, nao confirmacao de formulas, obrigatoriedade de campos opcionais, efeitos contabil/fiscal, regras de parcelas, integracao de estoque, sincronizacao de loja, transporte ou transicoes de situacao. Nao foi salvo um pedido e nao foi testada nenhuma acao em lote.

No Alpha, o pedido de venda inicial e uma entidade distinta de orcamento, OS, faturamento e documento fiscal.

#### Menu de acoes (tres pontos) da linha do pedido

Testado no Bling em modo de teste autorizado com um pedido proprio (pedido de teste n. 19, mantido no Bling). O menu da linha contem: Editar; Gerar nota fiscal; Gerar nota fiscal parcial; Lancar/Estornar estoque; Lancar/Estornar contas; Gerar NFC-e; Gerar nota de servico; Gerar ordem de servico; Clonar venda; Gerar reversao; Imprimir, Imprimir comprovante e Imprimir com detalhes; Imprimir etiqueta, carne e relatorio de producao; Enviar por e-mail/WhatsApp; Emitir boletos; e Alterar situacao (Em aberto, Em andamento, Atendido, Cancelado). No Bling o lancamento de estoque e de contas e independente da situacao.

Replica no Alpha (local):

- Situacoes do Bling: Em aberto, Em andamento, Atendido e Cancelado (terminal). Pedidos antigos migram de Rascunho para Em aberto e de Confirmado para Atendido, com o estoque ja baixado registrado como lancado.
- **Lancar/Estornar estoque** e independente da situacao, pode ser repetido em ciclos e gera movimentos rastreaveis vinculados ao pedido.
- **Lancar contas** cria o faturamento interno e uma conta a receber por grupo (Produtos -> NF-e; Servicos -> NFS-e) com conta bancaria, vencimento e Pix/Boleto. Frete e outras despesas entram no grupo de servicos, seguindo a convencao das OS. **Estornar contas** cancela os lancamentos se nao houver recebimentos.
- **Gerar nota fiscal** (NF-e) abre o editor local da NF-e em Vendas a partir do pedido (secao 3.2.1); **Gerar nota de servico** lanca as contas quando necessario e abre a inclusao da NFS-e com o faturamento pre-selecionado.
- **Gerar ordem de servico** cria uma OS vinculada; **Clonar venda** abre um novo pedido com os mesmos dados; as tres impressoes geram documento imprimivel.
- O pedido so pode ser editado em Em aberto/Em andamento, sem estoque lancado e sem contas. Cancelar estorna o estoque lancado e e bloqueado enquanto houver contas.
- Ficam desabilitados como "em breve": nota fiscal parcial, NFC-e, reversao, etiqueta de envio, carne, relatorio de producao, envio por e-mail/WhatsApp e emissao de boletos.

#### 3.2.1 Nota fiscal de venda de produto (NF-e)

Testado no Bling com o pedido de teste n. 19: "Gerar nota fiscal" abriu a NF 000002 preenchida, salva como Pendente e **nao transmitida**; o pedido passou a Atendido. Secoes observadas: aviso "Algumas informacoes podem causar a rejeicao dessa nota"; dados da nota (tipo de saida, serie, numero que pode mudar ao gravar, loja, unidade de negocio, natureza de operacao, datas/horas, regime tributario, finalidade, indicador de presenca); destinatario (contato, tipo de pessoa, documento, IE, vendedor, consumidor final, endereco, fone, e-mail, ente governamental); itens com modal "Item da nota fiscal" em abas (Dados do item, ICMS, IPI, PIS, COFINS, Importacao, Outros, Estoque, Retencoes, IS, IBS, CBS); historico do produto para o cliente; conciliacao de produtos; chave de calculo automatico e totais; retencoes; transportador/volumes; pagamento com condicao, "Gerar parcelas" e modal "Dados da parcela"; pessoas autorizadas a acessar o XML; informacoes adicionais. Sem classificacao tributaria IBS/CBS o Bling bloqueia a gravacao.

Correspondencia no Alpha (`SalesNfePanel`, `NfeEditor`, `outgoingInvoices.ts`, colecao `outgoingInvoices`):

- Editor com as mesmas secoes e abas. O calculo automatico calcula ICMS/FCP/ST, IPI, PIS, COFINS, IS, IBS/CBS (base = operacao - ICMS - PIS - COFINS, como no Bling), Funrural, comissao, IBPT e retencoes; desligado, os campos ficam editaveis.
- Pendencias bloqueiam a gravacao (destinatario, natureza, itens, CST do ICMS, CST/classificacao IBS/CBS); avisos (documento, UF/municipio, NCM, CFOP) apenas alertam.
- Condicoes "30 60", "3x" e "15 +2x"; a sobra de centavos fica na primeira parcela. Formas aceitas: Boleto e Pix.
- Ao salvar, a nota fica Pendente, o pedido passa a Atendido e, se houver parcelas, as contas a receber sao lancadas: para pedido, um faturamento de Produtos com uma conta por parcela (frete/outras despesas entram na NF-e); se o pedido ja tinha faturamento de servicos, o valor de produtos rateado e mantido. Nota avulsa lanca contas proprias.
- Menu de tres pontos: Editar/Visualizar, Validar (local), Lancar/Estornar contas, Lancar/Estornar estoque (somente nota com pedido), Clonar, Imprimir espelho da NF, Cancelar (motivo, exige contas estornadas) e Excluir (Pendente sem contas). Enviar, XML, e-mail, WhatsApp, NF-e complementar, boletos, clonar para entrada, DANFE e etiquetas ficam "em breve".
- A nota nao e transmitida a SEFAZ: Validar/Enviar no backend fiscal dependem da conexao com o backend.

#### 3.2.2 Coluna Servicos (contratos, OS, NFS-e, cobrancas e relatorios)

Testado no Bling com dados de teste mantidos na conta: contrato "Contrato teste Alpha - manutencao mensal", cobranca 11/2026 (R$ 100), OS 91 e NFS-e RPS 000110 Pendente (nao transmitida).

- **Notas de servico (NFS-e)** - `SalesNfsePanel`, `NfseEditor`, `serviceInvoices.ts`: RPS/serie, tomador, servico (codigos nacional/municipal, NBS, CST), ISS (reter/descontar), retencoes INSS 11%, PIS 0,65%, COFINS 3%, CSLL 1% e IR, IBPT, vendedor/comissao e parcelas. Total = base - retencoes - ISS (so com "Descontar ISS"); a sobra de centavos fica na 1a parcela. Menu de tres pontos com lancar/estornar contas, registrar emissao, clonar, espelho, cancelar e excluir. Origem a partir de pedido, OS, faturamento ou cobranca de contrato.
- **Contratos** - `MaintenanceContractsPanel`, `contractCharges.ts`: aba em Vendas (`#contracts` redireciona para `#sales/contracts`). Numero, periodicidade, data base, dia/regra de vencimento (dia inexistente usa o ultimo do mes), desconto ate um mes, impressao do periodo, gerar NFS-e/OS por cobranca. Isento, Avaliacao e Suspenso nao geram cobranca. O valor mensal nao e editavel (orienta clonar o contrato).
- **Cobrancas** - `SalesChargesPanel`: lista por mes com filtros de contas/notas, gera cobrancas do mes sem duplicar, gera notas no filtro e exclui cobrancas sem baixa.
- **Ordens de servico** - as 9 situacoes do Bling (Em aberto, Orcada, Aprovada, Nao aprovada, Em andamento, Servico concluido, Aguardando componentes, Finalizada, Finalizada sem conserto) ficam em `details.situation`, agrupadas sobre os 4 status gravados (Aberta, Em atendimento, Pausada, Finalizada) para preservar Supabase e app do tecnico; se o status muda por fora, a situacao volta a padrao do grupo. Menu de tres pontos: abrir, editar, gerar NFS-e/NF-e (a NF-e da OS deixa as contas para o faturamento da OS), imprimir, imprimir para tecnico (sem valores), clonar e mudar situacao; etiqueta e e-mail "em breve".
- **Relatorios de servico** - `serviceReporting.ts` e grupo "Servicos" em Relatorios: contratos por inicio/termino (inclusive agrupados por mes), notas de servico com ISS/retencoes/total, parcelas de NFS-e pelo vencimento, OS por situacao e exportacao CSV. CT-e fica "em breve".

### 3.3 Correspondencia comercial atual no Alpha

Por decisao do usuario, **Propostas comerciais** em Vendas e **Orcamentos** usam os mesmos registros: criar ou editar em uma tela atualiza a outra, sem duplicacao. O cadastro permite cliente, emissao, validade, itens de produto/servico, quantidade, preco unitario editavel, desconto em reais, modelos de equipamento e condicoes/observacoes. Seus estados sao **Rascunho**, **Enviado**, **Aprovado** e **Recusado**. O registro de aprovacao preserva um snapshot dos termos; orcamento aprovado ou ja convertido nao pode ser alterado, e orcamento vencido nao pode ser aprovado. Cada registro aprovado pode gerar no maximo uma OS e um pedido de venda em rascunho.

A conversao para OS e orientada a assistencia: cria OS aberta com data de hoje, horario e duracao iniciais, tipo/prioridade padrao, tecnico padrao da empresa e os itens do orcamento descritos nas observacoes. A conversao para pedido de venda cria um rascunho independente; somente sua confirmacao baixa os produtos do estoque. Criar ou aprovar uma proposta nao movimenta estoque nem gera cobranca, nota fiscal ou conta a receber.

Em Vendas, a navegacao apresenta propostas comerciais, pedidos de venda, notas fiscais de saida e notas de servico nessa ordem; a abertura padrao mostra as propostas. Cada tipo de nota abre sua propria listagem, com inclusao e configuracao fiscal acessiveis na tela, sem repetir o menu de navegacao.

Referencias locais: [editor de orcamentos](../app/src/Forms.tsx), [regras e conversoes](../app/src/domain.ts), [propostas comerciais](../app/src/CommercialProposalsPanel.tsx) e [abas Vendas](../app/src/SalesPanel.tsx).

### 3.4 Preferencias e integracoes

Preferencias apresentou categorias para empresa, sistema, cadastros, suprimentos, vendas, notas fiscais, certificado, financas, servicos, integracoes, logistica, contabilidade, importacoes e backup/exportacao. A maioria dos formularios internos dessas categorias nao foi aberta.

A Central de Extensoes apresentou descoberta, integracoes, instalacoes, servicos e exemplos de parceiros. A tela nao foi usada para instalar, autorizar ou configurar qualquer integracao. Autenticacao OAuth, escopos, webhooks, sincronizacao, limites, custos e suporte por plano permanecem **nao inspecionados**.

### 3.5 Outros menus

Os menus de Cadastros, Estoque e Financeiro foram inspecionados no nivel de navegacao. Suas opcoes constam na tabela da secao 2. Paginas de produtos, compras, estoque, contas, tributos e relatorios nao foram exploradas em detalhe; os campos, validacoes, permissoes e efeitos transacionais precisam de levantamento proprio.

## 4. Estado e riscos do Alpha

O inventario local confirma um ERP de assistencia tecnica ja amplo, mas com profundidade diferente do escopo de varejo/e-commerce do Bling:

- **Operacao tecnica**: agenda, OS, clientes, equipamentos, contratos de manutencao, questionarios e app de tecnicos ja formam o nucleo do Alpha; nao devem ser substituidos por um fluxo de pedido generico.
- **Compras e estoque**: pedidos, aprovacao, recebimento, devolucao, deposito, reservas e custo medio estao implementados localmente. Publicacao de protecoes SQL, validacao remota e ciclo completo em producao continuam pendentes.
- **Financeiro**: ha contas, baixas, parcelamento, recorrencias, transferencias, relatorios e conciliacao importada. Isso nao equivale a integracao bancaria, cobranca registrada, boleto/Pix emitido ou retorno bancario automatico.
- **Comercial**: orcamentos, OS, pedidos de venda em etapa inicial e faturamentos internos existem. Fluxo de entrega parcial, devolucao integrada, relacao com canais e etapas comerciais completas ainda faltam.
- **Fiscal**: NF-e/NFS-e possuem catalogo, regras parametrizadas e geradores em escopo limitado de homologacao. A checklist fiscal mantem pendentes a aprovacao contabil, validacao oficial, certificado real, infraestrutura, homologacao e liberacao de producao. NFC-e/CT-e nao foram encontrados no Alpha.
- **Relatorios**: foco em atendimento, tarefas, despesas, horas, deslocamento e financeiro gerencial. Dashboards de vendas/estoque, metas, margem por produto e contabilidade precisam de requisitos e formulas especificos.
- **Seguranca/escala**: existem Supabase Auth, isolamento por empresa e protecoes especificas. A checklist ainda registra permissoes granulares, auditoria transversal, validacoes server-side uniformes, backup/restauracao, monitoramento e testes de concorrencia/carga.
- **Persistencia**: o frontend usa um documento JSONB de ate 5 MB por empresa; a versao local tambem usa localStorage. Expansao para integracoes, grande volume e escrita concorrente exige projeto de dados/operacao, nao apenas novas telas.

Consulte [CHECKLIST-ERP.md](../CHECKLIST-ERP.md), [CHECKLIST-FATURAMENTO.md](../CHECKLIST-FATURAMENTO.md) e [README.md](../README.md) para os detalhes de implementacao e publicacao ja registrados. Itens marcados como presentes localmente nao significam implantados ou liberados para producao.

## 5. Roteiro para completar a especificacao

Este mapa e uma primeira passada por menus; nao e uma especificacao de paridade tela a tela. Para cada modulo ainda e necessario inspecionar, sem operar dados reais:

1. Listas, filtros, colunas, estados vazios, paginacao, exportacoes e acoes em lote.
2. Formularios de criacao/edicao, campos obrigatorios, validacoes, precos, descontos, parcelas e permissoes.
3. Ciclo de vida: aprovar, faturar, expedir, cancelar, devolver, estornar e impactos em estoque/financeiro/fiscal.
4. Relatorios, indicadores, formulas, periodos, exportacoes e rastreabilidade ate o registro de origem.
5. Integracoes: provedor, contrato, autenticacao, escopos, webhooks, retry, idempotencia, limites, custos e ambiente de homologacao.
6. Necessidades proprias do Alpha: atendimento tecnico, OS, contratos recorrentes, estoque de pecas, app de tecnicos e seguranca por papel.

Decisoes confirmadas pelo usuario para a primeira etapa de pedidos no Alpha:

- Pedido de venda e uma entidade independente da OS; o vinculo com OS e opcional.
- Um orcamento aprovado pode ser convertido em pedido, sem substituir a conversao existente para OS.
- Lancar estoque baixa os produtos do deposito selecionado, de forma independente da situacao (substitui a antiga confirmacao).
- Contas a receber sao criadas pela acao Lancar contas do menu do pedido; salvar o pedido nao cria lancamentos financeiros.
- Situacoes seguem o Bling (Em aberto, Em andamento, Atendido, Cancelado). Cancelar um pedido com estoque lancado registra movimentos de estorno vinculados ao pedido e repoe o saldo no deposito original.

A implementacao local cobre cadastro/edicao do pedido, conversao de orcamento aprovado, vinculo opcional com OS, descontos por item e geral, frete, outras despesas, vendedor, prazo previsto, condicao de pagamento como informacao, lancamento/estorno rastreavel de estoque e de contas e encaminhamento para NF-e/NFS-e. Nao inclui entrega parcial, reserva, nota parcial, NFC-e, cobranca bancaria automatica, listas de preco, comissoes ou integracoes de loja/logistica. A tela usa o documento local/JSONB existente; validacao server-side uniforme e concorrencia transacional continuam pendentes para producao.

A interface consultada no Bling nao confirma essas regras internas; elas sao decisoes proprias do Alpha e nao devem ser atribuidas ao comportamento do Bling.

Sequencia recomendada para especificacao (nao e compromisso de prazo): **pedido de venda e ciclo comercial**; **cadastros/precos**; **devolucoes e estoque ligado a venda**; **fiscal e cobranca real**; **logistica e canais**; **dashboards e relatorios comerciais**; **permissoes, auditoria e escala**. Cada etapa deve terminar com requisitos e criterios de aceite aprovados antes de alterar o produto.

Qualquer integracao real requer credenciais e homologacao pelo canal seguro do respectivo provedor; nao enviar senhas, certificados ou chaves pelo chat. Nenhum segredo do Bling foi registrado neste documento.
