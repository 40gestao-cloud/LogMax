-- 538 — Duas propostas vivas do mesmo fornecedor não são comparação de preço.
--
-- A migr. 537 pôs um cadeado na tela: enquanto um aluno cota a requisição 12
-- no Atacadão, o Atacadão aparece travado para os colegas naquela requisição.
-- Mas aquele cadeado é RASCUNHO — vive numa tabela com prazo de 3 minutos, e
-- some sozinho se a aba fechar. Ele evita trabalho duplicado; não é ele que
-- garante que o duplicado não exista.
--
-- Esta migração fecha o invariante onde ele pertence: na tabela real. É a
-- mesma divisão que a migr. 481 fixou para o número do produto —
--
--     "A reserva NÃO é o que garante unicidade: quem garante continua sendo
--      o índice único parcial."
--
-- — e a razão de não ter virado gatilho sobre `trabalho_reservas`: uma reserva
-- que vence por queda de rede faria o banco recusar o Salvar de quem estava
-- com o formulário cheio, que é o pior momento possível para descobrir
-- qualquer coisa.
--
-- ─── O QUE É PROIBIDO, E O QUE CONTINUA PERMITIDO ──────────────────────────
--
-- Proibido: duas propostas VIVAS da mesma requisição com o mesmo fornecedor.
-- Isso não é comparar preço — é digitar a mesma coisa duas vezes.
--
-- Permitido, de propósito:
--   · Vários fornecedores DIFERENTES na mesma requisição. É o exercício.
--     Travar isso mataria o botão "comparar propostas" e a régua de 3
--     propostas que a própria tela recomenda.
--   · Recotar o mesmo fornecedor depois de 'Negado' ou 'Cancelado'. Recusada
--     a proposta, voltar ao mesmo fornecedor com outro preço é negociação
--     normal — por isso o predicado lista os status VIVOS em vez de escrever
--     `<> 'Cancelado'`, que deixaria 'Negado' preso.
--
-- Vivos são os três de `STATUS_VIVOS` em `src/views/CotacoesView.tsx`:
-- 'Aguardando Financeiro', 'Em correção', 'Aprovado'. Se essa lista mudar lá,
-- muda aqui — são a mesma régua escrita duas vezes, e é dívida assumida.
--
-- ─── POR QUE ÍNDICE **E** GATILHO ──────────────────────────────────────────
--
-- O índice é quem garante. Um gatilho sozinho tem corrida: dois INSERTs
-- simultâneos passam os dois pelo `EXISTS` antes de qualquer um gravar, e os
-- dois entram — exatamente o cenário de turma cheia da migr. 469/470.
--
-- O gatilho é quem EXPLICA. Índice violado devolve 23505 cru
-- ("duplicate key value violates unique constraint..."), que não diz ao aluno
-- qual fornecedor, quem já cotou, nem o que fazer. O gatilho roda antes, no
-- caso normal, e levanta a frase legível; o índice fica de rede para a
-- corrida rara. Mesmo par de responsabilidades da 481.
--
-- Formato do gatilho copiado de `cotacoes_unica_aprovada` (a função irmã,
-- nesta mesma tabela): early-return, `EXISTS` com `id <> NEW.id`, ERRCODE
-- 'P0001'. Ordem alfabética conferida — `trg_cotacao_proposta_unica_...` cai
-- depois de `trg_cotacao_marca_so_na_eventual` e antes de
-- `trg_cotacoes_unica_aprovada`, e nenhum gatilho BEFORE anterior reescreve
-- `NEW.status` (só `marca`), então a régua lê o status certo.
--
-- ─── SONDA ANTES DE APLICAR ────────────────────────────────────────────────
--
-- Violações com o predicado EXATO do índice, nos 4 projetos: 0 / 0 / 0 / 0.
-- `cotacoes.ativo` é NOT NULL DEFAULT true nos 4, então `WHERE ativo` no
-- índice não diverge do `COALESCE(ativo, true)` que o app usa.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ─── Quem garante ───────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotacao_viva_requisicao_fornecedor
  ON public.cotacoes (requisicao_id, fornecedor_id)
  WHERE ativo
    AND requisicao_id IS NOT NULL
    AND fornecedor_id IS NOT NULL
    AND status IN ('Aguardando Financeiro', 'Em correção', 'Aprovado');

