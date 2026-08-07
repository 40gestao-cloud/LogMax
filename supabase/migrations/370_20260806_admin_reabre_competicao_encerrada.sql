-- =================================================================
-- 370 — Admin reabre competição encerrada
--
-- Declarar a vencedora era irreversível: status vira 'encerrada', o
-- placar congela em `placar_snapshot` e não existia caminho de volta.
-- Errou a filial, encerrou cedo, apareceu nota que faltava — não havia o
-- que fazer a não ser abrir outra competição e perder o histórico.
--
-- `reabrir_competicao` desfaz a DECLARAÇÃO, não a competição: volta para
-- 'aguardando_encerramento', que é exatamente o estado anterior — o
-- conselho segue votando e ninguém dá nota nova. Limpa `vencedora`,
-- `placar_snapshot` e `encerrada_por`, porque nenhum dos três descreve
-- mais a realidade depois de reabrir.
--
-- Os VOTOS ficam. São o registro do que o conselho decidiu; apagá-los
-- obrigaria todo mundo a votar de novo por um erro do admin. Quem quiser
-- mudar o próprio voto já pode.
--
-- Por que 'aguardando_encerramento' e não 'em_andamento': o cron
-- `expirar_competicoes` (migr. 363) move em_andamento → aguardando
-- quando `data_fim` passa. Reabrir para 'em_andamento' uma competição
-- com data vencida seria desfeito na madrugada seguinte, sem aviso.
--
-- Gate: role = 'admin' nominalmente, igual ao de `declarar_vencedora`
-- (migr. 369). `auth_is_admin()` não serve — devolve true para CEO e
-- conselheiro.
--
-- Idempotente.
-- =================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reabrir_competicao(p_competicao_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_status text;
  v_nome   text;
BEGIN
  IF auth_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas a Administração reabre uma competição'
      USING ERRCODE = '42501';
  END IF;

  SELECT status, nome INTO v_status, v_nome
    FROM competicoes_matriz
   WHERE id = p_competicao_id AND ativo = true;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'encerrada' THEN
    RAISE EXCEPTION 'Só competição encerrada pode ser reaberta (status atual: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE competicoes_matriz
     SET status          = 'aguardando_encerramento',
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
    format('"%s" voltou para a votação do conselho — o resultado anterior deixa de valer até nova declaração.', v_nome),
    'matriz-competicao', 'Alta', auth.uid(), p_competicao_id, 'competicao_reaberta', 'Matriz'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_competicao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_competicao(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
