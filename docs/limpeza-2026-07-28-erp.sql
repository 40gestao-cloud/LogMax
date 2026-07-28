-- ════════════════════════════════════════════════════════════════════════════
-- LIMPEZA OPERACIONAL — SOMENTE NO PROJETO LogMax-ERP (jvqsaccupxkvezriiede)
-- ════════════════════════════════════════════════════════════════════════════
-- Solicitada em 2026-07-28. NÃO é migração de schema: não numerar, não aplicar
-- nas outras turmas. Aprendiz, contabilidade e Adm ficam como estão.
--
-- Três blocos independentes. Cada um roda em transação própria — se um falhar,
-- os outros seguem válidos.
--
-- Blocos 2 e 3 são soft delete: `ativo = false`. Some das telas, o histórico
-- continua auditável, dá para desfazer trocando para true.
-- O bloco 1 é DELETE real, porque "começar do zero" na folha pede isso.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- BLOCO 1 — Folha de pagamento do zero, com estorno das carteiras
-- ────────────────────────────────────────────────────────────────────────────
-- Apaga 22 folhas, as 9 contas a pagar derivadas e as 30 transações MaxBank de
-- folha (R$ 34.317,22), debitando as carteiras na mesma transação. A ordem
-- importa: estornar saldo ANTES de apagar as transações que o explicam.
--
-- Efeitos automáticos que os triggers produzem — todos desejados:
--   • DELETE das contas pagas devolve o valor ao banco (sync_saldo_caixa_pagar
--     reage a DELETE). São 7 contas 'Pago' da MaxLook.
--   • As aberturas de saldo anterior da migr. 271 NÃO são tocadas: o saldo das
--     carteiras cai de R$ 128.867,06 para R$ 94.549,84, que é exatamente o
--     lastro histórico. Razão continua igual a saldo (sonda S2 segue limpa).

BEGIN;

WITH agg AS (
  SELECT conta_id, carteira,
         sum(CASE WHEN tipo = 'credito' THEN valor ELSE -valor END) AS delta
    FROM maxbank_transacoes
   WHERE origem = 'folha_pagamento'
   GROUP BY 1, 2
)
UPDATE maxbank_contas c
   SET saldo_salario      = c.saldo_salario      - COALESCE((SELECT delta FROM agg WHERE agg.conta_id = c.id AND agg.carteira = 'salario'),      0),
       saldo_beneficios   = c.saldo_beneficios   - COALESCE((SELECT delta FROM agg WHERE agg.conta_id = c.id AND agg.carteira = 'beneficios'),   0),
       saldo_bonificacoes = c.saldo_bonificacoes - COALESCE((SELECT delta FROM agg WHERE agg.conta_id = c.id AND agg.carteira = 'bonificacoes'), 0)
 WHERE EXISTS (SELECT 1 FROM agg WHERE agg.conta_id = c.id);

DELETE FROM maxbank_transacoes WHERE origem = 'folha_pagamento';

DELETE FROM contas_pagar
 WHERE folha_pagamento_id IS NOT NULL
    OR descricao ~ '\[folha:[0-9a-fA-F-]{36}\]';

-- folha_credito_falhas cai por CASCADE.
DELETE FROM folha_pagamento;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOCO 2 — Extrato de Tomate: a compra duplicada de 20/07
-- ────────────────────────────────────────────────────────────────────────────
-- Inativa SÓ o conjunto duplicado (pedido de 20/07 e tudo que nasceu dele).
-- A compra legítima de 14/07 e as 24 un vendidas no PDV permanecem.
--
-- Por que não os dois: o produto tem 24 un em estoque porque entraram 48 e o
-- PDV vendeu 24. Inativar as duas entradas levaria o saldo a −24, e desde a
-- migr. 268 o trigger recusa saldo negativo — a operação inteira falharia.
-- Inativando só a duplicata o estoque vai a 0, que é o resultado correto:
-- uma compra de 24, 24 vendidas, nada em prateleira.
--
-- Inativar a conta (que está 'Pago') devolve R$ 79,20 ao Sicredi sozinho.

BEGIN;

UPDATE movimentacoes_estoque SET ativo = false
 WHERE id = '90736660-0cbb-489d-8ee9-ece1990848fc';

UPDATE contas_pagar SET ativo = false
 WHERE id = '380b7674-0716-47f8-9399-9a9c2dd92265';

UPDATE recebimentos SET ativo = false
 WHERE id = 'b1ea83de-045d-4de3-94a3-f7f194ce99ed';

