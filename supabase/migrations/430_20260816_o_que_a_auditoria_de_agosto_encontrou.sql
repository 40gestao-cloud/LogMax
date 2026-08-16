-- 430_20260816_o_que_a_auditoria_de_agosto_encontrou.sql
--
-- Reauditoria da superfície exposta ao F12, pedida depois de ~170 migrações
-- terem entrado desde a última (257/258/260/261, de 27/07). O medo declarado:
-- "alguém assumir posição de admin" e "causar problemas pelo F12".
--
-- O que continua de pé, verificado neste banco e não de memória:
--   • nenhuma RPC própria fora da allowlist é executável por `anon`;
--   • toda SECURITY DEFINER própria tem `search_path` fixo;
--   • todas as views são `security_invoker=true`;
--   • RLS ligada em todas as tabelas de `public`;
--   • o cluster de avaliação da Matriz (avaliar_item_matriz,
--     remover_avaliacao_matriz, atualizar_avaliacao, registrar_voto) e o de
--     metas/tarefas táticas checam papel corretamente;
--   • MaxBank opera sempre sobre a conta do próprio `auth.uid()`.
--
-- O que NÃO estava de pé é o que esta migração fecha. Os md5 dos corpos são
-- idênticos nas 4 turmas, então os furos existem nas quatro e o corpo fixo
-- abaixo converge todas — não é caso de injeção por regexp.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. CRÍTICO — O DESLIGADO SE RECONTRATA SOZINHO PELO F12
--
-- A migr. 258 pôs um gatilho BEFORE UPDATE em `user_profiles` bloqueando os
-- campos de privilégio: role, setor, setores_extras, filial, is_conselheiro,
-- pode_acessar_usuarios, criado_por. Está lá e funciona.
--
-- Só que `desligado_em` nasceu DEPOIS (migrs. 318 e 355-357) e nunca entrou
-- nessa lista. E `desligado_em` virou, sem que ninguém reparasse, a coluna de
-- privilégio mais poderosa do banco: **382 policies** deste projeto a
-- consultam via `auth_desligado()`, e `auth_user_role()` devolve NULL para
-- quem está desligado — ou seja, ela sozinha liga e desliga o acesso inteiro.
-- O `_assert_rpc` também barra desligado, então ela governa as RPCs junto.
--
-- A policy de UPDATE (`up_update_own_or_admin`) permite mexer na própria
-- linha, e ela não chama `auth_desligado()`. Resultado, no console de um aluno
-- que a Matriz acabou de desligar:
--
--     supabase.from('user_profiles')
--             .update({ desligado_em: null })
--             .eq('id', (await supabase.auth.getUser()).data.user.id)
--
-- e o desligamento decidido pela Matriz é desfeito — sem passar por RH, sem
-- rastro, sem recuperação. Mesma classe da falha de 258, em coluna nova.
--
-- `ativo` entra junto pelo mesmo motivo: é o soft delete do cadastro e também
-- não estava protegido.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2. ALTO — O CAIXA DE QUALQUER FILIAL, POR QUALQUER ALUNO LOGADO
--
-- Quatro RPCs de `controle_caixa` são SECURITY DEFINER (logo, ignoram a RLS) e
-- não checam NADA além do estado do caixa. Nem papel, nem setor, nem filial:
--
--   suspender_caixa               → suspende o caixa aberto de qualquer filial
--   solicitar_fechamento_caixa    → joga o caixa alheio em Aguardando Confirmação
--   fechar_caixa_conferido        → fecha direto, com o valor contado que quiser
--   registrar_movimentacao_caixa  → injeta sangria/suprimento no caixa alheio
--
-- É a que mais se aproxima do que foi descrito como medo real: o PDV trava
-- quando o caixa não está aberto, então `suspender_caixa` com o id de outra
-- unidade derruba a operação da turma vizinha no meio da aula. E a sangria
-- injetada entra na conta do `valor_esperado`, então o fechamento da outra
-- filial passa a acusar falta — o prejuízo aparece como erro deles.
--
-- O id do caixa não é segredo: `useCaixaAberto` já traz a linha para o cliente.
--
-- `confirmar_fechamento_caixa` era a única com checagem de papel, mas o ramo do
-- setor `financeiro` não olhava filial — financeiro da MaxLook confirmava o
-- fechamento da SuperMax. Ganha o escopo de unidade aqui.
--
-- A régua adotada é a que as telas já praticam: quem opera o caixa é Vendas
-- (PDV) ou Financeiro, além do gerente daquela unidade; sempre da própria
-- filial. `fechar_caixa_conferido` continua servindo aos dois caminhos —
-- o operador fecha com `p_origem='operador'` (PDVViewSupermax) e o Financeiro
-- com `p_origem='financeiro'` (ControleCaixaView) —, por isso não vira
-- exclusiva do Financeiro.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 3. MÉDIO — NOTA FISCAL EM NOME DE QUALQUER FILIAL
--
-- `emitir_nota` valida filial não-vazia, valor não-negativo e descrição
-- preenchida — e mais nada. Qualquer aluno logado emite nota em nome de
-- qualquer unidade, com qualquer valor e qualquer cliente, consumindo a
-- numeração sequencial daquela filial (que é por (filial, serie) e não
-- retrocede). Suja o módulo fiscal alheio de forma que não dá para desfazer
-- sem mexer na numeração.
--
-- Continua sendo chamada de dentro de `criar_venda_pdv` — que já tem
-- `_assert_rpc` e roda com o `auth.uid()` do operador de Vendas, então o guard
-- novo deixa o fluxo do PDV passar igual.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 4. BAIXO — expirar_competicoes SEM DONO
--
-- Sem guard nenhum. Só mexe em competição cuja `data_fim` já passou, então o
-- estrago é pequeno, mas não há motivo para um aluno poder empurrar competição
-- para 'aguardando_encerramento'. Não é chamada de lugar nenhum do front —
-- é helper de manutenção. Vira admin/service_role.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FICA COMO ESTÁ, de propósito (mesmo critério da 260/261):
--   • `produtos` com SELECT USING(true) continua expondo custo pela API;
--   • `notificar_setor` continua deixando qualquer logado notificar qualquer
--     setor;
--   • `feedbacks_organizacao` mantém INSERT aberto — é o canal anônimo;
--   • `atualizar_foto_usuario` deixa gerente trocar a foto de qualquer um, sem
--     escopo de filial. É vandalismo cosmético, não privilégio; anotado.


BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Gatilho anti-privesc aprende as duas colunas que nasceram depois
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_profiles_bloquear_privesc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role (endpoint /api/users) passa livre.
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- Compara campos sensíveis; se algum mudou, rejeita.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Alteração de role bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  IF NEW.setor IS DISTINCT FROM OLD.setor THEN
    RAISE EXCEPTION 'Alteração de setor bloqueada — use /api/users (admin/CEO/gerente).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.setores_extras IS DISTINCT FROM OLD.setores_extras THEN
    RAISE EXCEPTION 'Alteração de setores_extras bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.filial IS DISTINCT FROM OLD.filial THEN
    RAISE EXCEPTION 'Alteração de filial bloqueada — use /api/users.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_conselheiro IS DISTINCT FROM OLD.is_conselheiro THEN
    RAISE EXCEPTION 'Alteração de is_conselheiro bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.pode_acessar_usuarios IS DISTINCT FROM OLD.pode_acessar_usuarios THEN
    RAISE EXCEPTION 'Alteração de pode_acessar_usuarios bloqueada — use /api/users (admin/CEO).'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.criado_por IS DISTINCT FROM OLD.criado_por THEN
    RAISE EXCEPTION 'Alteração de criado_por bloqueada.'
      USING ERRCODE = '42501';
  END IF;

  -- Novo na 430. `desligado_em` governa 382 policies via auth_desligado() e
  -- zera auth_user_role(); deixá-la fora desta lista era permitir que o
  -- desligado revertesse o próprio desligamento pelo console.
  IF NEW.desligado_em IS DISTINCT FROM OLD.desligado_em THEN
    RAISE EXCEPTION 'Alteração de desligado_em bloqueada — desligamento e readmissão passam pelo RH.'
      USING ERRCODE = '42501';
  END IF;

  -- Soft delete do cadastro: mesma história, escala menor.
  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'Alteração de ativo bloqueada — use /api/users (admin).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Guard único do caixa
