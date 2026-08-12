-- 404_20260811_a_ciencia_da_atividade_tambem_chega_ao_vivo.sql
--
-- A migr. 403 publicou `aula_atividades` no realtime: o professor envia e o
-- enunciado aparece na turma sem F5. Faltou o caminho de volta.
--
-- O painel de acompanhamento (Modo Aula → Atividades publicadas) conta quem já
-- abriu o enunciado, por filial. Sem esta publicação, essa contagem só mexe
-- quando o professor clica em «Atualizar» — e quem está conduzindo a aula, com
-- a tela projetada, não fica clicando em Atualizar para descobrir que a
-- MaxLook ainda não abriu.
--
-- Só publicação: a RLS da 403 já recorta o que cada um enxerga
-- (`aula_ativ_ciencia_read` — admin/CEO veem a turma, o aluno vê a própria
-- linha), e o realtime respeita a mesma política. Nada a mudar ali.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'aula_atividades_ciencia'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.aula_atividades_ciencia;
  END IF;
END $$;

-- =================================================================
-- VERIFICAÇÃO
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename LIKE 'aula_%';
--   -- esperado: aula_config, aula_atividades, aula_atividades_ciencia
-- =================================================================
