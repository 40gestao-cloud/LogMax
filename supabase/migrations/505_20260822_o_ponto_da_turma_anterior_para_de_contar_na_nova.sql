-- 505_20260822_o_ponto_da_turma_anterior_para_de_contar_na_nova.sql
--
-- Fecha os dois furos que a 504 abriu de propósito e deixou nomeados.
--
-- A 504 preservou o Registro de Ponto no APAGAR TUDO. O efeito colateral é que
-- o ponto passou a ser do FUNCIONÁRIO e não da turma — e `funcionarios` também
-- atravessa o reset. Reaproveitar o cadastro de um funcionário para um aluno
-- novo herda o histórico do aluno anterior. Dois lugares mordiam:
--
--   FURO 2 — `recalcular_folha_do_ponto` casa por `funcionario_id` +
--   `to_char(data,'YYYY-MM') = mes_ref`. Folha de um mês que a turma anterior
--   já tinha ponto conta as faltas e os atrasos dela no salário do aluno novo.
--
--   FURO 3 — `registrar_ponto_manual` recusa o dia com "está coberto por um
--   afastamento" quando a linha preservada tem `afastamento_id`. A mensagem
--   manda ajustar pelo módulo Afastamentos, onde a pessoa encontra um
--   afastamento de outra turma e não entende mais nada.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A LINHA DE CORTE
-- ────────────────────────────────────────────────────────────────────────────
-- Os dois pedem a mesma coisa: saber onde termina a turma anterior. O primeiro
-- candidato foi `funcionarios.data_admissao`, e ele não serve — o campo é
-- digitado pelo aluno e os dados provam: no LogMax-ERP a admissão mais nova é
-- 2026-12-19 (quatro meses no futuro) e na turma aprendiz a mais antiga é
-- 2023-07-25. Trava em cima disso barraria o lançamento de gente que trabalha
-- hoje. Régua que depende de campo livre não é régua.
--
-- O que marca a virada de turma com precisão é o próprio APAGAR TUDO. Então
-- ele passa a carimbar a data em `configuracoes` (chave `ponto_corte_turma`),
-- tabela que ele mesmo preserva desde a 377. Sem carimbo — projeto que nunca
-- resetou — nada muda: as três funções voltam ao comportamento de hoje.
--
-- O reset POR UNIDADE não carimba: o corte é global e uma unidade zerada não
-- encerra a turma das vizinhas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE CADA UMA PASSA A FAZER
-- ────────────────────────────────────────────────────────────────────────────
-- `recalcular_folha_do_ponto` — ignora dia anterior ao corte. Não é só
-- anti-vazamento: é a regra certa da folha. Falta de antes da virada não
-- desconta o salário de quem chegou depois. O retorno passa a dizer quantos
-- dias ficaram de fora, para o número não mudar em silêncio.
--
-- `registrar_ponto_manual` — recusa reescrever LINHA anterior ao corte. Repare
-- que a trava é sobre a linha existente, não sobre a data: lançar num dia
-- antigo que ninguém preencheu continua permitido, porque não destrói nada. O
-- que não se faz é passar por cima do registro da turma anterior — e é isso
-- que a mensagem diz, no lugar do "coberto por um afastamento" do furo 3.
--
-- `afastamento_valida_periodo` — recusa afastamento que COMEÇA antes do corte,
-- na mesma família das validações de "confira o ano" que já moram ali. Sem
-- isso sobrava a porta dos fundos: `aplicar_afastamento_no_ponto` reescreve as
-- linhas do período, e um período retroativo alcançaria o histórico
-- preservado por um caminho que nem passa pelo lançamento manual.
--
-- FICA EM ABERTO, e de propósito: aprovar um afastamento PENDENTE herdado da
-- turma anterior ainda escreve nas linhas antigas dele — o gatilho de período
-- sai cedo quando as datas não mudam. Fechar isso exigiria decidir o que fazer
-- com a fila de pendentes no reset, que é outra conversa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE OS CORPOS
-- ────────────────────────────────────────────────────────────────────────────
-- Copiados de `prosrc`, não reescritos. md5 idêntico nas 4 ANTES desta:
--   resetar_dados_operacionais   d1d37c93d600e2e54f2d1a08483f87df  (504)
--   recalcular_folha_do_ponto    ca15a6bd1d85d0b582c42a3f5094a7dc
--   registrar_ponto_manual       a6150a2dfc34338ca873ee370c407af0
--   afastamento_valida_periodo   5801ecbeba9d89eaca675b80681a0306
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) A linha de corte
-- ════════════════════════════════════════════════════════════════════════════
-- STABLE e não IMMUTABLE: o valor muda quando o professor reseta.
-- SECURITY DEFINER para não depender da RLS de `configuracoes` (hoje a leitura
-- é aberta a authenticated, mas quem chama são funções que não podem quebrar
-- se essa policy apertar).
CREATE OR REPLACE FUNCTION public.ponto_corte_turma()
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_txt text;
BEGIN
  SELECT valor INTO v_txt FROM public.configuracoes WHERE chave = 'ponto_corte_turma';
  IF v_txt IS NULL OR btrim(v_txt) = '' THEN
    RETURN NULL;
  END IF;
  -- Texto digitado à mão na tabela de configurações não pode derrubar a folha.
  BEGIN
    RETURN btrim(v_txt)::date;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$function$;

