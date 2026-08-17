-- 451_20260817_o_que_foi_apagado_passa_a_ter_volta.sql
--
-- APAGAR ERA DEFINITIVO POR FORA E ETERNO POR DENTRO.
--
-- O app apaga cadastro por soft-delete: `ativo = false` e a linha some da tela.
-- Duas metades faltavam, e as duas apareceram na auditoria de 17/08.
--
-- **Não havia volta.** Quem apagou por engano recadastra do zero — e foi o que
-- aconteceu na TechMax: "Iphone 17 Pro Max" código 01 nasceu 14:38, recebeu
-- 10+7 aparelhos, foi apagado 14:45 e recadastrado 14:50 com o mesmo código e
-- outro EAN, repetindo as duas entradas. O mesmo aparelho implantado duas
-- vezes porque não existia o botão "restaurar".
--
-- **Nada saía do banco.** Hoje há 10 produtos apagados carregando 465 unidades
-- de estoque e 17 movimentações ainda ativas. Não corrompe número — DRE, BI e
-- as telas filtram `ativo` —, mas é lixo que ninguém consegue nem ver nem
-- tirar, e que cresce a cada turma.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO NÃO FAZ
--
-- Não é uma lixeira genérica das 102 tabelas com coluna `ativo`. São seis, as
-- do catálogo e dos cadastros, que é onde os 10 registros apagados de fato
-- estão e onde o aluno erra. Documento (pedido, conta, requisição) já tem
-- regra própria dizendo que não se apaga — `documento_sem_exclusao` e
-- `conta_com_dinheiro_nao_exclui` — e esta migração não fura nenhuma delas.
--
-- A lista é branca e literal, nunca `tabela NOT IN (...)`: tabela nova nasce
-- de fora, e entra quando alguém decidir que entra.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O EXPURGO PERGUNTA AO GRAFO DE FK, E NÃO A UMA LISTA
--
-- `produtos` é referenciada por 16 tabelas, e 99 das 372 chaves estrangeiras
-- do banco são `ON DELETE CASCADE`. Apagar de vez um produto já vendido
-- levaria junto suas `produto_unidades` e deixaria `itens_venda.produto_id`
-- nulo — o custo carimbado na venda (migr. 425) perde o dono e o CMV de um mês
-- FECHADO muda depois de fechado. Erro caro e silencioso em estado puro.
--
-- Então o expurgo não confia em lista de exceções escrita à mão: pergunta ao
-- `pg_constraint` quem aponta para a linha, uma tabela por vez, e só apaga se
-- ninguém apontar. FK criada amanhã já entra na conta sozinha — lista fixa
-- envelhece calada, como o gatilho anti-privesc já ensinou.
--
-- A pergunta é afirmativa ("está livre?"), não negativa ("não é dos tipos
-- proibidos?"). Quando houver vínculo, a RPC diz QUAL tabela e QUANTAS linhas,
-- e a decisão volta para quem sabe o que aquilo era.
--
-- RESTAURAR TAMBÉM PODE FALHAR, E TEM DE FALHAR FALANDO
--
-- Os índices únicos de `produtos` são parciais em `ativo = true`:
-- `(filial, codigo)`, `(filial, ean)` e a variante da 445. Restaurar o iPhone
-- código 01 colide na hora com o que ocupou o lugar dele às 14:50. Um 23505
-- cru na tela ("duplicate key value violates unique constraint") não ajuda
-- ninguém — a RPC captura e devolve o que aconteceu em português, dizendo que
-- outro registro ocupa a vaga.
--
-- QUEM ABRE A LIXEIRA
--
-- `auth_user_role() = 'admin'` literal, como o Cofre de Senhas (409) e a
-- escrita de Usuários (410). `auth_is_admin()` incluiria CEO e conselheiro,
-- que são ALUNOS: restaurar e expurgar cadastro alheio não é jogada da
-- competição.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. Quem apagou, e quando ────────────────────────────────────────────────
--
-- `updated_at` não serve: qualquer edição posterior o sobrescreve, e a lixeira
-- passaria a mentir a data. Duas colunas próprias, preenchidas só na travessia
-- ativo → inativo.

ALTER TABLE public.produtos              ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.produtos              ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.fornecedores          ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.fornecedores          ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.clientes              ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.clientes              ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.categorias_produto    ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.categorias_produto    ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.subcategorias_produto ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.subcategorias_produto ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.servicos              ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.servicos              ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE OR REPLACE FUNCTION public.fn_carimba_exclusao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(OLD.ativo, true) AND NOT COALESCE(NEW.ativo, true) THEN
    NEW.excluido_em  := now();
    NEW.excluido_por := auth.uid();
  ELSIF NOT COALESCE(OLD.ativo, true) AND COALESCE(NEW.ativo, true) THEN
    NEW.excluido_em  := NULL;
    NEW.excluido_por := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_carimba_exclusao() IS
  'Carimba quem apagou e quando na travessia ativo → inativo, e limpa o carimbo na volta (migr. 451). No gatilho, não na tela: exclusão por F12 ou por SQL também precisa de autor.';

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['produtos','fornecedores','clientes',
                           'categorias_produto','subcategorias_produto','servicos']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_carimba_exclusao ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_carimba_exclusao BEFORE UPDATE OF ativo ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_carimba_exclusao()', t);
  END LOOP;
END
$do$;

-- Registros apagados ANTES desta migração não têm carimbo e não há de onde
-- tirar: `updated_at` pode ter sido tocado depois. Ficam com data nula, e a
-- tela diz "data desconhecida" em vez de inventar uma.

-- ── 2. A régua de quem pode e do que entra ──────────────────────────────────

CREATE OR REPLACE FUNCTION public._lixeira_tabelas()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT ARRAY['produtos', 'fornecedores', 'clientes',
               'categorias_produto', 'subcategorias_produto', 'servicos']
$function$;

COMMENT ON FUNCTION public._lixeira_tabelas() IS
  'Lista BRANCA das tabelas que a lixeira enxerga (migr. 451). Tabela nova nasce de fora — incluir é decisão, não efeito colateral.';

CREATE OR REPLACE FUNCTION public._assert_lixeira(p_tabela text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._assert_rpc();

  -- Literal, não auth_is_admin(): CEO e conselheiro são alunos.
  IF COALESCE(public.auth_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'A lixeira é do administrador do sistema.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tabela IS NULL OR NOT (p_tabela = ANY (public._lixeira_tabelas())) THEN
    RAISE EXCEPTION 'A lixeira não cobre "%". Cobertura atual: %.',
      COALESCE(p_tabela, '(vazio)'),
      array_to_string(public._lixeira_tabelas(), ', ')
      USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- ── 3. Quem ainda aponta para a linha ───────────────────────────────────────
--
-- A resposta vem do catálogo do Postgres, não de uma lista deste arquivo.

CREATE OR REPLACE FUNCTION public.lixeira_vinculos(p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fk    record;
  v_n     bigint;
  v_out   jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);

  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tabela_filha,
           a.attname                  AS coluna
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum   = c.conkey[1]
     WHERE c.contype  = 'f'
       AND c.confrelid = ('public.' || p_tabela)::regclass
       -- FK composta não existe hoje nestas seis; se surgir, é melhor não
       -- responder do que responder pela metade.
       AND array_length(c.conkey, 1) = 1
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.tabela_filha, v_fk.coluna)
      INTO v_n USING p_id;

    IF v_n > 0 THEN
      v_out := v_out || jsonb_build_object('tabela', v_fk.tabela_filha, 'linhas', v_n);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.lixeira_vinculos(text, uuid) IS
  'Quem ainda referencia esta linha, perguntado ao pg_constraint (migr. 451). FK criada depois entra na conta sozinha.';

-- ── 4. O que está na lixeira ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lixeira_listar(p_tabela text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tabelas text[];
  v_t       text;
  v_linhas  jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_tem_fil boolean;
BEGIN
  IF p_tabela IS NULL THEN
    PERFORM public._assert_lixeira('produtos');   -- só para checar o papel
    v_tabelas := public._lixeira_tabelas();
  ELSE
    PERFORM public._assert_lixeira(p_tabela);
    v_tabelas := ARRAY[p_tabela];
  END IF;

  FOREACH v_t IN ARRAY v_tabelas LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_t AND column_name = 'filial'
    ) INTO v_tem_fil;

    EXECUTE format($q$
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'tabela',      %L,
               'id',          x.id,
               'nome',        x.nome,
               'filial',      %s,
               'excluido_em', x.excluido_em,
               'excluido_por', (SELECT nome FROM public.user_profiles u WHERE u.id = x.excluido_por),
               'vinculos',    public.lixeira_vinculos(%L, x.id)
             ) ORDER BY x.excluido_em DESC NULLS LAST), '[]'::jsonb)
        FROM public.%I x
       WHERE x.ativo = false
    $q$, v_t, CASE WHEN v_tem_fil THEN 'x.filial' ELSE 'NULL::text' END, v_t, v_t)
    INTO v_linhas;

    v_out := v_out || v_linhas;
  END LOOP;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.lixeira_listar(text) IS
  'Cadastros apagados, com autor, data e os vínculos que impedem o expurgo (migr. 451). Só role admin literal.';

