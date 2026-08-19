-- 472 — Camada 2: o banco separa os textos, a IA julga a qualidade deles.
--
-- A migr. 471 respondeu "o que está errado" com regra fixa: campo vazio, etapa
-- pulada, valor que não bate. O que ela não sabe responder é "o que está
-- preenchido, mas mal feito":
--
--   · "Arros Branko" cadastrado ao lado de "Arroz Branco 5kg" no catálogo;
--   · item descrito como "comprar coisas para a loja";
--   · justificativa que não justifica ("porque sim", "urgente");
--   · fornecedor "Atacadão" numa linha e "atacadao ltda" na outra;
--   · categoria incoerente com o produto (Notebook em Hortifruti).
--
-- Nada disso é contável. É leitura, e leitura é trabalho da IA.
--
-- ─── O QUE ESTA FUNÇÃO FAZ (e o que ela NÃO faz) ────────────────────────────
--
-- Ela NÃO julga. Ela SEPARA: devolve os textos livres escritos pela turma
-- dentro da sessão de aula, com o contexto mínimo para que alguém consiga
-- julgá-los, e nada mais. Quem julga é `api/ai-aula-atividade.ts` no modo
-- `conferencia`.
--
-- "Os textos que sobraram" é literal: só entra aqui o que a camada 1 deixou
-- passar. Justificativa vazia já é achado da 471 e não vem; justificativa
-- preenchida vem, porque só lendo dá para saber se ela justifica. Nome com
-- menos de 3 caracteres já é achado da 471; nome com 12 vem, porque só lendo
-- dá para saber se está escrito errado. As duas camadas não se sobrepõem — se
-- sobrepusessem, o professor leria o mesmo problema duas vezes com dois graus
-- de confiança diferentes, e passaria a não confiar em nenhum.
--
-- ─── POR QUE O CONTEXTO VAI JUNTO ───────────────────────────────────────────
--
-- Um nome de produto sozinho não denuncia nada: "Arros Branko" só vira erro ao
-- lado de "Arroz Branco 5kg" que já está no catálogo. Por isso cada texto
-- viaja com os vizinhos mais parecidos da própria filial (`similarity` do
-- pg_trgm, presente nas 4 turmas no schema `public`). É o que transforma "acho
-- que está escrito errado" em "está escrito diferente do que já existe".
--
-- O corte de similaridade é 0,35 e os vizinhos são no máximo 3: acima disso a
-- lista vira ruído no prompt e o modelo começa a apontar semelhança entre
-- produtos que só compartilham a palavra "kg".
--
-- ─── QUEM PODE CHAMAR ───────────────────────────────────────────────────────
--
-- `role = 'admin'` literal — o professor, mesma régua da 471. `auth_is_admin()`
-- incluiria CEO e conselheiro, que aqui são alunos e leriam a leitura de si
-- mesmos. A chamada server-side com service_role também passa: é o endpoint da
-- IA buscando o corpus, e ele refaz a checagem de professor antes de chamar.

BEGIN;

