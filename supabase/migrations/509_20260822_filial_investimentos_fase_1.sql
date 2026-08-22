-- 509_20260822_filial_investimentos_fase_1.sql
--
-- Fase 1 do plano de desembolso da montagem de filial
-- (docs/plano-montagem-filial-investimentos.md). Exceção à trava de
-- features aberta pelo usuário em 2026-08-22 — Fase 0 (migr. 507/508) já
-- corrigiu o DRE, pré-requisito para esta fase existir sem afundar o
-- resultado do mês.
--
-- Hoje "Total Investido em Filiais" vive inteiro em `filiais.detalhes`
-- (jsonb, reescrito por inteiro a cada save) e não gera conta a pagar, caixa
-- nem DRE. Esta migração cria a tabela que vira a fonte da verdade —
-- `CAMPOS_NICHO` no front continua existindo, mas como catálogo de
-- sugestão, não como onde o dado mora.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A tabela
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.filial_investimentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filial_id       uuid REFERENCES public.filiais(id) ON DELETE SET NULL,
  -- Texto, não só FK: é o que casa com a régua de RLS existente
  -- (auth_pode_filial/auth_gerente_da recebem o nicho como texto).
  filial          text NOT NULL CHECK (filial IN ('SuperMax', 'MaxLook', 'TechMax', 'Matriz')),
  chave           text NOT NULL,
  rotulo          text NOT NULL,
  origem_campo    text NOT NULL DEFAULT 'customizado'
                    CHECK (origem_campo IN ('grade', 'customizado')),
  categoria       text NOT NULL DEFAULT 'outro'
                    CHECK (categoria IN ('equipamento', 'aluguel', 'outro')),
  quantidade      numeric(15,3) NOT NULL DEFAULT 1 CHECK (quantidade >= 0),
  preco_unitario  numeric(15,2) NOT NULL DEFAULT 0 CHECK (preco_unitario >= 0),
  valor_total     numeric(15,2) GENERATED ALWAYS AS (ROUND(quantidade * preco_unitario, 2)) STORED,
  centro_custo_id uuid REFERENCES public.centros_custo(id) ON DELETE SET NULL,
  -- É o que dá idempotência ao "Gerar contas a pagar" da Fase 3: item com
  -- conta_pagar_id preenchido é pulado, não convenção de descrição.
  conta_pagar_id  uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  ativo           boolean NOT NULL DEFAULT true,
  criado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filial_investimentos_filial
  ON public.filial_investimentos (filial) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_filial_investimentos_filial_id
  ON public.filial_investimentos (filial_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_filial_investimentos_conta_pagar_id
  ON public.filial_investimentos (conta_pagar_id) WHERE conta_pagar_id IS NOT NULL;

-- Duplo clique em "importar para itens" (Fase 2) não duplica a linha da
-- grade. Item customizado não entra nesta trava — rótulo livre pode repetir
-- de propósito (duas contratações de "Manutenção" em datas diferentes, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS ux_filial_investimentos_grade
  ON public.filial_investimentos (filial_id, chave)
  WHERE ativo AND origem_campo = 'grade';

COMMENT ON TABLE public.filial_investimentos IS
  'Fase 1 do plano de desembolso da montagem de filial (docs/plano-montagem-filial-investimentos.md). Item a item do que compõe o investimento da unidade — substitui as chaves fixas em filiais.detalhes como fonte da verdade.';
COMMENT ON COLUMN public.filial_investimentos.conta_pagar_id IS
  'FK para a conta a pagar gerada pela Fase 3 (RPC gerar_contas_da_montagem). Preenchida = já gerada; é isto que dá idempotência ao botão.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Auditoria: quem fez (migr. 055) + trilha do documento (migr. 331/468)
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_auditoria ON public.filial_investimentos;
CREATE TRIGGER trg_auditoria
  BEFORE INSERT OR UPDATE ON public.filial_investimentos
  FOR EACH ROW EXECUTE FUNCTION public.set_auditoria_campos();

DROP TRIGGER IF EXISTS trg_historico ON public.filial_investimentos;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE ON public.filial_investimentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico(
    'rotulo', 'quantidade', 'preco_unitario', 'categoria', 'centro_custo_id');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — espelha `filiais`: admin/CEO/conselheiro fazem tudo, gerente só
--    na própria unidade (mesmo predicado de filiais_insert/update/delete).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.filial_investimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_filial_investimentos ON public.filial_investimentos;
CREATE POLICY read_filial_investimentos ON public.filial_investimentos
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

DROP POLICY IF EXISTS filial_investimentos_insert ON public.filial_investimentos;
CREATE POLICY filial_investimentos_insert ON public.filial_investimentos
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_admin() OR public.auth_gerente_da(filial));

DROP POLICY IF EXISTS filial_investimentos_update ON public.filial_investimentos;
CREATE POLICY filial_investimentos_update ON public.filial_investimentos
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin() OR public.auth_gerente_da(filial))
  WITH CHECK (public.auth_is_admin() OR public.auth_gerente_da(filial));

