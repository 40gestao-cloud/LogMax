-- 303 — Falta justificada lançada à mão no Registro de Ponto.
--
-- Até aqui 'Justificado' só entrava no ponto por Afastamentos: a 289 fechou a
-- porta do lançamento manual ("Justificado é do módulo Afastamentos") porque na
-- época todo dia justificado nascia de um afastamento formal, com período,
-- documento e reversão própria.
--
-- Na prática o RH também precisa justificar UM dia solto — atestado de meia
-- jornada, convocação, ônibus que não passou — sem abrir afastamento com data
-- de início e fim. O que se fazia no lugar era marcar 'Falta' e escrever o
-- motivo na observação: a folha descontava assim mesmo, porque
-- `recalcular_folha_do_ponto` olha o status, não o texto.
--
-- Esta migração abre 'Justificado' para o lançamento manual, com duas travas:
--
--   1. MOTIVO OBRIGATÓRIO. Justificada sem justificativa é falta com nome
--      bonito — e é o único status cuja consequência (zero desconto) depende de
--      alguém ter dito por quê.
--   2. NÃO ENCOSTA EM AFASTAMENTO. O dia coberto por afastamento continua
--      recusado logo acima (afastamento_id IS NOT NULL), e a linha criada aqui
--      nasce com afastamento_id NULL — então o trigger de reversão da 273 não a
--      alcança e o módulo Afastamentos segue dono do que é dele.
--
-- EFEITO NA FOLHA — leia antes de supor: a justificada lançada aqui NÃO perdoa
-- o desconto. A migr. 292 amarrou o perdão à aprovação da Matriz, e um dia
-- 'Justificado' sem afastamento_id cai no ramo que desconta como falta cheia.
-- É intencional: perdoar falta continua sendo decisão de admin/CEO via
-- Afastamentos, e abrir exceção aqui reabriria exatamente a fresta que a 292
-- fechou (quem lança decide o próprio desconto).
--
-- O que este status entrega, então: o dia deixa de ser 'Falta' seca e passa a
-- carregar o motivo declarado, visível na tela e no histórico. Se a intenção
-- for zerar o desconto, o caminho é Afastamentos com aprovação.
--
-- Nos painéis (158/240) a aderência já exclui 'Justificado' da conta — lá o
-- efeito é imediato, diferente da folha.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

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
  v_sem_hora   boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF p_status NOT IN ('Normal', 'Falta', 'Justificado') THEN
    RAISE EXCEPTION 'Status inválido para lançamento manual: %. Use Normal, Falta ou Justificado.', p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Ver cabeçalho: o motivo é o que separa a falta justificada da falta.
  IF p_status = 'Justificado' AND COALESCE(btrim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Falta justificada precisa de justificativa escrita.'
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

  -- Afastamento continua sendo verdade do módulo dele: a justificativa de um
  -- dia solto não pode pisar num período já aprovado.
  IF FOUND AND v_existente.afastamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dia % de % está coberto por um afastamento. Ajuste pelo módulo Afastamentos.', p_data, COALESCE(v_nome, 'funcionário')
      USING ERRCODE = 'P0001';
  END IF;

  IF FOUND AND COALESCE(v_existente.origem, 'legado') = 'legado' AND v_existente.entrada IS NOT NULL THEN
    p_observacao := COALESCE(p_observacao || ' · ', '')
      || 'Substitui registro anterior (entrada ' || v_existente.entrada || ')';
  END IF;

  -- Falta e Justificada são dias sem jornada cumprida: sem entrada e sem horas.
  -- A diferença mora só no status, que é o que a folha lê.
  v_sem_hora := p_status IN ('Falta', 'Justificado');

  v_horas := CASE
    WHEN v_sem_hora THEN 0
    ELSE COALESCE(p_horas, 3.67)   -- 07:40→11:20, jornada padrão da manhã
  END;
  v_quem  := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.ponto_eletronico
    (funcionario_id, data, status, entrada, horas_trabalhadas, filial,
     origem, observacao, registrado_por, registrado_por_nome)
  VALUES
    (p_funcionario_id, p_data, p_status,
     CASE WHEN v_sem_hora THEN NULL ELSE p_entrada END,
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

REVOKE ALL ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Justificadas lançadas à mão (sem afastamento por trás):
--   SELECT data, funcionario_id, observacao, registrado_por_nome
--     FROM ponto_eletronico
--    WHERE status = 'Justificado' AND afastamento_id IS NULL AND origem = 'manual'
--    ORDER BY data DESC LIMIT 20;
--
--   -- Deve falhar com "precisa de justificativa escrita":
--   SELECT registrar_ponto_manual('<func_id>', current_date, 'Justificado', NULL, NULL, 3.67);
-- ────────────────────────────────────────────────────────────────────────────
