-- =================================================================
-- LogMax — Pesquisas & Tarefas: isolamento de leitura/escrita por filial
-- =================================================================
-- Contexto: `tarefas` e `pesquisas` ganharam coluna `filial` na
-- 20260703l_tarefas_pesquisas_filial, e o front (TarefasView,
-- PesquisasView) já filtra client-side e grava `filial` no insert —
-- mas a RLS ficou no design original de bootstrap (`*_auth ... USING
-- (true)`, documentado como "authenticated faz tudo via API; UI
-- restringe"), nunca revisitada. Mesmo furo do isolamento de Filiais
-- (20260713_filiais_rls_nicho.sql): qualquer autenticado lê/escreve
-- pesquisas e tarefas de qualquer unidade, não só a própria.
--
-- pesquisa_perguntas/pesquisa_respostas/pesquisa_resposta_itens não
-- têm coluna `filial` própria — herdam via EXISTS até `pesquisas`
-- (join extra até `pesquisa_respostas` no caso de resposta_itens).
--
-- responder_pesquisa (RPC, SECURITY DEFINER) continua sendo o caminho
-- oficial de submissão de resposta — a nova policy de escrita em
-- pesquisa_respostas/pesquisa_resposta_itens é defesa em profundidade
-- (bloqueia insert direto fora da própria filial), não afeta o fluxo
-- normal via RPC.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── pesquisas ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "pesquisas_auth" ON public.pesquisas;
CREATE POLICY "pesquisas_select" ON public.pesquisas FOR SELECT TO authenticated
  USING (auth_pode_filial(filial));
CREATE POLICY "pesquisas_write" ON public.pesquisas FOR ALL TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

-- ─── pesquisa_perguntas (herda filial via pesquisa_id) ────────────
DROP POLICY IF EXISTS "pesquisa_perguntas_auth" ON public.pesquisa_perguntas;
CREATE POLICY "pesquisa_perguntas_select" ON public.pesquisa_perguntas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pesquisas p WHERE p.id = pesquisa_perguntas.pesquisa_id AND auth_pode_filial(p.filial)));
CREATE POLICY "pesquisa_perguntas_write" ON public.pesquisa_perguntas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pesquisas p WHERE p.id = pesquisa_perguntas.pesquisa_id AND auth_pode_filial(p.filial)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pesquisas p WHERE p.id = pesquisa_perguntas.pesquisa_id AND auth_pode_filial(p.filial)));

-- ─── pesquisa_respostas (herda filial via pesquisa_id) ────────────
DROP POLICY IF EXISTS "pesquisa_respostas_auth" ON public.pesquisa_respostas;
CREATE POLICY "pesquisa_respostas_select" ON public.pesquisa_respostas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pesquisas p WHERE p.id = pesquisa_respostas.pesquisa_id AND auth_pode_filial(p.filial)));
CREATE POLICY "pesquisa_respostas_write" ON public.pesquisa_respostas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pesquisas p WHERE p.id = pesquisa_respostas.pesquisa_id AND auth_pode_filial(p.filial)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pesquisas p WHERE p.id = pesquisa_respostas.pesquisa_id AND auth_pode_filial(p.filial)));

-- ─── pesquisa_resposta_itens (herda via resposta_id → respostas → pesquisas) ──
DROP POLICY IF EXISTS "pesquisa_resposta_itens_auth" ON public.pesquisa_resposta_itens;
CREATE POLICY "pesquisa_resposta_itens_select" ON public.pesquisa_resposta_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pesquisa_respostas r
    JOIN public.pesquisas p ON p.id = r.pesquisa_id
    WHERE r.id = pesquisa_resposta_itens.resposta_id AND auth_pode_filial(p.filial)
  ));
CREATE POLICY "pesquisa_resposta_itens_write" ON public.pesquisa_resposta_itens FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pesquisa_respostas r
    JOIN public.pesquisas p ON p.id = r.pesquisa_id
    WHERE r.id = pesquisa_resposta_itens.resposta_id AND auth_pode_filial(p.filial)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.pesquisa_respostas r
    JOIN public.pesquisas p ON p.id = r.pesquisa_id
    WHERE r.id = pesquisa_resposta_itens.resposta_id AND auth_pode_filial(p.filial)
  ));

-- ─── tarefas (coluna filial direta) ───────────────────────────────
DROP POLICY IF EXISTS "tarefas_auth" ON public.tarefas;
CREATE POLICY "tarefas_select" ON public.tarefas FOR SELECT TO authenticated
  USING (auth_pode_filial(filial));
CREATE POLICY "tarefas_write" ON public.tarefas FOR ALL TO authenticated
  USING (auth_pode_filial(filial)) WITH CHECK (auth_pode_filial(filial));

COMMIT;
