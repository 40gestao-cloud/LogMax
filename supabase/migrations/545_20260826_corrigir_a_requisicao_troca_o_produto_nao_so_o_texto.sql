-- 545 — Corrigir a requisição troca o produto, não só o texto.
--
-- `corrigir_requisicao_compra` grava `item`, `qtd`, `urgencia` e `centro_custo`.
-- Nunca tocou em `produto_id`. E a tela de Compras > Requisições corrige o item
-- por um <select> do CATÁLOGO (`handleProdutoChange` em RequisicoesView.tsx):
-- quem corrige escolhe outro produto, e a RPC recebe só o NOME dele.
--
-- O elo fica apontando para o item antigo. E o elo é quem manda daí para a
-- frente:
--
--   gerar_pedido_de_cotacao:  v_produto_id := COALESCE(v_req.produto_id, p_produto_id)
--   RecebimentosView:         o campo "Produto recebido" abre travado, com
--                             cadeado, dizendo "Definido no pedido, herdado da
--                             requisição"
--
-- Ou seja: o documento diz uma coisa, o pedido compra outra, e a entrada de
-- estoque vai no produto errado — sem nenhuma tela em que a divergência
-- apareça. O aluno que confere está fazendo o certo: ele lê o cadeado e confia.
--
-- ─── POR QUE ISTO NÃO É "SÓ VALIDAR NA TELA" ───────────────────────────────
--
-- Porque a tela não tem como consertar: ela não tem parâmetro para mandar o
-- produto. A assinatura da RPC é a régua, e a régua não previa a troca. Trocar
-- item é trocar o que o gerente autorizou comprar — a própria função já sabe
-- disso e reabre a aprovação quando `item` ou `qtd` mudam (`v_reabre`). Trocar
-- o PRODUTO é a mesma decisão, com mais consequência ainda, e passava calado.
--
-- ─── O QUE ENTRA NA ASSINATURA, E POR QUE DOIS PARÂMETROS ──────────────────
--
--   p_produto_id uuid    — o produto do catálogo, ou NULL
--   p_vincula    boolean — "eu estou de fato decidindo o vínculo"
--
-- Dois, e não um, porque NULL é ambíguo: "não mandei nada" (chamada antiga, PWA
-- com bundle velho em cache) e "escolhi Outro (digitar), este item não está no
-- catálogo" são coisas opostas. Com a flag, a chamada antiga preserva o vínculo
-- e a nova decide. Mesmo desenho de `app.cotacao_correcao` na migr. 467: quando
-- a ausência de valor significa duas coisas, o sinal vem separado do valor.
--
-- DROP + CREATE, e não CREATE OR REPLACE: parâmetro novo com DEFAULT criaria uma
-- SEGUNDA função e o PostgREST não saberia qual chamar (migr.
-- feedback: DROP exige a assinatura vigente). Como os dois novos têm DEFAULT, a
-- tela antiga — a que ainda estiver em cache no navegador do aluno quando esta
-- migração rodar — continua chamando com 5 argumentos nomeados e funcionando
-- exatamente como antes.
--
-- ─── AS VALIDAÇÕES SÃO AS DA vincular_produto_requisicao ───────────────────
--
-- Mesma porta, mesmo porteiro: catálogo da própria unidade, produto ativo, e
-- patrimônio recusado aqui em vez de travar lá na frente no Gerar Pedido
-- (migr. 515). Escrever régua diferente nas duas portas é como este defeito
-- nasceu.
--
-- Desamarrar (p_vincula = true, p_produto_id = NULL) é permitido na compra
-- EVENTUAL — o item volta a ser texto livre e o Gerar Pedido volta a perguntar
-- qual é. Na REPOSIÇÃO não: reposição É o vínculo com o catálogo, sem ele o
-- documento não é mais uma reposição.
--
-- ─── O QUE ESTA MIGRAÇÃO NÃO CONSERTA ──────────────────────────────────────
--
-- Nada nos dados. Na ERP em 26/08 havia 10 requisições com `item` diferente do
-- nome do produto vinculado, e NENHUMA foi corrigida aqui — nove delas são
-- legítimas: vieram do cadastro que atende a requisição (migr. 494), onde o
-- texto livre do solicitante ("Camisa de Linho Masculina- Foxton") e o nome do
-- cadastro ("Camisa de Linho Masculina") divergem de propósito. Um palpite
-- automático estragaria as nove para consertar a décima.
--
-- A décima é a REQ-TM-2026-0105 (TechMax, Aprovado, sem pedido): pede
-- "Chromebook 14″ Full HD" e aponta para "Webcam C920 Pro HD 1080p". Depois
-- desta migração ela se conserta pela tela, que é o ponto. Para achar as
-- próximas:
--
--   SELECT r.numero, r.item, pr.nome, r.status
--     FROM requisicoes r JOIN produtos pr ON pr.id = r.produto_id
--    WHERE COALESCE(r.ativo, true) AND r.status IN ('Pendente','Aprovado')
--      AND lower(btrim(r.item)) <> lower(btrim(pr.nome));
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- A assinatura vigente, exata. Se algum projeto estiver atrás, o DROP não acha
-- e o IF EXISTS deixa passar — o CREATE abaixo cria a versão nova de qualquer
-- jeito.
DROP FUNCTION IF EXISTS public.corrigir_requisicao_compra(uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.corrigir_requisicao_compra(
  p_id           uuid,
  p_item         text,
  p_qtd          numeric,
  p_urgencia     text    DEFAULT NULL::text,
  p_centro_custo text    DEFAULT NULL::text,
  p_produto_id   uuid    DEFAULT NULL::uuid,
  p_vincula      boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req        requisicoes;
  v_prod       produtos;
  v_prod_novo  uuid;
  v_troca_prod boolean := false;
  v_reabre     boolean := false;
  v_cot        text;
  v_nome       text;
  v_ap_id      uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Descreva o item solicitado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

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

  -- ── MIGR 545: o vínculo com o catálogo ────────────────────────────────────
  -- Sem a flag, a chamada é a antiga: preserva o que estava lá.
  v_prod_novo  := CASE WHEN p_vincula THEN p_produto_id ELSE v_req.produto_id END;
  v_troca_prod := p_vincula AND (v_prod_novo IS DISTINCT FROM v_req.produto_id);

  IF v_troca_prod THEN
    IF v_req.servico_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta requisição é de um SERVIÇO contratado. Produto e serviço não se trocam um pelo outro no meio do fluxo — negue esta e abra a certa.'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_prod_novo IS NULL THEN
      IF COALESCE(v_req.tipo_requisicao, '') = 'Reposição' THEN
        RAISE EXCEPTION 'Reposição É o vínculo com o catálogo: sem produto ela deixa de ser uma reposição. Escolha outro produto, ou negue esta requisição e abra uma Compra eventual.'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- Mesmas checagens de `vincular_produto_requisicao` (migr. 494/515).
      SELECT * INTO v_prod FROM public.produtos WHERE id = v_prod_novo;
      IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE
         OR COALESCE(v_prod.status, 'Ativo') = 'Inativo' THEN
        RAISE EXCEPTION 'Produto não encontrado ou inativo. Um cadastro excluído não pode ser comprado — reative-o em Cadastros > Lixeira, ou escolha outro.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_prod.filial IS DISTINCT FROM v_req.filial THEN
        RAISE EXCEPTION 'O produto "%" é do catálogo da %, e esta requisição é da %. Amarrar no produto da vizinha faria a entrada do recebimento mexer no estoque dela.',
          v_prod.nome, v_prod.filial, v_req.filial USING ERRCODE = 'P0001';
      END IF;
      IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
        RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e bem não entra pelo fluxo de compra: ele não tem saldo de estoque, então o Gerar Pedido recusaria. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado. Se este cadastro é mercadoria ou material de consumo, corrija o Tipo dele em Cadastros > Produtos.',
          v_prod.nome USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- Item, quantidade e agora o PRODUTO são a decisão do gerente. Trocar o
  -- centro de custo ou a urgência não muda o que ele autorizou comprar.
  v_reabre := v_req.status = 'Aprovado'
              AND (trim(p_item) IS DISTINCT FROM v_req.item
                   OR p_qtd IS DISTINCT FROM v_req.qtd
                   OR v_troca_prod);

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
        'Já existe cotação em andamento para esta requisição. Cancele a cotação antes de mudar o item, o produto ou a quantidade.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.requisicoes
     SET item         = trim(p_item),
         qtd          = p_qtd,
         urgencia     = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         centro_custo = NULLIF(trim(COALESCE(p_centro_custo, '')), ''),
         produto_id   = v_prod_novo,
         status       = CASE WHEN v_reabre THEN 'Pendente' ELSE status END
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  IF v_reabre THEN
    SELECT id INTO v_ap_id FROM public.aprovacoes_compras
     WHERE requisicao_id = v_req.id
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;

    IF v_ap_id IS NULL THEN
      INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
      VALUES (v_req.id, 'Pendente', v_req.filial);
    ELSE
      UPDATE public.aprovacoes_compras
         SET status     = 'Pendente',
             aprovador  = NULL,
             observacao = format('Reaberta: %s corrigiu o item, o produto ou a quantidade após a aprovação.',
                                 COALESCE(v_nome, 'Compras'))
       WHERE id = v_ap_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'requisicao',     to_jsonb(v_req),
    'reaberta',       v_reabre,
    'produto_trocado', v_troca_prod
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_requisicao_compra(uuid, text, numeric, text, text, uuid, boolean) TO authenticated;

COMMIT;

-- Assinatura nova: sem isto o PostgREST devolve PGRST202 no primeiro Salvar.
NOTIFY pgrst, 'reload schema';
