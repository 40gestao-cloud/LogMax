-- 611_20260922_a_media_que_a_filial_ve_usa_a_mesma_regua_do_placar.sql
--
-- A 609 arrumou `_calcular_placar_competicao_raw`: papel e vínculo do avaliador
-- congelados na nota, e ninguém pontua a própria unidade. Ficou faltando a
-- outra ponta — `media_participantes_competicao`, que é o número que a FILIAL
-- lê na tela dos participantes dela.
--
-- Ela continuava com o `JOIN user_profiles` e o `role <> 'admin'` pelo papel de
-- hoje, e sem a trava de filial própria. Hoje os dois números coincidem (todas
-- as notas existentes nasceram na Matriz), mas duas réguas para o mesmo fato é
-- exatamente o tipo de coisa que só aparece no dia da premiação: a unidade vê
-- 7,2 na própria tela e o placar da Matriz conta 6,8, e ninguém sabe qual é a
-- certa.
--
-- Uma régua só. Mesmas duas cláusulas da 609, mesmo COALESCE para nota antiga.
--
-- NOTA SOBRE O CORPO: copiado do banco nesta sessão. Muda o filtro do
-- avaliador; o recorte por filial de quem está lendo (`v_filial`) e o
-- `status = 'encerrada'` da tarefa seguem intactos.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.media_participantes_competicao(p_competicao_id uuid)
 RETURNS TABLE(item_id uuid, filial_avaliada text, media_nota numeric, n_notas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filial text;
BEGIN
  SELECT up.filial INTO v_filial FROM user_profiles up WHERE up.id = auth.uid();
  IF v_filial IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT am.item_id,
         am.filial_avaliada,
         ROUND(AVG(am.nota), 2)               AS media_nota,
         COUNT(*) FILTER (WHERE am.nota IS NOT NULL)::int AS n_notas
    FROM avaliacoes_matriz am
    JOIN matriz_tarefa_participantes p ON p.id = am.item_id
    JOIN matriz_tarefas t ON t.id = p.tarefa_id
   WHERE am.competicao_id = p_competicao_id
     AND am.ativo = true
     AND am.nota IS NOT NULL
     AND am.item_tipo LIKE 'tarefa\_%'
     -- (611) Mesma régua do placar (609): papel e vínculo congelados na nota.
     AND COALESCE(am.avaliador_role, 'conselheiro') <> 'admin'
     AND COALESCE(am.avaliador_filial, 'Matriz') IS DISTINCT FROM am.filial_avaliada
     AND t.ativo = true
     AND t.status = 'encerrada'          -- só resultado fechado
     AND (v_filial = 'Matriz' OR am.filial_avaliada = v_filial)
   GROUP BY am.item_id, am.filial_avaliada;
END;
$function$;

-- Coluna nova na `avaliacoes_matriz` (609) só aparece pro PostgREST depois do
-- reload — vide [[feedback_pgrst_reload_apos_rpc]].
NOTIFY pgrst, 'reload schema';

COMMIT;
