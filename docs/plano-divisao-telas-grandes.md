# Plano — dividir as telas grandes (PDV e Produtos)

Escrito em 2026-09-23. **Etapas 1 e 2 feitas em 2026-09-23** (ver abaixo); as demais não foram executadas. Cada etapa é entregável sozinha e **não muda comportamento**.

## O que a medição mostrou

| Arquivo | Linhas | `useState` | `useEffect` | Observação |
|---|---:|---:|---:|---|
| `src/views/PDVViewSupermax.tsx` | 4.708 | 80 | 15 | Um componente só de 88 a 4.631. O render começa na 2.090, e daí para baixo são ~30 modais inline. |
| `src/views/ProdutosView.tsx` | 3.590 | 34 | 12 | O formulário começa na 1.990, com ~1.580 linhas de JSX. |
| `src/views/PDVView.tsx` | 3.264 | 37 | 20 | PDV de MaxLook e TechMax. Entrega a SuperMax ao `PDVViewSupermax`. |
| `src/views/MatrizCapitalView.tsx` | 3.038 | — | — | Fora do escopo deste plano. |
| `src/views/CotacoesView.tsx` | 2.610 | — | — | Fora do escopo deste plano. |

**Os dois PDVs não são cópia um do outro.** Só 2% das linhas se repetem em blocos de 6 ou mais linhas: os dois arquivos têm 7 nomes de função em comum, 24 só em `PDVView` e 32 só em `PDVViewSupermax`. São **duas implementações do mesmo fluxo que foram se afastando**:

| Capacidade | SuperMax | MaxLook / TechMax |
|---|:---:|:---:|
| `criar_venda_pdv` | ✔ | ✔ (chamada escrita de novo) |
| Pix / cartão pendentes (`cancelarPix`, `cancelarCartao`, `onAutorizado`) | ✔ | ✔ (escritos de novo) |
| CPF/CNPJ na nota (`p_cpf_nota`) | ✔ | ✘ |
| Cupom de desconto | ✘ (manda `null`) | ✔ |
| Pagamento misto | ✔ | ✘ |
| Desconto com autorização do gerente | ✔ | ✘ |

O custo disso já apareceu. A migr. 562 (dinheiro em espécie explícito) teve de ser feita duas vezes, e qualquer conserto no pagamento corre o risco de chegar a um PDV e não ao outro.

## Pré-requisito: onde testar

O preview local grava na turma real (memória `feedback_nao_clicar_acao_em_turma_ao_vivo`), e o PDV só se testa clicando: abrir caixa, vender, Pix, fechar. **Antes da etapa 2**, escolher um destes caminhos:

1. **Branch do Supabase** para um dos projetos. É o isolamento real, mas é pago e o schema precisa ser semeado.
2. **Turma Aprendiz fora do horário de aula.** É o banco de menos tráfego (5 requisições na janela medida). O custo é deixar vendas de teste nele, que depois precisam ser estornadas ou limpas pelo reset da filial.
3. **Roteiro manual feito pelo professor** logo depois do deploy, antes da aula seguinte.

A etapa 1 não depende disso: ela só tem código testável por unidade.

## Etapas

### 1. Lógica pura para `src/lib/pdv/`, com testes (risco baixo)
Funções sem React, extraídas dos dois PDVs e usadas pelos dois:
- `montarVendaPdv(...)`: monta os parâmetros de `criar_venda_pdv` (itens, `p_valor_dinheiro`, parcelas, desconto). Hoje cada PDV monta os seus.
- Troco e pagamento misto (o "valor acima do restante entra cortado").
- Quantidade fracionária: `isProdutoFracionario`, `formatQtd`, `fmtQtdArmada`.
- Regras por unidade: `formasDaUnidade`, `rotuloFiado`, `podeDevolver`.

Pronto quando: os dois PDVs chamam `montarVendaPdv`, os testes cobrem o payload de cada forma de pagamento, e o diff de comportamento é nenhum.

**Feito (2026-09-23).** `src/lib/pdv/` tem quatro arquivos: `venda.ts` (`montarVendaPdv`), `pagamento.ts` (misto, troco, gaveta, crédito do misto), `quantidade.ts` e `regrasUnidade.ts`. Os testes estão em `tests/pdvLogica.test.ts` (22 casos). Os dois PDVs chamam `montarVendaPdv`. `p_cpf_nota` só entra quando quem chama passa o CPF, então o PDV dos nichos continua sem mandar a chave. O que ficou de fora:
- Os totais do PDV dos nichos (`subtotal - desconto - cupom`, sem arredondar nem limitar o desconto) não passaram por `totaisComDesconto`, porque isso mudaria o comportamento.
- `isProdutoFracionario` compara a unidade com `toUpperCase`, e a SuperMax usa `normalizarUnidade`. Não foram unificados pelo mesmo motivo.
- A extração saiu num commit só, e não num por função: as quatro mexem nas mesmas linhas dos dois PDVs.
Resultado: `PDVViewSupermax` com 4.672 linhas e `PDVView` com 3.206.

