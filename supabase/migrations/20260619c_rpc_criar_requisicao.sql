-- =================================================================
-- RPCs transacionais: criar_requisicao_compra + criar_requisicao_estoque
-- =================================================================
-- Substitui o par de `dbInsert` sequenciais que o cliente fazia em
-- `RequisicoesView` e `RequisicoesEstoqueView` (requisicao + aprovacao
-- pendente) por uma única chamada atômica no servidor.
--
-- Benefícios:
--   1) Atômico — se a aprovação falha, a requisição também não persiste
--      (BEGIN/COMMIT implícito da função). Antes podiam ficar órfãs.
--   2) SECURITY DEFINER + RLS bypass — a função tem a confiança do
--      servidor. O cliente não depende mais da RLS abrir o INSERT em
--      `aprovacoes_compras`/`aprovacoes_estoque` (corrigido em
--      20260619b, mas a categoria do bug volta se alguém apertar a
--      RLS lá no futuro). RPC mata a categoria.
--   3) `auth.uid()` segue funcionando dentro do trigger de auditoria
--      (auth.uid() lê do JWT, não muda com SECURITY DEFINER) — autor
--      preservado.
--
-- Padrão segue `criar_venda_pdv` (20260614_marketing_campanhas_cupons.sql).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Compras: criar requisição + aprovação pendente ─────────────
CREATE OR REPLACE FUNCTION public.criar_requisicao_compra(
  p_item         text,
  p_solicitante  text,
  p_qtd          integer DEFAULT 1,
  p_urgencia     text    DEFAULT 'Normal',
  p_centro_custo text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req requisicoes;
BEGIN
  IF p_item IS NULL OR length(trim(p_item)) = 0 THEN
    RAISE EXCEPTION 'Item solicitado é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_solicitante IS NULL OR length(trim(p_solicitante)) = 0 THEN
    RAISE EXCEPTION 'Solicitante é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    p_qtd := 1;
  END IF;
  IF p_urgencia IS NULL OR p_urgencia NOT IN ('Normal','Alta','Urgente') THEN
    p_urgencia := 'Normal';
  END IF;

  INSERT INTO public.requisicoes (
    item, solicitante, qtd, urgencia, centro_custo, status, data
  ) VALUES (
    trim(p_item), trim(p_solicitante), p_qtd, p_urgencia,
    NULLIF(trim(COALESCE(p_centro_custo,'')), ''),
    'Pendente', public.acre_today()
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_compras (requisicao_id, status)
  VALUES (v_req.id, 'Pendente');

  RETURN to_jsonb(v_req);
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_requisicao_compra(text, text, integer, text, text)
  TO authenticated;

-- ─── 2. Estoque: criar requisição + aprovação pendente ─────────────
CREATE OR REPLACE FUNCTION public.criar_requisicao_estoque(
  p_produto_id  uuid,
  p_solicitante text,
  p_qtd         integer DEFAULT 1,
  p_destino     text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req requisicoes_estoque;
BEGIN
  IF p_produto_id IS NULL THEN
    RAISE EXCEPTION 'Produto é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_solicitante IS NULL OR length(trim(p_solicitante)) = 0 THEN
    RAISE EXCEPTION 'Solicitante é obrigatório.' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 THEN
    p_qtd := 1;
  END IF;

  INSERT INTO public.requisicoes_estoque (
    produto_id, solicitante, qtd, destino, status
  ) VALUES (
    p_produto_id, trim(p_solicitante), p_qtd,
    NULLIF(trim(COALESCE(p_destino,'')), ''),
    'Pendente'
  )
  RETURNING * INTO v_req;

  INSERT INTO public.aprovacoes_estoque (requisicao_estoque_id, status)
  VALUES (v_req.id, 'Pendente');

  RETURN to_jsonb(v_req);
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_requisicao_estoque(uuid, text, integer, text)
  TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- como qualquer authenticated:
--   SELECT public.criar_requisicao_compra('Teste RPC', 'Fulano', 2, 'Alta', 'CC-X');
--   -- retorna jsonb com a requisição criada; a aprovação pendente
--   -- correspondente já está em aprovacoes_compras (atômico).
--
--   SELECT public.criar_requisicao_estoque('<uuid-produto>', 'Fulano', 1, 'Produção');
--   -- idem para estoque.
-- =================================================================
