-- =================================================================
-- 385 — Matriz de riscos: o que pode dar errado tem dono e prazo.
--
-- Item #G8 do backlog de governança, e o que fecha o bloco.
--
-- O buraco: o ERP inteiro registra o que já aconteceu — venda, conta,
-- ponto, parecer. Nada registra o que ainda não aconteceu e vai doer se
-- acontecer. Conselho que só olha para trás é auditoria; olhar para a
-- frente é o outro metade do trabalho.
--
-- Decisões que valem estar escritas:
--   • Probabilidade e impacto de 1 a 5, severidade = produto (coluna
--     GERADA). Ninguém digita severidade: nota derivada que se digita
--     vira nota inventada.
--   • Todo risco tem DONO. Risco sem dono é conversa — o dono é quem
--     responde pela mitigação e quem o Conselho chama na revisão.
--   • A revisão é append-only (`risco_revisoes`) e é ela que move
--     probabilidade/impacto. Ver a nota cair de 20 para 6 ao longo de
--     três ciclos é o gráfico que ensina o que é gestão de risco; um
--     UPDATE silencioso apaga exatamente isso.
--   • 'aceito' é desfecho legítimo e existe de propósito: nem todo risco
--     se mitiga, e assumir um risco conscientemente é decisão de
--     Conselho — diferente de esquecer dele.
--   • Recorte por filial na leitura: o gerente vê os riscos da unidade
--     dele e os corporativos (filial 'Matriz'); a Matriz vê todos.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Riscos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.riscos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         text NOT NULL,
  descricao      text,
  categoria      text NOT NULL DEFAULT 'Operacional'
                   CHECK (categoria IN ('Operacional','Financeiro','Pessoas','Imagem','Tecnologia','Legal')),
  filial         text NOT NULL DEFAULT 'Matriz'
                   CHECK (filial IN ('SuperMax','MaxLook','TechMax','Matriz')),
  dono_id        uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  dono_nome      text,
  probabilidade  int NOT NULL DEFAULT 3 CHECK (probabilidade BETWEEN 1 AND 5),
  impacto        int NOT NULL DEFAULT 3 CHECK (impacto BETWEEN 1 AND 5),
  severidade     int GENERATED ALWAYS AS (probabilidade * impacto) STORED,
  mitigacao      text,
  prazo          date,
  status         text NOT NULL DEFAULT 'aberto'
                   CHECK (status IN ('aberto','mitigando','aceito','encerrado')),
  revisado_em    timestamptz,
  ativo          boolean NOT NULL DEFAULT true,
  criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.riscos.severidade IS
  'Coluna GERADA (probabilidade x impacto). Nota derivada que se digita vira nota inventada.';
COMMENT ON COLUMN public.riscos.dono_id IS
  'Quem responde pela mitigacao. Risco sem dono e conversa — por isso NOT NULL.';

CREATE INDEX IF NOT EXISTS idx_riscos_filial ON public.riscos (filial, status);
CREATE INDEX IF NOT EXISTS idx_riscos_dono   ON public.riscos (dono_id);

CREATE TABLE IF NOT EXISTS public.risco_revisoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risco_id      uuid NOT NULL REFERENCES public.riscos(id) ON DELETE CASCADE,
  probabilidade int NOT NULL CHECK (probabilidade BETWEEN 1 AND 5),
  impacto       int NOT NULL CHECK (impacto BETWEEN 1 AND 5),
  status        text NOT NULL CHECK (status IN ('aberto','mitigando','aceito','encerrado')),
  parecer       text,
  revisor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revisor_nome  text,
  revisado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.risco_revisoes IS
  'Append-only. Ver a severidade cair ao longo dos ciclos e o que ensina gestao de risco; UPDATE silencioso apaga isso.';

CREATE INDEX IF NOT EXISTS idx_risco_revisoes_risco ON public.risco_revisoes (risco_id, revisado_em DESC);

ALTER TABLE public.riscos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risco_revisoes ENABLE ROW LEVEL SECURITY;

-- Leitura: a unidade vê o que é dela e o que é corporativo; a Matriz vê tudo.
-- O dono sempre vê o próprio risco, esteja onde estiver.
DROP POLICY IF EXISTS riscos_read ON public.riscos;
CREATE POLICY riscos_read ON public.riscos
  FOR SELECT TO authenticated
  USING (
    COALESCE(auth_is_admin(), false)
    OR dono_id = auth.uid()
    OR filial = 'Matriz'
    OR filial = (SELECT u.filial FROM user_profiles u WHERE u.id = auth.uid())
  );

