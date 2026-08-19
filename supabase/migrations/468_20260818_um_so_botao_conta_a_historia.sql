-- 468 — A trilha chega ao catálogo, e sobra um botão só.
--
-- Desde a migr. 331 o ERP tem duas respostas para a mesma pergunta:
--
--   • o ícone de autoria (migr. 055): `criado_por` / `atualizado_por` na
--     própria linha, visível só para admin, CEO e gerente;
--   • a trilha (`historico_operacoes`): a história inteira do documento,
--     visível para quem opera a unidade.
--
-- Nas telas onde as duas existiam, eram dois ícones de relógio lado a lado —
-- e a primeira linha da trilha ("Criado por Fulano") já dizia o que o popover
-- dizia. O front acabou de tirar o popover de onde há trilha. Sobraram 15
-- tabelas de catálogo e movimento SEM trigger, onde o popover ainda era a
-- única resposta — e onde, por ser da Matriz para cima, o aluno que mexeu no
-- cadastro não conseguia ver o que ele mesmo tinha feito.
--
-- Esta migração fecha a lacuna: as 15 ganham `trg_historico`, o popover é
-- aposentado no front, e passa a existir UM botão de histórico em todo o ERP.
--
-- ─── O QUE ENTRA NA TRILHA, E O QUE NÃO ENTRA ───────────────────────────────
--
-- A trilha é lida por todo mundo que enxerga a filial, e o popover era lido só
-- pela Matriz. Trocar um pelo outro sem critério ALARGA a visibilidade. Por
-- isso o TG_ARGV de cada tabela lista apenas o que já está à vista de quem
-- opera a unidade — e a régua que a migr. 337 escreveu para o RH ("cargo sim,
-- salário não") vale igual aqui:
--
--   • `cargos.salario_base` e `beneficios.valor` ficam FORA. São remuneração,
--     e a tela que os mostra é de RH/Cadastros, não da operação.
--   • `produtos` não tem coluna de custo (o custo é média ponderada calculada
--     noutro lugar, migr. 417), então `preco` — que já está na vitrine — entra
--     sem risco.
--   • `caixa_bancos.saldo` fica FORA por ruído, não por sigilo: muda a cada
--     movimento e afogaria a trilha. Quem quer saldo tem o extrato.
--   • `produtos.estoque` fica fora pela mesma razão — muda a cada venda.
--
-- ─── POR QUE `produtos` USA `UPDATE OF` ─────────────────────────────────────
--
-- Todas as outras seguem o padrão da 331 (`AFTER INSERT OR UPDATE`). `produtos`
-- é a única no caminho quente: o PDV dá baixa de estoque a cada item vendido, e
-- um trigger FOR EACH ROW ali significa um SELECT em `user_profiles` por item —
-- para no fim não gravar nada, porque estoque não está na lista de decisão.
-- `UPDATE OF` faz o Postgres nem disparar o trigger quando o UPDATE não toca
-- nenhuma das colunas listadas. ATENÇÃO ao mexer: coluna nova que devesse entrar
-- na trilha precisa ser acrescentada NOS DOIS lugares — na cláusula `UPDATE OF`
-- e no TG_ARGV —, senão o trigger nunca dispara para ela.

BEGIN;

-- ─── Cadastros comerciais ───────────────────────────────────────────────────

-- Limite de crédito entra: é a decisão que a migr. 416 quis tornar
-- responsabilizável, e é dado do negócio, não remuneração de pessoa.
DROP TRIGGER IF EXISTS trg_historico ON public.clientes;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'limite_credito');

-- Prazo de entrega é o que a migr. 421 usa para medir pontualidade — mudá-lo
-- muda a régua pela qual o fornecedor é julgado.
DROP TRIGGER IF EXISTS trg_historico ON public.fornecedores;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'prazo_entrega_dias');

-- ─── Catálogo ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_historico ON public.produtos;
CREATE TRIGGER trg_historico
  AFTER INSERT OR UPDATE OF nome, preco, unidade, status, ativo ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'preco', 'unidade');

-- ─── Estrutura da empresa ───────────────────────────────────────────────────

-- `filiais` e `centros_custo` não têm coluna `filial`, então a linha do
-- histórico nasce com filial NULL e a policy da 331 a libera para todos os
-- autenticados. É o comportamento certo: são dados institucionais, e a tela
-- que os mostra já é lida por toda a rede.
DROP TRIGGER IF EXISTS trg_historico ON public.filiais;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.filiais
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'cidade', 'representante');

DROP TRIGGER IF EXISTS trg_historico ON public.centros_custo;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.centros_custo
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'orcamento', 'grupo_dre');

DROP TRIGGER IF EXISTS trg_historico ON public.projetos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.projetos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'responsavel', 'orcamento', 'data_fim');

DROP TRIGGER IF EXISTS trg_historico ON public.departamentos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.departamentos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'responsavel');

-- Cargo sim, salário não — mesma régua da migr. 337.
DROP TRIGGER IF EXISTS trg_historico ON public.cargos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.cargos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'nivel');

