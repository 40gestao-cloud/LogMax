-- 501_20260821_nf_nao_duplica_e_saldo_de_abertura_so_na_implantacao.sql
--
-- Duas travas de banco para o que a tela passou a resolver hoje em
-- Estoque > Recebimentos e Cadastros > Produtos.
--
-- ── 1. Número de NF gerado não pode colidir ─────────────────────────────────
-- A tela ganhou um botão "Gerar" para o número da nota (lê o maior já usado na
-- filial e sugere o próximo — `src/lib/notaFiscal.ts`). Sequencial evita
-- colisão no caso comum, mas duas abas do mesmo usuário, ou duas pessoas
-- registrando ao mesmo tempo, podem gerar o mesmo número antes que a primeira
-- tenha sido salva. O índice único é a trava de verdade; o gerador só evita
-- que ela dispare no caminho normal.
--
-- Conferido nos 4 projetos antes de criar o índice — sem duplicata:
--   SELECT filial, nf_numero, COALESCE(nf_serie,''), count(*)
--     FROM recebimentos WHERE ativo AND COALESCE(btrim(nf_numero),'') <> ''
--    GROUP BY 1,2,3 HAVING count(*) > 1;    -- 0 linhas nos 4
--
-- ── 2. Saldo de abertura só existe na implantação ───────────────────────────
-- "Saldo de Abertura" em Cadastros > Produtos gera uma Entrada de implantação
-- direto no cadastro — sem pedido, sem conta a pagar, sem conferência. Existe
-- porque a unidade PRECISA nascer com o que já está na prateleira antes de o
-- sistema existir para ela. O problema é que nada, até aqui, dizia "essa janela
-- fechou": um aluno que já tinha completado o ciclo inteiro (requisição →
-- cotação → pedido → recebimento) ainda achava o campo aberto em outro
-- cadastro, digitava a mesma mercadoria de novo, e o saldo dobrava — a mesma
-- caixa contada na Entrada de implantação E no Confirmar do recebimento.
--
-- A tela já fecha a saída visualmente (ProdutosView: `emImplantacao`, campo só
-- aparece enquanto a filial nunca teve um recebimento Concluído ou Parcial).
-- A trigger é a mesma régua, porque a tela não impede o F12.
--
-- Nome do trigger importa: `trg_mov_estoque_casa_com_pedido` e
-- `trg_mov_servico_nao_tem_saldo` já existem em `movimentacoes_estoque`, os
-- dois BEFORE INSERT, e o Postgres dispara BEFORE em ordem alfabética.
-- `trg_mov_saldo_abertura_so_na_implantacao` cai entre os dois — nenhum dos
-- três lê coluna que outro escreve, então a posição é inofensiva.


BEGIN;

-- ── 1. Índice único parcial ──────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimento_nf_por_filial
  ON public.recebimentos (filial, nf_numero, COALESCE(nf_serie, ''))
  WHERE ativo AND nf_numero IS NOT NULL AND btrim(nf_numero) <> '';

-- ── 2. Trigger da janela de implantação ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_mov_saldo_abertura_so_na_implantacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só mexe com o que a tela chama de implantação. Compra, venda, ajuste de
  -- inventário e devolução seguem livres — a régua é só sobre esta origem.
  IF NEW.origem IS DISTINCT FROM 'Saldo Inicial de Implantação' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recebimentos r
     WHERE r.filial = NEW.filial
       AND COALESCE(r.ativo, true)
       AND r.status IN ('Concluído', 'Parcial')
  ) THEN
    RAISE EXCEPTION
      'Esta unidade já recebeu mercadoria — saldo de abertura só existe na implantação. A quantidade entra por Estoque > Recebimentos.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mov_saldo_abertura_so_na_implantacao ON public.movimentacoes_estoque;
CREATE TRIGGER trg_mov_saldo_abertura_so_na_implantacao
  BEFORE INSERT ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.fn_mov_saldo_abertura_so_na_implantacao();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT indexname FROM pg_indexes WHERE indexname = 'uq_recebimento_nf_por_filial';
--   -- 1 linha
--
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_mov_saldo_abertura_so_na_implantacao';
--   -- 1
--
-- TESTE MANUAL: numa filial que já tem recebimento Concluído, tentar cadastrar
-- produto novo escolhendo "Saldo de implantação" (só chega a essa tela se o
-- F12 for direto na RPC, já que ProdutosView não oferece mais a opção fora da
-- janela) — a movimentação de Entrada deve ser recusada com a mensagem acima.
-- ════════════════════════════════════════════════════════════════════════════
