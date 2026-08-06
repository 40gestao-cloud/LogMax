-- Correção de dados — turma `logmax-aprendiz` SOMENTE
--
-- NÃO é migração de schema: não roda nas outras 3 turmas, e não deve entrar em
-- `supabase/migrations/`. É limpeza de cadastro duplicado, com ids fixos desta
-- turma.
--
-- ── O problema ──────────────────────────────────────────────────────────────
--
-- Dois alunos têm mais de um registro em `funcionarios` apontando para o MESMO
-- `user_profile_id`, e o histórico ficou espalhado entre eles:
--
--   Adrian Matheus (perfil 5bee4035…) — 3 cadastros:
--     350002cc  Desligado, ativo=false → 5 pontos, 1 folha, 2 frequências
--     edea749c  Desligado, ativo=true  → a demissão e a rescisão
--     bd95aa4c  Ativo,     ativo=false → 1 afastamento, 1 treino, 1 frequência
--
--   Pedro (perfil 84957d2e…) — 2 cadastros com nomes diferentes:
--     b0f47ff5  'Pedro Praxedes', Ativo  → 8 pontos, 2 folhas, 5 frequências
--     e5cdb05d  'Pedro Gabriel',  ativo=false → 1 treino
--
-- O do Adrian é o que dói: o cadastro que a tela de frequência mostra
-- (edea749c) não é o que tem o ponto (350002cc). Lançar presença pela Matriz
-- criaria histórico num terceiro lugar. E um dos três está em 'Ativo', o que
-- deixaria a filial contando alguém já desligado se a régua olhasse só
-- `funcionarios.status` — é por isso que `_funcionario_desligado` (migr. 356)
-- aceita os dois marcadores.
--
-- ── A correção ──────────────────────────────────────────────────────────────
--
-- Consolidar em um cadastro por pessoa: o que tem o histórico mais pesado
-- vence, as FKs dos perdedores são repontadas para ele, e os perdedores viram
-- `ativo = false` (soft-delete — nada é apagado).
--
-- Três tabelas têm UNIQUE PARCIAL `WHERE ativo = true`
-- (`treinamento_inscricoes`, `frequencia_trabalho`, `folha_pagamento`): ali o
-- repontamento colidiria, então a linha duplicada do perdedor é inativada
-- ANTES de migrar. `ponto_eletronico` tem UNIQUE TOTAL (funcionario_id, data)
-- e nenhuma coluna `ativo`: o que colidir fica onde está e é listado no
-- relatório final, para decisão manual. Hoje não há colisão de ponto.
--
-- Idempotente: rodar de novo não encontra o que mover e não muda nada.

BEGIN;

DO $$
DECLARE
  par           record;
  v_ponto_preso int;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      -- (perdedor, vencedor)
      ('edea749c-3907-45e5-acf9-e3e2b0197d10'::uuid, '350002cc-041e-4d5a-b82e-11a694ccaf45'::uuid),
      ('bd95aa4c-915b-446e-99fd-b7222ab80769'::uuid, '350002cc-041e-4d5a-b82e-11a694ccaf45'::uuid),
      ('e5cdb05d-7010-415d-a633-dc867617b68d'::uuid, 'b0f47ff5-7264-4690-97d8-8be0b7db927d'::uuid)
    ) v(perdedor, vencedor)
  LOOP
    -- ── 1. UNIQUE parcial: inativa a duplicata antes de migrar ──────────────
    UPDATE public.treinamento_inscricoes t SET ativo = false
     WHERE t.funcionario_id = par.perdedor AND t.ativo
       AND EXISTS (SELECT 1 FROM public.treinamento_inscricoes v
                    WHERE v.funcionario_id = par.vencedor
                      AND v.treinamento_id = t.treinamento_id AND v.ativo);

    UPDATE public.frequencia_trabalho f SET ativo = false
     WHERE f.funcionario_id = par.perdedor AND f.ativo
       AND EXISTS (SELECT 1 FROM public.frequencia_trabalho v
                    WHERE v.funcionario_id = par.vencedor
                      AND v.data = f.data AND v.ativo);

    UPDATE public.folha_pagamento f SET ativo = false
     WHERE f.funcionario_id = par.perdedor AND f.ativo
       AND EXISTS (SELECT 1 FROM public.folha_pagamento v
                    WHERE v.funcionario_id = par.vencedor
                      AND v.mes_ref = f.mes_ref AND v.ativo);

    UPDATE public.treinamento_inscricoes SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.frequencia_trabalho    SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.folha_pagamento        SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;

    -- ── 2. UNIQUE total, sem soft-delete: só o que não colide ───────────────
    UPDATE public.ponto_eletronico p SET funcionario_id = par.vencedor
     WHERE p.funcionario_id = par.perdedor
       AND NOT EXISTS (SELECT 1 FROM public.ponto_eletronico v
                        WHERE v.funcionario_id = par.vencedor AND v.data = p.data);

    SELECT count(*) INTO v_ponto_preso FROM public.ponto_eletronico WHERE funcionario_id = par.perdedor;
    IF v_ponto_preso > 0 THEN
      RAISE WARNING 'Cadastro % ficou com % registro(s) de ponto que colidem com o vencedor % — resolver à mão.',
        par.perdedor, v_ponto_preso, par.vencedor;
    END IF;

    -- ── 3. Sem restrição de unicidade: repontar tudo ────────────────────────
    UPDATE public.demissoes                 SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.rescisoes                 SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.ferias                    SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.afastamentos              SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.funcionario_beneficios    SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.matriz_tarefa_participantes SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.movimentacoes_carreira    SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.vaga_convites             SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.candidaturas              SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;
    UPDATE public.candidaturas              SET funcionario_origem_id = par.vencedor WHERE funcionario_origem_id = par.perdedor;
    UPDATE public.user_profiles             SET funcionario_id = par.vencedor WHERE funcionario_id = par.perdedor;

    -- ── 4. Aposenta o perdedor ──────────────────────────────────────────────
    -- `user_profile_id = NULL` é o que impede a duplicata de voltar: é por essa
    -- coluna que os cadastros se colavam à mesma pessoa.
    UPDATE public.funcionarios
       SET ativo = false, user_profile_id = NULL, updated_at = now()
     WHERE id = par.perdedor;
  END LOOP;
