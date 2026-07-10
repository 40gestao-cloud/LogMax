# Ordem de Execução SQL — LogMax (Setup Fresh do Zero)

> Lista **numerada e exata** dos scripts a rodar no Supabase SQL Editor pra criar um banco LogMax do zero.
>
> Execute na ordem dos números (1 → 109). Todos os scripts são **idempotentes** — rodar 2× não quebra.
>
> **Atualizado em: 2026-06-29**

---

## ⚠️ Antes de começar

1. **Crie um projeto Supabase novo** (banco totalmente vazio).
2. Em **Authentication → Providers → Email**: habilite "Email" (com senha).
3. **Decida o e-mail do admin master** — você vai usar ele no passo 109.

---

## 📋 Sequência completa

### Fase 1 — Schema base (1–13)

Estes scripts criam as tabelas fundamentais. Estão na raiz do repositório.

| # | Arquivo | O que faz |
|---|---|---|
| 1  | `logmax_supabase_schema.sql` | Cadastros e tabelas operacionais (filiais, clientes, fornecedores, produtos, requisições, cotações, pedidos, recebimentos, estoque, contas, RH básico). |
| 2  | `user_profiles_table.sql` | Tabela `user_profiles` (RBAC) + policy `auth_read`. |
| 3  | `pdv_tables.sql` | `vendas`, `itens_venda`. |
| 4  | `marketing_tables.sql` | `marketing_promocoes`, `marketing_tarefas`. |
| 5  | `qr_ponto_table.sql` | `ponto_qr_registros`. |
| 6  | `rh_tables.sql` | Tabelas RH complementares (idempotente — algumas já existem do passo 1). |
| 7  | `tarefas_table.sql` | `tarefas` (genérica, usada em todos os módulos). |
| 8  | `pesquisas_tables.sql` | Pesquisas + RPC `responder_pesquisa`. |
| 9  | `rls_policies.sql` | Cria `controle_caixa` + RLS aberta inicial. |
| 10 | `logmax_rls.sql` | Habilita RLS em todas as tabelas + policies `auth_all` (substituídas no passo 21). |
| 11 | `p0_fixes.sql` | Trigger `trg_atualiza_estoque`, trigger `trg_sync_ponto`, UNIQUE em ponto_eletronico, FK CASCADE em aprovações. |
| 12 | `p2_fixes.sql` | Coluna `pedidos.requisicao_id` + tabela `configuracoes`. |
| 13 | `promocoes_reversao.sql` | RPC `reverter_promocoes_expiradas`. |

### Fase 2 — Migrações (14–107)

Todos os arquivos estão em `supabase/migrations/`. Execute em ordem.

