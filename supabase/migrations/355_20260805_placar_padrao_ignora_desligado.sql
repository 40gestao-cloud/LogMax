-- 355 — Placar Padrão: quem foi desligado não pesa mais na filial
--
-- `calcular_placar_padrao` (migr. 235) média as notas do ciclo por
-- `user_profiles.filial` do avaliado, sem olhar `desligado_em`. O desligamento
-- (migr. 306/307) corta o acesso mas **não** mexe em `role` nem em `filial` —
-- de propósito, porque o histórico de RH precisa saber de onde a pessoa saiu.
-- O efeito colateral aparecia aqui: o aluno desligado continuava aparecendo
-- como avaliável na Central de Avaliação e a nota dele continuava entrando na
-- média da filial. A filial era julgada por gente que ela não tem mais.
--
-- O placar mede o time que a filial tem hoje. Nota de desligado sai da conta —
-- não é apagada: continua na `avaliacoes`/`criterios_avaliacao` e visível na
-- Visão do Ciclo (marcada como "Desligado"), porque a avaliação aconteceu e
-- reescrever isso seria pior do que a distorção que estamos corrigindo.
--
-- O lado da tela (não listar desligado como pendência de avaliação) foi feito
-- em AvaliacoesView.tsx no mesmo commit.
--
-- Idempotente (CREATE OR REPLACE, assinatura inalterada).

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
         -- A linha que faltava. Desligado não compõe a nota da filial.
         -- Só o avaliado: a nota de um avaliador que saiu depois continua
         -- valendo, porque ela descreve a filial, não ele.
         AND up.desligado_em IS NULL
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

REVOKE ALL ON FUNCTION public.calcular_placar_padrao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_placar_padrao() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
