-- =================================================================
-- Multi-setor: um usuário pode ter setor primário + N setores extras.
--
-- Exemplo: gerente de Vendas com acesso adicional ao TI.
--   user_profiles.setor          = 'vendas'              (mantém — define
--                                                          a role/escopo
--                                                          de gerência)
--   user_profiles.setores_extras = ARRAY['ti']            (concede acesso
--                                                          de leitura/escrita
--                                                          no setor extra,
--                                                          sem elevar role)
--
-- O acesso é checado via `auth_in_setor(...)` (já usado em todas as
-- policies RLS). Atualizamos esse helper pra considerar setor+extras
-- via overlap de arrays (operador &&).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- 1. Coluna setores_extras em user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS setores_extras text[] NOT NULL DEFAULT '{}';

-- Setores válidos (mesma lista do CHECK em `setor`).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_setores_extras_valid'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT chk_user_setores_extras_valid
      CHECK (
        setores_extras <@ ARRAY['logistica','vendas','financeiro',
                                'rh','marketing','ti','compras','estoque']::text[]
      );
  END IF;
END $$;

-- Garante que primary não aparece em extras (evita duplicidade lógica).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_setores_extras_sem_primario'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT chk_user_setores_extras_sem_primario
      CHECK (NOT (setor = ANY(setores_extras)));
  END IF;
END $$;

-- 2. Novo helper: devolve array (primary + extras) do usuário atual.
CREATE OR REPLACE FUNCTION public.auth_user_setores()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
  FROM public.user_profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_setores() TO authenticated;

-- 3. auth_in_setor: agora compara contra primary + extras via overlap.
--    Admin segue passando direto (escopo global).
CREATE OR REPLACE FUNCTION public.auth_in_setor(VARIADIC setors text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth_is_admin() OR (auth_user_setores() && setors);
$$;

-- 4. Notificações: ler também as endereçadas a setores extras do usuário.
DROP POLICY IF EXISTS "notif_read" ON notificacoes;
CREATE POLICY "notif_read" ON notificacoes
  FOR SELECT TO authenticated USING (
    auth_is_admin()
    OR setor = 'all'
    OR setor = ANY(auth_user_setores())
  );

DROP POLICY IF EXISTS "notif_update" ON notificacoes;
CREATE POLICY "notif_update" ON notificacoes
  FOR UPDATE TO authenticated
  USING (
    auth_is_admin()
    OR setor = 'all'
    OR setor = ANY(auth_user_setores())
  )
  WITH CHECK (
    auth_is_admin()
    OR setor = 'all'
    OR setor = ANY(auth_user_setores())
  );

-- 5. RPC responder_pesquisa: alvo de setor agora considera primary+extras.
--    Se a pesquisa alveja 'ti' e o usuário tem 'ti' como extra, ele responde.
CREATE OR REPLACE FUNCTION responder_pesquisa(
  p_pesquisa_id uuid,
  p_itens       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_anonima       boolean;
  v_status        text;
  v_alvo_roles    text[];
  v_alvo_setores  text[];
  v_user_id       uuid;
  v_user_role     text;
  v_user_setores  text[];
  v_resposta_id   uuid;
  v_item          jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT anonima, status, alvo_roles, alvo_setores
    INTO v_anonima, v_status, v_alvo_roles, v_alvo_setores
    FROM pesquisas WHERE id = p_pesquisa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada';
  END IF;
  IF v_status <> 'Ativa' THEN
    RAISE EXCEPTION 'Pesquisa não está ativa';
  END IF;

  SELECT role, ARRAY[setor] || COALESCE(setores_extras, '{}'::text[])
    INTO v_user_role, v_user_setores
    FROM user_profiles WHERE id = v_user_id;

  -- Wildcard: alvo NULL/vazio = todos. Setor 'all' (admin/CEO) sempre passa.
  IF v_alvo_roles IS NOT NULL AND array_length(v_alvo_roles, 1) > 0 THEN
    IF NOT (v_user_role = ANY(v_alvo_roles)) THEN
      RAISE EXCEPTION 'Usuário fora do público-alvo (role)';
    END IF;
  END IF;
  IF v_alvo_setores IS NOT NULL AND array_length(v_alvo_setores, 1) > 0 THEN
    -- Overlap: pelo menos um setor do usuário precisa estar no alvo.
    IF NOT ('all' = ANY(v_user_setores)) AND NOT (v_user_setores && v_alvo_setores) THEN
      RAISE EXCEPTION 'Usuário fora do público-alvo (setor)';
    END IF;
  END IF;

  -- Bloqueio de 2ª resposta para pesquisas identificadas.
  IF NOT v_anonima THEN
    IF EXISTS (
      SELECT 1 FROM pesquisa_respostas
       WHERE pesquisa_id = p_pesquisa_id AND respondente_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'Usuário já respondeu esta pesquisa';
    END IF;
  END IF;

  INSERT INTO pesquisa_respostas (pesquisa_id, respondente_id, anonima)
    VALUES (p_pesquisa_id, CASE WHEN v_anonima THEN NULL ELSE v_user_id END, v_anonima)
    RETURNING id INTO v_resposta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO pesquisa_resposta_itens (resposta_id, pergunta_id, valor_num, valor_texto)
      VALUES (
        v_resposta_id,
        (v_item->>'pergunta_id')::uuid,
        NULLIF(v_item->>'valor_num','')::numeric,
        v_item->>'valor_texto'
      );
  END LOOP;

  RETURN v_resposta_id;
END;
$$;

GRANT EXECUTE ON FUNCTION responder_pesquisa(uuid, jsonb) TO authenticated;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como usuário com setor='vendas' e setores_extras='{ti}':
--   SELECT auth_user_setor();    -- 'vendas'
--   SELECT auth_user_setores();  -- {vendas,ti}
--   SELECT auth_in_setor('ti');  -- true
--   SELECT auth_in_setor('rh');  -- false
-- =================================================================
