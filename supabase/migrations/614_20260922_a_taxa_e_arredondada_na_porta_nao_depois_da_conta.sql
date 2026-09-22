-- 614_20260922_a_taxa_e_arredondada_na_porta_nao_depois_da_conta.sql
--
-- A 613 deu três casas à `taxa_juros` e desarredondou os contratos, mas não
-- fechou a porta por onde o descasamento entrou: quem monta a Price é o valor
-- CHEIO que chega na RPC, e quem vai para o cadastro é o mesmo valor depois de
-- cortado pela escala da coluna. Com duas casas, 0,625 virava 0,63; com três,
-- 0,6255 vira 0,626 e a parcela continua sendo calculada com 0,6255.
--
-- Uma casa mais fundo é o mesmo bug. O conserto é arredondar ANTES da conta:
--
--   p_taxa_juros := ROUND(COALESCE(p_taxa_juros, 0), 3);
--
-- A partir daí o número que monta a parcela e o número que aparece na tela são
-- literalmente a mesma variável — não há mais como divergirem, digite-se o que
-- se digitar.
--
-- Em `editar_emprestimo` isto importa em dobro: lá o UPDATE do cadastro vem
-- ANTES do cálculo da Price, então o arredondamento tem de estar no topo, não
-- na linha do `v_i`. Por isso a âncora das duas funções é a validação de taxa
-- negativa, que roda antes de tudo nas duas.
--
-- Pela mesma razão da 607, a migração troca a linha no corpo que está no banco
-- em vez de transcrever 300 linhas de função alheia para cá. A âncora é única
-- em cada uma, e a conferência no fim recusa a migração se sobrar função sem o
-- arredondamento.
--
-- Não recalcula nada: contrato já aprovado continua com a parcela que tem.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

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
       AND p.proname IN ('aprovar_emprestimo', 'editar_emprestimo')
  LOOP
    CONTINUE WHEN position('ROUND(COALESCE(p_taxa_juros, 0), 3)' in r.def) > 0;

    v_novo := replace(
      r.def,
      '  IF COALESCE(p_taxa_juros, 0) < 0 THEN',
      '  -- (614) Arredonda na porta: a taxa que vai para o cadastro é'    || chr(10) ||
      '  -- exatamente a que monta a Price. Sem isto, digitar 0,6255 grava' || chr(10) ||
      '  -- 0,626 e calcula com 0,6255 — o descasamento da 613, uma casa'   || chr(10) ||
      '  -- mais fundo.'                                                    || chr(10) ||
      '  p_taxa_juros := ROUND(COALESCE(p_taxa_juros, 0), 3);'              || chr(10) ||
      ''                                                                    || chr(10) ||
      '  IF COALESCE(p_taxa_juros, 0) < 0 THEN'
    );

    IF v_novo = r.def THEN
      RAISE EXCEPTION 'Âncora não encontrada em %() — corpo divergiu do esperado.', r.proname
        USING ERRCODE = 'P0001';
    END IF;

    EXECUTE v_novo;
  END LOOP;
END;
$migr$;

DO $check$
DECLARE
  v_faltou text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_faltou
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('aprovar_emprestimo', 'editar_emprestimo')
     AND position('ROUND(COALESCE(p_taxa_juros, 0), 3)' in pg_get_functiondef(p.oid)) = 0;

  IF v_faltou IS NOT NULL THEN
    RAISE EXCEPTION 'Sem arredondamento de taxa em: %. Nada foi aplicado.', v_faltou;
  END IF;
END;
$check$;

COMMIT;
