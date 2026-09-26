-- 636_20260926_jornada_da_turma_configurada_no_registro_de_ponto.sql
--
-- O Registro de Ponto ganhou a tela de configuração da turma: dias com aula,
-- entrada, retorno do intervalo, saída e tolerância. O RPC já aceitava tudo
-- isso desde a 376 — mudam só duas coisas que a tela nova expõe:
--
-- 1. VIGÊNCIA AUTOMÁTICA DO CALENDÁRIO. A 610 deu data de vigência ao
--    calendário (`calendario_desde`), mas nada a preenchia: na ERP ela foi
--    gravada à mão. Com o botão agora à vista, a primeira turma que marcasse
--    os dias de aula ligaria o calendário "desde sempre" — e todo dia letivo
--    passado sem ponto viraria falta, reescrevendo placar de competição já
--    corrida. Agora: ligar o calendário (de vazio para algum dia) carimba
--    `calendario_desde = hoje` se ainda estiver vazio; desligar limpa, para a
--    próxima ligação começar de novo a partir do dia em que foi ligada. Trocar
--    os dias com o calendário já ligado não mexe na data.
--
-- 2. HORÁRIOS VALIDADOS JUNTOS. Retorno e saída só eram barrados pelo CHECK de
--    formato; agora também a ordem (entrada < retorno < saída), porque a folha
--    tira a jornada em horas de saída − entrada e saída antes da entrada vira
--    jornada zero sem aviso.
--
-- Corpo copiado do banco nesta sessão (md5 idêntico nos 4). Mesma assinatura:
-- CREATE OR REPLACE, sem DROP.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.definir_ponto_jornada(
  p_entrada        text,
  p_retorno        text       DEFAULT NULL::text,
  p_saida          text       DEFAULT NULL::text,
  p_tolerancia_min integer    DEFAULT NULL::integer,
  p_dias_semana    smallint[] DEFAULT NULL::smallint[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_d        smallint;
  v_atual    ponto_jornada;
  v_retorno  text;
  v_saida    text;
  v_dias     smallint[];
  v_desde    date;
BEGIN
  PERFORM _assert_matriz_admin();

  IF p_entrada !~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    RAISE EXCEPTION 'Horário de entrada inválido: % (use HH:MM)', p_entrada USING ERRCODE = 'P0001';
  END IF;

  IF p_dias_semana IS NOT NULL THEN
    FOREACH v_d IN ARRAY p_dias_semana LOOP
      IF v_d < 0 OR v_d > 6 THEN
        RAISE EXCEPTION 'Dia da semana inválido: % (0=domingo … 6=sábado)', v_d USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  SELECT * INTO v_atual FROM ponto_jornada WHERE id = true FOR UPDATE;

  v_retorno := COALESCE(NULLIF(p_retorno,''), v_atual.retorno);
  v_saida   := COALESCE(NULLIF(p_saida,''),   v_atual.saida);

  IF v_retorno !~ '^[0-9]{1,2}:[0-9]{2}$' OR v_saida !~ '^[0-9]{1,2}:[0-9]{2}$' THEN
    RAISE EXCEPTION 'Horário inválido (use HH:MM)' USING ERRCODE = 'P0001';
  END IF;

  -- (636) A ordem importa: a folha tira a jornada de saída − entrada.
  IF NOT (p_entrada::time < v_retorno::time AND v_retorno::time < v_saida::time) THEN
    RAISE EXCEPTION 'Os horários precisam seguir a ordem entrada (%) < retorno (%) < saída (%)',
      p_entrada, v_retorno, v_saida USING ERRCODE = 'P0001';
  END IF;

  -- Array vazio é "desconfigurar de propósito"; NULL é "não mexi".
  v_dias := CASE
              WHEN p_dias_semana IS NULL THEN v_atual.dias_semana
              WHEN COALESCE(array_length(p_dias_semana,1),0) = 0 THEN NULL
              ELSE (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(p_dias_semana) d)
            END;

  -- (636) Vigência do calendário (610): ligar carimba hoje, desligar limpa,
  -- trocar os dias com ele ligado preserva a data.
  v_desde := CASE
               WHEN v_dias IS NULL THEN NULL
               WHEN COALESCE(array_length(v_atual.dias_semana,1),0) = 0
                 THEN COALESCE(v_atual.calendario_desde, public.acre_today())
               ELSE v_atual.calendario_desde
             END;

  UPDATE ponto_jornada
     SET entrada          = p_entrada,
         retorno          = v_retorno,
         saida            = v_saida,
         tolerancia_min   = COALESCE(p_tolerancia_min, tolerancia_min),
         dias_semana      = v_dias,
         calendario_desde = v_desde,
         configurado      = true,
         updated_at       = now(),
         updated_por      = auth.uid()
   WHERE id = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.definir_ponto_jornada(text,text,text,integer,smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_ponto_jornada(text,text,text,integer,smallint[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
