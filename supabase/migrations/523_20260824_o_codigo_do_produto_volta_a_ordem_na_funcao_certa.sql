-- 523_20260824_o_codigo_do_produto_volta_a_ordem_na_funcao_certa.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A correção da migr. 518 foi escrita na assinatura errada
-- ═══════════════════════════════════════════════════════════════════════════
-- Levantamento na ERP, 24/08 — MaxLook com 20 produtos ativos e códigos
-- 001..006, 008, 70, 74, 76, 83, 084, 085, 121, 122, 123, 126, 127, 129, 130,
-- 131, 132. Vinte produtos, o numerador em 132.
--
-- A migr. 518 já tinha corrigido isto: procurar o PRIMEIRO livre a partir de
-- 001 em vez de andar só para frente a partir do maior. Só que ela fez
-- `CREATE OR REPLACE FUNCTION reservar_codigo_produto(p_filial text)` — a
-- assinatura de UM argumento, que a migr. 498 tinha DROPADO e substituído por
-- `reservar_codigo_produto(p_filial, p_codigo_atual)`. Resultado: a 518
-- ressuscitou uma sobrecarga morta com a lógica nova, e a função que a tela
-- realmente chama (a de dois argumentos) continuou com o
-- `GREATEST(max(produtos), max(reservas))` da 481.
--
-- Conferido nos 4 projetos antes desta migração: as duas sobrecargas existiam,
-- com md5 idêntico entre projetos — a de 1 argumento com o texto da 518, a de
-- 2 com o texto da 498. Vide [feedback_replace_function_copiar_do_banco] e
-- [feedback_drop_function_assinatura_exata]: REPLACE em assinatura que não é a
-- vigente não corrige nada, e ainda deixa duas funções com o mesmo nome — uma
-- chamada de 1 argumento de um bundle antigo cairia em PGRST203 (ambígua).
--
-- ── Por que a MaxLook saltou mais que as outras ─────────────────────────────
-- Dois numeradores empurrando o mesmo teto:
--   1. Código digitado à mão. "70", "74", "76", "83" não têm o zero à esquerda
--      que a RPC sempre põe (lpad 3) — foram escritos pelo aluno, um deles com
--      "(SKU 83)" no próprio nome. `codigo_seq` é coluna GERADA a partir da
--      parte numérica do código (migr. 265): digitar 83 levou o max() para 83,
--      e o próximo "Gerar" veio 084.
--   2. Formulário aberto e abandonado. A reserva expira, mas o max() nunca
--      voltava — cada abandono queimava um número para sempre.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
-- As duas funções que atribuem `produtos.codigo` sozinhas passam a procurar o
-- primeiro número livre a partir de 001:
--   • reservar_codigo_produto(text, text) — o botão "Gerar" do cadastro;
--   • gerar_grade_variantes(uuid, text[], text[]) — a grade da MaxLook
--     (migr. 445), o SEGUNDO numerador da filial, que a 518 nem tocou.
--
-- Três cuidados que a versão ingênua não teria:
--   a) o ocupado inclui o produto INATIVO. O índice único é parcial
--      (`WHERE ativo`), então o banco deixaria reusar o código de um item da
--      lixeira — e dois produtos diferentes dividiriam o mesmo código no
--      histórico de compras, estoque e DRE.
--   b) "70" e "070" são o mesmo número para o aluno e códigos diferentes para
--      o índice único. Quando o código existente é só dígitos, a comparação é
--      pelo `codigo_seq`; o herdado com letra ("ML-004") continua comparado
--      pelo texto, para não bloquear o "004" da filial.
--   c) a sobrecarga de 1 argumento criada pela 518 é removida — quem chama é a
--      de 2, e `p_codigo_atual` já tem DEFAULT NULL.
--
-- NÃO renumera o que já está cadastrado: código de produto é a etiqueta que o
-- aluno leu no pedido, na etiqueta e no relatório. Os buracos existentes vão
-- sendo preenchidos pelos próximos "Gerar" (na MaxLook, o próximo é 007).
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A sobrecarga morta que a 518 ressuscitou
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reservar_codigo_produto(text);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O botão "Gerar" — agora na assinatura que a tela chama
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservar_codigo_produto(
  p_filial       text,
  -- Código que o formulário já tem na mão. Default NULL mantém a chamada de um
  -- argumento válida (bundle antigo continua funcionando).
  p_codigo_atual text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seq    integer;
  v_codigo text;
BEGIN
  -- Sem lista de setor: quem pode INSERT em produtos é a policy write_produtos
  -- que decide, e tirar um número não cria nada.
  PERFORM public._assert_rpc();

  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Você não cadastra produto na unidade %.', p_filial
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('produtos_codigo_reserva'), hashtext(p_filial));

  -- Só a desta filial: o lock é por filial, e varrer a tabela inteira faria
  -- duas unidades esperarem uma pela outra sem precisar.
  DELETE FROM public.produtos_codigo_reserva
   WHERE filial = p_filial AND expira_em <= now();

  -- Renovação/reclique (migr. 498): o número que já está na tela continua sendo
  -- dele, com prazo novo — sem devolver o número da OUTRA aba para a fila.
  IF NULLIF(btrim(COALESCE(p_codigo_atual, '')), '') IS NOT NULL THEN
    UPDATE public.produtos_codigo_reserva
       SET expira_em = now() + interval '30 minutes'
     WHERE filial = p_filial
       AND codigo = btrim(p_codigo_atual)
       AND usuario_id = auth.uid()
    RETURNING codigo INTO v_codigo;

    IF v_codigo IS NOT NULL THEN
      RETURN v_codigo;
    END IF;
    -- Não era dele (ou já venceu e foi limpo acima): segue e tira um novo.
  END IF;

  -- MIGR 523: começa do 001, e não do maior já usado. É a correção que a 518
  -- escreveu na sobrecarga errada.
  v_seq := 0;

  LOOP
    v_seq := v_seq + 1;
    v_codigo := lpad(v_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.produtos p
                 WHERE p.filial = p_filial
                   -- `p.ativo` fora de propósito: o índice único é parcial, e
                   -- reusar o código da lixeira faria dois produtos dividirem
                   -- a mesma etiqueta no histórico.
                   AND (p.codigo = v_codigo
                        -- "70" e "070": mesmo número para quem lê, textos
                        -- diferentes para o índice. O herdado com letra
                        -- ("ML-004") não entra aqui e segue comparado por texto.
                        OR (p.codigo ~ '^[0-9]+$' AND p.codigo_seq = v_seq)))
         AND NOT EXISTS (
                SELECT 1 FROM public.produtos_codigo_reserva r
                 WHERE r.filial = p_filial
                   AND (r.codigo = v_codigo OR r.codigo_seq = v_seq));
  END LOOP;

  INSERT INTO public.produtos_codigo_reserva (filial, codigo, codigo_seq, usuario_id)
  VALUES (p_filial, v_codigo, v_seq, auth.uid());

  RETURN v_codigo;
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_codigo_produto(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_codigo_produto(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.reservar_codigo_produto(text, text) IS
  'Migr. 523. Reserva o próximo código livre da filial a partir de 001, pulando o ocupado (inclusive inativo) e o reservado. Passando p_codigo_atual, devolve o mesmo número e renova os 30 minutos.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A grade da MaxLook — o segundo numerador da filial
-- ────────────────────────────────────────────────────────────────────────────
-- Cópia do texto vigente no banco (md5 igual nos 4 projetos), com a mesma
-- mudança: parte de 001 em vez do maior, e o ocupado passa a incluir inativo e
-- o código sem zero à esquerda.
CREATE OR REPLACE FUNCTION public.gerar_grade_variantes(
  p_produto_id uuid,
  p_tamanhos   text[],
  p_cores      text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_base     public.produtos;
  v_custo    numeric(15,4);
  v_modelo   text;
  v_nome     text;
  v_tam      text;
  v_cor      text;
  v_codigo   text;
  v_seq      int;
  v_novo_id  uuid;
  v_criadas  int := 0;
  v_tams     text[];
  v_cores    text[];
BEGIN
  PERFORM public._assert_rpc();
  SELECT * INTO v_base FROM public.produtos WHERE id = p_produto_id;
  IF v_base.id IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_base.filial), false) THEN
    RAISE EXCEPTION 'Produto de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(
       public.auth_is_admin()
       OR public.auth_in_setor('compras', 'logistica', 'estoque')
       OR public.auth_gerente_da(v_base.filial), false) THEN
    RAISE EXCEPTION 'Abrir grade é de quem cadastra produto: compras, logística, estoque ou o gerente da filial.'
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_base.tipo, 'estoque_venda') <> 'estoque_venda' THEN
    RAISE EXCEPTION 'Grade é de mercadoria. Patrimônio e material de consumo não têm tamanho e cor.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(t ORDER BY ord) INTO v_tams FROM (
    SELECT DISTINCT ON (upper(btrim(u))) btrim(u) AS t, ord
      FROM unnest(COALESCE(p_tamanhos, ARRAY[]::text[])) WITH ORDINALITY AS x(u, ord)
     WHERE btrim(u) <> ''
     ORDER BY upper(btrim(u)), ord
  ) s;
  SELECT array_agg(c ORDER BY ord) INTO v_cores FROM (
    SELECT DISTINCT ON (upper(btrim(u))) btrim(u) AS c, ord
      FROM unnest(COALESCE(p_cores, ARRAY[]::text[])) WITH ORDINALITY AS x(u, ord)
     WHERE btrim(u) <> ''
     ORDER BY upper(btrim(u)), ord
  ) s;
  IF v_tams IS NULL OR v_cores IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um tamanho e uma cor.' USING ERRCODE = 'P0001';
  END IF;
  v_modelo := COALESCE(NULLIF(btrim(v_base.modelo_codigo), ''), v_base.codigo);
  v_nome := btrim(split_part(v_base.nome, ' — ', 1));
  SELECT preco_custo INTO v_custo FROM public.produtos_custo WHERE produto_id = v_base.id;
  -- [481] mesmo lock do botão "Gerar", antes de ler a numeração
  PERFORM pg_advisory_xact_lock(hashtext('produtos_codigo_reserva'), hashtext(v_base.filial));
  -- [523] parte de 001. O laço abaixo já pulava o ocupado; o que mudou foi de
  -- onde ele parte — cada variante continua tirando o próximo livre em ordem.
  v_seq := 0;
  UPDATE public.produtos
     SET modelo_codigo = v_modelo,
         nome = v_nome || ' — '
                || COALESCE(NULLIF(btrim(atributos ->> 'tamanho'), ''), '?') || ' / '
                || COALESCE(NULLIF(btrim(atributos ->> 'cor'), ''), '?')
   WHERE id = v_base.id;
  FOREACH v_tam IN ARRAY v_tams LOOP
    FOREACH v_cor IN ARRAY v_cores LOOP
      IF EXISTS (
        SELECT 1 FROM public.produtos
         WHERE ativo = true
           AND filial = v_base.filial
           AND modelo_codigo = v_modelo
           AND lower(btrim(COALESCE(atributos ->> 'tamanho', ''))) = lower(v_tam)
           AND lower(btrim(COALESCE(atributos ->> 'cor', '')))     = lower(v_cor)
      ) THEN
        CONTINUE;
      END IF;
      LOOP
        v_seq    := v_seq + 1;
        v_codigo := lpad(v_seq::text, 3, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.produtos p
           WHERE p.filial = v_base.filial
             -- [523] inativo também ocupa: o índice único é parcial e o código
             -- da lixeira não pode voltar para outro produto.
             AND (p.codigo = v_codigo
                  OR (p.codigo ~ '^[0-9]+$' AND p.codigo_seq = v_seq))
        )
        -- [481] número reservado tem dono, mesmo sem produto ainda
        AND NOT EXISTS (
          SELECT 1 FROM public.produtos_codigo_reserva r
           WHERE r.filial = v_base.filial
             AND (r.codigo = v_codigo OR r.codigo_seq = v_seq)
             AND r.expira_em > now()
        );
      END LOOP;
      INSERT INTO public.produtos (
        codigo, nome, estoque, preco, unidade, status, categoria, estoque_minimo,
        fornecedor, filial, imagem_url, imagem_url_2, imagem_url_3, tipo,
        elegivel_beneficios, categoria_id, subcategoria_id, marca, peso,
        peso_unidade, atributos, modelo_codigo,
        loja_online, vitrine_publica,
        ean
      ) VALUES (
        v_codigo,
        v_nome || ' — ' || v_tam || ' / ' || v_cor,
        0,
        v_base.preco, v_base.unidade, COALESCE(v_base.status, 'Ativo'), v_base.categoria,
        v_base.estoque_minimo, v_base.fornecedor, v_base.filial,
        v_base.imagem_url, v_base.imagem_url_2, v_base.imagem_url_3,
        v_base.tipo, COALESCE(v_base.elegivel_beneficios, false),
        v_base.categoria_id, v_base.subcategoria_id, v_base.marca, v_base.peso,
        v_base.peso_unidade,
        COALESCE(v_base.atributos, '{}'::jsonb)
          || jsonb_build_object('tamanho', v_tam, 'cor', v_cor),
        v_modelo,
        false, false,
        public.ean13_interno()
      )
      RETURNING id INTO v_novo_id;
      IF v_custo IS NOT NULL THEN
        INSERT INTO public.produtos_custo (produto_id, preco_custo, origem, updated_at)
        VALUES (v_novo_id, v_custo, 'grade', now())
        ON CONFLICT (produto_id) DO NOTHING;
      END IF;
      v_criadas := v_criadas + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object(
    'modelo_codigo', v_modelo,
    'criadas',       v_criadas,
    'combinacoes',   array_length(v_tams, 1) * array_length(v_cores, 1)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_grade_variantes(uuid, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_grade_variantes(uuid, text[], text[]) TO authenticated, service_role;

COMMIT;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   -- UMA linha, com dois argumentos:
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'reservar_codigo_produto';
--
--   -- os buracos de cada unidade, que os próximos "Gerar" vão preencher:
--   SELECT filial, count(*) FILTER (WHERE ativo) AS ativos,
--          min(codigo_seq), max(codigo_seq)
--     FROM produtos GROUP BY 1 ORDER BY 1;
--
--   NOTIFY pgrst, 'reload schema';
