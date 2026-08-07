-- =================================================================
-- 384 — Política com versão: ciência que caduca quando a regra muda.
--
-- Item #G7 do backlog de governança.
--
-- O buraco: `avisos_matriz` + "Ciente" (migr. 263) já resolve metade —
-- a Matriz manda o recado e a turma confirma leitura. Mas aviso é
-- efêmero e não tem versão. Código de conduta, política de compras e
-- política de uso de dados são documentos que VIVEM: mudam de redação,
-- e a assinatura da versão anterior não vale para a nova.
--
-- Decisões que valem estar escritas:
--   • A ciência é dada à VERSÃO, nunca à política. Publicar a v2 não
--     "zera" nada — as ciências da v1 continuam lá, provando quem leu o
--     quê e quando. Quem já assinou simplesmente volta a dever
--     assinatura, porque a assinatura devida é a da versão vigente.
--     Reciência sai de graça do modelo de dados, não de um UPDATE.
--   • Versão é imutável depois de publicada. Corrigir vírgula é publicar
--     v3. Documento que muda embaixo de quem assinou não prova nada.
--   • `vigencia_inicio` pode ser futura: aprova-se hoje o que passa a
--     valer no dia 1º. A vigente é a maior versão já publicada com
--     vigência começada.
--   • Notifica por setor, reaproveitando `notificar_setor` — política
--     publicada que ninguém vê é papel de parede.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. A política e suas versões ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.politicas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL,
  categoria       text NOT NULL DEFAULT 'Conduta'
                    CHECK (categoria IN ('Conduta','Compras','Financeiro','Pessoas','Segurança da Informação','Operação','Outra')),
  descricao       text,
  exige_ciencia   boolean NOT NULL DEFAULT true,
  publico         text NOT NULL DEFAULT 'todos' CHECK (publico IN ('todos','gestores')),
  ativo           boolean NOT NULL DEFAULT true,
  criado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_politica_titulo
  ON public.politicas (lower(titulo)) WHERE ativo = true;

CREATE TABLE IF NOT EXISTS public.politica_versoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_id     uuid NOT NULL REFERENCES public.politicas(id) ON DELETE CASCADE,
  versao          int  NOT NULL CHECK (versao > 0),
  conteudo        text NOT NULL,
  resumo_mudanca  text,
  vigencia_inicio date NOT NULL DEFAULT CURRENT_DATE,
  publicada_em    timestamptz NOT NULL DEFAULT now(),
  publicada_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  publicada_por_nome text,
  ativo           boolean NOT NULL DEFAULT true,
  UNIQUE (politica_id, versao)
);

COMMENT ON TABLE public.politica_versoes IS
  'Versao publicada e imutavel. Corrigir texto e publicar versao nova: documento que muda embaixo de quem assinou nao prova nada.';

CREATE TABLE IF NOT EXISTS public.politica_ciencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  versao_id     uuid NOT NULL REFERENCES public.politica_versoes(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  nome_snapshot text,
  filial        text,
  ciente_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (versao_id, user_id)
);

COMMENT ON TABLE public.politica_ciencias IS
  'Ciencia e dada a VERSAO, nunca a politica. E o que faz a assinatura caducar sozinha quando sai versao nova.';

CREATE INDEX IF NOT EXISTS idx_politica_ciencias_user ON public.politica_ciencias (user_id);

ALTER TABLE public.politicas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politica_versoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politica_ciencias ENABLE ROW LEVEL SECURITY;

-- Política é para ser lida: leitura aberta a quem está logado.
DROP POLICY IF EXISTS politicas_read ON public.politicas;
CREATE POLICY politicas_read ON public.politicas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS politicas_write ON public.politicas;
CREATE POLICY politicas_write ON public.politicas
  FOR ALL TO authenticated
  USING (COALESCE(auth_is_admin(), false) AND COALESCE(NOT auth_desligado(), false))
  WITH CHECK (COALESCE(auth_is_admin(), false));

DROP POLICY IF EXISTS politica_versoes_read ON public.politica_versoes;
CREATE POLICY politica_versoes_read ON public.politica_versoes
  FOR SELECT TO authenticated USING (true);

-- Escrita de versão só pela RPC (numeração e imutabilidade moram lá).

-- Quem assinou o quê é informação de gestão: o Conselho vê tudo, cada um
-- vê a própria assinatura.
DROP POLICY IF EXISTS politica_ciencias_read ON public.politica_ciencias;
CREATE POLICY politica_ciencias_read ON public.politica_ciencias
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR COALESCE(auth_is_admin(), false));

