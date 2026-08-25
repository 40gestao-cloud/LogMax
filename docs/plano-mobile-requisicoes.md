# Requisições no celular — levantamento e plano

Levantamento de 2026-08-24. **Nada aqui foi implementado: é plano.**

Escopo: as duas telas do módulo Requisições — `RequisicoesSetorView` (Do Setor)
e `AprovacoesComprasView` (Aprovações), com o bloco de material
`AprovacoesEstoqueView` que vive dentro da segunda. O que aparece fora desse
escopo está na seção 5, e está lá de propósito.

## Como foi medido

- Largura de referência: **375 px** (iPhone SE / 12 mini, o piso realista da
  turma). O `<main>` tem `p-4` abaixo de `sm`, então sobram **343 px** de
  conteúdo — [App.tsx:1384](../src/App.tsx#L1384).
- Segunda largura conferida: 768 px (tablet), onde o `sm:` e o `md:` já entram
  e quase tudo se resolve sozinho.
- **Limitação declarada:** o levantamento é por leitura de código. As telas
  exigem login de turma, então não houve navegação real em aparelho. Os itens
  1, 2, 3, 5 e 8 são geométricos (largura fixa contra largura de tela) e não
  dependem de dado; os demais devem ser reconferidos no aparelho antes de
  fechar.

---

## 1. Defeitos confirmados

### 1.1 — A tabela do Do Setor tem 780 px fixos (ALTA — impede o uso)

`<table className="w-full min-w-[780px]">`, nove colunas, **nenhuma escondida
em tela pequena** — [RequisicoesSetorView.tsx:1147](../src/views/RequisicoesSetorView.tsx#L1147).

Em 343 px o aluno enxerga 44% da tabela. As três telas de Compras que usam o
mesmo padrão escondem colunas por breakpoint (`hidden sm:table-cell`,
`hidden md:`, `hidden lg:`); esta não.

**Efeito:** a lista das próprias requisições — a tela que todo setor abre — só
se lê rolando na horizontal.

### 1.2 — A ação fica na coluna que ninguém alcança (ALTA — impede o uso)

O botão **Corrigir** (e o de Histórico) mora na última coluna, ~440 px fora da
tela em 375 px. A aba "Corrigir" existe justamente para oferecer essa ação, e
ela é a única que o aluno precisa executar ali.

**Efeito:** a tela anuncia a pendência e esconde o botão que a resolve. É o
mesmo defeito que a régua de `opacity-0 group-hover` já causou em tablet e que
foi corrigido em Requisições de Compra e em Cotações no dia 24/08 — aqui a
causa é outra (largura), o sintoma é o mesmo.

### 1.3 — O painel de detalhe herda os 780 px (ALTA)

O detalhe abre como `<tr>` com `colSpan={9}` **dentro da mesma tabela**
([RequisicoesSetorView.tsx:1240](../src/views/RequisicoesSetorView.tsx#L1240)),
então o conteúdo — justificativa, saldo no pedido, régua do fluxo, bloco de
devolução — nasce com a largura da tabela, não com a da tela.

**Efeito:** mesmo depois de tocar na linha para "ver o resto", o resto continua
fora da tela.

### 1.4 — Cabeçalho do card de Aprovações sem `min-w-0` (ALTA — impede o uso)

[AprovacoesComprasView.tsx:421](../src/views/AprovacoesComprasView.tsx#L421):
`justify-between` com dois blocos; o da esquerda (ícone + número + **nome do
item** + linha de solicitante) não tem `min-w-0` nem `truncate`, e o da direita
é `shrink-0` com quatro elementos (idade, tipo, urgência, seta).

Em flexbox, texto sem `min-w-0` não encolhe abaixo do próprio conteúdo. Com um
nome longo — e nome de produto é longo por natureza ("Camisa de Linho Masculina
Foxton") — o bloco da direita é empurrado para fora do card.

**Efeito:** os badges e, pior, **a seta de expandir** saem da área visível. O
card de decisão fica sem o controle que o abre.

### 1.5 — Os badges da direita não quebram linha (MÉDIA)

Mesmo com o 1.4 resolvido, quatro elementos disputando ~200 px espremem o nome
do item a ~100 px. Em mobile eles deveriam descer para uma segunda linha.

### 1.6 — O bloco de material repete o padrão (MÉDIA)

[AprovacoesEstoqueView.tsx:416](../src/views/AprovacoesEstoqueView.tsx#L416) —
`flex items-center justify-between gap-3` com o mesmo desenho. Corrigir 1.4/1.5
sem corrigir aqui deixa a aba "Material a liberar" quebrada enquanto a aba
"Compras a aprovar" fica boa.

### 1.7 — Rolagem dentro de rolagem no catálogo de reposição (MÉDIA)

A lista de produtos do formulário é `max-h-72 overflow-y-auto`
([RequisicoesSetorView.tsx:933](../src/views/RequisicoesSetorView.tsx#L933)).
No toque, o gesto vertical dentro da caixa não rola a página, e o alvo tem 288
px de altura numa tela de 812 — ou seja, a caixa ocupa mais de um terço da tela
e prende o dedo.

**Nota:** aqui a correção não é óbvia. Tirar a `max-h` faz a lista de 40+
produtos empurrar o botão de enviar para muito longe. Ver 2.2.

### 1.8 — Os FABs cobrem a lista (MÉDIA — fora do módulo, bate nele)

Os botões flutuantes estão empilhados em `bottom-6`, **`bottom-72` (288 px)** e
**`bottom-88` (352 px)**, todos em `right-6`
([PontoFAB.tsx:63](../src/components/PontoFAB.tsx#L63),
[NovoDocumentoModal.tsx:154](../src/components/NovoDocumentoModal.tsx#L154),
[RequisicaoAvisoModal.tsx:136](../src/components/RequisicaoAvisoModal.tsx#L136)).

Numa tela de 812 px de altura, dois deles ficam no **meio da lateral direita**,
por cima da lista. O empilhamento foi desenhado para desktop, onde sobra altura.

---

## 2. As decisões que faltam

### 2.1 — Tabela responsiva: régua de colunas ou cards? (precisa da sua ordem)

**Opção A — régua de colunas escondidas.** Aplicar em `RequisicoesSetorView` o
mesmo que `RequisicoesView` (Compras) já faz: `hidden sm:table-cell` /
`md:` / `lg:` nas colunas secundárias, e a ação puxada para junto do item. Em
343 px sobram Item + Situação + ação; o resto vive no detalhe expandido, que já
mostra a ficha completa.

- A favor: uma marcação só para os dois tamanhos; é a régua que a casa já usa;
  barato.
- Contra: a linha continua sendo uma linha de tabela — o toque é em alvos
  pequenos, e o detalhe (1.3) precisa ser resolvido junto.

**Opção B — cards em mobile.** `hidden sm:block` na tabela e um bloco
`sm:hidden` de cards, no desenho que Aprovações já usa.

- A favor: leitura e toque muito melhores; resolve 1.1, 1.2 e 1.3 de uma vez.
- Contra: duas marcações para a mesma lista, que divergem no primeiro ajuste —
  o defeito que este repositório já catalogou como "régua copiada à mão".

**Recomendação: A**, com 1.3 resolvido no mesmo passo (o detalhe passa a ter
largura de tela, não de tabela). B fica como plano B, se o teste em aparelho
mostrar que a linha continua desconfortável.

### 2.2 — O catálogo de reposição (1.7)

Três saídas, em ordem de custo: (a) reduzir a `max-h` em mobile e deixar a
busca fazer o trabalho de filtrar; (b) trocar a caixa rolável por um seletor
com busca (`SelectBusca`, que já existe no projeto); (c) deixar como está e
aceitar o incômodo. Precisa de teste em aparelho para decidir — é o item mais
dependente de sensação de uso.

---

## 3. Ordem de execução proposta

| Fase | O que entra | Tamanho | Depende de |
|---|---|---|---|
| 1 ✅ | 1.4, 1.5, 1.6 — `min-w-0`, `truncate` e quebra de linha nos cards de Aprovações e de material | P | nada |
| 2 | 1.1, 1.2, 1.3 — tabela do Do Setor responsiva + detalhe com largura de tela | M | decisão 2.1 |
| 3 | 1.8 — empilhamento dos FABs compactado abaixo de `sm` | P | nada, mas mexe em 3 componentes globais |
| 4 | 1.7 — catálogo de reposição | P/M | decisão 2.2 + teste em aparelho |

A fase 1 é independente e entrega valor sozinha: é a que devolve o botão de
expandir ao gerente que decide pelo celular.

**Sem migração.** Nenhum item deste plano toca o banco.

---

## 4. Critérios de aceite

Em 375 px, com a turma logada:

1. Do Setor: dá para ler item, situação e agir **sem rolagem horizontal**.
2. Do Setor: tocar na linha abre um detalhe que cabe na largura da tela.
3. Aprovações: o nome do item mais longo do catálogo não empurra a seta de
   expandir para fora; os badges quebram linha em vez de espremer o texto.
4. Aprovações → Material a liberar: idem.
5. Nenhum FAB cobre conteúdo da lista entre 375 e 430 px de largura.
6. Em 768 px e 1280 px, nada muda em relação a hoje — a correção é aditiva por
   breakpoint.
7. `npm run lint`, `npm test` e `npm run build` limpos.

Verificação: a régua é CSS (breakpoints do Tailwind), não JavaScript. O projeto
não tem hook de media query e não precisa ganhar um — `matchMedia` só aparece
hoje em `VitrineCarousel`, para `prefers-reduced-motion`.

---

## 5. Fora de escopo (e por quê)

- **Compras → Requisições de Compra, Cotações, Pedidos.** Têm o mesmo padrão de
  tabela larga. Ficaram de fora porque o pedido foi sobre o módulo Requisições,
  e porque a decisão 2.1 deve ser provada numa tela antes de virar régua para
  seis. Se A funcionar, elas entram numa segunda leva.
- **O menu lateral e a topbar.** Já são responsivos (drawer com `lg:hidden`).
- **O banco.** Nada aqui é de RLS, RPC ou schema.

---

## 6. Riscos

- **Esconder coluna é esconder informação.** A régua só é honesta se o que sai
  da tabela estiver no detalhe expandido. Em Requisições de Compra isso já vale
  (a ficha completa entrou em 24/08); no Do Setor, o detalhe hoje mostra fluxo,
  saldo, justificativa e devolução — falta conferir se cobre tudo o que as
  colunas escondidas diriam.
- **Regressão em desktop.** Todo `hidden` novo precisa do `sm:table-cell`
  correspondente; um esquecido some com a coluna em telas grandes também.
- **FABs são globais.** Mexer no empilhamento afeta todas as telas, não só
  estas duas — a verificação tem de incluir uma tela de operação (PDV) para
  garantir que nada passou a cobrir o botão de finalizar.

## 7. Fase 1 — executada em 2026-08-24

Commit: (ver `git log`). Duas correções, não uma:

- **`AprovacoesComprasView.tsx`** (o defeito 1.4/1.5 real): o botão do
  cabeçalho do card ganhou `flex-wrap`; o bloco esquerdo (ícone + textos)
  ganhou `min-w-0`, e o nome do item e a linha de solicitante ganharam
  `truncate`. O bloco direito (badges + seta) ganhou `ml-auto` para cair numa
  segunda linha quando o primeiro quebra, em vez de espremer.
- **`AprovacoesEstoqueView.tsx`** — na releitura para implementar, o card da
  fila de material (linha ~292) **já tinha `min-w-0`**; o item 1.6 do
  levantamento original superestimou a gravidade ali (não impedia o uso, só
  deixava o card crescer em altura sem cortar o texto). O que faltava era só
  `truncate` no nome do produto e na linha de solicitante — adicionado, para
  consistência com o resto da tela e com o card de "Decisões já tomadas" logo
  abaixo, que já usava o padrão certo.

**Não verificado em aparelho** — exige login de turma. `tsc --noEmit`, `npm
test` (229 passando) e `npm run build` (produção, com PWA) limpos.

Fases 2, 3 e 4 continuam não implementadas, aguardando ordem — a fase 2 segue
precisando da decisão da seção 2.1 (régua de colunas x cards).
