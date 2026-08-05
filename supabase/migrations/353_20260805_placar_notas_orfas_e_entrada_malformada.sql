-- =================================================================
-- 353 — Duas correções no que alimenta o placar. Revisão pós-349/350.
--
-- 1) NOTA ÓRFÃ INFLANDO O PLACAR
--    `calcular_placar_competicao` soma `avaliacoes_matriz` por
--    competição e item_tipo, SEM olhar se o participante ou a tarefa
--    ainda existem. Até a 348, remover uma tarefa só inativava tarefa
--    e participantes — as notas ficavam ativas e continuavam pesando,
--    embora o diálogo de remoção prometesse "somem do placar ativo".
--    A 348 passou a inativar as notas junto, mas o que foi removido
--    ANTES dela segue no placar. Este backfill fecha a conta.
--
--    Fica só o backfill: a origem já foi corrigida na 348, e amarrar
--    a soma do placar a um JOIN com participante ativo mudaria também
--    o histórico congelado em placar_snapshot.
--
-- 2) ENTRADA MALFORMADA DERRUBANDO O CÁLCULO INTEIRO
--    `_freq_credito_dia` (350) faz `p_entrada::time` pra decidir
--    atraso. `entrada` é text: uma linha com '' ou lixo levanta
--    exceção e, como a função roda dentro do placar, derruba o placar
--    das TRÊS filiais — não só o dia estragado. Passa a classificar
--    como atraso apenas o que casa com HH:MM; o resto conta presença
--    cheia, que é o comportamento seguro (não inventa punição).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Notas de tarefa/participante removidos saem do placar ──────
UPDATE public.avaliacoes_matriz am
   SET ativo = false, updated_at = now()
 WHERE am.ativo = true
   AND am.item_tipo LIKE 'tarefa\_%'
   AND NOT EXISTS (
     SELECT 1
       FROM public.matriz_tarefa_participantes p
       JOIN public.matriz_tarefas t ON t.id = p.tarefa_id
      WHERE p.id = am.item_id
        AND p.ativo = true
        AND t.ativo = true
   );

-- ── 2. Crédito do dia tolera entrada fora do formato ──────────────
CREATE OR REPLACE FUNCTION public._freq_credito_dia(
  p_status  text,
  p_entrada text,
  p_target  time,
  p_tol     integer
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_status,'Normal') = 'Justificado' THEN NULL   -- fora do denominador
    WHEN p_status = 'Falta' THEN 0
    -- Sem alvo confirmado (ponto_jornada.configurado = false) o atraso
    -- não é classificável: vale presença cheia.
    WHEN p_target IS NULL OR p_entrada IS NULL THEN 1
    -- Entrada fora de HH:MM (vazio, lixo de importação) também vale
    -- presença cheia: o cast quebraria o placar inteiro por causa de
    -- uma linha, e punir por dado ruim é pior que não punir.
    WHEN p_entrada !~ '^[0-9]{1,2}:[0-9]{2}' THEN 1
    WHEN p_entrada::time > p_target + make_interval(mins => COALESCE(p_tol,0)) THEN 0.5
    ELSE 1
  END;
$$;

REVOKE ALL ON FUNCTION public._freq_credito_dia(text, text, time, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._freq_credito_dia(text, text, time, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
