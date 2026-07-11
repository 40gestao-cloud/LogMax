# LogMax — Setup do zero numa nova turma (Supabase novo)

> ⚠️ **Documento desatualizado — usar apenas como referência histórica.**
>
> A partir de 2026-07 o fluxo recomendado é o **baseline consolidado**: em vez de rodar 130+ arquivos em ordem, gera-se um `baseline_YYYYMMDD.sql` via `pg_dump` do logmax-erp e roda-se ele + buckets + seed admin (3 arquivos, ~10 min).
>
> **Novo doc:** [`docs/setup-nova-turma.md`](docs/setup-nova-turma.md)
>
> Este arquivo aqui só serve pra referenciar o que cada migration antiga fez, ou pra debug quando o baseline diverge do esperado. Foi congelado no seu último estado — não reflete migrations posteriores a `20260530`.

---

Este documento lista a **ordem exata** de aplicação dos SQLs para subir um Supabase do zero e ter o LogMax funcionando como está hoje em produção.

> **Como usar:** abra o SQL Editor do Supabase do novo projeto e rode na ordem 001 → 091. Cada arquivo é idempotente (pode reaplicar sem quebrar).
>
> **Não inclui** scripts de emergência (`rls_rollback`), produção (`truncate_for_production`, `seed_admin_master`) — esses só fazem sentido depois e estão documentados em `supabase/migrations/README.md`.

---

## Bloco 1 — Schema base (SQLs em `docs/setup-turma/`)

| # | Arquivo | O que faz |
|---|---|---|
| 001 | `docs/setup-turma/logmax_supabase_schema.sql` | Tabelas-base do ERP (filiais, colaboradores, produtos, requisições, financeiro) |
| 002 | `docs/setup-turma/user_profiles_table.sql` | RBAC: tabela `user_profiles` (role + setor) |
| 003 | `docs/setup-turma/rh_tables.sql` | Módulo RH (funcionários, cargos, folha, férias) |
| 004 | `docs/setup-turma/pdv_tables.sql` | Módulo PDV (vendas, itens_venda) |
| 005 | `docs/setup-turma/marketing_tables.sql` | Módulo Marketing (promoções, tarefas) |
| 006 | `docs/setup-turma/marketing_links_migration.sql` | Colunas de link/aprovação em `marketing_tarefas` |
| 007 | `docs/setup-turma/tarefas_table.sql` | Tabela genérica `tarefas` (compartilhada por módulos) |
| 008 | `docs/setup-turma/pesquisas_tables.sql` | Submódulo Pesquisas RH (clima/eNPS) |
| 009 | `docs/setup-turma/qr_ponto_table.sql` | Registros de ponto por QR (`ponto_qr_registros`) |
| 010 | `docs/setup-turma/promocoes_reversao.sql` | RPC `reverter_promocoes_expiradas` |
| 011 | `docs/setup-turma/p0_fixes.sql` | Correções P0 sobre o schema inicial |
| 012 | `docs/setup-turma/p2_fixes.sql` | Correções P2 (inclui tabela `configuracoes`) |
| 013 | `docs/setup-turma/logmax_rls.sql` | RLS bootstrap (substituído depois pelo hardening, mas precisa rodar) |
| 014 | `docs/setup-turma/rls_policies.sql` | RLS de `controle_caixa` + ajustes |
| 015 | `docs/setup-turma/seed_data.sql` | Dados de demonstração (recomendado pra turma didática) |

---

## Bloco 2 — Migrações datadas (`supabase/migrations/`)