CREATE OR REPLACE FUNCTION public.coletar_textos_fluxo(
  p_sessao_id uuid        DEFAULT NULL,
  p_desde     timestamptz DEFAULT NULL,
  p_ate       timestamptz DEFAULT NULL,
  p_filial    text        DEFAULT NULL,
  p_limite    integer     DEFAULT 200
)
RETURNS TABLE (
  etapa        text,
  documento    text,
  documento_id uuid,
  filial       text,
  responsavel  text,
  campo        text,
  texto        text,
  contexto     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_de     timestamptz;
  v_ate    timestamptz;
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 200), 1), 400);
BEGIN
  -- `current_user` NÃO serve aqui: em SECURITY DEFINER ele já é o dono da
  -- função (postgres), não quem chamou. Quem sabe o papel da chamada é o claim
  -- do JWT — e o `service_role` só existe do lado do servidor, onde a chave
  -- nunca chega ao navegador.
  IF COALESCE(current_setting('request.jwt.claims', true)::json ->> 'role', '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'
     ) THEN
    RAISE EXCEPTION 'Apenas o professor (admin) pode coletar os textos da turma.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Mesmo recorte da 471: a sessão de aula manda quando informada, e sessão em
  -- curso termina agora.
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
  SELECT t.etapa, t.documento, t.documento_id, t.filial, t.responsavel,
         t.campo, t.texto, t.contexto
    FROM (

    -- ── REQUISIÇÃO: o que foi pedido ────────────────────────────────────────
    SELECT 'Requisição'::text AS etapa,
           COALESCE(r.numero, left(r.id::text, 8))::text AS documento,
           r.id AS documento_id, r.filial::text AS filial,
           COALESCE(p.nome, r.solicitante, '—')::text AS responsavel,
           'Descrição do item'::text AS campo,
           trim(r.item)::text AS texto,
           ('Pediu ' || trim(to_char(COALESCE(r.qtd, 0), 'FM999G999G990D0')) || ' ' ||
            COALESCE(r.unidade, '?') ||
            COALESCE(' · centro de custo ' || NULLIF(trim(r.centro_custo), ''), '') ||
            ' · compra ' || lower(COALESCE(r.tipo_requisicao, 'Eventual')))::text AS contexto,
           r.created_at AS quando
      FROM public.requisicoes r
      LEFT JOIN public.user_profiles p ON p.id = r.criado_por
     WHERE COALESCE(r.ativo, true)
       AND r.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR r.filial = p_filial)
       AND length(trim(COALESCE(r.item, ''))) >= 3   -- abaixo disso já é achado da 471

    UNION ALL

    -- ── REQUISIÇÃO: por que foi pedido ──────────────────────────────────────
    -- Só a compra eventual justifica (migr. 354/358/359). Reposição se explica
    -- pelo estoque mínimo, e cobrar prosa dela seria cobrar o que a tela não pede.
    SELECT 'Requisição'::text,
           COALESCE(r.numero, left(r.id::text, 8))::text,
           r.id, r.filial::text,
           COALESCE(p.nome, r.solicitante, '—')::text,
           'Justificativa'::text,
           trim(r.justificativa)::text,
           ('Justifica a compra eventual de: ' ||
            COALESCE(NULLIF(trim(r.item), ''), '(item em branco)'))::text,
           r.created_at
      FROM public.requisicoes r
      LEFT JOIN public.user_profiles p ON p.id = r.criado_por
     WHERE COALESCE(r.ativo, true)
       AND r.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR r.filial = p_filial)
       AND COALESCE(r.tipo_requisicao, 'Eventual') = 'Eventual'
       AND length(trim(COALESCE(r.justificativa, ''))) >= 1  -- vazia já é achado da 471

    UNION ALL

    -- ── COTAÇÃO: o motivo da devolução para correção (migr. 467) ────────────
    -- É o gerente escrevendo para o colaborador. "Refazer" não ensina ninguém a
    -- refazer o quê.
    SELECT 'Cotação'::text,
           COALESCE(c.numero, left(c.id::text, 8))::text,
           c.id, c.filial::text,
           COALESCE(p.nome, '—')::text,
           'Motivo da devolução'::text,
           trim(c.feedback)::text,
           ('Devolveu a cotação de ' || COALESCE(f.nome, 'fornecedor não informado') ||
            ' para o colaborador corrigir')::text,
           c.created_at
      FROM public.cotacoes c
      LEFT JOIN public.user_profiles p ON p.id = c.criado_por
      LEFT JOIN public.fornecedores f ON f.id = c.fornecedor_id
     WHERE COALESCE(c.ativo, true)
       AND c.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR c.filial = p_filial)
       AND length(trim(COALESCE(c.feedback, ''))) >= 1

    UNION ALL

    -- ── PEDIDO: descrição do item ───────────────────────────────────────────
    -- Só quando o aluno escreveu algo diferente do que veio da requisição —
    -- senão o mesmo texto seria julgado duas vezes, em dois documentos.
    SELECT 'Pedido'::text,
           COALESCE(pe.numero, left(pe.id::text, 8))::text,
           pe.id, pe.filial::text,
           COALESCE(p.nome, '—')::text,
           'Descrição do item'::text,
           trim(pe.item_descricao)::text,
           ('Pedido de ' || trim(to_char(COALESCE(pe.item_qtd, 0), 'FM999G999G990D0')) ||
            ' un para ' || COALESCE(f.nome, 'fornecedor não informado'))::text,
           pe.created_at
      FROM public.pedidos pe
      LEFT JOIN public.user_profiles p ON p.id = pe.criado_por
      LEFT JOIN public.fornecedores f ON f.id = pe.fornecedor_id
      LEFT JOIN public.requisicoes rq ON rq.id = pe.requisicao_id
     WHERE COALESCE(pe.ativo, true)
       AND pe.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR pe.filial = p_filial)
       AND length(trim(COALESCE(pe.item_descricao, ''))) >= 3
       AND trim(COALESCE(pe.item_descricao, '')) IS DISTINCT FROM trim(COALESCE(rq.item, ''))

    UNION ALL

    -- ── RECEBIMENTO: a observação da divergência ────────────────────────────
    SELECT 'Recebimento'::text,
           left(rec.id::text, 8)::text,
           rec.id, rec.filial::text,
           COALESCE(p.nome, '—')::text,
           'Observação'::text,
           trim(rec.observacao)::text,
           (CASE
              WHEN pe.id IS NOT NULL
               AND COALESCE(rec.qtd_recebida, 0) <> COALESCE(pe.item_qtd, 0)
              THEN 'Explica a divergência: recebeu ' ||
                   trim(to_char(COALESCE(rec.qtd_recebida, 0), 'FM999G999G990D0')) ||
                   ' de ' || trim(to_char(COALESCE(pe.item_qtd, 0), 'FM999G999G990D0')) ||
                   ' pedidos'
              ELSE 'Recebimento sem divergência de quantidade'
            END)::text,
           rec.created_at
      FROM public.recebimentos rec
      LEFT JOIN public.user_profiles p ON p.id = rec.criado_por
      LEFT JOIN public.pedidos pe ON pe.id = rec.pedido_id
     WHERE COALESCE(rec.ativo, true)
       AND rec.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR rec.filial = p_filial)
       AND length(trim(COALESCE(rec.observacao, ''))) >= 1

    UNION ALL

    -- ── PRODUTO: o nome, contra o catálogo que já existe ────────────────────
    SELECT 'Produto'::text,
           COALESCE(NULLIF(trim(pr.codigo), ''), left(pr.id::text, 8))::text,
           pr.id, pr.filial::text,
           COALESCE(p.nome, '—')::text,
           'Nome do produto'::text,
           trim(pr.nome)::text,
           ('Categoria: ' || COALESCE(NULLIF(trim(cat.nome), ''), NULLIF(trim(pr.categoria), ''),
                                      '(sem categoria)') ||
            COALESCE(' · marca ' || NULLIF(trim(pr.marca), ''), '') ||
            ' · ' || COALESCE(pr.unidade, '?') ||
            COALESCE(' · já no catálogo desta unidade: ' || sim.parecidos, ''))::text,
           pr.created_at
      FROM public.produtos pr
      LEFT JOIN public.user_profiles p ON p.id = pr.criado_por
      LEFT JOIN public.categorias_produto cat ON cat.id = pr.categoria_id
      LEFT JOIN LATERAL (
        SELECT string_agg(v.nome, ' / ') AS parecidos
          FROM (SELECT o.nome
                  FROM public.produtos o
                 WHERE o.id <> pr.id
                   AND COALESCE(o.ativo, true) AND o.excluido_em IS NULL
                   AND o.filial IS NOT DISTINCT FROM pr.filial
                   AND similarity(o.nome, pr.nome) > 0.35
                 ORDER BY similarity(o.nome, pr.nome) DESC
                 LIMIT 3) v
      ) sim ON true
     WHERE COALESCE(pr.ativo, true) AND pr.excluido_em IS NULL
       AND pr.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR pr.filial = p_filial)
       AND length(trim(COALESCE(pr.nome, ''))) >= 3

    UNION ALL

    -- ── FORNECEDOR: o mesmo fornecedor escrito de duas maneiras ─────────────
    SELECT 'Fornecedor'::text,
           left(fo.id::text, 8)::text,
           fo.id, fo.filial::text,
           COALESCE(p.nome, '—')::text,
           'Nome do fornecedor'::text,
           trim(fo.nome)::text,
           (COALESCE('Ramo: ' || NULLIF(trim(fo.categoria), ''), 'Sem ramo informado') ||
            COALESCE(' · ' || NULLIF(trim(fo.cidade), ''), '') ||
            COALESCE(' · CNPJ/CPF ' || NULLIF(trim(fo.cpf_cnpj), ''), ' · sem CNPJ') ||
            COALESCE(' · já cadastrados com nome parecido: ' || sim.parecidos, ''))::text,
           fo.created_at
      FROM public.fornecedores fo
      LEFT JOIN public.user_profiles p ON p.id = fo.criado_por
      LEFT JOIN LATERAL (
        SELECT string_agg(v.nome, ' / ') AS parecidos
          FROM (SELECT o.nome
                  FROM public.fornecedores o
                 WHERE o.id <> fo.id
                   AND COALESCE(o.ativo, true) AND o.excluido_em IS NULL
                   AND o.filial IS NOT DISTINCT FROM fo.filial
                   AND similarity(o.nome, fo.nome) > 0.35
                 ORDER BY similarity(o.nome, fo.nome) DESC
                 LIMIT 3) v
      ) sim ON true
     WHERE COALESCE(fo.ativo, true) AND fo.excluido_em IS NULL
       AND fo.created_at BETWEEN v_de AND v_ate
       AND (p_filial IS NULL OR fo.filial = p_filial)
       AND length(trim(COALESCE(fo.nome, ''))) >= 3

    ) t
   -- Ordenado por aluno de propósito: quem consome isto reparte o teto do
   -- prompt em rodadas (o 1º texto de cada aluno, depois o 2º...), e para isso
   -- precisa das linhas agrupadas por responsável. `p_limite` aqui é só a rede
   -- de segurança contra uma turma que escreveu muito mais do que cabe.
   ORDER BY t.responsavel, t.quando, t.etapa
   LIMIT v_limite;
END;
$function$;

REVOKE ALL ON FUNCTION public.coletar_textos_fluxo(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coletar_textos_fluxo(uuid, timestamptz, timestamptz, text, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.coletar_textos_fluxo(uuid, timestamptz, timestamptz, text, integer) IS
  'Migr. 472 — camada 2 da conferência do fluxo: separa os textos livres escritos na sessão de aula (com contexto e vizinhos parecidos do catálogo) para o MaxAI julgar qualidade. Não julga nada. Só role=admin ou service_role.';

COMMIT;

-- Verificação:
--
--   -- Corpus de uma aula (deve trazer só texto preenchido, nunca campo vazio):
--   SELECT etapa, campo, texto, contexto FROM coletar_textos_fluxo('<id da sessão>');
--
--   -- Não pode sobrepor a 471: nada abaixo do mínimo que a camada objetiva já acusa.
--   SELECT count(*) FROM coletar_textos_fluxo('<id>') WHERE length(trim(texto)) = 0;  -- 0
--
--   -- Aluno não pode chamar (deve levantar P0001):
--   SELECT * FROM coletar_textos_fluxo();  -- logado como colaborador/CEO
