-- 407_20260812_aula_esquecida_ligada_nao_e_aula.sql
--
-- Encerra automaticamente a aula que ficou ligada.
--
-- A migr. 406 registra a aula por sessão: ligar abre, desligar fecha. O
-- desligar é um gesto humano, e gesto humano no fim da aula é o primeiro a ser
-- esquecido — a turma vai embora e o Modo Aula fica no ar. O efeito não é só
-- uma linha feia no histórico: a sessão seguinte é engolida pela anterior, e
-- duas aulas de assuntos diferentes viram uma só, de doze horas.
--
-- O QUE ESTA RPC DESLIGA, E POR QUÊ NÃO É SÓ A SESSÃO:
--
-- A tentação é fechar a sessão (`encerrada_em = now()`) e deixar `aula_config`
-- como está. Isso quebraria o histórico de um jeito silencioso: a trigger da
-- 406 abre sessão na transição false→true de `ativo`. Com a config ainda em
-- `true`, o próximo "ligar" do professor não é transição nenhuma — nenhuma
-- sessão nasce, e as aulas seguintes deixam de ser registradas sem que nada
-- na tela indique isso. Uma correção que desliga o que veio corrigir.
--
-- Então o que a RPC faz é DESLIGAR O MODO AULA. A sessão fecha por
-- consequência, pela mesma trigger de sempre, e não existe segundo caminho
-- para fechar aula — que é o que garante que os dois nunca divergem.
--
-- Efeito colateral desejado: a turma volta ao RBAC normal quando a aula
-- acaba, em vez de passar a noite e o fim de semana com o menu recortado por
-- uma aula que terminou na quinta.
--
-- Janela: `p_horas = 6` por padrão, e o cron roda 22:10 no Acre (03:10 UTC,
-- ver vercel.json). As turmas são de manhã e de tarde (nenhuma às dez da
-- noite), então às 22:10 qualquer aula aberta há mais de seis horas é aula
-- esquecida, não aula em andamento. Uma que tenha começado à noite fica para
-- a varredura do dia seguinte — preferível a arriscar desligar aula viva.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.encerrar_aulas_ociosas(p_horas integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_n   integer;
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM public.aula_sessoes
   WHERE encerrada_em IS NULL
     AND iniciada_em < now() - make_interval(hours => GREATEST(COALESCE(p_horas, 6), 1));

  -- Nada aberto há tempo demais: caminho normal, e a RPC não escreve nada.
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- `atualizado_por = NULL` de propósito: quem desligou não foi pessoa
  -- nenhuma, e carimbar o professor que ligou faria o histórico dizer que ele
  -- encerrou uma aula que ele esqueceu aberta.
  UPDATE public.aula_config
     SET ativo = false,
         atualizado_por = NULL,
         atualizado_em = now()
   WHERE id = 1 AND ativo;

  -- A trigger da 406 já fechou a sessão no UPDATE acima. Este passo carimba
  -- QUEM fechou — e o COALESCE cobre o caso em que `ativo` já estava false
  -- (sessão aberta sem config ligada, que a trigger não teria como fechar).
  UPDATE public.aula_sessoes
     SET encerrada_em  = COALESCE(encerrada_em, now()),
         nome_encerrou = 'Encerramento automático'
   WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Padrão da migr. 260: nada nominalmente para anon. `authenticated` também
-- fica de fora — desligar o Modo Aula de todo mundo não é operação que se
-- ofereça a uma sessão de navegador; quem chama é o cron, com service role.
REVOKE ALL ON FUNCTION public.encerrar_aulas_ociosas(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encerrar_aulas_ociosas(integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO
--   -- simula aula esquecida: abre uma sessão e envelhece o início
--   UPDATE aula_config SET ativo = true WHERE id = 1;
--   UPDATE aula_sessoes SET iniciada_em = now() - interval '9 hours'
--    WHERE encerrada_em IS NULL;
--
--   SELECT public.encerrar_aulas_ociosas();          -- 1
--   SELECT ativo FROM aula_config WHERE id = 1;      -- false
--   SELECT encerrada_em, nome_encerrou FROM aula_sessoes
--    ORDER BY iniciada_em DESC LIMIT 1;              -- preenchida, "Encerramento automático"
--
--   SELECT public.encerrar_aulas_ociosas();          -- 0 (idempotente)
--
--   -- aula viva não é tocada:
--   UPDATE aula_config SET ativo = true WHERE id = 1;
--   SELECT public.encerrar_aulas_ociosas();          -- 0
--   SELECT ativo FROM aula_config WHERE id = 1;      -- true
-- =================================================================
