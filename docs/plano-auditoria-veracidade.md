# Plano de Auditoria de Veracidade — LogMax

> Criado em 2026-07-28, a partir dos 24 problemas encontrados nas auditorias de
> Compras (migr. 266), Financeiro (267) e Estoque (268).

## O critério

Não é "tem bug". É:

> **A tela promete um controle que o sistema executa?**

O LogMax é didático, mas o fluxo tem que ser verdadeiro. Um módulo que exibe um
número que ninguém cobra, ou um botão de aprovação que qualquer um clica, ensina
a coisa errada — e é indistinguível de um sistema quebrado.

---

## Parte I — Os 13 padrões de mentira

Cada um foi encontrado pelo menos uma vez em Compras, Financeiro ou Estoque.
Servem de gabarito ao varrer os módulos restantes.

| # | Padrão | Caso real |
|---|---|---|
| P1 | Tela calcula e anuncia um valor que o banco não grava | Juros/multa exibidos no pagamento, nunca cobrados |
| P2 | Módulo que não fecha o ciclo que promete | Inventário registrava a divergência e não ajustava o saldo |
| P3 | Filtro por status que nenhuma escrita produz | `Em Cotação`, `Recusada`, `Em Transporte`, `Aberto` |
| P4 | Ciclo de vida que nunca fecha | Requisição eterna em `Aprovado` → compra duplicada |
| P5 | Gate de aprovação sem RBAC ou redundante | "Aprovar Pedido": 3ª aprovação do mesmo gasto, sem RBAC |
| P6 | Escritas em sequência sem transação | Conta a Pagar perdida; expedição sem baixa de estoque |
| P7 | Guard que falha **aberto** | `return Infinity` no saldo do pedido; fallback da alçada |
| P8 | `filial` ausente no payload + coluna `DEFAULT 'SuperMax'` | Sugestões de Compras; Recebimentos |
| P9 | Paginação client-side fazendo total/filtro/cascata mentir | Cancelamento de concorrentes só via página 1 |
| P10 | Sem segregação de funções | Gerente criava e aprovava a própria cotação |
| P11 | Auditoria apagável sem rastro | Reabrir caixa zerava a divergência apurada |
| P12 | Fuso UTC onde a regra é Acre (UTC−5) | Filtro "Hoje" mostrando amanhã depois das 19h |
| P13 | Campo que deveria ser lido do sistema sendo digitado | `qtd_sistema` no inventário |

**Regra de ouro derivada:** onde a regra de negócio mora só no React, o banco não
a conhece — e alguém vai passar por fora. A correção quase sempre é mover a
transição para uma RPC.

---

## Parte II — Sondas reutilizáveis

Rodar **antes** de ler código. Foram elas que deram as provas materiais
(a compra duplicada do Extrato de Tomate saiu da sonda 5).

### S1 — Status morto
Para cada tabela com coluna `status`: `SELECT status, count(*) ... GROUP BY 1`
no banco, comparado com as strings literais nos `.tsx`. Diferença = filtro que
nunca casa. *(Achou 4 casos.)*

### S2 — Razão × saldo
Toda tabela-livro contra o agregado que ela deveria explicar:
movimentações × `produtos.estoque`, parcelas × conta, ponto × banco de horas,
folha × crédito MaxBank.

```sql
WITH led AS (
  SELECT produto_id, sum(mov_estoque_delta(tipo, qtd)) AS ledger
    FROM movimentacoes_estoque WHERE COALESCE(ativo,true) GROUP BY 1)
SELECT count(*) FILTER (WHERE p.estoque <> l.ledger) AS divergentes
  FROM led l JOIN produtos p ON p.id = l.produto_id;
```

### S3 — Órfãos de fluxo
`LEFT JOIN` do filho na tabela de aprovação, `WHERE aprovacao.id IS NULL`.
*(Achou o furo do Sugestões de Compras.)*

### S4 — Vazamento de filial
`SELECT filho.filial, pai.filial, count(*) ... GROUP BY 1,2` — linhas onde os
dois discordam denunciam payload sem `filial` + `DEFAULT`.

