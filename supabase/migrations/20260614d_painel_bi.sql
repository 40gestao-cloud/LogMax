-- =================================================================
-- LogMax — Painel de Inteligência Estratégica (BI)
-- =================================================================
-- Adiciona infraestrutura pro Painel BI:
--
--   1. RPC `gerar_painel_bi(p_inicio, p_fim)` — devolve jsonb consolidado
--      com agregações de Vendas, Financeiro, RH, Estoque e Marketing,
--      tanto pro período pedido quanto pro período anterior de mesma
--      duração (pra cálculo de variação). Roda em SECURITY DEFINER pra
--      que gerentes consigam ler dados de toda a holding (RLS de cada
--      tabela individual restringiria, e o BI precisa de visão macro).
--
--   2. Tabela `relatorios_bi` — histórico/cache de relatórios gerados
--      pela IA. Mesmo período + mesmo usuário dentro de 1h reaproveita
--      o relatório (economiza Gemini). Admin/CEO veem tudo; gerente vê
--      só os próprios (privacidade da análise).
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Tabela: relatorios_bi (histórico + cache)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS relatorios_bi (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_inicio  date        NOT NULL,
  periodo_fim     date        NOT NULL,
  -- Snapshot da agregação no momento da geração — não recalcula se o
  -- usuário reabrir relatório antigo.
  dados_json      jsonb       NOT NULL,
  -- Markdown retornado pelo Gemini (texto formatado em seções).
  markdown        text        NOT NULL,
  -- Auditoria
  gerado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_gerador    text,
  modelo_ia       text,
  ativo           boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_relatorio_periodo CHECK (periodo_fim >= periodo_inicio)
);

CREATE INDEX IF NOT EXISTS idx_relatorios_bi_periodo
  ON relatorios_bi(periodo_inicio, periodo_fim) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_relatorios_bi_gerado_por
  ON relatorios_bi(gerado_por, created_at DESC) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_relatorios_bi_created_at
  ON relatorios_bi(created_at DESC);

ALTER TABLE relatorios_bi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relatorios_bi_read"   ON relatorios_bi;
DROP POLICY IF EXISTS "relatorios_bi_insert" ON relatorios_bi;
DROP POLICY IF EXISTS "relatorios_bi_delete" ON relatorios_bi;

-- Read: admin/CEO veem tudo; gerente vê só os próprios (cada gerente
-- analisa o que precisa; relatórios entre gerentes mascaram contexto).
CREATE POLICY "relatorios_bi_read" ON relatorios_bi
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR gerado_por = auth.uid()
  );

-- Insert: admin/CEO/gerente (qualquer setor). Endpoint server-side
-- também valida — defesa em profundidade.
CREATE POLICY "relatorios_bi_insert" ON relatorios_bi
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_admin()
    OR auth_user_role() = 'gerente'
  );

-- Delete: só admin/CEO podem apagar histórico (auditoria).
CREATE POLICY "relatorios_bi_delete" ON relatorios_bi
  FOR DELETE TO authenticated
  USING (auth_is_admin());

-- ─────────────────────────────────────────────
-- 2. RPC: gerar_painel_bi(p_inicio, p_fim)
-- ─────────────────────────────────────────────
-- Devolve jsonb com 5 chaves principais (vendas, financeiro, rh, estoque,
-- marketing) + 'periodo' e 'periodo_anterior'. Cada chave inclui o valor
-- atual + variação % vs. período anterior.
--
-- O período anterior tem a mesma duração: se p_inicio=01-jun, p_fim=30-jun
-- (30 dias), comparativo cobre 02-mai a 31-mai (30 dias retroativos).
--
-- SECURITY DEFINER porque o BI consolida dados de toda a holding —
-- gerente não tem RLS pra ler folha de outro setor, mas precisa do total
-- agregado pra análise. O JSON devolvido NÃO inclui linhas individuais,
-- só métricas agregadas (privacidade preservada).

