-- 299 — Fraude fica visível, e o dado de origem para de ficar guardado à toa.
--
-- Três coisas, todas sem coletar UM dado pessoal novo. O que segura esta loja
-- em pé perante a LGPD é ela não saber quem é o comprador: só um apelido que a
-- própria pessoa digita. Qualquer antifraude que peça CPF, telefone ou e-mail
-- trocaria um problema pedagógico por um problema de proteção de dados de
-- terceiros — possivelmente menores de idade (art. 14).
--
-- ─── 1. Quem indica não fecha a própria venda ──────────────────────────────
--
-- O link aceita `?ind=nome`, que credita a indicação a um aluno. Nada impedia
-- o mesmo aluno de criar o pedido com a própria indicação e confirmá-lo,
-- inflando `vendas` — que alimentam o ranking da competição inter-filiais.
--
-- Agora a confirmação recusa quando quem clica É a indicação do pedido. Não é
-- desconfiança do aluno: é segregação de função, a mesma razão pela qual quem
-- lança a despesa não é quem aprova. Outro colega confirma e está resolvido.
--
-- ─── 2. `ip_hash` com prazo ────────────────────────────────────────────────
--
-- O hash serve para uma coisa só: contar pedidos por janela de UMA HORA. Ficava
-- gravado para sempre. Guardar dado além da finalidade é o oposto dos arts. 15
-- e 16 — e não custa nada corrigir, porque depois de um dia aquele valor não
-- responde mais pergunta nenhuma.
--
-- Trinta dias, não uma hora, para o professor ainda conseguir revisar a aula
-- da semana passada. Depois disso vira NULL: o pedido continua inteiro no
-- histórico, sem o rastro de origem.
--
-- ─── 3. `origem_token`: repetição visível, sem depender de IP ─────────────
--
-- CUIDADO COM `ip_hash` COMO IDENTIDADE: a turma toda sai pela mesma internet
-- da escola, então 20 alunos compartilham UM ip_hash. Bloquear "um pedido por
-- origem" transformaria o primeiro pedido do dia numa tranca para a sala
-- inteira, e é por isso que este arquivo NÃO faz isso — `max_pedidos_hora`
-- (hoje 30) já é o limite de vazão, e ele é por rede, não por pessoa.
--
-- `origem_token` é um UUID aleatório que a página guarda no `localStorage` do
-- navegador. Ele distingue dispositivos atrás do mesmo IP, e é aleatório de
-- nascença — não deriva de nada da pessoa. Some junto com o `ip_hash` aos 30
-- dias.
--
-- Ele não é prova, e a tela não trata como prova: aba anônima gera outro
-- token. O que ele faz é o barato e o honesto — mostrar ao aluno que atende
-- "5º pedido deste dispositivo hoje" e deixar a conversa acontecer entre
-- pessoas. Numa aula, fraude é assunto pedagógico, não de bloqueio automático.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

ALTER TABLE public.pedidos_online
  ADD COLUMN IF NOT EXISTS origem_token       text,
  ADD COLUMN IF NOT EXISTS origem_pedidos_24h integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.pedidos_online.origem_token IS
  'UUID aleatório do navegador (localStorage), para distinguir dispositivos atrás do mesmo IP. Não deriva de dado pessoal. Apagado junto com ip_hash aos 30 dias.';
COMMENT ON COLUMN public.pedidos_online.origem_pedidos_24h IS
  'Quantos pedidos vieram desta mesma origem nas 24h anteriores a este, contando ele. Snapshot do momento do pedido — indício para quem atende, não prova.';

CREATE INDEX IF NOT EXISTS idx_pedidos_online_origem
  ON public.pedidos_online (origem_token, created_at DESC)
  WHERE origem_token IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- Comparar indicação com nome de quem confirma