-- Benefício sim, valor não — `beneficios.valor` é remuneração indireta.
DROP TRIGGER IF EXISTS trg_historico ON public.beneficios;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.beneficios
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('nome', 'tipo');

-- ─── Financeiro: catálogo, não movimento ────────────────────────────────────

DROP TRIGGER IF EXISTS trg_historico ON public.caixa_bancos;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.caixa_bancos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('banco', 'conta', 'is_reserva');

DROP TRIGGER IF EXISTS trg_historico ON public.condicoes_pagamento;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.condicoes_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('descricao', 'parcelas', 'dias');

DROP TRIGGER IF EXISTS trg_historico ON public.formas_pagamento;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.formas_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('descricao', 'taxa', 'prazo');

-- ─── Estoque: onde a divergência vira discussão ─────────────────────────────

-- Contagem corrigida depois de fechada é exatamente a dúvida que a trilha
-- resolve: o sistema dizia 40, alguém contou 38, e depois alguém mudou para 40.
DROP TRIGGER IF EXISTS trg_historico ON public.inventarios;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('qtd_contada', 'diferenca');

DROP TRIGGER IF EXISTS trg_historico ON public.movimentacoes_estoque;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('tipo', 'qtd', 'origem', 'destino');

-- Lote e vencimento mexidos à mão mudam a ordem do FEFO (migr. 424).
DROP TRIGGER IF EXISTS trg_historico ON public.vencimentos_estoque;
CREATE TRIGGER trg_historico AFTER INSERT OR UPDATE ON public.vencimentos_estoque
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico('lote', 'qtd', 'vencimento');

-- ────────────────────────────────────────────────────────────────────────────
-- Backfill — idêntico ao da migr. 333, que foi escrita para ser reexecutada:
-- a lista sai dos próprios triggers, e o `WHERE NOT EXISTS` impede duplicar o
-- que já tem trilha. Sem isto, todo cadastro anterior a hoje abriria o
-- histórico vazio, que lê como "nunca aconteceu nada aqui" — e cadastro é
-- justamente o que foi criado no primeiro dia da turma.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t          text;
  e_criado   text;
  e_data     text;
  e_filial   text;
  e_status   text;
  v_ins      bigint;
  v_total    bigint := 0;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE tg.tgname = 'trg_historico'
     ORDER BY 1
  LOOP
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='criado_por')
                THEN 'x.criado_por' ELSE 'NULL::uuid' END INTO e_criado;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='created_at')
                THEN 'x.created_at' ELSE 'now()' END INTO e_data;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='filial')
                THEN 'x.filial::text' ELSE 'NULL::text' END INTO e_filial;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=t AND column_name='status')
                THEN 'COALESCE(x.status::text, ''sem status'')' ELSE '''sem status''' END INTO e_status;

    EXECUTE format(
      'INSERT INTO public.historico_operacoes '
      '  (entidade, entidade_id, filial, evento, detalhe, ator_id, ator_nome, ator_setor, created_at) '
      'SELECT %L, x.id, %s, ''Criado'', '
      '       ''Documento anterior ao histórico. Situação em '' || to_char(now(), ''DD/MM/YYYY'') || '': '' || %s || ''.'', '
      '       %s, COALESCE(p.nome, ''Não registrado''), p.setor, %s '
      '  FROM public.%I x '
      '  LEFT JOIN public.user_profiles p ON p.id = %s '
      ' WHERE NOT EXISTS (SELECT 1 FROM public.historico_operacoes h '
      '                    WHERE h.entidade = %L AND h.entidade_id = x.id)',
      t, e_filial, e_status, e_criado, e_data, t, e_criado, t);

    GET DIAGNOSTICS v_ins = ROW_COUNT;
    v_total := v_total + v_ins;
    RAISE NOTICE '% → % documento(s)', t, v_ins;
  END LOOP;

  RAISE NOTICE 'Backfill concluído: % linha(s).', v_total;
END $$;

COMMIT;

-- A RPC `usuarios_visiveis_para_auditoria()` (migr. 055) fica no banco, sem
-- chamador: era ela que resolvia o RBAC do popover aposentado. Não é derrubada
-- aqui de propósito — DROP de função é irreversível numa migração, e uma RPC
-- sem chamador não custa nada. Se for removida algum dia, que seja em migração
-- própria, depois de confirmar que nenhuma das 4 turmas a chama.

-- Verificação:
--
--   -- As 15 novas devem aparecer aqui (33 tabelas com trilha no total):
--   SELECT c.relname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
--    WHERE tg.tgname = 'trg_historico' ORDER BY 1;
--
--   -- Nenhum cadastro ativo pode ter ficado sem ponto de partida:
--   SELECT count(*) FROM produtos p
--    WHERE NOT EXISTS (SELECT 1 FROM historico_operacoes h
--                       WHERE h.entidade = 'produtos' AND h.entidade_id = p.id);
--
--   -- Salário e valor de benefício NÃO podem aparecer na trilha:
--   SELECT count(*) FROM historico_operacoes
--    WHERE detalhe ILIKE '%salario%' OR detalhe ILIKE '%salário%';
