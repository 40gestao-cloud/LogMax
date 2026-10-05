-- MIGR 677 — as portas laterais que a 676 deixou abertas.
--
-- Auditoria de 05/10, depois do caso do Óleo Liza x Soya (migr. 676). Provado
-- com o JWT de um aluno de Logística da turma ERP, em transação revertida:
--
--   1. `vincular_produto_requisicao` (a "Origem deste cadastro", migr. 494)
--      ligava a requisição do Soya ao 028 Liza — aceitava QUALQUER produto
--      ativo da unidade. Ligada, a requisição passa direto pelo Gerar Pedido
--      (`v_do_modal` falso), e o pedido saiu no 028. A régua da 627/676 era
--      contornada pelo F12.
--   2. A marca do 010 (Leite UHT, com saldo e pedidos recebidos) foi trocada de
--      Piracanjuba para Italac por UPDATE comum. Todo o histórico de entradas
--      passa a ser de outra marca, sem movimento que explique.
--   3. O índice de nome único (migr. 535) comparava só `lower(btrim(nome))`:
--      "Achocolatado em Pó 400g Toddy" e "…400g-Toddy" conviviam na Aprendiz,
--      com o estoque partido em dois.
--
-- O QUE MUDA
--   • vincular_produto_requisicao: com marca pedida (proposta aprovada, senão
--     a requisição), o produto tem de ser dessa marca — pela coluna, ou pelo
--     nome quando a coluna está vazia. O NOME não é conferido: o cadastro da
--     origem tem o "Refinar nome", e corrigir a grafia é legítimo.
--   • fn_produto_marca_imutavel_com_uso: produto com saldo, movimento ou
--     pedido vivo não troca de marca. Preencher marca em branco e acertar
--     caixa/espaço ("União " → "União") seguem livres. Professor (admin
--     literal) e service_role passam — é quem conserta base.
--   • uq_produtos_nome_filial_ativo passa a comparar `nome_item_normalizado`
--     (acento, caixa, espaço e pontuação). Mesmo nome de índice: a frase em
--     src/hooks/useSupabaseData.ts continua valendo. Se uma turma tiver
--     duplicata, a migração para antes de derrubar o índice antigo.
--
-- Cópia do banco: vincular_produto_requisicao md5 a862212339f599d31a7b3c9c2b3823bc
-- nos 4 em 05/10; só o bloco "MIGR 677" e a variável v_marca são novos.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ═══ 1. Vínculo pela Origem confere a marca ════════════════════════════════

CREATE OR REPLACE FUNCTION public.vincular_produto_requisicao(p_requisicao_id uuid, p_produto_id uuid)
 RETURNS requisicoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req  public.requisicoes;
  v_prod public.produtos;
  v_marca text;
  v_marca_norm text;
