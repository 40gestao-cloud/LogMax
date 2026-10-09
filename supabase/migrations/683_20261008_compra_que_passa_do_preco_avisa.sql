-- 683 — Compra que joga o custo acima do preço de venda avisa o Financeiro.
--
-- As travas da 601 (produto_preco_nao_fica_abaixo_do_custo e
-- custo_manual_nao_passa_do_preco_de_venda) só pegam o que alguém DIGITA. O
-- custo que chega pela compra — custo médio no recebimento (fn_custo_medio_da_
-- entrada) e ajuste pela nota (_ajustar_custo_pela_nota, migr. 645/657) —
-- atualiza produtos_custo calado. Na auditoria de 08/10, 6 produtos da
-- Aprendiz vendiam abaixo do custo sem ninguém saber (sabão a R$ 9 com custo de
-- R$ 49 — cara de pedido feito por fardo em vez de unidade).
--
-- A entrada NÃO é recusada: a mercadoria chegou e o custo é o que é; travar o
-- almoxarifado por um problema de preço seria pior. O que muda é que alguém
-- fica sabendo, no momento em que acontece, e com a pista do fardo quando o
-- unitário da compra é várias vezes o preço de venda.
--
-- Um gatilho só, em produtos_custo, cobre os dois caminhos. Avisa na
-- PASSAGEM para acima do preço (não a cada compra seguinte), e respeita a
-- exceção deliberada `venda_abaixo_custo`.
--
-- Achado no teste: o tipo 'alerta' NÃO existia em chk_notif_tipo. Três
-- funções já o usavam — _folha_creditar_e_avancar ("Folha sem crédito no
-- MaxBank"), conta_pagar_avancar_rescisao e efetivar_promocao — dentro de
-- BEGIN/EXCEPTION, então o aviso morria calado desde sempre. O tipo entra na
-- CHECK (e no sino, src/components/NotificationBell.tsx) e os três voltam a
-- avisar sem mexer neles.

ALTER TABLE public.notificacoes DROP CONSTRAINT IF EXISTS chk_notif_tipo;
ALTER TABLE public.notificacoes ADD CONSTRAINT chk_notif_tipo CHECK (tipo = ANY (ARRAY[
  'aprovacao_pendente', 'aprovado', 'reprovado', 'mensagem_setor', 'tarefa_atribuida',
  'tarefa_concluida', 'ti_chamado', 'ti_resolvido', 'info', 'treinamento_atribuido',
  'briefing_diario', 'justificativa_falta', 'devolvido_correcao', 'alerta'
]::text[]));

CREATE OR REPLACE FUNCTION public.fn_custo_de_compra_passa_do_preco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p    public.produtos;
  v_msg  text;
BEGIN
  IF COALESCE(NEW.origem, '') <> 'compra' OR COALESCE(NEW.preco_custo, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_p FROM public.produtos WHERE id = NEW.produto_id;
  IF v_p.id IS NULL OR COALESCE(v_p.preco, 0) <= 0 OR COALESCE(v_p.venda_abaixo_custo, false)
     OR COALESCE(v_p.tipo, '') = 'patrimonio' THEN
    RETURN NEW;
  END IF;
  IF NEW.preco_custo <= v_p.preco THEN
    RETURN NEW;
  END IF;
  -- Já estava acima antes desta atualização: o aviso já foi dado.
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.preco_custo, 0) > v_p.preco THEN
    RETURN NEW;
  END IF;

  v_msg := format('A compra levou o custo de "%s" para R$ %s, acima do preço de venda (R$ %s). Cada venda agora dá prejuízo.',
                  v_p.nome,
                  replace(to_char(NEW.preco_custo, 'FM999999990.00'), '.', ','),
                  replace(to_char(v_p.preco, 'FM999999990.00'), '.', ','));
  IF COALESCE(NEW.ultimo_custo_compra, 0) >= v_p.preco * 2 THEN
    v_msg := v_msg || format(' O unitário da última compra (R$ %s) é %s× o preço: confira se o pedido não foi lançado por fardo/caixa em vez de unidade.',
                             replace(to_char(NEW.ultimo_custo_compra, 'FM999999990.00'), '.', ','),
                             replace(to_char(NEW.ultimo_custo_compra / v_p.preco, 'FM990.0'), '.', ','));
  ELSE
    v_msg := v_msg || ' Reveja o preço em Financeiro › Precificação (aba Produtos).';
  END IF;

  BEGIN
    PERFORM public.notificar_setor(
      'financeiro', 'alerta', 'Custo de compra acima do preço de venda', v_msg,
      'financeiro-precificação', 'Alta', NEW.produto_id, NULL, v_p.filial);
  EXCEPTION WHEN OTHERS THEN
    -- O aviso é conveniência: a entrada no estoque não pode cair por ele.
    RAISE WARNING 'aviso de custo acima do preço falhou (%): %', NEW.produto_id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_custo_de_compra_passa_do_preco ON public.produtos_custo;
CREATE TRIGGER trg_custo_de_compra_passa_do_preco
  AFTER INSERT OR UPDATE OF preco_custo ON public.produtos_custo
  FOR EACH ROW EXECUTE FUNCTION public.fn_custo_de_compra_passa_do_preco();
