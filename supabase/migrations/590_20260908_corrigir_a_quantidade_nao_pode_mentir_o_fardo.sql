-- ════════════════════════════════════════════════════════════════════════════
-- 590 — Corrigir a quantidade não pode deixar o fardo mentindo
--
-- A migr. 589 pôs o pedido em embalagem fechada: 20 fardos de 30 gravam
-- `qtd = 600`, com `qtd_embalagens = 20` e `embalagem_fator = 30` ao lado.
--
-- Só que a requisição é corrigida DEPOIS de aberta, por duas portas:
--
--   `corrigir_requisicao_compra`     — Compras ou o gerente ajusta a quantidade
--   `reenviar_requisicao_corrigida`  — o solicitante conserta o que foi devolvido
--
-- As duas fazem `SET qtd = p_qtd` e não sabem que existe um fardo do lado.
-- Compras muda 600 para 750 e a linha passa a dizer, ao mesmo tempo, "750 UN"
-- e "20 FARDOS de 30" — que dá 600. A tela mostra as duas, a trilha registra as
-- duas, e as duas discordam.
--
-- ── Por que gatilho e CHECK, e não remendo nas duas RPCs ────────────────────
--
-- Consertar as duas funções resolveria hoje e voltaria a quebrar na terceira
-- porta — e já são duas em duas migrações diferentes (517 e 545). A coerência
-- entre `qtd` e o par embalagem é regra da TABELA, não de quem escreve nela:
--
--   * o CHECK diz o que é verdade      → qtd = qtd_embalagens × fator, sempre;
--   * o gatilho mantém a verdade       → recalcula quando a conta ainda fecha,
--                                        e apaga o fardo quando não fecha mais.
--
-- Sem o gatilho, o CHECK sozinho faria a correção de Compras ESTOURAR — e a
-- mensagem falaria de uma restrição, não do fardo. Sem o CHECK, o gatilho
-- sozinho deixaria a porta aberta para quem escreve fora dele.
--
-- ── A regra de "não fecha mais" ─────────────────────────────────────────────
--
-- Quantidade que deixou de ser múltiplo do fardo não é erro: é decisão. Compras
-- pode muito bem quebrar a embalagem ao negociar ("manda 610, o fornecedor
-- aceita"). O que não pode é continuar dizendo que são 20 fardos. Então o
-- documento perde o rótulo de embalagem e passa a falar só em unidade — que é a
-- verdade do que foi pedido. Trocar o produto limpa igual: fardo do arroz não
-- descreve o feijão.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O gatilho, ANTES do CHECK ────────────────────────────────────────────
--
-- BEFORE UPDATE: os gatilhos BEFORE rodam todos antes de o Postgres conferir as
-- restrições, então o CHECK abaixo vê o valor já ajustado. Os outros BEFORE da
-- tabela (auditoria, guard de decisão, marca de reenvio, sem_exclusao) não
-- tocam em `qtd` nem nas colunas de embalagem — ordem alfabética aqui não
-- muda nada, mas o nome ficou cedo no alfabeto de propósito.

CREATE OR REPLACE FUNCTION public.requisicao_embalagem_coerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Linha sem fardo continua como está: a esmagadora maioria.
  IF NEW.embalagem_fator IS NULL THEN
    RETURN NEW;
  END IF;

  -- Nada que interesse mudou? Não recalcula — deixar a conta quieta é o que
  -- garante que uma migração de dados ou um UPDATE de status não reescreva
  -- documento antigo.
  IF NEW.qtd IS NOT DISTINCT FROM OLD.qtd
     AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id
     AND NEW.embalagem_fator IS NOT DISTINCT FROM OLD.embalagem_fator THEN
    RETURN NEW;
  END IF;

  IF NEW.produto_id IS DISTINCT FROM OLD.produto_id
     OR NEW.qtd IS NULL
     OR NEW.embalagem_fator <= 0
     OR mod(NEW.qtd, NEW.embalagem_fator) <> 0 THEN
    -- Deixou de ser um número redondo de embalagens (ou virou outro produto):
    -- o documento passa a falar só na unidade de estoque.
    NEW.qtd_embalagens  := NULL;
    NEW.embalagem_nome  := NULL;
    NEW.embalagem_fator := NULL;
  ELSE
    NEW.qtd_embalagens := NEW.qtd / NEW.embalagem_fator;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.requisicao_embalagem_coerente() IS
  'Mantém qtd_embalagens coerente com qtd quando a requisição é corrigida (migr. 590). Recalcula enquanto a quantidade for múltiplo do fardo; apaga o rótulo de embalagem quando deixa de ser, porque 610 UN não são 20 fardos de 30.';

DROP TRIGGER IF EXISTS trg_embalagem_coerente ON public.requisicoes;
CREATE TRIGGER trg_embalagem_coerente
  BEFORE UPDATE ON public.requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.requisicao_embalagem_coerente();

-- ── 2. O CHECK: a conta tem de fechar ───────────────────────────────────────

ALTER TABLE public.requisicoes DROP CONSTRAINT IF EXISTS chk_requisicoes_embalagem_conta;

ALTER TABLE public.requisicoes
  ADD CONSTRAINT chk_requisicoes_embalagem_conta
  CHECK (qtd_embalagens IS NULL OR qtd = qtd_embalagens * embalagem_fator);

COMMENT ON CONSTRAINT chk_requisicoes_embalagem_conta ON public.requisicoes IS
  'A quantidade em estoque É o número de embalagens vezes o fator (migr. 590). Sem isto, corrigir a quantidade deixava a linha dizendo "750 UN" e "20 fardos de 30" ao mesmo tempo.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- gatilho e restrição no lugar
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.requisicoes'::regclass
--     AND tgname = 'trg_embalagem_coerente';
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conrelid='public.requisicoes'::regclass
--      AND conname = 'chk_requisicoes_embalagem_conta';
--
--   -- nenhuma linha incoerente (esperado: 0, hoje e sempre)
--   SELECT count(*) FROM requisicoes
--    WHERE qtd_embalagens IS NOT NULL AND qtd <> qtd_embalagens * embalagem_fator;
-- =================================================================
