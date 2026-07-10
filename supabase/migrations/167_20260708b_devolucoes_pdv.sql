-- =================================================================
-- LogMax — Troca/Devolução no PDV (MaxLook)
-- =================================================================
-- Objetivo: permitir que o operador devolva item(ns) de uma venda já
-- concluída ao estoque, sem usar venda negativa (criar_venda_pdv
-- bloqueia p_total_final < 0 e qtd <= 0 por design — RAISE EXCEPTION
-- 'Valores negativos não permitidos.').
--
-- Abordagem: tabela de auditoria `devolucoes_pdv` + RPC dedicada
-- `estornar_venda_pdv` que:
--   1. Valida os itens contra o que foi realmente vendido em
--      `itens_venda` (não confia em input livre do cliente).
--   2. Impede devolver mais do que o vendido menos o já devolvido
--      (soma across `devolucoes_pdv.itens` da mesma venda).
--   3. Repõe `produtos.estoque` e registra `movimentacoes_estoque`
--      (tipo 'Entrada') pra manter o rastro igual a qualquer outra
--      movimentação.
--   4. NÃO mexe em contas_receber/contas_pagar automaticamente —
--      contas_receber não guarda venda_id (schema atual não linka),
--      então tentar reverter por heurística de texto seria frágil.
--      Quando a venda original era Fiado ou Cartão Crédito, a RPC
--      retorna `requer_ajuste_financeiro: true` e o frontend avisa o
--      operador para ajustar manualmente em Financeiro.
--
-- Execute no Supabase SQL Editor. Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Tabela de auditoria ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devolucoes_pdv (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id                 uuid NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  filial                   text NOT NULL,
  itens                    jsonb NOT NULL,
  valor_total              numeric(15,2) NOT NULL DEFAULT 0,
  motivo                   text,
  operador_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requer_ajuste_financeiro boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devolucoes_pdv_venda ON devolucoes_pdv (venda_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_pdv_filial_data ON devolucoes_pdv (filial, created_at DESC);

ALTER TABLE devolucoes_pdv ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devolucoes_pdv_select" ON devolucoes_pdv;
CREATE POLICY "devolucoes_pdv_select" ON devolucoes_pdv
  FOR SELECT TO authenticated USING (auth_in_setor('vendas', 'financeiro'));

DROP POLICY IF EXISTS "devolucoes_pdv_write" ON devolucoes_pdv;
CREATE POLICY "devolucoes_pdv_write" ON devolucoes_pdv
  FOR ALL TO authenticated USING (auth_in_setor('vendas')) WITH CHECK (auth_in_setor('vendas'));

-- ─── 2. RPC estornar_venda_pdv ──────────────────────────────────────
CREATE OR REPLACE FUNCTION estornar_venda_pdv(
  p_venda_id uuid,
  p_itens    jsonb, -- [{produto_id, nome_produto, qtd, preco_unitario, subtotal}]
  p_motivo   text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_venda            vendas;
  v_devolucao_id      uuid;
  v_item              jsonb;
  v_produto_id        uuid;
  v_nome_produto      text;
  v_qtd_devolver      numeric(15,3);
  v_qtd_vendida       numeric(15,3);
  v_qtd_ja_devolvida  numeric(15,3);
  v_valor_total       numeric(15,2) := 0;
  v_requer_ajuste     boolean;
  v_today             date := public.acre_today();
  v_short_id          text;
BEGIN
  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um item para devolver.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_venda FROM vendas WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_short_id := UPPER(RIGHT(p_venda_id::text, 6));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_produto_id   := (v_item->>'produto_id')::uuid;
    v_nome_produto := COALESCE(v_item->>'nome_produto', 'produto');
    v_qtd_devolver := (v_item->>'qtd')::numeric;

    IF v_qtd_devolver IS NULL OR v_qtd_devolver <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida para "%".', v_nome_produto USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM(qtd), 0) INTO v_qtd_vendida
      FROM itens_venda
     WHERE venda_id = p_venda_id AND produto_id = v_produto_id;

    IF v_qtd_vendida = 0 THEN
      RAISE EXCEPTION '"%" não faz parte desta venda.', v_nome_produto USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM((it->>'qtd')::numeric), 0) INTO v_qtd_ja_devolvida
      FROM devolucoes_pdv d, jsonb_array_elements(d.itens) it
     WHERE d.venda_id = p_venda_id AND (it->>'produto_id')::uuid = v_produto_id;

    IF v_qtd_ja_devolvida + v_qtd_devolver > v_qtd_vendida + 0.001 THEN
      RAISE EXCEPTION
        'Quantidade a devolver de "%" excede o disponível (vendido %, já devolvido %).',
        v_nome_produto, v_qtd_vendida, v_qtd_ja_devolvida
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE produtos SET estoque = estoque + v_qtd_devolver WHERE id = v_produto_id;

    INSERT INTO movimentacoes_estoque (produto_id, tipo, qtd, origem, destino, data, filial)
    VALUES (v_produto_id, 'Entrada', v_qtd_devolver, 'Venda #' || v_short_id, 'Devolução PDV', v_today, v_venda.filial);

    v_valor_total := v_valor_total + COALESCE((v_item->>'subtotal')::numeric, v_qtd_devolver * (v_item->>'preco_unitario')::numeric);
  END LOOP;

  v_requer_ajuste := v_venda.forma_pagamento IN ('Fiado', 'Cartão Crédito');

  INSERT INTO devolucoes_pdv (venda_id, filial, itens, valor_total, motivo, operador_id, requer_ajuste_financeiro)
  VALUES (p_venda_id, v_venda.filial, p_itens, v_valor_total, NULLIF(trim(p_motivo), ''), auth.uid(), v_requer_ajuste)
  RETURNING id INTO v_devolucao_id;

  RETURN jsonb_build_object(
    'id', v_devolucao_id,
    'valor_total', v_valor_total,
    'requer_ajuste_financeiro', v_requer_ajuste
  );
END;
$$;

GRANT EXECUTE ON FUNCTION estornar_venda_pdv(uuid, jsonb, text) TO authenticated;

COMMIT;