-- Escrita direta é do Conselho. O dono mexe na mitigação pela RPC, que é
-- onde a régua de quem-pode-o-quê está escrita.
DROP POLICY IF EXISTS riscos_write ON public.riscos;
CREATE POLICY riscos_write ON public.riscos
  FOR ALL TO authenticated
  USING (COALESCE(auth_is_admin(), false) AND COALESCE(NOT auth_desligado(), false))
  WITH CHECK (COALESCE(auth_is_admin(), false));

DROP POLICY IF EXISTS risco_revisoes_read ON public.risco_revisoes;
CREATE POLICY risco_revisoes_read ON public.risco_revisoes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM riscos r WHERE r.id = risco_id));

-- Trilha de auditoria (migr. 331/332).
DROP TRIGGER IF EXISTS trg_historico ON public.riscos;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.riscos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'probabilidade', 'impacto', 'dono_nome', 'prazo');

-- ── 2. Revisar ────────────────────────────────────────────────────
-- Conselho revisa qualquer risco; o dono revisa o próprio. Ninguém mais.
CREATE OR REPLACE FUNCTION public.revisar_risco(
  p_risco_id      uuid,
  p_probabilidade int,
  p_impacto       int,
  p_status        text,
  p_parecer       text DEFAULT NULL,
  p_mitigacao     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_r     riscos;
  v_ator  text;
  v_admin boolean := COALESCE(auth_is_admin(), false);
BEGIN
  SELECT * INTO v_r FROM riscos WHERE id = p_risco_id AND ativo = true;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Risco não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (v_admin OR v_r.dono_id = auth.uid()) THEN
    RAISE EXCEPTION 'Revisão é do Conselho ou do dono do risco.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(auth_desligado(), false) THEN
    RAISE EXCEPTION 'Sessão sem permissão.' USING ERRCODE = '42501';
  END IF;

  -- COALESCE porque NULL em `NOT BETWEEN` devolve NULL e o IF não dispara —
  -- o guard passaria batido e o erro só apareceria no NOT NULL do INSERT.
  IF COALESCE(p_probabilidade, 0) NOT BETWEEN 1 AND 5
     OR COALESCE(p_impacto, 0) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Probabilidade e impacto vão de 1 a 5.' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('aberto','mitigando','aceito','encerrado') THEN
    RAISE EXCEPTION 'Status inválido.' USING ERRCODE = 'P0001';
  END IF;

  -- Aceitar um risco é decisão de Conselho: o dono pode trabalhar nele e
  -- pode dizer que acabou, mas não pode assinar embaixo de conviver com ele.
  IF p_status = 'aceito' AND NOT v_admin THEN
    RAISE EXCEPTION 'Só o Conselho aceita conviver com um risco.' USING ERRCODE = '42501';
  END IF;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();

  INSERT INTO risco_revisoes
    (risco_id, probabilidade, impacto, status, parecer, revisor_id, revisor_nome)
  VALUES
    (p_risco_id, p_probabilidade, p_impacto, p_status,
     NULLIF(btrim(COALESCE(p_parecer,'')), ''), auth.uid(), v_ator);

  UPDATE riscos
     SET probabilidade = p_probabilidade,
         impacto       = p_impacto,
         status        = p_status,
         mitigacao     = COALESCE(NULLIF(btrim(COALESCE(p_mitigacao,'')), ''), mitigacao),
         revisado_em   = now(),
         updated_at    = now()
   WHERE id = p_risco_id;

  RETURN jsonb_build_object('sucesso', true, 'severidade', p_probabilidade * p_impacto);
END;
$$;

REVOKE ALL ON FUNCTION public.revisar_risco(uuid,int,int,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revisar_risco(uuid,int,int,text,text,text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) anon fora:
-- SELECT has_function_privilege('anon', 'public.revisar_risco(uuid,int,int,text,text,text)', 'EXECUTE');
--
-- 2) Severidade é derivada — tentar escrever deve falhar:
-- UPDATE riscos SET severidade = 1;   -- esperado: erro 428C9
--
-- 3) Mapa de calor do Conselho:
-- SELECT filial, titulo, probabilidade, impacto, severidade, status, dono_nome
--   FROM riscos WHERE ativo ORDER BY severidade DESC;
--
-- 4) A revisão é a história, não o estado:
-- SELECT r.titulo, rv.revisado_em, rv.probabilidade, rv.impacto,
--        rv.probabilidade * rv.impacto AS severidade, rv.status, rv.revisor_nome
--   FROM risco_revisoes rv JOIN riscos r ON r.id = rv.risco_id
--  ORDER BY r.titulo, rv.revisado_em;
