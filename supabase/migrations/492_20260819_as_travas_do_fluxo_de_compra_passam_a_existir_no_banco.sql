-- 492 — As travas de ordem do fluxo de compra passam a existir no banco.
--
-- Observação do professor, e ela é a régua: "em todo sistema real há travas que
-- não permitem uma ação ser feita antes de outra que deveria ter sido feita".
--
-- O fluxo já tinha boa parte disso — requisição e cotação têm guard de decisão
-- com alçada e segregação, o pagamento exige recebimento e nota (migr. 491), o
-- status do recebimento sai do saldo (migr. 489). Sobraram três pontos onde a
-- ordem era combinada só na tela, e tela é acordo, não trava: quem abre o F12
-- (e a turma abre — foi assim que nasceram as migr. 260/261) passa por cima.
--
--   1. QUANTIDADE DO RECEBIMENTO. O teto "não recebe mais do que o pedido"
--      estava só em `RecebimentosView`, comparado contra `v_pedido_saldo` no
--      navegador. Nada no banco. Receber 500 contra um pedido de 42 entrava no
--      estoque, virava custo médio e virava conta a pagar do valor do pedido —
--      458 unidades nascidas do nada.
--
--   2. STATUS DO PEDIDO. `pedidos.status` mudava por UPDATE cru, sem máquina de
--      estados. Dava para carimbar 'Recebido' num pedido que ninguém recebeu:
--      o pedido sai da fila do almoxarifado (a tela filtra 'Recebido'), a carga
--      real fica sem como entrar, e `recebido_em` — a régua de pontualidade do
--      fornecedor — passa a mentir. Era o mesmo defeito que a 489 tirou da tela
--      de recebimento, sobrevivendo na tela de pedidos.
--
--   3. COTAÇÃO JÁ VIRADA PEDIDO. Cancelar/negar a cotação depois que o pedido
--      saiu não desfazia nada — só deixava o pedido órfão de uma proposta
--      cancelada. Desfazer um passo depois que o seguinte aconteceu é o avesso
--      da ordem que estas travas defendem.
--
-- Todas fazem `auth_is_service_role()` cedo: as RPCs de reset e os endpoints
-- serverless precisam continuar podendo arrumar o banco.

BEGIN;

