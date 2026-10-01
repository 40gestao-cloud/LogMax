-- 668_20260930_mesa_do_gestor_completa.sql
--
-- Segunda volta da Mesa do Gestor (667), tudo o que ficou de fora:
--
-- 1. Quem decidiu e quando, nas aprovações de compra e de material.
--    `aprovacoes_compras`/`aprovacoes_estoque` guardavam só o NOME em
--    `aprovador` e nenhuma hora — o "Resolvido" da mesa comparava texto e
--    usava a hora da requisição. Ganham `decidido_por`/`decidido_em`,
--    carimbados por gatilho na saída de 'Pendente' (vale para qualquer porta:
--    as duas telas de aprovação e as RPCs). O carimbo não aceita valor do
--    cliente: fora da transição, o gatilho devolve o que já estava gravado.
--    Linha antiga fica NULL e a mesa cai no nome, como antes.
--
-- 2. Filas novas na `minha_mesa`:
--    · contrato para assinar ou rascunho meu (623 — mesma régua do
--      `contrato_representa`: filial = gerente dela, Matriz = admin);
--    · férias solicitadas (o gerente opera o RH da unidade);
--    · requerimento esperando a Matriz (admin/CEO/conselheiro respondem);
--    · venda parada depois da aprovação: orçamento sem pedido, pedido de
--      venda a separar e a receber — coluna equipe;
--    · candidato parado numa etapa do recrutamento — coluna equipe.
--    Cartão de tela que só abre na Matriz leva `modo = 'matriz'`.
--
-- 3. `contar_minha_mesa`: só o número da coluna "Precisa de mim", para o
--    item do menu. A tela chama ao abrir, ao trocar de unidade e no foco
--    (no máximo a cada 2 min) — NUNCA por realtime (15/09).
--
-- 4. `mesa_anotacoes`: a Fase 2 — cartões livres do gestor (a fazer /
--    fazendo / feito). Tabela própria, e não a `tarefas`: anotação é
--    PRIVADA de quem escreve, e a `tarefas` é lida por setor e pelo admin —
--    pôr ali exporia a anotação do gerente. RLS só a própria linha.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Carimbo da decisão nas aprovações
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.aprovacoes_compras ADD COLUMN IF NOT EXISTS decidido_por uuid;
ALTER TABLE public.aprovacoes_compras ADD COLUMN IF NOT EXISTS decidido_em  timestamptz;
ALTER TABLE public.aprovacoes_estoque ADD COLUMN IF NOT EXISTS decidido_por uuid;
ALTER TABLE public.aprovacoes_estoque ADD COLUMN IF NOT EXISTS decidido_em  timestamptz;

COMMENT ON COLUMN public.aprovacoes_compras.decidido_por IS 'Quem tirou de Pendente (migr. 668). Carimbado por gatilho; NULL em decisão anterior à 668.';
COMMENT ON COLUMN public.aprovacoes_estoque.decidido_por IS 'Quem tirou de Pendente (migr. 668). Carimbado por gatilho; NULL em decisão anterior à 668.';

CREATE OR REPLACE FUNCTION public.fn_aprovacao_carimba_decisao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Nasce sem decisão; o carimbo não vem do cliente.
    IF COALESCE(NEW.status, 'Pendente') = 'Pendente' THEN
      NEW.decidido_por := NULL;
      NEW.decidido_em  := NULL;
    ELSE
      NEW.decidido_por := auth.uid();
      NEW.decidido_em  := now();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'Pendente' AND NEW.status IS DISTINCT FROM 'Pendente' THEN
    NEW.decidido_por := auth.uid();
    NEW.decidido_em  := now();
  ELSIF NEW.status = 'Pendente' THEN
    -- Voltou para a fila (reenvio depois de devolução): decisão em aberto.
    NEW.decidido_por := NULL;
    NEW.decidido_em  := NULL;
  ELSE
    NEW.decidido_por := OLD.decidido_por;
    NEW.decidido_em  := OLD.decidido_em;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aprovacao_carimba_decisao ON public.aprovacoes_compras;
CREATE TRIGGER trg_aprovacao_carimba_decisao BEFORE INSERT OR UPDATE ON public.aprovacoes_compras
  FOR EACH ROW EXECUTE FUNCTION public.fn_aprovacao_carimba_decisao();
DROP TRIGGER IF EXISTS trg_aprovacao_carimba_decisao ON public.aprovacoes_estoque;
CREATE TRIGGER trg_aprovacao_carimba_decisao BEFORE INSERT OR UPDATE ON public.aprovacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_aprovacao_carimba_decisao();

