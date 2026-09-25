// Atalho Cotações → Cadastros com a requisição já escolhida.
//
// A requisição eventual chega às Cotações em texto livre, e o pedido só sai
// amarrado a um item do catálogo (migr. 480). O cadastro faz esse vínculo —
// produto pela "Origem deste cadastro" (migr. 494), serviço pelo nome idêntico
// ao da requisição (migr. 628). O que faltava era o caminho: o comprador saía
// das Cotações, abria o cadastro, procurava a requisição e depois voltava para
// caçar a linha certa do Gerar Pedido.
//
// Vai por sessionStorage porque a navegação do App é por `activeView`, sem
// parâmetro. Ler não apaga (o StrictMode chama o inicializador duas vezes);
// quem consome chama `esquecerCadastroDaCotacao` depois de usar.

const CHAVE = 'logmax:cadastroDaCotacao';
// Pedido velho não abre formulário sozinho: quem saiu das Cotações e só voltou
// ao cadastro uma hora depois não estava mais no meio daquele trabalho.
const VALIDADE_MS = 10 * 60 * 1000;

export type DestinoCadastro = 'produto' | 'servico';
export type PedidoDeCadastro = { requisicaoId: string; nome: string };

export function pedirCadastroDaCotacao(
  destino: DestinoCadastro, requisicaoId: string, filial: string, nome: string,
): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ destino, requisicaoId, filial, nome, em: Date.now() }));
  } catch { /* sem storage: o comprador preenche o cadastro à mão, como antes */ }
}

/** O pedido de cadastro vindo das Cotações para esta tela e esta unidade, se houver. */
export function lerCadastroDaCotacao(filial: string, destino: DestinoCadastro): PedidoDeCadastro | null {
  try {
    const raw = sessionStorage.getItem(CHAVE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.requisicaoId || p.destino !== destino || p.filial !== filial
        || Date.now() - Number(p.em ?? 0) > VALIDADE_MS) return null;
    return { requisicaoId: String(p.requisicaoId), nome: String(p.nome ?? '') };
  } catch {
    return null;
  }
}

export function esquecerCadastroDaCotacao(): void {
  try { sessionStorage.removeItem(CHAVE); } catch { /* idem */ }
}
