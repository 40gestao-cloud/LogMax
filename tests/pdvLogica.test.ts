import { describe, it, expect } from 'vitest';
import { montarVendaPdv } from '../src/lib/pdv/venda';
import {
  totaisComDesconto, restanteAPagar, valorDevido, mistoAtivo, trocoDoRecebido, valorEditado,
  formaDoMisto, trocoTotal, dinheiroNaGaveta, parcelasDaVenda, creditoDoMisto,
} from '../src/lib/pdv/pagamento';
import { isProdutoFracionario, fmtQtdArmada, formatQtd } from '../src/lib/pdv/quantidade';
import { formasDaUnidade, rotuloFiado, podeDevolver, podeAlternarFilial } from '../src/lib/pdv/regrasUnidade';
import { mascararDocumento } from '../src/lib/pdv/documento';

// Lógica pura dos dois PDVs (src/lib/pdv/). O payload de criar_venda_pdv é o
// que os PDVs mandavam à mão antes da extração — qualquer diferença aqui é
// mudança de comportamento no banco.

const itemCarrinho = {
  produto_id: 'p1', nome_produto: 'Arroz', qtd: 2, preco_unitario: 10, subtotal: 20,
  // Campos do carrinho que NÃO vão à RPC.
  estoque: 50, unidade: 'UN', ean: '789', codigo: '001',
};
const itemRpc = { produto_id: 'p1', nome_produto: 'Arroz', qtd: 2, preco_unitario: 10, subtotal: 20 };

describe('montarVendaPdv', () => {
  const base = {
    clienteId: null, subtotal: 20, desconto: 0, totalFinal: 20, parcelas: 1,
    itens: [itemCarrinho], filial: 'SuperMax',
  };

  it('SuperMax, Dinheiro: CPF na nota vai, cupom vai zerado, espécie = total', () => {
    expect(montarVendaPdv({ ...base, forma: 'Dinheiro', dinheiroEmEspecie: 20, cpfNota: '12345678901' })).toEqual({
      p_cliente_id: null, p_total: 20, p_desconto: 0, p_total_final: 20,
      p_forma_pagamento: 'Dinheiro', p_parcelas: 1, p_itens: [itemRpc], p_filial: 'SuperMax',
      p_cupom_codigo: null, p_cupom_desconto: 0, p_valor_dinheiro: 20, p_cpf_nota: '12345678901',
    });
  });

  it('SuperMax sem CPF manda p_cpf_nota null (a chave existe)', () => {
    const p = montarVendaPdv({ ...base, forma: 'PIX', dinheiroEmEspecie: 0, cpfNota: null });
    expect(p).toHaveProperty('p_cpf_nota', null);
    expect(p.p_valor_dinheiro).toBe(0);
  });

  it('nichos: sem cpfNota a chave fica fora da chamada', () => {
    const p = montarVendaPdv({ ...base, filial: 'MaxLook', forma: 'Cartão Débito', dinheiroEmEspecie: 0 });
    expect(p).not.toHaveProperty('p_cpf_nota');
  });

  it('nichos: cupom e parcelas do crédito seguem como vieram', () => {
    const p = montarVendaPdv({
      ...base, filial: 'TechMax', forma: 'Cartão Crédito', parcelas: 3,
      desconto: 5, totalFinal: 15, cupomCodigo: 'MAX5', cupomDesconto: 5, dinheiroEmEspecie: 0,
    });
    expect(p).toMatchObject({
      p_desconto: 5, p_total_final: 15, p_parcelas: 3, p_cupom_codigo: 'MAX5', p_cupom_desconto: 5,
    });
  });

  it('misto: espécie arredondada a centavos', () => {
    const p = montarVendaPdv({ ...base, forma: 'Misto: ...', dinheiroEmEspecie: 0.1 + 0.2 });
    expect(p.p_valor_dinheiro).toBe(0.3);
  });

  it('Fiado com cliente', () => {
    const p = montarVendaPdv({ ...base, clienteId: 'c1', forma: 'Fiado', dinheiroEmEspecie: 0 });
    expect(p).toMatchObject({ p_cliente_id: 'c1', p_forma_pagamento: 'Fiado' });
  });
});

