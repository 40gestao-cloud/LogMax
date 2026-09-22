-- 613_20260922_a_taxa_do_contrato_cabe_com_tres_casas.sql
--
-- A SuperMax pegou R$ 1.500.000 em 60x e a parcela saiu R$ 30.056,92. Quem
-- refizesse a conta com a taxa que a tela mostra — 0,63% a.m. — chegava em
-- R$ 30.099,71 e não fechava. O contrato não está errado; o CADASTRO é que
-- está arredondado.
--
--   `emprestimos_filial.taxa_juros` é `numeric(5,2)`.
--
-- A `aprovar_emprestimo` recebe a taxa cheia (0,625 — que é 7,5% ao ano ÷ 12),
-- monta a Price com ela e só depois grava na coluna, onde o 0,625 vira 0,63.
-- O cálculo usou um número e o cadastro guardou outro. Num ERP didático isso é
-- pior que um bug de conta: o aluno refaz a matemática, não bate, e conclui que
-- a matemática dele está errada.
--
-- Prova pela primeira parcela, que é a que não tem arredondamento acumulado:
--   juros₁ = R$ 9.375,00 = 1.500.000 × 0,625%   (com 0,63% seriam R$ 9.450,00)
--
-- Três casas resolvem: 0,625% cabe, e continua cabendo a divisão por 12 de
-- qualquer taxa anual cheia (1% a.a. = 0,083%). A escala inteira não muda —
-- (6,3) guarda até 999,999, como (5,2) guardava até 999,99.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O BACKFILL SÓ DESARREDONDA — NÃO REESCREVE TAXA NENHUMA
-- ────────────────────────────────────────────────────────────────────────────
-- A taxa de verdade do contrato é recuperável: `juros₁ / valor`. Mas só é
-- aplicada quando, arredondada de volta para duas casas, dá exatamente o que
-- está gravado hoje — ou seja, quando a única diferença entre as duas é o
-- arredondamento que esta migração está desfazendo.
--
-- Se a taxa derivada NÃO reproduzir a gravada, a divergência é outra coisa
-- (contrato montado com uma taxa e cadastrado com outra) e a linha fica como
-- está: isso é caso de olhar, não de corrigir no escuro.
--
-- Nada é recalculado. Parcela, juros, amortização, saldo devedor e títulos
-- continuam exatamente os mesmos — o que muda é a tela parar de mentir sobre a
-- taxa que gerou tudo isso.
--
-- `capital_config.taxa_juros_padrao` vai junto: é de lá que sai o valor
-- sugerido na aprovação, e de nada adianta o contrato aceitar 0,625 se a
-- política ainda arredonda antes de chegar nele.
--
-- Os gatilhos da tabela não reagem: `emprestimo_valida_condicoes` só cobra o
-- teto de prazo no INSERT, na aprovação ou quando `num_parcelas` muda, e o
-- arquivado fica de fora do UPDATE pelo WHERE.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

ALTER TABLE public.emprestimos_filial
  ALTER COLUMN taxa_juros TYPE numeric(6,3);

ALTER TABLE public.capital_config
  ALTER COLUMN taxa_juros_padrao TYPE numeric(6,3);

COMMENT ON COLUMN public.emprestimos_filial.taxa_juros IS
  'Juros ao MÊS em pontos percentuais, 3 casas (0,625 = 0,625% a.m. = 7,5% a.a.). Duas casas arredondavam 0,625 para 0,63 e a parcela deixava de bater com a taxa exibida.';

UPDATE public.emprestimos_filial e
   SET taxa_juros = d.taxa_real
  FROM (
    SELECT p.emprestimo_id,
           ROUND(p.juros / em.valor * 100, 3) AS taxa_real
      FROM public.parcelas_emprestimo p
      JOIN public.emprestimos_filial em ON em.id = p.emprestimo_id
     WHERE p.num_parcela = 1
       AND p.juros IS NOT NULL
       AND em.valor > 0
  ) d
 WHERE e.id = d.emprestimo_id
   AND e.status = 'Aprovado'
   AND e.arquivado_em IS NULL
   AND e.taxa_juros IS DISTINCT FROM d.taxa_real
   -- Só desarredonda: a derivada tem de reproduzir a gravada em 2 casas.
   AND ROUND(d.taxa_real, 2) = ROUND(e.taxa_juros, 2);

COMMIT;
