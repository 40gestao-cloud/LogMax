-- ════════════════════════════════════════════════════════════════════════════
-- 604 — O dinheiro parado rende, e o prazo do crédito tem teto
-- ════════════════════════════════════════════════════════════════════════════
--
-- Duas coisas que a Matriz decidia "na fala" e agora decide no sistema:
--
-- 1) TETO DE PARCELAS. O formulário da filial trazia `max="60"` no HTML e
--    nada mais — atributo de input não é regra de negócio: um POST direto no
--    PostgREST passava com 900 parcelas. Agora o teto é
--    `capital_config.max_parcelas` (1..60, padrão 12) e quem cobra é o gatilho
--    que já valida as condições do empréstimo, então vale para o pedido da
--    filial E para as duas RPCs que aprovam.
--
-- 2) APLICAÇÃO FINANCEIRA. O pedido foi "cada banco rende conforme a taxa
--    dele". Conta corrente NÃO rende no Brasil — o que rende é aplicação
--    (CDB, RDB, poupança; o "saldo em conta" das fintechs é RDB automático
--    por trás). Então o modelo aqui não é "a conta rende sozinha": a unidade
--    APLICA um valor num banco e RESGATA depois. A decisão — quanto
--    imobilizar, em que banco, por quanto tempo — é o exercício.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O RELÓGIO
-- ────────────────────────────────────────────────────────────────────────────
-- Rendimento precisa de tempo passando, e aula dura 4 horas: 0,84% a.m. em
-- três dias é R$ 0,08 por mil — o aluno veria zero e concluiria que está
-- quebrado (foi exatamente o que acabou de acontecer com o período fechado do
-- capital).
--
-- Por isso o tempo aqui é MANUAL: `fechar_mes_aplicacoes()` capitaliza um mês
-- em TODAS as aplicações vivas, das 4 unidades, de uma vez. Quem clica é o
-- professor — `role = 'admin'` LITERAL, jamais `auth_is_admin()`, que inclui
-- ceo e conselheiro e esses são ALUNOS. Aluno não avança o calendário.
--
-- Consequência de projeto: prazo NÃO se mede em dias corridos em lugar nenhum
-- deste módulo. Carência e faixa de IR contam MESES FECHADOS
-- (`meses_rendidos`). Misturar as duas réguas daria resgate liberado pelo
-- calendário com rendimento zero, ou o contrário.
--
-- ────────────────────────────────────────────────────────────────────────────
-- IR E CARÊNCIA
-- ────────────────────────────────────────────────────────────────────────────
-- Tabela regressiva da renda fixa, convertida para meses fechados:
--   até 6 meses 22,5% · 7 a 12 20% · 13 a 24 17,5% · acima de 24 15%.
-- Poupança é isenta (`isento_ir`), como na vida real. O IR incide só sobre o
-- RENDIMENTO, nunca sobre o principal.
--
-- O que ficou de fora, de propósito, e por quê:
--   · IOF dos 30 primeiros dias — com o mês fechando por clique não existe
--     "dia 12"; a tabela regressiva de IOF não teria onde se apoiar.
--   · DARF / imposto a recolher — o IR é retido na fonte e some. Criar título
--     a pagar exigiria um calendário fiscal que o modelo não tem.
--   · Marcação a mercado e resgate parcial — resgate aqui é do contrato
--     inteiro, como RDB sem liquidez.
--
-- A carência tem uma válvula: `role='admin'` resgata antes do prazo. O tempo
-- aqui é manual, e sem a válvula um clique errado do aluno travaria o caixa da
-- unidade até alguém fechar N meses. O histórico marca o resgate como
-- "antecipado pela direção" — a exceção fica visível, não silenciosa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR ONDE O DINHEIRO ANDA
-- ────────────────────────────────────────────────────────────────────────────
-- Aplicar:  debita a conta escolhida (`caixa_bancos.saldo`) e grava a
--           aplicação com taxa, carência e isenção CARIMBADAS. Mudar a taxa
--           do banco depois não reescreve contrato que já está de pé — mesma
--           régua do snapshot de pedidos.
-- Resgatar: o PRINCIPAL volta direto para a conta (dinheiro que sai e volta
--           não é receita de ninguém). O RENDIMENTO LÍQUIDO entra como
--           `contas_receber` origem='aplicacao' já Recebida: o gatilho
--           `trg_sync_saldo_contas_receber` credita a conta, e
--           `calcular_saldo_capital` passa a contar o valor em
--           `receitas_pagas` — receita financeira não aumenta capital, igual
--           ao juro do mútuo na 473. Sem linha nova em calcular_saldo_capital.
--
-- Limite conhecido: `gerar_dre` monta a receita a partir de `vendas`, então a
-- receita financeira aparece no Capital e em Contas a Receber, mas ainda não
-- tem linha própria na DRE. Fica anotado para a rodada seguinte.
--
-- Escrita só por RPC (a régua da 326): `aplicacoes_financeiras` não ganha
-- policy de INSERT/UPDATE/DELETE. `bancos_investimento` é cadastro da Matriz
-- e esse sim aceita escrita direta de admin/ceo.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Teto de parcelas
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.capital_config
  ADD COLUMN IF NOT EXISTS max_parcelas integer NOT NULL DEFAULT 12;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capital_config_max_parcelas_ck'
  ) THEN
    ALTER TABLE public.capital_config
      ADD CONSTRAINT capital_config_max_parcelas_ck
      CHECK (max_parcelas BETWEEN 1 AND 60);
  END IF;
END $$;

COMMENT ON COLUMN public.capital_config.max_parcelas IS
  'Migr. 604 — teto de parcelas que a Matriz concede à filial (1..60). Cobrado por emprestimo_valida_condicoes(), não pelo max= do input.';

-- Corpo copiado de `prosrc` (não do arquivo antigo) + o teto.
-- Cobrado já no INSERT: melhor o aluno descobrir na hora de pedir do que a
-- Matriz descobrir na hora de aprovar.
CREATE OR REPLACE FUNCTION public.emprestimo_valida_condicoes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max    integer;
  v_checar boolean := false;
