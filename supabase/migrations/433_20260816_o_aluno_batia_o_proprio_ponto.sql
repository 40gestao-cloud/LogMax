-- 433_20260816_o_aluno_batia_o_proprio_ponto.sql
--
-- (O nome do arquivo ficou com o vocabulário antigo, "batia o ponto". Desde
-- 2026-07-29 o módulo é **Registro de Ponto** — Ponto Eletrônico e Frequência
-- de Trabalho viraram abas dele —, e o ato se chama registro de ponto. O nome
-- não muda porque a migração já foi aplicada nas 4 turmas.)
--
-- Achado da varredura função a função de 16/08, na parte das funções de
-- TRIGGER — as únicas que faltavam depois das RPCs de escrita e de leitura.
--
-- ════════════════════════════════════════════════════════════════════════════
-- O ALUNO REGISTRAVA O PRÓPRIO PONTO, COM A HORA QUE QUISESSE
--
-- Três peças que isoladas parecem inofensivas:
--
--   1. `pontoqr_insert` aceita `WITH CHECK (user_id = auth.uid() OR rh)`;
--   2. `ponto_qr_registros.registrado_em` tem `DEFAULT now()`, e default é só
--      default — o cliente manda o valor que quiser, e não há CHECK nenhum na
--      tabela;
--   3. o gatilho `fn_sync_ponto_eletronico` deriva data e hora de
--      `NEW.registrado_em` e grava `status = 'Normal'`, fixo. Ele nunca escreve
--      'Atrasado'.
--
-- Juntas, uma linha no console basta:
--
--     supabase.from('ponto_qr_registros').insert({
--       user_id: <o meu>, tipo: 'entrada',
--       registrado_em: '2026-08-16T07:35:00-05:00'   // antes do horário
--     })
--
-- e nasce em `ponto_eletronico` uma entrada às 07:35, status 'Normal', em
-- qualquer data — inclusive num dia em que a pessoa faltou. Frequência pesa 20%
-- no placar da competição e atraso vale 0,5, então isto é nota.
--
-- O que fecha o caso: **nenhuma tela escreve nessa tabela.** O único INSERT do
-- repositório é `api/register-ponto.ts`, que usa service-role e carimba o
-- horário no servidor. O ramo `user_id = auth.uid()` da policy é superfície
-- pura, sobra de quando o registro saía do cliente.
--
-- Estrago até agora: zero. `ponto_qr_registros` está com 0 linhas (conferido
-- nas 4 turmas); as 50 linhas de `ponto_eletronico` vieram por outro caminho.
-- É buraco aberto, não incidente.
--
-- ────────────────────────────────────────────────────────────────────────────
-- E TEM O CAMINHO CURTO: ESCREVER DIRETO NO PONTO
--
-- Fechar só o QR não resolveria. `ponto_eletronico` tem `ponto_self_insert`
-- com `WITH CHECK (funcionario_id = <o meu>)` — o aluno insere direto, sem
-- passar pelo QR, escolhendo `data`, `entrada`, `status` e
-- `horas_trabalhadas`. O `UNIQUE (funcionario_id, data)` impede sobrescrever
-- um dia já lançado, mas não impede CRIAR um dia que ainda não existe: falta
-- não registrada vira presença. E `horas_trabalhadas` alimenta a folha, então
-- não para na frequência.
--
-- Mesma conclusão do QR: superfície não usada. Nenhuma tela insere direto em
-- `ponto_eletronico` — o caminho do app é a RPC `registrar_ponto_manual`
-- (`FrequenciaTrabalhoView`, hoje uma aba de **Registro de Ponto**), que tem
-- `_assert_rpc` e régua de RH, e o totem entra pelos endpoints com
-- service-role, que não passam por RLS.
--
-- O SELECT do próprio ponto fica: ver a própria frequência é direito de quem
-- tem o ponto registrado. O que sai é só a escrita.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Três travas, porque nenhuma sozinha basta:
--
--   • a policy perde o ramo do próprio usuário — quem registra o ponto é o totem,
--     pelo endpoint, com service-role. RH continua podendo lançar (é a mesma
--     régua de `ponto_eletronico`, onde `ponto_rh_insert` já existe);
--   • um gatilho BEFORE carimba `registrado_em := now()` para qualquer chamador
--     autenticado. Assim, mesmo que alguém devolva o INSERT à tela um dia, a
--     hora deixa de ser palpite do cliente. service-role segue livre, senão o
--     endpoint do totem (que precisa registrar o instante da leitura do QR) e a
--     manutenção pelo SQL Editor quebram;
--   • `ponto_self_insert` sai de `ponto_eletronico`. Sem isso as duas primeiras
--     só empurram o problema uma tabela adiante.
--
-- NÃO mexido de propósito: `fn_sync_ponto_eletronico` continua gravando
-- 'Normal' fixo em vez de calcular 'Atrasado' a partir da jornada
-- (`definir_ponto_jornada`). É divergência real com o caminho da API, que
-- calcula o atraso em `lib/ponto.ts` — mas é regra de negócio, não segurança, e
-- com a tabela zerada não há urgência. Fica anotado para decidir à parte.


BEGIN;

-- 1. Registrar ponto é ato do totem, não da tela.
DROP POLICY IF EXISTS "pontoqr_insert" ON public.ponto_qr_registros;
CREATE POLICY "pontoqr_insert" ON public.ponto_qr_registros
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_in_setor(VARIADIC ARRAY['rh'::text]));

-- 2. A hora é do servidor, não do cliente.
CREATE OR REPLACE FUNCTION public.ponto_qr_carimba_hora()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role: o endpoint do totem informa o instante da leitura do QR, e a
  -- manutenção pelo SQL Editor precisa poder corrigir. Todo o resto usa now().
  IF public.auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  NEW.registrado_em := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ponto_qr_carimba_hora ON public.ponto_qr_registros;
CREATE TRIGGER trg_ponto_qr_carimba_hora
  BEFORE INSERT OR UPDATE ON public.ponto_qr_registros
  FOR EACH ROW EXECUTE FUNCTION public.ponto_qr_carimba_hora();

REVOKE ALL ON FUNCTION public.ponto_qr_carimba_hora() FROM public, anon;

-- 3. Ninguém lança o próprio ponto direto na tabela. RH e gerente da filial
--    continuam pela `ponto_rh_insert`, que já existe e não é tocada aqui.
--    O SELECT do próprio ponto (`ponto_self_select`) fica de pé.
DROP POLICY IF EXISTS "ponto_self_insert" ON public.ponto_eletronico;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (nos 4)
--
--   SELECT with_check FROM pg_policies
--    WHERE tablename='ponto_qr_registros' AND policyname='pontoqr_insert';
--   -- não pode mais conter 'auth.uid()'
--
--   SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
--    WHERE c.relname='ponto_qr_registros' AND t.tgname='trg_ponto_qr_carimba_hora';
--   -- espera 1
--
--   SELECT count(*) FROM pg_policies
--    WHERE tablename='ponto_eletronico' AND cmd='INSERT' AND with_check ~ 'auth.uid';
--   -- espera 0 (só sobra ponto_rh_insert)
--
-- TESTE MANUAL (F12, aluno colaborador):
--   insert em ponto_qr_registros com o próprio user_id  → deve dar 42501
--   insert em ponto_eletronico com o próprio func_id    → deve dar 42501
--   ver a própria frequência na tela                    → continua funcionando
--   RH lança presença por Frequência de Trabalho        → continua funcionando
--   totem/endpoint de ponto                             → continua registrando
-- ════════════════════════════════════════════════════════════════════════════
