-- =================================================================
-- Avaliações da Matriz — julgamento paralelo do conselho durante
-- uma competicoes_matriz. Não interfere no fluxo operacional das
-- filiais; serve como camada de avaliação para pontuar as 3 filiais.
--
-- Regras:
--   • Avaliadores = CEO + 2 conselheiros (filial='Matriz'). Admin NÃO
--     avalia (tem só leitura). Gerente com is_conselheiro=true também
--     conta como conselheiro.
--   • Decisão: 'Aprovado' | 'Reprovado' | null.
--   • Nota: 0-10, aplicável só a tipos criativos (arte, promocao,
--     campanha). Demais tipos precisam de nota=null.
--   • UPSERT por (competicao_id, item_tipo, item_id, avaliador_id):
--     nova submissão do mesmo avaliador sobrescreve a anterior.
--   • Média final por item = soma das 3 notas / 3 (pesos iguais).
--     Enquanto n<3, é parcial.
-- =================================================================

BEGIN;

-- 1. Tabela ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.avaliacoes_matriz (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES public.competicoes_matriz(id) ON DELETE CASCADE,
  filial_avaliada text NOT NULL CHECK (filial_avaliada IN ('SuperMax','MaxLook','TechMax')),
  item_tipo      text NOT NULL CHECK (item_tipo IN (
                    'requisicao','cotacao','promocao','arte','campanha',
                    'pedido_venda','ferias','requerimento'
                  )),
  item_id        uuid NOT NULL,
  avaliador_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decisao        text CHECK (decisao IS NULL OR decisao IN ('Aprovado','Reprovado')),
  nota           numeric(4,2) CHECK (nota IS NULL OR (nota >= 0 AND nota <= 10)),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  ativo          boolean NOT NULL DEFAULT true,

  -- Nota só faz sentido em tipos criativos
  CONSTRAINT chk_nota_apenas_criativos CHECK (
    nota IS NULL OR item_tipo IN ('arte','promocao','campanha')
  ),
  -- Pelo menos uma coisa foi avaliada
  CONSTRAINT chk_algo_avaliado CHECK (
    decisao IS NOT NULL OR nota IS NOT NULL OR comentario IS NOT NULL
  )
);

-- Um par (item, avaliador) só existe uma vez (dentro da competição)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_aval_par
  ON public.avaliacoes_matriz (competicao_id, item_tipo, item_id, avaliador_id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_aval_competicao
  ON public.avaliacoes_matriz (competicao_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_aval_filial
  ON public.avaliacoes_matriz (competicao_id, filial_avaliada) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_aval_item
  ON public.avaliacoes_matriz (item_tipo, item_id) WHERE ativo = true;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.trg_aval_matriz_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_aval_matriz_updated_at ON public.avaliacoes_matriz;
CREATE TRIGGER trg_aval_matriz_updated_at
  BEFORE UPDATE ON public.avaliacoes_matriz
  FOR EACH ROW EXECUTE FUNCTION public.trg_aval_matriz_updated_at();

-- 2. RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.avaliacoes_matriz ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aval_matriz_select"  ON public.avaliacoes_matriz;
DROP POLICY IF EXISTS "aval_matriz_insert"  ON public.avaliacoes_matriz;
DROP POLICY IF EXISTS "aval_matriz_update"  ON public.avaliacoes_matriz;
DROP POLICY IF EXISTS "aval_matriz_delete"  ON public.avaliacoes_matriz;

-- Leitura: admin/CEO/conselheiro em Matriz (admin lê mas não escreve)
CREATE POLICY "aval_matriz_select" ON public.avaliacoes_matriz
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND filial = 'Matriz'
        AND (
          role IN ('admin','ceo','conselheiro')
          OR (role = 'gerente' AND is_conselheiro = true)
        )
    )
  );

-- Escrita: só via RPC (que valida avaliador é CEO ou conselheiro em Matriz)
-- Bloqueia acesso direto — força passar pela RPC.
CREATE POLICY "aval_matriz_insert" ON public.avaliacoes_matriz
  FOR INSERT WITH CHECK (false);
CREATE POLICY "aval_matriz_update" ON public.avaliacoes_matriz
  FOR UPDATE USING (false);
CREATE POLICY "aval_matriz_delete" ON public.avaliacoes_matriz
  FOR DELETE USING (false);