-- ── 5. Restaurar ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lixeira_restaurar(p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
  v_n    int;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);

  EXECUTE format('SELECT nome FROM public.%I WHERE id = $1 AND ativo = false', p_tabela)
    INTO v_nome USING p_id;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Registro não está na lixeira (ou já foi restaurado).'
      USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    EXECUTE format('UPDATE public.%I SET ativo = true WHERE id = $1', p_tabela)
      USING p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION
    WHEN unique_violation THEN
      -- Índice único parcial em `ativo = true` (código, EAN, variante): entre
      -- apagar e restaurar, outro cadastro ocupou a vaga. Dizer isso vale mais
      -- que o 23505 cru — é literalmente o caso do iPhone código 01.
      RAISE EXCEPTION
        'Não dá para restaurar "%": outro cadastro ativo já ocupa a identificação dele (código, EAN ou variante). Renomeie ou apague o que está no lugar, e tente de novo.',
        v_nome USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object('restaurado', v_n, 'nome', v_nome);
END;
$function$;

COMMENT ON FUNCTION public.lixeira_restaurar(text, uuid) IS
  'Devolve o cadastro à operação (migr. 451). Colisão de índice único parcial vira mensagem, não 23505.';

-- ── 6. Apagar de vez ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lixeira_expurgar(p_tabela text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome     text;
  v_vinculos jsonb;
  v_texto    text;
  v_n        int;
BEGIN
  PERFORM public._assert_lixeira(p_tabela);

  EXECUTE format('SELECT nome FROM public.%I WHERE id = $1', p_tabela)
    INTO v_nome USING p_id;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Só sai de vez o que já está na lixeira. Expurgar direto da operação seria
  -- pular a única etapa em que dá para mudar de ideia.
  EXECUTE format('SELECT count(*) FROM public.%I WHERE id = $1 AND ativo = false', p_tabela)
    INTO v_n USING p_id;

  IF v_n = 0 THEN
    RAISE EXCEPTION
      '"%" ainda está em uso. Apague o cadastro primeiro; da lixeira ele sai de vez.',
      v_nome USING ERRCODE = 'P0001';
  END IF;

  v_vinculos := public.lixeira_vinculos(p_tabela, p_id);

  IF jsonb_array_length(v_vinculos) > 0 THEN
    SELECT string_agg(
             (e->>'tabela') || ' (' || (e->>'linhas') || ')', ', '
             ORDER BY (e->>'tabela'))
      INTO v_texto
      FROM jsonb_array_elements(v_vinculos) e;

    RAISE EXCEPTION
      'Não dá para apagar "%" de vez: ainda existe histórico ligado a ele em %. Apagar levaria esse histórico junto e mudaria resultado de mês já fechado. O registro continua na lixeira.',
      v_nome, v_texto USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_tabela) USING p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('apagado', v_n, 'nome', v_nome);
