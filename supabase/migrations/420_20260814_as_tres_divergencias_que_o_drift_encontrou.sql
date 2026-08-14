-- 420_20260814_as_tres_divergencias_que_o_drift_encontrou.sql
--
-- Primeira rodada do `npm run drift` depois da 419. Views, colunas, funções,
-- triggers, policies, RLS, grants, tabelas e realtime saíram idênticos nos 4.
-- Sobraram três divergências, todas com a LogMax-ERP de um lado e as outras
-- três turmas do outro — e todas com a mesma origem: migração que criou o
-- objeto no ERP primeiro e depois foi propagada com `IF NOT EXISTS`, que não
-- toca no que já existe.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. aprovacoes_estoque: FK sem CASCADE no ERP  ← a única com efeito visível
--
--   ERP:     FOREIGN KEY (requisicao_estoque_id) REFERENCES requisicoes_estoque(id)
--   outras:  ... ON DELETE CASCADE
--
-- O schema de bootstrap (docs/setup-turma/logmax_supabase_schema.sql:243) diz
-- CASCADE, então quem está fora do combinado é o ERP. Consequência prática:
-- apagar uma requisição de estoque no ERP estoura violação de FK enquanto nas
-- outras três leva a aprovação junto. Mesma tela, mesmo clique, erro só numa
-- turma — exatamente o tipo de coisa que aparece no meio da aula.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. filial_caixa_config: dois formatos da mesma tabela
--
--   ERP (migr. 157):  CHECK (filial IN ('SuperMax','MaxLook','TechMax'))
--                     updated_by REFERENCES public.user_profiles(id)
--   outras (migr. 196): sem CHECK
--                     updated_by REFERENCES auth.users(id)
--
-- A 196 diz no cabeçalho "após aplicar nos 4, o schema converge 100%". Não
-- convergiu: ela cria a tabela com `CREATE TABLE IF NOT EXISTS`, e no ERP a
-- tabela já existia desde a 157. O IF NOT EXISTS protege contra erro, não
-- contra diferença — é uma armadilha silenciosa em migração de propagação.
--
-- Canônico escolhido: **fica com o CHECK** (é guarda de verdade — só as três
-- unidades operacionais têm caixa, a Matriz não) e **a FK aponta para
-- auth.users**, que é o que o resto do schema usa para colunas de autoria.
-- Ou seja: as outras três ganham o CHECK, o ERP troca a FK.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 3. caixa_bancos: índices diferentes
--
--   ERP:     idx_caixa_bancos_filial ON (filial)
--            idx_caixa_bancos_reserva_filial ON (filial) WHERE is_reserva AND ativo
--   outras:  idx_caixa_bancos_filial ON (filial) WHERE filial IS NOT NULL
--
-- O índice da reserva veio da migr. 176, que só rodou no ERP. A coluna
-- `is_reserva` existe nas quatro (a 196 garantiu) e a tela usa
-- (CaixaBancosView filtra por ela) — o índice serve às quatro. Isto é
-- performance, não comportamento: nenhuma consulta muda de resultado.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A FK que faltava cascatear
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_delrule "char";
BEGIN
  SELECT confdeltype INTO v_delrule
    FROM pg_constraint
   WHERE conrelid = 'public.aprovacoes_estoque'::regclass
     AND conname  = 'aprovacoes_estoque_requisicao_estoque_id_fkey';

  -- 'c' = CASCADE. Já está no formato certo (as outras três turmas): sai.
  IF v_delrule IS NULL OR v_delrule = 'c' THEN
    RETURN;
  END IF;

  ALTER TABLE public.aprovacoes_estoque
    DROP CONSTRAINT aprovacoes_estoque_requisicao_estoque_id_fkey;

  ALTER TABLE public.aprovacoes_estoque
    ADD CONSTRAINT aprovacoes_estoque_requisicao_estoque_id_fkey
    FOREIGN KEY (requisicao_estoque_id)
    REFERENCES public.requisicoes_estoque(id) ON DELETE CASCADE;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Um formato só para filial_caixa_config
-- ────────────────────────────────────────────────────────────────────────────

-- 2a. O CHECK das três unidades operacionais.
DO $$
DECLARE
  v_intrusos text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.filial_caixa_config'::regclass
       AND conname  = 'filial_caixa_config_filial_check'
  ) THEN
    RETURN;
  END IF;

  -- Confere os dados ANTES de criar a constraint: assim a falha vem com o
  -- nome do que está fora da régua, e não com um erro de constraint genérico
  -- que obriga a ir investigar na mão.
  SELECT string_agg(DISTINCT filial, ', ') INTO v_intrusos
    FROM public.filial_caixa_config
   WHERE filial NOT IN ('SuperMax', 'MaxLook', 'TechMax');

  IF v_intrusos IS NOT NULL THEN
    RAISE EXCEPTION
      'filial_caixa_config tem linha fora das unidades operacionais: %. Remova antes de aplicar o CHECK.',
      v_intrusos USING ERRCODE = 'P0001';
  END IF;

  ALTER TABLE public.filial_caixa_config
    ADD CONSTRAINT filial_caixa_config_filial_check
    CHECK (filial IN ('SuperMax', 'MaxLook', 'TechMax'));
END $$;

-- 2b. updated_by aponta para auth.users, como o resto do schema.
DO $$
DECLARE
  v_ref text;
BEGIN
  SELECT confrelid::regclass::text INTO v_ref
    FROM pg_constraint
   WHERE conrelid = 'public.filial_caixa_config'::regclass
     AND conname  = 'filial_caixa_config_updated_by_fkey';

  IF v_ref IS NULL OR v_ref = 'auth.users' THEN
    RETURN;
  END IF;

  ALTER TABLE public.filial_caixa_config
    DROP CONSTRAINT filial_caixa_config_updated_by_fkey;

  ALTER TABLE public.filial_caixa_config
    ADD CONSTRAINT filial_caixa_config_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Os mesmos índices em caixa_bancos
--
-- O DROP + CREATE do índice de filial é para igualar a definição. O predicado
-- `WHERE filial IS NOT NULL` das outras três NÃO é redundante — `filial` é
-- nullable aqui, e NULL quer dizer "caixa global da Matriz" (vide migr. 157).
-- Só que as policies de caixa_bancos perguntam `filial IS NULL OR filial = ...`,
-- e o índice parcial não ajuda no primeiro ramo. O índice cheio atende os dois
-- e é o formato do ERP; é ele que fica.
-- ────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_caixa_bancos_filial;
CREATE INDEX idx_caixa_bancos_filial
  ON public.caixa_bancos USING btree (filial);

CREATE INDEX IF NOT EXISTS idx_caixa_bancos_reserva_filial
  ON public.caixa_bancos USING btree (filial)
  WHERE (is_reserva = true AND ativo = true);

COMMIT;

-- Depois de aplicar nos 4: `npm run drift` tem de sair sem divergência real
-- (só a nota conhecida da ordem física de coluna).
