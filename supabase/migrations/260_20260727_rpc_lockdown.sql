-- 260_20260727_rpc_lockdown.sql
--
-- Fecha o buraco crítico da auditoria de 2026-07-27: funções SECURITY DEFINER
-- executáveis por `anon`. SECURITY DEFINER roda como dono do banco e IGNORA RLS
-- por completo — qualquer pessoa com a anon key (visível no F12) chamava
-- POST /rest/v1/rpc/<nome> sem estar logada.
--
-- PoC que motivou esta migração (LogMax-ERP, produção, sem login):
--   POST /rest/v1/rpc/listar_pessoas_treinamento_ia -> HTTP 200, roster completo
--   (nome + role + setor de todos os usuários), enquanto
--   GET /rest/v1/user_profiles -> [] (RLS segurando corretamente).
--
-- ITEM 1 (parte B): revoga EXECUTE de anon/PUBLIC em todas as funções próprias
--                   do schema public; concede a authenticated + service_role;
--                   devolve anon só para a allowlist de rotas públicas reais.
-- ITEM 2 (parte C): injeta guard de autenticação/setor nas RPCs de escrita que
--                   hoje não checam nada.
--
-- IDEMPOTENTE: pode rodar de novo sem efeito colateral.
-- APLICAR NOS 4 PROJETOS: LogMax-ERP, logmax-aprendiz, logmax-contabilidade,
-- LogMax-Adm. A parte C se adapta ao corpo de cada projeto (schema drift) porque
-- reescreve a função a partir do pg_get_functiondef local, não de um corpo fixo.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- PARTE A — helper de guard
-- ────────────────────────────────────────────────────────────────────────────

