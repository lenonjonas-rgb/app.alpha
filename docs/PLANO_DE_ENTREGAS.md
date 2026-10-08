# Entregas e validacao - Alpha Tec

## Estado atual

A entrega 0.2 amplia o prototipo local dos seis modulos iniciais com a tela Mais informacoes da OS. Nao representa a implementacao integral das telas do Auvo. Os dados iniciais sao ficticios; nenhum cadastro, relato, foto ou resposta do Auvo foi importado. A inspecao de uma tarefa existente esta documentada em OS_DETALHADA.md.

## Etapa 1 - Validacao operacional local

- [x] Estrutura React/TypeScript, regras separadas e testes de dominio.
- [x] Agenda, OS, clientes, equipamentos, produtos/servicos e orcamentos.
- [x] Cadastro e edicao, busca e filtros.
- [x] Historico de status e movimentacoes de estoque.
- [x] Dados persistentes no mesmo navegador/origem.
- [x] Backup e importacao com validacao estrutural e de referencias.
- [x] Identidade grafite/branco/vermelho e carregamento de logo.
- [x] OS completa com nove areas, relato/assinatura, anexos, questionarios, pendencias e valores.
- [x] Atividades, calculo de horas e protecao de finalizacao antes de check-out.
- [x] Orcamento vinculado, replicacao sem execucao anterior, arquivamento/restauracao e impressao completa.
- [ ] Aprovar layout e nomes dos campos com o usuario.
- [ ] Ajustar regras de agenda, prioridades e tipos conforme a operacao real.
- [ ] Definir efeitos de cancelamento, finalizacao e consumo de pecas.

### Roteiro para testar agora

1. Cadastre um cliente ficticio e um equipamento vinculado.
2. Crie uma OS para esse cliente/equipamento e escolha tecnico, data e horario.
3. Tente criar outra OS sobreposta para o mesmo tecnico: o formulario deve bloquear.
4. Abra a OS, inicie o atendimento, edite o relato e finalize. Confira o historico.
5. Cadastre uma peca com saldo inicial. Registre entrada e saida com motivo.
6. Tente retirar mais que o saldo: nenhuma movimentacao deve ser gravada.
7. Crie um orcamento com produtos/servicos, ajuste quantidades e desconto.
8. Aprove o orcamento e gere uma OS. A conversao deve ficar vinculada e nao se repetir.
9. Recarregue o navegador e confira os dados.
10. Carregue a logo em Configuracoes e salve. Confira menu e documentos.
11. Exporte um backup antes de testar uma base vazia ou restauracao.
12. Repita os passos principais no celular ou em viewport reduzido.

### Verificacoes realizadas nesta entrega

- 22 testes automatizados de dominio passaram (12 na primeira entrega, mais 10 da OS ampliada).
- Compilacao de producao e lint passaram.
- Navegador: cadastro de cliente/equipamento, criacao e finalizacao de OS, historico e persistencia confirmados.
- Navegador: bloqueio de saida insuficiente, entrada e historico de estoque confirmados.
- Navegador: calculo de quantidade/desconto, aprovacao e geracao de OS confirmados.
- Navegador: alternancia de calendario/lista, mes/semana/dia e estado de busca vazia confirmados.
- Navegador: logo de teste salva, renderizada e persistida.
- Navegador: backup invalido rejeitado sem substituir a base e Blob JSON gerado com conteudo valido.
- Capturas em desktop e celular e verificacao de ausencia de overflow horizontal da pagina.
- O evento nativo de download nao foi exposto pela ferramenta do navegador integrado; o arquivo gerado foi verificado separadamente.
- Impressao tem estilos dedicados, mas impressora/PDF e dialogo nativo ainda precisam de validacao manual.
- Os registros criados para testes sao removidos ao concluir o levantamento, preservando a demonstracao.
- OS ampliada: respostas e pendencias, foto, relato, assinatura desenhada, atividades, valores e orcamento persistidos apos recarregar.
- OS ampliada: reagendamento preservou relato, assinatura e atividades; filtro de arquivadas e restauracao confirmados.
- Impressao completa verificada por emulacao da midia print; impressora fisica e dialogo nativo seguem para validacao manual.

## Etapa 2 - Backend e acesso seguro

Antes de usar dados reais:

- Definir hospedagem, banco, usuarios e politica de acesso.
- Implementar API e banco persistente com migracoes; validar regras novamente no servidor.
- Autenticacao real, sessoes seguras e perfis tecnico/gestor/administrador.
- Isolamento por empresa, controle de acesso a registros e auditoria.
- Transacoes e protecao contra concorrencia nas movimentacoes e conversoes.
- Backup remoto, restauracao testada e politicas de retencao.
- Migracao explicitamente autorizada dos dados locais.
- Confirmar LGPD, consentimento e tratamento de localizacao/assinaturas.

## Etapa 3 - Atendimento completo

- Migrar fotos/anexos locais para armazenamento seguro no servidor, limites e permissoes.
- Ampliar os questionarios locais para modelos compartilhados, versionamento e respostas validadas no servidor.
- Migrar assinatura/evidencias/pendencias locais para coleta autenticada e OS digital com acesso controlado.
- PDF gerado no servidor e envio real por email; WhatsApp depende de provedor.
- Regras de recorrencia e fluxo de OS sem agendamento.
- Numeracao e identidade final dos documentos.

## Etapa 4 - Gestao e campo

- Projetos, equipes e estoque em posse de tecnicos.
- Despesas, horas, indicadores e exportacoes.
- Reservas, consumo e estorno de pecas por documento, apos aprovar regras.
- Mapa/roteiros com provedor contratado e localizacao autorizada.
- PWA ou aplicativo, offline e reconciliacao de sincronizacao.

## Etapa 5 - Opcionais

- Portal de clientes e tickets, com requisitos proprios.
- Cobranca/Pix/boletos e conciliacao por integracao real.
- Fiscal por provedor e credenciais cadastradas fora do chat.
- Integracoes ERP conforme necessidade e contratos.

Cada etapa deve terminar com demonstracao funcional, testes e aprovacao do usuario antes de assumir que atende a operacao. Os modulos bloqueados no Auvo continuam sem especificacao completa; nao serao presumidos a partir de ofertas comerciais.