-- 289 — Presença passa a ter uma verdade só.
--
-- ACHADO (auditoria de veracidade do módulo RH). O sistema respondia
-- "essa pessoa veio trabalhar?" em duas tabelas que não se falam:
--
--   ponto_eletronico     Normal / Falta / Justificado / Hora Extra
--                        alimenta recalcular_folha_do_ponto (desconto e extra)
--                        escrito pelo totem QR e por Afastamentos
--
--   frequencia_trabalho  Presente / Falta / Presente com Atraso
--                        não alimenta absolutamente nada
--                        escrito à mão pelo RH na tela de Frequência
--
-- Consequências que estavam em produção: marcar Falta em Frequência não
-- descontava nada da folha; lançar um Afastamento marcava Justificado no ponto
-- e deixava a Frequência mostrando Falta no mesmo dia; e as duas telas podiam
-- ser abertas lado a lado dizendo coisas diferentes sobre a mesma pessoa.
--
-- Decisão: fica `ponto_eletronico`, que é quem tem consequência financeira.
-- Frequência vira o modo de entrada MANUAL do mesmo dado — o totem continua
-- sendo o outro. `frequencia_trabalho` para de receber escrita e fica como
-- histórico, igual às tabelas de votações.
--
-- Por que não precisou de status novo: `recalcular_folha_do_ponto` já deriva o
-- atraso da coluna `entrada` comparada ao horário-alvo da turma, para qualquer
-- dia que não seja Falta nem Justificado. Então "Presente com Atraso" é
-- 'Normal' + horário de entrada real, e o desconto sai sozinho. Um status
-- 'Atraso' seria um rótulo que o cálculo ignoraria.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. De onde veio cada linha de ponto
--
-- Com dois modos de entrada no mesmo lugar, "quem lançou isto" deixa de ser
-- detalhe: é a diferença entre um registro biométrico do totem e alguém do RH
-- afirmando presença de memória. A tela mostra, e a auditoria consegue separar.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ponto_eletronico
  ADD COLUMN IF NOT EXISTS origem              text,
  ADD COLUMN IF NOT EXISTS observacao          text,
  ADD COLUMN IF NOT EXISTS registrado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS registrado_por_nome text;

-- Backfill do que já existe: dia com afastamento_id veio de Afastamentos, o
-- resto veio do totem (único escritor até aqui).
UPDATE public.ponto_eletronico
   SET origem = CASE WHEN afastamento_id IS NOT NULL THEN 'afastamento' ELSE 'totem' END
 WHERE origem IS NULL;

ALTER TABLE public.ponto_eletronico
  ALTER COLUMN origem SET DEFAULT 'totem';

COMMENT ON COLUMN public.ponto_eletronico.origem IS
  'totem = marcado no QR/código pelo próprio colaborador; manual = lançado pelo '
  'RH na tela de Frequência; afastamento = escrito por aplicar_afastamento_no_ponto. '
  'Migração 289.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O lançamento manual
--
-- Vira RPC em vez de INSERT direto da tela por dois motivos que a 282 já tinha
-- estabelecido: a régua de autoridade alcança também quem escreve por fora da
-- UI, e a proteção contra pisar num afastamento não pode depender de alguém
-- lembrar de checar antes.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_ponto_manual(
  p_funcionario_id uuid,
  p_data           date,
  p_status         text,
  p_entrada        text DEFAULT NULL,
  p_observacao     text DEFAULT NULL
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
    RAISE EXCEPTION 'Status inválido para lançamento manual: %. Use Normal ou Falta — Justificado é do módulo Afastamentos e Hora Extra vem do totem.', p_status
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

  -- Autoridade: RH (auth_in_setor já cobre a Matriz) ou o gerente da unidade,
  -- e sempre dentro da própria filial.
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

  -- Dia coberto por afastamento é verdade do módulo de Afastamentos. Deixar a
  -- Frequência sobrescrever recriaria a divergência que esta migração fecha —
  -- e apagaria o status_antes_afastamento de que a reversão da 273 depende.
  IF FOUND AND v_existente.afastamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dia % de % está coberto por um afastamento. Ajuste pelo módulo Afastamentos.', p_data, COALESCE(v_nome, 'funcionário')
      USING ERRCODE = 'P0001';
  END IF;

  -- Marcação do totem é registro do próprio colaborador no horário. O RH pode
  -- corrigir, mas isso fica dito na observação em vez de sumir sem rastro.
  IF FOUND AND COALESCE(v_existente.origem, 'totem') = 'totem' AND v_existente.entrada IS NOT NULL THEN
    p_observacao := COALESCE(p_observacao || ' · ', '')
      || 'Corrigido pelo RH; marcação original do totem: ' || v_existente.entrada;
  END IF;

  v_horas := CASE WHEN p_status = 'Falta' THEN 0 ELSE 8 END;
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
    'funcionario', v_nome, 'filial', v_filial
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Migração do histórico de frequencia_trabalho
--
-- `ON CONFLICT DO NOTHING` é deliberado: onde já existe linha de ponto, ela
-- vale. O totem e o afastamento são fontes melhores do que um lançamento
-- manual paralelo, e é justamente onde as duas tabelas se contradiziam.
--
-- 'Presente com Atraso' entra como Normal SEM horário de entrada. O atraso
-- nunca foi quantificado em lugar nenhum — frequencia_trabalho só guardava o
-- rótulo. Inventar um horário aqui viraria desconto real na folha em cima de
-- um número que ninguém mediu; o rótulo original fica na observação.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.ponto_eletronico
  (funcionario_id, data, status, entrada, horas_trabalhadas, filial,
   origem, observacao, registrado_por, registrado_por_nome)
SELECT
  ft.funcionario_id,
  ft.data,
  CASE WHEN ft.status = 'Falta' THEN 'Falta' ELSE 'Normal' END,
  NULL,
  CASE WHEN ft.status = 'Falta' THEN 0 ELSE 8 END,
  COALESCE(f.filial, 'Matriz'),
  'manual',
  'Importado da Frequência de Trabalho (migr. 289)'
    || CASE WHEN ft.status = 'Presente com Atraso'
            THEN ' · registrado como "Presente com Atraso"; horário da entrada não era gravado, então o atraso não pôde ser quantificado'
            ELSE '' END
    || CASE WHEN COALESCE(trim(ft.justificativa), '') <> ''
            THEN ' · ' || ft.justificativa ELSE '' END,
  ft.registrado_por,
  ft.registrado_por_nome
FROM public.frequencia_trabalho ft
JOIN public.funcionarios f ON f.id = ft.funcionario_id
WHERE COALESCE(ft.ativo, true) = true
ON CONFLICT (funcionario_id, data) DO NOTHING;

COMMENT ON TABLE public.frequencia_trabalho IS
  'HISTÓRICO. Parou de receber escrita na migr. 289 — presença virou dado único '
  'em ponto_eletronico. Preservada como as tabelas de votações: o passado segue '
  'consultável, mas a tela de Frequência agora lê e escreve em ponto_eletronico.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Quanto foi importado, e quanto já tinha ponto (conflito preservado):
--   SELECT origem, count(*) FROM ponto_eletronico GROUP BY 1 ORDER BY 1;
--
--   -- Deve devolver 0 linhas: nenhum dia de afastamento virou manual.
--   SELECT count(*) FROM ponto_eletronico
--    WHERE afastamento_id IS NOT NULL AND origem = 'manual';
-- ────────────────────────────────────────────────────────────────────────────