-- ════════════════════════════════════════════════════════════════════════════
-- 2) minha_mesa com as filas novas
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.minha_mesa(p_filial text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_nome   text;
  v_minha  text;
  v_escopo text;
  v_hoje   date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_desde  timestamptz := now() - interval '7 days';
  v_cards  jsonb := '[]'::jsonb;
BEGIN
  v_role := public.auth_user_role();
  IF v_uid IS NULL OR COALESCE(v_role, '') NOT IN ('admin', 'ceo', 'conselheiro', 'gerente') THEN
    RAISE EXCEPTION 'A Mesa do Gestor é de admin, CEO, conselheiro e gerente.' USING ERRCODE = '42501';
  END IF;
  SELECT u.nome INTO v_nome FROM public.user_profiles u WHERE u.id = v_uid;

  IF v_role = 'gerente' THEN
    v_minha := public.auth_user_filial();
    IF COALESCE(v_minha, '') = '' THEN
      RAISE EXCEPTION 'Sua conta não está alocada em nenhuma unidade — fale com o professor.' USING ERRCODE = '42501';
    END IF;
    IF p_filial IS NOT NULL AND p_filial <> v_minha THEN
      RAISE EXCEPTION 'O gerente vê a mesa da própria unidade (%).', v_minha USING ERRCODE = '42501';
    END IF;
    v_escopo := v_minha;
  ELSE
    v_escopo := NULLIF(p_filial, '');
  END IF;

  -- ── 1. Filas do fluxo (listar_pendencias): admin e gerente ──────────────
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna',       CASE WHEN v_role = 'gerente' AND lp.responsavel_papel = 'Gerente da unidade'
                                  THEN 'mim' ELSE 'equipe' END,
             'area',         lp.area,
             'etapa',        lp.etapa,
             'documento',    lp.documento,
             'documento_id', lp.documento_id,
             'filial',       lp.filial,
             'onde',         lp.onde,
             'view',         CASE lp.onde
                               WHEN 'Requisições › Aprovações'             THEN 'requisicoes-aprovações'
                               WHEN 'Compras › Cotações'                   THEN 'compras-cotações'
                               WHEN 'Compras › Pedidos'                    THEN 'compras-pedidos'
                               WHEN 'Estoque › Recebimentos'               THEN 'estoque-recebimentos'
                               WHEN 'Financeiro › Aprovações de Cotação'   THEN 'financeiro-aprovaçõesdecotação'
                               WHEN 'Financeiro › Contas a Pagar'          THEN 'financeiro-contasapagar'
                               WHEN 'Financeiro › Contas a Receber'        THEN 'financeiro-contasareceber'
                               WHEN 'Financeiro › Controle de Caixa'       THEN 'financeiro-controledecaixa'
                               WHEN 'Financeiro › Aprovações de Orçamento' THEN 'financeiro-aprovaçõesdeorçamento'
                               WHEN 'Financeiro › Aprovações de Promoções' THEN 'financeiro-aprovaçõesdepromoções'
                               WHEN 'Financeiro › Aprovações de Conteúdo'  THEN 'financeiro-aprovaçõesdeconteúdo'
                             END,
             'acao',         lp.acao,
             'responsavel',  COALESCE(NULLIF(lp.responsavel, ''), lp.responsavel_papel),
             'valor',        lp.valor,
             'vencimento',   lp.vencimento,
             'dias_parado',  lp.dias_parado,
             'gravidade',    lp.gravidade)), '[]'::jsonb)
      INTO v_cards
      FROM public.listar_pendencias(v_escopo) lp
     WHERE lp.area NOT IN ('Financeiro')
        OR lp.etapa NOT LIKE 'Conta a % em aberto';
  END IF;

  -- ── 2. Material do almoxarifado: decisão do gerente ─────────────────────
  -- Não está no listar_pendencias; é a segunda metade da caixa Aprovações.
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', CASE WHEN v_role = 'gerente' THEN 'mim' ELSE 'equipe' END,
             'area', 'Estoque', 'etapa', 'Material do estoque aguardando aprovação',
             'documento', left(COALESCE(p.nome, 'material') || ' × ' || COALESCE(r.qtd::text, '?'), 60),
             'documento_id', r.id, 'filial', r.filial,
             'onde', 'Requisições › Aprovações', 'view', 'requisicoes-aprovações',
             'acao', 'Liberar ou negar', 'responsavel', 'Gerente da unidade',
             'dias_parado', GREATEST(0, v_hoje - (r.created_at AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (r.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                               WHEN v_hoje - (r.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                               ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.aprovacoes_estoque a
      JOIN public.requisicoes_estoque r ON r.id = a.requisicao_estoque_id
      LEFT JOIN public.produtos p ON p.id = r.produto_id
     WHERE a.status = 'Pendente' AND COALESCE(r.ativo, true) AND r.status = 'Pendente'
       AND (v_escopo IS NULL OR r.filial = v_escopo);
  END IF;

  -- ── 3. Promoção com parecer do Financeiro: decisão do gerente (576) ─────
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', CASE WHEN v_role = 'gerente' THEN 'mim' ELSE 'equipe' END,
             'area', 'Marketing', 'etapa', 'Promoção com parecer do Financeiro',
             'documento', left(COALESCE(mp.nome_produto, 'promoção'), 60),
             'documento_id', mp.id, 'filial', mp.filial,
             'onde', 'Marketing › Promoções', 'view', 'marketing-promoções',
             'acao', 'Aprovar ou negar a oferta', 'responsavel', 'Gerente da unidade',
             'valor', mp.preco_promocional,
             'dias_parado', GREATEST(0, v_hoje - (COALESCE(mp.analisado_em, mp.created_at) AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (COALESCE(mp.analisado_em, mp.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 2
                               THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.marketing_promocoes mp
     WHERE COALESCE(mp.ativo, true) AND mp.status = 'Em Análise'
       AND (v_escopo IS NULL OR mp.filial = v_escopo);
  END IF;

  -- ── 4. Justificativa de falta (650): gerente dá parecer, admin decide ───
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', CASE WHEN v_role = 'admin' THEN 'mim'
                            WHEN j.parecer_gerente IS NULL THEN 'mim'
                            ELSE 'equipe' END,
             'area', 'RH',
             'etapa', CASE WHEN v_role = 'admin' THEN 'Justificativa de falta para decidir'
                           WHEN j.parecer_gerente IS NULL THEN 'Justificativa de falta sem parecer'
                           ELSE 'Justificativa com parecer, aguardando o professor' END,
             'documento', left(COALESCE(j.nome_funcionario, '') || ' — ' || to_char(j.data, 'DD/MM'), 60),
             'documento_id', j.id, 'filial', j.filial,
             'onde', 'RH › Registro de Ponto › Justificativas', 'view', 'rh-registrodeponto',
             'acao', CASE WHEN v_role = 'admin' THEN 'Aceitar ou negar'
                          WHEN j.parecer_gerente IS NULL THEN 'Dar parecer'
                          ELSE 'Acompanhar' END,
             'responsavel', CASE WHEN v_role = 'gerente' AND j.parecer_gerente IS NOT NULL THEN 'Professor' ELSE NULL END,
             'dias_parado', GREATEST(0, v_hoje - (j.created_at AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (j.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2
                               THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.justificativas_falta j
     WHERE COALESCE(j.ativo, true) AND j.status = 'Pendente'
       AND (v_escopo IS NULL OR j.filial = v_escopo);
  END IF;

  -- ── 5. Desligamento solicitado (318): admin/CEO decidem ─────────────────
  SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
           'coluna', CASE WHEN v_role IN ('admin', 'ceo') THEN 'mim' ELSE 'equipe' END,
           'area', 'RH', 'etapa', 'Desligamento aguardando a Matriz',
           'documento', left(COALESCE(d.nome_funcionario, 'colaborador'), 60),
           'documento_id', d.id, 'filial', d.filial,
           'onde', 'RH › Desligamento', 'view', 'rh-desligamento',
           'acao', CASE WHEN v_role IN ('admin', 'ceo') THEN 'Aprovar ou recusar' ELSE 'Acompanhar' END,
           'responsavel', CASE WHEN v_role IN ('admin', 'ceo') THEN NULL ELSE 'Admin / CEO' END,
           'dias_parado', GREATEST(0, v_hoje - (d.created_at AT TIME ZONE 'America/Rio_Branco')::date),
           'gravidade', CASE WHEN v_hoje - (d.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2
                             THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
    INTO v_cards
    FROM public.demissoes d
   WHERE COALESCE(d.ativo, true) AND d.status = 'Solicitado'
     AND v_role IN ('admin', 'ceo', 'gerente')
     AND (v_escopo IS NULL OR d.filial = v_escopo);

  -- ── 6. Vaga aguardando a Matriz (311): admin/CEO, nunca quem abriu ──────
  SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
           'coluna', CASE WHEN v_role IN ('admin', 'ceo') AND va.criado_por IS DISTINCT FROM v_uid
                          THEN 'mim' ELSE 'equipe' END,
           'area', 'RH', 'etapa', 'Vaga aguardando a Matriz',
           'documento', left(COALESCE(va.cargo, 'vaga') || ' (' || COALESCE(va.quantidade, 1)::text || ')', 60),
           'documento_id', va.id, 'filial', va.filial,
           'onde', 'RH › Recrutamento e Seleção', 'view', 'rh-recrutamentoeseleção',
           'acao', CASE WHEN v_role IN ('admin', 'ceo') AND va.criado_por IS DISTINCT FROM v_uid
                        THEN 'Aprovar ou negar' ELSE 'Acompanhar' END,
           'responsavel', CASE WHEN v_role IN ('admin', 'ceo') AND va.criado_por IS DISTINCT FROM v_uid
                               THEN NULL ELSE 'Admin / CEO' END,
           'dias_parado', GREATEST(0, v_hoje - (va.created_at AT TIME ZONE 'America/Rio_Branco')::date),
           'gravidade', CASE WHEN v_hoje - (va.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2
                             THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
    INTO v_cards
    FROM public.vagas va
   WHERE COALESCE(va.ativo, true) AND va.status = 'Aguardando Matriz'
     AND v_role IN ('admin', 'ceo', 'gerente')
     AND (v_escopo IS NULL OR va.filial = v_escopo);

  -- ── 7. Nota que falta do conselho (345/361): CEO e conselheiro ──────────
  -- Um cartão por tarefa aberta, dizendo quantos participantes ainda estão
  -- sem a MINHA nota. Admin modera e não dá nota (240).
  IF v_role IN ('ceo', 'conselheiro') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', 'mim', 'area', 'Matriz', 'etapa', 'Tarefa da competição aguardando sua nota',
             'documento', left(x.nome, 60), 'documento_id', x.id, 'filial', 'Matriz',
             'onde', 'Central de Avaliação › Competição', 'view', 'matriz-avaliacoes', 'modo', 'matriz',
             'acao', 'Dar nota a ' || x.faltam || ' de ' || x.total || ' participante(s)',
             'dias_parado', GREATEST(0, v_hoje - (x.desde AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (x.desde AT TIME ZONE 'America/Rio_Branco')::date >= 2
                               THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM (
        SELECT t.id, t.nome, COALESCE(t.liberada_em, t.created_at) AS desde,
               count(*) AS total,
               count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM public.avaliacoes_matriz am
                  WHERE am.item_id = p.id AND am.avaliador_id = v_uid
                    AND am.ativo AND am.item_tipo LIKE 'tarefa\_%')) AS faltam
          FROM public.matriz_tarefas t
          JOIN public.matriz_tarefa_participantes p ON p.tarefa_id = t.id AND p.ativo
         WHERE t.ativo AND t.status = 'aberta'
           AND (v_escopo IS NULL OR p.filial = v_escopo)
         GROUP BY t.id, t.nome, t.liberada_em, t.created_at
      ) x
     WHERE x.faltam > 0;

    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', 'mim', 'area', 'Matriz', 'etapa', 'Demanda do ciclo aguardando sua nota',
             'documento', left(x.nome, 60), 'documento_id', x.id, 'filial', 'Matriz',
             'onde', 'Central de Avaliação › Padrão', 'view', 'matriz-avaliacoes', 'modo', 'matriz',
             'acao', 'Dar nota a ' || x.faltam || ' de ' || x.total || ' participante(s)',
             'dias_parado', GREATEST(0, v_hoje - (x.desde AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (x.desde AT TIME ZONE 'America/Rio_Branco')::date >= 2
                               THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM (
        SELECT t.id, t.nome, COALESCE(t.liberada_em, t.created_at) AS desde,
               count(*) AS total,
               count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM public.ciclo_tarefa_avaliacoes ca
                  WHERE ca.participante_id = p.id AND ca.avaliador_id = v_uid AND ca.ativo)) AS faltam
          FROM public.ciclo_tarefas t
          JOIN public.ciclo_tarefa_participantes p ON p.tarefa_id = t.id AND p.ativo
         WHERE t.ativo AND t.status = 'aberta'
           AND (v_escopo IS NULL OR p.filial = v_escopo)
         GROUP BY t.id, t.nome, t.liberada_em, t.created_at
      ) x
     WHERE x.faltam > 0;
  END IF;

  -- ── 8. Acesso a ajustar depois de transferência (312/313): admin ────────
  IF v_role = 'admin' THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', 'mim', 'area', 'RH', 'etapa', 'Acesso a ajustar depois de movimentação',
             'documento', left(COALESCE(m.nome_funcionario, '') || ' → ' || COALESCE(m.filial_nova, m.cargo_novo, ''), 60),
             'documento_id', m.id, 'filial', COALESCE(m.filial_nova, m.filial),
             'onde', 'Usuários', 'view', 'usuarios',
             'acao', 'Ajustar unidade/papel da conta',
             'dias_parado', GREATEST(0, v_hoje - (m.created_at AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (m.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2
                               THEN 'media' ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.movimentacoes_carreira m
     WHERE COALESCE(m.ativo, true) AND m.acesso_pendente
       AND (v_escopo IS NULL OR COALESCE(m.filial_nova, m.filial) = v_escopo);
  END IF;

  -- ── 9. Contrato entre unidades (623): a outra parte assina ──────────────
  -- Quem representa a parte é a mesma régua do `contrato_representa`: filial
  -- = o gerente dela, Matriz = admin. CEO e conselheiro só leem contrato.
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', CASE WHEN ct.status = 'aguardando' AND public.contrato_representa(ct.parte_b) THEN 'mim'
                            WHEN ct.status = 'rascunho' THEN 'mim'
                            ELSE 'equipe' END,
             'area', 'Contratos',
             'etapa', CASE WHEN ct.status = 'rascunho' THEN 'Rascunho de contrato para enviar'
                           WHEN public.contrato_representa(ct.parte_b) THEN 'Contrato aguardando sua assinatura'
                           ELSE 'Contrato aguardando a outra parte' END,
             'documento', left(COALESCE(ct.titulo, 'contrato') || ' — ' || ct.parte_a || ' × ' || ct.parte_b, 60),
             'documento_id', ct.id,
             'filial', CASE WHEN public.contrato_representa(ct.parte_b) THEN ct.parte_b ELSE ct.parte_a END,
             'onde', 'Contratos', 'view', 'contratos',
             'acao', CASE WHEN ct.status = 'rascunho' THEN 'Revisar e assinar'
                          WHEN public.contrato_representa(ct.parte_b) THEN 'Conferir e assinar'
                          ELSE 'Acompanhar' END,
             'responsavel', CASE WHEN ct.status = 'aguardando' AND NOT public.contrato_representa(ct.parte_b)
                                 THEN public._pendencia_responsaveis(ct.parte_b, CASE WHEN ct.parte_b = 'Matriz' THEN 'matriz' ELSE 'gerente' END)
                            END,
             'valor', ct.valor,
             'dias_parado', GREATEST(0, v_hoje - (COALESCE(ct.enviado_em, ct.created_at) AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (COALESCE(ct.enviado_em, ct.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                               WHEN v_hoje - (COALESCE(ct.enviado_em, ct.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                               ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.contratos ct
     WHERE (ct.status = 'aguardando'
            AND (public.contrato_representa(ct.parte_a) OR public.contrato_representa(ct.parte_b)))
        OR (ct.status = 'rascunho' AND ct.criado_por = v_uid);
  END IF;

  -- ── 10. Férias solicitadas: o gerente opera o RH da unidade ─────────────
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', CASE WHEN v_role = 'gerente' THEN 'mim' ELSE 'equipe' END,
             'area', 'RH', 'etapa', 'Férias solicitadas',
             'documento', left(COALESCE(fu.nome, 'colaborador') || ' — ' || COALESCE(to_char(fe.data_inicio, 'DD/MM'), '?')
                               || ' a ' || COALESCE(to_char(fe.data_fim, 'DD/MM'), '?'), 60),
             'documento_id', fe.id, 'filial', fe.filial,
             'onde', 'RH › Férias', 'view', 'rh-férias',
             'acao', 'Aprovar ou negar',
             'responsavel', CASE WHEN v_role = 'admin' THEN public._pendencia_responsaveis(fe.filial, 'gerente') END,
             'dias_parado', GREATEST(0, v_hoje - (fe.created_at AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN fe.data_inicio IS NOT NULL AND fe.data_inicio <= v_hoje + 7 THEN 'alta'
                               WHEN v_hoje - (fe.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                               ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.ferias fe
      LEFT JOIN public.funcionarios fu ON fu.id = fe.funcionario_id
     WHERE COALESCE(fe.ativo, true) AND fe.status = 'Solicitada'
       AND (v_escopo IS NULL OR fe.filial = v_escopo);
  END IF;

  -- ── 11. Requerimento para a Matriz (164): admin, CEO e conselheiro ──────
  SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
           'coluna', CASE WHEN v_role IN ('admin', 'ceo', 'conselheiro') THEN 'mim' ELSE 'equipe' END,
           'area', 'Matriz', 'etapa', 'Requerimento para a Matriz',
           'documento', left(COALESCE(rq.titulo, 'requerimento') || ' — ' || COALESCE(rq.criado_por_nome, ''), 60),
           'documento_id', rq.id, 'filial', rq.filial,
           'onde', 'Feedback & Requerimentos', 'view', 'feedback-org',
           'modo', CASE WHEN v_role IN ('admin', 'ceo', 'conselheiro') THEN 'matriz' END,
           'acao', CASE WHEN v_role IN ('admin', 'ceo', 'conselheiro') THEN 'Responder' ELSE 'Acompanhar' END,
           'responsavel', CASE WHEN v_role = 'gerente' THEN 'Matriz' END,
           'dias_parado', GREATEST(0, v_hoje - (rq.created_at AT TIME ZONE 'America/Rio_Branco')::date),
           'gravidade', CASE WHEN v_hoje - (rq.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                             WHEN v_hoje - (rq.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                             ELSE 'baixa' END)), '[]'::jsonb)
    INTO v_cards
    FROM public.requerimentos rq
   WHERE rq.status IN ('Pendente', 'Em Análise')
     AND (v_escopo IS NULL OR rq.filial = v_escopo);

  -- ── 12. Venda parada depois da aprovação: equipe (admin e gerente) ──────
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(x.card), '[]'::jsonb)
      INTO v_cards
      FROM (
        SELECT jsonb_build_object(
                 'coluna', 'equipe', 'area', 'Vendas', 'etapa', 'Orçamento aprovado, sem virar pedido',
                 'documento', left(COALESCE(NULLIF(o.numero::text, ''), left(o.id::text, 8)) || ' — ' || COALESCE(o.vendedor_nome, ''), 60),
                 'documento_id', o.id, 'filial', o.filial,
                 'onde', 'Vendas › Orçamentos', 'view', 'vendas-orçamentos',
                 'acao', 'Converter em pedido',
                 'responsavel', public._pendencia_responsaveis(o.filial, 'vendas'),
                 'valor', o.valor_total,
                 'dias_parado', GREATEST(0, v_hoje - (COALESCE(o.updated_at, o.created_at) AT TIME ZONE 'America/Rio_Branco')::date),
                 'gravidade', CASE WHEN v_hoje - (COALESCE(o.updated_at, o.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                                   WHEN v_hoje - (COALESCE(o.updated_at, o.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                                   ELSE 'baixa' END) AS card
          FROM public.orcamentos o
         WHERE COALESCE(o.ativo, true) AND o.status = 'Aprovado Financeiro'
           AND (v_escopo IS NULL OR o.filial = v_escopo)
        UNION ALL
        SELECT jsonb_build_object(
                 'coluna', 'equipe', 'area', 'Estoque', 'etapa', 'Pedido de venda a separar',
                 'documento', left(COALESCE(NULLIF(pv.numero, ''), left(pv.id::text, 8)) || ' — ' || COALESCE(pv.vendedor_nome, ''), 60),
                 'documento_id', pv.id, 'filial', pv.filial,
                 'onde', 'Estoque › Pedidos de Venda', 'view', 'estoque-pedidosdevenda',
                 'acao', 'Separar a mercadoria',
                 'responsavel', public._pendencia_responsaveis(pv.filial, 'estoque'),
                 'valor', pv.valor_total,
                 'dias_parado', GREATEST(0, v_hoje - (pv.created_at AT TIME ZONE 'America/Rio_Branco')::date),
                 'gravidade', CASE WHEN v_hoje - (pv.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                                   WHEN v_hoje - (pv.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                                   ELSE 'baixa' END)
          FROM public.pedidos_venda pv
         WHERE COALESCE(pv.ativo, true) AND pv.separado_em IS NULL AND pv.status <> 'Cancelado'
           AND (v_escopo IS NULL OR pv.filial = v_escopo)
        UNION ALL
        SELECT jsonb_build_object(
                 'coluna', 'equipe', 'area', 'Financeiro', 'etapa', 'Pedido de venda sem pagamento registrado',
                 'documento', left(COALESCE(NULLIF(pv.numero, ''), left(pv.id::text, 8)) || ' — ' || COALESCE(pv.vendedor_nome, ''), 60),
                 'documento_id', pv.id, 'filial', pv.filial,
                 'onde', 'Financeiro › Pedidos de Venda', 'view', 'financeiro-pedidosdevenda',
                 'acao', 'Registrar o pagamento',
                 'responsavel', public._pendencia_responsaveis(pv.filial, 'financeiro'),
                 'valor', pv.valor_total,
                 'dias_parado', GREATEST(0, v_hoje - (pv.created_at AT TIME ZONE 'America/Rio_Branco')::date),
                 'gravidade', CASE WHEN v_hoje - (pv.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                                   WHEN v_hoje - (pv.created_at AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                                   ELSE 'baixa' END)
          FROM public.pedidos_venda pv
         WHERE COALESCE(pv.ativo, true) AND pv.pago_em IS NULL AND pv.status <> 'Cancelado'
           AND (v_escopo IS NULL OR pv.filial = v_escopo)
      ) x;
  END IF;

  -- ── 13. Candidato parado numa etapa (311): RH ou gerente da unidade ─────
  -- 'Aprovado' ainda espera a efetivação; finais (Reprovado, Contratado) saem.
  IF v_role IN ('admin', 'gerente') THEN
    SELECT v_cards || COALESCE(jsonb_agg(jsonb_build_object(
             'coluna', 'equipe', 'area', 'RH',
             'etapa', CASE WHEN ca.etapa = 'Aprovado' THEN 'Candidato aprovado, sem efetivar'
                           ELSE 'Candidato parado em ' || ca.etapa END,
             'documento', left(COALESCE(ca.nome, 'candidato') || ' — ' || COALESCE(va.cargo, ''), 60),
             'documento_id', ca.id, 'filial', ca.filial,
             'onde', 'RH › Recrutamento e Seleção', 'view', 'rh-recrutamentoeseleção',
             'acao', CASE WHEN ca.etapa = 'Aprovado' THEN 'Efetivar a contratação' ELSE 'Avançar ou encerrar' END,
             'responsavel', public._pendencia_responsaveis(ca.filial, 'rh'),
             'dias_parado', GREATEST(0, v_hoje - (COALESCE(ca.updated_at, ca.created_at) AT TIME ZONE 'America/Rio_Branco')::date),
             'gravidade', CASE WHEN v_hoje - (COALESCE(ca.updated_at, ca.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 5 THEN 'alta'
                               WHEN v_hoje - (COALESCE(ca.updated_at, ca.created_at) AT TIME ZONE 'America/Rio_Branco')::date >= 2 THEN 'media'
                               ELSE 'baixa' END)), '[]'::jsonb)
      INTO v_cards
      FROM public.candidaturas ca
      LEFT JOIN public.vagas va ON va.id = ca.vaga_id
     WHERE COALESCE(ca.ativo, true) AND ca.etapa IN ('Triagem', 'Entrevista', 'Teste', 'Aprovado')
       AND (v_escopo IS NULL OR ca.filial = v_escopo);
  END IF;

  -- ── 14. Feito: o que EU decidi nos últimos 7 dias ───────────────────────
  SELECT v_cards || COALESCE(jsonb_agg(f.card ORDER BY f.quando DESC), '[]'::jsonb)
    INTO v_cards
    FROM (
      -- Requisição de compra. Desde a 668 a decisão grava id e hora; antes
      -- dela só havia o NOME em `aprovador` e a hora da requisição.
      SELECT COALESCE(a.decidido_em, r.updated_at) AS quando, jsonb_build_object(
               'coluna', 'feito', 'area', 'Compras', 'etapa', 'Requisição de compra',
               'documento', COALESCE(NULLIF(r.numero::text, ''), left(COALESCE(r.item, ''), 40)),
               'documento_id', r.id, 'filial', r.filial, 'view', 'requisicoes-aprovações',
               'resultado', a.status, 'quando', COALESCE(a.decidido_em, r.updated_at)) AS card
        FROM public.aprovacoes_compras a
        JOIN public.requisicoes r ON r.id = a.requisicao_id
       WHERE a.status <> 'Pendente'
         AND ((a.decidido_por = v_uid AND a.decidido_em >= v_desde)
           OR (a.decidido_por IS NULL AND a.aprovador = v_nome AND v_nome IS NOT NULL AND r.updated_at >= v_desde))
         AND (v_escopo IS NULL OR r.filial = v_escopo)
      UNION ALL
      SELECT COALESCE(a.decidido_em, r.updated_at), jsonb_build_object(
               'coluna', 'feito', 'area', 'Estoque', 'etapa', 'Material do estoque',
               'documento', left(COALESCE(p.nome, 'material'), 40),
               'documento_id', r.id, 'filial', r.filial, 'view', 'requisicoes-aprovações',
               'resultado', a.status, 'quando', COALESCE(a.decidido_em, r.updated_at))
        FROM public.aprovacoes_estoque a
        JOIN public.requisicoes_estoque r ON r.id = a.requisicao_estoque_id
        LEFT JOIN public.produtos p ON p.id = r.produto_id
       WHERE a.status <> 'Pendente'
         AND ((a.decidido_por = v_uid AND a.decidido_em >= v_desde)
           OR (a.decidido_por IS NULL AND a.aprovador = v_nome AND v_nome IS NOT NULL AND r.updated_at >= v_desde))
         AND (v_escopo IS NULL OR r.filial = v_escopo)
      UNION ALL
      SELECT j.parecer_gerente_em, jsonb_build_object(
               'coluna', 'feito', 'area', 'RH', 'etapa', 'Parecer em justificativa de falta',
               'documento', left(COALESCE(j.nome_funcionario, '') || ' — ' || to_char(j.data, 'DD/MM'), 60),
               'documento_id', j.id, 'filial', j.filial, 'view', 'rh-registrodeponto',
               'resultado', j.parecer_gerente, 'quando', j.parecer_gerente_em)
        FROM public.justificativas_falta j
       WHERE j.parecer_gerente_por = v_uid AND j.parecer_gerente_em >= v_desde
         AND (v_escopo IS NULL OR j.filial = v_escopo)
      UNION ALL
      SELECT j.decidido_em, jsonb_build_object(
               'coluna', 'feito', 'area', 'RH', 'etapa', 'Justificativa de falta',
               'documento', left(COALESCE(j.nome_funcionario, '') || ' — ' || to_char(j.data, 'DD/MM'), 60),
               'documento_id', j.id, 'filial', j.filial, 'view', 'rh-registrodeponto',
               'resultado', j.status, 'quando', j.decidido_em)
        FROM public.justificativas_falta j
       WHERE j.decidido_por = v_uid AND j.decidido_em >= v_desde
         AND (v_escopo IS NULL OR j.filial = v_escopo)
      UNION ALL
      SELECT d.updated_at, jsonb_build_object(
               'coluna', 'feito', 'area', 'RH', 'etapa', 'Desligamento',
               'documento', left(COALESCE(d.nome_funcionario, ''), 60),
               'documento_id', d.id, 'filial', d.filial, 'view', 'rh-desligamento',
               'resultado', d.status, 'quando', d.updated_at)
        FROM public.demissoes d
       WHERE d.decidido_por = v_uid AND d.status <> 'Solicitado' AND d.updated_at >= v_desde
         AND (v_escopo IS NULL OR d.filial = v_escopo)
      UNION ALL
      SELECT va.decidido_em, jsonb_build_object(
               'coluna', 'feito', 'area', 'RH', 'etapa', 'Vaga',
               'documento', left(COALESCE(va.cargo, 'vaga'), 60),
               'documento_id', va.id, 'filial', va.filial, 'view', 'rh-recrutamentoeseleção',
               'resultado', va.status, 'quando', va.decidido_em)
        FROM public.vagas va
       WHERE va.decidido_por = v_uid AND va.decidido_em >= v_desde
         AND (v_escopo IS NULL OR va.filial = v_escopo)
      UNION ALL
      SELECT rq.respondido_em, jsonb_build_object(
               'coluna', 'feito', 'area', 'Matriz', 'etapa', 'Requerimento respondido',
               'documento', left(COALESCE(rq.titulo, 'requerimento'), 60),
               'documento_id', rq.id, 'filial', rq.filial, 'view', 'feedback-org',
               'resultado', rq.status, 'quando', rq.respondido_em)
        FROM public.requerimentos rq
       WHERE rq.respondido_por_nome = v_nome AND v_nome IS NOT NULL AND rq.respondido_em >= v_desde
         AND (v_escopo IS NULL OR rq.filial = v_escopo)
    ) f;

  RETURN jsonb_build_object(
    'papel',     v_role,
    'escopo',    v_escopo,
    'gerado_em', now(),
    'cards',     v_cards
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.minha_mesa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_mesa(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Contador do menu
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.contar_minha_mesa(p_filial text DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
    FROM jsonb_array_elements(public.minha_mesa(p_filial) -> 'cards') c
   WHERE c ->> 'coluna' = 'mim';
$function$;

REVOKE ALL ON FUNCTION public.contar_minha_mesa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contar_minha_mesa(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Anotações do gestor (Fase 2)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mesa_anotacoes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  texto       text        NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 500),
  coluna      text        NOT NULL DEFAULT 'a_fazer' CHECK (coluna IN ('a_fazer', 'fazendo', 'feito')),
  ordem       double precision NOT NULL DEFAULT extract(epoch FROM now()),
  prazo       date,
  concluida_em timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mesa_anotacoes IS
  'Mesa do Gestor, Fase 2 (migr. 668): cartões livres e PRIVADOS de quem escreveu. Não é tarefa atribuída — essa mora em tarefas/demandas.';

CREATE INDEX IF NOT EXISTS idx_mesa_anotacoes_user ON public.mesa_anotacoes (user_id, coluna, ordem);

-- Dono não muda; concluída_em segue a coluna; updated_at sempre.
CREATE OR REPLACE FUNCTION public.fn_mesa_anotacoes_carimbo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
  ELSE
    NEW.user_id := OLD.user_id;
  END IF;
  NEW.texto := btrim(NEW.texto);
  IF NEW.coluna = 'feito' THEN
    NEW.concluida_em := COALESCE(CASE WHEN TG_OP = 'UPDATE' AND OLD.coluna = 'feito' THEN OLD.concluida_em END, now());
  ELSE
    NEW.concluida_em := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mesa_anotacoes_carimbo ON public.mesa_anotacoes;
CREATE TRIGGER trg_mesa_anotacoes_carimbo BEFORE INSERT OR UPDATE ON public.mesa_anotacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_mesa_anotacoes_carimbo();

ALTER TABLE public.mesa_anotacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_anotacoes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_anotacoes TO authenticated;

-- Só a própria linha, e só os quatro papéis de gestão. Identidade calculada
-- uma vez por consulta (597/598).
DROP POLICY IF EXISTS mesa_anotacoes_dono ON public.mesa_anotacoes;
CREATE POLICY mesa_anotacoes_dono ON public.mesa_anotacoes
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid())
              AND (SELECT public.auth_user_role()) IN ('admin', 'ceo', 'conselheiro', 'gerente'));

DROP POLICY IF EXISTS zz_desligado_bloqueia_insert ON public.mesa_anotacoes;
CREATE POLICY zz_desligado_bloqueia_insert ON public.mesa_anotacoes
  AS RESTRICTIVE FOR INSERT WITH CHECK (NOT (SELECT auth_desligado()));
DROP POLICY IF EXISTS zz_desligado_bloqueia_update ON public.mesa_anotacoes;
CREATE POLICY zz_desligado_bloqueia_update ON public.mesa_anotacoes
  AS RESTRICTIVE FOR UPDATE USING (NOT (SELECT auth_desligado()));
DROP POLICY IF EXISTS zz_desligado_bloqueia_delete ON public.mesa_anotacoes;
CREATE POLICY zz_desligado_bloqueia_delete ON public.mesa_anotacoes
  AS RESTRICTIVE FOR DELETE USING (NOT (SELECT auth_desligado()));

NOTIFY pgrst, 'reload schema';
