# Plano — Turma de Laboratório e seed de fluxo (LogMax)

> **Estado em 2026-08-26.** Plano proposto, **nada implementado**. A
> recomendação mudou no meio da conversa que o gerou: começar pelo **seed**
> (funciona hoje, sem infraestrutura) e criar o **laboratório** só quando
> houver necessidade de clicar nele. Ver "Recomendação" abaixo.
>
> Contexto: escrito depois das auditorias de 26/08 (migrações 544–557, commits
> `d425cde`, `b88c53c`, `891e9c5`), que fecharam 15 furos nos fluxos de compra,
> venda e PDV/caixa.

---

## Por que isto foi cogitado

Duas das três auditorias de 26/08 não tiveram **nenhuma evidência viva** para
sondar, porque os fluxos nunca haviam sido exercitados em turma nenhuma:

| Fluxo | Registros nas 4 turmas em 26/08 |
|---|---|
| Orçamentos | 0 |
| Pedidos de venda | 0 |
| Vendas (PDV) | 0 |
| Devoluções | 0 |
| Movimentações de caixa | 0 |
| Contas a receber | 40, todas `origem='emprestimo'` (Matriz→filial), nenhuma de venda |

A auditoria de compras, onde havia uso real, achou 7 furos com **5 casos vivos
e dados tortos para reparar**. As de venda e PDV acharam 8 furos e **zero casos
vivos** — todos preventivos ou provados por teste.

## A correção que precisa ficar registrada

A primeira versão deste plano justificava o laboratório dizendo que a
transação revertida "não cobre o que atravessa estados: abrir o caixa hoje,
vender, fechar amanhã". **Isso está errado.**

Neste sistema **tempo é coluna, não relógio**: `controle_caixa.data`,
`vendas.created_at`, `promocoes.validade_fim`, `recebimentos.data`. Tudo isso é
dado que se planta dentro da própria transação. O teste que provou o furo da
migr. 556 fez exatamente isso — montou um caixa em `'Aguardando Confirmação'`
com uma sangria já dentro e verificou a conferência corrigindo.

Os 11 testes de 26/08 foram feitos **sem laboratório nenhum**. Para auditar, o
ganho marginal de um projeto dedicado é pequeno.

## O que só o laboratório resolve

Três coisas, todas sobre **gente olhando**, não sobre auditoria automatizada:

1. **Turma de demonstração** — um ambiente completo e coerente para abrir em
   aula e percorrer o fluxo inteiro sem depender de aluno preencher formulário.
   É o argumento mais forte, e é pedagógico.
2. **Teste do frontend** — hoje se testa o banco, não a tela React. Dirigir o
   navegador exige sessão logada; num laboratório dá para criar conta
   descartável sem risco. *Atenção: um banco de laboratório sozinho não
   resolve — precisa das contas de auth.*
3. **Estado que sobrevive à sessão** — qualquer coisa montada para o professor
   conferir depois precisa sobreviver ao `ROLLBACK`.

## Custo

Verificado em 26/08 via API de gestão: um quinto projeto na organização
**Grupo Maximus** (`xifdqtxzkagssnjzblzn`, plano `free`) custa **R$ 0/mês**.
Custo não é objeção. As outras orgs disponíveis: `Mindset Educacional`,
`igorneri0307@gmail.com's Org`, `igornery0707@gmail.com's Org`,
`4.0coordenador@gmail.com's Org`.

Branch do Supabase é recurso pago e **efêmero** — serve para investigar um caso
pontual, não para guardar estado entre aulas.

---

## Recomendação

**Seed primeiro, laboratório depois.**

`scripts/seed-fluxo.mjs` com `--dry` (transação revertida) como padrão e
`--commit` exigindo `LOGMAX_LAB_REF` explícito. Assim ele:

- funciona **hoje**, sem infraestrutura, e já serve de bateria de regressão
  para as próximas auditorias;
- fica pronto para popular o laboratório no dia em que existir um;
- e se o laboratório nunca sair, não se perdeu nada.

O projeto vazio leva minutos e custa zero — crie quando for clicar nele.

