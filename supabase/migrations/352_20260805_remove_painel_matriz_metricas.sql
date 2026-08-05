-- =================================================================
-- 352 — Sai a `painel_matriz_metricas`, sem consumidor.
--
-- Ela alimentava o "Painel Comparativo dos Eixos", que fazia sentido
-- quando havia 7 eixos votados: ranking por eixo, medalha, contagem de
-- vitórias, total por filial. Com a saída da frequência (349/350/351)
-- sobrou UM eixo votado — 'Planejamento e Organização' — e a tela
-- passou a anunciar "vitórias" e "ranking de eixos" sobre uma coluna
-- só, o que é ruído, não informação.
--
-- O que ela mostrava continua na tela, melhor colocado:
--   • nota por filial + detalhe por avaliador → "Visão do Ciclo —
--     Avaliação das Filiais", no próprio AvaliacaoFilialPanel;
--   • frequência → card próprio, com a medida inteira.
--
-- O componente PainelComparativoEixos.tsx foi removido junto. Nenhuma
-- outra tela chama esta função. Avaliações e critérios seguem
-- intactos no banco — isto some com a leitura, não com o dado.
--
-- Idempotente.
-- =================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.painel_matriz_metricas(uuid);

COMMIT;

NOTIFY pgrst, 'reload schema';
