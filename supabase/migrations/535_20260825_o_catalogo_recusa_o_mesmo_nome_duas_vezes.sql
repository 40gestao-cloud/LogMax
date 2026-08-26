-- 535 — O catálogo recusa o mesmo nome duas vezes na mesma unidade.
--
-- Fecha o último invariante do fluxo de compras. A 537 pôs o cadeado na tela
-- (enquanto um aluno cadastra aquela origem, ela aparece travada para os
-- colegas) e a 538 fechou a cotação no banco. Faltava o caso que abriu esta
-- frente inteira: "1 produto cadastrado 2 vezes".
--
-- A régua é a mesma que a 481 fixou e a 538 repetiu: reserva é rascunho com
-- prazo, quem garante unicidade é o índice.
--
-- ─── POR QUE ESTA VEIO DEPOIS, E NÃO JUNTO ─────────────────────────────────
--
-- Porque a base tinha 8 grupos duplicados e o índice não subiria. Foram
-- limpos em 2026-08-25, antes desta migração:
--
--   Aprendiz (2 grupos)
--     · Biscoito Recheado Chocolate 130g-Oreo — ficou o 046, que tinha pedido
--       e requisição apontando para ele; o 041 saiu sem nenhum vínculo.
--     · Teclado Sem Fio Slim — as duas cópias zeradas. Saiu a 009, cujo nome
--       tinha um espaço à esquerda; é o `trim` desta chave que as juntava.
--
--   Contabilidade (6 grupos)
--     · Calça Jeans Masculina Slim Levi's — TRÊS cópias. Ficou a 013 (32 un.,
--       1 movimentação); 006 e 017 saíram zeradas.
--     · Camiseta Hering — ficou a 020 (45 un.); saiu a 026.
--     · Carteira Couro & Cia — ficou a 024 (44 un.); saiu a 021.
--     · Jaqueta Renner — ficou a 010 (20 un.); saiu a 025.
--     · Lustra-Móveis Lavanda 200ml — as duas zeradas, mesmo markup de 45% e
--       custos diferentes (R$ 15,90 x R$ 3,41). Ficou a 014, por ter o código
--       reservado antes. Escolha arbitrária: nenhuma das duas tinha uso.
--     · Desinfetante Pinho 500ml — o único que não era descarte, era FUSÃO:
--       as duas tinham saldo e movimentação (59 un. e 30 un.). Consolidado em
--       89 un. no 008, com as movimentações e os vencimentos do 017
--       repontados. Decisão do professor.
--
-- Nada foi apagado: `ativo = false` é soft delete, o gatilho
-- `fn_carimba_exclusao` carimba `excluido_em`, e as cópias continuam na
-- Lixeira de cadastros (migr. 451/452) se alguém precisar voltar atrás.
--
-- ─── COMO A FUSÃO MOVEU O SALDO (para a próxima vez) ───────────────────────
--
-- Repontando `movimentacoes_estoque.produto_id`, e SÓ isso. O gatilho
-- `fn_atualiza_estoque_produto` já trata movimentação que troca de produto —
-- subtrai do saldo antigo, soma no novo. Escrever `produtos.estoque` na mão
-- não funciona e é pior do que não funcionar: `fn_block_estoque_manual`
-- devolve o valor anterior EM SILÊNCIO, sem erro nenhum.
--
-- ─── A PRÉ-CHECAGEM ────────────────────────────────────────────────────────
--
-- Turma nova nasce de `docs/setup-turma/`, não daqui — mas se um dia esta
-- migração rodar num banco com duplicata, o erro nativo do índice é
-- "could not create unique index ... Key (filial, lower(btrim(nome)))=(...)",
-- que não diz quais produtos nem o que fazer. O bloco abaixo levanta a lista
-- de nomes antes, com o caminho da limpeza. Custa uma agregação numa tabela
-- pequena e evita meia hora de garimpo.
--
-- ─── O QUE O ÍNDICE NÃO PEGA ───────────────────────────────────────────────
--
-- Nome PARECIDO ("Arros Branko" x "Arroz Branco 5kg"). Isso é leitura, não
-- comparação — continua com a camada 2 da migr. 472 (IA, com os vizinhos do
-- catálogo como contexto) e com a regra "Nome duplicado no catálogo" da 534.
-- Igualdade exata (depois de `lower` + `trim`) é o que dá para impor sem
-- recusar cadastro legítimo: a grade de variantes da MaxLook (migr. 445) gera
-- "Camiseta P" e "Camiseta G", que são parecidos de propósito.
--
-- IDEMPOTENTE. APLICAR NOS 4 PROJETOS.

BEGIN;

DO $pre$
DECLARE
  v_lista text;
BEGIN
  SELECT string_agg(DISTINCT filial || ' — "' || btrim(nome) || '"', E'\n  ')
    INTO v_lista
    FROM public.produtos p
   WHERE p.ativo
     AND EXISTS (
       SELECT 1 FROM public.produtos o
        WHERE o.id <> p.id AND o.ativo
          AND o.filial IS NOT DISTINCT FROM p.filial
          AND lower(btrim(o.nome)) = lower(btrim(p.nome)));

  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION E'Há produto ativo repetido no catálogo, e o índice não sobe enquanto houver:\n  %\n\nAntes de aplicar esta migração, decida uma cópia por nome em cada unidade. Se as duas tiverem saldo, é FUSÃO e não descarte: reaponte `movimentacoes_estoque.produto_id` para a cópia que fica (o gatilho move o saldo sozinho) e só então marque a outra com ativo = false.', v_lista
      USING ERRCODE = 'P0001';
  END IF;
END $pre$;

-- `btrim` e não `trim`: mesma função, mas `trim` no corpo do índice é
-- reescrito pelo Postgres para `btrim` de qualquer jeito, e escrever já como
-- ele guarda evita o checador de drift acusar diferença entre o arquivo e o
-- banco.
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_nome_filial_ativo
  ON public.produtos (filial, lower(btrim(nome)))
  WHERE ativo;

COMMENT ON INDEX public.uq_produtos_nome_filial_ativo IS
  'Um produto ativo por nome em cada unidade. Igualdade exata depois de lower+trim '
  '— nome PARECIDO continua sendo trabalho da camada de IA (migr. 472) e da regra '
  'da 534, porque a grade de variantes (migr. 445) gera nomes parecidos de '
  'propósito. Migr. 535.';

COMMIT;

-- Verificação:
--
--   -- Deve devolver zero linhas nos 4 projetos:
--   SELECT filial, lower(btrim(nome)), count(*) FROM produtos WHERE ativo
--    GROUP BY 1,2 HAVING count(*) > 1;
--
--   -- Cadastrar duas vezes o mesmo nome na mesma unidade tem de recusar;
--   -- o mesmo nome em unidades DIFERENTES continua valendo.
