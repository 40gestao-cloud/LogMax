-- ── subcategorias_produto ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subcategorias_produto (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid        NOT NULL REFERENCES public.categorias_produto(id) ON DELETE CASCADE,
  nome         text        NOT NULL,
  cor          text        NOT NULL DEFAULT '#6b7280',
  icone        text        NOT NULL DEFAULT '📦',
  ativo        boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subcategorias_categoria_id ON public.subcategorias_produto(categoria_id);
CREATE INDEX IF NOT EXISTS idx_subcategorias_created_at   ON public.subcategorias_produto(created_at DESC);

-- ── produtos: coluna subcategoria_id ─────────────────────────────────────────
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS subcategoria_id uuid REFERENCES public.subcategorias_produto(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_produtos_subcategoria_id ON public.produtos(subcategoria_id);

-- ── itens_campanha ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.itens_campanha (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id         uuid         NOT NULL REFERENCES public.marketing_campanhas(id) ON DELETE CASCADE,
  produto_id          uuid         NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_atual         numeric(12,2),
  preco_promocional   numeric(12,2),
  percentual_desconto numeric(5,2),
  status              text         NOT NULL DEFAULT 'Pendente',
  motivo_reprovacao   text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(campanha_id, produto_id),
  CONSTRAINT chk_item_campanha_status CHECK (status IN ('Pendente','Aprovado','Reprovado'))
);

CREATE INDEX IF NOT EXISTS idx_itens_campanha_campanha_id ON public.itens_campanha(campanha_id);
CREATE INDEX IF NOT EXISTS idx_itens_campanha_status      ON public.itens_campanha(status);

-- ── marketing_campanhas: novos status ────────────────────────────────────────
ALTER TABLE public.marketing_campanhas DROP CONSTRAINT IF EXISTS chk_campanha_status;
ALTER TABLE public.marketing_campanhas ADD CONSTRAINT chk_campanha_status
  CHECK (status IN (
    'Rascunho','Aguardando Financeiro',
    'Aprovado','Parcialmente Aprovado','Reprovado',
    'Ativa','Concluída','Cancelada'
  ));

-- ── RLS: subcategorias_produto ────────────────────────────────────────────────
ALTER TABLE public.subcategorias_produto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subcategorias_select" ON public.subcategorias_produto
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "subcategorias_insert" ON public.subcategorias_produto
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );

CREATE POLICY "subcategorias_update" ON public.subcategorias_produto
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );

CREATE POLICY "subcategorias_delete" ON public.subcategorias_produto
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo')
    )
  );

-- ── RLS: itens_campanha ───────────────────────────────────────────────────────
ALTER TABLE public.itens_campanha ENABLE ROW LEVEL SECURITY;

CREATE POLICY "itens_campanha_select" ON public.itens_campanha
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "itens_campanha_insert" ON public.itens_campanha
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'marketing'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['marketing']))
    )
  );

CREATE POLICY "itens_campanha_update" ON public.itens_campanha
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor IN ('marketing','financeiro')
          OR (up.setores_extras IS NOT NULL
              AND (up.setores_extras @> ARRAY['marketing']
                OR up.setores_extras @> ARRAY['financeiro'])))
    )
  );

CREATE POLICY "itens_campanha_delete" ON public.itens_campanha
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'marketing'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['marketing']))
    )
  );

-- ── RLS: categorias_produto — restringe a logística + admin/CEO ───────────────
DROP POLICY IF EXISTS "categorias_produto_insert" ON public.categorias_produto;
DROP POLICY IF EXISTS "categorias_produto_update" ON public.categorias_produto;

CREATE POLICY "categorias_produto_insert" ON public.categorias_produto
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );

CREATE POLICY "categorias_produto_update" ON public.categorias_produto
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (up.role IN ('admin','ceo')
          OR up.setor = 'logistica'
          OR (up.setores_extras IS NOT NULL AND up.setores_extras @> ARRAY['logistica']))
    )
  );
