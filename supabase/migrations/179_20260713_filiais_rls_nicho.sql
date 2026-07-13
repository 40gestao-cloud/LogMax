-- =================================================================
-- LogMax — Filiais: isolamento de leitura por nicho (unidade)
-- =================================================================
-- Contexto: a tabela `filiais` guarda os registros de cada unidade
-- física (SuperMax/MaxLook/TechMax/Matriz), com o nicho salvo em
-- `detalhes->>'nicho'` (FiliaisView sempre grava esse campo, vindo da
-- unidade ativa no topbar). A policy de leitura, porém, ficou como
-- `USING (true)` desde o hardening inicial (20260516) e nunca foi
-- revisitada quando o isolamento por filial chegou nas outras tabelas
-- (20260708d_rls_por_filial) — resultado: qualquer autenticado vê os
-- registros de TODAS as unidades, inclusive os cadastrados por outra.
--
-- Regra de negócio (mesma de auth_pode_filial): admin/CEO/conselheiro
-- veem tudo; gerente comum e colaborador só a própria unidade.
--
-- Escrita não muda — `write_admin_empresa` já exige auth_is_admin(),
-- que sempre passa em auth_pode_filial() também.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- Backfill: registros antigos que não têm `detalhes.nicho` gravado
-- (criados antes da 20260710_filiais_detalhes_operacionais) inferem o
-- nicho pelo nome, mesma lógica de `detectarNicho()` no front.
UPDATE public.filiais
SET detalhes = COALESCE(detalhes, '{}'::jsonb) || jsonb_build_object('nicho',
  CASE
    WHEN nome ILIKE '%supermax%' THEN 'SuperMax'
    WHEN nome ILIKE '%maxlook%'  THEN 'MaxLook'
    WHEN nome ILIKE '%techmax%'  THEN 'TechMax'
    ELSE 'Matriz'
  END)
WHERE COALESCE(detalhes->>'nicho', '') = '';

DROP POLICY IF EXISTS "read_authenticated" ON public.filiais;
DROP POLICY IF EXISTS "read_filiais" ON public.filiais;
CREATE POLICY "read_filiais" ON public.filiais FOR SELECT TO authenticated
  USING (auth_pode_filial(COALESCE(detalhes->>'nicho', 'Matriz')));

COMMIT;
