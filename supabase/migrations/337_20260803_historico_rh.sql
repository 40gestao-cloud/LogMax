-- 337 — Histórico de operações em RH.
--
-- Fase 1 (331) cobriu compras, fase 2 (332) vendas e financeiro. RH ficou por
-- último e é onde "quem alterou isso?" pesa mais: aqui o registro é uma pessoa,
-- não um toner.
--
-- ─── O QUE ESTA MIGRAÇÃO NÃO REGISTRA, E POR QUÊ ────────────────────────────
--
-- A trilha é lida por quem enxerga a filial (policy `historico_select`, migr.
-- 331), o que inclui o colaborador. Isso foi decisão deliberada — era o que
-- tirava o aluno da dependência do professor. Mas a régua muda o que pode
-- entrar aqui: qualquer coluna observada vira texto legível para os colegas de
-- unidade, e não só para o RH.
--
-- Por isso:
--
--   • `funcionarios.salario` fica FORA da lista observada. Registrar
--     "salario: 2000 → 3000" publicaria a folha de cada colega numa tabela que
--     o colega lê. Mudança de cargo entra (é pública na prática, e é o que dá
--     sentido à movimentação); o valor, não.
--   • `demissoes.motivo` fica FORA pelo mesmo raciocínio: a transição de status
--     conta que houve desligamento; o motivo é conversa entre RH e a pessoa.
--   • `pdi_itens` e `movimentacoes_carreira` ficam fora inteiras: não têm
--     coluna `filial`, e a policy libera linha sem filial para todo
--     `authenticated`. Sem o recorte por unidade, a trilha de desenvolvimento
--     individual vazaria para o sistema inteiro. Elas voltam quando ganharem
--     `filial` — ou quando a policy ganhar um caso próprio.
--
-- O que sobra ainda responde a pergunta que motivou tudo isto: quem pediu,
-- quem aprovou, quando, e o que mudou de data ou de tipo.

BEGIN;

-- Férias: pedido do colaborador, decisão do gestor, e as datas — que é
-- justamente o que muda depois de aprovado e gera a dúvida.
DROP TRIGGER IF EXISTS trg_historico ON public.ferias;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.ferias
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('data_inicio', 'data_fim');

-- Afastamento escreve falta justificada no ponto (migr. 085): mudar tipo ou
-- período muda a frequência de alguém.
DROP TRIGGER IF EXISTS trg_historico ON public.afastamentos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.afastamentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('tipo', 'data_inicio', 'data_fim');

-- Desligamento: a filial instrui, a Matriz decide (migr. 318). São dois papéis
-- e dois momentos — sem trilha, o segundo não sabe o que o primeiro fez.
DROP TRIGGER IF EXISTS trg_historico ON public.demissoes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.demissoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('tipo');

DROP TRIGGER IF EXISTS trg_historico ON public.rescisoes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.rescisoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico();

-- Cargo sim, salário não — ver o bloco acima.
DROP TRIGGER IF EXISTS trg_historico ON public.funcionarios;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('cargo');

-- Recrutamento: a vaga e o caminho do candidato pelas etapas.
DROP TRIGGER IF EXISTS trg_historico ON public.vagas;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.vagas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('cargo', 'tipo');

DROP TRIGGER IF EXISTS trg_historico ON public.candidaturas;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.candidaturas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('etapa');

-- Treinamento e avaliação: quem inscreveu, quem avaliou, quando.
DROP TRIGGER IF EXISTS trg_historico ON public.treinamentos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.treinamentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('data_inicio', 'data_fim');

-- `avaliacoes` não tem coluna `status`: registra criação e mudança de tipo, que
-- é o que existe para contar nela.
DROP TRIGGER IF EXISTS trg_historico ON public.avaliacoes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.avaliacoes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('tipo');

COMMIT;

-- Rode a 333 (backfill) de novo depois desta: ela é idempotente e dirigida
-- pelos próprios triggers, então dá ponto de partida às nove tabelas novas sem
-- tocar no que já tem trilha.
--
-- Verificação (esperado: 27 tabelas — 18 anteriores mais estas 9):
--
--   SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname = 'trg_historico' ORDER BY 1;
--
--   -- Nenhuma linha de histórico pode conter salário:
--   SELECT count(*) FROM historico_operacoes
--    WHERE entidade = 'funcionarios' AND detalhe ILIKE '%salario%';
