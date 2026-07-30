-- 302_20260730_pendentes_leitura_pagador_autenticado.sql
--
-- Corrige regressão das migrações 257 (pix_pendentes) e 261 (cartao_pendentes /
-- beneficios_pendentes).
--
-- O que quebrou: as duas migrações escoparam as policies de `authenticated` a
-- `operador_id = auth.uid() OR auth_is_admin()`. O comentário da 261 dizia que
-- as policies de `anon` (MaxPay/MaxBank) não seriam tocadas — e não foram. O
-- que passou batido é que o MaxBank NÃO é anônimo: `getSupabaseClient()` cria o
-- cliente com `persistSession: true`, então o colaborador logado na carteira
-- chega ao PostgREST como `authenticated`. Policy de `anon` não se aplica a
-- `authenticated` — as duas roles são disjuntas no `TO` da policy.
--
-- Resultado: quem paga é sempre um usuário diferente do operador que criou a
-- cobrança no PDV, então o SELECT voltava 0 linhas e o app dizia "Cobrança não
-- encontrada". Vale para Débito e Crédito, e igualmente para Pix e Benefícios.
--
-- Fix: espelhar para `authenticated` exatamente o que `anon` já pode fazer.
-- Não abre nada novo — qualquer um com a anon key (que é pública, vai no
-- bundle) já tinha esse acesso. A régua da 257/261 continua valendo para o
-- resto (listar cobrança de outro operador, cancelar, apagar).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- cartao_pendentes — MaxBank lê a cobrança da maquininha pelo id do QR
-- ────────────────────────────────────────────────────────────────────────────
-- UPDATE não precisa de espelho: a autorização passa por
-- autorizar_cartao_maxbank / confirmar_cartao_pendente, ambas SECURITY DEFINER.
DROP POLICY IF EXISTS cartao_pendentes_pagador_select ON public.cartao_pendentes;
CREATE POLICY cartao_pendentes_pagador_select ON public.cartao_pendentes
  FOR SELECT TO authenticated
  USING (status = 'aguardando');

-- ────────────────────────────────────────────────────────────────────────────
-- pix_pendentes — mesma história no fluxo Pix (Recebimento e Pagar com salário)
-- ────────────────────────────────────────────────────────────────────────────
-- A baixa é via confirmar_pix_pendente (SECURITY DEFINER), então só o SELECT.
DROP POLICY IF EXISTS pix_pendentes_pagador_select ON public.pix_pendentes;
CREATE POLICY pix_pendentes_pagador_select ON public.pix_pendentes
  FOR SELECT TO authenticated
  USING (status = 'aguardando');

-- ────────────────────────────────────────────────────────────────────────────
-- beneficios_pendentes — código curto digitado no MaxBank
-- ────────────────────────────────────────────────────────────────────────────
-- Aqui o UPDATE também precisa de espelho: `confirmarPagamentoBeneficios`
-- (maxbank/src/lib/pagamento.ts) marca 'pago' com UPDATE direto, não RPC.
-- Mesmo par de condições da policy anon, inclusive o `expires_at > now()`.
DROP POLICY IF EXISTS beneficios_pendentes_pagador_select ON public.beneficios_pendentes;
CREATE POLICY beneficios_pendentes_pagador_select ON public.beneficios_pendentes
  FOR SELECT TO authenticated
  USING (status = 'aguardando' AND expires_at > now());

DROP POLICY IF EXISTS beneficios_pendentes_pagador_update ON public.beneficios_pendentes;
CREATE POLICY beneficios_pendentes_pagador_update ON public.beneficios_pendentes
  FOR UPDATE TO authenticated
  USING (status = 'aguardando' AND expires_at > now())
  WITH CHECK (status = 'pago');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) As 4 policies novas existem:
-- SELECT c.relname, p.polname, p.polcmd
--   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--  WHERE p.polname LIKE '%_pagador_%' ORDER BY 1, 2;
--
-- 2) Fim a fim: PDV SuperMax > Cartão Débito > maquininha MaxPay acha a
--    cobrança > MaxBank (LOGADO na carteira) escaneia o QR. Antes dava
--    "Cobrança não encontrada"; agora deve abrir a tela de confirmação.
