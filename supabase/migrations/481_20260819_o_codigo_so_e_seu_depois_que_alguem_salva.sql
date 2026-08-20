-- 481_20260819_o_codigo_so_e_seu_depois_que_alguem_salva.sql
--
-- Cadastros > Produtos > Código, botão "Gerar". Com a turma inteira cadastrando
-- ao mesmo tempo, o botão dava 001 para todo mundo: ele lê o maior `codigo_seq`
-- da filial e soma um, e o maior só muda quando ALGUÉM SALVA. Entre o clique e
-- o Salvar passam minutos — preencher nome, custo, EAN, ficha do nicho — e
-- nesse intervalo os alunos da unidade estão todos com 001 na tela. Quem salva
-- primeiro leva; os outros levam erro de chave duplicada no fim do
-- preenchimento, que é o pior momento possível para descobrir.
--
-- É a mesma classe de problema da migr. 469/470 (concorrência com turma cheia):
-- ler-e-depois-escrever sem nada segurando o número no meio.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A SOLUÇÃO: O CLIQUE JÁ RESERVA
--
-- `produtos_codigo_reserva` guarda o número tirado, por filial, com dono e
-- prazo. Quem clicar depois enxerga a reserva do colega e recebe o próximo —
-- 001, 002, 003 —, sem que nenhum produto tenha sido salvo ainda.
--
-- A reserva NÃO é o que garante unicidade: quem garante continua sendo o índice
-- único parcial de `produtos(filial, codigo) WHERE ativo` (migr. 201). A reserva
-- só evita que duas pessoas cheguem no Salvar com o mesmo número na mão.
--
-- Prazo de 30 minutos porque a reserva é otimista: o aluno pode fechar a aba,
-- cair a rede, desistir do cadastro. Sem prazo, cada desistência queimaria um
-- número do catálogo para sempre. Com prazo, o número volta sozinho — e a
-- própria RPC limpa o que venceu antes de escolher o próximo, então não precisa
-- de cron.
--
-- Clicar "Gerar" duas vezes devolve o MESMO número: a reserva anterior do
-- usuário naquela filial é solta antes da conta. Sem isso, hesitar custaria um
-- número por clique.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE ADVISORY LOCK, E NÃO SÓ O UNIQUE
--
-- Dois cliques simultâneos leriam o mesmo `max()` antes de qualquer INSERT, e um
-- dos dois tomaria erro de duplicidade — só que agora no clique do "Gerar", que
-- é justamente o que se quer evitar. `pg_advisory_xact_lock` por filial serializa
-- a escolha; o lock é por transação e some sozinho no fim da RPC. Chave dupla
-- (hashtext do nome da tabela + hashtext da filial) para não colidir com lock de
-- outro assunto.
--
-- A tabela fica com RLS ligada e SEM policy: ninguém fala com ela direto, só
-- pelas duas RPCs. É estado de rascunho, não é dado do curso.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O SEGUNDO NUMERADOR: A GRADE DA MAXLOOK
--
-- `gerar_grade_variantes` (migr. 445) numera as variantes do mesmo jeito —
-- `max(codigo_seq)` da filial, laço pulando o que está ocupado — e o laço dela
-- olha só `produtos`. Fechar o botão "Gerar" e deixar a grade como está seria
-- trocar de porta: abrir uma grade de seis variantes enquanto alguém tem 001
-- reservado TOMA o 001, e o cadastro do colega falha no Salvar exatamente como
-- antes.
--
-- Então ela entra aqui, com as duas mesmas mudanças: pega o mesmo advisory lock
-- (a chave é a filial, então os dois numeradores se enfileiram um atrás do
-- outro) e o laço passa a pular também o que está reservado. O resto da função
-- é cópia literal da 445 — CREATE OR REPLACE com a mesma assinatura.
--
-- O import de planilha não entra: lá o código vem digitado do arquivo, não é
-- numerador automático, e quem barra repetição continua sendo o índice único.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos. Depende da 445 (grade) e da 443
-- (`ean13_interno`).

BEGIN;

CREATE TABLE IF NOT EXISTS public.produtos_codigo_reserva (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial     text NOT NULL,
  codigo     text NOT NULL,
  -- Parte numérica, para o max() da próxima escolha. Gêmea de
  -- `produtos.codigo_seq` (migr. 265) — aqui é coluna comum porque o valor
  -- nasce da própria RPC, que já sabe o número.
  codigo_seq integer NOT NULL,
  -- Sem FK para auth.users de propósito: dependência ali é o que transforma
  -- exclusão de usuário em "Database error deleting user".
  usuario_id uuid,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);

