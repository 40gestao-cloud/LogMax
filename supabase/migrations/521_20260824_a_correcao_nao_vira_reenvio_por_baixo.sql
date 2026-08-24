-- 521 — Quatro correções apuradas na auditoria do fluxo de Requisições/Aprovações.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Reabrir uma devolvida virava "corrigida e reenviada" (regressão da 520)
-- ═══════════════════════════════════════════════════════════════════════════
-- `trg_requisicao_marca_reenvio` carimbava `reenviada_em` em QUALQUER
-- transição `Em correção → Pendente` — e `reabrir_requisicao` (ato da
-- direção, migr. 330) faz exatamente essa transição, sem o aluno ter tocado
-- no documento. O gerente recebia o modal "Requisição corrigida e
-- reenviada" (migr. 520), ia decidir, e o texto continuava o mesmo que ele
-- mandara corrigir — ninguém corrigiu nada.
--
-- Verificado em transação revertida antes desta migração: reabrir uma
-- requisição `Em correção` gravava `reenviada_em = now()`.
--
-- A marcação sai do gatilho — que passa a fazer só a metade que é sempre
-- verdade (devolvida de novo apaga a marca anterior) — e vai para dentro de
-- cada RPC, que sabe de fato quem fez o quê:
--   `reenviar_requisicao_corrigida` grava `reenviada_em = now()`
--   `reabrir_requisicao`            grava `reenviada_em = NULL`
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Dava para decidir por baixo de quem está corrigindo
-- ═══════════════════════════════════════════════════════════════════════════
-- `decidir_requisicao_compra` validava `v_ap.status = 'Pendente'` mas nunca
-- olhava `v_req.status`. A aprovação continua 'Pendente' enquanto a
-- requisição está 'Em correção' (a devolução não mexe na aprovação — só na
-- requisição), então aprovar ou negar um documento que está com o aluno era
-- aceito pelo banco. `devolver_requisicao_para_correcao` já tinha a guarda
-- simétrica; faltava aqui.
--
-- Hoje a tela esconde os botões nesse estado, o que torna o buraco
-- invisível — e frágil: qualquer outra porta (Matriz, correção manual,
-- tela futura) fura. Se furar, o reenvio seguinte falha com "só requisição
-- devolvida pode ser reenviada" e o texto corrigido do aluno morre no
-- formulário, porque a requisição já saiu de 'Em correção'.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. A decisão não avisava ninguém
-- ═══════════════════════════════════════════════════════════════════════════
-- Cotação avisa "aprovada pelo Financeiro" / "reprovada" (34 + 3 ocorrências
-- na LogMax-ERP). Requisição só avisava devolução e reenvio (a 518
-- acrescentou). Quem abriu descobria que foi aprovado ou negado abrindo a
-- tela e reparando na cor. A cascata do Negado (cotações canceladas) também
-- não avisava Compras.
--
-- `notificar_setor` para o setor de quem abriu, tipo 'aprovado'/'reprovado'
-- (a CHECK já aceita os dois — cotação já usa). A observação do gerente vai
-- no corpo; para 'reprovado' ela é obrigatória de qualquer forma
-- (`chk_notif_motivo`), e a RPC já exige justificativa para negar. Segundo
-- aviso para 'compras' quando a cascata cancelou cotação viva.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Aprovação órfã de material (mesmo buraco da 519, ainda não disparado)
-- ═══════════════════════════════════════════════════════════════════════════
-- A 519 fez o soft-delete de `requisicoes` levar `aprovacoes_compras`
-- junto. `requisicoes_estoque` tem o mesmo desenho — soft-delete
-- (`ativo`), FK `ON DELETE CASCADE` (só vale no hard delete) e a tela tem
-- `ExcluirAdmin` apontando para `/api/requisicoesestoqueview`. Hoje há
-- zero órfãs porque ninguém usou o botão ainda; o primeiro uso reproduz o
-- card que volta depois de "excluído".

