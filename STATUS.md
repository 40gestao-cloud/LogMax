# LogMax — Status do Projeto (2026-08-24)

> O snapshot anterior deste arquivo era de **2026-05-13** e tinha envelhecido a
> ponto de enganar: dizia "configurar Supabase" e "deploy Netlify" como
> pendências, "RLS opcional", e listava 9 views como Placeholder. Nada disso é
> verdade há meses. Foi reescrito, não apenas acrescentado.
>
> Para o estado do schema, a fonte da verdade continua sendo
> `supabase/migrations/` + `git log` — não este arquivo.

## Onde o projeto está

| Área | Estado |
|---|---|
| Deploy | ✅ Vercel, automático no push para `master` |
| Supabase | ✅ 4 projetos em produção (uma turma cada) |
| RLS + RBAC por setor/filial | ✅ Em produção, auditado (migr. 190-197, 257-261, 430, 495-497) |
| Views implementadas | ✅ 114 arquivos em `src/views/` — nenhum Placeholder restante |
| Migrações | 529 arquivos em `supabase/migrations/` |
| Testes | 229 passando, 20 pulados (21 arquivos) |
| PWA | ✅ `vite-plugin-pwa`, manifest + service worker |
| Checador de drift | ✅ `npm run drift` (precisa de `SUPABASE_ACCESS_TOKEN` no `.env`) |

**Turmas (project refs Supabase):** LogMax-ERP `jvqsaccupxkvezriiede` ·
logmax-aprendiz `ythesivrqzxhjueuwswq` · logmax-contabilidade
`yinwjvadtbjgiksdadbt` · LogMax-Adm `pvzfaejminpxkuuhilhz`.

---

## Hoje — 2026-08-24

Onze commits, migrações **523 a 528**, todas aplicadas nas 4 turmas. O dia foi
de relatos de sala: cada item abaixo nasceu de alguém esbarrando na tela.

> As migrações **504 a 522** (22 a 24/08) não estão detalhadas neste arquivo —
> para elas, `git log` e o cabeçalho de cada `.sql` são a fonte.

### Leitura das telas de compras (sem migração)

- **Requisições de Compra** — a linha expandida virou a **ficha completa** do
  documento: nome do item inteiro (a linha da tabela trunca, e precisa
  truncar), badge de tipo/serviço, código e ficha técnica do produto,
  quantidade, urgência, status, centro de custo, solicitante, setor, unidade,
  datas, saldo no pedido e justificativa.
- **Cotações** — os botões rotulados (Aprovar/Reprovar/Devolver/Corrigir/Gerar
  Pedido) empurravam as oito colunas da esquerda e quebravam o texto. Abaixo de
  `2xl` viram ícone com `title`; as colunas espremidas ganharam largura mínima.
  Saiu também o `opacity-0`, que escondia os botões em tablet.
- **Aprovações** — a aba "Compra" nomeava o assunto, não a pendência: numa tela
  de aprovações toda linha é uma requisição. Virou **"Compras a aprovar"**, e
  "Material do estoque" virou **"Material a liberar"**.

### O código do produto voltou a seguir a ordem (migr. 523)

A MaxLook tinha 20 produtos ativos e o numerador em **132** (70, 74, 76, 83,
084, 085, 121…). A migr. 518 já tinha corrigido isso — **na assinatura errada**:
fez `CREATE OR REPLACE` em `reservar_codigo_produto(text)`, de um argumento, que
a 498 havia dropado. Ressuscitou uma sobrecarga morta com a lógica nova e deixou
a de **dois** argumentos — a que a tela chama — com o `GREATEST(max(...))` da
481. A 523 põe a busca do primeiro livre a partir de 001 na assinatura certa,
aplica a mesma correção em `gerar_grade_variantes` (o segundo numerador da
filial) e dropa a sobrecarga. "Ocupado" passou a incluir produto **inativo** (o
índice único é parcial) e a tratar "70"/"070" como o mesmo número.

**Resultado em produção, no mesmo dia:** MaxLook com **001…020 em sequência
contínua**.

- **Código gerado e não salvo volta para a fila.** `closeForm` já devolvia no
  Cancelar e no Salvar; escapava o abandono sem clique (trocar de módulo, fechar
  a aba, recarregar a PWA) — e o heartbeat de 10 min fazia uma aba esquecida
  segurar o número indefinidamente. Agora o cleanup do efeito devolve na saída
  da tela e o `pagehide` devolve no fechar, com `fetch` keepalive.