-- Sem setor: exige apenas sessão autenticada.
-- Com setor(es): exige que o usuário pertença a pelo menos um deles.
-- auth_in_setor() já libera admin/CEO/conselheiro (e gerente+is_conselheiro).
-- service_role (cron, endpoints api/*.ts) passa direto.
CREATE OR REPLACE FUNCTION public._assert_rpc(VARIADIC p_setores text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.'
      USING ERRCODE = '42501';
  END IF;

  IF array_length(p_setores, 1) IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.auth_in_setor(VARIADIC p_setores) THEN
    RAISE EXCEPTION 'Permissão insuficiente para esta operação.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- PARTE B (ITEM 1) — revogar EXECUTE de anon/PUBLIC
-- ────────────────────────────────────────────────────────────────────────────
--
-- Por padrão o Postgres concede EXECUTE a PUBLIC em toda função criada — é daí
-- que vem o acesso de `anon`. Revogamos de PUBLIC/anon e concedemos
-- explicitamente a authenticated + service_role.
--
-- Funções de extensão (pg_trgm etc.) ficam de fora: são usadas por índices e
-- operadores internos, mexer nelas quebra busca.
--
-- Funções de trigger não precisam de GRANT (o Postgres não checa EXECUTE do
-- caller em triggers; a permissão é validada no CREATE TRIGGER), mas conceder
-- não faz mal e mantém o estado uniforme.

DO $revoke$
DECLARE
  r record;
  -- Rotas genuinamente públicas (sem login) que DEVEM continuar abertas:
  --   confirmar_pix_pendente   -> /simulador-pagamento (SimuladorPagamentoView)
  --   get_vitrine_publica      -> VitrineCarousel na tela de login
  --   confirmar_cartao_pendente, autorizar_cartao_maxbank, renotificar_pix_pago
  --                            -> consumidos pelo app externo MaxBank
  -- Helpers auth_* e acre_today: leitura trivial do próprio contexto, usados
  -- dentro de policies avaliadas como anon.
  allow_anon constant text[] := ARRAY[
    'confirmar_pix_pendente',
    'confirmar_cartao_pendente',
    'autorizar_cartao_maxbank',
    'renotificar_pix_pago',
    'get_vitrine_publica',
    'auth_user_role', 'auth_user_setor', 'auth_user_setores', 'auth_user_filial',
    'auth_is_admin', 'auth_in_setor', 'auth_pode_filial', 'auth_gerente_da',
    'auth_is_service_role',
    'acre_today'
  ];
  v_sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid AND d.deptype = 'e'
           )
  LOOP
    v_sig := format('public.%I(%s)', r.proname,
                    pg_get_function_identity_arguments(r.oid));

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);

    IF r.proname = ANY (allow_anon) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_sig);
    END IF;
  END LOOP;
END;
$revoke$;

-- Novas funções criadas daqui pra frente já nascem sem EXECUTE para PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ────────────────────────────────────────────────────────────────────────────
-- PARTE C (ITEM 2) — guard de setor dentro das RPCs de escrita
-- ────────────────────────────────────────────────────────────────────────────
--
-- A parte B já barra o anônimo. Isto fecha a segunda camada: aluno LOGADO como
-- colaborador de outro setor chamando RPC que não é do módulo dele.
--
-- O guard é injetado logo após o primeiro `BEGIN` de linha inteira do corpo,
-- reaproveitando pg_get_functiondef — assim preserva assinatura, SET search_path,
-- volatilidade e owner, e funciona mesmo com os corpos divergentes entre turmas.

DO $guard$
DECLARE
  r        record;
  v_def    text;
  v_new    text;
  v_args   text;
  v_setores jsonb;
  v_aplicadas int := 0;
  v_puladas   int := 0;

  -- RPC -> setores permitidos. [] = basta estar autenticado.
  -- Mapeamento derivado da view que chama cada RPC (src/views/*).
  alvos constant jsonb := jsonb_build_object(
    -- PDV (PDVView, PDVViewSupermax)
    'criar_venda_pdv',              jsonb_build_array('vendas','financeiro'),
    'estornar_venda_pdv',           jsonb_build_array('vendas','financeiro'),
    'validar_cupom',                jsonb_build_array('vendas','financeiro','marketing'),
    -- Compras (RequisicoesView)
    'criar_requisicao_compra',      jsonb_build_array('compras','logistica'),
    'criar_requisicoes_compra_lote',jsonb_build_array('compras','logistica'),
    -- Estoque (RequisicoesEstoqueView)
    'criar_requisicao_estoque',     jsonb_build_array('estoque','logistica'),
    -- Vendas -> Financeiro (OrcamentosView)
    'converter_orcamento_em_pedido',jsonb_build_array('vendas','financeiro'),
    -- Folha / MaxBank (FolhaPagamentoView)
    'recalcular_folha_do_ponto',    jsonb_build_array('rh','financeiro'),
    'reverter_folha_maxbank',       jsonb_build_array('rh','financeiro'),
    'recompute_saldos_maxbank',     jsonb_build_array('rh','financeiro'),
    'gerar_folgas_acumulado',       jsonb_build_array('rh'),
    -- RH (AfastamentosView)
    'aplicar_afastamento_no_ponto', jsonb_build_array('rh'),
    -- Competição / Matriz (só admin/CEO/conselheiro -> auth_in_setor('all'))
    'expirar_competicoes',          jsonb_build_array('all'),
    'calcular_placar_competicao',   jsonb_build_array('all'),
    -- TI / RH (DesenvolvimentoIAView) — era o vazamento do roster
    'listar_pessoas_treinamento_ia',jsonb_build_array('ti','rh'),
    -- Leitura financeira usada por 5 views de setores diversos: só autenticado
    'calcular_saldo_capital',       jsonb_build_array(),
    'calcular_valor_atualizado',    jsonb_build_array(),
    -- Canal anônimo: qualquer colaborador logado pode enviar
    'enviar_feedback_anonimo',      jsonb_build_array(),
    -- Cron + fallback client-side
    'reverter_promocoes_expiradas', jsonb_build_array(),
    -- Marketing (VitrinePublicaView)
    'marcar_vitrine',               jsonb_build_array('marketing'),
    'listar_vitrine_candidatos',    jsonb_build_array('marketing')
  );
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l  ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname = 'plpgsql'
       AND p.prokind = 'f'
       AND pg_get_function_result(p.oid) <> 'trigger'
       AND alvos ? p.proname
       -- Não tocar em função que JÁ tem guard próprio: um segundo guard entra
       -- em AND com o existente e pode restringir além do desenhado
       -- (ex.: estornar_venda_pdv, marcar_vitrine já checam papel internamente).
       AND NOT (p.prosrc ~* 'auth_user_role|auth_is_admin|auth_in_setor|auth_pode_filial|auth_gerente_da|auth_user_setor|_assert|Não autenticado')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- Já tem guard (rodada anterior desta migração)? pula.
    IF v_def LIKE '%_assert_rpc%' THEN
      v_puladas := v_puladas + 1;
      CONTINUE;
    END IF;

    v_setores := alvos -> r.proname;

    IF jsonb_array_length(v_setores) = 0 THEN
      v_args := '';
    ELSE
      SELECT string_agg(quote_literal(x), ', ')
        INTO v_args
        FROM jsonb_array_elements_text(v_setores) AS x;
    END IF;

    -- Injeta no primeiro `BEGIN` sozinho numa linha (o BEGIN do bloco externo,
    -- depois do DECLARE). Sem flag 'g': só a primeira ocorrência.
    v_new := regexp_replace(
      v_def,
      '(^[ \t]*BEGIN[ \t]*\r?$)',
      '\1' || E'\n  PERFORM public._assert_rpc(' || v_args || ');',
      'n'
    );

    IF v_new = v_def THEN
      RAISE WARNING '[260] Guard NÃO injetado em %(%): nenhum BEGIN de bloco externo encontrado. Revisar manualmente.',
        r.proname, pg_get_function_identity_arguments(r.oid);
      v_puladas := v_puladas + 1;
      CONTINUE;
    END IF;

    EXECUTE v_new;
    v_aplicadas := v_aplicadas + 1;
  END LOOP;

  RAISE NOTICE '[260] Guard aplicado em % função(ões); % pulada(s).', v_aplicadas, v_puladas;
END;
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- PARTE C.2 — caso especial: listar_pessoas_treinamento_ia
-- ────────────────────────────────────────────────────────────────────────────
--
-- É LANGUAGE sql (não tem bloco BEGIN, a injeção da parte C não alcança) e o
-- corpo era um `SELECT ... FROM user_profiles` cru sob SECURITY DEFINER — foi
-- exatamente esta a RPC que vazou o roster completo sem login no PoC.
-- Reescrita com o gate no WHERE: fora de TI/RH (e admin/CEO/conselheiro),
-- devolve vazio. Para anon, auth_in_setor() é NULL -> nenhuma linha.
CREATE OR REPLACE FUNCTION public.listar_pessoas_treinamento_ia()
RETURNS TABLE(id uuid, nome text, role text, setor text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, p.nome, p.role, p.setor
    FROM user_profiles p
   WHERE public.auth_in_setor('ti', 'rh')
   ORDER BY p.nome;
$function$;

-- Reaplica os grants nas funções recriadas acima (CREATE OR REPLACE preserva
-- ACL, mas garantimos o estado final de forma explícita).
DO $regrant$
DECLARE r record; v_sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    v_sig := format('public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END;
$regrant$;

-- _assert_rpc não deve ser chamável por anon.
REVOKE ALL ON FUNCTION public._assert_rpc(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_rpc(text[]) TO authenticated, service_role;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar depois; deve voltar 0 linhas fora da allowlist)
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND has_function_privilege('anon', p.oid, 'EXECUTE')
--    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
--  ORDER BY 1;
--
-- Teste externo (deve virar 401/403 em vez de 200):
--   curl -X POST "$URL/rest/v1/rpc/listar_pessoas_treinamento_ia" \
--        -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'
