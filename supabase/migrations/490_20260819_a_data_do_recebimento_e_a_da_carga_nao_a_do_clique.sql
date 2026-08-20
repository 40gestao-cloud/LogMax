-- 490 — A data do recebimento passa a ser a da carga, não a do clique.
--
-- `handleSave` gravava `data: todayBR()` e a tela não tinha campo. Carga que
-- chegou sexta e foi lançada segunda entrava como segunda.
--
-- Sozinho isso seria cosmético. O que o torna caro é `fn_pedido_marca_recebimento`:
-- ela carimba `recebido_em := acre_today()` na virada do pedido para 'Recebido',
-- e `recebido_em` é a régua de PONTUALIDADE DO FORNECEDOR (migr. 421). Ou seja,
-- o indicador media quando o aluno clicou, não quando o fornecedor entregou —
-- e o fornecedor pontual cujo recebimento foi lançado com três dias de atraso
-- aparecia como atrasado. Abrir o campo de data sem mexer na trigger não
-- resolveria nada: as duas coisas andam juntas.
--
-- A data que conta é a da ÚLTIMA carga conferida daquele pedido: é quando a
-- entrega de fato terminou.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_pedido_marca_recebimento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só a transição para Recebido carimba. Reprocessar, reabrir ou cancelar
  -- depois não reescreve a data: a primeira vez que a carga chegou é a que
  -- conta para medir o fornecedor.
  IF COALESCE(NEW.status, '') = 'Recebido'
     AND COALESCE(OLD.status, '') <> 'Recebido'
     AND NEW.recebido_em IS NULL THEN
    -- A data da última carga conferida, não a de hoje (migr. 490). Sem
    -- recebimento conferido — pedido fechado à mão — cai em hoje, que é o
    -- melhor palpite disponível.
    SELECT COALESCE(MAX(r.data), public.acre_today())
      INTO NEW.recebido_em
      FROM public.recebimentos r
     WHERE r.pedido_id = NEW.id
       AND COALESCE(r.ativo, true)
       AND r.status IN ('Concluído', 'Parcial');
  END IF;
  RETURN NEW;
END;
$function$;

-- A data do recebimento não pode ser do futuro nem anterior à emissão do
-- pedido: as duas produzem prazo negativo no cálculo de pontualidade.
CREATE OR REPLACE FUNCTION public.fn_recebimento_data_plausivel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emissao date;
BEGIN
  IF NEW.data IS NULL THEN
    NEW.data := public.acre_today();
  END IF;

  IF NEW.data > public.acre_today() THEN
    RAISE EXCEPTION 'A carga não pode ter chegado no futuro (% é depois de hoje).',
      to_char(NEW.data, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;

  IF NEW.pedido_id IS NOT NULL THEN
    SELECT created_at::date INTO v_emissao FROM public.pedidos WHERE id = NEW.pedido_id;
    IF v_emissao IS NOT NULL AND NEW.data < v_emissao THEN
      RAISE EXCEPTION 'A carga não pode ter chegado (%) antes de o pedido ser emitido (%).',
        to_char(NEW.data, 'DD/MM/YYYY'), to_char(v_emissao, 'DD/MM/YYYY')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Ordena antes de trg_recebimento_saldo_status ('da' < 'sa') e do guard de
-- segregação: normalizar a data é a primeira coisa a fazer.
-- Ver [[feedback_trigger_ordem_alfabetica]].
DROP TRIGGER IF EXISTS trg_recebimento_data_plausivel ON public.recebimentos;
CREATE TRIGGER trg_recebimento_data_plausivel
  BEFORE INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recebimento_data_plausivel();

COMMIT;

NOTIFY pgrst, 'reload schema';
