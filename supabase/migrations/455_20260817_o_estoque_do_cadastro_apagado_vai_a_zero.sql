-- 455_20260817_o_estoque_do_cadastro_apagado_vai_a_zero.sql
--
-- 465 UNIDADES NA PRATELEIRA DE UM CADASTRO QUE NÃO EXISTE MAIS.
--
-- Passivo levantado pela auditoria de 17/08 e deixado em aberto de propósito
-- até aqui: dez produtos apagados nas 4 turmas continuam com saldo em
-- `produtos.estoque`. São R$ 152.308,70 a preço de custo, quase tudo num único
-- "Iphone 17 Pro Max" que foi cadastrado, recebido, apagado e recadastrado no
-- intervalo de doze minutos — com as duas entradas repetidas no segundo
-- cadastro.
--
-- Não corrompe número nenhum hoje: DRE, painel de BI e as telas de estoque
-- filtram `ativo`, então esse saldo não é somado em lugar algum. O incômodo é
-- outro — é uma afirmação falsa guardada no banco, esperando a primeira
-- consulta que esqueça o filtro. Foi assim que a auditoria achou os outros
-- cinco erros do dia.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ZERAR POR MOVIMENTAÇÃO, NUNCA PELA COLUNA
--
-- `UPDATE produtos SET estoque = 0` é a forma errada por dois motivos, e o
-- primeiro é que ela nem funciona: `trg_block_estoque_manual` devolve o valor
-- antigo se a transação não estiver marcada como movimentação. A trava existe
-- exatamente para o que eu faria aqui por atalho.
--
-- O segundo é o que importa: saldo é consequência, não campo. Ele é a soma das
-- movimentações, e a única maneira honesta de levá-lo a zero é dizer o que
-- aconteceu com a mercadoria. Uma Saída por produto, com a quantidade exata do
-- saldo e a origem escrita por extenso, deixa o kardex explicando o próprio
-- resultado — quem abrir daqui a um mês lê a linha e entende.
--
-- Conferido antes de escrever: nos dez, `estoque` bate exatamente com a soma
-- das movimentações ativas. Não há saldo órfão nem divergência a investigar —
-- só entradas de implantação de um cadastro que foi descartado.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE ISTO NÃO É "CONSERTAR CADASTRO DE ALUNO POR ADIVINHAÇÃO"
--
-- A regra que esta auditoria seguiu o dia todo diz para não decidir no lugar da
-- turma quando o dado é ambíguo. Aqui não é: o cadastro foi apagado por
-- alguém, deliberadamente, pela tela. Mercadoria de cadastro descartado não
-- está à venda, não entra em inventário e não vai ser vendida — o saldo já era
-- ficção antes desta migração, só que ficção invisível.
--
-- O que continua sendo da turma é a OUTRA metade, e ela fica: as entradas de
-- implantação duplicadas do iPhone permanecem no kardex, com a saída de ajuste
-- ao lado. A migração não apaga o erro de digitação — mostra o ciclo inteiro,
-- que é o que serve de aula.
--
-- IDEMPOTENTE: roda pelo saldo atual, e na segunda vez não encontra saldo.
-- APLICAR NOS 4 PROJETOS.

BEGIN;

DO $do$
DECLARE
  v_p     record;
  v_conta int := 0;
BEGIN
  FOR v_p IN
    SELECT id, nome, filial, estoque
      FROM public.produtos
     WHERE COALESCE(ativo, true) = false
       AND COALESCE(estoque, 0) > 0
     ORDER BY filial, nome
  LOOP
    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES (
      v_p.id, 'Saída', v_p.estoque,
      'Ajuste — cadastro apagado, saldo baixado (migr. 455)',
      'Baixa de cadastro',
      public.acre_today(),
      v_p.filial
    );

    v_conta := v_conta + 1;
  END LOOP;

  RAISE NOTICE 'Saldos baixados: %', v_conta;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. nenhum cadastro apagado com saldo — esperado: zero linhas
--   SELECT nome, filial, estoque FROM produtos
--    WHERE COALESCE(ativo, true) = false AND COALESCE(estoque, 0) > 0;
--
--   -- 2. as baixas, com o que elas zeraram
--   SELECT me.filial, p.nome, me.qtd, me.data, p.estoque AS saldo_agora
--     FROM movimentacoes_estoque me
--     JOIN produtos p ON p.id = me.produto_id
--    WHERE me.origem LIKE 'Ajuste — cadastro apagado%'
--    ORDER BY me.filial, p.nome;
--
--   -- 3. o kardex do iPhone duplicado conta a história inteira: duas entradas
--   --    de implantação e a saída de ajuste, na ordem em que aconteceram
--   SELECT me.data, me.tipo, me.qtd, me.origem
--     FROM movimentacoes_estoque me
--     JOIN produtos p ON p.id = me.produto_id
--    WHERE NOT p.ativo AND p.nome ILIKE '%17 Pro Max%'
--    ORDER BY me.created_at;
--
-- Os produtos continuam na Lixeira e continuam presos ali: agora têm uma
-- movimentação a mais, e movimentação é fato de terceiro. Está certo — o que
-- esta migração resolve é o saldo, não o histórico.
-- =================================================================
