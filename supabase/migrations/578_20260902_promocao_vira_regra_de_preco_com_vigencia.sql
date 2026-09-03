-- Promoção vira REGRA DE PREÇO com vigência. O preço de tabela deixa de ser
-- destruído.
--
-- Até aqui a liberação da oferta dava UPDATE em `produtos.preco`, e o preço de
-- tabela virava uma cópia dentro da promoção (`preco_atual`). Não é o que o
-- varejo faz. Em loja de verdade o produto tem um preço base que fica intocado
-- e a promoção é uma REGRA — produto, unidade, período, preço — que o PDV
-- resolve no momento da venda: existe regra valendo hoje? então é esse preço;
-- senão, o preço base.
--
-- A diferença não é de estilo. O modelo antigo produzia três defeitos que
-- pareciam independentes e eram o mesmo:
--
--   - a rotina noturna de reversão só existia porque houve sobrescrita. Num
--     sistema real não se "reverte promoção": a regra deixa de valer e pronto;
--   - `data_inicio` no futuro não era respeitado, porque aprovar e aplicar
--     preço viraram o mesmo ato. Com vigência, aprovar é autorizar — a data
--     manda;
--   - duas ofertas no mesmo produto perdiam o preço de tabela original, porque
--     a segunda carimbava o preço promocional da primeira como "de".
--
-- Os três morrem aqui, sem código próprio.
--
-- ─── O que trava a ordem ────────────────────────────────────────────────────
-- `criar_venda_pdv` (migr. 554) confere o preço enviado pelo caixa contra
-- `produtos.preco` e recusa a venda se divergir. Hoje a sobrescrita é o que faz
-- a venda promocional passar. Se a liberação parar de sobrescrever sem que a
-- trava mude junto, TODA venda de item em oferta é recusada. Por isso as duas
-- coisas estão nesta mesma migração, junto com a devolução dos preços que já
-- foram sobrescritos.
--
-- ─── Onde mora a regra ──────────────────────────────────────────────────────
-- `promocao_vigente_do_produto()` é o único lugar que sabe o que é "uma oferta
-- valendo hoje". A view do PDV, o resolvedor de preço e a trava da venda todos
-- derivam dela — em vez de repetir o predicado em três lugares e ver os três
-- divergirem na próxima migração.
--
-- Promoção sem `data_fim` passa a valer por prazo indeterminado, que é o
-- comportamento real de uma remarcação sem fim previsto. Antes ela nunca
-- aparecia no PDV: a comparação com NULL derrubava a linha em silêncio.

BEGIN;

-- ─── 1. Devolver o que já foi sobrescrito ────────────────────────
-- ANTES de qualquer coisa, e com a régua antiga: só devolve se o preço vigente
-- ainda for exatamente o promocional. Se alguém remarcou à mão no meio do
-- caminho, a remarcação vale — não desfazemos decisão de quem estava lá.
UPDATE public.produtos p
   SET preco = m.preco_atual
  FROM public.marketing_promocoes m
 WHERE m.produto_id = p.id
   AND COALESCE(m.ativo, true)
   AND m.status = 'Aprovado'
   AND COALESCE(m.preco_atual, 0) > 0
   AND p.preco = m.preco_promocional;

-- Oferta aprovada cujo período já passou não é mais regra de nada: encerra,
-- como o cron faria. O preço dela já voltou no UPDATE acima.
UPDATE public.marketing_promocoes
   SET status = 'Encerrada'
 WHERE status = 'Aprovado'
   AND data_fim IS NOT NULL
   AND data_fim < public.acre_today();

-- ─── 2. A regra, num lugar só ────────────────────────────────────
-- Devolve a promoção que vale para o produto na data — ou nenhuma linha.
-- Entre duas ofertas sobrepostas vence a mais barata, que é a que o cliente
-- veria anunciada e a que ele vai cobrar no caixa.
CREATE OR REPLACE FUNCTION public.promocao_vigente_do_produto(
  p_produto_id uuid,
  p_data date DEFAULT NULL
)
 RETURNS SETOF public.marketing_promocoes
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.*
    FROM public.marketing_promocoes m
    JOIN public.produtos pr ON pr.id = m.produto_id
   WHERE m.produto_id = p_produto_id
     AND COALESCE(m.ativo, true)
     AND m.status = 'Aprovado'
     AND COALESCE(m.preco_promocional, 0) > 0
     -- Oferta que não baixa o preço não é oferta. Também é o que impede uma
     -- regra velha de "subir" o preço se a tabela baixou depois.
     AND m.preco_promocional < pr.preco
     AND COALESCE(p_data, public.acre_today()) >= COALESCE(m.data_inicio, COALESCE(p_data, public.acre_today()))
     AND COALESCE(p_data, public.acre_today()) <= COALESCE(m.data_fim,    COALESCE(p_data, public.acre_today()))
   ORDER BY m.preco_promocional ASC, m.data_fim ASC NULLS LAST, m.id
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.promocao_vigente_do_produto(uuid, date) IS
  'A oferta que vale para o produto na data (a mais barata, se houver mais de uma). Único lugar que define vigência — a view do PDV, preco_efetivo() e a trava de criar_venda_pdv derivam daqui.';

