-- 690 — Gerente Assistente e Head de Comunicação.
--
-- Pedido do usuário (2026-10-09). As duas são FUNÇÕES sobre o perfil, não
-- papéis: o papel é único (colaborador/gerente/...) e a pessoa continua no
-- setor dela. Precedente: `is_conselheiro` (gerente que também é conselho).
--
-- Gerente Assistente — colaborador de qualquer setor, 1 por filial, "braço
--   direito" do gerente: vê e opera a filial como a gerência, decide o que o
--   gerente decide, MENOS (a) o que ele mesmo abriu e (b) o que é reservado ao
--   titular: pessoas (funcionários, folha, férias, ponto, desligamento,
--   avaliações, vagas, metas individuais), capital/empréstimo/aplicação,
--   investimentos e patrimônio da filial, competição e votações, Mesa do Gestor.
--   Cada decisão dele avisa o gerente (aprendizado + prestação de contas).
-- Head de Comunicação — colaborador ou gerente, 1 por filial, escopo da
--   própria filial: recebe o setor Marketing e aprova o conteúdo (migr. 691).
--
-- Desenho:
--  1. user_profiles.gerente_assistente / head_comunicacao + regras + 1 por
--     filial + normalização (mudou de papel ou de filial, perde a função) +
--     anti-privesc (feedback_privesc_coluna_nova).
--  2. Helpers: auth_e_gerencia(), auth_e_gerente_assistente(),
--     auth_gerente_titular_da(filial), auth_head_comunicacao_da(filial).
--     auth_gerente_da(filial) passa a ser GERÊNCIA (titular + assistente) —
--     quase todos os ~50 usos são operação; os de pessoas/estratégia trocam
--     para auth_gerente_titular_da (item 4).
--  3. auth_user_setores(): assistente ganha os setores operacionais do gerente
--     SEM rh (logistica, vendas, financeiro, marketing, ti); Head ganha
--     marketing. É o que faz ~as policies por setor e o hasSetor da tela
--     funcionarem sem tocar uma a uma.
--  4. Policies: nas tabelas de OPERAÇÃO, o ramo literal "role = gerente"
--     vira auth_e_gerencia(). As de pessoas/estratégia ficam como estão (só o
--     titular). filiais_* e curriculos_read passam a auth_gerente_titular_da.
--  5. Gatilho em historico_operacoes: decisão (Aprovado/Negado/Reprovado/
--     Liberado, ou reabrir caixa) do assistente sobre documento que ELE abriu
--     é recusada (o erro desfaz a operação); toda decisão dele avisa o setor
--     'gerencia' da filial — que é o do gerente titular.

-- ── 1 ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS gerente_assistente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS head_comunicacao   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.gerente_assistente IS
  'Migr. 690: colaborador que é o Gerente Assistente da filial (1 por filial). Não decide o que abriu; pessoas/capital ficam com o titular.';
COMMENT ON COLUMN public.user_profiles.head_comunicacao IS
  'Migr. 690: Head de Comunicação da filial (1 por filial). Recebe o setor marketing e aprova conteúdo (691).';

-- Mudou de papel ou de unidade: a função não vai junto. Roda antes das CHECKs.
CREATE OR REPLACE FUNCTION public.fn_user_profile_funcoes_normaliza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM 'colaborador' THEN
    NEW.gerente_assistente := false;
  END IF;
  IF NEW.role NOT IN ('colaborador', 'gerente') THEN
    NEW.head_comunicacao := false;
  END IF;
  IF NEW.filial IS NULL OR NEW.filial = 'Matriz'
     OR (TG_OP = 'UPDATE' AND NEW.filial IS DISTINCT FROM OLD.filial) THEN
    NEW.gerente_assistente := false;
    NEW.head_comunicacao   := false;
  END IF;
  IF NEW.desligado_em IS NOT NULL THEN
    NEW.gerente_assistente := false;
    NEW.head_comunicacao   := false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_user_profile_funcoes_normaliza ON public.user_profiles;
