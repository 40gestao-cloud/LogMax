-- 324_20260801_cargos_departamentos_confinados_por_filial.sql
--
-- FECHA O ESCOPO DE FILIAL EM `cargos` E `departamentos`.
--
-- A policy `rh_all` das duas tabelas era:
--
--   auth_in_setor('rh') OR auth_gerente_da(filial)
--
-- O segundo ramo já é seguro — `auth_gerente_da` exige que a filial do perfil
-- seja a da linha. O primeiro não: `auth_in_setor('rh')` só pergunta o SETOR,
-- nunca a unidade. Na prática, qualquer RH de qualquer filial lia e escrevia o
-- catálogo de cargos das outras, incluindo a faixa salarial — e o `salario_base`
-- de um cargo alimenta o formulário de Funcionários, que alimenta a folha.
--
-- Todas as outras tabelas escopadas ganharam `AND auth_pode_filial(filial)` na
-- migr. 169; cargos e departamentos ficaram de fora, provavelmente porque na
-- época a coluna `filial` deles (migr. 145) era nova e a UI ainda a ignorava.
-- A UI parou de ignorar em 2026-08-01 (`filialScoped` nas duas telas); esta
-- migração faz o banco dizer a mesma coisa, para o confinamento não depender de
-- ninguém deixar de abrir o F12.
--
-- QUEM MUDA DE COMPORTAMENTO. Só o RH/colaborador de uma unidade tentando
-- alcançar o catálogo de outra. Admin, CEO e conselheiro seguem passando em
-- tudo por `auth_is_admin()`, que é o primeiro ramo de `auth_pode_filial` — e é
-- disso que dependem o modo Matriz e a tela de Recrutamento, que lê cargos sem
-- filtro para conduzir processo interfilial.
--
-- SEM MIGRAÇÃO DE DADOS. Linhas existentes continuam onde estão. Nas turmas em
-- que todo cargo é 'SuperMax' (default histórico da 145), o RH da MaxLook deixa
-- de enxergá-las — o que a tela já fazia desde que virou `filialScoped`.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── cargos ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "rh_all" ON public.cargos;

CREATE POLICY "rh_all" ON public.cargos FOR ALL TO authenticated
  USING (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  )
  WITH CHECK (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  );

-- ── departamentos ───────────────────────────────────────────────────────────
-- Mesma policy, mesmo buraco, mesma correção. Vão juntos porque são o mesmo
-- catálogo organizacional lido pelo mesmo formulário.
DROP POLICY IF EXISTS "rh_all" ON public.departamentos;

CREATE POLICY "rh_all" ON public.departamentos FOR ALL TO authenticated
  USING (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  )
  WITH CHECK (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  );

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar depois; as duas linhas devem conter auth_pode_filial)
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, qual
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('cargos', 'departamentos')
--    AND policyname = 'rh_all';
