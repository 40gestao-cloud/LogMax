# Ordem de Execução SQL — LogMax (Setup Fresh do Zero)

> Este documento lista **a ordem exata** para rodar os scripts SQL do projeto no **Supabase SQL Editor** quando você está criando um banco do zero.
>
> Cada bloco é independente — pode colar tudo no Editor de uma vez ou ir item por item. Todos os scripts oficiais são **idempotentes** (usam `IF NOT EXISTS`, `OR REPLACE`, `DROP IF EXISTS`); rodar 2× não quebra.

---

## ⚠️ Antes de começar

1. **Cria um projeto Supabase novo** (banco totalmente vazio).
2. Em **Authentication → Providers → Email**: habilita "Email" (com senha).
3. **Decide o e-mail do admin master**. Você vai usar ele no Passo Final.

---

## FASE 1 — Schema base (cria as tabelas)

Rode em ordem. Os arquivos abaixo ficam na **raiz do projeto**.

| # | Arquivo | O que cria |
|---|---|---|
| 1 | `logmax_supabase_schema.sql` | Schema canônico: filiais, clientes, fornecedores, produtos, requisições, cotações, pedidos, recebimentos, estoque, contas, RH básico (departamentos/cargos/funcionários/folha/férias/benefícios/treinamentos/ponto_eletronico). |
| 2 | `user_profiles_table.sql` | RBAC base: tabela `user_profiles` + policy `auth_read`. |
| 3 | `pdv_tables.sql` | `vendas`, `itens_venda` (módulo PDV). |
| 4 | `marketing_tables.sql` | `marketing_promocoes`, `marketing_tarefas`. |
| 5 | `qr_ponto_table.sql` | `ponto_qr_registros` (ponto eletrônico via QR/código). |
| 6 | `rh_tables.sql` | Tabelas RH complementares (algumas redundantes com schema base — `IF NOT EXISTS`). |
| 7 | `tarefas_table.sql` | Tabela genérica `tarefas` (submódulo presente em vários módulos). |
| 8 | `pesquisas_tables.sql` | Pesquisas (RH): `pesquisas`, `pesquisa_perguntas`, `pesquisa_respostas`, `pesquisa_resposta_itens` + RPC `responder_pesquisa`. |
| 9 | `rls_policies.sql` | `controle_caixa` (financeiro) + RLS aberta. **Bugfix 2026-05-25:** removido `CREATE UNIQUE INDEX ... WHERE ativo = true` que falhava aqui (coluna `ativo` só nasce na Fase 4 via `20260517_soft_delete.sql`). O índice correto é criado por `20260518_caixa_unique_ativo.sql`. |

---

## FASE 2 — RLS inicial aberta (transitória)

| # | Arquivo | O que faz |
|---|---|---|
| 10 | `logmax_rls.sql` | Habilita RLS em todas as tabelas do schema e cria policies `auth_all` (qualquer autenticado lê/escreve). **É placeholder** — vai ser substituído pelo hardening na Fase 3. |

---

## FASE 3 — Patches funcionais (triggers, RPCs, FKs)

| # | Arquivo | O que faz |
|---|---|---|
| 11 | `p0_fixes.sql` | Trigger `trg_atualiza_estoque` (movimentacoes_estoque → produtos.estoque), trigger `trg_sync_ponto` (ponto_qr_registros → ponto_eletronico), UNIQUE em ponto_eletronico, FK CASCADE em aprovacoes_compras. |
| 12 | `p2_fixes.sql` | Coluna `pedidos.requisicao_id` (rastreabilidade) + tabela `configuracoes`. |
| 13 | `promocoes_reversao.sql` | RPC `reverter_promocoes_expiradas` (cron diário restaura preço pós-campanha). |

---

## FASE 4 — Migrações cronológicas (`supabase/migrations/`)

Rode **em ordem alfabética/cronológica** do nome do arquivo. Todas começam com data `AAAAMMDD` justamente pra ordenar bem.

### 2026-05-15

