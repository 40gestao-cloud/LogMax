-- Oferta vencida não se libera, e a ordem dos passos vira regra do banco.
--
-- Dois furos que sobraram da migr. 576, achados auditando a cadeia nova.
--
-- 1) NADA olhava a data na hora de decidir.
--
--    `aprovar_promocao` conferia status, filial e autoria, mas não o período.
--    Com uma oferta cujo `data_fim` já passou, o gerente conseguia liberar
--    hoje: `produtos.preco` mudava na hora, e a `v_promocao_vigente` — que
--    filtra `acre_today() <= data_fim` — não mostrava oferta nenhuma. Ou seja,
--    produto com preço trocado e nada na tela explicando por quê, até o cron
--    da madrugada desfazer. É o pior desenlace possível para a aula: o preço
--    muda e ninguém consegue apontar de onde veio.
--
--    Isto não é hipótese. Na turma logmax-aprendiz existem 4 ofertas paradas
--    em 'Aguardando Aprovação' com `data_fim = 2026-08-30` (manteiga, arroz,
--    atum, feijão — todas da SuperMax), esperando o parecer desde 27/08.
--
--    O MaxPOS, que é onde a turma treina, já recusava: a `aprovar_promocao` de
--    lá tem o `end_date < hoje_operacao()`. Os dois sistemas precisam ensinar a
--    mesma coisa.
--
--    A saída da oferta vencida é `reprovar_promocao`, que continua aceitando os
--    dois status em curso e não olha data de propósito: quem barra escreve
--    'período vencido' e o marketing propõe de novo com datas novas. Sem prazo
--    (`data_fim IS NULL`) não vence e não é afetada.
--
-- 2) A ordem dos passos só existia dentro das RPCs.
--
--    A `promocao_decisao_guard` cobra QUEM decide, mas não em que ordem. Um
--    gerente com PostgREST na mão dava PATCH em `status='Aprovado'` direto na
--    linha recém-proposta: pulava o parecer do Financeiro (que é a razão de
--    existir da 576) e ainda deixava a promoção 'Aprovado' sem que o preço do
--    produto mudasse, porque quem troca o preço é a RPC, não o UPDATE.
--
--    Agora a trigger cobra a escada — 'Aguardando Aprovação' → 'Em Análise' →
--    'Aprovado' — e a mesma conferência de período. As RPCs continuam sendo a
--    porta de entrada e as donas das mensagens boas; a trigger é o cinto.
--
-- Como no resto do sistema, o admin/professor atravessa as regras de AUTORIDADE
-- (quem pode decidir), mas não as de ESTADO (ordem e período) — igual à 576,
-- onde a checagem de status já valia para todo mundo.

BEGIN;

-- ─── Passo 1: o parecer também olha o calendário ─────────────
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

  -- MIGR 577: não se analisa a margem de uma oferta que já não pode valer.
  IF v_promo.data_fim IS NOT NULL AND v_promo.data_fim < public.acre_today() THEN
    RAISE EXCEPTION 'O período desta oferta terminou em % — reprove com esse motivo e proponha de novo com datas novas.',
      to_char(v_promo.data_fim, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
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

  -- Margem sobre a venda, com o custo carimbado na própria proposta (migr. 576).
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

-- ─── Passo 2: o gerente não libera preço fora do prazo ───────
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

  -- MIGR 576: a liberação é o SEGUNDO passo.
  IF v_promo.status = 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Falta o parecer do Financeiro — ele confere a margem antes de a unidade liberar o preço.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.status <> 'Em Análise' THEN
    RAISE EXCEPTION 'Só promoção analisada pelo Financeiro pode ser liberada (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 577: liberar oferta vencida trocava o preço do produto sem que a
  -- oferta aparecesse no PDV — a `v_promocao_vigente` filtra por `data_fim`.
  IF v_promo.data_fim IS NOT NULL AND v_promo.data_fim < public.acre_today() THEN
    RAISE EXCEPTION 'O período desta oferta terminou em % — liberar agora trocaria o preço sem oferta nenhuma no caixa. Reprove e peça uma proposta com datas novas.',
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

  -- O preço é a razão de existir da aprovação. Promoção de serviço não tem
  -- produto e não muda preço nenhum — caso previsto, não falha.
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

-- ─── A trigger passa a cobrar a ordem e o prazo ──────────────
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

  -- MIGR 577: ESTADO vale para todo mundo, admin inclusive — é a mesma régua
  -- que a checagem de status da 576 já seguia.
  --
  -- A escada da cadeia, na ordem: propõe → parecer → libera. Sem isto, um PATCH
  -- direto em `status` pulava o Financeiro e ainda deixava 'Aprovado' sem o
  -- preço do produto ter mudado, porque quem troca o preço é a RPC.
  IF NEW.status = 'Em Análise' AND OLD.status <> 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Só oferta recém-proposta vai para análise (esta está %).', OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'Aprovado' AND OLD.status <> 'Em Análise' THEN
    RAISE EXCEPTION 'A liberação vem depois do parecer do Financeiro (esta está %).', OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'Reprovado' AND OLD.status NOT IN ('Aguardando Aprovação', 'Em Análise') THEN
    RAISE EXCEPTION 'Só promoção em curso pode ser reprovada (esta está %).', OLD.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Período: barra analisar e liberar, nunca reprovar — reprovar é a saída da
  -- oferta que venceu esperando decisão.
  IF NEW.status IN ('Em Análise', 'Aprovado')
     AND NEW.data_fim IS NOT NULL
     AND NEW.data_fim < public.acre_today() THEN
    RAISE EXCEPTION 'O período desta oferta terminou em % — reprove e proponha de novo com datas novas.',
      to_char(NEW.data_fim, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
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

COMMIT;

NOTIFY pgrst, 'reload schema';
