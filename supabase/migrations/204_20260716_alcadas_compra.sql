-- 204_20260716_alcadas_compra.sql
-- Alçada de aprovação de cotações por valor:
--   * Valor ≤ valor_limite_financeiro → Financeiro decide
--   * Valor >  valor_limite_financeiro → Gerente da filial decide
--   * Admin/CEO sempre podem (override total)
-- 1 linha por filial operacional; Matriz não faz compra (fica de fora).
-- Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.alcadas_compra (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filial                    text NOT NULL UNIQUE,
    valor_limite_financeiro   numeric(15,2) NOT NULL DEFAULT 1000
                                CHECK (valor_limite_financeiro >= 0),
    ativo                     boolean NOT NULL DEFAULT true,
    criado_por                uuid REFERENCES auth.users(id),
    atualizado_por            uuid REFERENCES auth.users(id),
    created_at                timestamptz DEFAULT now(),
    updated_at                timestamptz DEFAULT now()
);

-- Seed das 3 filiais operacionais. INSERT ... ON CONFLICT preserva
-- alterações manuais feitas depois pelo admin/CEO na tela de Alçadas.
INSERT INTO public.alcadas_compra (filial, valor_limite_financeiro)
VALUES ('SuperMax', 1000), ('MaxLook', 1000), ('TechMax', 1000)
ON CONFLICT (filial) DO NOTHING;

-- RLS
ALTER TABLE public.alcadas_compra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alcadas_compra_select ON public.alcadas_compra;
DROP POLICY IF EXISTS alcadas_compra_update ON public.alcadas_compra;
DROP POLICY IF EXISTS alcadas_compra_insert ON public.alcadas_compra;

-- Todo autenticado lê (o frontend precisa em Cotações pra bloquear botão).
CREATE POLICY alcadas_compra_select ON public.alcadas_compra
    FOR SELECT USING (auth.role() = 'authenticated');

-- Só admin/CEO altera limites.
CREATE POLICY alcadas_compra_update ON public.alcadas_compra
    FOR UPDATE USING (public.auth_is_admin())
    WITH CHECK (public.auth_is_admin());

CREATE POLICY alcadas_compra_insert ON public.alcadas_compra
    FOR INSERT WITH CHECK (public.auth_is_admin());

GRANT SELECT, INSERT, UPDATE ON public.alcadas_compra TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
