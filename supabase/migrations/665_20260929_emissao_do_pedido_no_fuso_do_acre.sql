-- 665_20260929_emissao_do_pedido_no_fuso_do_acre.sql
--
-- fn_recebimento_data_plausivel (migr. 490) comparava a data da carga, que é
-- do Acre (acre_today), com `created_at::date`, que é a data em UTC. Pedido
-- emitido depois das 19h no Acre já é "amanhã" em UTC: o PC-SM-2026-0052
-- (29/09 21:25 no Acre = 30/09 02:25 UTC) não podia ser recebido em dia
-- nenhum — 29/09 era "antes da emissão (30/09)" e 30/09 era "no futuro".
--
-- Conserto: a emissão também no fuso do Acre. Corpo copiado do banco
-- (md5 950f8ee0920a253766a1cf56013e9853); só a linha do SELECT muda.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

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
    SELECT (created_at AT TIME ZONE 'America/Rio_Branco')::date INTO v_emissao
      FROM public.pedidos WHERE id = NEW.pedido_id;
    IF v_emissao IS NOT NULL AND NEW.data < v_emissao THEN
      RAISE EXCEPTION 'A carga não pode ter chegado (%) antes de o pedido ser emitido (%).',
        to_char(NEW.data, 'DD/MM/YYYY'), to_char(v_emissao, 'DD/MM/YYYY')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
