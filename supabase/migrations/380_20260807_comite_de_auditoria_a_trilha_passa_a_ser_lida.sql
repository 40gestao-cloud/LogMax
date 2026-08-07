-- =================================================================
-- 380 — Comitê de Auditoria: a trilha passa a ser lida por alguém.
--
-- Item #G5 do backlog de governança. Exceção à trava aberta pelo usuário
-- em 2026-08-07.
--
-- O buraco: `historico_operacoes` já acumula milhares de linhas (1482 só
-- no ERP) e a tela de Auditoria já deixa navegar por elas. Mas ler não é
-- fiscalizar. Não havia nenhum ato: o conselheiro via algo estranho e não
-- tinha onde registrar a pergunta, quem respondeu, nem o que se concluiu.
-- Trilha que ninguém questiona é enfeite de banco.
--
-- Esta migração NÃO cria dado de operação — só o fluxo de revisão por
-- cima do que já existe:
--   1. Conselheiro escolhe uma operação da trilha e abre questionamento
--   2. Quem responde pela unidade responde
--   3. Conselheiro encerra: conforme ou não conforme
--   4. NÃO CONFORME VIRA TAREFA — mesma régua da ressalva da 379
--
-- Decisões que valem estar escritas:
--   • `filial` é copiada da operação no momento da abertura, não lida por
--     JOIN. A trilha é append-only, mas a RLS de leitura dela é por
--     unidade; duplicar o campo deixa a policy da revisão auto-suficiente
--     e evita que um JOIN com RLS decida quem enxerga o questionamento.
--   • Uma revisão aberta por operação (índice parcial). Duas pessoas
--     questionando a mesma linha viram duas conversas paralelas sobre o
--     mesmo fato, e ninguém sabe qual vale.
--   • Quem abre não responde. O auditor que responde a própria pergunta
--     não auditou nada.
--   • Encerrar exige conclusão explícita. Deixar em aberto para sempre é
--     o modo mais silencioso de a auditoria não existir.
--
-- Idempotente.
-- =================================================================

BEGIN;

-- ── 1. `tarefas` reconhece o apontamento de auditoria ─────────────
-- A 379 já abriu 'governanca' em modulo e 'ressalva_conselho' em origem.
-- Auditoria ganha origem própria: quem filtra a fila de não conformidades
-- precisa distinguir "o Conselho ressalvou a prestação" de "a auditoria
-- achou uma operação irregular".
ALTER TABLE public.tarefas DROP CONSTRAINT IF EXISTS chk_tarefas_origem;
ALTER TABLE public.tarefas ADD CONSTRAINT chk_tarefas_origem
  CHECK (origem IN ('manual','briefing_ia','ressalva_conselho','auditoria'));