BEGIN
  IF NEW.status = 'Aprovado' THEN
    IF COALESCE(NEW.num_parcelas, 0) < 1 THEN
      RAISE EXCEPTION 'Empréstimo aprovado precisa de ao menos 1 parcela.'
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(NEW.taxa_juros, 0) < 0 THEN
      RAISE EXCEPTION 'Taxa de juros não pode ser negativa.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Teto de prazo (604). O gatilho é BEFORE INSERT OR UPDATE, então cobrar o
  -- teto em TODO update trancaria o pedido antigo: baixar a política de 24x
  -- para 12x faria a Matriz não conseguir nem APROVAR (certo) nem NEGAR
  -- (errado — negar é justamente a saída) um pedido de 24x que já estava na
  -- fila. Só duas situações interessam:
  --   · INSERT — o pedido nasce dentro da política vigente;
  --   · UPDATE que aprova, ou que mexe no prazo — é aí que vira dinheiro.
  -- Negar, arquivar e corrigir justificativa passam sempre.
  --
  -- IF aninhado e não `TG_OP = 'INSERT' OR OLD.status ...`: PL/pgSQL avalia a
  -- condição como UMA expressão SQL, sem curto-circuito garantido, e tocar em
  -- OLD durante um INSERT estoura "record old is not assigned yet".
  IF TG_OP = 'INSERT' THEN
    v_checar := true;
  ELSIF (NEW.status = 'Aprovado' AND OLD.status IS DISTINCT FROM 'Aprovado')
        OR NEW.num_parcelas IS DISTINCT FROM OLD.num_parcelas THEN
    v_checar := true;
  END IF;

  IF v_checar THEN
    -- Config ausente = teto de 60, o máximo que a coluna aceita: turma sem
    -- período configurado não fica sem crédito nenhum.
    SELECT COALESCE(max_parcelas, 60) INTO v_max
      FROM public.capital_config
     ORDER BY created_at DESC LIMIT 1;
    v_max := COALESCE(v_max, 60);

    IF COALESCE(NEW.num_parcelas, 1) > v_max THEN
      RAISE EXCEPTION 'A Matriz parcela em até %x. Este pedido está em %x — reduza o prazo, ou a direção revê a política de crédito em Capital > Configuração. (Negar o pedido continua liberado.)',
        v_max, NEW.num_parcelas
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2) A praça: os bancos onde se aplica
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bancos_investimento (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome            text NOT NULL,
  produto         text NOT NULL DEFAULT 'CDB',
  taxa_mensal     numeric(7,4) NOT NULL DEFAULT 0,
  pct_cdi         numeric(6,2),
  carencia_meses  integer NOT NULL DEFAULT 0,
  isento_ir       boolean NOT NULL DEFAULT false,
  imagem_url      text,
  ordem           integer NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,
  criado_por      uuid,
  atualizado_por  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bancos_investimento_taxa_ck     CHECK (taxa_mensal >= 0 AND taxa_mensal <= 100),
  CONSTRAINT bancos_investimento_carencia_ck CHECK (carencia_meses BETWEEN 0 AND 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bancos_investimento_nome
  ON public.bancos_investimento (lower(nome));

COMMENT ON TABLE public.bancos_investimento IS
  'Migr. 604 — a praça financeira do exercício: onde a unidade aplica. Taxa em % AO MÊS; pct_cdi é só a referência didática de mercado.';

-- Os 5 da praça. Taxas calibradas por CDI ~0,84% a.m.: o que muda entre eles
-- é a troca liquidez × retorno, que é a decisão que o aluno tem de tomar.
-- Poupança rende menos e é isenta; quem paga mais prende o dinheiro.
INSERT INTO public.bancos_investimento (nome, produto, taxa_mensal, pct_cdi, carencia_meses, isento_ir, ordem)
SELECT v.nome, v.produto, v.taxa_mensal, v.pct_cdi, v.carencia_meses, v.isento_ir, v.ordem
  FROM (VALUES
    ('Mercado Pago',            'Conta remunerada', 0.8400, 100.00, 0, false, 1),
    ('Banco do Brasil',         'CDB',              0.8200,  98.00, 1, false, 2),
    ('Bradesco',                'CDB',              0.8000,  96.00, 1, false, 3),
    ('Sicredi',                 'RDB',              0.8600, 103.00, 3, false, 4),
    ('Caixa Econômica Federal', 'Poupança',         0.5000,  60.00, 1, true,  5)
  ) v(nome, produto, taxa_mensal, pct_cdi, carencia_meses, isento_ir, ordem)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.bancos_investimento b WHERE lower(b.nome) = lower(v.nome)
 );

ALTER TABLE public.bancos_investimento ENABLE ROW LEVEL SECURITY;

-- `(SELECT auth.uid())` e não `auth.uid()` cru: a subquery é avaliada uma vez
-- por consulta; a chamada crua roda por LINHA e foi o que derrubou a
-- contabilidade em 15/09 (migr. 597/598).
DROP POLICY IF EXISTS bancos_investimento_select ON public.bancos_investimento;
CREATE POLICY bancos_investimento_select ON public.bancos_investimento
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS bancos_investimento_insert ON public.bancos_investimento;
CREATE POLICY bancos_investimento_insert ON public.bancos_investimento
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'ceo')));

DROP POLICY IF EXISTS bancos_investimento_update ON public.bancos_investimento;
CREATE POLICY bancos_investimento_update ON public.bancos_investimento
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'ceo')));

DROP POLICY IF EXISTS bancos_investimento_delete ON public.bancos_investimento;
CREATE POLICY bancos_investimento_delete ON public.bancos_investimento
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'ceo')));

DROP POLICY IF EXISTS zz_desligado_bloqueia_insert ON public.bancos_investimento;
CREATE POLICY zz_desligado_bloqueia_insert ON public.bancos_investimento
  AS RESTRICTIVE FOR INSERT WITH CHECK (NOT (SELECT auth_desligado()));
DROP POLICY IF EXISTS zz_desligado_bloqueia_update ON public.bancos_investimento;
CREATE POLICY zz_desligado_bloqueia_update ON public.bancos_investimento
  AS RESTRICTIVE FOR UPDATE USING (NOT (SELECT auth_desligado()));
DROP POLICY IF EXISTS zz_desligado_bloqueia_delete ON public.bancos_investimento;
CREATE POLICY zz_desligado_bloqueia_delete ON public.bancos_investimento
  AS RESTRICTIVE FOR DELETE USING (NOT (SELECT auth_desligado()));


-- ════════════════════════════════════════════════════════════════════════════
-- 3) O contrato: o que cada unidade tem aplicado
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.aplicacoes_financeiras (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  filial                text NOT NULL,
  banco_investimento_id uuid NOT NULL REFERENCES public.bancos_investimento(id),
  banco_nome            text NOT NULL,
  produto               text NOT NULL,
  conta_id              uuid REFERENCES public.caixa_bancos(id) ON DELETE SET NULL,
  conta_nome            text,
  valor_aplicado        numeric(15,2) NOT NULL,
  -- Carimbados na aplicação: taxa que o banco anunciar depois não muda
  -- contrato que já está de pé.
  taxa_mensal           numeric(7,4) NOT NULL,
  carencia_meses        integer NOT NULL DEFAULT 0,
  isento_ir             boolean NOT NULL DEFAULT false,
  meses_rendidos        integer NOT NULL DEFAULT 0,
  rendimento_bruto      numeric(15,2) NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'Aplicada',
  resgatado_em          timestamptz,
  ir_retido             numeric(15,2),
  valor_resgatado       numeric(15,2),
  observacao            text,
  aplicado_por          uuid,
  aplicado_por_nome     text,
  ativo                 boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aplicacoes_valor_ck  CHECK (valor_aplicado > 0),
  CONSTRAINT aplicacoes_status_ck CHECK (status IN ('Aplicada', 'Resgatada'))
);

