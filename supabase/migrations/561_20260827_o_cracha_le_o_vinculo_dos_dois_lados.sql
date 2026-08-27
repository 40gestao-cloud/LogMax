-- Meu Crachá — o vínculo perfil<->funcionário passa a valer pelos dois lados,
-- e trocar esse vínculo deixa de ser coisa que o próprio aluno faz.
--
-- O que a auditoria achou, exercitando (JWT + SET LOCAL ROLE, transação revertida):
--
-- 1. `funcionarios.func_self` só reconhecia o vínculo gravado em
--    `user_profiles.funcionario_id`. Mas o vínculo é gravado nos DOIS lados —
--    `funcionarios.user_profile_id` é o outro — e nem sempre nos dois ao mesmo
--    tempo: numa das turmas TODOS os 39 perfis estavam com `funcionario_id`
--    nulo e quem apontava era o lado de `funcionarios` (26 linhas). Resultado
--    na tela: a turma inteira via "sua conta não está ligada a um cadastro de
--    funcionário" e um crachá SEM QR, no dia em que o crachá é usado.
--
-- 2. `funcionario_id` não estava na lista do gatilho anti-privesc, e a policy
--    de UPDATE de `user_profiles` deixa cada um escrever a própria linha. Ou
--    seja: o aluno apontava o próprio `funcionario_id` para o funcionário de
--    outra pessoa e, pela `func_self`, passava a LER aquela linha — inclusive
--    `salario`. Reproduzido: 0 linhas antes, 1 linha com salário depois.
--    A ponta de trás dessa mesma corda é o ponto, que é lançado por
--    `funcionario_id`.
--
-- O vínculo continua editável pelo professor em Usuários (é ele quem liga conta
-- e cadastro), e pelo service role em /api/users. O que sai de cena é o
-- caminho do próprio interessado.

BEGIN;

-- 1) Backfill: o lado canônico (`user_profiles.funcionario_id`) recebe o que já
--    estava dito no outro lado. Só onde não há ambiguidade — perfil sem vínculo
--    e um único funcionário apontando para ele.
UPDATE user_profiles up
   SET funcionario_id = f.id
  FROM funcionarios f
 WHERE f.user_profile_id = up.id
   AND up.funcionario_id IS NULL
   AND (SELECT count(*) FROM funcionarios f2 WHERE f2.user_profile_id = up.id) = 1;

-- 2) A leitura da própria linha de `funcionarios` passa a aceitar os dois lados.
--    Escrever `user_profile_id` continua sendo privilégio de RH/gerente da
--    unidade (policy `rh_filial_all`), então isto não abre porta nova: quem
--    poderia apontar o campo já lia a unidade inteira.
DROP POLICY IF EXISTS func_self ON funcionarios;
CREATE POLICY func_self ON funcionarios
  FOR SELECT
  USING (
    id = (SELECT up.funcionario_id FROM user_profiles up WHERE up.id = auth.uid())
    OR user_profile_id = auth.uid()
  );

-- 3) Gatilho anti-privesc: `funcionario_id` entra na lista. Copiado do banco
--    (não do arquivo antigo) e devolvido inteiro, com a cláusula nova.
--    `auth_user_role() = 'admin'` literal, e não `auth_is_admin()` — este
--    último inclui CEO e conselheiro, que são alunos como os outros.
CREATE OR REPLACE FUNCTION public.user_profiles_bloquear_privesc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Alteração de role bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.setor IS DISTINCT FROM OLD.setor THEN
    RAISE EXCEPTION 'Alteração de setor bloqueada — use /api/users (admin/CEO/gerente).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.setores_extras IS DISTINCT FROM OLD.setores_extras THEN
    RAISE EXCEPTION 'Alteração de setores_extras bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.filial IS DISTINCT FROM OLD.filial THEN
    RAISE EXCEPTION 'Alteração de filial bloqueada — use /api/users.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_conselheiro IS DISTINCT FROM OLD.is_conselheiro THEN
    RAISE EXCEPTION 'Alteração de is_conselheiro bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pode_acessar_usuarios IS DISTINCT FROM OLD.pode_acessar_usuarios THEN
    RAISE EXCEPTION 'Alteração de pode_acessar_usuarios bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.criado_por IS DISTINCT FROM OLD.criado_por THEN
    RAISE EXCEPTION 'Alteração de criado_por bloqueada.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.desligado_em IS DISTINCT FROM OLD.desligado_em
     AND COALESCE(current_setting('app.desligamento_rh', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Alteração de desligado_em bloqueada — desligamento e readmissão passam pelo RH.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'Alteração de ativo bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  -- Quem liga conta a cadastro é o professor, na tela de Usuários. Deixar o
  -- próprio interessado mexer aqui é entregar a leitura da linha de
  -- `funcionarios` de quem ele escolher — salário incluído.
  IF NEW.funcionario_id IS DISTINCT FROM OLD.funcionario_id
     AND NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Alteração de funcionario_id bloqueada — o vínculo é feito pelo professor em Usuários.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
