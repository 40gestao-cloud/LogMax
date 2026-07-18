-- =================================================================
-- Central de Avaliação — reestruturação de 2 níveis
--
-- Dados das Filiais (extraídos das filiais):
--   Marketing  ← arte, promocao, campanha, redes_sociais (NOVO)
--   Vendas     ← orcamento (NOVO)   [sai pedido_venda, treinamento]
--   Compras    ← requisicao, cotacao
--   Financeiro ← conta_pagar, conta_receber
--   RH         ← frequencia_trabalho, avaliacao_desempenho
--   Cadastros  ← 5 tipos (produto/cliente/etc)
--
-- Tarefas da Matriz (criadas pelo conselho):
--   Treinamento em Vendas  → tipo 'tarefa_treinamento_vendas'
--   Treinamento em IA      → tipo 'tarefa_treinamento_ia'
--   Apresentação Prof.     → tipo 'tarefa_apresentacao'
--
-- Placar ganha 7ª dimensão `matriz` — média das notas dos participantes,
-- agrupada pela filial do participante. Pesos default redistribuídos.
--
-- Redes Sociais das filiais: constraint reduzida a Instagram/TikTok
-- (Facebook/YouTube desativados; registros antigos ficam ativo=false).
-- =================================================================

BEGIN;

-- 1. Restringe metricas_redes_sociais a IG+TT ────────────────────────
--    Registros antigos de Facebook/YouTube são desativados (soft delete)
--    pra não bloquear o CHECK. Histórico preservado.
UPDATE public.metricas_redes_sociais
   SET ativo = false
 WHERE plataforma IN ('Facebook','YouTube') AND ativo = true;

ALTER TABLE public.metricas_redes_sociais
  DROP CONSTRAINT IF EXISTS metricas_redes_sociais_plataforma_check;

ALTER TABLE public.metricas_redes_sociais
  ADD CONSTRAINT metricas_redes_sociais_plataforma_check
  CHECK (plataforma IN ('Instagram','TikTok'));

-- 2. Expande item_tipo em avaliacoes_matriz ─────────────────────────
--    Adiciona: orcamento, redes_sociais, tarefa_treinamento_vendas,
--              tarefa_treinamento_ia, tarefa_apresentacao.
--    Mantém legados (pedido_venda, ferias, requerimento, treinamento)
--    no CHECK — histórico continua íntegro, some da UI.
ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS avaliacoes_matriz_item_tipo_check;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT avaliacoes_matriz_item_tipo_check
  CHECK (item_tipo IN (
    'requisicao','cotacao','promocao','arte','campanha',
    'pedido_venda','ferias','requerimento',
    'cadastro_produto','cadastro_cliente','cadastro_fornecedor',
    'cadastro_servico','cadastro_categoria',
    'conta_pagar','conta_receber',
    'treinamento','frequencia_trabalho','avaliacao_desempenho',
    'orcamento','redes_sociais',
    'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao'
  ));

-- 3. Expande chk_nota_apenas_criativos ──────────────────────────────
--    Notas 0-10 agora valem em: arte/promocao/campanha/redes_sociais +
--    3 tipos de tarefa da Matriz. Demais continuam nota=null.
ALTER TABLE public.avaliacoes_matriz
  DROP CONSTRAINT IF EXISTS chk_nota_apenas_criativos;

ALTER TABLE public.avaliacoes_matriz
  ADD CONSTRAINT chk_nota_apenas_criativos CHECK (
    nota IS NULL OR item_tipo IN (
      'arte','promocao','campanha','redes_sociais',
      'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao'
    )
  );

