-- 527_20260824_o_gerente_ve_as_pendencias_da_propria_unidade.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- Pendências deixa de ser só do professor — mas cada gerente só vê a sua
-- ═══════════════════════════════════════════════════════════════════════════
-- A migr. 477 nasceu como ferramenta de aula: o professor abre o mapa do que
-- está parado nas três unidades, com nome de quem está devendo. Por isso o
-- guard era `role = 'admin'` literal.
--
-- Só que a pergunta "o que está parado na minha filial e com quem?" é do
-- gerente todo dia — é o trabalho dele, não um relatório sobre ele. Sem esta
-- tela, ele descobre a requisição parada há 6 dias quando alguém reclama.
--
-- ── A parte que não era só afrouxar o papel ─────────────────────────────────
-- `p_filial` sempre foi FILTRO, não guarda: chamada sem argumento, a função
-- devolve as três unidades. Trocar `role = 'admin'` por "admin ou gerente"
-- daria ao gerente da MaxLook a lista — e os NOMES — da SuperMax e da TechMax,
-- com um `p_filial: null` no F12. O recorte tinha de virar guarda.
--
-- Agora quem manda é `v_escopo`, decidido no servidor:
--   • service_role e admin: p_filial livre, NULL = todas (como sempre foi);
--   • gerente: NULL vira A UNIDADE DELE, e pedir outra é 42501;
--   • qualquer outro papel: 42501, como antes.
--
-- Vide [[feedback_guard_null_auth_pode_filial]]: sem perfil, `auth_user_filial()`
-- é NULL, e NULL não pode virar "todas as unidades" — por isso o gerente sem
-- alocação é recusado com mensagem própria em vez de cair no ramo livre.
--
-- O CONTEÚDO não muda: continua o fluxo de compras + dinheiro da 477, com as
-- linhas que esperam o gerente (requisição e pedido pendentes, caixa aberto de
-- dia anterior) e as que esperam os setores da unidade dele — que é o que
-- "controle da própria filial" quer dizer.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.listar_pendencias(p_filial text DEFAULT NULL)
RETURNS TABLE (
  area              text,
  etapa             text,
  documento         text,
  documento_id      uuid,
  filial            text,
  onde              text,
  acao              text,
  responsavel       text,
  responsavel_papel text,
  solicitante       text,
  valor             numeric,
  vencimento        date,
  parado_desde      timestamptz,
  dias_parado       integer,
  gravidade         text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
      -- O professor atravessa as unidades: é o mapa da turma inteira.
      v_escopo := p_filial;

    ELSIF COALESCE(v_role, '') = 'gerente' THEN
      -- MIGR 527. O recorte é guarda, não filtro: NULL não pode virar "todas".
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
       AND NOT EXISTS (SELECT 1 FROM public.cotacoes c
                        WHERE c.requisicao_id = r.id AND COALESCE(c.ativo, true))

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
   -- MIGR 527: v_escopo, e não p_filial. É aqui que o recorte deixa de ser
   -- filtro de tela e vira guarda de servidor.
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

REVOKE ALL ON FUNCTION public.listar_pendencias(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_pendencias(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.listar_pendencias(text) IS
  'Mapa do que está parado no fluxo de compras e dinheiro (migr. 477). Admin vê as unidades todas; gerente vê só a própria, com o recorte imposto no servidor (migr. 527).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ─────────────────────────────────────────────────────────────
--   -- com JWT de gerente (o service_role passa batido, vide
--   -- [feedback_testar_guard_precisa_de_jwt]):
--   SELECT DISTINCT filial FROM listar_pendencias(NULL);      -- só a dele
--   SELECT * FROM listar_pendencias('SuperMax');              -- 42501 se não é a dele
