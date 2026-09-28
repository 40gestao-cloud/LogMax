-- 640_20260928_ia_tem_teto_de_uso_por_pessoa.sql
--
-- Os endpoints `api/ai-*` limitavam o tamanho de cada pedido, mas não quantos
-- pedidos cada pessoa faz. As chaves de IA são free tier e compartilhadas:
-- um aluno num laço esgota a cota e derruba o MaxAI da escola inteira.
--
-- COMO: `lib/limiteIa.ts` chama `contar_uso_ia` logo antes de cada chamada ao
-- modelo (resposta de cache não conta). Contador por (usuário, hora), mesmo
-- desenho da 639: incremento atômico, então pedidos em paralelo não furam.
-- O professor (`role = 'admin'`) fica fora do teto — é decisão do código, não
-- desta tabela.
--
-- Sem policy: só o service_role (os endpoints) acessa. A função apaga as horas
-- velhas daquele usuário a cada chamada.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

CREATE TABLE IF NOT EXISTS public.ia_uso_por_hora (
  user_id  uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hora     bigint  NOT NULL,
  chamadas integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, hora)
);

ALTER TABLE public.ia_uso_por_hora ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ia_uso_por_hora FROM public, anon, authenticated;

COMMENT ON TABLE public.ia_uso_por_hora IS
  'Chamadas à IA por usuário e hora (migr. 640). Sem policy de propósito: só o service_role (api/ai-*) acessa.';

CREATE OR REPLACE FUNCTION public.contar_uso_ia(p_user uuid, p_hora bigint)
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH limpa AS (
    DELETE FROM public.ia_uso_por_hora
     WHERE user_id = p_user AND hora < p_hora
  )
  INSERT INTO public.ia_uso_por_hora AS t (user_id, hora, chamadas)
  VALUES (p_user, p_hora, 1)
  ON CONFLICT (user_id, hora) DO UPDATE SET chamadas = t.chamadas + 1
  RETURNING t.chamadas;
$$;

REVOKE ALL ON FUNCTION public.contar_uso_ia(uuid, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contar_uso_ia(uuid, bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
