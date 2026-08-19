-- 478_20260819_o_pedido_da_vizinha_ainda_estava_aberto.sql
--
-- Terceira leva do isolamento por filial. Mesma família das 436 e 437, e desta
-- vez a porta de entrada foi uma reclamação de tela, não uma varredura:
--
--   "em Estoque > Recebimentos, ao Confirmar, o select de produto abre vazio"
--
-- A causa daquela tela era outra (catálogo da turma vazio — tratado no front,
-- sem SQL). Mas ao reproduzir o caso apareceu isto:
--
--   recebimentos.estoque_all   FOR ALL
--     USING (auth_in_setor('estoque','logistica') OR auth_gerente_da(filial))
--
-- `auth_in_setor` responde "esta pessoa é do estoque?" e não "de qual
-- unidade?". Simulando um colaborador de logística da SuperMax:
--
--   select count(*) from recebimentos where filial='MaxLook'  → 24
--   select count(*) from pedidos      where filial='MaxLook'  → 20
--
-- E as duas policies são FOR ALL: valia para ESCRITA. Um aluno do estoque de
-- uma unidade confirmava recebimento da vizinha — o que move estoque, baixa
-- saldo de pedido e mexe em conta a pagar (RPCs da 202/423/424). Numa operação
-- que é competição entre as três, isso é a logística do concorrente.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUE A VARREDURA DA 437 NÃO PEGOU ESTAS
--
-- A 437 procurou policy com `auth_in_setor` e sem filial. Estas TÊM uma menção
-- a filial — `auth_gerente_da(filial)` — e por isso passaram batido em
-- qualquer leitura apressada (a minha inclusive). Só que `auth_gerente_da` é o
-- ramo do GERENTE: escopa quem é gerente, e não escopa nada de quem entrou
-- pelo ramo do setor. A régua correta é o AND por fora dos dois ramos.
--
-- Sonda que acha o resto da família (depois desta, deve voltar só as exclusões
-- listadas mais abaixo):
--
--   SELECT p.tablename, p.policyname, p.cmd
--     FROM pg_policies p
--     JOIN information_schema.columns c
--       ON c.table_schema='public' AND c.table_name=p.tablename
--      AND c.column_name='filial'
--    WHERE p.schemaname='public'
--      AND COALESCE(p.qual,'')||COALESCE(p.with_check,'') ~ 'auth_in_setor'
--      AND COALESCE(p.qual,'')||COALESCE(p.with_check,'') !~ 'auth_pode_filial';
--
-- ────────────────────────────────────────────────────────────────────────────
-- A RÉGUA — a mesma da 437, sem inventar nada
--
--   <expressão de setor/gerente que já existia>
--   AND COALESCE(public.auth_pode_filial(filial), false)
--
-- `auth_pode_filial` tem `auth_is_admin()` por dentro: admin, CEO e conselheiro
-- continuam enxergando as três unidades, que é o que a Matriz precisa.
--
-- O conjunto de SETORES de cada policy fica EXATAMENTE como estava. Alargar
-- quem entra é outra conversa e não se faz de carona num hardening.
--
-- Metade da família já estava certa e serve de precedente: `compras_insert` de
-- aprovacoes_compras, `pv_insert`, `compras_insert` de requisicoes,
-- `logist_insert` de requisicoes_estoque e os dois `_read` de marketing já
-- traziam o `auth_pode_filial`. Esta migração termina o serviço.
--
-- ────────────────────────────────────────────────────────────────────────────
-- FICA COMO ESTÁ (conferido, não é esquecimento)
--
--   avaliacoes.avaliacoes_insert  o `auth_in_setor('ti')` ali é a trava do
--                                 tipo 'ti_dev_ia', não escopo de unidade; a
--                                 policy de leitura já resolve filial.
--   maxbank_metas.maxbank_metas_read  meta pode ser global (setor sem filial);
--                                 pôr o AND aqui sumiria com meta legítima.
--   ti_chamados.*                 chamado de TI é atendido pelo setor de TI
--                                 como suporte central — mudar isso é decisão
--                                 de produto, não hardening.
--
-- Conferido antes de escrever: ZERO linhas com `filial IS NULL` nas 12 tabelas,
-- nas 4 turmas. Ninguém some da tela por causa do COALESCE.


BEGIN;