### S5 — Duplicidade de efeito
`GROUP BY <chave_de_negócio> HAVING count(*) > 1` na tabela de efeito
(pedidos por requisição, contas por pedido, movimentações por recebimento).

### S6 — Fim de linha e RLS aberta
Registros parados no status terminal que nunca avançam; e
`SELECT * FROM pg_policies WHERE qual = 'true'`.

### S7 — Grep de transação
`await` seguido de outro `await` com escrita no meio, sem RPC — todo P6 tem
essa forma.

---

## Parte III — Ordem sugerida

### Etapa 0 — Regressão do PDV × trigger novo `[URGENTE]`

**Não é auditoria.** É verificar algo que mudou em 2026-07-28 e que ninguém
ainda exerceu no browser.

A migração 268 fez `fn_atualiza_estoque_produto` **lançar exceção** quando o
saldo ficaria negativo, no lugar do `GREATEST(0, ...)` que truncava em silêncio.
`criar_venda_pdv` insere em `movimentacoes_estoque` e passa por esse trigger.

- [ ] `criar_venda_pdv` valida saldo **antes** de fechar a venda?
- [ ] Se não valida: venda de produto com estoque desalinhado agora falha no
      fim, onde antes passava. Corrigir com validação prévia e mensagem clara.
- [ ] Rodar S2 (razão × saldo) logo após aplicar a 268 nas 4 turmas.
      Em 2026-07-28 estava em 0 divergentes / 198 produtos.

**Se for fazer só uma coisa desta lista, faça esta.**

---

### Etapa 1 — Sondas S1–S7 em todas as tabelas

Melhor retorno da lista: são consultas SQL, não leitura de código, e devolvem
**prova em dados** em vez de suspeita.

- [ ] S1 em toda tabela com `status`
- [ ] S2 em todo par livro/agregado
- [ ] S3 em todo fluxo com tabela de aprovação
- [ ] S4 em toda tabela com `filial NOT NULL DEFAULT`
- [ ] S5 nas tabelas de efeito financeiro e de estoque
- [ ] S6 (fim de linha + `pg_policies`)
- [ ] S7 (grep de transação) em `src/views/`

**Entrega:** lista de suspeitos, cada um com a consulta que o comprova.

---

### Etapa 2 — RH / Folha de Pagamento

O risco mais alto do que sobrou.

- [x] ~~**Vínculo folha↔conta é uma regex em texto livre.**~~ Fechado pela
      migr. 269: `contas_pagar.folha_pagamento_id` com FK + backfill do
      marcador. A descrição virou rótulo; `reverter_folha_maxbank` também
      passou a ler a coluna.
- [x] ~~**O crédito no MaxBank engole o próprio erro.**~~ Fechado pela migr.
      269: credita primeiro e só então avança para `Paga`. Falha deixa a folha
      em `Processada`, grava em `folha_credito_falhas` (sem policy de escrita)
      e notifica o setor RH. Transição agora mora na RPC `pagar_folha`.
      **Rodar a consulta 3 da verificação** — lista quem já ficou sem receber.
- [ ] Quem processa a folha também aprova o pagamento dela? (P10)
- [ ] Férias e Afastamentos escrevem `Justificado` no ponto — cancelar reverte? (P4)
- [ ] Benefícios e split MaxBank batem com o valor pago? (S2)
- [ ] Avaliações/PDI/Pesquisas: nota e plano influenciam algo, ou só arquivam? (P1)

---

### Etapa 3 — Vendas / PDV

Maior volume de escrita do app.

- [x] ~~Devolução de venda existe?~~ Existe e é completa: `criar_devolucao_venda`
      (migr. 203) devolve estoque, cancela conta a receber pendente ou cria
      conta a pagar. **Mas o gate validava o parâmetro errado** — conferia
      `auth_gerente_da(p_filial)`, valor enviado pelo cliente, sem nunca
      comparar com `vendas.filial`. Fechado pela migr. 276, no trigger.
