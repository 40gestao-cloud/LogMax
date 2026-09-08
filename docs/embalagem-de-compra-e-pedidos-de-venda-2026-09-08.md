# Embalagem de compra e ciclo de Pedidos de Venda — 2026-09-08

Documento de passagem para a próxima sessão. Duas frentes que se encontraram no
mesmo dia: **o fardo como medida de compra** (cadastro → requisição → cotação →
recebimento) e a **análise do fluxo Orçamento → Cliente Especial → Pedidos de
Venda**. No meio, um defeito de sessão que aparecia como "Token inválido".

Tudo abaixo já está aplicado nos **4 projetos** (LogMax-ERP, Aprendiz,
Contabilidade, Adm), com hash de função conferido igual nos quatro.

---

## 1. A régua que passou a valer

O produto tem **três** medidas, e confundi-las era a origem de quase tudo:

| campo | pergunta que responde | exemplo |
|---|---|---|
| `embalagem_compra` + `embalagem_qtd` | como o **fornecedor** vende | 1 FARDO = 30 UN |
| `unidade` | como o **estoque conta** e o **caixa vende** | UN |
| `peso` + `peso_unidade` | o que vem **dentro de uma** unidade | 1 UN = 1 KG (ou 1 PCT = 6 UN) |

**O estoque nunca conta embalagem de compra.** O fardo é forma de *pedir* e de
*receber*; a conversão acontece no recebimento e daí em diante o saldo é sempre
na unidade. Decisão confirmada pelo professor nesta sessão. O porquê, e os três
únicos lugares onde a conversão ocorre, estão escritos no topo de
`src/lib/unidades.ts` — **começar a leitura por lá**.

`FD` não entra em `UNIDADES_PRODUTO` por isso. `PCT`/`CX`/`PC` só são unidade de
estoque quando a loja **vende a embalagem fechada no caixa**.

---

## 2. Migrações desta sessão

| # | assunto | o que faz |
|---|---|---|
| **589** | o fardo é medida de compra | `produtos.embalagem_compra`/`embalagem_qtd`; reposição pede em fardo e grava `qtd` em unidade com snapshot do fator; view `produtos_com_custo` recriada |
| **590** | corrigir a quantidade não mente o fardo | gatilho + CHECK mantendo `qtd = qtd_embalagens × fator`; múltiplo recalcula, não-múltiplo apaga o rótulo |
| **591** | compra eventual também vem em fardo | ramo Eventual aceita embalagem declarada pelo solicitante; `embalagem_compra_valida()` dá nome à lista fechada; serviço (SV) recusado |
| **592** | a 1ª parcela não quita o pedido | gatilho varre `contas_receber.pedido_venda_id`; fecha só com `abertos = 0 AND pagos > 0`; estorno **reabre** |
| **593** | o pacote diz quantas unidades traz | `peso_unidade` aceita `'UN'`; recusa `UN` contendo `UN` |
| **594** | a unidade não muda com saldo | recusa trocar `produtos.unidade` com saldo ≠ 0; com saldo zero passa (é correção de cadastro) |

Todas idempotentes, todas exercitadas em transação revertida antes de aplicar.

---

## 3. Commits

**Já no `origin/master`:**

- `3b64648` cadastro + requisição ganham o fardo; siglas de unidade por extenso
- `3c61ebc` cotação (preço por fardo), recebimento (conta como chegou), sugestão (arredonda para fardo fechado)
- `625022e` compra eventual declara a própria embalagem
- `6074442` **fix de sessão** — `signOut` em escopo `local`
- `b4f0baf` parcela 1 não quita; filas filtram no servidor; lista de itens para separar

**Commitados e NÃO empurrados** (3 commits):

- `55dffa7` abas por fase em Pedidos de Venda + Cliente Especial com contador e aprovação em lote
- `989b2d2` conteúdo contado (`UN`) no cadastro
- `e6e29ca` trava da unidade com saldo + a régua do fardo escrita

> ⚠️ **Primeira coisa a decidir na próxima sessão:** `git push origin master`.
> As migrações 593 e 594 **já estão nos bancos**, então o código na `master` está
> atrás do schema. Não é quebra (as telas antigas não usam os campos novos), mas
> não deixe assim por muito tempo.

