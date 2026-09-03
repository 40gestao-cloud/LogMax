-- Caixa fechado não pode impedir o turno seguinte.
--
-- Sintoma relatado da aula: o Financeiro fechou o caixa e, no PDV, o operador
-- não conseguiu abrir. A tela ainda mostrava "ABRA O CAIXA PARA COMEÇAR" e o
-- botão respondia com "Já existe caixa aberto hoje" — que era mentira, porque o
-- caixa estava FECHADO. Sem saída: nem operar, nem abrir.
--
-- ─── A causa ────────────────────────────────────────────────────────────────
-- `fechar_caixa_conferido` grava `status = 'Fechado'` e não toca em `ativo` —
-- corretamente, porque `ativo` é a coluna de exclusão lógica do sistema
-- inteiro, e um caixa fechado NÃO é um caixa apagado: ele tem de continuar na
-- conferência do dia, no histórico e no DRE.
--
-- Só que o índice único era
--
--     UNIQUE (data, filial) WHERE ativo = true
--
-- ou seja, "um registro de caixa por dia por unidade", independente do status.
-- Fechado o caixa, a linha continua ativa e ocupa a vaga do dia: qualquer nova
-- abertura bate em 23505.
--
-- Reproduzido com JWT em transação revertida, na turma aprendiz:
--   1. Financeiro fecha .................. status=Fechado / ativo=true
--   2. operador abre no PDV .............. 23505 uq_controle_caixa_data_filial_ativo
--
-- ─── A regra certa ──────────────────────────────────────────────────────────
-- O que a loja garante não é "um caixa por dia" — é UM CAIXA ABERTO POR VEZ.
-- Numa loja de verdade o dia tem turnos: abre de manhã, confere e fecha na
-- troca, o próximo turno abre de novo. Cada turno com sua abertura, seu
-- fundo de troco e sua conferência — que é justamente o que a aula quer
-- mostrar quando o operador troca.
--
-- O código do app já esperava exatamente isso: `useCaixaAberto` filtra
-- `status IN ('Aberto','Aguardando Confirmação')` e usa `.maybeSingle()`. Ele
-- tolera várias linhas no dia desde que só uma esteja aberta. O índice é que
-- era mais largo que a regra que o sistema realmente precisa.
--
-- Então o índice passa a cobrir só o que está EM OPERAÇÃO. O caixa fechado
-- continua ativo, visível e auditável — e libera a vaga para o turno seguinte.
--
-- Conferido antes de aplicar: nenhuma das 4 turmas tem hoje duas linhas abertas
-- na mesma data/filial, então o índice novo entra sem recusar dado existente.
--
-- Nota: `reabrir_caixa` (migr. 267) continua sendo outra coisa, e continua
-- necessária. Reabrir é DESFAZER um fechamento errado, com trilha em
-- `controle_caixa_reaberturas`. Abrir um caixa novo é começar um turno novo.
-- Os dois gestos existem na loja e agora existem os dois aqui.

BEGIN;

DROP INDEX IF EXISTS public.uq_controle_caixa_data_filial_ativo;

CREATE UNIQUE INDEX uq_controle_caixa_aberto_por_dia_filial
  ON public.controle_caixa (data, filial)
  WHERE ativo = true AND status IN ('Aberto', 'Aguardando Confirmação');

COMMENT ON INDEX public.uq_controle_caixa_aberto_por_dia_filial IS
  'Um caixa ABERTO por vez em cada unidade, por dia. O fechado sai do índice e libera o turno seguinte — sem sumir do histórico, porque continua ativo=true.';

COMMIT;

NOTIFY pgrst, 'reload schema';
