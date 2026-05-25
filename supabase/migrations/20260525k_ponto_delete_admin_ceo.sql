-- =================================================================
-- Admin/CEO podem excluir registros de ponto_qr_registros.
--
-- O trigger trg_sync_ponto (fn_sync_ponto_eletronico) propaga INSERTs
-- de ponto_qr_registros → ponto_eletronico (entrada/saida/horas).
-- Sem cleanup no DELETE, deletar um registro QR deixa a linha
-- correspondente em ponto_eletronico divergente — a folha usaria
-- horário que não existe mais.
--
-- Esta migração:
--   1. Liberar DELETE pra admin/CEO além de RH (gerente RH já tinha).
--   2. Criar trigger AFTER DELETE em ponto_qr_registros que
--      recomputa entrada/saida/horas_trabalhadas/status em
--      ponto_eletronico baseado nos registros restantes do dia.
--      Se não sobrar nenhum, deleta a linha do ponto_eletronico.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Policy de DELETE ───────────────────────────────────────────
DROP POLICY IF EXISTS "pontoqr_delete" ON ponto_qr_registros;
CREATE POLICY "pontoqr_delete" ON ponto_qr_registros
  FOR DELETE TO authenticated
  USING (
    auth_user_role() IN ('admin', 'ceo')
    OR auth_in_setor('rh')
  );

-- ─── 2. Função + trigger de recompute ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_recompute_ponto_eletronico_after_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_func_id  UUID;
  v_data     DATE;
  v_entrada  TIME;
  v_saida    TIME;
BEGIN
  SELECT funcionario_id INTO v_func_id
  FROM user_profiles WHERE id = OLD.user_id;

  IF v_func_id IS NULL THEN
    RETURN OLD;
  END IF;

  v_data := (OLD.registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE;

  -- Re-deriva entrada/saida dos registros restantes do dia.
  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_entrada
    FROM ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'entrada'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em
   LIMIT 1;

  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_saida
    FROM ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'saida'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em DESC
   LIMIT 1;

  IF v_entrada IS NULL AND v_saida IS NULL THEN
    DELETE FROM ponto_eletronico
     WHERE funcionario_id = v_func_id AND data = v_data;
  ELSE
    UPDATE ponto_eletronico
       SET entrada = v_entrada,
           saida   = v_saida,
           horas_trabalhadas = CASE
             WHEN v_entrada IS NOT NULL AND v_saida IS NOT NULL
             THEN ROUND(EXTRACT(EPOCH FROM (v_saida - v_entrada)) / 3600.0, 2)
             ELSE 0
           END,
           status = CASE
             WHEN v_entrada IS NOT NULL AND v_saida IS NOT NULL
                  AND EXTRACT(EPOCH FROM (v_saida - v_entrada)) / 3600.0 > 9
             THEN 'Hora Extra'
             ELSE 'Normal'
           END
     WHERE funcionario_id = v_func_id AND data = v_data;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recompute_ponto ON ponto_qr_registros;
CREATE TRIGGER trg_recompute_ponto
  AFTER DELETE ON ponto_qr_registros
  FOR EACH ROW EXECUTE FUNCTION fn_recompute_ponto_eletronico_after_delete();

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   -- Como admin/CEO logado:
--   DELETE FROM ponto_qr_registros WHERE id = '<uuid>';
--   -- afeta 1 linha. Em seguida confira que ponto_eletronico
--   -- (do mesmo funcionário+dia) foi recomputado/removido.
-- =================================================================
