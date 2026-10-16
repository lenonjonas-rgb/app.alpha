# Checklist do ERP Alpha

Marcar somente apos implementar e verificar. Codigo local, publicacao e homologacao sao etapas diferentes. Este documento registra o escopo escolhido: gestao interna e arquivos primeiro; integracoes reais depois.

## 1. Financeiro gerencial

- [x] Contas a pagar/receber, baixas parciais, estornos e cancelamento interno protegido.
- [x] Faturar somente OS finalizadas, nao arquivadas e com valor pendente positivo.
- [x] Painel de caixa, realizado/previsao e vencimentos atuais.
- [x] Categorias, centros de custo e classificacao dos titulos sem reescrever snapshots fiscais.
- [x] Base inicial manual por banco e posicao gerencial.
- [x] Relatorios por periodo/banco/categoria/centro e exportacao CSV.
- [x] Transferencias entre contas, com duas pontas vinculadas, estorno atomico e protecao SQL de historico (validacao local; publicacao pendente).
- [x] Parcelar novas contas manuais a pagar/receber, com previa mensal, datas editaveis, total exato e vinculos protegidos (validacao local).
- [ ] Parcelar faturamentos de OS/titulos existentes e renegociar com historico e integracao fiscal/bancaria.
- [x] Juros, multas e descontos manuais em reais nas baixas de contas manuais/parcelas, com principal/caixa separados, motivo, confirmacao e historico (local).
- [ ] Ajustes de liquidacao em faturamentos de OS, perdao/baixa sem caixa e regras automaticas de juros/atraso.
- [ ] Orcamento financeiro e comparacao orcado x realizado.
- [ ] Resultado por competencia, margem por OS/cliente/contrato e revisao contabil.

## 2. Conciliacao bancaria por arquivo

- [x] Importar CSV padronizado e OFX bancario, com previa e confirmacao da conta (escopo/limites no README).
- [x] Impedir duplicacao/reimportacao conflitante de movimentos.
- [x] Associar movimento a baixa existente sem gerar novo recebimento/pagamento.
- [x] Dar baixa e conciliar mediante confirmacao explicita, validando tipo/conta/data/valor.
- [x] Desfazer vinculo sem apagar movimento nem estornar dinheiro automaticamente.
- [x] Preservar historico e invalidar conciliacao quando a baixa for estornada.
- [x] Implementar/testar protecao SQL de extratos/vinculos e revalidacao de estado atual, incluindo backups e dupla conciliacao. Migracao ainda nao aplicada em producao.
- [x] Conciliar cada ponta de transferencia com extrato exato, sem novas baixas; estados independentes, desfazimento e estorno com historico e protecao SQL (local).
- [ ] Conciliacao dividida/agrupada, tarifas, datas diferentes entre pontas e outras divergencias.
- [ ] Homologar importacao com arquivos reais dos bancos utilizados.

## 3. Comercial

- [ ] Integrar orcamentos existentes a aprovacao, pedido, OS e faturamento.
- [ ] Controlar entregas/servicos parciais, cancelamentos e devolucoes.
- [ ] Condicoes de pagamento, descontos e aprovacoes comerciais.

## 4. Compras e fornecedores

- [x] Cadastro/editabilidade/inativacao de fornecedores, contatos/endereco e CPF/CNPJ opcional validado/unico; nome/documento historicos preservados nos pedidos (local).
- [x] Pedidos confirmados imutaveis, itens/total, banco/classificacao e pagamentos unicos ou parcelados com previa/datas editaveis; cancelamento justificado antes de receber (local).
- [x] Recebimento integral conferido com data/referencia/observacoes e geracao atomica das contas a pagar, sem duplicidade por pedido, mesmo apos cancelamento de conta (local).
- [x] Protecao SQL de fornecedores/pedidos/recebimentos/contas vinculadas e isolamento do tecnico, validada em PostgreSQL local; publicacao pendente.
- [ ] Cotacoes, aprovacoes por alcada e trilha de auditoria de alteracoes de fornecedores.
- [ ] Recebimento parcial, conferencias e devolucoes.
- [ ] Entradas de estoque vinculadas ao recebimento, sem duplicidade (recebimento financeiro atual nao movimenta estoque).

