-- 608_20260922_quem_desce_para_a_filial_sai_do_conselho.sql
--
-- Kevila, Yan e Bismarck deram nota na competição 001 como conselheiros da
-- Matriz e depois voltaram para SuperMax, MaxLook e TechMax — cada um para uma
-- das filiais que estavam julgando. O sistema deixou: `/api/users` recusa
-- colaborador e gerente na Matriz, mas não recusa o caminho inverso, um
-- `conselheiro` (ou `ceo`) mandado para uma unidade operacional. O papel ficou
-- intacto e, com ele, o direito de avaliar a própria filial na rodada seguinte.
--
-- Conselho é cargo de Matriz. Quem desce para a filial sai do conselho no mesmo
-- ato — não é uma segunda tarefa que o professor precisa lembrar de fazer.
--
-- Gatilho de NORMALIZAÇÃO, não de bloqueio: mover a pessoa continua permitido,
-- o que muda é que o papel desce junto (`ceo`/`conselheiro` → `colaborador`).
-- Recusar o UPDATE obrigaria o professor a rebaixar antes e mover depois, em
-- duas idas à tela, para chegar no mesmo lugar.
--
-- `is_conselheiro` NÃO é tocado, e a primeira versão desta migração errava
-- nisso. O nome engana: o toggle "Acesso de Conselheiro" dá VISÃO GLOBAL a um
-- gerente, não assento no conselho — para votar e avaliar, `contar_votantes_
-- matriz` e `avaliar_item_matriz` exigem `filial = 'Matriz'`, e gerente nunca
-- é da Matriz. Ou seja: limpar a flag não fechava furo nenhum na competição e
-- matava um recurso que o professor liga de propósito.
--
-- Vale inclusive para o service_role: o caminho real é `/api/users`, que usa a
-- chave de serviço e passa por cima do `bloquear_privesc`. Um guard que
-- dispensa o service_role não guardaria nada aqui.
--
-- Nome com "c" depois de "bloquear_privesc": gatilhos BEFORE de mesma tabela
-- rodam em ordem alfabética, e este precisa vir DEPOIS de quem recusa troca de
-- role vinda de usuário comum — vide [[feedback_trigger_ordem_alfabetica]].
--
-- O que este gatilho NÃO faz: mexer em `setor`/`setores_extras`. Os três
-- ficaram com 5 setores extras da época do conselho, e decidir o que um aluno
-- enxerga na filial dele é escolha do professor, não normalização automática.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_conselho_e_da_matriz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Sem unidade (fila de alocação, migr. 411) e Matriz seguem como estão.
  IF NEW.filial IS NULL OR NEW.filial = 'Matriz' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IN ('ceo', 'conselheiro') THEN
    NEW.role := 'colaborador';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_user_profiles_conselho_e_da_matriz ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_conselho_e_da_matriz
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_conselho_e_da_matriz();

-- Quem já está em unidade operacional carregando papel de conselho.
UPDATE public.user_profiles
   SET role = 'colaborador'
 WHERE filial IS NOT NULL AND filial <> 'Matriz'
   AND role IN ('ceo', 'conselheiro');

COMMIT;
