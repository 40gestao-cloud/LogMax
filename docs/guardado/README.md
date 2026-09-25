# Guardado — fora do frontend

Coisas que saíram do app a pedido do professor, mas que ele pode querer de
volta. Nada aqui é compilado nem entra no bundle (`docs/` fica fora do
`tsconfig`).

## Descrições das telas — `descricoes-das-telas.md`

O parágrafo explicativo que ficava abaixo do título de cada tela (89 telas),
mais as descrições da tela genérica de cadastros (props `subtitle` no
`App.tsx`), do CRM e de Pedidos de Venda. Removidas em 24/09/2026.

## Faixa de etapa do fluxo — `FaixaEtapaFluxo.tsx`

A faixa no topo das telas de uma cadeia ("Compra · etapa 1 de 9 — O setor
pede o que falta…", com anterior/próxima, pré-requisitos e a cadeia inteira).
Removida em 24/09/2026. Os testes dela estão em `faixaEtapaFluxo.test.ts`.

Para voltar:

1. `git mv docs/guardado/FaixaEtapaFluxo.tsx src/components/FaixaEtapaFluxo.tsx`
2. `git mv docs/guardado/faixaEtapaFluxo.test.ts tests/faixaEtapaFluxo.test.ts`
3. Em `src/App.tsx`, importar
   `import { FaixaEtapaFluxo } from './components/FaixaEtapaFluxo';`
   e renderizar `<FaixaEtapaFluxo activeView={activeView} onNavigate={navigate} />`
   logo antes do `<div className="flex-1 min-h-0">` que envolve o
   `renderContent()`.

A faixa lê `src/lib/aulaFluxos.ts`, que continua no app porque o Modo Aula usa
a mesma lista.
