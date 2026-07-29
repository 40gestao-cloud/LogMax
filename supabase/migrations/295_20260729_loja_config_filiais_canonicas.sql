-- 295 — A loja de cada filial deixa de depender de já existir produto.
--
-- ERRO DA 293. O seed de `loja_config` foi escrito assim:
--
--     INSERT INTO loja_config (filial, aberta)
--     SELECT DISTINCT filial FROM produtos WHERE filial IS NOT NULL;
--
-- Isso amarrou o cadastro da loja ao acervo de produtos do dia da migração,
-- e o resultado apareceu na hora de publicar as 12 lojas (3 filiais × 4
-- turmas):
--
--   • turma contabilidade: `produtos` está vazia, então nasceram ZERO lojas.
--     As três lojas respondiam 404 "Loja não encontrada" — que é a mensagem
--     de loja inexistente, não de loja fechada, e não dá nenhuma pista de
--     que o problema é o cadastro faltando.
--
--   • turma adm: `produtos` só tinha 'Matriz' e 'SuperMax'. Nasceu loja para
--     a MATRIZ, que não vende, e não nasceu para MaxLook nem TechMax.
--
--   • turmas erp e aprendiz: funcionaram por coincidência — tinham produto
--     nas três filiais.
--
-- A loja de uma filial existe porque a filial existe, não porque alguém já
-- cadastrou mercadoria. Filial nova começa com a loja fechada e a vitrine
-- vazia, que é exatamente o que a página sabe dizer.
--
-- MATRIZ NÃO TEM LOJA. Ela não opera venda (vide a régua canônica
-- Matriz/Filial) — quem vende é a filial. A linha da Matriz criada por
-- acidente é removida, mas só quando não houver pedido nenhum apontando
-- para ela: se alguém já usou, o dado fica e o assunto vira conversa.
--
-- IDEMPOTENTE. Aplicar nos 4 projetos de turma.

BEGIN;

-- As três filiais que vendem, escritas por extenso. Nomes fora desta lista
-- ('Super Max ', 'Techmax', 'ascSAC' e afins que aparecem em `filiais` de
-- algumas turmas) não entram: a loja manda o valor canônico no parâmetro
-- `filial`, e um cadastro com nome divergente nunca casaria com ela.
INSERT INTO public.loja_config (filial, aberta)
VALUES ('SuperMax', false), ('MaxLook', false), ('TechMax', false)
ON CONFLICT (filial) DO NOTHING;

DELETE FROM public.loja_config lc
 WHERE lc.filial = 'Matriz'
   AND NOT EXISTS (
     SELECT 1 FROM public.pedidos_online p WHERE p.filial = lc.filial
   );

COMMIT;

-- Conferência: as 3 linhas presentes, nenhuma Matriz.
--   SELECT filial, aberta FROM loja_config ORDER BY filial;
