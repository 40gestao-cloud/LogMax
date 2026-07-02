-- Adiciona foto_url em funcionarios e RPC para admin/CEO/gerente
-- atualizarem a foto de qualquer usuário em user_profiles.
BEGIN;

ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS foto_url text;

-- RPC: atualizar_foto_usuario
-- Permite admin/CEO/gerente definirem foto_url de qualquer perfil.
CREATE OR REPLACE FUNCTION public.atualizar_foto_usuario(
  p_user_id uuid,
  p_foto_url text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'ceo', 'gerente') THEN
    RAISE EXCEPTION 'Sem permissão para alterar foto de outro usuário.';
  END IF;
  UPDATE user_profiles SET foto_url = p_foto_url WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.atualizar_foto_usuario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.atualizar_foto_usuario(uuid, text) TO authenticated;

COMMIT;
