// Parâmetros de `criar_venda_pdv`, montados num lugar só para os dois PDVs.
//
// Antes cada PDV escrevia a chamada à mão, e o que mudava na RPC tinha de ser
// lembrado duas vezes — a migr. 562 (`p_valor_dinheiro`) foi feita duas vezes.
// Esta função não decide regra de negócio: quem chama diz o desconto, as
// parcelas e quanto entra na gaveta. Ela só garante o formato.

export interface ItemVendaPdv {
  produto_id: string;
  nome_produto: string;
  qtd: number;
  preco_unitario: number;
  subtotal: number;
}

export interface VendaPdv {
  clienteId: string | null;
  subtotal: number;
  /** Desconto total enviado à RPC — no PDV dos nichos já inclui o do cupom. */
  desconto: number;
  totalFinal: number;
  forma: string;
  parcelas: number;
  /** Aceita o item do carrinho inteiro; só os cinco campos da RPC seguem. */
  itens: ItemVendaPdv[];
  filial: string;
  cupomCodigo?: string | null;
  cupomDesconto?: number;
  /** Quanto entra na GAVETA (migr. 562). Troco não entra. */
  dinheiroEmEspecie: number;
  /**
   * CPF/CNPJ na nota, só dígitos (migr. 574). `undefined` deixa o parâmetro
   * fora da chamada — o PDV dos nichos não tem o campo e não o manda.
   */
  cpfNota?: string | null;
}

export function montarVendaPdv(v: VendaPdv): Record<string, unknown> {
  const params: Record<string, unknown> = {
    p_cliente_id:      v.clienteId,
    p_total:           v.subtotal,
    p_desconto:        v.desconto,
    p_total_final:     v.totalFinal,
    p_forma_pagamento: v.forma,
    p_parcelas:        v.parcelas,
    p_itens:           v.itens.map(item => ({
      produto_id:     item.produto_id,
      nome_produto:   item.nome_produto,
      qtd:            item.qtd,
      preco_unitario: item.preco_unitario,
      subtotal:       item.subtotal,
    })),
    p_filial:          v.filial,
    p_cupom_codigo:    v.cupomCodigo ?? null,
    p_cupom_desconto:  v.cupomDesconto ?? 0,
    p_valor_dinheiro:  parseFloat(v.dinheiroEmEspecie.toFixed(2)),
  };
  if (v.cpfNota !== undefined) params.p_cpf_nota = v.cpfNota;
  return params;
}
