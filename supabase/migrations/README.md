# Migrations do LogMax

> **Subindo um Supabase do zero (nova turma)?** Use o **baseline consolidado** — ver [`docs/setup-nova-turma.md`](../../docs/setup-nova-turma.md). Você roda 3 arquivos (baseline + buckets + seed admin) em vez de 130+ migrations em ordem.
>
> Os documentos abaixo (`SETUP_NOVA_TURMA.md` da raiz e o resto deste README) descrevem o processo antigo passo-a-passo — servem como **referência histórica** e pra debug quando alguma migration não aplicou.

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

Rodar **na ordem da coluna #**. Essa ordem corresponde a `ls supabase/migrations/*.sql | sort` (alfabética por nome, garantida pelo prefixo `AAAAMMDD[suffix]`). A primeira migração datada já assume tudo do bloco anterior aplicado.

| # | Arquivo | O que faz | Observação |
|---|---|---|---|
| 16 | `20260515_unify_status.sql` | Unifica género dos status (Aprovado/Negado) + snapshot em pedidos | |
| 17 | `20260516_avaliacoes.sql` | Módulo de Avaliações de Desempenho (etapa 1) | Pré-requisito lógico: rls_hardening |
| 18 | `20260516_colaboradores_celular.sql` | Alinha tabela `colaboradores` com a UI (campo `celular`) | |
| 19 | `20260516_crm_align_schemas.sql` | Alinha `clientes`/`fornecedores` com o CRMView | |
| 20 | `20260516_filiais_align_ui.sql` | Adiciona `celular`/`endereco`/`representante` em `filiais` | |
| 21 | `20260516_pdv_financeiro_integration.sql` | PDV ↔ Financeiro: RPC `criar_venda_pdv` + parcelamento 1x–12x | |
| 22 | `20260516_pix_pendentes.sql` | Fluxo Pix interativo: QR + scanner + realtime | |
| 23 | `20260516_produtos_colunas_em_falta.sql` | Adiciona `preco_custo`/`estoque_minimo`/`ean`/`fornecedor` em `produtos` | |
| 24 | `20260516_rls_ceo_role.sql` | Role CEO recupera acesso (delta sobre hardening) | Pré-requisito lógico: rls_hardening |
| 25 | `20260516_rls_hardening.sql` | Substitui policies `auth_all` por scoping real por setor | Substitui `logmax_rls.sql` |
| 26 | `20260516_rls_rollback.sql` | **NÃO RODAR** em setup normal — só em emergência se o hardening quebrar | ⚠️ Pular |
| 27 | `20260516_seed_admin_master.sql` | Cria usuário Admin Master pós-TRUNCATE | Só produção; editar antes |
| 28 | `20260516_truncate_for_production.sql` | TRUNCATE de todas as tabelas operacionais (limpa seed/demo) | Só produção |
| 29 | `20260517_estoque_lock.sql` | Defesa em profundidade: `produtos.estoque` read-only após criação | |
| 30 | `20260517_filiais_codigo_nullable.sql` | Torna `filiais.codigo` nullable (form da UI não preenche) | |
| 31 | `20260517_fk_cleanup.sql` | Converte FKs para `ON DELETE SET NULL` | |
| 32 | `20260517_holding_filial.sql` | Coluna `filial` (SuperMax/MaxLook/TechMax) em tabelas operacionais | |
| 33 | `20260517_soft_delete.sql` | Soft delete global via coluna `ativo` | |
| 34 | `20260518_caixa_unique_ativo.sql` | UNIQUE parcial em `controle_caixa` (`WHERE ativo = true`) | |
| 35 | `20260518_produto_imagem.sql` | Bucket `produto-imagens` + coluna `imagem_url` | |
| 36 | `20260519_confirmar_pix_pendente_rpc.sql` | RPC `confirmar_pix_pendente` (substitui UPDATE direto do simulador) | |
| 37 | `20260520_ti_e_notificacoes.sql` | Módulo TI & Suporte + tabela `notificacoes` + RPC `notificar_setor` | |
| 38 | `20260520_ti_setor_logistica.sql` | Inclui setor `logistica` nos CHECKs de TI/notificações | |
| 39 | `20260520_ti_setor_responsavel.sql` | TI passa a ser setor com responsável próprio | |
| 40 | `20260521_marketing_artes_feedback.sql` | Artes de promoção + feedback 1-5★ por setor | |
| 41 | `20260522_marketing_artes_rls_fix.sql` | Fix: gallery de artes vazia em outros setores | |
| 42 | `20260522b_indices_e_pesquisa_created_at.sql` | Índices em `created_at` + fix em `pesquisa_resposta_itens` (perf P1) | |
| 43 | `20260522c_search_trigram.sql` | `pg_trgm` + GIN para busca server-side rápida (perf P2) | |
| 44 | `20260523_pdv_safety.sql` | Segurança transacional PDV: estoque + Pix órfão | |
| 45 | `20260523b_pdv_validar_totais.sql` | Validação server-side dos totais do PDV | |
| 46 | `20260525_cotacao_financeiro.sql` | Cotação passa por aprovação do Financeiro | |
| 47 | `20260525_multi_setor.sql` | `user_profiles.setores_extras` + helpers `hasSetor()` | Pré-requisito p/ 25e, 25g |
| 48 | `20260525_ponto_timezone_acre.sql` | Trigger ponto passa a usar `America/Rio_Branco` | |
| 49 | `20260525_recebimento_idempotencia.sql` | `movimentacoes_estoque.recebimento_id` + UNIQUE parcial | |
| 50 | `20260525c_drop_trigger_fantasma.sql` | Remove trigger duplicado em `movimentacoes_estoque` | |
| 51 | `20260525d_feedback_organizacional.sql` | Canal anônimo de feedback à diretoria | |
| 52 | `20260525e_avaliacoes_multi_setor.sql` | RLS de avaliações cobre setores extras do gerente | Depende de #47 |
| 53 | `20260525f_enviar_feedback_anonimo_rpc.sql` | RPC oficial pra inserir feedback (sem SELECT) | Depende de #51 |
| 54 | `20260525g_ti_chamados_multi_setor.sql` | RLS de TI cobre setores extras do gerente | Depende de #47 |
| 55 | `20260525h_aprovacao_estoque_idempotencia.sql` | UNIQUE pra aprovação de estoque (anti-double-click) | |
| 56 | `20260525i_status_contas_check.sql` | CHECK constraints em `contas_receber.status`/`contas_pagar.status` | |
| 57 | `20260525j_feedback_org_delete_ceo.sql` | CEO pode soft-deletar `feedbacks_organizacao` | Depende de #51 |
| 58 | `20260525k_ponto_delete_admin_ceo.sql` | Admin/CEO podem excluir `ponto_qr_registros` | |
| 59 | `20260526_cotacoes_logistica.sql` | Logística entra como par operacional de Compras | Depende de #46 |
| 60 | `20260526b_atualizar_avaliacao.sql` | RPC `atualizar_avaliacao` (edita notas/observação) | Depende de #17 |
| 61 | `20260526c_produtos_patrimonio.sql` | Separa `produtos` em `estoque_venda` × `patrimonio` | |
| 62 | `20260526d_criar_avaliacao_ciclo_aberto.sql` | `criar_avaliacao` bloqueia ciclo fechado | Depende de #17 |
| 63 | `20260527_orfaos_contas_pagar_pedido_inativo.sql` | Limpa contas a pagar órfãs (pedido inativo) | |
| 64 | `20260529_orcamentos_e_pedidos_venda.sql` | Módulo Orçamentos & Propostas + Pedidos de Venda | |
| 65 | `20260529b_corrigir_link_view_notificacoes_pedido_venda.sql` | Patch `link_view` em `converter_orcamento_em_pedido` | Depende de #64 |
| 66 | `20260529c_ti_desenvolvimento_ia.sql` | Submódulo "Desenvolvimento com IA" (treinamentos) | Depende de #37 |
| 67 | `20260530_acre_timezone_fix.sql` | Alinha SQL ao fuso do Acre (UTC-5) | |

