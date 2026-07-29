-- 293 — Loja online: o pedido de fora entra, mas quem vende é o aluno.
--
-- CONTEXTO. Cada filial ganha uma página pública (o "hub") para divulgar a
-- pessoas de fora da turma: elas navegam o catálogo, montam carrinho e pedem.
-- A dinâmica que se quer treinar é a venda — atender, conferir, fechar. Então
-- o clique em "Comprar" NÃO pode fechar venda sozinho: se fechasse, o aluno da
-- filial viraria espectador de um sistema que vende sem ele.
--
-- Desenho: o hub cria um PEDIDO. A venda nasce depois, quando alguém da filial
-- confirma — e nasce por `criar_venda_pdv`, o mesmo caminho do balcão, com
-- estoque, conta a receber, nota fiscal e auditoria que já existem. Nada de
-- rota paralela para o dinheiro.
--
-- POR QUE O ANÔNIMO NÃO TOCA NESTAS TABELAS. `criar_venda_pdv` recebe preço,
-- desconto e total como parâmetro e tem `_assert_rpc('vendas','financeiro')`.
-- Comprador anônimo chamando ela escolheria o próprio preço. Aqui o anon não
-- tem policy nenhuma: quem escreve é o endpoint `api/loja.ts` com service-role,
-- que relê `produtos.preco` do banco e ignora qualquer valor vindo do
-- navegador. O precedente a NÃO seguir é `pix_pendentes`, onde a policy anon
-- deixa qualquer um ler todas as linhas 'aguardando' e marcar como 'pago'.
--
-- DADO PESSOAL. Coleta-se apelido e nada mais — sem telefone, e-mail, CPF ou
-- endereço. O comprador acompanha pelo `codigo`, que é a credencial do próprio
-- pedido. São pessoas de fora da turma, e o pedido fica visível para todos os
-- alunos da filial pela RLS: o dado que não existe é o que não vaza.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A loja abre e fecha
--
-- A página vai para desconhecidos na internet e não dá para depender de
-- "ninguém vai achar o link". O professor precisa de um interruptor por filial
-- — e de um teto, porque um engraçadinho com 500 pedidos mata a aula.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.loja_config (
  filial            text PRIMARY KEY,
  aberta            boolean NOT NULL DEFAULT false,
  mensagem_fechada  text,
  -- Endereço público da loja. Ela vive em projeto Vercel próprio, então o
  -- LogMax não tem como deduzir a URL — e sem guardá-la aqui o botão
  -- "Copiar link" da tela do aluno copiaria um caminho que não existe.
  url_publica       text,
  max_itens_pedido  integer NOT NULL DEFAULT 20,
  max_valor_pedido  numeric(15,2) NOT NULL DEFAULT 5000,
  max_pedidos_hora  integer NOT NULL DEFAULT 30,
  atualizado_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Coluna adicionada em separado para o caso de a tabela já existir de uma
-- aplicação anterior desta mesma migração.
ALTER TABLE public.loja_config
  ADD COLUMN IF NOT EXISTS url_publica text;

COMMENT ON TABLE public.loja_config IS
  'Interruptor, tetos e endereço público da loja por filial. `aberta` nasce '
  'false: loja nova não abre sozinha ao aplicar a migração. Migração 293.';

-- Nasce fechada em toda filial que existir. Abrir é ato deliberado na tela.
INSERT INTO public.loja_config (filial, aberta)
SELECT DISTINCT filial, false FROM public.produtos WHERE filial IS NOT NULL
ON CONFLICT (filial) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O pedido
--
-- `codigo` é a credencial do comprador: sem login, é o que ele guarda para
-- acompanhar. Por isso não pode ser sequencial — 8 caracteres sorteados de um
-- alfabeto sem 0/O/1/I (que a pessoa vai digitar errado se for parecido).
--
-- `total` e os preços dos itens são SNAPSHOT do momento do pedido. Se o aluno
-- reajustar o preço amanhã, o que foi combinado com o comprador não muda —
-- mesma razão pela qual `itens_venda` guarda `preco_unitario`.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pedidos_online (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            text UNIQUE NOT NULL,
  filial            text NOT NULL,

  comprador_apelido text NOT NULL,

  -- O que o comprador escolheu na página. NÃO é a forma de pagamento da venda:
  -- quem fecha é o aluno, e é ele quem grava a forma real em criar_venda_pdv.
  -- Guardar as duas separadas é o que deixa medir "pediu Pix, pagou dinheiro".
  forma_desejada    text NOT NULL,

  cupom_codigo      text,
  cupom_desconto    numeric(15,2) NOT NULL DEFAULT 0,
  total             numeric(15,2) NOT NULL,
  total_final       numeric(15,2) NOT NULL,

  status            text NOT NULL DEFAULT 'Novo',
  venda_id          uuid REFERENCES public.vendas(id) ON DELETE SET NULL,

  atendido_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atendente_nome    text,
  atendido_em       timestamptz,
  motivo_cancelamento text,

  -- Quem trouxe o comprador. Alimenta a Competição inter-filiais: convencer
  -- alguém de fora a participar é o mérito que a dinâmica quer premiar.
  indicacao         text,

  -- Idempotência: o navegador manda o mesmo request_id se o usuário clicar
  -- duas vezes ou a resposta se perder. UNIQUE faz o segundo POST devolver o
  -- pedido que já existe em vez de criar um gêmeo.
  request_id        uuid UNIQUE,

  -- SHA-256 do IP + salt, nunca o IP. Serve só para contar pedidos por janela
  -- e barrar enxurrada; não identifica ninguém depois do fato.
  ip_hash           text,

  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.pedidos_online
    ADD CONSTRAINT chk_pedido_online_status
    CHECK (status IN ('Novo', 'Em Atendimento', 'Confirmado', 'Cancelado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.pedidos_online
    ADD CONSTRAINT chk_pedido_online_valores
    CHECK (total >= 0 AND total_final >= 0 AND cupom_desconto >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pedidos_online_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id      uuid NOT NULL REFERENCES public.pedidos_online(id) ON DELETE CASCADE,
  produto_id     uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
  nome_produto   text NOT NULL,
  qtd            numeric(15,3) NOT NULL,
  preco_unitario numeric(15,2) NOT NULL,
  subtotal       numeric(15,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pedido_item_qtd CHECK (qtd > 0)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_fila
  ON public.pedidos_online (filial, status, created_at DESC) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_pedidos_online_itens_pedido
  ON public.pedidos_online_itens (pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_online_rate
  ON public.pedidos_online (ip_hash, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Código do pedido
--
-- Alfabeto sem 0/O/1/I/L: o comprador vai ler isso de uma tela e digitar em
-- outra. 8 caracteres em 31 símbolos ≈ 8.5e11 combinações — junto com o teto
-- de pedidos por hora, chutar não compensa.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gerar_codigo_pedido_online()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo   text;
  v_tentativa integer := 0;
BEGIN
  LOOP
    v_codigo := '';
    FOR i IN 1..8 LOOP
      v_codigo := v_codigo || substr(v_alfabeto, floor(random() * length(v_alfabeto))::int + 1, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.pedidos_online WHERE codigo = v_codigo);

    v_tentativa := v_tentativa + 1;
    IF v_tentativa > 20 THEN
      RAISE EXCEPTION 'Não foi possível gerar código único para o pedido.';
    END IF;
  END LOOP;

  RETURN v_codigo;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS
--
-- anon: NENHUMA policy. O hub não fala com o PostgREST — fala com o endpoint,
-- que usa service-role. É a diferença deliberada em relação a `pix_pendentes`.
--
-- authenticated: quem opera vendas na filial, mais gerente da filial e Matriz.
-- Mesma régua canônica das migrações 179-197.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.loja_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_online       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_online_itens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.auth_opera_loja(p_filial text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (
    public.auth_in_setor(VARIADIC ARRAY['vendas', 'marketing'])
    OR public.auth_gerente_da(p_filial)
  ) AND public.auth_pode_filial(p_filial);
$function$;

DROP POLICY IF EXISTS loja_config_read  ON public.loja_config;
DROP POLICY IF EXISTS loja_config_write ON public.loja_config;

-- Ler a config é inofensivo e útil (a tela mostra se a loja está no ar).
CREATE POLICY loja_config_read ON public.loja_config
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

-- Abrir e fechar a loja é decisão de gerente ou Matriz, não de colaborador.
CREATE POLICY loja_config_write ON public.loja_config
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin() OR public.auth_gerente_da(filial))
  WITH CHECK (public.auth_is_admin() OR public.auth_gerente_da(filial));

DROP POLICY IF EXISTS pedidos_online_all ON public.pedidos_online;
CREATE POLICY pedidos_online_all ON public.pedidos_online
  FOR ALL TO authenticated
  USING (public.auth_opera_loja(filial))
  WITH CHECK (public.auth_opera_loja(filial));

DROP POLICY IF EXISTS pedidos_online_itens_all ON public.pedidos_online_itens;
CREATE POLICY pedidos_online_itens_all ON public.pedidos_online_itens
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pedidos_online p
     WHERE p.id = pedido_id AND public.auth_opera_loja(p.filial)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.pedidos_online p
     WHERE p.id = pedido_id AND public.auth_opera_loja(p.filial)
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Confirmar o pedido = fazer a venda
--
-- Aqui é onde o aluno entra. A RPC não recalcula nada por conta própria: ela
-- monta o payload a partir dos itens JÁ gravados no pedido e entrega para
-- `criar_venda_pdv`, que revalida tudo (soma dos itens, coerência do total,
-- cupom, estoque) e gera venda + movimentação + conta a receber + nota.
--
-- Se o estoque acabou entre o pedido e a confirmação, quem reclama é a
-- `criar_venda_pdv` — com a mensagem dela, que diz o produto e as quantidades.
-- Não duplicamos essa checagem aqui para não ter duas respostas diferentes
-- para a mesma pergunta.
--
-- `p_forma_pagamento` vem do ATENDENTE, não do pedido: o comprador declarou
-- uma preferência na página, mas quem fecha a venda é quem está no balcão.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirmar_pedido_online(
  p_pedido_id      uuid,
  p_forma_pagamento text,
  p_cliente_id     uuid    DEFAULT NULL,
  p_parcelas       integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido   public.pedidos_online;
  v_itens    jsonb;
  v_venda_id uuid;
  v_nome     text;
BEGIN
  SELECT * INTO v_pedido
    FROM public.pedidos_online
   WHERE id = p_pedido_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido online não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_opera_loja(v_pedido.filial) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_pedido.status = 'Confirmado' THEN
    RAISE EXCEPTION 'Pedido % já virou a venda %.', v_pedido.codigo, v_pedido.venda_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_pedido.status = 'Cancelado' THEN
    RAISE EXCEPTION 'Pedido % está cancelado.', v_pedido.codigo USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'produto_id',     i.produto_id,
           'nome_produto',   i.nome_produto,
           'qtd',            i.qtd,
           'preco_unitario', i.preco_unitario,
           'subtotal',       i.subtotal
         ) ORDER BY i.created_at)
    INTO v_itens
    FROM public.pedidos_online_itens i
   WHERE i.pedido_id = p_pedido_id;

  IF v_itens IS NULL OR jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Pedido % não tem itens.', v_pedido.codigo USING ERRCODE = 'P0001';
  END IF;

  v_venda_id := public.criar_venda_pdv(
    p_cliente_id     => p_cliente_id,
    p_total          => v_pedido.total,
    p_desconto       => v_pedido.cupom_desconto,
    p_total_final    => v_pedido.total_final,
    p_forma_pagamento => p_forma_pagamento,
    p_parcelas       => COALESCE(p_parcelas, 1),
    p_itens          => v_itens,
    p_filial         => v_pedido.filial,
    p_cupom_codigo   => v_pedido.cupom_codigo,
    p_cupom_desconto => v_pedido.cupom_desconto
  );

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.pedidos_online
     SET status         = 'Confirmado',
         venda_id       = v_venda_id,
         atendido_por   = auth.uid(),
         atendente_nome = COALESCE(v_nome, 'Atendente'),
         atendido_em    = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'ok', true,
    'venda_id', v_venda_id,
    'codigo',   v_pedido.codigo,
    'total',    v_pedido.total_final
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirmar_pedido_online(uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_online(uuid, text, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.gerar_codigo_pedido_online() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_codigo_pedido_online() TO service_role;

REVOKE ALL ON FUNCTION public.auth_opera_loja(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_opera_loja(text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Cancelar
--
-- Cancelar é registro, não apagamento: o pedido some da fila mas continua
-- contando na medição de quantos vieram de fora e quantos viraram venda.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancelar_pedido_online(
  p_pedido_id uuid,
  p_motivo    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filial text;
  v_status text;
BEGIN
  SELECT filial, status INTO v_filial, v_status
    FROM public.pedidos_online
   WHERE id = p_pedido_id AND COALESCE(ativo, true)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido online não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_opera_loja(v_filial) THEN
    RAISE EXCEPTION 'Pedido de outra filial.' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'Confirmado' THEN
    RAISE EXCEPTION 'Pedido já virou venda — cancele pela devolução, não aqui.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pedidos_online
     SET status              = 'Cancelado',
         motivo_cancelamento = trim(p_motivo),
         atendido_por        = auth.uid(),
         atendente_nome      = COALESCE(
           (SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'Atendente'),
         atendido_em         = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_pedido_online(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_online(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- A loja nasce fechada em todas as filiais:
--   SELECT filial, aberta FROM loja_config ORDER BY filial;
--
--   -- Produtos elegíveis à vitrine (o hub só mostra estes):
--   SELECT filial, count(*) FILTER (WHERE vitrine_publica AND estoque > 0)
--     FROM produtos WHERE COALESCE(ativo,true) GROUP BY 1;
--
--   -- O anon não pode nada (deve voltar zero linhas):
--   SELECT policyname FROM pg_policies
--    WHERE tablename IN ('pedidos_online','pedidos_online_itens')
--      AND 'anon' = ANY(roles);
-- ────────────────────────────────────────────────────────────────────────────
