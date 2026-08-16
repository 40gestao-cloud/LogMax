-- 434_20260816_o_apagao_nao_alcancava_os_relatorios.sql
--
-- Pendência anotada na auditoria de 16/08 e não tratada até aqui.
--
-- A simulação de perda de dados (migr. 339) é um apagão por RLS: 30 tabelas
-- ganharam a policy `zz_blackout` com `NOT auth_blackout()`, e enquanto a
-- direção mantém o exercício ligado a turma não enxerga nem escreve nada.
--
-- SECURITY DEFINER não se submete a RLS, então toda RPC precisa checar o
-- blackout por conta própria. As de ESCRITA checam — `_assert_rpc` faz isso
-- desde a 260, e as de caixa passaram a fazer pela 430 via `_assert_caixa`.
-- As de LEITURA nunca checaram.
--
-- Resultado: com o apagão ligado, o aluno abria o Painel de BI e via o
-- faturamento, o ticket médio e o comparativo entre unidades intactos. O
-- exercício se desmancha — a turma conclui que "sumiu da tela mas o sistema
-- sabe", que é o oposto do que a simulação quer ensinar.
--
-- Quatro funções leem tabela coberta pelo blackout e não o consultavam:
--
--   gerar_painel_bi              o painel inteiro
--   apurar_resultado_periodo     receitas, despesas e lucro do período
--   orcamento_execucao           orçado × realizado por centro de custo
--   total_pendente_contas_pagar  o saldo a pagar da unidade
--
-- FICAM DE FORA, de propósito:
--
--   • `cliente_saldo_devedor` e `cliente_titulos_vencidos`. Estão no caminho
--     quente do fiado (`lib/credito.ts` e o gatilho `venda_fiado_respeita_
--     credito`), e com o apagão ligado a venda já não passa — `vendas` tem
--     `zz_blackout`. Mexer nelas só faria sentido junto da decisão pendente
--     sobre recortá-las por filial, que é regra de negócio.
--   • `get_vitrine_publica`. É a loja pública, para `anon`, fora do exercício.
--
-- As três em plpgsql recebem o guard por injeção no primeiro `BEGIN` de linha
-- inteira — o padrão da 260/261, que se adapta ao corpo local de cada turma e
-- por isso é imune ao schema drift. `gerar_painel_bi` tem 14 KB; copiar corpo
-- fixo aqui seria pedir divergência. `orcamento_execucao` é `LANGUAGE sql` e
-- não tem `BEGIN`: vira plpgsql, como `apurar_resultado_periodo` já virou
-- na 431. Assinatura e colunas OUT idênticas, então nada de 42P13.


BEGIN;

-- Guard só do apagão. Existe separado de `_assert_rpc` porque leitura não deve
-- herdar as checagens de setor e de vínculo encerrado — quem foi desligado
-- continua podendo ver o que já via.
CREATE OR REPLACE FUNCTION public._assert_blackout()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF COALESCE(public.auth_blackout(), false) THEN
    RAISE EXCEPTION 'Dados indisponíveis — simulação de perda de dados em andamento. Nada foi apagado; a operação volta quando a direção encerrar o exercício.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_blackout() FROM public, anon;
GRANT EXECUTE ON FUNCTION public._assert_blackout() TO authenticated, service_role;

-- ── Injeção nas três plpgsql ────────────────────────────────────────────────

DO $do$
DECLARE
  v_sig text;
  v_def text;
  v_novo text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.gerar_painel_bi(date, date)',
    'public.apurar_resultado_periodo(text, date, date)',
    'public.total_pendente_contas_pagar(text)'
  ] LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);

    IF v_def ~ '_assert_blackout' THEN
      CONTINUE;  -- idempotente
    END IF;

    -- Primeiro BEGIN de linha inteira = abertura do corpo. Sem flag 'g':
    -- só a primeira ocorrência, para não atingir bloco aninhado.
    v_novo := regexp_replace(
      v_def,
      E'(^|\n)([ \t]*)BEGIN[ \t]*(\r?\n)',
      E'\\1\\2BEGIN\\3\\2  PERFORM public._assert_blackout();\\3',
      ''
    );

    IF v_novo = v_def THEN
      RAISE EXCEPTION 'Não achei o BEGIN de %s — injeção abortada.', v_sig;
    END IF;

    EXECUTE v_novo;
  END LOOP;
END
$do$;

-- ── orcamento_execucao: sql → plpgsql ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.orcamento_execucao(p_orcamento_id uuid)
RETURNS TABLE(item_id uuid, centro_custo_id uuid, centro_codigo text, centro_nome text, valor_proposto numeric, valor_aprovado numeric, realizado numeric, saldo numeric, consumo_pct numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_blackout();

  RETURN QUERY
  SELECT
    i.id,
    cc.id,
    cc.codigo,
    cc.nome,
    i.valor_proposto,
    i.valor_aprovado,
    COALESCE(r.gasto, 0) AS realizado,
    COALESCE(i.valor_aprovado, 0) - COALESCE(r.gasto, 0) AS saldo,
    CASE WHEN COALESCE(i.valor_aprovado, 0) = 0 THEN NULL
         ELSE round(COALESCE(r.gasto, 0) * 100 / i.valor_aprovado, 1)
    END AS consumo_pct
  FROM orcamento_itens i
  JOIN orcamentos_periodo o ON o.id = i.orcamento_id
  JOIN centros_custo cc     ON cc.id = i.centro_custo_id
  LEFT JOIN LATERAL (
    SELECT sum(cp.valor) AS gasto
      FROM contas_pagar cp
     WHERE cp.ativo = true
       AND cp.centro_custo_id = i.centro_custo_id
       AND cp.filial = o.filial
       AND cp.vencimento BETWEEN o.periodo_inicio AND o.periodo_fim
  ) r ON true
  WHERE i.orcamento_id = p_orcamento_id
    -- Escopo de filial da migr. 431: a filial sai do próprio orçamento, então
    -- sem esta linha bastava ter o id para ler o da unidade vizinha.
    AND (public.auth_is_service_role() OR COALESCE(public.auth_pode_filial(o.filial), false))
  ORDER BY cc.codigo;
END;
$function$;

REVOKE ALL ON FUNCTION public.orcamento_execucao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_execucao(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4 — espera 4)
--
--   SELECT count(*) FROM pg_proc
--    WHERE pronamespace='public'::regnamespace
--      AND proname IN ('gerar_painel_bi','apurar_resultado_periodo',
--                      'orcamento_execucao','total_pendente_contas_pagar')
--      AND pg_get_functiondef(oid) ~ '_assert_blackout';
--
-- TESTE MANUAL: ligar a simulação de perda de dados e abrir o Painel de BI —
-- deve dar a mensagem do exercício em vez do painel. Desligar e reabrir.
-- ════════════════════════════════════════════════════════════════════════════
