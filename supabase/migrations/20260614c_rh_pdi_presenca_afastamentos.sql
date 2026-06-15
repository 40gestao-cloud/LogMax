-- =================================================================
-- LogMax — RH: PDI + Presença em Treinamentos + Afastamentos
-- =================================================================
-- Três evoluções no módulo RH, agrupadas porque se entrelaçam:
--
--   1. PDI (Plano de Desenvolvimento Individual) — `pdi_itens`.
--      Cada avaliação ganha 0..N metas de desenvolvimento, com prazo
--      e (opcionalmente) um treinamento associado. Fecha o loop
--      Avaliação → Metas → Treinamento que hoje termina na nota.
--
--   2. Presença em Treinamentos — `treinamento_inscricoes`.
--      Inscrever colaboradores num treinamento, marcar presença e
--      gerar certificado (impressão client-side). UNIQUE parcial
--      (treinamento, funcionario) WHERE ativo segue o padrão de
--      [[feedback_partial_unique_soft_delete]].
--
--   3. Afastamentos — `afastamentos` + RPC `aplicar_afastamento_no_ponto`.
--      Atestados, licenças, faltas justificadas, férias gozadas etc.
--      ganham registro próprio (com período + motivo + anexo) e
--      escrevem `ponto_eletronico` como status='Justificado' nos dias
--      do período. O RPC já existente `recalcular_folha_do_ponto`
--      trata 'Justificado' como zero desconto — então afastamentos
--      já fluem pra folha sem mais código.
--
-- Idempotente. Execute no Supabase SQL Editor.
-- =================================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. pdi_itens — metas de desenvolvimento por avaliação
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pdi_itens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_id    uuid        NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
  descricao       text        NOT NULL,
  -- Treinamento opcionalmente vinculado — quando o PDI vira "fazer o
  -- curso X". Apaga-se a FK ao remover o treinamento (mantém o item).
  treinamento_id  uuid        REFERENCES treinamentos(id) ON DELETE SET NULL,
  prazo           date,
  status          text        NOT NULL DEFAULT 'Pendente',
  observacao      text,
  criado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_criador    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pdi_status CHECK (status IN ('Pendente','Em Andamento','Concluído','Cancelado')),
  CONSTRAINT chk_pdi_descricao_nao_vazia CHECK (length(trim(descricao)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_pdi_itens_avaliacao   ON pdi_itens(avaliacao_id);
CREATE INDEX IF NOT EXISTS idx_pdi_itens_treinamento ON pdi_itens(treinamento_id) WHERE treinamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pdi_itens_created_at  ON pdi_itens(created_at DESC);

CREATE OR REPLACE FUNCTION trg_pdi_itens_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS pdi_itens_updated_at ON pdi_itens;
CREATE TRIGGER pdi_itens_updated_at
  BEFORE UPDATE ON pdi_itens
  FOR EACH ROW EXECUTE FUNCTION trg_pdi_itens_updated_at();

ALTER TABLE pdi_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdi_read"   ON pdi_itens;
DROP POLICY IF EXISTS "pdi_insert" ON pdi_itens;
DROP POLICY IF EXISTS "pdi_update" ON pdi_itens;
DROP POLICY IF EXISTS "pdi_delete" ON pdi_itens;

-- PDI herda a visibilidade da avaliação: avaliador, avaliado, gerente
-- do setor do avaliado, admin/CEO. Reaproveita as regras de `avaliacoes_read`.
CREATE POLICY "pdi_read" ON pdi_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (
           auth_is_admin()
           OR a.avaliador_id = auth.uid()
           OR a.avaliado_id  = auth.uid()
           OR (auth_user_role() = 'gerente'
               AND a.avaliado_id IN (SELECT id FROM user_profiles WHERE setor = auth_user_setor()))
         )
    )
  );

-- Insert/Update: avaliador da avaliação OU admin/CEO. Avaliado lê mas
-- não escreve (PDI é "o que meu gerente espera de mim"). Avaliado pode
-- marcar concluído atualizando status via UI separada se quisermos —
-- por ora mantemos write-only com avaliador.
CREATE POLICY "pdi_insert" ON pdi_itens
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (auth_is_admin() OR a.avaliador_id = auth.uid())
    )
  );

CREATE POLICY "pdi_update" ON pdi_itens
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (auth_is_admin() OR a.avaliador_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (auth_is_admin() OR a.avaliador_id = auth.uid())
    )
  );

CREATE POLICY "pdi_delete" ON pdi_itens
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM avaliacoes a
       WHERE a.id = pdi_itens.avaliacao_id
         AND (auth_is_admin() OR a.avaliador_id = auth.uid())
    )
  );

