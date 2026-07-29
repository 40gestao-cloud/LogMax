-- 300 — Dois limites, porque são duas perguntas diferentes.
--
-- ERRO DA 293. Havia um limite só, `max_pedidos_hora` = 30, contado por hash de
-- IP. Como a turma inteira sai pela mesma internet da escola, aqueles 30 eram
-- 30 para a SALA — numa dinâmica com 20 alunos comprando duas vezes cada, o
-- último a clicar tomava 429 e a aula parava por um motivo que não tinha nada a
-- ver com a aula.
--
-- Baixar a guarda também não serve: o limite existe para uma pessoa não
-- despejar 200 pedidos na fila de quem está atendendo.
--
-- São duas perguntas:
--
--   "esta REDE está despejando pedido?"        → max_pedidos_hora (folgado)
--   "este DISPOSITIVO está despejando pedido?" → max_pedidos_hora_origem (curto)
--
-- O de rede sobe para 300/h: deixa a turma trabalhar e ainda segura um script.
-- O de dispositivo fica em 8/h, que é generoso para quem compra de verdade e
-- incômodo para quem está inflando venda.
--
-- O de dispositivo usa `origem_token` (UUID do localStorage, migr. 299). Sem
-- token — localStorage bloqueado, ou aba anônima nova — só o de rede se aplica.
-- Trocar de aba a cada pedido para fugir do limite curto é possível, e está
-- tudo bem: quem faz isso bate no de rede, e a fila mostra a repetição de
-- origem para quem atende. Nenhum dos dois é prova de nada; são vazão.
--
-- O UPDATE só toca linha que ainda está no default de 30. Se você já ajustou a
-- vazão de alguma filial na mão, o seu número fica.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

ALTER TABLE public.loja_config
  ADD COLUMN IF NOT EXISTS max_pedidos_hora_origem integer NOT NULL DEFAULT 8;

COMMENT ON COLUMN public.loja_config.max_pedidos_hora IS
  'Teto de pedidos por hora vindos da mesma REDE (hash de IP). A turma toda costuma compartilhar um IP, então este número é da sala, não da pessoa.';
COMMENT ON COLUMN public.loja_config.max_pedidos_hora_origem IS
  'Teto de pedidos por hora do mesmo DISPOSITIVO (origem_token do localStorage). Sem token, só o limite de rede se aplica.';

UPDATE public.loja_config
   SET max_pedidos_hora = 300
 WHERE max_pedidos_hora = 30;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificação:
--   SELECT filial, max_pedidos_hora, max_pedidos_hora_origem
--     FROM loja_config ORDER BY filial;
--
-- Para afrouxar ou apertar uma filial específica (é dado, não código):
--   UPDATE loja_config SET max_pedidos_hora_origem = 20 WHERE filial = 'SuperMax';
