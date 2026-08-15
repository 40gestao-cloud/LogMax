-- 424_20260814_a_mercearia_finalmente_olha_a_validade.sql
--
-- A SUPERMAX É UMA MERCEARIA QUE NUNCA OLHOU UMA DATA DE VALIDADE.
--
-- `vencimentos_estoque` existe desde a migr. 010: tem tabela, tem policy, tem
-- endpoint mapeado em `src/lib/supabase.ts` — e não tem tela, submenu nem rota.
-- Nunca foi usada uma vez. O resultado é que o produto perecível entra no
-- estoque igual a um parafuso, fica lá até alguém reparar, e a perda por
-- validade — que numa mercearia real é a segunda maior sangria depois do
-- furto — simplesmente não existe no sistema.
--
-- Esta migração dá dentes à tabela que já estava lá:
--
--   1. o lote passa a saber de onde veio (`recebimento_id`);
--   2. o status vira lista fechada — 'OK', 'Consumido', 'Perda';
--   3. a RLS deixa de ser cross-filial;
--   4. `baixar_lote_vencido` transforma "venceu" em baixa de estoque de verdade.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RLS ESTAVA ABERTA ENTRE FILIAIS
--
-- A policy original é uma só, `logist_all`, com
-- `auth_in_setor('logistica')` e nada de filial. Ou seja: a Logística da
-- MaxLook enxergava e editava os lotes da SuperMax. Passou despercebido porque
-- a tabela nunca teve tela — mas a partir do momento em que tem, o buraco
-- valeria uma aula inteira de F12. Agora é a régua de sempre: enxerga a própria
-- unidade, escreve quem é da Logística ou gerente dela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRAÇÃO **NÃO** FAZ, DE PROPÓSITO
--
-- A venda no PDV não escolhe lote. Baixar o lote certo a cada venda exigiria o
-- PDV perguntar "de qual lote saiu?" a cada item — inviável no balcão e
-- pedagogicamente pior que o problema. O controle aqui é de VALIDADE
-- (rastreamento e perda), não um segundo livro-caixa de estoque; por isso a
-- tela mostra lado a lado o saldo do produto e o que há em lotes, para a
-- diferença ficar visível em vez de fingida.
--
-- FEFO aqui é ordem de prioridade — a tela lista o que vence primeiro e é isso
-- que o aluno usa para decidir o que vender/promover antes —, não consumo
-- automático.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O lote ganha origem e disciplina
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vencimentos_estoque
  ADD COLUMN IF NOT EXISTS recebimento_id uuid REFERENCES public.recebimentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observacao     text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.vencimentos_estoque'::regclass
       AND conname  = 'vencimentos_estoque_status_valido'
  ) THEN
    ALTER TABLE public.vencimentos_estoque
      ADD CONSTRAINT vencimentos_estoque_status_valido
      CHECK (status IN ('OK', 'Consumido', 'Perda'))
      NOT VALID;  -- 4 bancos com histórico; barra o que entra de hoje em diante
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vencimentos_estoque_filial_venc
  ON public.vencimentos_estoque (filial, vencimento);
CREATE INDEX IF NOT EXISTS idx_vencimentos_estoque_produto
  ON public.vencimentos_estoque (produto_id);

COMMENT ON TABLE public.vencimentos_estoque IS
  'Lotes com data de validade. Controle de validade e perda — NÃO é o saldo do produto, que vive em produtos.estoque (vide migr. 424).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A RLS passa a respeitar a filial
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS logist_all ON public.vencimentos_estoque;

DROP POLICY IF EXISTS venc_select ON public.vencimentos_estoque;
CREATE POLICY venc_select ON public.vencimentos_estoque
  FOR SELECT TO authenticated
  USING (public.auth_pode_filial(filial));

