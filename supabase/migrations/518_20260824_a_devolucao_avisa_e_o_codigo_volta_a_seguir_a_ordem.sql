-- 518_20260824_a_devolucao_avisa_e_o_codigo_volta_a_seguir_a_ordem.sql
--
-- Três correções apuradas na turma ERP no mesmo dia em que a 517 entrou.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A devolução não avisava ninguém — e por isso duplicava documento
-- ═══════════════════════════════════════════════════════════════════════════
-- Levantamento na ERP, 24/08: quatro requisições da TechMax abertas em
-- duplicata, uma delas em quádruplo. O padrão é sempre o mesmo — a devolvida
-- fica parada, e ~18 minutos depois nasce outra igual, com outro número:
--
--   Controle DualSense ×4 (0082 Negado 09:27, 0090 09:45, 0098 09:51, 0103)
--   Notebook IdeaPad   ×3 (0083 Em correção 09:27, 0092 09:45, 0106 09:56)
--   Controle para PC   ×3 (0081 Em correção 09:27, 0091 09:45, 0107 09:56)
--   Galaxy A07         ×2 (0079 Em correção 09:27, 0094 09:45)
--
-- Não é bug de renderização: no banco não há `numero` repetido nem aprovação
-- duplicada. São documentos NOVOS, abertos por quem não soube que o seu tinha
-- voltado. Realtime já estava ligado (as duas tabelas estão na publicação, e
-- as telas recarregam sozinhas) — mas realtime muda a lista de quem está com
-- AQUELA tela aberta; não chama ninguém.
--
-- `notificar_setor` dos dois lados, dentro das próprias RPCs: aviso que
-- depende de o cliente lembrar de disparar é aviso que falta justamente
-- quando a rede cai no meio.
--
-- ── Duas listas fixas tiveram de crescer ────────────────────────────────
-- `chk_notif_setor` não aceitava 'gerencia', que é o setor dos três gerentes.
-- Efeito colateral que isso já causava antes desta migração: gerente só
-- recebia notificação por `setores_extras` e por 'all' — nunca como quem
-- decide. E `chk_notif_tipo` não tinha o verbo desta ação.
--
-- Chamar a devolução de 'reprovado' seria desfazer, no sino, a distinção que
-- a 517 existe para ensinar: devolver NÃO é negar. Vide
-- [feedback_auditar_fluxo_antigo_nao_tocado] — lista fixa não avisa a função
-- antiga que nasceu uma categoria nova.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Campo em branco era ignorado em silêncio no reenvio
-- ═══════════════════════════════════════════════════════════════════════════
-- `COALESCE(NULLIF(trim(p_centro_custo), ''), centro_custo)` guarda o valor
-- antigo quando chega vazio. Quem escolhesse "Não informar" via a tela dizer
-- que deu certo e o valor continuava lá. Na SuperMax isso rodou em loop: a
-- mesma requisição reenviada duas vezes, devolvida duas vezes, e a trilha de
-- auditoria sem NENHUMA alteração de `centro_custo` registrada.
--
-- Centro de custo e justificativa passam a aceitar o branco como "limpar".
-- Unidade e urgência continuam com fallback: são `<select>` de lista fechada,
-- onde vazio não é escolha, é falha de preenchimento do cliente.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. O código do produto parava de seguir a ordem
-- ═══════════════════════════════════════════════════════════════════════════
-- TechMax tinha 002, 006, 011, 012, 015, 016, 017, 019, 020, 023 — e o 001
-- nunca existiu. Não é aleatório: `reservar_codigo_produto` (migr. 481) parte
-- de `GREATEST(max(produtos), max(reservas))` e só anda para frente. Todo
-- formulário aberto e abandonado queima um número para sempre, porque a
-- reserva expira e ninguém volta para trás. Com turma cheia clicando "Gerar",
-- o 001 se perde no primeiro abandono.
--
-- Agora procura o PRIMEIRO livre a partir de 001. Um cuidado que a versão
-- ingênua não teria: pular também o código de produto INATIVO. O índice único
-- é parcial (`WHERE ativo`), então o banco deixaria reusar o código de um item
-- da lixeira — e aí dois produtos diferentes dividiriam o mesmo código no
-- histórico de compras, estoque e DRE.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1a. As listas fixas de `notificacoes`
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notificacoes DROP CONSTRAINT IF EXISTS chk_notif_setor;
ALTER TABLE public.notificacoes
  ADD CONSTRAINT chk_notif_setor CHECK (setor = ANY (ARRAY[
    'empresa', 'compras', 'estoque', 'financeiro', 'rh', 'vendas',
    'marketing', 'logistica', 'ti', 'gerencia', 'all'
  ]));

