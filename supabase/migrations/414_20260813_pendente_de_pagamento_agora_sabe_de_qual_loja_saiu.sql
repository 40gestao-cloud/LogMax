-- 414_20260813_pendente_de_pagamento_agora_sabe_de_qual_loja_saiu.sql
--
-- `pix_pendentes` e `cartao_pendentes` nasceram sem filial. Era coerente
-- enquanto elas eram só o bilhete efêmero entre o caixa e o MaxBank: quem
-- criou está no `operador_id`, quem paga confirma pelo id do QR, e ninguém
-- mais precisava saber de onde a cobrança saiu.
--
-- O PDV passou a limpar pendências abandonadas ao abrir (PDVView, "Limpeza de
-- Pix órfãos"), porque o plano Hobby do Vercel só permite 1 cron por dia. São
-- duas janelas: > 5 min do próprio operador e > 1h de qualquer operador. Sem
-- coluna de filial, a segunda janela não tem como se conter na loja.
--
-- Para colaborador isso não vaza — a RLS de leitura é
-- `operador_id = auth.uid() OR auth_is_admin()`, então a query "de qualquer
-- operador" volta só as linhas dele. Mas admin e CEO passam pelo
-- `auth_is_admin()`, e o CEO aqui é aluno: ele abre o PDV da MaxLook e cancela
-- Pix que estava aguardando no caixa da TechMax e da SuperMax, com um aviso na
-- tela contando cobranças que não são daquela loja. Uma loja mexendo no caixa
-- da outra é exatamente o que o RBAC por filial existe para impedir.
--
-- Com `filial` na tabela, a limpeza coletiva continua — contida na unidade.
--
-- POR QUE A TRIGGER SÓ PREENCHE QUANDO VEM NULL:
--
-- A tentação é copiar a lição do ponto (`trg_ponto_filial`, que sobrescreve o
-- que o cliente mandou) e derivar a filial sempre do perfil do operador. Aqui
-- isso quebra o caso legítimo: admin/CEO/gerente operam o PDV de uma unidade
-- pelo hub de filial, e o perfil deles é 'Matriz' — que não vende. A filial
-- correta é a do PDV aberto, e só o app sabe qual é.
--
-- Então a regra é COALESCE: o app manda a filial do caixa e a trigger respeita;
-- insert que não citar a coluna (caminho antigo, script, F12) cai no perfil do
-- operador em vez de ficar NULL. O pior caso de um insert forjado é a cobrança
-- ser varrida pela loja errada — e para varrer, a RLS de UPDATE ainda exige ser
-- o operador dono ou admin.
--
-- BACKFILL pelo perfil do operador, e SÓ para as três unidades que operam
-- caixa. Pendência antiga é lixo de sessão morta (aguardando/cancelado), não
-- tem venda atrás para consultar; a filial do operador é a melhor aproximação
-- e serve para o que a coluna faz — decidir de quem é a limpeza.
--
-- Perfil 'Matriz' ou sem filial fica NULL de propósito: gravar 'Matriz' seria
-- inventar um caixa que não existe, e a linha ficaria fora de toda varredura
-- coletiva parecendo classificada. NULL diz a verdade — não se sabe de qual
-- loja saiu — e a linha ainda some pela janela de 5 min do próprio dono.
--
-- IDEMPOTENTE — pode reaplicar em projeto onde já rodou (a turma Contabilidade
-- recebeu a primeira versão desta migração; rodar de novo é inofensivo).
-- APLICAR NOS 4 PROJETOS.

BEGIN;

ALTER TABLE public.pix_pendentes    ADD COLUMN IF NOT EXISTS filial text;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS filial text;

COMMENT ON COLUMN public.pix_pendentes.filial IS
  'Unidade do caixa que gerou a cobrança (não é a filial do perfil do operador: admin opera o PDV de outra unidade pelo hub). Preenchida pelo app; trigger cobre o insert que omitir.';
COMMENT ON COLUMN public.cartao_pendentes.filial IS
  'Unidade do caixa que gerou a cobrança (não é a filial do perfil do operador: admin opera o PDV de outra unidade pelo hub). Preenchida pelo app; trigger cobre o insert que omitir.';

-- Backfill pelo perfil de quem criou.
-- O BACKFILL PRECISA DESLIGAR O GATE DO MODO VISITANTE ANTES DE RODAR.
--
-- `pix_pendentes` e `cartao_pendentes` têm um trigger BEFORE UPDATE
-- (`*_visitor_gate` → `trg_pendente_visitor_gate`) que barra a operação quando
-- `auth.uid() IS NULL`: ou porque o modo visitante está desativado, ou porque
-- o valor passa do limite por transação. Ele existe para o pagador anônimo que
-- confirma o QR — e é a regra certa para esse caminho.
--
-- Acontece que o SQL Editor também roda sem `auth.uid()`. Para o gate, esta
-- migração é um visitante: na turma Aprendiz o backfill morreu num Pix de
-- R$ 613,99 contra o limite de R$ 500, e onde o modo visitante estiver
-- DESATIVADO ele reprovaria todas as linhas, de qualquer valor.
--
-- O trigger fica desligado só durante os dois UPDATEs, dentro da transação —
-- se algo falhar, o ROLLBACK devolve o estado (DDL é transacional no
-- Postgres). Enquanto isso, uma confirmação de pagamento vinda de outra sessão
-- passaria sem o gate; é uma janela de milissegundos numa migração aplicada
-- fora de aula, e o preço de não a correr é não ter a coluna preenchida.
--
-- Condicional porque o gate é drift: não está em nenhuma migração deste repo
-- (foi criado direto no banco), então não dá para assumir que existe nos 4
-- projetos. Onde não existir, o bloco não faz nada.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.pix_pendentes'::regclass
                AND tgname  = 'pix_pendentes_visitor_gate') THEN
    ALTER TABLE public.pix_pendentes DISABLE TRIGGER pix_pendentes_visitor_gate;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.cartao_pendentes'::regclass
                AND tgname  = 'cartao_pendentes_visitor_gate') THEN
    ALTER TABLE public.cartao_pendentes DISABLE TRIGGER cartao_pendentes_visitor_gate;
  END IF;
