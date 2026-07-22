-- =================================================================
-- Avaliações Padrão — RPC pra pódio das filiais no card da filial.
--
-- Espelha `calcular_placar_competicao`, mas para o ciclo padrão
-- (ciclos_avaliacao). Roda em modo filial: RLS de `avaliacoes`
-- esconde linhas de outras filiais do usuário, então o cliente não
-- consegue calcular médias comparativas direto — precisamos de
-- SECURITY DEFINER que devolva só agregados (média + n) por filial,
-- sem vazar linhas individuais.
--
-- Fonte:
--   • Último ciclo COM status='Fechado' (data_fim desc).
--   • Notas cujo avaliador é Admin ou CEO (role='admin' ou 'ceo').
--     Conselheiro, gerente e colaborador ficam fora — no ciclo Padrão
--     só admin/CEO avaliam gerentes/colaboradores.
--   • Avaliado com filial IN ('SuperMax','MaxLook','TechMax') —
--     Matriz não compete.
--
-- Retorno (jsonb):
--   { ciclo_id, ciclo_nome, data_fim, por_filial:
--       { SuperMax:{media,n}, MaxLook:{media,n}, TechMax:{media,n} } }
--   Se nenhum ciclo fechado existe → NULL (front esconde o card).
--
-- Idempotente (CREATE OR REPLACE).
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.calcular_placar_padrao()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ciclo record;
  v_por_filial jsonb;
BEGIN
  SELECT id, nome, data_fim
    INTO v_ciclo
    FROM public.ciclos_avaliacao
   WHERE status = 'Fechado'
   ORDER BY data_fim DESC, created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
           jsonb_object_agg(
             filial,
             jsonb_build_object('media', ROUND(media::numeric, 2), 'n', n)
           ),
           '{}'::jsonb
         )
    INTO v_por_filial
    FROM (
      SELECT up.filial AS filial,
             AVG(c.nota)::numeric AS media,
             COUNT(c.nota)        AS n
        FROM public.criterios_avaliacao c
        JOIN public.avaliacoes a  ON a.id = c.avaliacao_id
        JOIN public.user_profiles up ON up.id = a.avaliado_id
        JOIN public.user_profiles av ON av.id = a.avaliador_id
       WHERE a.ciclo_id = v_ciclo.id
         AND up.filial IN ('SuperMax','MaxLook','TechMax')
         AND av.role IN ('admin','ceo')
       GROUP BY up.filial
    ) q;

  RETURN jsonb_build_object(
    'ciclo_id',   v_ciclo.id,
    'ciclo_nome', v_ciclo.nome,
    'data_fim',   v_ciclo.data_fim,
    'por_filial', v_por_filial
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calcular_placar_padrao() FROM public;
GRANT EXECUTE ON FUNCTION public.calcular_placar_padrao() TO authenticated;

COMMIT;
