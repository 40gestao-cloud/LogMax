# Ordem de Execução SQL — LogMax (Setup Fresh do Zero)

> Lista **numerada e exata** dos scripts a rodar no Supabase SQL Editor pra criar um banco LogMax do zero.
>
> Execute na ordem dos números (1 → 57). Todos os scripts são **idempotentes** — rodar 2× não quebra.

---

## ⚠️ Antes de começar

1. **Crie um projeto Supabase novo** (banco totalmente vazio).
2. Em **Authentication → Providers → Email**: habilite "Email" (com senha).
3. **Decida o e-mail do admin master** — você vai usar ele no passo 56.

---

## 📋 Sequência completa (1 → 57)

| # | Arquivo | Fase | O que faz |
|---|---|---|---|
| 1  | `logmax_supabase_schema.sql` | Schema base | Cadastros e tabelas operacionais (filiais, clientes, fornecedores, produtos, requisições, cotações, pedidos, recebimentos, estoque, contas, RH básico). |
| 2  | `user_profiles_table.sql` | Schema base | Tabela `user_profiles` (RBAC) + policy `auth_read`. |
| 3  | `pdv_tables.sql` | Schema base | `vendas`, `itens_venda`. |
| 4  | `marketing_tables.sql` | Schema base | `marketing_promocoes`, `marketing_tarefas`. |
| 5  | `qr_ponto_table.sql` | Schema base | `ponto_qr_registros`. |
| 6  | `rh_tables.sql` | Schema base | Tabelas RH complementares (idempotente — algumas já existem do passo 1). |
| 7  | `tarefas_table.sql` | Schema base | `tarefas` (genérica, usada em todos os módulos). |
| 8  | `pesquisas_tables.sql` | Schema base | Pesquisas + RPC `responder_pesquisa`. |
| 9  | `rls_policies.sql` | Schema base | Cria `controle_caixa` + RLS aberta inicial. |
| 10 | `logmax_rls.sql` | RLS transitória | Habilita RLS em todas as tabelas + policies `auth_all` (serão substituídas em #21). |
| 11 | `p0_fixes.sql` | Patches | Trigger `trg_atualiza_estoque`, trigger `trg_sync_ponto`, UNIQUE em ponto_eletronico, FK CASCADE em aprovações. |
| 12 | `p2_fixes.sql` | Patches | Coluna `pedidos.requisicao_id` + tabela `configuracoes`. |
| 13 | `promocoes_reversao.sql` | Patches | RPC `reverter_promocoes_expiradas`. |
| 14 | `supabase/migrations/20260515_unify_status.sql` | Migrações | Normaliza status feminino → masculino + snapshot em pedidos. |
| 15 | `supabase/migrations/20260516_colaboradores_celular.sql` | Migrações | ADD COLUMN celular em colaboradores. |
| 16 | `supabase/migrations/20260516_crm_align_schemas.sql` | Migrações | Alinha colunas CRM. |
| 17 | `supabase/migrations/20260516_filiais_align_ui.sql` | Migrações | Alinha colunas filiais. |
| 18 | `supabase/migrations/20260516_produtos_colunas_em_falta.sql` | Migrações | Colunas extras em produtos. |
| 19 | `supabase/migrations/20260516_pdv_financeiro_integration.sql` | Migrações | RPC `criar_venda_pdv` (versão inicial). |
| 20 | `supabase/migrations/20260516_pix_pendentes.sql` | Migrações | Tabela `pix_pendentes` + realtime publication. |
| 21 | `supabase/migrations/20260516_rls_hardening.sql` ⚡ | **Migrações CRÍTICA** | Cria helpers `auth_user_role()`, `auth_user_setor()`, `auth_is_admin()`, `auth_in_setor()` e reescreve TODAS as policies por setor. **Tudo a partir daqui depende destes helpers**. |
| 22 | `supabase/migrations/20260516_rls_ceo_role.sql` | Migrações | Adiciona suporte ao role 'ceo' nos helpers. |
| 23 | `supabase/migrations/20260516_avaliacoes.sql` | Migrações | 4 tabelas de avaliações + RPC `criar_avaliacao`. |
| 24 | `supabase/migrations/20260517_estoque_lock.sql` | Migrações | Redefine `fn_atualiza_estoque_produto` com flag-guard + trigger `trg_block_estoque_manual`. |
| 25 | `supabase/migrations/20260517_filiais_codigo_nullable.sql` | Migrações | `filiais.codigo` passa a aceitar NULL. |
| 26 | `supabase/migrations/20260517_fk_cleanup.sql` | Migrações | Ajusta FKs com CASCADE/SET NULL. |
| 27 | `supabase/migrations/20260517_holding_filial.sql` | Migrações | ADD `filial` em produtos/clientes/fornecedores/user_profiles/vendas + atualiza `criar_venda_pdv`. |
| 28 | `supabase/migrations/20260517_soft_delete.sql` | Migrações | ADD COLUMN `ativo BOOLEAN` em várias tabelas (cria também em `controle_caixa`, prerrequisito do passo 29). |
| 29 | `supabase/migrations/20260518_caixa_unique_ativo.sql` | Migrações | UNIQUE parcial `controle_caixa(data) WHERE ativo=true`. |
| 30 | `supabase/migrations/20260518_produto_imagem.sql` | Migrações | Bucket `produto-imagens` + coluna `produtos.imagem_url`. |
| 31 | `supabase/migrations/20260519_confirmar_pix_pendente_rpc.sql` | Migrações | RPC `confirmar_pix_pendente`. |
| 32 | `supabase/migrations/20260520_ti_e_notificacoes.sql` | Migrações | Tabelas `ti_chamados` + `notificacoes` + RPC `notificar_setor` + `marcar_notificacao_lida` + realtime. |
| 33 | `supabase/migrations/20260520_ti_setor_logistica.sql` | Migrações | Logística pode abrir chamados TI. |
| 34 | `supabase/migrations/20260520_ti_setor_responsavel.sql` | Migrações | Refina policies de `ti_chamados`. |
| 35 | `supabase/migrations/20260521_marketing_artes_feedback.sql` | Migrações | Tabelas `marketing_artes` + `marketing_arte_feedback` + RPC `dar_feedback_arte`. |
| 36 | `supabase/migrations/20260522_marketing_artes_rls_fix.sql` | Migrações | Ajuste RLS em marketing_artes. |
| 37 | `supabase/migrations/20260522b_indices_e_pesquisa_created_at.sql` | Migrações | Índices de performance + `created_at` em pesquisa_resposta_itens. |
| 38 | `supabase/migrations/20260522c_search_trigram.sql` | Migrações | Extensão `pg_trgm` + índices GIN. |
| 39 | `supabase/migrations/20260523_pdv_safety.sql` | Migrações | Reescreve `criar_venda_pdv` com lock pessimista + validação de saldo. |
| 40 | `supabase/migrations/20260523b_pdv_validar_totais.sql` | Migrações | Valida totais (cliente vs servidor) na RPC do PDV. |
| 41 | `supabase/migrations/20260525_ponto_timezone_acre.sql` | Migrações | Trigger `fn_sync_ponto_eletronico` passa a usar `America/Rio_Branco`. |
| 42 | `supabase/migrations/20260525_multi_setor.sql` | Migrações | Coluna `setores_extras` + helper `auth_user_setores()` + atualiza `auth_in_setor()` + RPC `responder_pesquisa`. |
| 43 | `supabase/migrations/20260525_cotacao_financeiro.sql` | Migrações | Cotações com aprovação do Financeiro + status `'Aguardando Financeiro'`. |
| 44 | `supabase/migrations/20260525_recebimento_idempotencia.sql` | Migrações | FK `movimentacoes_estoque.recebimento_id` + UNIQUE parcial. |
| 45 | `supabase/migrations/20260525c_drop_trigger_fantasma.sql` | Migrações | DROP do trigger fantasma `trg_sync_estoque` (no-op em banco novo, seguro). |
| 46 | `supabase/migrations/20260525d_feedback_organizacional.sql` | Migrações | Tabela `feedbacks_organizacao` (anonimato técnico) + RLS. |
| 47 | `supabase/migrations/20260525e_avaliacoes_multi_setor.sql` | Migrações | Policy `avaliacoes_read` passa a usar `auth_user_setores()`. |
| 48 | `supabase/migrations/20260525f_enviar_feedback_anonimo_rpc.sql` | Migrações | RPC `enviar_feedback_anonimo` (SECURITY DEFINER). |
| 49 | `supabase/migrations/20260525g_ti_chamados_multi_setor.sql` | Migrações | Policies de ti_chamados usam `auth_in_setor('ti')`. |
| 50 | `supabase/migrations/20260525h_aprovacao_estoque_idempotencia.sql` | Migrações | FK `movimentacoes_estoque.requisicao_estoque_id` + UNIQUE parcial. |
| 51 | `supabase/migrations/20260525i_status_contas_check.sql` | Migrações | CHECK constraints (NOT VALID) em `contas_receber.status` e `contas_pagar.status`. |
| 52 | `supabase/migrations/20260525j_feedback_org_delete_ceo.sql` | Migrações | Policy UPDATE de feedbacks_organizacao libera CEO. |
| 53 | `supabase/migrations/20260525k_ponto_delete_admin_ceo.sql` | Migrações | DELETE em ponto_qr_registros pra admin/CEO + trigger `trg_recompute_ponto`. |
| 54 | `supabase/migrations/20260526_cotacoes_logistica.sql` | Migrações | RLS de `cotacoes`/`pedidos` aceita 'logistica' (par operacional de Compras); SELECT em `requisicoes` idem. |
| 55 | **(Bloco SQL inline — não é arquivo)** | Cleanup | Dropa policies `auth_all`/`auth_read` que sobreviveram ao hardening. **Cole o bloco abaixo.** |
| 56 | `marketing_links_migration.sql` | Patches finais | ADD COLUMN `link_propaganda/status_link/obs_link` em `marketing_tarefas` (idempotente). |
| 57 | `supabase/migrations/20260516_seed_admin_master.sql` | **Admin** | **Substitua `'admin@example.com'` pelo e-mail real ANTES de rodar.** Vincula a linha em user_profiles ao usuário criado no Auth Dashboard. |

---

## Passo 55 — Bloco SQL de cleanup (cole no Editor)

```sql
-- Remove policies abertas que sobraram dos passos 1–10 e não foram dropadas
-- explicitamente pelo hardening (#21).
DROP POLICY IF EXISTS "auth_read"           ON user_profiles;
DROP POLICY IF EXISTS "auth_all"            ON ponto_qr_registros;
DROP POLICY IF EXISTS "controle_caixa_auth" ON controle_caixa;
DROP POLICY IF EXISTS "auth_all"            ON vendas;
DROP POLICY IF EXISTS "auth_all"            ON itens_venda;
DROP POLICY IF EXISTS "auth_all"            ON folha_pagamento;
DROP POLICY IF EXISTS "auth_all"            ON funcionarios;
DROP POLICY IF EXISTS "auth_all"            ON departamentos;
DROP POLICY IF EXISTS "auth_all"            ON cargos;
DROP POLICY IF EXISTS "auth_all"            ON ferias;
DROP POLICY IF EXISTS "auth_all"            ON beneficios;
DROP POLICY IF EXISTS "auth_all"            ON treinamentos;
DROP POLICY IF EXISTS "auth_all"            ON ponto_eletronico;
DROP POLICY IF EXISTS "auth_all"            ON marketing_promocoes;
DROP POLICY IF EXISTS "auth_all"            ON marketing_tarefas;

-- Verificação: deve retornar 0 linhas
SELECT schemaname, tablename, policyname
  FROM pg_policies
 WHERE policyname IN ('auth_all', 'auth_read', 'controle_caixa_auth')
 ORDER BY tablename;
```

---

## Passo 57 — Como executar o seed do admin

1. **Supabase Dashboard → Authentication → Users → "Add user"**
   - E-mail: `<e-mail do admin>`
   - Senha: `<senha forte>`
   - "Auto-confirm user": ✅
2. Abra `supabase/migrations/20260516_seed_admin_master.sql` no editor.
3. **Substitua as 2 ocorrências de `'admin@example.com'` pelo e-mail real.**
4. Rode no SQL Editor.
5. Verifique:
   ```sql
   SELECT id, nome, email, role, setor FROM user_profiles WHERE role = 'admin';
   -- esperado: 1 linha com seu admin
   ```

---

## ❌ Arquivos que você NÃO deve rodar

| Arquivo | Por quê |
|---|---|
| `supabase/migrations/20260516_rls_rollback.sql` | É o rollback do hardening (#21). Só rode se quiser desfazer. |
| `supabase/migrations/20260516_truncate_for_production.sql` | Apaga TODOS os dados. Irrelevante em banco vazio. |
| `seed_data.sql` | Dados fictícios (clientes/produtos/movimentações de teste). **Não rodar em ambiente de cliente real.** Útil só pra ambiente de treinamento/demo. |

---

## 🔐 Variáveis de ambiente Vercel (fora do SQL)

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

## ✅ Checklist

- [ ] Banco Supabase criado
- [ ] Email/senha auth habilitado no Supabase
- [ ] Passos **1–54** executados em ordem
- [ ] Passo **55** (cleanup) executado — verificação retorna 0 linhas
- [ ] Passo **56** (marketing_links) executado
- [ ] Admin master criado em Authentication → Add User
- [ ] Passo **57** (seed_admin_master) executado com e-mail real substituído
- [ ] Variáveis de ambiente configuradas no Vercel
- [ ] Deploy disparado na Vercel
- [ ] Login bem-sucedido na app com o admin master

Pronto — banco saudável e alinhado com o último estado de produção do LogMax.