### Foto de capa obrigatória

`imagens[0]` — a **capa**, não "uma das três": preencher só um slot extra
deixaria `imagem_url` nulo e as listas seguiriam com o ícone padrão. Vale na
criação **e na edição**, decisão confirmada: o import de planilha é o único
caminho que ainda cria produto sem imagem, e a regra funciona como empurrão para
completar o cadastro. Passivo medido: 1 produto ativo sem capa nos 4 projetos,
contra 168 com foto.

### A lixeira passou a dizer o que a segura (migr. 524, 525)

Um produto não saía da lixeira e a mensagem dizia "histórico em `requisicoes`
(1)" — nome de tabela e uma contagem. Quem lê vai procurar e não acha: o
documento aparece na tela com outro texto, e o vínculo é uma coluna de id.

- **524** — `lixeira_vinculos` devolve o **rótulo** de até 3 linhas presas
  (número do documento, senão nome/item, com o status). A mensagem virou
  `requisicoes (1): REQ-ML-2026-0117 (Aprovado)`.
- **525** — o admin então **excluiu** o documento e a lixeira recusou de novo,
  com o mesmo texto. Não era bug: excluir é soft-delete, a linha continua no
  banco apontando para o cadastro — e a trava tem de continuar, porque a FK não
  tem `ON DELETE` e o expurgo morreria num erro cru. Agora, quando todos os que
  travam já foram excluídos, a mensagem diz isso e aponta as duas saídas.

### A marca da compra eventual nasce na proposta (migr. 526)

`produtos.marca` era texto livre digitado no cadastro, dias depois da compra e
de memória — 40 produtos ativos, 39 marcas distintas, **38** depois de
normalizar caixa e espaço.

Na compra **eventual** o produto ainda não existe: a marca aparece pela primeira
vez na proposta (o fornecedor A oferece Foxton, o B oferece Hering), e ali ela
não é cópia de nada. `cotacoes.marca` passa a existir e entra na **comparação de
propostas** — que antes punha lado a lado fornecedor, valor, prazo e validade
sem dizer *o que* estava sendo comprado, e a mais barata ganhava sem ninguém ver
que era outro produto. Na **reposição** a régua é oposta: a marca é do produto,
e o gatilho `trg_cotacao_marca_so_na_eventual` zera o campo — a trava é do
banco, porque a cotação nasce por INSERT direto, não por RPC. No cadastro, a
origem traz a marca da cotação **aprovada**, como sugestão editável.

### O gerente ganhou as ferramentas da unidade dele (migr. 527, 528)

- **527 — Pendências.** Era `role='admin'` literal. Mas "o que está parado na
  minha filial e com quem?" é o trabalho do gerente todo dia. A parte que não
  era só afrouxar o papel: `p_filial` sempre foi **filtro**, não guarda — com
  `p_filial: null` no F12 o gerente da MaxLook leria a lista, e os nomes, das
  outras duas. Agora quem manda é `v_escopo`, decidido no servidor. E, para o
  professor, a tela passou a existir **só em Matriz**: ela atravessa as três
  unidades, e oferecê-la dentro de uma filial contradiz o contexto escolhido.
- **528 — Documentos.** Deixou de ser mão única da Matriz: o gerente publica
  para a equipe da unidade dele, com dois limites — `filial_alvo` tem de ser a
  unidade dele (`NULL` = "todas" continua da Matriz) e só mexe no que ele mesmo
  criou. Três pontas precisavam da mesma régua: o **bucket** (sem policy de
  insert o modal morre no upload), o **rascunho** (a 513 só o mostrava ao admin
  — o gerente salvaria e ele sumiria da própria tela) e a RPC
  `publicar_documento`.

### Auditoria das mudanças do dia

Antes do push, uma varredura com **JWT falso** por papel (service_role passa
batido pelos guards). Três furos achados e corrigidos:

1. O gerente seria cobrado de confirmar a leitura do **próprio** documento —
   `ehDestinatario` olhava só o papel, e ele virou autor *e* destinatário. A
   fila de não lidos passou a excluir por autoria.
2. CEO e conselheiro chegavam em Pendências **por fora do menu**
   (sessionStorage, card da Início, botão Voltar) e liam um 42501.
3. O campo de marca piscava em cotação de **reposição** enquanto a lista de
   requisições não tinha chegado.

