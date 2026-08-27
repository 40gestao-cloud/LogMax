-- 559 — O ponto também entra por crachá
--
-- Hoje a presença da turma é lançada à mão: o professor abre Ponto Eletrônico,
-- procura o aluno na lista e marca. Funciona, mas com trinta pessoas é trinta
-- buscas por nome, e o nome é a única identidade que o aluno tem no sistema.
--
-- O crachá virtual troca a busca pela leitura de um QR: o aluno mostra o
-- crachá, o professor lê, confirma a foto e grava. O QR carrega apenas o
-- `funcionarios.id` — não é credencial e não autoriza nada. Quem grava
-- continua sendo `registrar_ponto_manual`, que já exige RH ou gerente da
-- filial; o crachá só substitui a DIGITAÇÃO do nome, e forjar um QR não dá a
-- ninguém um poder que quem está com o leitor na mão já não tivesse.
--
-- O que muda no banco é uma coisa só: saber por onde a presença entrou. Sem
-- isso, `origem` diria 'manual' para o dia inteiro e não haveria como
-- distinguir o que foi lido do que foi digitado — que é justamente a pergunta
-- que se faz quando um lançamento é contestado.
--
-- Assinatura vigente antes desta migração (conferida no banco, não no
-- arquivo): (uuid, date, text, text, text, numeric) — a 290 acrescentou
-- p_horas. Como o parâmetro novo entra com DEFAULT, CREATE OR REPLACE criaria
-- uma SEGUNDA função e o PostgREST passaria a não saber qual chamar; por isso
-- o DROP explícito da assinatura antiga.

BEGIN;

DROP FUNCTION IF EXISTS public.registrar_ponto_manual(uuid, date, text, text, text, numeric);

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

-- RPC nova nasce aberta pro anon: revogar nominalmente, não confiar no default.
REVOKE ALL ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric, text) TO authenticated;

COMMIT;

-- Sem isto o PostgREST continua anunciando a assinatura de 6 argumentos e a
-- chamada com p_origem volta PGRST202.
NOTIFY pgrst, 'reload schema';
