import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Policy nova escrita com a chamada crua volta a rodar por linha.
//
// Em 15/09 a logmax-contabilidade respondeu 504 em tudo, login incluído, com o
// banco sem lock e sem conexão esgotada: as helpers `auth_*` são SQL SECURITY
// DEFINER com search_path — o planner não inlina — e, escritas cruas na policy,
// rodavam de novo para CADA linha, cada uma chamando outras por dentro.
// `aprovacoes_compras` (184 linhas) levava 380 ms por leitura.
//
// As migrações 597 e 598 normalizaram as 741 policies existentes:
//   - chamada sem dependência de linha vira `(SELECT auth_x())`, que o Postgres
//     calcula uma vez por consulta (InitPlan);
//   - `auth_pode_filial(X)` e `auth_gerente_da(X)` viram o corpo delas escrito
//     no lugar, com a parte fixa embrulhada.
//
// Nada impede a próxima migração de reintroduzir o padrão antigo — e o estrago
// só aparece com a turma cheia, semanas depois. Este guarda olha as migrações
// de 599 em diante (as antigas ficaram como estavam; o banco já foi
// normalizado por cima delas) e reprova a chamada crua DENTRO de DDL de policy.
//
// Fora de policy a chamada crua é normal: dentro do corpo de uma função, ou num
// SELECT de verificação, chamar `auth_is_admin()` é o uso correto.
//
// Rodar `597` e `598` de novo depois de uma migração que mexa em policy também
// resolve (as duas são idempotentes) — mas aí o defeito já foi para produção.

const DIR = resolve(__dirname, '../supabase/migrations');

/** A 598 é a última normalização; daqui para a frente o padrão é obrigatório. */
const PRIMEIRA_COBRADA = 599;

/** DDL de policy: é só aí que a chamada crua custa por linha. */
const DDL_POLICY = /\b(?:CREATE|ALTER)\s+POLICY\b[\s\S]*?;/gi;

const PADROES: { nome: string; re: RegExp; conserto: string }[] = [
  {
    nome: 'helper auth_* sem argumento, crua',
    // Lookbehind: `( SELECT auth_x() ...)` já está certo.
    re: /(?<!SELECT\s)\bauth_[a-z_]+\(\)/g,
    conserto: 'troque por (SELECT auth_x()) — array precisa de cast: ((SELECT auth_user_setores())::text[])',
  },
  {
    nome: 'auth.uid() cru',
    re: /(?<!SELECT\s)\bauth\.uid\(\)/g,
    conserto: 'troque por (SELECT auth.uid())',
  },
  {
    nome: 'auth_in_setor(...) cru',
    re: /(?<!SELECT\s)\bauth_in_setor\(/g,
    conserto: 'troque por (SELECT auth_in_setor(VARIADIC ARRAY[...]))',
  },
  {
    nome: 'auth_pode_filial(coluna) — roda por linha',
    re: /\bauth_pode_filial\(/g,
    conserto: 'escreva o corpo: ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = <coluna>))',
  },
  {
    nome: 'auth_gerente_da(coluna) — roda por linha',
    re: /\bauth_gerente_da\(/g,
    conserto: "escreva o corpo: (((SELECT auth_user_role()) = 'gerente'::text) AND ((SELECT auth_user_filial()) = <coluna>))",
  },
];

/** Tira comentário de linha e de bloco antes de procurar — comentário explica, não executa. */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function numeroDe(arquivo: string): number | null {
  const m = /^(\d+)_/.exec(arquivo);
  return m ? Number(m[1]) : null;
}

describe('régua de RLS nas migrações novas', () => {
  const arquivos = readdirSync(DIR)
    .filter(f => f.endsWith('.sql'))
    .filter(f => (numeroDe(f) ?? 0) >= PRIMEIRA_COBRADA);

  it('policy nova calcula a identidade uma vez por consulta, não por linha', () => {
    const achados: string[] = [];

    for (const arquivo of arquivos) {
      const sql = semComentarios(readFileSync(resolve(DIR, arquivo), 'utf8'));
      for (const ddl of sql.match(DDL_POLICY) ?? []) {
        for (const { nome, re, conserto } of PADROES) {
          const ocorrencias = ddl.match(new RegExp(re.source, 'g'));
          if (!ocorrencias) continue;
          achados.push(
            `${arquivo}: ${nome} (${ocorrencias.length}×) — ${ocorrencias[0]}\n     ${conserto}`,
          );
        }
      }
    }

    expect(achados, `\n${achados.join('\n  ')}\n`).toEqual([]);
  });

  it('o guarda reprova mesmo — padrão antigo é reconhecido', () => {
    // Guarda do guarda: sem isto, um erro de regex faria o teste passar sempre
    // e ninguém saberia até a próxima aula travar.
    const ruim = semComentarios(`
      -- auth_is_admin() aqui é comentário, não conta
      CREATE POLICY teste_select ON public.pedidos FOR SELECT TO authenticated
        USING (auth_is_admin() OR (criado_por = auth.uid()) OR COALESCE(auth_pode_filial(filial), false));
    `);
    const ddl = ruim.match(DDL_POLICY) ?? [];
    expect(ddl).toHaveLength(1);

    const pegos = PADROES
      .filter(p => new RegExp(p.re.source, 'g').test(ddl[0]))
      .map(p => p.nome);
    expect(pegos).toContain('helper auth_* sem argumento, crua');
    expect(pegos).toContain('auth.uid() cru');
    expect(pegos).toContain('auth_pode_filial(coluna) — roda por linha');

    // E o jeito certo passa limpo.
    const bom = `CREATE POLICY t ON public.pedidos FOR SELECT TO authenticated
        USING ((SELECT auth_is_admin()) OR (criado_por = (SELECT auth.uid()))
               OR ((SELECT auth_is_admin()) OR ((SELECT auth_user_filial()) = filial)));`;
    const sobrou = PADROES.filter(p => new RegExp(p.re.source, 'g').test(bom)).map(p => p.nome);
    expect(sobrou).toEqual([]);
  });

  it('a lista de migrações cobertas cresce sozinha', () => {
    // Guarda do guarda: se `PRIMEIRA_COBRADA` ficar para trás do repo por
    // engano (ex.: alguém renumerar), este teste não protege nada e é melhor
    // saber. Só confirma que o filtro é capaz de ver arquivo.
    const total = readdirSync(DIR).filter(f => f.endsWith('.sql')).length;
    expect(total).toBeGreaterThan(0);
    expect(PRIMEIRA_COBRADA).toBeGreaterThan(598);
  });
});