CREATE INDEX IF NOT EXISTS idx_aplicacoes_filial_status
  ON public.aplicacoes_financeiras (filial, status) WHERE ativo = true;

COMMENT ON TABLE public.aplicacoes_financeiras IS
  'Migr. 604 — dinheiro que a unidade tirou do caixa e pôs para render. Escrita SÓ por aplicar_em_banco / resgatar_aplicacao / fechar_mes_aplicacoes (régua da 326).';

ALTER TABLE public.aplicacoes_financeiras ENABLE ROW LEVEL SECURITY;

-- Só SELECT, e escopado por unidade: a MaxLook não vê o colchão da TechMax.
-- Direção e conselho veem tudo; financeiro e gerente veem a unidade deles.
DROP POLICY IF EXISTS aplicacoes_financeiras_select ON public.aplicacoes_financeiras;
CREATE POLICY aplicacoes_financeiras_select ON public.aplicacoes_financeiras
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = (SELECT auth.uid())
       AND (
         p.role IN ('admin', 'ceo', 'conselheiro')
         OR (p.role = 'gerente' AND p.is_conselheiro = true)
         OR (p.filial = aplicacoes_financeiras.filial AND p.role = 'gerente')
         OR (p.filial = aplicacoes_financeiras.filial
             AND (p.setor = 'financeiro' OR 'financeiro' = ANY(p.setores_extras)))
       )));


