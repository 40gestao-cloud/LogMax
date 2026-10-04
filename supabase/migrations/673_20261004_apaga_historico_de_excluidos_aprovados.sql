-- 673_20261004_apaga_historico_de_excluidos_aprovados.sql
--
-- Limpeza PONTUAL, com lista aprovada pelo usuário em 2026-10-04: apaga de
-- vez o histórico e o cadastro de 8 funcionários já excluídos (soft-delete,
-- `funcionarios.ativo = false`). Não é regra: daqui pra frente excluir só
-- tira a pessoa das tarefas (672) — apagar histórico continua sendo ação
-- pontual com lista aprovada ([[feedback_nao_apagar_sem_lista_aprovada]]).
--
--   ERP            Tomas Cauan Costa
--   Aprendiz       José Vitor, Davi Marçal
--   Contabilidade  lara Letícia, Vicente, Isabele Oliveira, Maria Tamires
--   Adm            Victor Rodrigues
--
-- Os IDs são fixos e só casam no projeto de cada um; nos outros, no-op.
-- Trava dupla: o id tem de estar na lista E o cadastro tem de estar excluído.
--
-- Davi Marçal (Aprendiz): a folha dele gerou uma conta a pagar. A conta FICA
-- (é lançamento financeiro da unidade) e só perde o vínculo com a folha
-- (`folha_pagamento_id = NULL`). A conta de usuário dele NÃO é apagada aqui —
-- perde só o vínculo com o funcionário; remover a conta é pela tela Usuários.
--
-- Rodar nos 4 projetos. Idempotente (segunda execução não acha nada).

BEGIN;

CREATE TEMP TABLE _alvo ON COMMIT DROP AS
  SELECT f.id
    FROM public.funcionarios f
   WHERE f.ativo = false
     AND f.id IN (
       '8118ab98-dbf1-4ef7-b38a-63b3b7dca8f5',  -- Tomas Cauan Costa (ERP)
       '3b274b8a-f9c9-424b-9ff7-78af1e85ae20',  -- José Vitor (Aprendiz)
       '61967862-ec26-4bc6-bf7c-dc4a9f3836a8',  -- Davi Marçal (Aprendiz)
       'aa2ccc4e-cc13-4ff2-93bb-671eae08e3ed',  -- lara Letícia (Contabilidade)
       'c897fa7c-1b1f-4412-a1c0-1f76184aeadb',  -- Vicente (Contabilidade)
       'efd20499-b68f-498d-9360-20bdf5527dc1',  -- Isabele Oliveira (Contabilidade)
       '8e18e1dc-5f17-480b-8d69-d2b9da645591',  -- Maria Tamires (Contabilidade)
       '4d38f259-ec51-4a5f-bcd3-53198074c428'   -- Victor Rodrigues (Adm)
     );

-- Notas de tarefa (sem FK: item_id aponta pro participante).
DELETE FROM public.avaliacoes_matriz am
 USING public.matriz_tarefa_participantes p
 WHERE am.item_id = p.id AND p.funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.matriz_tarefa_participantes WHERE funcionario_id IN (SELECT id FROM _alvo);
-- ciclo_tarefa_avaliacoes vai junto (ON DELETE CASCADE).
DELETE FROM public.ciclo_tarefa_participantes  WHERE funcionario_id IN (SELECT id FROM _alvo);

DELETE FROM public.ponto_eletronico        WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.frequencia_trabalho     WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.treinamento_inscricoes  WHERE funcionario_id IN (SELECT id FROM _alvo);
-- rescisoes vai junto com a demissão (CASCADE) e pela FK própria.
DELETE FROM public.rescisoes               WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.demissoes               WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.ferias                  WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.afastamentos            WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.funcionario_beneficios  WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.movimentacoes_carreira  WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.apuracao_bonus_itens    WHERE funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.vaga_convites           WHERE funcionario_id IN (SELECT id FROM _alvo);
UPDATE public.candidaturas SET funcionario_id = NULL        WHERE funcionario_id IN (SELECT id FROM _alvo);
UPDATE public.candidaturas SET funcionario_origem_id = NULL WHERE funcionario_origem_id IN (SELECT id FROM _alvo);
UPDATE public.mandatos     SET funcionario_id = NULL        WHERE funcionario_id IN (SELECT id FROM _alvo);

-- Folha: a conta a pagar fica, sem o vínculo; rubricas e falhas vão em CASCADE.
UPDATE public.contas_pagar cp SET folha_pagamento_id = NULL
  FROM public.folha_pagamento fp
 WHERE cp.folha_pagamento_id = fp.id AND fp.funcionario_id IN (SELECT id FROM _alvo);
DELETE FROM public.folha_pagamento WHERE funcionario_id IN (SELECT id FROM _alvo);

-- Conta de usuário NÃO é apagada: perde só o vínculo.
UPDATE public.user_profiles SET funcionario_id = NULL WHERE funcionario_id IN (SELECT id FROM _alvo);

DELETE FROM public.funcionarios WHERE id IN (SELECT id FROM _alvo);

COMMIT;
