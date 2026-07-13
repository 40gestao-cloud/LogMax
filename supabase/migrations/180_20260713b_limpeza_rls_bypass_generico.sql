-- =================================================================
-- LogMax — Remove policies genéricas que furavam TODO o RLS
-- =================================================================
-- Contexto: investigando o vazamento de Filiais entre unidades
-- (20260713_filiais_rls_nicho.sql), veio à tona que o banco tinha uma
-- segunda camada de policies — fora do histórico de migrations deste
-- repo — criadas direto no SQL Editor em algum momento:
--
--   • authenticated_full_access / authenticated_select /
--     authenticated_write  (USING true / WITH CHECK true), presentes
--     em ~40 tabelas de cadastro/financeiro/estoque/compras.
--   • auth_all  (USING true) — sobrevivente do rollback pré-hardening
--     (20260516_rls_rollback), ainda ativo em 8 tabelas de RH.
--   • <tabela>_auth  (USING true FOR ALL) — mesmo padrão, nomeado por
--     tabela: itens_venda_auth, marketing_promocoes_auth,
--     marketing_tarefas_auth, vendas_auth, controle_caixa_auth.
--
-- Como o Postgres combina policies permissivas do mesmo comando com
-- OR, essas policies com `true` bypassavam TODO o trabalho de RBAC
-- por setor (20260516_rls_hardening) e por filial (20260708d_rls_por_
-- filial, 20260709b_empresa_cadastros_filial, 20260713_filiais_rls_
-- nicho) — qualquer autenticado lia/escrevia qualquer linha de
-- qualquer unidade, mesmo colaborador comum.
--
-- Cada tabela abaixo foi conferida individualmente: TODAS já têm uma
-- policy própria e restrita (fin_*, mov_*, rh_all, ponto_*, mkt_*,
-- vendas_select/write, read_clientes, write_produtos, caixa_filial_*
-- etc.) cobrindo o mesmo comando — dropar a genérica não tira acesso
-- de ninguém que deveria ter, só fecha o furo.
--
-- Fora de escopo (não tocado aqui, checado e confirmado intencional):
--   • beneficios_pendentes_auth_all / cartao_pendentes_auth_all — é a
--     ÚNICA policy pra role authenticated nessas tabelas (MaxBank
--     benefícios/cartão pendente); as outras são pra role anon
--     (fluxo público do totem). Não são duplicata de nada.
--   • Policies "*_read" de tabela única (aula_config_select,
--     campanhas_read, calendario_read, cupons_read, configuracoes/
--     auth_read, financeiro_config/fin_config_read, etc.) — cada uma
--     é a ÚNICA policy de SELECT da sua tabela; podem ser leitura
--     global intencional (config, calendário editorial, etc.), não o
--     mesmo bug. Fica pra uma auditoria separada, tabela por tabela.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. authenticated_full_access / authenticated_select / authenticated_write ──
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aprovacoes_compras', 'aprovacoes_estoque', 'beneficios', 'caixa_bancos',
    'cargos', 'centros_custo', 'classificacoes_auxiliares', 'clientes',
    'condicoes_pagamento', 'contas_pagar', 'contas_receber', 'cotacoes',
    'departamentos', 'duplicatas', 'expedicao', 'ferias', 'filiais',
    'folha_pagamento', 'formas_pagamento', 'fornecedores', 'funcionarios',
    'integracoes_bancarias', 'inventarios', 'itens_venda', 'mapeamentos_rateio',
    'marketing_promocoes', 'marketing_tarefas', 'movimentacoes_estoque',
    'notas_recebidas', 'pedidos', 'ponto_eletronico', 'previsoes', 'produtos',
    'projetos', 'recebimentos', 'requisicoes', 'requisicoes_estoque', 'servicos',
    'treinamentos', 'vencimentos_estoque', 'vendas'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_select" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_write" ON public.%I', t);
  END LOOP;
END $$;

-- ─── 2. auth_all sobrevivente do rollback (tabelas de RH) ──────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'beneficios', 'cargos', 'departamentos', 'ferias',
    'folha_pagamento', 'funcionarios', 'ponto_eletronico', 'treinamentos'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON public.%I', t);
  END LOOP;
END $$;

-- ─── 3. <tabela>_auth (mesmo padrão, nomeado por tabela) ───────────
DROP POLICY IF EXISTS "itens_venda_auth"         ON public.itens_venda;
DROP POLICY IF EXISTS "marketing_promocoes_auth" ON public.marketing_promocoes;
DROP POLICY IF EXISTS "marketing_tarefas_auth"   ON public.marketing_tarefas;
DROP POLICY IF EXISTS "vendas_auth"              ON public.vendas;
DROP POLICY IF EXISTS "controle_caixa_auth"      ON public.controle_caixa;

COMMIT;