- [x] ~~Fiado → `contas_receber` grava a `filial` certa?~~ A versão viva da
      `criar_venda_pdv` grava. A **fóssil de 7 argumentos**, que ninguém tinha
      dropado e seguia executável, não conhece filial. Migr. 274.
- [x] ~~Cupom~~ — validação server-side rigorosa: existência, janela de
      validade, filial, valor mínimo, limite de uso, recálculo do desconto e
      recusa se o cliente enviou valor diferente do calculado. Sem achado.
- [x] ~~Cliente Especial~~ — restrito a admin/CEO no menu, e a conversão exige
      `status = 'Aprovado Cliente'`. Não gera pedido fantasma.
- [x] ~~Orçamento → Pedido de Venda~~ — `converter_orcamento_em_pedido` fecha o
      ciclo, é idempotente (devolve o pedido existente em vez de duplicar) e
      usa a filial do orçamento. Sem achado.
- [ ] **`contas_receber` não tem `venda_id`.** O vínculo com a venda é o short
      id dentro da descrição — mesmo padrão de texto livre que a migr. 269
      acabou de eliminar na folha. Backfill por descrição é frágil (6 chars);
      vale a coluna daqui para frente. (P1)

---

### Etapa 4 — Financeiro: os submódulos não auditados

Contas a Pagar/Receber e Controle de Caixa já foram (migr. 267). Ficaram:

- [x] **Duplicatas — confirmado: é formulário.** `GenericCRUDView` puro, 6
      campos digitados. "A Receber" não gera conta a receber, "Paga" não move
      caixa, e `Vencida` é escolhido a mão em vez de derivar do vencimento. A
      tabela não tem `filial` — é global entre unidades. Zero registros nas 4
      turmas: ninguém nunca usou. **Resolvido em 2026-07-28: fora do menu**,
      tabela preservada, como nas votações. Implementar de verdade esbarraria
      na trava de features até 2026-09-13.
- [x] **Integração bancária — mesma forma.** Registra importações digitadas
      (banco, arquivo, data, nº de registros, status). Não importa nem concilia
      nada; o "Saldo Total" vem de `caixa_bancos`. Zero registros. **Fora do
      menu em 2026-07-28**, tabela preservada. `IntegracaoBancariaView.tsx`
      continua no repositório, sem rota — o dia em que o módulo for feito de
      verdade, a tela é o ponto de partida.
- [x] ~~**Patrimônio**~~ — é cadastro de bens (`produtos.tipo='patrimonio'`,
      19 itens) com número, responsável e localização, em tela read-only. Não
      deprecia nem dá baixa — e também não promete isso. Sem achado.
- [x] ~~**Notas Emitidas**~~ — 17 notas, todas com `venda_id` e
      `conta_receber_id` preenchidos e válidos. Vínculo real. Sem achado.
- [x] **Capital — `aprovar_emprestimo` e `negar_emprestimo` não tinham RBAC
      nenhum.** SECURITY DEFINER, executáveis por qualquer `authenticated`. O
      único `auth_` no corpo era `auth.uid()`, para registrar quem aprovou —
      não para decidir se podia. Como taxa de juros e número de parcelas são
      parâmetros, qualquer colaborador aprovava o próprio empréstimo com a taxa
      que quisesse, injetando capital pelo caminho que fura o bloqueio de
      capital estourado. Migr. 277. Zero empréstimos até hoje.
- [x] ~~**Alçadas**~~ — as 3 filiais ativas têm alçada e capital. Sem achado.
- [x] **Caixa e Notas: cinco RPCs passavam por cima da própria RLS.**
      `fechar_caixa_conferido`, `solicitar_fechamento_caixa`, `suspender_caixa`,
      `registrar_movimentacao_caixa` (sangria/suprimento) e `emitir_nota` são
      SECURITY DEFINER sem guard. As tabelas têm policy correta — e SECURITY
      DEFINER não se submete a RLS. Migr. 278 leva a régua das policies para
      triggers.

---

### Etapa 5 — Matriz e Competição

Muita automação sem operador olhando: cron 03:10, cache de 1h do BI, IA que
propõe pauta.

