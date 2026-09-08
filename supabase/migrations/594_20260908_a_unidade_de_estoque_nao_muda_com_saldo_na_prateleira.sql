-- ════════════════════════════════════════════════════════════════════════════
-- 594 — A unidade de estoque não muda com saldo na prateleira
--
-- 647 UNIDADES VIRAVAM 647 PACOTES COM UM UPDATE, E NENHUM LANÇAMENTO EXPLICAVA
-- A DIFERENÇA.
--
-- Testado na Água Sanitária Qboa da SuperMax (647 em estoque), em transação
-- revertida: `UPDATE produtos SET unidade='PCT'` passou, e o saldo continuou
-- 647 — agora significando pacotes. O formulário de Cadastros oferece o mesmo
-- seletor de Unidade num produto novo e num com três meses de movimentação.
--
-- A unidade de medida não é um rótulo: é o que dá sentido ao número. Trocá-la
-- reescreve, de uma vez e em silêncio, o saldo, o estoque mínimo, o preço
-- ("R$ 8,00 a unidade" vira "R$ 8,00 o pacote"), o custo médio, o valor do
-- inventário e o histórico inteiro de movimentações — que continuam gravadas
-- na medida antiga. Nenhum ERP permite isso depois do primeiro movimento; ou a
-- unidade é imutável, ou a troca vem acompanhada de uma conversão que lança o
-- ajuste correspondente.
--
-- ── Onde a trava fica ───────────────────────────────────────────────────────
--
-- Recusa quando há SALDO. Não recusa com saldo zero, e isso é deliberado:
--
--   * com saldo, o número na coluna muda de significado sem lançamento — é o
--     defeito, e é o que a trava fecha;
--   * sem saldo, trocar a unidade é correção de cadastro. Prender aí impediria
--     justamente o conserto que a turma precisa fazer. Estes seis produtos
--     estão na SuperMax do ERP agora, todos zerados:
--
--       Açúcar Cristal 1 (kg) 30 UN     unidade PCT
--       Açúcar Refinado 1 (kg) 30 UN    unidade PCT
--       Azeite de Oliva (500 ml) 12 UN  unidade PCT
--       Óleo de Soja (900 ml) 20 UN     unidade PCT
--       Ervilha(170 g) 24 UN            unidade PCT
--
--     Todos usaram a unidade de ESTOQUE para dizer "fardo de 30", porque até a
--     migr. 589 não havia onde dizer isso. Com a trava em cima do saldo, eles
--     continuam corrigíveis pela tela — que é o desfecho certo.
--
-- ── Por que erro, e não reversão silenciosa ─────────────────────────────────
--
-- `fn_block_estoque_manual` desfaz a edição de saldo sem avisar, e faz sentido
-- lá: ninguém edita `estoque` de propósito pela tela, é sempre efeito colateral
-- de um formulário que manda a linha inteira. Aqui é o contrário — a pessoa
-- ABRIU o seletor e escolheu outra unidade. Devolver ao valor antigo em
-- silêncio faria ela achar que salvou, e descobrir semanas depois. O erro
-- explica o que fazer.
--
-- O caminho para trocar mesmo assim já existe e é o de um ERP de verdade:
-- zerar o saldo por ajuste em Estoque > Movimentações (que deixa rastro e
-- motivo), trocar a unidade, e reentrar o saldo na medida nova.
--
-- Ninguém é exceção — nem admin. Não é regra de permissão: o saldo mudaria de
-- significado do mesmo jeito na mão do professor.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_unidade_imutavel_com_saldo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_antes  text := upper(btrim(COALESCE(OLD.unidade, 'UN')));
  v_depois text := upper(btrim(COALESCE(NEW.unidade, 'UN')));
  -- Saldo como se lê em português: sem zeros à direita, sem ponto órfão, com
  -- vírgula decimal. `numeric(15,3)` cru sairia "647.000" na mensagem.
  v_saldo  text := replace(
    rtrim(rtrim(to_char(COALESCE(OLD.estoque, 0), 'FM999999990.999'), '0'), '.'),
    '.', ',');
BEGIN
  -- Só interessa a troca de verdade: 'un' → 'UN' é normalização, não mudança.
  IF v_antes = v_depois THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.estoque, 0) <> 0 THEN
    RAISE EXCEPTION
      'O produto "%" tem % % em estoque, e a unidade de medida é o que dá sentido a esse número — trocá-la agora faria % % virarem % % sem nenhuma entrada ou saída que explicasse a diferença. Para mudar: zere o saldo por um ajuste em Estoque > Movimentações, troque a unidade aqui, e reentre o saldo na medida nova.',
      OLD.nome, v_saldo, v_antes, v_saldo, v_antes, v_saldo, v_depois
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_unidade_imutavel_com_saldo() IS
  'Recusa a troca de produtos.unidade enquanto houver saldo (migr. 594): a unidade dá sentido ao número, e trocá-la reinterpreta saldo, mínimo, preço, custo e todo o histórico de uma vez. Com saldo zero passa — aí é correção de cadastro.';

DROP TRIGGER IF EXISTS trg_unidade_imutavel_com_saldo ON public.produtos;
CREATE TRIGGER trg_unidade_imutavel_com_saldo
  BEFORE UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_unidade_imutavel_com_saldo();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- gatilho no lugar
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.produtos'::regclass
--     AND tgname='trg_unidade_imutavel_com_saldo';
--
--   -- exercício (transação revertida): com saldo recusa, sem saldo passa
--   -- BEGIN;
--   --   UPDATE produtos SET unidade='PCT' WHERE nome LIKE 'Água Sanitária Qboa%';  -- erro
--   -- ROLLBACK;
--
--   -- quem ainda usa a unidade de estoque para dizer "fardo de N"
--   SELECT filial, nome, unidade, estoque FROM produtos
--    WHERE ativo AND unidade IN ('PCT','CX','PC') AND nome ~* '[0-9]+\s*(unidades?|un\y)'
--    ORDER BY estoque DESC;
-- =================================================================
