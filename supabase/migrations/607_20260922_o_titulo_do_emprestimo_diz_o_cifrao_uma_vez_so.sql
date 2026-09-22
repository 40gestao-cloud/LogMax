-- 607_20260922_o_titulo_do_emprestimo_diz_o_cifrao_uma_vez_so.sql
--
-- Os 50 títulos do empréstimo da TechMax nasceram com a descrição
--
--   Parcela 1/50 — Empréstimo Banco do Brasil — 021549-9 · juros R$ R$ 225.000,00
--
-- Dois "R$". A `aprovar_emprestimo` concatena o literal ' · juros R$ ' com
-- `public.brl(v_juros)`, e `brl()` já devolve "R$ 225.000,00" — a mesma
-- armadilha de [[feedback_brl_ja_traz_o_simbolo]], agora do lado do banco.
--
-- Não é só a descrição: as mensagens de erro dessas RPCs escrevem
-- 'há R$ %' e passam `public.brl(...)` no %. Quem estoura o saldo lê
-- "há R$ R$ 1.234,56". Todas as ocorrências foram conferidas uma a uma nesta
-- sessão: em `aprovar/editar/apagar_emprestimo` TODO `R$ %` recebe `brl()` —
-- nenhuma delas imprime número cru, onde o "R$" do literal seria necessário.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE UM DO BLOCK E NÃO SEIS `CREATE OR REPLACE` COLADOS
-- ────────────────────────────────────────────────────────────────────────────
-- A correção é de UM caractere em seis corpos grandes (a `editar_emprestimo`
-- sozinha tem 300 linhas). Copiar os seis corpos pra cá só pra mexer no "R$"
-- é justamente o risco que [[feedback_replace_function_copiar_do_banco]]
-- manda evitar: quanto mais corpo alheio transcrito, mais chance de voltar
-- atrás numa mudança que alguém fez no meio.
--
-- Então a migração lê `pg_get_functiondef` do próprio banco, troca as duas
-- formas do erro e executa de volta. O corpo que roda é o corpo que estava
-- lá, menos o "R$" sobrando. É o mesmo que um `sed` na definição vigente —
-- e por isso continua valendo depois de qualquer migração futura.
--
-- As duas trocas, e por que cada uma é segura mecanicamente:
--   1. `R$ ' || public.brl(`  →  `' || public.brl(`
--      Concatenação. SEMPRE dobra, em qualquer função: o literal termina em
--      "R$ " e o `brl()` seguinte começa com "R$ ". Por isso esta vale para
--      as seis funções que têm o padrão.
--   2. `R$ %`  →  `%`
--      Formato de RAISE. Só dobra quando o argumento do % é `brl()`, o que
--      NÃO é verdade no resto do banco (há dezenas de `R$ %` legítimos, com
--      número cru no %, em `criar_venda_pdv` e companhia). Por isso esta fica
--      restrita às três funções de empréstimo, onde a conferência foi feita.
--
-- IDEMPOTENTE: na segunda passada nada casa, nada é executado.
-- Aplicar nos 4 projetos.

BEGIN;

DO $migr$
DECLARE
  r      record;
  v_novo text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('aprovar_emprestimo', 'editar_emprestimo', 'apagar_emprestimo',
                         'conceder_mutuo_capital', 'distribuir_lucro_filial',
                         'estornar_aporte_capital')
  LOOP
    -- 1. concatenação: ' … R$ ' || brl(x)  →  ' … ' || brl(x)
    v_novo := replace(r.def, 'R$ '' || public.brl(', ''' || public.brl(');

    -- 2. formato de RAISE, só onde cada % é comprovadamente brl()
    IF r.proname IN ('aprovar_emprestimo', 'editar_emprestimo', 'apagar_emprestimo') THEN
      v_novo := replace(v_novo, 'R$ %', '%');
    END IF;

    IF v_novo <> r.def THEN
      EXECUTE v_novo;
      RAISE NOTICE 'R$ duplicado removido de %()', r.proname;
    END IF;
  END LOOP;
END;
$migr$;

-- Conferência: nenhuma das seis pode ter sobrado com o padrão.
DO $check$
DECLARE
  v_faltou text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_faltou
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('aprovar_emprestimo', 'editar_emprestimo', 'apagar_emprestimo',
                       'conceder_mutuo_capital', 'distribuir_lucro_filial',
                       'estornar_aporte_capital')
     AND (pg_get_functiondef(p.oid) LIKE '%R$ '' || public.brl(%'
          OR (p.proname IN ('aprovar_emprestimo', 'editar_emprestimo', 'apagar_emprestimo')
              AND pg_get_functiondef(p.oid) LIKE '%R$ %%'));

  IF v_faltou IS NOT NULL THEN
    RAISE EXCEPTION 'R$ duplicado sobrou em: %. Nada foi aplicado.', v_faltou;
  END IF;
END;
$check$;

-- Os títulos já emitidos. São texto de tela: o valor, o vencimento e o elo com
-- a parcela (`parcelas_emprestimo.contas_pagar_id`) não são tocados, então
-- nenhum gatilho de contas_pagar reage — todos eles olham status ou `ativo`.
UPDATE public.contas_pagar
   SET descricao = replace(descricao, 'R$ R$ ', 'R$ ')
 WHERE origem = 'emprestimo'
   AND descricao LIKE '%R$ R$ %';

-- `historico_operacoes` fica como está, com o "R$ R$" que foi escrito na hora.
-- Trilha não se reescreve: o número lá dentro está certo, e a linha é o que a
-- turma viu acontecer. Vide [[project_historico_operacoes]].

COMMIT;
