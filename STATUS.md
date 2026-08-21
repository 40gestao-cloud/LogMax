# LogMax — Status do Projeto (2026-08-21)

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
| Views implementadas | ✅ 113 arquivos em `src/views/` — nenhum Placeholder restante |
| Migrações | 504 arquivos em `supabase/migrations/` |
| Testes | 196 passando, 20 pulados (21 arquivos) |
| PWA | ✅ `vite-plugin-pwa`, manifest + service worker |
| Checador de drift | ✅ `npm run drift` (precisa de `SUPABASE_ACCESS_TOKEN` no `.env`) |

**Turmas (project refs Supabase):** LogMax-ERP `jvqsaccupxkvezriiede` ·
logmax-aprendiz `ythesivrqzxhjueuwswq` · logmax-contabilidade
`yinwjvadtbjgiksdadbt` · LogMax-Adm `pvzfaejminpxkuuhilhz`.

---

## Hoje — 2026-08-21

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
| Verificação visual das telas novas | O trabalho de hoje foi verificado por `tsc`, testes e build — não por navegação real, que exige login de turma. Vale um passe manual no fluxo completo de compra eventual. |
| Trava de feature nova | Vigente até **2026-09-13**, junto com a revisão do Plano de Refino. |

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
