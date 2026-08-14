-- 416_20260814_fiado_sem_limite_nao_e_credito_e_sim_doacao.sql
--
-- VENDER NÃO É RECEBER.
--
-- O PDV aceita 'Fiado' desde sempre e a migr. 415 passou a exigir que a venda
-- a prazo tenha um devedor. Faltava a outra metade: quanto esse devedor pode
-- dever. Hoje o aluno vende R$ 50 mil fiado para o mesmo cliente que já tem
-- oito títulos vencidos, e o sistema agradece. Não existe coluna de limite em
-- `clientes`, nem consulta ao que está em aberto — o único freio é a memória
-- de quem está no caixa.
--
-- Numa loja de verdade o crédito tem duas travas, e as duas são simples:
--   1. teto (limite) — o quanto a casa aceita ter na rua com aquele cliente;
--   2. adimplência — quem tem título vencido não leva mais fiado até acertar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONDE A REGRA MORA
--
-- Numa trigger de `vendas`, não num IF do PDV. São dois PDVs (balcão e
-- SuperMax), mais a loja online, mais o F12 — e a `criar_venda_pdv` tem 10 KB
-- e é o caminho de toda venda das 4 turmas; reescrevê-la exige DROP + CREATE e
-- transcrever o corpo vivo, que já não é o da migração 224 (a 260 injetou o
-- `_assert_rpc` nele). Mesmo raciocínio da 415: regra na tabela vale para todo
-- caminho de escrita, hoje e depois, e falha sozinha em vez de levar a função
-- de venda junto.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AS DUAS DECISÕES QUE ESTA MIGRAÇÃO TOMA
--
-- `limite_credito` NULL = limite não cadastrado = não trava. A base das 4
-- turmas tem cliente cadastrado desde o primeiro dia e nascer tudo com teto
-- zero pararia o Fiado no meio da aula. Quem quiser a trava cadastra o valor
-- em Cadastros → Clientes. Limite 0 (zero) é diferente de NULL: é "este
-- cliente não leva fiado", e trava.
--
-- Título vencido trava SEMPRE, com ou sem limite cadastrado. É a regra que não
-- depende de parâmetro nenhum e a que ensina mais: a saída é baixar o título
-- em Financeiro → Contas a Receber, que é exatamente o que a loja real cobra
-- do cliente antes de liberar a próxima compra.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O teto do cliente
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS limite_credito numeric(15,2);

COMMENT ON COLUMN public.clientes.limite_credito IS
  'Teto de venda a prazo (Fiado). NULL = sem limite cadastrado, não trava. 0 = cliente não leva fiado.';

-- Limite negativo não quer dizer nada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.clientes'::regclass
       AND conname  = 'clientes_limite_credito_nao_negativo'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_limite_credito_nao_negativo
      CHECK (limite_credito IS NULL OR limite_credito >= 0);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Quanto o cliente já deve, e há quanto tempo
--
-- SECURITY DEFINER porque quem opera o caixa é do setor `vendas` e não lê
-- `contas_receber` (RLS é do Financeiro). As duas funções devolvem agregado —
-- saldo e contagem —, nunca a lista de títulos: o caixa precisa saber se pode
-- vender, não o extrato do cliente.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cliente_saldo_devedor(p_cliente_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(valor), 0)::numeric(15,2)
    FROM public.contas_receber
   WHERE cliente_id = p_cliente_id
     AND ativo = true
     AND status <> 'Pago';
$$;

CREATE OR REPLACE FUNCTION public.cliente_titulos_vencidos(p_cliente_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
    FROM public.contas_receber
   WHERE cliente_id = p_cliente_id
     AND ativo = true
     AND status <> 'Pago'
     AND vencimento IS NOT NULL
     AND vencimento < public.acre_today();
$$;

COMMENT ON FUNCTION public.cliente_saldo_devedor(uuid) IS
  'Soma dos títulos em aberto do cliente (contas_receber ativas com status <> Pago).';
COMMENT ON FUNCTION public.cliente_titulos_vencidos(uuid) IS
  'Quantos títulos em aberto do cliente já passaram do vencimento (fuso do Acre).';

-- Função nova nasce chamável pelo anon: revogar nominalmente, porque REVOKE do
-- public sozinho não tira o que o anon herdou.
REVOKE ALL ON FUNCTION public.cliente_saldo_devedor(uuid)   FROM public;
REVOKE ALL ON FUNCTION public.cliente_saldo_devedor(uuid)   FROM anon;
REVOKE ALL ON FUNCTION public.cliente_titulos_vencidos(uuid) FROM public;
REVOKE ALL ON FUNCTION public.cliente_titulos_vencidos(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cliente_saldo_devedor(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_titulos_vencidos(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. A trava, na tabela
--
-- LIKE '%Fiado%' e não igualdade: o SuperMax fecha venda em várias formas e
-- grava 'Misto: Dinheiro R$ 50,00 + ...'. Fiado hoje está bloqueado no misto
-- pela tela, mas comparar por igualdade deixaria a trava passar em branco no
-- dia em que o misto aceitar Fiado — e é justo o dia em que ela importa.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venda_fiado_respeita_credito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome     text;
  v_limite   numeric(15,2);
  v_devedor  numeric(15,2);
  v_vencidos integer;
BEGIN
  IF COALESCE(NEW.forma_pagamento, '') NOT LIKE '%Fiado%' THEN
    RETURN NEW;
  END IF;

  -- Fiado sem cliente já é barrado pelo CHECK da migr. 415 (NOT VALID, então
  -- não vale pro passado). Aqui não há o que conferir sem devedor.
  IF NEW.cliente_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nome, limite_credito INTO v_nome, v_limite
    FROM public.clientes WHERE id = NEW.cliente_id;

  v_vencidos := public.cliente_titulos_vencidos(NEW.cliente_id);
  IF v_vencidos > 0 THEN
    RAISE EXCEPTION
      '% tem % título(s) vencido(s) em aberto. Venda a prazo só depois de acertar — baixe em Financeiro → Contas a Receber, ou cobre à vista.',
      COALESCE(v_nome, 'Este cliente'), v_vencidos
      USING ERRCODE = 'P0001';
  END IF;

  -- Sem limite cadastrado a casa não definiu teto: segue.
  IF v_limite IS NULL THEN
    RETURN NEW;
  END IF;

  v_devedor := public.cliente_saldo_devedor(NEW.cliente_id);

  -- Tolerância de meio centavo: o total vem de soma de itens arredondada.
  IF v_devedor + COALESCE(NEW.total_final, 0) > v_limite + 0.005 THEN
    RAISE EXCEPTION
      'Limite de crédito de %: R$ %. Já em aberto: R$ %. Esta venda de R$ % estoura em R$ %. Receba parte da dívida ou cobre esta compra à vista.',
      COALESCE(v_nome, 'cliente'),
      to_char(v_limite,                                          'FM999G999G990D00'),
      to_char(v_devedor,                                         'FM999G999G990D00'),
      to_char(COALESCE(NEW.total_final, 0),                      'FM999G999G990D00'),
      to_char(v_devedor + COALESCE(NEW.total_final,0) - v_limite,'FM999G999G990D00')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venda_fiado_respeita_credito ON public.vendas;
CREATE TRIGGER trg_venda_fiado_respeita_credito
  BEFORE INSERT ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.venda_fiado_respeita_credito();

COMMIT;

-- PostgREST não enxerga função nova sem recarregar o cache do schema.
NOTIFY pgrst, 'reload schema';