---

## 4. O defeito de sessão (fora das duas frentes)

`supabase.auth.signOut()` é **global por padrão** — revoga todas as sessões do
usuário, em qualquer máquina. Três chamadas sem escopo: `useAuth.signOut` (o Sair
e o logout por inatividade de 15 min), `DesligamentoAviso`, e a autorização de
desconto do PDV (que entra com a conta do **gerente** só para conferir a senha).

O sintoma escondia a causa: o access token continua com assinatura válida, o
PostgREST segue respondendo e a tela parece funcionar — só os endpoints `/api`
recusam, porque conferem a sessão no GoTrue. Em Usuários isso aparecia como
**"Token inválido"**. Corrigido com `scope: 'local'` nos três.

Para investigar recorrência: `auth_logs` do projeto, `/logout` seguido de `/user`
com `Session not found` é a assinatura.

---

## 5. Análise de realismo — o que ficou pendente

Comparação do ciclo com um ERP real. O item 2 foi feito (migr. 594); **os outros
quatro continuam abertos**, em ordem de consequência:

### 5.1 Um pedido de compra por item *(o maior)*

Hoje: **78 pedidos, 77 contas a pagar**, cada um com **um único item**
(`pedidos.item_descricao`, `item_qtd`, singular). A cadeia é 1:1:1 — 1 requisição
= 1 item, 1 cotação = 1 requisição, 1 pedido = 1 cotação, 1 conta = 1 pedido.

Evidência de que dói: **7 pedidos ao Atacado Prime Men no mesmo dia**, somando
R$ 30.989,35 — que na vida real é *um* pedido com 7 linhas, um frete, uma
negociação, uma nota fiscal, um título.

Custo didático: o aluno de Compras nunca negocia condição por pedido, o Financeiro
paga sete títulos onde haveria um, e o three-way match (migr. 490) confere sete
notas onde chegaria uma.

Mudança estrutural grande: mexe em pedidos, recebimento, three-way match e DRE.

### 5.2 A embalagem de compra está no produto, não no fornecedor

Num ERP real o fator de conversão vive no par **item × fornecedor**: o mesmo arroz
vem em fardo de 30 no distribuidor A e caixa de 24 no B. Em
`produtos.embalagem_compra` só cabe um — e `produtos.fornecedor_id` é
explicitamente "sugestão" (migr. 488), ou seja, o campo está pendurado no lugar
que o próprio sistema diz não ser fonte da verdade.

Caminho sugerido: a **proposta da cotação** declara a embalagem do fornecedor
(cada um a sua), com a do cadastro como padrão. Espelha a migr. 526, que já fez
isso com a marca.

### 5.3 Ponto de pedido sem prazo de entrega

A sugestão usa `máx(mínimo × 2 − saldo, mínimo)` — regra de bolso, não ponto de
pedido. O real é **consumo médio × prazo de entrega + estoque de segurança**, e os
dois dados existem: movimentações de estoque e `fornecedores.prazo_entrega_dias`,
que ninguém lê.

Os números confirmam que o mínimo é chute: 21 produtos ativos na SuperMax,
**3 valores distintos** de estoque mínimo, média 45.

### 5.4 Sem pedido mínimo nem múltiplo de venda por fornecedor

Distribuidor real tem pedido mínimo (R$ ou volume) e vende em múltiplos. O
arredondamento por fardo cobre o múltiplo do produto; nada impede uma cotação de
R$ 40,00 num atacadista que só atende acima de R$ 1.500,00.

### 5.5 Simplificações aceitas — não são pendência

- **O fardo não existe no estoque.** Confirmado pelo professor: converte no
  recebimento, saldo sempre na unidade. Já está escrito em `src/lib/unidades.ts`.
- **O fardo não tem código de barras próprio** (DUN-14/GTIN-14). No recebimento
  real o conferente bipa o código do fardo. Torna o recebimento por leitor meio
  ficcional, mas o resto funciona.

---

## 6. Análise do fluxo de Pedidos de Venda — o que foi feito

Cinco problemas encontrados; **os cinco foram tratados**:

1. ✅ **Parcela 1 quitava o pedido inteiro** (migr. 592). Reproduzido no
   PV-SM-2026-0001 (3 × R$ 300,00): virava "Pago" com R$ 600,00 em aberto.