describe('pagamento misto e troco', () => {
  it('desconto maior que o subtotal clampa e total não fica negativo', () => {
    expect(totaisComDesconto(10, 15)).toEqual({ descontoAplicado: 10, totalFinal: 0 });
    expect(totaisComDesconto(10.1, 0.2)).toEqual({ descontoAplicado: 0.2, totalFinal: 9.9 });
  });

  it('restante desconta as linhas e nunca é negativo', () => {
    expect(restanteAPagar(26, [{ forma: 'Dinheiro', valor: 20 }])).toBe(6);
    expect(restanteAPagar(26, [{ forma: 'Dinheiro', valor: 30 }])).toBe(0);
    expect(restanteAPagar(0.3, [{ forma: 'PIX', valor: 0.1 }, { forma: 'PIX', valor: 0.2 }])).toBe(0);
  });

  it('valor acima do restante entra cortado; vazio = restante', () => {
    expect(valorDevido(50, 26)).toBe(26);
    expect(valorDevido(10, 26)).toBe(10);
    expect(valorDevido(0, 26)).toBe(26);
  });

  it('misto ativo com linha lançada ou parcial menor que o restante', () => {
    expect(mistoAtivo(1, 0, 10)).toBe(true);
    expect(mistoAtivo(0, 5, 10)).toBe(true);
    expect(mistoAtivo(0, 10, 10)).toBe(false);
    expect(mistoAtivo(0, 0, 10)).toBe(false);
  });

  it('troco: null quando o recebido não cobre; centavo de folga', () => {
    expect(trocoDoRecebido(50, 26.5)).toBe(23.5);
    expect(trocoDoRecebido(26.5, 26.5)).toBe(0);
    expect(trocoDoRecebido(20, 26.5)).toBeNull();
    expect(trocoDoRecebido(26.4995, 26.5)).toBeCloseTo(0);
  });

  it('editar linha respeita o teto que as outras deixam', () => {
    const linhas = [{ forma: 'Dinheiro', valor: 20 }, { forma: 'Cartão Débito', valor: 6 }];
    expect(valorEditado(26, linhas, 1, 10)).toBe(6);
    expect(valorEditado(26, linhas, 1, 4)).toBe(4);
    expect(valorEditado(26, [{ forma: 'PIX', valor: 30 }, { forma: 'Dinheiro', valor: 1 }], 1, 5)).toBe(0);
  });

  it('forma gravada: única ou "Misto: ..."', () => {
    expect(formaDoMisto([])).toBe('');
    expect(formaDoMisto([{ forma: 'PIX', valor: 10 }])).toBe('PIX');
    expect(formaDoMisto([{ forma: 'Dinheiro', valor: 20 }, { forma: 'PIX', valor: 6 }]))
      .toMatch(/^Misto: Dinheiro R\$ .*20,00 \+ PIX R\$ .*6,00$/);
  });

  it('gaveta recebe o valor do Dinheiro, não o troco', () => {
    const linhas = [
      { forma: 'Dinheiro', valor: 20, troco: 30 },
      { forma: 'Dinheiro', valor: 5.55, troco: 0.45 },
      { forma: 'PIX', valor: 6 },
    ];
    expect(dinheiroNaGaveta(linhas)).toBe(25.55);
    expect(trocoTotal(linhas)).toBe(30.45);
  });

  it('parcelas só valem com Cartão Crédito como forma única', () => {
    expect(parcelasDaVenda([{ forma: 'Cartão Crédito', valor: 100, parcelas: 3 }])).toBe(3);
    expect(parcelasDaVenda([{ forma: 'Cartão Crédito', valor: 100 }])).toBe(1);
    expect(parcelasDaVenda([
      { forma: 'Cartão Crédito', valor: 50, parcelas: 3 }, { forma: 'Dinheiro', valor: 50 },
    ])).toBe(1);
  });

  it('crédito do misto soma valores e usa o maior parcelamento', () => {
    expect(creditoDoMisto([
      { forma: 'Cartão Crédito', valor: 30.1, parcelas: 2 },
      { forma: 'Cartão Crédito', valor: 20.2, parcelas: 4 },
      { forma: 'Dinheiro', valor: 10 },
    ])).toEqual({ valor: 50.3, parcelas: 4 });
    expect(creditoDoMisto([{ forma: 'Dinheiro', valor: 10 }])).toEqual({ valor: 0, parcelas: 1 });
  });
});

describe('quantidade', () => {
  it('fracionário pela unidade, sem unidade é UN', () => {
    expect(isProdutoFracionario({ unidade: 'kg' })).toBe(true);
    expect(isProdutoFracionario({ unidade: 'UN' })).toBe(false);
    expect(isProdutoFracionario({})).toBe(false);
  });

  it('armada: inteiro sem casas, peso com 3', () => {
    expect(fmtQtdArmada(2)).toBe('2');
    expect(fmtQtdArmada(0.35)).toBe('0,350');
  });

  it('formatQtd arredonda item por unidade e mantém peso', () => {
    expect(formatQtd(2.4, 'UN')).toBe('2');
    expect(formatQtd(1.25, 'KG')).toBe('1,250');
    expect(formatQtd(3, '')).toBe('3');
  });
});

describe('regras por unidade', () => {
  it('TechMax não vende a prazo; MaxLook chama de Crediário', () => {
    expect(formasDaUnidade('TechMax')).not.toContain('Fiado');
    expect(formasDaUnidade('MaxLook')).toContain('Fiado');
    expect(rotuloFiado('MaxLook')).toBe('Crediário');
    expect(rotuloFiado('TechMax')).toBe('Fiado');
  });

  it('devolução: admin/CEO sempre, gerente só da própria unidade', () => {
    expect(podeDevolver({ role: 'admin' }, 'MaxLook')).toBe(true);
    expect(podeDevolver({ role: 'gerente', filial: 'MaxLook' }, 'MaxLook')).toBe(true);
    expect(podeDevolver({ role: 'gerente', filial: 'TechMax' }, 'MaxLook')).toBe(false);
    expect(podeDevolver({ role: 'colaborador', filial: 'MaxLook' }, 'MaxLook')).toBe(false);
  });

  it('gerente não alterna filial', () => {
    expect(podeAlternarFilial({ role: 'ceo' })).toBe(true);
    expect(podeAlternarFilial({ role: 'gerente' })).toBe(false);
  });
});

describe('documento na nota', () => {
  it('CPF até 11 dígitos, CNPJ até 14, o resto é descartado', () => {
    expect(mascararDocumento('11144477735')).toBe('111.444.777-35');
    expect(mascararDocumento('111.444')).toBe('111.444');
    expect(mascararDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(mascararDocumento('112223330001819999')).toBe('11.222.333/0001-81');
    expect(mascararDocumento('abc')).toBe('');
  });
});
