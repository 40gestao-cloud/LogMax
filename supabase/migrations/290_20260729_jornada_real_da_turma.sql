-- 290 — A folha para de supor jornada de 8 horas.
--
-- ACHADO. O LogMax roda em turmas de docência: o expediente é de ~4 horas
-- (manhã 07:40→11:20 = 3h40; tarde 13:20→16:50 = 3h30), configurável por
-- projeto Vercel via PONTO_ENTRADA/PONTO_SAIDA. O cálculo da folha, porém,
-- nasceu com a jornada CLT cravada:
--
--   valor_hora := salario_base / 220.0     -- 220h = 8h/dia × 27,5
--   horas_falta := horas_falta + 8         -- uma falta custa 8 horas
--   horas_extras := horas_trabalhadas - 8  -- extra só acima de 8 horas
--
-- Os efeitos NÃO são uniformes, e vale registrar porque um deles engana:
--
--   FALTA — estava certo por acidente. Os dois erros se cancelavam exatamente:
--           (S/220)×8 = S/27,5, e o correto para 4h é (S/110)×4 = S/27,5.
--           Nenhum desconto de falta saiu errado até hoje.
--
--   ATRASO — saía pela metade. O atraso é medido em minutos REAIS e
--            multiplicado pelo valor-hora; com a hora subvalorizada em 2×, o
--            desconto também. 30 min de atraso num expediente de 3h40 são 13,6%
--            do dia, e eram cobrados como 6,8%.
--
--   HORA EXTRA — nunca disparou, em nenhuma turma. Com expediente de 3h30,
--                ninguém chega a 8h. Quem ficasse o dobro do expediente
--                receberia zero.
--
-- Correção: nada de trocar 8 por 4. A jornada passa a sair de
-- p_target_saida − p_target_entrada, que a tela JÁ envia a partir do env da
-- turma. Manhã vira 3h40 e tarde 3h30 sozinhas, e turma nova só precisa do env
-- certo. O divisor mensal mantém o fator 27,5 (jornada × 27,5), que devolve
-- exatamente 220 para uma jornada de 8h — quem estiver em jornada integral não
-- vê diferença nenhuma.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

