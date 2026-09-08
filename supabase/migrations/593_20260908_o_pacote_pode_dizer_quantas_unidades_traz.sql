-- ════════════════════════════════════════════════════════════════════════════
-- 593 — O pacote passa a poder dizer quantas UNIDADES traz
--
-- "ONDE VAI APARECER A QUANTIDADE DE UNIDADES POR PACOTE?"
--
-- A pergunta é do professor, olhando o cadastro depois da migr. 589, e não
-- tinha resposta. O produto sabia declarar:
--
--   unidade              como o item entra e sai do estoque      (PCT)
--   peso/peso_unidade    o conteúdo da embalagem — SÓ EM PESO OU VOLUME
--   embalagem de compra  como o fornecedor vende                 (FARDO com 30)
--
-- O conteúdo estava preso a G/KG/ML/L desde a migr. 438. Serve para "pacote de
-- 5 KG", não serve para "pacote com 6 sabonetes" — e é aí que a contagem some.
-- O aluno não tem onde escrever o 6, então escreve no NOME, e o nome não soma,
-- não converte e não entra em relatório nenhum.
--
-- ── O que os dados mostram ──────────────────────────────────────────────────
--
-- Na SuperMax do projeto ERP, hoje:
--
--   nome                              unidade  peso     peso_unidade
--   Açúcar Cristal 1 (kg) 30 UN       PCT      1        KG
--   Azeite de Oliva (500 ml) 12 UN    PCT      500      ML
--   Ervilha(170 g) 24 UN              PCT      170      G
--
-- Leia a primeira linha inteira: o estoque conta PACOTES, cada pacote declara
-- conter 1 KG, e o "30" mora no texto. Mas o pacote não tem 1 kg — tem 30
-- unidades de 1 kg. O campo de conteúdo foi preenchido com o conteúdo da
-- UNIDADE, porque não havia campo para a unidade e o pacote ao mesmo tempo.
--
-- ── A régua que passa a existir ─────────────────────────────────────────────
--
-- `peso_unidade` aceita 'UN'. Com isso as três medidas passam a cobrir a
-- cadeia inteira, e cada uma responde a UMA pergunta:
--
--   Compra em     como o FORNECEDOR vende      1 FARDO = 30 PCT
--   Unidade       como o ESTOQUE conta e o PDV vende   PCT
--   Conteúdo      o que vem DENTRO de uma unidade      1 PCT = 6 UN (ou 5 KG)
--
-- O caso do açúcar acima não precisa de 'UN' nenhum: ele é um produto vendido
-- avulso (o cliente leva um pacote de 1 kg), então `unidade` é UN, o conteúdo
-- é 1 KG e o "30" é a EMBALAGEM DE COMPRA — exatamente o campo que a 589
-- criou. 'UN' como medida de conteúdo serve para o outro caso, o de quem vende
-- o pacote fechado no caixa: pacote com 6 sabonetes, cartela com 12 pilhas.
--
-- ── Conteúdo em UN só quando a unidade NÃO é UN ─────────────────────────────
--
-- "1 UN contém 1 UN" não é informação, é ruído — e é a primeira coisa que
-- alguém preenche por engano quando um campo aceita a mesma sigla dos dois
-- lados. O CHECK recusa. Continua valendo o que a 456 já dizia: item vendido a
-- granel não tem conteúdo de embalagem nenhum.
--
-- NÃO MEXE NOS DADOS. As três linhas acima seguem como estão: reclassificar
-- catálogo da turma por SQL é decidir por ela o que é unidade de venda — e
-- isso é a conversa de aula que este campo existe para provocar. A tela passa
-- a avisar quem escolhe PCT/CX como unidade de estoque.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_peso_unidade;

ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_peso_unidade
  CHECK (peso_unidade IS NULL OR peso_unidade IN ('G', 'KG', 'ML', 'L', 'UN'));

COMMENT ON CONSTRAINT chk_produtos_peso_unidade ON public.produtos IS
  'Medida do conteúdo da embalagem: peso, volume ou CONTAGEM (migr. 593). Sem UN, "pacote com 6 sabonetes" não tinha onde ser escrito e a contagem ia parar no nome do produto.';

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS chk_produtos_conteudo_un_redundante;

ALTER TABLE public.produtos
  ADD CONSTRAINT chk_produtos_conteudo_un_redundante
  CHECK (peso_unidade IS DISTINCT FROM 'UN' OR upper(btrim(COALESCE(unidade, 'UN'))) <> 'UN')
  NOT VALID;

COMMENT ON CONSTRAINT chk_produtos_conteudo_un_redundante ON public.produtos IS
  '"1 UN contém N UN" não descreve nada (migr. 593): conteúdo contado em unidades só faz sentido quando o estoque conta embalagens (PCT, CX, PC). NOT VALID pela régua da 456 — a turma não é travada por dado que criou aprendendo.';

COMMENT ON COLUMN public.produtos.peso_unidade IS
  'Medida do CONTEÚDO de uma unidade de estoque: G/KG/ML/L quando é peso ou volume, UN quando é contagem (migr. 593). Independente de produtos.unidade (a medida de entrada/saída) e de embalagem_compra (como o fornecedor vende). Pacote com 6 sabonetes: unidade=PCT, peso=6, peso_unidade=UN.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =================================================================
-- VERIFICAÇÃO (rodar nos 4 depois de aplicar)
--
--   SELECT conname, convalidated, pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conrelid='public.produtos'::regclass
--      AND conname IN ('chk_produtos_peso_unidade','chk_produtos_conteudo_un_redundante');
--
--   -- O passivo que a migração DEIXA de propósito: unidade de estoque em
--   -- pacote/caixa com a contagem escrita no nome. É a lição de casa da turma.
--   SELECT filial, nome, unidade, peso, peso_unidade, embalagem_compra, embalagem_qtd
--     FROM produtos
--    WHERE ativo AND unidade IN ('PCT','CX','PC')
--      AND nome ~* '[0-9]+\s*(unidades?|un\y)'
--    ORDER BY filial, nome;
-- =================================================================
