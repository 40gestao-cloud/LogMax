-- 453_20260817_o_produto_apagado_ainda_se_dizia_ativo.sql
--
-- DUAS COLUNAS RESPONDENDO À MESMA PERGUNTA, COM RESPOSTAS DIFERENTES.
--
-- Os 10 produtos apagados das 4 turmas estão todos assim: `ativo = false` e
-- `status = 'Ativo'`, na mesma linha. O cadastro foi apagado e continua se
-- dizendo ativo.
--
-- Achado na auditoria de 17/08, ao conferir o passivo da lixeira (451/452).
-- Não corrompe nenhum número hoje, e é justamente por isso que estava lá: o
-- app inteiro filtra `ativo`, então a segunda coluna mente sem consequência —
-- até alguém acreditar nela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE ISSO É UMA BOMBA DE EFEITO RETARDADO, E NÃO COSMÉTICA
--
-- Quinze funções do banco leem `status` de produto. As da vitrine se salvam
-- por redundância, não por desenho:
--
--   AND COALESCE(status, 'Ativo') = 'Ativo'
--   AND COALESCE(ativo,  true)    = true
--
-- As duas linhas juntas acertam. A primeira sozinha, não: `CatalogoProdutosView`
-- filtra só por `p.status === 'Ativo'` e hoje escapa porque o `useFetchData`
-- já cortou os inativos antes. É uma trava dependendo da outra — a próxima
-- consulta escrita com uma linha só devolve produto apagado como se estivesse
-- à venda.
--
-- É o padrão "régua copiada à mão" com uma diferença ruim: as duas cópias
-- vivem na MESMA LINHA da mesma tabela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE `status` NÃO É SIMPLESMENTE APAGADA
--
-- Seria a correção mais limpa se `produtos.status` fosse só ruído — e quase é:
-- nas 4 turmas tem um único valor, 'Ativo', e nenhuma tela oferece trocá-lo
-- (`ProdutosView` grava `'Ativo'` no insert e nunca mais toca). Mas quinze
-- funções e três telas a leem, e derrubar a coluna significa reescrever todas
-- num dia em que já subiram cinco migrações. Custo alto, risco alto, ganho
-- igual ao desta.
--
-- Então `status` deixa de ser uma segunda fonte e passa a ser uma PROJEÇÃO de
-- `ativo`: quem apaga o cadastro não precisa lembrar de mexer nos dois lugares,
-- porque não há dois lugares para lembrar.
--
-- O gatilho preserva valor deliberado. Só sobrescreve quando `status` é
-- 'Ativo' ou nulo — se um dia existir 'Descontinuado' num produto vivo, ele
-- continua 'Descontinuado'. A regra é "apagado não se diz ativo", não "status
-- é cópia de ativo".
--
-- COBRE INSERT TAMBÉM
--
-- `fn_carimba_exclusao` (451) só cobre UPDATE, e ali é suficiente: registro
-- nasce ativo. Aqui não — uma carga que insira `ativo = false` nasceria
-- mentindo, e a auditoria de hoje já catalogou "gatilho que cobre metade" como
-- padrão de erro. INSERT e UPDATE.
--
-- SÓ `produtos`. `fornecedores.status` vale 'Homologado' para os 27 registros:
-- ali a coluna significa homologação, não existência, e o fornecedor inativo
-- com status 'Homologado' está certo — foi homologado mesmo. `servicos.status`
-- é editável na tela, campo de negócio de verdade. Mexer nas três porque a
-- coluna tem o mesmo nome seria confundir grafia com significado.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_produto_status_segue_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(NEW.ativo, true) THEN
    -- Apagado não se diz ativo. Valor deliberado (um 'Descontinuado' futuro)
    -- sobrevive: só o default é sobrescrito.
    IF COALESCE(NEW.status, 'Ativo') = 'Ativo' THEN
      NEW.status := 'Inativo';
    END IF;
  ELSE
    -- Restaurado volta a valer. Só desfaz o que este gatilho fez.
    IF COALESCE(NEW.status, '') = 'Inativo' THEN
      NEW.status := 'Ativo';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_produto_status_segue_ativo() IS
  'Mantém produtos.status como projeção de produtos.ativo (migr. 453): apagado não se diz ativo. Preserva valor deliberado — só o default ''Ativo'' e o próprio ''Inativo'' são trocados.';

DROP TRIGGER IF EXISTS trg_produto_status_segue_ativo ON public.produtos;
CREATE TRIGGER trg_produto_status_segue_ativo
  BEFORE INSERT OR UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.fn_produto_status_segue_ativo();

-- ── O passivo ───────────────────────────────────────────────────────────────
--
-- As 10 linhas que já estão divergentes. Aqui a correção é segura porque não
-- há nada a adivinhar: `ativo = false` é o fato, e `status` é a cópia que
-- ficou para trás. Diferente do estoque desses mesmos registros, que a
-- auditoria deixou de propósito para a turma decidir.

UPDATE public.produtos
   SET status = 'Inativo'
 WHERE COALESCE(ativo, true) = false
   AND COALESCE(status, 'Ativo') = 'Ativo';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   -- 1. o gatilho no lugar
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.produtos'::regclass
--      AND tgname = 'trg_produto_status_segue_ativo';
--
--   -- 2. nenhum produto apagado se dizendo ativo — esperado: zero linhas
--   SELECT nome, filial, ativo, status FROM produtos
--    WHERE COALESCE(ativo, true) = false AND COALESCE(status, 'Ativo') = 'Ativo';
--
--   -- 3. o quadro completo depois da correção
--   SELECT status, ativo, count(*) FROM produtos GROUP BY 1, 2 ORDER BY 1, 2;
--
--   -- 4. as outras duas tabelas com coluna `status` seguem intactas, e devem:
--   --    'Homologado' em fornecedor inativo não é erro.
--   SELECT 'fornecedores' t, status, ativo, count(*) FROM fornecedores GROUP BY 1,2,3
--   UNION ALL
--   SELECT 'servicos', status, ativo, count(*) FROM servicos GROUP BY 1,2,3
--   ORDER BY 1, 2, 3;
--
-- O teste que vale a aula: apagar um produto e conferir na Lixeira que ele
-- aparece como Inativo; restaurar e ver voltar a Ativo, sem ninguém digitar
-- status nenhum.
-- =================================================================
