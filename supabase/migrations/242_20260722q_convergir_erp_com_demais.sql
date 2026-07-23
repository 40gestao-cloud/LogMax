-- =================================================================
-- Convergência do projeto ERP com os outros 3 (aprendiz/contabilidade/adm).
--
-- Auditoria por hashes (md5 de definição) achou 7 objetos divergentes:
--   * clientes.pessoa_tipo default 'Empresa' -> remover (outros não têm)
--   * fornecedores.pessoa_tipo default 'Empresa' -> remover
--   * projetos.status default 'Em Andamento' -> 'Ativo'
--   * calcular_placar_padrao() -> versão dos outros
--   * confirmar_pix_pendente(uuid) -> versão dos outros
--   * fn_recompute_ponto_eletronico_after_delete() -> versão dos outros
--   * get_vitrine_publica() -> versão dos outros
--
-- APLICAR SOMENTE NO PROJETO LogMax-ERP (ref jvqsaccupxkvezriiede).
--
-- Idempotente (ALTER + CREATE OR REPLACE).
-- =================================================================

BEGIN;

-- 1. Column defaults ---------------------------------------------------
ALTER TABLE public.clientes     ALTER COLUMN pessoa_tipo DROP DEFAULT;
ALTER TABLE public.fornecedores ALTER COLUMN pessoa_tipo DROP DEFAULT;
ALTER TABLE public.projetos     ALTER COLUMN status      SET DEFAULT 'Ativo'::text;

-- 2. Funções -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calcular_placar_padrao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ciclo record;
  v_por_filial jsonb;
BEGIN
  SELECT id, nome, data_fim
    INTO v_ciclo
    FROM public.ciclos_avaliacao
   WHERE status = 'Fechado'
   ORDER BY data_fim DESC, created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
           jsonb_object_agg(
             filial,
             jsonb_build_object('media', ROUND(media::numeric, 2), 'n', n)
           ),
           '{}'::jsonb
         )
    INTO v_por_filial
    FROM (
      SELECT up.filial AS filial,
             AVG(c.nota)::numeric AS media,
             COUNT(c.nota)        AS n
        FROM public.criterios_avaliacao c
        JOIN public.avaliacoes a  ON a.id = c.avaliacao_id
        JOIN public.user_profiles up ON up.id = a.avaliado_id
        JOIN public.user_profiles av ON av.id = a.avaliador_id
       WHERE a.ciclo_id = v_ciclo.id
         AND up.filial IN ('SuperMax','MaxLook','TechMax')
         AND (
              av.role IN ('ceo','conselheiro')
           OR av.is_conselheiro = true
         )
       GROUP BY up.filial
    ) q;

  RETURN jsonb_build_object(
    'ciclo_id',   v_ciclo.id,
    'ciclo_nome', v_ciclo.nome,
    'data_fim',   v_ciclo.data_fim,
    'por_filial', v_por_filial
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_pix_pendente(p_id uuid)
 RETURNS TABLE(id uuid, status text, paid_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE pix_pendentes p
  SET status = 'pago',
      paid_at = now()
  WHERE p.id = p_id
    AND p.status = 'aguardando'
  RETURNING p.id, p.status, p.paid_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pix pendente não encontrado ou já processado'
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recompute_ponto_eletronico_after_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_func_id  UUID;
  v_data     DATE;
  v_entrada  TIME;
  v_saida    TIME;
BEGIN
  SELECT funcionario_id INTO v_func_id
  FROM user_profiles WHERE id = OLD.user_id;

  IF v_func_id IS NULL THEN
    RETURN OLD;
  END IF;

  v_data := (OLD.registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE;

  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_entrada
    FROM ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'entrada'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em
   LIMIT 1;

  SELECT (registrado_em AT TIME ZONE 'America/Rio_Branco')::TIME
    INTO v_saida
    FROM ponto_qr_registros
   WHERE user_id = OLD.user_id
     AND tipo = 'saida'
     AND (registrado_em AT TIME ZONE 'America/Rio_Branco')::DATE = v_data
   ORDER BY registrado_em DESC
   LIMIT 1;

  IF v_entrada IS NULL AND v_saida IS NULL THEN
    DELETE FROM ponto_eletronico
     WHERE funcionario_id = v_func_id AND data = v_data;
  ELSE
    UPDATE ponto_eletronico
       SET entrada = v_entrada,
           saida   = v_saida,
           horas_trabalhadas = CASE
             WHEN v_entrada IS NOT NULL AND v_saida IS NOT NULL
             THEN ROUND(EXTRACT(EPOCH FROM (v_saida - v_entrada)) / 3600.0, 2)
             ELSE 0
           END,
           status = CASE
             WHEN v_entrada IS NOT NULL AND v_saida IS NOT NULL
                  AND EXTRACT(EPOCH FROM (v_saida - v_entrada)) / 3600.0 > 9
             THEN 'Hora Extra'
             ELSE 'Normal'
           END
     WHERE funcionario_id = v_func_id AND data = v_data;
  END IF;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH artes AS (
    SELECT
      'arte'::text                                                              AS tipo,
      a.id::text                                                                AS id,
      a.nome_produto                                                            AS titulo,
      a.descricao_promocao                                                      AS descricao,
      COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url)                      AS imagem_url,
      a.preco_promocional,
      a.data_inicio,
      a.data_fim,
      a.created_at
    FROM public.marketing_artes a
    LEFT JOIN public.marketing_promocoes mp ON mp.id = a.promocao_id
    LEFT JOIN public.produtos             p ON p.id  = mp.produto_id
    WHERE a.vitrine_publica = true
      AND COALESCE(NULLIF(trim(a.arte_url), ''), p.imagem_url) IS NOT NULL
      AND COALESCE(a.data_fim, current_date + 30) >= current_date
    ORDER BY a.created_at DESC
    LIMIT 12
  ),
  prods AS (
    SELECT
      'produto'::text   AS tipo,
      id::text          AS id,
      nome              AS titulo,
      categoria         AS descricao,
      imagem_url,
      preco             AS preco_promocional,
      NULL::date        AS data_inicio,
      NULL::date        AS data_fim,
      created_at
    FROM public.produtos
    WHERE vitrine_publica = true
      AND imagem_url IS NOT NULL
      AND COALESCE(status, 'Ativo') = 'Ativo'
      AND COALESCE(ativo,  true)    = true
    ORDER BY created_at DESC
    LIMIT 12
  ),
  combined AS (
    SELECT * FROM artes
    UNION ALL
    SELECT * FROM prods
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(combined) ORDER BY combined.created_at DESC),
    '[]'::jsonb
  )
  FROM combined;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
