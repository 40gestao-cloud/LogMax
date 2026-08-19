-- 471 — O professor pergunta o que saiu torto, e o banco responde.
--
-- Numa aula de 45 alunos, o fluxo Requisição → Cotação → Pedido → Recebimento →
-- Cadastro de Produto roda dezenas de vezes em paralelo. Conferir tudo à mão é
-- inviável, e o que passa despercebido é justamente o que a aula queria ensinar:
-- campo em branco, etapa pulada, valor que não bate com a cotação, produto
-- cadastrado sem nunca ter sido recebido.
--
-- Esta RPC responde a pergunta "o que saiu torto?" com regra fixa. É a metade
-- objetiva da análise — a que não pode errar.
--
-- ─── POR QUE ISTO NÃO É TRABALHO PARA A IA ──────────────────────────────────
--
-- A tentação é mandar tudo para o MaxAI e pedir um relatório. Mas se o texto
-- disser "3 requisições sem justificativa" e forem 4, o professor perde a
-- confiança no relatório inteiro — inclusive na parte certa. Contagem,
-- comparação de valor e verificação de campo vazio são trabalho de SQL: a
-- resposta é verificável e sempre a mesma.
--
-- Sobra para a IA (uma eventual camada 2) o que o SQL não sabe julgar: se
-- "Arros Branko" está escrito errado, se "comprar coisas para a loja" descreve
-- alguma coisa, se a justificativa justifica. Essa camada recebe SÓ os textos
-- que esta função apontar — não a base inteira.
--
-- ─── O QUE NÃO ENTROU, E POR QUÊ ────────────────────────────────────────────
--
-- Condição de pagamento do pedido: a coluna existe, mas a tela de Pedidos não
-- oferece o campo. Rodando contra 120 dias de dados reais, a regra acusou 57
-- documentos por algo que o aluno não tem como preencher — regra que culpa pelo
-- que a UI não pede é ruído, e ruído faz o professor ignorar o relatório todo.
--
-- Prefixo de SKU por filial (SM-/ML-/TM-): a base real tem código numérico
-- ("001") e histórico inconsistente ("ML-004" ao lado de "ML-31"). A regra
-- acusaria a turma inteira por um padrão que o próprio sistema não impôs.
-- Ficam a ausência de código e a duplicidade dentro da filial, que são fatos.
--
-- ─── QUEM PODE CHAMAR ───────────────────────────────────────────────────────
--
-- `role = 'admin'` literal — o professor. NÃO usa `auth_is_admin()`, que inclui
-- CEO e conselheiro: esses são alunos, e o relatório aponta o erro deles.

BEGIN;