COMMENT ON TABLE public.produtos_codigo_reserva IS
  'Códigos de produto tirados no botão "Gerar" e ainda não salvos. Rascunho com '
  'prazo, não catálogo — a unicidade de verdade é o índice de produtos (migr. 201). '
  'Só as RPCs reservar_codigo_produto/liberar_codigo_produto tocam nela. Migr. 481.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_codigo_reserva_filial_codigo
  ON public.produtos_codigo_reserva (filial, codigo);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo_reserva_expira
  ON public.produtos_codigo_reserva (expira_em);

ALTER TABLE public.produtos_codigo_reserva ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.produtos_codigo_reserva FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.produtos_codigo_reserva TO service_role;

-- ─── Reserva ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservar_codigo_produto(p_filial text)
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
  -- (migr. 169) que decide, e tirar um número não cria nada. O _assert_rpc aqui
  -- cobre o resto — não autenticado, desligado, apagão simulado.
  PERFORM public._assert_rpc();

  -- COALESCE: NULL não vira permissão.
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Você não cadastra produto na unidade %.', p_filial
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('produtos_codigo_reserva'), hashtext(p_filial));

  -- Só a desta filial: o lock é por filial, e sair varrendo a tabela inteira
  -- faria duas unidades esperarem uma pela outra sem precisar. O vencido das
  -- outras cai quando alguém reservar lá.
  DELETE FROM public.produtos_codigo_reserva
   WHERE filial = p_filial AND expira_em <= now();

  -- Antes da conta, e não depois: assim reclicar "Gerar" devolve o mesmo número
  -- em vez de subir um a cada clique.
  DELETE FROM public.produtos_codigo_reserva
   WHERE filial = p_filial AND usuario_id = auth.uid();

  SELECT GREATEST(
    COALESCE((SELECT max(p.codigo_seq) FROM public.produtos p
               WHERE p.filial = p_filial AND p.ativo), 0),
    COALESCE((SELECT max(r.codigo_seq) FROM public.produtos_codigo_reserva r
               WHERE r.filial = p_filial), 0)
  ) INTO v_seq;

  -- O max() é numérico e o catálogo herdado tem código com letra ("ML-004"), em
  -- que a parte numérica repete. O laço confere o TEXTO montado, que é o que o
  -- índice único de produtos vê.
  LOOP
    v_seq := v_seq + 1;
    v_codigo := lpad(v_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.produtos p
                 WHERE p.filial = p_filial AND p.ativo AND p.codigo = v_codigo)
         AND NOT EXISTS (
                SELECT 1 FROM public.produtos_codigo_reserva r
                 WHERE r.filial = p_filial AND r.codigo = v_codigo);
  END LOOP;

  INSERT INTO public.produtos_codigo_reserva (filial, codigo, codigo_seq, usuario_id)
  VALUES (p_filial, v_codigo, v_seq, auth.uid());

  RETURN v_codigo;
END;
$function$;

