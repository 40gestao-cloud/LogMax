-- 558 — A arte nasce na unidade da promoção, não na SuperMax.
--
-- Werisson Cunha (gerente de marketing da TechMax, turma Contabilidade) subiu
-- a imagem da arte e levou "Erro ao publicar" no Publicar. Na SuperMax o mesmo
-- fluxo passa. O erro não era do upload: o arquivo chega ao bucket, e é o
-- INSERT na tabela que a RLS recusa.
--
-- `PromocoesMarketingView.handleSaveArte` monta o payload da arte com
-- promocao_id, nome_produto, arte_url, publicada_por… e NÃO manda `filial`.
-- A coluna existe desde a migr. 139 com `DEFAULT 'SuperMax'`, então toda arte
-- publicada nasce carimbada SuperMax, venha de onde vier. A policy da migr.
-- 193 fecha em cima disso:
--
--     artes_insert WITH CHECK (... AND auth_pode_filial(filial))
--
-- Para quem opera a TechMax, `auth_pode_filial('SuperMax')` é falso — 42501.
-- Daí o "quase sempre": na SuperMax o default acerta por acidente, nas outras
-- duas unidades erra sempre. E para admin/CEO, que passam em qualquer filial,
-- o INSERT nem falha: a arte entra na unidade errada e some da lista da tela,
-- que lê com `{ filial }`.
--
-- ─── POR QUE O CONSERTO É NO BANCO, E NÃO SÓ NA TELA ───────────────────────
--
-- A tela também passa a mandar a filial da promoção. Mas o aluno está com a
-- PWA em cache, e um bug que só some depois do próximo update não serve para
-- a aula de hoje. A promoção é a dona da unidade da arte — a coluna é derivada,
-- não digitada — então quem deve carimbá-la é o banco.
--
-- `fn_arte_produto_e_cota` (migr. 539) já lê `marketing_promocoes` no BEFORE
-- INSERT/UPDATE para carimbar `produto_id`. A filial entra no mesmo SELECT:
-- uma leitura, dois carimbos. Como é BEFORE, a RLS avalia o WITH CHECK sobre
-- a linha já corrigida — quem pode escrever na unidade da promoção passa, e
-- quem não pode continua sendo recusado, agora pelo motivo certo.
--
-- Definição copiada de `pg_get_functiondef` no banco (não do arquivo da 539),
-- porque é o que está de fato rodando.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_arte_produto_e_cota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_produto uuid;
  v_filial  text;
  v_max     integer;
  v_tem     integer;
  v_nome    text;
BEGIN
  SELECT mp.produto_id, mp.filial INTO v_produto, v_filial
    FROM public.marketing_promocoes mp
   WHERE mp.id = NEW.promocao_id;

  IF v_produto IS NULL THEN
    RAISE EXCEPTION 'Esta promoção não aponta para nenhum produto do catálogo, e a arte é publicada por produto. Escolha o produto na promoção antes de publicar a arte.'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.produto_id := v_produto;

  -- A unidade da arte é a da promoção que ela anuncia. Nunca o default da
  -- coluna, nunca o que a tela mandar: promoção da TechMax não gera arte da
  -- SuperMax. `NULLIF` protege contra promoção antiga sem filial gravada —
  -- nesse caso a coluna fica com o que veio, e a RLS decide como antes.
  NEW.filial := COALESCE(NULLIF(v_filial, ''), NEW.filial);

  -- Editar a arte (trocar a imagem, corrigir o link) não é publicar outra:
  -- se o produto não mudou, não há cota nova a consumir.
  IF TG_OP = 'UPDATE' AND OLD.produto_id IS NOT DISTINCT FROM v_produto THEN
    RETURN NEW;
  END IF;

  -- Serializa por produto: sem isto, dois alunos contam "2 de 3" ao mesmo
  -- tempo, os dois passam, e o produto termina com 4.
  PERFORM pg_advisory_xact_lock(hashtext('marketing_artes_cota'), hashtext(v_produto::text));

  SELECT COALESCE(max_artes_por_produto, 3) INTO v_max
    FROM public.marketing_config WHERE id = 1;
  v_max := COALESCE(v_max, 3);   -- linha ausente não vira ausência de régua

  SELECT count(*) INTO v_tem
    FROM public.marketing_artes a
   WHERE a.produto_id = v_produto
     AND a.id <> NEW.id;

  IF v_tem >= v_max THEN
    SELECT nome INTO v_nome FROM public.produtos WHERE id = v_produto;
    RAISE EXCEPTION
      'O produto "%" já tem % arte(s) publicada(s), que é o limite atual. Peça ao professor para aumentar em Sessões Gerais → Marketing → Configurações, ou apague uma das artes existentes.',
      COALESCE(v_nome, 'deste item'), v_tem
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── ARTES JÁ GRAVADAS NA UNIDADE ERRADA ───────────────────────────────────
--
-- Mesmo reparo da migr. 139, agora pelo motivo oposto: lá a coluna acabava de
-- nascer, aqui ela nasceu errada. Só toca linha em que a promoção discorda —
-- arte de promoção apagada (LEFT JOIN sem par) fica como está.
UPDATE public.marketing_artes a
   SET filial = p.filial
  FROM public.marketing_promocoes p
 WHERE a.promocao_id = p.id
   AND p.filial IS NOT NULL
   AND p.filial <> ''
   AND a.filial IS DISTINCT FROM p.filial;

COMMIT;

-- ─── CONFERÊNCIA ───────────────────────────────────────────────────────────
--
--   -- espera ZERO linhas: nenhuma arte fora da unidade da própria promoção
--   SELECT a.id, a.filial, p.filial
--     FROM public.marketing_artes a
--     JOIN public.marketing_promocoes p ON p.id = a.promocao_id
--    WHERE a.filial IS DISTINCT FROM p.filial;
