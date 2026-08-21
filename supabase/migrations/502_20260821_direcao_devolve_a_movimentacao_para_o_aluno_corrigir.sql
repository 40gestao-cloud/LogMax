-- 502_20260821_direcao_devolve_a_movimentacao_para_o_aluno_corrigir.sql
--
-- Hoje o professor tem duas saídas quando o aluno erra uma movimentação de
-- estoque: inativar a linha (o saldo estorna, e acabou) ou corrigir o saldo ele
-- mesmo (migr. anterior, via Ajuste). As duas RESOLVEM e nenhuma ENSINA — o
-- aluno nem fica sabendo que errou, e quem conserta é sempre a direção.
--
-- É o mesmo buraco que a migr. 467 fechou em Cotações: quem decide não tinha
-- como DEVOLVER. Lá o gerente só podia aprovar o número errado ou reprovar a
-- proposta inteira; o caminho que faltava era mandar de volta para quem
-- cadastrou consertar. Aqui é igual, e a razão de fundo é a mesma: quem errou
-- é quem tem de corrigir, senão o erro não vira aprendizado.
--
-- ── O que entra ─────────────────────────────────────────────────────────────
-- 1. Marcação de correção pendente em `produtos` — com o MOTIVO escrito pela
--    direção, quem pediu, quando, e quem é o responsável por consertar (o autor
--    da movimentação devolvida).
-- 2. `devolver_movimentacao_para_correcao` — a direção inativa a movimentação
--    (o saldo estorna pelo gatilho que já existe desde a 268) E marca o produto
--    numa transação só, notificando o setor.
-- 3. `concluir_correcao_produto` — o responsável, o gerente da filial ou a
--    direção dão a correção por encerrada.
--
-- ── A trava que não pode faltar ─────────────────────────────────────────────
-- `update_produtos` é `auth_pode_filial(filial)`: QUALQUER pessoa da unidade
-- escreve em `produtos` por PostgREST. Sem uma trava, o aluno marcado para
-- corrigir simplesmente mandaria `correcao_pendente = false` pelo F12 e a
-- pendência sumiria sem ninguém corrigir nada.
--
-- A régua já existe nesta mesma tabela: `fn_block_estoque_manual` protege
-- `estoque` com uma flag de transação que só as RPCs legítimas levantam
-- (`set_config(..., true)` — `is_local`, morre no fim da transação). Repito o
-- padrão para as colunas de correção. Reverter em silêncio, e não RAISE, é de
-- propósito: é o que a coluna `estoque` já faz, e evita quebrar qualquer
-- UPDATE de tela que mande o objeto inteiro de volta sem intenção de mexer
-- nisto.


BEGIN;

-- ── 1. A marcação ───────────────────────────────────────────────────────────

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS correcao_pendente       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correcao_motivo         text,
  ADD COLUMN IF NOT EXISTS correcao_solicitada_por uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS correcao_solicitada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS correcao_responsavel_id uuid REFERENCES public.user_profiles(id);

CREATE INDEX IF NOT EXISTS idx_produtos_correcao_pendente
  ON public.produtos (filial) WHERE correcao_pendente;

COMMENT ON COLUMN public.produtos.correcao_pendente IS
  'A direção devolveu uma movimentação deste produto para correção. Quem conserta é `correcao_responsavel_id` (o autor da movimentação) ou o gerente da filial. Migr. 502.';
COMMENT ON COLUMN public.produtos.correcao_responsavel_id IS
  'Quem fez a movimentação devolvida — é dele a caneta. Nulo quando a movimentação não tinha autor registrado. Migr. 502.';

-- ── 2. A trava: só RPC mexe nas colunas de correção ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_block_correcao_manual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.allow_correcao_update', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  -- Silencioso, como `fn_block_estoque_manual`: a tela devolve o objeto inteiro
  -- no UPDATE de cadastro, e um RAISE aqui quebraria toda edição legítima de
  -- produto marcado.
  NEW.correcao_pendente       := OLD.correcao_pendente;
  NEW.correcao_motivo         := OLD.correcao_motivo;
  NEW.correcao_solicitada_por := OLD.correcao_solicitada_por;
  NEW.correcao_solicitada_em  := OLD.correcao_solicitada_em;
  NEW.correcao_responsavel_id := OLD.correcao_responsavel_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_correcao_manual ON public.produtos;
CREATE TRIGGER trg_block_correcao_manual
  BEFORE UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_correcao_manual();

