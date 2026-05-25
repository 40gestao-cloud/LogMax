-- =================================================================
-- Corrige fuso do trigger de sincronização do Ponto Eletrônico.
-- Operação roda no Acre (UTC-5); o trigger anterior usava
-- America/Sao_Paulo (UTC-3), o que gerava data/hora 2h adiantadas
-- em `ponto_eletronico.entrada/saida` e ainda virava o dia no fim
-- do expediente.
--
-- Idempotente: pode ser reaplicada com segurança.
-- =================================================================

CREATE OR REPLACE FUNCTION fn_sync_ponto_eletronico()
RETURNS TRIGGER AS $$
DECLARE
  v_func_id  UUID;
  v_data     DATE;
  v_hora     TIME;
  v_ponto_id UUID;
  v_entrada  TIME;
BEGIN
  SELECT funcionario_id INTO v_func_id
  FROM user_profiles WHERE id = NEW.user_id;

  IF v_func_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_data := (NEW.registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE;
  v_hora := (NEW.registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME;

  SELECT id, entrada INTO v_ponto_id, v_entrada
  FROM ponto_eletronico
  WHERE funcionario_id = v_func_id AND data = v_data;

  IF NEW.tipo = 'entrada' THEN
    IF v_ponto_id IS NULL THEN
      INSERT INTO ponto_eletronico (funcionario_id, data, entrada, status)
      VALUES (v_func_id, v_data, v_hora, 'Normal');
    ELSE
      UPDATE ponto_eletronico SET entrada = v_hora WHERE id = v_ponto_id;
    END IF;

  ELSIF NEW.tipo = 'saida' THEN
    IF v_ponto_id IS NULL THEN
      INSERT INTO ponto_eletronico (funcionario_id, data, saida, status)
      VALUES (v_func_id, v_data, v_hora, 'Normal');
    ELSE
      UPDATE ponto_eletronico
      SET
        saida = v_hora,
        horas_trabalhadas = ROUND(
          EXTRACT(EPOCH FROM (v_hora - COALESCE(v_entrada, v_hora))) / 3600.0, 2
        ),
        status = CASE
          WHEN v_entrada IS NOT NULL
            AND EXTRACT(EPOCH FROM (v_hora - v_entrada)) / 3600.0 > 9
          THEN 'Hora Extra'
          ELSE 'Normal'
        END
      WHERE id = v_ponto_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger continua o mesmo (apontando para a função recriada acima).
DROP TRIGGER IF EXISTS trg_sync_ponto ON ponto_qr_registros;
CREATE TRIGGER trg_sync_ponto
  AFTER INSERT ON ponto_qr_registros
  FOR EACH ROW EXECUTE FUNCTION fn_sync_ponto_eletronico();
