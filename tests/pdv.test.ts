import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

// Sentinel único por run — evita conflito se rodar simultâneo em CI + local.
const TEST_PREFIX = `__TEST_PDV_${Date.now()}__`;

let testProdutoId: string;
const createdVendaIds: string[] = [];

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

async function fecharVenda(formaPagamento: string, parcelas = 1, total = 100) {
  const { data, error } = await supabase.rpc('criar_venda_pdv', {
    p_cliente_id: null,
    p_total: total,
    p_desconto: 0,
    p_total_final: total,
    p_forma_pagamento: formaPagamento,
    p_parcelas: parcelas,
    p_itens: [
      {
        produto_id: testProdutoId,
        nome_produto: `${TEST_PREFIX} Produto`,
        qtd: 1,
        preco_unitario: total,
        subtotal: total,
      },
    ],
  });
  if (error) throw error;
  const vendaId = data as string;
  createdVendaIds.push(vendaId);
  return vendaId;
}

async function contasReceberDaVenda(vendaId: string) {
  const shortId = vendaId.slice(-6).toUpperCase();
  const { data, error } = await supabase
    .from('contas_receber')
    .select('*')
    .like('descricao', `%${shortId}%`)
    .order('vencimento', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function diasEntre(a: string | null, b: string): number {
  if (!a) return -1;
  const d1 = new Date(a).getTime();
  const d2 = new Date(b).getTime();
  return Math.round((d1 - d2) / 86_400_000);
}

// ----------------------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------------------

beforeAll(async () => {
  const { data, error } = await supabase
    .from('produtos')
    .insert({
      codigo: TEST_PREFIX,
      nome: `${TEST_PREFIX} Produto de Teste`,
      preco: 100,
      estoque: 9999,
      status: 'Ativo',
    })
    .select('id')
    .single();
  if (error) throw error;
  testProdutoId = data.id;
});

afterAll(async () => {
  // Cleanup em ordem de dependência (FK).
  for (const vendaId of createdVendaIds) {
    const shortId = vendaId.slice(-6).toUpperCase();
    await supabase.from('contas_receber').delete().like('descricao', `%${shortId}%`);
    await supabase.from('itens_venda').delete().eq('venda_id', vendaId);
    await supabase.from('movimentacoes_estoque').delete().like('destino', `%${shortId}%`);
    await supabase.from('vendas').delete().eq('id', vendaId);
  }
  if (testProdutoId) {
    await supabase.from('produtos').delete().eq('id', testProdutoId);
  }
});

// ----------------------------------------------------------------------
// Testes
// ----------------------------------------------------------------------

describe('PDV — criar_venda_pdv RPC', () => {
  it('Dinheiro à vista: 1 contas_receber Pago vencimento=hoje', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const vendaId = await fecharVenda('Dinheiro');
    const rows = await contasReceberDaVenda(vendaId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Pago');
    expect(Number(rows[0].valor)).toBe(100);
    expect(rows[0].vencimento).toBe(hoje);
  });

  it('Cartão Crédito 1x: 1 contas_receber Aberto vencimento ≈ hoje+30', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const vendaId = await fecharVenda('Cartão Crédito', 1);
    const rows = await contasReceberDaVenda(vendaId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Aberto');
    expect(diasEntre(rows[0].vencimento, hoje)).toBe(30);
  });

  it('Cartão Crédito 3x: 3 contas_receber vencimentos +30/+60/+90, soma exata', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const vendaId = await fecharVenda('Cartão Crédito', 3);
    const rows = await contasReceberDaVenda(vendaId);
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.status === 'Aberto')).toBe(true);
    expect(diasEntre(rows[0].vencimento, hoje)).toBe(30);
    expect(diasEntre(rows[1].vencimento, hoje)).toBe(60);
    expect(diasEntre(rows[2].vencimento, hoje)).toBe(90);
    const soma = rows.reduce((s, r) => s + Number(r.valor), 0);
    expect(Math.round(soma * 100) / 100).toBe(100);
  });

  it('Cartão Crédito 6x: arredondamento exato (100/6 → 5×16.67 + 1×16.65)', async () => {
    const vendaId = await fecharVenda('Cartão Crédito', 6);
    const rows = await contasReceberDaVenda(vendaId);
    expect(rows).toHaveLength(6);
    const soma = rows.reduce((s, r) => s + Number(r.valor), 0);
    expect(Math.round(soma * 100) / 100).toBe(100);
  });

  it('Fiado: 1 contas_receber Aberto vencimento ≈ hoje+30', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const vendaId = await fecharVenda('Fiado');
    const rows = await contasReceberDaVenda(vendaId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Aberto');
    expect(diasEntre(rows[0].vencimento, hoje)).toBe(30);
  });

  it('Side effects: venda + itens_venda + movimentacoes_estoque criados', async () => {
    const vendaId = await fecharVenda('Dinheiro');
    const { data: venda } = await supabase.from('vendas').select('*').eq('id', vendaId).single();
    expect(venda?.forma_pagamento).toBe('Dinheiro');
    expect(Number(venda?.total_final)).toBe(100);

    const { data: itens } = await supabase.from('itens_venda').select('*').eq('venda_id', vendaId);
    expect(itens).toHaveLength(1);
    expect(itens![0].qtd).toBe(1);

    const shortId = vendaId.slice(-6).toUpperCase();
    const { data: movs } = await supabase
      .from('movimentacoes_estoque')
      .select('*')
      .like('destino', `%${shortId}%`);
    expect(movs).toHaveLength(1);
    expect(movs![0].tipo).toBe('Saída');
    expect(movs![0].qtd).toBe(1);
  });
});
