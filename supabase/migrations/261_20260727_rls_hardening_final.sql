-- 261_20260727_rls_hardening_final.sql
--
-- Segunda leva da auditoria de 2026-07-27 (a 260 fechou o acesso anônimo às
-- RPCs). Aqui fechamos o que sobrou para o usuário LOGADO — o aluno que abre o
-- F12 já autenticado como colaborador de outro setor.
--
-- ITEM 3 — policies `USING (true)` / `WITH CHECK (true)` que davam escrita livre
-- ITEM 4 — SECURITY DEFINER sem SET search_path
-- ITEM 5 — REVOKE TRUNCATE/DELETE excessivos de anon/authenticated
-- ITEM 6 — policies com role `public` (inclui anon) que liam sem login
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 3.1 — notificacoes: bloquear notificação forjada
-- ────────────────────────────────────────────────────────────────────────────
--
-- `notif_insert` era WITH CHECK (true): qualquer aluno logado inseria
-- notificação em nome de qualquer setor — vetor de phishing dentro do ERP
-- ("Financeiro: clique aqui para regularizar...").
--
-- Não dá pra simplesmente travar o INSERT: as 7 telas que notificam
-- (Cotações, Orçamentos, Promoções, Treinamentos, Briefing, ClienteEspecial e
-- TI — esta só visível na Matriz) passam por notificar_setor(), que hoje é
-- SECURITY **INVOKER** e portanto depende dessa policy aberta.
--
-- Solução: notificar_setor() vira SECURITY DEFINER com guard de sessão. Ela já
-- preenche origem_setor/origem_user a partir do JWT (auth_user_setor() /
-- auth.uid()), então a procedência continua honesta e não falsificável. Com a
-- RPC autossuficiente, o INSERT direto na tabela pode fechar.
CREATE OR REPLACE FUNCTION public.notificar_setor(
  p_setor text,
  p_tipo text,
  p_titulo text,
  p_mensagem text DEFAULT NULL::text,
  p_link_view text DEFAULT NULL::text,
  p_urgencia text DEFAULT 'Média'::text,
  p_ref_id uuid DEFAULT NULL::uuid,
  p_motivo text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public._assert_rpc();

  INSERT INTO notificacoes (
    setor, tipo, titulo, mensagem, link_view, urgencia,
    origem_setor, origem_user, ref_id, motivo
  ) VALUES (
    p_setor, p_tipo, p_titulo, p_mensagem, p_link_view, p_urgencia,
    auth_user_setor(), auth.uid(), p_ref_id, p_motivo
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL  ON FUNCTION public.notificar_setor(text,text,text,text,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificar_setor(text,text,text,text,text,text,uuid,text) TO authenticated, service_role;

DROP POLICY IF EXISTS notif_insert ON public.notificacoes;
CREATE POLICY notif_insert ON public.notificacoes
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 3.2 — parcelas_emprestimo: fim do "quito qualquer parcela"
-- ────────────────────────────────────────────────────────────────────────────
--
-- `parcelas_update` era USING (true): qualquer aluno logado marcava qualquer
-- parcela de empréstimo como paga. O front só LÊ esta tabela
-- (FilialCapitalView usa useFetchData); a escrita legítima vem de
-- aprovar_emprestimo()/negar_emprestimo(). Escopo: Financeiro (auth_in_setor
-- já libera admin/CEO/conselheiro/gerência) + filial do empréstimo.
DROP POLICY IF EXISTS parcelas_insert ON public.parcelas_emprestimo;
CREATE POLICY parcelas_insert ON public.parcelas_emprestimo
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_in_setor('financeiro')
    AND EXISTS (
      SELECT 1 FROM public.emprestimos_filial e
       WHERE e.id = parcelas_emprestimo.emprestimo_id
         AND public.auth_pode_filial(e.filial)
    )
  );

DROP POLICY IF EXISTS parcelas_update ON public.parcelas_emprestimo;
CREATE POLICY parcelas_update ON public.parcelas_emprestimo
  FOR UPDATE TO authenticated
  USING (
    public.auth_in_setor('financeiro')
    AND EXISTS (
      SELECT 1 FROM public.emprestimos_filial e
       WHERE e.id = parcelas_emprestimo.emprestimo_id
         AND public.auth_pode_filial(e.filial)
    )
  )
  WITH CHECK (
    public.auth_in_setor('financeiro')
    AND EXISTS (
      SELECT 1 FROM public.emprestimos_filial e
       WHERE e.id = parcelas_emprestimo.emprestimo_id
         AND public.auth_pode_filial(e.filial)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 3.3 — cartao_pendentes / beneficios_pendentes: escopo por operador
-- ────────────────────────────────────────────────────────────────────────────
--
-- Ambas tinham `FOR ALL USING(true) WITH CHECK(true)` para authenticated:
-- qualquer aluno lia, alterava e apagava cobrança de qualquer operador de
-- qualquer filial. Espelhamos o modelo já aplicado em pix_pendentes na
-- migração 257 (operador_id = auth.uid() OR auth_is_admin()).
--
-- As policies de `anon` (maquininha MaxPay / app MaxBank confirmando pagamento)
-- NÃO são tocadas — continuam restritas a status='aguardando' -> 'autorizado'.
DROP POLICY IF EXISTS cartao_pendentes_auth_all ON public.cartao_pendentes;

CREATE POLICY cartao_pendentes_auth_select ON public.cartao_pendentes
  FOR SELECT TO authenticated
  USING (operador_id = auth.uid() OR public.auth_is_admin());

CREATE POLICY cartao_pendentes_auth_insert ON public.cartao_pendentes
  FOR INSERT TO authenticated
  WITH CHECK (operador_id = auth.uid());

CREATE POLICY cartao_pendentes_auth_update ON public.cartao_pendentes
  FOR UPDATE TO authenticated
  USING (operador_id = auth.uid() OR public.auth_is_admin())
  WITH CHECK (operador_id = auth.uid() OR public.auth_is_admin());

CREATE POLICY cartao_pendentes_auth_delete ON public.cartao_pendentes
  FOR DELETE TO authenticated
  USING (public.auth_is_admin());

DROP POLICY IF EXISTS beneficios_pendentes_auth_all ON public.beneficios_pendentes;

CREATE POLICY beneficios_pendentes_auth_select ON public.beneficios_pendentes
  FOR SELECT TO authenticated
  USING (operador_id = auth.uid() OR public.auth_is_admin());

-- ATENÇÃO: nenhuma tela deste repositório escreve em beneficios_pendentes — o
-- INSERT vem do app externo MaxBank. Por isso o WITH CHECK aceita operador_id
-- nulo, senão o fluxo de benefício quebraria sem aviso. Se confirmar que o
-- MaxBank preenche operador_id, apertar para `operador_id = auth.uid()`.
CREATE POLICY beneficios_pendentes_auth_insert ON public.beneficios_pendentes
  FOR INSERT TO authenticated
  WITH CHECK (operador_id IS NULL OR operador_id = auth.uid());

CREATE POLICY beneficios_pendentes_auth_update ON public.beneficios_pendentes
  FOR UPDATE TO authenticated
  USING (operador_id = auth.uid() OR public.auth_is_admin())
  WITH CHECK (operador_id = auth.uid() OR public.auth_is_admin());

CREATE POLICY beneficios_pendentes_auth_delete ON public.beneficios_pendentes
  FOR DELETE TO authenticated
  USING (public.auth_is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 3.4 — briefings_diarios: leitura restrita ao público do módulo
-- ────────────────────────────────────────────────────────────────────────────
--
-- Briefing Diário é módulo Admin/CEO, mas `briefings_read` era USING(true) e
-- `briefings_insert` não tinha WITH CHECK — qualquer colaborador lia a pauta
-- estratégica e podia inserir briefing. UPDATE/DELETE já estavam em
-- auth_is_admin(); alinhamos SELECT e INSERT à mesma régua.
DROP POLICY IF EXISTS briefings_read ON public.briefings_diarios;
CREATE POLICY briefings_read ON public.briefings_diarios
  FOR SELECT TO authenticated
  USING (public.auth_is_admin());

DROP POLICY IF EXISTS briefings_insert ON public.briefings_diarios;
CREATE POLICY briefings_insert ON public.briefings_diarios
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 6 — policies com role `public` que liberavam leitura sem login
-- ────────────────────────────────────────────────────────────────────────────
--
-- role `public` inclui `anon`. A maioria das policies `public` do schema tem
-- predicado baseado em auth.uid() (vira NULL para anon => fecha sozinho), mas
-- estas três eram `USING (true)`: competição e tarefas da Matriz liam sem login.
DROP POLICY IF EXISTS comp_read ON public.competicoes_matriz;
CREATE POLICY comp_read ON public.competicoes_matriz
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS mt_tarefas_select ON public.matriz_tarefas;
CREATE POLICY mt_tarefas_select ON public.matriz_tarefas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS mt_part_select ON public.matriz_tarefa_participantes;
CREATE POLICY mt_part_select ON public.matriz_tarefa_participantes
  FOR SELECT TO authenticated USING (true);

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 4 — SECURITY DEFINER sem SET search_path
-- ────────────────────────────────────────────────────────────────────────────
--
-- Função SECURITY DEFINER sem search_path fixo resolve nomes pelo search_path
-- de quem chama — vetor clássico de escalonamento (objeto homônimo num schema
-- que venha antes). Mesma classe de problema documentada em
-- feedback_trigger_search_path.
DO $sp$
DECLARE
  r record;
  alvos constant text[] := ARRAY[
    'fn_atualiza_estoque_produto',
    'fn_block_estoque_manual',
    'fn_sync_ponto_eletronico',
    'fn_recompute_ponto_eletronico_after_delete',
    'renotificar_pix_pago',
    'autorizar_cartao_maxbank'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (alvos)
       AND p.prosecdef
       AND (p.proconfig IS NULL
            OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search_path%'))
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public',
                   r.proname, pg_get_function_identity_arguments(r.oid));
    RAISE NOTICE '[261] search_path fixado em %', r.proname;
  END LOOP;
END;
$sp$;

-- ────────────────────────────────────────────────────────────────────────────
-- ITEM 5 — grants excessivos de tabela
-- ────────────────────────────────────────────────────────────────────────────
--
-- Por padrão o Supabase concede TODOS os privilégios de tabela a anon e
-- authenticated, contando com a RLS para filtrar. Duas ressalvas:
--
--   1. TRUNCATE **não passa por RLS**. Hoje não é alcançável pelo PostgREST
--      (que só faz SELECT/INSERT/UPDATE/DELETE e RPC), mas é privilégio sem
--      nenhum uso legítimo — some.
--   2. anon não tem um único fluxo que apague linha. Os fluxos anônimos reais
--      (simulador Pix, maquininha, MaxBank) só fazem SELECT/UPDATE de status.
--
-- SELECT/INSERT/UPDATE seguem concedidos: quem filtra é a RLS.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE DELETE   ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE DELETE ON TABLES FROM anon;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) Nenhuma policy aberta deve sobrar fora das conhecidas:
-- SELECT tablename, policyname, cmd, array_to_string(roles,',')
--   FROM pg_policies
--  WHERE schemaname='public'
--    AND (coalesce(qual,'')='true' OR coalesce(with_check,'')='true')
--  ORDER BY 1,2;
--
-- 2) Nenhum SECURITY DEFINER sem search_path:
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.prosecdef
--    AND (p.proconfig IS NULL OR NOT EXISTS (
--          SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search_path%'));
--
-- 3) anon sem TRUNCATE/DELETE:
-- SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND grantee='anon';