COMMENT ON FUNCTION public.ponto_corte_turma() IS
  'Migr. 505 - data do ultimo APAGAR TUDO. Ponto anterior a ela e da turma passada: nao conta na folha e nao se reescreve. NULL = projeto que nunca resetou.';

-- Função nova nasce com EXECUTE para PUBLIC, e PUBLIC inclui `anon`.
REVOKE ALL ON FUNCTION public.ponto_corte_turma() FROM public;
REVOKE ALL ON FUNCTION public.ponto_corte_turma() FROM anon;
GRANT EXECUTE ON FUNCTION public.ponto_corte_turma() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ponto_corte_turma() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) O APAGAR TUDO carimba a virada
-- ════════════════════════════════════════════════════════════════════════════
-- Corpo da 504 + o carimbo no fim + `corte_turma` no retorno. O TRUNCATE não
-- muda nem uma vírgula.
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

  TRUNCATE TABLE
    itens_venda, vendas, pix_pendentes, cartao_pendentes,
    movimentacoes_estoque, inventarios, recebimentos, notas_recebidas,
    expedicao, vencimentos_estoque, requisicoes_estoque, aprovacoes_estoque,
    pedidos, cotacoes, aprovacoes_compras, requisicoes,
    contas_receber, contas_pagar, previsoes, duplicatas,
    integracoes_bancarias, controle_caixa, emprestimos_filial,
    -- (504) ponto_eletronico, ponto_qr_registros, afastamentos e
    -- justificativas_falta sairam daqui: sao o historico de frequencia, do
    -- mesmo lado de frequencia_trabalho. As duas ultimas ficam porque o
    -- CASCADE e o gatilho de reversao levariam o ponto junto.
    folha_pagamento, ferias,
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
    -- (482) fornecedores saiu daqui: fundo de cadastro, nao exercicio.
    produtos, servicos, clientes,
    projetos,
    -- (486) Rascunho do botao "Gerar" (481). Mesma decisao da 485.
    produtos_codigo_reserva,
    -- (482) categorias_produto/subcategorias_produto sairam daqui: a categoria
    -- carrega o markup-alvo (360). O orcamento POR categoria continua zerando.
    orcamento_mensal_categoria
  RESTART IDENTITY CASCADE;

  -- (505) A virada de turma. `configuracoes` sobrevive ao reset desde a 377,
  -- entao o carimbo fica de pe para a turma nova. Daqui para tras o ponto e da
  -- turma passada: nao conta na folha e nao se reescreve.
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