-- ─────────────────────────────────────────────
-- 2. treinamento_inscricoes — presença + certificado
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS treinamento_inscricoes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  treinamento_id  uuid        NOT NULL REFERENCES treinamentos(id) ON DELETE CASCADE,
  funcionario_id  uuid        NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  -- Snapshot do nome no momento da inscrição (caso o funcionário seja
  -- inativado depois — o certificado precisa do nome certo).
  nome_funcionario text,
  status          text        NOT NULL DEFAULT 'Inscrito',
  nota            numeric(4,2),
  data_emissao    timestamptz,
  inscrito_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_inscritor  text,
  ativo           boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_inscricao_status CHECK (status IN ('Inscrito','Presente','Ausente','Concluído','Cancelado')),
  CONSTRAINT chk_inscricao_nota   CHECK (nota IS NULL OR (nota >= 0 AND nota <= 10))
);

-- UNIQUE parcial: 1 inscrição ativa por par (treinamento, funcionário).
-- Inscrição inativada libera reinscrição.
CREATE UNIQUE INDEX IF NOT EXISTS uq_treinamento_inscricoes_ativo
  ON treinamento_inscricoes (treinamento_id, funcionario_id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_inscricoes_treinamento ON treinamento_inscricoes(treinamento_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_inscricoes_funcionario ON treinamento_inscricoes(funcionario_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_inscricoes_created_at  ON treinamento_inscricoes(created_at DESC);

CREATE OR REPLACE FUNCTION trg_treinamento_inscricoes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS treinamento_inscricoes_updated_at ON treinamento_inscricoes;
CREATE TRIGGER treinamento_inscricoes_updated_at
  BEFORE UPDATE ON treinamento_inscricoes
  FOR EACH ROW EXECUTE FUNCTION trg_treinamento_inscricoes_updated_at();

ALTER TABLE treinamento_inscricoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inscricoes_read"   ON treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_insert" ON treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_update" ON treinamento_inscricoes;
DROP POLICY IF EXISTS "inscricoes_delete" ON treinamento_inscricoes;

-- Read: todos autenticados (o próprio inscrito precisa ver o status pra
-- imprimir certificado; colegas podem espiar quem fez quê).
CREATE POLICY "inscricoes_read" ON treinamento_inscricoes
  FOR SELECT TO authenticated USING (true);

-- Write: RH (setor 'rh') + admin/CEO. Padrão de gestão de treinamento.
CREATE POLICY "inscricoes_insert" ON treinamento_inscricoes
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('rh'));

CREATE POLICY "inscricoes_update" ON treinamento_inscricoes
  FOR UPDATE TO authenticated
  USING (auth_in_setor('rh'))
  WITH CHECK (auth_in_setor('rh'));

CREATE POLICY "inscricoes_delete" ON treinamento_inscricoes
  FOR DELETE TO authenticated
  USING (auth_in_setor('rh'));

-- ─────────────────────────────────────────────
-- 3. afastamentos — atestado, licença, falta justificada etc.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS afastamentos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id  uuid        NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  nome_funcionario text,
  tipo            text        NOT NULL,
  data_inicio     date        NOT NULL,
  data_fim        date        NOT NULL,
  descricao       text,
  link_documento  text,
  -- Quando o RPC aplicar_afastamento_no_ponto roda com sucesso, marca
  -- aqui pra não reaplicar (idempotência) e pra mostrar feedback na UI.
  aplicado_no_ponto boolean   NOT NULL DEFAULT false,
  aplicado_em     timestamptz,
  criado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nome_criador    text,
  ativo           boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_afastamento_tipo CHECK (tipo IN (
    'Atestado médico','Licença maternidade','Licença paternidade',
    'Férias gozadas','Falta justificada','Luto','Casamento','Doação de sangue','Outros'
  )),
  CONSTRAINT chk_afastamento_periodo CHECK (data_fim >= data_inicio),
  CONSTRAINT chk_afastamento_link_format
    CHECK (link_documento IS NULL OR link_documento ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_afastamentos_funcionario ON afastamentos(funcionario_id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_afastamentos_periodo     ON afastamentos(data_inicio, data_fim) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_afastamentos_created_at  ON afastamentos(created_at DESC);

CREATE OR REPLACE FUNCTION trg_afastamentos_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS afastamentos_updated_at ON afastamentos;
CREATE TRIGGER afastamentos_updated_at
  BEFORE UPDATE ON afastamentos
  FOR EACH ROW EXECUTE FUNCTION trg_afastamentos_updated_at();

ALTER TABLE afastamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afastamentos_read"   ON afastamentos;
DROP POLICY IF EXISTS "afastamentos_insert" ON afastamentos;
DROP POLICY IF EXISTS "afastamentos_update" ON afastamentos;
DROP POLICY IF EXISTS "afastamentos_delete" ON afastamentos;

-- Read: todos autenticados. Em ambiente educacional [[project_ambiente_educacional]]
-- a privacidade médica não é requisito; outros módulos RH (folha, ponto) também
-- ficam visíveis a todos. RH e admin é quem opera/cria.
CREATE POLICY "afastamentos_read" ON afastamentos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "afastamentos_insert" ON afastamentos
  FOR INSERT TO authenticated
  WITH CHECK (auth_in_setor('rh'));

CREATE POLICY "afastamentos_update" ON afastamentos
  FOR UPDATE TO authenticated
  USING (auth_in_setor('rh'))
  WITH CHECK (auth_in_setor('rh'));

CREATE POLICY "afastamentos_delete" ON afastamentos
  FOR DELETE TO authenticated
  USING (auth_in_setor('rh'));

-- ─────────────────────────────────────────────
-- 4. ponto_eletronico ganha rastreio do afastamento que o justificou
-- ─────────────────────────────────────────────
-- Não-NULL = aquela linha de ponto foi gerada pelo afastamento X.
-- Permite saber por que o dia ficou 'Justificado' e desfazer ao remover.
ALTER TABLE ponto_eletronico
  ADD COLUMN IF NOT EXISTS afastamento_id uuid REFERENCES afastamentos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ponto_afastamento
  ON ponto_eletronico(afastamento_id) WHERE afastamento_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 5. RPC: aplicar_afastamento_no_ponto
-- ─────────────────────────────────────────────
-- Itera nos dias entre data_inicio..data_fim do afastamento e, para cada
-- dia: faz UPSERT em ponto_eletronico marcando status='Justificado' e
-- afastamento_id apontando pra esse registro. Não cria 8h fictícias —
-- horas_trabalhadas fica em 0 (recalcular_folha_do_ponto vê 'Justificado'
-- e zera desconto). Sábado/domingo entram igual; a regra de "que dia é
-- útil" pertence ao calendário, não ao tipo de afastamento.
--
-- Idempotente: rodar duas vezes não duplica (encontra a linha existente
-- e reescreve com o mesmo afastamento_id). Se o dia já tem ponto de
-- outro afastamento (sobreposição), respeita o existente e devolve aviso.

CREATE OR REPLACE FUNCTION aplicar_afastamento_no_ponto(p_afastamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_afastamento afastamentos;
  v_dia         date;
  v_aplicados   int := 0;
  v_pulados     int := 0;
  v_existente   record;
BEGIN
  SELECT * INTO v_afastamento
    FROM afastamentos
   WHERE id = p_afastamento_id
     AND ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Afastamento % não encontrado ou inativo.', p_afastamento_id
      USING ERRCODE = 'P0002';
  END IF;

  v_dia := v_afastamento.data_inicio;
  WHILE v_dia <= v_afastamento.data_fim LOOP
    SELECT id, afastamento_id INTO v_existente
      FROM ponto_eletronico
     WHERE funcionario_id = v_afastamento.funcionario_id
       AND data           = v_dia
     LIMIT 1;

    IF v_existente.id IS NULL THEN
      -- Sem ponto no dia → cria linha justificada.
      INSERT INTO ponto_eletronico (funcionario_id, data, status, horas_trabalhadas, afastamento_id)
      VALUES (v_afastamento.funcionario_id, v_dia, 'Justificado', 0, p_afastamento_id);
      v_aplicados := v_aplicados + 1;

    ELSIF v_existente.afastamento_id IS NULL
       OR v_existente.afastamento_id = p_afastamento_id
    THEN
      -- Tem ponto mas não veio de outro afastamento → sobrescreve.
      UPDATE ponto_eletronico
         SET status            = 'Justificado',
             horas_trabalhadas = 0,
             afastamento_id    = p_afastamento_id
       WHERE id = v_existente.id;
      v_aplicados := v_aplicados + 1;

    ELSE
      -- Tem ponto de OUTRO afastamento ativo → não pisa em cima.
      v_pulados := v_pulados + 1;
    END IF;

    v_dia := v_dia + 1;
  END LOOP;

  UPDATE afastamentos
     SET aplicado_no_ponto = true,
         aplicado_em       = now()
   WHERE id = p_afastamento_id;

  RETURN jsonb_build_object(
    'aplicados', v_aplicados,
    'pulados',   v_pulados,
    'inicio',    v_afastamento.data_inicio,
    'fim',       v_afastamento.data_fim
  );
END;
$$;

REVOKE ALL ON FUNCTION aplicar_afastamento_no_ponto(uuid) FROM public;
GRANT EXECUTE ON FUNCTION aplicar_afastamento_no_ponto(uuid) TO authenticated;

-- ─────────────────────────────────────────────
-- 6. Realtime publication
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pdi_itens'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pdi_itens;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'treinamento_inscricoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE treinamento_inscricoes;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'afastamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE afastamentos;
  END IF;
END $$;

COMMIT;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT count(*) FROM pdi_itens;
--   SELECT count(*) FROM treinamento_inscricoes;
--   SELECT count(*) FROM afastamentos;
--   -- como RH:
--   --   INSERT INTO afastamentos (funcionario_id, nome_funcionario, tipo, data_inicio, data_fim)
--   --     VALUES ('<uuid>', 'João', 'Atestado médico', CURRENT_DATE, CURRENT_DATE + 2);
--   --   SELECT aplicar_afastamento_no_ponto('<id-do-afastamento>');
-- =================================================================
