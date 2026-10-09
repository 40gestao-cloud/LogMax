-- 685 — Acerto das folhas que a rescisão já cobria antes da 681.
--
-- A 681 encerra a folha do mês do desligamento quando a rescisão NASCE. As
-- rescisões gravadas antes dela deixaram as folhas para trás. Levantamento de
-- 08/10 (lista aprovada pelo usuário antes de aplicar) — só a Contabilidade
-- tem casos; ERP, Aprendiz e Adm: nenhum.
--
--   Ana Clara Cavalcante  10/2026  Processada  R$ 1.600,00  conta Pendente → Cancelado
--   Cauã Cassiano         09/2026  Pendente    R$ 1.620,00
--   Darly Willis          10/2026  Pendente    R$ 1.620,00
--   Esmeralda basto       10/2026  Pendente    R$ 1.620,00
--   Lara Tamires Matos    10/2026  Processada  R$ 1.700,00  conta Pendente → Cancelado
--   Lusiane Barrozo       10/2026  Pendente    R$ 1.620,00
--   Maria Clara Rocha     10/2026  Pendente    R$ 1.620,00
--   Rozieli Ferrais       10/2026  Processada  R$ 1.700,00  conta Pendente → Cancelado
--
-- As folhas são inativadas (não apagadas) e as 3 contas canceladas — o rastro
-- fica no histórico. As folhas de SETEMBRO de quem saiu em 07/10 continuam: são
-- devidas, a rescisão não paga mês anterior.
--
-- Idempotente: _encerrar_folhas_da_rescisao só toca folha ativa e coberta.

DO $mig$
DECLARE
  v_r record;
  v_total int := 0;
  v_res jsonb;
BEGIN
  FOR v_r IN SELECT id FROM public.rescisoes WHERE COALESCE(ativo, true) ORDER BY created_at LOOP
    v_res := public._encerrar_folhas_da_rescisao(v_r.id);
    v_total := v_total + COALESCE((v_res->>'folhas')::int, 0);
  END LOOP;
  RAISE NOTICE '685: % folha(s) encerrada(s)', v_total;
END
$mig$;