CREATE TRIGGER trg_user_profile_funcoes_normaliza
  BEFORE INSERT OR UPDATE OF role, filial, desligado_em, gerente_assistente, head_comunicacao
  ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_user_profile_funcoes_normaliza();

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS chk_gerente_assistente_colaborador;
ALTER TABLE public.user_profiles ADD CONSTRAINT chk_gerente_assistente_colaborador
  CHECK (NOT gerente_assistente OR (role = 'colaborador' AND filial IS NOT NULL AND filial <> 'Matriz'));
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS chk_head_comunicacao_papel;
ALTER TABLE public.user_profiles ADD CONSTRAINT chk_head_comunicacao_papel
  CHECK (NOT head_comunicacao OR (role IN ('colaborador', 'gerente') AND filial IS NOT NULL AND filial <> 'Matriz'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_gerente_assistente_por_filial
  ON public.user_profiles (filial) WHERE gerente_assistente;
CREATE UNIQUE INDEX IF NOT EXISTS uq_head_comunicacao_por_filial
  ON public.user_profiles (filial) WHERE head_comunicacao;

-- Anti-privesc: as duas colunas decidem acesso.
DO $mig$
DECLARE
  v_def text;
  v_old text := $o$  IF NEW.pode_acessar_usuarios IS DISTINCT FROM OLD.pode_acessar_usuarios THEN$o$;
  v_new text := $n$  -- MIGR 690: funções de Gerente Assistente e Head de Comunicação. Só
  -- GANHAR é barrado: perder (desligamento, troca de papel ou de unidade —
  -- fn_user_profile_funcoes_normaliza) nunca é escalada de privilégio.
  IF (NEW.gerente_assistente AND NOT COALESCE(OLD.gerente_assistente, false))
     OR (NEW.head_comunicacao AND NOT COALESCE(OLD.head_comunicacao, false)) THEN
    RAISE EXCEPTION 'Gerente Assistente e Head de Comunicação são definidos em Usuários (gerente titular, CEO ou admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pode_acessar_usuarios IS DISTINCT FROM OLD.pode_acessar_usuarios THEN$n$;
BEGIN
  v_def := replace(pg_get_functiondef('public.user_profiles_bloquear_privesc()'::regprocedure), E'\r', '');
  IF position('MIGR 690' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'user_profiles_bloquear_privesc: trecho-âncora não encontrado';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- ── 2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_e_gerente_assistente()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT u.gerente_assistente AND u.role = 'colaborador'
                     FROM public.user_profiles u
                    WHERE u.id = auth.uid() AND u.desligado_em IS NULL), false);
$$;

CREATE OR REPLACE FUNCTION public.auth_e_gerencia()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT u.role = 'gerente' OR (u.role = 'colaborador' AND u.gerente_assistente)
                     FROM public.user_profiles u
                    WHERE u.id = auth.uid() AND u.desligado_em IS NULL), false);
$$;

CREATE OR REPLACE FUNCTION public.auth_gerente_titular_da(p_filial text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth_user_role() = 'gerente' AND auth_user_filial() = p_filial;
$$;

-- MIGR 690: gerência da filial = gerente titular OU o Gerente Assistente.
CREATE OR REPLACE FUNCTION public.auth_gerente_da(p_filial text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.auth_e_gerencia() AND auth_user_filial() = p_filial;
$$;

CREATE OR REPLACE FUNCTION public.auth_head_comunicacao_da(p_filial text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT u.head_comunicacao AND u.filial = p_filial
                     FROM public.user_profiles u
                    WHERE u.id = auth.uid() AND u.desligado_em IS NULL), false);
$$;

-- Mesma régua dos auth_* existentes: as policies os chamam em qualquer
-- consulta, inclusive anônima (devolvem false sem auth.uid()). Sem o EXECUTE
-- para anon, a vitrine pública cairia em "permission denied" na RLS.
GRANT EXECUTE ON FUNCTION public.auth_e_gerente_assistente() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_e_gerencia() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_gerente_titular_da(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_head_comunicacao_da(text) TO anon, authenticated;

-- ── 3 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_user_setores()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT ARRAY[u.setor]
             || COALESCE(u.setores_extras, ARRAY[]::text[])
             || public.auth_aula_setores()
             -- MIGR 690: o assistente opera a filial como a gerência, sem RH.
             || CASE WHEN u.role = 'colaborador' AND u.gerente_assistente
                     THEN ARRAY['logistica', 'vendas', 'financeiro', 'marketing', 'ti']::text[]
                     ELSE ARRAY[]::text[] END
             -- MIGR 690: o Head de Comunicação é do Marketing da filial.
             || CASE WHEN u.head_comunicacao THEN ARRAY['marketing']::text[] ELSE ARRAY[]::text[] END
        FROM public.user_profiles u
       WHERE u.id = auth.uid() AND u.desligado_em IS NULL
    ),
    ARRAY[]::text[]
  );
