-- =================================================================
-- 381 — Destinação do resultado: reservar, reinvestir ou distribuir.
--
-- Item #G4 do backlog de governança. Fecha o trio financeiro com o
-- Orçamento (378) e a Prestação de Contas (379): a verba é dada, o gasto
-- é explicado, e agora o que sobrou tem destino decidido por alguém.
--
-- O buraco: o resultado do período não existia como objeto. O caixa
-- subia, e ninguém precisava dizer o que fazer com a sobra. É a decisão
-- mais adulta que existe em gestão — distribuir agora ou ter caixa para
-- crescer depois — e ela simplesmente não era tomada.
--
-- Como o resultado é apurado (e por que assim):
--   lucro = contas_receber PAGAS − contas_pagar PAGAS, no período, por
--   filial, usando `pago_em`. Regime de caixa, não competência.
--   Nesta altura do curso é o que o aluno consegue conferir extrato na
--   mão; competência exigiria provisão e apropriação, que são outra aula.
--   A apuração é uma FUNÇÃO, não uma coluna: número guardado envelhece e
--   passa a mentir quando alguém baixa uma conta atrasada do período.
--
-- Decisões que valem estar escritas:
--   • A soma das três destinações tem de bater com o lucro apurado, com
--     tolerância de 1 centavo (arredondamento). Sem isso vira formulário
--     de opinião.
--   • Reserva respeita `capital_config.reserva_min_pct`, que já existia e
--     não era usada por ninguém. O piso é do Conselho, não da filial.
--   • RESERVA E REINVESTIMENTO NÃO MOVEM DINHEIRO — são classificação do
--     que fica no caixa da unidade. Só a DISTRIBUIÇÃO move: sai de um
--     banco da filial e entra num banco da Matriz, que é o acionista.
--     Espelho invertido de `registrar_aporte_capital` (326), e pelo mesmo
--     princípio: dinheiro não nasce nem some, ele muda de conta.
--   • Prejuízo (lucro < 0) não se distribui. A RPC recusa.
--   • Deliberada é terminal. Refazer é criar outra, não editar a decisão
--     tomada — é ata, não rascunho.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. Apuração do resultado (regime de caixa) ────────────────────
CREATE OR REPLACE FUNCTION public.apurar_resultado_periodo(
  p_filial text,
  p_inicio date,
  p_fim    date
)
RETURNS TABLE (
  receitas numeric,
  despesas numeric,
  lucro    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH r AS (
    SELECT COALESCE(sum(COALESCE(valor_pago, valor)), 0) AS total
      FROM contas_receber
     WHERE ativo = true AND filial = p_filial
       AND pago_em BETWEEN p_inicio AND p_fim
  ),
  d AS (
    SELECT COALESCE(sum(COALESCE(valor_pago, valor)), 0) AS total
      FROM contas_pagar
     WHERE ativo = true AND filial = p_filial
       AND pago_em BETWEEN p_inicio AND p_fim
  )
  SELECT r.total, d.total, r.total - d.total FROM r, d;
$$;

REVOKE ALL ON FUNCTION public.apurar_resultado_periodo(text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apurar_resultado_periodo(text,date,date) TO authenticated;

-- ── 2. A destinação ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.destinacoes_resultado (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial              text NOT NULL,
  periodo_inicio      date NOT NULL,
  periodo_fim         date NOT NULL,
  lucro_apurado       numeric(14,2) NOT NULL,
  valor_reserva       numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_reserva       >= 0),
  valor_reinvestido   numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_reinvestido   >= 0),
  valor_distribuido   numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_distribuido   >= 0),
  banco_origem_id     uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  banco_destino_id    uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  justificativa       text,
  deliberado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deliberado_por_nome text,
  deliberado_em       timestamptz NOT NULL DEFAULT now(),
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (periodo_fim >= periodo_inicio)
);

COMMENT ON TABLE public.destinacoes_resultado IS
  'Ata da decisao sobre o resultado do periodo: quanto vira reserva, quanto reinveste e quanto e distribuido a Matriz.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_destinacao_filial_periodo
  ON public.destinacoes_resultado (filial, periodo_inicio, periodo_fim)
  WHERE ativo = true;

ALTER TABLE public.destinacoes_resultado ENABLE ROW LEVEL SECURITY;

-- Leitura aberta a quem loga: o que a unidade fez com o próprio lucro é
-- informação de governança, não segredo.
DROP POLICY IF EXISTS destinacao_read ON public.destinacoes_resultado;
CREATE POLICY destinacao_read ON public.destinacoes_resultado
  FOR SELECT TO authenticated USING (true);

-- Escrita só pela RPC: é ela que confere soma, piso de reserva e move caixa.

