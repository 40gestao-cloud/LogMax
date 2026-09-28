-- 643_20260928_quem_abre_nao_aprova_e_estoque_e_do_estoque.sql
--
-- Duas pendências da auditoria de 28/09 do fluxo de compra (ver 642).
--
-- 1. "Quem abre não aprova" tinha exceção para a Matriz. requisição, cotação
--    e recebimento pulavam a segregação com auth_is_admin(), que inclui CEO e
--    conselheiro — ALUNOS. Um CEO abria a requisição e a aprovava, cadastrava
--    a proposta e a aprovava, emitia o pedido e conferia a carga. A regra
--    passa a valer para todos; a Matriz continua decidindo o que OUTROS
--    abriram. Só o professor (eh_perfil_admin, role = 'admin' literal) fica
--    fora, porque é quem conserta base.
--
-- 2. Movimentação de estoque direta aceitava qualquer setor da filial
--    (mov_insert só olhava a filial): um aluno de Vendas ou RH dava entrada ou
--    saída de mercadoria. Passa a ser Estoque/Logística e o gerente da filial,
--    a mesma régua de mov_update/mov_delete. Nada do resto muda: venda,
--    requisição de material, inventário, expedição, devolução e a entrada do
--    recebimento são RPCs SECURITY DEFINER do postgres (ignoram RLS). O Modo
--    Aula entra sozinho — auth_user_setores() já soma o setor da aula. Os dois
--    caminhos diretos que sobram (saldo de abertura no cadastro/importação de
--    produto e a PWA antiga do Recebimentos) são de Logística/gerente.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

-- ═══ 1. Segregação sem exceção para aluno ══════════════════════════════════