-- ════════════════════════════════════════════════════════════════════════════
-- 3) FURO 2 — a folha para de contar falta de outra turma
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recalcular_folha_do_ponto(p_folha_id uuid, p_target_entrada text DEFAULT '07:40'::text, p_target_retorno text DEFAULT '09:20'::text, p_target_saida text DEFAULT '11:20'::text, p_tolerancia_min integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_funcionario_id   uuid;
  v_salario_base     numeric(12,2);
  v_mes_ref          text;
  v_status           text;
  v_competencia      date;
  v_dependentes      int := 0;
  v_fgts_aliq        numeric;
  v_valor_hora       numeric;
  v_target           time;
  v_jornada          numeric;
  v_horas_mes        numeric;
  v_horas_atraso     numeric := 0;
  v_horas_falta      numeric := 0;
  v_horas_extras     numeric := 0;
  v_horas_perdoadas  numeric := 0;
  v_desc_faltas      numeric := 0;
  v_desc_manual      numeric := 0;
  v_base_inss        numeric := 0;
  v_inss             numeric := 0;
  v_irrf             numeric := 0;
  v_fgts             numeric := 0;
  v_descontos        numeric;
  v_bonus_extra      numeric;
  v_salario_bruto    numeric;
  v_salario_liquido  numeric;
  v_atraso_min       numeric;
  -- (505) Linha de corte da turma e quantos dias ela deixou de fora.
  v_corte            date := public.ponto_corte_turma();
  v_dias_anteriores  int := 0;
  r                  record;
BEGIN
  PERFORM public._assert_rpc('rh', 'financeiro');

  SELECT funcionario_id, COALESCE(salario_base, salario_bruto), mes_ref, status,
         COALESCE(desconto_manual, 0)
    INTO v_funcionario_id, v_salario_base, v_mes_ref, v_status, v_desc_manual
    FROM folha_pagamento
   WHERE id = p_folha_id
     AND COALESCE(ativo, true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada ou inativa: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'Pendente' THEN
    RAISE EXCEPTION 'Só é possível recalcular folha em status Pendente (atual: %).', v_status;
  END IF;

  IF v_salario_base IS NULL OR v_salario_base <= 0 THEN
    RAISE EXCEPTION 'Salário base inválido (%) — preencha antes de recalcular.', v_salario_base;
  END IF;

  BEGIN
    v_competencia := to_date(v_mes_ref || '-01', 'YYYY-MM-DD');
  EXCEPTION WHEN OTHERS THEN
    v_competencia := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  END;

  SELECT COALESCE(dependentes, 0) INTO v_dependentes
    FROM funcionarios WHERE id = v_funcionario_id;
  v_dependentes := COALESCE(v_dependentes, 0);

  SELECT COALESCE(fgts_aliquota, 0.08) INTO v_fgts_aliq
    FROM rh_parametros WHERE vigencia_inicio = public.rh_vigencia_em(v_competencia);
  v_fgts_aliq := COALESCE(v_fgts_aliq, 0.08);

  v_target  := (p_target_entrada || ':00')::time;
  v_jornada := EXTRACT(EPOCH FROM (
                 (p_target_saida || ':00')::time - (p_target_entrada || ':00')::time
               )) / 3600.0;

  IF v_jornada IS NULL OR v_jornada <= 0 THEN
    RAISE EXCEPTION 'Jornada inválida: entrada % e saída % não formam um expediente.', p_target_entrada, p_target_saida
      USING ERRCODE = 'P0001';
  END IF;

  v_horas_mes  := v_jornada * 27.5;
  v_valor_hora := v_salario_base / v_horas_mes;

  -- (505) Quantos dias da competência são da turma anterior. Contado antes de
  -- somar, e devolvido no retorno: número que muda sozinho e não se explica é
  -- exatamente o que esta migração está corrigindo.
  IF v_corte IS NOT NULL THEN
    SELECT count(*) INTO v_dias_anteriores
      FROM ponto_eletronico p
     WHERE p.funcionario_id = v_funcionario_id
       AND to_char(p.data, 'YYYY-MM') = v_mes_ref
       AND p.data < v_corte;
  END IF;

  FOR r IN
    SELECT p.data, p.entrada, p.horas_trabalhadas, p.status,
           COALESCE(a.status = 'Aprovado' AND COALESCE(a.ativo, true), false) AS perdoado
      FROM ponto_eletronico p
      LEFT JOIN afastamentos a ON a.id = p.afastamento_id
     WHERE p.funcionario_id = v_funcionario_id
       AND to_char(p.data, 'YYYY-MM') = v_mes_ref
       -- (505) Falta de antes da virada de turma não desconta o salário de
       -- quem chegou depois. Sem carimbo (nunca resetou), nada é filtrado.
       AND (v_corte IS NULL OR p.data >= v_corte)
  LOOP
    IF r.status = 'Falta' THEN
      v_horas_falta := v_horas_falta + v_jornada;

    ELSIF r.status = 'Justificado' THEN
      IF r.perdoado THEN
        v_horas_perdoadas := v_horas_perdoadas + v_jornada;
      ELSE
        v_horas_falta := v_horas_falta + v_jornada;
      END IF;

    ELSIF r.status = 'Hora Extra' THEN
      v_horas_extras := v_horas_extras + GREATEST(COALESCE(r.horas_trabalhadas, 0) - v_jornada, 0);
    END IF;

    IF r.entrada IS NOT NULL
       AND r.status NOT IN ('Falta', 'Justificado')
    THEN
      v_atraso_min := EXTRACT(EPOCH FROM (r.entrada::time - v_target)) / 60.0;
      IF v_atraso_min > p_tolerancia_min THEN
        v_horas_atraso := v_horas_atraso + (v_atraso_min / 60.0);
      END IF;
    END IF;
  END LOOP;

  v_desc_faltas   := ROUND((v_horas_atraso + v_horas_falta) * v_valor_hora, 2);
  v_bonus_extra   := ROUND(v_horas_extras * v_valor_hora * 1.5, 2);
  -- Base de encargos: só faltas reduzem. O desconto manual é retenção sobre o
  -- líquido e fica fora daqui de propósito.
  v_base_inss     := GREATEST(ROUND(v_salario_base + v_bonus_extra, 2) - v_desc_faltas, 0);

  v_inss := public.rh_calc_inss(v_base_inss, v_competencia);
  v_irrf := public.rh_calc_irrf(v_base_inss - v_inss, v_competencia, v_dependentes);
  v_fgts := ROUND(v_base_inss * v_fgts_aliq, 2);

  DELETE FROM public.folha_rubricas WHERE folha_id = p_folha_id;

  INSERT INTO public.folha_rubricas
    (folha_id, codigo, descricao, tipo, referencia, valor,
     incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
  VALUES
    (p_folha_id, '001', 'Salário base', 'provento', '30 dias', v_salario_base,
     true, true, true, false, 1);

  IF v_bonus_extra > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '002', 'Horas extras 50%', 'provento',
       to_char(v_horas_extras, 'FM999990.00') || ' h', v_bonus_extra,
       true, true, true, true, 2);
  END IF;

  IF v_desc_faltas > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '101', 'Faltas e atrasos', 'desconto',
       to_char(v_horas_atraso + v_horas_falta, 'FM999990.00') || ' h', v_desc_faltas,
       true, true, true, false, 10);
  END IF;

  -- A correção desta migration: o lançamento manual vira rubrica em vez de
  -- ser engolido pela soma.
  IF v_desc_manual > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '199', 'Descontos (lançamento manual)', 'desconto', NULL, v_desc_manual,
       false, false, false, false, 19);
  END IF;

  IF v_inss > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '201', 'INSS', 'desconto',
       'base ' || to_char(v_base_inss, 'FM999G999G990D00'), v_inss,
       false, false, false, false, 20);
  END IF;

  IF v_irrf > 0 THEN
    INSERT INTO public.folha_rubricas
      (folha_id, codigo, descricao, tipo, referencia, valor,
       incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
    VALUES
      (p_folha_id, '202', 'IRRF', 'desconto',
       CASE WHEN v_dependentes > 0 THEN v_dependentes || ' dep.' ELSE NULL END, v_irrf,
       false, false, false, false, 21);
  END IF;

  INSERT INTO public.folha_rubricas
    (folha_id, codigo, descricao, tipo, referencia, valor,
     incide_inss, incide_irrf, incide_fgts, integra_media, ordem)
  VALUES
    (p_folha_id, '901', 'FGTS depositado (empregador)', 'informativa',
     to_char(v_fgts_aliq * 100, 'FM990D00') || '%', v_fgts,
     false, false, false, false, 90);

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'provento'), 0),
    COALESCE(SUM(valor) FILTER (WHERE tipo = 'desconto'), 0)
    INTO v_salario_bruto, v_descontos
    FROM public.folha_rubricas WHERE folha_id = p_folha_id;

  v_salario_liquido := ROUND(v_salario_bruto - v_descontos, 2);

  IF v_descontos > v_salario_bruto THEN
    v_descontos       := v_salario_bruto;
    v_salario_liquido := 0;
  END IF;

  UPDATE folha_pagamento
     SET salario_bruto   = v_salario_bruto,
         descontos       = v_descontos,
         salario_liquido = v_salario_liquido,
         horas_atraso    = ROUND(v_horas_atraso, 2),
         horas_falta     = v_horas_falta,
         horas_extras    = v_horas_extras,
         desconto_faltas = v_desc_faltas,
         base_inss       = v_base_inss,
         desconto_inss   = v_inss,
         desconto_irrf   = v_irrf,
         fgts_deposito   = v_fgts
   WHERE id = p_folha_id;

  RETURN jsonb_build_object(
    'valor_hora',       ROUND(v_valor_hora, 2),
    'jornada_diaria',   ROUND(v_jornada, 2),
    'horas_mes',        ROUND(v_horas_mes, 2),
    'horas_atraso',     ROUND(v_horas_atraso, 2),
    'horas_falta',      v_horas_falta,
    'horas_perdoadas',  v_horas_perdoadas,
    'horas_extras',     v_horas_extras,
    'competencia',      v_competencia,
    'vigencia_tabela',  public.rh_vigencia_em(v_competencia),
    'dependentes',      v_dependentes,
    'desconto_faltas',  v_desc_faltas,
    'desconto_manual',  v_desc_manual,
    'base_inss',        v_base_inss,
    'desconto_inss',    v_inss,
    'desconto_irrf',    v_irrf,
    'fgts_deposito',    v_fgts,
    'descontos',        v_descontos,
    'bonus_extra',      v_bonus_extra,
    'salario_base',     v_salario_base,
    'salario_bruto',    v_salario_bruto,
    'salario_liquido',  v_salario_liquido,
    -- (505) O que ficou de fora, e por qual corte.
    'corte_turma',              v_corte,
    'dias_turma_anterior_fora', v_dias_anteriores,
    'rubricas',         (SELECT count(*) FROM public.folha_rubricas WHERE folha_id = p_folha_id)
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) FURO 3 — o lançamento manual não reescreve linha de outra turma
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.registrar_ponto_manual(p_funcionario_id uuid, p_data date, p_status text, p_entrada text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_horas numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_filial     text;
  v_nome       text;
  v_desligado  boolean;
  v_existente  record;
  v_horas      numeric;
  v_quem       text;
  v_sem_hora   boolean;
  v_corte      date := public.ponto_corte_turma();
BEGIN
  PERFORM public._assert_rpc();

  IF p_status NOT IN ('Normal', 'Falta', 'Justificado') THEN
    RAISE EXCEPTION 'Status inválido para lançamento manual: %. Use Normal, Falta ou Justificado.', p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- O motivo é o que separa a falta justificada da falta.
  IF p_status = 'Justificado' AND COALESCE(btrim(p_observacao), '') = '' THEN
    RAISE EXCEPTION 'Falta justificada precisa de justificativa escrita.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_data > (now() AT TIME ZONE 'America/Rio_Branco')::date THEN
    RAISE EXCEPTION 'Não dá para lançar presença de um dia que ainda não aconteceu.'
      USING ERRCODE = 'P0001';
  END IF;

  -- A linha que muda tudo: em recuperação, o ponto é da Matriz. Mesma régua da
  -- trigger e do placar — aqui ela serve à **autorização** logo abaixo.
  SELECT f.nome,
         public._funcionario_desligado(f.id),
         CASE WHEN public._funcionario_desligado(f.id)
              THEN 'Matriz'
              ELSE COALESCE(f.filial, 'Matriz')
         END
    INTO v_nome, v_desligado, v_filial
    FROM public.funcionarios f WHERE f.id = p_funcionario_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.auth_in_setor('rh') OR public.auth_gerente_da(v_filial)) THEN
    RAISE EXCEPTION 'Só o RH ou o gerente da filial lançam presença.'
      USING ERRCODE = '42501';
  END IF;

  -- Mensagem própria para o caso novo: sem ela o gerente da filial levaria um
  -- "Funcionário de outra filial" sobre alguém que era dele ontem, e ia achar
  -- que é bug.
  IF NOT COALESCE(public.auth_pode_filial(v_filial), false) THEN
    IF v_desligado THEN
      RAISE EXCEPTION '% está desligado da filial e em recuperação — quem lança o ponto agora é a Matriz.', COALESCE(v_nome, 'Este funcionário')
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Funcionário de outra filial.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existente
    FROM public.ponto_eletronico
   WHERE funcionario_id = p_funcionario_id AND data = p_data
   FOR UPDATE;

  -- (505) Antes da checagem de afastamento, e de propósito: quando a linha é
  -- da turma anterior, o afastamento que a cobre também é, e mandar "ajuste
  -- pelo módulo Afastamentos" levava a pessoa a um afastamento de outra turma.
  -- A trava é sobre a LINHA, não sobre a data: dia antigo sem registro segue
  -- lançável, porque lançar ali não apaga nada de ninguém.
  IF FOUND AND v_corte IS NOT NULL AND p_data < v_corte THEN
    RAISE EXCEPTION 'Dia % de % é registro da turma anterior (o APAGAR TUDO de % fechou aquele período). Ele continua visível no Registro de Ponto, mas não se reescreve por aqui.',
      p_data, COALESCE(v_nome, 'funcionário'), v_corte
      USING ERRCODE = 'P0001';
  END IF;

  IF FOUND AND v_existente.afastamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dia % de % está coberto por um afastamento. Ajuste pelo módulo Afastamentos.', p_data, COALESCE(v_nome, 'funcionário')
      USING ERRCODE = 'P0001';
  END IF;

  IF FOUND AND COALESCE(v_existente.origem, 'legado') = 'legado' AND v_existente.entrada IS NOT NULL THEN
    p_observacao := COALESCE(p_observacao || ' · ', '')
      || 'Substitui registro anterior (entrada ' || v_existente.entrada || ')';
  END IF;

  v_sem_hora := p_status IN ('Falta', 'Justificado');

  v_horas := CASE
    WHEN v_sem_hora THEN 0
    ELSE COALESCE(p_horas, 3.67)   -- 07:40→11:20, jornada padrão da manhã
  END;
  v_quem  := COALESCE((SELECT nome FROM public.user_profiles WHERE id = auth.uid()), 'RH');

  -- ON CONFLICT toca `filial` de propósito: é o que faz a trigger disparar no
  -- UPDATE e reavaliar a regra. Um dia lançado pela filial antes do
  -- desligamento e reeditado depois passa a ser da Matriz, em vez de ficar com
  -- a filial antiga e voltar a pesar no placar dela. O valor aqui é só o
  -- gatilho — quem decide é a trigger.
  INSERT INTO public.ponto_eletronico
    (funcionario_id, data, status, entrada, horas_trabalhadas, filial,
     origem, observacao, registrado_por, registrado_por_nome)
  VALUES
    (p_funcionario_id, p_data, p_status,
     CASE WHEN v_sem_hora THEN NULL ELSE p_entrada END,
     v_horas, v_filial, 'manual', p_observacao, auth.uid(), v_quem)
  ON CONFLICT (funcionario_id, data) DO UPDATE
     SET status              = EXCLUDED.status,
         entrada             = EXCLUDED.entrada,
         horas_trabalhadas   = EXCLUDED.horas_trabalhadas,
         filial              = EXCLUDED.filial,
         origem              = 'manual',
         observacao          = EXCLUDED.observacao,
         registrado_por      = EXCLUDED.registrado_por,
         registrado_por_nome = EXCLUDED.registrado_por_nome;

  RETURN jsonb_build_object(
    'ok', true, 'status', p_status, 'data', p_data,
    'funcionario', v_nome, 'filial', v_filial, 'horas', v_horas,
    'em_recuperacao', v_desligado
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) A porta dos fundos: afastamento retroativo
-- ════════════════════════════════════════════════════════════════════════════
-- `aplicar_afastamento_no_ponto` reescreve as linhas do período. Sem esta
-- validação, um afastamento com data_inicio antiga alcançaria o histórico
-- preservado sem passar pelo lançamento manual.
CREATE OR REPLACE FUNCTION public.afastamento_valida_periodo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limite_dias  constant int := 365;
  v_limite_frente constant int := 365;
  v_hoje date := (now() AT TIME ZONE 'America/Rio_Branco')::date;
  v_corte date := public.ponto_corte_turma();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.data_inicio IS NOT DISTINCT FROM OLD.data_inicio
     AND NEW.data_fim    IS NOT DISTINCT FROM OLD.data_fim THEN
    RETURN NEW;
  END IF;

  IF NEW.data_fim < NEW.data_inicio THEN
    RAISE EXCEPTION 'Fim (%) não pode ser antes do início (%).', NEW.data_fim, NEW.data_inicio
      USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.data_fim - NEW.data_inicio) + 1 > v_limite_dias THEN
    RAISE EXCEPTION 'Afastamento de % dias excede o limite de % dias. Confira o ano das datas (% a %).',
      (NEW.data_fim - NEW.data_inicio) + 1, v_limite_dias, NEW.data_inicio, NEW.data_fim
      USING ERRCODE = 'P0001';
  END IF;

  -- Agendar afastamento futuro é legítimo (licença maternidade, cirurgia
  -- marcada). Ir além de um ano à frente é dedo errado no ano, não plano.
  IF NEW.data_fim > v_hoje + v_limite_frente THEN
    RAISE EXCEPTION 'Fim em % passa de um ano à frente. Confira o ano.', NEW.data_fim
      USING ERRCODE = 'P0001';
  END IF;

  -- (505) Mesma família das duas acima: data que cai antes da virada de turma
  -- é ano errado ou período de outra turma. O afastamento reescreve o ponto do
  -- período, então aqui a data importa mesmo quando não existe linha ainda.
  IF v_corte IS NOT NULL AND NEW.data_inicio < v_corte THEN
    RAISE EXCEPTION 'Início em % é anterior ao APAGAR TUDO de % — aquele período é da turma anterior e o ponto dele não se reescreve.',
      NEW.data_inicio, v_corte
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT public.ponto_corte_turma();           -- NULL antes do 1º reset
--   SELECT * FROM public.configuracoes WHERE chave = 'ponto_corte_turma';
--
--   -- O carimbo existe no reset e o corte chega nas três consumidoras:
--   SELECT proname, prosrc LIKE '%ponto_corte_turma%' AS usa_corte
--     FROM pg_proc
--    WHERE proname IN ('resetar_dados_operacionais', 'recalcular_folha_do_ponto',
--                      'registrar_ponto_manual', 'afastamento_valida_periodo')
--    ORDER BY 1;
--   -- espera t nas quatro
--
--   -- anon não executa o helper:
--   SELECT has_function_privilege('anon', 'public.ponto_corte_turma()', 'EXECUTE');
--   -- espera f
--
--   -- md5 depois desta, idêntico nas 4:
--   --   ponto_corte_turma           4072c53340b7f96abe236f5f68adcbde
--   --   resetar_dados_operacionais  9ff7284aba40824c8ee970d674a91d09
--   --   recalcular_folha_do_ponto   cd407c4d7fa5fb447740c18fb4870c9e
--   --   registrar_ponto_manual      643f8f5b871b0ca92be16b3c1835483a
--   --   afastamento_valida_periodo  d0f5246e83ebe2dec3cd1b6d335273dc
--
--   -- Ensaio do corte sem apagar nada (rode e desfaça):
--   --   INSERT INTO configuracoes (chave, valor) VALUES ('ponto_corte_turma','2026-08-01')
--   --     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
--   --   SELECT public.ponto_corte_turma();  -- 2026-08-01
--   --   DELETE FROM configuracoes WHERE chave = 'ponto_corte_turma';
-- ════════════════════════════════════════════════════════════════════════════
