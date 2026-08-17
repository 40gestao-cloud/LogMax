-- 444_20260817_o_imei_e_de_cada_aparelho_nao_do_modelo.sql
--
-- COM 5 IPHONES EM ESTOQUE NÃO HAVIA ONDE GUARDAR 5 IMEIs.
--
-- `produtos.atributos` é um JSONB por PRODUTO: modelo, cor, memória, tela. O
-- IMEI não é isso — é de cada aparelho. Cinco unidades do mesmo cadastro têm
-- cinco IMEIs diferentes, e um campo de produto só cabe um.
--
-- A ficha da TechMax tinha `requer_imei` desde a migr. 360. O campo não faz
-- nada, e **não pode fazer** como está modelado: não existe linha no banco
-- onde o número do aparelho caiba. A planilha modelo ainda prometia que "o PDV
-- pede o IMEI no fechamento da venda" — nunca pediu, e não teria onde guardar
-- a resposta.
--
-- Uma loja de celular sem controle de série não sabe qual aparelho vendeu para
-- quem: não honra garantia, não atende recall, não prova procedência de
-- seminovo e não acha o aparelho errado quando volta. É o cadastro mais
-- distante da realidade dos três, junto com a grade da MaxLook.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O MODELO: UMA LINHA POR APARELHO FÍSICO
--
-- `produto_unidades` — cada linha é um aparelho, com IMEI/serial próprio, que
-- nasce no recebimento e morre na venda. O saldo em `produtos.estoque` continua
-- sendo a verdade do estoque; as unidades são a identidade de cada peça dele.
-- Não são dois estoques concorrentes: é o mesmo estoque, com nome e sobrenome
-- onde o item tem nome e sobrenome.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O PDV NÃO ESCOLHE O IMEI
--
-- Mesma decisão que a migr. 424 tomou para o lote de validade: **o PDV não
-- escolhe**. A régua é FIFO — sai o aparelho que chegou primeiro — e o sistema
-- carimba qual foi. Pedir ao operador que escolha entre 5 IMEIs no fechamento
-- é a fila do caixa parada para uma decisão que não é dele; e no papel do
-- cliente o que importa é qual número saiu, não quem escolheu.
--
-- A alocação vai num gatilho de `itens_venda`, como o carimbo de custo (425) e
-- o guard de mercadoria (440): pega a venda do PDV, a do pedido de venda e a
-- da loja online sem tocar nos 10 KB da `criar_venda_pdv`.
--
-- **Venda sem unidade cadastrada não é bloqueada.** Se a TechMax vendeu um
-- aparelho cujos IMEIs ninguém registrou no recebimento, a venda passa e
-- nenhuma unidade é baixada. Travar seria transformar um cadastro incompleto
-- em caixa parado — o mesmo silêncio deliberado de `fn_custo_medio_da_entrada`
-- quando o pedido não tem valor. A tela de Recebimentos é que cobra o número
-- na hora certa, que é quando a caixa está aberta na frente do conferente.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ── 1. O aparelho ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.produto_unidades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id     uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  filial         text NOT NULL,
  imei           text NOT NULL,
  status         text NOT NULL DEFAULT 'Em estoque',
  recebimento_id uuid REFERENCES public.recebimentos(id) ON DELETE SET NULL,
  venda_id       uuid REFERENCES public.vendas(id)       ON DELETE SET NULL,
  item_venda_id  uuid REFERENCES public.itens_venda(id)  ON DELETE SET NULL,
  vendida_em     timestamptz,
  observacao     text,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.produto_unidades DROP CONSTRAINT IF EXISTS chk_produto_unidades_status;
ALTER TABLE public.produto_unidades
  ADD CONSTRAINT chk_produto_unidades_status
  CHECK (status IN ('Em estoque', 'Vendida', 'Devolvida', 'Baixada'));

COMMENT ON TABLE public.produto_unidades IS
  'Uma linha por aparelho físico (migr. 444). IMEI/serial é de cada unidade, não do produto — `produtos.atributos` é por cadastro. Nasce no recebimento, é baixada na venda por FIFO.';

-- Dois aparelhos com o mesmo IMEI na mesma unidade é erro de digitação, sempre.
-- Parcial em `ativo` porque baixa é soft-delete: o número precisa poder voltar
-- se a linha errada foi inativada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_produto_unidades_imei
  ON public.produto_unidades (filial, imei) WHERE ativo;

CREATE INDEX IF NOT EXISTS idx_produto_unidades_disponivel
  ON public.produto_unidades (produto_id, status, created_at) WHERE ativo;

CREATE INDEX IF NOT EXISTS idx_produto_unidades_venda
  ON public.produto_unidades (venda_id) WHERE venda_id IS NOT NULL;

ALTER TABLE public.produto_unidades ENABLE ROW LEVEL SECURITY;

-- Leitura pela régua de filial. Escrita não tem policy: entra pela RPC do
-- recebimento e sai pelo gatilho da venda, os dois SECURITY DEFINER.
DROP POLICY IF EXISTS "produto_unidade_read" ON public.produto_unidades;
CREATE POLICY "produto_unidade_read" ON public.produto_unidades
  FOR SELECT TO authenticated
  USING (public.auth_is_admin() OR COALESCE(public.auth_pode_filial(filial), false));