END $$;

-- ── 5. Os vencedores ficam visíveis e com o estado certo ─────────────────────
--
-- Adrian está em recuperação: `ativo = true` para aparecer na lista de
-- lançamento da Matriz (migr. 357), `status = 'Desligado'` porque é o que ele
-- é. As duas coisas juntas não são contradição — `ativo` é o soft-delete do
-- cadastro, `status` é a situação da pessoa.
UPDATE public.funcionarios
   SET ativo = true, status = 'Desligado', updated_at = now()
 WHERE id = '350002cc-041e-4d5a-b82e-11a694ccaf45';

UPDATE public.funcionarios
   SET ativo = true, status = 'Ativo', updated_at = now()
 WHERE id = 'b0f47ff5-7264-4690-97d8-8be0b7db927d';

-- O perfil volta a apontar para o cadastro sobrevivente.
UPDATE public.user_profiles SET funcionario_id = '350002cc-041e-4d5a-b82e-11a694ccaf45'
 WHERE id = '5bee4035-b0c6-461e-987d-4b35e8a93821';
UPDATE public.user_profiles SET funcionario_id = 'b0f47ff5-7264-4690-97d8-8be0b7db927d'
 WHERE id = '84957d2e-a962-476f-80b3-f4011c9eec40';

COMMIT;

-- ── Verificação ──────────────────────────────────────────────────────────────
-- Esperado: nenhuma linha. Se voltar alguma, sobrou perfil com mais de um
-- cadastro ativo.
SELECT up.id AS perfil, count(*) AS cadastros_ativos, string_agg(f.nome || ' / ' || f.status, ' | ')
  FROM public.funcionarios f
  JOIN public.user_profiles up ON up.id = f.user_profile_id
 WHERE f.ativo
 GROUP BY up.id
HAVING count(*) > 1;

-- Estado final dos dois casos.
SELECT f.nome, f.filial, f.status, f.ativo,
       (SELECT count(*) FROM public.ponto_eletronico p WHERE p.funcionario_id = f.id) AS pontos,
       (SELECT count(*) FROM public.demissoes d WHERE d.funcionario_id = f.id)        AS demissoes,
       (f.user_profile_id IS NOT NULL) AS ligado_ao_perfil
  FROM public.funcionarios f
 WHERE f.id IN (
   '350002cc-041e-4d5a-b82e-11a694ccaf45','edea749c-3907-45e5-acf9-e3e2b0197d10',
   'bd95aa4c-915b-446e-99fd-b7222ab80769','b0f47ff5-7264-4690-97d8-8be0b7db927d',
   'e5cdb05d-7010-415d-a633-dc867617b68d')
 ORDER BY f.nome, f.ativo DESC;
