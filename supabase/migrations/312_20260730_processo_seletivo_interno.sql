-- 312 — Processo Seletivo Interno (Fase 2 do Recrutamento & Seleção).
--
-- A 311 fechou a ENTRADA de gente nova. Falta o movimento que a régua
-- Matriz/Filial torna impossível hoje: promover quem já está dentro, e mover
-- alguém de uma unidade para outra.
--
-- O QUE MUDA EM RELAÇÃO À VAGA EXTERNA:
--   • O candidato já existe (`funcionarios`), não é digitado à mão.
--   • O resultado não é admissão — é cargo/salário/departamento novos, e às
--     vezes unidade nova.
--   • Vaga com `escopo = 'Interfilial'` busca candidato em TODA a rede. Isso
--     é decisão de holding por definição (filial não enxerga filial), então
--     só admin/CEO abre, candidata e efetiva.
--
-- A LINHA QUE ESTA MIGRAÇÃO NÃO CRUZA — e é o ponto mais importante daqui.
--
-- Promoção mexe em DUAS coisas que o LogMax mantém deliberadamente separadas:
--
--   `funcionarios.cargo`    — o cargo de RH ("Analista Pleno"). Texto do
--                             catálogo de Cargos. É o que esta migração muda.
--   `user_profiles.role`    — o privilégio de RBAC ('gerente'). É o que a
--                             migr. 258 protege com trigger BEFORE UPDATE.
--
-- Uma RPC SECURITY DEFINER **não** consegue mudar a segunda: `auth_is_service_role()`
-- lê o JWT da request, que segue sendo 'authenticated' mesmo dentro da função.
-- O trigger da 258 barra, e está certo — é exatamente a porta que a auditoria
-- do F12 fechou. Automatizar "virou Gerente de Loja no RH, então vira role
-- gerente no sistema" seria reabrir essa porta por conveniência.
--
-- Então: cargo, salário, departamento e filial do FUNCIONÁRIO mudam aqui,
-- numa transação. Acesso (role/setor/filial do LOGIN) continua passando por
-- `/api/users`, que é service_role e já tem o RBAC completo. A movimentação
-- nasce com `acesso_pendente` quando as duas pontas divergem, e
-- `marcar_acesso_ajustado` só fecha a pendência depois de CONFERIR no banco
-- que o login realmente mudou — não confia num flag da tela.
--
-- IDEMPOTENTE. Depende da 311. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — VAGA INTERNA
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vagas
  ADD COLUMN IF NOT EXISTS escopo text NOT NULL DEFAULT 'Filial';

