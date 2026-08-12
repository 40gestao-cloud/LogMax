-- 408_20260812_uma_aula_pode_durar_tres_encontros.sql
--
-- Uma aula pode não caber num dia.
--
-- A migr. 406 registra a aula por SESSÃO — ligar abre, desligar fecha — e
-- tratou sessão e aula como a mesma coisa. Não são. "Aula de Compra" é um
-- assunto, e a cadeia de compra é longa o bastante para durar três encontros;
-- o Modo Aula, esse sim, liga e desliga todo dia, porque menu recortado não
-- pode atravessar a noite e o registro tem de refletir a janela real de sala.
--
-- Com o modelo de 406 sozinho, o professor tinha duas saídas ruins: deixar
-- ligado três dias (e ter uma linha de setenta horas, com a config do terceiro
-- dia por cima da do primeiro) ou fechar todo dia (e ter três aulas soltas que
-- nada diz serem a mesma).
--
-- `continua_de` é a terceira saída: a sessão aponta para a anterior, e o
-- histórico lê a corrente como uma aula em N encontros.
--
-- POR QUE UMA REFERÊNCIA E NÃO UMA TABELA DE TEMAS:
--
-- Tema exigiria ser criado ANTES da aula, e a 406 estabeleceu o contrário — o
-- título é pedido depois, porque no começo da aula ninguém sabe ainda o que ela
-- foi. Encadear é a mesma ideia levada adiante: no fim do segundo encontro, o
-- professor sabe que aquilo continuou a terça; antes dele, não sabia. E sessão
-- não encadeada continua sendo registro completo — a ausência do vínculo não
-- estraga nada, só deixa de agrupar.
--
-- O título mora na RAIZ da corrente. Renomear a aula no primeiro encontro
-- renomeia os três, que é o comportamento esperado de quem digitou "Compra
-- completa" uma vez.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Coluna
-- ─────────────────────────────────────────────

ALTER TABLE public.aula_sessoes
  ADD COLUMN IF NOT EXISTS continua_de uuid
    REFERENCES public.aula_sessoes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.aula_sessoes.continua_de IS
  'Sessão anterior da mesma aula. NULL = a aula começa aqui. O título da aula '
  'mora na raiz da corrente.';

-- Uma sessão só pode ser continuada por UMA. Sem isto, dois encontros
-- apontando para a mesma terça-feira formariam uma árvore, e "encontro 2 de 3"
-- deixaria de ter resposta única.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aula_sessoes_continua_de
  ON public.aula_sessoes (continua_de) WHERE continua_de IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. RPC — encadear e desencadear
-- ─────────────────────────────────────────────
-- A tabela não tem policy de UPDATE (migr. 406: o histórico é inforjável pela
-- API), então o vínculo passa por RPC DEFINER, como o nomear.

CREATE OR REPLACE FUNCTION public.vincular_sessao_aula(
  p_sessao_id   uuid,
  p_continua_de uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_esta    public.aula_sessoes%ROWTYPE;
  v_alvo    public.aula_sessoes%ROWTYPE;
  v_cursor  uuid;
  v_saltos  integer := 0;
BEGIN
  -- COALESCE porque `auth_user_role()` devolve NULL para sessão sem perfil, e
  -- `NULL IN (...)` é NULL — que num IF NOT não barra ninguém.
  IF NOT COALESCE(public.auth_user_role() IN ('admin','ceo'), false) THEN
    RAISE EXCEPTION 'Apenas admin ou CEO pode encadear aulas.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_esta FROM public.aula_sessoes WHERE id = p_sessao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão de aula não encontrada.' USING ERRCODE = '22023';
  END IF;

  -- Desencadear: a aula volta a começar nesta sessão.
  IF p_continua_de IS NULL THEN
    UPDATE public.aula_sessoes SET continua_de = NULL WHERE id = p_sessao_id;
    RETURN;
  END IF;

  IF p_continua_de = p_sessao_id THEN
    RAISE EXCEPTION 'Uma aula não continua a si mesma.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_alvo FROM public.aula_sessoes WHERE id = p_continua_de;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A sessão anterior indicada não existe.' USING ERRCODE = '22023';
  END IF;

  -- Continuação vem DEPOIS. Sem esta trava, encadear na ordem errada faria
  -- "encontro 1" acontecer depois do "encontro 2" e a numeração mentiria.
  IF v_alvo.iniciada_em >= v_esta.iniciada_em THEN
    RAISE EXCEPTION 'A aula anterior tem de ter começado antes desta.'
      USING ERRCODE = '22023';
  END IF;

  -- Ciclo: subir a corrente a partir do alvo e recusar se esbarrar nesta
  -- sessão. A trava de tempo acima já torna o ciclo impossível, mas ela
  -- depende de `iniciada_em`, que é dado — e dado se conserta à mão. Este
  -- laço depende só da topologia. O teto de saltos é rede contra corrente
  -- corrompida: sem ele, um ciclo pré-existente travaria a transação.
  v_cursor := v_alvo.continua_de;
  WHILE v_cursor IS NOT NULL AND v_saltos < 100 LOOP
    IF v_cursor = p_sessao_id THEN
      RAISE EXCEPTION 'Isto fecharia um ciclo entre as aulas.' USING ERRCODE = '22023';
    END IF;
    SELECT continua_de INTO v_cursor FROM public.aula_sessoes WHERE id = v_cursor;
    v_saltos := v_saltos + 1;
  END LOOP;

  -- O índice único cuida de "essa terça já é continuada por outra"; traduzir
  -- aqui evita devolver 23505 cru para a tela.
  IF EXISTS (
    SELECT 1 FROM public.aula_sessoes
     WHERE continua_de = p_continua_de AND id <> p_sessao_id
  ) THEN
    RAISE EXCEPTION 'Essa aula já é continuada por outro encontro.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.aula_sessoes SET continua_de = p_continua_de WHERE id = p_sessao_id;
END;
$$;

-- ─────────────────────────────────────────────
-- 3. Grants (padrão da migr. 260: nada nominalmente para anon)
-- ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.vincular_sessao_aula(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vincular_sessao_aula(uuid, uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- três encontros da mesma aula (ids fictícios A, B, C em ordem de tempo):
--   SELECT public.vincular_sessao_aula('<B>', '<A>');
--   SELECT public.vincular_sessao_aula('<C>', '<B>');
--   SELECT id, continua_de, titulo FROM aula_sessoes ORDER BY iniciada_em;
--
--   -- as travas:
--   SELECT public.vincular_sessao_aula('<A>', '<A>');   -- erro: a si mesma
--   SELECT public.vincular_sessao_aula('<A>', '<C>');   -- erro: anterior é posterior
--   SELECT public.vincular_sessao_aula('<A>', '<B>');   -- erro: ciclo
--   SELECT public.vincular_sessao_aula('<C>', '<A>');   -- erro: A já é continuada por B
--
--   -- desencadear:
--   SELECT public.vincular_sessao_aula('<C>', NULL);
-- =================================================================
