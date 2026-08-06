-- 357 — Ponto de quem está em recuperação é lançado pela Matriz
--
-- Fecha o buraco que a 356 deixou aparente. Desligamento aqui não é saída do
-- curso: o aluno sai da filial e vai para recuperação, e continua tendo
-- presença lançada. A 356 tirou o ponto dele da conta da filial — mas ninguém
-- ficou responsável por lançá-lo: a tela de frequência filtrava
-- `status = 'Ativo'`, então o desligado sumia da lista do gerente da filial
-- (correto) e não aparecia em lugar nenhum (errado).
--
-- Regra nova: **para efeito de ponto, o desligado é da Matriz.**
--
-- Isso não é um campo novo nem um estado novo — é uma linha só, no ponto onde
-- a RPC resolve de qual filial é o funcionário. E ela resolve as três coisas
-- de uma vez, porque tudo depende de `v_filial`:
--
--   1. Autorização: `auth_pode_filial('Matriz')` só passa para admin/CEO/
--      conselheiro ou para quem é da Matriz. Gerente de filial deixa de poder
--      lançar o ponto de quem ela desligou — que é o ponto do exercício.
--   2. Gravação: a linha nasce com `filial = 'Matriz'` (ver a trigger abaixo),
--      então nem depende do filtro da 356 para ficar fora do placar da filial.
--      A 356 continua necessária para o histórico já gravado com a filial de
--      origem.
--   3. Leitura: RLS de `ponto_eletronico` é por filial, então o registro passa
--      a ser visível a quem responde por ele.
--
-- `funcionarios.filial` continua intocado — é a filial de origem, o que o RH
-- precisa saber e o que a readmissão usa para devolver a pessoa. Readmitido
-- volta a `status = 'Ativo'` e o ponto volta a ser da filial no mesmo instante.
--
-- ATENÇÃO — por que a regra mora na trigger e não só na RPC:
--
-- `ponto_eletronico` tem um BEFORE INSERT (`trg_ponto_filial`) que **sobrescreve**
-- `NEW.filial` com `funcionarios.filial`, ignorando o que o INSERT mandou. Uma
-- versão anterior desta migração só mexia na RPC e teria sido revertida em
-- silêncio pela trigger no INSERT — e, como a trigger não roda em UPDATE, o
-- `ON CONFLICT DO UPDATE` gravaria 'Matriz': o primeiro lançamento do dia iria
-- para a filial e a reedição para a Matriz. Pior que não fazer nada.
--
-- E há um segundo caminho de escrita: o totem. `fn_sync_ponto_eletronico`
-- (AFTER INSERT em `ponto_qr_registros`) insere em `ponto_eletronico` **sem
-- filial**, contando com essa mesma trigger. O desligamento não apaga o
-- `auth.users` e `api/register-ponto.ts` roda com service_role sem checar
-- `desligado_em`, então quem está em recuperação ainda consegue bater no
-- totem — e o registro nasceria na filial de origem.
--
-- Com a regra na trigger, os dois caminhos (lançamento manual e totem) e
-- qualquer INSERT futuro obedecem de graça. A RPC continua calculando a filial
-- para a **autorização** — é o que barra o gerente da filial —, mas quem tem a
-- palavra final sobre a coluna é a trigger.

BEGIN;

-- ── 0. A trigger que decide a filial do registro ─────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ponto_filial_from_funcionario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial text;
BEGIN
  SELECT f.filial INTO v_filial
    FROM public.funcionarios f
   WHERE f.id = NEW.funcionario_id;

  -- Em recuperação o ponto é da Matriz, venha de onde vier. A régua é a mesma
  -- do placar e da avaliação (`_funcionario_desligado`, migr. 356) — se cada
  -- lugar decidisse por conta própria, a linha nasceria numa filial e seria
  -- contada em outra.
  NEW.filial := CASE
    WHEN public._funcionario_desligado(NEW.funcionario_id) THEN 'Matriz'
    ELSE COALESCE(v_filial, 'SuperMax')   -- default histórico, preservado
  END;

  RETURN NEW;
END;
$function$;

-- Passa a valer no UPDATE também. Antes só o INSERT era coberto, então uma
-- linha criada antes do desligamento e reeditada depois ficava com a filial
-- antiga — exatamente o registro que não pode continuar pesando na filial.
DROP TRIGGER IF EXISTS trg_ponto_filial ON public.ponto_eletronico;
CREATE TRIGGER trg_ponto_filial
  BEFORE INSERT OR UPDATE OF funcionario_id, filial ON public.ponto_eletronico
  FOR EACH ROW EXECUTE FUNCTION public.fn_ponto_filial_from_funcionario();

CREATE OR REPLACE FUNCTION public.registrar_ponto_manual(
  p_funcionario_id uuid,
  p_data           date,
  p_status         text,
  p_entrada        text DEFAULT NULL,
  p_observacao     text DEFAULT NULL,
  p_horas          numeric DEFAULT NULL
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
BEGIN
  PERFORM public._assert_rpc();

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
  IF NOT public.auth_pode_filial(v_filial) THEN
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
     v_horas, v_filial, 'manual', p_observacao, auth.uid(), v_quem)
  ON CONFLICT (funcionario_id, data) DO UPDATE
     SET status              = EXCLUDED.status,
         entrada             = EXCLUDED.entrada,
         horas_trabalhadas   = EXCLUDED.horas_trabalhadas,
         filial              = EXCLUDED.filial,
         origem              = 'manual',
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

REVOKE ALL ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_manual(uuid, date, text, text, text, numeric) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
