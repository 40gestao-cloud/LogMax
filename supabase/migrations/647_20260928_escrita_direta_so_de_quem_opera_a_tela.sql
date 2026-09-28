-- 647_20260928_escrita_direta_so_de_quem_opera_a_tela.sql
--
-- Revisão guiada pelo mapa (docs/mapa, npm run mapa): 21 tabelas tinham policy
-- de escrita "qualquer aluno da própria filial", sem setor. Para cada uma, o
-- mapa disse quem grava de verdade — tela (e o setor dela) ou só função
-- SECURITY DEFINER, que ignora RLS. A régua passa a ser essa.
--
--   Só nascem por RPC → escrita direta fecha:
--     requisicoes, requisicoes_estoque, aprovacoes_compras, aprovacoes_estoque
--     (INSERT); mapeamentos_rateio (sem escritor nenhum); notificacoes
--     (UPDATE — texto de aviso alheio era editável).
--   Tela de um setor → o setor dela + gerente da filial (+ Matriz):
--     contas_pagar/contas_receber INSERT → Financeiro;
--     categorias_produto, subcategorias_produto, produtos INSERT → Compras/Logística;
--     produtos UPDATE → Compras/Logística/Vendas (Pedidos Online liga
--       "vender na loja"; quem publica ainda passa por produto_loja_online_guard);
--     pesquisas, pesquisa_perguntas → RH;
--     tarefas → só a Matriz (o Briefing Diário é quem cria).
--   Respostas de pesquisa: qualquer colega alterava ou apagava a resposta dos
--     outros e LIA quem respondeu o quê nas identificadas. responder_pesquisa
--     vira SECURITY DEFINER (única porta) e a leitura fica com RH, gerente,
--     Matriz e o próprio respondente.
--
-- Ficam como estão, de propósito: formas_pagamento, condicoes_pagamento e
-- projetos (módulo Empresa é aberto a todo setor por decisão — sectorAccess);
-- frequencia_trabalho e justificativas_falta (já têm trava própria).
--
-- Nada que grava por RPC muda: todas as funções que escrevem nessas tabelas são
-- SECURITY DEFINER do postgres (conferido na mesma revisão).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ═══ Só por RPC ═════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS compras_insert ON public.requisicoes;
DROP POLICY IF EXISTS logist_insert  ON public.requisicoes_estoque;
DROP POLICY IF EXISTS compras_insert ON public.aprovacoes_compras;
DROP POLICY IF EXISTS logist_insert  ON public.aprovacoes_estoque;
DROP POLICY IF EXISTS mapeamentos_rateio_write ON public.mapeamentos_rateio;
DROP POLICY IF EXISTS notif_update   ON public.notificacoes;

-- ═══ Financeiro ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS fin_insert ON public.contas_pagar;
CREATE POLICY fin_insert ON public.contas_pagar FOR INSERT TO authenticated
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));
DROP POLICY IF EXISTS fin_insert ON public.contas_receber;
CREATE POLICY fin_insert ON public.contas_receber FOR INSERT TO authenticated
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['financeiro'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

-- ═══ Cadastros ═════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS categorias_produto_write ON public.categorias_produto;
CREATE POLICY categorias_produto_write ON public.categorias_produto FOR ALL TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

DROP POLICY IF EXISTS subcategorias_write ON public.subcategorias_produto;
CREATE POLICY subcategorias_write ON public.subcategorias_produto FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.categorias_produto c
                  WHERE c.id = subcategorias_produto.categoria_id AND COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = c.filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = c.filial)), false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.categorias_produto c
                  WHERE c.id = subcategorias_produto.categoria_id AND COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = c.filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = c.filial)), false)));

DROP POLICY IF EXISTS write_produtos ON public.produtos;
CREATE POLICY write_produtos ON public.produtos FOR INSERT TO authenticated
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));
DROP POLICY IF EXISTS update_produtos ON public.produtos;
CREATE POLICY update_produtos ON public.produtos FOR UPDATE TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'vendas'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'vendas'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

-- ═══ RH ════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS pesquisas_write ON public.pesquisas;
CREATE POLICY pesquisas_write ON public.pesquisas FOR ALL TO authenticated
  USING (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['rh'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false))
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['rh'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

DROP POLICY IF EXISTS pesquisa_perguntas_write ON public.pesquisa_perguntas;
CREATE POLICY pesquisa_perguntas_write ON public.pesquisa_perguntas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pesquisas p
                  WHERE p.id = pesquisa_perguntas.pesquisa_id AND COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['rh'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = p.filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = p.filial)), false)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pesquisas p
                  WHERE p.id = pesquisa_perguntas.pesquisa_id AND COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['rh'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = p.filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = p.filial)), false)));

