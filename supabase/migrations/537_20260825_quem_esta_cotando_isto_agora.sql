-- 537 — Quem está cotando isto agora, e quem está cadastrando aquilo.
--
-- A segunda preocupação, direta do usuário: "quando um aluno tiver fazendo
-- uma cotação, ao selecionar o produto, outro aluno já não deve poder
-- selecionar o mesmo produto. Se um aluno tiver cadastrando um produto, ao
-- selecionar o produto, outro aluno já não deve poder fazer do mesmo."
--
-- A migr. 481 já resolveu exatamente este problema para o número do código de
-- produto — dois alunos clicando "Gerar" ao mesmo tempo. Esta migração
-- generaliza o mesmo desenho (tabela de reserva com dono e prazo, advisory
-- lock, limpeza do vencido embutida na própria RPC) para dois casos novos:
--
--   1. Cotação: reserva por REQUISIÇÃO + FORNECEDOR, não por requisição
--      inteira. A tela existe para comparar preços de fornecedores
--      diferentes na mesma requisição (o botão "comparar propostas", e a
--      regra "Cotação única" da migr. 471/534, cobram exatamente isso) —
--      travar a requisição inteira mataria a comparação. Travar a dupla
--      impede o que sobra: dois alunos cotando o MESMO fornecedor para o
--      MESMO item, que é trabalho repetido, não comparação.
--   2. Cadastro de produto: reserva por ORIGEM DE COMPRA — a requisição
--      esperando pedido (migr. 494) ou a descrição do item já recebido
--      (migr. 480). É o momento exato que o usuário descreveu: escolher a
--      origem no `SelectBusca` de Cadastros > Produtos.
--
-- ─── PRAZO CURTO, DE PROPÓSITO DIFERENTE DA 481 ────────────────────────────
--
-- A reserva de código (481) dura 30 minutos porque soltar cedo custa caro:
-- queima um número do catálogo. Aqui é o oposto — a reserva só marca "estou
-- trabalhando nisto AGORA", e um aluno preenchendo cotação ou cadastro passa
-- minutos na tela. Prazo de 3 minutos, renovado a cada 60s pelo hook
-- enquanto a tela está aberta: quem fecha a aba solta a vaga rápido, sem
-- travar a sala esperando meia hora.
--
-- ─── POR QUE UMA TABELA SÓ PARA OS DOIS CASOS ──────────────────────────────
--
-- `escopo` distingue ('cotacao' | 'cadastro_produto'); a chave é texto livre
-- porque a origem do cadastro nem sempre é um uuid (o grupo "já chegou e não
-- está no catálogo" da ProdutosView é indexado pela DESCRIÇÃO do item, não
-- por id — não existe linha de banco para esse grupo). Uma tabela genérica
-- evita duas tabelas quase idênticas e deixa o professor com um único lugar
-- para ver e soltar reserva presa (a aba Cadeia, migr. 533/536).
--
-- ─── QUEM PODE SOLTAR ───────────────────────────────────────────────────────
--
-- O dono (fechou a tela, mudou de ideia) ou o professor (`role='admin'`
-- literal, mesma régua da 471/477/533) — nunca outro aluno: soltar a reserva
-- alheia recriaria a corrida que esta migração existe para fechar.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.trabalho_reservas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo      text NOT NULL CHECK (escopo IN ('cotacao', 'cadastro_produto')),
  chave       text NOT NULL,
  filial      text NOT NULL,
  usuario_id  uuid,
  -- Desnormalizado de propósito: quem vê o cadeado do colega não consegue ler
  -- o nome dele em `user_profiles` pela RLS comum, e "reservado por alguém"
  -- não ajuda ninguém a decidir se espera ou troca de fornecedor.
  usuario_nome text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL DEFAULT now() + interval '3 minutes'
);

COMMENT ON TABLE public.trabalho_reservas IS
  'Cadeado de "estou trabalhando nisto agora" — cotação (requisição+fornecedor) '
  'e cadastro de produto (origem de compra). Prazo curto (3min, renovado pelo '
  'hook), some sozinha se a aba fechar. Só as RPCs reservar_trabalho/'
  'renovar_trabalho/liberar_trabalho tocam nela. Migr. 537.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_trabalho_reservas_escopo_chave
  ON public.trabalho_reservas (escopo, chave);
CREATE INDEX IF NOT EXISTS idx_trabalho_reservas_expira
  ON public.trabalho_reservas (expira_em);
CREATE INDEX IF NOT EXISTS idx_trabalho_reservas_filial
  ON public.trabalho_reservas (filial);

ALTER TABLE public.trabalho_reservas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trabalho_reservas FROM PUBLIC, anon;
GRANT ALL ON TABLE public.trabalho_reservas TO service_role;

-- Leitura liberada pra quem tem a filial: é o que pinta o cadeado do colega
-- na tela ANTES do clique, não só no erro depois. Escrita fica só nas RPCs
-- (nenhuma policy INSERT/UPDATE/DELETE abaixo).
-- DROP antes: `CREATE POLICY` não tem `IF NOT EXISTS`, e sem isto a migração
-- quebra com 42710 na segunda aplicação — justamente o que o cabeçalho promete
-- que não acontece.
DROP POLICY IF EXISTS trabalho_reservas_select ON public.trabalho_reservas;
CREATE POLICY trabalho_reservas_select ON public.trabalho_reservas
  FOR SELECT TO authenticated
  USING (COALESCE(public.auth_pode_filial(filial), false));
GRANT SELECT ON TABLE public.trabalho_reservas TO authenticated;