-- ── 2. A revisão ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auditoria_revisoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacao_id    uuid NOT NULL REFERENCES public.historico_operacoes(id) ON DELETE CASCADE,
  filial         text,                    -- copiada da operação; ver cabeçalho
  questionamento text NOT NULL,
  aberta_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aberta_em      timestamptz NOT NULL DEFAULT now(),
  resposta       text,
  respondida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  respondida_em  timestamptz,
  conclusao      text CHECK (conclusao IS NULL OR conclusao IN ('conforme','nao_conforme')),
  parecer        text,
  encerrada_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  encerrada_em   timestamptz,
  status         text NOT NULL DEFAULT 'aberta'
                   CHECK (status IN ('aberta','respondida','encerrada')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auditoria_revisoes IS
  'Questionamento do Comite de Auditoria sobre uma linha de historico_operacoes. Nao conformidade vira tarefa.';

-- Uma conversa por operação enquanto não encerra.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_revisao_operacao_aberta
  ON public.auditoria_revisoes (operacao_id)
  WHERE status <> 'encerrada';

CREATE INDEX IF NOT EXISTS idx_revisao_status ON public.auditoria_revisoes (status, filial);

-- ── 3. RLS ────────────────────────────────────────────────────────
ALTER TABLE public.auditoria_revisoes ENABLE ROW LEVEL SECURITY;

-- Espelha a régua da trilha: quem responde pela unidade enxerga; a Matriz
-- (admin/CEO/conselheiro) enxerga tudo, porque auth_pode_filial já abre.
DROP POLICY IF EXISTS revisao_read ON public.auditoria_revisoes;
CREATE POLICY revisao_read ON public.auditoria_revisoes
  FOR SELECT TO authenticated
  USING (filial IS NULL OR COALESCE(auth_pode_filial(filial), false));

-- Escrita só por RPC: as três transições têm regra de papel e de estado.

-- ── 4. Abrir questionamento (só Conselho) ─────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_revisao_auditoria(
  p_operacao_id    uuid,
  p_questionamento text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_op historico_operacoes;
  v_id uuid;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Comitê de Auditoria abre questionamento.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_questionamento), '') = '' THEN
    RAISE EXCEPTION 'Escreva o questionamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_op FROM historico_operacoes WHERE id = p_operacao_id;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'Operação não encontrada na trilha.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM auditoria_revisoes
              WHERE operacao_id = p_operacao_id AND status <> 'encerrada') THEN
    RAISE EXCEPTION 'Já existe uma revisão aberta para esta operação.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO auditoria_revisoes (operacao_id, filial, questionamento, aberta_por)
  VALUES (p_operacao_id, v_op.filial, p_questionamento, auth.uid())
  RETURNING id INTO v_id;

  -- Vai para o setor de quem praticou o ato: é quem sabe explicar.
  -- `ator_setor` pode ser NULL em linha antiga; cai em 'empresa', que todo
  -- mundo enxerga, em vez de a notificação sumir.
  PERFORM notificar_setor(
    p_setor     => COALESCE(NULLIF(v_op.ator_setor, ''), 'empresa'),
    p_tipo      => 'aprovacao_pendente',
    p_titulo    => 'Auditoria questionou uma operação',
    p_mensagem  => format('%s em %s: %s', v_op.evento, v_op.entidade, p_questionamento),
    -- Rota top-level, irmã de 'auditoria': o comitê não é submenu de
    -- Financeiro — fiscaliza a operação inteira, não só o dinheiro.
    p_link_view => 'comite-auditoria',
    p_ref_id    => v_id,
    p_filial    => v_op.filial);

  RETURN jsonb_build_object('sucesso', true, 'revisao_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.abrir_revisao_auditoria(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_revisao_auditoria(uuid,text) TO authenticated;

-- ── 5. Responder ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.responder_revisao_auditoria(
  p_revisao_id uuid,
  p_resposta   text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_r auditoria_revisoes;
BEGIN
  SELECT * INTO v_r FROM auditoria_revisoes WHERE id = p_revisao_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Revisão não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_r.status = 'encerrada' THEN
    RAISE EXCEPTION 'Revisão já encerrada.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(auth_pode_filial(COALESCE(v_r.filial, auth_user_filial())), false) THEN
    RAISE EXCEPTION 'Você não responde por esta unidade.' USING ERRCODE = '42501';
  END IF;

  -- Quem pergunta não responde. Auditor que responde a própria pergunta
  -- não auditou nada.
  IF v_r.aberta_por = auth.uid() THEN
    RAISE EXCEPTION 'Você abriu este questionamento — a resposta é de quem praticou o ato.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_resposta), '') = '' THEN
    RAISE EXCEPTION 'Escreva a resposta.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE auditoria_revisoes
     SET resposta = p_resposta, respondida_por = auth.uid(),
         respondida_em = now(), status = 'respondida'
   WHERE id = p_revisao_id;

  RETURN jsonb_build_object('sucesso', true, 'status', 'respondida');
END;
$$;

REVOKE ALL ON FUNCTION public.responder_revisao_auditoria(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_revisao_auditoria(uuid,text) TO authenticated;

-- ── 6. Encerrar (só Conselho) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encerrar_revisao_auditoria(
  p_revisao_id uuid,
  p_conclusao  text,
  p_parecer    text DEFAULT NULL,
  p_prazo_acao date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_r       auditoria_revisoes;
  v_op      historico_operacoes;
  v_tarefas int := 0;
BEGIN
  IF NOT COALESCE(auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Só o Comitê de Auditoria encerra a revisão.' USING ERRCODE = '42501';
  END IF;

  IF p_conclusao NOT IN ('conforme','nao_conforme') THEN
    RAISE EXCEPTION 'Conclusão inválida: %.', p_conclusao USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_r FROM auditoria_revisoes WHERE id = p_revisao_id;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Revisão não encontrada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_r.status = 'encerrada' THEN
    RAISE EXCEPTION 'Revisão já encerrada.' USING ERRCODE = 'P0001';
  END IF;

  -- Não conformidade sem prazo é laudo sem efeito.
  IF p_conclusao = 'nao_conforme' AND p_prazo_acao IS NULL THEN
    RAISE EXCEPTION 'Não conformidade exige prazo de correção.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_op FROM historico_operacoes WHERE id = v_r.operacao_id;

  IF p_conclusao = 'nao_conforme' THEN
    INSERT INTO tarefas (modulo, titulo, descricao, prioridade, prazo, filial, origem, criado_por, nome_criador)
    VALUES ('governanca',
            format('Não conformidade — %s em %s', COALESCE(v_op.evento,'operação'), COALESCE(v_op.entidade,'—')),
            COALESCE(p_parecer, v_r.questionamento),
            'Alta',
            p_prazo_acao,
            COALESCE(v_r.filial, 'Matriz'),
            'auditoria',
            auth.uid(),
            'Comitê de Auditoria');
    v_tarefas := 1;
  END IF;

  UPDATE auditoria_revisoes
     SET conclusao = p_conclusao, parecer = p_parecer,
         encerrada_por = auth.uid(), encerrada_em = now(), status = 'encerrada'
   WHERE id = p_revisao_id;

  RETURN jsonb_build_object(
    'sucesso', true, 'conclusao', p_conclusao, 'tarefas_geradas', v_tarefas);
END;
$$;

REVOKE ALL ON FUNCTION public.encerrar_revisao_auditoria(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encerrar_revisao_auditoria(uuid,text,text,date) TO authenticated;

-- ── 7. Realtime ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'auditoria_revisoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auditoria_revisoes;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ────────────────────────────────────────────────────────────────────────────
-- 1) origem de tarefas com os 4 valores (a 379 pôs 3):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid='public.tarefas'::regclass AND conname='chk_tarefas_origem';
--
-- 2) anon fora das RPCs novas:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('abrir_revisao_auditoria','responder_revisao_auditoria',
--                      'encerrar_revisao_auditoria');
-- Esperado: false nas três.
--
-- 3) Fim a fim: conselheiro abre questionamento sobre uma linha da trilha.
--    O gerente da unidade responde (o próprio conselheiro não consegue).
--    Conselheiro encerra como 'nao_conforme' com prazo — deve devolver
--    tarefas_geradas = 1:
-- SELECT titulo, prazo, filial, origem FROM tarefas WHERE origem='auditoria';
