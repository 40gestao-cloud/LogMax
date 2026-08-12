// Casamento tarefa ↔ aluno na «Atividade da aula».
//
// O destaque «Você» é heurística sobre texto livre, e a primeira versão usava
// `includes`: 'ti' casava dentro de "markeTIng" e "logísTIca", 'ia' dentro de
// "filIAl". O aluno de TI abria a atividade e via as tarefas de Marketing
// marcadas como dele.
//
// Este teste é estático de propósito (não fala com o banco): ele cobra o
// casamento contra os papéis REAIS de `AULA_FLUXOS`, que é onde a regressão
// apareceria de novo — basta alguém escrever um papel novo com uma sílaba
// infeliz.

import { describe, it, expect } from 'vitest';
import { termosDoAluno, tarefaEhDoAluno } from '../src/lib/aulaAtividade';
import { AULA_FLUXOS } from '../src/lib/aulaFluxos';

const PAPEIS = Array.from(new Set(AULA_FLUXOS.flatMap(f => f.etapas.map(e => e.quem))));

const casadosPara = (setor: string, role = 'colaborador') => {
  const termos = termosDoAluno({ role, setor, setores_extras: [] });
  return PAPEIS.filter(p => tarefaEhDoAluno(p, termos));
};

describe('termosDoAluno', () => {
  it('não distingue ninguém quando o perfil vê tudo', () => {
    expect(termosDoAluno({ role: 'colaborador', setor: 'all', setores_extras: [] })).toEqual([]);
    expect(termosDoAluno(null)).toEqual([]);
  });

  it('inclui os setores extras, não só o principal', () => {
    const termos = termosDoAluno({ role: 'gerente', setor: 'vendas', setores_extras: ['financeiro'] });
    expect(termos).toContain('vendas');
    expect(termos).toContain('financeiro');
    expect(termos).toContain('gerente');
  });
});

describe('tarefaEhDoAluno', () => {
  it('sem termos não casa nada — destaque desligado, não destaque universal', () => {
    for (const p of PAPEIS) expect(tarefaEhDoAluno(p, [])).toBe(false);
  });

  it('casa o setor citado no papel', () => {
    expect(casadosPara('compras')).toContain('Setor de Compras');
    expect(casadosPara('vendas')).toContain('Setor de Vendas');
    expect(casadosPara('estoque')).toContain('Setor de Estoque');
    expect(casadosPara('rh')).toContain('Setor de RH');
  });

  it('ignora acento — "Logística" no papel, "logistica" no perfil', () => {
    expect(casadosPara('logistica')).toContain('Setor de Estoque / Logística');
  });

  it('NÃO casa termo curto no meio de outra palavra', () => {
    // 'ti' dentro de markeTIng / logísTIca
    const ti = casadosPara('ti');
    expect(ti.some(p => /marketing/i.test(p))).toBe(false);
    expect(ti.some(p => /log/i.test(p))).toBe(false);
    // 'ia' dentro de filIAl
    const ia = casadosPara('ia');
    expect(ia.some(p => /filial/i.test(p))).toBe(false);
  });

  it('casa o papel pela role quando o papel fala de gerente', () => {
    const termos = termosDoAluno({ role: 'gerente', setor: 'vendas', setores_extras: [] });
    const gerenciais = PAPEIS.filter(p => /gerente/i.test(p));
    expect(gerenciais.length).toBeGreaterThan(0);
    for (const p of gerenciais) expect(tarefaEhDoAluno(p, termos)).toBe(true);
  });

  it('prefixo continua valendo para as variações do almoxarifado', () => {
    const termos = termosDoAluno({ role: 'colaborador', setor: 'logistica', setores_extras: [] });
    expect(tarefaEhDoAluno('Almoxarife da filial', termos)).toBe(true);
    expect(tarefaEhDoAluno('Responsável pelo almoxarifado', termos)).toBe(true);
  });
});
