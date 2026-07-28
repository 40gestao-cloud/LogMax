-- Folha: processar passa a ser transição de banco, não sequência de telas.
--
-- ACHADO (Etapa 2 do plano, provado em dados no LogMax-ERP em 2026-07-28):
-- 15 folhas em 'Paga', todas creditadas no MaxBank, **nenhuma** com conta a
-- pagar — R$ 22,4 mil que o Financeiro nunca viu. Só a MaxLook gerou as suas
-- (9 de 9). SuperMax e TechMax: zero de 15.
--
-- A causa está na assimetria entre duas policies de `contas_pagar`:
--
--   fin_insert  → auth_pode_filial(filial)
--   fin_select  → (financeiro OU gerente da filial) AND auth_pode_filial(...)
--
-- O RH gera a conta pela tela de Folha. Quando a tela está apontada para a
-- própria filial do operador, o INSERT passa. Quando aponta para outra — e
-- gerente+ alterna livremente — a RLS nega, o `catch` mostra um toast, e o
-- ciclo segue: a folha vira 'Processada', depois 'Paga', o colaborador é
-- creditado e a despesa nunca existe. Um toast é tudo que separa a folha de
-- ser paga sem lançamento.
--
-- Três defeitos no mesmo trecho:
--   P6  duas escritas sem transação — a segunda pode falhar sozinha;
--   P8  a conta nascia com a filial DA TELA, não a da folha;
--   P13 o líquido vinha do objeto em memória, não do banco.
--
-- `processar_folha` resolve os três: uma transação, filial lida da folha,
-- valor lido da folha. Se a conta não puder ser criada, a folha NÃO avança.
--
-- Não regulariza as 15 folhas já pagas — isso mexe em saldo de banco e é
-- decisão do Financeiro. Ver a seção de REGULARIZAÇÃO no fim do arquivo.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos com colaboradores.

BEGIN;

CREATE OR REPLACE FUNCTION public.processar_folha(p_folha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     text;
  v_filial     text;
  v_liquido    numeric(15,2);
  v_mes_ref    text;
  v_func_nome  text;
  v_venc       date;
  v_conta_id   uuid;
BEGIN
  PERFORM public._assert_rpc('rh');

  SELECT f.status, f.filial, f.salario_liquido, f.mes_ref, fu.nome
    INTO v_status, v_filial, v_liquido, v_mes_ref, v_func_nome
    FROM public.folha_pagamento f
    LEFT JOIN public.funcionarios fu ON fu.id = f.funcionario_id
   WHERE f.id = p_folha_id
     AND COALESCE(f.ativo, true)
   FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Folha de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Só uma folha Pendente pode ser processada (esta está %).', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_liquido IS NULL OR v_liquido <= 0 THEN
    RAISE EXCEPTION 'Salário líquido zerado. Confira os valores da folha antes de processar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Vencimento: dia 5 do mês seguinte ao de referência.
  v_venc := CASE
    WHEN v_mes_ref ~ '^\d{4}-\d{2}$'
      THEN (to_date(v_mes_ref || '-01', 'YYYY-MM-DD') + interval '1 month' + interval '4 days')::date
    ELSE NULL
  END;

  SELECT id INTO v_conta_id
    FROM public.contas_pagar
   WHERE folha_pagamento_id = p_folha_id
     AND COALESCE(ativo, true);

  IF v_conta_id IS NULL THEN
    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, folha_pagamento_id)
    VALUES (
      'Folha ' || COALESCE(v_mes_ref, '') || ' — ' || COALESCE(v_func_nome, 'Funcionário')
        || ' [folha:' || p_folha_id::text || ']',
      v_liquido,
      v_venc,
      'Pendente',
      v_filial,            -- filial da FOLHA. A da tela não manda aqui (P8).
      p_folha_id
    )
    RETURNING id INTO v_conta_id;
  END IF;

  UPDATE public.folha_pagamento
     SET status = 'Processada'
   WHERE id = p_folha_id;

  RETURN jsonb_build_object(
    'ok', true, 'status', 'Processada',
    'conta_pagar_id', v_conta_id, 'valor', v_liquido, 'filial', v_filial
  );
END;
$$;

REVOKE ALL ON FUNCTION public.processar_folha(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.processar_folha(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   -- Folhas que saíram de Pendente sem deixar conta a pagar. Deve parar de
--   -- crescer a partir daqui.
--   SELECT f.filial, f.status, count(*)
--     FROM folha_pagamento f
--    WHERE f.status IN ('Processada','Paga') AND COALESCE(f.ativo,true)
--      AND NOT EXISTS (SELECT 1 FROM contas_pagar cp
--                       WHERE cp.folha_pagamento_id = f.id AND COALESCE(cp.ativo,true))
--    GROUP BY 1,2 ORDER BY 1,2;
--
-- ════════════════════════════════════════════════════════════════════════════
-- REGULARIZAÇÃO DO PASSIVO (decisão do Financeiro — NÃO roda sozinho)
-- ════════════════════════════════════════════════════════════════════════════
-- As folhas já pagas sem conta são despesa que aconteceu (o colaborador tem o
-- dinheiro na carteira) e que o banco nunca registrou — o saldo dos bancos
-- está superestimado nesse valor. Duas saídas, e a escolha não é técnica:
--
--   A) Lançar como já paga, debitando o banco: reconhece a despesa e corrige
--      o saldo. Exige escolher o banco (`banco_id`), senão o trigger
--      `sync_saldo_caixa_pagar` não move nada.
--
--   B) Lançar como 'Pendente': a despesa aparece no Financeiro e alguém paga
--      de novo — o que debita o banco por um dinheiro que o colaborador já
--      recebeu. Só faz sentido se o pagamento real ainda não saiu.
--
-- Levantamento do passivo antes de qualquer decisão:
--   SELECT f.filial, count(*), sum(f.salario_liquido) AS total
--     FROM folha_pagamento f
--    WHERE f.status='Paga' AND COALESCE(f.ativo,true)
--      AND NOT EXISTS (SELECT 1 FROM contas_pagar cp WHERE cp.folha_pagamento_id=f.id)
--    GROUP BY 1;
-- ════════════════════════════════════════════════════════════════════════════
