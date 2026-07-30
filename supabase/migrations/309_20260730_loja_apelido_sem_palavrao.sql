-- 309 — A loja online aceitava qualquer texto como identificação do comprador.
--
-- ACHADO, na turma aprendiz: dos 4 pedidos recebidos, dois vieram com apelido
-- de palavrão. O campo é livre e aparece na tela de Pedidos Online, que o
-- professor abre em sala e projeta.
--
-- ONDE O FILTRO PRECISA MORAR. Não adianta validar no front da loja: as lojas
-- são três repositórios separados, com 12 deploys, e cada um pode estar numa
-- versão diferente. Pior — a loja grava usando `service_role`, que passa por
-- cima de RLS, então policy também não alcança. Trigger é o único ponto que
-- vale para qualquer cliente, hoje e depois: dispara inclusive para
-- service_role.
--
-- POR QUE UMA TABELA E NÃO UMA LISTA DENTRO DA FUNÇÃO. A lista precisa ser
-- ajustada — cada turma inventa a sua, e nenhuma lista nasce pronta. Com
-- tabela, incluir uma palavra é um INSERT; com lista embutida, é substituir a
-- função inteira em 4 projetos.
--
-- CASAMENTO POR INÍCIO DE PALAVRA (`\m` no regex), não por substring. Substring
-- é o erro clássico: bloquearia "açúcar" por conter "cu" e "consulta" por
-- conter "cons...". Início de palavra pega as flexões que importam
-- ("piroca" → "pirocudo", "pirocão") sem pegar palavra inocente que apenas
-- contém a sequência no meio.
--
-- NORMALIZA antes de comparar: minúsculas, sem acento, e caracteres repetidos
-- colapsados ("piiiroca" → "piroca"). Não tenta resolver leetspeak — "p1r0ca"
-- passa. Filtro de palavrão é contenção, não muralha; o que ele evita é o
-- constrangimento acidental na tela projetada, e para o aluno que insiste
-- existe o botão de cancelar com motivo registrado.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