| # | Arquivo | O que faz |
|---|---|---|
| 14 | `001_20260515_unify_status.sql` | Normaliza status feminino → masculino + snapshot em pedidos. |
| 15 | `003_20260516_colaboradores_celular.sql` | ADD COLUMN celular em colaboradores. |
| 16 | `004_20260516_crm_align_schemas.sql` | Alinha colunas CRM. |
| 17 | `005_20260516_filiais_align_ui.sql` | Alinha colunas filiais. |
| 18 | `008_20260516_produtos_colunas_em_falta.sql` | Colunas extras em produtos. |
| 19 | `006_20260516_pdv_financeiro_integration.sql` | RPC `criar_venda_pdv` (versão inicial). |
| 20 | `007_20260516_pix_pendentes.sql` | Tabela `pix_pendentes` + realtime publication. |
| 21 | `010_20260516_rls_hardening.sql` ⚡ | **CRÍTICA.** Cria helpers `auth_user_role()`, `auth_user_setor()`, `auth_is_admin()`, `auth_in_setor()` e reescreve TODAS as policies por setor. **Tudo a partir daqui depende destes helpers.** |
| 22 | `009_20260516_rls_ceo_role.sql` | Adiciona suporte ao role 'ceo' nos helpers. |
| 23 | `002_20260516_avaliacoes.sql` | 4 tabelas de avaliações + RPC `criar_avaliacao`. |
| 24 | `014_20260517_estoque_lock.sql` | Redefine `fn_atualiza_estoque_produto` com flag-guard + trigger `trg_block_estoque_manual`. |
| 25 | `015_20260517_filiais_codigo_nullable.sql` | `filiais.codigo` passa a aceitar NULL. |
| 26 | `016_20260517_fk_cleanup.sql` | Ajusta FKs com CASCADE/SET NULL. |
| 27 | `017_20260517_holding_filial.sql` | ADD `filial` em produtos/clientes/fornecedores/user_profiles/vendas + atualiza `criar_venda_pdv`. |
| 28 | `018_20260517_soft_delete.sql` | ADD COLUMN `ativo BOOLEAN` em várias tabelas (cria também em `controle_caixa`, prerrequisito do passo 29). |
| 29 | `019_20260518_caixa_unique_ativo.sql` | UNIQUE parcial `controle_caixa(data) WHERE ativo=true`. |
| 30 | `020_20260518_produto_imagem.sql` | Bucket `produto-imagens` + coluna `produtos.imagem_url`. |
| 31 | `021_20260519_confirmar_pix_pendente_rpc.sql` | RPC `confirmar_pix_pendente`. |
| 32 | `022_20260520_ti_e_notificacoes.sql` | Tabelas `ti_chamados` + `notificacoes` + RPC `notificar_setor` + `marcar_notificacao_lida` + realtime. |
| 33 | `023_20260520_ti_setor_logistica.sql` | Logística pode abrir chamados TI. |
| 34 | `024_20260520_ti_setor_responsavel.sql` | Refina policies de `ti_chamados`. |
| 35 | `025_20260521_marketing_artes_feedback.sql` | Tabelas `marketing_artes` + `marketing_arte_feedback` + RPC `dar_feedback_arte`. |
| 36 | `026_20260522_marketing_artes_rls_fix.sql` | Ajuste RLS em marketing_artes. |
| 37 | `027_20260522b_indices_e_pesquisa_created_at.sql` | Índices de performance + `created_at` em pesquisa_resposta_itens. |
| 38 | `028_20260522c_search_trigram.sql` | Extensão `pg_trgm` + índices GIN. |
| 39 | `029_20260523_pdv_safety.sql` | Reescreve `criar_venda_pdv` com lock pessimista + validação de saldo. |
| 40 | `030_20260523b_pdv_validar_totais.sql` | Valida totais (cliente vs servidor) na RPC do PDV. |
| 41 | `033_20260525_ponto_timezone_acre.sql` | Trigger `fn_sync_ponto_eletronico` passa a usar `America/Rio_Branco`. |
| 42 | `032_20260525_multi_setor.sql` | Coluna `setores_extras` + helper `auth_user_setores()` + atualiza `auth_in_setor()` + RPC `responder_pesquisa`. |
| 43 | `031_20260525_cotacao_financeiro.sql` | Cotações com aprovação do Financeiro + status `'Aguardando Financeiro'`. |
| 44 | `034_20260525_recebimento_idempotencia.sql` | FK `movimentacoes_estoque.recebimento_id` + UNIQUE parcial. |
| 45 | `035_20260525c_drop_trigger_fantasma.sql` | DROP do trigger fantasma `trg_sync_estoque` (no-op em banco novo, seguro). |
| 46 | `036_20260525d_feedback_organizacional.sql` | Tabela `feedbacks_organizacao` (anonimato técnico) + RLS. |
| 47 | `037_20260525e_avaliacoes_multi_setor.sql` | Policy `avaliacoes_read` passa a usar `auth_user_setores()`. |
| 48 | `038_20260525f_enviar_feedback_anonimo_rpc.sql` | RPC `enviar_feedback_anonimo` (SECURITY DEFINER). |
| 49 | `039_20260525g_ti_chamados_multi_setor.sql` | Policies de ti_chamados usam `auth_in_setor('ti')`. |
| 50 | `040_20260525h_aprovacao_estoque_idempotencia.sql` | FK `movimentacoes_estoque.requisicao_estoque_id` + UNIQUE parcial. |
| 51 | `041_20260525i_status_contas_check.sql` | CHECK constraints (NOT VALID) em `contas_receber.status` e `contas_pagar.status`. |
| 52 | `042_20260525j_feedback_org_delete_ceo.sql` | Policy UPDATE de feedbacks_organizacao libera CEO. |
| 53 | `043_20260525k_ponto_delete_admin_ceo.sql` | DELETE em ponto_qr_registros pra admin/CEO + trigger `trg_recompute_ponto`. |
| 54 | `044_20260526_cotacoes_logistica.sql` | RLS de `cotacoes`/`pedidos` aceita 'logistica' (par operacional de Compras); SELECT em `requisicoes` idem. |
| 55 | `045_20260526b_atualizar_avaliacao.sql` | RPC `atualizar_avaliacao` — admin/CEO editam qualquer avaliação; demais só as próprias; ciclo fechado bloqueia. |
| 56 | `046_20260526c_produtos_patrimonio.sql` | Coluna `tipo` em `produtos` (estoque_venda / patrimonio) + campos tag/responsável/localização. |
| 57 | `047_20260526d_criar_avaliacao_ciclo_aberto.sql` | RPC `criar_avaliacao` bloqueia ciclo não-Aberto. |
| 58 | `048_20260527_orfaos_contas_pagar_pedido_inativo.sql` | Limpa contas_pagar órfãs vinculadas a pedido inativo. |
| 59 | `049_20260529_orcamentos_e_pedidos_venda.sql` | Módulo Orçamentos & Pedidos de Venda (tabelas + RPCs + RLS). |
| 60 | `050_20260529b_corrigir_link_view_notificacoes_pedido_venda.sql` | Fix link_view por destinatário na RPC converter_orcamento_em_pedido. |
| 61 | `051_20260529c_ti_desenvolvimento_ia.sql` | Submódulo "Desenvolvimento com IA" em TI (treinamentos IA + auxiliares). |
| 62 | `052_20260530_acre_timezone_fix.sql` | Alinhamento de fuso horário no SQL (Acre / UTC-5) em todas as RPCs. |
| 63 | `053_20260601_filial_contas.sql` | Coluna `filial` em contas_pagar e contas_receber. |
| 64 | `054_20260601b_filial_contas_pdv.sql` | Propaga p_filial para contas_receber em `criar_venda_pdv`. |
| 65 | `055_20260602_auditoria_quem_fez.sql` | Auditoria: criado_por, atualizado_por, updated_at em 20 tabelas operacionais. |
| 66 | `056_20260602b_auditoria_cadastros.sql` | Auditoria Fase 2: cadastros mestres. |
| 67 | `057_20260602c_unique_parcial_cadastros.sql` | UNIQUE parcial em cadastros com soft-delete. |
| 68 | `058_20260602d_marketing_tipo_origem.sql` | Promoções de serviços (`tipo_origem` em marketing_promocoes). |
| 69 | `059_20260602e_servicos_filial.sql` | Coluna `filial` em servicos. |
| 70 | `060_20260602f_produtos_unidade.sql` | Coluna `unidade` em produtos (UN, KG, L, M, CX, PC). |
| 71 | `061_20260605_maxbank_carteira.sql` | MaxBank Carteira Fase 1: saldo + extrato. |
| 72 | `062_20260605b_maxbank_credito_folha.sql` | MaxBank Fase 2: crédito automático ao pagar folha. |
| 73 | `063_20260606_contas_pagar_folha_link.sql` | Link contas_pagar → folha_pagamento → carteira. |
| 74 | `064_20260606b_ponto_folha_recalculo.sql` | Fase 3: Ponto → desconto/bônus na folha + RPC `recalcular_folha_do_ponto`. |
| 75 | `065_20260606c_maxbank_metas.sql` | MaxBank Fase 4: metas/gamificação com bonificação. |
| 76 | `066_20260607_folha_valor_beneficios.sql` | Split de benefícios na folha (saldo_salario + saldo_beneficios). |
| 77 | `067_20260607b_maxpos_beneficios_pendentes.sql` | PDV: beneficios_pendentes (Fase 5). |
| 78 | `068_20260607c_produtos_beneficios_e_debito.sql` | Produtos elegíveis a benefícios + RPC debitar (Fase 5). |
| 79 | `069_20260608_maxbank_transferencias.sql` | MaxBank Fase 6: Pix entre colaboradores. |
| 80 | `070_20260608b_reverter_e_excluir_maxbank.sql` | Reversão administrativa (folha + lançamentos individuais). |
| 81 | `071_20260608c_maxbank_excluir_recompute.sql` | Fix excluir_transacao_maxbank: recompute em vez de delta. |
| 82 | `072_20260608d_caixa_por_filial.sql` | Controle de Caixa por filial (1 por dia por unidade). |
| 83 | `073_20260608e_metas_estrategicas_taticas.sql` | Metas em 2 níveis: Estratégico + Tático. |
| 84 | `074_20260608f_metas_rls_e_fanout_fix.sql` | Hotfix RLS + fanout das metas. |
| 85 | `075_20260609_perfil_foto.sql` | Foto de perfil: bucket `perfil-fotos` + coluna `foto_url`. |
| 86 | `076_20260609b_fix_role_case_reverter.sql` | Fix case do role no gate de reversão MaxBank (CEO → ceo). |
| 87 | `077_20260610_perfil_fotos_path_scope.sql` | Escopa policies do bucket perfil-fotos por user_id. |
| 88 | `078_20260611_pdv_contasreceber_descricao_produtos.sql` | Descrição com nomes dos produtos em contas_receber (PDV). |
| 89 | `079_20260612_pdv_qtd_decimal_kg.sql` | Venda por peso (KG/L): qtd em numeric(15,3). |
| 90 | `080_20260612b_metas_editar_apagar.sql` | Metas estratégicas: editar + apagar (soft-delete cascade). |
| 91 | `081_20260612c_gerente_acesso_usuarios.sql` | Toggle por gerente: acesso ao módulo Usuários. |
| 92 | `082_20260612d_dev_ia_ti_only_auxiliares_abertos.sql` | Dev IA: TI cria, auxiliares abertos. |
| 93 | `083_20260614_marketing_campanhas_cupons.sql` | Marketing: Campanhas (ROI) + Cupons promocionais. |
| 94 | `084_20260614b_marketing_calendario_editorial.sql` | Marketing: Calendário Editorial. |
| 95 | `085_20260614c_rh_pdi_presenca_afastamentos.sql` | RH: PDI + Presença em Treinamentos + Afastamentos. |
| 96 | `086_20260614d_painel_bi.sql` | Painel de Inteligência Estratégica (BI) + RPC `gerar_painel_bi`. |
| 97 | `087_20260614e_briefing_diario.sql` | Briefing Diário com IA (Pauta do Dia). |
| 98 | `088_20260615_metas_apenas_admin_ceo.sql` | Metas: criação restrita a Admin/CEO. |
| 99 | `089_20260615b_drop_colaboradores.sql` | DROP TABLE colaboradores (redundância com funcionarios). |
| 100 | `090_20260615c_briefing_marketing_e_janela.sql` | Briefing: janela configurável (7/15/30 dias) + inclusão de Marketing. |
| 101 | `091_20260615d_avaliacoes_pdi_rh.sql` | RH ganha leitura cross-setor em avaliações + gestão PDI. |
| 102 | `092_20260616a_briefing_editar_excluir.sql` | Briefing: editar/excluir com cascade nas tarefas. |
| 103 | `093_20260618_treinamentos_descricao_horarios_multi_instrutor.sql` | Treinamentos: descrição, horários, multi-instrutor. |
| 104 | `094_20260618b_feedback_destinatarios_categoria.sql` | Feedback: destinatários por role + categoria obrigatória. |
| 105 | `095_20260618c_avaliacoes_criterios_e_escala_10.sql` | Avaliações: renomear critérios + escala 0-10. |
| 106 | `096_20260618d_resetar_dados_operacionais.sql` | RPC `resetar_dados_operacionais` (wipe preservando usuários). |
| 107 | `097_20260618e_fix_delete_user_maxbank_fk.sql` | Fix "Database error deleting user": FKs maxbank. |
| 108 | `098_20260618f_fix_user_profiles_criado_por_fk.sql` | Fix #2 delete user: FK user_profiles.criado_por. |
| 109 | `099_20260619a_fix_delete_user_ponto_trigger.sql` | Fix #3 delete user: trigger ponto com search_path. |
| 110 | `100_20260619b_fix_aprovacoes_insert_rls.sql` | Fix requisição não aparece em aprovações: RLS INSERT. |
| 111 | `101_20260619c_rpc_criar_requisicao.sql` | RPCs transacionais: criar_requisicao_compra + criar_requisicao_estoque. |
| 112 | `102_20260619d_rpc_get_vitrine_publica.sql` | RPC pública `get_vitrine_publica`. |
| 113 | `103_20260619e_vitrine_publica_toggle.sql` | Toggle `vitrine_publica` em marketing_artes e produtos. |
| 114 | `104_20260619f_financeiro_juros_caixa.sql` | Financeiro: juros + multa + sangria/suprimento + conferência de caixa. |
| 115 | `105_20260619g_vitrine_fallback_produto_imagem.sql` | Vitrine: fallback arte_url vazia → produto.imagem_url. |
| 116 | `106_20260619h_vitrine_fallback_onerror.sql` | Vitrine: separa imagem_url e imagem_fallback pra onError no front. |
| 117 | `107_20260619i_vitrine_aumenta_limite.sql` | Vitrine: aumenta limite de candidatos. |
| 118 | `108_20260620a_projetos_descricao.sql` | Projetos: campo descrição livre (textarea). |
| 119 | `109_20260623_baixa_banco_id.sql` | Audit trail de baixas: qual banco foi debitado/creditado. |
| 120 | `110_20260623b_caixa_bancos_logo.sql` | Logo por banco: bucket `banco-logos` + coluna `imagem_url`. |
| 121 | `111_20260626_caixa_operador_fechar_suspender.sql` | Operador PDV pode fechar/suspender caixa + coluna origem. |
| 122 | `112_20260626b_drop_fechar_caixa_overload.sql` | Remove overload antiga de `fechar_caixa_conferido` (3 params). |
| 123 | `113_20260626c_frequencia_trabalho.sql` | Frequência de Trabalho: registro diário de presença/falta/atraso. |
| 124 | `114_20260627_justificativas_falta.sql` | Justificativas de falta com notificação hierárquica. |
| 125 | `115_20260628_renotificar_pix_pago.sql` | RPC `renotificar_pix_pago` (re-dispara evento realtime). |
| 126 | `116_20260629_cartao_pendentes.sql` | Fluxo Cartão (Maquininha) interativo: `cartao_pendentes` + RPCs. |
| 127 | `117_20260629b_carteira_fatura.sql` | Adiciona carteira 'fatura' em maxbank_transacoes. |

