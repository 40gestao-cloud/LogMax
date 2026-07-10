-- Métricas de Redes Sociais por filial
-- Registradas manualmente por gerente/colaborador de marketing ou admin/CEO.

CREATE TABLE IF NOT EXISTS metricas_redes_sociais (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  filial          text        NOT NULL,
  plataforma      text        NOT NULL CHECK (plataforma IN ('Instagram','TikTok','Facebook','YouTube')),
  data_registro   date        NOT NULL DEFAULT CURRENT_DATE,
  seguidores      integer     NOT NULL DEFAULT 0,
  curtidas        integer     NOT NULL DEFAULT 0,
  visualizacoes   integer     NOT NULL DEFAULT 0,
  compartilhamentos integer   NOT NULL DEFAULT 0,
  comentarios     integer     NOT NULL DEFAULT 0,
  registrado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ativo           boolean     NOT NULL DEFAULT true
);

ALTER TABLE metricas_redes_sociais ENABLE ROW LEVEL SECURITY;

-- Todos autenticados lêem
CREATE POLICY "metricas_rs_select" ON metricas_redes_sociais
  FOR SELECT USING (auth.role() = 'authenticated');

-- Marketing da própria filial insere; admin/CEO inserem em qualquer filial
CREATE POLICY "metricas_rs_insert" ON metricas_redes_sociais
  FOR INSERT WITH CHECK (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','ceo')
    OR (
      filial = (SELECT filial FROM user_profiles WHERE id = auth.uid())
      AND (SELECT setor FROM user_profiles WHERE id = auth.uid()) = 'marketing'
    )
  );

-- Quem registrou pode atualizar; admin/CEO também
CREATE POLICY "metricas_rs_update" ON metricas_redes_sociais
  FOR UPDATE USING (
    registrado_por = auth.uid()
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','ceo')
  );

-- Apenas admin/CEO deletam
CREATE POLICY "metricas_rs_delete" ON metricas_redes_sociais
  FOR DELETE USING (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','ceo')
  );

CREATE INDEX IF NOT EXISTS idx_metricas_rs_filial_plat_data
  ON metricas_redes_sociais (filial, plataforma, data_registro DESC);
