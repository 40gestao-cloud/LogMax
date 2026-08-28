-- O professor manda a turma recarregar, da máquina dele.
--
-- Pedido de 28/08: "dá para o admin forçar o Ctrl+Shift+R em todas as máquinas
-- a partir da dele?". Dá — e o comando remoto faz mais do que a tecla: o que
-- costuma emperrar aqui não é o cache HTTP da aba, é o service worker da PWA
-- servindo os arquivos que ele guardou. O cliente que recebe este comando apaga
-- os caches, desregistra o SW e só então recarrega.
--
-- A carona é a mesma dos alarmes da aula (migr. 529): uma linha nova numa
-- tabela pequena, realtime avisando todo mundo, e o `App.tsx` reagindo em
-- qualquer tela. Não é broadcast puro de propósito — a linha fica gravada, e
-- assim a máquina que estava fechada obedece ao abrir, dentro da validade.
--
-- Decisões que valem comentário:
--
-- - **Quem manda é `role = 'admin'` literal.** `auth_is_admin()` inclui CEO e
--   conselheiro, que aqui são alunos: recarregar a tela da turma inteira é
--   ferramenta de condução de aula, não de papel de negócio. Mesmo critério do
--   cofre de senhas (migr. 409).
--
-- - **Todo mundo LÊ.** O aluno precisa receber o comando; é isso ou nada
--   acontece na máquina dele. A linha não tem conteúdo sensível: diz que houve
--   um pedido de recarga, quem pediu e quando.
--
-- - **Validade é do cliente, não do banco.** O front ignora comando com mais de
--   30 min (constante em `src/lib/comandosTurma.ts`). Assim a máquina que ficou
--   desligada não recarrega sozinha no dia seguinte por causa da aula de hoje,
--   e ninguém precisa de rotina de limpeza aqui.

BEGIN;

CREATE TABLE IF NOT EXISTS public.comandos_turma (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             text NOT NULL DEFAULT 'recarregar',
  motivo           text,
  emitido_por      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  emitido_por_nome text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comandos_turma_tipo_chk CHECK (tipo IN ('recarregar'))
);

COMMENT ON TABLE public.comandos_turma IS
  'Comandos que o professor dispara para todas as máquinas da turma. Hoje só "recarregar" (limpa cache do PWA e recarrega). Escrita só role=admin literal; leitura por todos, porque é o aluno quem obedece.';

CREATE INDEX IF NOT EXISTS idx_comandos_turma_created_at
  ON public.comandos_turma (created_at DESC);

ALTER TABLE public.comandos_turma ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comandos_turma_leitura ON public.comandos_turma;
CREATE POLICY comandos_turma_leitura
  ON public.comandos_turma
  FOR SELECT TO authenticated
  USING (true);

-- `COALESCE(..., false)`: sem perfil, `auth_user_role()` devolve NULL e o
-- predicado inteiro viraria NULL — o guarda sumiria em vez de barrar
-- (migr. 495-497).
DROP POLICY IF EXISTS comandos_turma_escrita_admin ON public.comandos_turma;
CREATE POLICY comandos_turma_escrita_admin
  ON public.comandos_turma
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(public.auth_user_role() = 'admin', false)
    AND emitido_por = auth.uid()
  );

REVOKE ALL ON TABLE public.comandos_turma FROM anon;
GRANT SELECT, INSERT ON TABLE public.comandos_turma TO authenticated;

-- Sem isto o INSERT acontece e ninguém fica sabendo: realtime só entrega o que
-- está na publicação (a mesma pegadinha da migr. 529).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'comandos_turma'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comandos_turma;
  END IF;
END $$;

COMMIT;