END;
$function$;

COMMENT ON FUNCTION public.lixeira_expurgar(text, uuid) IS
  'DELETE real, e só quando ninguém aponta para a linha (migr. 451). A pergunta é afirmativa — "está livre?" — respondida pelo grafo de FK vigente.';

-- ── 7. Quem executa ─────────────────────────────────────────────────────────
--
-- REVOKE FROM public não basta: `anon` recebe o EXECUTE por conta própria e
-- precisa ser nomeado.

REVOKE ALL ON FUNCTION public._lixeira_tabelas()                    FROM public, anon;
REVOKE ALL ON FUNCTION public._assert_lixeira(text)                 FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_vinculos(text, uuid)          FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_listar(text)                  FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_restaurar(text, uuid)         FROM public, anon;
REVOKE ALL ON FUNCTION public.lixeira_expurgar(text, uuid)          FROM public, anon;

GRANT EXECUTE ON FUNCTION public.lixeira_vinculos(text, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lixeira_listar(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lixeira_restaurar(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lixeira_expurgar(text, uuid)  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. as quatro RPCs e o gatilho nas seis tabelas
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('lixeira_listar','lixeira_restaurar','lixeira_expurgar','lixeira_vinculos')
--    ORDER BY 1;                                        -- esperado: 4 linhas
--   SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname = 'trg_carimba_exclusao' ORDER BY 1; -- esperado: 6 linhas
--
--   -- 2. nenhuma delas aberta para anônimo — esperado: zero linhas
--   SELECT p.proname FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'lixeira%'
--      AND has_function_privilege('anon', p.oid, 'EXECUTE');
--
--   -- 3. o que a lixeira mostra hoje (como admin)
--   SELECT jsonb_pretty(public.lixeira_listar());
--
--   -- 4. o passivo que motivou tudo: apagados carregando estoque
--   SELECT nome, filial, estoque, excluido_em FROM produtos
--    WHERE NOT ativo AND COALESCE(estoque, 0) > 0 ORDER BY estoque DESC;
--
-- Os 10 apagados de hoje entram na lixeira sem data de exclusão — o carimbo
-- só existe a partir daqui. A tela mostra "data desconhecida"; inventar a data
-- a partir de `updated_at` seria dar ares de fato a um palpite.
--
-- O teste que vale a aula: apagar uma categoria nova, restaurá-la, apagar de
-- novo e tentar "apagar de vez" — sai. Depois tentar o mesmo com uma categoria
-- que tem produto: a tela diz quantos produtos a seguram.
-- =================================================================
