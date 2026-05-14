-- =================================================================
-- LogMax ERP — Correções P0
-- Execute no Supabase SQL Editor (Settings > SQL Editor)
-- Seguro para executar múltiplas vezes (idempotente).
-- =================================================================

-- -----------------------------------------------------------------
-- 1. TRIGGER: movimentacoes_estoque → atualiza produtos.estoque
--    Entrada/Ajuste somam; Saída subtrai (mínimo 0).
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_atualiza_estoque_produto()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tipo = 'Saída' THEN
    UPDATE produtos
    SET estoque = GREATEST(0, estoque - NEW.qtd)
    WHERE id = NEW.produto_id;
  ELSE
    UPDATE produtos
    SET estoque = estoque + NEW.qtd
    WHERE id = NEW.produto_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_atualiza_estoque ON movimentacoes_estoque;
CREATE TRIGGER trg_atualiza_estoque
  AFTER INSERT ON movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_estoque_produto();

-- -----------------------------------------------------------------
-- 2. SCHEMA: user_profiles — coluna de vínculo com funcionário
-- -----------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS funcionario_id UUID
  REFERENCES funcionarios(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------
-- 3. UNIQUE CONSTRAINT em ponto_eletronico (funcionario + data)
--    Permite o upsert seguro do trigger de ponto QR.
-- -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_ponto_func_data'
  ) THEN
    ALTER TABLE ponto_eletronico
      ADD CONSTRAINT uq_ponto_func_data UNIQUE (funcionario_id, data);
  END IF;
END $$;

-- -----------------------------------------------------------------
-- 4. TRIGGER: ponto_qr_registros → sincroniza ponto_eletronico
--    entrada  → cria/atualiza coluna 'entrada'
--    saida    → atualiza 'saida' e calcula 'horas_trabalhadas'
--    retorno  → ignorado (é checkpoint intermediário)
-- -----------------------------------------------------------------
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

  v_data := (NEW.registrado_em AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_hora := (NEW.registrado_em AT TIME ZONE 'America/Sao_Paulo')::TIME;

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

DROP TRIGGER IF EXISTS trg_sync_ponto ON ponto_qr_registros;
CREATE TRIGGER trg_sync_ponto
  AFTER INSERT ON ponto_qr_registros
  FOR EACH ROW EXECUTE FUNCTION fn_sync_ponto_eletronico();

-- -----------------------------------------------------------------
-- 5. REALTIME: adiciona tabelas críticas à publicação
--    (Erros de "já adicionada" são seguros para ignorar)
-- -----------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['requisicoes','aprovacoes_compras','pedidos',
                            'movimentacoes_estoque','ponto_qr_registros']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------
-- 6. CASCADE: excluir requisição remove sua aprovação associada
-- -----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'aprovacoes_compras_requisicao_id_fkey'
  ) THEN
    ALTER TABLE aprovacoes_compras
      DROP CONSTRAINT aprovacoes_compras_requisicao_id_fkey;
  END IF;

  ALTER TABLE aprovacoes_compras
    ADD CONSTRAINT aprovacoes_compras_requisicao_id_fkey
    FOREIGN KEY (requisicao_id) REFERENCES requisicoes(id) ON DELETE CASCADE;
END $$;