-- ─── Reservar ───────────────────────────────────────────────────────────────
-- Idempotente para o dono: chamar de novo com a mesma chave RENOVA (é o que o
-- hook faz a cada 60s). Chamar com chave já reservada por OUTRO usuário não
-- dá erro — devolve o dono atual, e a tela decide se mostra travado ou deixa
-- o Salvar tentar (que aí sim recusa, no INSERT/RPC de destino).
CREATE OR REPLACE FUNCTION public.reservar_trabalho(
  p_escopo text, p_chave text, p_filial text
)
RETURNS TABLE (usuario_id uuid, usuario_nome text, minha boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Você não trabalha nesta unidade.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('trabalho_reservas'), hashtext(p_escopo || ':' || p_chave));

  -- Varre TODO o vencido, não só o desta chave.
  --
  -- Limpar apenas a própria chave (como faz a migr. 481, onde o custo de
  -- deixar lixo é zero) tem consequência aqui: quem lê a tabela para pintar
  -- o cadeado na tela enxergaria reserva morta há horas e travaria uma opção
  -- que o banco liberaria na hora. Um aluno fechando o notebook trancaria
  -- aquele fornecedor pelo resto do curso. A tabela é pequena (uma linha por
  -- pessoa trabalhando) e a varredura roda dentro do advisory lock, então
  -- custa nada e evita depender de cron.
  DELETE FROM public.trabalho_reservas WHERE expira_em <= now();

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  INSERT INTO public.trabalho_reservas (escopo, chave, filial, usuario_id, usuario_nome)
  VALUES (p_escopo, p_chave, p_filial, auth.uid(), COALESCE(v_nome, 'Alguém'))
  ON CONFLICT (escopo, chave) DO UPDATE
    SET usuario_id   = CASE WHEN public.trabalho_reservas.usuario_id = auth.uid()
                             THEN EXCLUDED.usuario_id ELSE public.trabalho_reservas.usuario_id END,
        usuario_nome = CASE WHEN public.trabalho_reservas.usuario_id = auth.uid()
                             THEN EXCLUDED.usuario_nome ELSE public.trabalho_reservas.usuario_nome END,
        expira_em    = CASE WHEN public.trabalho_reservas.usuario_id = auth.uid()
                             THEN EXCLUDED.expira_em ELSE public.trabalho_reservas.expira_em END;

  -- COALESCE: linha com `usuario_id` nulo (só service_role cria) devolveria
  -- `minha = NULL`, e a tela lê NULL como "é de outro" — cadeado sem dono,
  -- que ninguém consegue soltar. NULL não vira permissão nem vira bloqueio.
  RETURN QUERY
  SELECT r.usuario_id, r.usuario_nome, COALESCE(r.usuario_id = auth.uid(), false)
    FROM public.trabalho_reservas r
   WHERE r.escopo = p_escopo AND r.chave = p_chave;
END;
$function$;

-- ─── Renovar ────────────────────────────────────────────────────────────────
-- Batimento do hook (a cada 60s) enquanto a tela segue aberta. Só estende o
-- prazo de quem já é dono — chamar sobre reserva alheia não faz nada.
CREATE OR REPLACE FUNCTION public.renovar_trabalho(p_escopo text, p_chave text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();

  UPDATE public.trabalho_reservas
     SET expira_em = now() + interval '3 minutes'
   WHERE escopo = p_escopo AND chave = p_chave AND usuario_id = auth.uid();
END;
$function$;

-- ─── Liberar ────────────────────────────────────────────────────────────────
-- Chamada ao salvar (a reserva virou dado de verdade e não serve mais), ao
-- fechar o formulário sem salvar, ou no unmount do hook. Só o dono solta.
CREATE OR REPLACE FUNCTION public.liberar_trabalho(p_escopo text, p_chave text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_rpc();

  DELETE FROM public.trabalho_reservas
   WHERE escopo = p_escopo AND chave = p_chave AND usuario_id = auth.uid();
END;
$function$;

-- ─── Liberar (professor) ────────────────────────────────────────────────────
-- Para quando a reserva fica presa de verdade (notebook fechado antes do
-- prazo vencer, rede caiu) e alguém precisa da vaga antes dos 3 minutos. Só o
-- professor — `role='admin'` literal, mesma régua da 471/477/533.
CREATE OR REPLACE FUNCTION public.liberar_trabalho_forcado(p_escopo text, p_chave text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Apenas o professor (admin) solta a reserva de outro aluno.'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.trabalho_reservas WHERE escopo = p_escopo AND chave = p_chave;
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_trabalho(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renovar_trabalho(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.liberar_trabalho(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.liberar_trabalho_forcado(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_trabalho(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renovar_trabalho(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_trabalho(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_trabalho_forcado(text, text) TO authenticated;

-- Realtime: o cadeado do colega precisa aparecer sem F5. Nome fixo por
-- instância no hook (feedback_canal_realtime_nome_fixo) — dois componentes
-- montados ao mesmo tempo não podem competir pelo mesmo nome de canal.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'trabalho_reservas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trabalho_reservas;
  END IF;
END $do$;

COMMIT;

-- Verificação:
--
--   -- Reservar (autenticado como aluno da filial):
--   SELECT * FROM reservar_trabalho('cotacao', '<req_id>:<fornecedor_id>', 'SuperMax');
--
--   -- Chamar de novo (mesmo usuário) renova e devolve minha=true; outro
--   -- usuário na mesma chave recebe minha=false com o nome do dono.
--
--   -- Professor solta reserva presa:
--   SELECT liberar_trabalho_forcado('cotacao', '<req_id>:<fornecedor_id>');
