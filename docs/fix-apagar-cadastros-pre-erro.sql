-- Limpeza de dados — cadastros de funcionário anteriores ao recadastro
--
-- NÃO é migração de schema. Rodar nas 4 turmas; é genérico (sem ids fixos) e
-- idempotente — rodar de novo não acha mais nada e não muda nada.
--
-- ── O que apaga ─────────────────────────────────────────────────────────────
--
-- Todo `funcionarios` com `ativo = false`. Essa coluna é o soft-delete da tela
-- de Funcionários: são exatamente os cadastros que já foram apagados pela UI e
-- refeitos depois, quando o cadastro deu errado. O soft-delete tirou da lista,
-- mas não do banco — e as agregações que leem `ponto_eletronico` não olham
-- `funcionarios.ativo`, então o ponto do cadastro velho continuava pesando na
-- frequência da filial.
--
-- Casos concretos no momento em que isto foi escrito:
--   erp      — ` João lucas` (velho: 2 pontos / novo: 9) + 7 cadastros vazios
--   aprendiz — `Laiza Maia`  (velho: 8 pontos / novo: 1) + 4 outros
--
-- A folha da Laiza ilustra por que apagar é a correção e não um risco: o
-- cadastro velho tem 2 folhas de 2026-07 duplicadas (`ativo = false`,
-- 'Processada') e as 2 contas a pagar que elas geraram **também já estão
-- inativas**. A folha que vale — 'Paga', ativa — está no cadastro novo. O que
-- sai daqui é resíduo do erro, não histórico.
--
-- ── Guard ───────────────────────────────────────────────────────────────────
--
-- Antes de apagar, o script aborta se achar folha ou conta a pagar ATIVA
-- pendurada num cadastro inativo. Isso não existe nas turmas conferidas, mas o
-- script é genérico e roda em 4 bancos: apagar dinheiro vivo por descuido é
-- exatamente o que não pode acontecer.

BEGIN;

DO $$
DECLARE
  v_folha_viva  int;
  v_conta_viva  int;
  v_cadastros   int;
BEGIN
  SELECT count(*) INTO v_folha_viva
    FROM public.folha_pagamento fp JOIN public.funcionarios f ON f.id = fp.funcionario_id
   WHERE NOT f.ativo AND COALESCE(fp.ativo, true);

  SELECT count(*) INTO v_conta_viva
    FROM public.contas_pagar cp
    JOIN public.folha_pagamento fp ON fp.id = cp.folha_pagamento_id
    JOIN public.funcionarios f ON f.id = fp.funcionario_id
   WHERE NOT f.ativo AND COALESCE(cp.ativo, true);

  IF v_folha_viva > 0 OR v_conta_viva > 0 THEN
    RAISE EXCEPTION
      'Abortado: % folha(s) e % conta(s) a pagar ATIVAS penduradas em cadastro inativo. Conferir antes de apagar.',
      v_folha_viva, v_conta_viva;
  END IF;

  SELECT count(*) INTO v_cadastros FROM public.funcionarios WHERE NOT ativo;
  RAISE NOTICE 'Apagando % cadastro(s) inativo(s).', v_cadastros;
END $$;

-- ── 1. Dependências que NÃO cascateiam (ON DELETE NO ACTION) ────────────────
-- Ordem importa: conta a pagar → folha → o resto.

DELETE FROM public.contas_pagar cp
 USING public.folha_pagamento fp, public.funcionarios f
 WHERE cp.folha_pagamento_id = fp.id AND fp.funcionario_id = f.id AND NOT f.ativo;

-- CASCADE em folha_rubricas e folha_credito_falhas.
DELETE FROM public.folha_pagamento fp
 USING public.funcionarios f
 WHERE fp.funcionario_id = f.id AND NOT f.ativo;

DELETE FROM public.ponto_eletronico pe
 USING public.funcionarios f
 WHERE pe.funcionario_id = f.id AND NOT f.ativo;

DELETE FROM public.ferias fe
 USING public.funcionarios f
 WHERE fe.funcionario_id = f.id AND NOT f.ativo;

DELETE FROM public.matriz_tarefa_participantes mtp
 USING public.funcionarios f
 WHERE mtp.funcionario_id = f.id AND NOT f.ativo;

DELETE FROM public.candidaturas c
 USING public.funcionarios f
 WHERE (c.funcionario_id = f.id OR c.funcionario_origem_id = f.id) AND NOT f.ativo;

-- Perfil solta o vínculo em vez de ser apagado: a pessoa segue existindo.
UPDATE public.user_profiles up SET funcionario_id = NULL
  FROM public.funcionarios f
 WHERE up.funcionario_id = f.id AND NOT f.ativo;

-- ── 2. O cadastro ───────────────────────────────────────────────────────────
-- CASCADE leva junto: frequencia_trabalho, treinamento_inscricoes,
-- afastamentos, funcionario_beneficios, demissoes, rescisoes,
-- movimentacoes_carreira, vaga_convites.
DELETE FROM public.funcionarios WHERE NOT ativo;

COMMIT;

-- ── Verificação ─────────────────────────────────────────────────────────────
-- Esperado: 0 em tudo.
SELECT
  (SELECT count(*) FROM public.funcionarios WHERE NOT ativo) AS cadastros_inativos,
  (SELECT count(*) FROM public.ponto_eletronico pe
     LEFT JOIN public.funcionarios f ON f.id = pe.funcionario_id
    WHERE pe.funcionario_id IS NOT NULL AND f.id IS NULL)    AS ponto_orfao;

-- Frequência por filial depois da limpeza — confira se bate com o esperado.
SELECT pe.filial, count(*) AS registros, count(DISTINCT pe.funcionario_id) AS pessoas
  FROM public.ponto_eletronico pe
 WHERE pe.filial IN ('SuperMax','MaxLook','TechMax')
 GROUP BY 1 ORDER BY 1;
