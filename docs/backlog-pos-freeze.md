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

### #G2 — Remuneração variável atrelada a resultado
Real: Conselho aprova a política de bônus; pagamento sai do atingimento de
metas e do desempenho medido.
- Tabelas: `politica_remuneracao` (vigência, pesos, gatilhos) +
  `apuracao_bonus` por ciclo/pessoa
- Fonte do desempenho: placar da competição (`avaliacoes` tipo
  `matriz_filial`) + `metas_estrategicas`/`tarefas_taticas`
- Saída: provento na folha e/ou crédito em `maxbank_contas`
- Didático: fecha o ciclo do que já existe. Hoje o placar é orgulho; virando
  dinheiro na carteira, a competição vira consequência.

Escopo: médio-grande. Depende de folha e do placar estarem estáveis.

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

## Pedidos novos (não-auditoria)

Adicionar aqui quaisquer ideias que aparecerem durante a trava.

- (vazio por enquanto)
