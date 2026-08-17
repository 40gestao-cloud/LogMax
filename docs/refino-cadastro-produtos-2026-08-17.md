# Refino do cadastro de produtos — 2026-08-17

Handoff para continuar em outra sessão. Escrito no fim do dia 17/08.

## Estado

**Nada foi commitado.** Todo o trabalho está no working tree, sobre `master` em
`ce6b200`. As três migrações **já foram aplicadas nas 4 turmas** e conferidas —
o código do front depende delas, então não dá para descartar o working tree sem
descartar também o que está no banco.

```
git status --short   # 20 modificados + 9 novos
```

## O que motivou

Um aluno tentou cadastrar arroz de 5 kg, 50 pacotes, e não conseguiu: o campo
Peso/Volume herdava a unidade de ESTOQUE, então lia "Peso / Volume (UN)". A
partir daí saiu uma auditoria do cadastro inteiro nas três filiais.

## Migrações aplicadas (438, 439, 440)

| # | arquivo | o que faz |
|---|---|---|
| 438 | `o_arroz_de_cinco_quilos_nao_cabia_no_cadastro` | `produtos.peso_unidade` (G/KG/ML/L) separada da unidade de estoque; `estoque_minimo` integer → numeric(15,3); `produtos_com_custo` recriada |
| 439 | `a_fracao_morria_no_caminho_da_compra` | 6 colunas de quantidade integer → numeric(15,3) na cadeia de compra; `v_pedido_saldo` sem os `::integer`; 7 RPCs recriadas |
| 440 | `a_resma_de_papel_nao_e_mercadoria` | `tipo` ganha `consumo`; dois gatilhos de trava; `get_vitrine_publica` filtra tipo |

Conferência pós-aplicação (feita, resultado igual nos 4 projetos): hash da
`produtos_com_custo` `25e7e41a…`, 6/6 colunas numeric, views com
`security_invoker`, **zero RPC com `integer` na assinatura** (nenhuma sobrecarga
nasceu dos DROP/CREATE), CHECK de tipo com os três valores, ambos os gatilhos
`tgenabled='O'`.

### Passivo deixado de propósito pela 438

57 produtos com `peso` preenchido e `peso_unidade` NULL — 4 na ERP, 36 na
Aprendiz, 8 na Contabilidade, 9 na Adm. O backfill só tocou o caso não-ambíguo
(unidade de estoque já era KG/L/G/ML). Onde a unidade é discreta o valor podia
ser grama ou quilo — os dados tinham 900 e 0,5 na mesma coluna — e adivinhar
seria inventar cadastro. A listagem mostra "900 (unidade não informada)" em
âmbar até alguém corrigir.

Query para listar por turma:

```sql
SELECT filial, codigo, nome, unidade, peso FROM produtos
 WHERE ativo AND peso IS NOT NULL AND peso_unidade IS NULL ORDER BY filial, codigo;
```

## Bibliotecas novas (`src/lib/`)

- **`tipoProduto.ts`** — `ehVendavel` / `temEstoque` / `normalizarTipo`. Régua
  dos três destinos. **Toda pergunta é afirmativa**: as checagens antigas eram
  `tipo !== 'patrimonio'`, e blacklist faz tipo novo nascer permitido.
- **`precificacao.ts`** — `calcMarkup` (sobre o custo) × `calcMargem` (sobre a
  venda). A fórmula estava duplicada em duas views, e as duas calculavam markup
  sob o rótulo "Margem".
- **`perecivel.ts`** — `ehPerecivel` / `validadeDias` / `vencimentoPrevisto`.
  Faz a ficha da migr. 360 virar data de vencimento.
- **`unidades.ts`** (estendida) — `UNIDADES_CONTEUDO`, `temConteudoDeEmbalagem`,
  `formatarConteudo`.
- **`viewUtils.ts`** (estendida) — `formatQtd` / `parseQtd` / `handleQtdKeyDown`
  / `qtdBR`. Quantidade é `type=text inputMode=decimal`: `type=number` descarta
  o valor quando a vírgula do teclado pt-BR chega.

## Testes novos (todos no projeto `estatico`, sem banco)

126 passando em 10 arquivos. Os quatro novos são `unidadesConteudo`,
`tipoProduto`, `precificacao`, `perecivel`.

Dois deles varrem o código-fonte, não só as funções:

- `tipoProduto.test.ts` falha se `tipo !== 'patrimonio'` reaparecer em qualquer
  das cinco telas de venda.
- `precificacao.test.ts` falha se alguém redefinir `calcMargem` dentro de uma
  view de novo.

## Decisões tomadas que vale conhecer antes de mexer

- **Cor de markup mantida com os cortes antigos (10/30).** Recalibrar junto com
  a correção do rótulo faria o catálogo parecer que piorou de um dia para o
  outro. A margem aparece sem cor: margem saudável depende do ramo (mercearia
  20-30%, boutique 50%+) e um corte único para as três filiais ensinaria outro
  erro.
