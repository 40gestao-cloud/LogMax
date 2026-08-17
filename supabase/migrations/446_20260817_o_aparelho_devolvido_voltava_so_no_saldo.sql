-- 446_20260817_o_aparelho_devolvido_voltava_so_no_saldo.sql
--
-- DEVOLUÇÃO DE VENDA DEVOLVIA O SALDO E NÃO DEVOLVIA O APARELHO.
--
-- Buraco aberto pela própria migr. 444, encontrado na revisão do mesmo dia.
--
-- `criar_devolucao_venda` (203) grava `itens_devolucao` e lança uma Entrada em
-- `movimentacoes_estoque`: o saldo volta. Mas a unidade serializada continuava
-- `status = 'Vendida'`, porque a 444 só criou o caminho de ida (venda → baixa
-- por FIFO) e nenhum de volta.
--
-- O resultado é uma divergência que cresce em silêncio:
--
--   5 iPhones em estoque, 5 unidades 'Em estoque'
--   vende 1  → saldo 4, unidades 'Em estoque' 4          (certo)
--   devolve  → saldo 5, unidades 'Em estoque' 4          (errado)
--
-- Duas vendas depois o saldo diz 3 e não há unidade para alocar: a venda passa
-- (a 444 não bloqueia venda sem unidade, de propósito) e o recibo sai sem IMEI.
-- Aparelho de volta na prateleira sem número é aparelho que a loja não sabe
-- de quem foi — exatamente o problema que a 444 existia para resolver.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A UNIDADE VOLTA PARA 'Em estoque', NÃO PARA 'Devolvida'
--
-- O CHECK tem 'Devolvida', e era tentador usá-lo. Mas o FIFO só aloca
-- 'Em estoque': a unidade ficaria parada num status que ninguém consome
-- enquanto o SALDO já a conta de volta — a mesma divergência, com outro nome.
-- Se um dia houver inspeção de devolvido antes de revender, aí 'Devolvida'
-- ganha sentido, junto com o passo que a libera.
--
-- O VÍNCULO COM A VENDA ANTIGA FICA
--
-- A primeira versão desta migração anulava `venda_id`. Está errado: o recibo
-- daquela venda lê `produto_unidades` por `venda_id`, e apagar a coluna
-- apagaria o IMEI de um documento já emitido — o papel que o cliente levou
-- deixaria de bater com o sistema. O aparelho FOI vendido ali; a devolução é o
-- fato seguinte, não a negação do primeiro.
--
-- Então só o estado muda. A próxima venda sobrescreve `venda_id` na alocação,
-- e é ela que passa a ser a verdade sobre onde o aparelho está — o histórico
-- da devolução fica na `observacao`.
--
-- Mesma forma da 444: gatilho em `itens_devolucao`, não IF dentro da RPC. Pega
-- devolução vinda da tela, do F12 e de qualquer caminho futuro.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS. Depende da 444.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_item_devolucao_devolve_unidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venda_id uuid;
  v_qtd      int;
BEGIN
  IF NEW.produto_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Aparelho não volta pela metade: 0,5 iPhone não existe.
  v_qtd := GREATEST(floor(COALESCE(NEW.qtd, 0))::int, 0);
  IF v_qtd = 0 THEN
    RETURN NEW;
  END IF;

  SELECT d.venda_id INTO v_venda_id
    FROM public.devolucoes d WHERE d.id = NEW.devolucao_id;

  IF v_venda_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- `venda_id` e `item_venda_id` ficam de propósito (ver cabeçalho): o recibo
  -- daquela venda os lê para imprimir o IMEI. Quem move o vínculo é a venda
  -- seguinte, na alocação da migr. 444.
  UPDATE public.produto_unidades pu
     SET status        = 'Em estoque',
         vendida_em    = NULL,
         observacao    = trim(both ' ' from
           COALESCE(pu.observacao || ' | ', '')
           || 'Devolvida da venda ' || right(v_venda_id::text, 6)
           || ' em ' || to_char(public.acre_today(), 'DD/MM/YYYY'))
   WHERE pu.id IN (
     SELECT id FROM public.produto_unidades
      WHERE ativo
        AND produto_id = NEW.produto_id
        AND status = 'Vendida'
        AND venda_id = v_venda_id
      -- A última que saiu é a primeira que volta: numa venda de duas unidades
      -- iguais, qualquer uma serve, e esta ordem é a que o balcão enxerga.
      ORDER BY vendida_em DESC NULLS LAST
      LIMIT v_qtd
      FOR UPDATE SKIP LOCKED
   );

  -- Venda anterior à migr. 444 não tem unidade carimbada. Nada a devolver, e
  -- nada a avisar: o saldo já voltou pela RPC.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_item_devolucao_devolve_unidade ON public.itens_devolucao;
CREATE TRIGGER trg_item_devolucao_devolve_unidade
  AFTER INSERT ON public.itens_devolucao
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_devolucao_devolve_unidade();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. o gatilho existe
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.itens_devolucao'::regclass
--      AND tgname = 'trg_item_devolucao_devolve_unidade';
--
--   -- 2. saldo x unidades: as duas contas têm de bater em produto com IMEI
--   SELECT p.filial, p.nome, p.estoque AS saldo,
--          count(*) FILTER (WHERE pu.status = 'Em estoque') AS unidades_em_estoque
--     FROM produtos p
--     LEFT JOIN produto_unidades pu ON pu.produto_id = p.id AND pu.ativo
--    WHERE p.ativo AND COALESCE((p.atributos ->> 'requer_imei')::boolean, false)
--    GROUP BY 1, 2, 3
--   HAVING p.estoque <> count(*) FILTER (WHERE pu.status = 'Em estoque');
--   -- esperado: zero linhas depois que a turma registrar todos os IMEIs.
--
-- E o teste que vale a aula: vender um aparelho, devolver no PDV e conferir
-- que ele volta a aparecer para a próxima venda — com o histórico da
-- devolução na observação da unidade.
-- =================================================================