-- ── 2. Publicar versão ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publicar_politica_versao(
  p_politica_id     uuid,
  p_conteudo        text,
  p_resumo_mudanca  text DEFAULT NULL,
  p_vigencia_inicio date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_pol    politicas;
  v_versao int;
  v_id     uuid;
  v_ator   text;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Conselho publica política.' USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(p_conteudo, '')) = '' THEN
    RAISE EXCEPTION 'Política sem texto não é política.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pol FROM politicas WHERE id = p_politica_id AND ativo = true;
  IF v_pol.id IS NULL THEN
    RAISE EXCEPTION 'Política não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(versao), 0) + 1 INTO v_versao
    FROM politica_versoes WHERE politica_id = p_politica_id;

  SELECT nome INTO v_ator FROM user_profiles WHERE id = auth.uid();

  INSERT INTO politica_versoes
    (politica_id, versao, conteudo, resumo_mudanca, vigencia_inicio,
     publicada_por, publicada_por_nome)
  VALUES
    (p_politica_id, v_versao, p_conteudo,
     NULLIF(btrim(COALESCE(p_resumo_mudanca,'')), ''),
     COALESCE(p_vigencia_inicio, CURRENT_DATE), auth.uid(), v_ator)
  RETURNING id INTO v_id;

  -- Avisa quem tem de ler. Setor 'all' e tipo 'info' de propósito: o CHECK
  -- de `notificacoes` só aceita a lista fechada de setores (e 'gerencia',
  -- que existe em user_profiles, não está nela) e a lista fechada de tipos.
  -- Varrer os setores das pessoas quebraria a publicação por constraint.
  IF v_pol.exige_ciencia THEN
    PERFORM notificar_setor(
      'all', 'info',
      format('%s — v%s', v_pol.titulo, v_versao),
      CASE WHEN v_versao = 1 THEN 'Nova política publicada. Leia e confirme ciência.'
           ELSE 'Nova versão publicada. A ciência anterior não vale mais — leia e confirme de novo.' END,
      'politicas', 'Média', v_id, NULL, NULL);
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'versao_id', v_id, 'versao', v_versao);
END;
$$;

REVOKE ALL ON FUNCTION public.publicar_politica_versao(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publicar_politica_versao(uuid,text,text,date) TO authenticated;

-- ── 3. Dar ciência ────────────────────────────────────────────────
-- SECURITY DEFINER e sempre em nome de auth.uid(): ninguém assina pelo
-- outro, nem passando id alheio no parâmetro — não existe parâmetro.
CREATE OR REPLACE FUNCTION public.dar_ciencia_politica(p_versao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_perfil user_profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_perfil FROM user_profiles WHERE id = auth.uid();
  IF v_perfil.id IS NULL THEN
    RAISE EXCEPTION 'Perfil não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM politica_versoes WHERE id = p_versao_id AND ativo = true) THEN
    RAISE EXCEPTION 'Versão não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO politica_ciencias (versao_id, user_id, nome_snapshot, filial)
  VALUES (p_versao_id, auth.uid(), v_perfil.nome, v_perfil.filial)
  ON CONFLICT (versao_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

REVOKE ALL ON FUNCTION public.dar_ciencia_politica(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dar_ciencia_politica(uuid) TO authenticated;

-- ── 4. Versão vigente + adesão ────────────────────────────────────
-- A vigente é a maior versão já publicada com vigência começada. Versão
-- aprovada hoje para valer no dia 1º fica esperando a data virar.
CREATE OR REPLACE VIEW public.politicas_vigentes
WITH (security_invoker = true) AS
SELECT
  p.id            AS politica_id,
  p.titulo,
  p.categoria,
  p.descricao,
  p.exige_ciencia,
  v.id            AS versao_id,
  v.versao,
  v.conteudo,
  v.resumo_mudanca,
  v.vigencia_inicio,
  v.publicada_em,
  v.publicada_por_nome,
  -- `cientes` roda sob a RLS de quem lê (security_invoker): para o Conselho
  -- é a adesão real; para o colaborador é 0 ou 1, porque ele só enxerga a
  -- própria assinatura. A tela só mostra adesão para o Conselho, e o
  -- colaborador usa `eu_ciente`, que é a pergunta dele.
  (SELECT count(*) FROM politica_ciencias c WHERE c.versao_id = v.id) AS cientes,
  EXISTS (SELECT 1 FROM politica_ciencias c
           WHERE c.versao_id = v.id AND c.user_id = auth.uid())        AS eu_ciente,
  (SELECT count(*) FROM user_profiles u
    WHERE COALESCE(u.ativo, true) AND u.desligado_em IS NULL)          AS elegiveis
FROM politicas p
JOIN LATERAL (
  SELECT * FROM politica_versoes pv
   WHERE pv.politica_id = p.id AND pv.ativo = true
     AND pv.vigencia_inicio <= CURRENT_DATE
   ORDER BY pv.versao DESC LIMIT 1
) v ON true
WHERE p.ativo = true;

COMMENT ON VIEW public.politicas_vigentes IS
  'Uma linha por politica com a versao que vale hoje + contagem de ciencias daquela versao.';

GRANT SELECT ON public.politicas_vigentes TO authenticated;
REVOKE ALL ON public.politicas_vigentes FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) anon fora:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('publicar_politica_versao','dar_ciencia_politica');
--
-- 2) A ciência caduca sozinha: publicar a v2 e conferir que a adesão da
--    política volta a zero sem nenhum DELETE ter acontecido.
-- SELECT titulo, versao, cientes, elegiveis FROM politicas_vigentes;
-- SELECT versao_id, count(*) FROM politica_ciencias GROUP BY 1;  -- v1 intacta
--
-- 3) A view enxerga a versão futura? NÃO deve:
-- SELECT titulo, versao, vigencia_inicio FROM politicas_vigentes;