| # | Arquivo | O que faz |
|---|---|---|
| 016 | `001_20260515_unify_status.sql` | Unifica status para masculino (Aprovado/Negado) + snapshot em pedidos |
| 017 | `002_20260516_avaliacoes.sql` | Módulo de Avaliações de Desempenho |
| 018 | `003_20260516_colaboradores_celular.sql` | Adiciona `celular` em `colaboradores` |
| 019 | `004_20260516_crm_align_schemas.sql` | Alinha `clientes`/`fornecedores` com o CRMView |
| 020 | `005_20260516_filiais_align_ui.sql` | `celular`/`endereco`/`representante` em `filiais` |
| 021 | `006_20260516_pdv_financeiro_integration.sql` | PDV ↔ Financeiro: RPC `criar_venda_pdv` + parcelamento 1x–12x |
| 022 | `007_20260516_pix_pendentes.sql` | Fluxo Pix interativo: QR + scanner + realtime |
| 023 | `008_20260516_produtos_colunas_em_falta.sql` | `preco_custo`/`estoque_minimo`/`ean`/`fornecedor` em `produtos` |
| 024 | `009_20260516_rls_ceo_role.sql` | Role CEO recupera acesso (delta sobre hardening) |
| 025 | `010_20260516_rls_hardening.sql` | Substitui policies permissivas por scoping real por setor |
| 026 | `014_20260517_estoque_lock.sql` | `produtos.estoque` read-only após criação |
| 027 | `015_20260517_filiais_codigo_nullable.sql` | Torna `filiais.codigo` nullable |
| 028 | `016_20260517_fk_cleanup.sql` | Converte FKs para `ON DELETE SET NULL` |
| 029 | `017_20260517_holding_filial.sql` | Coluna `filial` (SuperMax/MaxLook/TechMax) em tabelas operacionais |
| 030 | `018_20260517_soft_delete.sql` | Soft delete global via coluna `ativo` |
| 031 | `019_20260518_caixa_unique_ativo.sql` | UNIQUE parcial em `controle_caixa` (`WHERE ativo = true`) |
| 032 | `020_20260518_produto_imagem.sql` | Bucket `produto-imagens` + coluna `imagem_url` |
| 033 | `021_20260519_confirmar_pix_pendente_rpc.sql` | RPC `confirmar_pix_pendente` |
| 034 | `022_20260520_ti_e_notificacoes.sql` | Módulo TI & Suporte + tabela `notificacoes` + RPC `notificar_setor` |
| 035 | `023_20260520_ti_setor_logistica.sql` | Inclui setor `logistica` nos CHECKs de TI/notificações |
| 036 | `024_20260520_ti_setor_responsavel.sql` | TI passa a ser setor com responsável próprio |
| 037 | `025_20260521_marketing_artes_feedback.sql` | Artes de promoção + feedback 1-5★ por setor |
| 038 | `026_20260522_marketing_artes_rls_fix.sql` | Fix: gallery de artes vazia em outros setores |
| 039 | `027_20260522b_indices_e_pesquisa_created_at.sql` | Índices em `created_at` (perf P1) |
| 040 | `028_20260522c_search_trigram.sql` | `pg_trgm` + GIN para busca server-side (perf P2) |
| 041 | `029_20260523_pdv_safety.sql` | Segurança transacional PDV: estoque + Pix órfão |
| 042 | `030_20260523b_pdv_validar_totais.sql` | Validação server-side dos totais do PDV |
| 043 | `031_20260525_cotacao_financeiro.sql` | Cotação passa por aprovação do Financeiro |
| 044 | `032_20260525_multi_setor.sql` | `user_profiles.setores_extras` + helpers `hasSetor()` |
| 045 | `033_20260525_ponto_timezone_acre.sql` | Trigger ponto passa a usar `America/Rio_Branco` |
| 046 | `034_20260525_recebimento_idempotencia.sql` | `movimentacoes_estoque.recebimento_id` + UNIQUE parcial |
| 047 | `035_20260525c_drop_trigger_fantasma.sql` | Remove trigger duplicado em `movimentacoes_estoque` |
| 048 | `036_20260525d_feedback_organizacional.sql` | Canal anônimo de feedback à diretoria |
| 049 | `037_20260525e_avaliacoes_multi_setor.sql` | RLS de avaliações cobre setores extras do gerente |
| 050 | `038_20260525f_enviar_feedback_anonimo_rpc.sql` | RPC oficial pra inserir feedback (sem SELECT) |
| 051 | `039_20260525g_ti_chamados_multi_setor.sql` | RLS de TI cobre setores extras do gerente |
| 052 | `040_20260525h_aprovacao_estoque_idempotencia.sql` | UNIQUE pra aprovação de estoque (anti-double-click) |
| 053 | `041_20260525i_status_contas_check.sql` | CHECK constraints em `contas_receber.status`/`contas_pagar.status` |
| 054 | `042_20260525j_feedback_org_delete_ceo.sql` | CEO pode soft-deletar `feedbacks_organizacao` |
| 055 | `043_20260525k_ponto_delete_admin_ceo.sql` | Admin/CEO podem excluir `ponto_qr_registros` |
| 056 | `044_20260526_cotacoes_logistica.sql` | Logística entra como par operacional de Compras |
| 057 | `045_20260526b_atualizar_avaliacao.sql` | RPC `atualizar_avaliacao` (edita notas/observação) |
| 058 | `046_20260526c_produtos_patrimonio.sql` | Separa `produtos` em `estoque_venda` × `patrimonio` |
| 059 | `047_20260526d_criar_avaliacao_ciclo_aberto.sql` | `criar_avaliacao` bloqueia ciclo fechado |
| 060 | `048_20260527_orfaos_contas_pagar_pedido_inativo.sql` | Limpa contas a pagar órfãs (pedido inativo) |
| 061 | `049_20260529_orcamentos_e_pedidos_venda.sql` | Módulo Orçamentos & Propostas + Pedidos de Venda |
| 062 | `050_20260529b_corrigir_link_view_notificacoes_pedido_venda.sql` | Patch `link_view` em `converter_orcamento_em_pedido` |
| 063 | `051_20260529c_ti_desenvolvimento_ia.sql` | Submódulo "Desenvolvimento com IA" (treinamentos) |
| 064 | `052_20260530_acre_timezone_fix.sql` | Alinha SQL ao fuso do Acre (UTC-5) |
| 065 | `053_20260601_filial_contas.sql` | Coluna `filial` em `contas_pagar`/`contas_receber` |
| 066 | `054_20260601b_filial_contas_pdv.sql` | PDV passa `p_filial` via RPC pro contas_receber |
| 067 | `055_20260602_auditoria_quem_fez.sql` | Auditoria: colunas `criado_por`/`atualizado_por` |
| 068 | `056_20260602b_auditoria_cadastros.sql` | Estende auditoria aos cadastros |
| 069 | `057_20260602c_unique_parcial_cadastros.sql` | UNIQUE parcial em cadastros (respeitando soft-delete) |
| 070 | `058_20260602d_marketing_tipo_origem.sql` | `tipo`/`origem` em marketing |
| 071 | `059_20260602e_servicos_filial.sql` | Coluna `filial` em `servicos` |
| 072 | `060_20260602f_produtos_unidade.sql` | Coluna `unidade` em `produtos` (UN/KG/L) |
| 073 | `061_20260605_maxbank_carteira.sql` | Módulo MaxBank (carteira digital) |
| 074 | `062_20260605b_maxbank_credito_folha.sql` | Crédito de folha de pagamento no MaxBank |
| 075 | `063_20260606_contas_pagar_folha_link.sql` | Link entre `contas_pagar` e folha |
| 076 | `064_20260606b_ponto_folha_recalculo.sql` | Recalcula folha a partir de batidas de ponto |
| 077 | `065_20260606c_maxbank_metas.sql` | Integração MaxBank ↔ Metas (saldo de meta) |
| 078 | `066_20260607_folha_valor_beneficios.sql` | Coluna `valor_beneficios` em folha |
| 079 | `067_20260607b_maxpos_beneficios_pendentes.sql` | Benefícios pendentes no PDV |
| 080 | `068_20260607c_produtos_beneficios_e_debito.sql` | Marca produtos elegíveis a benefício + débito |
| 081 | `069_20260608_maxbank_transferencias.sql` | Transferências P2P no MaxBank |
| 082 | `070_20260608b_reverter_e_excluir_maxbank.sql` | Reverter/excluir lançamentos do MaxBank |
| 083 | `071_20260608c_maxbank_excluir_recompute.sql` | Recalcula saldos após exclusão |
| 084 | `072_20260608d_caixa_por_filial.sql` | 1 caixa por dia POR unidade (SuperMax/MaxLook/TechMax) |
| 085 | `073_20260608e_metas_estrategicas_taticas.sql` | Metas em 2 níveis (estratégica → tática) |
| 086 | `074_20260608f_metas_rls_e_fanout_fix.sql` | Fix RLS + fanout em metas |
| 087 | `075_20260609_perfil_foto.sql` | Bucket de fotos de perfil + coluna `foto_url` |
| 088 | `076_20260609b_fix_role_case_reverter.sql` | Fix case-sensitivity de role no reverter |
| 089 | `077_20260610_perfil_fotos_path_scope.sql` | Escopo de path em `perfil-fotos` (segurança) |
| 090 | `078_20260611_pdv_contasreceber_descricao_produtos.sql` | Descrição de produtos vendidos em `contas_receber` |
| 091 | `079_20260612_pdv_qtd_decimal_kg.sql` | `qtd` decimal (15,3) pra venda por peso (KG/L) no PDV |

