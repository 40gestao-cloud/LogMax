# Plano — Montagem da filial vira desembolso, item a item

**Status:** proposta, não executada. Escrito em 2026-08-22.
**Pedido de origem:** "Total Investido em Filiais está ali sem uso, e isso é errado" — transformar
a montagem da unidade em contas a pagar detalhadas, com centro de custo, e permitir que o usuário
crie campos novos quando a grade não tiver o item.

---

## 1. O que é verdade hoje (levantado no código, não suposto)

### Compra → Contas a Pagar
A conta **já é gerada automaticamente**, mas não no recebimento: nasce quando o Financeiro aprova a
cotação e o pedido é criado (`gerar_pedido_de_cotacao`), com valor da cotação, vencimento no prazo
de entrega (ou hoje + 30), status `Pendente`, `pedido_id` amarrado e centro de custo herdado da
requisição.

O recebimento **não cria nada** — ele libera o pagamento. Para o dinheiro sair, as três pernas do
match precisam existir (migr. 490/491/492):

1. recebimento `Concluído` para o pedido;
2. nota registrada na doca (`recebimentos.nf_numero`, obrigatório para confirmar);
3. "Conferir nota" no Financeiro (`nf_conferida_em`), que **sobrescreve o valor da conta pelo valor
   da nota** e exige justificativa escrita se divergir do pedido.

Sem as três, `conta_pagar_exige_recebimento` recusa a mudança para `Pago`/`Parcial`.

### Total Investido em Filiais
É número de tela. `totalInvestidoForm` é um `useMemo` em `src/views/FiliaisView.tsx` (≈ linha 339)
que soma equipamentos × preço + aluguel + folha. O que se grava vai só para `filiais.detalhes`
(jsonb de cadastro), e `filiais` tem apenas dois gatilhos: auditoria e histórico.

**Nenhuma linha em contas a pagar, nenhum lançamento de caixa, nada no DRE.**

Quem move dinheiro para a filial hoje são outros dois instrumentos, que continuam valendo:
`capital_filial` (aporte) e `emprestimos_filial` (mútuo, Price desde a migr. 473).

---

## 2. Achado que muda a ordem das coisas

> **`gerar_dre` não olha `natureza`.**
> Ele filtra despesas por `pedido_id IS NULL` (com exceção para pedido de serviço) e
> `origem NOT IN ('devolucao_pdv','emprestimo')`. Nenhuma função do banco além de
> `fn_conta_pagar_natureza` referencia a coluna.

Consequência: conta avulsa marcada como `imobilizado` **entra no DRE como despesa hoje**, apesar de
a tela de Contas a Pagar prometer o contrário ("Não entra no DRE: bem não é gasto"). É bug
pré-existente da migr. 447, e está no caminho desta melhoria — gerar 12 contas de equipamento por
filial afundaria o resultado do mês, que é exatamente o problema que a 447 dizia ter resolvido.

Por isso a Fase 0 não é opcional.

---

## 3. Fases

### Fase 0 — O DRE passa a respeitar a natureza *(pré-requisito)*

Migração: `gerar_dre` exclui `natureza IN ('estoque','imobilizado')` do bloco de despesas.

- **Risco:** muda número de DRE já exibido — contas hoje marcadas como estoque/imobilizado saem do
  resultado. É correção, mas mexe no que a turma já viu; merece ser anunciada.
- Classificação: **bug**, não melhoria. Pode ser feita antes da trava de features.

### Fase 1 — Modelo de dados: sair do jsonb

Hoje tudo vive em `filiais.detalhes`, com chaves fixas por nicho (`CAMPOS_NICHO`), e o objeto é
**reescrito inteiro a cada save**. Isso não sustenta item customizado nem vínculo com a conta gerada.

Nova tabela **`filial_investimentos`**:

| coluna | papel |
|---|---|
| `filial_id`, `filial` | a unidade (texto para casar com a régua de RLS existente) |
| `chave`, `rotulo` | `gondolas` / "Gôndolas" — livres no item customizado |
| `origem_campo` | `grade` \| `customizado` — o botão "novo campo" grava o segundo |
| `quantidade`, `preco_unitario`, `valor_total` (coluna gerada) | o item |
| `categoria` | `equipamento` \| `aluguel` \| `outro` — decide natureza e recorrência |
| `centro_custo_id` | FK para `centros_custo` (que já carrega `grupo_dre`) |
| `conta_pagar_id` | FK para a conta gerada — **é o que dá idempotência** |
| `ativo` + auditoria | padrão da casa |

