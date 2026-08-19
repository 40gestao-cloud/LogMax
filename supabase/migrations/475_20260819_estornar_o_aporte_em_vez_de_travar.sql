-- 475 — O aporte errado tinha de poder voltar atrás.
--
-- A 326 fechou a porta certa pelo motivo certo: deletar a linha de um aporte
-- que moveu caixa devolveria o capital no papel, mas deixaria a conta da
-- Matriz debitada pra sempre e a conta da filial creditada pra sempre. Então
-- o gatilho passou a recusar todo DELETE de aporte com banco.
--
-- O problema é que a recusa virou beco sem saída. A mensagem manda "registrar
-- o lançamento de estorno" — e esse lançamento não existe em lugar nenhum:
-- `caixa_bancos.saldo` é só-leitura pro cliente desde a 327, e não há RPC que
-- desfaça aporte. Quem digitou a filial errada ficava com o registro pra
-- sempre. Pior: a mensagem fala em "movimentou caixa", e o professor vai
-- olhar Contas a Pagar da filial, não acha gasto nenhum, e conclui que o
-- sistema está mentindo. Não está — o aporte não vira gasto, vira SALDO na
-- conta da unidade. É a conta que está diferente, não a despesa.
--
-- Esta migração troca o beco por um caminho:
--
--   · `estornar_aporte_capital` desfaz o movimento na ordem inversa — tira da
--     conta da unidade, devolve pra conta da Matriz, apaga a linha. Tudo numa
--     transação: ou volta inteiro, ou não volta.
--
--   · A trava continua existindo, só que agora ela mede o que importa. Não é
--     "houve banco" (que é sempre verdade desde a 326), é "o dinheiro ainda
--     está lá". Se a unidade já gastou parte, o estorno é recusado com o
--     número na mão: quanto tem, quanto precisa, quanto falta. Aí o caminho é
--     devolver por outro instrumento — distribuição de lucro —, porque
--     estornar criaria saldo negativo.
--
--   · O DELETE direto continua bloqueado. O gatilho só abre para a RPC, via
--     flag local à transação (mesmo padrão da 450/467): o F12 não alcança.
--
--   · O que sumiu da tabela fica no histórico. A linha é apagada, mas
--     `historico_operacoes` guarda valor, unidade, contas e motivo — a
--     pergunta "cadê o aporte de 50 mil?" tem resposta.
--
-- Estorno ≠ devolução. Estorno desfaz um lançamento que não devia ter
-- existido, e por isso só vale enquanto o dinheiro não foi usado. Devolver
-- capital que já circulou é outro ato, com outro nome, e sai pelas RPCs que
-- já existem.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O gatilho passa a distinguir DELETE solto de estorno
--
-- A flag é local à transação (terceiro argumento de `set_config` = true), então
-- ela morre no COMMIT e não vaza pra próxima requisição do mesmo pool. E como
-- só a RPC (SECURITY DEFINER) a acende, quem chamar `.delete()` pelo PostgREST
-- continua batendo na mesma parede.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bloqueia_delete_aporte_com_caixa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.estorno_aporte', true), 'false') = 'true' THEN
    RETURN OLD;
  END IF;

  IF OLD.banco_destino_id IS NOT NULL OR OLD.banco_origem_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este aporte moveu dinheiro entre contas. Use "Estornar aporte" — apagar a linha direto deixaria o saldo das duas contas errado.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bloqueia_delete_aporte_com_caixa ON public.capital_filial;
