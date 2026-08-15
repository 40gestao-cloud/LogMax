# Backlog pós-freeze — revisar a partir de 2026-09-13

Itens identificados durante a trava de 90 dias que **não** foram implementados.
Quando a trava cair (vide [feedback-freeze-features](../.. )), entrar aqui antes
de pedir nova feature.

## Gaps de padrão de mercado (auditoria de 2026-06-19)

Bloco 1+2+6 já entregue: juros/multa, sangria/suprimento, fechamento conferido.
Restam os 4 abaixo.

### #3 — Devolução parcial de venda (PDV / Histórico)
Hoje há cancelamento TOTAL de venda + estorno de estoque. Falta:
- Selecionar UM ou MAIS itens de uma venda para devolver
- Recalcular total da venda (estorno proporcional)
- Devolver estoque APENAS dos itens devolvidos
- Registrar motivo da devolução
- Refletir em Contas a Receber (se Fiado) ou caixa (se dinheiro)

Escopo: médio. Requer RPC transacional, edição em `vendas` + `itens_venda`,
estorno preciso em `movimentacoes_estoque`.

### #4 — Vale-troca / Crédito do cliente
Depende de #3. Ao devolver, em vez de pagar de volta:
- Gerar "vale" com valor + validade
- Vale fica associado ao cliente
- PDV pode aplicar o vale na próxima compra (resgate)

Escopo: médio. Nova tabela `vales_credito` + integração no PDV.

### #5 — Comissão de vendedor
PDV já registra `operador_id`. Falta:
- Cadastro de regra de comissão por vendedor (% sobre venda ou produto)
- Cálculo automático ao fim do período
- Integração com Folha de Pagamento (linha de comissão como provento)
- Relatório de comissões por período/vendedor

Escopo: médio. Tabela `comissoes_regras` + cálculo programado + ajuste em Folha.

### #7 — DRE (Demonstrativo de Resultado do Exercício)
Padrão contábil. RelatoriosFinanceirosView hoje só tem listagens. Falta:
- Estrutura DRE: Receita bruta → deduções → Receita líquida → CMV → Lucro
  bruto → Despesas → EBITDA → Lucro líquido
- Configuração de plano de contas (mapeamento de centros_custo → grupos DRE)
- Período comparativo (mês atual vs anterior, ano atual vs anterior)
- Export PDF/Excel

Escopo: **grande**. Plano de contas + RPC agregadora + view dedicada. Pode
virar projeto isolado.

## Governança: o que CEO e Conselho fariam além de avaliar/votar (2026-08-07)

Levantado a pedido do usuário. **Diagnóstico de fundo:** hoje Conselho e CEO
têm as mesmas mãos — os dois avaliam, votam e criam tarefa. Numa empresa real
o Conselho delibera e fiscaliza, o CEO executa e presta contas. Falta o loop
de accountability: ninguém cobra o CEO de nada. Quase todos os itens abaixo
nascem disso.

Ordem de valor sugerida: **#G1 e #G3 primeiro** — juntos fecham o ciclo
(Conselho dá a verba → CEO executa → CEO volta explicar o que fez com ela).
Todo o resto pendura nisso.