CREATE OR REPLACE FUNCTION public.auditar_fluxo_compras(
  p_desde     timestamptz DEFAULT NULL,
  p_ate       timestamptz DEFAULT NULL,
  p_filial    text        DEFAULT NULL,
  p_sessao_id uuid        DEFAULT NULL
)
RETURNS TABLE (
  etapa       text,
  documento   text,
  documento_id uuid,
  filial      text,
  responsavel text,
  problema    text,
  detalhe     text,
  gravidade   text,
  ocorrido_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_de  timestamptz;
  v_ate timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Apenas o professor (admin) pode auditar o fluxo da turma.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Sessão de aula manda no período quando informada: é o recorte que o
  -- professor tem na cabeça ("a aula de hoje"). Sessão em curso não tem
  -- `encerrada_em`, então o fim vira agora.
  IF p_sessao_id IS NOT NULL THEN
    SELECT s.iniciada_em, COALESCE(s.encerrada_em, now())
      INTO v_de, v_ate
      FROM public.aula_sessoes s WHERE s.id = p_sessao_id;
    IF v_de IS NULL THEN
      RAISE EXCEPTION 'Sessão de aula % não encontrada.', p_sessao_id USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_de  := COALESCE(p_desde, now() - interval '24 hours');
    v_ate := COALESCE(p_ate, now());
  END IF;

  RETURN QUERY

  -- ── REQUISIÇÃO ────────────────────────────────────────────────────────────
  SELECT 'Requisição', COALESCE(r.numero, left(r.id::text, 8)), r.id, r.filial,
         COALESCE(p.nome, r.solicitante, '—'),
         v.problema, v.detalhe, v.gravidade, r.created_at
    FROM public.requisicoes r
    LEFT JOIN public.user_profiles p ON p.id = r.criado_por
    CROSS JOIN LATERAL (VALUES
      -- Só a compra eventual precisa justificar (migr. 354/358/359): reposição
      -- se justifica pelo estoque mínimo.
      ('Sem justificativa',
       'Compra eventual precisa dizer por que a empresa precisa do item.',
       'alta',
       COALESCE(r.tipo_requisicao, 'Eventual') = 'Eventual'
         AND COALESCE(trim(r.justificativa), '') = ''),
      ('Sem data de necessidade',
       'Ninguém sabe para quando o item é preciso — Compras prioriza no escuro.',
       'media', r.data_necessidade IS NULL),
      ('Sem centro de custo',
       'A despesa não tem onde pousar no DRE.',
       'media', COALESCE(trim(r.centro_custo), '') = ''),
      ('Unidade inválida',
       'Unidade "' || COALESCE(r.unidade, '(vazia)') || '" fora da régua do catálogo.',
       'media',
       COALESCE(r.unidade, '') NOT IN ('UN','KG','L','M','M²','M³','CX','PC','PCT','SV')),
      ('Quantidade inválida',
       'Quantidade zerada ou negativa.',
       'alta', COALESCE(r.qtd, 0) <= 0),
      ('Descrição vaga',
       'Item descrito com menos de 3 caracteres.',
       'alta', length(trim(COALESCE(r.item, ''))) < 3)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(r.ativo, true)
     AND r.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR r.filial = p_filial)

  UNION ALL

  -- ── COTAÇÃO ───────────────────────────────────────────────────────────────
  SELECT 'Cotação', COALESCE(c.numero, left(c.id::text, 8)), c.id, c.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, c.created_at
    FROM public.cotacoes c
    LEFT JOIN public.user_profiles p ON p.id = c.criado_por
    CROSS JOIN LATERAL (VALUES
      ('Sem fornecedor', 'Cotação sem fornecedor não é cotação.', 'alta',
       c.fornecedor_id IS NULL),
      ('Sem prazo de entrega', 'Prazo em branco — não dá para cobrar atraso depois.', 'media',
       c.prazo_entrega IS NULL),
      ('Valor zerado', 'Cotação sem valor.', 'alta',
       COALESCE(c.valor_total, 0) <= 0)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(c.ativo, true)
     AND c.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR c.filial = p_filial)

  UNION ALL

  -- Requisição que virou pedido com uma cotação só: não houve comparação. Não
  -- é erro de preenchimento, é decisão sem alternativa — o professor julga.
  SELECT 'Cotação', COALESCE(r.numero, left(r.id::text, 8)), r.id, r.filial,
         COALESCE(p.nome, r.solicitante, '—'),
         'Cotação única',
         'A requisição foi adiante com ' || cnt.n || ' cotação — sem comparar preço.',
         'baixa', r.created_at
    FROM public.requisicoes r
    LEFT JOIN public.user_profiles p ON p.id = r.criado_por
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM public.cotacoes c
       WHERE c.requisicao_id = r.id AND COALESCE(c.ativo, true)
    ) cnt
   WHERE cnt.n = 1
     AND COALESCE(r.ativo, true)
     AND r.status IN ('Atendida', 'Aprovado')
     AND r.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR r.filial = p_filial)

  UNION ALL

  -- ── PEDIDO ────────────────────────────────────────────────────────────────
  SELECT 'Pedido', COALESCE(pe.numero, left(pe.id::text, 8)), pe.id, pe.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, pe.created_at
    FROM public.pedidos pe
    LEFT JOIN public.user_profiles p ON p.id = pe.criado_por
    LEFT JOIN public.cotacoes c ON c.id = pe.cotacao_id
    CROSS JOIN LATERAL (VALUES
      ('Pedido sem cotação',
       'Etapa pulada: o pedido nasceu sem cotação vinculada.', 'alta',
       pe.cotacao_id IS NULL),
      ('Valor diferente da cotação',
       'Pedido R$ ' || to_char(COALESCE(pe.valor_total,0), 'FM999G999G990D00') ||
       ' contra cotação R$ ' || to_char(COALESCE(c.valor_total,0), 'FM999G999G990D00') || '.',
       'alta',
       c.id IS NOT NULL AND abs(COALESCE(pe.valor_total,0) - COALESCE(c.valor_total,0)) > 0.01),
      ('Sem prazo de entrega', 'Pedido sem prazo — a cobrança de atraso fica sem régua.', 'media',
       pe.prazo_entrega IS NULL)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(pe.ativo, true)
     AND pe.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR pe.filial = p_filial)

  UNION ALL

  -- ── RECEBIMENTO ───────────────────────────────────────────────────────────
  SELECT 'Recebimento', left(rec.id::text, 8), rec.id, rec.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, rec.created_at
    FROM public.recebimentos rec
    LEFT JOIN public.user_profiles p ON p.id = rec.criado_por
    LEFT JOIN public.pedidos pe ON pe.id = rec.pedido_id
    CROSS JOIN LATERAL (VALUES
      ('Quantidade divergente sem observação',
       'Recebeu ' || COALESCE(rec.qtd_recebida, 0) || ' de ' || COALESCE(pe.item_qtd, 0) ||
       ' pedidos, e não escreveu o porquê.',
       'alta',
       pe.id IS NOT NULL
         AND COALESCE(rec.qtd_recebida, 0) <> COALESCE(pe.item_qtd, 0)
         AND COALESCE(trim(rec.observacao), '') = ''),
      ('Quantidade inválida', 'Quantidade recebida zerada ou negativa.', 'alta',
       COALESCE(rec.qtd_recebida, 0) <= 0),
      ('Recebimento sem pedido', 'Etapa pulada: recebimento sem pedido vinculado.', 'alta',
       rec.pedido_id IS NULL)
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(rec.ativo, true)
     AND rec.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR rec.filial = p_filial)

  UNION ALL

  -- ── PRODUTO ───────────────────────────────────────────────────────────────
  SELECT 'Produto', COALESCE(NULLIF(trim(pr.codigo), ''), left(pr.id::text, 8)), pr.id, pr.filial,
         COALESCE(p.nome, '—'),
         v.problema, v.detalhe, v.gravidade, pr.created_at
    FROM public.produtos pr
    LEFT JOIN public.user_profiles p ON p.id = pr.criado_por
    CROSS JOIN LATERAL (VALUES
      ('Sem código', 'Produto cadastrado sem código.', 'alta',
       COALESCE(trim(pr.codigo), '') = ''),
      ('Código repetido na filial',
       'Já existe outro produto ativo com este código nesta unidade.', 'alta',
       COALESCE(trim(pr.codigo), '') <> '' AND EXISTS (
         SELECT 1 FROM public.produtos o
          WHERE o.id <> pr.id AND COALESCE(o.ativo, true)
            AND trim(o.codigo) = trim(pr.codigo)
            AND o.filial IS NOT DISTINCT FROM pr.filial)),
      ('Sem preço', 'Preço zerado — o PDV vende de graça.', 'alta',
       COALESCE(pr.preco, 0) <= 0),
      ('Unidade inválida',
       'Unidade "' || COALESCE(pr.unidade, '(vazia)') || '" fora da régua do catálogo.', 'media',
       COALESCE(pr.unidade, '') NOT IN ('UN','KG','L','M','M²','M³','CX','PC','PCT')),
      ('Sem categoria', 'Produto sem categoria — some dos filtros e dos relatórios.', 'baixa',
       pr.categoria IS NULL AND pr.categoria_id IS NULL),
      ('Nome muito curto', 'Nome com menos de 3 caracteres.', 'alta',
       length(trim(COALESCE(pr.nome, ''))) < 3),
      -- O atalho clássico: cadastrar direto em Produtos sem passar pelo fluxo.
      ('Cadastrado fora do fluxo',
       'Nenhum pedido aponta para este produto — não veio de requisição.',
       'media',
       NOT EXISTS (SELECT 1 FROM public.pedidos pd WHERE pd.produto_id = pr.id)
       -- Só acusa quando houve compra no período: numa aula cujo tema é montar
       -- catálogo, cadastrar produto direto é o exercício, não o atalho.
       AND EXISTS (SELECT 1 FROM public.pedidos pd2
                    WHERE pd2.created_at BETWEEN v_de AND v_ate
                      AND (p_filial IS NULL OR pd2.filial = p_filial)))
    ) AS v(problema, detalhe, gravidade, bateu)
   WHERE v.bateu
     AND COALESCE(pr.ativo, true)
     AND pr.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR pr.filial = p_filial)

  UNION ALL

  -- ── TRILHA: decisão rápida demais ─────────────────────────────────────────
  --
  -- Aprovar 20 segundos depois de o documento nascer não é agilidade: é não ter
  -- lido. Só a trilha sabe disso, e ela existe desde a migr. 331.
  SELECT 'Aprovação', h.entidade || ' ' || UPPER(right(h.entidade_id::text, 6)), h.entidade_id,
         h.filial, COALESCE(h.ator_nome, '—'),
         'Aprovação sem leitura',
         'Aprovado ' || round(extract(epoch FROM h.created_at - nasc.quando))::text ||
         's depois de criado.',
         'media', h.created_at
    FROM public.historico_operacoes h
    JOIN LATERAL (
      SELECT min(h2.created_at) AS quando FROM public.historico_operacoes h2
       WHERE h2.entidade = h.entidade AND h2.entidade_id = h.entidade_id
         AND h2.evento = 'Criado'
    ) nasc ON true
   WHERE h.evento = 'Status'
     AND h.para IN ('Aprovado', 'Aprovada')
     AND h.entidade IN ('requisicoes', 'cotacoes', 'pedidos')
     AND h.created_at BETWEEN v_de AND v_ate
     AND (p_filial IS NULL OR h.filial = p_filial)
     AND nasc.quando IS NOT NULL
     AND h.created_at - nasc.quando < interval '30 seconds'

  ORDER BY 8, 1, 9;   -- gravidade, etapa, quando
END;
$function$;

REVOKE ALL ON FUNCTION public.auditar_fluxo_compras(timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditar_fluxo_compras(timestamptz, timestamptz, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.auditar_fluxo_compras(timestamptz, timestamptz, text, uuid) IS
  'Migr. 471 — inconsistências objetivas do fluxo Requisição→Cadastro no período (ou na sessão de aula). Só role=admin. A camada de IA, se existir, recebe só os textos que esta função apontar.';

COMMIT;

-- Verificação:
--
--   -- Últimas 24h, todas as unidades:
--   SELECT * FROM auditar_fluxo_compras();
--
--   -- Uma aula específica:
--   SELECT * FROM auditar_fluxo_compras(p_sessao_id => '<id da sessão>');
--
--   -- Aluno não pode chamar (deve levantar P0001):
--   SELECT * FROM auditar_fluxo_compras();  -- logado como colaborador/CEO
