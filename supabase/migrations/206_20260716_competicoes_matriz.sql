-- =================================================================
-- Fase 1 — Competição inter-filiais no modo Matriz.
--
-- Contexto:
--   Admin/CEO abre um período de competição entre SuperMax, MaxLook
--   e TechMax. Cada dimensão (Logística, Financeiro, RH, Vendas,
--   Marketing) tem 1 KPI-chave; ranking 3-2-1 pontos por linha.
--   Pontuação final = soma ponderada (pesos definidos no criar).
--
-- Escopo desta migração:
--   - Tabelas: competicoes_matriz + competicao_votos
--   - RPC criar_competicao (admin/CEO)
--   - RPC calcular_placar_competicao (leitura consolidada, ranking 3-2-1)
--   - RPC expirar_competicoes (cron/manual, marca aguardando_encerramento)
--   - RLS + soft-delete
--
-- Fora do escopo (Fase 2):
--   - RPC declarar_vencedora + votação (competicao_votos existe mas
--     ainda não é escrita)
--   - Endpoint /api/ai-competicao
--
-- Idempotente (CREATE OR REPLACE + IF NOT EXISTS).
-- =================================================================

BEGIN;

-- 1. Tabela principal ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competicoes_matriz (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           text NOT NULL,
  data_inicio    date NOT NULL,
  data_fim       date NOT NULL,
  status         text NOT NULL DEFAULT 'em_andamento'
                   CHECK (status IN ('em_andamento','aguardando_encerramento','encerrada')),
  -- Pesos: {"logistica":20,"financeiro":25,"rh":15,"vendas":25,"marketing":15}
  -- Soma DEVE ser 100. Validado em criar_competicao.
  pesos          jsonb NOT NULL,
  -- Preenchidos quando a competição fecha (fase 2). Placar snapshot congela
  -- o resultado histórico independente de mudanças posteriores no banco.
  vencedora      text,
  placar_snapshot jsonb,
  analise_ia     text,
  criado_por     uuid REFERENCES auth.users(id),
  encerrada_por  uuid REFERENCES auth.users(id),
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_comp_periodo CHECK (data_fim >= data_inicio),
  CONSTRAINT chk_comp_vencedora CHECK (vencedora IS NULL OR vencedora IN ('SuperMax','MaxLook','TechMax'))
);

CREATE INDEX IF NOT EXISTS idx_comp_status ON public.competicoes_matriz(status) WHERE ativo=true;
CREATE INDEX IF NOT EXISTS idx_comp_periodo ON public.competicoes_matriz(data_inicio, data_fim) WHERE ativo=true;

-- Só 1 competição em_andamento por vez — evita placar confuso.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_comp_em_andamento
  ON public.competicoes_matriz((true))
  WHERE ativo=true AND status='em_andamento';

-- 2. Votos (fase 2 escreve aqui) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competicao_votos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES public.competicoes_matriz(id) ON DELETE CASCADE,
  votante_id     uuid NOT NULL REFERENCES auth.users(id),
  voto           text NOT NULL CHECK (voto IN ('aceita','rejeita')),
  filial_escolhida text CHECK (filial_escolhida IS NULL OR filial_escolhida IN ('SuperMax','MaxLook','TechMax')),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competicao_id, votante_id)
);

-- 3. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.competicoes_matriz ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competicao_votos   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comp_read"   ON public.competicoes_matriz;
DROP POLICY IF EXISTS "comp_write"  ON public.competicoes_matriz;
DROP POLICY IF EXISTS "comp_update" ON public.competicoes_matriz;
DROP POLICY IF EXISTS "voto_read"   ON public.competicao_votos;
DROP POLICY IF EXISTS "voto_write"  ON public.competicao_votos;

-- Leitura: quem entra na Matriz (admin/CEO/conselheiro).
CREATE POLICY "comp_read" ON public.competicoes_matriz
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_user_role() = 'conselheiro'
         OR (auth_user_role() = 'gerente' AND EXISTS (
             SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_conselheiro = true)));

CREATE POLICY "comp_write" ON public.competicoes_matriz
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin());

CREATE POLICY "comp_update" ON public.competicoes_matriz
  FOR UPDATE TO authenticated
  USING (auth_is_admin())
  WITH CHECK (auth_is_admin());

-- Votos: mesmo grupo lê; só CEO+conselheiros escrevem (fase 2).
CREATE POLICY "voto_read" ON public.competicao_votos
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_user_role() = 'conselheiro'
         OR (auth_user_role() = 'gerente' AND EXISTS (
             SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_conselheiro = true)));

