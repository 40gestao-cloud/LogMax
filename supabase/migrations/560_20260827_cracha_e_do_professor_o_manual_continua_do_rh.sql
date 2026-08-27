-- 560 — Crachá é do professor; o manual continua do RH e do gerente
--
-- A 559 abriu a origem 'cracha' na `registrar_ponto_manual`, mas manteve a
-- autorização que já existia: RH **ou** gerente da filial. Com isso um
-- aluno-gerente podia registrar a presença dos colegas da própria unidade
-- lendo o crachá deles — o que já era verdade no lançamento manual desde a
-- 289, só que ali exige procurar o nome numa lista, e aqui é um clique.
--
-- A régua pedida: **crachá só o professor**; o lançamento manual segue com o
-- RH e com o gerente. É por isso que a trava entra aqui e não na tela: a tela
-- já esconde o módulo de quem não é admin, mas tela não é autorização — a RPC
-- é chamada direto pelo PostgREST com o JWT de quem estiver logado.
--
-- `auth_user_role() = 'admin'` LITERAL, e não `auth_is_admin()`: esta última
-- devolve true para 'ceo', 'conselheiro' e para o gerente com
-- `is_conselheiro`, que nesta operação são alunos. "O professor" é role
-- 'admin' e só.
--
-- COALESCE no predicado porque `auth_user_role()` devolve NULL para quem não
-- tem perfil (ou está desligado), e `NULL <> 'admin'` é NULL — o IF não
-- dispararia e o guard sumiria justamente para quem menos deveria passar.