-- ─── 3. O preço que o caixa cobra ────────────────────────────────
CREATE OR REPLACE FUNCTION public.preco_efetivo(p_produto_id uuid, p_data date DEFAULT NULL)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT preco_promocional FROM public.promocao_vigente_do_produto(p_produto_id, p_data)),
    (SELECT preco             FROM public.produtos WHERE id = p_produto_id)
  );
$function$;

COMMENT ON FUNCTION public.preco_efetivo(uuid, date) IS
  'Preço de venda do produto na data: a oferta vigente, se houver; senão o preço de tabela. É o número que o PDV cobra e contra o qual a venda é conferida.';

-- ─── 4. O que o PDV lê ───────────────────────────────────────────
-- `preco_de` agora sai de `produtos.preco` VIVO, não mais do snapshot
-- `preco_atual`: com o preço base intocado, o "de" é o preço de tabela de
-- verdade, e não uma cópia que envelhece.
DROP VIEW IF EXISTS public.v_promocao_vigente;

CREATE VIEW public.v_promocao_vigente
WITH (security_invoker = false) AS
SELECT
  pr.id            AS produto_id,
  m.filial,
  pr.preco         AS preco_de,
  m.preco_promocional AS preco_por,
  m.data_inicio,
  m.data_fim,
  m.descricao
FROM public.produtos pr
CROSS JOIN LATERAL public.promocao_vigente_do_produto(pr.id) m
-- A loja online consulta esta view pelo service role, fora de qualquer sessão
-- de usuário: ali `auth_pode_filial` é NULL e recortaria tudo. O endpoint já
-- filtra a unidade na própria query (`.eq('filial', …)`), e a vitrine é
-- pública por natureza — o que não pode vazar daqui é custo, e custo não está
-- nesta view.
WHERE COALESCE(public.auth_is_service_role(), false)
   OR COALESCE(public.auth_pode_filial(m.filial), false);

COMMENT ON VIEW public.v_promocao_vigente IS
  'Ofertas valendo hoje, recortadas pela unidade de quem consulta. Sem preço de custo — é a fonte do de/por no PDV, no orçamento e na loja online.';

-- ─── 5. Liberar deixa de mexer no cadastro ───────────────────────
CREATE OR REPLACE FUNCTION public.aprovar_promocao(p_promocao_id uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo   public.marketing_promocoes;
  v_vigente boolean;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_promo FROM public.marketing_promocoes
   WHERE id = p_promocao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promoção não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- MIGR 576: a liberação é o SEGUNDO passo.
  IF v_promo.status = 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Falta o parecer do Financeiro — ele confere a margem antes de a unidade liberar o preço.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.status <> 'Em Análise' THEN
    RAISE EXCEPTION 'Só promoção analisada pelo Financeiro pode ser liberada (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 577: oferta cujo período já passou não se libera.
  IF v_promo.data_fim IS NOT NULL AND v_promo.data_fim < public.acre_today() THEN
    RAISE EXCEPTION 'O período desta oferta terminou em % — reprove e peça uma proposta com datas novas.',
      to_char(v_promo.data_fim, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  IF v_promo.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_promo.filial), false) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_promo.criado_por IS NOT NULL AND v_promo.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem propõe o desconto não aprova a própria promoção.'
        USING ERRCODE = '42501';
    END IF;
    IF v_promo.analisado_por IS NOT NULL AND v_promo.analisado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem deu o parecer não é quem libera — a revisão é da unidade que vai vender.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.auth_gerente_da(v_promo.filial), false) THEN
      RAISE EXCEPTION 'A liberação é do gerente da filial — o Financeiro analisa, a unidade libera.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.marketing_promocoes
     SET status = 'Aprovado', observacao = COALESCE(p_observacao, '')
   WHERE id = p_promocao_id;

  -- MIGR 578: NÃO se mexe mais em `produtos.preco`. A liberação autoriza a
  -- regra; quem decide se ela vale hoje é o calendário. Oferta que começa
  -- sexta passa a valer sexta, sozinha — e é isso que a tela precisa dizer,
  -- em vez do antigo "preço atualizado no PDV".
  SELECT EXISTS (SELECT 1 FROM public.promocao_vigente_do_produto(v_promo.produto_id))
    INTO v_vigente;

  RETURN jsonb_build_object(
    'promocao_id',  p_promocao_id,
    'status',       'Aprovado',
    'vigente_hoje', COALESCE(v_vigente, false),
    'data_inicio',  v_promo.data_inicio,
    'sem_prazo',    v_promo.data_fim IS NULL
  );
