-- 437_20260816_setor_sem_filial_ainda_atravessa_a_parede.sql
--
-- Segunda leva do isolamento por filial, achada na varredura que a 436 abriu.
-- Lá o problema era `SELECT USING (true)`; aqui é mais sutil: policies que
-- checam SETOR e esquecem a FILIAL.
--
-- `auth_in_setor('logistica')` responde "esta pessoa é da logística?" e não
-- "de qual unidade?". Passa o aluno de logística de qualquer filial. A policy
-- parece escopada — tem um guard, tem um helper `auth_` — e não está.
--
-- ════════════════════════════════════════════════════════════════════════════
-- AS SEIS
--
--   expedicao                    `logist_all`, FOR ALL
--   inventarios                  `logist_all`, FOR ALL
--   movimentacoes_caixa          `mov_caixa_all`, FOR ALL
--   devolucoes_pdv               select + write (FOR ALL), ambos sem filial
--   rateio_administrativo_itens  select
--   alcadas_compra               select (`auth.role() = 'authenticated'`)
--
-- As duas primeiras são as graves, porque são FOR ALL — valem para ESCRITA. E
-- diferente do caixa, não há trigger cobrindo:
--
--   • `expedir` e `fechar_inventario` são as RPCs certas e checam
--     `auth_pode_filial`. Mas escrita direta na tabela não passa por RPC — é
--     o mesmo padrão do achado do caixa na 430, sem a rede que a 278 tinha
--     armado lá.
--   • Inventário fecha ajustando saldo de estoque (migr. 268). Um aluno de
--     logística da MaxLook fechava inventário da SuperMax e mexia no estoque
--     da unidade vizinha.
--
-- `movimentacoes_caixa` fica no meio: a ESCRITA já estava barrada pelo trigger
-- `movimentacao_caixa_guard` (migr. 278), que confere a filial do caixa. A
-- LEITURA não estava — sangria e suprimento da unidade vizinha eram visíveis.
-- Aqui a policy passa a dizer o que o trigger já dizia; defesa em profundidade,
-- e a leitura fecha junto.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RÉGUA — a mesma de sempre, confirmada com a direção em 16/08:
-- a Matriz precisa enxergar as três, e `auth_pode_filial` já entrega isso
-- (tem `auth_is_admin()` por dentro, que cobre admin, CEO e conselheiro).
--
-- O conjunto de SETORES de cada policy fica EXATAMENTE como estava. Esta
-- migração só acrescenta o `AND auth_pode_filial(filial)`; alargar quem entra
-- (somar gerente onde hoje só há logística, por exemplo) é outra conversa e
-- não se faz de carona num hardening.
--
-- Conferido antes: zero linhas com `filial IS NULL` nas seis tabelas, nas 4
-- turmas. Ninguém some da tela por causa do COALESCE.


BEGIN;

-- ── expedicao ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "logist_all" ON public.expedicao;
CREATE POLICY "logist_all" ON public.expedicao
  FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── inventarios ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "logist_all" ON public.inventarios;
CREATE POLICY "logist_all" ON public.inventarios
  FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── movimentacoes_caixa ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mov_caixa_all" ON public.movimentacoes_caixa;
CREATE POLICY "mov_caixa_all" ON public.movimentacoes_caixa
  FOR ALL TO authenticated
  USING (
    (COALESCE(public.auth_in_setor(VARIADIC ARRAY['financeiro'::text, 'vendas'::text]), false)
     OR public.auth_user_role() = 'gerente')
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    (COALESCE(public.auth_in_setor(VARIADIC ARRAY['financeiro'::text, 'vendas'::text]), false)
     OR public.auth_user_role() = 'gerente')
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── devolucoes_pdv ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devolucoes_pdv_select" ON public.devolucoes_pdv;
CREATE POLICY "devolucoes_pdv_select" ON public.devolucoes_pdv
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'financeiro'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "devolucoes_pdv_write" ON public.devolucoes_pdv;
CREATE POLICY "devolucoes_pdv_write" ON public.devolucoes_pdv
  FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text]), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── rateio_administrativo_itens ─────────────────────────────────────────────
DROP POLICY IF EXISTS "rateio_itens_select" ON public.rateio_administrativo_itens;
CREATE POLICY "rateio_itens_select" ON public.rateio_administrativo_itens
  FOR SELECT TO authenticated
  USING (
    (COALESCE(public.auth_in_setor(VARIADIC ARRAY['financeiro'::text]), false)
     OR public.auth_user_role() = 'gerente')
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── alcadas_compra ──────────────────────────────────────────────────────────
-- Era `auth.role() = 'authenticated'`: qualquer logado lia o limite de
-- aprovação de todas as unidades. A escrita já é admin-only e não muda.
DROP POLICY IF EXISTS "alcadas_compra_select" ON public.alcadas_compra;
CREATE POLICY "alcadas_compra_select" ON public.alcadas_compra
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_pode_filial(filial), false));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4 — espera 7)
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND qual ~ 'auth_pode_filial'
--      AND policyname IN ('logist_all','mov_caixa_all','devolucoes_pdv_select',
--                         'devolucoes_pdv_write','rateio_itens_select',
--                         'alcadas_compra_select');
--
-- TESTE MANUAL (F12, aluno de logística de UMA filial):
--   from('inventarios').select('filial')  → só a própria unidade
--   from('expedicao').select('filial')    → idem
--   fechar inventário da própria unidade  → continua funcionando
--   Matriz/admin                          → continua vendo as três
-- ════════════════════════════════════════════════════════════════════════════