-- `tipo` nasceu na 311 aceitando só 'Externa'. Abrir o CHECK é a mudança que
-- aquela migração já previa no comentário da coluna.
ALTER TABLE public.vagas DROP CONSTRAINT IF EXISTS chk_vaga_tipo;
DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_tipo
    CHECK (tipo IN ('Externa', 'Interna'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_escopo
    CHECK (escopo IN ('Filial', 'Interfilial'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Vaga externa não tem escopo interfilial: contratar de fora é sempre para
-- uma unidade. Sem esta regra, 'Externa' + 'Interfilial' seria um estado
-- válido no banco que nenhuma tela sabe interpretar.
DO $$
BEGIN
  ALTER TABLE public.vagas ADD CONSTRAINT chk_vaga_escopo_externa
    CHECK (tipo = 'Interna' OR escopo = 'Filial');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

COMMENT ON COLUMN public.vagas.escopo IS
  'Filial: candidatos da própria unidade. Interfilial: candidatos de toda a '
  'rede — só admin/CEO abre, candidata e efetiva. Migração 312.';

COMMENT ON COLUMN public.vagas.tipo IS
  'Externa: contrata de fora, cria funcionário (311). Interna: promove quem '
  'já está dentro, altera o funcionário existente (312).';

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — CANDIDATURA INTERNA
--
-- `funcionario_origem_id` (quem se candidata) é coluna NOVA e distinta de
-- `funcionario_id` (o resultado do processo). Na vaga externa o resultado é um
-- funcionário que ainda não existia; na interna as duas apontam para a mesma
-- pessoa no fim. Reusar uma coluna só apagaria a diferença entre "de onde
-- veio" e "no que deu".
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.candidaturas
  ADD COLUMN IF NOT EXISTS funcionario_origem_id uuid
    REFERENCES public.funcionarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidaturas_origem
  ON public.candidaturas (funcionario_origem_id);

-- Mesma pessoa não se candidata duas vezes à mesma vaga interna.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidatura_vaga_origem
  ON public.candidaturas (vaga_id, funcionario_origem_id)
  WHERE ativo AND funcionario_origem_id IS NOT NULL;

ALTER TABLE public.candidaturas DROP CONSTRAINT IF EXISTS chk_candidatura_etapa;
DO $$
BEGIN
  ALTER TABLE public.candidaturas ADD CONSTRAINT chk_candidatura_etapa
    CHECK (etapa IN ('Triagem', 'Entrevista', 'Teste', 'Aprovado', 'Reprovado',
                     'Contratado', 'Promovido'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — HISTÓRICO DE CARREIRA
--
-- Sem isto, promover seria um UPDATE que apaga o passado: o salário anterior
-- some, e a folha de dois meses atrás passa a não bater com nada explicável.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.movimentacoes_carreira (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id         uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  nome_funcionario       text,
  vaga_id                uuid REFERENCES public.vagas(id) ON DELETE SET NULL,
  candidatura_id         uuid REFERENCES public.candidaturas(id) ON DELETE SET NULL,
  tipo                   text NOT NULL,
  cargo_anterior         text,
  cargo_novo             text,
  departamento_anterior  text,
  departamento_novo      text,
  salario_anterior       numeric(12,2),
  salario_novo           numeric(12,2),
  filial_anterior        text NOT NULL,
  filial_nova            text NOT NULL,
  data_efeito            date NOT NULL,
  -- Snapshot do login no momento da promoção. NULL = funcionário sem acesso,
  -- e aí não há o que ajustar.
  user_profile_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acesso_pendente        boolean NOT NULL DEFAULT false,
  decidido_por           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome      text,
  ativo                  boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.movimentacoes_carreira ADD CONSTRAINT chk_movimentacao_tipo
    CHECK (tipo IN ('Promoção', 'Transferência', 'Promoção e Transferência'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_funcionario
  ON public.movimentacoes_carreira (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_filial
  ON public.movimentacoes_carreira (filial_nova);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_pendentes
  ON public.movimentacoes_carreira (acesso_pendente) WHERE acesso_pendente;

ALTER TABLE public.movimentacoes_carreira ENABLE ROW LEVEL SECURITY;

-- Leitura pelas DUAS pontas da transferência: quem perdeu e quem ganhou a
-- pessoa precisam ver o movimento. Escopar só por `filial_nova` esconderia da
-- unidade de origem o motivo de alguém ter sumido do quadro dela.
DROP POLICY IF EXISTS movimentacoes_carreira_select ON public.movimentacoes_carreira;
CREATE POLICY movimentacoes_carreira_select ON public.movimentacoes_carreira
  FOR SELECT TO authenticated
  USING (
    (
      (public.auth_in_setor('rh') OR public.auth_gerente_da(filial_nova)
                                  OR public.auth_gerente_da(filial_anterior))
      AND (public.auth_pode_filial(filial_nova) OR public.auth_pode_filial(filial_anterior))
    )
    -- A própria pessoa vê o próprio histórico de carreira, como em `rescisoes`.
    OR user_profile_id = auth.uid()
  );

-- Escrita só por RPC. Sem policy de INSERT/UPDATE/DELETE, como nas 3 tabelas
-- da 311.

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- 4.0 Guard do escopo interfilial.
--
-- `_assert_recrutamento` autoriza pela filial da vaga — e para a vaga
-- interfilial isso não basta: o RH da unidade de destino passaria nele e
-- poderia puxar gente de uma filial que ele nem enxerga (a RPC é SECURITY
-- DEFINER, a RLS não o segura lá dentro). Mover pessoa entre unidades é da
-- holding, mesma régua de `decidir_vaga`.
CREATE OR REPLACE FUNCTION public._assert_interfilial()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.auth_is_service_role() THEN
    RETURN;
  END IF;

  IF COALESCE(public.auth_user_role(), '') NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Movimentação entre unidades é decisão da Matriz — só admin ou CEO.'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_interfilial() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_interfilial() TO authenticated, service_role;

-- 4.1 Abrir vaga interna
--
-- Função separada de `abrir_vaga` de propósito: acrescentar parâmetros com
-- DEFAULT àquela criaria uma sobrecarga, e o PostgREST recusa chamar função
-- ambígua (PGRST203). Duas funções com nomes distintos é o caminho que não
-- quebra o que já está em produção nas 4 turmas.
CREATE OR REPLACE FUNCTION public.abrir_vaga_interna(
  p_filial        text,
  p_cargo         text,
  p_justificativa text,
  p_escopo        text    DEFAULT 'Filial',
  p_departamento  text    DEFAULT NULL,
  p_quantidade    integer DEFAULT 1,
  p_salario_min   numeric DEFAULT NULL,
  p_salario_max   numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id   uuid;
  v_nome text;
BEGIN
  IF p_escopo NOT IN ('Filial', 'Interfilial') THEN
    RAISE EXCEPTION 'Escopo inválido: %. Use Filial ou Interfilial.', p_escopo
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._assert_recrutamento(p_filial);

  IF p_escopo = 'Interfilial' THEN
    PERFORM public._assert_interfilial();
  END IF;

  IF COALESCE(btrim(p_cargo), '') = '' THEN
    RAISE EXCEPTION 'Informe o cargo da vaga.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(p_justificativa), '') = '' THEN
    RAISE EXCEPTION 'Justifique a abertura do processo interno.' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_quantidade, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;

  IF p_salario_min IS NOT NULL AND p_salario_max IS NOT NULL AND p_salario_min > p_salario_max THEN
    RAISE EXCEPTION 'Salário mínimo não pode ser maior que o máximo.' USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.vagas
    (filial, cargo, departamento, tipo, escopo, quantidade, salario_min, salario_max,
     justificativa, criado_por, criado_por_nome)
  VALUES
    (p_filial, btrim(p_cargo), p_departamento, 'Interna', p_escopo, p_quantidade,
     p_salario_min, p_salario_max, btrim(p_justificativa), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  PERFORM public.notificar_setor(
    'rh', 'aprovacao', 'Processo interno aguardando aprovação',
    v_nome || ' abriu ' || p_quantidade || 'x ' || btrim(p_cargo)
      || ' (' || p_filial || ', ' || p_escopo || ')',
    'rh-recrutamentoeseleção', 'Média', v_id, NULL, p_filial
  );

  RETURN jsonb_build_object('ok', true, 'vaga_id', v_id, 'escopo', p_escopo);
END;
$function$;

REVOKE ALL ON FUNCTION public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_vaga_interna(text, text, text, text, text, integer, numeric, numeric) TO authenticated;

-- 4.2 Inscrever funcionário numa vaga interna
CREATE OR REPLACE FUNCTION public.registrar_candidatura_interna(
  p_vaga_id        uuid,
  p_funcionario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vaga record;
  v_f    record;
  v_id   uuid;
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.tipo <> 'Interna' THEN
    RAISE EXCEPTION 'Esta vaga é externa — use registrar_candidatura.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.status <> 'Aprovada' THEN
    RAISE EXCEPTION 'Só é possível inscrever em vaga Aprovada (esta está %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_f FROM public.funcionarios
   WHERE id = p_funcionario_id AND COALESCE(ativo, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado ou inativo.' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_f.status, 'Ativo') <> 'Ativo' THEN
    RAISE EXCEPTION '% está com status % — só funcionário Ativo entra em processo interno.',
      v_f.nome, COALESCE(v_f.status, 'Ativo') USING ERRCODE = 'P0001';
  END IF;

  -- Desligado com demissão viva não se candidata, mesmo que `status` tenha
  -- ficado para trás por edição manual.
  IF EXISTS (SELECT 1 FROM public.demissoes WHERE funcionario_id = p_funcionario_id AND ativo) THEN
    RAISE EXCEPTION '% está desligado.', v_f.nome USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.escopo = 'Filial' THEN
    IF COALESCE(v_f.filial, '') <> v_vaga.filial THEN
      RAISE EXCEPTION 'Vaga de escopo Filial só aceita candidato da unidade % (este é de %).',
        v_vaga.filial, COALESCE(v_f.filial, '—') USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Interfilial: puxar gente de outra unidade é da holding.
    PERFORM public._assert_interfilial();
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.candidaturas
    (vaga_id, filial, nome, cpf, email, telefone, funcionario_origem_id,
     criado_por, criado_por_nome)
  VALUES
    (p_vaga_id, v_vaga.filial, v_f.nome, v_f.cpf, v_f.email, v_f.telefone, p_funcionario_id,
     auth.uid(), v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (v_id, NULL, 'Triagem',
          'Inscrição interna — ' || COALESCE(v_f.cargo, 'sem cargo') || ' em ' || COALESCE(v_f.filial, '—'),
          auth.uid(), v_nome);

  RETURN jsonb_build_object('ok', true, 'candidatura_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_candidatura_interna(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_candidatura_interna(uuid, uuid) TO authenticated;

-- 4.3 Efetivar a promoção
CREATE OR REPLACE FUNCTION public.efetivar_promocao(
  p_candidatura_id uuid,
  p_salario        numeric,
  p_data_efeito    date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c           record;
  v_vaga        record;
  v_f           record;
  v_nome        text;
  v_data        date;
  v_promovidos  integer;
  v_muda_filial boolean;
  v_tipo        text;
  v_pendente    boolean;
  v_mov_id      uuid;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_c FROM public.candidaturas
   WHERE id = p_candidatura_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_c.funcionario_origem_id IS NULL THEN
    RAISE EXCEPTION 'Esta candidatura é externa — use efetivar_contratacao.' USING ERRCODE = 'P0001';
  END IF;

  IF v_c.etapa <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só é possível promover candidatura na etapa Aprovado (esta está %).', v_c.etapa
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vaga FROM public.vagas WHERE id = v_c.vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga da candidatura não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.status NOT IN ('Aprovada', 'Preenchida') THEN
    RAISE EXCEPTION 'Vaga não está mais disponível (status %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_f FROM public.funcionarios
   WHERE id = v_c.funcionario_origem_id AND COALESCE(ativo, true) FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário da candidatura não encontrado ou inativo.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.demissoes WHERE funcionario_id = v_f.id AND ativo) THEN
    RAISE EXCEPTION '% foi desligado durante o processo — não há o que promover.', v_f.nome
      USING ERRCODE = 'P0001';
  END IF;

  v_muda_filial := COALESCE(v_f.filial, '') IS DISTINCT FROM v_vaga.filial;

  -- Mover de unidade é da Matriz, mesmo que o funil tenha sido conduzido pelo
  -- RH da unidade de destino.
  IF v_muda_filial THEN
    PERFORM public._assert_interfilial();
  END IF;

  SELECT count(*) INTO v_promovidos
    FROM public.candidaturas WHERE vaga_id = v_vaga.id AND etapa = 'Promovido';

  IF v_promovidos >= v_vaga.quantidade THEN
    RAISE EXCEPTION 'Vaga já preencheu as % posições aprovadas.', v_vaga.quantidade
      USING ERRCODE = 'P0001';
  END IF;

  IF p_salario IS NULL OR p_salario <= 0 THEN
    RAISE EXCEPTION 'Informe o novo salário.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_min IS NOT NULL AND p_salario < v_vaga.salario_min THEN
    RAISE EXCEPTION 'Salário abaixo da faixa aprovada (mínimo %).', v_vaga.salario_min
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_max IS NOT NULL AND p_salario > v_vaga.salario_max THEN
    RAISE EXCEPTION 'Salário acima da faixa aprovada (máximo %).', v_vaga.salario_max
      USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data_efeito, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  v_tipo := CASE
    WHEN v_muda_filial AND COALESCE(v_f.cargo, '') IS DISTINCT FROM v_vaga.cargo
      THEN 'Promoção e Transferência'
    WHEN v_muda_filial THEN 'Transferência'
    ELSE 'Promoção'
  END;

  -- O login continua onde estava: `user_profiles` só muda por service_role
  -- (trigger da migr. 258). Ver o cabeçalho desta migração.
  v_pendente := v_f.user_profile_id IS NOT NULL AND v_muda_filial;

  INSERT INTO public.movimentacoes_carreira (
    funcionario_id, nome_funcionario, vaga_id, candidatura_id, tipo,
    cargo_anterior, cargo_novo, departamento_anterior, departamento_novo,
    salario_anterior, salario_novo, filial_anterior, filial_nova,
    data_efeito, user_profile_id, acesso_pendente, decidido_por, decidido_por_nome
  ) VALUES (
    v_f.id, v_f.nome, v_vaga.id, p_candidatura_id, v_tipo,
    v_f.cargo, v_vaga.cargo,
    v_f.departamento, COALESCE(v_vaga.departamento, v_f.departamento),
    v_f.salario, p_salario,
    COALESCE(v_f.filial, v_vaga.filial), v_vaga.filial,
    v_data, v_f.user_profile_id, v_pendente, auth.uid(), v_nome
  )
  RETURNING id INTO v_mov_id;

  -- `departamento` só é sobrescrito quando a vaga declara um: vaga sem
  -- departamento não deve zerar o que o funcionário já tinha.
  UPDATE public.funcionarios
     SET cargo        = v_vaga.cargo,
         departamento = COALESCE(v_vaga.departamento, departamento),
         salario      = p_salario,
         filial       = v_vaga.filial,
         updated_at   = now()
   WHERE id = v_f.id;

  UPDATE public.candidaturas
     SET etapa = 'Promovido', funcionario_id = v_f.id, updated_at = now()
   WHERE id = p_candidatura_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (p_candidatura_id, 'Aprovado', 'Promovido',
          v_tipo || ' em ' || to_char(v_data, 'DD/MM/YYYY')
            || ' — ' || COALESCE(v_f.cargo, 'sem cargo') || ' → ' || v_vaga.cargo,
          auth.uid(), v_nome);

  IF v_promovidos + 1 >= v_vaga.quantidade THEN
    UPDATE public.vagas SET status = 'Preenchida', updated_at = now() WHERE id = v_vaga.id;
  END IF;

  IF v_pendente THEN
    PERFORM public.notificar_setor(
      'rh', 'alerta', 'Acesso pendente após transferência',
      v_f.nome || ' passou para ' || v_vaga.filial
        || ', mas o login continua em ' || COALESCE(v_f.filial, '—')
        || '. Ajuste em Usuários para o acesso acompanhar.',
      'rh-recrutamentoeseleção', 'Alta', v_mov_id, NULL, v_vaga.filial
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movimentacao_id', v_mov_id,
    'funcionario_id', v_f.id,
    'tipo', v_tipo,
    'user_profile_id', v_f.user_profile_id,
    'filial_anterior', v_f.filial,
    'filial_nova', v_vaga.filial,
    -- A tela usa isto para oferecer o ajuste em /api/users logo em seguida.
    'acesso_pendente', v_pendente,
    'vaga_preenchida', (v_promovidos + 1 >= v_vaga.quantidade)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.efetivar_promocao(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.efetivar_promocao(uuid, numeric, date) TO authenticated;

-- 4.4 Fechar a pendência de acesso — conferindo, não confiando
--
-- Não recebe "já ajustei" como verdade: relê `user_profiles` e só baixa a
-- flag se o login realmente está na unidade nova. Um botão que apenas marca
-- resolvido seria pior que pendência nenhuma — esconderia o problema.
CREATE OR REPLACE FUNCTION public.marcar_acesso_ajustado(p_movimentacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_m           record;
  v_filial_atual text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_m FROM public.movimentacoes_carreira
   WHERE id = p_movimentacao_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimentação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_m.filial_nova);

  IF NOT v_m.acesso_pendente THEN
    RETURN jsonb_build_object('ok', true, 'acesso_pendente', false, 'ja_estava', true);
  END IF;

  IF v_m.user_profile_id IS NULL THEN
    UPDATE public.movimentacoes_carreira
       SET acesso_pendente = false, updated_at = now()
     WHERE id = p_movimentacao_id;
    RETURN jsonb_build_object('ok', true, 'acesso_pendente', false, 'sem_login', true);
  END IF;

  SELECT filial INTO v_filial_atual
    FROM public.user_profiles WHERE id = v_m.user_profile_id;

  IF COALESCE(v_filial_atual, '') IS DISTINCT FROM v_m.filial_nova THEN
    RAISE EXCEPTION
      'O login ainda está em % — ajuste a filial em Usuários antes de fechar a pendência.',
      COALESCE(v_filial_atual, 'nenhuma unidade')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.movimentacoes_carreira
     SET acesso_pendente = false, updated_at = now()
   WHERE id = p_movimentacao_id;

  RETURN jsonb_build_object('ok', true, 'acesso_pendente', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_acesso_ajustado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_acesso_ajustado(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 5 — FECHAR AS TRÊS FRESTAS QUE A VAGA INTERNA ABRIU NA 311
--
-- As RPCs da 311 foram escritas quando só existia vaga Externa, e por isso não
-- perguntam nem o tipo da vaga nem a origem da candidatura. Com a vaga Interna
-- existindo, cada uma dessas omissões vira um caminho errado utilizável — não
-- pela tela, que roteia certo, mas por um POST direto do DevTools, que é
-- exatamente o que esta turma faz (foi o que gerou as migrs. 258/260/261).
--
--   1. `registrar_candidatura` aceitaria um candidato digitado à mão numa vaga
--      INTERNA, criando candidatura sem `funcionario_origem_id` — que depois
--      nenhuma das duas RPCs de efetivação sabe processar.
--
--   2. `efetivar_contratacao` aceitaria uma candidatura INTERNA e criaria um
--      funcionário NOVO em vez de promover o existente: a pessoa passaria a
--      ter dois cadastros, duas folhas e, no fim, duas rescisões. A checagem
--      de CPF duplicado da 311 pega o caso comum, mas não o funcionário sem
--      CPF nem e-mail preenchidos.
--
--   3. `mover_candidatura` trata só 'Contratado' como etapa final. 'Promovido'
--      nasceu nesta migração e ficou de fora: dava para mover um promovido de
--      volta para 'Aprovado' e promovê-lo de novo — e como `efetivar_promocao`
--      conta as posições preenchidas por `etapa = 'Promovido'`, a contagem
--      caía junto e a vaga aceitava mais gente do que a Matriz aprovou.
--
-- Mesma assinatura das originais, então é substituição limpa.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_candidatura(
  p_vaga_id        uuid,
  p_nome           text,
  p_cpf            text DEFAULT NULL,
  p_email          text DEFAULT NULL,
  p_telefone       text DEFAULT NULL,
  p_link_curriculo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vaga  record;
  v_id    uuid;
  v_nome  text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_vaga FROM public.vagas WHERE id = p_vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  -- NOVO na 312.
  IF COALESCE(v_vaga.tipo, 'Externa') <> 'Externa' THEN
    RAISE EXCEPTION 'Esta vaga é interna — use registrar_candidatura_interna.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.status <> 'Aprovada' THEN
    RAISE EXCEPTION 'Só é possível candidatar em vaga Aprovada (esta está %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do candidato.' USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.candidaturas
    (vaga_id, filial, nome, cpf, email, telefone, link_curriculo, criado_por, criado_por_nome)
  VALUES
    (p_vaga_id, v_vaga.filial, btrim(p_nome), NULLIF(btrim(p_cpf), ''), NULLIF(btrim(p_email), ''),
     NULLIF(btrim(p_telefone), ''), NULLIF(btrim(p_link_curriculo), ''), auth.uid(), v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, registrado_por, registrado_por_nome)
  VALUES (v_id, NULL, 'Triagem', auth.uid(), v_nome);

  RETURN jsonb_build_object('ok', true, 'candidatura_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_candidatura(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_candidatura(uuid, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mover_candidatura(
  p_candidatura_id uuid,
  p_etapa          text,
  p_observacao     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c    record;
  v_nome text;
BEGIN
  PERFORM public._assert_rpc();

  IF p_etapa NOT IN ('Triagem', 'Entrevista', 'Teste', 'Aprovado', 'Reprovado') THEN
    RAISE EXCEPTION 'Etapa inválida: %. Use efetivar_contratacao ou efetivar_promocao para fechar.', p_etapa
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_c FROM public.candidaturas WHERE id = p_candidatura_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_c.filial);

  -- 'Promovido' entrou na lista: era a fresta que deixava reabrir e recontar
  -- uma promoção já efetivada.
  IF v_c.etapa IN ('Contratado', 'Promovido') THEN
    RAISE EXCEPTION 'Candidatura já finalizada como % — etapa final.', v_c.etapa
      USING ERRCODE = 'P0001';
  END IF;

  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  UPDATE public.candidaturas
     SET etapa = p_etapa, parecer = COALESCE(p_observacao, parecer), updated_at = now()
   WHERE id = p_candidatura_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (p_candidatura_id, v_c.etapa, p_etapa, p_observacao, auth.uid(), v_nome);

  RETURN jsonb_build_object('ok', true, 'etapa', p_etapa);
END;
$function$;

REVOKE ALL ON FUNCTION public.mover_candidatura(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mover_candidatura(uuid, text, text) TO authenticated;

-- `efetivar_contratacao` ganha só o guard de origem; o resto do corpo é o da
-- 311, que já está correto.
CREATE OR REPLACE FUNCTION public.efetivar_contratacao(
  p_candidatura_id uuid,
  p_salario        numeric,
  p_data_admissao  date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c            record;
  v_vaga         record;
  v_nome         text;
  v_data         date;
  v_funcionario  uuid;
  v_contratados  integer;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_c FROM public.candidaturas WHERE id = p_candidatura_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- NOVO na 312: candidatura interna promove, não admite.
  IF v_c.funcionario_origem_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta candidatura é interna — use efetivar_promocao. Contratar aqui criaria um segundo cadastro para quem já é funcionário.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c.etapa <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só é possível contratar candidatura na etapa Aprovado (esta está %).', v_c.etapa
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_vaga FROM public.vagas WHERE id = v_c.vaga_id AND ativo FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga da candidatura não encontrada ou inativa.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._assert_recrutamento(v_vaga.filial);

  IF v_vaga.status NOT IN ('Aprovada', 'Preenchida') THEN
    RAISE EXCEPTION 'Vaga não está mais disponível para contratação (status %).', v_vaga.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_contratados
    FROM public.candidaturas WHERE vaga_id = v_vaga.id AND etapa = 'Contratado';

  IF v_contratados >= v_vaga.quantidade THEN
    RAISE EXCEPTION 'Vaga já preencheu as % posições aprovadas.', v_vaga.quantidade
      USING ERRCODE = 'P0001';
  END IF;

  IF p_salario IS NULL OR p_salario <= 0 THEN
    RAISE EXCEPTION 'Informe o salário de admissão.' USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_min IS NOT NULL AND p_salario < v_vaga.salario_min THEN
    RAISE EXCEPTION 'Salário abaixo da faixa aprovada (mínimo %).', v_vaga.salario_min
      USING ERRCODE = 'P0001';
  END IF;

  IF v_vaga.salario_max IS NOT NULL AND p_salario > v_vaga.salario_max THEN
    RAISE EXCEPTION 'Salário acima da faixa aprovada (máximo %).', v_vaga.salario_max
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c.cpf IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.funcionarios
     WHERE cpf = v_c.cpf AND COALESCE(ativo, true) AND COALESCE(status, 'Ativo') <> 'Desligado'
  ) THEN
    RAISE EXCEPTION 'Já existe funcionário ativo com o CPF %.', v_c.cpf
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.funcionarios
     WHERE lower(email) = lower(v_c.email) AND COALESCE(ativo, true) AND COALESCE(status, 'Ativo') <> 'Desligado'
  ) THEN
    RAISE EXCEPTION 'Já existe funcionário ativo com o e-mail %.', v_c.email
      USING ERRCODE = 'P0001';
  END IF;

  IF v_c.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE lower(email) = lower(v_c.email)
       AND filial IS NOT NULL AND filial <> v_vaga.filial
  ) THEN
    RAISE EXCEPTION
      'O e-mail % já tem login em outra unidade. Contratar aqui moveria o cadastro para lá — corrija o e-mail do candidato ou trate como movimentação interna.',
      v_c.email USING ERRCODE = 'P0001';
  END IF;

  v_data := COALESCE(p_data_admissao, (now() AT TIME ZONE 'America/Rio_Branco')::date);
  v_nome := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  INSERT INTO public.funcionarios
    (nome, cpf, email, telefone, cargo, departamento, salario, data_admissao, status, filial)
  VALUES
    (v_c.nome, v_c.cpf, v_c.email, v_c.telefone, v_vaga.cargo, v_vaga.departamento,
     p_salario, v_data, 'Ativo', v_vaga.filial)
  RETURNING id INTO v_funcionario;

  UPDATE public.candidaturas
     SET etapa = 'Contratado', funcionario_id = v_funcionario, updated_at = now()
   WHERE id = p_candidatura_id;

  INSERT INTO public.candidatura_etapas
    (candidatura_id, etapa_anterior, etapa_nova, observacao, registrado_por, registrado_por_nome)
  VALUES (p_candidatura_id, 'Aprovado', 'Contratado',
          'Admissão em ' || to_char(v_data, 'DD/MM/YYYY') || ' — R$ ' || p_salario,
          auth.uid(), v_nome);

  IF v_contratados + 1 >= v_vaga.quantidade THEN
    UPDATE public.vagas SET status = 'Preenchida', updated_at = now() WHERE id = v_vaga.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'funcionario_id', v_funcionario,
    'vaga_preenchida', (v_contratados + 1 >= v_vaga.quantidade)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.efetivar_contratacao(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.efetivar_contratacao(uuid, numeric, date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- Verificação:
--
--   -- Vagas internas por escopo:
--   SELECT filial, cargo, escopo, status FROM vagas WHERE tipo = 'Interna';
--
--   -- Candidatos internos de uma vaga (vêm de funcionarios, não digitados):
--   SELECT c.nome, f.cargo AS cargo_atual, f.filial, c.etapa
--     FROM candidaturas c JOIN funcionarios f ON f.id = c.funcionario_origem_id
--    WHERE c.vaga_id = '<vaga_id>';
--
--   -- Trilha de carreira de uma pessoa:
--   SELECT data_efeito, tipo, cargo_anterior, cargo_novo,
--          salario_anterior, salario_novo, filial_anterior, filial_nova
--     FROM movimentacoes_carreira
--    WHERE funcionario_id = '<func_id>' ORDER BY data_efeito;
--
--   -- Transferências cujo LOGIN ainda não acompanhou (a fila que importa):
--   SELECT m.nome_funcionario, m.filial_anterior, m.filial_nova, up.filial AS filial_login
--     FROM movimentacoes_carreira m
--     JOIN user_profiles up ON up.id = m.user_profile_id
--    WHERE m.acesso_pendente;
--
--   -- Nenhuma vaga externa pode ter escopo interfilial:
--   SELECT count(*) FROM vagas WHERE tipo = 'Externa' AND escopo <> 'Filial';  -- 0
-- ────────────────────────────────────────────────────────────────────────────