UPDATE pedidos SET ativo = false
 WHERE id = '73ba7bb8-5e75-47e6-bf04-b1aeb608f168';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- BLOCO 3 — As 23 requisições aprovadas que nunca viraram pedido
-- ────────────────────────────────────────────────────────────────────────────
-- Inativa as requisições. Filhos primeiro, senão ficam órfãos visíveis em
-- dashboard (padrão que a própria base já ensinou: soft delete não cascateia).
--
-- Duas correções em relação à primeira versão deste script:
--
--   • `aprovacoes_compras` NÃO tem coluna `ativo` — a primeira versão tentou
--     `ativo = false` nela e abortou o bloco inteiro. As 23 aprovações ficam
--     como estão: a tela de Aprovações filtra por 'Pendente' e essas são
--     'Aprovado', então não aparecem em lugar nenhum. Apagá-las de vez seria a
--     única alternativa, e destruiria o rastro de quem aprovou o quê.
--
--   • As 18 cotações dessas requisições já estavam inativas. O UPDATE fica
--     por segurança (0 linhas hoje, idempotente).
--
-- Statement único de propósito. A primeira versão usava `CREATE TEMP TABLE
-- ... ON COMMIT DROP` dentro de BEGIN/COMMIT, e o SQL Editor do Supabase
-- confirma cada statement por conta própria — a temp morria antes dos UPDATEs
-- ("relation _alvo does not exist"). Numa só instrução, o snapshot da CTE
-- congela a lista mesmo enquanto os UPDATEs mudam a condição que a define.

WITH alvo AS (
  SELECT r.id
    FROM requisicoes r
   WHERE r.status = 'Aprovado'
     AND COALESCE(r.ativo, true)
     AND NOT EXISTS (SELECT 1 FROM pedidos p
                      WHERE p.requisicao_id = r.id AND COALESCE(p.ativo, true))
), cot AS (
  UPDATE cotacoes SET ativo = false
   WHERE requisicao_id IN (SELECT id FROM alvo)
     AND COALESCE(ativo, true)
  RETURNING 1
)
UPDATE requisicoes SET ativo = false
 WHERE id IN (SELECT id FROM alvo);


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rodar depois dos três blocos)
-- ════════════════════════════════════════════════════════════════════════════
SELECT
  (SELECT count(*) FROM folha_pagamento)                                     AS folhas_restantes,
  (SELECT count(*) FROM maxbank_transacoes WHERE origem = 'folha_pagamento') AS tx_folha_restantes,
  (SELECT count(*) FROM contas_pagar WHERE descricao ~ '\[folha:')           AS contas_folha_restantes,
  (SELECT sum(saldo_salario + saldo_beneficios + saldo_bonificacoes)
     FROM maxbank_contas)                                                    AS saldo_carteiras,
  (SELECT count(*) FROM maxbank_contas
    WHERE saldo_salario < 0 OR saldo_beneficios < 0 OR saldo_bonificacoes < 0) AS carteiras_negativas,
  (SELECT estoque FROM produtos WHERE id = 'b11fd6ac-c027-48a5-9a81-f995ee4c9b46') AS estoque_tomate,
  (SELECT count(*) FROM requisicoes r
    WHERE r.status = 'Aprovado' AND COALESCE(r.ativo, true)
      AND NOT EXISTS (SELECT 1 FROM pedidos p
                       WHERE p.requisicao_id = r.id AND COALESCE(p.ativo, true))) AS requisicoes_soltas;

-- Esperado: 0 folhas, 0 tx, 0 contas, saldo 94.549,84, 0 negativas,
--           estoque_tomate = 0, 0 requisições soltas.
--
-- E a sonda S2 do MaxBank deve continuar em zero divergentes:
--   WITH led AS (SELECT conta_id, carteira,
--                  sum(CASE WHEN tipo='credito' THEN valor ELSE -valor END) AS l
--                  FROM maxbank_transacoes GROUP BY 1,2)
--   SELECT count(*) FROM maxbank_contas c
--     LEFT JOIN led s ON s.conta_id=c.id AND s.carteira='salario'
--     LEFT JOIN led b ON b.conta_id=c.id AND b.carteira='beneficios'
--     LEFT JOIN led o ON o.conta_id=c.id AND o.carteira='bonificacoes'
--    WHERE c.saldo_salario<>COALESCE(s.l,0) OR c.saldo_beneficios<>COALESCE(b.l,0)
--       OR c.saldo_bonificacoes<>COALESCE(o.l,0);
-- ════════════════════════════════════════════════════════════════════════════
