-- =================================================================
-- Refino do módulo Competição/Central de Avaliação da Matriz.
--
-- Muda:
--   1. calcular_placar_competicao: dimensão marketing passa a usar a
--      média das notas 0-10 do conselho (arte/promoção/campanha) quando
--      houver ao menos uma avaliação com nota na competição. Sem
--      avaliações, mantém a fórmula antiga (campanhas ativas + artes).
--      Filial sem notas vai a 0 no cenário "com julgamento" — a régua é
--      intencional: se o conselho ainda não julgou uma filial, ela não
--      pontua em marketing até receber avaliação.
--
--   2. Nova RPC contar_votantes_matriz() → int
--      Fonte pra quórum dinâmico no cliente (CEO + conselheiros da Matriz).
--
--   3. Nova RPC encerrar_competicao_agora(uuid)
--      Admin/CEO força em_andamento → aguardando_encerramento antes da
--      data_fim (fecha trimestre puxado). Cron 03:10 faz o mesmo pra
--      competições vencidas.
--
--   4. RLS competicao_votos: permite UPDATE do próprio voto enquanto a
--      competição está aguardando_encerramento. Antes só INSERT (voto
--      cravado no primeiro clique).
--
-- Idempotente (CREATE OR REPLACE + DROP POLICY IF EXISTS).
-- =================================================================

BEGIN;

-- 1. Placar recomputado ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp      competicoes_matriz;
  v_dados     jsonb;
  v_kpis      jsonb;
  v_scores    jsonb;
  v_tem_notas boolean;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  v_dados := gerar_painel_bi(v_comp.data_inicio, v_comp.data_fim);

  -- Julgamento do conselho já iniciado? (qualquer nota lançada em
  -- arte/promoção/campanha na competição).
  SELECT EXISTS (
    SELECT 1 FROM avaliacoes_matriz
     WHERE competicao_id = p_competicao_id
       AND ativo = true
       AND nota IS NOT NULL
  ) INTO v_tem_notas;

  WITH filiais AS (SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial),
  vendas AS (
    SELECT
      (item->>'filial')::text AS filial,
      COALESCE((item->>'faturamento')::numeric, 0) AS valor
      FROM jsonb_array_elements(COALESCE(v_dados->'vendas'->'por_filial', '[]'::jsonb)) AS item
  ),
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
  logistica AS (
    SELECT f.filial,
      CASE WHEN COUNT(p.*) = 0 THEN 100
           ELSE 100 - ROUND(100.0 * SUM(CASE WHEN COALESCE(p.estoque,0) <= COALESCE(p.estoque_minimo,10) THEN 1 ELSE 0 END) / COUNT(*), 1)
      END AS valor
    FROM filiais f
    LEFT JOIN produtos p ON p.filial = f.filial AND COALESCE(p.ativo,true)
    GROUP BY f.filial
  ),
  rh AS (
    SELECT f.filial,
      COALESCE((SELECT COUNT(*) FROM funcionarios
                 WHERE filial = f.filial AND COALESCE(status,'Ativo') = 'Ativo'), 0) AS valor
    FROM filiais f
  ),
  marketing AS (
    -- Com julgamento: média_nota_conselho * 10 (0..100). Sem julgamento:
    -- fórmula antiga (campanhas ativas + artes no período).
    SELECT f.filial,
      CASE WHEN v_tem_notas THEN
        COALESCE(
          (SELECT ROUND(AVG(nota) * 10, 2)
             FROM avaliacoes_matriz
            WHERE competicao_id = p_competicao_id
              AND ativo = true
              AND nota IS NOT NULL
              AND filial_avaliada = f.filial),
          0
        )
      ELSE
        COALESCE((SELECT COUNT(*) FROM marketing_campanhas
                   WHERE filial = f.filial AND COALESCE(ativo,true) AND status='Ativa'), 0)
        +
        COALESCE((SELECT COUNT(*) FROM marketing_artes
                   WHERE filial = f.filial AND created_at::date BETWEEN v_comp.data_inicio AND v_comp.data_fim), 0)
      END AS valor
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
    SELECT dim, peso, filial, valor,
           (4 - RANK() OVER (PARTITION BY dim ORDER BY valor DESC))::numeric AS pontos_raw
    FROM raw
  ),
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
    'marketing_origem', CASE WHEN v_tem_notas THEN 'conselho' ELSE 'atividade' END,
    'placar', v_scores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

-- 2. Contagem de votantes elegíveis (quórum dinâmico) ────────────────
CREATE OR REPLACE FUNCTION public.contar_votantes_matriz()
RETURNS int
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.user_profiles
  WHERE filial = 'Matriz'
    AND (
      role = 'ceo'
      OR role = 'conselheiro'
      OR (role = 'gerente' AND is_conselheiro = true)
    );
$$;

GRANT EXECUTE ON FUNCTION public.contar_votantes_matriz() TO authenticated;

-- 3. Encerramento manual (força aguardando_encerramento) ─────────────
CREATE OR REPLACE FUNCTION public.encerrar_competicao_agora(
  p_competicao_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  -- Restrito a admin/CEO puros. auth_is_admin() aqui é fraco demais
  -- (inclui conselheiro/gerente-conselheiro), o que descolaria da UI.
  IF auth_user_role() NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO pode encerrar competição' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'em_andamento' THEN
    RAISE EXCEPTION 'Só competição em andamento pode ser encerrada agora (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE competicoes_matriz
     SET status = 'aguardando_encerramento', updated_at = now()
   WHERE id = p_competicao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.encerrar_competicao_agora(uuid) TO authenticated;

-- 4. RLS competicao_votos: permite trocar próprio voto ───────────────
DROP POLICY IF EXISTS "voto_update" ON public.competicao_votos;

CREATE POLICY "voto_update" ON public.competicao_votos
  FOR UPDATE TO authenticated
  USING (
    votante_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM competicoes_matriz c
       WHERE c.id = competicao_votos.competicao_id
         AND c.status = 'aguardando_encerramento'
    )
  )
  WITH CHECK (
    votante_id = auth.uid()
    AND (auth_user_role() IN ('ceo','conselheiro')
         OR (auth_user_role() = 'gerente' AND EXISTS (
             SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_conselheiro = true)))
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