--
-- Existe como função própria em vez de repetido nas cinco RPCs para que a
-- régua ("quem opera o caixa desta unidade") tenha um lugar só. `_assert_rpc()`
-- sem setores entra primeiro: traz de graça service_role, não-autenticado,
-- vínculo encerrado e o blackout da migr. 339 — sem ele a RPC seria a porta
-- dos fundos da simulação de perda de dados.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assert_caixa(p_filial text, p_conferencia boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_setores text[];
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  PERFORM public._assert_rpc();

  -- Conferência (confirmar o fechamento pedido pelo operador) é do Financeiro;
  -- a operação do dia a dia é do PDV também.
  v_setores := CASE WHEN p_conferencia
                    THEN ARRAY['financeiro']
                    ELSE ARRAY['financeiro','vendas'] END;

  -- COALESCE em todo guard: NULL não vira permissão (vide migr. 260).
  IF NOT COALESCE(
       public.auth_in_setor(VARIADIC v_setores)
       OR public.auth_gerente_da(p_filial),
     false) THEN
    RAISE EXCEPTION 'Apenas % (ou o gerente da unidade) operam o caixa.',
      CASE WHEN p_conferencia THEN 'o Financeiro' ELSE 'Vendas e Financeiro' END
      USING ERRCODE = '42501';
  END IF;

  -- ATENÇÃO ao caixa com `filial IS NULL` (linha legada, anterior ao caixa por
  -- unidade): `auth_pode_filial(NULL)` devolve NULL para quem não é admin, o
  -- COALESCE transforma em false e o caixa vira admin-only. É o lado seguro,
  -- mas se alguma turma ainda tiver caixa antigo sem filial, ele para de ser
  -- operável pelo aluno. Conferido em 16/08 nas 4 turmas: zero linhas com
  -- `filial IS NULL`, então na prática não afeta ninguém hoje. Reconferir se
  -- esta migração for aplicada muito depois:
  --   SELECT id, data, status FROM controle_caixa WHERE filial IS NULL;
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Este caixa é da unidade % — você só opera o caixa da sua unidade.',
      COALESCE(p_filial, '(sem filial)')
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_caixa(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._assert_caixa(text, boolean) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2a. suspender_caixa
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.suspender_caixa(p_controle_id uuid, p_observacao text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa  public.controle_caixa;
  v_uid    uuid := auth.uid();
  v_nome   text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status <> 'Aberto' THEN
    RAISE EXCEPTION 'Caixa não está aberto.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status            = 'Suspenso',
         fechado_por       = v_uid,
         fechado_por_nome  = v_nome,
         fechado_em        = now(),
         observacao        = COALESCE(p_observacao, observacao),
         origem_fechamento = 'operador'
   WHERE id = p_controle_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2b. solicitar_fechamento_caixa
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.solicitar_fechamento_caixa(p_controle_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa         public.controle_caixa;
  v_vendas_din    numeric(15,2) := 0;
  v_suprimentos   numeric(15,2) := 0;
  v_sangrias      numeric(15,2) := 0;
  v_esperado      numeric(15,2);
  v_dif           numeric(15,2);
  v_tipo          text;
  v_uid           uuid := auth.uid();
  v_nome          text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status <> 'Aberto' THEN
    RAISE EXCEPTION 'Só é possível solicitar fechamento de caixa aberto (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_contado IS NULL OR p_valor_contado < 0 THEN
    RAISE EXCEPTION 'Valor contado inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(total_final), 0) INTO v_vendas_din
    FROM public.vendas
   WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
     AND forma_pagamento ILIKE 'dinheiro%'
     AND COALESCE(ativo, true) = true
     AND (v_caixa.filial IS NULL OR filial = v_caixa.filial);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;
  v_dif      := p_valor_contado - v_esperado;
  v_tipo     := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status             = 'Aguardando Confirmação',
         valor_fechamento   = p_valor_contado,
         valor_esperado     = v_esperado,
         diferenca          = v_dif,
         tipo_diferenca     = v_tipo,
         fechado_por        = v_uid,
         fechado_por_nome   = v_nome,
         fechado_em         = now(),
         observacao         = COALESCE(p_observacao, observacao),
         origem_fechamento  = 'operador'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  v_esperado,
    'valor_contado',   p_valor_contado,
    'diferenca',       v_dif,
    'tipo',            v_tipo,
    'status_novo',     'Aguardando Confirmação'
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2c. fechar_caixa_conferido
--
-- Serve aos dois caminhos (operador no PDV e Financeiro na ControleCaixa), por
-- isso NÃO usa p_conferencia=true.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fechar_caixa_conferido(p_controle_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text, p_origem text DEFAULT 'financeiro'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa         public.controle_caixa;
  v_vendas_din    numeric(15,2) := 0;
  v_suprimentos   numeric(15,2) := 0;
  v_sangrias      numeric(15,2) := 0;
  v_esperado      numeric(15,2);
  v_dif           numeric(15,2);
  v_tipo          text;
  v_uid           uuid := auth.uid();
  v_nome          text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa já fechado.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_contado IS NULL OR p_valor_contado < 0 THEN
    RAISE EXCEPTION 'Valor contado inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(total_final), 0) INTO v_vendas_din
    FROM public.vendas
   WHERE DATE(created_at AT TIME ZONE 'America/Rio_Branco') = v_caixa.data
     AND forma_pagamento ILIKE 'dinheiro%'
     AND COALESCE(ativo, true) = true
     AND (v_caixa.filial IS NULL OR filial = v_caixa.filial);

  SELECT COALESCE(SUM(valor), 0) INTO v_suprimentos
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'suprimento';

  SELECT COALESCE(SUM(valor), 0) INTO v_sangrias
    FROM public.movimentacoes_caixa
   WHERE controle_caixa_id = p_controle_id AND tipo = 'sangria';

  v_esperado := COALESCE(v_caixa.valor_abertura, 0) + v_vendas_din + v_suprimentos - v_sangrias;
  v_dif      := p_valor_contado - v_esperado;
  v_tipo     := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status             = 'Fechado',
         valor_fechamento   = p_valor_contado,
         valor_esperado     = v_esperado,
         diferenca          = v_dif,
         tipo_diferenca     = v_tipo,
         fechado_por        = v_uid,
         fechado_por_nome   = v_nome,
         fechado_em         = now(),
         observacao         = COALESCE(p_observacao, observacao),
         origem_fechamento  = COALESCE(p_origem, 'financeiro')
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_abertura',  COALESCE(v_caixa.valor_abertura, 0),
    'vendas_dinheiro', v_vendas_din,
    'suprimentos',     v_suprimentos,
    'sangrias',        v_sangrias,
    'valor_esperado',  v_esperado,
    'valor_contado',   p_valor_contado,
    'diferenca',       v_dif,
    'tipo',            v_tipo
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2d. registrar_movimentacao_caixa
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_movimentacao_caixa(p_controle_id uuid, p_tipo text, p_valor numeric, p_motivo text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa public.controle_caixa;
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_id    uuid;
BEGIN
  IF p_tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Tipo inválido (use sangria ou suprimento).' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_caixa(v_caixa.filial);

  IF v_caixa.status = 'Fechado' THEN
    RAISE EXCEPTION 'Caixa fechado — operação não permitida.' USING ERRCODE = 'P0001';
  END IF;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.movimentacoes_caixa
    (controle_caixa_id, tipo, valor, motivo, filial, criado_por, criado_por_nome)
  VALUES
    (p_controle_id, p_tipo, p_valor, p_motivo, v_caixa.filial, v_uid, v_nome)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2e. confirmar_fechamento_caixa — a checagem que existia, agora com filial
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirmar_fechamento_caixa(p_controle_id uuid, p_observacao_extra text DEFAULT NULL::text, p_valor_reconferido numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caixa       public.controle_caixa;
  v_uid         uuid := auth.uid();
  v_nome        text;
  v_esperado    numeric(15,2);
  v_valor_final numeric(15,2);
  v_dif         numeric(15,2);
  v_tipo        text;
  v_obs_final   text;
BEGIN
  SELECT * INTO v_caixa FROM public.controle_caixa WHERE id = p_controle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Antes a checagem era inline e o ramo do setor 'financeiro' não olhava
  -- filial nenhuma. p_conferencia=true mantém a régua mais estreita (só
  -- Financeiro, ou o gerente da unidade), agora escopada.
  PERFORM public._assert_caixa(v_caixa.filial, true);

  IF v_caixa.status <> 'Aguardando Confirmação' THEN
    RAISE EXCEPTION 'Só é possível confirmar caixa em Aguardando Confirmação (estado atual: %).', v_caixa.status
      USING ERRCODE = 'P0001';
  END IF;

  v_esperado := COALESCE(v_caixa.valor_esperado, 0);
  v_valor_final := COALESCE(p_valor_reconferido, v_caixa.valor_fechamento);
  v_dif  := v_valor_final - v_esperado;
  v_tipo := CASE
    WHEN v_dif > 0.005  THEN 'sobra'
    WHEN v_dif < -0.005 THEN 'falta'
    ELSE 'exato'
  END;

  v_obs_final := CASE
    WHEN p_observacao_extra IS NULL OR btrim(p_observacao_extra) = '' THEN v_caixa.observacao
    WHEN v_caixa.observacao IS NULL OR btrim(v_caixa.observacao) = '' THEN p_observacao_extra
    ELSE v_caixa.observacao || E'\n— Financeiro: ' || p_observacao_extra
  END;

  SELECT nome INTO v_nome FROM public.user_profiles WHERE id = v_uid;

  UPDATE public.controle_caixa
     SET status            = 'Fechado',
         valor_fechamento  = v_valor_final,
         diferenca         = v_dif,
         tipo_diferenca    = v_tipo,
         atualizado_por    = v_uid,
         updated_at        = now(),
         observacao        = v_obs_final,
         origem_fechamento = 'financeiro'
   WHERE id = p_controle_id;

  RETURN jsonb_build_object(
    'valor_esperado', v_esperado,
    'valor_final',    v_valor_final,
    'diferenca',      v_dif,
    'tipo',           v_tipo,
    'confirmado_por', v_nome,
    'status_novo',    'Fechado'
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. emitir_nota — setor + filial
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.emitir_nota(p_filial text, p_tipo text, p_origem text, p_cliente_id uuid, p_cliente_nome text, p_valor_total numeric, p_descricao text, p_venda_id uuid DEFAULT NULL::uuid, p_conta_receber_id uuid DEFAULT NULL::uuid, p_data_emissao date DEFAULT NULL::date, p_serie text DEFAULT '001'::text)
RETURNS notas_emitidas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next  integer;
  v_row   public.notas_emitidas;
  v_data  date := COALESCE(p_data_emissao, public.acre_today());
BEGIN
  IF p_filial IS NULL OR length(trim(p_filial)) = 0 THEN
    RAISE EXCEPTION 'Filial obrigatória.' USING ERRCODE = 'P0001';
  END IF;
  IF p_valor_total < 0 THEN
    RAISE EXCEPTION 'Valor negativo não permitido.' USING ERRCODE = 'P0001';
  END IF;
  IF p_descricao IS NULL OR length(trim(p_descricao)) = 0 THEN
    RAISE EXCEPTION 'Descrição obrigatória.' USING ERRCODE = 'P0001';
  END IF;

  -- Novo na 430. Vendas entra porque `criar_venda_pdv` chama esta função
  -- dentro da mesma transação, com o auth.uid() do operador do PDV.
  IF NOT public.auth_is_service_role() THEN
    PERFORM public._assert_rpc('financeiro', 'vendas');
    IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
      RAISE EXCEPTION 'Você não emite nota em nome da unidade %.', p_filial
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Serializa concorrência de numeração por (filial, serie) via advisory
  -- lock (hashtext do par). Evita bloquear a tabela inteira.
  PERFORM pg_advisory_xact_lock(hashtext('notas_emitidas:' || p_filial || ':' || p_serie));

  SELECT COALESCE(MAX(numero), 0) + 1
    INTO v_next
    FROM public.notas_emitidas
   WHERE filial = p_filial AND serie = p_serie;

  INSERT INTO public.notas_emitidas (
    filial, numero, serie, tipo, origem,
    cliente_id, cliente_nome, valor_total, descricao, data_emissao,
    venda_id, conta_receber_id, criado_por
  ) VALUES (
    p_filial, v_next, p_serie, p_tipo, p_origem,
    p_cliente_id, p_cliente_nome, p_valor_total, p_descricao, v_data,
    p_venda_id, p_conta_receber_id, auth.uid()
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. expirar_competicoes — helper de manutenção, não de aluno
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expirar_competicoes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_hoje  date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  IF NOT public.auth_is_service_role() AND NOT COALESCE(public.auth_is_admin(), false) THEN
    RAISE EXCEPTION 'Apenas a direção encerra competições.' USING ERRCODE = '42501';
  END IF;

  UPDATE competicoes_matriz
     SET status = 'aguardando_encerramento', updated_at = now()
   WHERE ativo = true
     AND status = 'em_andamento'
     AND data_fim < v_hoje;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- Higiene de grants. CREATE OR REPLACE preserva privilégios, mas a regra da
-- casa (vide 260 e [[feedback_rpc_nova_nasce_aberta_anon]]) é reafirmar:
-- revogar de `anon` NOMINALMENTE, porque o ALTER DEFAULT PRIVILEGES do
-- Supabase concede EXECUTE a anon de forma explícita e REVOKE FROM public não
-- o remove.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.suspender_caixa(uuid, text)',
    'public.solicitar_fechamento_caixa(uuid, numeric, text)',
    'public.fechar_caixa_conferido(uuid, numeric, text, text)',
    'public.registrar_movimentacao_caixa(uuid, text, numeric, text)',
    'public.confirmar_fechamento_caixa(uuid, text, numeric)',
    'public.emitir_nota(text, text, text, uuid, text, numeric, text, uuid, uuid, date, text)',
    'public.expirar_competicoes()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rodar depois, nos 4 projetos — deve dar o mesmo em todos)
--
--   -- 1. gatilho aprendeu as duas colunas: espera 2
--   SELECT count(*) FROM (
--     SELECT unnest(ARRAY['desligado_em','ativo']) c
--   ) x WHERE pg_get_functiondef('public.user_profiles_bloquear_privesc()'::regprocedure)
--         LIKE '%NEW.' || x.c || ' IS DISTINCT FROM%';
--
--   -- 2. as seis RPCs passaram a ter guard: espera 6
--   SELECT count(*) FROM pg_proc p
--    WHERE p.pronamespace='public'::regnamespace
--      AND p.proname IN ('suspender_caixa','solicitar_fechamento_caixa',
--                        'fechar_caixa_conferido','registrar_movimentacao_caixa',
--                        'emitir_nota','expirar_competicoes')
--      AND pg_get_functiondef(p.oid) ~ '_assert_caixa|_assert_rpc|auth_is_admin';
--
--   -- 3. convergência entre turmas: os md5 têm de bater nos 4 projetos
--   SELECT proname, md5(pg_get_functiondef(oid))
--     FROM pg_proc WHERE pronamespace='public'::regnamespace
--      AND proname IN ('user_profiles_bloquear_privesc','_assert_caixa',
--                      'suspender_caixa','solicitar_fechamento_caixa',
--                      'fechar_caixa_conferido','registrar_movimentacao_caixa',
--                      'confirmar_fechamento_caixa','emitir_nota','expirar_competicoes')
--    ORDER BY 1;
--
-- TESTE MANUAL (F12, logado como aluno colaborador de UMA filial):
--   • update({desligado_em:null}) na própria linha  → 42501
--   • rpc('suspender_caixa', {p_controle_id:<id de outra filial>}) → 42501
--   • sangria no caixa da própria filial pelo PDV   → continua funcionando
-- ════════════════════════════════════════════════════════════════════════════
