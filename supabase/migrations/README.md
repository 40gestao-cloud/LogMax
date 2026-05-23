# Migrations do LogMax

Este projeto tem **duas eras** de scripts SQL:

1. **Raiz do repo** (`./*.sql`) — setup inicial, escrito antes de adotarmos a convenção datada. Devem rodar **uma única vez**, na ordem listada abaixo, ao subir um Supabase do zero.
2. **`supabase/migrations/AAAAMMDD[suffix]_descricao.sql`** — migrações datadas. Rodam em ordem alfabética (data prefixada garante).

Daqui em diante, **todo novo SQL vai em `supabase/migrations/` com prefixo de data**. Nada novo na raiz.

---

## Setup do zero (Supabase novo)

Rodar nesta ordem no SQL Editor do Supabase:

### 1. Schema base (raiz do repo)

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `logmax_supabase_schema.sql` | Tabelas-base do ERP (filiais, colaboradores, produtos, requisições, financeiro, etc.) |
| 2 | `user_profiles_table.sql` | RBAC: tabela `user_profiles` (role + setor) |
| 3 | `rh_tables.sql` | Módulo RH (funcionários, cargos, departamentos, folha, férias, etc.) |
| 4 | `pdv_tables.sql` | Módulo PDV (vendas, itens_venda) |
| 5 | `marketing_tables.sql` | Módulo Marketing (promoções, tarefas) |
| 6 | `marketing_links_migration.sql` | Colunas de link/aprovação em `marketing_tarefas` |
| 7 | `tarefas_table.sql` | Tabela genérica `tarefas` (compartilhada por módulos) |
| 8 | `pesquisas_tables.sql` | Submódulo Pesquisas (RH) — pesquisas + perguntas + respostas |
| 9 | `qr_ponto_table.sql` | Registros de ponto por QR (`ponto_qr_registros`) |
| 10 | `promocoes_reversao.sql` | RPC `reverter_promocoes_expiradas` |
| 11 | `p0_fixes.sql` | Correções P0 sobre o schema inicial |
| 12 | `p2_fixes.sql` | Correções P2 (inclui tabela `configuracoes`) |
| 13 | `logmax_rls.sql` | RLS bootstrap (policies `auth_all` permissivas — substituído depois pelo hardening) |
| 14 | `rls_policies.sql` | RLS de `controle_caixa` + ajustes |
| 15 | `seed_data.sql` | **Opcional** — dados de demonstração. Pular em produção. |

### 2. Migrações datadas (`supabase/migrations/`)

Rodar **na ordem do nome do arquivo** (datas + suffix). A primeira migração datada já assume tudo do bloco anterior aplicado.

```
20260515_unify_status.sql
20260516_*.sql          (rls_hardening, pdv_financeiro, avaliacoes, pix_pendentes, …)
20260517_*.sql          (soft_delete, holding_filial, estoque_lock, fk_cleanup, …)
20260518_*.sql          (caixa_unique_ativo, produto_imagem)
20260519_*.sql          (confirmar_pix_pendente_rpc)
20260520_*.sql          (ti_e_notificacoes, ti_setor_responsavel, ti_setor_logistica)
20260521_*.sql          (marketing_artes_feedback)
20260522_*.sql          (marketing_artes_rls_fix)
20260522b_*.sql         (indices_e_pesquisa_created_at — perf P1)
20260522c_*.sql         (search_trigram — perf P2)
```

> **Importante**: `20260516_rls_hardening.sql` substitui as policies criadas em `logmax_rls.sql`. Em deploys do zero ambos rodam (o segundo droppa e recria); em deploys que já têm `logmax_rls.sql` aplicado, basta rodar a partir das datadas.

---

## Update de projeto existente

Se você já tem um Supabase rodando, **não reaplique** os arquivos da raiz. Olhe a data da última migração que aplicou e rode só as datadas posteriores:

```bash
ls supabase/migrations/*.sql | sort
```

Todas as migrações datadas são **idempotentes** (usam `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.) — em caso de dúvida sobre qual já rodou, pode reaplicar.

---

## Convenção daqui em diante

```
supabase/migrations/AAAAMMDD[suffix]_descricao.sql
```

- `AAAAMMDD` — data de criação (não de aplicação). Garante ordem alfabética.
- `[suffix]` — opcional. Use `b`, `c`, etc. quando houver várias migrações no mesmo dia (já temos `20260522`, `20260522b`, `20260522c`).
- `descricao` — kebab-case curto descrevendo a mudança.
- **Sempre idempotente**: `IF NOT EXISTS`, `DROP ... IF EXISTS` antes de `CREATE`, etc. Um rerun acidental não deve quebrar nada.
- **Sempre transacional**: `BEGIN; ... COMMIT;` (exceto quando rodar `CREATE INDEX CONCURRENTLY`, que não aceita transação).
- Comentário no topo explica: sintoma, diagnóstico, fix.
