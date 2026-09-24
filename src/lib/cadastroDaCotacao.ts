// Atalho Cotações → Cadastros > Produtos com a origem já escolhida.
//
// A requisição eventual chega às Cotações em texto livre, e o pedido só sai
// amarrado a um item do catálogo (migr. 480). O cadastro com "Origem deste
// cadastro" já grava esse vínculo (migr. 494) — o que faltava era o caminho: o
// comprador saía das Cotações, abria Produtos, procurava a requisição no select
// e depois voltava para caçar a linha certa do Gerar Pedido.
//
// Vai por sessionStorage porque a navegação do App é por `activeView`, sem
// parâmetro. Ler não apaga (o StrictMode chama o inicializador duas vezes);
// quem consome chama `esquecerCadastroDaCotacao` depois de usar.

const CHAVE = 'logmax:cadastroDaCotacao';
// Pedido velho não abre formulário sozinho: quem saiu das Cotações e só voltou
// a Produtos uma hora depois não estava mais no meio daquele cadastro.
const VALIDADE_MS = 10 * 60 * 1000;

export function pedirCadastroDaCotacao(requisicaoId: string, filial: string): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ requisicaoId, filial, em: Date.now() }));
  } catch { /* sem storage: o comprador escolhe a origem à mão, como antes */ }
}

/** Id da requisição pedida pelas Cotações para esta unidade, se houver. */
export function lerCadastroDaCotacao(filial: string): string | null {
  try {
    const raw = sessionStorage.getItem(CHAVE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.requisicaoId || p.filial !== filial || Date.now() - Number(p.em ?? 0) > VALIDADE_MS) return null;
    return String(p.requisicaoId);
  } catch {
    return null;
  }
}

export function esquecerCadastroDaCotacao(): void {
  try { sessionStorage.removeItem(CHAVE); } catch { /* idem */ }
}
