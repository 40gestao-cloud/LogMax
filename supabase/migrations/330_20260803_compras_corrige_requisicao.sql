-- 330 — Compras corrige a requisição, e corrigir o que já foi aprovado reabre
-- a aprovação.
--
-- A tela de Requisições de Compra sempre disse "aqui Compras confere, corrige e
-- leva para cotação", mas o botão de editar só existia enquanto o documento
-- estava 'Pendente' — ou seja, some no instante em que o gerente aprova, que é
-- justamente quando Compras vai trabalhar nele. Na prática não havia correção
-- nenhuma: a tela prometia e não entregava.
--
-- O motivo da trava era legítimo. O item da requisição é texto livre de
-- propósito (migr. 283: quem pede descreve a necessidade, casar com o catálogo
-- é trabalho de Compras), então corrigir depois da aprovação mexe exatamente no
-- que o gerente aprovou. Deixar Compras trocar item ou quantidade em silêncio
-- transformaria a aprovação num carimbo: aprova-se 5 e compra-se 50.
--
-- A saída é a do ERP de verdade: corrigir pode, e mudar o que foi decidido
-- devolve o documento para quem decide. Urgência e centro de custo não reabrem
-- nada — não são a decisão.
--
-- Por que RPC e não dois UPDATE na tela: reabrir são duas escritas (requisição
-- e aprovação) que só fazem sentido juntas. Se a segunda falhasse, a requisição
-- voltaria a 'Pendente' com a aprovação ainda decidida — sem card em Aprovações
-- e sem caminho de saída, exatamente o tipo de documento travado que esta tela
-- acabou de parar de produzir.

BEGIN;

CREATE OR REPLACE FUNCTION public.corrigir_requisicao_compra(
  p_id           uuid,
  p_item         text,
  p_qtd          integer,
  p_urgencia     text DEFAULT NULL,
  p_centro_custo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      requisicoes;
  v_reabre   boolean := false;
  v_cot      text;
  v_nome     text;
  v_ap_id    uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Descreva o item solicitado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    RAISE EXCEPTION 'A quantidade precisa ser pelo menos 1.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesma régua da policy compras_update: quem executa a compra, o gerente da
  -- filial, ou a Matriz.
  IF NOT (public.auth_is_admin()
          OR public.auth_in_setor('compras')
          OR public.auth_gerente_da(v_req.filial)) THEN
    RAISE EXCEPTION 'Só Compras ou o gerente da filial corrige a requisição.'
      USING ERRCODE = '42501';
  END IF;

  IF v_req.status NOT IN ('Pendente', 'Aprovado') THEN
    RAISE EXCEPTION
      'Requisição % não pode ser corrigida: já está %. Depois de virar pedido a correção é no pedido; negada, quem reabre é o setor solicitante.',
      v_req.item, v_req.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Só item e quantidade são a decisão do gerente. Trocar o centro de custo ou
  -- a urgência não muda o que ele autorizou comprar.
  v_reabre := v_req.status = 'Aprovado'
              AND (trim(p_item) IS DISTINCT FROM v_req.item
                   OR p_qtd IS DISTINCT FROM v_req.qtd);

  IF v_reabre THEN
    -- Cotação viva nasceu do item antigo. Reabrir por baixo dela deixaria o
    -- Financeiro decidindo o preço de uma coisa que já não é a pedida.
    SELECT c.id::text INTO v_cot
      FROM public.cotacoes c
     WHERE c.requisicao_id = v_req.id
       AND COALESCE(c.ativo, true)
       AND c.status IN ('Aguardando Financeiro', 'Aprovado')
     LIMIT 1;

    IF v_cot IS NOT NULL THEN
      RAISE EXCEPTION
        'Já existe cotação em andamento para esta requisição. Cancele a cotação antes de mudar o item ou a quantidade.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.requisicoes
     SET item         = trim(p_item),
         qtd          = p_qtd,
         urgencia     = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         centro_custo = NULLIF(trim(COALESCE(p_centro_custo, '')), ''),
         status       = CASE WHEN v_reabre THEN 'Pendente' ELSE status END
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  IF v_reabre THEN
    SELECT id INTO v_ap_id FROM public.aprovacoes_compras
     WHERE requisicao_id = v_req.id
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;

    IF v_ap_id IS NULL THEN
      -- Requisição sem linha de aprovação não tem tela onde ser decidida.
      -- Acontece com registro vindo de seed ou importação; criar a linha aqui
      -- é mais barato que deixá-la presa em 'Pendente' para sempre.
      INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
      VALUES (v_req.id, 'Pendente', v_req.filial);
    ELSE
      UPDATE public.aprovacoes_compras
         SET status     = 'Pendente',
             aprovador  = NULL,
             observacao = format('Reaberta: %s corrigiu o item ou a quantidade após a aprovação.',
                                 COALESCE(v_nome, 'Compras'))
       WHERE id = v_ap_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('requisicao', to_jsonb(v_req), 'reaberta', v_reabre);
END;
$function$;

-- A função nasceria com EXECUTE para PUBLIC, desfazendo em silêncio o lockdown
-- das migr. 260/261.
REVOKE ALL ON FUNCTION public.corrigir_requisicao_compra(uuid, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_requisicao_compra(uuid, text, integer, text, text)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- 1) Uma assinatura só:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'corrigir_requisicao_compra';
--
--   -- 2) Corrigir urgência de uma aprovada NÃO reabre; trocar a quantidade sim:
--   --    o retorno traz "reaberta": true e a linha volta para Aprovações.