-- ════════════════════════════════════════════════════════════════════════════
-- 4) Tabela regressiva do IR, em meses fechados
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ir_aplicacao_pct(p_meses integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(p_meses, 0) <= 6  THEN 22.5
    WHEN p_meses <= 12 THEN 20.0
    WHEN p_meses <= 24 THEN 17.5
    ELSE 15.0
  END;
$function$;

-- Irmã da `brl()` para percentual: o cluster roda `lc_numeric = en_US`, então
-- `taxa_mensal` (numeric(7,4)) sai como "0.8600" em toda mensagem que o aluno
-- lê. Aqui vira "0,86" — sem zeros à toa e com a vírgula certa.
CREATE OR REPLACE FUNCTION public.pct_br(p_valor numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT replace(trim(to_char(COALESCE(p_valor, 0), 'FM990D99')), '.', ',');
$function$;

COMMENT ON FUNCTION public.pct_br(numeric) IS
  'Migr. 604 — percentual em pt-BR para mensagem de RPC, irmã de brl(). Usar em qualquer texto novo que fale de taxa.';

COMMENT ON FUNCTION public.ir_aplicacao_pct(integer) IS
  'Migr. 604 — IR regressivo da renda fixa traduzido de dias para MESES FECHADOS, porque neste módulo o tempo anda por fechar_mes_aplicacoes().';


-- ════════════════════════════════════════════════════════════════════════════
-- 5) Aplicar
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.aplicar_em_banco(
  p_filial text,
  p_banco_investimento_id uuid,
  p_conta_id uuid,
  p_valor numeric,
  p_observacao text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b     RECORD;
  v_conta RECORD;
  v_ator  text;
  v_setor text;
  v_id    uuid;
BEGIN
  PERFORM public._assert_rpc();

  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax', 'MaxLook', 'TechMax', 'Matriz') THEN
    RAISE EXCEPTION 'Unidade inválida: %', COALESCE(p_filial, '(vazio)') USING ERRCODE = 'P0001';
  END IF;

  -- COALESCE em todo guard: NULL não vira permissão.
  IF NOT COALESCE(public.auth_pode_filial(p_filial), false) THEN
    RAISE EXCEPTION 'Caixa de outra unidade.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(p_filial), false)
          OR COALESCE(public.auth_user_role(), '') IN ('admin', 'ceo')) THEN
    RAISE EXCEPTION 'Aplicar o caixa é decisão do Financeiro ou do gerente da unidade.'
      USING ERRCODE = '42501';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  -- A coluna é numeric(15,2) e o saldo também: sem arredondar aqui, um valor
  -- com três casas debitaria um número e guardaria outro, e a diferença ficaria
  -- pendurada no caixa para sempre.
  p_valor := ROUND(p_valor, 2);

  SELECT * INTO v_b FROM public.bancos_investimento
   WHERE id = p_banco_investimento_id AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Banco de investimento não encontrado ou desativado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT cb.id, cb.filial, COALESCE(cb.saldo, 0) AS saldo,
         COALESCE(cb.banco, cb.conta) AS nome
    INTO v_conta
    FROM public.caixa_bancos cb
   WHERE cb.id = p_conta_id AND COALESCE(cb.ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  -- Conta global/legada (filial NULL) serve a qualquer unidade — régua da 325.
  IF v_conta.filial IS NOT NULL AND v_conta.filial <> p_filial THEN
    RAISE EXCEPTION 'A conta % é de % e a aplicação é de %.',
      v_conta.nome, v_conta.filial, p_filial USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: há % e a aplicação é de %. Aplicar não cria dinheiro — o valor sai do caixa e fica preso até o resgate.',
      v_conta.nome, public.brl(v_conta.saldo), public.brl(p_valor)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.caixa_bancos SET saldo = COALESCE(saldo, 0) - p_valor WHERE id = p_conta_id;

  SELECT nome, setor INTO v_ator, v_setor FROM public.user_profiles WHERE id = auth.uid();
  IF v_ator IS NULL THEN
    v_ator := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  INSERT INTO public.aplicacoes_financeiras
    (filial, banco_investimento_id, banco_nome, produto, conta_id, conta_nome,
     valor_aplicado, taxa_mensal, carencia_meses, isento_ir, observacao,
     aplicado_por, aplicado_por_nome)
  VALUES
    (p_filial, v_b.id, v_b.nome, v_b.produto, p_conta_id, v_conta.nome,
     p_valor, v_b.taxa_mensal, v_b.carencia_meses, v_b.isento_ir, p_observacao,
     auth.uid(), v_ator)
  RETURNING id INTO v_id;

  INSERT INTO public.historico_operacoes
    (entidade, entidade_id, filial, evento, de, para, detalhe,
     ator_id, ator_nome, ator_setor)
  VALUES
    ('aplicacoes_financeiras', v_id, p_filial, 'Aplicação feita',
     '0,00', public.brl(p_valor),
     public.brl(p_valor) || ' de ' || v_conta.nome || ' para ' || v_b.nome
       || ' (' || v_b.produto || ', ' || public.pct_br(v_b.taxa_mensal) || '% a.m.'
       || CASE WHEN v_b.carencia_meses > 0
               THEN ', carência de ' || v_b.carencia_meses || ' mês(es)' ELSE '' END || ')'
       || COALESCE(' · ' || NULLIF(p_observacao, ''), ''),
     auth.uid(), v_ator, v_setor);

  RETURN v_id;
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 6) Fechar o mês — o relógio do professor
-- ════════════════════════════════════════════════════════════════════════════
-- Juros COMPOSTOS: o mês seguinte rende sobre principal + rendimento já
-- acumulado. É o que um CDB faz, e é o que torna "deixar parado" uma decisão
-- com efeito visível ao longo da turma.
CREATE OR REPLACE FUNCTION public.fechar_mes_aplicacoes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ap    RECORD;
  v_juro  numeric(15,2);
  v_total numeric(15,2) := 0;
  v_qtd   integer := 0;
  v_ator  text;
  v_setor text;
BEGIN
  PERFORM public._assert_rpc();

  -- `role = 'admin'` LITERAL: auth_is_admin() inclui ceo e conselheiro, que
  -- são ALUNOS. Avançar o calendário é do professor.
  IF COALESCE(public.auth_user_role(), '') <> 'admin'
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Só o administrador fecha o mês das aplicações — é o relógio da turma, não um lançamento da unidade.'
      USING ERRCODE = '42501';
  END IF;

  SELECT nome, setor INTO v_ator, v_setor FROM public.user_profiles WHERE id = auth.uid();
  IF v_ator IS NULL THEN
    v_ator := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  -- ORDER BY id no FOR UPDATE: duas sessões fechando o mês ao mesmo tempo
  -- travam na mesma ordem e não se cruzam.
  FOR v_ap IN
    SELECT * FROM public.aplicacoes_financeiras
     WHERE status = 'Aplicada' AND ativo = true
     ORDER BY id
     FOR UPDATE
  LOOP
    v_juro := ROUND((v_ap.valor_aplicado + v_ap.rendimento_bruto) * v_ap.taxa_mensal / 100, 2);

    UPDATE public.aplicacoes_financeiras
       SET rendimento_bruto = rendimento_bruto + v_juro,
           meses_rendidos   = meses_rendidos + 1,
           updated_at       = now()
     WHERE id = v_ap.id;

    INSERT INTO public.historico_operacoes
      (entidade, entidade_id, filial, evento, de, para, detalhe,
       ator_id, ator_nome, ator_setor)
    VALUES
      ('aplicacoes_financeiras', v_ap.id, v_ap.filial, 'Mês fechado',
       public.brl(v_ap.rendimento_bruto), public.brl(v_ap.rendimento_bruto + v_juro),
       'Mês ' || (v_ap.meses_rendidos + 1) || ' em ' || v_ap.banco_nome
         || ' · ' || public.pct_br(v_ap.taxa_mensal) || '% sobre '
         || public.brl(v_ap.valor_aplicado + v_ap.rendimento_bruto)
         || ' rendeu ' || public.brl(v_juro),
       auth.uid(), v_ator, v_setor);

    v_total := v_total + v_juro;
    v_qtd   := v_qtd + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'aplicacoes', v_qtd,
    'rendimento', v_total,
    'fechado_em', public.acre_today()
  );
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 7) Resgatar
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resgatar_aplicacao(
  p_aplicacao_id uuid,
  p_conta_destino_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ap      RECORD;
  v_conta   RECORD;
  v_destino uuid;
  v_ir_pct  numeric;
  v_ir      numeric(15,2);
  v_liquido numeric(15,2);
  v_antecipado boolean;
  v_ator    text;
  v_setor   text;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_ap FROM public.aplicacoes_financeiras
   WHERE id = p_aplicacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aplicação não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_ap.status = 'Resgatada' THEN
    RAISE EXCEPTION 'Esta aplicação já foi resgatada em %.',
      to_char(v_ap.resgatado_em AT TIME ZONE 'America/Rio_Branco', 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_ap.filial), false) THEN
    RAISE EXCEPTION 'Aplicação de outra unidade.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(public.auth_in_setor('financeiro'), false)
          OR COALESCE(public.auth_gerente_da(v_ap.filial), false)
          OR COALESCE(public.auth_user_role(), '') IN ('admin', 'ceo')) THEN
    RAISE EXCEPTION 'Resgatar é decisão do Financeiro ou do gerente da unidade.'
      USING ERRCODE = '42501';
  END IF;

  -- Carência: quem paga mais prende o dinheiro. Contada em meses FECHADOS,
  -- não no calendário — neste módulo o tempo anda por fechar_mes_aplicacoes().
  --
  -- A VÁLVULA DO PROFESSOR (`role='admin'` literal, nunca auth_is_admin(), que
  -- inclui aluno): a carência é didática, mas o tempo aqui é manual. Um aluno
  -- que aplica o caixa inteiro no Sicredi por engano ficaria travado até
  -- alguém fechar 3 meses, e a aula pararia por causa de um clique. O
  -- professor destrava; o histórico registra que foi resgate antecipado, para
  -- ninguém confundir com carência cumprida.
  v_antecipado := v_ap.meses_rendidos < v_ap.carencia_meses;

  IF v_antecipado AND COALESCE(public.auth_user_role(), '') = 'admin' THEN
    NULL;
  ELSIF v_antecipado THEN
    RAISE EXCEPTION 'Carência: % exige % mês(es) aplicados e este contrato tem %. Faltam % fechamento(s) de mês — foi a taxa maior que cobrou esse prazo.',
      v_ap.banco_nome, v_ap.carencia_meses, v_ap.meses_rendidos,
      v_ap.carencia_meses - v_ap.meses_rendidos
      USING ERRCODE = 'P0001';
  END IF;

  v_destino := COALESCE(p_conta_destino_id, v_ap.conta_id);
  IF v_destino IS NULL THEN
    RAISE EXCEPTION 'Informe a conta que recebe o resgate: a conta de origem desta aplicação não existe mais.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT cb.id, cb.filial, COALESCE(cb.banco, cb.conta) AS nome
    INTO v_conta
    FROM public.caixa_bancos cb
   WHERE cb.id = v_destino AND COALESCE(cb.ativo, true)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_conta.filial IS NOT NULL AND v_conta.filial <> v_ap.filial THEN
    RAISE EXCEPTION 'A conta % é de % e a aplicação é de %.',
      v_conta.nome, v_conta.filial, v_ap.filial USING ERRCODE = 'P0001';
  END IF;

  v_ir_pct  := CASE WHEN v_ap.isento_ir THEN 0
                    ELSE public.ir_aplicacao_pct(v_ap.meses_rendidos) END;
  v_ir      := ROUND(v_ap.rendimento_bruto * v_ir_pct / 100, 2);
  v_liquido := v_ap.rendimento_bruto - v_ir;

  -- O PRINCIPAL volta direto: dinheiro que saiu e voltou não é receita.
  UPDATE public.caixa_bancos
     SET saldo = COALESCE(saldo, 0) + v_ap.valor_aplicado
   WHERE id = v_destino;

  SELECT nome, setor INTO v_ator, v_setor FROM public.user_profiles WHERE id = auth.uid();
  IF v_ator IS NULL THEN
    v_ator := CASE WHEN auth.uid() IS NULL THEN 'Sistema' ELSE 'Usuário removido' END;
  END IF;

  -- O RENDIMENTO entra como título já recebido: o gatilho de sync credita a
  -- conta e calcular_saldo_capital passa a contar em receitas_pagas.
  IF v_liquido > 0 THEN
    INSERT INTO public.contas_receber
      (descricao, valor, vencimento, status, filial, banco_id, valor_pago,
       pago_em, origem, criado_por)
    VALUES
      ('Rendimento de aplicação — ' || v_ap.banco_nome || ' (' || v_ap.produto || ')',
       -- 'Pago' e não 'Recebido': as RPCs leem `IN ('Pago','Recebido')`, mas
       -- quem grava é o CHECK `chk_contas_receber_status`, e ele só conhece
       -- Aberto/Parcial/Pago/Atrasado/Cancelado. O exercício em transação
       -- revertida pegou isso antes de aplicar.
       v_liquido, public.acre_today(), 'Pago', v_ap.filial, v_destino, v_liquido,
       public.acre_today(), 'aplicacao', auth.uid());
  END IF;

  UPDATE public.aplicacoes_financeiras
     SET status          = 'Resgatada',
         resgatado_em    = now(),
         ir_retido       = v_ir,
         valor_resgatado = v_ap.valor_aplicado + v_liquido,
         updated_at      = now()
   WHERE id = v_ap.id;

  INSERT INTO public.historico_operacoes
    (entidade, entidade_id, filial, evento, de, para, detalhe,
     ator_id, ator_nome, ator_setor)
  VALUES
    ('aplicacoes_financeiras', v_ap.id, v_ap.filial,
     CASE WHEN v_antecipado THEN 'Aplicação resgatada (antecipado pela direção)'
          ELSE 'Aplicação resgatada' END,
     public.brl(v_ap.valor_aplicado), public.brl(v_ap.valor_aplicado + v_liquido),
     'Principal ' || public.brl(v_ap.valor_aplicado)
       || ' · rendimento bruto ' || public.brl(v_ap.rendimento_bruto)
       || ' em ' || v_ap.meses_rendidos || ' mês(es)'
       || CASE WHEN v_ap.isento_ir THEN ' · isento de IR'
               ELSE ' · IR ' || public.pct_br(v_ir_pct) || '% = ' || public.brl(v_ir) END
       || ' · líquido ' || public.brl(v_liquido)
       || ' creditado em ' || v_conta.nome,
     auth.uid(), v_ator, v_setor);

  RETURN jsonb_build_object(
    'principal', v_ap.valor_aplicado,
    'bruto',     v_ap.rendimento_bruto,
    'ir_pct',    v_ir_pct,
    'ir',        v_ir,
    'liquido',   v_liquido,
    'creditado', v_ap.valor_aplicado + v_liquido,
    'conta',     v_conta.nome,
    'antecipado', v_antecipado
  );
