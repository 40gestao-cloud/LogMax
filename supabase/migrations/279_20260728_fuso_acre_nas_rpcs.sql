-- Fuso: seis RPCs ainda decidem o dia em UTC.
--
-- ACHADO (Etapa 5 do plano, P12): a operação roda em Rio Branco (UTC−5) e
-- existe `acre_today()` desde a migr. 052 justamente para isso. Seis funções
-- continuaram usando `CURRENT_DATE`, que no Postgres é UTC:
--
--   expirar_competicoes           cron das 03:10 UTC = 22:10 no Acre. Uma
--                                 competição que termina hoje é marcada como
--                                 'aguardando_encerramento' quase duas horas
--                                 antes de o dia acabar para quem participa.
--   criar_devolucao_venda         depois das 19h no Acre, a devolução e a
--                                 entrada de estoque nascem com a data de
--                                 amanhã — some do relatório do dia e do
--                                 fechamento de caixa.
--   converter_orcamento_em_pedido mesma coisa na data do pedido e no
--                                 vencimento da conta a receber.
--   aprovar_emprestimo            idem nas datas das parcelas.
--   calcular_saldo_capital        janela de cálculo desalinhada do dia real.
--   get_vitrine_publica           promoção entra e sai da vitrine cinco horas
--                                 fora do combinado.
--
-- É o mesmo defeito que a 052 corrigiu no PDV, sobrevivendo nas funções
-- escritas depois. `acre_today()` é STABLE e já tem EXECUTE para authenticated
-- e anon — a vitrine pública continua funcionando.
--
-- A troca é textual sobre a definição corrente de cada função, então preserva
-- o corpo como está hoje, inclusive guards adicionados por migrações
-- anteriores. Reaplicar é inofensivo.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

DO $fuso$
DECLARE
  r      record;
  v_def  text;
  v_novo text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('expirar_competicoes', 'criar_devolucao_venda',
                         'converter_orcamento_em_pedido', 'aprovar_emprestimo',
                         'calcular_saldo_capital', 'get_vitrine_publica')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- \m/\M = limites de palavra: não pega CURRENT_DATE dentro de outro
    -- identificador nem now()::date já qualificado.
    v_novo := regexp_replace(v_def, '\mCURRENT_DATE\M', 'public.acre_today()', 'gi');
    v_novo := regexp_replace(v_novo, 'now\(\)::date',   'public.acre_today()', 'gi');

    IF v_novo = v_def THEN
      RAISE NOTICE '[279] % já estava no fuso do Acre.', r.proname;
      CONTINUE;
    END IF;

    EXECUTE v_novo;
    RAISE NOTICE '[279] % passou a usar acre_today().', r.proname;
  END LOOP;
END;
$fuso$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO — nenhuma função de negócio deve decidir o dia em UTC
-- ════════════════════════════════════════════════════════════════════════════
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND pg_get_functiondef(p.oid) ~* '\mCURRENT_DATE\M|now\(\)::date'
--    ORDER BY 1;
--   -- Esperado: vazio.
--
--   -- Diferença que o bug produzia (positiva entre 19h e 24h no Acre):
--   SELECT CURRENT_DATE AS utc, public.acre_today() AS acre,
--          CURRENT_DATE - public.acre_today() AS dias_de_diferenca;
--
-- Sonda reutilizável: rodar junto com as demais sempre que entrar RPC nova.
-- O fuso é o tipo de erro que só aparece em produção, depois das 19h.
-- ════════════════════════════════════════════════════════════════════════════
