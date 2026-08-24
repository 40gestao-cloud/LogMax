-- 522 — Requisição de material ganha a terceira saída: devolver.
--
-- A 517 deu à requisição de COMPRA três saídas — Aprovar, Negar, Devolver.
-- A de MATERIAL (almoxarifado) ficou com duas: o gerente que vê "500 canetas"
-- só pode negar, decisão de mérito, quando o problema é a quantidade digitada
-- errada. O aluno abre outra requisição, e volta a duplicata que a 517/518
-- existem para eliminar — a mesma lição, ensinada pela metade.
--
-- Esta migração espelha, para `requisicoes_estoque`, exatamente o desenho já
-- corrigido das anteriores — inclusive as lições que custaram uma migração
-- própria para aprender:
--
--   · `reenviada_em` é gravado pela RPC de reenvio, não pelo gatilho (521):
--     um gatilho que carimba em QUALQUER transição Em correção → Pendente
--     marca "corrigida e reenviada" também quando é a direção reabrindo.
--   · `liberar_requisicao_estoque` passa a recusar decidir requisição
--     `Em correção` (521, item 2) — a aprovação continua Pendente enquanto a
--     requisição está com o aluno, porque devolver não mexe na aprovação.
--   · `reabrir_requisicao_estoque` zera `reenviada_em` explicitamente, pelo
--     mesmo motivo.
--   · Ciência do modal por PESSOA e por INSTANTE do evento (520) — tabela
--     própria, não reaproveita `requisicao_ciencia` porque a FK dela aponta
--     para `requisicoes`, não para `requisicoes_estoque`.

BEGIN;

-- ── 1. Colunas de correção ───────────────────────────────────────────────────
ALTER TABLE public.requisicoes_estoque
  ADD COLUMN IF NOT EXISTS correcao_motivo         text,
  ADD COLUMN IF NOT EXISTS correcao_solicitada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS correcao_solicitada_por uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reenviada_em            timestamptz;

COMMENT ON COLUMN public.requisicoes_estoque.correcao_motivo IS
  'Migr. 522. O que o Estoque (ou gerente) pediu para o solicitante corrigir.';
COMMENT ON COLUMN public.requisicoes_estoque.reenviada_em IS
  'Migr. 522. Instante em que a requisição voltou de Em correção para Pendente. Gravado pela RPC de reenvio, nunca por gatilho — reabrir zera.';

-- ── 2. Gatilho: só limpa, nunca marca ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.requisicao_estoque_marca_reenvio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'Em correção' AND OLD.status IS DISTINCT FROM 'Em correção' THEN
    NEW.reenviada_em := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.requisicao_estoque_marca_reenvio() IS
  'Migr. 522 (espelha a 521). Só limpa reenviada_em ao devolver de novo.';

DROP TRIGGER IF EXISTS trg_requisicao_estoque_marca_reenvio ON public.requisicoes_estoque;
CREATE TRIGGER trg_requisicao_estoque_marca_reenvio
  BEFORE UPDATE ON public.requisicoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.requisicao_estoque_marca_reenvio();

