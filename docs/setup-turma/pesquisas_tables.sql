-- ============================================================
-- LogMax — Submódulo Pesquisas (RH)
-- Execute este script no SQL Editor do Supabase
-- ============================================================
--
-- Modelo:
--   pesquisas               → header da pesquisa (alvo, status, anonimato)
--   pesquisa_perguntas      → perguntas (escala 1-5 ou texto livre)
--   pesquisa_respostas      → 1 linha por submissão (anonimato preserva
--                              respondente_id/role/setor como NULL)
--   pesquisa_resposta_itens → resposta individual a cada pergunta
--
-- Anti-duplicata: UNIQUE parcial em (pesquisa_id, respondente_id)
-- bloqueia 2ª resposta do mesmo usuário em pesquisa identificada.
-- Anônimas usam localStorage como soft-guard no front.
--
-- RPC `responder_pesquisa`: caminho transacional oficial. Valida
-- elegibilidade (role/setor vs alvo), cria submissão e itens em 1 tx.
-- ============================================================

CREATE TABLE IF NOT EXISTS pesquisas (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo       text        NOT NULL,
  descricao    text,
  anonima      boolean     NOT NULL DEFAULT true,
  status       text        NOT NULL DEFAULT 'Rascunho'
                 CHECK (status IN ('Rascunho','Ativa','Encerrada')),
  alvo_roles   text[],
  alvo_setores text[],
  data_inicio  date,
  data_fim     date,
  nome_criador text,
  criado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pesquisas_status_idx     ON pesquisas (status);
CREATE INDEX IF NOT EXISTS pesquisas_created_at_idx ON pesquisas (created_at DESC);

CREATE TABLE IF NOT EXISTS pesquisa_perguntas (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  pesquisa_id uuid        NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  ordem       int         NOT NULL DEFAULT 0,
  tipo        text        NOT NULL CHECK (tipo IN ('escala','texto')),
  enunciado   text        NOT NULL,
  obrigatoria boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pesquisa_perguntas_pesquisa_idx
  ON pesquisa_perguntas (pesquisa_id, ordem);

CREATE TABLE IF NOT EXISTS pesquisa_respostas (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  pesquisa_id       uuid        NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  respondente_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  respondente_role  text,
  respondente_setor text,
  created_at        timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pesquisa_respostas_unq_resp
  ON pesquisa_respostas (pesquisa_id, respondente_id)
  WHERE respondente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pesquisa_respostas_pesquisa_idx
  ON pesquisa_respostas (pesquisa_id);

CREATE TABLE IF NOT EXISTS pesquisa_resposta_itens (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  resposta_id  uuid        NOT NULL REFERENCES pesquisa_respostas(id) ON DELETE CASCADE,
  pergunta_id  uuid        NOT NULL REFERENCES pesquisa_perguntas(id) ON DELETE CASCADE,
  valor_escala int         CHECK (valor_escala BETWEEN 1 AND 5),
  valor_texto  text,
  -- useFetchData ordena por created_at; sem essa coluna, qualquer view
  -- futura que faça fetch direto da tabela devolve 400 silencioso.
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_resposta_valor
    CHECK (valor_escala IS NOT NULL OR valor_texto IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pesquisa_resposta_itens_resposta_idx
  ON pesquisa_resposta_itens (resposta_id);

-- RLS: padrão do projeto (authenticated faz tudo via API; UI restringe).
ALTER TABLE pesquisas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_perguntas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_respostas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_resposta_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pesquisas_auth" ON pesquisas;
CREATE POLICY "pesquisas_auth" ON pesquisas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pesquisa_perguntas_auth" ON pesquisa_perguntas;
CREATE POLICY "pesquisa_perguntas_auth" ON pesquisa_perguntas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pesquisa_respostas_auth" ON pesquisa_respostas;
CREATE POLICY "pesquisa_respostas_auth" ON pesquisa_respostas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pesquisa_resposta_itens_auth" ON pesquisa_resposta_itens;
CREATE POLICY "pesquisa_resposta_itens_auth" ON pesquisa_resposta_itens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- RPC: responder_pesquisa
-- Caminho oficial de envio de respostas. Atômico, valida elegibilidade.
-- ============================================================
CREATE OR REPLACE FUNCTION responder_pesquisa(
  p_pesquisa_id uuid,
  p_itens       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anonima      boolean;
  v_status       text;
  v_alvo_roles   text[];
  v_alvo_setores text[];
  v_user_id      uuid;
  v_user_role    text;
  v_user_setor   text;
  v_resposta_id  uuid;
  v_item         jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT anonima, status, alvo_roles, alvo_setores
    INTO v_anonima, v_status, v_alvo_roles, v_alvo_setores
    FROM pesquisas WHERE id = p_pesquisa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada';
  END IF;
  IF v_status <> 'Ativa' THEN
    RAISE EXCEPTION 'Pesquisa não está ativa';
  END IF;

  SELECT role, setor INTO v_user_role, v_user_setor
    FROM user_profiles WHERE id = v_user_id;

  -- Wildcard: alvo NULL/vazio = todos. Setor 'all' (admin/CEO) sempre passa.
  IF v_alvo_roles IS NOT NULL AND array_length(v_alvo_roles, 1) > 0 THEN
    IF NOT (v_user_role = ANY(v_alvo_roles)) THEN
      RAISE EXCEPTION 'Usuário fora do público-alvo (role)';
    END IF;
  END IF;
  IF v_alvo_setores IS NOT NULL AND array_length(v_alvo_setores, 1) > 0 THEN
    IF v_user_setor <> 'all' AND NOT (v_user_setor = ANY(v_alvo_setores)) THEN
      RAISE EXCEPTION 'Usuário fora do público-alvo (setor)';
    END IF;
  END IF;

  INSERT INTO pesquisa_respostas (
    pesquisa_id, respondente_id, respondente_role, respondente_setor
  ) VALUES (
    p_pesquisa_id,
    CASE WHEN v_anonima THEN NULL ELSE v_user_id    END,
    CASE WHEN v_anonima THEN NULL ELSE v_user_role  END,
    CASE WHEN v_anonima THEN NULL ELSE v_user_setor END
  )
  RETURNING id INTO v_resposta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    INSERT INTO pesquisa_resposta_itens (
      resposta_id, pergunta_id, valor_escala, valor_texto
    ) VALUES (
      v_resposta_id,
      (v_item->>'pergunta_id')::uuid,
      NULLIF(v_item->>'valor_escala','')::int,
      NULLIF(v_item->>'valor_texto','')
    );
  END LOOP;

  RETURN v_resposta_id;
END;
$$;

GRANT EXECUTE ON FUNCTION responder_pesquisa(uuid, jsonb) TO authenticated;
