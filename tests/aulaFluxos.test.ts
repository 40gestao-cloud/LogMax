import { describe, it, expect } from 'vitest';
import {
  AULA_FLUXOS, analisarCadeias, etapaCoberta, configDoFluxo, completarComFluxo,
  modulosDoFluxo, submenusDoFluxo, etapasObrigatorias,
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

  it('requisicoes+compras sem Financeiro acusa a compra quebrada', () => {
    // O caso que motivou a feature: a cotação fica presa em "Aguardando
    // Financeiro". Com 'requisicoes' ligado a turma consegue começar o fluxo,
    // que é o critério do alerta.
    const quebradas = analisarCadeias(['requisicoes', 'cadastros', 'compras', 'estoque'], []);
    const compra = quebradas.find(c => c.fluxo.id === 'compra');
    expect(compra).toBeDefined();
    expect(compra!.faltando.some(e => e.modulo === 'financeiro')).toBe(true);
  });

  it('ligar só Financeiro não despeja alerta de todo fluxo que o toca', () => {
    // Financeiro aparece em cinco fluxos. Alertar em todos treinava o
    // professor a ignorar o painel; só alerta quem a turma consegue começar
    // ou quem já tem metade da cadeia de pé.
    const quebradas = analisarCadeias(['financeiro'], []);
    expect(quebradas.length).toBeLessThanOrEqual(2);
    // Compra começa em Requisições, que está desligado: não é a aula de hoje.
    expect(quebradas.map(c => c.fluxo.id)).not.toContain('compra');
  });

  it('etapa opcional desligada não deixa o fluxo incompleto', () => {
    const compra = AULA_FLUXOS.find(f => f.id === 'compra')!;
    const opcionais = compra.etapas.filter(e => e.opcional);
    expect(opcionais.length).toBeGreaterThan(0);

    // Liga tudo menos as opcionais.
    const { modulos } = configDoFluxo(compra);
    const submenus = etapasObrigatorias(compra)
      .filter(e => e.view.startsWith(`${e.modulo}-`))
      .map(e => e.view);
    const quebradas = analisarCadeias(modulos, submenus).map(c => c.fluxo.id);
    expect(quebradas).not.toContain('compra');
  });

  it('governança não passa mais por Auditoria', () => {
    // Comitê de Auditoria, trilha e Matriz de Riscos saíram em 2026-08-08.
    // Se o módulo voltar ao fluxo, o professor libera algo que não existe.
    const gov = AULA_FLUXOS.find(f => f.id === 'governanca')!;
    expect(modulosDoFluxo(gov)).not.toContain('auditoria');
    expect(modulosDoFluxo(gov)).not.toContain('riscos');
  });

  it('material do almoxarifado é um fluxo próprio e não passa por Compras', () => {
    // O contraste com o fluxo de compra é a lição; se este fluxo encostasse
    // em 'compras', ela se perderia.
    const material = AULA_FLUXOS.find(f => f.id === 'material');
    expect(material).toBeDefined();
    expect(modulosDoFluxo(material!)).not.toContain('compras');
    expect(modulosDoFluxo(material!)).not.toContain('financeiro');
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

  it('submenusDoFluxo só devolve view com prefixo de módulo', () => {
    // View top-level não entra em `submenus_ativos`; se vazasse pra lá, a
    // whitelist do módulo passaria a excluir os submenus de verdade.
    for (const f of AULA_FLUXOS) {
      for (const s of submenusDoFluxo(f)) {
        expect(s, `${f.id}: ${s}`).toMatch(/^[a-z-]+-.+/);
        expect(modulosDoFluxo(f).some(m => s.startsWith(`${m}-`)), s).toBe(true);
      }
    }
  });
});