### 2. Hook `usePagamentoPendente` (Pix e cartão) (risco médio)
A espera do Pix ou do cartão (polling, realtime, cancelar com confirmação, `onAutorizado`) existe nos dois PDVs. Ela vira um hook só e os dois passam a usá-lo. É o trecho em que um defeito custa mais caro, porque envolve cobrança na MaxPay e casamento por valor, então é o que mais ganha com ter uma versão só.

Precisa do ambiente de teste do pré-requisito.

**Código feito (2026-09-23). O roteiro de cliques ainda falta.**
- `src/lib/pdv/cobranca.ts` reúne:
  - `aguardarCobranca`: realtime + polling de 2s, que dispara uma vez;
  - `inserirPixPendente` e `inserirCartaoPendente`;
  - `cancelarAguardandoAntigas` e `cancelarCobranca`.
- `src/hooks/usePagamentoPendente.ts` liga a espera ao ciclo de vida da tela.
- Os dois PDVs usam as duas peças nas quatro esperas (Pix e cartão em cada um). A reação à confirmação continua em cada PDV, porque hoje é diferente:
  - a SuperMax confere o caixa e tenta de novo o Pix que falhou;
  - os nichos abrem o modal de falha pós-pagamento.
- Testes em `tests/pdvCobranca.test.ts` (12 casos, com Supabase falso). O caso central: realtime e polling juntos disparam UMA vez.

O que mudou de comportamento, tudo de propósito e pequeno:
1. Depois que a espera para (modal fechado), um polling que ainda estava a caminho não dispara mais. O Pix da SuperMax não tinha essa trava.
2. O texto de erro do cartão da SuperMax, quando o insert não devolve nem linha nem erro, passou a ser o dos nichos.

O que continua divergente e é decisão da etapa 5:
- O Pix dos nichos não cancela as pendentes antigas do operador antes de criar outra. A SuperMax cancela. Como a MaxPay casa por valor, uma pendente velha com o mesmo valor pode ser confirmada no lugar da nova.
- Cancelar Pix ou cartão pede confirmação na SuperMax, e nos nichos não.

**Antes do deploy:** rodar o roteiro do pré-requisito, com os mesmos cliques nos dois PDVs:
- Pix pago; Pix cancelado;
- débito; crédito 3x;
- na SuperMax, cartão dentro do misto;
- Pix pago com o caixa fechado no meio: tem de aparecer "Tentar Novamente" e, reaberto o caixa, a venda sai sozinha.

### 3. Modais do `PDVViewSupermax` para `src/components/pdv/` (risco baixo por modal)
Da linha 2.454 em diante, cada modal vira um componente com props explícitas. Ordem sugerida, dos puramente de leitura para os que gravam:
1. Manual do PDV, Consulta de preço (F7), Reimpressão (Ctrl+R).
2. Recibo, Agradecimento, CPF na nota, Parcelas, Vale-Alimentação.
3. Busca (F8), seleção de cliente para fiado e de cartão.
4. Pix aguardando e cartão aguardando, que já estarão no hook da etapa 2.

Cuidado conhecido: a navegação por teclado (`trapTab`, `devolverTabAoPdv`, F-keys) depende de foco e de `ref`s. Cada modal extraído precisa passar no roteiro de teclado do Manual.

Meta: `PDVViewSupermax` abaixo de 2.000 linhas.

### 4. `ProdutosView`: formulário separado da lista (risco baixo)
- `MarkupBadge` e `EtiquetaPreviewModal` para `src/components/produtos/`.
- O formulário (1.990 → 3.569) vira `ProdutoForm`, com seções próprias: dados básicos, preço/markup, embalagem, atributos por nicho (JSONB) e imagens.
- A lista e os filtros ficam na view.

### 5. Paridade entre os PDVs: é decisão de produto, não refatoração
A tabela acima mostra buracos (CPF na nota nos nichos, cupom na SuperMax). Fechar esses buracos é **feature**, então passa pela trava de features. Anotar em `docs/backlog-pos-freeze.md` e decidir à parte. As etapas 1 a 3 deixam esse trabalho barato, porque a capacidade passa a morar num lugar só.

## Ordem e tamanho

| Etapa | Depende de | Tamanho |
|---|---|---|
| 1 | nada | 1 sessão |
| 2 | 1 + ambiente de teste | 1 sessão |
| 3 | 2 | 2–3 sessões (um lote de modais por sessão) |
| 4 | nada | 1–2 sessões |
| 5 | 1–3 + decisão | fora deste plano |

Regra para todas as etapas: um commit por extração, `npm run lint` e `npm test` verdes, e deploy fora do horário de aula (manhã 12:40–16:20 UTC, tarde 18:20–21:50 UTC).