**Ressalva de escopo:** a trava de feature nova vale até 2026-09-13. Isto é
ferramenta, não feature do produto, mas é escopo novo com **manutenção
recorrente**: toda migração que mude assinatura de RPC quebra o seed. Quebrar é
o comportamento certo (é o seed avisando que a mudança quebra alguém), mas o
custo é recorrente.

---

## A rota do schema — a decisão que trava a Fase 1

`docs/setup-turma/ordem_execucao_sql.md` é um **snapshot congelado**: leva até
a migração **117** (29/06/2026). Hoje estamos na **557**. São ~440 migrações de
diferença.

| Rota | Como | A favor | Contra |
|---|---|---|---|
| **A** — replay | Bootstrap 1→127, depois migrações 118→557 em ordem | Zero ferramenta nova; dá para automatizar com o script de aplicação já usado | ~440 arquivos, e vários foram escritos assumindo estado existente. Sem garantia de replay do zero — vide `feedback_if_not_exists_nao_converge` |
| **B** — clone *(recomendada)* | `pg_dump --schema-only` de uma turma → restore no laboratório | Fiel por construção; uma volta só; `npm run drift` confirma | Precisa da senha do banco. Os dois comandos são do professor; daí em diante é automatizável |
| **C** — branch | Branch do Supabase | Trabalho nenhum; cópia exata | Pago e efêmero; não guarda estado entre aulas |

---

## Fases

### Fase 0 — Decisão e projeto vazio

- Escolher a rota (A/B/C).
- Criar projeto em `sa-east-1`, mesma região das outras quatro. Nome sugerido:
  `logmax-lab`.
- Habilitar Email/senha em **Authentication → Providers**, como no bootstrap
  das turmas.

**Entregável:** um `ref` de projeto vazio e a rota escolhida.

### Fase 1 — Schema de pé e provado

Na rota B, o professor roda dump e restore; o resto é automatizável.

A prova usa o checador que **já existe e já aceita lista customizada**:
`scripts/schema-drift.mjs` lê a variável `LOGMAX_PROJETOS`
(formato `Nome:ref,Nome:ref`). Basta incluir o laboratório e exigir as 12
verificações verdes com **cinco** projetos.

**Entregável:** `npm run drift` verde com o laboratório na lista.

### Fase 2 — Elenco e cadastros base

Elenco mínimo para exercitar a **segregação de funções**, que é metade das
travas auditadas (quem abre a requisição não a aprova; quem emite o pedido não
confere o recebimento).

- Por filial: um gerente e um colaborador em cada setor — compras, financeiro,
  estoque, vendas, logística.
- Cadastros: fornecedores, clientes, categorias, centros de custo, e produtos
  por nicho com preço e estoque mínimo.
- Um admin, para o papel do professor.

> **Requisito que muda conforme o objetivo.** Para o seed bastam linhas em
> `user_profiles`. Para **teste de tela** são necessárias contas de auth com
> senha conhecida — o seed não faz login. Decidir o objetivo antes de executar
> esta fase.

**Entregável:** `scripts/seed-fluxo.mjs --base`, idempotente.

### Fase 3 — As três voltas completas

Cada volta percorre um fluxo de ponta a ponta, e cada passo roda como a persona
certa — o que significa que o seed **exercita os guards**: trava errada faz o
seed falhar alto, no passo exato.

- **Compra:** requisição → aprovação do gerente → cotação de 3 fornecedores →
  decisão do Financeiro → pedido → recebimento parcial → confirmação →
  devolução ao fornecedor.
- **Venda:** orçamento → aprovação → conversão em pedido → separação → conta a
  receber → baixa parcial.
- **Caixa e PDV:** abrir caixa → vendas nas 4 formas de pagamento → sangria e
  suprimento → pedido de fechamento → conferência do Financeiro.

**Entregável:** `npm run lab:seed` com relatório passo a passo (documento
gerado, número, estado).

### Fase 4 — Integrar à rotina

Auditoria nova passa a começar pelo laboratório: semear, exercitar, e só então
abrir o código. O seed vira também material de aula.

