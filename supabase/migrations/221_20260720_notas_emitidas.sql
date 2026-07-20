-- =================================================================
-- LogMax — Notas Emitidas (faturamento das filiais)
-- =================================================================
-- Contexto: hoje a filial gera vendas no PDV que viram `contas_receber`
-- + Recibo PDF em memória (RecibosVendasView monta na hora a partir de
-- vendas/itens_venda). Não existe trilha estruturada de "notas emitidas"
-- que permita:
--   • Numeração sequencial por filial (série/número)
--   • Diferenciar NF Produto / NFS-e Serviço / Recibo Simples por nicho
--   • Emissão manual de nota de serviço (TechMax) fora do PDV
--   • Consolidado em Matriz do faturamento por filial × tipo × período
--
-- Cria a tabela + sequência de numeração por filial + RLS canônico
-- (padrão vendas: leitura pra vendas/financeiro/gerente_da_filial,
-- escrita pra vendas/financeiro/gerente_da_filial).
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ─── 1. Tabela notas_emitidas ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notas_emitidas (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  filial          text NOT NULL,
  -- Numeração: sequencial por filial. Ex.: 000123. Preenchido pela RPC.
  numero          integer NOT NULL,
  serie           text NOT NULL DEFAULT '001',
  -- Tipo direciona o template PDF. Regra por nicho no front — servidor
  -- só valida o domínio.
  tipo            text NOT NULL CHECK (tipo IN ('NF Produto', 'NFS-e Serviço', 'Recibo Simples')),
  origem          text NOT NULL DEFAULT 'avulso'
    CHECK (origem IN ('pdv', 'servico_manual', 'avulso')),
  cliente_id      uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nome    text,   -- snapshot pra recibo mesmo se o cliente sumir
  valor_total     numeric(15,2) NOT NULL DEFAULT 0,
  descricao       text NOT NULL,
  data_emissao    date NOT NULL DEFAULT (public.acre_today()),
  -- Rastreio opcional pro fluxo automatizado (PDV)
  venda_id        uuid REFERENCES public.vendas(id) ON DELETE SET NULL,
  conta_receber_id uuid REFERENCES public.contas_receber(id) ON DELETE SET NULL,
  -- Auditoria padrão
  criado_por      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  atualizado_por  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  ativo           boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_emitidas_filial_serie_numero
  ON public.notas_emitidas (filial, serie, numero);
CREATE INDEX IF NOT EXISTS idx_notas_emitidas_filial_data
  ON public.notas_emitidas (filial, data_emissao DESC)
  WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_notas_emitidas_venda
  ON public.notas_emitidas (venda_id) WHERE venda_id IS NOT NULL;

-- ─── 2. RPC pra alocar próximo número atomicamente por (filial, serie) ──
-- Usa LOCK explícito na tabela pra serializar concorrência entre PDV
-- (auto) e emissão manual. Retorna o registro completo.
CREATE OR REPLACE FUNCTION public.emitir_nota(
  p_filial          text,
  p_tipo            text,
  p_origem          text,
  p_cliente_id      uuid,
  p_cliente_nome    text,
  p_valor_total     numeric,
  p_descricao       text,
  p_venda_id        uuid DEFAULT NULL,
  p_conta_receber_id uuid DEFAULT NULL,
  p_data_emissao    date DEFAULT NULL,
  p_serie           text DEFAULT '001'
) RETURNS public.notas_emitidas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next  integer;
  v_row   public.notas_emitidas;
  v_data  date := COALESCE(p_data_emissao, public.acre_today());
BEGIN
  IF p_filial IS NULL OR length(trim(p_filial)) = 0 THEN
    RAISE EXCEPTION 'Filial obrigatória.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_total < 0 THEN
    RAISE EXCEPTION 'Valor negativo não permitido.' USING ERRCODE = 'P0001';
  END IF;
  IF p_descricao IS NULL OR length(trim(p_descricao)) = 0 THEN
    RAISE EXCEPTION 'Descrição obrigatória.' USING ERRCODE = 'P0001';
  END IF;

  -- Serializa concorrência de numeração por (filial, serie) via advisory
  -- lock (hashtext do par). Evita bloquear a tabela inteira.
  PERFORM pg_advisory_xact_lock(hashtext('notas_emitidas:' || p_filial || ':' || p_serie));

  SELECT COALESCE(MAX(numero), 0) + 1
    INTO v_next
    FROM public.notas_emitidas
   WHERE filial = p_filial AND serie = p_serie;

  INSERT INTO public.notas_emitidas (
    filial, numero, serie, tipo, origem,
    cliente_id, cliente_nome, valor_total, descricao, data_emissao,
    venda_id, conta_receber_id, criado_por
  ) VALUES (
    p_filial, v_next, p_serie, p_tipo, p_origem,
    p_cliente_id, p_cliente_nome, p_valor_total, p_descricao, v_data,
    p_venda_id, p_conta_receber_id, auth.uid()
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.emitir_nota(text, text, text, uuid, text, numeric, text, uuid, uuid, date, text)
  TO authenticated;

-- ─── 3. RLS canônica (padrão vendas + gerente_da_filial + auth_pode_filial) ──
ALTER TABLE public.notas_emitidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notas_emitidas_select" ON public.notas_emitidas;
CREATE POLICY "notas_emitidas_select" ON public.notas_emitidas FOR SELECT TO authenticated
  USING ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- INSERT também via RPC criar_venda_pdv (SECURITY DEFINER) — cross-flow.
DROP POLICY IF EXISTS "notas_emitidas_insert" ON public.notas_emitidas;
CREATE POLICY "notas_emitidas_insert" ON public.notas_emitidas FOR INSERT TO authenticated
  WITH CHECK ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

DROP POLICY IF EXISTS "notas_emitidas_update" ON public.notas_emitidas;
CREATE POLICY "notas_emitidas_update" ON public.notas_emitidas FOR UPDATE TO authenticated
  USING ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial))
  WITH CHECK ((auth_in_setor('vendas', 'financeiro') OR auth_gerente_da(filial)) AND auth_pode_filial(filial));

-- Só admin/CEO/conselheiro apaga (soft-delete via UPDATE ativo=false é o padrão).
DROP POLICY IF EXISTS "notas_emitidas_delete" ON public.notas_emitidas;
CREATE POLICY "notas_emitidas_delete" ON public.notas_emitidas FOR DELETE TO authenticated
  USING (auth_is_admin());

COMMIT;