- [x] ~~Ranking confere com os dados de origem?~~ Confere.
      `calcular_placar_competicao` deriva das notas reais
      (`avaliacoes_matriz` + `criterios_avaliacao`), exclui avaliações de
      admin e só inclui os eixos subjetivos quando as 3 filiais têm avaliação
      no período. `declarar_vencedora` exige ao menos um voto e congela o
      placar calculado em `placar_snapshot`. Nada é digitado.
- [x] ~~Conselho: pessoas distintas?~~ Sim — a Matriz tem 5 pessoas: 1 CEO,
      3 conselheiros e 1 admin.
- [x] ~~Central de Avaliação: nota influencia o placar?~~ Influencia, e o
      recorte está correto. `calcular_placar_competicao` filtra
      `item_tipo LIKE 'tarefa\_%'` porque hoje o conselho **só** dá nota em
      tarefa — `MatrizTarefasPanel` oferece os 7 tipos `tarefa_*` e mais
      nenhum. A nota em arte/promoção/campanha saiu do produto; o que sobrou
      no banco é resíduo de assinatura da RPC, não caminho vivo.
- [x] ~~Briefing IA: o cascade preserva `Em Andamento`/`Concluído`?~~
      Preserva. `excluir_briefing_cascade` apaga apenas `status = 'Pendente'`
      em `tarefas` e `marketing_tarefas`, e é restrita a admin/CEO.
- [x] ~~Avisos da Matriz: "Ciente" prova leitura?~~ Prova o clique, com autor e
      data — 15 confirmações de 15 pessoas distintas no aviso vigente, e a
      policy exige `user_id = auth.uid()`, então ninguém confirma pelo outro.
      É o que a palavra "Ciente" promete; não promete leitura.
- [x] **Seis RPCs decidiam o dia em UTC** (P12), incluindo o cron das 03:10 —
      que roda às 22:10 no Acre e expirava competição antes de o dia acabar.
      Junto: devolução, conversão de orçamento, empréstimo, saldo de capital e
      vitrine pública. Migr. 279.

**Observação, não achado:** `declarar_vencedora` aceita a filial vencedora por
parâmetro e não exige que coincida com o primeiro colocado do placar. É
coerente com o desenho (o conselho é soberano, a IA e o placar são subsídio),
e o `placar_snapshot` deixa registrada qualquer divergência.

---

### Etapa 6 — Marketing

- [x] ~~Promoções: o guard de ajuste manual segura?~~ Segura. A restauração é
      `UPDATE produtos SET preco = preco_atual WHERE preco = preco_promocional`
      — preço mexido à mão não é sobrescrito. E a função já usa `acre_today()`.
- [x] **Campanhas: o ROI vinha de coincidência de calendário.** A view somava
      como receita da campanha toda venda concluída da filial na janela de
      datas, com ou sem relação com ela; o card se chama "Receita Atribuída".
      Duas campanhas simultâneas contavam a mesma venda. Somava-se a isso um
      erro de precedência AND/OR (a perna do cupom aceitava venda cancelada) e
      `created_at::date` em UTC. Migr. 280. Estrago atual zero — nenhuma
      campanha coincidiu com vendas ainda.
- [x] ~~Cupons: validação server-side?~~ Sim, verificado na Etapa 3, e
      `criar_venda_pdv` incrementa `usos` na mesma transação.
- [x] ~~Artes: nota 1-5★~~ — `dar_feedback_arte` valida faixa 1-5 e restringe a
      gerente/admin/CEO. A nota fica registrada e visível, sem consequência
      automática — que é o que a tela promete. Sem achado.
- [x] ~~Calendário editorial~~ — status é manual, sem cron por trás; não trava
      nem avança sozinho. Sem achado.

Marketing está zerado no ERP e na contabilidade (sem artes, posts, cupons ou
campanhas com venda), então esta etapa é auditoria de código, não de dados.

---

### Etapa 7 — TI, Max Work, Metas, Feedback

Menor risco financeiro, mas:

