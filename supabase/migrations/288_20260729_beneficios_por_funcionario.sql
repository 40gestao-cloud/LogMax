-- 288 — Benefícios deixam de ser uma lista e passam a chegar em alguém.
--
-- ACHADO (auditoria de veracidade do módulo RH). O submenu Benefícios cadastra
-- nome/tipo/valor por filial e para por aí: não existe nada ligando um
-- benefício a um funcionário. Enquanto isso `folha_pagamento.valor_beneficios`
-- é um campo digitado à mão, sem relação nenhuma com o catálogo — e é ele que
-- credita a carteira de benefícios no MaxBank (`_folha_creditar_e_avancar`).
--
-- Ou seja: o subtítulo "Gerencie os benefícios oferecidos aos funcionários"
-- descrevia algo que o sistema não fazia. Ele gerenciava uma lista.
--
-- Esta migração cria o elo que faltava e a função que soma o que a pessoa tem
-- direito. A folha continua com a coluna `valor_beneficios` — o valor efetivo
-- do mês precisa ficar congelado na folha, senão mexer no catálogo em agosto
-- reescreveria o que foi creditado em julho. O que muda é a origem: a tela
-- passa a propor a soma real em vez de esperar que alguém lembre o número.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O vínculo
--
-- `filial` é redundante com a do funcionário, e mesmo assim entra: as policies
-- desta base decidem escopo por coluna própria (auth_pode_filial(filial)), e
-- fazer a policy pular para `funcionarios` a cada linha custa mais do que
-- manter o campo — que um trigger preenche, para ninguém precisar acertar.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.funcionario_beneficios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  beneficio_id   uuid NOT NULL REFERENCES public.beneficios(id)   ON DELETE CASCADE,
  filial         text NOT NULL DEFAULT 'SuperMax',
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz,
  criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- UNIQUE parcial em `ativo`: sem o WHERE, um vínculo desligado no passado
-- bloquearia religar o mesmo benefício para a mesma pessoa depois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_func_benef_ativo
  ON public.funcionario_beneficios (funcionario_id, beneficio_id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_func_benef_funcionario
  ON public.funcionario_beneficios (funcionario_id) WHERE ativo = true;

-- useFetchData faz order('created_at', desc) hard-coded; sem a coluna a
-- listagem voltaria 400 silencioso e a UI pareceria bloqueada por RLS.
CREATE INDEX IF NOT EXISTS idx_func_benef_created_at
  ON public.funcionario_beneficios (created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A filial vem do funcionário, não de quem está com a tela aberta
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.func_benef_set_filial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(f.filial, 'Matriz') INTO NEW.filial
    FROM public.funcionarios f WHERE f.id = NEW.funcionario_id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_func_benef_set_filial ON public.funcionario_beneficios;
CREATE TRIGGER trg_func_benef_set_filial
  BEFORE INSERT OR UPDATE ON public.funcionario_beneficios
  FOR EACH ROW EXECUTE FUNCTION public.func_benef_set_filial();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — mesma régua do catálogo `beneficios` (leitura por filial,
--    escrita para RH ou gerente da unidade)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.funcionario_beneficios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS func_benef_read ON public.funcionario_beneficios;
CREATE POLICY func_benef_read ON public.funcionario_beneficios
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

DROP POLICY IF EXISTS func_benef_rh_write ON public.funcionario_beneficios;
CREATE POLICY func_benef_rh_write ON public.funcionario_beneficios
  FOR ALL TO authenticated
  USING (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  )
  WITH CHECK (
    (public.auth_in_setor('rh') OR public.auth_gerente_da(filial))
    AND public.auth_pode_filial(filial)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Quanto a pessoa tem de benefício hoje
--
-- Conta só vínculo ativo apontando para benefício ativo e com status 'Ativo' —
-- desativar no catálogo tem de parar de valer sem exigir que alguém saia
-- removendo vínculo a vínculo.
-- ────────────────────────────────────────────────────────────────────────────

-- SECURITY DEFINER com guard explícito: a função enxerga por cima da RLS de
-- `funcionario_beneficios`, então sem a checagem de filial qualquer
-- autenticado somaria os benefícios de gente de outra unidade tendo só o UUID.
-- É um número pequeno, mas é remuneração — e é exatamente o padrão que a
-- migr. 260 fechou nas outras RPCs.
CREATE OR REPLACE FUNCTION public.beneficios_do_funcionario(p_funcionario_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filial text;
  v_total  numeric;
BEGIN
  SELECT COALESCE(f.filial, 'Matriz') INTO v_filial
    FROM public.funcionarios f WHERE f.id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_pode_filial(v_filial) THEN
    RAISE EXCEPTION 'Funcionário de outra filial.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(b.valor), 0)::numeric INTO v_total
    FROM public.funcionario_beneficios fb
    JOIN public.beneficios b ON b.id = fb.beneficio_id
   WHERE fb.funcionario_id = p_funcionario_id
     AND fb.ativo = true
     AND COALESCE(b.ativo, true) = true
     AND COALESCE(b.status, 'Ativo') = 'Ativo';

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.beneficios_do_funcionario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beneficios_do_funcionario(uuid) TO authenticated;

COMMENT ON FUNCTION public.beneficios_do_funcionario(uuid) IS
  'Soma dos benefícios ativos atribuídos ao funcionário. A tela de Folha usa '
  'para propor valor_beneficios; o valor gravado na folha fica congelado, '
  'porque é ele que credita o MaxBank do mês. Migração 288.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funcionario_beneficios TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--   SELECT f.nome, public.beneficios_do_funcionario(f.id) AS beneficios
--     FROM funcionarios f WHERE COALESCE(f.ativo, true) ORDER BY 2 DESC;
-- ────────────────────────────────────────────────────────────────────────────
