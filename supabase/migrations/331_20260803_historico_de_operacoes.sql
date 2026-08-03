-- 331 — Histórico de operações: a trilha que a auditoria de hoje não guarda.
--
-- A migr. 055 pôs `criado_por` / `atualizado_por` / `updated_at` em 20 tabelas,
-- e o ícone de auditoria mostra isso. São duas fotos, não um filme:
-- `atualizado_por` guarda só a ÚLTIMA alteração. Uma requisição aprovada,
-- corrigida e reaberta tem uma linha de auditoria — a última —, e quem aprovou
-- desaparece na alteração seguinte. Quando o aluno pergunta "por que isto está
-- assim?", não há onde olhar.
--
-- Aqui nasce a trilha: uma tabela append-only, uma linha por transição, com
-- quem fez, quando, de onde para onde.
--
-- TRÊS DECISÕES, e o porquê de cada uma:
--
-- 1. Registra TRANSIÇÃO, não todo UPDATE. Diff completo em jsonb vira lixo
--    ilegível — cada correção de centro de custo viraria linha. O trigger
--    recebe, por tabela, a lista de colunas que são a decisão (item,
--    quantidade, valor) e ignora o resto.
--
-- 2. Append-only de verdade: `authenticated` só tem SELECT. Sem INSERT, UPDATE
--    ou DELETE — quem escreve é o trigger, que é SECURITY DEFINER e passa por
--    cima da RLS. Histórico que o próprio usuário pode editar não serve para
--    tirar dúvida, e essa é justamente a aula.
--
-- 3. Lê quem enxerga a filial, não só a Matriz. O ícone de auditoria de hoje só
--    renderiza para admin e CEO, e é por isso que a tela fica vazia para o
--    aluno. Ver "Fulano aprovou" dentro da própria unidade não é vazamento: é o
--    que ensina responsabilidade, e é o que faz o aluno parar de precisar
--    perguntar ao professor o que aconteceu com o documento dele.

BEGIN;