$function$;

-- ── 4 ──────────────────────────────────────────────────────────────────────
-- 4a. Funções de pessoas/estratégia: só o titular.
DO $mig$
DECLARE
  v_fn  text;
  v_oid oid;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    '_assert_recrutamento', 'desempenho_funcionarios', 'ferias_decisao_guard',
    'registrar_ponto_manual', 'solicitar_desligamento',
    'lancar_investimento_filial', 'gerar_contas_da_montagem', 'desvincular_investimento_conta',
    'aplicar_em_banco', 'resgatar_aplicacao', 'antecipar_parcela_emprestimo', 'vender_patrimonio'
  ] LOOP
    FOR v_oid IN SELECT p.oid FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn LOOP
      v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
      IF position('auth_gerente_da(' IN v_def) > 0 THEN
        EXECUTE replace(v_def, 'auth_gerente_da(', 'auth_gerente_titular_da(');
      END IF;
    END LOOP;
  END LOOP;
END
$mig$;

-- 4b. Policies: operação → gerência; filiais/currículos → titular.
DO $mig$
DECLARE
  r      record;
  v_pat  text := $p$( SELECT auth_user_role() AS auth_user_role) = 'gerente'::text$p$;
  v_rep  text := $p$( SELECT auth_e_gerencia() AS auth_e_gerencia)$p$;
  v_q    text;
  v_c    text;
  v_n    int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY[
         'ajustes_custo_compra', 'aprovacoes_compras', 'aprovacoes_estoque', 'categorias_produto',
         'clientes', 'conciliacao_maquininha_itens', 'conciliacoes_maquininha', 'condicoes_pagamento',
         'contas_pagar', 'contas_receber', 'controle_caixa', 'cotacoes', 'das_apuracoes',
         'despesas_recorrentes', 'devolucoes', 'formas_pagamento', 'fornecedores', 'fretes_compra',
         'fretes_compra_rateio', 'itens_campanha', 'itens_devolucao', 'itens_venda', 'loja_config',
         'marketing_arte_feedback', 'marketing_artes', 'marketing_calendario', 'marketing_campanhas',
         'marketing_cupons', 'marketing_promocoes', 'marketing_tarefas', 'max_shows',
         'movimentacoes_caixa', 'movimentacoes_estoque', 'notas_emitidas', 'notas_recebidas',
         'orcamento_mensal_categoria', 'orcamentos', 'pedidos', 'pedidos_venda', 'produtos', 'projetos',
         'rateio_administrativo', 'rateio_administrativo_itens', 'recebimentos', 'relatorios_bi',
         'requisicoes', 'requisicoes_estoque', 'servicos', 'subcategorias_produto',
         'vencimentos_estoque', 'vendas', 'vendas_pagamentos'])
       AND (position(v_pat IN COALESCE(qual, '')) > 0 OR position(v_pat IN COALESCE(with_check, '')) > 0)
  LOOP
    v_q := replace(r.qual, v_pat, v_rep);
    v_c := replace(r.with_check, v_pat, v_rep);
    IF v_q IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.policyname, r.schemaname, r.tablename, v_q);
    END IF;
    IF v_c IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, v_c);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE (schemaname = 'public' AND tablename = 'filiais')
        OR (schemaname = 'storage' AND tablename = 'objects' AND policyname = 'curriculos_read')
  LOOP
    IF position('auth_gerente_da(' IN COALESCE(r.qual, '') || COALESCE(r.with_check, '')) = 0 THEN
      CONTINUE;
    END IF;
    v_q := replace(r.qual, 'auth_gerente_da(', 'auth_gerente_titular_da(');
    v_c := replace(r.with_check, 'auth_gerente_da(', 'auth_gerente_titular_da(');
    IF v_q IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', r.policyname, r.schemaname, r.tablename, v_q);
    END IF;
    IF v_c IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', r.policyname, r.schemaname, r.tablename, v_c);
    END IF;
  END LOOP;

  RAISE NOTICE '690: % policies de operação passaram para a gerência', v_n;
END
$mig$;

