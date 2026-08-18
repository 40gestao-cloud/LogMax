-- 456_20260817_conteudo_de_embalagem_sem_medida_nao_entra_mais.sql
--
-- A TELA COBRAVA A MEDIDA. O BANCO, NÃO.
--
-- A migr. 438 separou o conteúdo da embalagem da unidade de estoque e pôs um
-- seletor de medida ao lado do número. Mas a obrigatoriedade ficou só no
-- formulário: `chk_produtos_peso_unidade_orfa` garante o lado inverso —
-- medida sem número não entra — e deixa passar o que importa, que é **número
-- sem medida**.
--
--   CHECK (peso IS NOT NULL OR peso_unidade IS NULL)
--
-- Leia de novo: peso = 1 com peso_unidade = NULL satisfaz. É exatamente a
-- linha que existe hoje em quatro arrozes da SuperMax, e exatamente a
-- ambiguidade que a 438 dizia ter encerrado — "1" que pode ser um quilo ou um
-- grama, e a ficha do produto imprimindo "1 (unidade não informada)".
--
-- Toda regra de dinheiro e de medida precisa existir no banco; a tela é
-- conveniência. Enquanto for só do formulário, uma correção por SQL, uma carga
-- ou o F12 reabrem o buraco — e o cadastro é a porta de entrada de tudo que
-- vem depois: preço por quilo, comparação de fornecedor, ficha de prateleira.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AS TRÊS INCOERÊNCIAS QUE PASSAM HOJE
--
--   1. Número sem medida.        peso = 1,    peso_unidade = NULL
--   2. Medida com número zerado. peso = 0,    peso_unidade = 'KG'
--   3. Granel com embalagem.     unidade = 'KG' e peso = 5 KG
--
-- A terceira é a mais silenciosa. Item vendido a granel JÁ é a medida — banana
-- a quilo não tem "peso por embalagem" —, e foi pedir isso que encheu a coluna
-- de `1` repetido antes da 438. A tela esconde o campo nesse caso
-- (`temConteudoDeEmbalagem`); o banco aceitava numa boa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- `NOT VALID`, E POR QUÊ
--
-- Os quatro arrozes com número sem medida continuam na base — soft-delete não
-- apaga linha, então nem excluí-los pela tela faria o CHECK passar. `NOT VALID`
-- é o que o projeto já usa em `chk_contas_receber_status`: vale para tudo que
-- entrar ou for alterado daqui em diante, e não exige limpar o passado antes.
--
-- É a escolha certa aqui por um motivo além do prático: a régua nova não pode
-- travar a turma por causa de dado que ela criou aprendendo. O passivo fica
-- visível na ficha do produto, que já diz "unidade não informada" em vez de
-- chutar quilo.
--
-- A FUNÇÃO EM VEZ DA LISTA REPETIDA
--
-- `unidade_fracionaria()` nasce aqui porque o CHECK precisa da régua e o
-- TypeScript não roda no Postgres. As duas cópias — `UNIDADES_FRACIONARIAS` em
-- `src/lib/unidades.ts` e esta — são inevitáveis, então ficam nomeadas e
-- comentadas uma apontando para a outra. Régua duplicada sem nome é como a
-- ficha de produto foi parar em três arquivos.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. A régua de granel, do lado SQL ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unidade_fracionaria(p_unidade text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Espelho de UNIDADES_FRACIONARIAS em src/lib/unidades.ts. Mudou lá, muda
  -- aqui — e vice-versa.
  SELECT upper(btrim(COALESCE(p_unidade, 'UN'))) IN ('KG', 'L', 'M', 'M²', 'M³')
$function$;

COMMENT ON FUNCTION public.unidade_fracionaria(text) IS
  'Unidade de estoque vendida a peso/medida (migr. 456). Espelho de UNIDADES_FRACIONARIAS em src/lib/unidades.ts — item assim JÁ é a medida e não tem conteúdo de embalagem.';

-- ── 2. Número e medida andam juntos ─────────────────────────────────────────
--
-- Substitui `chk_produtos_peso_unidade_orfa`, que cobria só metade. Um CHECK
-- simétrico no lugar de dois assimétricos: menos régua, e a que fica responde
-- a pergunta inteira.

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_peso_unidade_orfa;
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_peso_com_medida;

ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_peso_com_medida
  CHECK ((peso IS NULL) = (peso_unidade IS NULL))
  NOT VALID;

COMMENT ON CONSTRAINT chk_produtos_peso_com_medida ON public.produtos IS
  'Conteúdo de embalagem tem número E medida, ou nenhum dos dois (migr. 456). O CHECK anterior só barrava medida sem número — o inverso, que é o problema real, passava.';

-- ── 3. Conteúdo zerado não é conteúdo ───────────────────────────────────────

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_peso_positivo;

ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_peso_positivo
  CHECK (peso IS NULL OR peso > 0)
  NOT VALID;

COMMENT ON CONSTRAINT chk_produtos_peso_positivo ON public.produtos IS
  'Embalagem de 0 KG não existe (migr. 456). Sem conteúdo declarado a coluna fica nula, não zerada.';

-- ── 4. Granel não tem embalagem para medir ──────────────────────────────────

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_granel_sem_conteudo;

ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_granel_sem_conteudo
  CHECK (NOT public.unidade_fracionaria(unidade) OR peso IS NULL)
  NOT VALID;

COMMENT ON CONSTRAINT chk_produtos_granel_sem_conteudo ON public.produtos IS
  'Item vendido a peso já É a medida (migr. 456): banana a KG não tem conteúdo por embalagem. A tela já esconde o campo; aqui a regra passa a existir para quem entra por fora dela.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. as três restrições no lugar, e a antiga fora — esperado: 3 linhas
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conrelid = 'public.produtos'::regclass
--      AND conname IN ('chk_produtos_peso_com_medida',
--                      'chk_produtos_peso_positivo',
--                      'chk_produtos_granel_sem_conteudo',
--                      'chk_produtos_peso_unidade_orfa')
--    ORDER BY 1;
--
--   -- 2. o passivo que o NOT VALID deixou entrar — hoje: 4 arrozes da SuperMax
--   SELECT filial, nome, unidade, peso, peso_unidade FROM produtos
--    WHERE (peso IS NULL) <> (peso_unidade IS NULL)
--       OR (peso IS NOT NULL AND peso <= 0)
--       OR (public.unidade_fracionaria(unidade) AND peso IS NOT NULL)
--    ORDER BY filial, nome;
--
--   -- 3. a régua nova barra de verdade — esperado: as três dão erro
--   --    (rodar solto, fora de transação que você queira manter)
--   -- INSERT INTO produtos (nome, filial, peso) VALUES ('teste', 'SuperMax', 1);
--   -- INSERT INTO produtos (nome, filial, peso, peso_unidade) VALUES ('teste', 'SuperMax', 0, 'KG');
--   -- INSERT INTO produtos (nome, filial, unidade, peso, peso_unidade) VALUES ('teste', 'SuperMax', 'KG', 5, 'KG');
--
-- Quando a turma limpar os produtos de treinamento e a sonda 2 vier vazia, dá
-- para validar as três de uma vez e a régua passa a valer também para trás:
--
--   ALTER TABLE public.produtos VALIDATE CONSTRAINT chk_produtos_peso_com_medida;
--   ALTER TABLE public.produtos VALIDATE CONSTRAINT chk_produtos_peso_positivo;
--   ALTER TABLE public.produtos VALIDATE CONSTRAINT chk_produtos_granel_sem_conteudo;
-- =================================================================