- [x] ~~**Metas** — folga concedida é debitada de algum saldo?~~ Não se aplica:
      o sistema de folga saiu do produto.
- [x] ~~Metas em 2 níveis: o tático consome o pool do estratégico?~~ Não se
      aplica: o consumo de pool saiu do produto.
- [x] ~~TI Chamados: SLA existe?~~ Não se aplica: o submenu saiu de operação em
      2026-07-27 e a tabela está zerada nas 4 turmas. Nunca houve campo de SLA
      em `ti_chamados` — não havia o que mentir.
- [x] ~~Feedback anônimo: é mesmo anônimo?~~ É. `feedbacks_organizacao` não tem
      `autor_id` nem `criado_por` — o anonimato é estrutural, não uma promessa
      da tela. Nenhum trigger na tabela (o de auditoria não a alcança), não há
      tabela de log no schema, e o DELETE está fechado com `USING (false)`:
      nem admin apaga. Limite honesto: o log de request do PostgREST/Supabase
      é infraestrutura e está fora do alcance do app.
- [x] ~~Max Work~~ — `max_docs` e `max_planilhas` com RLS ligada e 4 policies
      cada: dono lê/escreve o próprio, docente lê e apaga. INSERT e UPDATE
      exigem `user_id = auth.uid()`, então ninguém escreve no documento alheio.
      Sem achado.
- [x] **Whitelist do Modo Aula estava fora de sincronia com o menu** nos dois
      sentidos: sobravam `Tarefas` (6 módulos), `Vitrine Pública` e `Chamados`
      — o professor liberava submenu que não existe; e faltavam `Alçadas`,
      `Notas Emitidas` e `Devoluções` — que não podiam ser liberados e sumiam
      da aula sem explicação. Sincronizada em 2026-07-28.

---

### Etapa 8 — Matriz de autoridade (transversal) `[LEVANTADA 2026-07-28]`

Levantada **do banco**: `pg_proc` (guard de cada RPC), `pg_policies` (regra de
cada tabela) e `pg_trigger` (o que a policy não alcança). A tela não entrou na
conta — ela é a versão que mente.

Legenda de "onde": **RPC** = `SECURITY DEFINER` com guard próprio; **RLS** =
a regra é a policy da tabela; **trigger** = guard em `BEFORE`, alcança quem
escreve direto.

