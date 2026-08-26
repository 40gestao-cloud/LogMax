-- 557 — O cupom volta quando a venda é cancelada.
--
-- `fn_venda_cancelada_desfaz` desfaz bem: devolve o estoque item a item (com
-- guard de idempotência pela origem), devolve o aparelho com número de série
-- para 'Em estoque', cancela a cobrança que ainda não recebeu nada e marca a
-- que já recebeu. Três efeitos da venda, três desfeitos.
--
-- O quarto ficou de fora. `criar_venda_pdv` termina com:
--
--     IF v_tem_cupom THEN
--       UPDATE marketing_cupons SET usos = usos + 1 WHERE id = v_cupom.id;
--     END IF;
--
-- e nada devolve esse uso.
--
-- Teste rodado em 26/08 (transação revertida), como a Evilin — cupom AUDIT10,
-- 10% de desconto, limite de 3 usos:
--
--     venda com o cupom          → usos = 1
--     venda CANCELADA            → usos = 1   ← o uso não voltou
--     estoque depois de cancelar → 681 → 681  ← esse voltou certo
--
-- ─── POR QUE ISSO IMPORTA NUMA AULA ────────────────────────────────────────
--
-- Cupom tem `limite_uso`, e é justamente aí que a turma aprende a régua:
-- "campanha com 3 usos" significa três clientes. Três alunos testando o PDV e
-- cancelando queimam a campanha inteira sem nenhuma venda ter existido — e o
-- erro é invisível, porque `usos` não aparece em lugar nenhum além do próprio
-- cadastro do cupom. O aluno seguinte recebe 'Cupom atingiu o limite de usos.'
-- sem ter como saber por quê.
--
-- ─── O DESENHO SEGUE O DO ESTOQUE, AO LADO ─────────────────────────────────
--
-- O gatilho já dispara só na transição para 'Cancelada' (o `WHEN` do
-- `CREATE TRIGGER`), então roda uma vez por cancelamento. O `usos > 0` é a
-- mesma cautela do `HAVING SUM(iv.qtd) > 0` do bloco de estoque: não deixa a
-- correção criar um número impossível se o gatilho for disparado à mão sobre
-- uma linha já tratada.
--
-- `vendas.cupom_id` é gravado por `criar_venda_pdv` no mesmo INSERT da venda,
-- então o elo já existe — não é preciso casar por código nem por descrição.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_venda_cancelada_desfaz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_short   text := upper(right(NEW.id::text, 6));
  v_hoje    date := public.acre_today();
  v_origem  text;
  v_item    record;
  v_marca   text;
BEGIN
  v_origem := 'Estorno — Venda #' || v_short || ' cancelada';
  v_marca  := ' [venda #' || v_short || ' cancelada — devolver ao cliente]';

  -- 1.1 Estoque de volta. Uma Entrada por item, com guard de idempotência pela
  -- origem: se a tela antiga já estornou este item, não estorna de novo.
  FOR v_item IN
    SELECT iv.produto_id, SUM(iv.qtd) AS qtd
      FROM public.itens_venda iv
     WHERE iv.venda_id = NEW.id
       AND iv.produto_id IS NOT NULL
     GROUP BY iv.produto_id
    HAVING SUM(iv.qtd) > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.movimentacoes_estoque me
       WHERE me.produto_id = v_item.produto_id
         AND me.origem = v_origem
         AND COALESCE(me.ativo, true)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.movimentacoes_estoque
      (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES
      (v_item.produto_id, 'Entrada', v_item.qtd, v_origem, 'Almoxarifado',
       v_hoje, COALESCE(NEW.filial, 'SuperMax'));
  END LOOP;

  -- 1.2 Aparelho de volta para 'Em estoque'. Mesma decisão da 446: o vínculo
  -- com a venda antiga PERMANECE (o recibo já emitido lê `venda_id` para
  -- imprimir o IMEI); só o estado muda, e a próxima venda sobrescreve.
  UPDATE public.produto_unidades pu
     SET status     = 'Em estoque',
         vendida_em = NULL,
         observacao = trim(both ' ' from COALESCE(pu.observacao || ' | ', '')
           || 'Venda ' || v_short || ' cancelada em '
           || to_char(v_hoje, 'DD/MM/YYYY'))
   WHERE pu.ativo
     AND pu.venda_id = NEW.id
     AND pu.status = 'Vendida';

  -- 1.3 Cobrança. O elo é `contas_receber.venda_id` — a coluna existe e
  -- `criar_venda_pdv` a grava em toda venda. (Até a migr. 553 este comentário
  -- dizia que a coluna NÃO existia e que o elo era a descrição: era verdade
  -- quando a 448 foi escrita, e deixou de ser quando a coluna nasceu. O código
  -- migrou; o comentário não. Quem escrever o próximo desfazimento usa
  -- `venda_id`, não texto.)
  UPDATE public.contas_receber cr
     SET status     = 'Cancelado',
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.venda_id = NEW.id
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) = 0;

  -- Dinheiro que entrou fica, e fica VISÍVEL. `position` em vez de LIKE para
  -- não marcar duas vezes se o gatilho rodar de novo.
  UPDATE public.contas_receber cr
     SET descricao  = cr.descricao || v_marca,
         updated_at = now()
   WHERE cr.ativo
     AND cr.filial IS NOT DISTINCT FROM NEW.filial
     AND cr.venda_id = NEW.id
     AND cr.status <> 'Cancelado'
     AND COALESCE(cr.valor_pago, 0) > 0
     AND position(v_marca in cr.descricao) = 0;

  -- 1.4 Cupom de volta para a campanha (MIGR 557). A venda consumiu um uso no
  -- `criar_venda_pdv`; cancelada, ela não consumiu nada. Sem isto, três alunos
  -- testando e cancelando esgotam uma campanha de 3 usos sem nenhuma venda ter
  -- existido — e o próximo recebe 'Cupom atingiu o limite de usos.' sem ter
  -- como descobrir o porquê.
  IF NEW.cupom_id IS NOT NULL THEN
    UPDATE public.marketing_cupons
       SET usos = usos - 1
     WHERE id = NEW.cupom_id
       AND COALESCE(usos, 0) > 0;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