> Os números # **continuam** a contagem do bloco 1 (que vai até 15). Total: 15 arquivos da raiz + 52 migrações datadas = **67 passos** num setup do zero.

> **`20260516_rls_hardening.sql` (#25)** substitui as policies criadas em `logmax_rls.sql` (#13). Em deploys do zero ambos rodam (o segundo droppa e recria); em deploys que já têm `logmax_rls.sql` aplicado, basta rodar a partir das datadas.

> **`20260516_rls_rollback.sql` (#26)**, **`20260516_seed_admin_master.sql` (#27)** e **`20260516_truncate_for_production.sql` (#28)** **não fazem parte do setup normal**:
> - Rollback só em emergência se o hardening quebrar produção.
> - Truncate + seed admin são passos de *preparação para produção* (limpar dados de teste e criar o primeiro admin). Em ambiente de dev, pular ou aplicar seed via `seed_data.sql` da raiz.

> **Ordem dos `20260525_*` sem suffix (#46–#49)**: compartilham a mesma data, então o `sort` aplica em ordem alfabética do descritor: `cotacao_financeiro` → `multi_setor` → `ponto_timezone_acre` → `recebimento_idempotencia`. São independentes entre si, mas várias migrações posteriores (`20260525e`, `20260525g`) dependem de `20260525_multi_setor.sql` — ele precisa rodar antes do bloco `c` em diante.

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