## 5. Estoque integrado

- [ ] Livro de movimentacoes, saldos por local e estoque minimo.
- [ ] Reservas/consumo de pecas por OS e devolucao.
- [ ] Inventario e ajustes justificados.
- [ ] Custo medio e margem sem reescrever historico.
- [ ] Rastreabilidade compra -> estoque -> OS/venda -> devolucao.

## 6. Contratos e recorrencias

- [ ] Contratos de manutencao e vinculo a cliente/unidade/equipamento.
- [x] Recorrencias financeiras mensais a pagar/receber com vigencia, suspensao/reativacao/cancelamento e historico (local).
- [x] Geracao manual de contas por previa/confirmacao, sem duplicar recorrencia/mes, inclusive contas canceladas (local).
- [ ] Reajustes, renovacoes e versionamento de condicoes contratuais.
- [ ] Geracao de OS/tarefas previstas dos contratos de manutencao.
- [ ] Controle de inadimplencia e renovacoes.

## 7. Fiscal e cobranca real

Detalhamento tecnico e limitacoes em [CHECKLIST-FATURAMENTO.md](./CHECKLIST-FATURAMENTO.md).

- [x] Estrutura de backend fiscal, certificado A1, cadastros, calculos e remessas implementada para validacao.
- [ ] Publicar backend privado com armazenamento persistente, backups e secrets seguros.
- [ ] Validar cadastros/matriz tributaria com a contabilidade e operacoes reais.
- [ ] Homologar NF-e/NFS-e com A1 real e retornos oficiais antes de habilitar producao.
- [ ] Concluir eventos fiscais aplicaveis, consultas e recuperacao de falhas.
- [ ] Homologar registro/retorno de boleto e conciliacao bancaria sem confundir remessa com pagamento.
- [ ] Definir e integrar Pix real/banco/provedor, com notificacoes idempotentes e conferencia.

## 8. Governanca e operacao

- [x] Isolamento por empresa e restricao do financeiro ao painel administrativo.
- [x] Protecao SQL do historico de contas/faturamentos/baixas no codigo.
- [ ] Permissoes granulares por acao e aprovacoes por valor/responsavel.
- [ ] Auditoria persistente de autor, data, antes/depois e justificativa.
- [ ] Fechamento/reabertura autorizada de periodos.
- [ ] Validacoes server-side para todos os novos processos, sem depender apenas da interface.
- [ ] Backups coordenados Supabase/backend e restauracao testada.
- [ ] Monitoramento, alertas, recuperacao e teste de carga/concorrencia.

## 9. Publicacao e aceite

- [ ] Revisar e publicar as etapas gerenciais locais ainda sem commit/push.
- [ ] Conferir quais migracoes ja estao aplicadas; aplicar somente pendentes em ambiente de teste.
- [ ] Validar com usuarios reais os processos integrados e saldos iniciais.
- [ ] Conferir isolamento de tecnicos e permissoes administrativas em producao.
- [ ] Testar o ciclo completo: compra -> estoque -> OS/venda -> fiscal -> cobranca -> conciliacao.
- [ ] Aprovar operacao em producao com financeiro/contabilidade e documentar procedimentos.

## Entrega em andamento

Conciliacao por CSV/OFX implementada e validada localmente, individual (um movimento para uma baixa), sem conexao bancaria. Suite frontend: 435 testes aprovados; build e lint aprovados. Teste no navegador: titulo sintetico de R$ 100,00, importacao de credito R$ 40,00, baixa/conciliacao e recarga mantiveram R$ 40,00 realizado + R$ 60,00 previsto; dados sinteticos removidos ao final. Validacao local nao equivale a homologacao com extrato real ou aplicacao de SQL em producao.