END;
$function$;


-- ════════════════════════════════════════════════════════════════════════════
-- 8) Grants — RPC nova nasce aberta pro anon
-- ════════════════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION public.aplicar_em_banco(text, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resgatar_aplicacao(uuid, uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fechar_mes_aplicacoes()                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ir_aplicacao_pct(integer)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pct_br(numeric)                                   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.aplicar_em_banco(text, uuid, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resgatar_aplicacao(uuid, uuid)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fechar_mes_aplicacoes()                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ir_aplicacao_pct(integer)                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pct_br(numeric)                                   TO authenticated, service_role;

GRANT SELECT ON public.aplicacoes_financeiras TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bancos_investimento TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 9) Os dois resets levam as aplicações junto
-- ════════════════════════════════════════════════════════════════════════════
-- Aplicação é dinheiro da unidade parado fora do caixa. O reset zera
-- `caixa_bancos.saldo` e apaga os títulos; uma aplicação sobrevivente seria
-- resgatada pela turma seguinte e criaria dinheiro do nada — o mesmo defeito
-- que a 572 corrigiu no empréstimo preservado.
--
-- Corpos copiados de `prosrc` (md5 antes desta migração:
--   resetar_dados_operacionais  c67e47be58b13a3c87c93f9ca871dfa8
--   resetar_dados_da_filial     1062d32db27700ddbedc2b533d1fda66
-- iguais nos 4 projetos, conferido pelo `npm run drift` de 21/09). A única
-- diferença é a entrada nova em cada régua.

CREATE OR REPLACE FUNCTION public.resetar_dados_operacionais()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_usuarios_preservados int;
  v_corte date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
BEGIN
  IF auth_user_role() NOT IN ('admin', 'ceo') THEN
    RAISE EXCEPTION 'Apenas admin e CEO podem executar este reset.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM desenvolvimentos_ia WHERE id IS NOT NULL;
  DELETE FROM avaliacoes WHERE tipo IS DISTINCT FROM 'matriz_filial';
  UPDATE caixa_bancos SET saldo = 0 WHERE saldo IS DISTINCT FROM 0;

  -- (572) A foto das parcelas, ANTES do TRUNCATE. `parcelas_emprestimo`
  -- referencia contas_pagar e contas_receber, que continuam na lista, e
  -- TRUNCATE ... CASCADE trunca quem referencia sem olhar o ON DELETE
  -- (as duas FKs sao SET NULL e mesmo assim a tabela inteira iria junto).
  DROP TABLE IF EXISTS _reset_parcelas_emprestimo;
  CREATE TEMP TABLE _reset_parcelas_emprestimo ON COMMIT DROP AS
    SELECT * FROM public.parcelas_emprestimo;

  TRUNCATE TABLE
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    contas_receber, contas_pagar, previsoes, duplicatas, filial_investimentos,
    -- (604) aplicacoes_financeiras: dinheiro que a unidade tirou do caixa e
    -- pos para render. O reset zera `caixa_bancos.saldo`, entao uma aplicacao
    -- sobrevivente seria resgatada pela turma nova criando dinheiro do nada.
    aplicacoes_financeiras,
    integracoes_bancarias, controle_caixa,
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam daqui: sao o historico de frequencia, do
    -- mesmo lado de frequencia_trabalho. As duas ultimas ficam porque o
    -- CASCADE e o gatilho de reversao levariam o ponto junto.
    -- (514) folha_pagamento saiu daqui, e com ela folha_rubricas e
    -- folha_credito_falhas, que morriam pelo CASCADE: o holerite e historico da
    -- pessoa (e a base do FGTS acumulado), nao exercicio da turma. contas_pagar
    -- continua na lista -- o lancamento financeiro da folha e' que e' exercicio.
    -- (572) emprestimos_filial saiu daqui, e com ela parcelas_emprestimo (esta
    -- por foto, logo abaixo): o contrato e a tabela de amortizacao sao
    -- historico da UNIDADE. Os TITULOS continuam saindo -- contas_pagar da
    -- filial e contas_receber da Matriz sao o exercicio da turma, mesma regua
    -- da folha. O emprestimo preservado atravessa quitado, nao devendo, e
    -- recebe `arquivado_em` para parar de contar como capital.
    ferias,
    beneficios_pendentes,
    treinamento_inscricoes,
    pesquisa_resposta_itens, pesquisa_respostas, pesquisa_perguntas, pesquisas,
    marketing_arte_feedback, marketing_artes, marketing_tarefas,
    marketing_promocoes, marketing_calendario, marketing_cupons,
    marketing_campanhas, itens_campanha,
    orcamentos, pedidos_venda,
    maxbank_transacoes, maxbank_transferencias,
    maxbank_folgas_conquistadas, maxbank_metas,
    tarefas_taticas, tarefas, metas_estrategicas,
    ti_chamados,
    relatorios_bi, briefings_diarios, notificacoes, feedbacks_organizacao,
    votacoes_votos, votacoes,
    capital_filial, requerimentos,
    orcamentos_periodo, prestacoes_contas, destinacoes_resultado,
    apuracoes_bonus, politicas_remuneracao, mandatos, riscos,
    auditoria_revisoes,
    -- (504) `documentos` e `documentos_leitura` (migr. 476) NUNCA estiveram
    -- nesta lista, e agora isso esta escrito: o material que o professor
    -- publica e dele, nao da turma -- refazer o upload a cada turma seria
    -- trabalho repetido sem nada didatico dentro. Ficam de fora por decisao,
    -- nao por esquecimento, que e o que a licao das 12 tabelas orfas entre a
    -- 377 e a 392 pede. Nada truncado aqui as referencia (as maes sao
    -- `user_profiles`), entao nenhum CASCADE as alcanca.
    -- (514) Mesma nota para `departamentos`, `cargos` e `centros_custo`: nunca
    -- estiveram aqui e nenhum CASCADE as alcanca (quem e' truncada sao as
    -- FILHAS de centros_custo, e TRUNCATE CASCADE desce, nao sobe). Sao a
    -- estrutura da empresa, montada uma vez; a contagem no retorno deixa isso
    -- conferivel.
    -- (482) fornecedores saiu daqui: fundo de cadastro, nao exercicio.
    produtos, servicos, clientes,
    projetos,
    -- (486) Rascunho do botao "Gerar" (481). Mesma decisao da 485.
    produtos_codigo_reserva,
    -- (482) categorias_produto/subcategorias_produto sairam daqui: a categoria
    -- carrega o markup-alvo (360). O orcamento POR categoria continua zerando.
    orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  -- (572) O contrato sobreviveu ao TRUNCATE; agora vira historico fechado.
  -- Feito ANTES de repor as parcelas de proposito: assim a reinsercao ja
  -- acontece com o emprestimo arquivado, e o gatilho da parcela nao tem de
  -- distinguir nada (ele so olha UPDATE).
  UPDATE public.emprestimos_filial
     SET arquivado_em = now()
   WHERE arquivado_em IS NULL;

  -- Os dois ids de titulo voltam NULL: a conta a pagar da filial e a conta a
  -- receber da Matriz foram apagadas acima, e a parcela nao pode apontar para
  -- o que nao existe mais.
  INSERT INTO public.parcelas_emprestimo
    (id, emprestimo_id, num_parcela, valor_parcela, data_vencimento, status,
     contas_pagar_id, contas_receber_id, created_at, juros, amortizacao, saldo_devedor)
  SELECT id, emprestimo_id, num_parcela, valor_parcela, data_vencimento, status,
         NULL, NULL, created_at, juros, amortizacao, saldo_devedor
    FROM _reset_parcelas_emprestimo;

  DROP TABLE IF EXISTS _reset_parcelas_emprestimo;

  -- (505) A virada de turma. `configuracoes` sobrevive ao reset desde a 377,
  -- entao o carimbo fica de pe para a turma nova. Daqui para tras o ponto e da
  -- turma passada: nao conta na folha e nao se reescreve.
  -- (514) O mesmo carimbo fecha a folha preservada para escrita.
  INSERT INTO public.configuracoes (chave, valor, updated_at)
  VALUES ('ponto_corte_turma', v_corte::text, now())
  ON CONFLICT (chave) DO UPDATE
     SET valor = EXCLUDED.valor, updated_at = now();

  SELECT count(*) INTO v_usuarios_preservados FROM user_profiles;

  RETURN jsonb_build_object(
    'sucesso',                  true,
    'usuarios_preservados',     v_usuarios_preservados,
    'funcionarios_preservados', (SELECT count(*) FROM funcionarios),
    'carteiras_preservadas',    (SELECT count(*) FROM maxbank_contas),
    'filiais_preservadas',      (SELECT count(*) FROM filiais),
    'frequencia_preservada',    (SELECT count(*) FROM frequencia_trabalho),
    -- (504) O relatorio ja dizia 'frequencia_preservada' enquanto truncava o
    -- ponto. Agora o numero do ponto aparece ao lado, e a conferencia e visual.
    'ponto_preservado',         (SELECT count(*) FROM ponto_eletronico),
    'afastamentos_preservados', (SELECT count(*) FROM afastamentos),
    'justificativas_preservadas', (SELECT count(*) FROM justificativas_falta),
    'documentos_preservados',   (SELECT count(*) FROM documentos WHERE COALESCE(ativo, true)),
    -- (514) A folha e os cadastros de estrutura, pelo mesmo motivo: o numero no
    -- retorno e a unica conferencia que o professor tem depois do TRUNCATE.
    'folha_preservada',         (SELECT count(*) FROM folha_pagamento WHERE COALESCE(ativo, true)),
    'rubricas_preservadas',     (SELECT count(*) FROM folha_rubricas),
    'departamentos_preservados',(SELECT count(*) FROM departamentos),
    'cargos_preservados',       (SELECT count(*) FROM cargos),
    'centros_custo_preservados',(SELECT count(*) FROM centros_custo),
    -- (572) Idem emprestimo: o numero preservado ao lado do numero de parcelas
    -- e a unica conferencia depois do TRUNCATE.
    'emprestimos_preservados',  (SELECT count(*) FROM emprestimos_filial),
    'parcelas_emprestimo_preservadas', (SELECT count(*) FROM parcelas_emprestimo),
    'corte_turma',              v_corte,
    'competicoes_preservadas',  (SELECT count(*) FROM competicoes_matriz),
    'notas_placar_preservadas', (SELECT count(*) FROM avaliacoes WHERE tipo = 'matriz_filial'),
    'avaliacoes_matriz_preservadas', (SELECT count(*) FROM avaliacoes_matriz),
    'tarefas_matriz_preservadas',    (SELECT count(*) FROM matriz_tarefas),
    'treinamentos_preservados', (SELECT count(*) FROM treinamentos),
    'fornecedores_preservados', (SELECT count(*) FROM fornecedores WHERE ativo IS DISTINCT FROM false),
    'categorias_preservadas',   (SELECT count(*) FROM categorias_produto WHERE ativo IS DISTINCT FROM false),
    'contas_bancarias_zeradas', (SELECT count(*) FROM caixa_bancos),
    'executado_em',             now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resetar_dados_da_filial(p_filial text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_alvos text[][] := ARRAY[
    ['itens_venda','venda_id IN (SELECT id FROM public.vendas WHERE filial = $1)'],
    ['notas_emitidas','filial = $1'],
    ['devolucoes','filial = $1'],
    ['itens_devolucao','devolucao_id IN (SELECT id FROM public.devolucoes WHERE filial = $1)'],
    ['vendas','filial = $1'],
    ['pix_pendentes','filial = $1'],
    ['cartao_pendentes','filial = $1'],
    ['beneficios_pendentes','filial_pdv = $1'],
    ['pedidos_online_itens','pedido_id IN (SELECT id FROM public.pedidos_online WHERE filial = $1)'],
    ['pedidos_online','filial = $1'],
    ['movimentacoes_estoque','filial = $1'],
    ['produto_unidades','filial = $1'],
    ['vencimentos_estoque','filial = $1'],
    ['inventarios','filial = $1'],
    ['expedicao','filial = $1'],
    ['requisicoes_estoque','filial = $1'],
    ['aprovacoes_estoque','filial = $1'],
    ['consumos_material','filial = $1'],
    ['devolucoes_fornecedor','filial = $1'],
    ['notas_recebidas','filial = $1'],
    ['recebimentos','filial = $1'],
    ['pedidos','filial = $1'],
    ['cotacoes','filial = $1'],
    ['aprovacoes_compras','filial = $1'],
    ['requisicoes','filial = $1'],
    -- (572) parcelas_emprestimo saiu daqui: e' a tabela de amortizacao, parte
    -- do contrato. Sai do reset junto com `emprestimos_filial`, mais abaixo.
    -- A FK ON DELETE SET NULL corta o elo com o titulo quando ele e' apagado.
    ['contas_receber','id IN (SELECT id FROM _reset_cr_matriz)'],
    ['contas_receber_baixas','filial = $1'],
    ['contas_pagar_baixas','filial = $1'],
    ['rateio_administrativo_itens','filial = $1'],
    -- (514) folha_credito_falhas saiu daqui: e' filha de folha_pagamento, que
    -- agora fica. Preservar a folha e apagar o registro do credito que falhou
    -- deixaria a linha preservada sem como explicar o proprio estado.
    ['contas_receber','filial = $1'],
    ['contas_pagar','filial = $1'],
    ['filial_investimentos','filial = $1'],
    ['previsoes','filial = $1'],
    ['duplicatas','filial = $1'],
    ['integracoes_bancarias','filial = $1'],
    ['movimentacoes_caixa','filial = $1'],
    ['controle_caixa_reaberturas','filial = $1'],
    ['controle_caixa','filial = $1'],
    -- (572) emprestimos_filial saiu daqui: o contrato e' historico da unidade,
    -- nao exercicio da turma. No lugar do DELETE vem o carimbo de
    -- `arquivado_em`, no fim da execucao real -- e e' ele que tira o
    -- emprestimo da conta de capital, ja que o reset por unidade nao carimba
    -- corte de turma nenhum (505).
    ['capital_filial','filial = $1'],
    -- (604) mesma razao de capital_filial: e' dinheiro da unidade zerada.
    ['aplicacoes_financeiras','filial = $1'],
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam da regua: historico de frequencia fica.
    -- (514) folha_rubricas e folha_pagamento sairam pelo mesmo motivo: o
    -- holerite e historico da pessoa. A conta a pagar da folha continua saindo
    -- (`contas_pagar`, acima) -- o financeiro e' que e' exercicio da turma.
    ['maxbank_folgas_conquistadas','colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['ferias','filial = $1'],
    ['treinamento_inscricoes','funcionario_id IN (SELECT id FROM public.funcionarios WHERE filial = $1)'],
    ['pesquisa_resposta_itens','resposta_id IN (SELECT r.id FROM public.pesquisa_respostas r JOIN public.pesquisas p ON p.id = r.pesquisa_id WHERE p.filial = $1)'],
    ['pesquisa_respostas','pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisa_perguntas','pesquisa_id IN (SELECT id FROM public.pesquisas WHERE filial = $1)'],
    ['pesquisas','filial = $1'],
    ['marketing_arte_feedback','arte_id IN (SELECT id FROM public.marketing_artes WHERE filial = $1)'],
    ['marketing_artes','filial = $1'],
    ['marketing_tarefas','filial = $1'],
    ['marketing_promocoes','filial = $1'],
    ['marketing_calendario','filial = $1'],
    ['marketing_cupons','filial = $1'],
    ['itens_campanha','campanha_id IN (SELECT id FROM public.marketing_campanhas WHERE filial = $1)'],
    ['marketing_campanhas','filial = $1'],
    ['orcamentos','filial = $1'],
    ['pedidos_venda','filial = $1'],
    ['maxbank_transacoes','conta_id IN (SELECT c.id FROM public.maxbank_contas c JOIN public.user_profiles u ON u.id = c.colaborador_id WHERE u.filial = $1)'],
    ['maxbank_transferencias','de_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1) OR para_colaborador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['maxbank_metas','filial = $1'],
    ['tarefas_taticas','meta_estrategica_id IN (SELECT m.id FROM public.metas_estrategicas m JOIN public.user_profiles u ON u.id = m.criada_por WHERE u.filial = $1)'],
    ['metas_estrategicas','criada_por IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['tarefas','filial = $1'],
    ['ti_chamados','filial = $1'],
    ['notificacoes','filial = $1'],
    ['requerimentos','filial = $1'],
    ['votacoes_votos','votacao_id IN (SELECT v.id FROM public.votacoes v JOIN public.user_profiles u ON u.id = v.criador_id WHERE u.filial = $1)'],
    ['votacoes','criador_id IN (SELECT id FROM public.user_profiles WHERE filial = $1)'],
    ['orcamento_itens','orcamento_id IN (SELECT id FROM public.orcamentos_periodo WHERE filial = $1)'],
    ['orcamentos_periodo','filial = $1'],
    ['prestacao_pareceres','prestacao_id IN (SELECT id FROM public.prestacoes_contas WHERE filial = $1)'],
    ['prestacoes_contas','filial = $1'],
    ['destinacoes_resultado','filial = $1'],
    ['apuracao_bonus_itens','filial = $1'],
    ['mandatos','filial = $1'],
    ['risco_revisoes','risco_id IN (SELECT id FROM public.riscos WHERE filial = $1)'],
    ['riscos','filial = $1'],
    ['auditoria_revisoes','filial = $1'],
    ['orcamento_mensal_categoria','filial = $1'],
    ['avaliacoes','filial = $1 AND tipo IS DISTINCT FROM ''matriz_filial'''],
    ['produtos_codigo_reserva','filial = $1'],
    ['produtos_custo','produto_id IN (SELECT id FROM public.produtos WHERE filial = $1)'],
    ['produtos','filial = $1'],
    ['servicos','filial = $1'],
    ['clientes','filial = $1'],
    ['projetos','filial = $1']];
  v_tab text; v_where text; v_i int; v_passada int;
  v_apagou bigint; v_total bigint := 0; v_progresso boolean;
  v_restou text := ''; v_contagem jsonb := '{}'::jsonb;
  v_estorno jsonb := '[]'::jsonb; v_devolvido numeric := 0;
  v_zeradas int := 0; v_emp_arquivar int := 0; r record;
BEGIN
  IF NOT COALESCE(public.auth_user_role() = 'admin', false)
     AND NOT public.auth_is_service_role() THEN
    RAISE EXCEPTION 'Apenas o administrador pode zerar uma unidade.'
      USING ERRCODE = '42501';
  END IF;

  IF p_filial IS NULL OR p_filial NOT IN ('SuperMax','MaxLook','TechMax') THEN
    RAISE EXCEPTION 'Reset por unidade é de SuperMax, MaxLook ou TechMax — recebi %. A Matriz é a contraparte de todas; para ela existe o APAGAR TUDO.',
      COALESCE(p_filial,'(vazio)') USING ERRCODE = 'P0001';
  END IF;

  DROP TABLE IF EXISTS _reset_cr_matriz;
  CREATE TEMP TABLE _reset_cr_matriz ON COMMIT DROP AS
    SELECT p.contas_receber_id AS id
      FROM public.parcelas_emprestimo p
      JOIN public.emprestimos_filial e ON e.id = p.emprestimo_id
     WHERE e.filial = p_filial AND p.contas_receber_id IS NOT NULL;

  -- (572) Quantos contratos serao arquivados (e nao apagados). O ensaio mostra
  -- o mesmo numero que a execucao real vai carimbar.
  SELECT count(*) INTO v_emp_arquivar
    FROM public.emprestimos_filial
   WHERE filial = p_filial AND arquivado_em IS NULL;

  FOR r IN
    SELECT b.id AS banco_id, COALESCE(b.banco, b.conta) AS banco_nome, SUM(x.valor) AS valor
      FROM (SELECT banco_origem_id AS banco, valor FROM public.capital_filial
             WHERE filial = p_filial AND banco_origem_id IS NOT NULL
            UNION ALL
            SELECT banco_id, valor FROM public.emprestimos_filial
             WHERE filial = p_filial AND status = 'Aprovado' AND banco_id IS NOT NULL
               -- (572) O emprestimo agora sobrevive ao reset. Sem este filtro,
               -- zerar a mesma unidade duas vezes estornaria o mesmo dinheiro
               -- duas vezes.
               AND arquivado_em IS NULL) x
      JOIN public.caixa_bancos b ON b.id = x.banco
     WHERE b.filial IS DISTINCT FROM p_filial
     GROUP BY b.id, COALESCE(b.banco, b.conta)
  LOOP
    v_estorno := v_estorno || jsonb_build_object('banco', r.banco_nome, 'devolvido', r.valor);
    v_devolvido := v_devolvido + r.valor;
    IF NOT p_dry_run THEN
      UPDATE public.caixa_bancos SET saldo = COALESCE(saldo,0) + r.valor WHERE id = r.banco_id;
    END IF;
  END LOOP;

  IF p_dry_run THEN
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN
        v_contagem := v_contagem || jsonb_build_object(v_tab,
          COALESCE((v_contagem ->> v_tab)::bigint,0) + v_apagou);
        v_total := v_total + v_apagou;
      END IF;
    END LOOP;
  ELSE
    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_alvos[v_i][1]);
    END LOOP;

    FOR v_passada IN 1 .. 6 LOOP
      v_progresso := false;
      FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
        v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
        BEGIN
          EXECUTE format('WITH del AS (DELETE FROM public.%I WHERE %s RETURNING 1) SELECT count(*) FROM del',
            v_tab, v_where) INTO v_apagou USING p_filial;
          IF v_apagou > 0 THEN
            v_progresso := true;
            v_contagem := v_contagem || jsonb_build_object(v_tab,
              COALESCE((v_contagem ->> v_tab)::bigint,0) + v_apagou);
            v_total := v_total + v_apagou;
          END IF;
        EXCEPTION WHEN foreign_key_violation THEN NULL;
        END;
      END LOOP;
      EXIT WHEN NOT v_progresso;
    END LOOP;

    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      v_tab := v_alvos[v_i][1]; v_where := v_alvos[v_i][2];
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_where)
        INTO v_apagou USING p_filial;
      IF v_apagou > 0 THEN v_restou := v_restou || v_tab || ' (' || v_apagou || '), '; END IF;
    END LOOP;

    FOR v_i IN 1 .. array_length(v_alvos,1) LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_alvos[v_i][1]);
    END LOOP;

    IF v_restou <> '' THEN
      RAISE EXCEPTION 'Reset abortado: sobraram linhas presas por chave estrangeira em %. Nada foi apagado.',
        rtrim(v_restou, ', ') USING ERRCODE = 'P0001';
    END IF;

    -- (572) Depois do laco, com os titulos ja apagados: o contrato vira
    -- historico fechado. Daqui para frente ele nao conta capital, nao aceita
    -- UPDATE e so sai por `apagar_emprestimo`.
    UPDATE public.emprestimos_filial
       SET arquivado_em = now()
     WHERE filial = p_filial AND arquivado_em IS NULL;
  END IF;

  SELECT count(*) INTO v_zeradas FROM public.caixa_bancos
   WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  IF NOT p_dry_run THEN
    UPDATE public.caixa_bancos SET saldo = 0
     WHERE filial = p_filial AND saldo IS DISTINCT FROM 0;
  END IF;

  DROP TABLE IF EXISTS _reset_cr_matriz;

  RETURN jsonb_build_object('sucesso', true, 'ensaio', p_dry_run, 'filial', p_filial,
    'linhas', v_total, 'por_tabela', v_contagem, 'contas_zeradas', v_zeradas,
    'estorno_matriz', v_estorno, 'estorno_total', v_devolvido,
    -- (504) O ponto da unidade nao entra mais na conta; o numero aparece pra
    -- quem roda o ensaio conferir que ele sobreviveu.
    'ponto_preservado', (SELECT count(*) FROM public.ponto_eletronico WHERE filial = p_filial),
    -- (514) Idem folha: quem roda o ensaio ve o que NAO vai sair.
    'folha_preservada', (SELECT count(*) FROM public.folha_pagamento
                          WHERE filial = p_filial AND COALESCE(ativo, true)),
    -- (572) Emprestimo nao sai: e' arquivado. O ensaio mostra quantos.
    'emprestimos_arquivados', v_emp_arquivar,
    'emprestimos_preservados', (SELECT count(*) FROM public.emprestimos_filial
                                 WHERE filial = p_filial),
    'executado_em', now());
END;
$function$;

COMMIT;

-- PostgREST guarda o schema em cache: sem isto a tela toma PGRST202 nas RPCs
-- novas.
NOTIFY pgrst, 'reload schema';
