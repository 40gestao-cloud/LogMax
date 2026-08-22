-- 506_20260822_o_afastamento_herdado_nao_reescreve_o_ponto_antigo.sql
--
-- Fecha o caso que a 505 deixou em aberto — e corrige o que ela disse dele.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A 505 DESCREVEU O CAMINHO ERRADO
-- ────────────────────────────────────────────────────────────────────────────
-- O cabeçalho da 505 diz que "aprovar um afastamento PENDENTE herdado ainda
-- escreve nas linhas antigas". Não escreve: `handleDecidir` (AfastamentosView)
-- só faz UPDATE de `status` e `motivo_decisao`. Nenhum gatilho de afastamento
-- chama `aplicar_afastamento_no_ponto` — quem chama é o FRONT, em dois pontos:
--
--   1. ao CRIAR o afastamento (por isso a tela diz "registrado e marcado no
--      ponto. Aguardando aprovação"); e
--   2. no botão "Aplicar" da linha, que aparece sempre que
--      `aplicado_no_ponto = false`.
--
-- É o (2) que é o buraco de verdade, e ele é maior do que "aprovar": qualquer
-- afastamento herdado com `aplicado_no_ponto = false` mostra o botão, e um
-- clique reescreve os dias antigos — sem passar pelo lançamento manual (505)
-- nem pelo gatilho de período (505), que só valida INSERT/UPDATE de datas.
--
-- E tem o simétrico, que a 505 não viu: **desfazer** também reescreve.
-- `_reverter_ponto_do_afastamento` (chamada pelos gatilhos de excluir e de
-- inativar) apaga linhas e restaura status. Inativar um afastamento da turma
-- passada apagaria ponto preservado — pior que sobrescrever, porque some.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A REGRA, NAS DUAS DIREÇÕES
-- ────────────────────────────────────────────────────────────────────────────
-- Dia anterior ao corte não se escreve nem se desescreve. As duas funções
-- passam a pular esses dias, cada uma no seu sentido:
--
-- `aplicar_afastamento_no_ponto` — pula dia anterior ao corte e conta em
-- `pulados_turma_anterior`. Se o período INTEIRO for anterior, levanta erro em
-- vez de marcar `aplicado_no_ponto = true`: dizer "aplicado" sem ter aplicado
-- nada é a mentira que a tela repetiria depois.
--
-- `_reverter_ponto_do_afastamento` — não apaga nem restaura linha anterior ao
-- corte. O efeito colateral é conhecido e aceito: apagando o afastamento, a FK
-- (`ON DELETE SET NULL`) zera `afastamento_id` e o dia fica 'Justificado' sem
-- afastamento por trás. Isso é inerte — dia anterior ao corte não entra na
-- folha da turma nova (505) — e preserva a linha, que é o ponto.
--
-- POR QUE O RESET NÃO LIMPA A FILA DE PENDENTES: seria a solução óbvia para
-- "afastamento herdado" e está errada. O ponto é aplicado na CRIAÇÃO, não na
-- aprovação — então o pendente da turma passada já tem dias marcados no ponto,
-- e apagá-lo dispararia justamente `_reverter_ponto_do_afastamento`. O reset
-- reescreveria o histórico que a 504 preservou.
--
-- Corpos copiados de `prosrc`. md5 idêntico nas 4 ANTES desta:
--   aplicar_afastamento_no_ponto     de358763e6133be2091e5ac7935612c1
--   _reverter_ponto_do_afastamento   e38d04ce2de21eb7a3d6f6d581befcdb
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Aplicar no ponto: só daqui para frente
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.aplicar_afastamento_no_ponto(p_afastamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_afastamento afastamentos;
  v_dia         date;
  v_aplicados   int := 0;
  v_pulados     int := 0;
  -- (506) Dias que caem antes da virada de turma.
  v_pulados_turma int := 0;
  v_corte       date := public.ponto_corte_turma();
  v_existente   record;
BEGIN
  PERFORM public._assert_rpc('rh');

  SELECT * INTO v_afastamento
    FROM afastamentos
   WHERE id = p_afastamento_id
     AND ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Afastamento % não encontrado ou inativo.', p_afastamento_id
      USING ERRCODE = 'P0002';
  END IF;

  v_dia := v_afastamento.data_inicio;
  WHILE v_dia <= v_afastamento.data_fim LOOP
    -- (506) O ponto da turma passada não se reescreve. O gatilho de período
    -- (505) barra afastamento NOVO com data antiga, mas não alcança o herdado
    -- que já estava na tabela quando o corte foi carimbado — e é dele que vem
    -- o botão "Aplicar" na linha.
    IF v_corte IS NOT NULL AND v_dia < v_corte THEN
      v_pulados_turma := v_pulados_turma + 1;
      v_dia := v_dia + 1;
      CONTINUE;
    END IF;

    SELECT id, afastamento_id, status, horas_trabalhadas
      INTO v_existente
      FROM ponto_eletronico
     WHERE funcionario_id = v_afastamento.funcionario_id
       AND data           = v_dia
     LIMIT 1;

    IF v_existente.id IS NULL THEN
      INSERT INTO ponto_eletronico
        (funcionario_id, data, status, horas_trabalhadas, afastamento_id, criado_por_afastamento)
      VALUES (v_afastamento.funcionario_id, v_dia, 'Justificado', 0, p_afastamento_id, true);
      v_aplicados := v_aplicados + 1;

    ELSIF v_existente.afastamento_id IS NULL
       OR v_existente.afastamento_id = p_afastamento_id
    THEN
      UPDATE ponto_eletronico
         SET status                   = 'Justificado',
             horas_trabalhadas        = 0,
             afastamento_id           = p_afastamento_id,
             -- Só na primeira sobrescrita: reaplicar não pode gravar
             -- 'Justificado' como se fosse o estado original do dia.
             status_antes_afastamento = COALESCE(status_antes_afastamento, v_existente.status),
             horas_antes_afastamento  = COALESCE(horas_antes_afastamento, v_existente.horas_trabalhadas)
       WHERE id = v_existente.id;
      v_aplicados := v_aplicados + 1;

    ELSE
      v_pulados := v_pulados + 1;
    END IF;

    v_dia := v_dia + 1;
  END LOOP;

  -- (506) Nada aplicado porque TUDO era da turma passada. Marcar
  -- `aplicado_no_ponto = true` aqui seria carimbar um trabalho que não houve,
  -- e a tela passaria a exibir "Aplicado" para sempre.
  IF v_aplicados = 0 AND v_pulados_turma > 0 THEN
    RAISE EXCEPTION 'O período % a % é anterior ao APAGAR TUDO de % — é ponto da turma passada e não se reescreve. Este afastamento ficou da turma anterior; para tirá-lo da lista, exclua-o (o ponto antigo é mantido).',
      v_afastamento.data_inicio, v_afastamento.data_fim, v_corte
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE afastamentos
     SET aplicado_no_ponto = true,
         aplicado_em       = now()
   WHERE id = p_afastamento_id;

  RETURN jsonb_build_object(
    'aplicados', v_aplicados,
    'pulados', v_pulados,
    'pulados_turma_anterior', v_pulados_turma
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Reverter: também só daqui para frente
-- ════════════════════════════════════════════════════════════════════════════
-- Chamada pelos gatilhos BEFORE DELETE e AFTER UPDATE OF ativo. Sem o recorte,
-- inativar um afastamento herdado APAGA ponto preservado.
CREATE OR REPLACE FUNCTION public._reverter_ponto_do_afastamento(p_afastamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_apagados    int := 0;
  v_orfas       int := 0;
  v_restaurados int := 0;
  -- (506) Antes do corte a linha é histórico: não se apaga nem se restaura.
  v_corte       date := public.ponto_corte_turma();
  v_preservados int := 0;
BEGIN
  SELECT count(*) INTO v_preservados
    FROM public.ponto_eletronico
   WHERE afastamento_id = p_afastamento_id
     AND v_corte IS NOT NULL
     AND data < v_corte;

  WITH apagadas AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND criado_por_afastamento = true
       AND (v_corte IS NULL OR data >= v_corte)
    RETURNING 1
  )
  SELECT count(*) INTO v_apagados FROM apagadas;

  -- Legado pré-273: sem estado anterior e sem vestígio, a linha é do
  -- afastamento. Restaurá-la como 'Falta' era inventar ausência (migr. 304).
  WITH sem_dono AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND COALESCE(criado_por_afastamento, false) = false
       AND status_antes_afastamento IS NULL
       AND entrada             IS NULL
       AND COALESCE(horas_trabalhadas, 0) = 0
       AND registrado_por_nome IS NULL
       AND observacao          IS NULL
       AND (v_corte IS NULL OR data >= v_corte)
    RETURNING 1
  )
  SELECT count(*) INTO v_orfas FROM sem_dono;

  WITH restauradas AS (
    UPDATE public.ponto_eletronico
       SET status                   = COALESCE(status_antes_afastamento, 'Falta'),
           horas_trabalhadas        = COALESCE(horas_antes_afastamento, 0),
           afastamento_id           = NULL,
           status_antes_afastamento = NULL,
           horas_antes_afastamento  = NULL
     WHERE afastamento_id = p_afastamento_id
       AND (v_corte IS NULL OR data >= v_corte)
    RETURNING 1
  )
  SELECT count(*) INTO v_restaurados FROM restauradas;

  RETURN jsonb_build_object(
    'apagados',       v_apagados,
    'orfas_sem_dono', v_orfas,
    'restaurados',    v_restaurados,
    -- (506) Linhas que ficaram como estavam por serem da turma passada.
    'preservados_turma_anterior', v_preservados
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT proname, prosrc LIKE '%ponto_corte_turma%' AS usa_corte
--     FROM pg_proc
--    WHERE proname IN ('aplicar_afastamento_no_ponto',
--                      '_reverter_ponto_do_afastamento')
--    ORDER BY 1;
--   -- espera t nas duas
--
-- md5 depois desta, idêntico nas 4:
--   aplicar_afastamento_no_ponto     17756582462dc68a7176c2fbcfa9c6f5
--   _reverter_ponto_do_afastamento   908056fb31713c604a4becc2574ef4a6
--
-- Ensaio (com corte carimbado, num projeto de teste): criar afastamento com
-- período anterior ao corte é impossível pela 505, então o caso só se produz
-- mexendo direto na tabela — foi assim que este foi exercitado:
--   1. INSERT em afastamentos com datas pós-corte, depois UPDATE das datas
--      direto (o gatilho barra) OU INSERT com o corte ainda NULL e carimbo
--      depois. O segundo é o que acontece de verdade no reset.
--   2. SELECT aplicar_afastamento_no_ponto(id) -- espera exceção "anterior ao
--      APAGAR TUDO", e `aplicado_no_ponto` continua false.
--   3. DELETE do afastamento -- espera ponto antigo intacto, com
--      afastamento_id virando NULL pela FK.
-- ════════════════════════════════════════════════════════════════════════════
