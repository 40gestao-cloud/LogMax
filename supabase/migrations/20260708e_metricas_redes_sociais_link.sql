-- =================================================================
-- LogMax — Links das redes sociais por filial
-- =================================================================
-- Redesenho: o link do perfil/página (Instagram, TikTok, Facebook,
-- YouTube) não é um dado por REGISTRO de métrica — é uma configuração
-- por FILIAL, que muda raramente. Guardar no registro (abordagem
-- anterior) obrigaria a filial a redigitar o mesmo link toda vez que
-- lançasse uma métrica nova.
--
-- Nova tabela: 1 linha por (filial, plataforma) — no máximo 4 por
-- filial — editável uma vez em "Links das Redes Sociais" e reutilizada
-- em todo registro/exibição dessa plataforma.
--
-- Execute no Supabase SQL Editor. Idempotente.
-- =================================================================

CREATE TABLE IF NOT EXISTS redes_sociais_links (
  filial         text NOT NULL,
  plataforma     text NOT NULL CHECK (plataforma IN ('Instagram','TikTok','Facebook','YouTube')),
  link           text,
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (filial, plataforma)
);

ALTER TABLE redes_sociais_links ENABLE ROW LEVEL SECURITY;

-- Todos autenticados lêem (mesmo padrão de metricas_redes_sociais)
DROP POLICY IF EXISTS "redes_links_select" ON redes_sociais_links;
CREATE POLICY "redes_links_select" ON redes_sociais_links
  FOR SELECT USING (auth.role() = 'authenticated');

-- Marketing da própria filial grava/atualiza; admin/CEO em qualquer filial
DROP POLICY IF EXISTS "redes_links_insert" ON redes_sociais_links;
CREATE POLICY "redes_links_insert" ON redes_sociais_links
  FOR INSERT WITH CHECK (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','ceo')
    OR (
      filial = (SELECT filial FROM user_profiles WHERE id = auth.uid())
      AND (SELECT setor FROM user_profiles WHERE id = auth.uid()) = 'marketing'
    )
  );

DROP POLICY IF EXISTS "redes_links_update" ON redes_sociais_links;
CREATE POLICY "redes_links_update" ON redes_sociais_links
  FOR UPDATE USING (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','ceo')
    OR (
      filial = (SELECT filial FROM user_profiles WHERE id = auth.uid())
      AND (SELECT setor FROM user_profiles WHERE id = auth.uid()) = 'marketing'
    )
  ) WITH CHECK (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','ceo')
    OR (
      filial = (SELECT filial FROM user_profiles WHERE id = auth.uid())
      AND (SELECT setor FROM user_profiles WHERE id = auth.uid()) = 'marketing'
    )
  );
