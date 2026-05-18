-- ============================================================
-- LogMax — Controle de Caixa + RLS Policies
-- Execute no Supabase SQL Editor
-- ============================================================


-- ── 1. Cria tabela controle_caixa (se ainda não existir) ────

CREATE TABLE IF NOT EXISTS controle_caixa (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  data             date NOT NULL,
  valor_abertura   numeric(15,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'Aberto',
  aberto_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aberto_por_nome  text,
  aberto_em        timestamptz DEFAULT now(),
  fechado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fechado_por_nome text,
  fechado_em       timestamptz,
  observacao       text,
  created_at       timestamptz DEFAULT now()
);

-- Garante apenas um caixa ativo por dia.
-- Partial index: linhas soft-deletadas (ativo=false) NÃO bloqueiam
-- a abertura de uma nova sessão no mesmo dia. Veja migração
-- 20260518_caixa_unique_ativo.sql.
CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_caixa_data_ativo
  ON controle_caixa (data)
  WHERE ativo = true;

ALTER TABLE controle_caixa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "controle_caixa_auth" ON controle_caixa;
CREATE POLICY "controle_caixa_auth" ON controle_caixa
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 2. Habilita RLS + políticas em todas as outras tabelas ──
-- Processa apenas tabelas que já existem (ignora as ausentes).

DO $outer$
DECLARE
  t            TEXT;
  tbl_exists   BOOLEAN;
  tables TEXT[] := ARRAY[
    'filiais','colaboradores','clientes','fornecedores','produtos','servicos',
    'centros_custo','projetos','condicoes_pagamento','classificacoes_auxiliares',
    'mapeamentos_rateio','formas_pagamento','requisicoes','cotacoes','pedidos',
    'aprovacoes_compras','recebimentos','notas_recebidas','requisicoes_estoque',
    'aprovacoes_estoque','expedicao','movimentacoes_estoque','inventarios',
    'vencimentos_estoque','contas_receber','contas_pagar','previsoes','duplicatas',
    'caixa_bancos','integracoes_bancarias','departamentos','cargos','funcionarios',
    'folha_pagamento','ferias','ponto_eletronico','beneficios','treinamentos',
    'vendas','itens_venda','marketing_promocoes','marketing_tarefas'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) INTO tbl_exists;

    IF tbl_exists THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_select" ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_write" ON %I', t);
      EXECUTE format(
        'CREATE POLICY "authenticated_select" ON %I FOR SELECT TO authenticated USING (true)',
        t
      );
      EXECUTE format(
        'CREATE POLICY "authenticated_write" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END;
$outer$;


-- ── 3. RBAC por setor (opcional) ────────────────────────────
-- Descomente e adapte para restringir acesso por setor.
-- Requer coluna `setor` na tabela de perfis do seu projeto.
--
-- Exemplo: somente setor financeiro acessa contas_pagar:
--
-- DROP POLICY IF EXISTS "authenticated_select" ON contas_pagar;
-- CREATE POLICY "financeiro_select" ON contas_pagar
--   FOR SELECT TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM user_profiles
--       WHERE id = auth.uid() AND setor IN ('all', 'financeiro')
--     )
--   );
