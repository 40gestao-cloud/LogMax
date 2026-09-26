-- 634 — Montagem da filial chega ao Financeiro de verdade (etapas 1 a 3).
--
-- Contexto medido em 26/09 (ERP, Aprendiz, Contabilidade): zero linhas em
-- filial_investimentos, zero contas com origem 'montagem_filial', zero bens.
-- O "Total investido" que a tela de Filiais mostra vinha só do jsonb
-- `filiais.detalhes` da grade antiga — nunca virou conta a pagar. O caminho
-- (salvar, reabrir, "Importar de Detalhes", preencher preço, achar o botão no
-- fim do formulário) era escondido demais para alguém usar.
--
-- 1. Backfill: a grade antiga de `detalhes` vira item em filial_investimentos,
--    só em filial que ainda não tem item nenhum. É o mesmo que o botão
--    "Importar de Detalhes" faz, feito uma vez para todas. Não gera conta:
--    o item nasce PLANEJADO; lançar continua sendo gesto do aluno.
--
-- 2. `lancar_investimento_filial`: lança UM item, à vista ou em N parcelas.
--    Equipamento e "outro" dividem o valor total pelas parcelas (centavo que
--    sobra vai na última); aluguel repete o valor todo mês. Equipamento segue
--    virando bem de patrimônio (migr. 511) pelo valor TOTAL, independente de
--    como foi pago. `gerar_contas_da_montagem` (lote, à vista) fica como está.
--
-- 3. `vender_patrimonio`: baixa o bem E cria a conta a receber, à vista ou
--    parcelada. O ganho/perda continua saindo da baixa no DRE (migr. 511) —
--    `gerar_dre` não lê contas_receber, então o recebimento não duplica a
--    receita. A conta leva `produto_patrimonio_id`: é por ele que a tela de
--    Filiais sabe que o bem foi vendido e quanto já entrou.
--
-- 4. `desvincular_investimento_conta` passa a recusar item cujo bem já foi
--    baixado: cancelar a compra de um bem vendido deixaria uma venda sem
--    compra, com conta a receber viva.

BEGIN;

-- ── Vínculo conta a receber → bem vendido ────────────────────────────────
ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS produto_patrimonio_id uuid REFERENCES public.produtos(id);

CREATE INDEX IF NOT EXISTS idx_contas_receber_produto_patrimonio
  ON public.contas_receber (produto_patrimonio_id)
  WHERE produto_patrimonio_id IS NOT NULL;

COMMENT ON COLUMN public.contas_receber.produto_patrimonio_id IS
  'Migr. 634. Bem de patrimônio cuja venda gerou esta conta (todas as parcelas apontam para ele).';