DROP POLICY IF EXISTS venc_write ON public.vencimentos_estoque;
CREATE POLICY venc_write ON public.vencimentos_estoque
  FOR ALL TO authenticated
  USING (
    public.auth_pode_filial(filial)
    AND (public.auth_in_setor('logistica') OR public.auth_gerente_da(filial))
  )
  WITH CHECK (
    public.auth_pode_filial(filial)
    AND (public.auth_in_setor('logistica') OR public.auth_gerente_da(filial))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. "Venceu" vira baixa de estoque
--
-- Ajuste − e não Saída: a diferença é o vocabulário do módulo — Saída é
-- mercadoria que foi para algum lugar (venda, requisição), Ajuste − é
-- mercadoria que deixou de existir. Perda por validade é a segunda.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.baixar_lote_vencido(
  p_lote_id uuid,
  p_qtd     integer DEFAULT NULL,
  p_motivo  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote     vencimentos_estoque;
  v_qtd      integer;
  v_restante integer;
  v_produto  text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_lote
    FROM public.vencimentos_estoque
   WHERE id = p_lote_id AND COALESCE(ativo, true)
     FOR UPDATE;

  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_lote.filial), false) THEN
    RAISE EXCEPTION 'Lote de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('logistica'), false)
          OR COALESCE(public.auth_gerente_da(v_lote.filial), false)) THEN
    RAISE EXCEPTION 'Apenas a Logística ou o gerente da filial dão baixa em lote vencido.'
      USING ERRCODE = '42501';
  END IF;
  IF v_lote.status <> 'OK' THEN
    RAISE EXCEPTION 'Este lote já foi encerrado como "%".', v_lote.status USING ERRCODE = 'P0001';
  END IF;
  IF v_lote.produto_id IS NULL THEN
    RAISE EXCEPTION 'Lote sem produto vinculado — não há saldo para baixar.' USING ERRCODE = 'P0001';
  END IF;

  -- Sem quantidade = perde o lote inteiro, que é o caso comum.
  v_qtd := COALESCE(p_qtd, v_lote.qtd, 0);
  IF v_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade perdida precisa ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF v_qtd > COALESCE(v_lote.qtd, 0) THEN
    RAISE EXCEPTION 'O lote tem % unidade(s); não dá para baixar %.',
      COALESCE(v_lote.qtd, 0), v_qtd USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_produto FROM public.produtos WHERE id = v_lote.produto_id;

  INSERT INTO public.movimentacoes_estoque
    (produto_id, tipo, qtd, origem, destino, data, filial)
  VALUES
    (v_lote.produto_id, 'Ajuste −', v_qtd, 'Almoxarifado',
     'Perda por validade' || COALESCE(' — lote ' || v_lote.lote, '')
       || COALESCE(' (' || p_motivo || ')', ''),
     public.acre_today(), v_lote.filial);

  v_restante := COALESCE(v_lote.qtd, 0) - v_qtd;

  UPDATE public.vencimentos_estoque
     SET qtd        = v_restante,
         status     = CASE WHEN v_restante <= 0 THEN 'Perda' ELSE 'OK' END,
         observacao = COALESCE(observacao || ' | ', '') ||
                      'Baixa de ' || v_qtd || ' em ' || to_char(public.acre_today(), 'DD/MM/YYYY')
                      || COALESCE(': ' || p_motivo, ''),
         updated_at = now()
   WHERE id = p_lote_id;

  RETURN jsonb_build_object(
    'lote_id',   p_lote_id,
    'produto',   COALESCE(v_produto, '—'),
    'baixado',   v_qtd,
    'restante',  v_restante,
    'encerrado', v_restante <= 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.baixar_lote_vencido(uuid, integer, text) FROM public;
REVOKE ALL ON FUNCTION public.baixar_lote_vencido(uuid, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.baixar_lote_vencido(uuid, integer, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Encerrar lote sem perda (vendeu tudo antes de vencer)
--
-- Não mexe em estoque de propósito: a saída dessas unidades já foi registrada
-- pela venda. Aqui só se declara que o lote acabou, para ele sair da fila do
-- que precisa ser olhado.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.encerrar_lote_consumido(p_lote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote vencimentos_estoque;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_lote FROM public.vencimentos_estoque
   WHERE id = p_lote_id AND COALESCE(ativo, true) FOR UPDATE;

  IF v_lote.id IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_lote.filial), false) THEN
    RAISE EXCEPTION 'Lote de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('logistica'), false)
          OR COALESCE(public.auth_gerente_da(v_lote.filial), false)) THEN
    RAISE EXCEPTION 'Apenas a Logística ou o gerente da filial encerram lote.'
      USING ERRCODE = '42501';
  END IF;
  IF v_lote.status <> 'OK' THEN
    RAISE EXCEPTION 'Este lote já foi encerrado como "%".', v_lote.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vencimentos_estoque
     SET status = 'Consumido', qtd = 0, updated_at = now()
   WHERE id = p_lote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_lote_consumido(uuid) FROM public;
REVOKE ALL ON FUNCTION public.encerrar_lote_consumido(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.encerrar_lote_consumido(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
