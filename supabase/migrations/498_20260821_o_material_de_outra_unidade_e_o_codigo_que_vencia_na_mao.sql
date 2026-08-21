-- 498_20260821_o_material_de_outra_unidade_e_o_codigo_que_vencia_na_mao.sql
--
-- Dois achados da auditoria dos fluxos de requisição (2026-08-21). Nada em
-- comum entre eles além de terem saído da mesma leitura.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. REQUISIÇÃO DE MATERIAL ACEITAVA PRODUTO DE OUTRA UNIDADE
--
-- `criar_requisicao_estoque` só perguntava se o produto EXISTE:
--
--   IF NOT EXISTS (SELECT 1 FROM produtos WHERE id = p_produto_id)
--
-- Sem comparar filial. A irmã dela, `criar_requisicoes_compra_lote`, compara e
-- recusa com o nome do produto — a régua existia, só não estava aqui. Pela tela
-- não dá para chegar (o select só oferece o catálogo da unidade), mas pela API
-- dava, e a liberação depois baixa estoque: seria saída lançada no saldo da
-- vizinha. Mesma classe dos gaps de isolamento das migr. 436/437.
--
-- Entram junto duas travas que a tela já cumpria sozinha (mesma linha da migr.
-- 492: acordo de tela vira trava de banco):
--   • produto inativo não se requisita — o catálogo da tela filtra 'Inativo';
--   • patrimônio não tem saldo (migr. 440), então não sai por requisição de
--     material. `temEstoque()` no `produtosEmEstoque` já excluía.
--
-- Conferido antes: 0 linhas existentes violam qualquer uma das três.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2. O CÓDIGO RESERVADO VENCIA NA MÃO DE QUEM ESTAVA PREENCHENDO
--
-- A reserva da migr. 481 dura 30 minutos e ninguém a renovava. Em aula cheia
-- isso aparece de dois jeitos, os dois terminando em 23505 na hora de salvar:
--
--   • o aluno clica "Gerar", preenche a ficha longa (grade da MaxLook,
--     garantia/IMEI da TechMax), conversa, volta — e o número já não é dele;
--   • o aluno abre um segundo cadastro: a RPC apagava a reserva anterior DELE
--     antes de contar (DELETE ... WHERE usuario_id = auth.uid()), então as duas
--     abas recebiam o MESMO número e uma das duas não salvava.
--
-- O DELETE existia por um bom motivo: sem ele, reclicar "Gerar" subia o número
-- a cada clique e queimava a sequência. A saída é o chamador dizer qual código
-- já tem na mão:
--
--   reservar_codigo_produto(p_filial, p_codigo_atual)
--
--   • `p_codigo_atual` é uma reserva viva do próprio usuário → devolve O MESMO
--     número e ESTENDE o prazo. É o reclique idempotente de antes, e é também
--     o heartbeat: o formulário aberto renova sozinho a cada 10 minutos.
--   • senão → número novo, sem apagar a reserva anterior. Duas abas, dois
--     números.
--
-- Reserva abandonada não fica presa: a tela devolve no fechar/salvar
-- (`liberar_codigo_produto`) e o prazo limpa o que escapar.
--
-- ATENÇÃO: DROP + CREATE por causa do argumento novo. O default NULL mantém a
-- chamada de um argumento válida, então o bundle antigo continua funcionando
-- (só sem a idempotência) na janela entre aplicar isto e o deploy da tela.


BEGIN;