BEGIN;

-- ── 1. O gatilho fica só com a limpeza ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.requisicao_marca_reenvio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Devolvida de novo: a volta anterior deixa de valer, senão o gerente
  -- continuaria vendo "corrigida e reenviada" no que está com o aluno outra
  -- vez. Quem marca o reenvio de verdade agora é `reenviar_requisicao_corrigida`
  -- — este gatilho não sabe distinguir reenvio de reabertura, e por isso
  -- parou de tentar.
  IF NEW.status = 'Em correção' AND OLD.status IS DISTINCT FROM 'Em correção' THEN
    NEW.reenviada_em := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.requisicao_marca_reenvio() IS
  'Migr. 521. Só limpa reenviada_em ao devolver de novo. Quem marca o reenvio é reenviar_requisicao_corrigida; reabrir_requisicao zera explicitamente.';

-- ── 2. Reenviar marca o instante; reabrir zera ──────────────────────────────
CREATE OR REPLACE FUNCTION public.reenviar_requisicao_corrigida(
  p_id               uuid,
  p_item             text,
  p_qtd              numeric,
  p_unidade          text DEFAULT NULL,
  p_justificativa    text DEFAULT NULL,
  p_urgencia         text DEFAULT NULL,
  p_centro_custo     text DEFAULT NULL,
  p_data_necessidade date DEFAULT NULL
)
RETURNS public.requisicoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.requisicoes;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = p_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  -- Só o documento devolvido se reenvia. Fora de 'Em correção' isto seria porta
  -- lateral para reescrever requisição pendente ou já aprovada.
  IF v_req.status <> 'Em correção' THEN
    RAISE EXCEPTION 'Só requisição devolvida para correção pode ser reenviada (esta está %).',
      v_req.status USING ERRCODE = 'P0001';
  END IF;

  -- Quem corrige é quem fez. Gerente e Matriz entram junto porque são eles que
  -- destravam o aluno que faltou na aula seguinte.
  IF NOT COALESCE(public.auth_is_admin(), false)
     AND NOT COALESCE(public.auth_gerente_da(v_req.filial), false)
     AND COALESCE(v_req.criado_por, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid() THEN
    RAISE EXCEPTION 'Quem corrige a requisição é quem a abriu.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(trim(p_item), '') = '' THEN
    RAISE EXCEPTION 'O item não pode ficar em branco.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade tem de ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  -- MIGR 518: centro de custo e justificativa aceitam BRANCO como "limpar".
  -- Antes o branco caía no COALESCE e o valor antigo ficava — a tela dizia que
  -- deu certo, o gerente via o mesmo valor de sempre e devolvia de novo.
  --
  -- Unidade e urgência mantêm o fallback: são `<select>` de lista fechada, em
  -- que vazio não é escolha do usuário, é falha de preenchimento do cliente —
  -- e apagar a unidade quebraria a régua de fracionário no resto do fluxo.
  --
  -- `produto_id`, `servico_id`, `tipo_requisicao`, `setor_solicitante` e
  -- `filial` seguem de fora: corrigir é consertar o que foi pedido, não trocar
  -- o documento por outro.
  --
  -- MIGR 521: `reenviada_em` gravado aqui, explícito — é este UPDATE que sabe
  -- que houve reenvio de verdade, e não uma reabertura da direção por baixo.
  UPDATE public.requisicoes
     SET item                    = trim(p_item),
         qtd                     = p_qtd,
         unidade                 = COALESCE(NULLIF(trim(COALESCE(p_unidade, '')), ''), unidade),
         urgencia                = COALESCE(NULLIF(trim(COALESCE(p_urgencia, '')), ''), urgencia),
         justificativa           = NULLIF(trim(COALESCE(p_justificativa, '')), ''),
         centro_custo            = NULLIF(trim(COALESCE(p_centro_custo, '')), ''),
         data_necessidade        = COALESCE(p_data_necessidade, data_necessidade),
         status                  = 'Pendente',
         correcao_motivo         = NULL,
         correcao_solicitada_em  = NULL,
         correcao_solicitada_por = NULL,
         reenviada_em            = now()
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  -- MIGR 518: o outro lado do aviso. 'gerencia' é o setor dos três gerentes —
  -- e até esta migração a CHECK nem aceitava esse valor, então quem decide
  -- nunca tinha sido destinatário de notificação nenhuma.
  PERFORM public.notificar_setor(
    'gerencia',
    'aprovacao_pendente',
    'Requisição corrigida e reenviada',
    COALESCE(v_req.numero, 'Requisição') || ' — ' || COALESCE(v_req.item, 'item')
      || ' · ' || trim(to_char(v_req.qtd, 'FM999999990.999')) || ' ' || COALESCE(v_req.unidade, ''),
    'requisicoes-aprovações',
    'Média',
    v_req.id,
    NULL,
    v_req.filial
  );

  RETURN v_req;
END;
$function$;

COMMENT ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date) IS
  'Migr. 518/521. Reenvia o documento devolvido; grava reenviada_em explicitamente (migr. 521) — o gatilho não marca mais.';

