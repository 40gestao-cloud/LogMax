import { describe, it, expect } from 'vitest';
import {
  AULA_FLUXOS, analisarCadeias, etapaCoberta, configDoFluxo, completarComFluxo,
  modulosDoFluxo, submenusDoFluxo,
} from '../src/lib/aulaFluxos';
import { AULA_MODULOS, AULA_SUBMENUS, aulaSubmenuId } from '../src/lib/aulaModulos';

// Os fluxos de aula são uma lista escrita à mão que referencia viewIds gerados
// por `aulaSubmenuId` a partir de labels com acento e espaço
// ('Aprovações de Cotação' → 'financeiro-aprovaçõesdecotação'). Um caractere
// fora do lugar não quebra nada visível: a etapa simplesmente nunca conta como
// coberta, o fluxo nunca fecha e a tela acusa "cadeia incompleta" para sempre.
// Estes testes existem para que isso apareça no CI, não na aula.

const IDS_MODULO = new Set(AULA_MODULOS.map(m => m.id));

describe('AULA_FLUXOS — integridade das referências', () => {
  it('toda etapa aponta para um módulo que existe no catálogo', () => {
    for (const f of AULA_FLUXOS) {
      for (const e of f.etapas) {
        expect(IDS_MODULO, `${f.id} › ${e.titulo}`).toContain(e.modulo);
      }
    }
  });

  it('toda etapa de submenu corresponde a um submenu real do módulo', () => {
    for (const f of AULA_FLUXOS) {
      for (const e of f.etapas) {
        if (!e.view.startsWith(`${e.modulo}-`)) continue;  // view top-level
        const validos = (AULA_SUBMENUS[e.modulo] ?? []).map(l => aulaSubmenuId(e.modulo, l));
        expect(validos, `${f.id} › ${e.titulo} (${e.view})`).toContain(e.view);
      }
    }
  });

  it('não há id de fluxo repetido', () => {
    const ids = AULA_FLUXOS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo fluxo atravessa mais de um módulo', () => {
    // Um "fluxo" contido num módulo só não ensina integração — e não teria
    // motivo para existir aqui em vez de virar um atalho por módulo.
    for (const f of AULA_FLUXOS) {
      expect(modulosDoFluxo(f).length, f.id).toBeGreaterThan(1);
    }
  });
});

describe('AULA_FLUXOS — cobertura e alertas', () => {
  it('montar um fluxo cobre todas as suas etapas', () => {
    for (const f of AULA_FLUXOS) {
      const { modulos, submenus } = configDoFluxo(f);
      for (const e of f.etapas) {
        expect(etapaCoberta(e, modulos, submenus), `${f.id} › ${e.titulo}`).toBe(true);
      }
    }
  });

  it('fluxo montado não gera alerta de cadeia quebrada para ele mesmo', () => {
    for (const f of AULA_FLUXOS) {
      const { modulos, submenus } = configDoFluxo(f);
      const quebradas = analisarCadeias(modulos, submenus).map(c => c.fluxo.id);
      expect(quebradas, f.id).not.toContain(f.id);
    }
  });

  it('config vazia não acusa nenhuma cadeia quebrada', () => {
    // Sem nada ligado não há fluxo "começado" — acusar tudo seria ruído.
    expect(analisarCadeias([], [])).toHaveLength(0);
  });

  it('o atalho Logística acusa a compra quebrada no Financeiro', () => {
    // O caso que motivou a feature: cadastros+compras+estoque sem Financeiro
    // deixa a cotação presa em "Aguardando Financeiro".
    const quebradas = analisarCadeias(['cadastros', 'compras', 'estoque'], []);
    const compra = quebradas.find(c => c.fluxo.id === 'compra');
    expect(compra).toBeDefined();
    expect(compra!.faltando.some(e => e.modulo === 'financeiro')).toBe(true);
  });

  it('completar a cadeia fecha o fluxo sem descartar o que já estava ligado', () => {
    const modulos = ['compras', 'estoque', 'rh'];
    const compra = AULA_FLUXOS.find(f => f.id === 'compra')!;
    const cfg = completarComFluxo(compra, modulos, []);
    expect(cfg.modulos).toContain('rh');          // preservado
    expect(cfg.modulos).toContain('financeiro');  // acrescentado
    for (const e of compra.etapas) {
      expect(etapaCoberta(e, cfg.modulos, cfg.submenus), e.titulo).toBe(true);
    }
  });

  it('completar não cria whitelist de submenu em módulo que estava inteiro liberado', () => {
    // 'compras' entra sem whitelist: restringi-lo ao completar tiraria telas
    // que o professor tinha deliberadamente deixado abertas.
    const compra = AULA_FLUXOS.find(f => f.id === 'compra')!;
    const cfg = completarComFluxo(compra, ['compras'], []);
    expect(cfg.submenus.some(s => s.startsWith('compras-'))).toBe(false);
    expect(cfg.submenus.some(s => s.startsWith('financeiro-'))).toBe(true);
  });

  it('submenusDoFluxo ignora views top-level', () => {
    const gov = AULA_FLUXOS.find(f => f.id === 'governanca')!;
    expect(submenusDoFluxo(gov)).not.toContain('comite-auditoria');
    expect(modulosDoFluxo(gov)).toContain('auditoria');
  });
});
