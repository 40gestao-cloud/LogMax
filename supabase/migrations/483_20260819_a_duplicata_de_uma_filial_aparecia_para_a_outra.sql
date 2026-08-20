-- 483_20260819_a_duplicata_de_uma_filial_aparecia_para_a_outra.sql
--
-- `duplicatas`, `previsoes` e `integracoes_bancarias` ganham `filial` e passam a
-- isolar por unidade. Hoje a RLS das três é só de setor:
--
--     USING (auth_in_setor('financeiro'))
--
-- Sem `auth_pode_filial`. É o padrão que [[feedback_setor_sem_filial]] descreve
-- e que as migrs. 436/437 e 478 já fecharam em outras tabelas: papel não é
-- contexto de filial. Quem é do financeiro da MaxLook satisfaz o predicado
-- olhando a duplicata da SuperMax — e não só lê: a policy é FOR ALL, então
-- edita e apaga também.
--
-- Elas escaparam porque a migr. 053, que deu `filial` a `contas_pagar` e
-- `contas_receber`, não levou as vizinhas de módulo junto. Ficaram três tabelas
-- de financeiro sem dono, no meio de um módulo inteiro que já era por filial.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ISTO NÃO É
--
-- Não é incidente. As três estão com ZERO linhas nas quatro turmas, e nenhuma
-- tela do app as consome: `duplicatas` e `previsoes` têm endpoint mapeado e
-- nenhum consumidor, e `IntegracaoBancariaView` está exportada mas não é
-- montada em lugar nenhum do `App.tsx`. O furo é de esquema e de API — quem
-- tivesse o token e o endpoint passaria —, não de tela.
--
-- É por isso que dá para consertar agora de graça: sem linha nenhuma, não há de
-- quem-é-esta-duplicata para adivinhar. Daqui a um mês, com a turma lançando,
-- o mesmo conserto viraria um backfill por chute.
--
-- Motivo imediato: o reset por filial (a vir) precisa saber de quem é cada
-- linha. Estas três eram a única zona cinzenta com jeito de resolver — as
-- outras quatro sem filial (`feedbacks_organizacao`, `briefings_diarios`,
-- `relatorios_bi`, `desenvolvimentos_ia`) são da organização por desenho e
-- devem continuar sem.
--
-- ────────────────────────────────────────────────────────────────────────────
-- NOT NULL DE PROPÓSITO
--
-- `auth_pode_filial(NULL)` é falso para quem não é admin — linha sem filial
-- nasceria invisível para o próprio autor, que é o pior dos dois mundos: o
-- INSERT passa e o registro some. Com NOT NULL o erro aparece na hora de
-- gravar, onde dá para corrigir. Como as quatro turmas estão vazias, o NOT NULL
-- entra sem backfill — mas o bloco confere antes, para não abortar a migração
-- numa base que eu não vi.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ─── 1. A coluna ────────────────────────────────────────────────────────────
ALTER TABLE public.duplicatas            ADD COLUMN IF NOT EXISTS filial text;
ALTER TABLE public.previsoes             ADD COLUMN IF NOT EXISTS filial text;
ALTER TABLE public.integracoes_bancarias ADD COLUMN IF NOT EXISTS filial text;

COMMENT ON COLUMN public.duplicatas.filial IS
  'Unidade dona da duplicata. Migr. 483 — antes a RLS era só de setor e o financeiro de uma filial via a duplicata da outra.';
COMMENT ON COLUMN public.previsoes.filial IS
  'Unidade dona da previsão. Migr. 483 — ver duplicatas.filial.';
COMMENT ON COLUMN public.integracoes_bancarias.filial IS
  'Unidade dona da importação bancária. Migr. 483 — ver duplicatas.filial.';

-- NOT NULL só quando não há linha órfã. Numa base já povoada a migração avisa
-- e segue: a policy nova já isola, e o NOT NULL entra depois do backfill.
DO $notnull$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['duplicatas', 'previsoes', 'integracoes_bancarias'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE filial IS NULL', t) INTO n;
    IF n = 0 THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN filial SET NOT NULL', t);
    ELSE
      RAISE NOTICE '[483] %: % linha(s) sem filial — NOT NULL não aplicado. Faça o backfill e rode: ALTER TABLE public.% ALTER COLUMN filial SET NOT NULL;', t, n, t;
    END IF;
  END LOOP;
END;
$notnull$;

CREATE INDEX IF NOT EXISTS idx_duplicatas_filial            ON public.duplicatas (filial);
CREATE INDEX IF NOT EXISTS idx_previsoes_filial             ON public.previsoes (filial);
CREATE INDEX IF NOT EXISTS idx_integracoes_bancarias_filial ON public.integracoes_bancarias (filial);

-- ─── 2. A RLS ───────────────────────────────────────────────────────────────
-- `auth_pode_filial` já cobre admin/CEO/conselheiro (passam em todas) e prende
-- gerente e colaborador na própria unidade. COALESCE não é preciso aqui: a
-- função é STRICT-free e devolve boolean, e o AND com NULL não vira permissão
-- dentro de uma policy (NULL não é TRUE).
DROP POLICY IF EXISTS fin_all ON public.duplicatas;
CREATE POLICY fin_all ON public.duplicatas FOR ALL TO authenticated
  USING      (auth_in_setor('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));

DROP POLICY IF EXISTS fin_all ON public.previsoes;
CREATE POLICY fin_all ON public.previsoes FOR ALL TO authenticated
  USING      (auth_in_setor('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));

DROP POLICY IF EXISTS fin_all ON public.integracoes_bancarias;
CREATE POLICY fin_all ON public.integracoes_bancarias FOR ALL TO authenticated
  USING      (auth_in_setor('financeiro') AND auth_pode_filial(filial))
  WITH CHECK (auth_in_setor('financeiro') AND auth_pode_filial(filial));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT tablename, qual FROM pg_policies
--    WHERE schemaname='public' AND policyname='fin_all'
--      AND tablename IN ('duplicatas','previsoes','integracoes_bancarias');
--   -- as três têm de mencionar auth_pode_filial
--
--   SELECT table_name, is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='filial'
--      AND table_name IN ('duplicatas','previsoes','integracoes_bancarias');
--   -- espera NO nas três
--
-- ATENÇÃO a quem for montar a tela: `IntegracaoBancariaView` não passa `filial`
-- no `dbInsert`. Com o NOT NULL desta migração, o INSERT falha até alguém
-- acrescentar o campo. É de propósito — falhar na gravação é melhor que gravar
-- um registro que some da tela de quem o criou.
-- ════════════════════════════════════════════════════════════════════════════