Conferido: gerente recusado em `filial_alvo` NULL, em outra unidade e em autoria
alheia, aceito na própria; colaborador não vê rascunho alheio, não publica e não
abre pendências; admin segue publicando para todas e lendo as três unidades.

---

## 2026-08-21

Dez commits, migrações **494 a 503**, todas aplicadas nas 4 turmas.

### Compras e serviço (migr. 494, 499, 500)

- **494** — a compra eventual mandava cadastrar o produto e não deixava
  vincular.
- **499** — **serviço virou categoria de item do pedido**, o item D do SAP
  contra o item M de material. `pedidos.servico_id` e `requisicoes.servico_id`
  com CHECK excludente contra `produto_id`. As consequências vêm junto: serviço
  não tem saldo (trigger recusa movimentação), o recebimento dele é **aceite**
  (a folha de medição), e o custo é despesa do período, nunca CMV. A tela
  inteira foi feita junto: Cotações pergunta a categoria no Gerar Pedido,
  Recebimentos vira aceite, Pedidos fala "Em Execução".
- **500** — dois furos da própria 499, achados conferindo o banco depois de
  aplicá-la: `fn_conta_pagar_natureza` carimbava `'estoque'` em toda conta com
  `pedido_id` (o DRE contava como despesa e o rótulo dizia estoque — duas telas
  discordando do mesmo lançamento), e `centro_custo_id` nunca era preenchido,
  então todo serviço cairia em "Não classificado".

### Segurança (migr. 495, 496, 497)

Guard de filial que **sumia em vez de barrar** quando o perfil não tinha filial:
`IF NOT auth_pode_filial(...)` com retorno NULL não entra no bloco. Corrigido
em 19 funções na 496, e a 497 fechou o ponto cego da própria varredura.

### Cadastro de produto e recebimento (migr. 498, 501, 502, 503)

- **498** — material da unidade vizinha e o código que vencia na mão do aluno.
- **Cadastro avulso de mercadoria deixou de ser opção.** `origemExigida` passou
  a valer sempre para mercadoria de revenda, não só quando havia lista. "Não
  veio de compra" virou **"Saldo de implantação"** e só aparece enquanto a
  unidade nunca teve recebimento Concluído/Parcial. Quando não há nada a
  escolher, a tela aponta o caminho (abrir a requisição) em vez de oferecer um
  select vazio, e o Salvar fica travado.
