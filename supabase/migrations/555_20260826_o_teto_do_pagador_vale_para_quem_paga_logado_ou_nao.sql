-- 555 — O teto do pagador vale para quem paga, logado ou não.
--
-- `confirmar_pix_pendente` é a função inteira:
--
--     UPDATE pix_pendentes SET status = 'pago', paid_at = now()
--      WHERE id = p_id AND status = 'aguardando'
--
-- Sem `_assert_rpc`, sem RBAC, sem filial. É o momento em que o sistema declara
-- que o dinheiro entrou, e ele aceita qualquer uuid de quem quer que chame.
--
-- Teste rodado em 26/08, transação revertida: a Mirella (colaboradora, setor
-- vendas, TechMax) marcou como paga uma cobrança de **R$ 3.500,00 da SuperMax**.
-- `status = pago`, `paid_at` carimbado, zero erro. Ela também enxergava a
-- cobrança: a policy `pix_pendentes_pagador_select` é `status = 'aguardando'`
-- para `authenticated`, e como policies são OR, ela anula o escopo da
-- `pix_pendentes_auth_select` (`operador_id = auth.uid() OR auth_is_admin()`).
--
-- ─── O GUARD EXISTE, E ESTÁ NO LADO ERRADO ─────────────────────────────────
--
-- Existe um teto de valor, em `trg_pendente_visitor_gate`. No mesmo teste, um
-- visitante SEM LOGIN tentando confirmar a mesma cobrança levou:
--
--     'Valor R$ 3500.00 excede o limite por transação do modo visitante
--      (R$ 500.00).'
--
-- A régua dele é a primeira linha da função:
--
--     IF auth.uid() IS NOT NULL THEN RETURN NEW; END IF;
--
-- "Está logado? Pode tudo." Ou seja: quem tem conta na turma pode mais do que
-- quem não tem. O aluno de outra unidade passa por cima de um teto que o
-- visitante anônimo respeita.
--
-- ─── A RÉGUA CERTA É QUEM ESTÁ PAGANDO, NÃO QUEM ESTÁ LOGADO ───────────────
--
-- Confirmar um Pix é simular o CLIENTE pagando. Duas situações, e elas são
-- diferentes:
--
--   · O operador que abriu a cobrança confirma a própria cobrança. É a loja
--     fechando o ciclo da venda dela — legítimo, e pelo valor cheio: uma venda
--     de R$ 3.500 no PDV tem de poder ser confirmada.
--   · Qualquer outra pessoa confirma. Aí é alguém no papel de cliente — o
--     colega de turma com o celular na mão, ou o visitante do simulador. Esse é
--     exatamente o caso para o qual o teto do modo visitante foi criado, e ele
--     passa a valer independentemente de a pessoa estar logada.
--
-- A exceção deixa de ser "tem sessão" e passa a ser "é o dono da cobrança".
-- `operador_id` já existe na tabela e já é preenchido no INSERT (a policy
-- `pix_pendentes_auth_insert` é `operador_id = auth.uid()`), então o dado
-- necessário já está lá.
--
-- Cobrança sem `operador_id` — criada por service role, ou legado — continua
-- caindo no teto, que é o lado seguro.
--
-- ─── O QUE ESTA MIGRAÇÃO NÃO FAZ ───────────────────────────────────────────
--
-- Não mexe na visibilidade. A `pix_pendentes_pagador_select` deixa todo aluno
-- logado enxergar toda cobrança aguardando pagamento da turma, e estreitá-la
-- por filial quebraria o exercício em que um aluno de uma unidade faz o papel
-- de cliente de outra — que é uso normal na aula. Com o teto valendo, ver a
-- cobrança deixa de bastar para confirmá-la, que era o dano real. Se a régua
-- de visibilidade tiver de mudar, é decisão de quem ensina.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_pendente_visitor_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
BEGIN
  -- MIGR 555: era `IF auth.uid() IS NOT NULL THEN RETURN NEW`. Estar logado
  -- não é o mesmo que ser a loja: quem confirma um Pix está no papel do
  -- cliente, e só o operador que ABRIU a cobrança está fechando o próprio
  -- ciclo de venda. Esse passa pelo valor cheio; todo o resto — visitante ou
  -- colega de turma — respeita o teto.
  IF NEW.operador_id IS NOT NULL AND NEW.operador_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Service role (cron, manutenção, endpoints com chave) não é gente pagando.
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  SELECT ativo, limite_por_transacao
    INTO cfg
    FROM public.modo_visitante_config
   WHERE id = 1;

  IF NOT COALESCE(cfg.ativo, false) THEN
    RAISE EXCEPTION 'Modo visitante desativado. Peça ao admin do MaxBank para ativar em Configurações → Modo Visitante.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.valor > cfg.limite_por_transacao THEN
    RAISE EXCEPTION
      'Valor R$ % excede o limite por transação de quem paga (R$ %). Quem confirma um Pix está no papel do cliente; acima desse teto, quem confirma é o operador que abriu a cobrança, no próprio PDV.',
      NEW.valor, cfg.limite_por_transacao
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