| Arquivo | O que faz |
|---|---|
| `20260515_unify_status.sql` | Normaliza status feminino → masculino + snapshot em pedidos. |

### 2026-05-16

| Arquivo | O que faz |
|---|---|
| `20260516_colaboradores_celular.sql` | ADD COLUMN celular em colaboradores. |
| `20260516_crm_align_schemas.sql` | Alinha colunas CRM. |
| `20260516_filiais_align_ui.sql` | Alinha colunas filiais. |
| `20260516_produtos_colunas_em_falta.sql` | Colunas extras em produtos. |
| `20260516_pdv_financeiro_integration.sql` | RPC `criar_venda_pdv` (transacional: venda → itens → movimentação → contas_receber). |
| `20260516_pix_pendentes.sql` | Tabela `pix_pendentes` + realtime publication. |
| `20260516_avaliacoes.sql` | 4 tabelas de avaliações + RPC `criar_avaliacao`. |
| **`20260516_rls_hardening.sql`** ⚡ | **CRÍTICO**: cria helpers `auth_user_role()`, `auth_user_setor()`, `auth_is_admin()`, `auth_in_setor()` e reescreve TODAS as policies de RLS para escopo por setor. **Tudo depois daqui depende destes helpers**. |
| `20260516_rls_ceo_role.sql` | Adiciona suporte ao role 'ceo' nos helpers. |

**❌ NÃO rodar nesta fase:**
- `20260516_rls_rollback.sql` — é o rollback do hardening (rode SÓ se quiser desfazer).
- `20260516_truncate_for_production.sql` — apaga dados, irrelevante em banco vazio.
- `20260516_seed_admin_master.sql` — fica pro **Passo Final** (depois de criar admin no Auth).

### 2026-05-17

| Arquivo | O que faz |
|---|---|
| `20260517_filiais_codigo_nullable.sql` | Permite `filiais.codigo` NULL. |
| `20260517_fk_cleanup.sql` | Ajusta FKs com CASCADE/SET NULL. |
| `20260517_soft_delete.sql` | Adiciona coluna `ativo BOOLEAN` em várias tabelas. |
| `20260517_holding_filial.sql` | Adiciona `filial text` em produtos/clientes/fornecedores/user_profiles/vendas + atualiza `criar_venda_pdv` pra aceitar filial. |
| `20260517_estoque_lock.sql` | Redefine `fn_atualiza_estoque_produto` com guard de flag + trigger `trg_block_estoque_manual` (UPDATE direto em produtos.estoque é revertido silenciosamente). |

### 2026-05-18

| Arquivo | O que faz |
|---|---|
| `20260518_caixa_unique_ativo.sql` | UNIQUE parcial `controle_caixa(data) WHERE ativo=true`. |
| `20260518_produto_imagem.sql` | Bucket `produto-imagens` + coluna `produtos.imagem_url`. |

### 2026-05-19

| Arquivo | O que faz |
|---|---|
| `20260519_confirmar_pix_pendente_rpc.sql` | RPC `confirmar_pix_pendente` (rota pública do simulador Pix). |

### 2026-05-20

| Arquivo | O que faz |
|---|---|
| `20260520_ti_e_notificacoes.sql` | Tabelas `ti_chamados` + `notificacoes` + RPC `notificar_setor` + `marcar_notificacao_lida` + realtime publication. |
| `20260520_ti_setor_responsavel.sql` | Refina policies de `ti_chamados` (será atualizado em `20260525g`). |
| `20260520_ti_setor_logistica.sql` | Permite logística abrir chamados TI. |

### 2026-05-21

| Arquivo | O que faz |
|---|---|
| `20260521_marketing_artes_feedback.sql` | Tabelas `marketing_artes` + `marketing_arte_feedback` + RPC `dar_feedback_arte` + soft-delete em cascata. |

### 2026-05-22

