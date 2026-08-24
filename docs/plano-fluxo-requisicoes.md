# Fluxo de Requisições e Aprovações — auditoria e plano

Levantamento de 2026-08-24, depois das migrações 517–520 e da consolidação da
tela de Aprovações. Nada aqui foi implementado: é plano.

Escopo auditado: `requisicoes`, `aprovacoes_compras`, `requisicoes_estoque`,
`aprovacoes_estoque`, as RPCs dos dois fluxos, e as telas
`RequisicoesSetorView`, `AprovacoesComprasView`, `AprovacoesEstoqueView`,
`RequisicoesView`.

---

## 1. Defeitos confirmados

### 1.1 — Reabrir uma devolvida vira "corrigida e reenviada" (ALTA, regressão de hoje)

`trg_requisicao_marca_reenvio` (migr. 520) carimba `reenviada_em` em **qualquer**
transição `Em correção → Pendente`. `reabrir_requisicao` faz exatamente essa
transição — e é ato da direção, não do solicitante.

Verificado em transação revertida na LogMax-ERP: reabrir uma requisição
`Em correção` grava `reenviada_em = now()`.

Efeito: o gerente recebe o modal "Requisição corrigida e reenviada", vai
decidir, e o documento continua com o texto errado que ele mandou corrigir —
ninguém corrigiu nada.

**Correção:** tirar a marcação do gatilho e pôr onde ela é verdade.
`reenviar_requisicao_corrigida` grava `reenviada_em = now()`;
`reabrir_requisicao` grava `NULL`. O gatilho fica só com o lado que limpa
(devolver de novo).

### 1.2 — Decidir por baixo de quem está corrigindo (MÉDIA-ALTA)

`decidir_requisicao_compra` valida `v_ap.status = 'Pendente'` mas **nunca olha
`v_req.status`**. A aprovação continua `Pendente` enquanto a requisição está
`Em correção`, então aprovar/negar uma requisição que está com o aluno é aceito
pelo banco.

`devolver_requisicao_para_correcao` tem a guarda equivalente
(`IF v_req.status = 'Em correção' THEN RAISE`); a decisão não tem.

Hoje a tela esconde os botões, o que torna isso invisível — e frágil: qualquer
outra porta (Matriz, tela futura, correção manual) fura. Se furar, o reenvio
seguinte falha com "só requisição devolvida pode ser reenviada" e o texto
corrigido do aluno morre no formulário.

**Correção:** guarda simétrica na RPC, com a mensagem dizendo o que fazer
("está com *fulano* para correção; espere o reenvio ou reabra").

### 1.3 — A decisão não avisa ninguém (MÉDIA)

Contagem de notificações na LogMax-ERP:

| Documento | Avisa ao decidir? |
|---|---|
| Cotação | sim — "aprovada pelo Financeiro" (34), "reprovada" (3), "devolvida" (6) |
| Requisição | **não** — só devolução (8) e reenvio (7), que a 518 acrescentou |

Quem abriu a requisição descobre que foi aprovada ou negada abrindo a tela e
reparando na mudança de cor. A cascata do Negado (cotações canceladas) também
não avisa Compras.

**Correção:** `notificar_setor` no fim de `decidir_requisicao_compra`, para o
setor do solicitante, com o tipo certo (`aprovado`/`reprovado`) e a observação
do gerente no corpo. Se houve cascata, um segundo aviso para `compras`.

### 1.4 — Aprovação órfã de material (MÉDIA, latente)

A migr. 519 fez o soft-delete de `requisicoes` levar `aprovacoes_compras` junto.
`requisicoes_estoque` tem o mesmo desenho — está em `TABLES_WITH_ATIVO`, a FK é
`ON DELETE CASCADE` (só vale no hard delete) e a tela tem botão `ExcluirAdmin`
apontando para `/api/requisicoesestoqueview`.

Hoje há 0 órfãs porque ninguém usou o botão ainda. O primeiro uso reproduz
exatamente o defeito de ontem: card que volta depois de "excluído".

**Correção:** mesmo gatilho da 519 para `requisicoes_estoque`.