| Transição | Quem lança | Quem decide | Onde | Segregação | Falha aberto |
|---|---|---|---|---|---|
| Requisição de compra → `Pendente` | compras, logística (`criar_requisicao_compra`) | — | RPC + RLS `INSERT true` | n/a | INSERT direto aceita qualquer filial |
| Requisição → `Aprovado`/`Negado` | compras ou gerente da filial | mesmo conjunto | **só RLS**, 2 `UPDATE` do `.tsx` sem transação (P6) | **não** — quem pede aprova | não |
| Cotação → `Aguardando Financeiro` | compras, logística, gerente | — | RLS | n/a | não |
| Cotação → `Aprovado` | financeiro ou gerente da filial | idem | RLS + trigger `cotacoes_unica_aprovada` | **não** — gerente cria e aprova | não |
| Cotação → Pedido | compras, logística (`gerar_pedido_de_cotacao`) | — | RPC + `auth_pode_filial` | n/a | não |
| Recebimento → baixa de estoque | estoque, logística (`movimentar_estoque`) | — | RPC + trigger `fn_atualiza_estoque_produto` | n/a | não |
| Expedição → `Expedido` | estoque, logística (`expedir`) | — | RPC + `auth_pode_filial` | n/a | não |
| Inventário → ajuste | estoque, logística (`fechar_inventario`) | — | RPC + `auth_pode_filial` | contagem é o próprio setor | não |
| Venda PDV | vendas, financeiro (`criar_venda_pdv`) | — | RPC | n/a | não |
| Devolução de venda | gerente da filial **da venda** ou admin | idem | RPC + trigger `devolucao_valida_filial_da_venda` (migr. 276) | não | não |
| Orçamento → `Aprovado` | vendas, financeiro ou gerente | idem | RLS | **não** | não |
| Orçamento → Pedido de venda | vendas, financeiro (`converter_orcamento_em_pedido`) | — | RPC, idempotente | n/a | não |
| Conta a pagar → `Pago` | financeiro ou gerente da filial | idem | RPC `registrar_pagamento_conta` **e** RLS; triggers `sync_saldo_caixa_pagar` + `bloqueia_conta_pagar_estourado` | **não** | não |
| Caixa → `Aguardando Conferência` / `Fechado` | operador do caixa (`solicitar_fechamento_caixa`) | gerente/financeiro (`confirmar_fechamento_caixa`) | RPC + trigger `controle_caixa_guard` (migr. 278) | **sim** | não |
| Caixa → reaberto | gerente da filial (`reabrir_caixa`) | idem | RPC + trigger | não | não |
| Sangria/suprimento | operador (`registrar_movimentacao_caixa`) | — | RPC + trigger `movimentacao_caixa_guard` | n/a | não |
| Nota emitida | financeiro/vendas da filial (`emitir_nota`) | — | RPC + trigger `nota_emitida_guard` | n/a | não |
| Empréstimo entre filiais → `Pendente` | gerente/admin/CEO da filial | — | RLS | n/a | não |
| Empréstimo → `Aprovado`/`Negado` | — | admin/CEO (`aprovar_emprestimo`) | RPC `_assert_capital_holding` (migr. 277) | **agora sim** (281) | **era sim** — ver achados |
| Folha → `Processada` | RH da filial (`processar_folha`) | — | RPC `_assert_rpc('rh')` | n/a | não |
| Folha → `Paga` + crédito MaxBank | RH da filial (`pagar_folha`) | — | RPC | **não** — mesmo gate do processar | **era sim** — ver achados |
| Reverter folha / apagar lançamento MaxBank | admin, CEO ou RH | idem | RPC `_maxbank_pode_reverter` | não | não |
| Férias → `Aprovado` | colaborador pede (`Solicitada`) | RH ou gerente da filial | RLS `ferias_rh_all` | **não** — RH aprova as próprias | não |
| Afastamento → ponto `Justificado` | RH (`aplicar_afastamento_no_ponto`) | — | RPC; reversão por trigger | n/a | **sim** — ver achados |
| Requerimento → decisão | qualquer um (`criado_por = uid`) | admin, CEO, conselheiro, gerente-conselheiro | RLS | sim | não |
| Meta estratégica → publicada / tática → aprovada | admin/CEO cria | gerente/admin (`aprovar_tarefa_tatica`) | RPC | sim | não |
| Meta/tarefa → `Concluida` | o próprio colaborador alvo | gestor aprova depois | RPC (`colaborador_id = auth.uid()`) | sim | não |
| Promoção → `Aprovada` | marketing (`marketing_promocoes`) | financeiro ou gerente | RLS | sim | não |
| Arte → nota 1-5★ | marketing publica | gerente/admin/CEO (`dar_feedback_arte`) | RPC | sim | não |
| Avaliação da Matriz / declarar vencedora | conselho (`avaliar_item_matriz`) | CEO/admin (`declarar_vencedora`) | RPC + `_assert_matriz_admin` | sim | não |
| Aviso da Matriz / "Ciente" | admin da Matriz (`criar_aviso_matriz`) | cada pessoa por si (`dar_ciencia_aviso`) | RPC + RLS `user_id = auth.uid()` | sim | não |
| Briefing IA → tarefas | IA propõe | admin/CEO aprova item a item | RPC | sim | não |

#### Achados desta etapa (fechados pela migr. 281)

- [x] **`_folha_creditar_e_avancar` e `creditar_folha_maxbank` tinham EXECUTE
      para `anon`.** Nenhuma das duas tem RBAC — o gate mora em `pagar_folha`.
      Com a anon key (que é pública, vai no bundle) dava para creditar a
      carteira e levar a folha a `Paga` sem ser do RH. `pagar_folha` e
      `processar_folha` também estavam abertas a `anon`; nelas o
      `_assert_rpc('rh')` barra, mas o grant não tinha razão de existir.