ALTER TABLE public.notificacoes DROP CONSTRAINT IF EXISTS chk_notif_tipo;
ALTER TABLE public.notificacoes
  ADD CONSTRAINT chk_notif_tipo CHECK (tipo = ANY (ARRAY[
    'aprovacao_pendente', 'aprovado', 'reprovado', 'mensagem_setor',
    'tarefa_atribuida', 'tarefa_concluida', 'ti_chamado', 'ti_resolvido',
    'info', 'treinamento_atribuido', 'briefing_diario', 'justificativa_falta',
    'devolvido_correcao'
  ]));

-- ────────────────────────────────────────────────────────────────────────────
-- 1b. Devolver passa a avisar quem abriu
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_requisicao_para_correcao(
  p_aprovacao_id uuid,
  p_motivo       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ap    record;
  v_req   record;
  v_setor text;
BEGIN
  PERFORM public._assert_rpc();

  -- Devolver sem dizer o que está errado é negar com outro nome: o aluno
  -- reenviaria o mesmo documento, e o gerente devolveria de novo.
  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser corrigido — é isso que o solicitante vai ler.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ap FROM public.aprovacoes_compras
   WHERE id = p_aprovacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aprovação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ap.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Esta requisição já foi decidida (%). Para desfazer a decisão, quem reabre é a direção.',
      v_ap.status USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.requisicoes
   WHERE id = v_ap.requisicao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisição não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status = 'Em correção' THEN
    RAISE EXCEPTION 'Esta requisição já está com o solicitante, esperando correção.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Mesma autoridade de `decidir_requisicao_compra` (migr. 282): devolver é ato
  -- de quem decide. Se o autor pudesse devolver a própria requisição, teria
  -- achado o caminho para editá-la sem passar pelo gerente.
  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF v_req.criado_por IS NOT NULL AND v_req.criado_por = auth.uid() THEN
      RAISE EXCEPTION 'Quem abre a requisição não a devolve. Quem decide é o gerente da filial.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.auth_gerente_da(v_req.filial), false) THEN
      RAISE EXCEPTION 'Só o gerente da filial (ou a Matriz) devolve requisição de compra.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.requisicoes
     SET status                  = 'Em correção',
         correcao_motivo         = trim(p_motivo),
         correcao_solicitada_em  = now(),
         correcao_solicitada_por = auth.uid()
   WHERE id = v_req.id;

  -- MIGR 518: o aviso. Sem ele o aluno não sabia que o documento voltou, achava
  -- que tinha travado, e abria outra requisição igual.
  --
  -- `setor_solicitante` é o destinatário certo: a requisição é do SETOR, e a
  -- lista "Do Setor" é do setor inteiro. Notificação é por setor, não por
  -- pessoa. O IN protege a CHECK de setor — requisição antiga pode ter setor
  -- nulo ou fora da lista, e um aviso não pode derrubar a devolução.
  v_setor := lower(COALESCE(v_req.setor_solicitante, ''));
  IF v_setor IN ('empresa','compras','estoque','financeiro','rh','vendas',
                 'marketing','logistica','ti','gerencia') THEN
    PERFORM public.notificar_setor(
      v_setor,
      'devolvido_correcao',
      'Requisição devolvida para correção',
      COALESCE(v_req.numero, 'Requisição') || ' — ' || COALESCE(v_req.item, 'item'),
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

REVOKE ALL ON FUNCTION public.devolver_requisicao_para_correcao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolver_requisicao_para_correcao(uuid, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 1c + 2. Reenviar avisa o gerente, e branco passa a limpar
-- ────────────────────────────────────────────────────────────────────────────
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
         correcao_solicitada_por = NULL
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

REVOKE ALL ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reenviar_requisicao_corrigida(uuid, text, numeric, text, text, text, text, date) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. O código volta a seguir a ordem
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservar_codigo_produto(p_filial text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seq    integer;
  v_codigo text;
BEGIN
  -- Sem lista de setor: quem pode INSERT em produtos é a policy write_produtos
  -- (migr. 169) que decide, e tirar um número não cria nada. O _assert_rpc aqui
  -- cobre o resto — não autenticado, desligado, apagão simulado.
  PERFORM public._assert_rpc();

  -- COALESCE: NULL não vira permissão.
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Você não cadastra produto na unidade %.', p_filial
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('produtos_codigo_reserva'), hashtext(p_filial));

  -- Só a desta filial: o lock é por filial, e sair varrendo a tabela inteira
  -- faria duas unidades esperarem uma pela outra sem precisar. O vencido das
  -- outras cai quando alguém reservar lá.
  DELETE FROM public.produtos_codigo_reserva
   WHERE filial = p_filial AND expira_em <= now();

  -- Antes da conta, e não depois: assim reclicar "Gerar" devolve o mesmo número
  -- em vez de subir um a cada clique.
  DELETE FROM public.produtos_codigo_reserva
   WHERE filial = p_filial AND usuario_id = auth.uid();

  -- MIGR 518: começa do 001, e não do maior já usado.
  --
  -- A versão da 481 partia de `GREATEST(max(produtos), max(reservas))` e só
  -- andava para frente — então todo formulário aberto e abandonado queimava um
  -- número para sempre. A TechMax chegou a 002, 006, 011, 012, 015... sem nunca
  -- ter tido um 001. Numa turma cheia clicando "Gerar", isso é a regra.
  --
  -- O laço já pulava o ocupado; o que mudou foi de onde ele parte.
  v_seq := 0;

  -- O max() da versão anterior era numérico e o catálogo herdado tem código com
  -- letra ("ML-004"), em que a parte numérica repete. O laço confere o TEXTO
  -- montado, que é o que o índice único de produtos vê.
  --
  -- `p.ativo` saiu da condição de propósito: o índice único é PARCIAL
  -- (`WHERE ativo`), então o banco deixaria reusar o código de um produto na
  -- lixeira. Preenchendo buracos isso deixaria de ser hipótese — e dois
  -- produtos diferentes dividiriam o mesmo código no histórico de compras,
  -- estoque e DRE.
  LOOP
    v_seq := v_seq + 1;
    v_codigo := lpad(v_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.produtos p
                 WHERE p.filial = p_filial AND p.codigo = v_codigo)
         AND NOT EXISTS (
                SELECT 1 FROM public.produtos_codigo_reserva r
                 WHERE r.filial = p_filial AND r.codigo = v_codigo);
  END LOOP;

  INSERT INTO public.produtos_codigo_reserva (filial, codigo, codigo_seq, usuario_id)
  VALUES (p_filial, v_codigo, v_seq, auth.uid());

  RETURN v_codigo;
END;
$function$;

COMMIT;

-- ── Conferência ─────────────────────────────────────────────────────────────
--   -- o próximo código de cada unidade passa a ser o primeiro buraco:
--   SELECT filial, count(*), min(codigo_seq), max(codigo_seq)
--     FROM produtos WHERE filial IS NOT NULL GROUP BY 1;
--   SELECT * FROM produtos_codigo_reserva ORDER BY filial, codigo_seq;
--   NOTIFY pgrst, 'reload schema';
