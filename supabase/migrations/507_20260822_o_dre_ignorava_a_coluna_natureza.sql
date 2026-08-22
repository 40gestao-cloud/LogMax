-- 507_20260822_o_dre_ignorava_a_coluna_natureza.sql
--
-- Fase 0 do plano de desembolso da montagem de filial
-- (docs/plano-montagem-filial-investimentos.md) — pré-requisito antes de
-- gerar contas a pagar de equipamento/imobilizado item a item: gerar 12
-- contas de equipamento por filial afundaria o resultado do mês enquanto
-- este bug estivesse de pé.
--
-- ── O sintoma ────────────────────────────────────────────────────────────
-- A tela de Contas a Pagar promete: "Não entra no DRE: bem não é gasto"
-- para conta marcada `imobilizado`. É mentira desde a migr. 473.
--
-- ── O diagnóstico ───────────────────────────────────────────────────────
-- A migr. 447 criou `contas_pagar.natureza` e fez `gerar_dre` filtrar por
-- ela (`COALESCE(cp.natureza,'despesa') = 'despesa'`). A migr. 473, dois
-- dias depois, reescreveu `gerar_dre` inteira pra separar juro de
-- amortização do mútuo — e o corpo copiado era o de ANTES da 447 (a
-- própria 473 diz "corpo copiado do banco (migr. 426)"), voltando ao
-- filtro velho `cp.pedido_id IS NULL`. A coluna `natureza` ficou órfã: só
-- o trigger `fn_conta_pagar_natureza` e a tela continuaram enxergando ela.
--
-- A migr. 499 remendou esse MESMO filtro pra deixar contratação de serviço
-- entrar como despesa (`pedido_id IS NULL OR EXISTS(...servico_id...)`),
-- sem notar que estava resolvendo o sintoma errado: a pergunta nunca foi
-- "tem pedido ou não", é "essa conta virou estoque, imobilizado ou
-- despesa". A migr. 500, no mesmo dia, já tinha corrigido
-- `fn_conta_pagar_natureza` pra gravar `natureza='despesa'` em pedido de
-- serviço — a coluna já sabia a resposta certa, só ninguém perguntava.
--
-- ── O fix ───────────────────────────────────────────────────────────────
-- Troca o filtro do bloco de despesas por `natureza`. Isso:
--   · fecha o buraco do plano — avulsa `imobilizado`/`estoque` sai do DRE;
--   · resolve o caso de serviço pela mesma régua, sem a EXISTS especial da
--     499 — natureza já é 'despesa' em pedido de serviço (migr. 500).
--
-- Cirúrgico via `pg_get_functiondef` + `replace()`, mesma régua da migr.
-- 499: a função tem ~5 KB e a norma do projeto é copiar do banco, não
-- retranscrever à mão.
--
-- ── Risco (avisar a turma) ─────────────────────────────────────────────
-- Conta avulsa hoje marcada `imobilizado` sai do resultado do mês. Quem já
-- abriu o DRE recente vai ver o número mudar — é a correção, não uma
-- regressão nova.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DO $migracao$
DECLARE
  v_def   text;
  v_novo  text;
  v_alvo  text := 'AND (cp.pedido_id IS NULL OR EXISTS (SELECT 1 FROM public.pedidos pse WHERE pse.id = cp.pedido_id AND pse.servico_id IS NOT NULL))';
  v_subst text := 'AND COALESCE(cp.natureza, ''despesa'') NOT IN (''estoque'', ''imobilizado'')';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'gerar_dre';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 507: gerar_dre não existe neste projeto.';
  END IF;

  -- Já corrigida (re-execução): segue.
  IF v_def ~ 'cp\.natureza' THEN
    RAISE NOTICE 'MIGR 507: gerar_dre já filtra por natureza — nada a fazer.';
    RETURN;
  END IF;

  IF position(v_alvo in v_def) = 0 THEN
    RAISE EXCEPTION 'MIGR 507: o filtro esperado (pedido_id/servico_id) não foi encontrado em gerar_dre — abortando em vez de recriar a função como estava.';
  END IF;

  v_novo := replace(v_def, v_alvo, v_subst);
  EXECUTE v_novo;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT prosrc ~ 'cp\.natureza' FROM pg_proc WHERE proname = 'gerar_dre';
--   -- true
--
--   -- conta avulsa 'imobilizado' some do DRE:
--   --   1) criar uma contas_pagar avulsa com natureza='imobilizado',
--   --      vencimento no mês corrente;
--   --   2) gerar_dre(filial, inicio_mes, hoje) -> 'despesas' não soma ela;
--   --   3) marcar a mesma conta natureza='despesa' e rodar de novo -> soma.
--
--   -- serviço continua entrando (natureza já é 'despesa' desde a migr. 500):
--   SELECT cp.natureza FROM public.contas_pagar cp
--     JOIN public.pedidos p ON p.id = cp.pedido_id
--    WHERE p.servico_id IS NOT NULL LIMIT 5;
--   -- esperado: 'despesa' em todas
--
--   -- o número do DRE do mês pode mudar (é o esperado): comparar antes/depois
--   SELECT gerar_dre('SuperMax', date_trunc('month', now())::date, public.acre_today()) -> 'despesas';
-- ════════════════════════════════════════════════════════════════════════