### Fase 3 — Cleanup e Admin (108–109)

| # | Arquivo | O que faz |
|---|---|---|
| 108 | **(Bloco SQL inline — cole no Editor)** | Dropa policies `auth_all`/`auth_read` que sobreviveram ao hardening. **Veja abaixo.** |
| 109 | `marketing_links_migration.sql` (raiz) | ADD COLUMN `link_propaganda/status_link/obs_link` em `marketing_tarefas`. |

### Fase 4 — Seed do Admin Master (110)

| # | Arquivo | O que faz |
|---|---|---|
| 110 | `supabase/migrations/012_20260516_seed_admin_master.sql` | **Substitua `'admin@example.com'` pelo e-mail real ANTES de rodar.** |

---

## Passo 108 — Bloco SQL de cleanup (cole no Editor)

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

## Passo 110 — Como executar o seed do admin

1. **Supabase Dashboard → Authentication → Users → "Add user"**
   - E-mail: `<e-mail do admin>`
   - Senha: `<senha forte>`
   - "Auto-confirm user": ✅
2. Abra `supabase/migrations/012_20260516_seed_admin_master.sql` no editor.
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
| `supabase/migrations/011_20260516_rls_rollback.sql` | É o rollback do hardening (#21). Só rode se quiser desfazer. |
| `supabase/migrations/013_20260516_truncate_for_production.sql` | Apaga TODOS os dados. Irrelevante em banco vazio. |
| `seed_data.sql` | Dados fictícios (clientes/produtos/movimentações de teste). **Não rodar em ambiente de cliente real.** Útil só pra ambiente de treinamento/demo. |

---

## 🔐 Variáveis de ambiente Vercel (fora do SQL)

Configure em **Vercel → Project Settings → Environment Variables**:

| Variável | Onde pegar | Obrigatória? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL | sim |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (secret) | sim |
| `QR_TOKEN_SECRET` | Gere com `openssl rand -hex 32` | sim (Ponto QR/código) |
| `GEMINI_API_KEY` | Google AI Studio | opcional (MaxAI assistant) |
| `GROQ_API_KEY` | Groq Cloud | opcional (fallback IA) |
| `OPENROUTER_API_KEY` | OpenRouter | opcional (fallback IA) |
| `CRON_SECRET` | Gere com `openssl rand -hex 32` | opcional (crons Vercel) |
| `PONTO_HORA_ENTRADA` | Horário de entrada da turma (ex: `07:40`) | sim (Ponto) |
| `PONTO_HORA_ALMOCO_SAIDA` | Horário saída almoço (ex: `09:20`) | sim (Ponto) |
| `PONTO_HORA_ALMOCO_VOLTA` | Horário volta almoço (ex: `09:20`) | sim (Ponto) |
| `PONTO_HORA_SAIDA` | Horário de saída (ex: `11:20`) | sim (Ponto) |
| `VITE_PONTO_HORA_ENTRADA` | Mesmo valor (frontend) | sim |
| `VITE_PONTO_HORA_ALMOCO_SAIDA` | Mesmo valor (frontend) | sim |
| `VITE_PONTO_HORA_ALMOCO_VOLTA` | Mesmo valor (frontend) | sim |
| `VITE_PONTO_HORA_SAIDA` | Mesmo valor (frontend) | sim |

---

## ✅ Checklist

- [ ] Banco Supabase criado
- [ ] Email/senha auth habilitado no Supabase
- [ ] Passos **1–13** (schema base) executados em ordem
- [ ] Passos **14–127** (migrações) executados em ordem
- [ ] Passo **108** (cleanup) executado — verificação retorna 0 linhas
- [ ] Passo **109** (marketing_links) executado
- [ ] Admin master criado em Authentication → Add User
- [ ] Passo **110** (seed_admin_master) executado com e-mail real substituído
- [ ] Variáveis de ambiente configuradas no Vercel
- [ ] Deploy disparado na Vercel
- [ ] Login bem-sucedido na app com o admin master

Pronto — banco saudável e alinhado com o último estado de produção do LogMax.
