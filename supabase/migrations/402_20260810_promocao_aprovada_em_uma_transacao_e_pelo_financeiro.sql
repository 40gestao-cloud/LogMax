-- =================================================================
-- 402 — A promoção passa a ser aprovada numa transação só, e pelo
--       Financeiro de verdade.
--
-- Auditoria do fluxo de aula "Promoção aprovada chega ao PDV". O fluxo
-- existe para ensinar que marketing não decide preço sozinho. Duas
-- coisas desmentiam isso.
--
-- (1) APROVAR ERAM DUAS ESCRITAS SOLTAS, SEM ROLLBACK
--     A tela fazia `dbUpdate` na promoção (status 'Aprovado') e depois
--     `dbUpdate` no produto (preço promocional). Se a segunda falhasse,
--     a promoção ficava APROVADA com o preço velho — e o `catch {}`
--     engolia o motivo. Pior: a linha só saía da fila no caminho feliz,
--     então a tela seguia mostrando "aguardando" enquanto o banco já
--     dizia "Aprovado". No primeiro F5 ela sumia da fila e ninguém mais
--     voltava a olhar. O PDV continuava com o preço antigo, em silêncio.
--
-- (2) A SEGUNDA AUTORIDADE MORAVA NO MENU
--     `mkt_update` libera marketing OU financeiro, e `update_produtos`
--     cobra só a filial. Quer dizer: o próprio marketing aprovava a
--     própria promoção e mexia no preço — a separação era só o fato de
--     o submenu de aprovação estar pendurado no Financeiro. Organização
--     de tela não é controle.
--
-- Como fica:
--   • `aprovar_promocao` / `reprovar_promocao`: status e preço na mesma
--     transação, com a régua no banco.
--   • `trg_promocao_decisao_guard`: qualquer caminho que mova o status
--     para Aprovado/Reprovado — RPC, tela, F12 — passa pela mesma
--     checagem. É a trigger que fecha, a RPC só chega antes com uma
--     mensagem melhor.
--   • Quem PROPÔS não aprova, nem sendo do Financeiro. Mesma régua da
--     requisição de compra (282) e da de material (399). Admin (o
--     professor) segue isento, para destravar a turma.
--
-- Promoção sem `produto_id` (serviço) é aprovada sem tocar em preço
-- nenhum — e a RPC devolve isso, para a tela parar de anunciar "preço
-- atualizado no PDV" quando não atualizou nada.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. A régua, onde ela fecha ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promocao_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só a transição para decidida interessa. Editar texto, data ou preço
  -- proposto continua livre para o marketing.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Reprovado') THEN
    RETURN NEW;
  END IF;

  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem propõe o desconto não aprova a própria promoção.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(
       public.auth_in_setor('financeiro')
       OR public.auth_gerente_da(NEW.filial), false) THEN
    RAISE EXCEPTION 'Só o Financeiro (ou o gerente da filial) decide promoção — marketing propõe.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promocao_decisao_guard ON public.marketing_promocoes;
CREATE TRIGGER trg_promocao_decisao_guard
  BEFORE UPDATE ON public.marketing_promocoes
  FOR EACH ROW EXECUTE FUNCTION public.promocao_decisao_guard();

-- ── 2. Aprovar: status e preço juntos ou nada ─────────────────────
CREATE OR REPLACE FUNCTION public.aprovar_promocao(
  p_promocao_id uuid,
  p_observacao  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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
  IF v_promo.status <> 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Só promoção aguardando aprovação pode ser decidida (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.filial IS NOT NULL AND NOT public.auth_pode_filial(v_promo.filial) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- A trigger cobra o mesmo no UPDATE abaixo; aqui é para a mensagem
  -- chegar antes de qualquer linha se mexer.
  IF NOT public.auth_is_admin() THEN
    IF v_promo.criado_por IS NOT NULL AND v_promo.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem propõe o desconto não aprova a própria promoção.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(
         public.auth_in_setor('financeiro')
         OR public.auth_gerente_da(v_promo.filial), false) THEN
      RAISE EXCEPTION 'Só o Financeiro (ou o gerente da filial) decide promoção — marketing propõe.'
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
$$;

CREATE OR REPLACE FUNCTION public.reprovar_promocao(
  p_promocao_id uuid,
  p_observacao  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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
  IF v_promo.status <> 'Aguardando Aprovação' THEN
    RAISE EXCEPTION 'Só promoção aguardando aprovação pode ser decidida (esta está %).',
      v_promo.status USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.filial IS NOT NULL AND NOT public.auth_pode_filial(v_promo.filial) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Reprovar não mexe em preço: a trigger é quem cobra a autoridade.
  UPDATE public.marketing_promocoes
     SET status = 'Reprovado', observacao = p_observacao
   WHERE id = p_promocao_id;

  RETURN jsonb_build_object('promocao_id', p_promocao_id, 'status', 'Reprovado');
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_promocao(uuid, text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reprovar_promocao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_promocao(uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprovar_promocao(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- marketing tentando aprovar a própria proposta: 42501
--   UPDATE marketing_promocoes SET status = 'Aprovado' WHERE id = '<a sua>';
--
--   -- aprovada pelo Financeiro: preço do produto muda na mesma transação
--   SELECT p.preco, m.preco_promocional, m.status
--     FROM marketing_promocoes m JOIN produtos p ON p.id = m.produto_id
--    WHERE m.id = '<promocao>';