-- ── 1. Requisição de material ───────────────────────────────────────────────
-- Cabeçalho copiado do banco, não reescrito de memória: os defaults de
-- p_qtd/p_destino/p_filial e o `pg_temp` no search_path já estavam lá, e
-- CREATE OR REPLACE que os omite morre em 42P13.
CREATE OR REPLACE FUNCTION public.criar_requisicao_estoque(
  p_produto_id uuid,
  p_solicitante text,
  p_qtd numeric DEFAULT 1,
  p_destino text DEFAULT NULL::text,
  p_filial text DEFAULT 'SuperMax'::text,
  p_centro_custo_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req   requisicoes_estoque;
  v_nome  text;
  v_setor text;
  v_prod  public.produtos;
BEGIN
  -- Era _assert_rpc('estoque','logistica'). Material do almoxarifado é pedido
  -- por quem precisa dele — igual à requisição de compra (migr. 283).
  PERFORM public._assert_rpc();

  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    p_qtd := 1;
  END IF;
  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    p_filial := 'SuperMax';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Você só abre requisição para a sua filial.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  -- Migr. 498. O almoxarifado é da unidade: liberar material apontando para o
  -- produto da vizinha lançaria a saída no saldo dela.
  IF v_prod.filial IS DISTINCT FROM p_filial THEN
    RAISE EXCEPTION 'O produto "%" é do catálogo da %, e esta requisição é da %.',
      v_prod.nome, v_prod.filial, p_filial USING ERRCODE = '42501';
  END IF;
  IF v_prod.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'O produto "%" está inativo no catálogo.', v_prod.nome
      USING ERRCODE = 'P0001';
  END IF;
  -- Patrimônio não tem saldo (migr. 440): freezer não sai do almoxarifado por
  -- requisição de material, é gerido em Financeiro > Patrimônio.
  IF v_prod.tipo = 'patrimonio' THEN
    RAISE EXCEPTION 'O item "%" é patrimônio e não tem saldo de estoque — ele é gerido em Financeiro > Patrimônio.',
      v_prod.nome USING ERRCODE = 'P0001';
  END IF;

  -- Migr. 442. Centro de custo inexistente ou inativo entra como NULL em vez de
  -- derrubar o pedido: o material é urgente, a classificação não é.
  IF p_centro_custo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.centros_custo
     WHERE id = p_centro_custo_id AND COALESCE(ativo, true)
  ) THEN
    p_centro_custo_id := NULL;
  END IF;

  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.requisicoes_estoque (
    produto_id, solicitante, setor_solicitante, qtd, destino, status, filial,
    centro_custo_id
  ) VALUES (
    p_produto_id,
    COALESCE(v_nome, trim(p_solicitante)),
    v_setor,
    p_qtd,
    NULLIF(trim(COALESCE(p_destino,'')), ''),
    'Pendente', p_filial,
    p_centro_custo_id
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
  VALUES (v_req.id, 'Pendente', p_filial);

  RETURN to_jsonb(v_req);
END;
$function$;

REVOKE ALL ON FUNCTION public.criar_requisicao_estoque(uuid, text, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, numeric, text, text, uuid) TO authenticated, service_role;

-- ── 2. Reserva de código ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reservar_codigo_produto(text);

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

  -- Renovação/reclique: o número que já está na tela continua sendo dele, com
  -- prazo novo. É isto que substitui o DELETE por usuário da migr. 481 — sem
  -- devolver o número da OUTRA aba para a fila.
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

REVOKE ALL ON FUNCTION public.reservar_codigo_produto(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_codigo_produto(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.reservar_codigo_produto(text, text) IS
  'Tira (ou renova) o número de código de produto da filial. Passando o código que o formulário já tem, devolve o mesmo e estende o prazo — reclique e heartbeat. Sem ele, tira um número novo sem derrubar a reserva anterior do usuário. Migr. 481/498.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'reservar_codigo_produto';
--   -- espera UMA linha: reservar_codigo_produto(text,text)
--
-- TESTE MANUAL:
--   Requisições > Do Setor > Material do estoque → segue funcionando na própria
--     unidade; produto de outra unidade, inativo ou patrimônio agora é recusado
--     com o motivo.
--   Cadastros > Produtos > Gerar → clicar duas vezes devolve o MESMO número;
--     abrir um segundo cadastro em outra aba dá número DIFERENTE; e o formulário
--     aberto por mais de 30 min continua com o número dele.
-- ════════════════════════════════════════════════════════════════════════════
