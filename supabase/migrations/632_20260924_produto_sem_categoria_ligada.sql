-- MIGR 632 — produto que só tinha a categoria em TEXTO.
--
-- A 629 reclassificou os produtos seguindo `categoria_id`. Dois produtos não
-- tinham a ligação, só o nome antigo no texto (`produtos.categoria`): o
-- "Achocolatado - Todynho" da Adm ("Mercearia seca e despensa") e a "Bolsa
-- Tiracolo Feminina" da ERP ("Moda feminina · acessórios"). A lista de
-- Produtos mostrava uma categoria que não existe mais.
--
-- Mesma régua da 629 para produto sem subcategoria: a primeira palavra do
-- nome (radical de 4 letras) contra as subcategorias da lista padrão da loja.
-- Sem casamento, o produto fica como está.

DO $m$
DECLARE
  p      record;
  v_rad  text;
  v_dcat text;
  v_dsub text;
  v_cat  uuid;
  v_sub  uuid;
BEGIN
  FOR p IN
    SELECT pr.id, pr.nome, pr.filial FROM public.produtos pr
     WHERE pr.categoria_id IS NULL AND COALESCE(pr.categoria, '') <> ''
       AND pr.filial IN ('SuperMax', 'MaxLook', 'TechMax')
  LOOP
    v_rad := left(split_part(public.nome_item_normalizado(p.nome), ' ', 1), 4);
    CONTINUE WHEN length(v_rad) < 4;
    v_dcat := NULL; v_dsub := NULL;
    SELECT t.categoria, t.subcategoria INTO v_dcat, v_dsub FROM public.taxonomia_padrao t
     WHERE t.nicho = p.filial AND t.subcategoria <> ''
       AND EXISTS (SELECT 1 FROM regexp_split_to_table(public.nome_item_normalizado(t.subcategoria), ' ') w
                    WHERE length(w) >= 4 AND left(w, 4) = v_rad)
     ORDER BY t.ordem
     LIMIT 1;
    CONTINUE WHEN v_dcat IS NULL;
    SELECT id INTO v_cat FROM public.categorias_produto WHERE filial = p.filial AND padrao AND nome = v_dcat;
    SELECT id INTO v_sub FROM public.subcategorias_produto WHERE categoria_id = v_cat AND padrao AND nome = v_dsub;
    CONTINUE WHEN v_cat IS NULL;
    UPDATE public.produtos SET categoria_id = v_cat, subcategoria_id = v_sub, categoria = v_dcat WHERE id = p.id;
  END LOOP;
END;
$m$;