CREATE OR REPLACE FUNCTION public.reabrir_requisicao(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req      public.requisicoes;
  v_nome     text;
  v_ap_id    uuid;
  v_pedido   text;
  v_restaura boolean;
BEGIN
  PERFORM public._assert_rpc();

  -- Reabrir desfaz decisão de gerente e, às vezes, exclusão. É ato de direção.
  IF NOT (public.auth_is_admin() OR public.auth_user_role() IN ('ceo', 'conselheiro')) THEN
    RAISE EXCEPTION 'Só a direção reabre uma requisição.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Pedido vivo é compra em andamento: reabrir por baixo dele faria a
  -- requisição dizer uma coisa e o pedido outra, com a conta a pagar já criada.
  SELECT COALESCE(p.numero, upper(right(p.id::text, 6))) INTO v_pedido
    FROM public.pedidos p
   WHERE p.requisicao_id = v_req.id AND COALESCE(p.ativo, true)
   LIMIT 1;

  IF v_pedido IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta requisição já virou o pedido %. Inative o pedido antes de reabri-la — a conta a pagar dele também precisa ser resolvida.',
      v_pedido
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cotacoes c
              WHERE c.requisicao_id = v_req.id AND COALESCE(c.ativo, true)
                AND c.status IN ('Aguardando Financeiro', 'Aprovado')) THEN
    RAISE EXCEPTION
      'Existe cotação em andamento para esta requisição. Cancele a cotação antes de reabrir.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();
  v_restaura := NOT COALESCE(v_req.ativo, true);

  -- MIGR 521: `reenviada_em` zerado aqui, explícito. Reabrir é a direção
  -- desfazendo uma decisão — não é o aluno tendo corrigido nada — e não pode
  -- disparar o modal "corrigida e reenviada" do lado do gerente.
  UPDATE public.requisicoes
     SET status       = 'Pendente',
         ativo        = true,
         reenviada_em = NULL
   WHERE id = v_req.id
  RETURNING * INTO v_req;

  -- A aprovação volta para a fila do gerente. Sem isto a requisição ficaria
  -- 'Pendente' sem card em Aprovações — travada, que é o defeito que a 331
  -- ajudou a encontrar e a 330 a evitar.
  SELECT id INTO v_ap_id FROM public.aprovacoes_compras
   WHERE requisicao_id = v_req.id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_ap_id IS NULL THEN
    INSERT INTO public.aprovacoes_compras (requisicao_id, status, filial)
    VALUES (v_req.id, 'Pendente', v_req.filial);
  ELSE
    UPDATE public.aprovacoes_compras
       SET status     = 'Pendente',
           aprovador  = NULL,
           observacao = format('Reaberta por %s%s.',
                               COALESCE(v_nome, 'direção'),
                               COALESCE(' — ' || NULLIF(trim(p_motivo), ''), ''))
     WHERE id = v_ap_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurada', v_restaura,
    'requisicao', to_jsonb(v_req)
  );
