-- categorias_produto: categorias personalizáveis com cor e ícone
CREATE TABLE IF NOT EXISTS public.categorias_produto (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text        NOT NULL,
  cor        text        NOT NULL DEFAULT '#6b7280',
  icone      text        NOT NULL DEFAULT '📦',
  ativo      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- orcamento_mensal_categoria: orçamento editável por categoria × filial × mês/ano
CREATE TABLE IF NOT EXISTS public.orcamento_mensal_categoria (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid         NOT NULL REFERENCES public.categorias_produto(id) ON DELETE CASCADE,
  filial       text         NOT NULL DEFAULT 'Todas',
  mes          smallint     NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano          smallint     NOT NULL,
  percentual   numeric(5,2) CHECK (percentual >= 0 AND percentual <= 100),
  valor_limite numeric(12,2) CHECK (valor_limite >= 0),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (categoria_id, filial, mes, ano)
);

-- categoria_id em produtos (nullable para não quebrar dados existentes)
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES public.categorias_produto(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_produtos_categoria_id
  ON public.produtos (categoria_id);

CREATE INDEX IF NOT EXISTS idx_orcamento_mensal_periodo
  ON public.orcamento_mensal_categoria (ano, mes, filial);

-- ── RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.categorias_produto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_mensal_categoria ENABLE ROW LEVEL SECURITY;

-- Todos os autenticados leem categorias
CREATE POLICY "categorias_produto_select" ON public.categorias_produto
  FOR SELECT TO authenticated USING (true);

-- Admin/CEO/Gerente criam e editam
CREATE POLICY "categorias_produto_insert" ON public.categorias_produto
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo','gerente')
    )
  );

CREATE POLICY "categorias_produto_update" ON public.categorias_produto
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo','gerente')
    )
  );

-- Somente admin/CEO excluem categoria
CREATE POLICY "categorias_produto_delete" ON public.categorias_produto
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo')
    )
  );

-- Todos os autenticados leem orçamento
CREATE POLICY "orcamento_mensal_select" ON public.orcamento_mensal_categoria
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "orcamento_mensal_insert" ON public.orcamento_mensal_categoria
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo','gerente')
    )
  );

CREATE POLICY "orcamento_mensal_update" ON public.orcamento_mensal_categoria
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo','gerente')
    )
  );

CREATE POLICY "orcamento_mensal_delete" ON public.orcamento_mensal_categoria
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin','ceo','gerente')
    )
  );
