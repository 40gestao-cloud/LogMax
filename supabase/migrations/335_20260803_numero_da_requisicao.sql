-- 335 — A requisição de compra ganha número.
--
-- É o único documento do fluxo sem identificador visível. Pedido aparece como
-- #A1B2C3, recebimento também, a conta a pagar nasce "Pedido #A1B2C3 — Toner".
-- A requisição, não: nas quatro telas em que aparece, o aluno a chama pelo nome
-- do item — e com duas pessoas pedindo toner na mesma semana, "a requisição do
-- toner" deixa de identificar alguma coisa.
--
-- Ficou mais grave depois do histórico (migr. 331/332): o modal de trilha e a
-- tela de Auditoria mostram os seis últimos caracteres do uuid, e não havia
-- como cruzar aquilo com nenhuma linha da lista. As telas passaram a falar uma
-- língua que o documento não falava.
--
-- Formato: REQ-SM-2026-0001 — prefixo de filial igual ao dos SKUs
-- (`src/lib/filiais.ts`), ano, e sequência que reinicia a cada ano, por filial.
-- É o que uma empresa tem: lê-se em voz alta, ordena sozinho e diz de quem é
-- sem precisar de contexto de tela.
--
-- Só a requisição nesta migração. Cotação e pedido seguem com o id curto até o
-- formato ser aprovado no uso — numerar os três de uma vez e depois mudar de
-- ideia custaria três backfills.

BEGIN;

-- ── Contador ────────────────────────────────────────────────────────────────
-- Tabela em vez de SEQUENCE: são N contadores (um por filial e ano) que
-- precisam reiniciar no virar do ano, e sequence não reinicia sozinha. O
-- UPSERT ... RETURNING trava a linha, então dois alunos criando ao mesmo tempo
-- recebem números diferentes.

CREATE TABLE IF NOT EXISTS public.documento_sequencias (
  entidade text    NOT NULL,
  filial   text    NOT NULL,
  ano      integer NOT NULL,
  ultimo   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (entidade, filial, ano)
);

ALTER TABLE public.documento_sequencias ENABLE ROW LEVEL SECURITY;
-- Sem policy alguma: ninguém lê nem escreve pela aplicação. Quem mexe é a
-- função abaixo, SECURITY DEFINER. Contador que o cliente alcança é contador
-- que o cliente reinicia.

CREATE OR REPLACE FUNCTION public.proximo_numero_documento(
  p_entidade text,
  p_filial   text,
  p_ano      integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seq integer;
BEGIN
  INSERT INTO public.documento_sequencias (entidade, filial, ano, ultimo)
  VALUES (p_entidade, p_filial, p_ano, 1)
  ON CONFLICT (entidade, filial, ano)
  DO UPDATE SET ultimo = public.documento_sequencias.ultimo + 1
  RETURNING ultimo INTO v_seq;

  RETURN v_seq;
END;
$function$;

REVOKE ALL ON FUNCTION public.proximo_numero_documento(text, text, integer) FROM PUBLIC, anon, authenticated;

-- ── Formato ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.formatar_numero_requisicao(
  p_filial text,
  p_ano    integer,
  p_seq    integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT 'REQ-' ||
         CASE p_filial
           WHEN 'SuperMax' THEN 'SM'
           WHEN 'MaxLook'  THEN 'ML'
           WHEN 'TechMax'  THEN 'TM'
           ELSE upper(left(COALESCE(p_filial, 'XX'), 2))
         END
         || '-' || p_ano::text || '-' || lpad(p_seq::text, 4, '0');
$function$;

-- ── Coluna e trigger ────────────────────────────────────────────────────────

ALTER TABLE public.requisicoes ADD COLUMN IF NOT EXISTS numero text;

CREATE OR REPLACE FUNCTION public.set_numero_requisicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ano integer;
BEGIN
  IF NEW.numero IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Ano do Acre, não do servidor: a partir das 19h locais o UTC já virou o dia
  -- seguinte, e em 31/12 isso emitiria a primeira requisição do ano que vem.
  v_ano := extract(year FROM COALESCE(NEW.data, public.acre_today()))::integer;

  NEW.numero := public.formatar_numero_requisicao(
    NEW.filial, v_ano,
    public.proximo_numero_documento('requisicoes', COALESCE(NEW.filial, 'XX'), v_ano));

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_numero_requisicao ON public.requisicoes;
CREATE TRIGGER trg_numero_requisicao
  BEFORE INSERT ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.set_numero_requisicao();

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Ordem de criação, por filial e ano: o número passa a contar a mesma história
-- que a data conta. Sem ordenar, o documento mais antigo poderia sair com o
-- número maior e o aluno concluiria que a numeração não significa nada.

WITH numerados AS (
  SELECT id,
         filial,
         extract(year FROM COALESCE(data, created_at::date))::integer AS ano,
         row_number() OVER (
           PARTITION BY filial, extract(year FROM COALESCE(data, created_at::date))
           ORDER BY created_at NULLS LAST, id
         )::integer AS seq
    FROM public.requisicoes
   WHERE numero IS NULL
)
UPDATE public.requisicoes r
   SET numero = public.formatar_numero_requisicao(n.filial, n.ano, n.seq)
  FROM numerados n
 WHERE n.id = r.id;

-- Contador continua de onde o backfill parou, senão a próxima requisição
-- nasceria como 0001 e colidiria com o índice único abaixo.
INSERT INTO public.documento_sequencias (entidade, filial, ano, ultimo)
SELECT 'requisicoes',
       filial,
       extract(year FROM COALESCE(data, created_at::date))::integer,
       count(*)::integer
  FROM public.requisicoes
 WHERE numero IS NOT NULL
 GROUP BY filial, extract(year FROM COALESCE(data, created_at::date))
ON CONFLICT (entidade, filial, ano)
DO UPDATE SET ultimo = greatest(public.documento_sequencias.ultimo, excluded.ultimo);

-- Único de verdade: número repetido em documento de compra é problema de
-- controle, não detalhe de tela.
CREATE UNIQUE INDEX IF NOT EXISTS idx_requisicoes_numero
  ON public.requisicoes (numero) WHERE numero IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- 1) Ninguém ficou sem número:
--   SELECT count(*) FROM requisicoes WHERE numero IS NULL;
--
--   -- 2) A ordem bate com a data:
--   SELECT numero, data, item FROM requisicoes
--    WHERE filial = 'SuperMax' ORDER BY numero LIMIT 10;
--
--   -- 3) O contador está à frente do maior número emitido:
--   SELECT * FROM documento_sequencias WHERE entidade = 'requisicoes';
