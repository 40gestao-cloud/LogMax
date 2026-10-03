import { describe, it, expect } from 'vitest';
import { aulaConfigEfetiva, aulaFiltraUsuario, aulaPermiteView, aulaSetoresConcedidos } from '../src/lib/aulaModulos';
import type { AulaConfig } from '../src/hooks/useAulaConfig';

// Grupo de apoio (migr. 669): a escolha da config no front tem de bater com a
// de `auth_aula_setores()` no banco.

const turma: AulaConfig = {
  ativo: true,
  modulos_ativos: ['compras'],
  submenus_ativos: [],
  roles_afetados: ['colaborador', 'gerente'],
  atualizado_em: null,
};
const grupoLigado = { ativo: true, modulos_ativos: ['rh'], submenus_ativos: ['rh-cargos'], atualizado_em: null };

describe('Grupo de apoio — config que vale', () => {
  it('integrante com o grupo ligado segue o grupo', () => {
    const c = aulaConfigEfetiva(turma, { membro: true, config: grupoLigado }, 'colaborador');
    expect(c.modulos_ativos).toEqual(['rh']);
    expect(aulaSetoresConcedidos(c, { role: 'colaborador' })).toEqual(['rh']);
    expect(aulaPermiteView(c, { role: 'colaborador' }, 'rh-cargos')).toBe(true);
    expect(aulaPermiteView(c, { role: 'colaborador' }, 'compras-pedidos')).toBe(false);
  });

  it('o grupo filtra qualquer papel, mesmo fora do alvo da turma', () => {
    const c = aulaConfigEfetiva(turma, { membro: true, config: grupoLigado }, 'ceo');
    expect(aulaFiltraUsuario(c, { role: 'ceo' })).toBe(true);
  });

  it('com a aula da turma desligada, o grupo ligado ainda vale', () => {
    const c = aulaConfigEfetiva({ ...turma, ativo: false }, { membro: true, config: grupoLigado }, 'colaborador');
    expect(aulaFiltraUsuario(c, { role: 'colaborador' })).toBe(true);
  });

  it('grupo desligado, quem está fora e o admin seguem a turma', () => {
    expect(aulaConfigEfetiva(turma, { membro: true, config: { ...grupoLigado, ativo: false } }, 'colaborador')).toBe(turma);
    expect(aulaConfigEfetiva(turma, { membro: false, config: grupoLigado }, 'colaborador')).toBe(turma);
    expect(aulaConfigEfetiva(turma, { membro: true, config: null }, 'colaborador')).toBe(turma);
    expect(aulaConfigEfetiva(turma, { membro: true, config: grupoLigado }, 'admin')).toBe(turma);
  });
});