BEGIN
  -- Mesmo papel de `gerar_pedido_de_cotacao`: quem amarra o texto livre ao
  -- catálogo é quem compra. Admin/CEO passam por dentro de auth_in_setor.
  PERFORM public._assert_rpc('compras', 'logistica');

  SELECT * INTO v_req FROM public.requisicoes WHERE id = p_requisicao_id FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- COALESCE: `auth_pode_filial` é `auth_is_admin() OR auth_user_filial() = X`,
  -- e conta sem alocação (migr. 411) tem filial NULL — o OR devolve NULL, e
  -- `IF NOT NULL` não entra no bloco. Sem isto o guard passa batido justamente
  -- para quem não tem unidade nenhuma.
  IF NOT COALESCE(public.auth_pode_filial(v_req.filial), false) THEN
    RAISE EXCEPTION 'Requisição de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_req.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Requisição excluída não recebe vínculo.' USING ERRCODE = 'P0001';
  END IF;
  -- Atendida já virou pedido: o vínculo dela, se faltou, é problema do pedido,
  -- não desta porta. Negada não vai comprar nada.
  IF v_req.status IN ('Atendida', 'Negado') THEN
    RAISE EXCEPTION 'Requisição % está % — o vínculo com o catálogo só vale enquanto ela pode virar pedido.',
      COALESCE(v_req.numero, '#' || upper(right(v_req.id::text, 6))), lower(v_req.status)
      USING ERRCODE = 'P0001';
  END IF;

  -- Já amarrada: não sobrescreve. Trocar o produto de uma requisição que o
  -- gerente aprovou é trocar a decisão dele por outra, calado.
  IF v_req.produto_id IS NOT NULL THEN
    IF v_req.produto_id = p_produto_id THEN
      RETURN v_req;
    END IF;
    RAISE EXCEPTION 'Esta requisição já aponta para um produto do catálogo.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF v_prod.id IS NULL OR v_prod.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Produto não encontrado ou inativo.' USING ERRCODE = 'P0001';
  END IF;
  -- Mesma régua da 480: catálogo é por unidade. Amarrar no produto da vizinha
  -- faria a entrada do recebimento mexer no estoque dela.
  IF v_prod.filial IS DISTINCT FROM v_req.filial THEN
    RAISE EXCEPTION 'O produto "%" é do catálogo da %, e esta requisição é da %.',
      v_prod.nome, v_prod.filial, v_req.filial USING ERRCODE = 'P0001';
  END IF;
  -- MIGR 515: o pedido recusaria este vínculo depois (bem não tem saldo).
  IF COALESCE(v_prod.tipo, '') = 'patrimonio' THEN
    RAISE EXCEPTION '"%" está cadastrado como Patrimônio (bem de uso), e requisição de compra não vira pedido de bem — o vínculo travaria na frente do Gerar Pedido. Registre a aquisição em Financeiro > Contas a Pagar marcando a conta como imobilizado. Se este cadastro é mercadoria ou material de consumo, corrija o Tipo antes de amarrá-lo à requisição.',
      v_prod.nome USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 677: a marca pedida é a do produto. Ligada aqui, a requisição passa
  -- direto pelo Gerar Pedido — este é o único lugar onde a marca é conferida.
  SELECT NULLIF(btrim(c.marca), '') INTO v_marca
    FROM public.cotacoes c
   WHERE c.requisicao_id = v_req.id AND c.ativo AND c.status = 'Aprovado'
   ORDER BY c.aprovado_em DESC NULLS LAST
   LIMIT 1;
  v_marca      := COALESCE(v_marca, NULLIF(btrim(v_req.marca), ''));
  v_marca_norm := public.nome_item_normalizado(v_marca);
  IF v_marca_norm <> ''
     AND public.nome_item_normalizado(v_prod.marca) <> v_marca_norm
     AND NOT (public.nome_item_normalizado(v_prod.marca) = ''
              AND (' ' || public.nome_item_normalizado(v_prod.nome) || ' ') LIKE ('% ' || v_marca_norm || ' %')) THEN
    RAISE EXCEPTION 'A requisição % pediu a marca "%", e "%" é %. A compra entraria no saldo de outra marca. Se a marca é outra mesmo, devolva a requisição para correção em Compras > Requisições; se o cadastro está errado, corrija a marca dele.',
      COALESCE(v_req.numero, '#' || upper(right(v_req.id::text, 6))), v_marca, v_prod.nome,
      COALESCE('da marca "' || NULLIF(btrim(v_prod.marca), '') || '"', 'sem marca')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.requisicoes
     SET produto_id = p_produto_id
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$function$;

-- ═══ 2. Marca não troca com o produto em uso ═══════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_produto_marca_imutavel_com_uso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_antes  text := public.nome_item_normalizado(OLD.marca);
  v_depois text := public.nome_item_normalizado(NEW.marca);
BEGIN
  -- Caixa e espaço são grafia; preencher a marca que faltava é completar o
  -- cadastro. Só a troca de uma marca por outra muda o que o produto é.
  IF v_antes = v_depois OR v_antes = '' THEN
    RETURN NEW;
  END IF;
  IF public.auth_is_service_role() OR public.eh_perfil_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.estoque, 0) <> 0
     OR EXISTS (SELECT 1 FROM public.movimentacoes_estoque m WHERE m.produto_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.pedidos p
                 WHERE p.produto_id = OLD.id AND p.ativo AND p.status <> 'Cancelado') THEN
    RAISE EXCEPTION 'O produto "%" já tem estoque, movimento ou pedido como marca "%". Trocar para "%" faria esse histórico virar de outra marca sem nenhuma entrada ou saída que explique. Se é outra marca, cadastre um produto novo (com a marca no nome). Se o cadastro nasceu com a marca errada, peça ao professor para corrigir.',
      OLD.nome, btrim(OLD.marca), btrim(NEW.marca)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_produto_marca_imutavel_com_uso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_produto_marca_imutavel_com_uso ON public.produtos;
CREATE TRIGGER trg_produto_marca_imutavel_com_uso
  BEFORE UPDATE OF marca ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_marca_imutavel_com_uso();

-- ═══ 3. Nome único compara o nome normalizado ══════════════════════════════
-- `nome_item_normalizado` é IMMUTABLE e o índice depende disso: mudar a
-- normalização exige REINDEX deste índice.

DO $$
DECLARE v_dup text;
BEGIN
  SELECT string_agg(format('%s: %s', filial, nomes), '; ') INTO v_dup
    FROM (SELECT filial, string_agg(codigo || ' ' || btrim(nome), ' | ') nomes
            FROM public.produtos WHERE ativo
           GROUP BY filial, public.nome_item_normalizado(nome)
          HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'Migr. 677: há produtos ativos com o mesmo nome normalizado — junte ou inative antes: %', v_dup;
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_produtos_nome_filial_ativo;
CREATE UNIQUE INDEX uq_produtos_nome_filial_ativo
  ON public.produtos (filial, public.nome_item_normalizado(nome))
  WHERE ativo;

NOTIFY pgrst, 'reload schema';
