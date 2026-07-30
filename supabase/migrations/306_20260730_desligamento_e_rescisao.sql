-- 306 — Desligamento e Rescisão.
--
-- Fecha o ciclo de vida do colaborador, que até aqui só tinha entrada. Demitir
-- era editar `funcionarios.status` para um texto qualquer: não guardava motivo,
-- não guardava quem decidiu, não tirava o acesso e não pagava nada.
--
-- Esta migração traz as duas partes estáticas:
--
--   1. REGISTRO   — `demissoes` (o evento) e `rescisoes` (as contas).
--   2. CÁLCULO    — verbas dos 4 tipos da CLT, em RPC pura, sem gravar.
--
-- As RPCs de decisão (demitir, readmitir, processar, pagar) e o corte de
-- acesso vêm na 307, que depende das tabelas criadas aqui.
--
-- SOBRE O CORTE DE ACESSO, que é a parte com risco. O bloqueio NÃO mora na tela: um
-- modal se fecha pelo DevTools, e esta turma já provou que mexe em F12 (foi o
-- que gerou as migrs. 258/260/261). A régua entra nas quatro funções que o
-- RBAC inteiro consulta — `auth_user_role`, `auth_user_filial`,
-- `auth_user_setores` e `auth_is_admin`. Todas leem `user_profiles`; passam a
-- ignorar a linha de quem tem `desligado_em` preenchido.
--
-- O efeito se propaga sozinho: `auth_in_setor` e `auth_pode_filial` chamam
-- essas quatro, e as duas juntas aparecem em 116 das 228 policies de escrita
-- do projeto. Somando as que chamam `auth_is_admin` direto, o desligado perde
-- leitura e escrita em praticamente tudo sem que a 307 precise tocar em policy
-- nenhuma. Sobram as policies escopadas por `auth.uid()` — o próprio perfil,
-- as próprias notificações —, que continuam abertas de propósito: é o que
-- permite a tela carregar e o modal aparecer.
--
-- A coluna `user_profiles.desligado_em` que sustenta isso nasce aqui.
--
-- CONTEXTO DIDÁTICO. LogMax é plataforma de ensino. O cálculo abaixo é fiel o
-- bastante para ensinar por que "pedir as contas" rende menos que ser mandado
-- embora, e deliberadamente simplificado em FGTS e nas tabelas de INSS/IRRF —
-- não serve para rescisão real e não pretende servir.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — REGISTRO
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.demissoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id      uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  -- Snapshot do nome, no mesmo motivo dos pedidos (project_pedido_snapshot):
  -- a lista de desligados precisa dizer quem saiu mesmo que o cadastro seja
  -- renomeado ou apagado depois.
  nome_funcionario    text,
  filial              text NOT NULL,
  tipo                text NOT NULL,
  motivo              text NOT NULL,
  data_desligamento   date NOT NULL,
  aviso_previo        text NOT NULL DEFAULT 'Indenizado',
  observacao          text,
  decidido_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome   text,
  ativo               boolean NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.demissoes ADD CONSTRAINT chk_demissao_tipo
    CHECK (tipo IN ('Sem justa causa', 'Com justa causa', 'Pedido de demissão', 'Acordo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.demissoes ADD CONSTRAINT chk_demissao_aviso
    CHECK (aviso_previo IN ('Indenizado', 'Trabalhado', 'Não cumprido', 'Não se aplica'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Motivo em branco é o mesmo que não ter motivo: a régua toda desta tela é
-- obrigar alguém a escrever por quê.
DO $$
BEGIN
  ALTER TABLE public.demissoes ADD CONSTRAINT chk_demissao_motivo_nao_vazio
    CHECK (btrim(motivo) <> '');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Um desligamento ativo por pessoa. Parcial em `ativo` — readmitido inativa a
-- linha antiga, e sem o WHERE ela travaria o próximo desligamento
-- (ver o caso do controle_caixa em feedback_partial_unique_soft_delete).
CREATE UNIQUE INDEX IF NOT EXISTS uq_demissao_ativa_por_funcionario
  ON public.demissoes (funcionario_id) WHERE ativo;

CREATE INDEX IF NOT EXISTS idx_demissoes_filial ON public.demissoes (filial) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.rescisoes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demissao_id            uuid NOT NULL REFERENCES public.demissoes(id) ON DELETE CASCADE,
  funcionario_id         uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  -- Snapshot do perfil de acesso. A policy que deixa a pessoa ver a PRÓPRIA
  -- rescisão compara com esta coluna, não com um JOIN em `funcionarios`: o
  -- vínculo entre as duas tabelas é assimétrico (28 funcionários apontam para
  -- um perfil, mas só 15 perfis apontam de volta), e a policy `func_self` usa
  -- justamente o lado furado. Sem isto, metade dos desligados não enxergaria a
  -- própria rescisão.
  user_profile_id        uuid,
  filial                 text NOT NULL,

  -- Fotografia do que alimentou a conta. Sem isso, mudar o salário do
  -- funcionário depois reescreveria uma rescisão já paga.
  salario_base           numeric(15,2) NOT NULL DEFAULT 0,
  data_admissao          date,
  data_desligamento      date,
  meses_trabalhados      integer NOT NULL DEFAULT 0,
  dias_aviso             integer NOT NULL DEFAULT 0,

  -- Verbas
  saldo_salario          numeric(15,2) NOT NULL DEFAULT 0,
  aviso_previo_valor     numeric(15,2) NOT NULL DEFAULT 0,
  decimo_terceiro        numeric(15,2) NOT NULL DEFAULT 0,
  ferias_vencidas        numeric(15,2) NOT NULL DEFAULT 0,
  ferias_proporcionais   numeric(15,2) NOT NULL DEFAULT 0,
  terco_ferias           numeric(15,2) NOT NULL DEFAULT 0,
  multa_fgts             numeric(15,2) NOT NULL DEFAULT 0,
  fgts_depositado        numeric(15,2) NOT NULL DEFAULT 0,

  -- Descontos
  desconto_inss          numeric(15,2) NOT NULL DEFAULT 0,
  desconto_irrf          numeric(15,2) NOT NULL DEFAULT 0,
  desconto_aviso         numeric(15,2) NOT NULL DEFAULT 0,

  total_bruto            numeric(15,2) NOT NULL DEFAULT 0,
  total_descontos        numeric(15,2) NOT NULL DEFAULT 0,
  total_liquido          numeric(15,2) NOT NULL DEFAULT 0,

  status                 text NOT NULL DEFAULT 'Pendente',
  conta_pagar_id         uuid,
  ativo                  boolean NOT NULL DEFAULT true,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.rescisoes ADD CONSTRAINT chk_rescisao_status
    CHECK (status IN ('Pendente', 'Processada', 'Paga'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rescisao_ativa_por_demissao
  ON public.rescisoes (demissao_id) WHERE ativo;

-- Vínculo relacional com a despesa, no mesmo desenho que a 269 deu à folha
-- (lá o vínculo era regex na descrição, e editar a descrição matava o vínculo).
ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS rescisao_id uuid REFERENCES public.rescisoes(id) ON DELETE SET NULL;

-- Marca de desligamento no perfil de acesso. Fica em user_profiles, não em
-- funcionarios, porque quem tem ou não tem acesso é o perfil — e é ele que as
-- funções de RBAC leem.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS desligado_em timestamptz;

COMMENT ON COLUMN public.user_profiles.desligado_em IS
  'Preenchido = vínculo encerrado. As funções auth_user_role/filial/setores e '
  'auth_is_admin ignoram a linha, o que derruba leitura e escrita em toda '
  'policy escopada por setor, filial ou admin. Migração 306.';

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — CÁLCULO
--
-- Pura: recebe os parâmetros, devolve o demonstrativo, não grava nada. Serve
-- ao preview da tela antes de confirmar e ao próprio `demitir_funcionario`.
-- ════════════════════════════════════════════════════════════════════════════

-- INSS progressivo por faixa. Valores didáticos, não vinculados a competência.
CREATE OR REPLACE FUNCTION public._inss_simplificado(p_base numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT ROUND(
      LEAST(p_base, 1518.00) * 0.075
    + GREATEST(LEAST(p_base, 2793.88) - 1518.00, 0) * 0.09
    + GREATEST(LEAST(p_base, 4190.83) - 2793.88, 0) * 0.12
    + GREATEST(LEAST(p_base, 8157.41) - 4190.83, 0) * 0.14
  , 2);
$function$;

-- IRRF por faixa com parcela a deduzir. Idem: didático.
CREATE OR REPLACE FUNCTION public._irrf_simplificado(p_base numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT GREATEST(ROUND(
    CASE
      WHEN p_base <= 2259.20 THEN 0
      WHEN p_base <= 2826.65 THEN p_base * 0.075 - 169.44
      WHEN p_base <= 3751.05 THEN p_base * 0.150 - 381.44
      WHEN p_base <= 4664.68 THEN p_base * 0.225 - 662.77
      ELSE                       p_base * 0.275 - 896.00
    END
  , 2), 0);
$function$;

REVOKE ALL ON FUNCTION public._inss_simplificado(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._irrf_simplificado(numeric) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.calcular_rescisao(
  p_funcionario_id  uuid,
  p_tipo            text,
  p_data            date DEFAULT NULL,
  p_aviso_previo    text DEFAULT 'Indenizado'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome        text;
  v_filial      text;
  v_salario     numeric(15,2);
  v_admissao    date;
  v_data        date;
  v_dia         numeric;

  v_anos_completos  int;
  v_meses_total     int;
  v_meses_ano       int;      -- meses no ano do desligamento (13º)
  v_meses_aquisit   int;      -- meses desde o último aniversário (férias prop.)
  v_ferias_gozadas  int;
  v_periodos_venc   int;

  v_dias_aviso  int := 0;
  v_saldo       numeric(15,2) := 0;
  v_aviso       numeric(15,2) := 0;
  v_decimo      numeric(15,2) := 0;
  v_fer_venc    numeric(15,2) := 0;
  v_fer_prop    numeric(15,2) := 0;
  v_terco       numeric(15,2) := 0;
  v_fgts_dep    numeric(15,2) := 0;
  v_multa       numeric(15,2) := 0;

  v_base_trib   numeric(15,2) := 0;
  v_inss        numeric(15,2) := 0;
  v_irrf        numeric(15,2) := 0;
  v_desc_aviso  numeric(15,2) := 0;

  v_bruto       numeric(15,2);
  v_descontos   numeric(15,2);
  v_liquido     numeric(15,2);
BEGIN
  -- A função lê `funcionarios.salario`. Sem este guard, qualquer autenticado
  -- enumeraria os ids e leria o salário de todo mundo pela porta de uma RPC de
  -- "simulação" — que é o tipo de fresta que a 260 encontrou aberta.
  PERFORM public._assert_rpc('rh');

  IF p_tipo NOT IN ('Sem justa causa', 'Com justa causa', 'Pedido de demissão', 'Acordo') THEN
    RAISE EXCEPTION 'Tipo de desligamento inválido: %.', p_tipo USING ERRCODE = 'P0001';
  END IF;

  SELECT nome, COALESCE(filial, 'Matriz'), COALESCE(salario, 0), data_admissao
    INTO v_nome, v_filial, v_salario, v_admissao
    FROM public.funcionarios
   WHERE id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  v_data := COALESCE(p_data, (now() AT TIME ZONE 'America/Rio_Branco')::date);

  IF v_salario <= 0 THEN
    RAISE EXCEPTION 'Salário do funcionário está zerado. Preencha em RH → Funcionários antes de calcular a rescisão.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Sem data de admissão não há tempo de casa, e tempo de casa é o que move
  -- quase toda verba. Melhor recusar do que devolver número inventado.
  IF v_admissao IS NULL THEN
    RAISE EXCEPTION 'Funcionário sem data de admissão. Preencha em RH → Funcionários antes de calcular a rescisão.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_data < v_admissao THEN
    RAISE EXCEPTION 'Desligamento (%) não pode ser anterior à admissão (%).', v_data, v_admissao
      USING ERRCODE = 'P0001';
  END IF;

  v_dia            := ROUND(v_salario / 30.0, 2);
  v_meses_total    := GREATEST((EXTRACT(YEAR FROM age(v_data, v_admissao)) * 12
                              + EXTRACT(MONTH FROM age(v_data, v_admissao)))::int, 0);
  v_anos_completos := v_meses_total / 12;

  -- 13º: meses do ano corrente com 15 dias ou mais trabalhados.
  --
  -- Os dois extremos entram na conta pela mesma régua, e é aí que a versão
  -- ingênua erra: no mês da ADMISSÃO trabalha-se de `dia` até o fim, ou seja
  -- 30 − dia + 1 dias — o mês só conta se a pessoa entrou até o dia 16. No mês
  -- do DESLIGAMENTO trabalha-se de 1 até `dia`, então conta a partir do 15.
  DECLARE
    v_mes_ini int := 1;
    v_mes_fim int;
  BEGIN
    IF EXTRACT(YEAR FROM v_admissao) = EXTRACT(YEAR FROM v_data) THEN
      v_mes_ini := EXTRACT(MONTH FROM v_admissao)::int
                   + CASE WHEN EXTRACT(DAY FROM v_admissao)::int > 16 THEN 1 ELSE 0 END;
    END IF;

    v_mes_fim := EXTRACT(MONTH FROM v_data)::int
                 - CASE WHEN EXTRACT(DAY FROM v_data)::int < 15 THEN 1 ELSE 0 END;

    v_meses_ano := GREATEST(LEAST(v_mes_fim - v_mes_ini + 1, 12), 0);
  END;

  -- Férias proporcionais: meses desde o último aniversário de admissão.
  v_meses_aquisit := v_meses_total - (v_anos_completos * 12);

  -- Vencidas: um período por ano completo, menos os que já foram gozados.
  --
  -- Simplificação assumida: cada registro de férias aprovado vale um período
  -- aquisitivo. Quem fracionou as férias em duas quinzenas aparece como dois
  -- períodos gozados e recebe menos vencidas do que deveria. Corrigir isso
  -- exigiria somar dias e amarrar cada bloco ao seu período aquisitivo — mais
  -- máquina do que a aula pede.
  SELECT count(*) INTO v_ferias_gozadas
    FROM public.ferias
   WHERE funcionario_id = p_funcionario_id
     AND COALESCE(ativo, true)
     AND status = 'Aprovado';
  v_periodos_venc := GREATEST(v_anos_completos - COALESCE(v_ferias_gozadas, 0), 0);

  -- ── Saldo de salário: dias trabalhados no mês do desligamento ─────────────
  v_saldo := ROUND(v_dia * EXTRACT(DAY FROM v_data)::int, 2);

  -- ── Aviso prévio: 30 dias + 3 por ano completo, teto de 90 ───────────────
  v_dias_aviso := LEAST(30 + (v_anos_completos * 3), 90);

  IF p_tipo = 'Sem justa causa' THEN
    -- Trabalhado já foi pago como dia normal; só o indenizado vira verba.
    IF p_aviso_previo = 'Indenizado' THEN
      v_aviso := ROUND(v_dia * v_dias_aviso, 2);
    END IF;

  ELSIF p_tipo = 'Acordo' THEN
    -- Art. 484-A: metade do aviso indenizado.
    v_aviso := ROUND(v_dia * v_dias_aviso / 2.0, 2);

  ELSIF p_tipo = 'Pedido de demissão' THEN
    -- Quem pede e não cumpre o aviso paga por ele.
    IF p_aviso_previo = 'Não cumprido' THEN
      v_desc_aviso := ROUND(v_dia * 30, 2);
    END IF;
    v_dias_aviso := 0;

  ELSE  -- Com justa causa
    v_dias_aviso := 0;
  END IF;

  -- ── 13º proporcional: justa causa perde ──────────────────────────────────
  IF p_tipo <> 'Com justa causa' THEN
    v_decimo := ROUND(v_salario * v_meses_ano / 12.0, 2);
  END IF;

  -- ── Férias ───────────────────────────────────────────────────────────────
  -- Vencidas são direito adquirido: nem a justa causa tira.
  v_fer_venc := ROUND(v_salario * v_periodos_venc, 2);

  -- Proporcionais, sim: justa causa perde.
  IF p_tipo <> 'Com justa causa' THEN
    v_fer_prop := ROUND(v_salario * v_meses_aquisit / 12.0, 2);
  END IF;

  v_terco := ROUND((v_fer_venc + v_fer_prop) / 3.0, 2);

  -- ── FGTS: 8% do salário por mês trabalhado (simulado — não há conta real) ─
  v_fgts_dep := ROUND(v_salario * 0.08 * v_meses_total, 2);

  v_multa := CASE p_tipo
    WHEN 'Sem justa causa' THEN ROUND(v_fgts_dep * 0.40, 2)
    WHEN 'Acordo'          THEN ROUND(v_fgts_dep * 0.20, 2)
    ELSE 0
  END;

  -- ── Descontos ────────────────────────────────────────────────────────────
  -- Só saldo de salário e 13º são base de INSS/IRRF. Aviso indenizado, férias
  -- indenizadas e multa do FGTS são indenizatórios — não entram. Essa é a
  -- simplificação mais importante do arquivo, e ela é fiel.
  v_base_trib := v_saldo + v_decimo;
  v_inss := public._inss_simplificado(v_base_trib);
  v_irrf := public._irrf_simplificado(v_base_trib - v_inss);

  v_bruto := v_saldo + v_aviso + v_decimo + v_fer_venc + v_fer_prop + v_terco + v_multa;
  v_descontos := v_inss + v_irrf + v_desc_aviso;

  -- Rescisão não vira dívida do trabalhador: o líquido para em zero.
  IF v_descontos > v_bruto THEN
    v_descontos := v_bruto;
  END IF;
  v_liquido := v_bruto - v_descontos;

  RETURN jsonb_build_object(
    'funcionario',          v_nome,
    'filial',               v_filial,
    'tipo',                 p_tipo,
    'aviso_previo',         p_aviso_previo,
    'salario_base',         v_salario,
    'data_admissao',        v_admissao,
    'data_desligamento',    v_data,
    'meses_trabalhados',    v_meses_total,
    'anos_completos',       v_anos_completos,
    'dias_aviso',           v_dias_aviso,
    'periodos_ferias_vencidas', v_periodos_venc,
    'saldo_salario',        v_saldo,
    'aviso_previo_valor',   v_aviso,
    'decimo_terceiro',      v_decimo,
    'ferias_vencidas',      v_fer_venc,
    'ferias_proporcionais', v_fer_prop,
    'terco_ferias',         v_terco,
    'fgts_depositado',      v_fgts_dep,
    'multa_fgts',           v_multa,
    'desconto_inss',        v_inss,
    'desconto_irrf',        v_irrf,
    'desconto_aviso',       v_desc_aviso,
    'total_bruto',          v_bruto,
    'total_descontos',      v_descontos,
    'total_liquido',        v_liquido
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calcular_rescisao(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calcular_rescisao(uuid, text, date, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
