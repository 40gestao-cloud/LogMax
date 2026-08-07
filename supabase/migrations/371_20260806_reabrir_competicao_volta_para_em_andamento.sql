-- =================================================================
-- 371 — Reabrir competição devolve ela para 'em_andamento'
--
-- A 370 devolvia para 'aguardando_encerramento'. Estado errado: ali TODAS
-- as RPCs de escrita recusam — avaliar, remover avaliação, criar e
-- liberar tarefa. Reabrir servia só para tirar o troféu da tela, e nem
-- CEO nem conselheiro conseguiam mexer nas notas, que é o motivo de
-- reabrir.
--
-- Agora volta para 'em_andamento': a competição roda de novo, o conselho
-- dá e corrige nota, a Matriz cria e libera tarefa.
--
-- O problema da data: o cron `expirar_competicoes` (migr. 363) move
-- em_andamento → aguardando quando `data_fim` passa. Reabrir uma
-- competição já vencida sem tocar na data seria desfeito na madrugada
-- seguinte, em silêncio. Então, se `data_fim` já passou no fuso do Acre,
-- ela é empurrada — para `p_data_fim`, quando informada, ou para hoje.
-- A RPC devolve a data que ficou valendo, para a tela poder dizer isso
-- em vez de o admin descobrir sozinho.
--
-- DROP antes do CREATE porque a assinatura muda (ganha `p_data_fim`).
-- CREATE OR REPLACE criaria uma SOBRECARGA, e o PostgREST recusa resolver
-- duas funções de mesmo nome.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.reabrir_competicao(uuid);

CREATE OR REPLACE FUNCTION public.reabrir_competicao(
  p_competicao_id uuid,
  p_data_fim      date DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status   text;
  v_nome     text;
  v_data_fim date;
  v_hoje     date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_nova_fim date;
BEGIN
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração reabre uma competição'
      USING ERRCODE = '42501';
  END IF;

  SELECT status, nome, data_fim INTO v_status, v_nome, v_data_fim
    FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'encerrada' THEN
    RAISE EXCEPTION 'Só competição encerrada pode ser reaberta (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF p_data_fim IS NOT NULL AND p_data_fim < v_hoje THEN
    RAISE EXCEPTION 'A nova data de fim não pode ser anterior a hoje' USING ERRCODE = 'P0001';
  END IF;

  -- Só empurra se precisa: competição ainda dentro do prazo mantém a data
  -- que o admin definiu.
  v_nova_fim := COALESCE(p_data_fim, GREATEST(v_data_fim, v_hoje));

  UPDATE competicoes_matriz
     SET status          = 'em_andamento',
         data_fim        = v_nova_fim,
         vencedora       = NULL,
         placar_snapshot = NULL,
         encerrada_por   = NULL,
         updated_at      = now()
   WHERE id = p_competicao_id;

  -- A filial viu o pódio e o card de vencedora sumir da tela dela. Sem
  -- aviso isso lê como falha do sistema.
  INSERT INTO notificacoes (setor, tipo, titulo, mensagem, link_view, urgencia, origem_user, ref_id, motivo, filial)
  VALUES (
    'all', 'info',
    'Competição reaberta',
    format('"%s" voltou a correr até %s — o resultado anterior deixa de valer até nova declaração.',
           v_nome, to_char(v_nova_fim, 'DD/MM/YYYY')),
    'matriz-competicao', 'Alta', auth.uid(), p_competicao_id, 'competicao_reaberta', 'Matriz'
  );

  RETURN v_nova_fim;
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_competicao(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_competicao(uuid,date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