CREATE OR REPLACE FUNCTION gerar_painel_bi(
  p_inicio date,
  p_fim    date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias              int;
  v_inicio_anterior   date;
  v_fim_anterior      date;
  v_vendas            jsonb;
  v_financeiro        jsonb;
  v_rh                jsonb;
  v_estoque           jsonb;
  v_marketing         jsonb;
  v_role              text := auth_user_role();
BEGIN
  -- Gate: só admin/CEO/gerente podem rodar (defesa em profundidade
  -- além da RLS de relatorios_bi).
  IF v_role NOT IN ('admin','ceo','gerente') THEN
    RAISE EXCEPTION 'Acesso negado — apenas Admin, CEO e Gerentes geram relatórios BI.'
      USING ERRCODE = '42501';
  END IF;

  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'Período inválido: % a %', p_inicio, p_fim USING ERRCODE = 'P0001';
  END IF;

  v_dias            := (p_fim - p_inicio) + 1;
  v_inicio_anterior := p_inicio - v_dias;
  v_fim_anterior    := p_inicio - 1;

  -- ─── VENDAS ───────────────────────────────────────────────────
  -- Faturamento por filial + total + comparativo. Conta só vendas
  -- ativas e concluídas.
  WITH v_atual AS (
    SELECT filial, COUNT(*) AS qtd, SUM(total_final) AS faturamento,
           AVG(total_final)::numeric(15,2) AS ticket_medio
      FROM vendas
     WHERE created_at::date BETWEEN p_inicio AND p_fim
       AND status = 'Concluída'
       AND COALESCE(ativo, true)
     GROUP BY filial
  ),
  v_anterior AS (
    SELECT SUM(total_final) AS faturamento_ant, COUNT(*) AS qtd_ant
      FROM vendas
     WHERE created_at::date BETWEEN v_inicio_anterior AND v_fim_anterior
       AND status = 'Concluída'
       AND COALESCE(ativo, true)
  )
  SELECT jsonb_build_object(
    'por_filial', COALESCE(
      jsonb_agg(jsonb_build_object(
        'filial', filial,
        'qtd_vendas', qtd,
        'faturamento', ROUND(COALESCE(faturamento,0), 2),
        'ticket_medio', ROUND(COALESCE(ticket_medio,0), 2)
      ) ORDER BY faturamento DESC NULLS LAST) FILTER (WHERE filial IS NOT NULL),
      '[]'::jsonb
    ),
    'total_faturamento', ROUND(COALESCE((SELECT SUM(faturamento) FROM v_atual), 0), 2),
    'total_vendas',      COALESCE((SELECT SUM(qtd) FROM v_atual), 0),
    'ticket_medio_geral', ROUND(
      COALESCE((SELECT SUM(faturamento) FROM v_atual) / NULLIF((SELECT SUM(qtd) FROM v_atual), 0), 0), 2),
    'faturamento_anterior', ROUND(COALESCE((SELECT faturamento_ant FROM v_anterior), 0), 2),
    'qtd_vendas_anterior',  COALESCE((SELECT qtd_ant FROM v_anterior), 0),
    'variacao_faturamento_pct', CASE
      WHEN COALESCE((SELECT faturamento_ant FROM v_anterior), 0) > 0
      THEN ROUND((((SELECT SUM(faturamento) FROM v_atual) - (SELECT faturamento_ant FROM v_anterior))
                 / (SELECT faturamento_ant FROM v_anterior)) * 100, 1)
      ELSE NULL
    END
  )
  INTO v_vendas
  FROM v_atual;

  -- ─── FINANCEIRO ───────────────────────────────────────────────
  -- contas_pagar PAGAS no período + contas_receber RECEBIDAS + margem
  -- estimada. Status 'Pago' indica realização efetiva.
  WITH f_atual AS (
    SELECT
      COALESCE((SELECT SUM(valor) FROM contas_pagar
                 WHERE COALESCE(ativo,true)
                   AND status = 'Pago'
                   AND vencimento BETWEEN p_inicio AND p_fim), 0) AS despesas,
      COALESCE((SELECT SUM(valor) FROM contas_receber
                 WHERE COALESCE(ativo,true)
                   AND status = 'Pago'
                   AND vencimento BETWEEN p_inicio AND p_fim), 0) AS receitas,
      COALESCE((SELECT SUM(valor) FROM contas_receber
                 WHERE COALESCE(ativo,true)
                   AND status = 'Aberto'
                   AND vencimento BETWEEN p_inicio AND p_fim), 0) AS a_receber,
      COALESCE((SELECT SUM(valor) FROM contas_pagar
                 WHERE COALESCE(ativo,true)
                   AND status = 'Aberto'
                   AND vencimento BETWEEN p_inicio AND p_fim), 0) AS a_pagar
  ),
  f_anterior AS (
    SELECT
      COALESCE((SELECT SUM(valor) FROM contas_pagar
                 WHERE COALESCE(ativo,true)
                   AND status = 'Pago'
                   AND vencimento BETWEEN v_inicio_anterior AND v_fim_anterior), 0) AS despesas_ant,
      COALESCE((SELECT SUM(valor) FROM contas_receber
                 WHERE COALESCE(ativo,true)
                   AND status = 'Pago'
                   AND vencimento BETWEEN v_inicio_anterior AND v_fim_anterior), 0) AS receitas_ant
  )
  SELECT jsonb_build_object(
    'receitas',  ROUND(receitas, 2),
    'despesas',  ROUND(despesas, 2),
    'saldo',     ROUND(receitas - despesas, 2),
    'a_receber', ROUND(a_receber, 2),
    'a_pagar',   ROUND(a_pagar, 2),
    'margem_pct', CASE WHEN receitas > 0
                       THEN ROUND(((receitas - despesas) / receitas) * 100, 1)
                       ELSE NULL END,
    'receitas_anterior',  ROUND((SELECT receitas_ant FROM f_anterior), 2),
    'despesas_anterior',  ROUND((SELECT despesas_ant FROM f_anterior), 2),
    'variacao_saldo_pct', CASE
      WHEN (SELECT receitas_ant - despesas_ant FROM f_anterior) > 0
      THEN ROUND((((receitas - despesas) - (SELECT receitas_ant - despesas_ant FROM f_anterior))
                  / (SELECT receitas_ant - despesas_ant FROM f_anterior)) * 100, 1)
      ELSE NULL
    END
  )
  INTO v_financeiro
  FROM f_atual;

  -- ─── RH ──────────────────────────────────────────────────────
  -- Folha do mês de referência (string YYYY-MM no schema), faltas e
  -- horas do ponto, afastamentos no período. Como folha usa mes_ref e
  -- não data, pegamos meses tocados pelo período.
  SELECT jsonb_build_object(
    'folha_total', COALESCE((
      SELECT ROUND(SUM(salario_liquido), 2)
        FROM folha_pagamento
       WHERE COALESCE(ativo, true)
         AND to_date(mes_ref, 'YYYY-MM') BETWEEN date_trunc('month', p_inicio)::date
                                             AND date_trunc('month', p_fim)::date
    ), 0),
    'folha_descontos', COALESCE((
      SELECT ROUND(SUM(descontos), 2)
        FROM folha_pagamento
       WHERE COALESCE(ativo, true)
         AND to_date(mes_ref, 'YYYY-MM') BETWEEN date_trunc('month', p_inicio)::date
                                             AND date_trunc('month', p_fim)::date
    ), 0),
    'horas_extras', COALESCE((
      SELECT ROUND(SUM(horas_extras), 2)
        FROM folha_pagamento
       WHERE COALESCE(ativo, true)
         AND to_date(mes_ref, 'YYYY-MM') BETWEEN date_trunc('month', p_inicio)::date
                                             AND date_trunc('month', p_fim)::date
    ), 0),
    'horas_atraso', COALESCE((
      SELECT ROUND(SUM(horas_atraso), 2)
        FROM folha_pagamento
       WHERE COALESCE(ativo, true)
         AND to_date(mes_ref, 'YYYY-MM') BETWEEN date_trunc('month', p_inicio)::date
                                             AND date_trunc('month', p_fim)::date
    ), 0),
    'faltas_dias', COALESCE((
      SELECT COUNT(*)
        FROM ponto_eletronico
       WHERE data BETWEEN p_inicio AND p_fim
         AND status = 'Falta'
    ), 0),
    'justificados_dias', COALESCE((
      SELECT COUNT(*)
        FROM ponto_eletronico
       WHERE data BETWEEN p_inicio AND p_fim
         AND status = 'Justificado'
    ), 0),
    'afastamentos_total', COALESCE((
      SELECT COUNT(*)
        FROM afastamentos
       WHERE COALESCE(ativo, true)
         AND data_inicio <= p_fim
         AND data_fim   >= p_inicio
    ), 0),
    'funcionarios_ativos', COALESCE((
      SELECT COUNT(*) FROM funcionarios
       WHERE COALESCE(status, 'Ativo') = 'Ativo'
    ), 0),
    'turnover_periodo', COALESCE((
      SELECT COUNT(*) FROM funcionarios
       WHERE COALESCE(status, 'Ativo') <> 'Ativo'
         AND created_at::date BETWEEN p_inicio AND p_fim
    ), 0)
  )
  INTO v_rh;

  -- ─── ESTOQUE ─────────────────────────────────────────────────
  -- Top 5 vendidos no período + produtos sem saída + giro estimado
  -- (saídas / saldo médio). Considera só produtos ativos não-patrimônio.
  SELECT jsonb_build_object(
    'top_vendidos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'produto_id', produto_id,
        'nome', nome,
        'qtd_vendida', qtd_total,
        'receita', ROUND(receita, 2),
        'filial', filial
      ) ORDER BY qtd_total DESC)
      FROM (
        SELECT iv.produto_id, p.nome, p.filial,
               SUM(iv.qtd) AS qtd_total,
               SUM(iv.subtotal) AS receita
          FROM itens_venda iv
          JOIN vendas v ON v.id = iv.venda_id
          LEFT JOIN produtos p ON p.id = iv.produto_id
         WHERE v.created_at::date BETWEEN p_inicio AND p_fim
           AND v.status = 'Concluída'
           AND COALESCE(v.ativo, true)
         GROUP BY iv.produto_id, p.nome, p.filial
         ORDER BY qtd_total DESC
         LIMIT 5
      ) t
    ), '[]'::jsonb),
    'produtos_sem_saida', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome', nome, 'filial', filial, 'estoque', estoque
      ))
      FROM (
        SELECT p.nome, p.filial, p.estoque
          FROM produtos p
         WHERE COALESCE(p.ativo, true)
           AND COALESCE(p.tipo, 'estoque_venda') <> 'patrimonio'
           AND COALESCE(p.estoque, 0) > 0
           AND NOT EXISTS (
             SELECT 1 FROM itens_venda iv
              JOIN vendas v ON v.id = iv.venda_id
             WHERE iv.produto_id = p.id
               AND v.created_at::date BETWEEN p_inicio AND p_fim
               AND v.status = 'Concluída'
           )
         ORDER BY p.estoque DESC
         LIMIT 10
      ) t
    ), '[]'::jsonb),
    'total_produtos_ativos', COALESCE((
      SELECT COUNT(*) FROM produtos
       WHERE COALESCE(ativo, true)
         AND COALESCE(tipo, 'estoque_venda') <> 'patrimonio'
    ), 0),
    'valor_estoque_total', COALESCE((
      SELECT ROUND(SUM(COALESCE(estoque, 0) * COALESCE(preco_custo, preco, 0)), 2)
        FROM produtos
       WHERE COALESCE(ativo, true)
         AND COALESCE(tipo, 'estoque_venda') <> 'patrimonio'
    ), 0)
  )
  INTO v_estoque;

  -- ─── MARKETING ───────────────────────────────────────────────
  SELECT jsonb_build_object(
    'campanhas_ativas', COALESCE((
      SELECT COUNT(*) FROM marketing_campanhas
       WHERE COALESCE(ativo, true)
         AND status = 'Ativa'
         AND data_inicio <= p_fim
         AND data_fim   >= p_inicio
    ), 0),
    'campanhas_concluidas', COALESCE((
      SELECT COUNT(*) FROM marketing_campanhas
       WHERE COALESCE(ativo, true)
         AND status = 'Concluída'
         AND data_fim BETWEEN p_inicio AND p_fim
    ), 0),
    'orcamento_campanhas', COALESCE((
      SELECT ROUND(SUM(orcamento), 2) FROM marketing_campanhas
       WHERE COALESCE(ativo, true)
         AND data_inicio <= p_fim
         AND data_fim   >= p_inicio
    ), 0),
    'gasto_real_campanhas', COALESCE((
      SELECT ROUND(SUM(gasto_real), 2) FROM marketing_campanhas
       WHERE COALESCE(ativo, true)
         AND data_inicio <= p_fim
         AND data_fim   >= p_inicio
    ), 0),
    'cupons_usados', COALESCE((
      SELECT COUNT(*) FROM vendas
       WHERE created_at::date BETWEEN p_inicio AND p_fim
         AND status = 'Concluída'
         AND COALESCE(ativo, true)
         AND cupom_id IS NOT NULL
    ), 0),
    'desconto_total_cupons', COALESCE((
      SELECT ROUND(SUM(cupom_desconto), 2) FROM vendas
       WHERE created_at::date BETWEEN p_inicio AND p_fim
         AND status = 'Concluída'
         AND COALESCE(ativo, true)
         AND cupom_id IS NOT NULL
    ), 0),
    'promocoes_aprovadas', COALESCE((
      SELECT COUNT(*) FROM marketing_promocoes
       WHERE COALESCE(ativo, true)
         AND status = 'Aprovado'
         AND COALESCE(data_inicio, p_inicio) <= p_fim
         AND COALESCE(data_fim,    p_fim)    >= p_inicio
    ), 0)
  )
  INTO v_marketing;

  -- ─── Monta JSON final ──────────────────────────────────────────
  RETURN jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', p_inicio,
      'fim',    p_fim,
      'dias',   v_dias
    ),
    'periodo_anterior', jsonb_build_object(
      'inicio', v_inicio_anterior,
      'fim',    v_fim_anterior
    ),
    'vendas',     COALESCE(v_vendas,     '{}'::jsonb),
    'financeiro', COALESCE(v_financeiro, '{}'::jsonb),
    'rh',         COALESCE(v_rh,         '{}'::jsonb),
    'estoque',    COALESCE(v_estoque,    '{}'::jsonb),
    'marketing',  COALESCE(v_marketing,  '{}'::jsonb),
    'gerado_em',  to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
END;
$$;

REVOKE ALL ON FUNCTION gerar_painel_bi(date, date) FROM public;
GRANT EXECUTE ON FUNCTION gerar_painel_bi(date, date) TO authenticated;

-- ─────────────────────────────────────────────
-- 3. Realtime publication (histórico aparece sem F5)
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'relatorios_bi'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE relatorios_bi;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como admin/CEO/gerente:
--   SELECT gerar_painel_bi(CURRENT_DATE - 30, CURRENT_DATE);
--   SELECT count(*) FROM relatorios_bi;
-- =================================================================
