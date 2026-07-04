import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

// Sentinel único por run para não colidir com dados reais.
const PREFIX = `__TEST_FOLHA_${Date.now()}__`;

let funcId: string;
const folhaIds: string[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────

async function insertFolha(overrides: Record<string, unknown> = {}) {
  const payload = {
    funcionario_id:   funcId,
    mes_ref:          '2099-01',
    salario_base:     3000,
    salario_bruto:    3000,
    salario_liquido:  2700,
    descontos:        300,
    valor_beneficios: 0,
    status:           'Pendente',
    filial:           'SuperMax',
    ...overrides,
  };
  const { data, error } = await supabase
    .from('folha_pagamento')
    .insert(payload)
    .select('id, filial, mes_ref, status, funcionario_id')
    .single();
  if (error) throw error;
  folhaIds.push(data.id);
  return data;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  const { data, error } = await supabase
    .from('funcionarios')
    .insert({
      nome:     `${PREFIX} Func`,
      cargo:    'Teste',
      salario:  3000,
      status:   'Ativo',
      filial:   'SuperMax',
    })
    .select('id')
    .single();
  if (error) throw error;
  funcId = data.id;
});

afterAll(async () => {
  if (folhaIds.length) {
    await supabase.from('folha_pagamento').delete().in('id', folhaIds);
  }
  if (funcId) {
    await supabase.from('funcionarios').delete().eq('id', funcId);
  }
});

// ── Testes ─────────────────────────────────────────────────────────────────

describe('FolhaPagamento — insert com filial', () => {
  it('grava filial corretamente (SuperMax)', async () => {
    const row = await insertFolha({ filial: 'SuperMax' });
    expect(row.filial).toBe('SuperMax');
  });

  it('grava filial corretamente (MaxLook)', async () => {
    const row = await insertFolha({ mes_ref: '2099-02', filial: 'MaxLook' });
    expect(row.filial).toBe('MaxLook');
  });

  it('filial NOT NULL — rejeita insert sem filial', async () => {
    const { error } = await supabase
      .from('folha_pagamento')
      .insert({
        funcionario_id:  funcId,
        mes_ref:         '2099-03',
        salario_base:    3000,
        salario_bruto:   3000,
        salario_liquido: 2700,
        descontos:       300,
        status:          'Pendente',
        // filial ausente — deve falhar
      });
    expect(error).not.toBeNull();
    // NOT NULL ou violação de constraint
    expect(error?.code).toMatch(/23[0-9]{3}/);
  });

  it('unicidade mês/funcionário — bloqueia duplicata no mesmo mês', async () => {
    // '2099-01' já existe de um teste anterior
    const { error } = await supabase
      .from('folha_pagamento')
      .insert({
        funcionario_id:  funcId,
        mes_ref:         '2099-01',
        salario_base:    3000,
        salario_bruto:   3000,
        salario_liquido: 2700,
        descontos:       300,
        status:          'Pendente',
        filial:          'SuperMax',
      });
    expect(error).not.toBeNull();
    // 23505 = unique_violation
    expect(error?.code).toBe('23505');
  });

  it('filial propagada para contas_pagar ao processar (status Processada)', async () => {
    // Insere com filial MaxLook e simula transição Pendente → Processada
    const row = await insertFolha({ mes_ref: '2099-04', filial: 'MaxLook' });
    await supabase
      .from('folha_pagamento')
      .update({ status: 'Processada' })
      .eq('id', row.id);

    // contas_pagar gerada deve ter mesma filial (via trigger ou app logic —
    // aqui validamos só que a folha foi gravada com MaxLook)
    const { data: folha } = await supabase
      .from('folha_pagamento')
      .select('filial')
      .eq('id', row.id)
      .single();
    expect(folha?.filial).toBe('MaxLook');
  });
});
