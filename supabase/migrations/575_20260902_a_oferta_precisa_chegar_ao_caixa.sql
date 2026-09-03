-- A oferta precisa chegar ao caixa.
--
-- Promoção no LogMax é decidida antes do caixa: marketing propõe, Financeiro
-- ou o gerente aprova, e a aprovação TROCA `produtos.preco` pelo promocional
-- (migr. 402); o cron devolve o preço no fim do período. Isso está certo — em
-- supermercado o operador não decide preço, ele bipa.
--
-- O efeito colateral é que a promoção fica invisível justamente onde ela é
-- vivida: no caixa. O PDV lê `produtos.preco` e vê só o número final. O
-- operador não sabe que o item está em oferta e o cliente não vê o quanto
-- economizou — que é o que o cupom de qualquer rede imprime no rodapé.
--
-- O "de" existe: `marketing_promocoes.preco_atual` guarda o preço anterior. O
-- que faltava era o caixa poder ler. E ele não podia: a policy `mkt_select`
-- libera marketing, financeiro e o gerente da filial — o setor vendas fica de
-- fora. Abrir a tabela inteira para o operador resolveria e criaria um
-- problema maior: `marketing_promocoes` carrega `preco_custo`, e custo não é
-- assunto de frente de caixa.
--
-- Por isso uma VIEW estreita: só o que o PDV precisa mostrar (produto, de,
-- por, vigência, descrição), sem custo. Ela roda como dona (security_invoker
-- FALSE, declarado no CREATE — vide as migrações que perderam esse atributo
-- num REPLACE) para atravessar a RLS da tabela base, e recorta a unidade no
-- próprio corpo com `auth_pode_filial`: quem opera a TechMax não enxerga a
-- oferta da SuperMax.
--
-- A vigência é conferida aqui, no fuso do Acre, e não na tela: promoção que
-- terminou ontem não pode reaparecer como oferta porque o navegador do aluno
-- está com a data errada.

BEGIN;

DROP VIEW IF EXISTS public.v_promocao_vigente;

CREATE VIEW public.v_promocao_vigente
WITH (security_invoker = false) AS
SELECT
  m.produto_id,
  m.filial,
  m.preco_atual       AS preco_de,
  m.preco_promocional AS preco_por,
  m.data_inicio,
  m.data_fim,
  m.descricao
FROM public.marketing_promocoes m
WHERE m.ativo
  AND m.status = 'Aprovado'
  AND m.produto_id IS NOT NULL
  AND COALESCE(m.preco_promocional, 0) > 0
  AND COALESCE(m.preco_atual, 0) > COALESCE(m.preco_promocional, 0)
  AND public.acre_today() >= COALESCE(m.data_inicio, public.acre_today())
  AND public.acre_today() <= m.data_fim
  AND COALESCE(public.auth_pode_filial(m.filial), false);

COMMENT ON VIEW public.v_promocao_vigente IS
  'Ofertas aprovadas e vigentes hoje, recortadas pela unidade de quem consulta. Sem preço de custo — é a fonte do "de/por" no PDV.';

REVOKE ALL ON public.v_promocao_vigente FROM PUBLIC, anon;
GRANT SELECT ON public.v_promocao_vigente TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
