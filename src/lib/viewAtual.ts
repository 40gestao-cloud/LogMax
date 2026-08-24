// Qual tela está aberta, para quem vive fora da árvore autenticada.
//
// O registador do service worker (PwaUpdatePrompt) monta ACIMA do
// LogMaxAppInner — é ele que decide se pode recarregar a página, e para isso
// precisa saber se o aluno está no PDV. Não dá para ler `activeView` por prop
// sem subir metade do App.tsx um nível.
//
// Uma variável de módulo resolve porque só existe uma tela aberta de cada vez
// e ninguém precisa re-renderizar quando ela muda: quem lê, lê no instante em
// que vai decidir.

let atual: string | null = null;

export function setViewAtual(view: string | null): void {
  atual = view;
}

export function viewAtual(): string | null {
  return atual;
}
