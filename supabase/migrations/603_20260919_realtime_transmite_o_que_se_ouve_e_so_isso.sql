-- 603 — O realtime transmite o que se ouve, e só isso
--
-- A publicação `supabase_realtime` e a lista de tabelas que o app assina
-- tinham divergido dos DOIS lados. Esta migração encosta uma na outra.
--
-- ─── LADO 1: 14 TABELAS TRANSMITIDAS PARA NINGUÉM ──────────────────────────
--
-- Eram decodificadas do WAL e avaliadas contra as assinaturas de cada máquina
-- da sala a cada escrita, para no fim não serem entregues a ninguém. Não é o
-- gargalo — esse era a contagem dos badges, que a 602 tirou. É sobra, e é paga
-- no pior momento: a hora em que a turma está escrevendo.
--
-- ─── LADO 2: 6 ASSINATURAS QUE NUNCA RECEBERAM NADA ────────────────────────
--
-- Este é o achado que interessa. Seis tabelas que o app ASSINA nunca estiveram
-- na publicação, então o canal subia, ficava SUBSCRIBED e não chegava evento
-- nenhum. Ninguém percebe olhando o código: `assinarRealtime` está lá, o canal
-- conecta, e a tela só parece "demorar a atualizar" — porque o que a atualiza
-- é o mount, o foco da aba ou a ação de quem está nela.
--
--   ferias                   badge de RH → Férias, parado até alguém recarregar
--   metas_estrategicas       badge de Metas, idem
--   servicos                 Cotações e Recebimentos
--   vencimentos_estoque      Validades
--   conciliacoes_maquininha  conciliação do cartão
--   ciclos_avaliacao         ciclo de avaliação
--
-- É o caso de [[feedback_realtime_exige_publicacao]] outra vez: assinar não
-- basta, a tabela precisa estar publicada. Foi a guarda do fim desta migração
-- que os encontrou, ao recusar tirar da publicação uma tabela que o app ouve.
--
-- ─── COMO AS DUAS LISTAS FORAM FEITAS ──────────────────────────────────────
--
-- Varredura de `src/` atrás de `assinarRealtime`, `alvos:`, `listenTables:` e
-- `supabase.channel(...)`, mais os endpoints passados ao `useFetchData` com
-- `realtime = true` (resolvidos pelo `ENDPOINT_TABLE_MAP`).
--
-- Seis das 14 que saem até têm endpoint no mapa (`briefings_diarios`,
-- `relatorios_bi`, `marketing_calendario`, `marketing_arte_feedback`,
-- `pdi_itens`, `treinamento_inscricoes`) — mas todas as chamadas são sem
-- realtime: a tela lê ao abrir e relê quando quem está nela faz alguma coisa.
-- Estar na publicação não as atualizava; só custava.
--
-- OS REPOSITÓRIOS IRMÃOS foram conferidos, porque leem estes mesmos bancos e
-- não apareceriam numa varredura do LogMax: a MaxPay (`~/Downloads/maxpay`)
-- assina `pix_pendentes` e `cartao_pendentes`, e as duas FICAM. O MaxID não
-- toca nestes bancos.
--
-- PARA DESFAZER: `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>;`
-- (ou DROP, para as seis que entram). Nenhum dado muda aqui — só quem é
-- transmitido.

SET lock_timeout = '3s';

DO $ajusta$
DECLARE
  t text;
  -- Transmitidas sem ninguém do outro lado.
  mudas text[] := ARRAY[
    'auditoria_revisoes',
    'beneficios_pendentes',
    'briefings_diarios',
    'marketing_arte_feedback',
    'marketing_calendario',
    'maxbank_contas',
    'movimentacoes_caixa',
    'orcamentos_periodo',
    'pdi_itens',
    'ponto_qr_registros',
    'prestacoes_contas',
    'relatorios_bi',
    'ti_chamados',
    'treinamento_inscricoes'
  ];
  -- Assinadas pelo app e ausentes da publicação: canal vivo, evento nenhum.
  surdas text[] := ARRAY[
    'ciclos_avaliacao',
    'conciliacoes_maquininha',
    'ferias',
    'metas_estrategicas',
    'servicos',
    'vencimentos_estoque'
  ];
BEGIN
  -- Idempotente dos dois lados: DROP do que já saiu e ADD do que já está são
  -- erro, e esta migração precisa poder rodar de novo nas 4 turmas.
  FOREACH t IN ARRAY mudas LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY surdas LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$ajusta$;

-- Guarda: o que o app ouve tem de estar publicado. Foi ela que encontrou as
-- seis surdas — se alguém tirar da publicação uma tabela assinada, a migração
-- para aqui em vez de deixar a tela muda.
DO $guarda$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_faltando
    FROM unnest(ARRAY[
      'requisicoes', 'cotacoes', 'pedidos', 'recebimentos', 'aprovacoes_compras',
      'aprovacoes_estoque', 'requisicoes_estoque', 'expedicao', 'pedidos_venda',
      'orcamentos', 'marketing_promocoes', 'marketing_tarefas', 'ferias',
      'metas_estrategicas', 'desenvolvimentos_ia', 'notificacoes', 'produtos',
      'servicos', 'vencimentos_estoque', 'conciliacoes_maquininha', 'ciclos_avaliacao',
      'pix_pendentes', 'cartao_pendentes', 'comandos_turma', 'aula_config'
    ]) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
   );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION '603: saiu da publicação tabela que o app ouve: %', v_faltando;
  END IF;
END
$guarda$;

RESET lock_timeout;