CREATE TRIGGER trg_bloqueia_delete_aporte_com_caixa
  BEFORE DELETE ON public.capital_filial
  FOR EACH ROW EXECUTE FUNCTION public.bloqueia_delete_aporte_com_caixa();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. estornar_aporte_capital — desfaz na ordem inversa
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.estornar_aporte_capital(
  p_aporte_id uuid,
  p_motivo    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ap          RECORD;
  v_dest_saldo  numeric;
  v_dest_nome   text;
  v_orig_nome   text;
  v_ator_nome   text;
  v_ator_setor  text;
  v_detalhe     text;
BEGIN
  PERFORM public._assert_capital_holding();

  SELECT * INTO v_ap
    FROM public.capital_filial
   WHERE id = p_aporte_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aporte não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- ── Tira da conta que recebeu ─────────────────────────────────────────────
  -- Ordem de lock: destino antes de origem, igual à `registrar_aporte_capital`
  -- lida ao contrário. Ordem invertida entre funções é deadlock esperando
  -- turma cheia (vide migr. 469).
  IF v_ap.banco_destino_id IS NOT NULL THEN
    SELECT COALESCE(saldo, 0), COALESCE(banco, conta)
      INTO v_dest_saldo, v_dest_nome
      FROM public.caixa_bancos
     WHERE id = v_ap.banco_destino_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A conta que recebeu este aporte não existe mais. Sem ela não dá para saber de onde tirar o dinheiro de volta.'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_dest_saldo < v_ap.valor THEN
      RAISE EXCEPTION 'Estorno recusado: a conta % tem R$ % e o aporte foi de R$ %. Faltam R$ % — a unidade já usou parte do dinheiro, e estornar deixaria a conta negativa. Para trazer capital de volta depois de usado, use distribuição de lucro.',
        v_dest_nome, public.brl(v_dest_saldo), public.brl(v_ap.valor),
        public.brl(v_ap.valor - v_dest_saldo)
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) - v_ap.valor
     WHERE id = v_ap.banco_destino_id;
  END IF;

  -- ── Devolve pra conta que pagou ───────────────────────────────────────────
  -- Origem NULL é o capital próprio da holding (dinheiro dos sócios, migr. 326)
  -- e os aportes anteriores à 326: não saiu de conta nenhuma, então não volta
  -- pra conta nenhuma.
  IF v_ap.banco_origem_id IS NOT NULL THEN
    SELECT COALESCE(banco, conta) INTO v_orig_nome
      FROM public.caixa_bancos
     WHERE id = v_ap.banco_origem_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A conta da Matriz de onde este aporte saiu não existe mais. Recrie a conta antes de estornar, senão o dinheiro some do sistema.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.caixa_bancos
       SET saldo = COALESCE(saldo, 0) + v_ap.valor
     WHERE id = v_ap.banco_origem_id;
  END IF;

  -- ── A linha some; o registro fica ─────────────────────────────────────────
  SELECT nome, setor INTO v_ator_nome, v_ator_setor
    FROM public.user_profiles WHERE id = auth.uid();
  IF v_ator_nome IS NULL THEN
    v_ator_nome := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  v_detalhe := 'Aporte de R$ ' || public.brl(v_ap.valor) || ' para ' || v_ap.filial
    || COALESCE(' · saiu de ' || v_orig_nome, ' · sem conta de origem')
    || COALESCE(' · entrou em ' || v_dest_nome, '')
    || COALESCE(' · observação original: ' || NULLIF(v_ap.observacao, ''), '')
    || COALESCE(' · motivo do estorno: ' || NULLIF(p_motivo, ''), '');

  INSERT INTO public.historico_operacoes
    (entidade, entidade_id, filial, evento, de, para, detalhe,
     ator_id, ator_nome, ator_setor)
  VALUES
    ('capital_filial', v_ap.id, v_ap.filial, 'Aporte estornado',
     public.brl(v_ap.valor), '0,00', v_detalhe,
     auth.uid(), v_ator_nome, v_ator_setor);

  PERFORM set_config('app.estorno_aporte', 'true', true);
  DELETE FROM public.capital_filial WHERE id = p_aporte_id;
  PERFORM set_config('app.estorno_aporte', 'false', true);
END;
$function$;

COMMENT ON FUNCTION public.estornar_aporte_capital(uuid, text) IS
  'Migr. 475 — desfaz um aporte inteiro: debita a conta da unidade, credita a conta da Matriz e apaga a linha de capital. Só enquanto o dinheiro ainda estiver na conta que recebeu; depois disso o caminho é distribuição de lucro.';

REVOKE ALL ON FUNCTION public.estornar_aporte_capital(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.estornar_aporte_capital(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.estornar_aporte_capital(uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