**Status (2026-08-07): o bloco G1–G8 saiu inteiro.** Migrações 378 (#G1),
382 (#G2), 379 (#G3), 381 (#G4), 380 (#G5), 383 (#G6), 384 (#G7) e 385 (#G8).
As descrições abaixo ficam como registro do que foi pedido e por quê — o que
vale como especificação é o cabeçalho de cada migration.

### #G1 — Orçamento anual (maior lacuna)
Real: cada unidade propõe orçamento do período por centro de custo; o Conselho
aprova, corta ou devolve; durante o ciclo, gasto é confrontado com o aprovado
e estouro exige aprovação suplementar.
- Tabelas: `orcamentos_periodo` (filial, ciclo, status) + itens por
  `centros_custo`; parecer do Conselho com valor aprovado ≠ proposto
- Consumo: view/RPC confrontando `contas_pagar` × orçado por centro de custo
- Trava: alerta ou bloqueio em Compras quando o centro de custo estourar
- Reaproveita: `orcamento_mensal_categoria`, `centros_custo`, `contas_pagar`,
  `alcadas_compra`, Rateio Administrativo
- Didático: hoje filial gasta sem teto. Ensina a diferença entre querer e ter
  verba — a conversa nº 1 de qualquer gestor.

Escopo: **grande**. 1 migration robusta + 2 telas (propor / deliberar) +
integração em Compras.

### #G2 — Remuneração variável atrelada a resultado — ~~feito~~ **removido em 2026-08-09**
Foi implementado (migr. 382) e retirado do produto. Não reabrir sem pedido
explícito: a decisão foi de escopo, não de bug. O placar da competição volta a
ser orgulho e não dinheiro; folha de pagamento e carteira do MaxBank seguem
intactas, cada uma com o próprio caminho de crédito.

As tabelas continuam no banco (`politicas_remuneracao`, `apuracoes_bonus`,
`apuracao_bonus_itens`), sem tela — mesma situação de `riscos` e
`auditoria_revisoes` depois do #G5/#G8.

### #G3 — Prestação de contas do CEO ao Conselho
Real: reunião periódica em que o CEO apresenta resultados e o Conselho aprova,
aprova com ressalva ou reprova — ressalva vira plano de ação com prazo.
- Tabelas: `prestacoes_contas` (ciclo, autor, indicadores, anexo) +
  `prestacao_pareceres` (conselheiro, voto, ressalva)
- Ressalva gera linha em `matriz_tarefas` com prazo (plano de ação)
- Reaproveita: Painel BI (já exporta), `ciclos_avaliacao` pro ritmo
- Didático: é o que falta pro CEO ser cargo de verdade e não super-admin.

Escopo: médio. 1 migration + 1 tela com duas faces (submeter / deliberar).

### #G4 — Destinação do resultado
Real: apurado o lucro do ciclo, decide-se entre reinvestir, formar reserva ou
distribuir.
- Tabela: `destinacoes_resultado` (ciclo, lucro apurado, rateio das 3 vias)
- Reaproveita: `capital_filial`, `capital_config`, MaxBank
- Didático: o trade-off mais adulto que existe — distribuir agora ou ter caixa
  pra crescer depois.

Escopo: médio.

### #G5 — Comitê de Auditoria — ~~feito~~ **removido em 2026-08-08**
Foi implementado (migrs. 380/387/388) e retirado do produto junto com a tela de
Auditoria (trilha) e a Matriz de Riscos. Não reabrir sem pedido explícito: a
decisão foi de escopo, não de bug. O histórico de cada documento continua
dentro dele, e `historico_operacoes` segue gravando.

### #G6 — Nomeação com mandato
Real: Conselho nomeia gestor da unidade por mandato; ao fim, reconduz ou
substitui com base no desempenho.
- Tabela: `mandatos` (pessoa, cargo, filial, início/fim, ato de nomeação)
- Reaproveita: `movimentacoes_carreira` (existe e está vazia), Desligamento /
  Rescisão, placar como critério
- Didático: hoje virar gerente é o admin editar um campo. Com mandato, o cargo
  ganha origem, prazo e consequência.

Escopo: médio.

### #G7 — Política / código de conduta com versão
`avisos_matriz` + "Ciente" já faz metade. Falta o conceito de política vigente
com versionamento e reciência quando a versão muda.

Escopo: pequeno-médio (extensão de tela existente — pode contar como refino).

### #G8 — Matriz de riscos — ~~feito~~ **removido em 2026-08-08**
Implementada na migr. 385 e retirada do produto junto com o Comitê de Auditoria.
Mesma observação do #G5.

## Auditoria de realismo de 2026-08-14

Levantamento pedido pelo usuário ("o que sugere melhorar, e onde falta
realidade"). Nove gaps, ordenados por valor/custo. **Os quatro primeiros
saíram no mesmo dia** (migrs. 416/417/418, exceção aberta à trava); os cinco
restantes ficam aqui, na ordem em que valem a pena.

- ~~#1 Fiado sem limite de crédito nem checagem de inadimplência~~ — migr. 416.
- ~~#2 Custo do produto não vinha da compra~~ — migr. 417 (média ponderada móvel
  apurada no recebimento).
- ~~#3 Sugestão de compra valorizada a preço de venda~~ — corrigido em
  `SugestoesComprasView` (lê a view mascarada e estima a preço de custo).
- ~~#4 Prazo de entrega não era cobrável~~ — migr. 418 (`pedidos.recebido_em`,
  prazo herdado do fornecedor, atraso na tela).

### ~~#5 — Desempenho de fornecedor~~ — feito em 2026-08-14 (migr. 421)
View `v_fornecedor_desempenho` (pontualidade, atraso médio, pior atraso, última
entrega, volume) + selo em Cotações nos três pontos de decisão: linha da
cotação, coluna nova do comparativo e formulário de nova proposta. Pedido em
aberto com prazo vencido conta à parte (`em_atraso_agora`), e fornecedor sem
entrega fechada mostra "sem histórico" em vez de 0%.

### ~~#6 — Lote e validade (FEFO)~~ — feito em 2026-08-14 (migr. 424)
Tela `Estoque → Validades` ordenada por FEFO, com fila de vencidos / 7 / 30
dias, baixa de perda (Ajuste −) e encerramento de lote consumido. Lote nasce no
Confirmar do Recebimento. A RLS da tabela, que era cross-filial desde a 010,
foi corrigida junto.

**Fica declarado como limitação:** a venda no PDV **não escolhe lote**. O
controle é de validade e perda, não um segundo saldo — a tela mostra lote e
saldo do produto lado a lado para a divergência aparecer. Consumo automático por
lote no PDV é outro projeto (exigiria o balcão perguntar o lote a cada item).

### ~~#7 — Divergência de recebimento vira ocorrência~~ — feito em 2026-08-14 (migr. 423)
Tabela `devolucoes_fornecedor` + RPC `registrar_devolucao_fornecedor`: baixa
estoque, abate a conta a pagar do pedido e encerra ou reabre o pedido conforme
`reenvio_esperado`. `v_pedido_saldo` desconta só a devolução com reposição
prometida — é o que impede o pedido de ficar pendente para sempre.

Ficou de fora, e é o próximo passo natural do assunto: **conta a pagar já paga
não gera crédito** (a RPC avisa e alguém negocia com o fornecedor). Um
`creditos_fornecedor` abatendo a próxima compra fecharia o ciclo.

### ~~#8 — Baixa parcial em Contas a Receber~~ — feito em 2026-08-14 (migr. 422)
Tabela `contas_receber_baixas` (uma linha por recebimento) + status `Parcial` +
RPC `baixar_conta_receber`. O título mantém o valor do documento; juros passam a
correr sobre o saldo; o trigger de saldo bancário aprendeu 'Parcial'; e
`cliente_saldo_devedor` (migr. 416) desconta o que já foi recebido, então pagar
volta a liberar limite de crédito no PDV.

**Contas a PAGAR continua tudo-ou-nada** — a mesma necessidade existe do outro
lado (pagar fornecedor em duas parcelas) e o desenho já está pronto para copiar:
tabela irmã `contas_pagar_baixas` + o mesmo status + a mesma RPC espelhada.

### #9 — DRE / resultado
Ver #7 da auditoria de 2026-06-19, acima. Continua sendo o item grande. Ficou
mais viável depois da migr. 417: com custo apurado da compra, o CMV deixa de ser
chute.

## Pedidos novos (não-auditoria)

Adicionar aqui quaisquer ideias que aparecerem durante a trava.

- (vazio por enquanto)