| Arquivo | O que faz |
|---|---|
| `20260522_marketing_artes_rls_fix.sql` | Ajuste de RLS em marketing_artes. |
| `20260522b_indices_e_pesquisa_created_at.sql` | Índices de performance + coluna `created_at` em pesquisa_resposta_itens. |
| `20260522c_search_trigram.sql` | Extensão `pg_trgm` + índices GIN para busca por similaridade. |

### 2026-05-23

| Arquivo | O que faz |
|---|---|
| `20260523_pdv_safety.sql` | Reescreve `criar_venda_pdv` com lock pessimista + validação de saldo. |
| `20260523b_pdv_validar_totais.sql` | Valida totais (cliente vs servidor) na RPC do PDV. |

### 2026-05-25 — Acre / multi-setor / cotações / feedback / ponto-por-código / auditoria

Rode na ordem alfabética abaixo (importante porque tem dependências entre eles):

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20260525_ponto_timezone_acre.sql` | Trigger `fn_sync_ponto_eletronico` usa `America/Rio_Branco` (UTC-5). |
| 2 | `20260525_multi_setor.sql` | Coluna `user_profiles.setores_extras text[]` + helper `auth_user_setores()` + `auth_in_setor()` usando overlap + RLS de notificações + atualiza RPC `responder_pesquisa`. |
| 3 | `20260525_cotacao_financeiro.sql` | Colunas `feedback/aprovado_por/aprovado_em` em cotações + status `'Aguardando Financeiro'` + RLS pro Financeiro. |
| 4 | `20260525_recebimento_idempotencia.sql` | FK `movimentacoes_estoque.recebimento_id` + UNIQUE parcial. |
| 5 | `20260525c_drop_trigger_fantasma.sql` | DROP do trigger fantasma `trg_sync_estoque` (no-op em banco novo, mas seguro). |
| 6 | `20260525d_feedback_organizacional.sql` | Tabela `feedbacks_organizacao` (anonimato técnico) + RLS. |
| 7 | `20260525e_avaliacoes_multi_setor.sql` | Atualiza policy `avaliacoes_read` para usar `auth_user_setores()`. |
| 8 | `20260525f_enviar_feedback_anonimo_rpc.sql` | RPC `enviar_feedback_anonimo` (SECURITY DEFINER, contorna RLS para insert anônimo). |
| 9 | `20260525g_ti_chamados_multi_setor.sql` | Policies de ti_chamados usam `auth_in_setor('ti')`. |
| 10 | `20260525h_aprovacao_estoque_idempotencia.sql` | FK `movimentacoes_estoque.requisicao_estoque_id` + UNIQUE parcial. |
| 11 | `20260525i_status_contas_check.sql` | CHECK constraints (NOT VALID) em `contas_receber.status` e `contas_pagar.status`. |
| 12 | `20260525j_feedback_org_delete_ceo.sql` | Policy UPDATE de feedbacks_organizacao libera CEO além de admin. |
| 13 | `20260525k_ponto_delete_admin_ceo.sql` | Liberar DELETE em ponto_qr_registros pra admin/CEO + trigger `trg_recompute_ponto` (recalcula ponto_eletronico após delete). |

---

## FASE 5 — Cleanup de policies "auth_all" remanescentes

⚠️ A Fase 2 (`logmax_rls.sql` + arquivos da raiz como `qr_ponto_table.sql`, `pdv_tables.sql` etc.) cria policies abertas chamadas `auth_all` / `auth_read` em algumas tabelas. O hardening (passo 8 da Fase 4) só dropa nas tabelas listadas explicitamente. Em algumas tabelas, a policy aberta sobrevive e **anula** as restritivas (PERMISSIVE são OR'd).

Rode este bloco pra limpar as sobras:

```sql
-- Sobras conhecidas que NÃO foram dropadas pelo hardening:
DROP POLICY IF EXISTS "auth_read"          ON user_profiles;       -- coberto por up_select_own_or_scope
DROP POLICY IF EXISTS "auth_all"           ON ponto_qr_registros;  -- coberto por pontoqr_*
DROP POLICY IF EXISTS "controle_caixa_auth" ON controle_caixa;     -- coberto por fin_all
DROP POLICY IF EXISTS "auth_all"           ON vendas;
DROP POLICY IF EXISTS "auth_all"           ON itens_venda;
DROP POLICY IF EXISTS "auth_all"           ON folha_pagamento;
DROP POLICY IF EXISTS "auth_all"           ON funcionarios;
DROP POLICY IF EXISTS "auth_all"           ON departamentos;
DROP POLICY IF EXISTS "auth_all"           ON cargos;
DROP POLICY IF EXISTS "auth_all"           ON ferias;
DROP POLICY IF EXISTS "auth_all"           ON beneficios;
DROP POLICY IF EXISTS "auth_all"           ON treinamentos;
DROP POLICY IF EXISTS "auth_all"           ON ponto_eletronico;
DROP POLICY IF EXISTS "auth_all"           ON marketing_promocoes;
DROP POLICY IF EXISTS "auth_all"           ON marketing_tarefas;