-- Respostas: só pela RPC; leitura de quem apura (RH/gerente/Matriz) e do próprio.
DROP POLICY IF EXISTS pesquisa_respostas_write ON public.pesquisa_respostas;
DROP POLICY IF EXISTS pesquisa_respostas_select ON public.pesquisa_respostas;
CREATE POLICY pesquisa_respostas_select ON public.pesquisa_respostas FOR SELECT TO authenticated
  USING (
    respondente_id = ( SELECT auth.uid() AS uid)
    OR EXISTS (SELECT 1 FROM public.pesquisas p
                WHERE p.id = pesquisa_respostas.pesquisa_id AND COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['rh'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = p.filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = p.filial)), false))
  );

DROP POLICY IF EXISTS pesquisa_resposta_itens_write ON public.pesquisa_resposta_itens;
DROP POLICY IF EXISTS pesquisa_resposta_itens_select ON public.pesquisa_resposta_itens;
CREATE POLICY pesquisa_resposta_itens_select ON public.pesquisa_resposta_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pesquisa_respostas r
      JOIN public.pesquisas p ON p.id = r.pesquisa_id
     WHERE r.id = pesquisa_resposta_itens.resposta_id
       AND (r.respondente_id = ( SELECT auth.uid() AS uid) OR COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['rh'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = p.filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = p.filial)), false))
  ));

CREATE OR REPLACE FUNCTION public.responder_pesquisa(p_pesquisa_id uuid, p_itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anonima       boolean;
  v_status        text;
  v_alvo_roles    text[];
  v_alvo_setores  text[];
  v_user_id       uuid;
  v_user_role     text;
  v_user_setores  text[];
  v_resposta_id   uuid;
  v_item          jsonb;
  v_filial        text;
BEGIN
  -- MIGR 647: SECURITY DEFINER — é a única porta para gravar resposta, e a
  -- RLS de pesquisa_respostas/itens deixou de aceitar escrita direta. O que a
  -- RLS cobrava na porta (desligado, simulação de perda, filial) passa a ser
  -- cobrado aqui.
  PERFORM public._assert_rpc();
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT anonima, status, alvo_roles, alvo_setores, filial
    INTO v_anonima, v_status, v_alvo_roles, v_alvo_setores, v_filial
    FROM pesquisas WHERE id = p_pesquisa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    RAISE EXCEPTION 'Pesquisa de outra unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'Ativa' THEN
    RAISE EXCEPTION 'Pesquisa não está ativa';
  END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_user_role, v_user_setores
    FROM user_profiles WHERE id = v_user_id;

  -- Wildcard: alvo NULL/vazio = todos. Setor 'all' (admin/CEO) sempre passa.
  IF v_alvo_roles IS NOT NULL AND array_length(v_alvo_roles, 1) > 0 THEN
    IF NOT (v_user_role = ANY(v_alvo_roles)) THEN
      RAISE EXCEPTION 'Usuário fora do público-alvo (role)';
    END IF;
  END IF;
  IF v_alvo_setores IS NOT NULL AND array_length(v_alvo_setores, 1) > 0 THEN
    -- Overlap: pelo menos um setor do usuário precisa estar no alvo.
    IF NOT ('all' = ANY(v_user_setores)) AND NOT (v_user_setores && v_alvo_setores) THEN
      RAISE EXCEPTION 'Usuário fora do público-alvo (setor)';
    END IF;
  END IF;

  -- Bloqueio de 2ª resposta para pesquisas identificadas.
  IF NOT v_anonima THEN
    IF EXISTS (
      SELECT 1 FROM pesquisa_respostas
       WHERE pesquisa_id = p_pesquisa_id AND respondente_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Usuário já respondeu esta pesquisa';
    END IF;
  END IF;

  INSERT INTO pesquisa_respostas (pesquisa_id, respondente_id)
    VALUES (p_pesquisa_id, CASE WHEN v_anonima THEN NULL ELSE v_user_id END)
    RETURNING id INTO v_resposta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO pesquisa_resposta_itens (resposta_id, pergunta_id, valor_escala, valor_texto)
      VALUES (
        v_resposta_id,
        (v_item->>'pergunta_id')::uuid,
        NULLIF(v_item->>'valor_escala','')::int,
        v_item->>'valor_texto'
      );
  END LOOP;

  RETURN v_resposta_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.responder_pesquisa(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.responder_pesquisa(uuid, jsonb) TO authenticated;

-- ═══ Matriz ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS tarefas_write ON public.tarefas;
CREATE POLICY tarefas_write ON public.tarefas FOR ALL TO authenticated
  USING (COALESCE(( SELECT auth_is_admin() AS auth_is_admin), false))
  WITH CHECK (COALESCE(( SELECT auth_is_admin() AS auth_is_admin), false));

NOTIFY pgrst, 'reload schema';