-- ── 1. Não se recebe mais do que se comprou ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recebimento_nao_estoura_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedida   numeric;
  v_recebido numeric;
  v_reenvio  numeric;
  v_ja       numeric;
  v_teto     numeric;
  v_total    numeric;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.ativo, true) IS NOT TRUE OR NEW.pedido_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.qtd_recebida, 0) <= 0 THEN
    RAISE EXCEPTION 'A quantidade recebida tem de ser maior que zero.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Mesma fonte da tela e da migr. 489: `v_pedido_saldo` já devolve ao pedido a
  -- quantidade devolvida com reenvio esperado (migr. 423), então o fornecedor
  -- pode mesmo mandar de novo o que voltou.
  SELECT qtd_pedida, qtd_recebida_total, qtd_devolvida_reenvio
    INTO v_pedida, v_recebido, v_reenvio
    FROM public.v_pedido_saldo
   WHERE pedido_id = NEW.pedido_id;

  -- Pedido sem quantidade declarada não tem teto a cobrar. Deixa passar em vez
  -- de travar o almoxarifado por um campo em branco que é de Compras.
  IF COALESCE(v_pedida, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_ja := CASE WHEN TG_OP = 'UPDATE' AND COALESCE(OLD.ativo, true)
               THEN COALESCE(OLD.qtd_recebida, 0) ELSE 0 END;
  v_total := COALESCE(v_recebido, 0) - v_ja + NEW.qtd_recebida;
  v_teto  := v_pedida + COALESCE(v_reenvio, 0);

  -- Meia milésima de tolerância: numeric(15,3) e vírgula digitada não fecham na
  -- última casa (mesma régua do teto da tela e do saldo da 489).
  IF v_total > v_teto + 0.0005 THEN
    RAISE EXCEPTION 'Este recebimento passa do que foi comprado: o pedido é de %, já entraram % e você está lançando mais %. Chegou a mais? Receba só o que o pedido cobre e registre o excesso em Divergência.',
      to_char(v_teto, 'FM999999990.999'),
      to_char(COALESCE(v_recebido, 0) - v_ja, 'FM999999990.999'),
      to_char(NEW.qtd_recebida, 'FM999999990.999')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recebimento_nao_estoura_pedido ON public.recebimentos;
CREATE TRIGGER trg_recebimento_nao_estoura_pedido
  BEFORE INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_nao_estoura_pedido();

-- ── 2. O pedido só anda para onde faz sentido ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_transicao_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean := false;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- 'Aprovado' → 'Recebido' é legítimo e comum: a carga chega antes de alguém
  -- lembrar de marcar "Em Entrega". 'Recebido' → 'Em Entrega' também: é a
  -- devolução com reenvio esperado reabrindo o pedido (migr. 423).
  v_ok := CASE
    WHEN NEW.status = 'Em Entrega' THEN OLD.status IN ('Aprovado', 'Recebido')
    WHEN NEW.status = 'Recebido'   THEN OLD.status IN ('Aprovado', 'Em Entrega')
    WHEN NEW.status = 'Cancelado'  THEN OLD.status IN ('Aprovado', 'Em Entrega')
    ELSE false
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Um pedido % não passa para %. O caminho é Aprovado → Em Entrega → Recebido, e cancelar só antes de a carga entrar.',
      OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;

  -- 'Recebido' é o goods receipt do pedido inteiro: ele não pode ser carimbado
  -- por fora do almoxarifado. Quem fecha é a conferência da carga.
  IF NEW.status = 'Recebido' AND NOT EXISTS (
    SELECT 1 FROM public.recebimentos r
     WHERE r.pedido_id = NEW.id
       AND COALESCE(r.ativo, true)
       AND r.status = 'Concluído'
  ) THEN
    RAISE EXCEPTION 'Este pedido não tem recebimento conferido. Quem o encerra é o Estoque, confirmando a entrada da carga em Recebimentos — não dá para marcá-lo como recebido por aqui.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedido_transicao_valida ON public.pedidos;
CREATE TRIGGER trg_pedido_transicao_valida
  BEFORE UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_pedido_transicao_valida();

-- ── 3. Não se desfaz a cotação depois que ela virou pedido ──────────────────
CREATE OR REPLACE FUNCTION public.fn_cotacao_com_pedido_nao_volta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido text;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Cancelado', 'Negado', 'Em correção') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.numero, 'Pedido #' || upper(right(p.id::text, 6)))
    INTO v_pedido
    FROM public.pedidos p
   WHERE p.cotacao_id = NEW.id AND COALESCE(p.ativo, true) AND p.status <> 'Cancelado'
   LIMIT 1;

  IF v_pedido IS NOT NULL THEN
    RAISE EXCEPTION 'Esta proposta já virou o % — cancelá-la agora não desfaz a compra, só deixa o pedido órfão. Cancele o pedido, e a conta a pagar é inativada junto.',
      v_pedido USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cotacao_com_pedido_nao_volta ON public.cotacoes;
CREATE TRIGGER trg_cotacao_com_pedido_nao_volta
  BEFORE UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_cotacao_com_pedido_nao_volta();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- TESTE MANUAL
--   receber mais que o pedido            → recusa, dizendo pedido/já entrou/lançado
--   receber quantidade zero              → recusa
--   pedido Aprovado → Recebido sem carga → recusa
--   pedido Recebido → Aprovado           → recusa
--   devolução com reenvio (Recebido → Em Entrega) → passa
--   cancelar cotação que já gerou pedido → recusa nomeando o pedido
-- ════════════════════════════════════════════════════════════════════════════