COMMENT ON INDEX public.uq_cotacao_viva_requisicao_fornecedor IS
  'Uma proposta viva por (requisição, fornecedor). Comparar preço é fornecedor '
  'DIFERENTE; o mesmo fornecedor duas vezes é digitação repetida. Negado e '
  'Cancelado ficam fora para permitir recotação. Migr. 538.';

-- ─── Quem explica ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cotacao_proposta_unica_por_fornecedor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_forn  text;
  v_quem  text;
  v_num   text;
BEGIN
  IF NEW.requisicao_id IS NULL
     OR NEW.fornecedor_id IS NULL
     OR NEW.ativo IS NOT TRUE
     OR NEW.status NOT IN ('Aguardando Financeiro', 'Em correção', 'Aprovado') THEN
    RETURN NEW;
  END IF;

  -- UPDATE que já estava vivo com o MESMO par não precisa revalidar: aprovar
  -- uma proposta ('Aguardando Financeiro' → 'Aprovado') não cria par novo, e
  -- revalidar ali faria a própria linha colidir consigo mesma pela janela de
  -- quem só mudou de status.
  IF TG_OP = 'UPDATE'
     AND OLD.ativo IS TRUE
     AND OLD.status IN ('Aguardando Financeiro', 'Em correção', 'Aprovado')
     AND OLD.requisicao_id  IS NOT DISTINCT FROM NEW.requisicao_id
     AND OLD.fornecedor_id  IS NOT DISTINCT FROM NEW.fornecedor_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.numero, 'sem número'),
         COALESCE(p.nome, 'outra pessoa')
    INTO v_num, v_quem
    FROM public.cotacoes c
    LEFT JOIN public.user_profiles p ON p.id = c.criado_por
   WHERE c.requisicao_id = NEW.requisicao_id
     AND c.fornecedor_id = NEW.fornecedor_id
     AND c.id <> NEW.id
     AND c.ativo
     AND c.status IN ('Aguardando Financeiro', 'Em correção', 'Aprovado')
   LIMIT 1;

  IF v_num IS NULL THEN
    RETURN NEW;
  END IF;

  -- SECURITY DEFINER: o nome do fornecedor e o do colega saem por cima da RLS
  -- de propósito. "Já existe uma proposta" sem dizer de quem nem de qual
  -- fornecedor não ajuda ninguém a decidir o que fazer em seguida.
  SELECT nome INTO v_forn FROM public.fornecedores WHERE id = NEW.fornecedor_id;

  RAISE EXCEPTION
    'A proposta % de % para esta requisição já foi cadastrada por %. Comparar preço é cotar fornecedores DIFERENTES — escolha outro fornecedor, ou cancele a proposta anterior antes de repetir este.',
    v_num, COALESCE(v_forn, 'deste fornecedor'), v_quem
    USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS trg_cotacao_proposta_unica_fornecedor ON public.cotacoes;
CREATE TRIGGER trg_cotacao_proposta_unica_fornecedor
  BEFORE INSERT OR UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.cotacao_proposta_unica_por_fornecedor();

COMMIT;

-- Verificação:
--
--   -- Deve devolver 0 nos 4 projetos (senão o índice não sobe):
--   SELECT count(*) FROM (
--     SELECT requisicao_id, fornecedor_id FROM cotacoes
--      WHERE ativo AND requisicao_id IS NOT NULL AND fornecedor_id IS NOT NULL
--        AND status IN ('Aguardando Financeiro','Em correção','Aprovado')
--      GROUP BY 1,2 HAVING count(*) > 1) x;
--
--   -- Aprovar uma proposta viva NÃO pode disparar a régua (o par não muda).
--   -- Recotar fornecedor de proposta 'Negado'/'Cancelado' TEM de passar.
