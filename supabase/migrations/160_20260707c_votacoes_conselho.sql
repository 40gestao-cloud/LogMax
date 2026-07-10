-- =================================================================
-- Votações do Conselho e Votações Totais (modo Matriz)
-- =================================================================
-- Tipos:
--   'conselho' — criado por admin/CEO/conselheiro; voto restrito a CEO/conselheiro
--   'total'    — criado por admin/CEO/conselheiro; voto aberto a todos
-- Fluxo: Rascunho → Em Votação → Decidido
-- =================================================================

BEGIN;

-- ── Tabela principal ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.votacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL CHECK (tipo IN ('conselho', 'total')),
  criador_id      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  pauta           text NOT NULL,
  descricao       text,
  imagem_url      text,
  data_votacao    date NOT NULL,
  horario_votacao time NOT NULL,
  status          text NOT NULL DEFAULT 'Rascunho'
                  CHECK (status IN ('Rascunho', 'Em Votação', 'Decidido')),
  votos_favor     integer NOT NULL DEFAULT 0,
  votos_contra    integer NOT NULL DEFAULT 0,
  resultado       text CHECK (resultado IN ('Aceito', 'Rejeitado')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Votos individuais ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.votacoes_votos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  votacao_id  uuid NOT NULL REFERENCES public.votacoes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  voto        text NOT NULL CHECK (voto IN ('favor', 'contra')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (votacao_id, user_id)
);

-- ── Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS votacoes_tipo_status_idx ON public.votacoes (tipo, status);
CREATE INDEX IF NOT EXISTS votacoes_votos_votacao_idx ON public.votacoes_votos (votacao_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.votacoes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votacoes_votos  ENABLE ROW LEVEL SECURITY;

-- votacoes: leitura por todos autenticados
DROP POLICY IF EXISTS votacoes_select ON public.votacoes;
CREATE POLICY votacoes_select ON public.votacoes
  FOR SELECT TO authenticated USING (true);

-- votacoes: criação/edição por admin, CEO ou conselheiro
DROP POLICY IF EXISTS votacoes_insert ON public.votacoes;
CREATE POLICY votacoes_insert ON public.votacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (p.role IN ('admin','ceo','conselheiro')
              OR (p.role = 'gerente' AND p.is_conselheiro = true))
    )
  );

DROP POLICY IF EXISTS votacoes_update ON public.votacoes;
CREATE POLICY votacoes_update ON public.votacoes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND (p.role IN ('admin','ceo','conselheiro')
              OR (p.role = 'gerente' AND p.is_conselheiro = true))
    )
  );

DROP POLICY IF EXISTS votacoes_delete ON public.votacoes;
CREATE POLICY votacoes_delete ON public.votacoes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('admin','ceo')
    )
  );

-- votacoes_votos: leitura por todos autenticados
DROP POLICY IF EXISTS votacoes_votos_select ON public.votacoes_votos;
CREATE POLICY votacoes_votos_select ON public.votacoes_votos
  FOR SELECT TO authenticated USING (true);

-- votacoes_votos: insert via RPC SECURITY DEFINER (política aberta p/ RPC)
DROP POLICY IF EXISTS votacoes_votos_insert ON public.votacoes_votos;
CREATE POLICY votacoes_votos_insert ON public.votacoes_votos
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ── RPC: registrar_voto ────────────────────────────────────────────────────
-- Valida permissão por tipo, faz upsert do voto e re-conta totais.
CREATE OR REPLACE FUNCTION public.registrar_voto(
  p_votacao_id uuid,
  p_voto       text   -- 'favor' ou 'contra'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo    text;
  v_status  text;
  v_role    text;
  v_cons    boolean;
BEGIN
  -- Busca dados da votação
  SELECT tipo, status INTO v_tipo, v_status
    FROM public.votacoes
   WHERE id = p_votacao_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Votação não encontrada';
  END IF;
  IF v_status <> 'Em Votação' THEN
    RAISE EXCEPTION 'Votação não está em andamento';
  END IF;
  IF p_voto NOT IN ('favor','contra') THEN
    RAISE EXCEPTION 'Voto inválido';
  END IF;

  -- Busca perfil do usuário logado
  SELECT role, COALESCE(is_conselheiro, false)
    INTO v_role, v_cons
    FROM public.user_profiles
   WHERE id = auth.uid();

  -- Verifica permissão de votar
  IF v_tipo = 'conselho' THEN
    -- Apenas CEO e conselheiros
    IF NOT (v_role = 'ceo'
            OR v_role = 'conselheiro'
            OR (v_role = 'gerente' AND v_cons = true)) THEN
      RAISE EXCEPTION 'Sem permissão para votar nesta votação';
    END IF;
  END IF;
  -- tipo='total': qualquer autenticado pode votar (sem restrição extra)

  -- Upsert do voto (permite alterar enquanto Em Votação)
  INSERT INTO public.votacoes_votos (votacao_id, user_id, voto)
       VALUES (p_votacao_id, auth.uid(), p_voto)
  ON CONFLICT (votacao_id, user_id)
  DO UPDATE SET voto = EXCLUDED.voto, created_at = now();

  -- Reconta totais
  UPDATE public.votacoes
     SET votos_favor  = (SELECT COUNT(*) FROM public.votacoes_votos
                          WHERE votacao_id = p_votacao_id AND voto = 'favor'),
         votos_contra = (SELECT COUNT(*) FROM public.votacoes_votos
                          WHERE votacao_id = p_votacao_id AND voto = 'contra')
   WHERE id = p_votacao_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_voto(uuid, text) TO authenticated;

-- ── Storage bucket (criação idempotente via SQL não é possível no Supabase)
-- Criar manualmente no painel: bucket "votacoes-imagens", público, 200 KB max.
-- Ou via script de seed separado.

COMMIT;