CREATE OR REPLACE FUNCTION public.decidir_requisicao_compra(p_aprovacao_id uuid, p_decisao text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ap          record;
  v_req         record;
  v_canceladas  integer := 0;
  v_setor       text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_decisao NOT IN ('Aprovado', 'Negado') THEN
    RAISE EXCEPTION 'Decisão inválida: use Aprovado ou Negado.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decisao = 'Negado' AND COALESCE(trim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Negar exige justificativa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_compras
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%).', v_ap.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = v_ap.requisicao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status = 'Em correção' THEN
    RAISE EXCEPTION
      'Esta requisição está com % para correção — espere o reenvio, ou peça à direção para reabri-la. Decidir agora ignoraria o que ele está consertando.',
      COALESCE(v_req.solicitante, 'o solicitante')
      USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 643: "quem abre não aprova" vale para todo aluno, CEO e conselheiro
  -- inclusive — antes o auth_is_admin() os tirava da regra. A Matriz segue
  -- decidindo o que OUTROS abriram; só o professor fica fora.
  IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid()
     AND NOT public.eh_perfil_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Quem abre a requisição não a aprova. A decisão é de outra pessoa: o gerente da filial ou a Matriz.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.auth_is_admin(), false)
     AND NOT COALESCE(public.auth_gerente_da(v_req.filial), false) THEN
    RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) decide requisição de compra.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.aprovacoes_compras
     SET status     = p_decisao,
         observacao = COALESCE(p_observacao, ''),
         aprovador  = COALESCE(
           (SELECT nome FROM public.user_profiles WHERE id = auth.uid()),
           aprovador)
   WHERE id = p_aprovacao_id;

  UPDATE public.requisicoes
     SET status = p_decisao
   WHERE id = v_req.id;

  IF p_decisao = 'Negado' THEN
    WITH canceladas AS (
      UPDATE public.cotacoes c
         SET status = 'Cancelado'
       WHERE c.requisicao_id = v_req.id
         AND COALESCE(c.ativo, true)
         AND c.status IN ('Aguardando Financeiro', 'Aprovado')
         AND NOT EXISTS (
           SELECT 1 FROM public.pedidos p
            WHERE p.cotacao_id = c.id AND COALESCE(p.ativo, true))
      RETURNING 1
    )
    SELECT count(*) INTO v_canceladas FROM canceladas;
  END IF;

  v_setor := lower(COALESCE(v_req.setor_solicitante, ''));
  IF v_setor IN ('empresa','compras','estoque','financeiro','rh','vendas',
                 'marketing','logistica','ti','gerencia') THEN
    PERFORM public.notificar_setor(
      v_setor,
      CASE WHEN p_decisao = 'Aprovado' THEN 'aprovado' ELSE 'reprovado' END,
      CASE WHEN p_decisao = 'Aprovado' THEN 'Requisição aprovada' ELSE 'Requisição negada' END,
      COALESCE(v_req.numero, 'Requisição') || ' — ' || COALESCE(v_req.item, 'item'),
      'requisicoes-dosetor',
      'Média',
      v_req.id,
      NULLIF(trim(p_observacao), ''),
      v_req.filial
    );
  END IF;

  IF v_canceladas > 0 THEN
    PERFORM public.notificar_setor(
      'compras',
      'info',
      'Cotação cancelada — requisição negada',
      COALESCE(v_req.numero, 'Requisição') || ' — ' || COALESCE(v_req.item, 'item')
        || ' · ' || v_canceladas || ' cotação(ões) cancelada(s)',
      'compras-cotações',
      'Média',
      v_req.id,
      NULL,
      v_req.filial
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_decisao,
    'requisicao_id', v_req.id,
    'cotacoes_canceladas', v_canceladas
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.requisicao_decisao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só a transição de decisão é gate. Demais updates seguem a policy.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- MIGR 642: Atendida → Aprovado não é decisão do gerente — é a requisição
  -- voltando à fila porque o pedido dela foi cancelado (cancelar_pedido_compra
  -- faz exatamente isto). Sem esta saída o guard recusava o cancelamento para
  -- quem compra, e nenhum pedido chegou a ser cancelado nas 4 turmas. Vale só
  -- quando não resta pedido vivo: a regra é o fato, não o cargo de quem grava.
  IF OLD.status = 'Atendida' AND NEW.status = 'Aprovado'
     AND NOT EXISTS (
       SELECT 1 FROM public.pedidos p
        WHERE p.requisicao_id = NEW.id
          AND COALESCE(p.ativo, true)
          AND p.status <> 'Cancelado'
     ) THEN
    RETURN NEW;
  END IF;

  -- MIGR 643: a regra de segregação vem ANTES da passagem da Matriz — CEO e
  -- conselheiro também não decidem o que eles mesmos abriram.
  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid()
     AND NOT public.eh_perfil_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Quem abre a requisição não a aprova. A decisão é de outra pessoa: o gerente da filial ou a Matriz.'
      USING ERRCODE = '42501';
  END IF;

  IF public.auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT COALESCE(public.auth_gerente_da(NEW.filial), false) THEN
    RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) decide requisição de compra.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cotacao_decisao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limite numeric;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND 'Em correção' IN (NEW.status, OLD.status)
     AND NEW.status <> 'Cancelado'
     AND COALESCE(current_setting('app.cotacao_correcao', true), '') <> 'true'
     AND NOT EXISTS (
       SELECT 1 FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND (p.role IN ('admin', 'ceo', 'conselheiro')
               OR (p.role = 'gerente' AND p.is_conselheiro = true))
     ) THEN
    RAISE EXCEPTION 'Devolver para correção e reenviar passam pelas ações da tela de Cotações.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'Em correção'
     AND (NEW.valor_total IS DISTINCT FROM OLD.valor_total
          OR NEW.prazo_entrega IS DISTINCT FROM OLD.prazo_entrega)
     AND COALESCE(current_setting('app.cotacao_correcao', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Use "Corrigir e reenviar" para alterar a proposta devolvida.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Aprovado', 'Negado') THEN
    RETURN NEW;
  END IF;

  -- MIGR 642: aprovar ou reprovar gravando o status direto pulava tudo o que
  -- decidir_cotacao cobra — validade viva, origem 'Aguardando Financeiro',
  -- quem aprovou e o cancelamento das outras propostas. Vale para todo cargo:
  -- o CEO também decide pelo botão. Só o professor passa (conserto de base).
  IF COALESCE(current_setting('app.cotacao_decisao', true), '') <> 'true'
     AND NOT public.eh_perfil_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Aprovar ou reprovar cotação é pelo botão da tela de Cotações — é lá que a validade da proposta é conferida e as propostas concorrentes são canceladas.'
      USING ERRCODE = '42501';
  END IF;

  -- MIGR 643: segregação antes da passagem da Matriz (CEO e conselheiro
  -- também não aprovam a proposta que cadastraram). Só o professor fica fora.
  IF OLD.criado_por IS NOT NULL AND OLD.criado_por = auth.uid()
     AND NOT public.eh_perfil_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Quem cadastra a proposta não a aprova.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = auth.uid()
       AND (p.role IN ('admin', 'ceo', 'conselheiro')
            OR (p.role = 'gerente' AND p.is_conselheiro = true))
  ) THEN
    RETURN NEW;
  END IF;

  SELECT valor_limite_financeiro INTO v_limite
    FROM public.alcadas_compra
   WHERE filial = NEW.filial AND COALESCE(ativo, true);

  IF v_limite IS NULL OR COALESCE(NEW.valor_total, 0) <= v_limite THEN
    IF NOT COALESCE(public.auth_in_setor('financeiro'), false) THEN
      RAISE EXCEPTION 'Dentro da alçada, quem decide a cotação é o Financeiro.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT COALESCE(public.auth_gerente_da(NEW.filial), false) THEN
      RAISE EXCEPTION 'Acima da alçada da filial, quem decide é o gerente (ou a Matriz).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recebimento_segregacao_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_autor uuid;
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Só o fechamento é gate; registrar recebimento parcial segue livre.
  IF NEW.status IS DISTINCT FROM 'Concluído' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Concluído' THEN
    RETURN NEW;
  END IF;

  SELECT criado_por INTO v_pedido_autor
    FROM public.pedidos WHERE id = NEW.pedido_id;

  IF v_pedido_autor IS NOT NULL
     AND v_pedido_autor = auth.uid()
     -- MIGR 643: eh_perfil_admin no lugar de auth_is_admin — CEO e
     -- conselheiro emitindo pedido também não conferem a própria carga.
     AND NOT (public.eh_perfil_admin(auth.uid())
              OR COALESCE(public.auth_gerente_da(NEW.filial), false)) THEN
    RAISE EXCEPTION 'Quem emitiu o pedido não confere o próprio recebimento. Peça ao gerente da filial para fechar.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ═══ 2. Movimentação direta é do Estoque ══════════════════════════════════

DROP POLICY IF EXISTS mov_insert ON public.movimentacoes_estoque;
CREATE POLICY mov_insert ON public.movimentacoes_estoque
  FOR INSERT TO authenticated
  WITH CHECK (COALESCE((( SELECT auth_in_setor(VARIADIC ARRAY['estoque'::text, 'logistica'::text]) AS auth_in_setor) OR ((( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text) AND (( SELECT auth_user_filial() AS auth_user_filial) = filial))), false) AND COALESCE((( SELECT auth_is_admin() AS auth_is_admin) OR (( SELECT auth_user_filial() AS auth_user_filial) = filial)), false));

NOTIFY pgrst, 'reload schema';
