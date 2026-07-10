-- Remove a assinatura antiga de 3 params que ficou como overload
-- após a migração 20260626 criar a versão com 4 params.
-- Sem isso o Supabase client pode chamar a versão errada (sem p_origem).
DROP FUNCTION IF EXISTS public.fechar_caixa_conferido(uuid, numeric, text);
