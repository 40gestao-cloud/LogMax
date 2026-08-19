-- 470 — Em Modo Aula, ninguém fecha o caixa com venda em curso.
--
-- O caixa é UM por filial por dia (migr. do caixa por filial). Fora da aula
-- isso é fiel à realidade: a loja tem um caixa, e quem opera fecha no fim do
-- expediente. Em Modo Aula a mesma regra vira um problema de sala: 45 alunos
-- dividem o caixa da unidade, e o primeiro que clicar em "Fechar" derruba a
-- operação de todos os outros — inclusive de quem está com o QR do Pix na tela
-- esperando o cliente pagar.
--
-- O aluno que fechou não fez nada de errado: ele seguiu o processo que a aula
-- ensina. Quem precisa saber que há venda em curso é o sistema.
--
-- ─── O QUE CONTA COMO "VENDA EM CURSO" ──────────────────────────────────────
--
-- Cobrança aberta: linha em `pix_pendentes` ou `cartao_pendentes` com status
-- 'aguardando', da mesma filial do caixa. É o estado em que o PDV está com o QR
-- na tela e o realtime escutando a confirmação — fechar o caixa embaixo disso
-- deixa a venda órfã.
--
-- Com JANELA DE 15 MINUTOS, e é uma decisão, não um detalhe: cobrança
-- abandonada (aluno que fechou a aba sem cancelar) ficaria 'aguardando' para
-- sempre e travaria o caixa da turma inteira até alguém ir ao banco limpar. A
-- janela faz a trava proteger a venda viva sem virar refém do lixo.
--
-- ─── POR QUE TRIGGER, E NÃO UM IF DENTRO DA RPC ─────────────────────────────
--
-- Hoje dois caminhos escrevem 'Fechado': `fechar_caixa_conferido` (operador) e
-- `confirmar_fechamento_caixa` (Financeiro conferindo). Amanhã pode nascer um
-- terceiro, ou alguém pode dar UPDATE direto. Regra que mora na RPC protege a
-- RPC; regra que mora na trigger protege a tabela — e a tabela é o que importa.
--
-- ─── SÓ EM MODO AULA ────────────────────────────────────────────────────────
--
-- Fora da aula a trava não existe. A loja de verdade fecha o caixa quando o
-- gerente manda, e inventar um impedimento que o comércio não tem seria ensinar
-- errado. `aula_config.ativo` é o interruptor.

BEGIN;

CREATE OR REPLACE FUNCTION public.bloqueia_fechamento_com_venda_em_curso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_qtd    int;
  v_numeros text;
  v_corte  timestamptz := now() - interval '15 minutes';
BEGIN
  -- Duas transições interessam, e a segunda não é óbvia:
  --
  --   'Fechado'                — o operador fecha direto;
  --   'Aguardando Confirmação' — o operador SOLICITA e o Financeiro confirma
  --                              depois (migr. 448).
  --
  -- Barrar só 'Fechado' deixaria o aluno solicitar normalmente e o erro cairia
  -- no colo do Financeiro na hora de confirmar — por causa de uma venda que não
  -- é dele e que ele não pode concluir nem cancelar. Barrando na solicitação, o
  -- aviso chega a quem consegue agir.
  --
  -- Reabrir, suspender, corrigir observação: nada disso passa por aqui.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('Fechado', 'Aguardando Confirmação') THEN
    RETURN NEW;
  END IF;

  -- Fora do Modo Aula a regra não se aplica.
  IF NOT EXISTS (SELECT 1 FROM public.aula_config WHERE ativo = true) THEN
    RETURN NEW;
  END IF;

  -- Caixa sem filial (consolidado) olha todas as cobranças; com filial, só as
  -- dela — senão a MaxLook travaria por causa de uma venda da SuperMax.
  WITH em_curso AS (
    SELECT id, created_at FROM public.pix_pendentes
     WHERE status = 'aguardando' AND created_at >= v_corte
       AND (NEW.filial IS NULL OR filial = NEW.filial)
    UNION ALL
    SELECT id, created_at FROM public.cartao_pendentes
     WHERE status = 'aguardando' AND created_at >= v_corte
       AND (NEW.filial IS NULL OR filial = NEW.filial)
  )
  SELECT count(*), string_agg(UPPER(right(id::text, 6)), ', ' ORDER BY created_at)
    INTO v_qtd, v_numeros
    FROM em_curso;

  IF COALESCE(v_qtd, 0) > 0 THEN
    RAISE EXCEPTION
      'Não dá para fechar o caixa agora: % cobrança(s) aguardando pagamento nesta unidade (nº %). '
      'Em Modo Aula o caixa é compartilhado pela turma — fechar deixaria essa venda órfã. '
      'Conclua ou cancele a cobrança no PDV e feche em seguida.',
      v_qtd, v_numeros
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.bloqueia_fechamento_com_venda_em_curso() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_bloqueia_fechamento_venda_em_curso ON public.controle_caixa;
CREATE TRIGGER trg_bloqueia_fechamento_venda_em_curso
  BEFORE UPDATE ON public.controle_caixa
  FOR EACH ROW EXECUTE FUNCTION public.bloqueia_fechamento_com_venda_em_curso();

COMMENT ON FUNCTION public.bloqueia_fechamento_com_venda_em_curso() IS
  'Migr. 470 — em Modo Aula, barra o fechamento do caixa enquanto houver cobrança aguardando (15 min) na filial. Fora da aula não faz nada.';

COMMIT;

-- Verificação:
--
--   -- 1. Trigger no lugar:
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.controle_caixa'::regclass
--    AND NOT tgisinternal;
--
--   -- 2. Fora da aula não bloqueia (aula_config.ativo = false):
--   --    fechar um caixa normalmente deve continuar funcionando.
--
--   -- 3. Em aula, com cobrança aberta, o fechamento deve levantar P0001:
--   --    UPDATE aula_config SET ativo = true;
--   --    INSERT INTO pix_pendentes (valor, status, filial) VALUES (1, 'aguardando', 'SuperMax');
--   --    SELECT fechar_caixa_conferido('<id do caixa>', 100);   -- deve falhar
--   --    (desfaça os dois depois do teste)
