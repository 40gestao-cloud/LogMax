-- A oferta passa pelo Financeiro antes do gerente.
--
-- Até aqui a promoção tinha UM passo de decisão: quem chegasse primeiro entre
-- o Financeiro e o gerente da filial aprovava, e a aprovação já trocava o
-- preço no PDV. Na loja de verdade a cadeia tem dois passos e eles não são
-- intercambiáveis:
--
--   Marketing  — desenha a oferta (queima de estoque, sazonalidade, isca).
--   Financeiro — diz se cabe: olha o custo da mercadoria e a margem que sobra,
--                ou assume o desconto como verba de marketing.
--   Gerente    — revisa e libera: é a unidade que vai vender por esse preço.
--   PDV        — só bipa. O preço chega pronto.
--
-- Esta migração separa os dois passos. O parecer do Financeiro vira uma etapa
-- com registro próprio (quem analisou, quando, qual a margem resultante e o
-- texto do parecer) e a promoção fica em 'Em Análise'. Só de lá o gerente
-- aprova — e só a aprovação dele troca o preço.
--
-- A margem é calculada no banco, com o custo do produto no momento do parecer:
-- é a conta que o Financeiro faria na mão, e guardá-la explica a decisão
-- depois que o custo tiver mudado. Margem NEGATIVA não bloqueia — existe
-- oferta que se assume como custo de marketing —, mas fica escrita: o gerente
-- lê o número antes de liberar, e é isso que a aula quer mostrar.
--
-- Quem propôs continua sem poder decidir (a regra já existia e vale nos dois
-- passos). O admin/professor atravessa, como em todo o resto do sistema.

BEGIN;

ALTER TABLE public.marketing_promocoes
  ADD COLUMN IF NOT EXISTS parecer_financeiro  text,
  ADD COLUMN IF NOT EXISTS margem_pct          numeric(6,2),
  ADD COLUMN IF NOT EXISTS analisado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS analisado_por_nome  text,
  ADD COLUMN IF NOT EXISTS analisado_em        timestamptz;

COMMENT ON COLUMN public.marketing_promocoes.margem_pct IS
  'Margem sobre a venda que sobra no preço promocional, calculada no parecer do Financeiro. Negativa = oferta assumida como custo.';

-- ─── Passo 1: o parecer do Financeiro ────────────────────────
CREATE OR REPLACE FUNCTION public.analisar_promocao_financeiro(
  p_promocao_id uuid,
  p_parecer text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo  public.marketing_promocoes;
  v_custo  numeric(15,2);
  v_margem numeric(6,2);
  v_nome   text;
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE(length(trim(p_parecer)), 0) < 5 THEN
    RAISE EXCEPTION 'Escreva o parecer: é ele que o gerente lê antes de liberar o preço.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM public.marketing_promocoes
   WHERE id = p_promocao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promoção não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status <> 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Só promoção recém-proposta vai para análise (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_promo.filial), false) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_promo.criado_por IS NOT NULL AND v_promo.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem propõe a oferta não dá o próprio parecer.' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.auth_in_setor('financeiro'), false) THEN
      RAISE EXCEPTION 'O parecer de viabilidade é do Financeiro — é ele que responde pela margem.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Margem sobre a venda. O custo vem da PRÓPRIA promoção: a tela do marketing
  -- já o carimba na proposta (`preco_custo`, vindo da view de custo médio), e é
  -- esse o número sobre o qual a oferta foi desenhada. Ir buscar o custo de
  -- agora faria o parecer falar de uma conta diferente da que está na tela.
  -- Sem custo (promoção de serviço, ou produto que nunca foi comprado) a
  -- margem fica em branco e o parecer é só o texto — que continua obrigatório.
  v_custo := NULLIF(COALESCE(v_promo.preco_custo, 0), 0);
  IF v_custo IS NOT NULL AND COALESCE(v_promo.preco_promocional, 0) > 0 THEN
    v_margem := ROUND(((v_promo.preco_promocional - v_custo) / v_promo.preco_promocional) * 100, 2);
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.marketing_promocoes
     SET status             = 'Em Análise',
         parecer_financeiro = trim(p_parecer),
         margem_pct         = v_margem,
         analisado_por      = auth.uid(),
         analisado_por_nome = COALESCE(v_nome, 'Financeiro'),
         analisado_em       = now()
   WHERE id = p_promocao_id;

  RETURN jsonb_build_object(
    'promocao_id', p_promocao_id,
    'status',      'Em Análise',
    'margem_pct',  v_margem,
    'custo',       v_custo
  );
