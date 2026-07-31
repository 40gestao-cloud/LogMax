-- 316_20260730_fix_abrir_vaga_interna_duplicada.sql
--
-- CORREÇÃO DA 315. Erro meu, e do tipo que só aparece em runtime.
--
-- A 315 dropou a assinatura de 8 argumentos de `abrir_vaga_interna` — a que a
-- 312 criou — sem notar que a 313 já a havia substituído por uma de 9 (com
-- `p_nota_minima`). O DROP virou no-op e o banco ficou com DUAS funções:
--
--   abrir_vaga_interna(text,text,text,text,text,integer,numeric,numeric,numeric)
--   abrir_vaga_interna(text,text,text,text,text,integer,numeric,numeric,numeric,text)
--
-- Para o PostgREST isso é função sobrecarregada, e sobrecarga ele recusa
-- (PGRST203) — em vez de escolher a errada, não chama nenhuma. Abrir vaga
-- interna está quebrado nas 4 turmas desde a aplicação da 315.
--
-- Aqui o DROP é escrito pelo `regprocedure` exato, para não errar de novo por
-- contagem de argumento, e a verificação no fim é obrigatória.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DROP FUNCTION IF EXISTS public.abrir_vaga_interna(
  text, text, text, text, text, integer, numeric, numeric, numeric
);

-- Trava de segurança: se por qualquer motivo sobrar mais de uma, aborta a
-- transação em vez de deixar o PostgREST mudo de novo.
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'abrir_vaga_interna';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 abrir_vaga_interna, encontrei %. Confira pg_proc antes de seguir.', v_n;
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   SELECT oid::regprocedure::text FROM pg_proc WHERE proname = 'abrir_vaga_interna';
--   -- Deve devolver exatamente 1 linha, a de 10 argumentos (com p_role_alvo).
-- =================================================================