CREATE OR REPLACE FUNCTION public.recalcular_folha_do_ponto(
  p_folha_id        uuid,
  p_target_entrada  text    DEFAULT '07:40',
  p_target_retorno  text    DEFAULT '09:20',
  p_target_saida    text    DEFAULT '11:20',
  p_tolerancia_min  integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_funcionario_id   uuid;
  v_salario_base     numeric(12,2);
  v_mes_ref          text;
  v_status           text;
  v_valor_hora       numeric;
  v_target           time;
  v_jornada          numeric;
  v_horas_mes        numeric;
  v_horas_atraso     numeric := 0;
  v_horas_falta      numeric := 0;
  v_horas_extras     numeric := 0;
  v_descontos        numeric;
  v_bonus_extra      numeric;
  v_salario_bruto    numeric;
  v_salario_liquido  numeric;
  v_atraso_min       numeric;
  r                  record;
BEGIN
  PERFORM public._assert_rpc('rh', 'financeiro');

  SELECT funcionario_id, COALESCE(salario_base, salario_bruto), mes_ref, status
    INTO v_funcionario_id, v_salario_base, v_mes_ref, v_status
    FROM folha_pagamento
   WHERE id = p_folha_id
     AND COALESCE(ativo, true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada ou inativa: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Só é possível recalcular folha em status Pendente (atual: %).', v_status;
  END IF;

  IF v_salario_base IS NULL OR v_salario_base <= 0 THEN
    RAISE EXCEPTION 'Salário base inválido (%) — preencha antes de recalcular.', v_salario_base;
  END IF;

  v_target := (p_target_entrada || ':00')::time;

  -- Jornada real da turma. Sem inventar constante: é a janela que o próprio
  -- env do projeto define e a tela já manda.
  v_jornada := EXTRACT(EPOCH FROM (
                 (p_target_saida || ':00')::time - (p_target_entrada || ':00')::time
               )) / 3600.0;

  -- Guarda-costas: env trocado (saída antes da entrada) zeraria o valor-hora e
  -- transformaria todo desconto em zero, silenciosamente.
  IF v_jornada IS NULL OR v_jornada <= 0 THEN
    RAISE EXCEPTION 'Jornada inválida: entrada % e saída % não formam um expediente.', p_target_entrada, p_target_saida
      USING ERRCODE = 'P0001';
  END IF;

  -- 27,5 é o mesmo fator embutido no 220 antigo (8 × 27,5). Mantido para que
  -- jornada de 8h continue dando exatamente 220.
  v_horas_mes  := v_jornada * 27.5;
  v_valor_hora := v_salario_base / v_horas_mes;

  FOR r IN
    SELECT data, entrada, saida, horas_trabalhadas, status
      FROM ponto_eletronico
     WHERE funcionario_id = v_funcionario_id
       AND to_char(data, 'YYYY-MM') = v_mes_ref
  LOOP
    IF r.status = 'Falta' THEN
      -- Uma falta custa um expediente, não uma jornada CLT.
      v_horas_falta := v_horas_falta + v_jornada;

    ELSIF r.status = 'Justificado' THEN
      NULL;

    ELSIF r.status = 'Hora Extra' THEN
      v_horas_extras := v_horas_extras + GREATEST(COALESCE(r.horas_trabalhadas, 0) - v_jornada, 0);
    END IF;

    IF r.entrada IS NOT NULL
       AND r.status NOT IN ('Falta', 'Justificado')
    THEN
      v_atraso_min := EXTRACT(EPOCH FROM (r.entrada::time - v_target)) / 60.0;
      IF v_atraso_min > p_tolerancia_min THEN
        v_horas_atraso := v_horas_atraso + (v_atraso_min / 60.0);
      END IF;
    END IF;
  END LOOP;

  v_descontos       := ROUND((v_horas_atraso + v_horas_falta) * v_valor_hora, 2);
  v_bonus_extra     := ROUND(v_horas_extras * v_valor_hora * 1.5, 2);
  v_salario_bruto   := ROUND(v_salario_base + v_bonus_extra, 2);
  v_salario_liquido := ROUND(v_salario_bruto - v_descontos, 2);

  -- Desconto não pode passar do salário: com jornada curta o valor-hora é
  -- alto, e uma sequência longa de faltas levaria o líquido a negativo — que
  -- vira conta a pagar negativa lá na frente.
  IF v_descontos > v_salario_bruto THEN
    v_descontos       := v_salario_bruto;
    v_salario_liquido := 0;
  END IF;

  UPDATE folha_pagamento
     SET salario_bruto   = v_salario_bruto,
         descontos       = v_descontos,
         salario_liquido = v_salario_liquido,
         horas_atraso    = ROUND(v_horas_atraso, 2),
         horas_falta     = v_horas_falta,
         horas_extras    = v_horas_extras
   WHERE id = p_folha_id;

  RETURN jsonb_build_object(
    'valor_hora',      ROUND(v_valor_hora, 2),
    'jornada_diaria',  ROUND(v_jornada, 2),
    'horas_mes',       ROUND(v_horas_mes, 2),
    'horas_atraso',    ROUND(v_horas_atraso, 2),
    'horas_falta',     v_horas_falta,
    'horas_extras',    v_horas_extras,
    'descontos',       v_descontos,
    'bonus_extra',     v_bonus_extra,
    'salario_base',    v_salario_base,
    'salario_bruto',   v_salario_bruto,
    'salario_liquido', v_salario_liquido
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- Lançamento manual: horas do dia = jornada real, não 8
--
-- A 289 gravava horas_trabalhadas = 8 em todo lançamento manual. Era inócuo
-- enquanto o limiar de extra também era 8 (8−8=0); com o limiar agora na
-- jornada real, 8 viraria hora extra fantasma em todo dia presente.
--
-- A jornada vem do env do backend, que a RPC não enxerga. Usar NULL seria
-- pior (quebra o cálculo de extra), então grava-se a janela padrão da turma
-- da manhã e a tela pode sobrescrever quando souber melhor.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_ponto_manual(
  p_funcionario_id uuid,
  p_data           date,
  p_status         text,
  p_entrada        text DEFAULT NULL,
  p_observacao     text DEFAULT NULL,
  p_horas          numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial     text;
  v_nome       text;
  v_existente  record;
  v_horas      numeric;
  v_quem       text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_status NOT IN ('Normal', 'Falta') THEN
    RAISE EXCEPTION 'Status inválido para lançamento manual: %. Use Normal ou Falta — Justificado é do módulo Afastamentos.', p_status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_data > (now() AT TIME ZONE 'America/Rio_Branco')::date THEN
    RAISE EXCEPTION 'Não dá para lançar presença de um dia que ainda não aconteceu.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(f.filial, 'Matriz'), f.nome INTO v_filial, v_nome
    FROM public.funcionarios f WHERE f.id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.auth_in_setor('rh') OR public.auth_gerente_da(v_filial)) THEN
    RAISE EXCEPTION 'Só o RH ou o gerente da filial lançam presença.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Funcionário de outra filial.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existente
    FROM public.ponto_eletronico
   WHERE funcionario_id = p_funcionario_id AND data = p_data
   FOR UPDATE;

  IF FOUND AND v_existente.afastamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dia % de % está coberto por um afastamento. Ajuste pelo módulo Afastamentos.', p_data, COALESCE(v_nome, 'funcionário')
      USING ERRCODE = 'P0001';
  END IF;

  -- A 289 tinha aqui um ramo que anotava "marcação original do totem" ao
  -- sobrescrever. Sai: o totem nunca gravou nada (ponto_qr_registros zerada
  -- nas 4 turmas) e foi removido da UI, então a mensagem atribuiria a um
  -- totem inexistente qualquer valor anterior. Sobrescrita de linha 'legado'
  -- fica registrada abaixo, sem inventar procedência.
  IF FOUND AND COALESCE(v_existente.origem, 'legado') = 'legado' AND v_existente.entrada IS NOT NULL THEN
    p_observacao := COALESCE(p_observacao || ' · ', '')
      || 'Substitui registro anterior (entrada ' || v_existente.entrada || ')';
  END IF;

  v_horas := CASE
    WHEN p_status = 'Falta' THEN 0
    ELSE COALESCE(p_horas, 3.67)   -- 07:40→11:20, jornada padrão da manhã
  END;
  v_quem  := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.ponto_eletronico
    (funcionario_id, data, status, entrada, horas_trabalhadas, filial,
     origem, observacao, registrado_por, registrado_por_nome)
  VALUES
    (p_funcionario_id, p_data, p_status,
     CASE WHEN p_status = 'Falta' THEN NULL ELSE p_entrada END,
     v_horas, v_filial, 'manual', p_observacao, auth.uid(), v_quem)
  ON CONFLICT (funcionario_id, data) DO UPDATE
     SET status              = EXCLUDED.status,
         entrada             = EXCLUDED.entrada,
         horas_trabalhadas   = EXCLUDED.horas_trabalhadas,
         origem              = 'manual',
         observacao          = EXCLUDED.observacao,
         registrado_por      = EXCLUDED.registrado_por,
         registrado_por_nome = EXCLUDED.registrado_por_nome;

  RETURN jsonb_build_object(
    'ok', true, 'status', p_status, 'data', p_data,
    'funcionario', v_nome, 'filial', v_filial, 'horas', v_horas
  );
END;
$function$;

-- A assinatura de 5 argumentos da 289 fica órfã: PostgREST escolhe overload
-- pelos nomes recebidos, e manter as duas faria a chamada antiga gravar 8h.
DROP FUNCTION IF EXISTS public.registrar_ponto_manual(uuid, date, text, text, text);

REVOKE ALL ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Corrige as horas já gravadas pela 289
--
-- Só linhas manuais com exatamente 8h — o número que a 289 cravou. Quem tiver
-- outro valor veio do totem ou de correção humana e não se toca.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.ponto_eletronico
   SET horas_trabalhadas = 3.67
 WHERE origem = 'manual'
   AND status <> 'Falta'
   AND horas_trabalhadas = 8;

-- ────────────────────────────────────────────────────────────────────────────
-- Desfaz o rótulo 'totem' que a 289 gravou errado
--
-- O backfill da 289 dizia "o resto veio do totem (único escritor até aqui)".
-- Era falso: `ponto_qr_registros` está zerada nas 4 turmas — o totem nunca
-- registrou nada. As linhas que ganharam esse rótulo (69 na turma aprendiz,
-- nenhuma nas outras três) vêm de seed e do antigo lançamento manual que
-- existia em PontoEletronicoView antes de ser removido.
--
-- 'legado' diz a verdade: origem anterior ao rastreio, desconhecida. Chamar de
-- 'manual' seria afirmar que alguém do RH lançou, que é outra invenção.
--
-- O DEFAULT da coluna continua 'totem': se o totem voltar, é ele quem escreve
-- por essa porta, e aí o rótulo passa a valer.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.ponto_eletronico
   SET origem = 'legado'
 WHERE origem = 'totem';

COMMENT ON COLUMN public.ponto_eletronico.origem IS
  'manual = lançado pelo RH na aba Lançamento; afastamento = escrito por '
  'aplicar_afastamento_no_ponto; legado = anterior ao rastreio, procedência '
  'desconhecida; totem = marcado no QR/código — reservado, o totem saiu da UI '
  'em 2026-07-29 sem nunca ter registrado nada. Migrações 289 e 290.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   -- Deve devolver 0: nenhum lançamento manual com jornada de 8h sobrando.
--   SELECT count(*) FROM ponto_eletronico
--    WHERE origem = 'manual' AND status <> 'Falta' AND horas_trabalhadas = 8;
--
--   -- Deve devolver 0: nenhuma linha rotulada como totem (que nunca rodou).
--   SELECT count(*) FROM ponto_eletronico WHERE origem = 'totem';
--
--   -- Distribuição esperada: manual + afastamento + legado.
--   SELECT origem, count(*) FROM ponto_eletronico GROUP BY 1 ORDER BY 2 DESC;
--
--   -- Recalcule uma folha Pendente e confira jornada_diaria/valor_hora no
--   -- retorno: com o env da manhã deve vir 3.67 e salário ÷ 100,83.
-- ────────────────────────────────────────────────────────────────────────────