-- ── 1. Backfill da grade antiga ──────────────────────────────────────────
WITH grade(nicho, chave, rotulo) AS (VALUES
  ('SuperMax','gondolas','Gôndolas'), ('SuperMax','freezers','Freezers / Geladeiras'),
  ('SuperMax','camarasFrias','Câmaras frias'), ('SuperMax','balancas','Balanças'),
  ('SuperMax','esteirasCaixa','Esteiras de caixa'), ('SuperMax','pdvs','PDVs (checkouts)'),
  ('SuperMax','carrinhos','Carrinhos'), ('SuperMax','cestas','Cestas'),
  ('SuperMax','setoresEspeciais','Setores (açougue/padaria/hortifruti)'),
  ('SuperMax','arCondicionados','Ar-condicionados'), ('SuperMax','camerasSeguranca','Câmeras de segurança'),
  ('SuperMax','extintores','Extintores'),
  ('MaxLook','provadores','Provadores'), ('MaxLook','araras','Araras (roupas)'),
  ('MaxLook','manequins','Manequins'), ('MaxLook','prateleirasCalcado','Prateleiras de calçados'),
  ('MaxLook','espelhos','Espelhos'), ('MaxLook','expositoresPerfume','Expositores de perfume'),
  ('MaxLook','balcaoMaquiagem','Balcões de maquiagem'), ('MaxLook','testers','Testers em exposição'),
  ('MaxLook','iluminacaoEspecial','Spots de iluminação'), ('MaxLook','antifurtos','Sensores antifurto'),
  ('MaxLook','pdvs','PDVs (caixas)'), ('MaxLook','arCondicionados','Ar-condicionados'),
  ('MaxLook','camerasSeguranca','Câmeras de segurança'),
  ('TechMax','bancadasReparo','Bancadas de reparo'), ('TechMax','estacoesSolda','Estações de solda'),
  ('TechMax','multimetros','Multímetros'), ('TechMax','osciloscopios','Osciloscópios'),
  ('TechMax','ferramentasSet','Kits de ferramentas'), ('TechMax','estacoesEsd','Estações antiestática (ESD)'),
  ('TechMax','vitrinesExposicao','Vitrines de exposição'), ('TechMax','vitrinesAcessorios','Vitrines de acessórios'),
  ('TechMax','estoquePecas','Compartimentos de peças'), ('TechMax','pdvs','PDVs (caixas)'),
  ('TechMax','arCondicionados','Ar-condicionados'), ('TechMax','camerasSeguranca','Câmeras de segurança'),
  ('Matriz','salasReuniao','Salas de reunião'), ('Matriz','estacoesTrabalho','Estações de trabalho'),
  ('Matriz','servidoresRack','Servidores / Racks'), ('Matriz','telefones','Telefones'),
  ('Matriz','quadrosBrancos','Quadros brancos'), ('Matriz','impressoras','Impressoras'),
  ('Matriz','arCondicionados','Ar-condicionados'), ('Matriz','camerasSeguranca','Câmeras de segurança'),
  ('Matriz','extintores','Extintores')
),
alvo AS (
  -- Mesma régua de unidade da RPC de lote: nicho gravado, senão o nome.
  SELECT f.id, f.detalhes,
         COALESCE(
           CASE WHEN f.detalhes->>'nicho' IN ('SuperMax','MaxLook','TechMax','Matriz') THEN f.detalhes->>'nicho' END,
           CASE WHEN f.nome ILIKE '%supermax%' THEN 'SuperMax'
                WHEN f.nome ILIKE '%maxlook%'  THEN 'MaxLook'
                WHEN f.nome ILIKE '%techmax%'  THEN 'TechMax' END,
           'Matriz') AS nicho
    FROM public.filiais f
   WHERE f.detalhes IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.filial_investimentos i WHERE i.filial_id = f.id AND i.ativo)
)
INSERT INTO public.filial_investimentos
  (filial_id, filial, chave, rotulo, origem_campo, categoria, quantidade, preco_unitario)
SELECT a.id, a.nicho, g.chave, g.rotulo, 'grade', 'equipamento',
       (a.detalhes->>g.chave)::numeric,
       -- CASE e não AND: o planejador não promete avaliar o typeof antes do cast.
       COALESCE(CASE WHEN jsonb_typeof(a.detalhes->(g.chave || 'Preco')) = 'number'
                     THEN (a.detalhes->>(g.chave || 'Preco'))::numeric END, 0)
  FROM alvo a
  JOIN grade g ON g.nicho = a.nicho
 WHERE CASE WHEN jsonb_typeof(a.detalhes->g.chave) = 'number'
            THEN (a.detalhes->>g.chave)::numeric END > 0
UNION ALL
SELECT a.id, a.nicho, 'aluguel', 'Aluguel', 'customizado', 'aluguel', 1,
       (a.detalhes->>'valorAluguel')::numeric
  FROM alvo a
 WHERE a.detalhes->>'tipoImovel' = 'Alugado'
   AND CASE WHEN jsonb_typeof(a.detalhes->'valorAluguel') = 'number'
            THEN (a.detalhes->>'valorAluguel')::numeric END > 0;