### 1.5 — Card fantasma com botões que vão falhar (MÉDIA)

`AprovacoesEstoqueView` monta a lista sem descartar aprovação sem requisição:

```ts
const enriched = aprovacoes.map(ap => {
  const req = requisicoes.find(r => r.id === ap.requisicao_estoque_id);
  return { ...ap, req, prod: req ? produtos.find(...) : undefined };
});
```

Sem `req`, o card aparece como "Produto não encontrado", com Aprovar e Negar
ativos — e a RPC recusa. A tela de compras já resolveu isso (filtra, busca a
linha por id e mostra o aviso amarelo de órfãs).

**Correção:** trazer para o material o mesmo tratamento — descartar da fila,
contar, e avisar em vez de oferecer um botão que erra.

### 1.6 — O professor recebe o modal da turma inteira (MÉDIA, ruído)

`useRequisicoesAviso` põe na fila de "reenviada" quem decide — o que inclui
`role='admin'`. Em modo Matriz (`filialAtiva = null`) não há recorte de unidade,
então cada correção reenviada por qualquer aluno das três filiais abre modal
para o professor.

O modal existe para chamar atenção de quem tem de agir. O professor não é a fila
de decisão; ele é quem destrava quando ninguém decide.

**Correção:** a fila de "reenviada" é do gerente da unidade. Matriz só entra
quando está operando dentro de uma unidade (`filialAtiva != null`). O sino
continua avisando os dois.

---

## 2. Lacunas de fluxo

### 2.1 — Material não tem "devolver para correção"

Compra tem três saídas (Aprovar / Negar / Devolver, migr. 517). Material tem
duas. O gerente que vê "500 canetas" na requisição de material só pode negar —
decisão de mérito — quando o problema é a quantidade digitada errada.

O aluno então abre outra requisição, e volta a duplicata que a 517/518
existem para eliminar. É a mesma lição, e ela está ensinada pela metade.

**Proposta:** `devolver_requisicao_estoque_para_correcao`, espelhando a 517:
status `Em correção`, `correcao_motivo`, e a aba "Para corrigir" de Do Setor já
existente passando a aceitar o documento de material.

### 2.2 — O reenvio não reconfere duplicata

`confirmarDuplicatas` roda na abertura. No reenvio não roda: entre a devolução
e a correção, um colega pode ter aberto documento para o mesmo item — que é
precisamente o cenário que a devolução provoca.

O aviso existe do lado do gerente (`irmasVivas` em Aprovações). Falta do lado de
quem corrige, que é onde dá para desistir a tempo.

**Proposta:** chamar a mesma régua antes do reenvio.

### 2.3 — `Em correção` é mudo em Compras → Requisições

A linha aparece com a etiqueta e sem nenhuma ação — sem botão de corrigir (certo)
e sem dizer por quê. Compras fica sem saber se espera ou age.

