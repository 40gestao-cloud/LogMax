import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from './setup';

// Valida o comportamento que useFetchData replica internamente:
// .from(table).select('*').eq('filial', filial)
// Aqui testamos a camada Supabase diretamente — sem montar o hook React.

const PREFIX = `__TEST_FILIAL_${Date.now()}__`;

const funcIds: string[] = [];

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  const rows = [
    { nome: `${PREFIX} SM1`, cargo: 'Teste', salario: 1000, status: 'Ativo', filial: 'SuperMax' },
    { nome: `${PREFIX} SM2`, cargo: 'Teste', salario: 1000, status: 'Ativo', filial: 'SuperMax' },
    { nome: `${PREFIX} ML1`, cargo: 'Teste', salario: 1000, status: 'Ativo', filial: 'MaxLook' },
    { nome: `${PREFIX} TM1`, cargo: 'Teste', salario: 1000, status: 'Ativo', filial: 'TechMax' },
  ];
  const { data, error } = await supabase
    .from('funcionarios')
    .insert(rows)
    .select('id');
  if (error) throw error;
  funcIds.push(...(data ?? []).map(r => r.id));
});

afterAll(async () => {
  if (funcIds.length) {
    await supabase.from('funcionarios').delete().in('id', funcIds);
  }
});

// ── Testes ─────────────────────────────────────────────────────────────────

describe('useFetchData — extraFilter de filial', () => {
  it('filial=SuperMax retorna só registros SuperMax do sentinel', async () => {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, filial')
      .in('id', funcIds)
      .eq('filial', 'SuperMax');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.every(r => r.filial === 'SuperMax')).toBe(true);
  });

  it('filial=MaxLook retorna só o registro MaxLook do sentinel', async () => {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, filial')
      .in('id', funcIds)
      .eq('filial', 'MaxLook');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].filial).toBe('MaxLook');
  });

  it('filial=TechMax retorna só o registro TechMax do sentinel', async () => {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, filial')
      .in('id', funcIds)
      .eq('filial', 'TechMax');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].filial).toBe('TechMax');
  });

  it('sem filtro de filial retorna todos os sentinels (4 registros)', async () => {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, filial')
      .in('id', funcIds);
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
  });

  it('filial=Matriz retorna zero registros (filial não operacional)', async () => {
    const { data, error } = await supabase
      .from('funcionarios')
      .select('id, filial')
      .in('id', funcIds)
      .eq('filial', 'Matriz');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
