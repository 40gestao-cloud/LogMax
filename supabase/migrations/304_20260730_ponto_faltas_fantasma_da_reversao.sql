-- 304 — A reversão de afastamento fabricava falta. Limpa o estrago e fecha a porta.
--
-- ACHADO (turma logmax-aprendiz, MaxLook: 1.000+ registros e 757 faltas numa
-- filial de 8 pessoas). 792 linhas de 'Falta' que nunca corresponderam a uma
-- ausência: 725 delas em datas FUTURAS, chegando a 2028-07-24.
--
-- CAUSA. `reverter_afastamento_no_ponto` (migr. 273) tem dois ramos:
--
--   apaga     as linhas com criado_por_afastamento = true
--   restaura  as demais, com status = COALESCE(status_antes_afastamento, 'Falta')
--
-- Afastamento anterior à 273 não tem nenhuma das duas colunas preenchidas — a
-- 273 é que as criou. Então TODA linha que aqueles afastamentos criaram do zero
-- caiu no ramo "restaura", e o COALESCE inventou uma falta para um dia que só
-- existia por causa do afastamento. A migr. 291 rodou essa reversão em massa
-- sobre o acervo e documentou o resultado como correto ("o dia volta a ser
-- falta até alguém dizer o contrário"). Está certo para o dia que JÁ EXISTIA e
-- foi sobrescrito; está errado para o dia que a rotina inventou.
--
-- Saldo: 792 justificados fantasma viraram 792 faltas fantasma. O número não
-- melhorou, e a falta pesa na folha e derruba a aderência dos painéis.
--
-- COMO SE RECONHECE UM FANTASMA. Três marcas juntas:
--   origem = 'afastamento'      — o backfill da 289 carimbou quem tinha
--                                 afastamento_id na época; é a digital de que
--                                 a linha nasceu da rotina de afastamento;
--   afastamento_id IS NULL      — a reversão cortou o vínculo;
--   nenhum vestígio de registro real (sem entrada, sem horas, sem quem
--   registrou, sem observação) — ninguém marcou ponto nesse dia.
--
-- Duas linhas da Kellida (2026-07-09 e 07-10) TÊM entrada gravada: eram dias
-- reais, sobrescritos pelo afastamento e restaurados como 'Falta' por falta do
-- estado anterior. Ficam. Corrigir o status delas é decisão do RH na tela, não
-- desta migração — apagá-las destruiria registro legítimo.
--
-- NÃO MEXE nos afastamentos ATIVOS de 755 dias (Caio Vinicius, Kellida Alves).
-- São dado do usuário, não defeito do mecanismo — a seção final traz o comando.
--
-- IDEMPOTENTE. Só a turma aprendiz tem linhas afetadas hoje; nas outras três é
-- no-op. Aplicar nas 4 para o conserto da função valer em todas.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Fecha a porta: reverter deixa de fabricar falta
--
-- Ramo novo no meio: linha SEM estado anterior guardado e SEM vestígio de
-- registro real só pode ter sido criada pelo próprio afastamento — mesmo que
-- criado_por_afastamento seja false por ser anterior à 273. Apaga.
--
-- O ramo "restaura" continua existindo e continua sendo o certo para o dia que
-- tinha registro antes (entrada marcada, horas, quem lançou, observação).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverter_afastamento_no_ponto(p_afastamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_apagados    int := 0;
  v_orfas       int := 0;
  v_restaurados int := 0;
BEGIN
  WITH apagadas AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND criado_por_afastamento = true
    RETURNING 1
  )
  SELECT count(*) INTO v_apagados FROM apagadas;

  -- Legado pré-273: sem estado anterior e sem vestígio, a linha é do
  -- afastamento. Restaurá-la como 'Falta' era inventar ausência.
  WITH sem_dono AS (
    DELETE FROM public.ponto_eletronico
     WHERE afastamento_id = p_afastamento_id
       AND COALESCE(criado_por_afastamento, false) = false
       AND status_antes_afastamento IS NULL
       AND entrada             IS NULL
       AND COALESCE(horas_trabalhadas, 0) = 0
       AND registrado_por_nome IS NULL
       AND observacao          IS NULL
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
    RETURNING 1
  )
  SELECT count(*) INTO v_restaurados FROM restauradas;

  UPDATE public.afastamentos
     SET aplicado_no_ponto = false,
         aplicado_em       = NULL
   WHERE id = p_afastamento_id;

  RETURN jsonb_build_object(
    'apagados',     v_apagados,
    'orfas_sem_dono', v_orfas,
    'restaurados',  v_restaurados
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reverter_afastamento_no_ponto(uuid) FROM public;
REVOKE ALL ON FUNCTION public.reverter_afastamento_no_ponto(uuid) FROM authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Varre os fantasmas que a 291 deixou
--
-- Já estão órfãos (afastamento_id NULL), então a função acima não os alcança —
-- precisa ser varredura direta. As três marcas do cabeçalho, todas exigidas.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_apagadas int;
  v_mantidas int;
BEGIN
  WITH fantasmas AS (
    DELETE FROM public.ponto_eletronico
     WHERE origem         = 'afastamento'
       AND afastamento_id IS NULL
       AND entrada             IS NULL
       AND COALESCE(horas_trabalhadas, 0) = 0
       AND registrado_por_nome IS NULL
       AND observacao          IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_apagadas FROM fantasmas;

  SELECT count(*) INTO v_mantidas
    FROM public.ponto_eletronico
   WHERE origem = 'afastamento' AND afastamento_id IS NULL;

  RAISE NOTICE 'Faltas fantasma apagadas: %. Linhas com vestígio mantidas: %.',
    v_apagadas, v_mantidas;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Deve sobrar só o que tem vestígio de registro real (2 na aprendiz):
--   SELECT data, status, entrada, registrado_por_nome
--     FROM ponto_eletronico
--    WHERE origem = 'afastamento' AND afastamento_id IS NULL
--    ORDER BY data;
--
--   -- Nenhum ponto em data futura fora de afastamento vivo:
--   SELECT count(*) FROM ponto_eletronico
--    WHERE data > current_date AND afastamento_id IS NULL;
--
-- ────────────────────────────────────────────────────────────────────────────
-- PARA RODAR À MÃO — os dois afastamentos ATIVOS de 755 dias
--
-- Fora do corpo de propósito: encurtar ou descartar afastamento de alguém é
-- decisão sua. O teto de 365 dias da 291 só valida INSERT ou mudança de data,
-- então estes dois passaram e seguem ativos:
--
--   Caio Vinicius   2026-07-01 → 2028-07-24  (755 dias justificados no ponto)
--   Kellida Alves   2026-07-01 → 2028-07-24  (ativo, ainda não aplicado)
--
-- Descartar (o trigger da 273 reverte o ponto sozinho, agora sem fabricar falta):
--
--   UPDATE afastamentos SET ativo = false WHERE id = '<id>';
--
-- Corrigir a data em vez de descartar:
--
--   SELECT reverter_afastamento_no_ponto('<id>');
--   UPDATE afastamentos SET data_fim = '<AAAA-MM-DD>' WHERE id = '<id>';
--   SELECT aplicar_afastamento_no_ponto('<id>');
-- ────────────────────────────────────────────────────────────────────────────