**Proposta:** uma linha de contexto ("devolvida a *fulano* em dd/mm — esperando
correção") e o motivo no detalhe.

---

## 3. Organização e vocabulário

### 3.1 — Quatro portas para "requisição", em três módulos

| Menu | Tela | O que é |
|---|---|---|
| Requisições → Do Setor | `RequisicoesSetorView` | abrir e corrigir (compra **e** material) |
| Requisições → Aprovações | `AprovacoesComprasView` | decidir (compra **e** material) |
| Compras → Requisições de Compra | `RequisicoesView` | fila de trabalho de Compras |
| Estoque → Liberar Requisições | `AprovacoesEstoqueView` | mesma fila da aba "Material" |
| Estoque → Requisições de Material | `RequisicoesEstoqueView` | conferir/corrigir material |

Depois da consolidação de hoje, **Liberar Requisições** virou porta dupla da aba
"Material do estoque". Duas portas para a mesma fila não é erro, mas precisa ser
dito — senão a turma pergunta qual é a certa.

**Proposta:** manter as duas (a de Estoque é a do almoxarife, a de Requisições é
a do gerente) e escrever isso no subtítulo de cada uma, nomeando a outra.

### 3.2 — Vocabulário de status

`requisicoes` usa `Pendente / Aprovado / Negado / Em correção / Atendida`.
`Atendida` é feminino no meio de uma régua masculina ([[project_status_unification]]),
e a tela de material chama `Aprovado` de "Liberado" na lista de decisões.

Não é bug — é ruído de aula, onde o nome do status é conteúdo.

**Proposta:** decidir a régua e aplicar em um lugar só (`Atendido`; e "Liberado"
só como verbo do botão, nunca como nome de status).

### 3.3 — Quanto tempo o documento está parado

Nenhuma das filas mostra idade. Uma devolvida esquecida há três dias parece
igual à devolvida de agora, e é justamente a esquecida que trava a compra.

**Proposta:** "parada há N dias" no card, âmbar depois de 2 dias, nas três filas
(decidir, devolvidas, material).

---

## 4. Visual e experiência de uso

### 4.1 — Âmbar, sky e laranja somem no modo claro (ALTA, e é pré-existente)

`src/index.css` remapeia as classes de cor do Tailwind para o tema claro
(linhas ~578-597): purple, yellow, blue, green, emerald, cyan, rose, pink, red e
orange (300/400). **Não há mapa para `amber`, para `sky`, nem para as variantes
100/200** — e é justamente onde vive a linguagem nova deste fluxo.

Contraste sobre o cartão claro (`--color-card-bg: #FFFFFF`):

| Classe | Cor | Contraste sobre branco | Onde |
|---|---|---|---|
| `text-amber-400` | `#fbbf24` | 1,7:1 | botão **Devolver p/ correção** |
| `text-amber-300` | `#fcd34d` | 1,4:1 | bloco "Devolvida — está com o solicitante"; aviso "mesmo item em outro documento"; aba "Para corrigir" |
| `text-sky-400` | `#38bdf8` | 2,1:1 | etiqueta **Serviço** |
| `text-orange-200` | `#fed7aa` | 1,3:1 | rótulo do FAB de requisição devolvida |
| `text-sky-200` | `#bae6fd` | 1,3:1 | rótulo do FAB de Novo Documento |
| `text-amber-200` | `#fde68a` | 1,2:1 | rótulo do FAB de Avisos da Matriz |

O mínimo utilizável é 4,5:1. Ocorrências no fluxo: 6 em `AprovacoesComprasView`
+ `RequisicoesSetorView`, 5 em `RequisicaoAvisoModal`, 4 em
`NovoDocumentoModal`, 3 em `AvisoMatrizFAB`.

Efeito prático: **quem usa o modo claro não vê o botão que devolve, não lê o
aviso de item duplicado e não lê o rótulo de nenhum dos três FABs de recado.**
As três últimas migrações (517/518/520) existem exatamente para esses avisos
serem vistos.

Não é regressão só nossa — Avisos da Matriz e Novo Documento estão assim desde
que nasceram. Só apareceu agora porque o fluxo inteiro passou a falar âmbar.

**Correção:** acrescentar amber (200/300/400/500), sky (200/300/400) e as
variantes 100/200 de orange/amber/sky ao bloco de overrides, na mesma régua dos
vizinhos (tom ~700/800 em fundo claro). Uma edição, um arquivo. Vale ainda uma
varredura por outras famílias sem mapa, antes que o próximo módulo repita.

### 4.2 — Dois dialetos visuais na mesma tela (MÉDIA)

A consolidação de ontem pôs lado a lado duas gramáticas diferentes:

| | Aba **Compra** | Aba **Material do estoque** |
|---|---|---|
| Cartão | largura inteira, dobra/desdobra | grelha de 2 colunas, tudo aberto |
| Botões | `py-2 px-5 text-sm`, ícone + rótulo | `py-1.5 px-3 text-xs` |
| Observação | campo à vista ao abrir o cartão | escondido atrás de "Adicionar obs." |
| Saídas | Devolver · Negar · Aprovar | Negar · Aprovar |

Quem troca de aba sente que trocou de sistema. A régua da casa diz o contrário:
"duas coisas que interrompem o aluno do mesmo jeito devem parecer a mesma
coisa".

**Correção:** trazer o cartão de material para o formato de compra (largura
inteira, dobra, observação à vista). O conteúdo continua diferente — o
vocabulário e a régua de decisão são de cada fluxo —, o formato não.

### 4.3 — O cartão de material esconde o que o de compra mostra (MÉDIA)

Falta no material: **número do documento** (`REQ-…`), urgência, data de
abertura e botão de histórico. Sobra: `StatusBadge` escrito "Pendente" numa fila
onde tudo é pendente — ruído com aparência de informação.

Sem o número, o gerente não tem como falar do documento com o aluno ("o que é
esse aqui?" em vez de "o REQ-SM-2026-0231 está errado").

**Correção:** cabeçalho igual ao de compra — número em `font-mono`, item em
negrito, solicitante e quantidade na linha de baixo; fora o `StatusBadge`,
dentro o `HistoricoOperacoes`.

### 4.4 — A mesma ação em duas cores (BAIXA)

"Devolver" é âmbar no cartão de decisão e **verde** (`action-btn-success`) na
lista de decisões já tomadas — nas duas telas, compra e material. Verde diz
"aprovar" em todo o resto do sistema.

**Correção:** um `action-btn-warning` âmbar para devolver, em qualquer lugar
onde a ação apareça.

### 4.5 — Seis FABs empilhados no canto (MÉDIA, dívida de desenho)

`bottom-6` Ponto · `24` Avisos · `40` Pedido online · `56` Convite de vaga ·
`72` Novo documento · `88` Requisição devolvida. Numa tela de 768px de altura a
pilha ocupa metade do lado direito, cada um de uma cor, todos pulsando.

Cada um nasceu certo sozinho; juntos viraram um segundo menu que ninguém
desenhou. O sétimo não cabe.

**Proposta (fase própria, não urgente):** um FAB único de pendências, com a
contagem total e uma lista curta ao clicar — cada linha abre o modal que já
existe. O modal automático continua para o que não pode esperar.

### 4.6 — O que a tela não diz

- **Tempo parado** — vide 3.3. É a informação que falta em todas as filas.
- **Aba "Devolvidas"**: mostra o motivo que o gerente escreveu, mas não *quando*
  devolveu nem *quem* devolveu. `correcao_solicitada_em` e `correcao_solicitada_por`
  existem no banco desde a 517 e nenhuma tela lê.
- **Etiqueta de origem no material**: a aba Compra ganhou Reposição / Eventual /
  Serviço; material não tem etiqueta nenhuma, embora venha de dois caminhos
  (reposição de prateleira e pedido eventual do setor).

---

## 5. Plano de implementação

Ordem por risco decrescente. Cada fase é fechada e testável sozinha.

### Fase 0 — Contraste no modo claro (um arquivo, sem migração) — ✅ feito 2026-08-24

0. `src/index.css`: overrides de `amber` (100–500), `sky` (100–400), `indigo`
   (100–400), `violet`, `teal`, `fuchsia`, `cyan-300`, `emerald-100/200`,
   `orange-100/200`, `purple-200`, `red-200`, `slate-300` e `yellow-500` — a
   varredura por família (item 1) achou mais faltando do que o levantamento
   original: `amber-300`/`amber-400` sozinhos somavam 141 ocorrências em
   `src/views` e não tinham NENHUM override.
1. Varredura feita por `grep -rhoE` em `src/**/*.tsx`, contra a lista de
   overrides existente.

Aplicado antes da Fase 1 porque era a correção mais barata do lote e a que
devolve visibilidade aos avisos que as três últimas migrações criaram.

### Fase 1 — Correções de banco (migr. 521) — ✅ feito 2026-08-24, aplicado nos 4 projetos

2. `reenviar_requisicao_corrigida`: grava `reenviada_em = now()` (copiar a
   definição vigente do banco antes de substituir — a 518 já a alterou).
3. `reabrir_requisicao`: grava `reenviada_em = NULL`.
4. `requisicao_marca_reenvio`: fica só com a limpeza na devolução.
5. `decidir_requisicao_compra`: recusa `v_req.status = 'Em correção'`.
6. `decidir_requisicao_compra`: `notificar_setor` da decisão para o setor do
   solicitante; segundo aviso para `compras` quando houve cascata de cotações.
7. Gatilho `aprovacao_estoque_segue_a_requisicao` em `requisicoes_estoque`,
   igual ao da 519, mais limpeza de órfãs.

Aplicado nos 4 projetos; `NOTIFY pgrst, 'reload schema'` rodado nos 4.

Verificado com transações revertidas antes de aplicar de verdade: reabrir
zera `reenviada_em`; `decidir_requisicao_compra` recusa `Em correção` —
testado contra um caso real (a aprovação `efe12674…` seguia `Pendente` com a
requisição `Em correção`, exatamente o buraco descrito no item 1.2); o
reenvio grava `reenviada_em` de verdade. Limpeza de órfãs de material: 0 nos
4 projetos — o botão de excluir requisição de material nunca tinha sido
usado ainda.

### Fase 2 — Correções de tela — ✅ feito 2026-08-24

8. `useRequisicoesAviso`: fila de "reenviada" só com `filialAtiva` definida
   — `decide` passa a exigir `!!filialAtiva`, guardado no próprio cabeçalho
   do hook para não se perder de vista na próxima edição.
9. `AprovacoesEstoqueView`: descartar aprovação sem requisição, contar e avisar
   (espelhado `orfas`/`avulsas` de `AprovacoesComprasView`, com o mesmo aviso
   âmbar e o mesmo guard de `isLoading` para não piscar durante o fetch).
10. `RequisicoesView`: contexto da linha `Em correção` — mesmo bloco âmbar
    ("Devolvida — está com…", motivo, o que esperar) que já existia em
    Aprovações, agora também na linha expandida de Compras → Requisições.
11. Cartão de material no formato do de compra: largura inteira (era grelha
    de 2 colunas), observação à vista (era escondida atrás de "Adicionar
    obs."), `HistoricoOperacoes` e data de abertura. **Ajuste ao executar:**
    `requisicoes_estoque` não tem coluna `numero` nem `urgencia` — essas
    duas partes do item 11 não existem na tabela. O código curto
    (`numeroRequisicao` cai no fallback `REQ-xxxxxx` via `id`) supre o
    "como nomear o documento numa conversa"; urgência fica de fora porque
    não há dado nenhum para mostrar. `StatusBadge` removido (era sempre
    "Pendente" na fila — ruído).
12. `action-btn-warning` âmbar para devolver, nas duas telas — trocado de
    `action-btn-success` (verde, que em todo o resto do sistema significa
    "aprovar"). A classe já existia, usada em Requisições → Compras para
    "Reabrir"; só faltava aplicá-la aqui.

### Fase 3 — Devolver material para correção (migr. 522)

13. `devolver_requisicao_estoque_para_correcao` + colunas de correção em
    `requisicoes_estoque`.
14. Botão na aba Material, com o mesmo texto de três saídas de Compra.
15. `RequisicoesSetorView`: aba "Para corrigir" aceita material.
16. Modal de aviso (`useRequisicoesAviso`) passa a cobrir o documento de
    material — mesma tabela de ciência, evento novo.

### Fase 4 — Refinamento

17. Duplicata reconferida no reenvio.
18. "Parada há N dias" nas três filas (3.3 e 4.6), âmbar depois de 2 dias.
19. Quem devolveu e quando, na aba Devolvidas — as colunas existem desde a 517
    e nenhuma tela lê.
20. Etiqueta de origem também no material (4.6).
21. Régua de vocabulário (`Atendido`; "Liberado" só como verbo).
22. Subtítulos nomeando a porta gêmea.

### Fase 5 — FAB único de pendências (desenho, não correção)

23. Substituir a pilha de seis FABs por um só, com contagem e lista curta (4.5).
    Fase própria porque mexe em cinco componentes que hoje não se conhecem, e
    porque o ganho é de desenho, não de correção.

### Fora de escopo, anotado

- `criar_requisicao_compra` (singular) parece legado desde o lote da 358 —
  conferir se alguma tela ainda chama antes de remover.
- Requisição com `criado_por` nulo (linhas antigas) não recebe o modal de
  devolução; só o sino. Não vale migração de dados.