CREATE POLICY "voto_write" ON public.competicao_votos
  FOR INSERT TO authenticated
  WITH CHECK (
    votante_id = auth.uid()
    AND (auth_user_role() IN ('ceo','conselheiro')
         OR (auth_user_role() = 'gerente' AND EXISTS (
             SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_conselheiro = true)))
  );

-- 4. RPC: criar competição ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_competicao(
  p_nome        text,
  p_data_inicio date,
  p_data_fim    date,
  p_pesos       jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_soma numeric;
  v_id   uuid;
BEGIN
  IF NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Apenas admin/CEO cria competição' USING ERRCODE = '42501';
  END IF;
  IF p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'Data fim anterior ao início' USING ERRCODE = 'P0001';
  END IF;

  -- Pesos: 5 chaves obrigatórias, soma = 100.
  IF NOT (p_pesos ? 'logistica' AND p_pesos ? 'financeiro' AND p_pesos ? 'rh'
          AND p_pesos ? 'vendas' AND p_pesos ? 'marketing') THEN
    RAISE EXCEPTION 'Pesos exigem chaves: logistica, financeiro, rh, vendas, marketing'
      USING ERRCODE = 'P0001';
  END IF;
  v_soma := (p_pesos->>'logistica')::numeric + (p_pesos->>'financeiro')::numeric
          + (p_pesos->>'rh')::numeric + (p_pesos->>'vendas')::numeric
          + (p_pesos->>'marketing')::numeric;
  IF v_soma <> 100 THEN
    RAISE EXCEPTION 'Soma dos pesos deve ser 100 (recebido: %)', v_soma USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO competicoes_matriz (nome, data_inicio, data_fim, pesos, criado_por)
  VALUES (p_nome, p_data_inicio, p_data_fim, p_pesos, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe competição em andamento — encerre a atual antes'
      USING ERRCODE = 'P0001';
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_competicao(text, date, date, jsonb) TO authenticated;

-- 5. RPC: calcular placar (leitura, sem escrita no banco) ─────────────
-- Reaproveita a lógica de gerar_painel_bi por baixo pra puxar os
-- números crus; converte em KPIs por dimensão + ranking 3-2-1.
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp   competicoes_matriz;
  v_dados  jsonb;
  v_kpis   jsonb;
  v_scores jsonb;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  v_dados := gerar_painel_bi(v_comp.data_inicio, v_comp.data_fim);

  -- KPI-chave por dimensão (para as 3 filiais). Higher-is-better = true;
  -- para logística uso "100 - taxa_critico" pra unificar direção.
  WITH filiais AS (SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial),
  -- Vendas: faturamento por filial (v_dados.vendas.por_filial).
  vendas AS (
    SELECT
      (item->>'filial')::text AS filial,
      COALESCE((item->>'faturamento')::numeric, 0) AS valor
      FROM jsonb_array_elements(COALESCE(v_dados->'vendas'->'por_filial', '[]'::jsonb)) AS item
  ),
  -- Financeiro: contas_receber pagas - contas_pagar pagas, por filial e período.
  financeiro AS (
    SELECT f.filial,
      COALESCE((SELECT SUM(valor) FROM contas_receber
                 WHERE filial = f.filial AND status='Pago' AND ativo IS NOT FALSE
                   AND vencimento BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      -
      COALESCE((SELECT SUM(valor) FROM contas_pagar
                 WHERE filial = f.filial AND status='Pago' AND ativo IS NOT FALSE
                   AND vencimento BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      AS valor
    FROM filiais f
  ),
  -- Logística: 100 - taxa % de produtos em estoque crítico (menor crítico = melhor).
  logistica AS (
    SELECT f.filial,
      CASE WHEN COUNT(p.*) = 0 THEN 100
           ELSE 100 - ROUND(100.0 * SUM(CASE WHEN COALESCE(p.estoque,0) <= COALESCE(p.estoque_minimo,10) THEN 1 ELSE 0 END) / COUNT(*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN produtos p ON p.filial = f.filial AND COALESCE(p.ativo,true)
    GROUP BY f.filial
  ),
  -- RH: taxa de presença hoje (ponto_eletronico do dia, funcionarios ativos).
  -- Para MVP simplifico: nº de funcionarios ativos por filial (higher better).
  rh AS (
    SELECT f.filial,
      COALESCE((SELECT COUNT(*) FROM funcionarios
                 WHERE filial = f.filial AND COALESCE(status,'Ativo') = 'Ativo'), 0) AS valor
    FROM filiais f
  ),
  -- Marketing: campanhas ativas + artes publicadas no período.
  marketing AS (
    SELECT f.filial,
      COALESCE((SELECT COUNT(*) FROM marketing_campanhas
                 WHERE filial = f.filial AND COALESCE(ativo,true) AND status='Ativa'), 0)
      +
      COALESCE((SELECT COUNT(*) FROM marketing_artes
                 WHERE filial = f.filial AND created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      AS valor
    FROM filiais f
  )
  SELECT jsonb_build_object(
    'vendas',     jsonb_object_agg(x.filial, x.v),
    'financeiro', jsonb_object_agg(y.filial, y.v),
    'logistica',  jsonb_object_agg(l.filial, l.v),
    'rh',         jsonb_object_agg(r.filial, r.v),
    'marketing',  jsonb_object_agg(m.filial, m.v)
  ) INTO v_kpis
  FROM (SELECT filial, valor AS v FROM vendas) x
  FULL JOIN (SELECT filial, valor AS v FROM financeiro) y USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM logistica)  l USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM rh)         r USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM marketing)  m USING (filial);

  -- Ranking 3-2-1 por dimensão + pontuação ponderada.
  -- Empate: divide igual (média das posições).
  WITH dims AS (
    SELECT d.dim, d.peso FROM (VALUES
      ('vendas',     (v_comp.pesos->>'vendas')::numeric),
      ('financeiro', (v_comp.pesos->>'financeiro')::numeric),
      ('logistica',  (v_comp.pesos->>'logistica')::numeric),
      ('rh',         (v_comp.pesos->>'rh')::numeric),
      ('marketing',  (v_comp.pesos->>'marketing')::numeric)
    ) d(dim, peso)
  ),
  raw AS (
    SELECT d.dim, d.peso, f AS filial,
           COALESCE((v_kpis->d.dim->>f)::numeric, 0) AS valor
    FROM dims d
    CROSS JOIN unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS f
  ),
  ranked AS (
    -- 3 pts pra melhor, 2 pro do meio, 1 pro pior. Empate = média.
    SELECT dim, peso, filial, valor,
           4 - AVG(rnk) OVER (PARTITION BY dim, valor) + 0 AS ignore_rnk,
           (4 - RANK() OVER (PARTITION BY dim ORDER BY valor DESC))::numeric AS pontos_raw
    FROM (
      SELECT dim, peso, filial, valor,
             RANK() OVER (PARTITION BY dim ORDER BY valor DESC) AS rnk
      FROM raw
    ) t
  ),
  -- Empate: se 2 filiais empatam em 1º, ambas ganham (3+2)/2 = 2.5.
  scored AS (
    SELECT dim, peso, filial, valor,
           AVG(pontos_raw) OVER (PARTITION BY dim, valor) AS pontos_dim,
           (peso/100.0) * AVG(pontos_raw) OVER (PARTITION BY dim, valor) AS pontos_ponderados
    FROM ranked
  )
  SELECT jsonb_build_object(
    'por_dimensao', (
      SELECT jsonb_object_agg(dim, dim_data)
      FROM (
        SELECT dim,
               jsonb_build_object(
                 'peso', MAX(peso),
                 'filiais', jsonb_object_agg(filial, jsonb_build_object(
                   'valor', valor, 'pontos', pontos_dim, 'ponderado', pontos_ponderados
                 ))
               ) AS dim_data
        FROM scored GROUP BY dim
      ) s
    ),
    'total_por_filial', (
      SELECT jsonb_object_agg(filial, total)
      FROM (
        SELECT filial, ROUND(SUM(pontos_ponderados)::numeric, 2) AS total
        FROM scored GROUP BY filial
      ) t
    )
  ) INTO v_scores
  FROM scored LIMIT 1;

  RETURN jsonb_build_object(
    'competicao', jsonb_build_object(
      'id', v_comp.id, 'nome', v_comp.nome,
      'data_inicio', v_comp.data_inicio, 'data_fim', v_comp.data_fim,
      'status', v_comp.status, 'pesos', v_comp.pesos, 'vencedora', v_comp.vencedora
    ),
    'kpis', v_kpis,
    'placar', v_scores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

-- 6. RPC: expirar competições vencidas (chamada por cron ou manual) ───
CREATE OR REPLACE FUNCTION public.expirar_competicoes()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE competicoes_matriz
     SET status = 'aguardando_encerramento', updated_at = now()
   WHERE ativo = true
     AND status = 'em_andamento'
     AND data_fim < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expirar_competicoes() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- Como admin:
--   SELECT criar_competicao('Trimestre Q3 2026', '2026-07-01', '2026-09-30',
--     '{"logistica":20,"financeiro":25,"rh":15,"vendas":25,"marketing":15}');
--   SELECT calcular_placar_competicao('<id>');
--   SELECT expirar_competicoes(); -- normalmente via cron
-- =================================================================
