-- 662_20260929_devolucao_de_servico_abate_anexo_iii.sql
--
-- Última pendência da formação de preço (659): a devolução de SERVIÇO abatia
-- a receita de mercadoria. `_receita_simples` tira o valor devolvido inteiro
-- da receita total, mas `_receita_servico` não sabia que parte dele era
-- serviço — então o Anexo III ficava cheio e o Anexo I pagava a conta.
--
--   • `itens_devolucao.servico_id`: o item devolvido que é serviço. Quem
--     preenche é o banco, pela linha da venda (mesmo nome, sem produto) — a
--     tela não precisa mandar nada.
--   • `_receita_servico` desconta o serviço devolvido no período (mesma régua
--     de `_receita_simples`: devolução ativa, da unidade, pela data no Acre).
--     Devolução de serviço vendido no mês anterior deixa o serviço do mês
--     negativo, como já acontece com mercadoria: o `_simples_periodo` soma os
--     dois anexos e a conta fecha.
--   • Backfill das devoluções existentes (nenhuma turma tem hoje).
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

ALTER TABLE public.itens_devolucao
  ADD COLUMN IF NOT EXISTS servico_id uuid REFERENCES public.servicos(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.itens_devolucao.servico_id IS
  'Serviço devolvido (migr. 662). Preenchido por criar_devolucao_venda a partir da linha da venda; desconta o Anexo III em _receita_servico.';

UPDATE public.itens_devolucao idev
   SET servico_id = iv.servico_id
  FROM public.devolucoes d, public.itens_venda iv
 WHERE d.id = idev.devolucao_id
   AND iv.venda_id = d.venda_id
   AND iv.servico_id IS NOT NULL
   AND iv.nome_produto = idev.nome_produto
   AND idev.produto_id IS NULL
   AND idev.servico_id IS NULL;

-- criar_devolucao_venda grava o serviço do item. Troca cirúrgica no corpo
-- vivo, conferida.
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.criar_devolucao_venda(uuid, jsonb, text, text, text)'::regprocedure);
  IF position('MIGR 662' in d) > 0 THEN
    RETURN;
  END IF;

  n := replace(d,
    '            devolucao_id, produto_id, nome_produto, qtd, preco_unitario, subtotal',
    '            devolucao_id, produto_id, nome_produto, qtd, preco_unitario, subtotal,
            servico_id  -- MIGR 662');
  IF n = d THEN RAISE EXCEPTION '662: âncora das colunas não achada em criar_devolucao_venda'; END IF;
  d := n;

  n := replace(d,
    '            v_dev_id, v_produto_id, v_nome, v_qtd, v_preco, v_subtotal',
    '            v_dev_id, v_produto_id, v_nome, v_qtd, v_preco, v_subtotal,
            CASE WHEN v_produto_id IS NULL THEN
              (SELECT iv.servico_id FROM public.itens_venda iv
                WHERE iv.venda_id = p_venda_id
                  AND iv.servico_id IS NOT NULL
                  AND iv.nome_produto = v_nome
                LIMIT 1)
            END');
  IF n = d THEN RAISE EXCEPTION '662: âncora dos valores não achada em criar_devolucao_venda'; END IF;

  EXECUTE n;
END $$;

CREATE OR REPLACE FUNCTION public._receita_servico(p_filial text, p_inicio date, p_fim date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ROUND(
    COALESCE((
      SELECT SUM((v.total - COALESCE(v.desconto, 0) - COALESCE(v.cupom_desconto, 0)) * s.serv / NULLIF(v.total, 0))
        FROM public.vendas v
        JOIN LATERAL (SELECT SUM(iv.subtotal) AS serv
                        FROM public.itens_venda iv
                       WHERE iv.venda_id = v.id AND iv.servico_id IS NOT NULL) s ON s.serv > 0
       WHERE v.ativo = true
         AND v.filial = p_filial
         AND v.status <> 'Cancelada'
         AND (v.created_at AT TIME ZONE 'America/Rio_Branco')::date BETWEEN p_inicio AND p_fim), 0)
    -- MIGR 662: o serviço devolvido sai do Anexo III, não da mercadoria.
  - COALESCE((
      SELECT SUM(idev.subtotal)
        FROM public.itens_devolucao idev
        JOIN public.devolucoes d ON d.id = idev.devolucao_id
       WHERE idev.servico_id IS NOT NULL
         AND d.ativo = true
         AND d.filial = p_filial
         AND (d.created_at AT TIME ZONE 'America/Rio_Branco')::date BETWEEN p_inicio AND p_fim), 0), 2);
$function$;

NOTIFY pgrst, 'reload schema';