-- Verificação: lista qualquer "auth_all" / "auth_read" remanescente
SELECT schemaname, tablename, policyname
  FROM pg_policies
 WHERE policyname IN ('auth_all', 'auth_read', 'controle_caixa_auth')
 ORDER BY tablename;
-- esperado: 0 linhas
```

---

## FASE 6 — Migrações de marketing tardias (se necessário)

| Arquivo | O que faz |
|---|---|
| `marketing_links_migration.sql` | Adiciona `link_propaganda/status_link/obs_link` em `marketing_tarefas`. (Pode estar redundante com `marketing_tables.sql`; `IF NOT EXISTS` deixa idempotente.) |

---

## PASSO FINAL — Cria o admin master

1. **Supabase Dashboard → Authentication → Users → "Add user"**
   - E-mail: `<email-do-admin>`
   - Senha: `<senha-forte>`
   - "Auto-confirm user": ✅
2. Abra `supabase/migrations/20260516_seed_admin_master.sql` no editor.
3. **Substitua** as duas ocorrências de `'admin@example.com'` pelo e-mail real.
4. Rode no SQL Editor.
5. Verifica:
   ```sql
   SELECT id, nome, email, role, setor FROM user_profiles WHERE role = 'admin';
   -- esperado: 1 linha com seu admin
   ```

---

## OPCIONAL — Dados fictícios (só para ambiente de teste / treinamento)

| Arquivo | O que faz |
|---|---|
| `seed_data.sql` | Popula com clientes/produtos/requisições/pedidos/movimentações fictícias. **NÃO rodar em ambiente de cliente real.** |

---

## Variáveis de ambiente Vercel (fora do SQL, mas necessárias)

Sem isso o app não conecta. Configure em **Vercel → Project Settings → Environment Variables**:

| Variável | Onde pegar | Obrigatória? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL | sim |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (secret) | sim |
| `QR_TOKEN_SECRET` | Gere com `openssl rand -hex 32` | sim (Ponto QR/código) |
| `GEMINI_API_KEY` | Google AI Studio | opcional (MaxAI assistant) |
| `CRON_SECRET` | Gere com `openssl rand -hex 32` | opcional (crons Vercel) |

---

## Checklist final

- [ ] Banco Supabase criado
- [ ] Email/senha auth habilitado
- [ ] **Fase 1** (schema base) executada
- [ ] **Fase 2** (RLS inicial) executada
- [ ] **Fase 3** (patches funcionais) executada
- [ ] **Fase 4** (migrações cronológicas) executada
- [ ] **Fase 5** (cleanup de policies abertas) executada — verificação retorna 0 linhas
- [ ] **Fase 6** (marketing_links, se aplicável) executada
- [ ] Admin master criado em Auth Dashboard
- [ ] `20260516_seed_admin_master.sql` rodado com e-mail real
- [ ] Variáveis de ambiente configuradas no Vercel
- [ ] Login bem-sucedido na app com o admin master

Pronto — banco saudável e alinhado com o último estado de produção do LogMax.
