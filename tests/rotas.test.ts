import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AULA_SUBMENUS, aulaSubmenuId } from '../src/lib/aulaModulos';

// Três listas precisam concordar e não têm como se cobrar sozinhas:
//
//   1. `menuModules` em App.tsx      — o que a sidebar mostra
//   2. o `switch (activeView)`       — o que sabe renderizar
//   3. `AULA_SUBMENUS`               — o que o professor consegue liberar
//
// Quando divergem o sintoma é mudo: submenu que cai no `default` ("Módulo em
// Desenvolvimento"), ou submenu que existe na sidebar mas some da aula porque
// a whitelist é fechada — foi assim que 'Recrutamento e Seleção' ficou
// inalcançável no Modo Aula desde a migr. 311.
//
// O parser lê App.tsx como texto de propósito: importar o módulo puxaria o app
// inteiro (lazy imports, contexts, supabase) para dentro do teste.

const APP = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');

/** Espelha o cálculo de viewId feito em SidebarNav. */
const viewIdDe = (modId: string, label: string) =>
  `${modId}-${label.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;

/** Extrai `{ modulo: [labels] }` do literal `menuModules`. */
function lerMenuModules(): Record<string, string[]> {
  const inicio = APP.indexOf('const menuModules');
  const fim = APP.indexOf('// Helpers: extrai label');
  expect(inicio, 'menuModules não encontrado em App.tsx').toBeGreaterThan(-1);
  expect(fim, 'fim de menuModules não encontrado').toBeGreaterThan(inicio);

  // `requireRole: ['admin','ceo']` tem strings que não são labels.
  const bloco = APP.slice(inicio, fim).replace(/require(Role|Setor):\s*\[[^\]]*\]/g, '');

  const out: Record<string, string[]> = {};
  for (const parte of bloco.split(/\n {2}\{\n/).slice(1)) {
    const id = parte.match(/id:\s*'([a-z-]+)'/)?.[1];
    const i = parte.indexOf('submenus:');
    if (!id || i < 0) continue;
    // Item de submenu é `'Label'` solto no array ou `{ label: 'Label', … }`.
    // Comentários com aspas simples ficariam de fora do array real, então a
    // fatia começa em `submenus:` e o ruído é sempre um label a mais — o teste
    // acusaria, e é isso que se quer de um guarda como este.
    const labels = [...parte.slice(i).matchAll(/(?:^|[[\s,])'([^']+)'|label:\s*'([^']+)'/g)]
      .map(m => m[1] ?? m[2])
      .filter(Boolean) as string[];
    out[id] = labels;
  }
  return out;
}

const menu = lerMenuModules();
const casos = new Set([...APP.matchAll(/case '([^']+)':/g)].map(m => m[1]));

// Labels que aparecem só em comentários dentro do bloco de submenus. Manter
// explícito é melhor que um parser esperto: quando alguém remove o comentário,
// o teste falha e a lista é corrigida junto.
const RUIDO_DE_COMENTARIO = new Set([
  'rh-pontoeletrônico',
  'rh-frequênciadetrabalho',
  'vendas-clienteespecial',
]);

describe('menuModules', () => {
  it('acha os módulos e submenus', () => {
    expect(Object.keys(menu).length).toBeGreaterThan(5);
    expect(menu.financeiro).toContain('Centros de Custo');
  });

  it('todo submenu tem case no switch de renderContent', () => {
    const orfas: string[] = [];
    for (const [mod, labels] of Object.entries(menu)) {
      for (const label of labels) {
        const view = viewIdDe(mod, label);
        if (RUIDO_DE_COMENTARIO.has(view)) continue;
        if (!casos.has(view)) orfas.push(`${mod} > "${label}" → ${view}`);
      }
    }
    expect(orfas, `submenus que cairiam no default ("Módulo em Desenvolvimento"):\n${orfas.join('\n')}`)
      .toEqual([]);
  });

  it('todo submenu é liberável no Modo Aula', () => {
    const faltando: string[] = [];
    for (const [mod, labels] of Object.entries(menu)) {
      const doAula = AULA_SUBMENUS[mod];
      if (!doAula) continue;  // módulo sem whitelist de submenu — tudo liberado
      for (const label of labels) {
        if (RUIDO_DE_COMENTARIO.has(viewIdDe(mod, label))) continue;
        if (!doAula.includes(label)) faltando.push(`${mod} > "${label}"`);
      }
    }
    expect(faltando, `submenus invisíveis no Modo Aula quando o professor restringe:\n${faltando.join('\n')}`)
      .toEqual([]);
  });
});

describe('AULA_SUBMENUS', () => {
  it('não oferece submenu que a sidebar não tem', () => {
    const fantasmas: string[] = [];
    for (const [mod, labels] of Object.entries(AULA_SUBMENUS)) {
      for (const label of labels) {
        if (!menu[mod]?.includes(label)) fantasmas.push(`${mod} > "${label}"`);
      }
    }
    expect(fantasmas, `o professor libera, mas não existe submenu correspondente:\n${fantasmas.join('\n')}`)
      .toEqual([]);
  });

  it('gera viewId que o switch conhece', () => {
    const orfas: string[] = [];
    for (const [mod, labels] of Object.entries(AULA_SUBMENUS)) {
      for (const label of labels) {
        const view = aulaSubmenuId(mod, label);
        if (!casos.has(view)) orfas.push(view);
      }
    }
    expect(orfas).toEqual([]);
  });
});