- **Trilha da fila no topo do formulário** — `Requisição → Aprovação → Cotação →
  Aprovação → Cadastro (você está aqui) → Gerar Pedido → Em Entrega →
  Recebimento → Confirmar`. É o antídoto para a leitura circular ("preciso do
  produto para confirmar, e o produto depende do recebimento") que já apareceu
  em sala.
- **`SelectBusca`** (`src/components/SelectBusca.tsx`, novo) — primeiro combobox
  com busca do projeto. O select de origem chegou a mostrar 46 requisições num
  `<select>` nativo. Grupos alfabéticos, e a prioridade "cotada primeiro" virou
  rótulo de grupo em vez de posição.
- **Nome do produto travado** quando vem da origem, com botão "Refinar nome". O
  texto da requisição é a *necessidade* ("Sardinha em Óleo 125g"); o nome do
  catálogo é a *identificação* ("SARDINHA EM ÓLEO GOMES DA COSTA 125G") — e é o
  segundo que sai na etiqueta e no PDV.
- **501** — número de NF com botão **Gerar** nos três formulários que o digitam,
  **sequencial** por filial (`src/lib/notaFiscal.ts`, 6 testes), nunca sorteado.
  Série **não** ganhou gerador de propósito (é constante `1`, não sorteio) e
  passou a vir preenchida. Índice único parcial contra colisão. A mesma migração
  trancou o **saldo de abertura na janela de implantação**, com trigger, porque
  a tela não impede o F12.
- **502/503** — **a direção devolve a movimentação para quem errou corrigir.**
  Mesma ideia da cotação devolvida (migr. 467): quem decide não corrige o
  trabalho do outro, devolve com motivo. A RPC desfaz a movimentação (o saldo
  estorna) e marca o produto como "precisa de correção" na mesma transação. Selo
  na grade, banner com o motivo no formulário. Encerram a pendência: quem fez a
  movimentação, o gerente da unidade ou a direção — o colega de setor não.
  A **503** é o rabo da 502: Cadastros > Produtos lê a view `produtos_com_custo`,
  não a tabela, e view não herda coluna nova — o selo viria `undefined` em toda
  linha, sem erro no console.

### Correção de saldo pela direção (sem migração)

Conferindo o que estava travado na edição de produto, quase nada estava — nome,
código, categoria, EAN, preço, custo, unidade, marca, tipo, ficha, fornecedor,
imagem e estoque mínimo já eram editáveis. **O único campo travado era o
saldo**, e continua sendo: `produtos.estoque` tem de ser igual à soma das
movimentações ativas (a "razão única" da migr. 268).

A direção ganhou a ergonomia sem quebrar a invariante: digita o **saldo certo** e
o sistema grava a **diferença** como `Ajuste +` / `Ajuste −` com motivo.
Restrito a `role = 'admin'` **literal**, jamais `auth_is_admin()` — esse helper
inclui CEO e conselheiro, que são alunos.

### Limpeza de dados — saldo de implantação duplicado

Alunos lançaram produtos com Saldo Inicial de Implantação e depois receberam o
mesmo item pelo fluxo de compra, dobrando o estoque. **48 lançamentos
estornados** (41 na aprendiz, 7 na LogMax-ERP); contabilidade e Adm não tinham
nenhum. Cadastros preservados — o estorno é soft delete da movimentação, o
gatilho devolve a quantidade.

Conferência final nas 4 turmas: **0 lançamentos de implantação ativos, 0
divergências entre saldo e razão, 0 saldos negativos**.

Um caso exigiu ordem: o "Carregador Mi Power Bank" (TechMax/LogMax-ERP) tinha 1
unidade já vendida, e o estorno deixaria −1 — o gatilho recusa, e uma execução
em bloco abortaria a transação inteira. Foi separado, a venda cancelada
primeiro, e só então estornado.

---

## Em aberto

| Item | Observação |
|---|---|
| Janela de implantação ainda aberta | MaxLook e TechMax da turma **aprendiz** não têm nenhum recebimento, então continuam legitimamente em implantação — a opção de saldo inicial ainda aparece lá. Fecha sozinha no primeiro recebimento confirmado. |
| `SUPABASE_ACCESS_TOKEN` ausente no `.env` local | `npm run drift` não roda. A convergência das 4 turmas vem sendo conferida por MD5 via MCP. |
| Verificação visual das telas novas | O trabalho de 21/08 e o de 24/08 foram verificados por `tsc`, testes, build e sondas SQL com JWT falso — não por navegação real, que exige login de turma. Vale um passe manual no fluxo de compra eventual e nas telas novas do gerente. |
| Trava de feature nova | Vigente até **2026-09-13**. Exceções autorizadas em 24/08: marca na cotação eventual (526) e as duas telas do gerente (527/528). |
| Marca ainda é texto livre | A 526 resolveu *quando* a marca é decidida, não o formato. Acabar com o texto livre pede tabela `marcas` + `marca_id` — custo medido: 16 funções do banco, 1 view e ~34 arquivos do front que leem `marca`. Não iniciado. |
| Pendências fica visível ao gerente no Modo Aula | `'pendencias'` está em `SEMPRE_LIBERADO` (`aulaModulos.ts`), regra herdada de quando a tela era só do professor. Com o gerente incluído (527), vale decidir se o Modo Aula deve escondê-la dele. |

---

## Como trabalhar aqui

- **Deploy é automático** no push para `master`. Não rodar `vercel --prod`.
- **Antes de escrever migração** que dependa de estrutura existente, conferir
  `supabase/migrations/` (o assunto pode já ter migração) e rodar `npm run drift`.
- **Depois de aplicar**, propagar para as 4 turmas e conferir convergência
  (MD5 de `pg_get_functiondef` / `pg_get_viewdef`), e disparar
  `NOTIFY pgrst, 'reload schema'`.
- **`role = 'admin'` literal** para poder de professor. `auth_is_admin()` inclui
  CEO e conselheiro, que são alunos.
- **Guard com expressão que pode devolver NULL** precisa de `COALESCE(..., false)`
  — `IF NOT NULL` não barra ninguém.
- **Coluna nova em tabela lida por view** não aparece na view. Ao recriar:
  colunas novas no fim e `security_invoker = true` dentro do `CREATE`.

---

## Scripts

```bash
npm run dev     # Vite
npm run lint    # tsc --noEmit
npm test        # vitest
npm run build   # build de produção + PWA
npm run drift   # compara o schema das 4 turmas (precisa do PAT no .env)
```
