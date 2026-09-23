-- 620 — A bolinha de Compras conta o que a tela de Compras conta
--
-- O QUE ESTAVA ACONTECENDO
--
-- Aula de 22/09 no LogMax-ERP: a SuperMax terminou com 38 cotações aprovadas
-- pelo Financeiro e nenhum pedido gerado; a TechMax, com 30 requisições
-- aprovadas e nenhuma cotação. Dentro da tela de Cotações a faixa
-- `FilaDeTrabalho` mostrava as duas filas — mas só para quem abria a tela.
-- Fora dela, nada chamava:
--
--   · `contar_pendencias` (migr. 602) contava 'compras-cotações' por
--     status = 'Pendente'. A CHECK de `cotacoes` nem aceita esse status:
--     a bolinha era zero sempre.
--   · 'compras-pedidos' também contava 'Pendente', e pedido nasce 'Aprovado'
--     esperando o "Marcar Em Entrega". Zero sempre.
--   · `listar_pendencias` (mapa do professor/gerente, migr. 527) não tinha a
--     linha "cotação aprovada sem pedido" — justamente a fila das 38.
--   · e contava "requisição aprovada sem cotação" só quando não havia
--     cotação NENHUMA: uma proposta negada ou cancelada tirava a requisição
--     do mapa, mesmo precisando ser cotada de novo.
--
-- O QUE MUDA
--
-- Os dois números passam a ser os mesmos da faixa de cada tela
-- (CotacoesView: sem cotação viva + em correção + aprovada sem pedido;
-- PedidosView: aprovados esperando envio). "Viva" = 'Aguardando Financeiro',
-- 'Em correção' ou 'Aprovado' — o STATUS_VIVOS da tela.
--
-- As duas funções foram copiadas do banco (pg_get_functiondef, iguais nos 4)
-- e só os trechos marcados com (620) mudaram.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.contar_pendencias(p_filial text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Filas contadas uma vez e usadas em mais de uma chave.
  v_aprov_compras  int;
  v_aprov_estoque  int;
  v_promocoes      int;
  -- As duas metades de `estoque-recebimentos`.
  v_receb_pendente int;
  v_receb_saldo    int;
BEGIN
  SELECT count(*) INTO v_aprov_compras
    FROM aprovacoes_compras a
    JOIN requisicoes r ON r.id = a.requisicao_id
   WHERE a.status = 'Pendente'
     AND r.ativo AND r.status = 'Pendente'
     AND (p_filial IS NULL OR a.filial = p_filial);

  SELECT count(*) INTO v_aprov_estoque
    FROM aprovacoes_estoque a
    JOIN requisicoes_estoque r ON r.id = a.requisicao_estoque_id
   WHERE a.status = 'Pendente'
     AND r.ativo AND r.status = 'Pendente'
     AND (p_filial IS NULL OR a.filial = p_filial);

  SELECT count(*) INTO v_promocoes
    FROM marketing_promocoes
   WHERE ativo
     AND status IN ('Aguardando Aprovação', 'Em Análise')
     AND (p_filial IS NULL OR filial = p_filial);

  SELECT count(*) INTO v_receb_pendente
    FROM recebimentos
   WHERE ativo AND status = 'Pendente'
     AND (p_filial IS NULL OR filial = p_filial);

  SELECT count(*) INTO v_receb_saldo
    FROM v_pedidos_a_receber
   WHERE (p_filial IS NULL OR filial = p_filial);

  RETURN jsonb_build_object(
    -- ── Compras ──────────────────────────────────────────────────────────
    'compras-requisiçõesdecompra', (
      SELECT count(*) FROM requisicoes
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    -- (620) As três filas da faixa de Cotações, somadas como a tela soma.
    -- Era status = 'Pendente', que a CHECK de cotacoes nem aceita: a bolinha
    -- ficava em zero enquanto 38 cotações aprovadas esperavam pedido.
    'compras-cotações', (
      SELECT count(*) FROM requisicoes r
       WHERE r.ativo AND r.status = 'Aprovado'
         AND (p_filial IS NULL OR r.filial = p_filial)
         AND NOT EXISTS (SELECT 1 FROM cotacoes c
                          WHERE c.requisicao_id = r.id AND c.ativo
                            AND c.status IN ('Aguardando Financeiro', 'Em correção', 'Aprovado'))
    ) + (
      SELECT count(*) FROM cotacoes c
       WHERE c.ativo AND c.status = 'Em correção'
         AND (p_filial IS NULL OR c.filial = p_filial)
    ) + (
      SELECT count(*) FROM cotacoes c
       WHERE c.ativo AND c.status = 'Aprovado'
         AND (p_filial IS NULL OR c.filial = p_filial)
         AND NOT EXISTS (SELECT 1 FROM pedidos p
                          WHERE p.cotacao_id = c.id AND p.ativo AND p.status <> 'Cancelado')
    ),
    -- (620) Pedido nasce 'Aprovado' (gerar_pedido_de_cotacao) e espera Compras
    -- marcar Em Entrega — é a primeira linha da faixa de Pedidos.
    'compras-pedidos', (
      SELECT count(*) FROM pedidos
       WHERE ativo AND status = 'Aprovado'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- ── Requisições (caixa de decisão do gerente) ────────────────────────
    -- Soma as duas portas: compra e material do almoxarifado.
    'requisicoes-aprovações', v_aprov_compras + v_aprov_estoque,

    -- ── Estoque ──────────────────────────────────────────────────────────
    'estoque-liberarrequisições',    v_aprov_estoque,
    'estoque-recebimentos',          v_receb_pendente + v_receb_saldo,
    'estoque-requisiçõesdematerial', (
      SELECT count(*) FROM requisicoes_estoque
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    'estoque-expedição', (
      SELECT count(*) FROM expedicao
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),
    'estoque-pedidosdevenda', (
      SELECT count(*) FROM pedidos_venda
       WHERE ativo AND separado_em IS NULL AND status <> 'Cancelado'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- ── Financeiro ───────────────────────────────────────────────────────
    'financeiro-aprovaçõesdecotação', (
      SELECT count(*) FROM cotacoes
       WHERE ativo AND status = 'Aguardando Financeiro'
         AND (p_filial IS NULL OR filial = p_filial)),
    'financeiro-aprovaçõesdeorçamento', (
      SELECT count(*) FROM orcamentos
       WHERE ativo AND status = 'Aguardando Financeiro'
         AND (p_filial IS NULL OR filial = p_filial)),
    'financeiro-aprovaçõesdepromoções', v_promocoes,
    'financeiro-aprovaçõesdeconteúdo', (
      SELECT count(*) FROM marketing_tarefas
       WHERE ativo AND status_link = 'Aguardando Aprovação'
         AND (p_filial IS NULL OR filial = p_filial)),
    'financeiro-pedidosdevenda', (
      SELECT count(*) FROM pedidos_venda
       WHERE ativo AND pago_em IS NULL AND status <> 'Cancelado'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- ── Vendas / Marketing / RH / TI / Metas ─────────────────────────────
    'vendas-orçamentos', (
      SELECT count(*) FROM orcamentos
       WHERE ativo AND status = 'Aprovado Financeiro'
         AND (p_filial IS NULL OR filial = p_filial)),
    'marketing-promoções', v_promocoes,
    'rh-férias', (
      SELECT count(*) FROM ferias
       WHERE ativo AND status = 'Solicitada'
         AND (p_filial IS NULL OR filial = p_filial)),
    -- Metas e Desenvolvimento com IA não têm coluna de filial: a RLS já
    -- recorta, e inventar filtro aqui zeraria a bolinha de quem tem direito.
    'metas', (
      SELECT count(*) FROM metas_estrategicas
       WHERE ativo AND status = 'Em Produção'),
    'ti-desenvolvimentocomia', (
      SELECT count(*) FROM desenvolvimentos_ia
       WHERE ativo AND status = 'Agendado')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.listar_pendencias(p_filial text DEFAULT NULL::text)
 RETURNS TABLE(area text, etapa text, documento text, documento_id uuid, filial text, onde text, acao text, responsavel text, responsavel_papel text, solicitante text, valor numeric, vencimento date, parado_desde timestamp with time zone, dias_parado integer, gravidade text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role   text;
  v_claim  text;
  v_minha  text;
  v_escopo text;
  v_hoje   date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  v_claim := COALESCE(current_setting('request.jwt.claims', true), '');
  IF v_claim <> '' AND (v_claim::jsonb ->> 'role') = 'service_role' THEN
    v_escopo := p_filial;
  ELSE
    SELECT u.role INTO v_role FROM public.user_profiles u WHERE u.id = auth.uid();

    IF COALESCE(v_role, '') = 'admin' THEN
      v_escopo := p_filial;

    ELSIF COALESCE(v_role, '') = 'gerente' THEN
      v_minha := public.auth_user_filial();

      IF COALESCE(v_minha, '') = '' THEN
        RAISE EXCEPTION 'Sua conta não está alocada em nenhuma unidade — fale com o professor.'
          USING ERRCODE = '42501';
      END IF;

      IF p_filial IS NOT NULL AND p_filial <> v_minha THEN
        RAISE EXCEPTION 'O gerente vê as pendências da própria unidade (%).', v_minha
          USING ERRCODE = '42501';
      END IF;

      v_escopo := v_minha;

    ELSE
      RAISE EXCEPTION 'O mapa de pendências é do professor e do gerente da unidade.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH bruto (area, etapa, documento, documento_id, filial, onde, acao,
              papel, papel_label, solicitante, valor, vencimento, parado_desde) AS (

    SELECT 'Compras'::text, 'Requisição aguardando aprovação'::text,
           COALESCE(NULLIF(r.numero::text, ''), left(COALESCE(r.item, 'sem item'), 40)),
           r.id, r.filial,
           'Requisições › Aprovações'::text, 'Aprovar ou negar'::text,
           'gerente'::text, 'Gerente da unidade'::text,
           COALESCE(r.solicitante, '')::text, NULL::numeric, NULL::date, r.created_at
      FROM public.requisicoes r
     WHERE COALESCE(r.ativo, true) AND r.status = 'Pendente'

    UNION ALL
    SELECT 'Compras', 'Requisição aprovada sem cotação',
           COALESCE(NULLIF(r.numero::text, ''), left(COALESCE(r.item, 'sem item'), 40)),
           r.id, r.filial,
           'Compras › Cotações', 'Cotar com fornecedores',
           'compras', 'Setor de Compras',
           COALESCE(r.solicitante, ''), NULL::numeric, NULL::date, r.created_at
      FROM public.requisicoes r
     WHERE COALESCE(r.ativo, true) AND r.status = 'Aprovado'
       -- (620) Proposta NEGADA ou CANCELADA não tira a requisição da fila:
       -- ela precisa ser cotada de novo. Mesmo recorte da faixa da tela.
       AND NOT EXISTS (SELECT 1 FROM public.cotacoes c
                        WHERE c.requisicao_id = r.id AND COALESCE(c.ativo, true)
                          AND c.status IN ('Aguardando Financeiro', 'Em correção', 'Aprovado'))

    UNION ALL
    SELECT 'Compras', 'Cotação em aberto, sem enviar ao financeiro',
           COALESCE(NULLIF(c.numero::text, ''), left(c.id::text, 8)),
           c.id, c.filial,
           'Compras › Cotações', 'Concluir e enviar ao financeiro',
           'compras', 'Setor de Compras',
           '', c.valor_total, NULL::date, c.created_at
      FROM public.cotacoes c
     WHERE COALESCE(c.ativo, true) AND c.status = 'Em Cotação'

    UNION ALL
    SELECT 'Financeiro', 'Cotação aguardando decisão do financeiro',
           COALESCE(NULLIF(c.numero::text, ''), left(c.id::text, 8)),
           c.id, c.filial,
           'Financeiro › Aprovações de Cotação', 'Aprovar ou negar',
           'financeiro', 'Setor Financeiro',
           '', c.valor_total, NULL::date, c.created_at
      FROM public.cotacoes c
     WHERE COALESCE(c.ativo, true) AND c.status = 'Aguardando Financeiro'

    UNION ALL
    SELECT 'Compras', 'Cotação devolvida para correção',
           COALESCE(NULLIF(c.numero::text, ''), left(c.id::text, 8)),
           c.id, c.filial,
           'Compras › Cotações', 'Corrigir e reenviar',
           'compras', 'Setor de Compras',
           '', c.valor_total, NULL::date, COALESCE(c.updated_at, c.created_at)
      FROM public.cotacoes c
     WHERE COALESCE(c.ativo, true) AND c.status = 'Em correção'

    -- (620) Faltava: a proposta aprovada pelo Financeiro que ninguém virou
    -- pedido. Em 22/09 eram 38 na SuperMax, e o mapa não mostrava nenhuma.
    UNION ALL
    SELECT 'Compras', 'Cotação aprovada sem pedido',
           COALESCE(NULLIF(c.numero::text, ''), left(c.id::text, 8)),
           c.id, c.filial,
           'Compras › Cotações', 'Gerar o pedido',
           'compras', 'Setor de Compras',
           '', c.valor_total, NULL::date, COALESCE(c.aprovado_em, c.updated_at, c.created_at)
      FROM public.cotacoes c
     WHERE COALESCE(c.ativo, true) AND c.status = 'Aprovado'
       AND NOT EXISTS (SELECT 1 FROM public.pedidos p
                        WHERE p.cotacao_id = c.id AND COALESCE(p.ativo, true)
                          AND p.status <> 'Cancelado')

    UNION ALL
    SELECT 'Compras', 'Pedido aguardando aprovação',
           COALESCE(NULLIF(p.numero::text, ''), left(p.id::text, 8)),
           p.id, p.filial,
           'Compras › Pedidos', 'Aprovar ou negar',
           'gerente', 'Gerente da unidade',
           '', p.valor_total, NULL::date, p.created_at
      FROM public.pedidos p
     WHERE COALESCE(p.ativo, true) AND p.status = 'Pendente'

    UNION ALL
    SELECT 'Compras', 'Pedido aprovado, não enviado ao fornecedor',
           COALESCE(NULLIF(p.numero::text, ''), left(p.id::text, 8)),
           p.id, p.filial,
           'Compras › Pedidos', 'Enviar e marcar Em Entrega',
           'compras', 'Setor de Compras',
           '', p.valor_total, NULL::date, COALESCE(p.updated_at, p.created_at)
      FROM public.pedidos p
     WHERE COALESCE(p.ativo, true) AND p.status = 'Aprovado'

    UNION ALL
    SELECT 'Estoque', 'Pedido em entrega, sem recebimento registrado',
           COALESCE(NULLIF(p.numero::text, ''), left(p.id::text, 8)),
           p.id, p.filial,
           'Estoque › Recebimentos', 'Registrar o recebimento',
           'estoque', 'Setor de Estoque',
           '', p.valor_total, NULL::date, COALESCE(p.updated_at, p.created_at)
      FROM public.pedidos p
     WHERE COALESCE(p.ativo, true) AND p.status = 'Em Entrega'

    UNION ALL
    SELECT 'Estoque',
           CASE WHEN rc.status = 'Parcial'
                THEN 'Recebimento parcial, aguardando o restante'
                ELSE 'Recebimento aguardando conferência' END,
           left(rc.id::text, 8), rc.id, rc.filial,
           'Estoque › Recebimentos', 'Conferir e concluir',
           'estoque', 'Setor de Estoque',
           '', NULL::numeric, NULL::date, rc.created_at
      FROM public.recebimentos rc
     WHERE COALESCE(rc.ativo, true) AND rc.status IN ('Pendente', 'Parcial')

    UNION ALL
    SELECT 'Financeiro',
           CASE WHEN cp.vencimento < v_hoje THEN 'Conta a pagar VENCIDA'
                ELSE 'Conta a pagar em aberto' END,
           left(COALESCE(cp.descricao, 'sem descrição'), 40), cp.id, cp.filial,
           'Financeiro › Contas a Pagar', 'Pagar ou renegociar',
           'financeiro', 'Setor Financeiro',
           '', COALESCE(cp.valor, 0) - COALESCE(cp.valor_pago, 0),
           cp.vencimento, cp.created_at
      FROM public.contas_pagar cp
     WHERE COALESCE(cp.ativo, true) AND cp.status IN ('Pendente', 'Parcial', 'Atrasado')

    UNION ALL
    SELECT 'Financeiro',
           CASE WHEN cr.vencimento < v_hoje THEN 'Conta a receber VENCIDA'
                ELSE 'Conta a receber em aberto' END,
           left(COALESCE(cr.descricao, 'sem descrição'), 40), cr.id, cr.filial,
           'Financeiro › Contas a Receber', 'Receber ou cobrar',
           'financeiro', 'Setor Financeiro',
           '', COALESCE(cr.valor, 0) - COALESCE(cr.valor_pago, 0),
           cr.vencimento, cr.created_at
      FROM public.contas_receber cr
     WHERE COALESCE(cr.ativo, true) AND cr.status IN ('Aberto', 'Parcial', 'Atrasado')

    UNION ALL
    SELECT 'Caixa', 'Caixa aberto de dia anterior, sem fechamento',
           to_char(cx.data, 'DD/MM/YYYY'), cx.id, cx.filial,
           'Financeiro › Controle de Caixa', 'Conferir e fechar o caixa',
           'gerente', 'Gerente da unidade',
           COALESCE(cx.aberto_por_nome, ''), cx.valor_abertura, NULL::date,
           COALESCE(cx.aberto_em, cx.created_at)
      FROM public.controle_caixa cx
     WHERE COALESCE(cx.ativo, true) AND cx.status IN ('Aberto', 'Aguardando Confirmação')
       AND cx.data < v_hoje

    UNION ALL
    SELECT 'Financeiro', 'Orçamento aguardando decisão do financeiro',
           COALESCE(NULLIF(o.numero::text, ''), left(o.id::text, 8)),
           o.id, o.filial,
           'Financeiro › Aprovações de Orçamento', 'Aprovar ou reprovar',
           'financeiro', 'Setor Financeiro',
           COALESCE(o.vendedor_nome, ''), o.valor_total, NULL::date, o.created_at
      FROM public.orcamentos o
     WHERE COALESCE(o.ativo, true) AND o.status = 'Aguardando Financeiro'

    UNION ALL
    SELECT 'Marketing', 'Promoção aguardando aprovação do financeiro',
           left(COALESCE(mp.nome_produto, 'promoção'), 40), mp.id, mp.filial,
           'Financeiro › Aprovações de Promoções', 'Aprovar ou negar',
           'financeiro', 'Setor Financeiro',
           COALESCE(mp.nome_criador, ''), mp.preco_promocional, NULL::date, mp.created_at
      FROM public.marketing_promocoes mp
     WHERE COALESCE(mp.ativo, true) AND mp.status = 'Aguardando Aprovação'

    UNION ALL
    SELECT 'Marketing', 'Conteúdo aguardando aprovação do financeiro',
           left(COALESCE(mt.titulo, 'conteúdo'), 40), mt.id, mt.filial,
           'Financeiro › Aprovações de Conteúdo', 'Aprovar ou reprovar',
           'financeiro', 'Setor Financeiro',
           COALESCE(mt.nome_criador, ''), NULL::numeric, NULL::date, mt.created_at
      FROM public.marketing_tarefas mt
     WHERE COALESCE(mt.ativo, true) AND mt.status_link = 'Aguardando Aprovação'
  )
  SELECT b.area, b.etapa, b.documento, b.documento_id, b.filial, b.onde, b.acao,
         public._pendencia_responsaveis(b.filial, b.papel) AS responsavel,
         b.papel_label,
         b.solicitante,
         b.valor,
         b.vencimento,
         b.parado_desde,
         GREATEST(0, (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date))::integer AS dias_parado,
         CASE
           WHEN (b.vencimento IS NOT NULL AND b.vencimento < v_hoje) THEN 'alta'
           WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 5 THEN 'alta'
           WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 2 THEN 'media'
           ELSE 'baixa'
         END AS gravidade
    FROM bruto b
   WHERE v_escopo IS NULL OR b.filial = v_escopo
   ORDER BY
     CASE WHEN (b.vencimento IS NOT NULL AND b.vencimento < v_hoje) THEN 0
          WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 5 THEN 0
          WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 2 THEN 1
          ELSE 2 END,
     (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) DESC,
     b.area, b.etapa;
END;
$function$;

NOTIFY pgrst, 'reload schema';