END;
$function$;

-- ─── Passo 2: o gerente revisa e o preço muda ────────────────
CREATE OR REPLACE FUNCTION public.aprovar_promocao(p_promocao_id uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo public.marketing_promocoes;
  v_mexeu boolean := false;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_promo FROM public.marketing_promocoes
   WHERE id = p_promocao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promoção não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- MIGR 576: a liberação é o SEGUNDO passo. Sem o parecer do Financeiro o
  -- gerente estaria liberando um preço que ninguém conferiu contra o custo.
  IF v_promo.status = 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Falta o parecer do Financeiro — ele confere a margem antes de a unidade liberar o preço.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.status <> 'Em Análise' THEN
    RAISE EXCEPTION 'Só promoção analisada pelo Financeiro pode ser liberada (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_promo.filial), false) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- A trigger cobra o mesmo no UPDATE abaixo; aqui é para a mensagem
  -- chegar antes de qualquer linha se mexer.
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

  -- O preço é a razão de existir da aprovação: se ele não mudar, a
  -- aprovação não pode ficar de pé. Promoção de serviço não tem produto
  -- e não muda preço nenhum — isso é caso previsto, não falha.
  IF v_promo.produto_id IS NOT NULL AND COALESCE(v_promo.preco_promocional, 0) > 0 THEN
    UPDATE public.produtos
       SET preco = v_promo.preco_promocional
     WHERE id = v_promo.produto_id;
    v_mexeu := FOUND;

    IF NOT v_mexeu THEN
      RAISE EXCEPTION 'Produto da promoção não encontrado — a aprovação não seria aplicada no PDV.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'promocao_id',    p_promocao_id,
    'status',         'Aprovado',
    'preco_alterado', v_mexeu,
    'sem_prazo',      v_promo.data_fim IS NULL
  );
END;
$function$;

-- ─── Reprovar: cabe nos dois passos ──────────────────────────
CREATE OR REPLACE FUNCTION public.reprovar_promocao(p_promocao_id uuid, p_observacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo public.marketing_promocoes;
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE(trim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Reprovar exige justificativa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM public.marketing_promocoes
   WHERE id = p_promocao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promoção não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- MIGR 576: o Financeiro pode barrar na análise e o gerente pode barrar na
  -- revisão. Os dois usam esta porta.
  IF v_promo.status NOT IN ('Aguardando Aprovação', 'Em Análise') THEN
    RAISE EXCEPTION 'Só promoção em curso pode ser reprovada (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_promo.filial), false) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Reprovar não mexe em preço: a trigger é quem cobra a autoridade.
  UPDATE public.marketing_promocoes
     SET status = 'Reprovado', observacao = p_observacao
   WHERE id = p_promocao_id;

  RETURN jsonb_build_object('promocao_id', p_promocao_id, 'status', 'Reprovado');
END;
$function$;

-- ─── A trigger acompanha os dois passos ──────────────────────
CREATE OR REPLACE FUNCTION public.promocao_decisao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só as transições de decisão interessam. Editar texto, data ou preço
  -- proposto continua livre para o marketing.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Em Análise', 'Aprovado', 'Reprovado') THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem propõe o desconto não decide a própria promoção.'
      USING ERRCODE = '42501';
  END IF;

  -- MIGR 576: cada passo tem o seu dono.
  IF NEW.status = 'Em Análise' THEN
    IF NOT COALESCE(public.auth_in_setor('financeiro'), false) THEN
      RAISE EXCEPTION 'O parecer de viabilidade é do Financeiro.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.status = 'Aprovado' THEN
    IF NOT COALESCE(public.auth_gerente_da(NEW.filial), false) THEN
      RAISE EXCEPTION 'A liberação da oferta é do gerente da filial.' USING ERRCODE = '42501';
    END IF;
  ELSE -- Reprovado
    IF NOT COALESCE(
         public.auth_in_setor('financeiro')
         OR public.auth_gerente_da(NEW.filial), false) THEN
      RAISE EXCEPTION 'Só o Financeiro ou o gerente da filial reprova uma oferta.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.analisar_promocao_financeiro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analisar_promocao_financeiro(uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
