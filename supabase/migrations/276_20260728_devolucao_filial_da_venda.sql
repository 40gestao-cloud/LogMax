-- Devolução: a filial que manda é a da venda, não a que o cliente enviou.
--
-- ACHADO (Etapa 3 do plano): `criar_devolucao_venda` faz o gate certo sobre o
-- parâmetro errado.
--
--     IF NOT (auth_is_admin() OR auth_gerente_da(p_filial)) THEN ...
--     SELECT * INTO v_venda FROM vendas WHERE id = p_venda_id AND ativo;
--
-- `p_filial` vem do cliente e nunca é comparado com `v_venda.filial`. Um
-- gerente da MaxLook que chame a RPC com `p_filial = 'MaxLook'` e o id de uma
-- venda da SuperMax passa pelo gate: devolve mercadoria de outra unidade,
-- estorna a conta a receber de outra unidade — e o cabeçalho da devolução
-- ainda é gravado com `filial = p_filial`, jogando o registro nos relatórios
-- da filial errada. É o P7 na forma mais limpa: o guard valida uma afirmação
-- do próprio chamador.
--
-- A correção mora na tabela, não na RPC: um trigger que confronta a filial
-- declarada com a da venda vale para todo caminho de escrita — a RPC de hoje,
-- qualquer INSERT direto que a RLS permita, e a próxima RPC que alguém
-- escrever. Zero devoluções feitas até agora, então nada a regularizar.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.devolucao_valida_filial_da_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filial_venda text;
BEGIN
  SELECT filial INTO v_filial_venda
    FROM public.vendas
   WHERE id = NEW.venda_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda % não encontrada.', NEW.venda_id USING ERRCODE = 'P0002';
  END IF;

  -- A filial da devolução é a da venda. Ponto. Divergência é erro de quem
  -- chamou, não algo a corrigir em silêncio.
  IF NEW.filial IS DISTINCT FROM v_filial_venda THEN
    RAISE EXCEPTION
      'Devolução declarada como % mas a venda é da unidade %.', NEW.filial, v_filial_venda
      USING ERRCODE = '42501';
  END IF;

  -- Revalida a autorização contra a filial REAL. auth.uid() nulo = service
  -- role ou manutenção via SQL editor.
  IF auth.uid() IS NOT NULL
     AND NOT (public.auth_is_admin() OR public.auth_gerente_da(v_filial_venda)) THEN
    RAISE EXCEPTION 'Sem permissão para autorizar devolução na unidade %.', v_filial_venda
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_devolucao_valida_filial ON public.devolucoes;
CREATE TRIGGER trg_devolucao_valida_filial
  BEFORE INSERT OR UPDATE OF venda_id, filial ON public.devolucoes
  FOR EACH ROW EXECUTE FUNCTION public.devolucao_valida_filial_da_venda();

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ════════════════════════════════════════════════════════════════════════════
--   -- Nenhuma devolução deve divergir da venda que a originou:
--   SELECT d.id, d.filial AS filial_devolucao, v.filial AS filial_venda
--     FROM devolucoes d JOIN vendas v ON v.id = d.venda_id
--    WHERE d.filial IS DISTINCT FROM v.filial;
--
--   -- Teste do gate (em turma de teste, logado como gerente de uma unidade):
--   --   SELECT criar_devolucao_venda('<venda de OUTRA unidade>', '[...]'::jsonb,
--   --                                'teste', 'cancela_pendencias', '<sua unidade>');
--   --   -- esperado: 42501, com o nome da unidade real da venda na mensagem.
-- ════════════════════════════════════════════════════════════════════════════
