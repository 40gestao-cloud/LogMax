// Natureza do serviço — quem presta.
//
// `servicos` nasceu como catálogo do que a filial PRESTA: os atributos por
// nicho são de venda (troca de tela, ajuste de bainha, garantia, marcas
// atendidas, tempo estimado) e `valor` significa PREÇO. A migr. 499 apontou o
// pedido de compra para essa mesma tabela, para tirar a requisição de serviço
// do beco em que a 480 a deixou — e com isso juntou duas coisas que não são a
// mesma.
//
// Com mercadoria a fusão não incomoda: o que se compra é o que se vende. Com
// serviço não fecha — serviço prestado é a SAÍDA da empresa, serviço contratado
// é a saída de outra. Sem separar, o comprador que precisa de dedetização abre
// o select e vê "Troca de tela — R$ 150"; e para conseguir comprar, cadastra
// "Dedetização" no catálogo que a loja OFERECE, com preço e garantia.
//
// É a mesma distinção que o SAP faz entre o serviço vendido (material tipo
// DIEN, do lado de vendas) e o serviço comprado (cadastro de serviço, usado na
// folha de medição do pedido).
//
// Régua única, como `tipoProduto.ts` e `unidades.ts`: os literais entram em
// três telas e na RPC, e é assim que "prestado" vira 'Prestado' em uma delas.

export const NATUREZAS_SERVICO = ['prestado', 'contratado'] as const;

export type NaturezaServico = typeof NATUREZAS_SERVICO[number];

/** Legado de antes da coluna (migr. 516): tudo que existia era de venda. */
export const normalizarNatureza = (n: string | null | undefined): NaturezaServico =>
  String(n ?? '') === 'contratado' ? 'contratado' : 'prestado';

/** A filial vende este serviço. É o catálogo de saída — PDV, vitrine, promoção. */
export const ehPrestado = (n: string | null | undefined): boolean =>
  normalizarNatureza(n) === 'prestado';

/** A filial contrata este serviço. É item de pedido de compra, nunca de venda. */
export const ehContratado = (n: string | null | undefined): boolean =>
  normalizarNatureza(n) === 'contratado';

export const NATUREZA_LABEL: Record<NaturezaServico, string> = {
  prestado:   'Prestado pela unidade',
  contratado: 'Contratado de terceiro',
};

/** Explica a escolha na própria tela — é onde se decide errado. */
export const NATUREZA_AJUDA: Record<NaturezaServico, string> = {
  prestado:
    'A unidade executa e cobra do cliente: troca de tela, ajuste de bainha, entrega. Tem preço, garantia e prazo, e é isso que entra em promoção.',
  contratado:
    'A unidade paga a um fornecedor: manutenção, frete, dedetização, licença de software. Entra por requisição de compra, vira pedido, e o "recebimento" dele é o aceite da execução — que libera o pagamento.',
};

/** O rótulo do campo de dinheiro muda com a natureza: preço x custo. */
export const NATUREZA_VALOR_LABEL: Record<NaturezaServico, string> = {
  prestado:   'Preço (R$) *',
  contratado: 'Custo de referência (R$)',
};
