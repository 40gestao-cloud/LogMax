-- 479_20260819_a_aula_dava_a_tela_e_o_bucket_recusava_a_imagem.sql
--
-- Reportado da turma de Contabilidade: uma aluna da MaxLook tentou salvar
-- categoria e levou erro de política de segurança falando da imagem, enquanto
-- as colegas salvavam normal.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DUAS RÉGUAS PARA A MESMA TELA
--
-- A TABELA `categorias_produto` aceita quem é da unidade:
--
--   categorias_produto_write   USING/WITH CHECK auth_pode_filial(filial)
--
-- O BUCKET `categoria-imagens` aceitava só quem tem logística GRAVADA na
-- coluna do perfil:
--
--   categoria_imagens_insert   WITH CHECK (
--     bucket_id = 'categoria-imagens' AND EXISTS (
--       SELECT 1 FROM user_profiles up
--        WHERE up.id = auth.uid()
--          AND (up.role IN ('admin','ceo')
--               OR up.setor = 'logistica'
--               OR up.setores_extras @> ARRAY['logistica'])))
--
-- Categoria SEM imagem salvava; COM imagem morria no upload. E como o texto do
-- erro é o do storage, o aluno lê "política de segurança" numa tela que, para
-- ele, é a de categoria.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE A COLUNA CRUA NÃO ENXERGA: O MODO AULA
--
-- Esta era a única policy de storage que ainda lia `up.setor` / `setores_extras`
-- na mão. Todas as outras (`cadastro-imagens`, `produto-imagens`,
-- `nota-anexos`) já passam por `auth_in_setor()`, e é aí que mora a diferença:
-- `auth_in_setor` soma `auth_aula_setores()` (migr. 317), a coluna não soma
-- nada. Na aula, o setor CONCEDIDO substitui o do perfil — a tela abre, a
-- tabela aceita, e só o bucket continua olhando o crachá antigo.
--
-- Na turma, com `aula_config` ativa e `cadastros-categorias` liberado, a aluna
-- de marketing tinha:
--
--   auth_user_setores()                 → {marketing,compras,estoque,financeiro,logistica}
--   auth_in_setor('logistica')          → true
--   a policy antiga, pela coluna        → false
--
-- As colegas que conseguiram salvar são as de logística DE VERDADE, que passam
-- pelos dois caminhos. Não era a aluna: era o setor no perfil dela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO
--
-- Mesma régua de sempre, agora pelo helper. O conjunto de quem entra NÃO muda
-- de propósito: continua logística (+ admin/CEO, que `auth_in_setor` já traz
-- por dentro via `auth_is_admin()`, somando conselheiro como no resto do app).
-- O que muda é que agora a aula conta — que é o ponto.
--
-- SELECT continua público: bucket público, imagem de categoria aparece na
-- vitrine e nos cards sem login.


BEGIN;

DROP POLICY IF EXISTS "categoria_imagens_insert" ON storage.objects;
CREATE POLICY "categoria_imagens_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'categoria-imagens'
    AND COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
  );

DROP POLICY IF EXISTS "categoria_imagens_update" ON storage.objects;
CREATE POLICY "categoria_imagens_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'categoria-imagens'
    AND COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
  );

DROP POLICY IF EXISTS "categoria_imagens_delete" ON storage.objects;
CREATE POLICY "categoria_imagens_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'categoria-imagens'
    AND COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text]), false)
  );

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND COALESCE(qual,'')||COALESCE(with_check,'') ~ 'up\.setor';
--   -- espera ZERO linhas: nenhuma policy de storage lendo a coluna na mão
--
-- TESTE MANUAL (aluno fora da logística, com Modo Aula ligado em Cadastros):
--   Cadastros > Categorias > nova categoria COM imagem → salva
--   mesma coisa com a aula desligada                   → recusa (correto:
--                                                        fora da aula ele não
--                                                        opera Cadastros)
-- ════════════════════════════════════════════════════════════════════════════
