-- =================================================================
-- LogMax — Auditoria "quem fez": criado_por, atualizado_por, updated_at
--
-- Adiciona rastreio de autoria em 20 tabelas operacionais críticas
-- (Financeiro, Vendas/PDV, Estoque, Compras). Cada INSERT/UPDATE
-- preenche automaticamente o autor via auth.uid() — operadores não
-- precisam alterar payloads.
--
-- Linhas legadas (pré-migração) ficam com criado_por / atualizado_por
-- IS NULL — o componente <AuditoriaInspect> trata como "autoria
-- desconhecida (linha legada)".
--
-- Idempotente — ADD COLUMN IF NOT EXISTS + DROP/CREATE TRIGGER.
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- 1) Função reutilizável dos triggers de auditoria.
--
-- Por que SECURITY INVOKER (padrão)? O trigger precisa ler auth.uid()
-- no contexto do usuário autenticado, não do dono do schema. Se o
-- INSERT vem de um service role (api/*), auth.uid() é NULL e a coluna
-- fica NULL — comportamento aceito (componente mostra "desconhecido").
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_auditoria_campos()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por     := COALESCE(NEW.criado_por, auth.uid());
    NEW.atualizado_por := NEW.criado_por;
    NEW.updated_at     := COALESCE(NEW.updated_at, now());
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.atualizado_por := COALESCE(auth.uid(), NEW.atualizado_por);
    NEW.updated_at     := now();
  END IF;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------
-- 2) Para cada tabela em escopo:
--      - adiciona criado_por / atualizado_por / updated_at
--      - liga o trigger BEFORE INSERT OR UPDATE
--
-- DO block + ARRAY[] mantém a migração curta e o set de tabelas
-- visível em um único lugar.
-- -----------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    -- Financeiro
    'contas_pagar', 'contas_receber', 'controle_caixa', 'previsoes',
    'duplicatas', 'caixa_bancos', 'folha_pagamento', 'vencimentos_estoque',
    -- Vendas / PDV
    'vendas', 'orcamentos', 'pedidos_venda',
    -- Estoque
    'movimentacoes_estoque', 'requisicoes_estoque', 'expedicao', 'inventarios',
    -- Compras
    'requisicoes', 'cotacoes', 'pedidos', 'recebimentos', 'notas_recebidas'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_auditoria
                      BEFORE INSERT OR UPDATE ON %I
                      FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_campos()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------
-- 3) RPC: lista de usuários cuja autoria o caller pode revelar.
--
--   - admin / ceo  → todos os user_profiles
--   - gerente      → usuários nos setores que o gerente atua
--                    (setor primário + setores_extras)
--   - demais roles → array vazio (não veem ícone de auditoria)
--
-- O AuditoriaContext chama esta RPC uma vez por sessão e usa o
-- resultado pra montar dois mapas:
--   - visíveis: Set<uuid> — IDs cuja autoria é revelada
--   - nomes:    Map<uuid, {nome, setor}> — exibido no popover
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usuarios_visiveis_para_auditoria()
RETURNS TABLE (id uuid, nome text, setor text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role  text;
  v_setor text;
  v_extras text[];
BEGIN
  SELECT up.role, up.setor, COALESCE(up.setores_extras, '{}'::text[])
    INTO v_role, v_setor, v_extras
    FROM user_profiles up
   WHERE up.id = auth.uid();

  IF v_role IN ('admin', 'ceo') THEN
    RETURN QUERY
      SELECT up.id, up.nome, up.setor
        FROM user_profiles up;
    RETURN;
  END IF;

  IF v_role = 'gerente' THEN
    RETURN QUERY
      SELECT up.id, up.nome, up.setor
        FROM user_profiles up
       WHERE up.setor = ANY(ARRAY[v_setor] || v_extras);
    RETURN;
  END IF;

  -- Demais roles: array vazio (componente esconde ícone).
  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.usuarios_visiveis_para_auditoria() TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--
-- 1. Conferir colunas em uma tabela:
--    \d+ contas_pagar
--
-- 2. Inserir uma linha de teste (como usuário autenticado):
--    INSERT INTO contas_pagar (descricao, valor) VALUES ('teste', 100);
--    SELECT criado_por, atualizado_por, updated_at FROM contas_pagar
--     ORDER BY created_at DESC LIMIT 1;
--    -- esperado: criado_por = auth.uid() do usuário;
--                 atualizado_por = criado_por;
--                 updated_at ≈ created_at.
--
-- 3. Atualizar a mesma linha por outro usuário e conferir:
--    atualizado_por troca, criado_por permanece.
--
-- 4. RPC com caller admin: SELECT count(*) FROM usuarios_visiveis_para_auditoria();
--    -- deve retornar total de user_profiles.
-- =================================================================