-- 4. Tarefas da Matriz — tabelas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matriz_tarefas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES public.competicoes_matriz(id) ON DELETE CASCADE,
  tipo           text NOT NULL CHECK (tipo IN (
                    'tarefa_treinamento_vendas',
                    'tarefa_treinamento_ia',
                    'tarefa_apresentacao'
                  )),
  nome           text NOT NULL,
  descricao      text,
  data           date NOT NULL,
  criado_por     uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  ativo          boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_matriz_tarefas_comp
  ON public.matriz_tarefas (competicao_id, tipo) WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.matriz_tarefa_participantes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id         uuid NOT NULL REFERENCES public.matriz_tarefas(id) ON DELETE CASCADE,
  funcionario_id    uuid REFERENCES public.funcionarios(id) ON DELETE SET NULL,
  nome_snapshot     text NOT NULL,
  filial            text NOT NULL CHECK (filial IN ('SuperMax','MaxLook','TechMax')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  ativo             boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tarefa_participante
  ON public.matriz_tarefa_participantes (tarefa_id, funcionario_id)
  WHERE ativo = true AND funcionario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tarefa_participantes_tarefa
  ON public.matriz_tarefa_participantes (tarefa_id) WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_tarefa_participantes_filial
  ON public.matriz_tarefa_participantes (filial) WHERE ativo = true;

-- Trigger updated_at pras tarefas
CREATE OR REPLACE FUNCTION public.trg_matriz_tarefas_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_matriz_tarefas_upd ON public.matriz_tarefas;
CREATE TRIGGER trg_matriz_tarefas_upd
  BEFORE UPDATE ON public.matriz_tarefas
  FOR EACH ROW EXECUTE FUNCTION public.trg_matriz_tarefas_updated_at();

-- 5. RLS — só admin/CEO/conselheiro (Matriz) ────────────────────────
ALTER TABLE public.matriz_tarefas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matriz_tarefa_participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mt_tarefas_select" ON public.matriz_tarefas;
CREATE POLICY "mt_tarefas_select" ON public.matriz_tarefas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND filial = 'Matriz'
        AND (role IN ('admin','ceo','conselheiro')
             OR (role = 'gerente' AND is_conselheiro = true))
    )
  );

-- Escritas só via RPC
DROP POLICY IF EXISTS "mt_tarefas_ins" ON public.matriz_tarefas;
DROP POLICY IF EXISTS "mt_tarefas_upd" ON public.matriz_tarefas;
DROP POLICY IF EXISTS "mt_tarefas_del" ON public.matriz_tarefas;
CREATE POLICY "mt_tarefas_ins" ON public.matriz_tarefas FOR INSERT WITH CHECK (false);
CREATE POLICY "mt_tarefas_upd" ON public.matriz_tarefas FOR UPDATE USING (false);
CREATE POLICY "mt_tarefas_del" ON public.matriz_tarefas FOR DELETE USING (false);

DROP POLICY IF EXISTS "mt_part_select" ON public.matriz_tarefa_participantes;
CREATE POLICY "mt_part_select" ON public.matriz_tarefa_participantes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND filial = 'Matriz'
        AND (role IN ('admin','ceo','conselheiro')
             OR (role = 'gerente' AND is_conselheiro = true))
    )
  );
DROP POLICY IF EXISTS "mt_part_ins" ON public.matriz_tarefa_participantes;
DROP POLICY IF EXISTS "mt_part_upd" ON public.matriz_tarefa_participantes;
DROP POLICY IF EXISTS "mt_part_del" ON public.matriz_tarefa_participantes;
CREATE POLICY "mt_part_ins" ON public.matriz_tarefa_participantes FOR INSERT WITH CHECK (false);
CREATE POLICY "mt_part_upd" ON public.matriz_tarefa_participantes FOR UPDATE USING (false);
CREATE POLICY "mt_part_del" ON public.matriz_tarefa_participantes FOR DELETE USING (false);

-- 6. RPC criar tarefa da Matriz + participantes ─────────────────────
CREATE OR REPLACE FUNCTION public.criar_matriz_tarefa(
  p_competicao_id uuid,
  p_tipo          text,
  p_nome          text,
  p_descricao     text,
  p_data          date,
  p_participantes jsonb  -- [{ funcionario_id, nome, filial }, ...]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_role   text;
  v_filial text;
  v_cons   boolean;
  v_tarefa uuid;
  v_p      jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro INTO v_role, v_filial, v_cons
    FROM user_profiles WHERE id = v_user;

  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role IN ('admin','ceo','conselheiro') OR (v_role='gerente' AND v_cons))
  THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro da Matriz cria tarefa' USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN ('tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO matriz_tarefas (competicao_id, tipo, nome, descricao, data, criado_por)
  VALUES (p_competicao_id, p_tipo, p_nome, NULLIF(p_descricao,''), p_data, v_user)
  RETURNING id INTO v_tarefa;

  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes,'[]'::jsonb))
  LOOP
    INSERT INTO matriz_tarefa_participantes (tarefa_id, funcionario_id, nome_snapshot, filial)
    VALUES (
      v_tarefa,
      NULLIF(v_p->>'funcionario_id','')::uuid,
      COALESCE(v_p->>'nome',''),
      v_p->>'filial'
    );
  END LOOP;

  RETURN v_tarefa;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_matriz_tarefa(uuid,text,text,text,date,jsonb) TO authenticated;

