-- 287 — Frequência de Trabalho: o isolamento por filial sai do React e vira RLS.
--
-- ACHADO (auditoria de veracidade do módulo RH). As policies da migr. 264
-- conferem só role/setor: `role IN ('admin','ceo','conselheiro','gerente')
-- OR setor = 'rh'`. Nenhuma delas olha de que unidade é o funcionário da linha.
-- Resultado prático: o gerente da MaxLook lê — e escreve — a frequência do
-- pessoal da TechMax e da SuperMax, e o colaborador de RH de qualquer filial
-- faz o mesmo. A tela disfarça com o `filialFiltro` client-side, que é
-- exatamente a classe de proteção que não protege: quem chama o PostgREST
-- direto passa por cima.
--
-- Isso contradiz a régua canônica Matriz/Filial já aplicada nas migrações
-- 179-197: filiais são isoladas entre si, gerente opera a filial inteira,
-- Matriz (admin/CEO/conselheiro) enxerga tudo. Frequência ficou de fora.
--
-- `frequencia_trabalho` não tem coluna `filial` — e não vai ganhar. A filial
-- do registro é a do funcionário, e duplicá-la criaria uma segunda verdade que
-- alguém teria de manter em dia. O escopo vem do JOIN com `funcionarios`.
--
-- Funcionário sem filial conta como Matriz, mesmo default que a tela usa
-- (FILIAL_DEFAULT em FrequenciaTrabalhoView) — sem o COALESCE, linha com
-- filial NULL sumiria para todo mundo, inclusive para quem a lançou.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Helper: quem registra frequência
--
-- A régua de PAPEL (quem lança) é a mesma da 264 e continua valendo; o que
-- entra agora é a régua de ESCOPO (de quem). Separar as duas em funções
-- distintas evita repetir o EXISTS em quatro lugares e sair do ar em um deles.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_registra_frequencia()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles u
     WHERE u.id = auth.uid()
       AND (
         u.role IN ('admin', 'ceo', 'conselheiro', 'gerente')
         OR u.setor = 'rh'
         OR 'rh' = ANY(COALESCE(u.setores_extras, ARRAY[]::text[]))
       )
  );
$$;

REVOKE ALL ON FUNCTION public.auth_registra_frequencia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_registra_frequencia() TO authenticated;

COMMENT ON FUNCTION public.auth_registra_frequencia() IS
  'Papel que pode lançar frequência: Matriz, gerente ou RH. Não diz de QUEM — '
  'o escopo por filial vem de auth_pode_filial sobre a filial do funcionário. '
  'Migração 287.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Helper: a filial de um funcionário
--
-- SECURITY DEFINER de propósito. A policy precisa ler `funcionarios` para
-- decidir, e `funcionarios` tem RLS própria por filial: sem o DEFINER, a
-- subconsulta devolveria zero linhas e a policy negaria tudo — inclusive para
-- quem tem direito.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.funcionario_filial(p_funcionario_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(f.filial, 'Matriz')
    FROM public.funcionarios f
   WHERE f.id = p_funcionario_id;
$$;

REVOKE ALL ON FUNCTION public.funcionario_filial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funcionario_filial(uuid) TO authenticated;

COMMENT ON FUNCTION public.funcionario_filial(uuid) IS
  'Filial do funcionário, com NULL tratado como Matriz (mesmo default da UI). '
  'SECURITY DEFINER porque é usada dentro de policies que precisam enxergar '
  'funcionarios antes de decidir o escopo. Migração 287.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. frequencia_trabalho — papel + escopo
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS frequencia_select ON public.frequencia_trabalho;
CREATE POLICY frequencia_select ON public.frequencia_trabalho
  FOR SELECT TO authenticated
  USING (
    public.auth_registra_frequencia()
    AND public.auth_pode_filial(public.funcionario_filial(funcionario_id))
  );

DROP POLICY IF EXISTS frequencia_write ON public.frequencia_trabalho;
CREATE POLICY frequencia_write ON public.frequencia_trabalho
  FOR ALL TO authenticated
  USING (
    public.auth_registra_frequencia()
    AND public.auth_pode_filial(public.funcionario_filial(funcionario_id))
  )
  WITH CHECK (
    public.auth_registra_frequencia()
    AND public.auth_pode_filial(public.funcionario_filial(funcionario_id))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. justificativas_falta — mesmo escopo, e o INSERT deixa de ser aberto
--
-- `justfalta_insert` era WITH CHECK (true): qualquer autenticado podia gravar
-- justificativa em nome de qualquer pessoa, de qualquer filial, e assinar como
-- quem quisesse. O comentário da 114 dizia "RBAC refinado no frontend" — hoje
-- não há frontend nenhum escrevendo aqui (a tela de Frequência só lê), então a
-- policy era porta aberta sem porteiro e sem visita.
--
-- Aqui `funcionario_id` referencia auth.users (não `funcionarios`, como em
-- frequencia_trabalho), então a filial sai de user_profiles.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.perfil_filial(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(u.filial, 'Matriz')
    FROM public.user_profiles u
   WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.perfil_filial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfil_filial(uuid) TO authenticated;

DROP POLICY IF EXISTS "justfalta_select" ON public.justificativas_falta;
CREATE POLICY "justfalta_select" ON public.justificativas_falta
  FOR SELECT TO authenticated
  USING (
    public.auth_is_admin()
    OR funcionario_id = auth.uid()
    OR criado_por     = auth.uid()
    OR (
      public.auth_registra_frequencia()
      AND public.auth_pode_filial(public.perfil_filial(funcionario_id))
    )
  );

-- INSERT: a própria falta, sempre. Em nome de outro, só quem lança frequência
-- na filial daquela pessoa. E `criado_por` passa a ter que ser quem está
-- escrevendo — assinatura de terceiro era o furo mais silencioso dos dois.
DROP POLICY IF EXISTS "justfalta_insert" ON public.justificativas_falta;
CREATE POLICY "justfalta_insert" ON public.justificativas_falta
  FOR INSERT TO authenticated
  WITH CHECK (
    criado_por = auth.uid()
    AND (
      funcionario_id = auth.uid()
      OR public.auth_is_admin()
      OR (
        public.auth_registra_frequencia()
        AND public.auth_pode_filial(public.perfil_filial(funcionario_id))
      )
    )
  );

COMMIT;

-- PostgREST precisa recarregar o schema cache depois de mexer em policies.
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação (rodar como gerente de filial, não como service_role):
--
--   -- Deve devolver só funcionários da própria unidade:
--   SELECT DISTINCT public.funcionario_filial(funcionario_id)
--     FROM public.frequencia_trabalho;
--
--   -- Deve devolver 0 (nenhuma policy de frequência sem escopo de filial):
--   SELECT count(*) FROM pg_policies
--    WHERE tablename IN ('frequencia_trabalho', 'justificativas_falta')
--      AND qual IS NOT NULL
--      AND qual NOT LIKE '%filial%';
-- ────────────────────────────────────────────────────────────────────────────
