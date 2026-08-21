-- 497_20260821_a_varredura_anterior_tinha_um_ponto_cego.sql
--
-- Correção da migr. 496, que se declarou completa e não estava.
--
-- ── O ponto cego ────────────────────────────────────────────────────────────
-- A 496 selecionava as funções assim:
--
--   prosrc ~  'IF NOT (public\.)?auth_(pode_filial|gerente_da)'
--   prosrc !~ 'IF NOT COALESCE'          ← o erro
--
-- O segundo filtro descartava qualquer função que já tivesse UM guard com
-- COALESCE em qualquer ponto do corpo. Função com guard misto — um corrigido,
-- outro não — nunca entrou na lista. E como a trava final da 496 usava o mesmo
-- filtro, ela conferiu "0 restantes" pelo mesmo ponto cego e deu o serviço por
-- encerrado. O primeiro filtro já basta: `IF NOT` seguido direto do predicado
-- é a assinatura do problema; se viesse COALESCE ali, não casaria.
--
-- Escaparam três: `liberar_requisicao_estoque` (é ela que dá baixa no material
-- do almoxarifado), `devolver_cotacao_para_correcao` e `separar_pedido_venda`.
--
-- ── E a família é maior do que a 495/496 supôs ──────────────────────────────
-- Ao conferir o que sobrava nessas três, apareceu o resto do parentesco:
--
--   auth_user_role()  → NULL quando não há linha em user_profiles
--   auth_is_admin()   → `auth_user_role() IN (...) OR EXISTS(...)`
--                       → NULL IN (...) = NULL; NULL OR false = NULL
--   auth_in_setor()   → `auth_is_admin() OR (setores && x)` → NULL OR false = NULL
--   auth_opera_loja, auth_is_service_role → mesma forma
--
-- Ou seja: NÃO era só `auth_pode_filial`/`auth_gerente_da`. Todo `IF NOT
-- auth_*(...)` do schema tem o mesmo comportamento — com o token cujo `sub` não
-- tem perfil (conta sem alocação, ou token ainda válido de usuário removido), o
-- guard não barra: ele desaparece.
--
-- Em `IF NOT auth_is_service_role() THEN <confere gente> END IF` o efeito é o
-- espelho e igualmente ruim: o bloco de conferência é PULADO.
--
-- ── A correção ──────────────────────────────────────────────────────────────
-- Duas passadas de regexp sobre `pg_get_functiondef`, agora com o padrão
-- ESTRITO — parênteses balanceados com no máximo um nível, sem atravessar
-- AND/OR:
--
--   1ª: `IF NOT auth_x(...) THEN`  → `IF NOT COALESCE(auth_x(...), false) THEN`
--   2ª: `IF NOT auth_x(...) AND …` → `IF NOT COALESCE(auth_x(...), false) AND …`
--
-- A segunda passada existe porque a primeira não pode encostar em condição
-- composta: o padrão frouxo da 496 (`[^\n]*?`) engoliria até o `) THEN` do fim
-- da linha e produziria `NOT (A AND B)` no lugar de `(NOT A) AND B` — que é
-- outra regra, e liberaria justamente o service_role. Foi visto em dry-run
-- antes de aplicar; por isso o padrão daqui exige parêntese balanceado e para
-- no primeiro operador.
--
-- Travas: cada função tem de mudar de texto; e, no fim, NENHUM `IF NOT auth_*`
-- sem COALESCE pode restar no schema — desta vez conferido pelo padrão certo.
--
-- NÃO muda quem pode o quê. Conta com perfil íntegro vê o mesmo comportamento.


BEGIN;

DO $migracao$
DECLARE
  v_rec      record;
  v_novo     text;
  v_mudadas  int := 0;
  v_restam   int;
BEGIN
  FOR v_rec IN
    SELECT p.oid, p.oid::regprocedure::text AS fn, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc ~ 'IF\s+NOT\s+(public\.)?auth_[a-z_]*\s*\('
     ORDER BY 1
  LOOP
    v_novo := regexp_replace(
      regexp_replace(
        v_rec.def,
        '(IF\s+NOT\s+)((?:public\.)?auth_[a-z_]+\s*\((?:[^()\n]|\([^()\n]*\))*\))(\s*THEN)',
        '\1COALESCE(\2, false)\3', 'g'),
      '(IF\s+NOT\s+)((?:public\.)?auth_[a-z_]+\s*\((?:[^()\n]|\([^()\n]*\))*\))(\s+AND\M)',
      '\1COALESCE(\2, false)\3', 'g');

    IF v_novo = v_rec.def THEN
      RAISE EXCEPTION 'MIGR 497: % casou na seleção mas nenhuma das duas passadas mudou o texto — abortando em vez de recriar a função como estava.', v_rec.fn;
    END IF;

    EXECUTE v_novo;
    v_mudadas := v_mudadas + 1;
  END LOOP;

  RAISE NOTICE 'MIGR 497: % função(ões) corrigida(s).', v_mudadas;

  SELECT count(*) INTO v_restam
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'IF\s+NOT\s+(public\.)?auth_[a-z_]*\s*\(';

  IF v_restam > 0 THEN
    RAISE EXCEPTION 'MIGR 497: ainda restam % função(ões) com IF NOT auth_*() sem COALESCE.', v_restam;
  END IF;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4) — o padrão certo, sem o segundo filtro da 496
--
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prosrc ~ 'IF\s+NOT\s+(public\.)?auth_[a-z_]*\s*\(';
--   -- espera 0
--
-- TESTE MANUAL: fluxo de material do almoxarifado (pedir → liberar), devolução
-- de cotação para correção e separação de pedido de venda seguem funcionando
-- com conta da própria filial; o que muda é token sem perfil, que antes
-- atravessava.
-- ════════════════════════════════════════════════════════════════════════════