-- ─── Devolução ──────────────────────────────────────────────────────────────
-- Chamada quando o produto foi salvo (o número virou catálogo, a reserva não
-- serve mais), quando o formulário é fechado sem salvar, ou quando o operador
-- digita outro código por cima do gerado. Só solta o que é do próprio usuário:
-- devolver a reserva alheia recriaria o conflito que esta migração fecha.
CREATE OR REPLACE FUNCTION public.liberar_codigo_produto(p_filial text, p_codigo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();

  DELETE FROM public.produtos_codigo_reserva
   WHERE filial = p_filial
     AND codigo = p_codigo
     AND usuario_id = auth.uid();
END;
$function$;

-- ─── O outro numerador: a grade de variantes (migr. 445) ────────────────────
-- Cópia literal da 445, com DUAS mudanças, marcadas abaixo com [481]:
--   1. o advisory lock da filial, antes de ler o max();
--   2. o laço do código pulando também o que está reservado.
CREATE OR REPLACE FUNCTION public.gerar_grade_variantes(
  p_produto_id uuid,
  p_tamanhos   text[],
  p_cores      text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
  -- Mesma autoridade de quem cadastra produto: a policy de INSERT de `produtos`
  -- é da filial, e esta RPC é SECURITY DEFINER — sem esta linha ela seria uma
  -- porta mais larga que a tela.
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

  -- Limpeza das listas: vazio fora, repetido fora, espaço fora. A grade vem de
  -- campo digitado, e "P, M, G, " tem quatro itens se ninguém olhar.
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

  -- Nome do modelo = nome da base sem o sufixo de variante, para a segunda
  -- rodada não produzir "Camiseta — M / Preto — G / Branco".
  v_nome := btrim(split_part(v_base.nome, ' — ', 1));

  SELECT preco_custo INTO v_custo FROM public.produtos_custo WHERE produto_id = v_base.id;

  -- [481] Mesmo lock do botão "Gerar", mesma chave. A grade tira uma faixa de
  -- códigos de uma vez; sem se enfileirar com quem está tirando um, os dois
  -- leem o mesmo max() e o índice único derruba o segundo. Vai ANTES do max().
  PERFORM pg_advisory_xact_lock(hashtext('produtos_codigo_reserva'), hashtext(v_base.filial));

  -- Ponto de partida da numeração: o maior código da filial. `codigo_seq` é a
  -- parte numérica de `codigo` (coluna gerada da migr. 265), que existe
  -- justamente porque a base tem código com e sem padding.
  -- [481] GREATEST com as reservas vivas: número reservado ainda não é produto,
  -- e começar a contar abaixo dele faria o laço percorrer a faixa inteira.
  SELECT GREATEST(
    COALESCE((SELECT MAX(p.codigo_seq) FROM public.produtos p
               WHERE p.ativo = true AND p.filial = v_base.filial), 0),
    COALESCE((SELECT MAX(r.codigo_seq) FROM public.produtos_codigo_reserva r
               WHERE r.filial = v_base.filial AND r.expira_em > now()), 0)
  ) INTO v_seq;

  -- A base entra na grade como as outras.
  UPDATE public.produtos
     SET modelo_codigo = v_modelo,
         nome = v_nome || ' — '
                || COALESCE(NULLIF(btrim(atributos ->> 'tamanho'), ''), '?') || ' / '
                || COALESCE(NULLIF(btrim(atributos ->> 'cor'), ''), '?')
   WHERE id = v_base.id;

  FOREACH v_tam IN ARRAY v_tams LOOP
    FOREACH v_cor IN ARRAY v_cores LOOP
      -- Já existe (inclusive a própria base)? Não toca.
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

      -- Código só numérico, sequencial dentro da filial — o mesmo padrão do
      -- botão "Gerar" do cadastro. Nada de sufixo de tamanho/cor no código: o
      -- que distingue a variante é a ficha, e código que carrega atributo
      -- envelhece mal (a peça muda de cor no ano seguinte e o código mente).
      -- Pula o que já estiver ocupado em vez de estourar o índice único e
      -- derrubar a grade inteira.
      LOOP
        v_seq    := v_seq + 1;
        v_codigo := lpad(v_seq::text, 3, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.produtos
           WHERE ativo = true AND filial = v_base.filial AND codigo = v_codigo
        )
        -- [481] Reservado no "Gerar" e ainda não salvo: o número tem dono,
        -- mesmo sem existir produto nenhum com ele.
        AND NOT EXISTS (
          SELECT 1 FROM public.produtos_codigo_reserva r
           WHERE r.filial = v_base.filial AND r.codigo = v_codigo
             AND r.expira_em > now()
        );
      END LOOP;

      INSERT INTO public.produtos (
        codigo, nome, estoque, preco, unidade, status, categoria, estoque_minimo,
        fornecedor, filial, imagem_url, imagem_url_2, imagem_url_3, tipo,
        elegivel_beneficios, categoria_id, subcategoria_id, marca, peso,
        peso_unidade, atributos, modelo_codigo,
        -- Publicar é ato com dono (443): a variante nasce fora da loja e fora
        -- da vitrine, mesmo que o modelo esteja publicado.
        loja_online, vitrine_publica,
        -- Saldo não se copia; o EAN não se copia e sim se cria. Ver cabeçalho.
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

      -- O custo acompanha o modelo: é a mesma peça em outro tamanho, e sem isto
      -- a variante entraria no CMV por zero até a primeira compra.
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

-- `anon` nominalmente: REVOKE FROM PUBLIC não alcança grant próprio do papel.
REVOKE ALL ON FUNCTION public.reservar_codigo_produto(text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.liberar_codigo_produto(text, text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_codigo_produto(text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liberar_codigo_produto(text, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT oid::regprocedure FROM pg_proc
--    WHERE proname IN ('reservar_codigo_produto', 'liberar_codigo_produto');
--   -- espera 2 linhas
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'produtos_codigo_reserva';
--   -- espera t
--
-- TESTE MANUAL (duas contas da MESMA unidade, formulário aberto nos dois):
--   aluno A clica Gerar          → 001
--   aluno B clica Gerar          → 002   (sem ninguém ter salvado)
--   aluno A clica Gerar de novo  → 001   (a dele volta, não vira 003)
--   aluno A salva; aluno C Gerar → 003
--   aluno B fecha o formulário; aluno D Gerar → 002 (voltou para a fila)
--
-- TESTE DA GRADE (MaxLook, com um código reservado por outra conta):
--   aluno A clica Gerar e NÃO salva                  → segura, digamos, 012
--   aluno B abre grade de uma peça (2 tam × 2 cores) → cria 013, 014, 015
--   aluno A salva                                    → grava 012, sem erro
--   -- antes desta migração a grade levava o 012 e o Salvar do A falhava.
-- ════════════════════════════════════════════════════════════════════════════