-- ── recebimentos ────────────────────────────────────────────────────────────
-- A que originou a investigação. FOR ALL: fecha leitura e escrita juntas.
DROP POLICY IF EXISTS "estoque_all" ON public.recebimentos;
CREATE POLICY "estoque_all" ON public.recebimentos
  FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['estoque'::text, 'logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['estoque'::text, 'logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── pedidos ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "compras_all" ON public.pedidos;
CREATE POLICY "compras_all" ON public.pedidos
  FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── notas_recebidas ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "compras_all" ON public.notas_recebidas;
CREATE POLICY "compras_all" ON public.notas_recebidas
  FOR ALL TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── requisicoes ─────────────────────────────────────────────────────────────
-- `requisicoes_setor_select` (a leitura do setor solicitante) já escopa filial
-- por dentro e não é tocada. `compras_insert` idem. `compras_delete` é admin.
DROP POLICY IF EXISTS "compras_select" ON public.requisicoes;
CREATE POLICY "compras_select" ON public.requisicoes
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "compras_update" ON public.requisicoes;
CREATE POLICY "compras_update" ON public.requisicoes
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── requisicoes_estoque ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "logist_select" ON public.requisicoes_estoque;
CREATE POLICY "logist_select" ON public.requisicoes_estoque
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "logist_update" ON public.requisicoes_estoque;
CREATE POLICY "logist_update" ON public.requisicoes_estoque
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "logist_delete" ON public.requisicoes_estoque;
CREATE POLICY "logist_delete" ON public.requisicoes_estoque
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── aprovacoes_compras ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "compras_select" ON public.aprovacoes_compras;
CREATE POLICY "compras_select" ON public.aprovacoes_compras
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "compras_update" ON public.aprovacoes_compras;
CREATE POLICY "compras_update" ON public.aprovacoes_compras
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "compras_delete" ON public.aprovacoes_compras;
CREATE POLICY "compras_delete" ON public.aprovacoes_compras
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── aprovacoes_estoque ──────────────────────────────────────────────────────
-- O INSERT só checava `status='Pendente'` — qualquer autenticado abria
-- aprovação de estoque em nome de qualquer unidade. Fica igual ao de
-- aprovacoes_compras, que já era assim.
DROP POLICY IF EXISTS "logist_insert" ON public.aprovacoes_estoque;
CREATE POLICY "logist_insert" ON public.aprovacoes_estoque
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'Pendente'
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "logist_select" ON public.aprovacoes_estoque;
CREATE POLICY "logist_select" ON public.aprovacoes_estoque
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "logist_update" ON public.aprovacoes_estoque;
CREATE POLICY "logist_update" ON public.aprovacoes_estoque
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "logist_delete" ON public.aprovacoes_estoque;
CREATE POLICY "logist_delete" ON public.aprovacoes_estoque
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── cotacoes ────────────────────────────────────────────────────────────────
-- `cot_delete` é admin-only e não muda.
DROP POLICY IF EXISTS "cot_select" ON public.cotacoes;
CREATE POLICY "cot_select" ON public.cotacoes
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "cot_insert" ON public.cotacoes;
CREATE POLICY "cot_insert" ON public.cotacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "cot_update" ON public.cotacoes;
CREATE POLICY "cot_update" ON public.cotacoes
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['compras'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── orcamentos (proposta ao cliente, do setor de vendas) ────────────────────
DROP POLICY IF EXISTS "orc_select" ON public.orcamentos;
CREATE POLICY "orc_select" ON public.orcamentos
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "orc_insert" ON public.orcamentos;
CREATE POLICY "orc_insert" ON public.orcamentos
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "orc_update" ON public.orcamentos;
CREATE POLICY "orc_update" ON public.orcamentos
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "orc_delete" ON public.orcamentos;
CREATE POLICY "orc_delete" ON public.orcamentos
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── pedidos_venda ───────────────────────────────────────────────────────────
-- `pv_insert` já trazia o AND e não muda.
DROP POLICY IF EXISTS "pv_select" ON public.pedidos_venda;
CREATE POLICY "pv_select" ON public.pedidos_venda
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "pv_update" ON public.pedidos_venda;
CREATE POLICY "pv_update" ON public.pedidos_venda
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text, 'logistica'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "pv_delete" ON public.pedidos_venda;
CREATE POLICY "pv_delete" ON public.pedidos_venda
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['vendas'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── marketing_campanhas ─────────────────────────────────────────────────────
-- `campanhas_read` já estava correta.
DROP POLICY IF EXISTS "campanhas_insert" ON public.marketing_campanhas;
CREATE POLICY "campanhas_insert" ON public.marketing_campanhas
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "campanhas_update" ON public.marketing_campanhas;
CREATE POLICY "campanhas_update" ON public.marketing_campanhas
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text, 'financeiro'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "campanhas_delete" ON public.marketing_campanhas;
CREATE POLICY "campanhas_delete" ON public.marketing_campanhas
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

-- ── marketing_cupons ────────────────────────────────────────────────────────
-- `cupons_read` já estava correta.
DROP POLICY IF EXISTS "cupons_insert" ON public.marketing_cupons;
CREATE POLICY "cupons_insert" ON public.marketing_cupons
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "cupons_update" ON public.marketing_cupons;
CREATE POLICY "cupons_update" ON public.marketing_cupons
  FOR UPDATE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  )
  WITH CHECK (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

DROP POLICY IF EXISTS "cupons_delete" ON public.marketing_cupons;
CREATE POLICY "cupons_delete" ON public.marketing_cupons
  FOR DELETE TO authenticated
  USING (
    COALESCE(public.auth_in_setor(VARIADIC ARRAY['marketing'::text])
             OR public.auth_gerente_da(filial), false)
    AND COALESCE(public.auth_pode_filial(filial), false)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4 — a sonda do cabeçalho deve voltar só avaliacoes_insert,
-- maxbank_metas_read e as duas de ti_chamados)
--
-- TESTE MANUAL (F12, aluno de estoque/logística de UMA unidade):
--   from('recebimentos').select('filial')  → só a própria
--   from('pedidos').select('filial')       → só a própria
--   confirmar recebimento da própria       → continua funcionando
--   admin / CEO / conselheiro              → continuam vendo as três
-- ════════════════════════════════════════════════════════════════════════════
