-- 618 — O resumo da tela de Recebimento não precisa da lista toda
--
-- O QUE ESTAVA ACONTECENDO
--
-- A `RecebimentosView` lia `recebimentos` DUAS vezes por atualização: a página
-- (50 linhas) e, logo atrás, a tabela inteira sem paginação — esta última só
-- para três números:
--
--   · quantos recebimentos estão 'Pendente' (a faixa `FilaDeTrabalho`);
--   · o maior número de NF já usado na unidade (o botão "Gerar");
--   · quais pedidos já têm carga lançada esperando confirmação (a opção cinza
--     da lista de pedidos, que explica por que o pedido sumiu).
--
-- Nenhum dos três precisa das linhas. E como a tela tem realtime, cada escrita
-- de qualquer aluno da sala fazia TODA máquina refazer as duas leituras.
--
-- Medido no dia 22/09 na logmax-contabilidade, aula da tarde, 15 minutos de
-- recebimento em massa — o par aparece cravado no log do gateway:
--
--   ?select=*&order=created_at.desc&ativo=eq.true&filial=eq.TechMax                333 chamadas
--   ?select=*&order=created_at.desc&ativo=eq.true&filial=eq.TechMax&offset=0&limit=50   330 chamadas
--
-- 638 leituras de `recebimentos` para 93 escritas. Às 19:03:20 UTC a chegada
-- passou de ~90 requisições por 10 s para 234, o pool de 10 conexões do
-- PostgREST encheu (`PGRST003 — Timed out acquiring connection from connection
-- pool`) e a turma inteira ficou oito minutos com a tela pendurada, login
-- incluído. A fila do pool é o que a sala vê como "só carregando": a
-- requisição não erra, ela espera.
--
-- Esta função devolve os três números numa consulta agregada. A lista de 50
-- continua sendo lida como antes — o que sai é a segunda leitura, a que
-- crescia com o tamanho da tabela.
--
-- ─── SECURITY INVOKER, PELO MESMO MOTIVO DA 602 ─────────────────────────────
--
-- Roda com a RLS de quem chamou. O número tem de ser o que a pessoa consegue
-- abrir na tela; SECURITY DEFINER aqui contaria a holding e o contador viraria
-- mentira (e vazamento: "há 14 coisas que você não pode ver").
--
-- ─── POR QUE `max_nf` É NUMÉRICO E NÃO A LISTA ──────────────────────────────
--
-- O `proximoNumeroNf` (src/lib/notaFiscal.ts) só usa o maior: ele varre os
-- números, tira os dígitos, pega o máximo e soma 1. Trazer a lista inteira
-- para calcular um máximo no navegador era o desperdício. `regexp_replace`
-- com `\D` reproduz exatamente o mesmo descarte de caracteres não-dígito, e
-- `NULLIF(...,'')` protege a NF que é só texto (vazia depois do descarte).
--
-- ─── UMA MUDANÇA DE COMPORTAMENTO, DE PROPÓSITO ─────────────────────────────
--
-- O máximo agora sai da unidade inteira, ativos E inativos. Antes não: a lista
-- vinha do `useFetchData`, que filtra `ativo = true` por padrão, então nota
-- inativada devolvia o número dela para o balcão e o "Gerar" o sugeria outra
-- vez.
--
-- O índice `uq_recebimento_nf_por_filial` é PARCIAL (`WHERE ativo AND ...`),
-- então o banco aceitaria a repetição — não é dele que vem o motivo. O motivo
-- é a regra que o `src/lib/notaFiscal.ts` já declara no cabeçalho: numeração de
-- nota não repete. Número emitido está gasto, mesmo que o documento tenha sido
-- cancelado depois; buraco na sequência por documento cancelado é o que
-- acontece em empresa de verdade, número repetido não é. Dois recebimentos
-- exibindo a mesma NF, um ativo e um cancelado, é a aula errada.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.resumo_recebimentos(p_filial text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    -- A faixa de "o que está esperando alguém".
    'aguardando_confirmacao', (
      SELECT count(*) FROM recebimentos
       WHERE ativo AND status = 'Pendente'
         AND (p_filial IS NULL OR filial = p_filial)),

    -- Maior número de NF já gasto na unidade, como inteiro. 0 quando não há
    -- nenhum — o front soma 1 e começa em 000001, igual ao reduce que havia lá.
    'max_nf', (
      SELECT coalesce(max(
               nullif(regexp_replace(coalesce(nf_numero, ''), '\D', '', 'g'), '')::bigint
             ), 0)
        FROM recebimentos
       WHERE (p_filial IS NULL OR filial = p_filial)),

    -- Pedidos com carga já lançada e ainda por confirmar. Vira a explicação da
    -- opção cinza: "carga já lançada — falta confirmar abaixo".
    'pedidos_a_confirmar', (
      SELECT coalesce(jsonb_agg(DISTINCT pedido_id), '[]'::jsonb)
        FROM recebimentos
       WHERE ativo AND status = 'Pendente' AND pedido_id IS NOT NULL
         AND (p_filial IS NULL OR filial = p_filial))
  );
$fn$;

COMMENT ON FUNCTION public.resumo_recebimentos(text) IS
  'Os três números do topo da tela de Recebimento (pendentes, maior NF, pedidos '
  'a confirmar) numa consulta agregada, no lugar de reler a tabela inteira a '
  'cada evento de realtime. SECURITY INVOKER: o número é o que a RLS de quem '
  'chamou deixa ver. Consumida por src/views/RecebimentosView.tsx.';

-- RPC nova nasce alcançável pelo `anon` por causa do grant de schema; fecha na mão.
REVOKE ALL     ON FUNCTION public.resumo_recebimentos(text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.resumo_recebimentos(text) TO authenticated;

-- PostgREST só enxerga a função depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';

RESET lock_timeout;
