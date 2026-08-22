# Pendências — auditoria da montagem de filial (Fases 0-4)

Escrito em 2026-08-22, depois da auditoria das migr. 507-511.

A auditoria achou 7 furos. **Os 5 que quebravam dado ou dinheiro já foram corrigidos** nos
commits `c56f97e` (tela) e `7780b1c` (migr. 512) — ver
[[project_montagem_filial_investimentos]] na memória e o cabeçalho da própria migr. 512.

O que sobrou está aqui. Nenhum destes perde dado nem duplica desembolso: são buracos de
realismo contábil e de UX. Ordem sugerida = a de baixo para cima em custo/benefício, mas
todos são independentes entre si.

---

## 1. Item `outro` com natureza `imobilizado` some do resultado

**Onde:** `src/views/FiliaisView.tsx:838-845` (select "Natureza") e a RPC
`gerar_contas_da_montagem` (migr. 512, bloco de equipamento/outro).

**Sintoma:** o usuário marca um item customizado como `outro` e escolhe natureza
`imobilizado` no modal de gerar. A conta nasce com `natureza='imobilizado'`, que a migr.
507 excluiu do DRE de propósito — mas só `categoria='equipamento'` cria o produto
`tipo='patrimonio'`. Resultado: o dinheiro não aparece como despesa, não aparece como
depreciação, não aparece em lugar nenhum.

**Por quê:** a Fase 4 amarrou "vira patrimônio" à *categoria*, e a natureza ficou como
escolha livre do usuário na Fase 3. As duas regras não conversam.

**Correção sugerida (escolher uma):**
- (a) Simples: tirar `imobilizado` das opções do select de natureza para item `outro` —
  quem quer bem de patrimônio usa a categoria `equipamento`, que é o caminho que gera o
  produto. Uma linha na tela, zero migração.
- (b) Coerente: na RPC, tratar `natureza='imobilizado'` como gatilho de criação do produto
  de patrimônio, independentemente da categoria. Mexe na função e no `IF r.categoria =
  'equipamento'`.

Recomendação: **(a)**. A categoria já é a régua; duas réguas para a mesma decisão é o que
criou o furo.

---

## 2. Aluguel com `quantidade > 1` cobra qtd × preço em cada parcela

**Onde:** `filial_investimentos.valor_total` (coluna gerada, migr. 509) e o laço de
parcelas em `gerar_contas_da_montagem`.

**Sintoma:** o item de aluguel tem os mesmos campos de qualquer outro — quantidade e preço
unitário. Quem digitar `12 × R$ 2.000` pensando "12 meses" gera 12 parcelas de **R$
24.000** cada, R$ 288 mil de aluguel. Nada na tela avisa; o número de meses é o campo
"Parcelas do aluguel" do modal, não a quantidade.

**Correção sugerida:** na tela, para `categoria='aluguel'`, travar quantidade em 1 (campo
oculto ou `readOnly` com rótulo "valor mensal") e renomear a coluna de preço para "Valor
mensal". Reforço no banco, se quiser: `CHECK (categoria <> 'aluguel' OR quantidade = 1)`.

---

## 3. "Importar de Detalhes" não aparece em filial só com aluguel

**Onde:** `src/views/FiliaisView.tsx:707-714` (a condição do botão).

**Sintoma:** a condição do botão exige alguma chave de equipamento com `qtd > 0` em
`detalhes`. Filial alugada que nunca preencheu a grade (ou preencheu só o aluguel) nunca
vê o botão, e o `valorAluguel` antigo nunca vira item — fica só como número espelhado.

**Correção sugerida:** somar à condição
`|| (Number(editItem.detalhes?.valorAluguel) > 0)`. A rotina `handleImportarParaItens`
**já** importa o aluguel (`FiliaisView.tsx:456-462`); só a visibilidade do botão ficou
estreita.

---

## 4. Botão "Baixar" aparece para quem o RPC recusa

**Onde:** `src/views/PatrimonioView.tsx:204` (botão) e `dar_baixa_patrimonio` (migr. 511),
que chama `_assert_rpc('financeiro', 'logistica')`.

**Sintoma:** qualquer um que enxerga a tela de Patrimônio vê "Baixar". Gerente da unidade
fora dos setores financeiro/logística preenche o modal inteiro (motivo, valor de venda) e
só aí leva "Permissão insuficiente para esta operação".

**Decidir primeiro — o gerente da filial pode dar baixa em bem da própria unidade?**
- Se **sim**: acrescentar `auth_gerente_da(v_prod.filial)` como alternativa ao
  `_assert_rpc` de setor, no mesmo formato da `gerar_contas_da_montagem` (migração nova).
- Se **não**: esconder o botão na tela com a mesma régua de setor
  (`hasSetor(profile, 'financeiro') || hasSetor(profile, 'logistica') || admin`).

Ver [[feedback_guard_recusa_rpc_autorizada]] — a tela nunca deve oferecer o que o guard vai
recusar.

---

## 5. Depreciação usa mês de 30 dias

**Onde:** bloco "Depreciação" de `gerar_dre` (migr. 511, mantido na 512) e a mesma fórmula
espelhada em `PatrimonioView.tsx` (`valorContabilAtual`).

**Sintoma:** a quota é `dias × custo / meses / 30`. Como o fim da vida é cortado em
`created_at + vida_util_meses`, um bem de 60 meses acumula ~1.826 dias sobre um divisor de
1.800 → deprecia ~101,4% do custo ao longo da vida. Erro pequeno, consistente entre SQL e
tela, mas existe.

**Correção sugerida:** trocar o rateio diário por rateio mensal — contar meses inteiros
dentro do período em vez de dias, com o mesmo `GREATEST/LEAST` de bordas. Fecha em 100%
exatos e simplifica a leitura. Se mexer, **mexer nos dois lugares na mesma migração/commit**
(o número da tela e o do DRE têm de continuar batendo).

---

## Fora da lista, mas anotado

- **Filial com capital estourado não consegue gerar a montagem.**
  `bloqueia_conta_pagar_estourado` dispara no primeiro INSERT e derruba a transação
  inteira com a mensagem de capital, sem relação aparente com o botão clicado. É
  comportamento correto (não se lança despesa com capital estourado), só mal explicado.
  Se incomodar, o conserto é uma checagem prévia na RPC devolvendo mensagem própria antes
  de tentar inserir.
- **Editar a conta em Contas a Pagar depois de gerada.** A legenda do item mostra o valor
  do *item*, não o da conta. Se alguém alterar o valor pela tela do Financeiro, os dois
  divergem em silêncio. O caminho certo é desvincular e regerar; hoje nada impede o outro.
- **Passe visual pendente.** Nada disto (nem as correções da 512) foi verificado no
  navegador — a sessão não tinha login. Vale abrir Filiais e Patrimônio uma vez antes de
  considerar o assunto fechado.
