-- MIGR 631 — aplicar_taxonomia_padrao reconhece a linha padrão desativada.
--
-- Desativar uma categoria (o olho, em Cadastros › Categorias) passa pelo
-- fn_carimba_exclusao, que carimba `excluido_em` — a linha vai para a Lixeira.
-- A 629 procurava a linha existente com `excluido_em IS NULL`: numa segunda
-- aplicação (turma nova, ajuste de lista), a categoria padrão desativada não
-- era achada e a função criava OUTRA com o mesmo nome. Agora acha qualquer
-- uma, preferindo a padrão e a ativa, e não reativa nada — desativar é
-- decisão da unidade.

CREATE OR REPLACE FUNCTION public.aplicar_taxonomia_padrao(p_filial text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  s     record;
  v_cat uuid;
  v_sub uuid;
  v_n   integer := 0;
BEGIN
  PERFORM set_config('app.taxonomia_padrao', 'on', true);
  FOR r IN SELECT * FROM taxonomia_padrao
            WHERE nicho = p_filial AND subcategoria = '' ORDER BY ordem LOOP
    SELECT id INTO v_cat FROM categorias_produto
     WHERE filial = p_filial
       AND nome_item_normalizado(nome) = nome_item_normalizado(r.categoria)
     ORDER BY padrao DESC, (excluido_em IS NULL) DESC, created_at
     LIMIT 1;
    IF v_cat IS NULL THEN
      INSERT INTO categorias_produto (nome, cor, icone, filial, padrao)
      VALUES (r.categoria, r.cor, r.icone, p_filial, true)
      RETURNING id INTO v_cat;
      v_n := v_n + 1;
    ELSE
      UPDATE categorias_produto SET nome = r.categoria, padrao = true WHERE id = v_cat;
    END IF;

    FOR s IN SELECT * FROM taxonomia_padrao
              WHERE nicho = p_filial AND categoria = r.categoria AND subcategoria <> ''
              ORDER BY ordem LOOP
      SELECT id INTO v_sub FROM subcategorias_produto
       WHERE categoria_id = v_cat
         AND nome_item_normalizado(nome) = nome_item_normalizado(s.subcategoria)
       ORDER BY padrao DESC, (excluido_em IS NULL) DESC, created_at
       LIMIT 1;
      IF v_sub IS NULL THEN
        INSERT INTO subcategorias_produto (categoria_id, nome, cor, icone, padrao)
        VALUES (v_cat, s.subcategoria, COALESCE(r.cor, '#6b7280'), COALESCE(r.icone, '📦'), true);
        v_n := v_n + 1;
      ELSE
        UPDATE subcategorias_produto SET nome = s.subcategoria, padrao = true WHERE id = v_sub;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.taxonomia_padrao', '', true);
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.aplicar_taxonomia_padrao(text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
