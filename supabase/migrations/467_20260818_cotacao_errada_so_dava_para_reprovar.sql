-- 467 — Cotação errada só dava para reprovar
--
-- O gerente abria a cotação, via um valor digitado errado (ou o prazo em
-- branco) e tinha duas saídas: aprovar o número errado ou reprovar a proposta
-- inteira. Reprovar mata a proposta — o colaborador tem de cadastrar outra do
-- zero e o histórico fica com uma recusa que não foi do fornecedor, foi de
-- digitação.
--
-- O caminho que faltava é o de qualquer aprovação real: DEVOLVER para
-- correção. A proposta continua viva, volta para quem a cadastrou, ele
-- conserta e reenvia.
--
-- Por que não deixar o gerente editar direto: `cotacao_decisao_guard` (migr.
-- 282) barra "quem cadastra aprova" olhando `criado_por`. Se o gerente
-- editasse o valor, `criado_por` continuaria sendo o colaborador e o guard
-- deixaria o gerente aprovar o número que ele mesmo escreveu — segregação de
-- funções furada por uma porta lateral. Devolvendo, autoria e alçada ficam
-- intactas e o vai-e-volta aparece no histórico.
--
-- Além disso a cotação é a proposta DO FORNECEDOR: o valor tem de ser digitado
-- por quem falou com ele, não corrigido por quem decide.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Status novo
--
-- Sem IF NOT EXISTS: a constraint já existe em todas as turmas com a lista
-- antiga, e um guard de existência deixaria o status novo barrado justamente
-- onde a tabela já estava criada.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cotacoes DROP CONSTRAINT IF EXISTS chk_cotacoes_status;
ALTER TABLE public.cotacoes
  ADD CONSTRAINT chk_cotacoes_status
  CHECK (status IN ('Em Cotação', 'Aguardando Financeiro', 'Em correção',
                    'Aprovado', 'Negado', 'Cancelado'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Devolver para correção — quem decide devolve
--
-- Mesma régua de autoridade de `decidir_cotacao` / `cotacao_decisao_guard`:
-- Matriz sempre; quem cadastrou nunca; dentro da alçada é o Financeiro, acima
-- dela é o gerente da filial. Devolver é decisão sobre a proposta e por isso
-- pesa igual a aprovar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.devolver_cotacao_para_correcao(
  p_cotacao_id uuid,
  p_motivo     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cot    public.cotacoes;
  v_limite numeric;
  v_matriz boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Devolver exige dizer o que corrigir — é o que o colaborador lê para arrumar.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cot.status <> 'Aguardando Financeiro' THEN
    RAISE EXCEPTION 'Só dá para devolver o que ainda aguarda decisão. Esta cotação está %.', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.auth_is_service_role() THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (p.role IN ('admin', 'ceo', 'conselheiro')
              OR (p.role = 'gerente' AND p.is_conselheiro = true))
    ) INTO v_matriz;

    IF NOT COALESCE(v_matriz, false) THEN
      IF v_cot.criado_por IS NOT NULL AND v_cot.criado_por = auth.uid() THEN
        RAISE EXCEPTION 'Quem cadastra a proposta não a devolve — corrija e reenvie.'
          USING ERRCODE = '42501';
      END IF;

      SELECT valor_limite_financeiro INTO v_limite
        FROM public.alcadas_compra
       WHERE filial = v_cot.filial AND COALESCE(ativo, true);

      IF v_limite IS NULL OR COALESCE(v_cot.valor_total, 0) <= v_limite THEN
        IF NOT public.auth_in_setor('financeiro') THEN
          RAISE EXCEPTION 'Dentro da alçada, quem decide a cotação é o Financeiro.'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        IF NOT public.auth_gerente_da(v_cot.filial) THEN
          RAISE EXCEPTION 'Acima da alçada da filial, quem decide é o gerente (ou a Matriz).'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Libera o guard de transição (seção 4) só dentro desta transação.
  PERFORM set_config('app.cotacao_correcao', 'true', true);

  UPDATE public.cotacoes
     SET status       = 'Em correção',
         feedback     = trim(p_motivo),
         aprovado_por = NULL,
         aprovado_em  = NULL
   WHERE id = p_cotacao_id
  RETURNING * INTO v_cot;

  -- Desliga a flag: is_local vale até o fim da TRANSAÇÃO, não da função. Via
  -- PostgREST cada RPC é uma transação, mas quem chamar as duas coisas na
  -- mesma transação ganharia uma janela para editar a proposta por fora.
  PERFORM set_config('app.cotacao_correcao', 'false', true);

  RETURN jsonb_build_object('ok', true, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.devolver_cotacao_para_correcao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolver_cotacao_para_correcao(uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Corrigir e reenviar — só quem cadastrou (ou o setor dono da proposta)
--
-- Requisição e fornecedor NÃO são editáveis aqui de propósito: trocar
-- fornecedor é outra proposta, não correção desta — senão o histórico de preço
-- por fornecedor (que alimenta o custo médio ponderado, migr. 417) passa a
-- mentir sobre quem cobrou o quê.
-- ═══════════════════════════════════════════════════════════════════════════

-- `prazo_entrega` é text nesta tabela (schema de bootstrap) e `validade` é
-- date. Recebo as duas como text e faço o cast aqui — não existe cast
-- implícito de text para date em argumento de função.
CREATE OR REPLACE FUNCTION public.reenviar_cotacao_corrigida(
  p_cotacao_id    uuid,
  p_valor_total   numeric,
  p_prazo_entrega text DEFAULT NULL,
  p_validade      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cot public.cotacoes;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_cot FROM public.cotacoes
   WHERE id = p_cotacao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotação não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cot.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Esta cotação não está em correção (está %).', v_cot.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.auth_is_service_role() THEN
    -- Quem cadastrou corrige. Compras/Logística da filial também, porque a
    -- proposta é do setor e o colaborador pode ter sido desligado no meio.
    -- COALESCE porque `criado_por` pode ser NULL em linha antiga: sem ele a
    -- expressão inteira vira NULL, o IF não dispara e o guard deixa passar.
    IF NOT COALESCE(
         v_cot.criado_por = auth.uid()
         OR (public.auth_in_setor('compras', 'logistica')
             AND public.auth_pode_filial(v_cot.filial)), false) THEN
      RAISE EXCEPTION 'Só quem cadastrou a proposta (ou Compras da filial) corrige e reenvia.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE(p_valor_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Valor da proposta precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.cotacao_correcao', 'true', true);

  UPDATE public.cotacoes
     SET valor_total   = p_valor_total,
         prazo_entrega = COALESCE(NULLIF(trim(COALESCE(p_prazo_entrega, '')), ''), prazo_entrega),
         validade      = NULLIF(trim(COALESCE(p_validade, '')), '')::date,
         status        = 'Aguardando Financeiro',
         feedback      = NULL
   WHERE id = p_cotacao_id
  RETURNING * INTO v_cot;

  -- Desliga a flag: is_local vale até o fim da TRANSAÇÃO, não da função. Via
  -- PostgREST cada RPC é uma transação, mas quem chamar as duas coisas na
  -- mesma transação ganharia uma janela para editar a proposta por fora.
  PERFORM set_config('app.cotacao_correcao', 'false', true);

  RETURN jsonb_build_object('ok', true, 'cotacao', to_jsonb(v_cot));
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reenviar_cotacao_corrigida(uuid, numeric, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Guard: 'Em correção' só entra e sai pelas duas RPCs
--
-- `cot_update` (migr. 187) deixa compras, logística, financeiro e o gerente da
-- filial darem UPDATE em qualquer linha da filial. Sem esta trava, o status
-- novo viraria justamente o caminho para mexer no valor por fora — o furo que
-- esta migration existe para não abrir. Estendo o guard que já roda na tabela
-- em vez de criar um segundo trigger.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cotacao_decisao_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limite numeric;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Correção (migr. 467): entrar ou sair de 'Em correção' só pelas RPCs
  -- `devolver_cotacao_para_correcao` / `reenviar_cotacao_corrigida`, que já
  -- checaram autoria e alçada. A flag é local à transação delas.
  --
  -- Duas saídas ficam livres: CANCELAR (desistir da proposta é direito de quem
  -- a cadastrou, e não mexe em dinheiro nenhum) e a Matriz, que já tem
  -- override em toda a régua — é por ali que `reabrir_cotacao` passa.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND 'Em correção' IN (NEW.status, OLD.status)
     AND NEW.status <> 'Cancelado'
     AND COALESCE(current_setting('app.cotacao_correcao', true), '') <> 'true'
     AND NOT EXISTS (
       SELECT 1 FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND (p.role IN ('admin', 'ceo', 'conselheiro')
               OR (p.role = 'gerente' AND p.is_conselheiro = true))
     ) THEN
    RAISE EXCEPTION 'Devolver para correção e reenviar passam pelas ações da tela de Cotações.'
      USING ERRCODE = '42501';
  END IF;

  -- Valor e prazo de uma proposta devolvida só mudam pelo reenvio.
  IF OLD.status = 'Em correção'
     AND (NEW.valor_total IS DISTINCT FROM OLD.valor_total
          OR NEW.prazo_entrega IS DISTINCT FROM OLD.prazo_entrega)
     AND COALESCE(current_setting('app.cotacao_correcao', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Use "Corrigir e reenviar" para alterar a proposta devolvida.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- Matriz: override total. É a saída quando não há outro aprovador na filial.
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = auth.uid()
       AND (p.role IN ('admin', 'ceo', 'conselheiro')
            OR (p.role = 'gerente' AND p.is_conselheiro = true))
  ) THEN
    RETURN NEW;
  END IF;

  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid() THEN
    RAISE EXCEPTION 'Quem cadastra a proposta não a aprova.'
      USING ERRCODE = '42501';
  END IF;

  SELECT valor_limite_financeiro INTO v_limite
    FROM public.alcadas_compra
   WHERE filial = NEW.filial AND COALESCE(ativo, true);

  -- Alçada não configurada = limite infinito = Financeiro decide. Um caminho
  -- só, igual à tela.
  IF v_limite IS NULL OR COALESCE(NEW.valor_total, 0) <= v_limite THEN
    IF NOT public.auth_in_setor('financeiro') THEN
      RAISE EXCEPTION 'Dentro da alçada, quem decide a cotação é o Financeiro.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT public.auth_gerente_da(NEW.filial) THEN
      RAISE EXCEPTION 'Acima da alçada da filial, quem decide é o gerente (ou a Matriz).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cotacao_decisao_guard ON public.cotacoes;
CREATE TRIGGER trg_cotacao_decisao_guard
  BEFORE UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.cotacao_decisao_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
