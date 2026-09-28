-- 639_20260928_codigo_do_ponto_tem_teto_de_tentativas.sql
--
-- O código de 6 dígitos do totem (`/api/register-ponto`, method 'codigo') não
-- tinha limite de tentativas. A cada chute valem 6 códigos (3 checkpoints ×
-- janela atual e anterior), ~1 em 166 mil — pouco para um humano, alcançável
-- para um script com o próprio login disparando em paralelo. O prêmio é bater
-- ponto sem estar na sala, e a frequência vale 20% do placar.
--
-- COMO: o endpoint chama `contar_tentativa_codigo_ponto` ANTES de conferir o
-- código. O contador é por (usuário, janela de 2 min) e o incremento é
-- atômico (INSERT ... ON CONFLICT ... RETURNING): N pedidos em paralelo
-- recebem N números distintos, então disparar tudo de uma vez não fura o teto.
-- Conta toda tentativa, certa ou errada — quem digita certo gasta uma.
--
-- A tabela não tem policy: só o service_role (o endpoint) escreve e lê, e a
-- função não é exposta a anon nem authenticated.
--
-- Limpeza: a própria função apaga as janelas velhas DAQUELE usuário, então a
-- tabela fica com no máximo algumas linhas por aluno.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE TABLE IF NOT EXISTS public.ponto_codigo_tentativas (
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  janela     bigint  NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, janela)
);

ALTER TABLE public.ponto_codigo_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ponto_codigo_tentativas FROM public, anon, authenticated;

COMMENT ON TABLE public.ponto_codigo_tentativas IS
  'Contador de tentativas do código de 6 dígitos do ponto, por usuário e janela de 2 min (migr. 639). Sem policy de propósito: só o service_role (api/register-ponto) acessa.';

CREATE OR REPLACE FUNCTION public.contar_tentativa_codigo_ponto(p_user uuid, p_janela bigint)
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH limpa AS (
    DELETE FROM public.ponto_codigo_tentativas
     WHERE user_id = p_user AND janela < p_janela - 1
  )
  INSERT INTO public.ponto_codigo_tentativas AS t (user_id, janela, tentativas)
  VALUES (p_user, p_janela, 1)
  ON CONFLICT (user_id, janela) DO UPDATE SET tentativas = t.tentativas + 1
  RETURNING t.tentativas;
$$;

REVOKE ALL ON FUNCTION public.contar_tentativa_codigo_ponto(uuid, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contar_tentativa_codigo_ponto(uuid, bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