-- 4c. Guards de caixa e Painel de BI: gerência.
DO $mig$
DECLARE
  v_fn  text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['controle_caixa_guard', 'movimentacao_caixa_guard'] LOOP
    v_def := replace(pg_get_functiondef(('public.' || v_fn || '()')::regprocedure), E'\r', '');
    IF position('public.auth_user_role() = ''gerente''' IN v_def) > 0 THEN
      EXECUTE replace(v_def, 'public.auth_user_role() = ''gerente''', 'public.auth_e_gerencia()');
    END IF;
  END LOOP;

  SELECT replace(pg_get_functiondef(p.oid), E'\r', '') INTO v_def
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'gerar_painel_bi' LIMIT 1;
  IF position('IF v_role NOT IN (''admin'',''ceo'',''gerente'') THEN' IN v_def) > 0 THEN
    EXECUTE replace(v_def, 'IF v_role NOT IN (''admin'',''ceo'',''gerente'') THEN',
                    'IF v_role NOT IN (''admin'',''ceo'',''gerente'') AND NOT public.auth_e_gerencia() THEN  -- MIGR 690');
  END IF;
END
$mig$;

-- ── 5 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_historico_decisao_do_assistente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assist  boolean;
  v_autor   uuid;
  v_decide  boolean;
  v_rotulo  text;
BEGIN
  IF NEW.ator_id IS NULL OR NEW.evento <> 'Status' THEN
    RETURN NULL;
  END IF;

  SELECT u.role = 'colaborador' AND u.gerente_assistente INTO v_assist
    FROM public.user_profiles u WHERE u.id = NEW.ator_id;
  IF NOT COALESCE(v_assist, false) THEN
    RETURN NULL;
  END IF;

  v_decide := NEW.para IN ('Aprovado', 'Aprovada', 'Negado', 'Negada', 'Reprovado', 'Reprovada',
                           'Liberado', 'Liberada')
              OR (NEW.entidade = 'controle_caixa' AND NEW.de = 'Fechado' AND NEW.para = 'Aberto');

  -- (a) Não decide o que ele mesmo abriu.
  IF v_decide AND EXISTS (SELECT 1 FROM information_schema.columns c
                           WHERE c.table_schema = 'public' AND c.table_name = NEW.entidade
                             AND c.column_name = 'criado_por') THEN
    EXECUTE format('SELECT criado_por FROM public.%I WHERE id = $1', NEW.entidade)
       INTO v_autor USING NEW.entidade_id;
    IF v_autor = NEW.ator_id THEN
      RAISE EXCEPTION 'Como Gerente Assistente você não decide sobre o que você mesmo abriu. Esta decisão fica com o gerente da unidade.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- (b) Toda decisão dele chega ao gerente.
  IF v_decide OR NEW.para IN ('Em correção', 'Devolvido', 'Devolvida', 'Cancelado', 'Cancelada') THEN
    v_rotulo := CASE NEW.entidade
      WHEN 'requisicoes'         THEN 'Requisição de compra'
      WHEN 'requisicoes_estoque' THEN 'Requisição de estoque'
      WHEN 'cotacoes'            THEN 'Cotação'
      WHEN 'pedidos'             THEN 'Pedido de compra'
      WHEN 'recebimentos'        THEN 'Recebimento'
      WHEN 'devolucoes'          THEN 'Devolução'
      WHEN 'controle_caixa'      THEN 'Caixa'
      WHEN 'orcamentos'          THEN 'Orçamento'
      WHEN 'pedidos_venda'       THEN 'Pedido de venda'
      WHEN 'vendas'              THEN 'Venda'
      WHEN 'contas_pagar'        THEN 'Conta a pagar'
      WHEN 'contas_receber'      THEN 'Conta a receber'
      ELSE NEW.entidade END;
    INSERT INTO public.notificacoes
      (setor, tipo, titulo, mensagem, urgencia, origem_setor, origem_user, ref_id, filial)
    VALUES
      ('gerencia', 'info', 'Decisão do Gerente Assistente',
       format('%s — %s: %s → %s.%s', NEW.ator_nome, v_rotulo, COALESCE(NEW.de, '—'), NEW.para,
              COALESCE(' ' || NULLIF(NEW.detalhe, ''), '')),
       'Baixa', NEW.ator_setor, NEW.ator_id, NEW.entidade_id, NEW.filial);
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_historico_decisao_do_assistente ON public.historico_operacoes;
CREATE TRIGGER trg_historico_decisao_do_assistente
  AFTER INSERT ON public.historico_operacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_historico_decisao_do_assistente();

NOTIFY pgrst, 'reload schema';
