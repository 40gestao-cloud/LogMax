-- =================================================================
-- 399 — O gerente também não libera o próprio material.
--
-- `requisicao_estoque_decisao_guard` (o guard do "quem pede não libera")
-- isentava admin E gerente da filial de uma vez só:
--
--   IF auth_is_admin() OR auth_gerente_da(NEW.filial) THEN RETURN NEW;
--
-- Isentar do QUÊ é que era o problema: aquele RETURN pulava as duas
-- checagens seguintes, inclusive a do autor. O gerente pedia material e
-- liberava sozinho, em dois cliques.
--
-- O fluxo de compra não faz isso. `decidir_requisicao_compra` (282)
-- isenta só `auth_is_admin()`; o gerente é a AUTORIDADE do fluxo, não uma
-- exceção a ele, e por isso não aprova a própria requisição. Como a aula
-- de Material do almoxarifado é dada em contraste com a de Compra, a
-- divergência aparecia em sala do pior jeito possível: o gerente
-- completava o fluxo sozinho e o colaborador ao lado, não.
--
-- Aqui a autoridade do gerente é preservada — ele continua decidindo
-- requisição de material da filial dele, esteja ou não em setor de
-- estoque. O que muda é que ela passa a valer para requisição dos
-- OUTROS, que é o que autoridade quer dizer num controle de segregação.
--
-- Admin (o professor) segue isento de tudo: é a saída quando a turma
-- trava e não há outro liberador possível.
--
-- Idempotente. Corpo copiado do estado vigente no banco; muda só a
-- ordem das três checagens.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.requisicao_estoque_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só interessa a transição para decidida. Edição de destino, qtd ou
  -- reabertura passa direto.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- O professor destrava qualquer etapa. Ninguém mais é isento do teste
  -- de autoria abaixo — nem o gerente.
  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem pede o material não libera a própria requisição.'
      USING ERRCODE = '42501';
  END IF;

  -- A autoridade do gerente sobre a filial continua: ela só deixou de
  -- valer para a requisição dele mesmo. COALESCE porque guard que testa
  -- NULL com NOT deixa passar (NOT NULL é NULL, não é true).
  IF NOT COALESCE(
       public.auth_in_setor('estoque', 'logistica')
       OR public.auth_gerente_da(NEW.filial), false) THEN
    RAISE EXCEPTION 'Só o Estoque (ou o gerente da filial) decide requisição de material.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação (como gerente, na própria requisição de material):
--   UPDATE requisicoes_estoque SET status = 'Aprovado' WHERE id = '<a sua>';
--   -- 42501: Quem pede o material não libera a própria requisição.
--
-- E na de outro aluno da filial dele: passa, como antes.
