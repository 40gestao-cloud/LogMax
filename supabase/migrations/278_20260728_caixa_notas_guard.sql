-- Caixa e Notas: as RPCs deixam de passar por cima da própria RLS.
--
-- ACHADO (Etapa 4 do plano): cinco funções do Financeiro são SECURITY DEFINER,
-- têm `GRANT EXECUTE ... TO authenticated` e nenhuma checagem de permissão:
--
--   fechar_caixa_conferido        fecha o caixa com o valor contado que
--                                 receber por parâmetro
--   solicitar_fechamento_caixa    idem, na etapa anterior
--   suspender_caixa               suspende caixa alheio
--   registrar_movimentacao_caixa  sangria e suprimento — move dinheiro
--   emitir_nota                   emite nota de qualquer filial
--
-- As tabelas TÊM policy correta. É esse o detalhe que faz o caso: SECURITY
-- DEFINER roda como dono e a RLS não se aplica. A regra existe, está escrita,
-- e o caminho que o app usa passa ao lado dela. Só
-- `confirmar_fechamento_caixa` (migr. 267) valida quem chama.
--
-- Repetindo o remédio da migr. 276: a regra vai para trigger, que roda mesmo
-- sob SECURITY DEFINER e vale para todo caminho de escrita — as RPCs de hoje,
-- as de amanhã e qualquer INSERT direto.
--
-- A régua é a das próprias policies, sem inventar régua nova:
--   caixa e movimentações → setor financeiro/vendas ou gerente, na sua filial
--   notas                 → setor vendas/financeiro ou gerente da filial
--
-- (`auth_in_setor` já devolve true para admin/CEO, então eles seguem passando.)
--
-- Ganho de tabela: `movimentacoes_caixa` tem policy sem recorte de filial —
-- o trigger passa a exigir que a movimentação seja da filial do caixa pai.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. controle_caixa — abrir, fechar, suspender, reabrir
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.controle_caixa_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() nulo = service role / cron / manutenção via SQL editor.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT ((public.auth_in_setor('financeiro', 'vendas') OR public.auth_user_role() = 'gerente')
          AND public.auth_pode_filial(NEW.filial)) THEN
    RAISE EXCEPTION 'Sem permissão para operar o caixa da unidade %.', NEW.filial
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_controle_caixa_guard ON public.controle_caixa;
CREATE TRIGGER trg_controle_caixa_guard
  BEFORE INSERT OR UPDATE ON public.controle_caixa
  FOR EACH ROW EXECUTE FUNCTION public.controle_caixa_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. movimentacoes_caixa — sangria e suprimento
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.movimentacao_caixa_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filial_caixa text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT filial INTO v_filial_caixa
    FROM public.controle_caixa
   WHERE id = NEW.controle_caixa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa % não encontrado.', NEW.controle_caixa_id USING ERRCODE = 'P0002';
  END IF;

  -- A movimentação é da filial do caixa. Divergência é erro de quem chamou.
  IF NEW.filial IS DISTINCT FROM v_filial_caixa THEN
    RAISE EXCEPTION 'Movimentação declarada como % mas o caixa é da unidade %.',
      NEW.filial, v_filial_caixa USING ERRCODE = '42501';
  END IF;

  IF NOT ((public.auth_in_setor('financeiro', 'vendas') OR public.auth_user_role() = 'gerente')
          AND public.auth_pode_filial(v_filial_caixa)) THEN
    RAISE EXCEPTION 'Sem permissão para movimentar o caixa da unidade %.', v_filial_caixa
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_movimentacao_caixa_guard ON public.movimentacoes_caixa;
CREATE TRIGGER trg_movimentacao_caixa_guard
  BEFORE INSERT OR UPDATE ON public.movimentacoes_caixa
  FOR EACH ROW EXECUTE FUNCTION public.movimentacao_caixa_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. notas_emitidas
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.nota_emitida_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT ((public.auth_in_setor('vendas', 'financeiro') OR public.auth_gerente_da(NEW.filial))
          AND public.auth_pode_filial(NEW.filial)) THEN
    RAISE EXCEPTION 'Sem permissão para emitir nota na unidade %.', NEW.filial
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nota_emitida_guard ON public.notas_emitidas;
CREATE TRIGGER trg_nota_emitida_guard
  BEFORE INSERT OR UPDATE ON public.notas_emitidas
  FOR EACH ROW EXECUTE FUNCTION public.nota_emitida_guard();

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   SELECT tgname FROM pg_trigger
--    WHERE tgname IN ('trg_controle_caixa_guard','trg_movimentacao_caixa_guard',
--                     'trg_nota_emitida_guard');
--
--   -- Teste (logado como colaborador de outra unidade, em turma de teste):
--   --   SELECT fechar_caixa_conferido('<caixa de outra filial>', 0, 'teste', 'x');
--   --   -- esperado: 42501.
--
--   -- Fumaça: o fluxo normal do PDV e do Controle de Caixa deve seguir
--   -- funcionando para financeiro/vendas/gerente na própria unidade.
-- ════════════════════════════════════════════════════════════════════════════