CREATE TABLE IF NOT EXISTS public.historico_operacoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Par (entidade, entidade_id) em vez de FK: uma tabela serve todos os
  -- documentos, e o histórico sobrevive ao soft-delete do documento.
  entidade    text NOT NULL,
  entidade_id uuid NOT NULL,
  filial      text,
  evento      text NOT NULL,
  de          text,
  para        text,
  detalhe     text,
  ator_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ator_nome   text,
  ator_setor  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historico_documento
  ON public.historico_operacoes (entidade, entidade_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historico_filial_data
  ON public.historico_operacoes (filial, created_at DESC);

ALTER TABLE public.historico_operacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS historico_select ON public.historico_operacoes;
CREATE POLICY historico_select ON public.historico_operacoes
  FOR SELECT TO authenticated
  USING (
    public.auth_is_admin()
    OR public.auth_user_role() IN ('ceo', 'conselheiro')
    OR filial IS NULL
    OR public.auth_pode_filial(filial)
  );

COMMENT ON POLICY historico_select ON public.historico_operacoes IS
  'Quem opera a unidade lê a trilha da unidade. Deliberadamente mais aberto que o ícone de auditoria (055), que só renderiza para a Matriz — era isso que deixava o aluno sem resposta sobre o próprio documento.';

-- Sem policy de escrita: nada em `authenticated` insere, altera ou apaga. O
-- trigger é SECURITY DEFINER e escreve por fora da RLS.

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger genérico. TG_ARGV traz as colunas que valem como decisão naquela
-- tabela; `status` entra sempre, sem precisar ser declarado.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_novo    jsonb := to_jsonb(NEW);
  v_velho   jsonb;
  v_nome    text;
  v_setor   text;
  v_filial  text;
  v_col     text;
  v_de      text;
  v_para    text;
  v_mudanca text[] := '{}';
BEGIN
  SELECT nome, setor INTO v_nome, v_setor
    FROM public.user_profiles WHERE id = auth.uid();

  -- Cron e endpoints de service_role não têm auth.uid(). Gravar 'Sistema' é
  -- melhor que gravar NULL: a pergunta "quem fez isso?" tem resposta.
  IF v_nome IS NULL THEN
    v_nome := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  v_filial := v_novo->>'filial';

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.historico_operacoes
      (entidade, entidade_id, filial, evento, para, ator_id, ator_nome, ator_setor)
    VALUES
      (TG_TABLE_NAME, NEW.id, v_filial, 'Criado', v_novo->>'status',
       auth.uid(), v_nome, v_setor);
    RETURN NULL;
  END IF;

  v_velho := to_jsonb(OLD);

  -- Soft delete é evento, não sumiço. Sem isto o documento simplesmente
  -- desaparece das telas e ninguém sabe quem o tirou de circulação.
  IF COALESCE((v_velho->>'ativo')::boolean, true)
     AND NOT COALESCE((v_novo->>'ativo')::boolean, true) THEN
    INSERT INTO public.historico_operacoes
      (entidade, entidade_id, filial, evento, de, para, ator_id, ator_nome, ator_setor)
    VALUES
      (TG_TABLE_NAME, NEW.id, v_filial, 'Inativado', v_velho->>'status', v_novo->>'status',
       auth.uid(), v_nome, v_setor);
    RETURN NULL;
  END IF;

  IF (v_novo->>'status') IS DISTINCT FROM (v_velho->>'status') THEN
    INSERT INTO public.historico_operacoes
      (entidade, entidade_id, filial, evento, de, para, detalhe, ator_id, ator_nome, ator_setor)
    VALUES
      (TG_TABLE_NAME, NEW.id, v_filial, 'Status',
       v_velho->>'status', v_novo->>'status',
       COALESCE(NULLIF(v_novo->>'observacao', ''), NULLIF(v_novo->>'feedback', ''),
                NULLIF(v_novo->>'motivo_cancelamento', '')),
       auth.uid(), v_nome, v_setor);
  END IF;

  -- Campos que são a decisão. Uma linha só listando o que mudou, em vez de uma
  -- linha por campo: quem lê quer a frase, não o dump.
  IF TG_NARGS > 0 THEN
    FOREACH v_col IN ARRAY TG_ARGV LOOP
      v_de   := v_velho->>v_col;
      v_para := v_novo->>v_col;
      IF v_de IS DISTINCT FROM v_para THEN
        v_mudanca := v_mudanca || format('%s: %s → %s', v_col,
                                         COALESCE(v_de, '—'), COALESCE(v_para, '—'));
      END IF;
    END LOOP;

    IF array_length(v_mudanca, 1) > 0 THEN
      INSERT INTO public.historico_operacoes
        (entidade, entidade_id, filial, evento, detalhe, ator_id, ator_nome, ator_setor)
      VALUES
        (TG_TABLE_NAME, NEW.id, v_filial, 'Alterado',
         array_to_string(v_mudanca, ' · '), auth.uid(), v_nome, v_setor);
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_historico() FROM PUBLIC, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- Fase 1: o fluxo de compras, de ponta a ponta. É onde a dúvida aparece —
-- documento que passa por quatro setores antes de virar mercadoria e dinheiro.
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_historico ON public.requisicoes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('item', 'qtd', 'urgencia', 'centro_custo');

DROP TRIGGER IF EXISTS trg_historico ON public.aprovacoes_compras;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.aprovacoes_compras
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('aprovador');

DROP TRIGGER IF EXISTS trg_historico ON public.cotacoes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.cotacoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_total', 'fornecedor_id', 'prazo_entrega');

DROP TRIGGER IF EXISTS trg_historico ON public.pedidos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor_total', 'prazo_entrega');

DROP TRIGGER IF EXISTS trg_historico ON public.recebimentos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('qtd_recebida');

DROP TRIGGER IF EXISTS trg_historico ON public.requisicoes_estoque;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.requisicoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('qtd', 'destino');

DROP TRIGGER IF EXISTS trg_historico ON public.aprovacoes_estoque;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.aprovacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('aprovador');

-- A conta a pagar é o fim da linha do pedido, e é onde o dinheiro sai.
DROP TRIGGER IF EXISTS trg_historico ON public.contas_pagar;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('valor', 'vencimento');

-- A tela lê o histórico direto pela tabela, com a RLS acima.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'historico_operacoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.historico_operacoes;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--
--   -- 1) Oito triggers:
--   SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname = 'trg_historico' ORDER BY 1;
--
--   -- 2) Aprovar uma requisição e conferir a trilha:
--   SELECT created_at, evento, de, para, ator_nome
--     FROM historico_operacoes
--    WHERE entidade = 'requisicoes'
--    ORDER BY created_at DESC LIMIT 10;
--
--   -- 3) Append-only: isto tem de falhar para um usuário comum.
--   --    DELETE FROM historico_operacoes WHERE true;