-- ── 3. Deliberar a destinação (só Conselho) ───────────────────────
CREATE OR REPLACE FUNCTION public.deliberar_destinacao_resultado(
  p_filial            text,
  p_inicio            date,
  p_fim               date,
  p_valor_reserva     numeric,
  p_valor_reinvestido numeric,
  p_valor_distribuido numeric,
  p_banco_origem_id   uuid    DEFAULT NULL,
  p_banco_destino_id  uuid    DEFAULT NULL,
  p_justificativa     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_lucro     numeric;
  v_soma      numeric;
  v_pct_min   numeric;
  v_reserva_min numeric;
  v_saldo     numeric;
  v_orig_fil  text;
  v_orig_nome text;
  v_dest_fil  text;
  v_id        uuid;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho delibera a destinação do resultado.' USING ERRCODE = '42501';
  END IF;

  SELECT lucro INTO v_lucro FROM apurar_resultado_periodo(p_filial, p_inicio, p_fim);

  IF v_lucro <= 0 THEN
    RAISE EXCEPTION 'Resultado do período é R$ % — não há lucro a destinar.', round(v_lucro, 2)
      USING ERRCODE = 'P0001';
  END IF;

  v_soma := COALESCE(p_valor_reserva,0) + COALESCE(p_valor_reinvestido,0) + COALESCE(p_valor_distribuido,0);
  IF abs(v_soma - v_lucro) > 0.01 THEN
    RAISE EXCEPTION 'A destinação soma R$ % e o lucro apurado é R$ % — todo o resultado precisa ter destino.',
      round(v_soma, 2), round(v_lucro, 2) USING ERRCODE = 'P0001';
  END IF;

  -- Piso de reserva: `capital_config.reserva_min_pct` existia desde a 326 e
  -- nunca tinha sido cobrada em lugar nenhum.
  SELECT reserva_min_pct INTO v_pct_min
    FROM capital_config
   WHERE data_inicio <= p_fim AND (data_fim IS NULL OR data_fim >= p_fim)
   ORDER BY data_inicio DESC LIMIT 1;

  v_reserva_min := round(v_lucro * COALESCE(v_pct_min, 0) / 100, 2);
  IF COALESCE(p_valor_reserva, 0) < v_reserva_min - 0.01 THEN
    RAISE EXCEPTION 'Reserva mínima é % %% do lucro (R$ %), e foi destinado R$ %.',
      COALESCE(v_pct_min,0), v_reserva_min, round(COALESCE(p_valor_reserva,0), 2)
      USING ERRCODE = 'P0001';
  END IF;

  -- Só a distribuição move dinheiro. Reserva e reinvestimento ficam no
  -- caixa da unidade — são classificação da decisão, não transferência.
  IF COALESCE(p_valor_distribuido, 0) > 0 THEN
    IF p_banco_origem_id IS NULL OR p_banco_destino_id IS NULL THEN
      RAISE EXCEPTION 'Distribuir exige conta de origem (filial) e destino (Matriz).'
        USING ERRCODE = 'P0001';
    END IF;

    -- `caixa_bancos` não tem coluna `nome`: o rótulo é COALESCE(banco, conta),
    -- mesma expressão que a 326 usa. FOR UPDATE pelo mesmo motivo de lá —
    -- duas distribuições simultâneas leriam o mesmo saldo.
    SELECT filial, COALESCE(banco, conta), COALESCE(saldo, 0)
      INTO v_orig_fil, v_orig_nome, v_saldo
      FROM caixa_bancos
     WHERE id = p_banco_origem_id AND COALESCE(ativo, true)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_orig_fil, '') <> p_filial THEN
      RAISE EXCEPTION 'A origem tem de ser conta de %. A escolhida é de %.',
        p_filial, COALESCE(v_orig_fil, 'uso global') USING ERRCODE = 'P0001';
    END IF;
    IF v_saldo < p_valor_distribuido THEN
      RAISE EXCEPTION 'Saldo insuficiente em %: há R$ % e a distribuição é de R$ %.',
        v_orig_nome, round(v_saldo, 2), round(p_valor_distribuido, 2) USING ERRCODE = 'P0001';
    END IF;

    SELECT filial INTO v_dest_fil
      FROM caixa_bancos
     WHERE id = p_banco_destino_id AND COALESCE(ativo, true)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(v_dest_fil, '') <> 'Matriz' THEN
      RAISE EXCEPTION 'A distribuição vai para o caixa da Matriz. A conta escolhida é de %.',
        COALESCE(v_dest_fil, 'uso global') USING ERRCODE = 'P0001';
    END IF;

    UPDATE caixa_bancos SET saldo = COALESCE(saldo,0) - p_valor_distribuido
     WHERE id = p_banco_origem_id;
    UPDATE caixa_bancos SET saldo = COALESCE(saldo,0) + p_valor_distribuido
     WHERE id = p_banco_destino_id;
  END IF;

  INSERT INTO destinacoes_resultado
    (filial, periodo_inicio, periodo_fim, lucro_apurado,
     valor_reserva, valor_reinvestido, valor_distribuido,
     banco_origem_id, banco_destino_id, justificativa,
     deliberado_por, deliberado_por_nome)
  VALUES
    (p_filial, p_inicio, p_fim, v_lucro,
     COALESCE(p_valor_reserva,0), COALESCE(p_valor_reinvestido,0), COALESCE(p_valor_distribuido,0),
     p_banco_origem_id, p_banco_destino_id, p_justificativa,
     auth.uid(), (SELECT nome FROM user_profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'destinacao_id', v_id,
    'lucro', v_lucro, 'distribuido', COALESCE(p_valor_distribuido,0));
END;
$$;

REVOKE ALL ON FUNCTION public.deliberar_destinacao_resultado(text,date,date,numeric,numeric,numeric,uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deliberar_destinacao_resultado(text,date,date,numeric,numeric,numeric,uuid,uuid,text)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) anon fora:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('apurar_resultado_periodo','deliberar_destinacao_resultado');
-- Esperado: false nas duas.
--
-- 2) Apuração bate com o extrato:
-- SELECT * FROM apurar_resultado_periodo('SuperMax','2026-01-01','2026-12-31');
--
-- 3) Fim a fim: conselheiro tenta destinar menos que o lucro (deve recusar),
--    depois abaixo da reserva mínima (deve recusar), depois correto com
--    distribuição — o saldo sai do banco da filial e entra no da Matriz:
-- SELECT nome, filial, saldo FROM caixa_bancos ORDER BY filial, nome;
