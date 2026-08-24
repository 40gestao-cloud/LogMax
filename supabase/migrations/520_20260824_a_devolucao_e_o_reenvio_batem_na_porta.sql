-- 520 — A devolução e o reenvio batem na porta, em vez de esperar no sino.
--
-- A 518 fez os dois lados avisarem: devolveu, notifica o setor de quem abriu;
-- reenviou, notifica a gerência. Mas notificação é badge no sino — depende de
-- a pessoa REPARAR num número pequeno no topo da tela. Foi por não repararem
-- que nasceram as quatro requisições em duplicata da TechMax: a devolvida
-- ficava parada e ~18 minutos depois nascia outra igual, com outro número.
--
-- O que já funciona nesta casa quando o recado NÃO pode ser perdido é o modal
-- que interrompe: Avisos da Matriz (263) e Novo Documento (476). Mesma
-- mecânica aqui, de propósito — duas coisas que interrompem o aluno do mesmo
-- jeito devem parecer a mesma coisa.
--
-- Quem recebe:
--   · devolvida  → SÓ quem abriu a requisição (`criado_por`). Gerente e Matriz
--                  ficam de fora: foram eles que devolveram.
--   · reenviada  → quem decide (gerente da unidade + Matriz).
--
-- ── Por que uma tabela de ciência, e não `notificacoes.lido` ────────────────
-- `notificacoes` é por SETOR: uma linha para o setor inteiro. Um aluno clicar
-- "ciente" apagaria o aviso dos colegas. Ciência de modal é por PESSOA, como
-- em `avisos_matriz_ciencia`.
--
-- ── Por que `evento_em`, e não só um booleano ──────────────────────────────
-- O mesmo documento vai e volta várias vezes na mesma aula. Ciência que só diz
-- "já vi esta requisição" cala o modal na SEGUNDA devolução — justamente a que
-- mais precisa aparecer. Por isso a ciência guarda O INSTANTE do evento que
-- foi visto, e o modal reabre quando o evento é mais novo que a ciência.

BEGIN;

-- ── 1. Quando o documento voltou para a fila do gerente ─────────────────────
--
-- `correcao_solicitada_em` (517) já marca a ida. Faltava a volta: o reenvio
-- apaga os campos de correção e devolve o status a 'Pendente', e depois disso
-- nada distingue a requisição corrigida das que nunca saíram da fila.
--
-- Gatilho em vez de mexer na RPC: a marca passa a valer para QUALQUER caminho
-- que faça a transição — inclusive o conserto manual da direção pelo banco.
ALTER TABLE public.requisicoes
  ADD COLUMN IF NOT EXISTS reenviada_em timestamptz;

COMMENT ON COLUMN public.requisicoes.reenviada_em IS
  'Migr. 520. Instante em que a requisição voltou de Em correção para Pendente. NULL = nunca voltou (ou foi devolvida de novo).';

CREATE OR REPLACE FUNCTION public.requisicao_marca_reenvio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'Em correção' AND NEW.status = 'Pendente' THEN
    NEW.reenviada_em := now();
  ELSIF NEW.status = 'Em correção' AND OLD.status IS DISTINCT FROM 'Em correção' THEN
    -- Devolvida de novo: a volta anterior deixa de valer, senão o gerente
    -- continuaria vendo "corrigida e reenviada" no que está com o aluno.
    NEW.reenviada_em := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_requisicao_marca_reenvio ON public.requisicoes;
CREATE TRIGGER trg_requisicao_marca_reenvio
  BEFORE UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.requisicao_marca_reenvio();

-- ── 2. Ciência por pessoa e por evento ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.requisicao_ciencia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisicao_id uuid NOT NULL REFERENCES public.requisicoes(id)   ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  evento        text NOT NULL CHECK (evento IN ('devolvida', 'reenviada')),
  -- Instante do evento que a pessoa viu, não da ciência. É o que permite o
  -- modal reabrir na devolução seguinte do mesmo documento.
  evento_em     timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requisicao_id, user_id, evento)
);

CREATE INDEX IF NOT EXISTS idx_requisicao_ciencia_user
  ON public.requisicao_ciencia (user_id, evento);

ALTER TABLE public.requisicao_ciencia ENABLE ROW LEVEL SECURITY;

-- Ciência é da pessoa: ela lê a dela e mais nada. A escrita passa só pela RPC
-- (SECURITY DEFINER), que é quem sabe qual é o instante do evento.
DROP POLICY IF EXISTS "ciencia_req_select" ON public.requisicao_ciencia;
CREATE POLICY "ciencia_req_select" ON public.requisicao_ciencia
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.requisicao_ciencia TO authenticated;
REVOKE ALL ON public.requisicao_ciencia FROM anon;

-- ── 3. Dar ciência ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dar_ciencia_requisicao(
  p_requisicao_id uuid,
  p_evento        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requisicoes;
  v_em  timestamptz;
BEGIN
  PERFORM public._assert_rpc();

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão sem usuário.' USING ERRCODE = '42501';
  END IF;

  IF p_evento NOT IN ('devolvida', 'reenviada') THEN
    RAISE EXCEPTION 'Evento inválido: %.', p_evento USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = p_requisicao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- O instante vem do documento, não do cliente: navegador não decide até onde
  -- a própria ciência vale.
  v_em := COALESCE(
    CASE WHEN p_evento = 'devolvida' THEN v_req.correcao_solicitada_em
         ELSE v_req.reenviada_em END,
    now());

  INSERT INTO public.requisicao_ciencia (requisicao_id, user_id, evento, evento_em)
  VALUES (p_requisicao_id, auth.uid(), p_evento, v_em)
  ON CONFLICT (requisicao_id, user_id, evento)
  DO UPDATE SET evento_em  = GREATEST(public.requisicao_ciencia.evento_em, EXCLUDED.evento_em),
                created_at = now();

  RETURN jsonb_build_object('ok', true, 'evento_em', v_em);
END;
$function$;

REVOKE ALL ON FUNCTION public.dar_ciencia_requisicao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_ciencia_requisicao(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.dar_ciencia_requisicao(uuid, text) IS
  'Migr. 520. Registra que ESTA pessoa viu a devolucao (ou o reenvio) DESTE documento, carimbando o instante do evento visto.';

-- ── 4. Realtime ─────────────────────────────────────────────────────────────
-- `requisicoes` já está na publicação; sem isto o modal só apareceria no F5
-- seguinte, e um aviso que chega depois do próximo clique não é aviso.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'requisicoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.requisicoes;
  END IF;
END $$;

COMMIT;
