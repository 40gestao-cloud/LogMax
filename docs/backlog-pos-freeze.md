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

## Pedidos novos (não-auditoria)

Adicionar aqui quaisquer ideias que aparecerem durante a trava.

- (vazio por enquanto)