**Entregável:** uma linha no `CLAUDE.md` dizendo que o laboratório existe e
como usá-lo.

---

## O seed, em detalhe

### Dirige as RPCs, não faz INSERT

Cada passo chama a mesma função que a tela chama — `criar_requisicoes_compra_lote`,
`gerar_pedido_de_cotacao`, `criar_venda_pdv`, `solicitar_fechamento_caixa`.
Semear por `INSERT` direto produziria um estado que o aplicativo não consegue
gerar, e a auditoria estaria olhando ficção.

### Cada passo com a persona certa

Mesma técnica dos testes de 26/08 (ver `feedback_testar_guard_precisa_de_jwt`
na memória do projeto):

```sql
SELECT set_config('request.jwt.claims',
  '{"sub":"<uuid>","role":"authenticated"}', true);  -- true = is_local
SET LOCAL ROLE authenticated;   -- sem isto a RLS NÃO vale
```

As duas linhas são necessárias por motivos diferentes: sem a primeira,
`auth_is_service_role()` devolve `true` e todo guard que começa com
`IF auth_is_service_role() THEN RETURN NEW` deixa passar; sem a segunda, a
conexão é dona do schema e RLS/GRANTs não se aplicam.

Armadilhas já conhecidas:

- Temp table de resultado precisa de `GRANT ALL … TO authenticated`, senão o
  `INSERT` de dentro do `DO` dá permission denied.
- Ler o estado final **como dono**, depois do `RESET ROLE` — a RLS pode
  esconder a própria linha que acabou de ser alterada, e o teste volta nulo
  parecendo que não rodou.
- `'texto ' || v_variavel` vira `NULL` se a variável for `NULL`, e a linha
  some do relatório.

### Recusa turma viva

Lista negra dos quatro `ref` de produção embutida no script, mais exigência de
`LOGMAX_LAB_REF` explícito. Um seed apontado para turma errada é o pior
acidente possível deste plano.

Refs de produção (nunca destino de `--commit`):

| Turma | ref |
|---|---|
| LogMax-ERP | `jvqsaccupxkvezriiede` |
| logmax-aprendiz | `ythesivrqzxhjueuwswq` |
| logmax-contabilidade | `yinwjvadtbjgiksdadbt` |
| LogMax-Adm | `pvzfaejminpxkuuhilhz` |

---

## Riscos

- **O laboratório derivar das turmas sem ninguém notar.** Mitigado pela Fase 1,
  que amarra o `drift` nele.
- **O seed envelhecer.** Toda migração que muda assinatura de RPC quebra o
  seed. É o comportamento desejado, mas é custo recorrente.
- **Seed apontado para turma viva.** Mitigado pela lista negra + variável
  obrigatória. É o risco de maior impacto.
- **Objetivo mal definido na Fase 2.** Contas de `user_profiles` servem ao
  seed; teste de tela precisa de contas de auth. Decidir antes de executar.

---

## Em aberto (decisões do professor, não implementadas)

Vieram das auditorias de 26/08 e não têm relação com o laboratório, mas ficam
registradas aqui porque não têm outro lugar:

- **Alçada de desconto no PDV.** Uma colaboradora fecha uma venda de R$ 240 em
  R$ 0,00 pelo campo Desconto. A compra tem
  `alcadas_compra.valor_limite_financeiro`; a venda não tem espelho. Falta o
  teto. Depois da migr. 554 o abatimento ao menos aparece como desconto,
  separado da receita no DRE, em vez de se disfarçar de preço.
- **Visibilidade das cobranças Pix entre unidades.** A policy
  `pix_pendentes_pagador_select` é `status = 'aguardando'` para `authenticated`
  e, por serem policies OR, anula o escopo da `pix_pendentes_auth_select`.
  Estreitar por filial quebraria o exercício do colega fazendo papel de cliente
  de outra loja. Com o teto da migr. 555 valendo, ver a cobrança deixou de
  bastar para confirmá-la — o dano saiu; resta decisão de aula.
