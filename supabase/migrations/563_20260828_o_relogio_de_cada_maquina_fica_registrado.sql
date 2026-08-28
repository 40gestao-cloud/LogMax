-- O relógio de cada máquina passa a ficar registrado.
--
-- Contexto (28/08): a turma reclamou de "entro e volto para a tela de login".
-- Os `edge_logs` mostraram 796 chamadas a /auth/v1/token numa hora, todas com
-- status 200, todas do IP do laboratório — nenhuma sessão de outro IP passou de
-- 2 renovações no mesmo dia. Renovação que responde 200 é servidor entregando
-- token novo de boa vontade: quem insistia era o cliente, porque o `auth-js`
-- compara o `exp` do token (tempo absoluto do servidor) com o `Date.now()` da
-- máquina. Relógio adiantado além de ~59 min ⇒ todo token nasce vencido ⇒ laço
-- de renovação ⇒ estoura o limite por IP ⇒ cai a sessão de todo mundo naquela
-- rede, inclusive de quem está com a hora certa.
--
-- O app já parou de depender desse relógio (`src/lib/horaServidor.ts` ancora o
-- `Date` no servidor). O que faltava era o professor CONSEGUIR VER quais
-- estações estão fora de hora, sem depender de aluno relatando sintoma — é o
-- que esta tabela guarda, uma linha por máquina, alimentada pela própria
-- medição que o app já faz no boot.
--
-- Desenho:
--
-- - A chave é um id sorteado no navegador e guardado no `localStorage` da
--   estação. Não identifica pessoa: identifica o computador, que é a unidade em
--   que o defeito acontece. Limpar dados do navegador cria uma linha nova — o
--   custo de errar por excesso aqui é uma linha órfã, e o de errar por falta
--   seria juntar duas máquinas na mesma.
--
-- - Escrita só pela RPC `registrar_relogio_maquina` (SECURITY DEFINER). A
--   tabela não ganha policy de INSERT/UPDATE: aluno nenhum precisa escrever
--   nela diretamente, e o carimbo de quem estava na máquina sai de `auth.uid()`
--   no servidor, não de argumento que o cliente pudesse forjar.
--
-- - Leitura só para a Matriz (`auth_is_admin()` = admin/CEO/conselheiro).
--   `COALESCE(..., false)`: sem perfil a função devolve NULL e o predicado
--   sumiria — a armadilha da migr. 495-497.
--
-- - `offset_ms` é bigint, não integer: integer estoura em 24 dias de desvio, e
--   máquina com o ANO errado é caso real em laboratório.

BEGIN;

-- ── 1) A tabela ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ti_relogio_maquinas (
  maquina_id        text PRIMARY KEY,
  offset_ms         bigint      NOT NULL,
  medido_em         timestamptz NOT NULL DEFAULT now(),
  ultimo_usuario_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ultimo_usuario    text,
  filial            text,
  navegador         text,
  plataforma        text,
  compartilhada     boolean,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ti_relogio_maquinas IS
  'Diagnóstico de relógio por estação (Sessões Gerais → Tecnologia da Informação). Uma linha por máquina; escrita só via registrar_relogio_maquina().';
COMMENT ON COLUMN public.ti_relogio_maquinas.maquina_id IS
  'Id sorteado no navegador e guardado no localStorage da estação. Identifica o computador, não a pessoa.';
COMMENT ON COLUMN public.ti_relogio_maquinas.offset_ms IS
  'Quanto é preciso somar ao relógio da máquina para chegar no do servidor. Negativo = máquina ADIANTADA (é o caso que derruba a sessão).';
COMMENT ON COLUMN public.ti_relogio_maquinas.compartilhada IS
  'Heurística do sessaoGuard: true = estação de laboratório (ponteiro fino), false = dispositivo pessoal.';

-- Ordenação da tela: pior desvio primeiro, e "quem não aparece há dias".
CREATE INDEX IF NOT EXISTS idx_ti_relogio_medido_em
  ON public.ti_relogio_maquinas (medido_em DESC);

-- ── 2) RLS: a Matriz lê, ninguém escreve direto ─────────────────────────────
ALTER TABLE public.ti_relogio_maquinas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ti_relogio_leitura_matriz ON public.ti_relogio_maquinas;
CREATE POLICY ti_relogio_leitura_matriz
  ON public.ti_relogio_maquinas
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_is_admin(), false));

-- Tabela nova nasce com GRANT para anon no Supabase; aqui isso seria expor o
-- parque de máquinas a quem nem logou.
REVOKE ALL ON TABLE public.ti_relogio_maquinas FROM anon;
GRANT SELECT ON TABLE public.ti_relogio_maquinas TO authenticated;

-- ── 3) A RPC que registra ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_relogio_maquina(
  p_maquina_id    text,
  p_offset_ms     bigint,
  p_navegador     text    DEFAULT NULL,
  p_plataforma    text    DEFAULT NULL,
  p_compartilhada boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome   text;
  v_filial text;
BEGIN
  -- Sem sessão não há o que registrar. `IF NOT ... IS NULL` seria NULL-safe
  -- pela negativa; aqui a checagem é direta de propósito.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão ausente.' USING ERRCODE = '42501';
  END IF;

  IF p_maquina_id IS NULL OR length(p_maquina_id) NOT BETWEEN 8 AND 64 THEN
    RAISE EXCEPTION 'Identificador de máquina inválido.' USING ERRCODE = '22023';
  END IF;

  -- ~10 anos. Acima disso não é relógio errado, é lixo — e sujaria a tela.
  IF p_offset_ms IS NULL OR abs(p_offset_ms) > 315360000000 THEN
    RAISE EXCEPTION 'Desvio fora de faixa.' USING ERRCODE = '22023';
  END IF;

  SELECT nome, filial INTO v_nome, v_filial
    FROM public.user_profiles
   WHERE id = auth.uid();

  INSERT INTO public.ti_relogio_maquinas AS t (
    maquina_id, offset_ms, medido_em,
    ultimo_usuario_id, ultimo_usuario, filial,
    navegador, plataforma, compartilhada
  ) VALUES (
    p_maquina_id, p_offset_ms, now(),
    auth.uid(), v_nome, v_filial,
    left(p_navegador, 120), left(p_plataforma, 120), p_compartilhada
  )
  ON CONFLICT (maquina_id) DO UPDATE SET
    offset_ms         = EXCLUDED.offset_ms,
    medido_em         = EXCLUDED.medido_em,
    ultimo_usuario_id = EXCLUDED.ultimo_usuario_id,
    ultimo_usuario    = EXCLUDED.ultimo_usuario,
    filial            = EXCLUDED.filial,
    -- Navegador/plataforma só são sobrescritos quando vieram preenchidos: uma
    -- chamada mais pobre não apaga o que já se sabia da estação.
    navegador         = COALESCE(EXCLUDED.navegador, t.navegador),
    plataforma        = COALESCE(EXCLUDED.plataforma, t.plataforma),
    compartilhada     = COALESCE(EXCLUDED.compartilhada, t.compartilhada);
END;
$function$;

-- RPC nova nasce executável pelo anon: revogar nominalmente (migr. anteriores
-- documentam o mesmo cuidado).
REVOKE ALL ON FUNCTION public.registrar_relogio_maquina(text, bigint, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_relogio_maquina(text, bigint, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_relogio_maquina(text, bigint, text, text, boolean) TO authenticated;

COMMIT;

-- PostgREST só enxerga a RPC depois de recarregar o cache do schema.
NOTIFY pgrst, 'reload schema';