-- ── 3. Devolver: de quem decide para quem abriu ─────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_requisicao_estoque_para_correcao(
  p_aprovacao_id uuid,
  p_motivo       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ap    public.aprovacoes_estoque;
  v_req   public.requisicoes_estoque;
  v_prod  text;
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser corrigido — é isso que o solicitante vai ler.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_estoque
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF v_ap.id IS NULL THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%). Para desfazer a decisão, quem reabre é a direção.',
      v_ap.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque
   WHERE id = v_ap.requisicao_estoque_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status = 'Em correção' THEN
    RAISE EXCEPTION 'Esta requisição já está com o solicitante, esperando correção.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_req.filial), false) THEN
    RAISE EXCEPTION 'Requisição de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Mesma autoridade de `liberar_requisicao_estoque`: quem pede não devolve a
  -- própria requisição.
  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem pede o material não devolve a própria requisição.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(
         public.auth_in_setor('estoque', 'logistica')
         OR public.auth_gerente_da(v_req.filial), false) THEN
      RAISE EXCEPTION 'Só o Estoque (ou o gerente da filial) devolve requisição de material.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.requisicoes_estoque
     SET status                  = 'Em correção',
         correcao_motivo         = trim(p_motivo),
         correcao_solicitada_em  = now(),
         correcao_solicitada_por = auth.uid()
   WHERE id = v_req.id;

  SELECT nome INTO v_prod FROM public.produtos WHERE id = v_req.produto_id;

  -- Mesma lista fixa da 518: requisição antiga pode ter setor nulo ou fora
  -- da lista, e um aviso não pode derrubar a devolução.
  IF lower(COALESCE(v_req.setor_solicitante, '')) IN
     ('empresa','compras','estoque','financeiro','rh','vendas',
      'marketing','logistica','ti','gerencia') THEN
    PERFORM public.notificar_setor(
      lower(v_req.setor_solicitante),
      'devolvido_correcao',
      'Requisição de material devolvida para correção',
      COALESCE(v_prod, 'Material') || ' · ' || trim(to_char(v_req.qtd, 'FM999999990.999')),
      'requisicoes-dosetor',
      'Alta',
      v_req.id,
      trim(p_motivo),
      v_req.filial
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'requisicao_id', v_req.id,
    'status', 'Em correção'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.devolver_requisicao_estoque_para_correcao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolver_requisicao_estoque_para_correcao(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.devolver_requisicao_estoque_para_correcao(uuid, text) IS
  'Migr. 522 (espelha a 517). Terceira saída da requisição de material, ao lado de Aprovar e Negar.';

-- ── 4. Reenviar: de quem abriu de volta para quem decide ───────────────────
CREATE OR REPLACE FUNCTION public.reenviar_requisicao_estoque_corrigida(
  p_id      uuid,
  p_qtd     numeric,
  p_destino text DEFAULT NULL
)
RETURNS public.requisicoes_estoque
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req  public.requisicoes_estoque;
  v_prod text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_req FROM public.requisicoes_estoque
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Só requisição de material devolvida para correção pode ser reenviada (esta está %).',
      v_req.status USING ERRCODE = 'P0001';
  END IF;

  -- Quem corrige é quem fez. Gerente e Matriz entram junto pelo mesmo motivo
  -- da 517: destravam o aluno que faltou na aula seguinte.
  IF NOT COALESCE(public.auth_is_admin(), false)
     AND NOT COALESCE(public.auth_gerente_da(v_req.filial), false)
     AND COALESCE(v_req.criado_por, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
    RAISE EXCEPTION 'Quem corrige a requisição é quem a abriu.' USING ERRCODE = '42501';
  END IF;

  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade tem de ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  -- `produto_id`, `centro_custo_id`, `setor_solicitante` e `filial` ficam de
  -- fora de propósito, como em `reenviar_requisicao_corrigida`: corrigir é
  -- consertar o que foi pedido, não trocar o documento por outro.
  UPDATE public.requisicoes_estoque
     SET qtd                     = p_qtd,
         destino                 = NULLIF(trim(COALESCE(p_destino, '')), ''),
         status                  = 'Pendente',
         correcao_motivo         = NULL,
         correcao_solicitada_em  = NULL,
         correcao_solicitada_por = NULL,
         reenviada_em            = now()
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  SELECT nome INTO v_prod FROM public.produtos WHERE id = v_req.produto_id;

  -- 'logistica' é quem decide na prática (a guarda de `liberar_requisicao_estoque`
  -- aceita `estoque` OU `logistica`, mas nenhum perfil real usa o setor
  -- `estoque` — vide auditoria de 2026-08-24). 'gerencia' entra também porque
  -- o gerente decide sem depender de setor.
  PERFORM public.notificar_setor(
    'logistica',
    'aprovacao_pendente',
    'Requisição de material corrigida e reenviada',
    COALESCE(v_prod, 'Material') || ' · ' || trim(to_char(v_req.qtd, 'FM999999990.999')),
    'requisicoes-aprovações',
    'Média',
    v_req.id,
    NULL,
    v_req.filial
  );
  PERFORM public.notificar_setor(
    'gerencia',
    'aprovacao_pendente',
    'Requisição de material corrigida e reenviada',
    COALESCE(v_prod, 'Material') || ' · ' || trim(to_char(v_req.qtd, 'FM999999990.999')),
    'requisicoes-aprovações',
    'Média',
    v_req.id,
    NULL,
    v_req.filial
  );

  RETURN v_req;
END;
$function$;

REVOKE ALL ON FUNCTION public.reenviar_requisicao_estoque_corrigida(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reenviar_requisicao_estoque_corrigida(uuid, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.reenviar_requisicao_estoque_corrigida(uuid, numeric, text) IS
  'Migr. 522 (espelha a 517/518/521). Reenvia o documento de material devolvido; grava reenviada_em explicitamente.';

-- ── 5. Decidir recusa requisição que está com o solicitante ────────────────
CREATE OR REPLACE FUNCTION public.liberar_requisicao_estoque(
  p_aprovacao_id uuid,
  p_decisao      text,
  p_observacao   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ap   public.aprovacoes_estoque;
  v_req  public.requisicoes_estoque;
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_decisao NOT IN ('Aprovado', 'Negado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Negado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_decisao = 'Negado' AND COALESCE(trim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Negar exige justificativa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_estoque
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF v_ap.id IS NULL THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%).', v_ap.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque
   WHERE id = v_ap.requisicao_estoque_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- MIGR 522 (espelha a 521, item 2): a aprovação continua Pendente enquanto
  -- a requisição está Em correção — devolver não mexe na aprovação.
  IF v_req.status = 'Em correção' THEN
    RAISE EXCEPTION
      'Esta requisição está com % para correção — espere o reenvio, ou peça à direção para reabri-la. Decidir agora ignoraria o que ele está consertando.',
      COALESCE(v_req.solicitante, 'o solicitante')
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_req.filial), false) THEN
    RAISE EXCEPTION 'Requisição de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem pede o material não libera a própria requisição.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(
         public.auth_in_setor('estoque', 'logistica')
         OR public.auth_gerente_da(v_req.filial), false) THEN
      RAISE EXCEPTION 'Só o Estoque (ou o gerente da filial) decide requisição de material.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.aprovacoes_estoque
     SET status     = p_decisao,
         observacao = COALESCE(p_observacao, ''),
         aprovador  = COALESCE(v_nome, aprovador)
   WHERE id = p_aprovacao_id;

  UPDATE public.requisicoes_estoque
     SET status = p_decisao
   WHERE id = v_req.id;

  IF p_decisao = 'Aprovado' AND v_req.produto_id IS NOT NULL
     AND COALESCE(v_req.qtd, 0) > 0 THEN
    INSERT INTO public.movimentacoes_estoque (
      produto_id, tipo, qtd, origem, destino, data, filial, requisicao_estoque_id
    ) VALUES (
      v_req.produto_id, 'Saída', v_req.qtd, 'Requisição de Estoque',
      COALESCE(NULLIF(trim(v_req.destino), ''), 'Solicitado'),
      public.acre_today(), v_req.filial, v_req.id
    );
  END IF;

  RETURN jsonb_build_object(
    'aprovacao_id',  p_aprovacao_id,
    'requisicao_id', v_req.id,
    'status',        p_decisao,
    'baixou_estoque', p_decisao = 'Aprovado'
                      AND v_req.produto_id IS NOT NULL
                      AND COALESCE(v_req.qtd, 0) > 0
  );
END;
$function$;

COMMENT ON FUNCTION public.liberar_requisicao_estoque(uuid, text, text) IS
  'Migr. 284/399/522. Recusa decidir requisição de material Em correção.';

-- ── 6. Reabrir zera reenviada_em explicitamente ─────────────────────────────
CREATE OR REPLACE FUNCTION public.reabrir_requisicao_estoque(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      public.requisicoes_estoque;
  v_nome     text;
  v_ap_id    uuid;
  v_restaura boolean;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'Só a direção reabre uma requisição de material.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição de material não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status = 'Aprovado' AND COALESCE(v_req.ativo, true) THEN
    RAISE EXCEPTION
      'Este material já foi liberado e saiu do estoque. Reabrir contaria a mesma saída duas vezes — registre uma entrada de devolução em Movimentações e abra uma requisição nova.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();
  v_restaura := NOT COALESCE(v_req.ativo, true);

  -- MIGR 522: reenviada_em zerado aqui, explícito — reabrir é a direção
  -- desfazendo, não o aluno tendo corrigido nada.
  UPDATE public.requisicoes_estoque
     SET status       = 'Pendente',
         ativo        = true,
         reenviada_em = NULL
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  SELECT id INTO v_ap_id FROM public.aprovacoes_estoque
   WHERE requisicao_estoque_id = v_req.id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_ap_id IS NULL THEN
    INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status, filial)
    VALUES (v_req.id, 'Pendente', v_req.filial);
  ELSE
    UPDATE public.aprovacoes_estoque
       SET status = 'Pendente', aprovador = NULL,
           observacao = format('Reaberta por %s%s.', COALESCE(v_nome, 'direção'),
                               COALESCE(' — ' || NULLIF(trim(p_motivo), ''), ''))
     WHERE id = v_ap_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'restaurada', v_restaura, 'requisicao', to_jsonb(v_req));
END;
$function$;

COMMENT ON FUNCTION public.reabrir_requisicao_estoque(uuid, text) IS
  'Migr. 399/522. Direção desfaz decisão; zera reenviada_em explicitamente.';

-- ── 7. Ciência por pessoa e por evento (espelha a 520) ──────────────────────
CREATE TABLE IF NOT EXISTS public.requisicao_estoque_ciencia (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisicao_estoque_id  uuid NOT NULL REFERENCES public.requisicoes_estoque(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.user_profiles(id)      ON DELETE CASCADE,
  evento                 text NOT NULL CHECK (evento IN ('devolvida', 'reenviada')),
  evento_em              timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requisicao_estoque_id, user_id, evento)
);

CREATE INDEX IF NOT EXISTS idx_requisicao_estoque_ciencia_user
  ON public.requisicao_estoque_ciencia (user_id, evento);

ALTER TABLE public.requisicao_estoque_ciencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ciencia_req_estoque_select" ON public.requisicao_estoque_ciencia;
CREATE POLICY "ciencia_req_estoque_select" ON public.requisicao_estoque_ciencia
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.requisicao_estoque_ciencia TO authenticated;
REVOKE ALL ON public.requisicao_estoque_ciencia FROM anon;

CREATE OR REPLACE FUNCTION public.dar_ciencia_requisicao_estoque(
  p_requisicao_estoque_id uuid,
  p_evento                text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requisicoes_estoque;
  v_em  timestamptz;
BEGIN
  PERFORM public._assert_rpc();

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão sem usuário.' USING ERRCODE = '42501';
  END IF;
  IF p_evento NOT IN ('devolvida', 'reenviada') THEN
    RAISE EXCEPTION 'Evento inválido: %.', p_evento USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes_estoque WHERE id = p_requisicao_estoque_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Requisição de material não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_em := COALESCE(
    CASE WHEN p_evento = 'devolvida' THEN v_req.correcao_solicitada_em
         ELSE v_req.reenviada_em END,
    now());

  INSERT INTO public.requisicao_estoque_ciencia (requisicao_estoque_id, user_id, evento, evento_em)
  VALUES (p_requisicao_estoque_id, auth.uid(), p_evento, v_em)
  ON CONFLICT (requisicao_estoque_id, user_id, evento)
  DO UPDATE SET evento_em  = GREATEST(public.requisicao_estoque_ciencia.evento_em, EXCLUDED.evento_em),
                created_at = now();

  RETURN jsonb_build_object('ok', true, 'evento_em', v_em);
END;
$function$;

REVOKE ALL ON FUNCTION public.dar_ciencia_requisicao_estoque(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_ciencia_requisicao_estoque(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.dar_ciencia_requisicao_estoque(uuid, text) IS
  'Migr. 522 (espelha a 520). Registra que ESTA pessoa viu a devolução (ou o reenvio) DESTE material.';

COMMIT;
