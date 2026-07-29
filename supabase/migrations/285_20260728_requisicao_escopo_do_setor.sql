-- 285 — A requisição é do setor, não de quem a digitou
--
-- Correção do escopo aberto pela 283/284. Aquelas migrações fizeram a coisa
-- certa pela metade: passaram a gravar `setor_solicitante` — derivado do
-- usuário autenticado, com comentário explicando que a área é que pede — e aí
-- a policy de leitura filtrou por outra coisa:
--
--     USING (criado_por = auth.uid())
--
-- Guarda o setor, lê pelo indivíduo. Na empresa a requisição pertence à área
-- que precisa do item: o centro de custo é do setor, o orçamento é do setor, a
-- necessidade é do setor. Quem digitou é autor, não dono — autoria é metadado,
-- não escopo.
--
-- O que o escopo por autor quebrava, na prática:
--
--   • Dois analistas do mesmo setor pedem a mesma resma na mesma semana e
--     nenhum dos dois vê o pedido do outro. Compras recebe duplicado e não tem
--     como saber que é duplicata.
--   • A autora entra de férias ou afastamento — módulos que existem e são
--     usados — e a requisição some para o setor inteiro. Ninguém consegue
--     acompanhar, e ninguém consegue nem descobrir que ela existe.
--   • O setor não sabe responder "o que já pedimos este mês?". A pergunta é
--     natural, o dado está lá, e o filtro escondia.
--
-- Conferido antes de mexer: nenhuma das outras policies permissivas dessas
-- tabelas cobria colega de setor. `compras_select` (187) cobre
-- compras/logística/financeiro/gerente; `logist_select` (187) cobre
-- logística/gerente. Fora isso, só a policy de autor. Então o colega de setor
-- não via mesmo.
--
-- O que muda: SELECT passa a ser por **setor do solicitante + filial**,
-- respeitando multi-setor (`auth_user_setores()` já soma `setores_extras`).
--
-- Sobre a checagem de filial: **não** usar `auth_pode_filial` aqui. Apesar do
-- nome, ela devolve true para gerente em QUALQUER filial — está escrito na
-- 072: "Gerente vê tudo (regra de negócio: cobertura entre unidades)". Isso
-- serve para caixa, não para requisição: pela régua canônica as filiais são
-- isoladas entre si e o gerente opera a própria. O helper certo é
-- `auth_gerente_da(filial)`, que compara a filial do gerente com a da linha —
-- é o mesmo que a 187 usa nas policies de compras/logística.
--
-- O `criado_por = auth.uid()` continua no OR de propósito: as linhas criadas
-- antes da 283/284 têm `setor_solicitante` NULL (não houve backfill — não dá
-- para inferir com honestidade o setor de quem pediu há dois meses, e o setor
-- da pessoa pode ter mudado desde então). Sem esse OR, o autor perderia de
-- vista a própria requisição antiga. A mudança é estritamente aditiva:
-- ninguém enxerga menos do que enxergava.
--
-- A autoridade não muda: quem decide segue sendo o gerente da filial
-- (`requisicao_decisao_guard`, migr. 282). Isto é leitura, não decisão.

BEGIN;

-- ── 1. Requisição de compra ──────────────────────────────────────────────────

DROP POLICY IF EXISTS requisicoes_autor_select ON public.requisicoes;

CREATE POLICY requisicoes_setor_select ON public.requisicoes
  FOR SELECT TO authenticated
  USING (
    (
      setor_solicitante = ANY (public.auth_user_setores())
      AND (
        public.auth_is_admin()
        OR public.auth_user_role() = 'ceo'
        OR public.auth_gerente_da(filial)
        OR public.auth_user_filial() = filial
      )
    )
    OR criado_por = auth.uid()
  );

COMMENT ON POLICY requisicoes_setor_select ON public.requisicoes IS
  'A requisição é da área que precisa do item: o setor inteiro lê o que o setor pediu, dentro da própria filial. O OR de autor preserva as linhas anteriores à 283, que têm setor_solicitante NULL.';

-- ── 2. Requisição de material do almoxarifado ────────────────────────────────
-- Mesmo raciocínio, mesma tabela-irmã (migr. 284).

DROP POLICY IF EXISTS requisicoes_estoque_autor_select ON public.requisicoes_estoque;

CREATE POLICY requisicoes_estoque_setor_select ON public.requisicoes_estoque
  FOR SELECT TO authenticated
  USING (
    (
      setor_solicitante = ANY (public.auth_user_setores())
      AND (
        public.auth_is_admin()
        OR public.auth_user_role() = 'ceo'
        OR public.auth_gerente_da(filial)
        OR public.auth_user_filial() = filial
      )
    )
    OR criado_por = auth.uid()
  );

COMMENT ON POLICY requisicoes_estoque_setor_select ON public.requisicoes_estoque IS
  'Espelha requisicoes_setor_select: material do almoxarifado é pedido pela área, e a área acompanha o que pediu.';

-- ── 3. Índices de apoio ──────────────────────────────────────────────────────
-- O predicado novo cruza setor + filial em toda abertura da tela; sem índice
-- vira seq scan a cada carga.

CREATE INDEX IF NOT EXISTS idx_requisicoes_setor_filial
  ON public.requisicoes (setor_solicitante, filial);

CREATE INDEX IF NOT EXISTS idx_requisicoes_estoque_setor_filial
  ON public.requisicoes_estoque (setor_solicitante, filial);

COMMIT;
