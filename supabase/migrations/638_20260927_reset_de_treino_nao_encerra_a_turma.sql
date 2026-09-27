-- 638_20260927_reset_de_treino_nao_encerra_a_turma.sql
--
-- O APAGAR TUDO tem dois usos, e a 505 só enxergou um.
--
--   1. Virada de turma: entram alunos novos. O ponto de antes é de outra gente
--      e não pode contar na folha de quem chegou — é o que a 505 resolveu
--      carimbando `ponto_corte_turma`.
--   2. Recomeço de treino: a MESMA turma errou muito num exercício e o
--      professor zera para refazer. Ninguém mudou; o ponto das aulas já dadas
--      é dessa gente e continua valendo.
--
-- Hoje o reset carimba o corte nos dois casos. Na turma Adm (27/09) um
-- recomeço de treino transformou as quatro quintas-feiras de setembro em
-- "Turma anterior": fora da folha e travadas para correção.
--
-- A escolha passa a ser do professor, a cada reset, e é obrigatória — não há
-- default, porque os dois erros custam caro: carimbar sem querer trava o ponto
-- da turma em curso; não carimbar numa turma nova faz o aluno herdar as faltas
-- do anterior (furo 2 da 505).
--
-- COMO: porta nova `resetar_dados_operacionais_admin(p_encerra_turma)`, mesmo
-- guard da 412. `resetar_dados_operacionais()` NÃO é reescrita (a régua de
-- TRUNCATE é longa e já custou caro reescrever). Quando o professor diz que
-- não é turma nova, a porta devolve `configuracoes.ponto_corte_turma` ao valor
-- que tinha antes do reset — inclusive à ausência, se nunca houve corte.
--
-- A porta sem argumento fica, com o comportamento de sempre (encerra a turma),
-- só para a aba aberta com o bundle antigo durante o deploy não quebrar.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.resetar_dados_operacionais_admin(p_encerra_turma boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_tinha_corte boolean;
  v_corte_antes text;
  v_res         jsonb;
BEGIN
  -- Mesmo guard da 412: `role = 'admin'` literal, e COALESCE porque NULL num
  -- IF NOT não barra ninguém.
  IF NOT COALESCE(public.auth_user_role() = 'admin', false) THEN
    RAISE EXCEPTION 'Apenas o administrador pode apagar os dados operacionais.'
      USING ERRCODE = '42501';
  END IF;

  IF p_encerra_turma IS NULL THEN
    RAISE EXCEPTION 'Diga se o reset encerra a turma ou só recomeça o treino.'
      USING ERRCODE = '22004';
  END IF;

  SELECT valor INTO v_corte_antes
    FROM public.configuracoes WHERE chave = 'ponto_corte_turma';
  v_tinha_corte := FOUND;

  v_res := public.resetar_dados_operacionais();

  IF NOT p_encerra_turma THEN
    IF v_tinha_corte THEN
      UPDATE public.configuracoes
         SET valor = v_corte_antes, updated_at = now()
       WHERE chave = 'ponto_corte_turma';
    ELSE
      DELETE FROM public.configuracoes WHERE chave = 'ponto_corte_turma';
    END IF;
  END IF;

  RETURN v_res
    || jsonb_build_object(
         'turma_encerrada', p_encerra_turma,
         'corte_turma', CASE WHEN p_encerra_turma THEN v_res->'corte_turma' ELSE 'null'::jsonb END);
END;
$function$;

COMMENT ON FUNCTION public.resetar_dados_operacionais_admin(boolean) IS
  '(638) APAGAR TUDO do professor. p_encerra_turma=true carimba ponto_corte_turma (turma nova); false preserva o corte anterior (recomeço de treino da mesma turma).';

-- RPC nova nasce executável por PUBLIC (e portanto anon).
REVOKE ALL ON FUNCTION public.resetar_dados_operacionais_admin(boolean) FROM public;
REVOKE ALL ON FUNCTION public.resetar_dados_operacionais_admin(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.resetar_dados_operacionais_admin(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resetar_dados_operacionais_admin(boolean) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