Transferencias internas implementadas: contas ativas distintas, valor positivo, data nao futura, registro unico das duas pontas; posicoes por banco, fluxo diario e CSV separados de receitas/despesas. Estorno justificado/confirmado preserva registro e retira ambas as pontas dos calculos. Protecao SQL em `20261016020000_finance_transfer_guards.sql`, testada localmente e ainda nao aplicada em producao. Teste no navegador com R$ 25,00 confirmou persistencia apos recarga, origem -R$ 25,00/destino +R$ 25,00, resultado operacional zero e estorno das duas pontas; dados sinteticos removidos.

Vinculos de extrato com transferencias implementados: cada ponta pode ser conciliada separadamente por conta/data/sinal/valor exatos, com selecao explicita, sem criar baixas ou alterar saldos. Desfazer uma ponta preserva a outra; estorno da transferencia torna ambas pendentes preservando historico. Migracao aditiva `20261016030000_bank_transfer_match_guards.sql` protege historico e impede ocupacao cruzada com baixas, inclusive em restauracoes/escritas diretas.

Validacao desta etapa: 462 testes frontend aprovados, incluindo PostgreSQL PGlite e isolamento do tecnico; build/type-check, lint e verificacao de diff aprovados. No navegador, transferencia sintetica de R$ 25,00: ambas as pontas conciliadas por selecao explicita, persistencia apos recarga, desfazimento apenas da saida preservando entrada e estorno tornando ambos os extratos pendentes, sem novas baixas e sem apagar historico. Dados locais originais restaurados ao final. Migracoes nao aplicadas em producao; sem commit/push nesta etapa.

Parcelamento manual implementado conforme escopo confirmado: novas contas a pagar/receber; mensal com previa e edicao das datas. Ate 120 parcelas, centavos restantes nas primeiras e ajuste de meses curtos preservando o dia original. Gravacao atomica sem titulo adicional pelo total; parcelas com baixa/estorno/cancelamento independentes e classificacao inicial comum. Metadata opcional preserva grupo/numero/total original; relatorios/CSV e conciliacao usam as parcelas sem duplicar valores. Migracao aditiva `20261016040000_finance_installment_guards.sql` valida grupos completos, rateio/datas/origem/banco; campos originais continuam imutaveis pela protecao financeira anterior.

Validacao do parcelamento: 476 testes frontend aprovados, incluindo PostgreSQL PGlite e isolamento tecnico; build/type-check e lint aprovados. Navegador: total R$ 100,00 em R$ 33,34/R$ 33,33/R$ 33,33, calendario 31/out -> 30/nov -> 31/dez, rejeicao atomica de datas duplicadas, edicao de vencimento, categorias/centros em todas as parcelas e persistencia apos recarga. Baixa parcial de R$ 10,00 apenas na primeira; a receber, teste de tres parcelas de R$ 0,01. Dados locais originais restaurados. SQL nao aplicado em producao; sem commit/push.

Juros/multas/descontos manuais na liquidacao implementados conforme escopo confirmado: somente contas manuais e parcelas; caixa positivo obrigatorio. Principal liquidado preserva o contrato de `settlements[].amount` e reduz o saldo; caixa efetivo considera acrescimos/desconto nos realizados, posicoes, relatorios/CSV e conciliacao exata. Motivo/confirmacao obrigatorios, sem taxas presumidas; estorno preserva ajustes e reabre principal, invalidando conciliacao. Migracao aditiva `20261016050000_settlement_adjustment_guards.sql` valida ajustes e atualiza comparacao do extrato sem remover protecoes do historico.

Validacao dos ajustes: 490 testes frontend aprovados, incluindo PostgreSQL PGlite, limites monetarios exatos, CSV seguro e isolamento tecnico; build/type-check, lint e diff aprovados. Navegador: principal R$ 100,00 + juros R$ 10,00 + multa R$ 2,00 - desconto R$ 5,00 = caixa R$ 107,00, persistencia apos recarga e conciliacao com credito R$ 107,00. Pagamento de principal R$ 100,00 com desconto R$ 5,00 movimentou R$ 95,00; painel confirmou saldo R$ 12,00. Desconto integral com caixa zero rejeitado; editar ajuste invalidou confirmacao; estorno liberou extrato sem apagar historico. Dados locais originais restaurados. SQL nao aplicado em producao; sem commit/push.