-- ── 3. Devolver a movimentação para correção ────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_movimentacao_para_correcao(
  p_movimentacao_id uuid,
  p_motivo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mov   public.movimentacoes_estoque;
  v_prod  public.produtos;
  v_nome  text;
BEGIN
  -- `role = 'admin'` LITERAL, jamais `auth_is_admin()`: esse helper inclui CEO
  -- e conselheiro, que são ALUNOS — devolver para correção é ato de quem
  -- avalia, não de quem é avaliado. COALESCE porque `auth_user_role()` devolve
  -- NULL para sessão sem perfil, e `IF NOT NULL` não barra ninguém (migr. 495).
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas a direção devolve uma movimentação para correção.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Escreva o que está errado — é o motivo que o aluno vai ler para corrigir.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_mov FROM public.movimentacoes_estoque
   WHERE id = p_movimentacao_id FOR UPDATE;
  IF v_mov.id IS NULL THEN
    RAISE EXCEPTION 'Movimentação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_mov.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta movimentação já está inativa.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = v_mov.produto_id;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'A movimentação não aponta para um produto do catálogo.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Inativar ESTORNA o saldo — quem faz isso é `fn_atualiza_estoque_produto`,
  -- que reage a UPDATE desde a migr. 268. Se o estorno deixar o produto
  -- negativo (parte do saldo já foi vendida), a exceção do gatilho sobe daqui e
  -- a transação inteira volta atrás — inclusive a marcação. É o certo: devolver
  -- para correção não pode deixar estoque negativo pelo caminho.
  UPDATE public.movimentacoes_estoque
     SET ativo = false
   WHERE id = v_mov.id;

  PERFORM set_config('app.allow_correcao_update', 'true', true);
  UPDATE public.produtos
     SET correcao_pendente       = true,
         correcao_motivo         = btrim(p_motivo),
         correcao_solicitada_por = auth.uid(),
         correcao_solicitada_em  = now(),
         -- Quem fez é quem corrige. Sem autor registrado (movimentação antiga),
         -- fica nulo e sobra para o gerente da filial.
         correcao_responsavel_id = v_mov.criado_por
   WHERE id = v_prod.id;

  SELECT nome INTO v_nome FROM public.produtos WHERE id = v_prod.id;

  -- Best-effort: a notificação não pode derrubar a devolução.
  BEGIN
    PERFORM public.notificar_setor(
      'logistica',
      'reprovado',
      'Movimentação devolvida para correção',
      COALESCE(v_nome, 'Produto') || ' — ' || v_mov.tipo || ' de ' ||
        to_char(v_mov.qtd, 'FM999999990.999') || ' foi desfeita pela direção.',
      'estoque-movimentações',
      'Alta',
      v_prod.id,
      btrim(p_motivo),
      v_prod.filial
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'produto_id',     v_prod.id,
    'produto_nome',   v_nome,
    'movimentacao_id', v_mov.id,
    'responsavel_id', v_mov.criado_por
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.devolver_movimentacao_para_correcao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolver_movimentacao_para_correcao(uuid, text) TO authenticated, service_role;

-- ── 4. Encerrar a correção ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.concluir_correcao_produto(
  p_produto_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prod public.produtos;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id FOR UPDATE;
  IF v_prod.id IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Produto de outra filial.' USING ERRCODE = '42501';
  END IF;
  IF v_prod.correcao_pendente IS NOT TRUE THEN
    RAISE EXCEPTION 'Este produto não tem correção pendente.' USING ERRCODE = 'P0001';
  END IF;

  -- Quem tem a caneta: o responsável (quem fez a movimentação devolvida), o
  -- gerente da filial, ou a direção. O colega de setor NÃO — o ponto do
  -- exercício é quem errou corrigir. Movimentação sem autor registrado
  -- (turma antiga) não tem responsável e sobra para o gerente, que já está
  -- na lista.
  --
  -- COALESCE em TODAS as pernas, inclusive na comparação com `auth.uid()`:
  -- com `correcao_responsavel_id` nulo a igualdade devolve NULL, e
  -- `NULL OR false OR false` é NULL — `IF NOT NULL` não entra no bloco e o
  -- guard passaria batido justamente para quem não tem autoridade nenhuma.
  IF NOT COALESCE(
       v_prod.correcao_responsavel_id = auth.uid()
    OR COALESCE(public.auth_gerente_da(v_prod.filial), false)
    OR COALESCE(public.auth_user_role() = 'admin', false)
    , false) THEN
    RAISE EXCEPTION 'Só quem fez a movimentação, o gerente da unidade ou a direção encerram esta correção.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.allow_correcao_update', 'true', true);
  UPDATE public.produtos
     SET correcao_pendente       = false,
         correcao_motivo         = NULL,
         correcao_solicitada_por = NULL,
         correcao_solicitada_em  = NULL,
         correcao_responsavel_id = NULL
   WHERE id = p_produto_id;

  RETURN jsonb_build_object('produto_id', p_produto_id, 'correcao_pendente', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.concluir_correcao_produto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.concluir_correcao_produto(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='produtos' AND column_name LIKE 'correcao_%';   -- 5
--
--   SELECT count(*) FROM pg_trigger WHERE tgname='trg_block_correcao_manual'; -- 1
--
--   SELECT oid::regprocedure FROM pg_proc
--    WHERE proname IN ('devolver_movimentacao_para_correcao','concluir_correcao_produto');
--
-- TESTE MANUAL:
--   Como professor: Estoque > Movimentações > "Devolver para correção" numa
--     linha do aluno, com motivo. O saldo estorna, o produto fica marcado.
--   Como o aluno autor: Cadastros > Produtos mostra o selo e o motivo; ele
--     corrige a ficha e clica em "Correção concluída".
--   Como colega do mesmo setor (não autor, não gerente): o botão de encerrar
--     deve recusar com 42501.
--   Pelo F12, mandar `correcao_pendente=false` direto na tabela: a coluna não
--     muda (o gatilho reverte em silêncio).
-- ════════════════════════════════════════════════════════════════════════════