- RLS espelhando `filiais`: admin/CEO/conselheiro fazem tudo; gerente só na própria unidade.
- Recriar as três policies restritivas de desligado (padrão da migr. 308 — tabela nova nasce fora
  da varredura).
- `CAMPOS_NICHO` continua no front, como **catálogo de sugestão**; a tabela passa a ser a verdade.

### Fase 2 — Tela: campo dinâmico + centro de custo

- Cada linha da grade ganha **centro de custo** (select de `centros_custo`) ao lado de qtd × preço.
- Botão **"+ Adicionar item"** insere linha vazia com rótulo editável
  (`origem_campo='customizado'`); ao digitar o valor, entra no total pelo mesmo `useMemo` — sem
  tratamento especial, que é o pedido original.
- Total Investido passa a somar da lista, não de chaves fixas.
- **Migração de dados:** ao abrir filial que só tem `detalhes`, a tela oferece "importar para itens"
  (uma vez). `detalhes` continua sendo gravado, para não quebrar quem o lê hoje.

### Fase 3 — Gerar o desembolso (RPC `gerar_contas_da_montagem`)

Botão **"Gerar contas a pagar"** no formulário — explícito, nunca automático no save.

| categoria | vira | natureza | vencimento |
|---|---|---|---|
| equipamento | 1 conta **por item** | `imobilizado` | data escolhida no modal |
| aluguel | 1 conta **por mês**, N parcelas | `despesa` | dia do mês, N vezes |
| outro (customizado) | 1 conta por item | escolha do usuário | data escolhida |

Regras:

- **Folha fica de fora, deliberadamente.** `processar_folha` já gera a conta a pagar real; gerar
  aqui duplicaria salário no DRE. O campo segue como estimativa de cadastro.
- **Fornecedor opcional** — `contas_pagar.fornecedor_id` é nullable, e na montagem raramente se
  sabe de quem foi.
- **Idempotência:** item com `conta_pagar_id` preenchido é pulado; o botão informa
  "12 itens, 9 já gerados, 3 novos". Sem isso, dois cliques = compra dobrada.
- **Editar item já gerado** não altera a conta em silêncio: a tela mostra "conta gerada em dd/mm
  por R$ X" e exige desvincular — o que **cancela** a conta, não apaga. Conta já paga não
  desvincula.
- `origem = 'montagem_filial'` em todas, para auditoria e para o reset saber o que é.

### Fase 4 — Fechar o ciclo no patrimônio *(opcional)*

Item de equipamento pode virar linha em `produtos` com `tipo='patrimonio'` (o módulo
Financeiro > Patrimônio já existe e lê essa tabela). É o que a tela de Contas a Pagar hoje manda
fazer à mão.

---

## 4. O que a mudança encosta

- `gerar_dre` (Fase 0)
- nova tabela + RLS + policies de desligado
- `src/views/FiliaisView.tsx` — o grosso do trabalho
- `src/views/ContasPagarView.tsx` — badge de origem
- **régua do reset** ([[project_reset_apagar_tudo]]): decidir se `filial_investimentos` é exercício
  da turma (entra no TRUNCATE) ou cadastro (fica). **Recomendação: entra** — montar a filial é
  exercício. Decidir na hora de criar a tabela, não depois: é a lição das 12 tabelas órfãs entre a
  migr. 377 e a 392.

## 5. Riscos

1. **DRE mudando de valor** na Fase 0 — o efeito colateral visível.
2. **Duplicação de desembolso** se a idempotência falhar; por isso o vínculo é FK, não convenção
   de descrição.
3. **Confusão com aporte/mútuo** — `capital_filial` e `emprestimos_filial` são de onde vem o
   dinheiro; isto é para onde ele vai. A tela precisa dizer isso.
4. **Turma no meio do ciclo** — filiais já cadastradas ficam sem itens até alguém importar.

## 6. Sequência e calendário

Fases 0 → 1 → 2 → 3 são encadeadas (cada uma é inútil sem a anterior). A 4 pode ficar para depois.
Estimativa: **4 migrações** e reescrita parcial de `FiliaisView`.

A trava de features do projeto vai até **2026-09-13**. A Fase 0 é bug e cabe antes; as Fases 1–3
são melhoria e cabem melhor depois da trava.
