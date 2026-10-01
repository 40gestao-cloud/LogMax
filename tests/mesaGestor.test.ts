import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mesa do Gestor (migr. 667/668): cada cartão traz no `view` o viewId da tela
// onde o documento se resolve, escrito à mão dentro do SQL. Se um submenu for
// renomeado, o slug muda, o `case` some do App e o botão do cartão passa a
// abrir "Módulo em Desenvolvimento" — sem erro nenhum, em produção. Este guarda
// lê a versão mais nova da `minha_mesa` e cobra a rota de cada viewId.

const DIR = resolve(__dirname, '../supabase/migrations');
const APP = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Texto da `minha_mesa` na migração mais nova que a (re)define. */
function minhaMesaVigente(): { arquivo: string; corpo: string } {
  const arquivos = readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const arquivo of arquivos.reverse()) {
    const sql = readFileSync(resolve(DIR, arquivo), 'utf8').replace(/\r\n/g, '\n');
    const ini = sql.indexOf('CREATE OR REPLACE FUNCTION public.minha_mesa(');
    if (ini < 0) continue;
    const fim = sql.indexOf('$function$;', ini);
    return { arquivo, corpo: sql.slice(ini, fim) };
  }
  throw new Error('nenhuma migração define public.minha_mesa');
}

describe('Mesa do Gestor', () => {
  const { arquivo, corpo } = minhaMesaVigente();
  const views = new Set<string>([
    ...[...corpo.matchAll(/'view',\s*'([^']+)'/g)].map(m => m[1]),
    ...[...corpo.matchAll(/THEN\s+'([a-z]+-[^']+)'/g)].map(m => m[1]),
  ]);

  it('a minha_mesa vigente aponta para telas', () => {
    expect(views.size, `nenhum viewId achado em ${arquivo}`).toBeGreaterThan(10);
  });

  it('todo viewId de cartão existe como rota no App', () => {
    const sem = [...views].filter(v => !APP.includes(`case '${v}':`));
    expect(sem, `viewId sem rota em App.tsx (vindo de ${arquivo})`).toEqual([]);
  });

  it('a própria Mesa tem rota e entra no Modo Aula', () => {
    expect(APP).toContain("case 'mesa-gestor':");
    const aula = readFileSync(resolve(__dirname, '../src/lib/aulaModulos.ts'), 'utf8');
    expect(aula).toMatch(/SEMPRE_LIBERADO[^;]*'mesa-gestor'/s);
  });
});