END $$;

UPDATE public.pix_pendentes p
   SET filial = up.filial
  FROM public.user_profiles up
 WHERE up.id = p.operador_id
   AND p.filial IS NULL
   AND up.filial IN ('SuperMax', 'MaxLook', 'TechMax');

UPDATE public.cartao_pendentes c
   SET filial = up.filial
  FROM public.user_profiles up
 WHERE up.id = c.operador_id
   AND c.filial IS NULL
   AND up.filial IN ('SuperMax', 'MaxLook', 'TechMax');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.pix_pendentes'::regclass
                AND tgname  = 'pix_pendentes_visitor_gate') THEN
    ALTER TABLE public.pix_pendentes ENABLE TRIGGER pix_pendentes_visitor_gate;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.cartao_pendentes'::regclass
                AND tgname  = 'cartao_pendentes_visitor_gate') THEN
    ALTER TABLE public.cartao_pendentes ENABLE TRIGGER cartao_pendentes_visitor_gate;
  END IF;
END $$;

-- Preenchimento defensivo: só quando o insert não citou a coluna.
-- search_path fixo — trigger function sem ele quebra em contexto de outro
-- schema (a mesma pegadinha que já derrubou delete de usuário aqui).
CREATE OR REPLACE FUNCTION public.pendente_pagamento_preenche_filial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.filial IS NULL AND NEW.operador_id IS NOT NULL THEN
    SELECT up.filial INTO NEW.filial
      FROM public.user_profiles up
     WHERE up.id = NEW.operador_id;
  END IF;
  RETURN NEW;
END;
$$;

-- SEM REVOKE de EXECUTE aqui, ao contrário da régua das RPCs. A função retorna
-- `trigger`: o PostgREST não expõe esse tipo, então não há superfície de RPC
-- para fechar. E revogar teria risco assimétrico — a checagem de EXECUTE de
-- função de trigger é feita no CREATE TRIGGER, não a cada disparo, mas se essa
-- premissa estiver errada o preço é todo INSERT de cobrança falhando no caixa.
-- Ganho simbólico, risco no PDV: fica como está.

DROP TRIGGER IF EXISTS trg_pix_pendentes_filial    ON public.pix_pendentes;
DROP TRIGGER IF EXISTS trg_cartao_pendentes_filial ON public.cartao_pendentes;

CREATE TRIGGER trg_pix_pendentes_filial
  BEFORE INSERT ON public.pix_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.pendente_pagamento_preenche_filial();

CREATE TRIGGER trg_cartao_pendentes_filial
  BEFORE INSERT ON public.cartao_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.pendente_pagamento_preenche_filial();

-- Índice para a varredura de órfãos: filtra filial + status e ordena por idade.
-- Parcial porque só 'aguardando' é varrido; pago e cancelado ficam de fora.
CREATE INDEX IF NOT EXISTS idx_pix_pendentes_filial_aguardando
  ON public.pix_pendentes (filial, created_at)
  WHERE status = 'aguardando';

CREATE INDEX IF NOT EXISTS idx_cartao_pendentes_filial_aguardando
  ON public.cartao_pendentes (filial, created_at)
  WHERE status = 'aguardando';

-- RLS não muda. A coluna é escopo de varredura, não de acesso: quem lê
-- continua sendo o operador dono, o admin, e o pagador anônimo que escaneou o
-- QR (`status = 'aguardando'`, por id).

COMMIT;

-- PostgREST precisa reler o schema para enxergar a coluna nova.
NOTIFY pgrst, 'reload schema';