2. ✅ **As filas filtravam a página, não a fila.** O recorte foi para o servidor;
   o badge da sidebar já contava certo e os dois discordavam.
3. ✅ **Sem abas por fase.** Estoque: *A separar | Já separados | Todos*.
   Financeiro: *A receber | Recebidos | Todos*. Vendas: *Em aberto | Concluídos |
   Cancelados | Todos*. Contagem do banco por aba.
4. ✅ **Logística separava às cegas** — a coluna Itens mostrava só a contagem.
   Virou botão que abre a lista: produto, código, quantidade **com a unidade**,
   preço, subtotal, e em quantos fardos quando a conta fecha exata.
5. ✅ **Cliente Especial era fila invisível.** Ganhou contador, valor total,
   filtro por unidade, idade e unidade em cada cartão, ordem da mais antiga
   primeiro e **aprovação em lote** (reprovar segue uma a uma — exige motivo).

---

## 7. Passivo de dados — para resolver **em aula**, não por SQL

Nenhuma migração mexeu em dado da turma. De propósito: reclassificar catálogo por
SQL é decidir pela turma o que é unidade de venda.

- **5 produtos usam `PCT` para dizer "fardo de 30"** na SuperMax do ERP — Açúcar
  Cristal/Refinado 1 (kg) 30 UN, Azeite de Oliva (500 ml) 12 UN, Óleo de Soja
  (900 ml) 20 UN, Ervilha (170 g) 24 UN. **Todos com saldo zero**, então a trava
  da 594 não impede o conserto. O certo: `unidade = UN`, conteúdo `1 KG`,
  `Compra em = FARDO com 30`.
  Sonda no rodapé da migr. 594.
- **Requisições antigas com o fardo no nome** ("Òleo de Soja (900 ml) 20 UN" com
  quantidade "1 PCT"). Documento emitido não se reescreve — saem pelo fluxo.
- **28 orçamentos** parados em "Enviado ao Cliente" (R$ 65.584,25), esperando a
  decisão do professor no Cliente Especial. Agora com aprovação em lote.
- **Atum Sólido 170g (LogMax-ERP)** ficou com `CAIXA com 24` — cadastro que usei
  para testar o ciclo ponta a ponta. Valor realista; **decisão pendente**:
  manter ou limpar.

---

## 8. Pontas soltas menores

- **Verificação de tela pendente**: o resumo "Como este produto fica" (593) e a
  trava da unidade (594) foram validados por tipos, testes e banco, mas **não
  foram vistos rodando** — a sessão do preview caiu por inatividade antes.
- A mensagem de erro da RPC da 591 imprime número com ponto ("fardo com 30.5")
  em vez de vírgula. A tela barra o caso antes; só aparece para quem entra por
  fora do formulário.
- `Aprovações de Cotação` (Financeiro) e o dropdown de requisição na cotação
  ainda mostram só a quantidade em unidade, sem o "3 CAIXAS" ao lado.

---

## 9. Onde olhar no código

- `src/lib/unidades.ts` — **a régua**. Começar por aqui.
- `src/components/QuantidadeEmbalagem.tsx` — campo com a chave UN|FARDO e a conta
  à vista; `qtdEmEstoque()` é a única conversão do front.
- `src/views/ProdutosView.tsx` — cadastro: unidade, conteúdo, *Compra em*, resumo
  "Como este produto fica", trava da unidade.
- `src/views/RequisicoesSetorView.tsx` — reposição (fator do cadastro) e eventual
  (fator declarado).
- `src/views/CotacoesView.tsx` — preço por fardo → unitário derivado.
- `src/views/RecebimentosView.tsx` — conta como a carga chegou.
- `src/views/SugestoesComprasView.tsx` — arredonda para fardo fechado; passou a
  criar **Reposição com `produto_id`** (era Eventual em texto livre).
- `src/views/PedidosVendaView.tsx` — abas, filtro no servidor, lista de itens.
- `src/views/ClienteEspecialView.tsx` — fila da Matriz com contador e lote.
- `tests/embalagemCompra.test.ts` — 19 casos, incluindo a invariante do estoque.