- [x] **`reverter_afastamento_no_ponto`: `SECURITY DEFINER`, zero guard,
      EXECUTE para `anon` e `authenticated`.** Apaga linhas de
      `ponto_eletronico` e restaura status a partir de um uuid de afastamento.
      Nenhuma tela a chama — só os dois triggers de `afastamentos`, que rodam
      como owner. Revogada.
- [x] **`_assert_capital_holding` falhava aberto** (P7): `auth.uid() IS NULL`
      dava `RETURN` em silêncio em vez de barrar. Não era explorável hoje
      (as RPCs de empréstimo não têm grant para `anon`), mas é o guard de toda
      a alçada de capital.
- [x] **Policy de `emprestimos_filial` mais larga que a RPC.** O `UPDATE`
      aceitava conselheiro e gerente-conselheiro; a RPC exige admin/CEO. Como
      nenhuma tela faz `UPDATE` direto nessa tabela, era só superfície: um
      gerente-conselheiro aprovava o próprio empréstimo por fora da
      `aprovar_emprestimo`. Policy alinhada a admin/CEO.
- [x] **Empréstimo: solicitante podia ser o aprovador.** Admin e CEO também
      podem solicitar (policy de INSERT), então o par coincidia. Agora
      `_assert_nao_e_o_solicitante` barra nos dois lados (aprovar e negar).

#### Segregação de funções — a régua vertical (migr. 282)

Quatro transições deixavam lançador e decisor no mesmo conjunto. O dado que
decidiu o desenho: **cada filial tem uma pessoa por setor**. Não existe "outro
analista do mesmo setor" para conferir — segregação horizontal é impossível por
construção. A régua adotada é a de empresa pequena de verdade:

> colaborador lança → gerente decide; gerente lança → Matriz decide; ninguém
> decide sobre si mesmo; acima da alçada, sobe um nível.

- [x] **Folha:** RH fecha (`processar_folha`, que gera a conta a pagar), o
      Financeiro paga. `pagar_folha` saiu de `_assert_rpc('rh')` para
      `('financeiro')`, e o caminho canônico virou Contas a Pagar — o trigger
      `conta_pagar_avancar_folha_e_creditar` leva a folha a `Paga` e credita o
      MaxBank sozinho. Para quem é só do RH, a tela agora para em `Processada`
      e diz por quê.
- [x] **Requisição de compra:** estava invertido — Compras criava e Compras
      aprovava. A decisão passou ao gerente da filial (ou Matriz), nunca ao
      autor, com trigger `requisicao_decisao_guard`. E os dois `UPDATE` soltos
      do `.tsx` com rollback best-effort (P6) viraram
      `decidir_requisicao_compra`: aprovação, requisição e cascata de cotações
      numa transação só.
- [x] **Cotação:** a régua certa já existia — mas só no React (alçada por valor
      + "quem cadastrou não aprova"). Virou trigger `cotacao_decisao_guard`,
      que espelha a tela: dentro da alçada decide o Financeiro, acima decide o
      gerente, Matriz sempre pode, autor nunca.
- [x] **Férias:** trigger `ferias_decisao_guard` — ninguém aprova as próprias;
      férias de quem é do RH vão ao gerente da filial; férias de gerente sobem
      à Matriz.

#### Outras superfícies largas (fechadas na 282)

- [x] `requisicoes` e `requisicoes_estoque` tinham `INSERT` com
      `WITH CHECK true` — nem filial, nem setor. Agora `auth_pode_filial(filial)`.
- [x] `aprovacoes_compras.compras_insert` só exigia `status = 'Pendente'`:
      qualquer autenticado criava linha de aprovação de qualquer filial.

**Meia pendência assumida:** a recomendação incluía abrir a *abertura* de
requisição a qualquer setor (na empresa real quem pede é a área que precisa).
Não foi feito: o menu é por módulo, não por submenu, e dar `compras` inteiro a
vendas/RH/marketing seria redesenhar a árvore de módulos de todos os setores.
A autoridade — que era o furo — está fechada; a abertura fica como mudança de
menu, a decidir.

