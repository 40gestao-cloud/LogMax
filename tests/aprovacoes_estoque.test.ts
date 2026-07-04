import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

const PREFIX = `__TEST_APROV_${Date.now()}__`;

let produtoId: string;
let reqId: string;
let aprovId: string;
const movIds: string[] = [];

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Produto com estoque suficiente
  const { data: prod, error: pe } = await supabase
    .from('produtos')
    .insert({ codigo: PREFIX, nome: `${PREFIX} Prod`, preco: 10, estoque: 100, status: 'Ativo', filial: 'SuperMax' })
    .select('id').single();
  if (pe) throw pe;
  produtoId = prod.id;

  // Requisição de estoque pendente
  const { data: req, error: re } = await supabase
    .from('requisicoes_estoque')
    .insert({ produto_id: produtoId, qtd: 5, destino: 'Teste', status: 'Pendente', filial: 'SuperMax' })
    .select('id').single();
  if (re) throw re;
  reqId = req.id;

  // Aprovação pendente vinculada
  const { data: aprov, error: ae } = await supabase
    .from('aprovacoes_estoque')
    .insert({ requisicao_estoque_id: reqId, status: 'Pendente', filial: 'SuperMax' })
    .select('id').single();
  if (ae) throw ae;
  aprovId = aprov.id;
});

afterAll(async () => {
  if (movIds.length) await supabase.from('movimentacoes_estoque').delete().in('id', movIds);
  if (aprovId) await supabase.from('aprovacoes_estoque').delete().eq('id', aprovId);
  if (reqId)   await supabase.from('requisicoes_estoque').delete().eq('id', reqId);
  if (produtoId) await supabase.from('produtos').delete().eq('id', produtoId);
});

// ── Helper ─────────────────────────────────────────────────────────────────

async function insertMovimentacao() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('movimentacoes_estoque')
    .insert({
      produto_id:            produtoId,
      tipo:                  'Saída',
      qtd:                   5,
      origem:                'Requisição de Estoque',
      destino:               'Solicitado',
      data:                  today,
      requisicao_estoque_id: reqId,
      filial:                'SuperMax',
    })
    .select('id')
    .single();
  return { data, error };
}

// ── Testes ─────────────────────────────────────────────────────────────────

describe('AprovacoesEstoque — idempotência de movimentação', () => {
  it('primeiro insert de movimentacao_estoque é aceito', async () => {
    const { data, error } = await insertMovimentacao();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    movIds.push(data!.id);
  });

  it('segundo insert com mesmo requisicao_estoque_id viola UNIQUE (23505)', async () => {
    const { error } = await insertMovimentacao();
    // uq_mov_estoque_por_requisicao_estoque — constraint de idempotência
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');
    expect(error?.message).toMatch(/uq_mov_estoque_por_requisicao_estoque|duplicate key value/i);
  });

  it('apenas uma movimentacao existe para a requisição após duplo insert', async () => {
    const { data } = await supabase
      .from('movimentacoes_estoque')
      .select('id')
      .eq('requisicao_estoque_id', reqId);
    expect(data).toHaveLength(1);
  });

  it('aprovacao pode ser marcada Aprovado sem duplicar movimentação', async () => {
    await supabase
      .from('aprovacoes_estoque')
      .update({ status: 'Aprovado' })
      .eq('id', aprovId);
    const { data } = await supabase
      .from('aprovacoes_estoque')
      .select('status')
      .eq('id', aprovId)
      .single();
    expect(data?.status).toBe('Aprovado');
    // Movimentações permanecem com exatamente 1 registro
    const { data: movs } = await supabase
      .from('movimentacoes_estoque')
      .select('id')
      .eq('requisicao_estoque_id', reqId);
    expect(movs).toHaveLength(1);
  });
});