-- ── 2. O registro no recebimento ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_unidades_recebidas(
  p_recebimento_id uuid,
  p_produto_id     uuid,
  p_filial         text,
  p_imeis          text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limpos    text[];
  v_repetido  text;
  v_existente text;
  v_gravadas  int := 0;
  v_imei      text;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Recebimento de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;

  -- Espaço, hífen e linha em branco são o que sai de leitor de código de barras
  -- e de "colei a lista do fornecedor".
  SELECT array_agg(t) INTO v_limpos
    FROM (
      SELECT DISTINCT regexp_replace(u, '[^0-9A-Za-z]', '', 'g') AS t
        FROM unnest(COALESCE(p_imeis, ARRAY[]::text[])) AS u
       WHERE regexp_replace(u, '[^0-9A-Za-z]', '', 'g') <> ''
    ) s;

  IF v_limpos IS NULL OR array_length(v_limpos, 1) IS NULL THEN
    RETURN jsonb_build_object('gravadas', 0);
  END IF;

  -- Repetido DENTRO da lista já foi eliminado pelo DISTINCT; o que interessa
  -- agora é colisão com aparelho que já está na casa.
  SELECT string_agg(pu.imei, ', ') INTO v_existente
    FROM public.produto_unidades pu
   WHERE pu.ativo AND pu.filial = p_filial AND pu.imei = ANY(v_limpos);

  IF v_existente IS NOT NULL THEN
    RAISE EXCEPTION 'IMEI/serial já cadastrado nesta unidade: %. Confira o número — dois aparelhos não têm o mesmo.',
      v_existente USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_imei IN ARRAY v_limpos LOOP
    INSERT INTO public.produto_unidades
      (produto_id, filial, imei, status, recebimento_id)
    VALUES (p_produto_id, p_filial, v_imei, 'Em estoque', p_recebimento_id);
    v_gravadas := v_gravadas + 1;
  END LOOP;

  RETURN jsonb_build_object('gravadas', v_gravadas);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_unidades_recebidas(uuid, uuid, text, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_unidades_recebidas(uuid, uuid, text, text[]) TO authenticated, service_role;

-- ── 3. A baixa na venda (FIFO) ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_item_venda_aloca_unidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_requer boolean;
  v_filial text;
  v_qtd    int;
BEGIN
  IF NEW.produto_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((p.atributos ->> 'requer_imei')::boolean, false)
    INTO v_requer
    FROM public.produtos p WHERE p.id = NEW.produto_id;

  IF NOT COALESCE(v_requer, false) THEN
    RETURN NEW;
  END IF;

  SELECT v.filial INTO v_filial FROM public.vendas v WHERE v.id = NEW.venda_id;

  -- Aparelho não se vende pela metade: 1,5 iPhone não existe.
  v_qtd := GREATEST(floor(COALESCE(NEW.qtd, 0))::int, 0);
  IF v_qtd = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.produto_unidades pu
     SET status        = 'Vendida',
         venda_id      = NEW.venda_id,
         item_venda_id = NEW.id,
         vendida_em    = now()
   WHERE pu.id IN (
     SELECT id FROM public.produto_unidades
      WHERE ativo
        AND produto_id = NEW.produto_id
        AND status = 'Em estoque'
        AND (v_filial IS NULL OR filial = v_filial)
      -- FIFO: o que chegou primeiro sai primeiro. Em aparelho isso importa —
      -- o mais antigo é o que corre risco de virar encalhe de geração.
      ORDER BY created_at
      LIMIT v_qtd
      FOR UPDATE SKIP LOCKED
   );

  -- Sem unidade disponível a venda segue (ver cabeçalho). Nada a fazer aqui.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_item_venda_aloca_unidade ON public.itens_venda;
CREATE TRIGGER trg_item_venda_aloca_unidade
  AFTER INSERT ON public.itens_venda
  FOR EACH ROW EXECUTE FUNCTION public.fn_item_venda_aloca_unidade();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. tabela, índice único e gatilho
--   SELECT to_regclass('public.produto_unidades');
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='produto_unidades';
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.itens_venda'::regclass AND tgname='trg_item_venda_aloca_unidade';
--
--   -- 2. quantos aparelhos por situação
--   SELECT filial, status, count(*) FROM produto_unidades
--    WHERE ativo GROUP BY 1,2 ORDER BY 1,2;
--
--   -- 3. venda × aparelho (é a pergunta que a loja não sabia responder)
--   SELECT v.created_at::date, pu.imei, p.nome
--     FROM produto_unidades pu
--     JOIN produtos p ON p.id = pu.produto_id
--     JOIN vendas   v ON v.id = pu.venda_id
--    WHERE pu.status = 'Vendida' ORDER BY v.created_at DESC LIMIT 20;
--
-- E o teste que vale a aula: cadastrar um iPhone com "Requer IMEI/Serial"
-- marcado, comprar 2 e informar os 2 IMEIs no Recebimento, vender 1 no PDV e
-- conferir no recibo qual aparelho saiu.
-- =================================================================
