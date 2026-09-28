-- 644_20260928_quem_emite_o_pedido_nao_confere_a_carga.sql
--
-- Fecha as duas pontas que sobraram em recebimento_segregacao_guard depois da
-- 643 ("quem abre não aprova" sem exceção para aluno):
--
--   1. O GERENTE conferia a carga do pedido que ele mesmo emitiu. Passa a
--      valer a regra de todo mundo; só o professor (eh_perfil_admin) fica fora.
--   2. Só 'Concluído' era gate. Como o status já chega derivado do saldo, quem
--      emitiu conferia sozinho as cargas PARCIAIS do próprio pedido — e desde
--      a 642 conferir parcial dá entrada no estoque. O gate passa a ser a
--      conferência em si (Concluído ou Parcial); registrar (Pendente) segue livre.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE OR REPLACE FUNCTION public.recebimento_segregacao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_autor uuid;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- MIGR 644: o gate é a CONFERÊNCIA, parcial ou completa — registrar a carga
  -- (Pendente) segue livre. Antes só 'Concluído' era gate, mas o status já
  -- chega aqui derivado do saldo (trg_recebimento_saldo_status roda antes):
  -- quem emitiu o pedido conferia sozinho as cargas parciais, e desde a 642
  -- conferir parcial dá entrada no estoque.
  IF COALESCE(NEW.status, '') NOT IN ('Concluído', 'Parcial') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') IN ('Concluído', 'Parcial')
     AND COALESCE(OLD.ativo, true) THEN
    RETURN NEW;
  END IF;

  SELECT criado_por INTO v_pedido_autor
    FROM public.pedidos WHERE id = NEW.pedido_id;

  IF v_pedido_autor IS NOT NULL
     AND v_pedido_autor = auth.uid()
     -- MIGR 643/644: só o professor fica fora. O gerente também não confere
     -- a carga do pedido que ele mesmo emitiu — é a mesma regra de quem abre
     -- não aprova, e o gerente é aluno como os outros.
     AND NOT public.eh_perfil_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Quem emitiu o pedido não confere a carga dele. Peça a outra pessoa do Estoque/Logística — ou ao gerente, se não foi ele quem emitiu — para conferir.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