Recorrencias financeiras mensais implementadas conforme escopo confirmado: pagar/receber, vigencia explicita, previa manual de ate 24 meses e geracao atomica sem duplicidade por recorrencia/mes (inclusive contas canceladas). Cadastro nao cria contas nem inflaciona previsao. Suspender/reativar/cancelar exige motivo/confirmacao e preserva contas; cancelamento definitivo. Reativar permite conferir meses pendentes da vigencia, inclusive passados durante suspensao. Dados originais imutaveis; reajustes/contratos de manutencao/OS nao foram incluidos. Migracao `20261016060000_finance_recurrence_guards.sql` preserva definicoes/eventos, valida contas geradas e referencias ativas, vigencia, classificacao inicial e limite de lote. Metadata acompanha backup/sincronizacao sem expor ao tecnico.

Validacao das recorrencias: 507 testes frontend aprovados em 45 arquivos, incluindo PostgreSQL PGlite, duplicidades/backup/CAS, referencias, limite de lote, historico e isolamento tecnico; build/type-check, lint e diff aprovados. Navegador: cadastro nao criou contas; geracao de tres mensalidades de R$ 100,00 (31/out, 30/nov, 31/dez) persistiu R$ 300,00 com classificacoes e vinculos apos recarga. Periodo repetido e mes com conta cancelada nao geraram novamente; suspensao bloqueou geracao, reativacao manteve contas e cancelamento definitivo preservou historico/contas. Recorrencia a receber gerou R$ 0,01 para o cliente escolhido. Dados originais restaurados. SQL nao aplicado em producao; sem commit/push.

Compras e fornecedores implementados conforme escopo confirmado: fornecedores editaveis/inativaveis com CPF/CNPJ numerico/alfanumerico opcional validado e unico, contatos/endereco; pedidos com snapshot de nome/documento e condicoes imutaveis, itens de quantidade inteira, previa mensal de 1 a 120 pagamentos e vencimentos editaveis. Pedido aberto nao cria contas/previsao. Recebimento integral conferido gera todas as contas/classificacoes atomicamente, sem duplicidade por pedido, inclusive apos cancelamento de conta. Cancelamento justificado/confirmado somente antes de receber, definitivo. Sem movimentacao de estoque, parciais/devolucoes, fiscal/boletos, aprovacao por alcada ou importacao XML. Referencia documental informativa nao impede pedidos diferentes para a mesma compra. Migracao `20261016070000_purchase_guards.sql` protege historico, dados de fornecedores, origem/parcelas/classificacao inicial e operacoes com referencias ativas.

Validacao de compras: 526 testes frontend aprovados em 46 arquivos, incluindo PostgreSQL PGlite, pagamentos de um centavo/limite monetario, centavos exatos, calendarios/datas editadas, snapshots, idempotencia/backup/CAS, escrita direta e isolamento tecnico; build/type-check, lint e diff aprovados. Navegador: fornecedor com CNPJ formatado normalizado; pedido de R$ 100,00 com parcelas R$ 33,34/R$ 33,33/R$ 33,33, previa 31/out -> 30/nov -> 31/dez e segunda data editada para 01/dez. Antes do recebimento, zero contas; apos conferencia, tres contas com classificacao e vinculos persistidos apos recarga. Cancelar conta nao liberou novo recebimento. Outro fluxo validou cancelamento definitivo de pedido aberto sem contas, pagamento unico de R$ 0,01 sem parcela artificial e alteracao/inativacao do fornecedor preservando snapshot e historico. Dados locais originais restaurados. SQL nao aplicado em producao; sem commit/push.

Proxima entrega recomendada: livro de movimentacoes de estoque e entradas vinculadas a compras, sem duplicidade e sem alterar saldos historicos silenciosamente, preparando consumo/devolucao por OS. Recebimentos parciais/devolucoes, contratos de manutencao/OS e parcelamento/ajustes de faturamentos de OS permanecem separados e pendentes. Publicacao das etapas financeiras e migracoes pendentes continuam separadas da implementacao.