- **`categorias_produto.margem_alvo` não foi renomeada.** O COMMENT dela no
  banco já dizia "Markup-alvo da linha"; só as telas mentiam.
- **"Quantidade Comprada" foi removida do cadastro.** Gerava uma segunda Entrada
  ('Compra inicial') que somava com o Saldo de Abertura — quem preenchia as duas
  com 50 ficava com 100 — e criava estoque sem conta a pagar nem apuração de
  custo, o oposto do fluxo que a migr. 417 tornou obrigatório. Compra entra por
  Compras → Recebimentos.
- **Gatilho em vez de reescrever a RPC.** A trava de "só mercadoria se vende"
  está em `fn_item_venda_so_mercadoria` (em `itens_venda`) e não dentro de
  `criar_venda_pdv` (10 KB): o gatilho pega caminhos que a RPC não conhece.
  `confirmar_pedido_online` **não** cria `itens_venda`, por isso existe o segundo
  gatilho, `fn_produto_publicavel`.

## Pendências — em ordem de valor

### 1. DRE do material de consumo (decisão sua, já mapeada)

**O buraco continua aberto e é o mais caro da lista.** A compra de material de
consumo desaparece do resultado: a conta a pagar tem `pedido_id`, e a migr. 425
exclui essas contas das despesas (`AND cp.pedido_id IS NULL`) porque compra de
mercadoria vira CMV na venda. Só que a resma nunca é vendida — não vira CMV, e o
dinheiro não aparece em lugar nenhum do DRE.

Duas políticas defensáveis:

- **Despesa no consumo** (recomendada) — vira despesa na liberação ao setor,
  valorizada pelo custo médio, no centro de custo de quem pediu. Aproveita
  `fn_custo_medio_da_entrada` (417), a movimentação de saída de
  `liberar_requisicao_estoque` e `centros_custo.grupo_dre` (425). Precisa de
  `centro_custo` em `requisicoes_estoque` (hoje não existe) e de um evento
  financeiro novo.
- **Despesa na compra** — a exceção `pedido_id IS NULL` passa a olhar o tipo do
  item. Uma regra só. Menos fiel: R$ 300 de papel viram despesa integral no mês
  da compra com 9 resmas na prateleira.

### 2. MaxLook: grade de variantes (estrutural)

`tamanho` + `cor` obrigatórios com índice único `(filial, codigo)` significa que
cada variante é um produto inteiro. Camiseta P/M/G × 2 cores = 6 cadastros, 6
códigos, 6 EANs, até 18 fotos. As 6 etiquetas saem idênticas (a etiqueta imprime
nome e preço, sem tamanho nem cor). Loja de roupa real usa produto pai + grade.
É o cadastro mais distante da realidade dos três.

### 3. TechMax: IMEI é por unidade, `atributos` é por produto (estrutural)

Com 5 iPhones em estoque não há onde guardar 5 IMEIs. `requer_imei` não faz nada
hoje e **não pode funcionar** como está modelado. A planilha ainda promete que
"o PDV pede o IMEI no fechamento da venda" — mentira a corrigir de qualquer
forma.

### 4. Menores

- EAN com dígito verificador inválido **salva** sem bloqueio; reaparece depois
  como etiqueta silenciosamente descartada.
- `garantia_dias` (TechMax) é texto livre e nada calcula fim de garantia na
  venda.
- `ATRIBUTOS_PRODUTO` está duplicado em `atributosProduto.ts` e em
  `modelosPlanilha.ts` — exatamente a duplicação que o cabeçalho do primeiro
  arquivo diz ter eliminado.
- `trg_produto_loja_online_guard` é BEFORE **UPDATE** apenas: um INSERT com
  `loja_online=true` não passa pela checagem de autoridade. É RBAC, adjacente ao
  que foi feito aqui, e ficou de fora de propósito.

## Duas coisas de ambiente

- **`npm run drift` não roda**: falta `SUPABASE_ACCESS_TOKEN` no `.env`. Usei o
  MCP da Supabase em read-only para todas as conferências.
- **As 5 suítes de integração falham** por falta de `.env.test`. É anterior a
  este trabalho — morrem no `tests/setup.ts`. As 10 suítes estáticas passam.
- Nenhuma tela foi exercitada logada: o dev server sobe limpo, mas a verificação
  para na tela de login.

## Teste de aula que fecha os três assuntos

1. Cadastrar "Arroz Branco 5kg" na SuperMax: conteúdo **5 KG**, unidade de
   estoque **UN**, saldo de abertura 50. Antes era impossível.
2. Cadastrar "Papel A4 75g — resma" como **Uso e Consumo**: conferir que não
   aparece no PDV nem na lista de publicação da loja, e tirar do estoque por
   Estoque → Requisições de Material.
3. Cadastrar um iogurte com **Produto perecível** + validade 5 dias, comprar e
   receber: a data de vencimento vem calculada no Recebimento, e o lote entra na
   fila de Validades com o selo de armazenagem.
