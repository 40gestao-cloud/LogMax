-- 633 — Amarrar o produto à requisição não apaga o fardo.
--
-- A 590 limpa `qtd_embalagens`/`embalagem_nome`/`embalagem_fator` quando o
-- produto da requisição MUDA ("virou outro produto"). Mas a compra eventual
-- nasce com `produto_id` nulo e ganha o produto no cadastro (migr. 494): o
-- NULL → X também contava como troca, e toda eventual pedida em fardo perdia
-- o fardo no exato momento em que o produto era cadastrado. Achado na Adm:
-- REQ-SM-2026-0236 (10 pacotes de 4) virou "40 UN" depois do cadastro.
--
-- Troca de verdade é X → Y. O primeiro vínculo mantém a embalagem declarada.
-- Corpo copiado do banco (vigente nas 4 turmas) e só a condição alterada.

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

  IF (OLD.produto_id IS NOT NULL AND NEW.produto_id IS DISTINCT FROM OLD.produto_id)
     OR NEW.qtd IS NULL
     OR NEW.embalagem_fator <= 0
     OR mod(NEW.qtd, NEW.embalagem_fator) <> 0 THEN
    -- Deixou de ser um número redondo de embalagens (ou trocou de produto):
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