CREATE TABLE IF NOT EXISTS public.loja_palavras_bloqueadas (
  palavra    text PRIMARY KEY,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.loja_palavras_bloqueadas IS
  'Radicais barrados no apelido do comprador da loja online. O casamento é por '
  'início de palavra, então grave o RADICAL ("piroc"), não a flexão completa. '
  'Para liberar uma palavra sem perder o registro, use ativo = false. Migr. 309.';

ALTER TABLE public.loja_palavras_bloqueadas ENABLE ROW LEVEL SECURITY;

-- Leitura só para quem opera a loja; escrita só admin/CEO. A lista em si é
-- material sensível de sala de aula — não precisa estar exposta ao anon.
DROP POLICY IF EXISTS palavras_bloqueadas_select ON public.loja_palavras_bloqueadas;
CREATE POLICY palavras_bloqueadas_select ON public.loja_palavras_bloqueadas
  FOR SELECT TO authenticated USING (public.auth_in_setor('vendas', 'marketing'));

DROP POLICY IF EXISTS palavras_bloqueadas_write ON public.loja_palavras_bloqueadas;
CREATE POLICY palavras_bloqueadas_write ON public.loja_palavras_bloqueadas
  FOR ALL TO authenticated
  USING (public.auth_user_role() IN ('admin', 'ceo'))
  WITH CHECK (public.auth_user_role() IN ('admin', 'ceo'));

-- Radicais, não palavras inteiras — ver o cabeçalho. Lista inicial curta de
-- propósito: cada turma acrescenta o que aparecer.
INSERT INTO public.loja_palavras_bloqueadas (palavra) VALUES
  ('piroc'), ('caralh'), ('porra'), ('bucet'), ('fode'), ('fodid'),
  ('puta'), ('viado'), ('viadin'), ('bicha'), ('cuzao'), ('cuzudo'),
  ('merda'), ('bosta'), ('otari'), ('arrombad'), ('vagabund'), ('corno'),
  ('pau no cu'), ('xoxota'), ('boquete'), ('punhet'),
  ('escrot'), ('desgraca'), ('filho da puta'), ('fdp'), ('pqp'), ('krl'),
  ('cacete'), ('bunda'), ('peid'), ('tesao'), ('safad'),
  ('nazista'), ('macac'), ('preto imundo'), ('retardad'), ('mongol')
ON CONFLICT (palavra) DO NOTHING;

-- FORA da lista de propósito, e não por descuido:
--
--   'pinto' — sobrenome comuníssimo. Bloquearia "João Pinto".
--   'rola'  — o casamento por início de palavra pegaria "Rolando".
--
-- Nome real barrado é pior que palavrão passando: o aluno bloqueado não
-- entende o motivo e não tem como contornar, enquanto o palavrão que escapa
-- ainda tem o cancelamento com motivo registrado. Se a turma abusar dessas
-- duas, inclua — mas sabendo do custo.

-- ────────────────────────────────────────────────────────────────────────────
-- Normalização: minúsculas, sem acento, repetição colapsada
--
-- `unaccent` não está instalada em todos os projetos, e instalar extensão em 4
-- bancos por causa disto é desproporcional — `translate` resolve o alfabeto
-- português inteiro numa linha.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._normalizar_texto_loja(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT regexp_replace(
           translate(
             lower(COALESCE(p_texto, '')),
             'áàâãäéèêëíìîïóòôõöúùûüçñ',
             'aaaaaeeeeiiiiooooouuuucn'
           ),
           '(.)\1+', '\1', 'g'          -- piiiroca → piroca
         );
$function$;

CREATE OR REPLACE FUNCTION public.loja_apelido_limpo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_texto     text;
  v_ofensiva  text;
BEGIN
  -- `indicacao` entra junto: é outro campo livre da mesma tela, e não adianta
  -- fechar uma porta e deixar a do lado aberta.
  v_texto := public._normalizar_texto_loja(
               COALESCE(NEW.comprador_apelido, '') || ' ' || COALESCE(NEW.indicacao, '')
             );

  SELECT b.palavra INTO v_ofensiva
    FROM public.loja_palavras_bloqueadas b
   WHERE b.ativo
     -- \m = início de palavra. Pega "pirocudo" a partir de "piroc", e não pega
     -- "açúcar" por causa de "cu".
     AND v_texto ~ ('\m' || public._normalizar_texto_loja(b.palavra))
   LIMIT 1;

  IF v_ofensiva IS NOT NULL THEN
    RAISE EXCEPTION 'Escolha outro nome de identificação — este contém linguagem imprópria.'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(btrim(COALESCE(NEW.comprador_apelido, ''))) < 2 THEN
    RAISE EXCEPTION 'Informe um nome de identificação com pelo menos 2 caracteres.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- BEFORE INSERT OR UPDATE: o UPDATE também entra porque, sem ele, bastaria
-- criar limpo e editar depois.
DROP TRIGGER IF EXISTS trg_loja_apelido_limpo ON public.pedidos_online;
CREATE TRIGGER trg_loja_apelido_limpo
  BEFORE INSERT OR UPDATE OF comprador_apelido, indicacao ON public.pedidos_online
  FOR EACH ROW EXECUTE FUNCTION public.loja_apelido_limpo();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Deve devolver true nas duas primeiras e false na terceira (o teste que
--   -- prova que "açúcar" não é palavrão):
--   SELECT _normalizar_texto_loja('Pirocudo 2004') ~ '\mpiroc'   AS pega_flexao,
--          _normalizar_texto_loja('CARALHOO')      ~ '\mcaralh'  AS pega_caps,
--          _normalizar_texto_loja('açúcar cristal') ~ '\mcu'     AS falso_positivo;
--
--   -- Acrescentar palavra que a turma inventar (grave o RADICAL):
--   INSERT INTO loja_palavras_bloqueadas (palavra) VALUES ('novaraiz');
--
--   -- Liberar sem perder o registro:
--   UPDATE loja_palavras_bloqueadas SET ativo = false WHERE palavra = 'rola';
--
-- ATENÇÃO ao aplicar: os pedidos que JÁ existem com palavrão continuam como
-- estão — trigger não olha para trás. Na aprendiz são 2, e os dois já estão
-- cancelados. Se quiser limpá-los da tela, exclua pelo botão de lixeira.
-- ────────────────────────────────────────────────────────────────────────────