CREATE OR REPLACE FUNCTION public.registrar_ponto_manual(
  p_funcionario_id uuid,
  p_data           date,
  p_status         text,
  p_entrada        text    DEFAULT NULL,
  p_observacao     text    DEFAULT NULL,
  p_horas          numeric DEFAULT NULL,
  p_origem         text    DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial     text;
  v_nome       text;
  v_desligado  boolean;
  v_existente  record;
  v_horas      numeric;
  v_quem       text;
  v_sem_hora   boolean;
  v_origem     text;
  v_corte      date := public.ponto_corte_turma();
BEGIN
  PERFORM public._assert_rpc();

  -- Lista fechada: `origem` é texto livre na tabela, e sem esta trava a
  -- coluna viraria depósito de qualquer string que o frontend mandasse.
  IF COALESCE(p_origem, 'manual') NOT IN ('manual', 'cracha') THEN
    RAISE EXCEPTION 'Origem inválida para lançamento: %. Use manual ou cracha.', p_origem
      USING ERRCODE = 'P0001';
  END IF;
  v_origem := COALESCE(p_origem, 'manual');

  -- Crachá é do professor. O manual segue do RH e do gerente, logo abaixo.
  IF v_origem = 'cracha' AND COALESCE(public.auth_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Só o professor registra presença por crachá. O lançamento manual continua disponível para o RH e o gerente da filial.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('Normal', 'Falta', 'Justificado') THEN
    RAISE EXCEPTION 'Status inválido para lançamento manual: %. Use Normal, Falta ou Justificado.', p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- O motivo é o que separa a falta justificada da falta.
  IF p_status = 'Justificado' AND COALESCE(btrim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Falta justificada precisa de justificativa escrita.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_data > (now() AT TIME ZONE 'America/Rio_Branco')::date THEN
    RAISE EXCEPTION 'Não dá para lançar presença de um dia que ainda não aconteceu.'
      USING ERRCODE = 'P0001';
  END IF;

  -- A linha que muda tudo: em recuperação, o ponto é da Matriz. Mesma régua da
  -- trigger e do placar — aqui ela serve à **autorização** logo abaixo.
  SELECT f.nome,
         public._funcionario_desligado(f.id),
         CASE WHEN public._funcionario_desligado(f.id)
              THEN 'Matriz'
              ELSE COALESCE(f.filial, 'Matriz')
         END
    INTO v_nome, v_desligado, v_filial
    FROM public.funcionarios f WHERE f.id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.auth_in_setor('rh') OR public.auth_gerente_da(v_filial)) THEN
    RAISE EXCEPTION 'Só o RH ou o gerente da filial lançam presença.'
      USING ERRCODE = '42501';
  END IF;

  -- Mensagem própria para o caso novo: sem ela o gerente da filial levaria um
  -- "Funcionário de outra filial" sobre alguém que era dele ontem, e ia achar
  -- que é bug.
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    IF v_desligado THEN
      RAISE EXCEPTION '% está desligado da filial e em recuperação — quem lança o ponto agora é a Matriz.', COALESCE(v_nome, 'Este funcionário')
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Funcionário de outra filial.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existente
    FROM public.ponto_eletronico
   WHERE funcionario_id = p_funcionario_id AND data = p_data
   FOR UPDATE;

  -- (505) Antes da checagem de afastamento, e de propósito: quando a linha é
  -- da turma anterior, o afastamento que a cobre também é, e mandar "ajuste
  -- pelo módulo Afastamentos" levava a pessoa a um afastamento de outra turma.
  -- A trava é sobre a LINHA, não sobre a data: dia antigo sem registro segue
  -- lançável, porque lançar ali não apaga nada de ninguém.
  IF FOUND AND v_corte IS NOT NULL AND p_data < v_corte THEN
    RAISE EXCEPTION 'Dia % de % é registro da turma anterior (o APAGAR TUDO de % fechou aquele período). Ele continua visível no Registro de Ponto, mas não se reescreve por aqui.',
      p_data, COALESCE(v_nome, 'funcionário'), v_corte
      USING ERRCODE = 'P0001';
  END IF;

  IF FOUND AND v_existente.afastamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dia % de % está coberto por um afastamento. Ajuste pelo módulo Afastamentos.', p_data, COALESCE(v_nome, 'funcionário')
      USING ERRCODE = 'P0001';
  END IF;

  IF FOUND AND COALESCE(v_existente.origem, 'legado') = 'legado' AND v_existente.entrada IS NOT NULL THEN
    p_observacao := COALESCE(p_observacao || ' · ', '')
      || 'Substitui registro anterior (entrada ' || v_existente.entrada || ')';
  END IF;

  v_sem_hora := p_status IN ('Falta', 'Justificado');

  v_horas := CASE
    WHEN v_sem_hora THEN 0
    ELSE COALESCE(p_horas, 3.67)   -- 07:40→11:20, jornada padrão da manhã
  END;
  v_quem  := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  -- ON CONFLICT toca `filial` de propósito: é o que faz a trigger disparar no
  -- UPDATE e reavaliar a regra. Um dia lançado pela filial antes do
  -- desligamento e reeditado depois passa a ser da Matriz, em vez de ficar com
  -- a filial antiga e voltar a pesar no placar dela. O valor aqui é só o
  -- gatilho — quem decide é a trigger.
  INSERT INTO public.ponto_eletronico
    (funcionario_id, data, status, entrada, horas_trabalhadas, filial,
     origem, observacao, registrado_por, registrado_por_nome)
  VALUES
    (p_funcionario_id, p_data, p_status,
     CASE WHEN v_sem_hora THEN NULL ELSE p_entrada END,
     v_horas, v_filial, v_origem, p_observacao, auth.uid(), v_quem)
  ON CONFLICT (funcionario_id, data) DO UPDATE
     SET status              = EXCLUDED.status,
         entrada             = EXCLUDED.entrada,
         horas_trabalhadas   = EXCLUDED.horas_trabalhadas,
         filial              = EXCLUDED.filial,
         origem              = EXCLUDED.origem,
         observacao          = EXCLUDED.observacao,
         registrado_por      = EXCLUDED.registrado_por,
         registrado_por_nome = EXCLUDED.registrado_por_nome;

  RETURN jsonb_build_object(
    'ok', true, 'status', p_status, 'data', p_data,
    'funcionario', v_nome, 'filial', v_filial, 'horas', v_horas,
    'em_recuperacao', v_desligado
  );
END;
$function$;

-- Assinatura inalterada, então os GRANTs da 559 continuam valendo. Repetidos
-- assim mesmo: `CREATE OR REPLACE` preserva as permissões, mas quem ler só
-- esta migração não tem como saber disso.
REVOKE ALL ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
