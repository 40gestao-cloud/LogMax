-- A oferta expira pelo calendário, e pode ser encerrada antes do prazo.
--
-- Duas faltas que sobraram da cadeia de promoção, as duas de operação real.
--
-- ─── 1. Proposta que vence esperando decisão ────────────────────────────────
-- A migr. 577 passou a recusar parecer e liberação de oferta cujo período já
-- passou — corretamente: liberar preço para um período encerrado é troco sem
-- venda. Mas nada FECHAVA essas propostas. Elas ficavam na fila para sempre,
-- inflando o badge do Financeiro e sem saída a não ser alguém reprovar na mão.
--
-- Reprovar seria mentira no registro. Reprovar é juízo humano — "eu olhei a
-- margem e recusei". Vencer é o calendário. Carimbar reprovação onde ninguém
-- olhou apaga a diferença entre "o Financeiro barrou" e "a proposta apodreceu
-- na fila", que é exatamente o que a aula precisa conseguir distinguir depois.
-- Nenhum workflow sério auto-reprova por decurso de prazo.
--
-- Entra o status 'Expirada', escrito pelo calendário e por mais ninguém.
--
-- ─── 2. Encerrar a oferta antes do prazo ────────────────────────────────────
-- Puxar uma promoção do ar é rotina de loja: rompeu o estoque, o preço saiu
-- errado, a campanha foi cancelada. Não existia — a única saída era apagar a
-- linha, e no modelo antigo isso deixava o produto preso no preço promocional.
--
-- Depois da migr. 578 ficou trivial: a promoção é uma REGRA, e encerrar a regra
-- basta. Não há preço para restaurar — o de tabela nunca saiu do cadastro. É a
-- prova de que o modelo novo estava certo: a funcionalidade que faltava virou
-- um UPDATE de status.
--
-- Quem encerra é quem libera (o gerente da filial) ou o Financeiro, que
-- responde pela margem. Com justificativa obrigatória: oferta anunciada que
-- some do caixa é pergunta de cliente no dia seguinte, e alguém tem de
-- responder por ela.
--
-- ─── Nota sobre vigências sobrepostas ───────────────────────────────────────
-- Ficou de fora, de propósito, uma trava contra duas ofertas valendo ao mesmo
-- tempo no mesmo produto. Ela fazia sentido no modelo antigo, onde a segunda
-- oferta destruía o preço de tabela guardado pela primeira. Depois da 578 não
-- faz mais: o preço base está intacto, e `promocao_vigente_do_produto()` já
-- resolve o empate pela mais barata — que é o que o varejo faz de verdade,
-- onde várias regras convivem e uma prioridade decide. Proibir seria menos
-- real que permitir.

BEGIN;

-- ─── Expirar: só o calendário escreve este status ────────────────
-- Junta as duas faxinas numa varredura só, que é a que o cron já chama:
--   Aprovado + prazo vencido      → Encerrada (a oferta correu e acabou)
--   Em curso  + prazo vencido     → Expirada  (ninguém decidiu a tempo)
CREATE OR REPLACE FUNCTION public.reverter_promocoes_expiradas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_encerradas INT := 0;
  v_expiradas  INT := 0;
BEGIN
  PERFORM public._assert_rpc();

  -- MIGR 578: não devolve preço nenhum. O cadastro nunca foi sobrescrito.
  WITH e AS (
    UPDATE public.marketing_promocoes
       SET status = 'Encerrada'
     WHERE status = 'Aprovado'
       AND data_fim IS NOT NULL
       AND data_fim < public.acre_today()
    RETURNING 1
  )
  SELECT count(*) INTO v_encerradas FROM e;

  -- MIGR 579: proposta que venceu esperando decisão sai da fila como Expirada.
  -- Não é reprovação: ninguém olhou.
  WITH x AS (
    UPDATE public.marketing_promocoes
       SET status = 'Expirada',
           observacao = COALESCE(NULLIF(observacao, ''), 'Prazo da oferta venceu sem decisão.')
     WHERE status IN ('Aguardando Aprovação', 'Em Análise')
       AND data_fim IS NOT NULL
       AND data_fim < public.acre_today()
    RETURNING 1
  )
  SELECT count(*) INTO v_expiradas FROM x;

  RETURN v_encerradas + v_expiradas;
END;
$function$;

COMMENT ON FUNCTION public.reverter_promocoes_expiradas() IS
  'Faxina diária do calendário: encerra a oferta que correu até o fim e expira a proposta que venceu sem decisão. Não mexe em preço — o de tabela nunca sai do cadastro (migr. 578).';

-- ─── Encerrar antes do prazo ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encerrar_promocao(p_promocao_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo public.marketing_promocoes;
  v_nome  text;
BEGIN
  PERFORM public._assert_rpc();

  IF COALESCE(length(trim(p_motivo)), 0) < 5 THEN
    RAISE EXCEPTION 'Diga por que a oferta está saindo do ar — quem anunciou o preço precisa saber o que responder ao cliente.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM public.marketing_promocoes
   WHERE id = p_promocao_id AND COALESCE(ativo, true) FOR UPDATE;
  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promoção não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só oferta liberada pode ser encerrada (esta está %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.filial IS NOT NULL AND NOT COALESCE(public.auth_pode_filial(v_promo.filial), false) THEN
    RAISE EXCEPTION 'Promoção de outra filial.' USING ERRCODE = '42501';
  END IF;

  -- Quem tira do ar é quem tem autoridade sobre o preço: a unidade que vende
  -- ou o Financeiro, que respondeu pela margem.
  IF NOT COALESCE(public.auth_is_admin(), false) THEN
    IF NOT COALESCE(
         public.auth_gerente_da(v_promo.filial)
         OR public.auth_in_setor('financeiro'), false) THEN
      RAISE EXCEPTION 'Encerrar oferta é do gerente da filial ou do Financeiro.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  -- Encerrar a REGRA basta: o preço de tabela nunca saiu do cadastro, então o
  -- caixa volta a cobrá-lo na próxima leitura. Sem restauração, sem cron.
  UPDATE public.marketing_promocoes
     SET status = 'Encerrada',
         observacao = 'Encerrada antes do prazo por '
                      || COALESCE(v_nome, 'responsável') || ': ' || trim(p_motivo)
   WHERE id = p_promocao_id;

  RETURN jsonb_build_object(
    'promocao_id', p_promocao_id,
    'status',      'Encerrada',
    'encerrada_em', public.acre_today()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.encerrar_promocao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_promocao(uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
