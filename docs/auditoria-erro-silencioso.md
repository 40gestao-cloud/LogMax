# Auditoria de erro caro e silencioso

Instrução de trabalho para uma sessão de auditoria no LogMax. Escrita em
2026-08-17, a partir dos erros encontrados naquele dia (migrações 441–447).

Complementa `docs/plano-auditoria-veracidade.md`, que cuida de **veracidade**
(tela que promete o que o sistema não faz). Aqui o alvo é outro: o número que
sai **plausível e errado**.

## Premissa

O erro que importa não quebra tela. Testes passam, `tsc` passa, ninguém
reclama — e o resultado do mês está errado. Ele aparece semanas depois, longe
de onde foi cometido. Procure pelo silêncio, não pela exceção.

Dos cinco achados mais caros de 17/08, quatro eram silenciosos:

| achado | como se manifestava |
|---|---|
| compra de material de consumo fora do DRE | filial fechava o mês com lucro maior do que teve |
| aparelho devolvido voltava só no saldo | duas vendas depois, recibo sem IMEI |
| conta avulsa + consumo | mesmo dinheiro saindo do resultado duas vezes |
| freezer comprado por conta avulsa | mês inteiro afundava como se fosse gasto |
| lista comparada com a página, não com o catálogo | produto cadastrado duas vezes |

## As três perguntas que acham quase tudo

1. **Quem lê isso?** Campo que o cadastro grava e nada consome é mentira com
   aparência de recurso. `requer_imei` não fazia nada; `garantia_dias` não
   calculava data nenhuma.
2. **Qual é o caminho de volta?** Todo caminho de ida precisa do inverso.
   Venda baixa a unidade — devolução devolve? Liberação vira despesa — estorno
   tira? A migr. 444 tinha ida sem volta.
3. **Esse fato tem duas portas?** O mesmo dinheiro ou a mesma quantidade
   entrando por dois caminhos soma duas vezes. Saldo de abertura + recebimento;
   conta avulsa como despesa + consumo como despesa.

## Padrões concretos

- **Regra por proxy.** `WHERE pedido_id IS NULL` para dizer "é despesa"
  responde outra pergunta ("veio de compra?") em vez da verdadeira ("virou
  ativo ou virou gasto?"). Ao achar uma exclusão, verifique as **duas pontas**:
  o que saiu daqui entra em algum lugar? Se não entra em nenhum, sumiu.
- **Gatilho que cobre metade.** `BEFORE UPDATE` sem `INSERT` deixa o primeiro
  registro passar sem checagem de autoridade. Rode `pg_get_triggerdef` em todo
  guard.
- **Lista negra em vez de branca.** `tipo <> 'patrimonio'` faz o tipo novo
  nascer permitido. A pergunta é sempre afirmativa: `tipo = 'estoque_venda'`.
- **Booleano que confunde "não" com "não respondi".** Checkbox desmarcado é
  resposta ou ausência? Onde a diferença muda um fluxo — perecível decide a
  fila de validade — tem de ser pergunta obrigatória.
- **Régua copiada à mão.** Duas listas com o mesmo conteúdo divergem no
  primeiro campo novo. Procure `Record<string, string>` de rótulos, arrays de
  opções repetidos, fórmulas duplicadas. A ficha de produto já esteve em TRÊS
  arquivos ao mesmo tempo.
- **Comparação contra dado paginado.** `data` de `useFetchData` é uma página de
  50, ainda filtrada pela busca. Deduplicar ou validar contra ela ignora o
  resto do catálogo.
- **Formato validado, valor não.** Dígito verificador correto não impede EAN
  repetido — e `7890000000000` passa no dígito.
- **Tela e banco discordando.** Ou o banco exige o que a tela não pede
  (cadastro rápido criando mercadoria sem EAN), ou a tela exige o que o banco
  não cobra. Toda regra de dinheiro precisa existir no banco; a tela é
  conveniência.
- **`CREATE OR REPLACE` com corpo defasado.** Copie o `prosrc` do banco antes
  de reescrever a função — nunca do arquivo da migração antiga.

## Sondas SQL (rodar nas 4 turmas)

```sql
-- 1. saldo x unidades serializadas — esperado: zero linhas
SELECT p.filial, p.nome, p.estoque, count(*) FILTER (WHERE pu.status='Em estoque')
  FROM produtos p LEFT JOIN produto_unidades pu ON pu.produto_id = p.id AND pu.ativo
 WHERE p.ativo AND COALESCE((p.atributos->>'requer_imei')::boolean, false)
 GROUP BY 1,2,3
HAVING p.estoque <> count(*) FILTER (WHERE pu.status='Em estoque');

-- 2. dinheiro contado duas vezes: conta de pedido marcada como despesa
SELECT count(*) FROM contas_pagar
 WHERE ativo AND pedido_id IS NOT NULL AND natureza <> 'estoque';

-- 3. mercadoria sem EAN (o PDV não acha) ou EAN repetido na unidade
SELECT filial, count(*) FROM produtos
 WHERE ativo AND COALESCE(tipo,'estoque_venda') = 'estoque_venda'
   AND (ean IS NULL OR btrim(ean) = '')
 GROUP BY 1;

SELECT filial, ean, count(*) FROM produtos
 WHERE ativo AND ean IS NOT NULL AND btrim(ean) <> ''
 GROUP BY 1,2 HAVING count(*) > 1;

-- 4. RPC nova aberta para anônimo
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 5. policy que não filtra nada
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND qual = 'true';

-- 6. consumo de material sem custo apurado (entra no DRE por zero)
SELECT filial, count(*) FROM consumos_material
 WHERE ativo AND custo_unitario IS NULL GROUP BY 1;
```

## Ordem de trabalho

Siga **um fato** — uma nota de dinheiro, uma unidade física — do começo ao fim
do fluxo, nas duas direções, e pergunte em cada passo:

- ele foi contado?
- ele pode ser contado de novo por outro caminho?
- o que acontece se o passo seguinte for desfeito?

Erro caro mora nas junções entre módulos, não dentro deles. Compras → Estoque,
Estoque → DRE, Venda → Devolução, Cadastro → PDV.

## Ao achar

- **Confirme com dado real das 4 turmas antes de corrigir.** Em 17/08 a leitura
  do código dizia "não há duplicata de EAN" e o banco tinha três produtos com o
  mesmo número em duas turmas.
- **Releia a própria correção.** Uma das correções daquele dia apagaria o IMEI
  de recibos já emitidos, e isso só apareceu relendo a migração recém-escrita.
- **A regra vai onde nada escapa** — gatilho, não IF dentro de uma RPC de 10 KB.
  Precedente: migrs. 425, 440, 442, 444, 446.
- **Não conserte cadastro de aluno por adivinhação.** Quando o dado está
  ambíguo, o certo é a migração deixar o passivo visível e a turma decidir.