END;
$function$;

COMMENT ON FUNCTION public.reabrir_requisicao(uuid, text) IS
  'Migr. 330/521. Direção desfaz decisão ou exclusão; zera reenviada_em explicitamente para não disparar o modal de "corrigida e reenviada".';

-- ── 3. Decidir recusa requisição que está com o solicitante, e avisa ───────
CREATE OR REPLACE FUNCTION public.decidir_requisicao_compra(
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

  -- MIGR 521: a aprovação continua 'Pendente' enquanto a requisição está
  -- 'Em correção' — devolver não mexe na aprovação, só na requisição. Sem
  -- esta guarda, decidir por baixo de quem está corrigindo era aceito: o
  -- texto que o aluno estava consertando virava aprovado ou negado do jeito
  -- que estava antes de ser devolvido.
  IF v_req.status = 'Em correção' THEN
    RAISE EXCEPTION
      'Esta requisição está com % para correção — espere o reenvio, ou peça à direção para reabri-la. Decidir agora ignoraria o que ele está consertando.',
      COALESCE(v_req.solicitante, 'o solicitante')
      USING ERRCODE = 'P0001';
  END IF;

  -- Autoridade: gerente da filial da requisição, ou Matriz. Nunca o autor.
  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem abre a requisição não a aprova. A decisão é do gerente da filial.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.auth_gerente_da(v_req.filial), false) THEN
      RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) decide requisição de compra.'
        USING ERRCODE = '42501';
    END IF;
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

  -- Cascata do Negado: cotação viva de requisição negada não pode seguir
  -- para o Financeiro. A que já virou pedido fica — ali há compromisso com o
  -- fornecedor, e quem desfaz é o Pedidos.
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

  -- MIGR 521: quem abriu descobria a decisão abrindo a tela e reparando na
  -- cor. Cotação já avisa "aprovada"/"reprovada" pelo Financeiro; requisição
  -- só avisava devolução e reenvio. Setor validado contra a mesma lista fixa
  -- da 518 — requisição antiga pode ter setor nulo ou fora da lista, e um
  -- aviso não pode derrubar a decisão.
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

  -- Cascata cancelou cotação viva: Compras estava trabalhando nela e precisa
  -- saber que parou, sem ter de descobrir abrindo Cotações por acaso.
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

COMMENT ON FUNCTION public.decidir_requisicao_compra(uuid, text, text) IS
  'Migr. 282/521. Recusa decidir requisição Em correção; notifica o setor do solicitante e, na cascata do Negado, Compras.';

-- ── 4. A aprovação de material segue a requisição excluída ─────────────────
CREATE OR REPLACE FUNCTION public.aprovacao_estoque_segue_a_requisicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true) THEN
    DELETE FROM public.aprovacoes_estoque WHERE requisicao_estoque_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.aprovacao_estoque_segue_a_requisicao() IS
  'Migr. 521 (espelha a 519). Soft-delete de requisição de material leva a aprovação junto.';

DROP TRIGGER IF EXISTS trg_aprovacao_estoque_segue_requisicao ON public.requisicoes_estoque;
CREATE TRIGGER trg_aprovacao_estoque_segue_requisicao
  AFTER UPDATE ON public.requisicoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.aprovacao_estoque_segue_a_requisicao();

DELETE FROM public.aprovacoes_estoque a
 WHERE NOT EXISTS (
   SELECT 1 FROM public.requisicoes_estoque r
    WHERE r.id = a.requisicao_estoque_id AND COALESCE(r.ativo, true)
 );

COMMIT;
