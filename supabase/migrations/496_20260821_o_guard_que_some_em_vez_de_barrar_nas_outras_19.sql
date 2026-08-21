-- 496_20260821_o_guard_que_some_em_vez_de_barrar_nas_outras_19.sql
--
-- Varredura do padrão que a migr. 495 fechou numa função só.
--
-- `auth_pode_filial(x)`  = `auth_is_admin() OR auth_user_filial() = x`
-- `auth_gerente_da(x)`   = `auth_user_role() = 'gerente' AND auth_user_filial() = x`
--
-- Conta sem alocação (migr. 411) — ou um `sub` de JWT que não tem linha em
-- `user_profiles` — faz `auth_user_filial()` devolver NULL. Aí:
--
--   auth_pode_filial → false OR NULL → NULL
--   auth_gerente_da  → NULL  AND NULL → NULL
--
-- e `IF NOT NULL THEN ... END IF` **não entra no bloco**. O guard não barra:
-- ele desaparece, calado, justamente para quem não tem unidade nenhuma. Em
-- policy de RLS o NULL é recusa (fail-closed); dentro de PL/pgSQL é liberação
-- (fail-open). É a mesma armadilha do `_assert_rpc`, que a régua do projeto já
-- nomeia — só que ninguém a tinha aplicado fora dele.
--
-- ── O que passava por essas portas ──────────────────────────────────────────
-- pagar_folha, pagar_rescisao, processar_folha, processar_rescisao (dinheiro de
-- folha de outra unidade), movimentar_estoque, fechar_inventario, expedir,
-- reabrir_caixa, cancelar_pedido_compra, conferir_nota_fiscal,
-- registrar_ponto_manual, beneficios_do_funcionario, as três criar_requisicao*,
-- e os três gatilhos de decisão (requisição, cotação, férias).
--
-- ── Como a correção é feita ─────────────────────────────────────────────────
-- Não à mão. Transcrever 19 corpos de função é como se perde lógica no meio do
-- caminho — e a régua do projeto é copiar do banco, não do que a gente lembra.
-- O DO abaixo lê `pg_get_functiondef` de cada uma, envolve SÓ a expressão do
-- guard em COALESCE(..., false) e recria com CREATE OR REPLACE. Sem DROP: a
-- assinatura não muda e os GRANTs ficam de pé.
--
-- Três travas para isso não virar um `sed` cego:
--   1. lista fixa de assinaturas — nada fora dela é tocado;
--   2. a substituição tem de mudar o texto; se não mudar, a migração aborta;
--   3. no fim, nenhuma função do schema pode restar com o padrão inseguro.
-- Qualquer uma falhando derruba a transação inteira.
--
-- NÃO muda quem pode o quê. Uma conta COM filial vê exatamente o mesmo
-- comportamento de antes; o que muda é a conta sem filial deixar de passar.


BEGIN;

DO $migracao$
DECLARE
  -- As 19 encontradas pela sonda, conferidas iguais nas 4 turmas
  -- (md5 do conjunto: 229cc0c51a5c6b75064788015420b1b4).
  v_alvos text[] := ARRAY[
    'public.beneficios_do_funcionario(uuid)',
    'public.cancelar_pedido_compra(uuid,text)',
    'public.conferir_nota_fiscal(uuid,numeric,text)',
    'public.cotacao_decisao_guard()',
    'public.criar_requisicao_compra(text,text,numeric,text,text,text,text,date,text)',
    'public.criar_requisicao_estoque(uuid,text,numeric,text,text,uuid)',
    'public.criar_requisicoes_compra_lote(jsonb,text,text,text,text,text,date,text)',
    'public.decidir_requisicao_compra(uuid,text,text)',
    'public.expedir(uuid)',
    'public.fechar_inventario(uuid,numeric)',
    'public.ferias_decisao_guard()',
    'public.movimentar_estoque(uuid,text,numeric,text,text,text)',
    'public.pagar_folha(uuid)',
    'public.pagar_rescisao(uuid)',
    'public.processar_folha(uuid)',
    'public.processar_rescisao(uuid)',
    'public.reabrir_caixa(uuid,text)',
    'public.registrar_ponto_manual(uuid,date,text,text,text,numeric)',
    'public.requisicao_decisao_guard()'
  ];
  v_sig      text;
  v_oid      oid;
  v_def      text;
  v_novo     text;
  v_mudadas  int := 0;
  v_restam   int;
BEGIN
  FOREACH v_sig IN ARRAY v_alvos LOOP
    -- to_regprocedure em vez de ::regprocedure: turma que (por qualquer motivo)
    -- não tenha a função não deve derrubar a migração das outras 18.
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE NOTICE 'MIGR 496: % não existe neste projeto — pulada.', v_sig;
      CONTINUE;
    END IF;

    v_def := pg_get_functiondef(v_oid);

    -- Já corrigida (re-execução da migração): segue em frente.
    IF v_def !~ 'IF\s+NOT\s+(public\.)?auth_(pode_filial|gerente_da)' THEN
      CONTINUE;
    END IF;

    -- Âncora nas duas pontas: `IF NOT ` na frente e `) THEN` atrás. O `[^\n]*?`
    -- mantém a captura na mesma linha e é preguiçoso, então para no PRIMEIRO
    -- `) THEN` — o que preserva parêntese aninhado no argumento
    -- (fechar_inventario passa um COALESCE lá dentro).
    v_novo := regexp_replace(
      v_def,
      '(IF\s+NOT\s+)((?:public\.)?auth_(?:pode_filial|gerente_da)\s*\([^\n]*?\))(\s*THEN)',
      '\1COALESCE(\2, false)\3',
      'g'
    );

    IF v_novo = v_def THEN
      RAISE EXCEPTION 'MIGR 496: o padrão foi detectado em % mas a substituição não mudou nada — abortando em vez de recriar a função como estava.', v_sig;
    END IF;

    EXECUTE v_novo;
    v_mudadas := v_mudadas + 1;
  END LOOP;

  RAISE NOTICE 'MIGR 496: % função(ões) corrigida(s).', v_mudadas;

  -- Invariante final: ninguém no schema pode ficar com o guard fail-open.
  SELECT count(*) INTO v_restam
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'IF\s+NOT\s+(public\.)?auth_(pode_filial|gerente_da)'
     AND p.prosrc !~ 'IF\s+NOT\s+COALESCE';

  IF v_restam > 0 THEN
    RAISE EXCEPTION 'MIGR 496: ainda restam % função(ões) com o guard sem COALESCE — a lista de alvos ficou desatualizada.', v_restam;
  END IF;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.prosrc ~ 'IF\s+NOT\s+(public\.)?auth_(pode_filial|gerente_da)'
--      AND p.prosrc !~ 'IF\s+NOT\s+COALESCE';
--   -- espera 0
--
--   SELECT md5(string_agg(p.oid::regprocedure::text || '=' || md5(p.prosrc), E'\n'
--                         ORDER BY p.oid::regprocedure::text))
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public'
--      AND p.prosrc ~ 'COALESCE\(public\.auth_(pode_filial|gerente_da)';
--   -- mesmo md5 nas 4 turmas
--
-- TESTE MANUAL: operar normalmente com conta COM filial (folha, movimentação de
-- estoque, requisição, reabrir caixa) — nada muda. O que muda é conta sem
-- alocação, que antes atravessava.
-- ════════════════════════════════════════════════════════════════════════════
