-- =================================================================
-- 398 — A aula de Compra precisa do catálogo dentro dela.
--
-- Diferente das outras: isto não muda schema, muda a CONFIG da aula que
-- está no ar. Está aqui porque `aula_config` é linha única e mexer nela
-- à mão em 4 projetos é como as configs divergem.
--
-- O fluxo "Compra — da necessidade ao pagamento" foi montado com
-- requisicoes + compras + financeiro + estoque. Faltou o começo: sem
-- `cadastros`, a turma não tem Categorias, Produtos nem Fornecedores.
--
-- Por que isso PARA a aula, e não só incomoda:
--   • Requisição de Reposição vem do catálogo — catálogo vazio, aba
--     inútil, sobra só a compra Eventual.
--   • Cotação exige `fornecedor_id`. Sem fornecedor cadastrado a cadeia
--     morre na 4ª de 9 etapas, e é uma parede, não um contorno.
--   • E o aluno não se salva sozinho: a whitelist da aula SUBSTITUI o
--     setor (migr. 317), então nem o gerente — que fora da aula vê tudo
--     da filial — enxerga Cadastros. Só o admin, que é isento.
--
-- Não abre nada novo na RLS: `aula_setores_do_modulo('cadastros')`
-- devolve logistica + compras, que `compras` e `estoque` já concediam.
-- A cadeia de escrita do cadastro fecha inteira com isso —
-- `categorias_produto` cobra só `auth_pode_filial`, `fornecedores` aceita
-- compras/financeiro/logistica, e `produtos_custo` (onde o preço de
-- custo do formulário de produto vai parar, e sem o qual o produto não
-- salva) aceita logistica.
--
-- `cadastros-serviços` fica de fora: não entra no fluxo de compra.
--
-- O WHERE mira a montagem da compra pelo submenu do Financeiro, que só
-- ela tem. Turma com outra aula no ar não é tocada — config de aula é
-- por turma, e propagar a de uma para as quatro seria o inverso do que
-- esta migração quer.
--
-- Idempotente: rodar de novo não duplica módulo nem submenu.
-- =================================================================

BEGIN;

UPDATE public.aula_config
   SET modulos_ativos = CASE
         WHEN 'cadastros' = ANY(modulos_ativos) THEN modulos_ativos
         -- `::text` não é enfeite: sem o cast, o literal fica sem tipo e o
         -- Postgres resolve `text[] || 'cadastros'` como concatenação de DOIS
         -- arrays, tentando ler "cadastros" como array literal — 22P02,
         -- "malformed array literal".
         ELSE modulos_ativos || 'cadastros'::text
       END,
       submenus_ativos = submenus_ativos || ARRAY(
         SELECT s FROM unnest(ARRAY[
           'cadastros-categorias',
           'cadastros-produtos',
           'cadastros-fornecedores'
         ]) s
          WHERE NOT (s = ANY(submenus_ativos))
       ),
       atualizado_em = now()
 WHERE ativo = true
   AND 'financeiro-aprovaçõesdecotação' = ANY(submenus_ativos);

COMMIT;

-- Sem NOTIFY: nada de schema mudou. `aula_config` está na publicação
-- realtime, então o menu dos alunos se atualiza sozinho, sem F5.

-- Verificação:
--
--   SELECT ativo, modulos_ativos, submenus_ativos FROM aula_config;
--   -- 'cadastros' entre os módulos e os 3 submenus na lista.
--
-- Ordem que a turma precisa seguir (produto exige categoria E fornecedor):
--   Categorias → Fornecedores → Produtos