--
-- `unaccent` não está instalado nos projetos de turma, e instalar extensão em
-- 4 bancos por causa de uma comparação é peso desnecessário — `translate` dá
-- conta das acentuações do português.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalizar_nome(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT btrim(lower(translate(
    COALESCE(p_texto, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  )));
$function$;

CREATE OR REPLACE FUNCTION public.limpar_ip_hash_pedidos_online()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
BEGIN
  PERFORM public._assert_rpc();  -- só service_role (o cron) ou usuário logado

  UPDATE public.pedidos_online
     SET ip_hash = NULL, origem_token = NULL
   WHERE created_at < now() - interval '30 days'
     AND (ip_hash IS NOT NULL OR origem_token IS NOT NULL);

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.limpar_ip_hash_pedidos_online() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limpar_ip_hash_pedidos_online() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- confirmar_pedido_online — agora com segregação de função.
-- Assinatura idêntica à da 296/297: CREATE OR REPLACE puro.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirmar_pedido_online(
  p_pedido_id       uuid,
  p_forma_pagamento text,
  p_cliente_id      uuid    DEFAULT NULL,
  p_parcelas        integer DEFAULT 1,
  p_ignorar_cupom   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido    public.pedidos_online;
  v_itens     jsonb;
  v_venda_id  uuid;
  v_nome      text;
  v_desconto  numeric(15,2);
  v_total_fin numeric(15,2);
  v_cupom_cod text;
  v_intruso   text;
  v_ind       text;
  v_eu        text;
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

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  -- Segregação de função: quem é creditado não fecha a própria venda.
  -- Compara com o nome inteiro e com o primeiro nome, porque a indicação é
  -- texto livre e ninguém digita o nome completo num link.
  IF v_pedido.indicacao IS NOT NULL AND v_nome IS NOT NULL THEN
    v_ind := public.normalizar_nome(v_pedido.indicacao);
    v_eu  := public.normalizar_nome(v_nome);
    IF v_ind <> '' AND (v_ind = v_eu OR v_ind = split_part(v_eu, ' ', 1)) THEN
      RAISE EXCEPTION
        'Este pedido credita a indicação a "%" — peça a outra pessoa da equipe para confirmar. Quem indica não fecha a própria venda.',
        v_pedido.indicacao
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Forma que deixa conta em aberto precisa de devedor.
  IF p_forma_pagamento IN ('Fiado', 'Cartão Crédito') AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION
      '% gera conta a receber em aberto — escolha o cliente, senão a cobrança fica sem devedor.',
      p_forma_pagamento
      USING ERRCODE = 'P0001';
  END IF;

  -- Item de outra filial no pedido só chega aqui se alguém escreveu direto na
  -- tabela: o checkout público recusa antes de gravar.
  SELECT pr.nome INTO v_intruso
    FROM public.pedidos_online_itens i
    JOIN public.produtos pr ON pr.id = i.produto_id
   WHERE i.pedido_id = p_pedido_id
     AND pr.filial IS NOT NULL
     AND pr.filial <> v_pedido.filial
   LIMIT 1;

  IF v_intruso IS NOT NULL THEN
    RAISE EXCEPTION
      'Pedido % tem item de outra filial ("%") e não pode ser confirmado.',
      v_pedido.codigo, v_intruso
      USING ERRCODE = 'P0001';
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

  -- Sem cupom, a venda é o total cheio dos itens. `criar_venda_pdv` confere
  -- que total − desconto = total_final, então os três andam juntos.
  IF p_ignorar_cupom THEN
    v_desconto  := 0;
    v_total_fin := v_pedido.total;
    v_cupom_cod := NULL;
  ELSE
    v_desconto  := v_pedido.cupom_desconto;
    v_total_fin := v_pedido.total_final;
    v_cupom_cod := v_pedido.cupom_codigo;
  END IF;

  v_venda_id := public.criar_venda_pdv(
    p_cliente_id      => p_cliente_id,
    p_total           => v_pedido.total,
    p_desconto        => v_desconto,
    p_total_final     => v_total_fin,
    p_forma_pagamento => p_forma_pagamento,
    p_parcelas        => COALESCE(p_parcelas, 1),
    p_itens           => v_itens,
    p_filial          => v_pedido.filial,
    p_cupom_codigo    => v_cupom_cod,
    p_cupom_desconto  => v_desconto
  );

  UPDATE public.pedidos_online
     SET status         = 'Confirmado',
         venda_id       = v_venda_id,
         cupom_ignorado = COALESCE(p_ignorar_cupom, false),
         atendido_por   = auth.uid(),
         atendente_nome = COALESCE(v_nome, 'Atendente'),
         atendido_em    = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'ok', true,
    'venda_id', v_venda_id,
    'codigo',   v_pedido.codigo,
    'total',    v_total_fin,
    'cupom_ignorado', COALESCE(p_ignorar_cupom, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirmar_pedido_online(uuid, text, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_online(uuid, text, uuid, integer, boolean) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- Colunas novas:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'pedidos_online'
--      AND column_name IN ('origem_token', 'origem_pedidos_24h');
--
--   -- A limpeza roda e é idempotente (0 na segunda vez):
--   SELECT limpar_ip_hash_pedidos_online();
--
--   -- Origens repetidas do dia, sem expor o token:
--   SELECT left(origem_token, 8) AS origem, count(*), max(origem_pedidos_24h)
--     FROM pedidos_online
--    WHERE created_at > now() - interval '24 hours' AND origem_token IS NOT NULL
--    GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;
