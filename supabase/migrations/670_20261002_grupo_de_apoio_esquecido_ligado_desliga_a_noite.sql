-- 670 — Grupo de apoio esquecido ligado desliga à noite
--
-- Achado na revisão da 669. A aula da turma tem o encerramento automático do
-- cron das 22:10 (Acre), `encerrar_aulas_ociosas` (migr. 407). O grupo de apoio
-- não tinha — e ele vale MESMO com a aula da turma desligada. O professor que
-- esquecesse o grupo ligado deixaria os dois alunos, no dia seguinte, vendo só
-- as telas do grupo, sem ninguém entender por quê.
--
-- Mesma régua da aula: desliga o grupo que ninguém tocou há mais de `p_horas`
-- (padrão 6). `atualizado_por = NULL` pelo mesmo motivo da 407: quem desligou
-- não foi pessoa nenhuma.
--
-- Corpo copiado do banco (igual nas 4 turmas, conferido por md5 em 02/10). A
-- única mudança é o bloco do grupo, ANTES do `RETURN 0` do caminho sem aula
-- aberta — senão o grupo só desligaria nas noites em que a turma também tivesse
-- esquecido a aula ligada. O retorno continua sendo o nº de sessões da TURMA
-- encerradas, que é o que o cron registra.

BEGIN;

CREATE OR REPLACE FUNCTION public.encerrar_aulas_ociosas(p_horas integer DEFAULT 6)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_n   integer;
BEGIN
  -- Grupo de apoio (migr. 669/670): esquecido ligado, desliga.
  UPDATE public.aula_grupo_apoio_config
     SET ativo = false,
         atualizado_por = NULL,
         atualizado_em = now()
   WHERE id = 1
     AND ativo
     AND atualizado_em < now() - make_interval(hours => GREATEST(COALESCE(p_horas, 6), 1));

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
$function$;

COMMIT;