-- 7. RPC remover tarefa (soft delete admin/CEO) ─────────────────────
CREATE OR REPLACE FUNCTION public.remover_matriz_tarefa(p_tarefa_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role text;
  v_filial text;
BEGIN
  SELECT role, filial INTO v_role, v_filial
    FROM user_profiles WHERE id = auth.uid();
  IF v_filial IS DISTINCT FROM 'Matriz' OR v_role NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO remove tarefa' USING ERRCODE = '42501';
  END IF;
  UPDATE matriz_tarefas SET ativo = false, updated_at = now()
   WHERE id = p_tarefa_id;
  UPDATE matriz_tarefa_participantes SET ativo = false
   WHERE tarefa_id = p_tarefa_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.remover_matriz_tarefa(uuid) TO authenticated;

-- 8. Placar reescrito com 7 dimensões ───────────────────────────────
--    Marketing agora inclui redes_sociais (média de notas × 10).
--    Vendas passa a olhar orcamento (% aprovação).
--    Nova dim `matriz` = média de notas × 10 dos participantes por filial.
--
--    Legados (pedido_venda/treinamento/ferias/requerimento) somem do placar
--    mas ficam íntegros na tabela.
CREATE OR REPLACE FUNCTION public.calcular_placar_competicao(
  p_competicao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp   competicoes_matriz;
  v_kpis   jsonb;
  v_scores jsonb;
  v_origem jsonb;
BEGIN
  SELECT * INTO v_comp FROM competicoes_matriz WHERE id = p_competicao_id AND ativo = true;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;

  WITH filiais AS (SELECT unnest(ARRAY['SuperMax','MaxLook','TechMax']) AS filial),
  marketing AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('arte','promocao','campanha','redes_sociais')), 0) AS valor,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('arte','promocao','campanha','redes_sociais')), 0) AS n
    FROM filiais f
  ),
  vendas AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND item_tipo = 'orcamento'), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND item_tipo = 'orcamento'), 0) AS n
    FROM filiais f
  ),
  compras AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('requisicao','cotacao')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('requisicao','cotacao')), 0) AS n
    FROM filiais f
  ),
  rh AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('frequencia_trabalho','avaliacao_desempenho')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('frequencia_trabalho','avaliacao_desempenho')), 0) AS n
    FROM filiais f
  ),
  cadastros AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo LIKE 'cadastro_%'), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo LIKE 'cadastro_%'), 0) AS n
    FROM filiais f
  ),
  financeiro AS (
    SELECT f.filial,
      COALESCE((SELECT ROUND(
                    100.0 * COUNT(*) FILTER (WHERE decisao='Aprovado')
                    / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0), 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('conta_pagar','conta_receber')), 0) AS valor,
      COALESCE((SELECT COUNT(*) FILTER (WHERE decisao IS NOT NULL)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial
                   AND item_tipo IN ('conta_pagar','conta_receber')), 0) AS n
    FROM filiais f
  ),
  matriz AS (
    -- Tarefas da Matriz: nota 0-10 do conselho por participante. Filial =
    -- filial do participante. valor = média × 10 (mesma escala do marketing).
    SELECT f.filial,
      COALESCE((SELECT ROUND(AVG(nota) * 10, 2)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao')), 0) AS valor,
      COALESCE((SELECT COUNT(*)
                  FROM avaliacoes_matriz
                 WHERE competicao_id = p_competicao_id AND ativo = true
                   AND filial_avaliada = f.filial AND nota IS NOT NULL
                   AND item_tipo IN ('tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao')), 0) AS n
    FROM filiais f
  )
  SELECT jsonb_build_object(
    'marketing',  jsonb_object_agg(m.filial,  m.v),
    'vendas',     jsonb_object_agg(v.filial,  v.v),
    'compras',    jsonb_object_agg(c.filial,  c.v),
    'rh',         jsonb_object_agg(r.filial,  r.v),
    'cadastros',  jsonb_object_agg(cd.filial, cd.v),
    'financeiro', jsonb_object_agg(fi.filial, fi.v),
    'matriz',     jsonb_object_agg(mz.filial, mz.v)
  ) INTO v_kpis
  FROM      (SELECT filial, valor AS v FROM marketing)  m
  FULL JOIN (SELECT filial, valor AS v FROM vendas)      v  USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM compras)     c  USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM rh)          r  USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM cadastros)   cd USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM financeiro)  fi USING (filial)
  FULL JOIN (SELECT filial, valor AS v FROM matriz)      mz USING (filial);

  SELECT jsonb_build_object(
    'marketing',  CASE WHEN (SELECT SUM(n) FROM marketing)  > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'vendas',     CASE WHEN (SELECT SUM(n) FROM vendas)     > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'compras',    CASE WHEN (SELECT SUM(n) FROM compras)    > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'rh',         CASE WHEN (SELECT SUM(n) FROM rh)         > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'cadastros',  CASE WHEN (SELECT SUM(n) FROM cadastros)  > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'financeiro', CASE WHEN (SELECT SUM(n) FROM financeiro) > 0 THEN 'julgada' ELSE 'sem_julgamento' END,
    'matriz',     CASE WHEN (SELECT SUM(n) FROM matriz)     > 0 THEN 'julgada' ELSE 'sem_julgamento' END
  ) INTO v_origem
  FROM (SELECT 1) x
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM marketing)  mkt ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM vendas)     ven ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM compras)    com ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM rh)         rrh ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM cadastros)  cad ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM financeiro) fin ON true
  LEFT JOIN LATERAL (SELECT SUM(n) AS n FROM matriz)     mtz ON true;

  WITH dims AS (
    SELECT d.dim, d.peso FROM (VALUES
      ('marketing',  COALESCE((v_comp.pesos->>'marketing')::numeric,  0)),
      ('vendas',     COALESCE((v_comp.pesos->>'vendas')::numeric,     0)),
      ('compras',    COALESCE((v_comp.pesos->>'compras')::numeric,    0)),
      ('rh',         COALESCE((v_comp.pesos->>'rh')::numeric,         0)),
      ('cadastros',  COALESCE((v_comp.pesos->>'cadastros')::numeric,  0)),
      ('financeiro', COALESCE((v_comp.pesos->>'financeiro')::numeric, 0)),
      ('matriz',     COALESCE((v_comp.pesos->>'matriz')::numeric,     0))
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
    'dims_origem', v_origem,
    'placar',      v_scores
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_competicao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_competicao(uuid) TO authenticated;

-- 9. criar_competicao + atualizar_pesos_competicao — 7 chaves ───────
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

  IF NOT (p_pesos ? 'marketing' AND p_pesos ? 'vendas' AND p_pesos ? 'compras'
          AND p_pesos ? 'rh' AND p_pesos ? 'cadastros' AND p_pesos ? 'financeiro'
          AND p_pesos ? 'matriz') THEN
    RAISE EXCEPTION 'Pesos exigem chaves: marketing, vendas, compras, rh, cadastros, financeiro, matriz'
      USING ERRCODE = 'P0001';
  END IF;

  v_soma := (p_pesos->>'marketing')::numeric + (p_pesos->>'vendas')::numeric
          + (p_pesos->>'compras')::numeric + (p_pesos->>'rh')::numeric
          + (p_pesos->>'cadastros')::numeric + (p_pesos->>'financeiro')::numeric
          + (p_pesos->>'matriz')::numeric;
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

CREATE OR REPLACE FUNCTION public.atualizar_pesos_competicao(
  p_competicao_id uuid,
  p_pesos         jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_soma   numeric;
  v_status text;
BEGIN
  IF auth_user_role() NOT IN ('admin','ceo') THEN
    RAISE EXCEPTION 'Apenas admin/CEO pode editar pesos' USING ERRCODE = '42501';
  END IF;

  IF NOT (p_pesos ? 'marketing' AND p_pesos ? 'vendas' AND p_pesos ? 'compras'
          AND p_pesos ? 'rh' AND p_pesos ? 'cadastros' AND p_pesos ? 'financeiro'
          AND p_pesos ? 'matriz') THEN
    RAISE EXCEPTION 'Pesos exigem chaves: marketing, vendas, compras, rh, cadastros, financeiro, matriz'
      USING ERRCODE = 'P0001';
  END IF;

  v_soma := (p_pesos->>'marketing')::numeric + (p_pesos->>'vendas')::numeric
          + (p_pesos->>'compras')::numeric + (p_pesos->>'rh')::numeric
          + (p_pesos->>'cadastros')::numeric + (p_pesos->>'financeiro')::numeric
          + (p_pesos->>'matriz')::numeric;
  IF v_soma <> 100 THEN
    RAISE EXCEPTION 'Soma dos pesos deve ser 100 (recebido: %)', v_soma USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'em_andamento' THEN
    RAISE EXCEPTION 'Pesos só podem ser editados durante a competição (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE competicoes_matriz
     SET pesos = p_pesos, updated_at = now()
   WHERE id = p_competicao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_pesos_competicao(uuid, jsonb) TO authenticated;

-- 10. Retro-fit: competições em andamento sem chave 'matriz' ────────
--     Injeta matriz=0 pra não quebrar o CHECK das RPCs quando um admin
--     editar pesos depois. Soma continua 100 no legado.
UPDATE public.competicoes_matriz
   SET pesos = pesos || jsonb_build_object('matriz', 0)
 WHERE ativo = true
   AND NOT (pesos ? 'matriz');

COMMIT;

NOTIFY pgrst, 'reload schema';
