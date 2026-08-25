-- 529_20260825_o_alarme_sai_da_aba_e_vira_aviso_da_turma.sql
--
-- ═══════════════════════════════════════════════════════════════════════════
-- O alarme deixa de morrer na aba da Central de Tempo
-- ═══════════════════════════════════════════════════════════════════════════
-- Até aqui o alarme era `localStorage` + um `setInterval` DENTRO do card da
-- Central de Tempo. Duas consequências, as duas contra o propósito da coisa:
--
--   1. Saiu da view, o componente desmonta, o intervalo morre e o alarme não
--      toca. Alarme que só toca com a tela do alarme aberta não lembra nada.
--   2. Ficava na máquina de quem cadastrou. O professor marcava o intervalo e
--      a turma não via nada.
--
-- Esta migração dá ao alarme o único lugar onde ele pode alcançar a turma: o
-- banco. A tabela é minúscula de propósito — o disparo continua sendo do
-- cliente (cada aba compara o relógio do Acre com `hora:minuto`), o banco só
-- guarda a régua e a distribui por realtime.
--
-- ── Quem escreve ────────────────────────────────────────────────────────────
-- `role = 'admin'` LITERAL, e não `auth_is_admin()` — este helper inclui aluno
-- em Modo Aula, e alarme é interrupção da turma inteira: nenhum aluno pode
-- fazer a tela de 45 pessoas parar. Mesma régua da 476/513 em `documentos`.
--
-- ── Quem lê ─────────────────────────────────────────────────────────────────
-- Todo mundo autenticado, sem recorte de filial. O alarme é da AULA (intervalo,
-- fim de expediente), não da unidade — recortar por filial só criaria turma
-- pela metade no intervalo.
--
-- ── Os três tipos ───────────────────────────────────────────────────────────
-- `intervalo` e `saida` têm texto fixo no cliente (src/lib/alarmes.ts) e por
-- isso ignoram `mensagem`. `aviso` é o tipo livre e EXIGE mensagem — sem o
-- CHECK, um aviso salvo em branco viraria um modal vazio na tela da turma,
-- que é pior do que não tocar.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A tabela
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alarmes_turma (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hora       smallint NOT NULL,
  minuto     smallint NOT NULL,
  tipo       text     NOT NULL DEFAULT 'aviso',
  mensagem   text,
  ativo      boolean  NOT NULL DEFAULT true,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- CHECKs em bloco separado: `CREATE TABLE IF NOT EXISTS` não acrescenta
-- constraint em tabela que já existe (turma reaplicando a migração).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alarmes_turma_hora_valida') THEN
    ALTER TABLE public.alarmes_turma
      ADD CONSTRAINT alarmes_turma_hora_valida CHECK (hora BETWEEN 0 AND 23);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alarmes_turma_minuto_valido') THEN
    ALTER TABLE public.alarmes_turma
      ADD CONSTRAINT alarmes_turma_minuto_valido CHECK (minuto BETWEEN 0 AND 59);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alarmes_turma_tipo_valido') THEN
    ALTER TABLE public.alarmes_turma
      ADD CONSTRAINT alarmes_turma_tipo_valido CHECK (tipo IN ('aviso', 'intervalo', 'saida'));
  END IF;
  -- Aviso sem texto é modal em branco na tela da turma.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alarmes_turma_aviso_tem_mensagem') THEN
    ALTER TABLE public.alarmes_turma
      ADD CONSTRAINT alarmes_turma_aviso_tem_mensagem
      CHECK (tipo <> 'aviso' OR COALESCE(btrim(mensagem), '') <> '');
  END IF;
END $$;

-- Quem cadastrou vem do banco, não do cliente: o insert do front não manda a
-- coluna, e sem DEFAULT ela nasceria NULL em toda linha — coluna de auditoria
-- que não audita nada.
ALTER TABLE public.alarmes_turma ALTER COLUMN criado_por SET DEFAULT auth.uid();

COMMENT ON TABLE public.alarmes_turma IS
  'Migr. 529 — alarmes da aula. O banco guarda a régua; o disparo é do cliente, comparando o relógio do Acre com hora:minuto.';

-- Um alarme por horário. Sem isto, o professor clicando duas vezes deixa a
-- turma com dois modais empilhados no mesmo minuto.
CREATE UNIQUE INDEX IF NOT EXISTS alarmes_turma_horario_unico
  ON public.alarmes_turma (hora, minuto);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.alarmes_turma ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alarmes_turma_select ON public.alarmes_turma;
CREATE POLICY alarmes_turma_select ON public.alarmes_turma
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS alarmes_turma_insert ON public.alarmes_turma;
CREATE POLICY alarmes_turma_insert ON public.alarmes_turma
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS alarmes_turma_update ON public.alarmes_turma;
CREATE POLICY alarmes_turma_update ON public.alarmes_turma
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS alarmes_turma_delete ON public.alarmes_turma;
CREATE POLICY alarmes_turma_delete ON public.alarmes_turma
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.id = auth.uid() AND p.role = 'admin')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alarmes_turma TO authenticated;
REVOKE ALL ON public.alarmes_turma FROM anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Realtime
-- ────────────────────────────────────────────────────────────────────────────
-- Sem publicação a aba do aluno só veria o alarme no próximo F5 — o professor
-- cadastraria o intervalo às 09h58 para as 10h00 e metade da turma perderia.
-- REPLICA IDENTITY FULL porque o DELETE precisa chegar com o `id` no payload
-- (a aba que já carregou a lista tem de tirar o alarme apagado).
ALTER TABLE public.alarmes_turma REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alarmes_turma'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.alarmes_turma;
  END IF;
END $$;

COMMIT;
