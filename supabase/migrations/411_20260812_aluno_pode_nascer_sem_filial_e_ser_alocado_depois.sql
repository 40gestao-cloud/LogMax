-- 411_20260812_aluno_pode_nascer_sem_filial_e_ser_alocado_depois.sql
--
-- Montar a turma exigia decidir a unidade de cada aluno na hora de criar a
-- conta. São dezenas de contas numa sentada, e a alocação é justamente a parte
-- que se resolve depois, com a turma toda na frente. O formulário obrigava a
-- escolher primeiro e reorganizar em seguida — duas passagens onde bastava uma.
--
-- `user_profiles.filial` era `NOT NULL DEFAULT 'Matriz'` (migr. 017), então
-- "ainda não sei" só tinha duas saídas ruins: chutar uma loja, ou cair na
-- Matriz — que para colaborador é pior que nada, porque a Matriz é escopo de
-- cargo global e a tela recusa colaborador lotado nela.
--
-- Agora NULL é permitido, e quer dizer exatamente o que parece: conta criada,
-- unidade ainda não decidida.
--
-- POR QUE NULL E NÃO UM RÓTULO 'Sem alocação':
--
-- Um literal novo entraria em VALID_FILIAIS, nos filtros, nos badges e — o que
-- importa — nas policies que comparam `filial = auth_user_filial()`. Rótulo
-- casa com rótulo: dois alunos não alocados ficariam na mesma "unidade" e se
-- enxergariam. NULL não casa com nada, nem consigo mesmo, então a comparação
-- devolve NULL, que em RLS reprova. O estado indefinido falha fechado.
--
-- O QUE ESSE ALUNO VÊ ENQUANTO ESPERA:
--
-- Nada, e de propósito. `auth_user_filial()` devolve NULL, logo
-- `auth_pode_filial(x)` é NULL para ele em qualquer unidade, e o App já barra
-- antes disso com "Filial não configurada — solicite ao administrador"
-- (App.tsx, gate `!filialAtiva && !podeEscolherFilial`). Essa tela deixa de ser
-- erro de cadastro e passa a ser a sala de espera do aluno recém-criado.
--
-- O DEFAULT 'Matriz' FICA. Só o NOT NULL sai. Assim nada que insira perfil sem
-- citar a coluna muda de comportamento; para nascer sem filial é preciso
-- mandar NULL explicitamente, e só o `/api/users` faz isso.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

ALTER TABLE public.user_profiles ALTER COLUMN filial DROP NOT NULL;

COMMENT ON COLUMN public.user_profiles.filial IS
  'Unidade do usuário. NULL = criado e ainda não alocado: o App barra o login '
  'com "Filial não configurada" e auth_pode_filial() reprova em toda unidade. '
  'DEFAULT continua Matriz — para nascer sem filial é preciso mandar NULL.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   SELECT is_nullable, column_default FROM information_schema.columns
--    WHERE table_name = 'user_profiles' AND column_name = 'filial';
--   -- esperado: is_nullable = YES, column_default = 'Matriz'::text
--
--   -- quem está esperando alocação:
--   SELECT nome, role, created_at FROM user_profiles
--    WHERE filial IS NULL ORDER BY created_at;
-- =================================================================