END;
$function$;

-- ─── 6. A reversão perde a razão de existir ──────────────────────
-- Não há mais preço para devolver: o cadastro nunca foi tocado. Mantida como
-- faxina do calendário — encerra o que venceu — e, principalmente, PARA de
-- escrever em `produtos`. Deixá-la como estava seria perigoso: ela casa
-- `preco = preco_promocional`, e um produto cujo preço de tabela por acaso
-- coincidisse com o de uma oferta velha teria o preço trocado por um
-- `preco_atual` de meses atrás.
CREATE OR REPLACE FUNCTION public.reverter_promocoes_expiradas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total INT := 0;
BEGIN
  PERFORM public._assert_rpc();

  WITH encerradas AS (
    UPDATE public.marketing_promocoes
       SET status = 'Encerrada'
     WHERE status = 'Aprovado'
       AND data_fim IS NOT NULL
       AND data_fim < public.acre_today()
    RETURNING 1
  )
  SELECT count(*) INTO total FROM encerradas;

  RETURN total;
END;
$function$;

COMMENT ON FUNCTION public.reverter_promocoes_expiradas() IS
  'MIGR 578: não devolve preço nenhum — o preço base nunca é sobrescrito. Só encerra a oferta cujo período passou, para ela sair das filas.';

-- ─── 7. A trava da venda passa a conferir o preço EFETIVO ────────
-- `criar_venda_pdv` tem 13 KB e uma linha a mudar. Reescrevê-la inteira aqui
-- convidaria o erro que a memória do projeto já registra: copiar do arquivo
-- antigo e perder o que migrações posteriores fizeram. Em vez disso a troca é
-- feita sobre a definição VIVA do banco, com âncora exata e asserção — se a
-- âncora não aparecer exatamente uma vez, a migração falha em vez de aplicar
-- pela metade.
DO $$
DECLARE
  v_def   text;
  v_velho text := 'SELECT preco, nome INTO v_preco_cat, v_nome_produto
      FROM public.produtos WHERE id = v_produto_id;';
  v_novo  text := 'SELECT public.preco_efetivo(id, v_today), nome INTO v_preco_cat, v_nome_produto
      FROM public.produtos WHERE id = v_produto_id;';
  v_msg_velha text := 'no catálogo está R$ %';
  v_msg_nova  text := 'o preço de venda de hoje é R$ %';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'criar_venda_pdv';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'criar_venda_pdv não encontrada — migração 554 ausente?';
  END IF;

  IF (length(v_def) - length(replace(v_def, v_velho, ''))) / length(v_velho) <> 1 THEN
    RAISE EXCEPTION 'A leitura de preço em criar_venda_pdv não está no formato esperado (âncora encontrada % vez(es)). Confira a definição vigente antes de aplicar.',
      (length(v_def) - length(replace(v_def, v_velho, ''))) / NULLIF(length(v_velho), 0);
  END IF;

  v_def := replace(v_def, v_velho, v_novo);
  v_def := replace(v_def, v_msg_velha, v_msg_nova);

  EXECUTE v_def;
END $$;

-- Conferência: a função tem de citar preco_efetivo e não pode mais ler o preço
-- cru do cadastro para conferir a venda.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'criar_venda_pdv';
  IF position('preco_efetivo' in v_def) = 0 THEN
    RAISE EXCEPTION 'A troca não pegou: criar_venda_pdv não chama preco_efetivo.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.promocao_vigente_do_produto(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preco_efetivo(uuid, date)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocao_vigente_do_produto(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preco_efetivo(uuid, date)               TO authenticated, service_role;

REVOKE ALL ON public.v_promocao_vigente FROM PUBLIC, anon;
GRANT SELECT ON public.v_promocao_vigente TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
