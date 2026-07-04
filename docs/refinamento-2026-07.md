# LogMax — Backlog de Refinamento (2026-07)

## 1. Qualidade de Dados — Filial

**Contexto:** Todas as tabelas operacionais ganharam `filial NOT NULL DEFAULT 'SuperMax'`
nas migrations g–l de 03/07/2026. Registros históricos (anteriores à migration) ficaram
com `filial = 'SuperMax'` mesmo quando eram de MaxLook/TechMax.

**Ações:**
- [ ] Auditar registros com `filial = 'SuperMax'` em cada tabela e corrigir via SQL onde
  possível (ex.: `contas_pagar` cujo `funcionario_id` aponta pra funcionário de outra filial).
- [ ] Criar script de auditoria que lista registros provavelmente com filial errada
  (funcionario.filial ≠ registro.filial).

---

## 2. Tipo `any` excessivo nas views

**Contexto:** 1.227 ocorrências de `: any` em views. 116 de `useState<any>`.
Dificulta detectar props faltando em refactors.

**Ações:**
- [ ] Definir tipos mínimos para os DTOs mais usados (Funcionario, Produto, Venda, Pedido)
  em `src/types/` e substituir `any` nas views de maior risco (PDV, Folha, Aprovações).
- [ ] Habilitar `"strict": true` gradualmente (começar por `src/lib/` e `src/hooks/`).

---

## 3. Hook `useFetchData` — `order('created_at', desc)` hard-coded

**Contexto:** O hook faz `order('created_at', desc)` em todas as tabelas.
Tabelas sem `created_at` devolvem 400 silencioso e a UI fica vazia.
Há 18 supressões `eslint-disable` relacionadas a deps de useEffect no hook.

**Ações:**
- [ ] Garantir que toda tabela que usa `useFetchData` tem `created_at`
  (ou usar o param `orderBy` que o hook já suporta).
- [ ] Documentar no CLAUDE.md as tabelas que precisam de `orderBy` customizado.

---

## 4. Consistência do FilialSelector — Relatórios

**Contexto:** `RelatoriosEstoqueView`, `RelatoriosFinanceirosView`, `RelatoriosComprasView`,
`RelatoriosRHView` não têm FilialSelector. Mostram dados misturados de todas as filiais
sem filtro explícito.

**Ações:**
- [ ] Decidir se relatórios devem ter FilialSelector ou dropdown próprio de filial.
  Dropdown (não bloqueia a tela inteira) pode ser mais adequado para telas de BI.
- [ ] Implementar filtro de filial nos 4 relatórios.

---

## 5. `HistoricoVendasView` — estorno usa `venda.filial ?? 'SuperMax'`

**Contexto:** Ao cancelar uma venda, o estorno de movimentação cai em `'SuperMax'`
se `venda.filial` for null (vendas antigas sem filial).

**Ação:**
- [ ] Migrar: `UPDATE vendas SET filial = 'SuperMax' WHERE filial IS NULL` (ou usar
  caixa do dia para resolver a filial real).

---

## 6. Dados de funcionários sem filial em AvaliacoesView

**Contexto:** O filtro de filial em Avaliações usa `!u.filial || u.filial === filial`.
Usuários com `filial = null` (antes da migration de 03/07) aparecem em todas as filiais.

**Ação:**
- [ ] Rodar: `UPDATE user_profiles SET filial = 'SuperMax' WHERE filial IS NULL OR filial = 'Matriz'`
  (ou valor correto por funcionario).

---

## 7. RPC `criar_venda_pdv` — parâmetro `p_filial` com DEFAULT 'SuperMax'

**Contexto:** O RPC aceita `p_filial DEFAULT 'SuperMax'`. Se o PDV não passar
a filial explicitamente, vendas vão pra SuperMax silenciosamente.

**Ação:**
- [ ] Verificar se `PDVView.tsx` passa sempre `p_filial` corretamente.
  Tornar o parâmetro obrigatório (remover DEFAULT) na próxima janela de manutenção.

---

## 8. `ControleCaixaView` — filial via `profile.filial`

**Contexto:** ControleCaixa resolve filial pelo perfil do usuário logado, não por FilialSelector.
Funcionários com `profile.filial = null` ou `'Matriz'` não conseguem abrir caixa.

**Ação:**
- [ ] Garantir que todo colaborador ativo tem `filial` preenchida corretamente em `user_profiles`.

---

## 9. Cobertura de testes

**Contexto:** Apenas PDV tem testes (`tests/pdv.test.ts`). Nenhum teste cobre
o padrão FilialSelector, hooks de filial, ou fluxos de aprovação.

**Ações:**
- [ ] Adicionar testes de integração para `FolhaPagamentoView` (insert com filial).
- [ ] Testar `AprovacoesEstoqueView` — duplo clique / idempotência.
- [ ] Testar `useFetchData` com `extraFilter` de filial.

---

## 10. UX — FilialSelector sem "Voltar" em algumas views

**Contexto:** Nem toda view com FilialSelector tem botão `onVoltar` para o menu anterior.
O botão "Trocar unidade" volta à seleção de filial, não ao menu.

**Ação:**
- [ ] Verificar se `onVoltar` é necessário nas views de submenu (ex.: Tarefas, Pesquisas)
  ou se o menu lateral já supre.

---

## Ordem sugerida de execução

1. **Item 5 + 6** — SQL rápido, corrige dados históricos (≤1h)
2. **Item 7** — verificar PDVView, remover DEFAULT (≤30min)
3. **Item 4** — FilialSelector/dropdown nos Relatórios (≤1 dia)
4. **Item 8** — garantir filial em user_profiles (operacional, não código)
5. **Item 1** — auditoria de dados históricos (investigação)
6. **Item 2 + 3** — qualidade de código (refino contínuo)
7. **Item 9** — testes (sprint dedicado)
8. **Item 10** — UX menor, baixo impacto