**Suspeita das ~14 telas de Aprovações: descartada.** São gates distintos —
compras, estoque, conteúdo de marketing, promoção no financeiro, orçamento,
requerimento, férias, capital, metas. A redundância que existia (3ª aprovação
do mesmo gasto) já tinha sido cortada.

---

## Parte IV — Pendências abertas do trabalho de 2026-07-28

Não fazem parte da auditoria, mas estão em aberto:

- [ ] **Compra duplicada do Extrato de Tomate** — segue intocada, agora por
      falta de prova, não de aval (revisto em 2026-07-28).

      Estado: pedidos `d7b200c4` (14/07) e `73ba7bb8` (20/07), ambos
      `Recebido`; recebimentos `ccf04075` e `b1ea83de`, ambos `Concluído`;
      contas `fe4540d5` e `380b7674`, ambas `Pago` (R$ 79,20 cada, Sicredi
      `ac6225f2`); movimentações `739eb970` e `90736660`, 24 un cada. O produto
      `b11fd6ac` tem 24 un em estoque — 48 entradas menos 24 vendidas no PDV.
      Nenhum inventário desse produto existe no histórico.

      Os dois recebimentos foram conferidos e fechados por alguém. Nada nos
      dados sustenta que a segunda entrega não chegou; o que está provado é o
      furo de processo, e esse a migr. 266 fechou. Estornar sem contagem
      física seria registrar uma devolução que ninguém fez.

      **Próximo passo:** contar o produto em Estoque → Inventário. Desde a
      268 o fechamento gera o ajuste sozinho. O resultado decide:

      - **Contagem = 24** → as duas entregas chegaram. Os dois pagamentos são
        devidos e não há nada a estornar no sistema; a cobrança ao fornecedor,
        se houver, é assunto do mundo real.
      - **Contagem = 0** → a segunda entrega não existiu. Aí sim estorna-se o
        conjunto, e o próprio inventário já terá corrigido o estoque:

        ```sql
        BEGIN;
        UPDATE contas_pagar          SET ativo = false WHERE id = '380b7674-0716-47f8-9399-9a9c2dd92265';
        UPDATE recebimentos          SET ativo = false WHERE id = 'b1ea83de-045d-4de3-94a3-f7f194ce99ed';
        UPDATE pedidos               SET ativo = false WHERE id = '73ba7bb8-5e75-47e6-bf04-b1aeb608f168';
        COMMIT;
        ```

        Inativar a conta paga devolve os R$ 79,20 ao Sicredi sozinho — o
        trigger `sync_saldo_caixa_pagar` reage a `ativo` desde a migr. 267.
        A movimentação `90736660` **não** entra na lista: o ajuste do
        inventário já terá tirado as 24 un, e inativá-la tiraria de novo.
- [ ] **23 requisições aprovadas e nunca cotadas** (07/07 a 20/07, 20 delas da
      MaxLook, mesmo solicitante). Não é resíduo do ciclo quebrado — nenhuma
      tem cotação ativa, e a 266 só deixou de fora quem não virou pedido. É
      backlog de Compras: cotar ou cancelar, decisão do setor. A mais recente
      é outra requisição de Extrato de Tomate, 24 un.
- [ ] **Busca por fornecedor/cliente** em Contas a Pagar/Receber — removida
      porque só funcionava dentro da página. Recuperável com uma RPC de busca.
- [ ] **Busca por tipo/origem/destino** em Movimentações — removida pelo mesmo
      motivo. Recuperável com `<select>` de tipo indo ao servidor.
- [ ] **Recomendação 1** (mover as demais transições de estado para RPCs) —
      parcialmente feita. As recomendações 2 (cortar a 3ª aprovação) e 3
      (alçada única) já estão em produção.
- [ ] **Testes não rodam localmente** (`tests/setup.ts` exige
      `VITE_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; falta `.env.test`).
      Nenhuma das correções de 2026-07-28 tem cobertura automatizada.