-- ── 2. Lançar um item, à vista ou parcelado ──────────────────────────────
CREATE OR REPLACE FUNCTION public.lancar_investimento_filial(
  p_item_id             uuid,
  p_primeiro_vencimento date,
  p_parcelas            integer DEFAULT 1,
  p_intervalo_dias      integer DEFAULT 30,
  p_natureza_outro      text    DEFAULT 'despesa'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item     public.filial_investimentos;
  v_total    numeric;
  v_parcela  numeric;
  v_valor    numeric;
  v_soma     numeric := 0;
  v_venc     date;
  v_cp_id    uuid;
  v_primeira uuid;
  v_prod_id  uuid;
  v_natureza text;
  v_desc     text;
  i          integer;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_item FROM public.filial_investimentos WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR NOT v_item.ativo THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_item.filial), false)
     OR NOT COALESCE(public.auth_is_admin() OR public.auth_gerente_da(v_item.filial), false) THEN
    RAISE EXCEPTION 'Apenas admin/CEO/conselheiro ou o gerente da unidade lançam a montagem.'
      USING ERRCODE = '42501';
  END IF;

  -- Mesmo lock da RPC de lote: um lançamento por item e o lote não se cruzam.
  PERFORM pg_advisory_xact_lock(hashtext('montagem_filial:' || v_item.filial_id::text));

  IF v_item.conta_pagar_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.contas_pagar cp
                 WHERE cp.filial_investimento_id = v_item.id
                   AND COALESCE(cp.ativo, true) AND cp.status <> 'Cancelado') THEN
    RAISE EXCEPTION 'Este item já foi lançado no Financeiro.' USING ERRCODE = 'P0001';
  END IF;

  v_total := COALESCE(v_item.valor_total, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Item sem valor — informe quantidade e preço antes de lançar.' USING ERRCODE = 'P0001';
  END IF;
  IF p_primeiro_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe o primeiro vencimento.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_parcelas, 0) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Parcelas: de 1 a 60.' USING ERRCODE = 'P0001';
  END IF;
  IF v_item.categoria <> 'aluguel' AND COALESCE(p_intervalo_dias, 0) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Intervalo entre parcelas: de 1 a 365 dias.' USING ERRCODE = 'P0001';
  END IF;

  v_natureza := CASE v_item.categoria
                  WHEN 'equipamento' THEN 'imobilizado'
                  WHEN 'aluguel'     THEN 'despesa'
                  ELSE p_natureza_outro END;
  IF COALESCE(v_natureza, '') NOT IN ('despesa', 'estoque', 'imobilizado') THEN
    RAISE EXCEPTION 'Natureza inválida: %', p_natureza_outro USING ERRCODE = 'P0001';
  END IF;

  -- Aluguel: o valor é mensal e se repete. Compra: o total se divide.
  v_parcela := CASE WHEN v_item.categoria = 'aluguel' THEN v_total
                    ELSE round(v_total / p_parcelas, 2) END;

  FOR i IN 1..p_parcelas LOOP
    IF v_item.categoria = 'aluguel' THEN
      v_valor := v_parcela;
      v_venc  := (p_primeiro_vencimento + make_interval(months => i - 1))::date;
    ELSE
      -- O centavo que a divisão não fecha vai na última parcela.
      v_valor := CASE WHEN i = p_parcelas THEN v_total - v_soma ELSE v_parcela END;
      v_venc  := p_primeiro_vencimento + (i - 1) * p_intervalo_dias;
    END IF;
    v_soma := v_soma + v_valor;

    v_desc := 'Montagem ' || v_item.filial || ' — ' || v_item.rotulo
              || CASE WHEN p_parcelas > 1 THEN ' (' || i || '/' || p_parcelas || ')' ELSE '' END;

    INSERT INTO public.contas_pagar
      (descricao, valor, vencimento, status, filial, origem, centro_custo_id, natureza,
       filial_investimento_id)
    VALUES (v_desc, v_valor, v_venc, 'Pendente', v_item.filial, 'montagem_filial',
            v_item.centro_custo_id, v_natureza, v_item.id)
    RETURNING id INTO v_cp_id;

    IF i = 1 THEN v_primeira := v_cp_id; END IF;
  END LOOP;

  -- Equipamento vira bem (migr. 511) pelo valor TOTAL de aquisição — parcelar
  -- a compra não muda quanto o bem custou.
  IF v_item.categoria = 'equipamento' AND v_item.produto_patrimonio_id IS NULL THEN
    INSERT INTO public.produtos
      (codigo, nome, tipo, filial, estoque, preco, status,
       patrimonio_localizacao, patrimonio_vida_util_meses)
    VALUES (
      'PAT-' || to_char(public.acre_today(), 'YYYYMMDD') || '-'
             || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
      v_item.rotulo, 'patrimonio', v_item.filial, v_item.quantidade, 0, 'Ativo',
      v_item.filial, 60
    )
    RETURNING id INTO v_prod_id;

    INSERT INTO public.produtos_custo (produto_id, preco_custo, origem, updated_at)
    VALUES (v_prod_id, v_total, 'manual', now());
  END IF;

  UPDATE public.filial_investimentos
     SET conta_pagar_id        = v_primeira,
         produto_patrimonio_id = COALESCE(v_prod_id, produto_patrimonio_id)
   WHERE id = v_item.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'parcelas', p_parcelas,
    'valor_total', CASE WHEN v_item.categoria = 'aluguel' THEN v_total * p_parcelas ELSE v_total END,
    'bem_criado', v_prod_id IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lancar_investimento_filial(uuid, date, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lancar_investimento_filial(uuid, date, integer, integer, text) TO authenticated;

-- ── 3. Vender um bem: baixa + conta a receber ────────────────────────────
CREATE OR REPLACE FUNCTION public.vender_patrimonio(
  p_produto_id          uuid,
  p_valor               numeric,
  p_primeiro_vencimento date,
  p_parcelas            integer DEFAULT 1,
  p_intervalo_dias      integer DEFAULT 30,
  p_cliente_id          uuid    DEFAULT NULL,
  p_motivo              text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prod    public.produtos;
  v_parcela numeric;
  v_valor   numeric;
  v_soma    numeric := 0;
  v_desc    text;
  i         integer;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bem não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_prod.tipo <> 'patrimonio' THEN
    RAISE EXCEPTION 'Só item de patrimônio pode ser vendido por aqui.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(public.auth_pode_filial(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Bem de outra filial.' USING ERRCODE = '42501';
  END IF;
  -- Quem já baixava (financeiro/logística) e quem lança a montagem
  -- (admin ou gerente da unidade) vendem.
  IF NOT COALESCE(public.auth_in_setor('financeiro', 'logistica')
                  OR public.auth_is_admin()
                  OR public.auth_gerente_da(v_prod.filial), false) THEN
    RAISE EXCEPTION 'Permissão insuficiente para vender bem.' USING ERRCODE = '42501';
  END IF;
  IF v_prod.patrimonio_baixado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este bem já foi baixado em %.', to_char(v_prod.patrimonio_baixado_em, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor da venda.' USING ERRCODE = 'P0001';
  END IF;
  IF p_primeiro_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe o primeiro vencimento.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_parcelas, 0) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Parcelas: de 1 a 60.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_intervalo_dias, 0) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Intervalo entre parcelas: de 1 a 365 dias.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.produtos SET
    status                  = 'Baixado',
    patrimonio_baixado_em   = public.acre_today(),
    patrimonio_baixa_motivo = COALESCE(NULLIF(btrim(p_motivo), ''), 'Venda do bem'),
    patrimonio_valor_venda  = p_valor
  WHERE id = p_produto_id;

  v_parcela := round(p_valor / p_parcelas, 2);
  FOR i IN 1..p_parcelas LOOP
    v_valor := CASE WHEN i = p_parcelas THEN p_valor - v_soma ELSE v_parcela END;
    v_soma  := v_soma + v_valor;
    v_desc  := 'Venda de bem — ' || v_prod.nome
               || CASE WHEN p_parcelas > 1 THEN ' (' || i || '/' || p_parcelas || ')' ELSE '' END;
    INSERT INTO public.contas_receber
      (descricao, valor, vencimento, status, filial, origem, cliente_id, produto_patrimonio_id)
    VALUES (v_desc, v_valor, p_primeiro_vencimento + (i - 1) * p_intervalo_dias, 'Aberto',
            v_prod.filial, 'venda_patrimonio', p_cliente_id, v_prod.id);
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'parcelas', p_parcelas, 'valor', p_valor);
END;
$function$;