DROP POLICY IF EXISTS filial_investimentos_delete ON public.filial_investimentos;
CREATE POLICY filial_investimentos_delete ON public.filial_investimentos
  FOR DELETE TO authenticated
  USING (public.auth_is_admin() OR public.auth_gerente_da(filial));

-- As três restritivas de desligado (padrão migr. 308) — tabela nova nasce
-- fora da varredura que a 308 rodou uma vez só, então recriar aqui é
-- obrigatório, não redundante.
DROP POLICY IF EXISTS zz_desligado_bloqueia_insert ON public.filial_investimentos;
CREATE POLICY zz_desligado_bloqueia_insert ON public.filial_investimentos
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.auth_desligado());

DROP POLICY IF EXISTS zz_desligado_bloqueia_update ON public.filial_investimentos;
CREATE POLICY zz_desligado_bloqueia_update ON public.filial_investimentos
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.auth_desligado());

DROP POLICY IF EXISTS zz_desligado_bloqueia_delete ON public.filial_investimentos;
CREATE POLICY zz_desligado_bloqueia_delete ON public.filial_investimentos
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.auth_desligado());

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Régua do reset — decidida agora, não depois (lição das 12 tabelas
--    órfãs entre a migr. 377 e a 392). É exercício da turma: entra nos dois
--    resets, igual a contas_pagar.
-- ────────────────────────────────────────────────────────────────────────────

DO $migracao$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  -- 4a. APAGAR TUDO (Matriz) — TRUNCATE global.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'resetar_dados_operacionais';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 509: resetar_dados_operacionais não existe neste projeto.';
  END IF;

  IF position('filial_investimentos' in v_def) = 0 THEN
    IF position($anc$contas_pagar, previsoes, duplicatas,$anc$ in v_def) = 0 THEN
      RAISE EXCEPTION 'MIGR 509: âncora do TRUNCATE global não encontrada — abortando.';
    END IF;
    v_novo := replace(v_def,
      $anc$contas_pagar, previsoes, duplicatas,$anc$,
      $rep$contas_pagar, previsoes, duplicatas, filial_investimentos,$rep$);
    EXECUTE v_novo;
  ELSE
    RAISE NOTICE 'MIGR 509: resetar_dados_operacionais já inclui filial_investimentos.';
  END IF;

  -- 4b. Reset por unidade (SuperMax/MaxLook/TechMax).
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'resetar_dados_da_filial';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'MIGR 509: resetar_dados_da_filial não existe neste projeto.';
  END IF;

  IF position('filial_investimentos' in v_def) = 0 THEN
    IF position($anc2$['contas_pagar','filial = $1'],$anc2$ in v_def) = 0 THEN
      RAISE EXCEPTION 'MIGR 509: âncora do reset por unidade não encontrada — abortando.';
    END IF;
    v_novo := replace(v_def,
      $anc2$['contas_pagar','filial = $1'],$anc2$,
      $rep2$['contas_pagar','filial = $1'],
    ['filial_investimentos','filial = $1'],$rep2$);
    EXECUTE v_novo;
  ELSE
    RAISE NOTICE 'MIGR 509: resetar_dados_da_filial já inclui filial_investimentos.';
  END IF;
END
$migracao$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   \d public.filial_investimentos
--
--   SELECT count(*) FROM pg_policies WHERE tablename = 'filial_investimentos';
--   -- esperado: 7 (read/insert/update/delete + 3 zz_desligado_bloqueia_*)
--
--   SELECT prosrc ~ 'filial_investimentos' FROM pg_proc
--    WHERE proname IN ('resetar_dados_operacionais','resetar_dados_da_filial');
--   -- esperado: true nas duas linhas
-- ════════════════════════════════════════════════════════════════════════