-- 3. RPC de upsert ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avaliar_item_matriz(
  p_competicao_id  uuid,
  p_filial_avaliada text,
  p_item_tipo      text,
  p_item_id        uuid,
  p_decisao        text DEFAULT NULL,
  p_nota           numeric DEFAULT NULL,
  p_comentario     text  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role    text;
  v_filial  text;
  v_is_cons boolean;
  v_id      uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT role, filial, is_conselheiro
    INTO v_role, v_filial, v_is_cons
  FROM public.user_profiles WHERE id = v_user_id;

  -- Só CEO ou conselheiro (puro/gerente+is_conselheiro) em Matriz.
  -- Admin não avalia (tem só leitura).
  IF v_filial IS DISTINCT FROM 'Matriz'
     OR NOT (v_role = 'ceo' OR v_role = 'conselheiro' OR (v_role='gerente' AND v_is_cons))
  THEN
    RAISE EXCEPTION 'Apenas CEO e conselheiros da Matriz podem avaliar' USING ERRCODE = '42501';
  END IF;

  -- Competição precisa existir e estar em andamento
  IF NOT EXISTS (
    SELECT 1 FROM public.competicoes_matriz
    WHERE id = p_competicao_id AND ativo = true AND status = 'em_andamento'
  ) THEN
    RAISE EXCEPTION 'Competição não está em andamento' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.avaliacoes_matriz (
    competicao_id, filial_avaliada, item_tipo, item_id,
    avaliador_id, decisao, nota, comentario
  )
  VALUES (
    p_competicao_id, p_filial_avaliada, p_item_tipo, p_item_id,
    v_user_id, p_decisao, p_nota, p_comentario
  )
  ON CONFLICT (competicao_id, item_tipo, item_id, avaliador_id)
    WHERE ativo = true
  DO UPDATE SET
    decisao    = EXCLUDED.decisao,
    nota       = EXCLUDED.nota,
    comentario = EXCLUDED.comentario,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.avaliar_item_matriz(uuid,text,text,uuid,text,numeric,text) TO authenticated;

-- 4. View agregada por item (média + contagem de decisões) ──────────
CREATE OR REPLACE VIEW public.avaliacoes_matriz_agregado AS
SELECT
  competicao_id,
  filial_avaliada,
  item_tipo,
  item_id,
  COUNT(*) FILTER (WHERE nota IS NOT NULL)::int             AS n_notas,
  ROUND(AVG(nota) FILTER (WHERE nota IS NOT NULL), 2)        AS media_nota,
  COUNT(*) FILTER (WHERE decisao = 'Aprovado')::int          AS n_aprovado,
  COUNT(*) FILTER (WHERE decisao = 'Reprovado')::int         AS n_reprovado,
  COUNT(*)::int                                              AS n_total_avaliadores,
  MAX(updated_at)                                            AS ultima_atualizacao
FROM public.avaliacoes_matriz
WHERE ativo = true
GROUP BY competicao_id, filial_avaliada, item_tipo, item_id;

GRANT SELECT ON public.avaliacoes_matriz_agregado TO authenticated;

-- 5. Placar do conselho por filial (na competição corrente) ─────────
--    Uso pra derivar KPIs "% aprovação do conselho" e "média de notas"
--    consumidos pela Central de Avaliação e (em migração futura) pelo
--    calcular_placar_competicao.
CREATE OR REPLACE VIEW public.avaliacoes_matriz_placar_filial AS
SELECT
  competicao_id,
  filial_avaliada,
  ROUND(AVG(nota) FILTER (WHERE nota IS NOT NULL), 2) AS media_nota_geral,
  COUNT(*) FILTER (WHERE decisao = 'Aprovado')::int   AS itens_aprovados,
  COUNT(*) FILTER (WHERE decisao = 'Reprovado')::int  AS itens_reprovados,
  CASE
    WHEN COUNT(*) FILTER (WHERE decisao IS NOT NULL) = 0 THEN NULL
    ELSE ROUND(
      100.0 * COUNT(*) FILTER (WHERE decisao = 'Aprovado')
      / NULLIF(COUNT(*) FILTER (WHERE decisao IS NOT NULL), 0),
    2)
  END AS taxa_aprovacao_pct
FROM public.avaliacoes_matriz
WHERE ativo = true
GROUP BY competicao_id, filial_avaliada;

GRANT SELECT ON public.avaliacoes_matriz_placar_filial TO authenticated;

COMMIT;
