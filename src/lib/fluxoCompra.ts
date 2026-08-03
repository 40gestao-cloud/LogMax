// As cinco etapas da requisição de compra, e de quem é cada uma.
//
// Mora aqui, e não dentro do componente, porque a mesma régua é usada em três
// telas de papéis diferentes. Duas cópias divergiriam no primeiro ajuste do
// fluxo — e a barra passaria a dizer coisas diferentes para o solicitante e
// para quem decide.

export type EtapaCompra = 'solicitado' | 'aprovado' | 'cotado' | 'pedido' | 'recebido' | 'negado';

export const ETAPAS_COMPRA: { id: Exclude<EtapaCompra, 'negado'>; label: string; quem: string; ajuda: string }[] = [
  { id: 'solicitado', label: 'Solicitado', quem: 'aguarda o gerente',
    ajuda: 'A área pediu. Enquanto está aqui, quem abriu ainda pode corrigir com Compras — e nada foi comprado.' },
  { id: 'aprovado',   label: 'Aprovado',   quem: 'com Compras',
    ajuda: 'O gerente autorizou. Aprovar não compra nada: libera Compras a pedir preço aos fornecedores.' },
  { id: 'cotado',     label: 'Cotado',     quem: 'aguarda o Financeiro',
    ajuda: 'Compras coletou proposta e enviou. Dentro da alçada quem decide é o Financeiro; acima dela, o gerente.' },
  { id: 'pedido',     label: 'Pedido',     quem: 'com o fornecedor',
    ajuda: 'O pedido foi emitido e a conta a pagar nasceu junto. Agora se espera a mercadoria chegar.' },
  { id: 'recebido',   label: 'Recebido',   quem: 'concluído',
    ajuda: 'O Estoque conferiu e deu entrada. É essa conferência que libera o pagamento ao fornecedor.' },
];

/**
 * Em que etapa está a requisição.
 *
 * O status dela já responde quase tudo, porque o fluxo o move: 'Atendida' só
 * acontece dentro de `gerar_pedido_de_cotacao`, então significa pedido emitido
 * — a cotação necessariamente ficou para trás.
 *
 * O que o status NÃO diz é se a mercadoria chegou, que é do pedido. Telas que
 * enxergam o pedido passam `pedidoStatus`; as que não enxergam (a lista do
 * setor solicitante, onde a RLS não entrega `pedidos`) simplesmente param em
 * 'Pedido' — parar é honesto, adivinhar não seria.
 */
export function etapaDaRequisicao(
  status: string | null | undefined,
  opts?: { temCotacaoViva?: boolean; pedidoStatus?: string | null },
): EtapaCompra {
  if (status === 'Negado') return 'negado';
  if (status === 'Atendida') {
    return opts?.pedidoStatus === 'Recebido' ? 'recebido' : 'pedido';
  }
  if (status === 'Aprovado') return opts?.temCotacaoViva ? 'cotado' : 'aprovado';
  return 'solicitado';
}