---

## Checklist após rodar tudo

1. **Criar usuário admin** — vá em **Authentication → Users → Add user** no Supabase. Depois insira manualmente em `user_profiles` com `role='admin'`, `setor='administrativo'`.
2. **Configurar Storage** — confirmar que os buckets `produto-imagens` e `perfil-fotos` foram criados (criados pelas migrações 032 e 087).
3. **Variáveis de ambiente** — preencher `.env` com:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (do novo projeto)
   - `SUPABASE_SERVICE_ROLE_KEY` (do novo projeto, **só no Vercel**, nunca no front)
   - `GEMINI_API_KEY` (se for usar o MaxAI)
   - `CRON_SECRET` (qualquer string forte; usar nas chamadas dos crons)
   - `PONTO_*` / `VITE_PONTO_*` (turma, horários — ver [[project_turmas_e_ponto]])
4. **Testar fluxos críticos**:
   - Login / logout
   - PDV → venda em dinheiro → conferir lançamento em `contas_receber`
   - Abertura de caixa por filial
   - Cadastro de produto com imagem
   - Sino de notificações realtime

---

## Convenção pra novas migrações

A partir daqui, todo SQL novo segue `supabase/migrations/AAAAMMDD[suffix]_descricao.sql`:

- `AAAAMMDD` — data de criação (garante ordem alfabética por `ls | sort`).
- `[suffix]` — `b`, `c`... quando há várias no mesmo dia.
- Sempre **idempotente** (`IF NOT EXISTS`, `DROP ... IF EXISTS`).
- Sempre **transacional** (`BEGIN; ... COMMIT;`), exceto quando rodar `CREATE INDEX CONCURRENTLY`.
- Comentário no topo: sintoma → diagnóstico → fix.

Quando adicionar uma nova migração, **atualize este arquivo** (próximo número da sequência + linha na tabela do Bloco 2).
