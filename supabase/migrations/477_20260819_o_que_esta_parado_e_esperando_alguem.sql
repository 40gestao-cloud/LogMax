-- 477 — O que está parado, onde, e esperando quem.
--
-- A Conferência (471/472) responde "o que saiu torto na aula de hoje". Falta a
-- outra pergunta, que o professor faz toda semana: "o que está parado?". Uma é
-- sobre o que foi feito errado; a outra, sobre o que não foi feito.
--
-- ─── POR QUE NÃO DÁ PARA FILTRAR POR 'Pendente' ────────────────────────────
--
-- Foi a primeira coisa que o dado real desmentiu. Numa turma com 51 contas a
-- pagar paradas, 14 pedidos em entrega, 10 recebimentos e 3 caixas abertos,
-- `status = 'Pendente'` pega menos de um terço. Cada fluxo tem o SEU estado de
-- espera, e o nome quase nunca é "Pendente":
--
--   · cotação parada no financeiro  → 'Aguardando Financeiro'
--   · pedido esperando a mercadoria → 'Em Entrega'
--   · caixa que ninguém fechou      → 'Aberto'
--   · orçamento parado              → 'Aguardando Financeiro'
--   · promoção e conteúdo           → 'Aguardando Aprovação'
--
-- A regra tem que conhecer o fluxo. Não existe atalho genérico aqui, e fingir
-- que existe produz um relatório que mente para menos — o pior tipo, porque
-- silêncio se lê como "está tudo em dia".
--
-- ─── A MESMA RÉGUA DA 471: SQL CONTA, IA JULGA ─────────────────────────────
--
-- Esta RPC não prioriza, não interpreta e não aconselha. Ela diz o que está
-- parado, há quantos dias, de que valor e quem tem a caneta. Tudo verificável:
-- o professor abre o documento e confere. A leitura ("o que destravar
-- primeiro") é opinião e vive na camada da IA, rotulada como opinião.
--
-- ─── QUEM É O RESPONSÁVEL É NOME, NÃO CARGO ────────────────────────────────
--
-- "Aguardando o financeiro" não cobra ninguém. `_pendencia_responsaveis`
-- resolve o papel em PESSOAS daquela unidade, e respeita o multi-setor
-- (`setores_extras`) — quem acumula financeiro como setor extra aparece.
--
-- Fila sem ninguém para atender é achado, não vazio: quando não há pessoa
-- alocada, a coluna diz isso em letras, porque o documento vai ficar parado
-- para sempre e ninguém seria notificado.
--
-- ─── AUTORIDADE ────────────────────────────────────────────────────────────
--
-- Espelha `coletar_textos_fluxo` (472): `role = 'admin'` literal ou claim
-- `service_role`. O relatório atravessa as três unidades e diz o nome de quem
-- está devendo — isso é do professor. CEO e conselheiro são alunos e estão
-- DENTRO do relatório.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Papel → pessoas
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._pendencia_responsaveis(p_filial text, p_papel text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_nomes   text;
  v_setores text[];
BEGIN
  -- A Matriz não tem colaborador nem gerente: por régua de RBAC ela é só
  -- admin/CEO/conselheiro. Sem esta saída, toda pendência da holding — e elas
  -- existem desde o mútuo da 473/474, que cria conta a receber com
  -- filial = 'Matriz' — sairia com "ninguém alocado", acusando de abandono uma
  -- fila que tem dono. Qualquer papel pedido na Matriz resolve na Matriz.
  IF p_filial = 'Matriz' OR p_papel = 'matriz' THEN
    SELECT string_agg(u.nome, ', ' ORDER BY u.nome) INTO v_nomes
      FROM public.user_profiles u
     WHERE u.role IN ('admin', 'ceo')
       AND COALESCE(u.ativo, true) AND u.desligado_em IS NULL;

  ELSIF p_papel = 'gerente' THEN
    SELECT string_agg(u.nome, ', ' ORDER BY u.nome) INTO v_nomes
      FROM public.user_profiles u
     WHERE u.role = 'gerente' AND u.filial = p_filial
       AND COALESCE(u.ativo, true) AND u.desligado_em IS NULL;

  ELSE
    -- Setor equivalente, não setor literal. ESPELHA `AULA_MODULO_SETORES` (e a
    -- `aula_setores_do_modulo()` da migr. 317): quem está em Logística responde
    -- por Compras e por Estoque.
    --
    -- Isto não é preciosismo — foi o dado real que cobrou. Na turma NINGUÉM
    -- tem setor 'compras' ou 'estoque'; são 10 pessoas em 'logistica' fazendo
    -- esse trabalho. Com o setor literal, um terço do relatório sairia
    -- dizendo "ninguém alocado" sobre filas que têm dono — e essa é a mesma
    -- classe de erro da `condicao_pgto` da 471: regra que acusa o que a
    -- realidade não confirma vira ruído, e ruído desacredita o resto.
    v_setores := CASE p_papel
                   WHEN 'compras' THEN ARRAY['compras', 'logistica']
                   WHEN 'estoque' THEN ARRAY['estoque', 'logistica']
                   ELSE ARRAY[p_papel]
                 END;

    -- TITULAR PRIMEIRO, reserva só se não houver titular.
    --
    -- O dado real cobrou de novo: 6 dos 8 alunos da SuperMax têm 'logistica'
    -- em `setores_extras`. Somando titulares e extras numa lista só, "quem
    -- decide" saía com quase a filial inteira — e lista com seis nomes não
    -- responsabiliza ninguém, que é o oposto do que esta coluna existe para
    -- fazer. Ter a chave da sala não é ser o dono da cadeira.
    SELECT string_agg(u.nome, ', ' ORDER BY u.nome) INTO v_nomes
      FROM public.user_profiles u
     WHERE u.filial = p_filial
       AND u.setor = ANY(v_setores)
       AND u.role IN ('colaborador', 'gerente')
       AND COALESCE(u.ativo, true) AND u.desligado_em IS NULL;

    -- Sem titular, quem acumula o setor como extra responde — é melhor cobrar
    -- de quem tem o acesso do que declarar a fila órfã.
    IF COALESCE(v_nomes, '') = '' THEN
      SELECT string_agg(u.nome, ', ' ORDER BY u.nome) INTO v_nomes
        FROM public.user_profiles u
       WHERE u.filial = p_filial
         AND COALESCE(u.setores_extras, '{}') && v_setores
         AND u.role IN ('colaborador', 'gerente')
         AND COALESCE(u.ativo, true) AND u.desligado_em IS NULL;
    END IF;
  END IF;

  -- Fila órfã: o documento fica parado para sempre e ninguém é cobrado. Dizer
  -- "—" esconderia justamente o pior caso.
  RETURN COALESCE(NULLIF(v_nomes, ''), 'ninguém alocado nesta unidade');
END;
$function$;

COMMENT ON FUNCTION public._pendencia_responsaveis(text, text) IS
  'Migr. 477 — resolve papel (matriz | gerente | id de setor) nas pessoas daquela unidade. Considera setores_extras. Sem ninguém alocado, devolve o aviso em texto.';

REVOKE ALL ON FUNCTION public._pendencia_responsaveis(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pendencia_responsaveis(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public._pendencia_responsaveis(text, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. listar_pendencias
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.listar_pendencias(text);

CREATE FUNCTION public.listar_pendencias(p_filial text DEFAULT NULL)
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
SET search_path = public
AS $function$
DECLARE
  v_role  text;
  v_claim text;
  v_hoje  date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  -- Guard igual ao da 472. `current_user` não serve: em SECURITY DEFINER ele
  -- já é o dono da função, então testá-lo aprovaria qualquer chamador.
  v_claim := COALESCE(current_setting('request.jwt.claims', true), '');
  IF v_claim <> '' AND (v_claim::jsonb ->> 'role') = 'service_role' THEN
    NULL;
  ELSE
    SELECT u.role INTO v_role FROM public.user_profiles u WHERE u.id = auth.uid();
    IF COALESCE(v_role, '') <> 'admin' THEN
      RAISE EXCEPTION 'O mapa de pendências é do professor (admin).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH bruto (area, etapa, documento, documento_id, filial, onde, acao,
              papel, papel_label, solicitante, valor, vencimento, parado_desde) AS (

    -- ── COMPRAS ────────────────────────────────────────────────────────────

    -- Requisição esperando decisão. Quem decide é o gerente da unidade ou a
    -- Matriz, nunca Compras (migr. 282): Compras executa a compra, não a aprova.
    SELECT 'Compras'::text, 'Requisição aguardando aprovação'::text,
           COALESCE(NULLIF(r.numero::text, ''), left(COALESCE(r.item, 'sem item'), 40)),
           r.id, r.filial,
           'Requisições › Aprovações'::text, 'Aprovar ou negar'::text,
           'gerente'::text, 'Gerente da unidade'::text,
           COALESCE(r.solicitante, '')::text, NULL::numeric, NULL::date, r.created_at
      FROM public.requisicoes r
     WHERE COALESCE(r.ativo, true) AND r.status = 'Pendente'

    UNION ALL
    -- Aprovada e esquecida: ninguém abriu cotação. É a pendência mais invisível
    -- do fluxo, porque o documento já saiu da fila de quem aprova.
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
    -- Devolvida para correção (migr. 467): a bola voltou para Compras e o
    -- financeiro fica esperando sem saber que espera.
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

    -- ── ESTOQUE ────────────────────────────────────────────────────────────

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

    -- ── DINHEIRO ───────────────────────────────────────────────────────────

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
    -- Só caixa de dia ANTERIOR: o de hoje está aberto porque a unidade está
    -- operando, e acusar isso seria acusar o funcionamento normal.
    SELECT 'Caixa', 'Caixa aberto de dia anterior, sem fechamento',
           to_char(cx.data, 'DD/MM/YYYY'), cx.id, cx.filial,
           'Financeiro › Controle de Caixa', 'Conferir e fechar o caixa',
           'gerente', 'Gerente da unidade',
           COALESCE(cx.aberto_por_nome, ''), cx.valor_abertura, NULL::date,
           COALESCE(cx.aberto_em, cx.created_at)
      FROM public.controle_caixa cx
     WHERE COALESCE(cx.ativo, true) AND cx.status IN ('Aberto', 'Aguardando Confirmação')
       AND cx.data < v_hoje

    -- ── APROVAÇÕES DO FINANCEIRO ───────────────────────────────────────────

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
         -- Régua de gravidade. Cinco dias parece pouco no mundo real e é muito
         -- numa turma: o exercício roda em dias, não em meses. Vencido é alta
         -- por definição — já passou do prazo, não está "quase".
         --
         -- A condição olha a COLUNA `vencimento`, não o rótulo da etapa.
         -- Casar gravidade com texto de tela faz a regra quebrar no dia em que
         -- alguém reescrever a frase.
         CASE
           WHEN (b.vencimento IS NOT NULL AND b.vencimento < v_hoje) THEN 'alta'
           WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 5 THEN 'alta'
           WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 2 THEN 'media'
           ELSE 'baixa'
         END AS gravidade
    FROM bruto b
   WHERE p_filial IS NULL OR b.filial = p_filial
   ORDER BY
     CASE WHEN (b.vencimento IS NOT NULL AND b.vencimento < v_hoje) THEN 0
          WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 5 THEN 0
          WHEN (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) >= 2 THEN 1
          ELSE 2 END,
     (v_hoje - (b.parado_desde AT TIME ZONE 'America/Rio_Branco')::date) DESC,
     b.area, b.etapa;
END;
$function$;

COMMENT ON FUNCTION public.listar_pendencias(text) IS
  'Migr. 477 — o que está parado em Compras, Estoque, Financeiro, Caixa e aprovações de Marketing: onde, há quantos dias, de que valor e quem tem a caneta. Não prioriza nem interpreta (isso é da IA). Só role=admin literal ou service_role.';

REVOKE ALL ON FUNCTION public.listar_pendencias(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.listar_pendencias(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.listar_pendencias(text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