REVOKE ALL ON FUNCTION public.vender_patrimonio(uuid, numeric, date, integer, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vender_patrimonio(uuid, numeric, date, integer, integer, uuid, text) TO authenticated;

-- ── 4. Desvincular não desfaz compra de bem já baixado ───────────────────
-- Cópia do corpo vigente (pg_get_functiondef em 26/09) com um guard a mais,
-- logo depois da checagem de permissão.
CREATE OR REPLACE FUNCTION public.desvincular_investimento_conta(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item      public.filial_investimentos;
  v_paga      text;
  v_canceladas integer := 0;
  v_bem       boolean := false;
BEGIN
  PERFORM public._assert_rpc();

  SELECT * INTO v_item FROM public.filial_investimentos WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(public.auth_pode_filial(v_item.filial), false)
     OR NOT COALESCE(public.auth_is_admin() OR public.auth_gerente_da(v_item.filial), false) THEN
    RAISE EXCEPTION 'Permissão insuficiente.' USING ERRCODE = '42501';
  END IF;

  -- Migr. 634: bem vendido ou descartado teve vida contábil própria —
  -- cancelar a compra dele deixaria a venda sem compra.
  IF v_item.produto_patrimonio_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.produtos
        WHERE id = v_item.produto_patrimonio_id AND patrimonio_baixado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'O bem deste item já foi baixado (vendido ou descartado) — a compra não pode mais ser desfeita.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Fecha o vínculo dos dois lados: a 1ª conta (ponteiro antigo) e todas as
  -- parcelas carimbadas. Linha gerada antes da migr. 512 só tem o ponteiro.
  UPDATE public.contas_pagar
     SET filial_investimento_id = v_item.id
   WHERE id = v_item.conta_pagar_id
     AND filial_investimento_id IS NULL;

  -- Nada gerado, nada a desfazer. (Vínculo apontando só para conta já
  -- cancelada/apagada na mão não é erro: solta o ponteiro e segue, senão o
  -- item fica preso — nem regera, nem sai da lista.)
  IF v_item.conta_pagar_id IS NULL
     AND v_item.produto_patrimonio_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.contas_pagar
                      WHERE filial_investimento_id = v_item.id) THEN
    RAISE EXCEPTION 'Este item não tem conta gerada.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma parcela paga trava o conjunto: cancelar as outras deixaria um
  -- aluguel meio pago e meio cancelado, sem quem responda pelo saldo.
  SELECT string_agg(descricao, ', ' ORDER BY vencimento) INTO v_paga
    FROM public.contas_pagar
   WHERE filial_investimento_id = v_item.id
     AND COALESCE(ativo, true)
     AND status IN ('Pago', 'Parcial');

  IF v_paga IS NOT NULL THEN
    RAISE EXCEPTION 'Conta já paga (total ou parcialmente) não desvincula — estorne o pagamento primeiro: %', v_paga
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.contas_pagar
     SET status = 'Cancelado'
   WHERE filial_investimento_id = v_item.id
     AND COALESCE(ativo, true)
     AND status <> 'Cancelado';
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  -- O bem só existia porque a compra existia. Inativado (não apagado), sai
  -- da depreciação do DRE. Bem já baixado fica: teve vida contábil própria.
  IF v_item.produto_patrimonio_id IS NOT NULL THEN
    UPDATE public.produtos
       SET ativo = false
     WHERE id = v_item.produto_patrimonio_id
       AND patrimonio_baixado_em IS NULL
       AND COALESCE(ativo, true);
    v_bem := FOUND;
  END IF;

  UPDATE public.filial_investimentos
     SET conta_pagar_id = NULL, produto_patrimonio_id = NULL
   WHERE id = v_item.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'contas_canceladas', v_canceladas,
    'bem_inativado', v_bem
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
