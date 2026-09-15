#!/usr/bin/env node
// rls-check.mjs
// Procura, nos 4 bancos, policy que recalcula a identidade a cada linha.
//
// POR QUE ISTO EXISTE, SEPARADO DO DRIFT
//
// O `npm run drift` compara as 4 turmas ENTRE SI: ele acha o que está
// diferente. Uma policy crua nas quatro está "igual" e passa batido — foi
// exatamente o caso até 15/09, quando a logmax-contabilidade respondeu 504 em
// tudo (login incluído) com o banco sem lock e sem conexão esgotada. As helpers
// `auth_*` são SQL SECURITY DEFINER com search_path, o planner não inlina, e
// escritas cruas na policy rodavam de novo para cada linha: `aprovacoes_compras`
// (184 linhas) levava 380 ms por leitura.
//
// O teste `tests/reguaRls.test.ts` cobre as migrações NOVAS do repo. Este
// script cobre o que está APLICADO — policy criada direto no SQL Editor, ou
// migração aplicada em três turmas e esquecida na quarta, não passam pelo
// arquivo.
//
// Conserto: rodar de novo as migrações 597 e 598 no projeto apontado. As duas
// são idempotentes e só mexem no que ainda está cru.
//
// Requisitos e uso: iguais aos do schema-drift (SUPABASE_ACCESS_TOKEN no
// ambiente ou no .env).
//
//   npm run rls:check
//   npm run rls:check -- --json
//
// Sai 1 se achar policy crua. O token NUNCA é impresso, nem em erro.

import { readFileSync } from 'node:fs';

const PROJETOS_PADRAO = [
  { nome: 'LogMax-ERP',     ref: 'jvqsaccupxkvezriiede' },
  { nome: 'Aprendiz',       ref: 'ythesivrqzxhjueuwswq' },
  { nome: 'Contabilidade',  ref: 'yinwjvadtbjgiksdadbt' },
  { nome: 'Adm',            ref: 'pvzfaejminpxkuuhilhz' },
];

// Exceção consciente, a mesma da migr. 598: `filiais` usa
// COALESCE((detalhes ->> 'nicho'), 'Matriz') como argumento em 4 policies. A
// tabela tem uma linha por unidade — chamada por linha ali não custa nada.
const TABELAS_ISENTAS = new Set(['filiais']);

const PADROES = [
  {
    nome: 'helper sem argumento, crua',
    // O texto que o Postgres devolve do embrulho é `( SELECT auth_x() AS auth_x)`.
    re: /(?<!SELECT\s)\bauth_[a-z_]+\(\)/g,
  },
  { nome: 'auth.uid() cru',              re: /(?<!SELECT\s)\bauth\.uid\(\)/g },
  { nome: 'auth_in_setor(...) cru',      re: /(?<!SELECT\s)\bauth_in_setor\(/g },
  { nome: 'auth_pode_filial por linha',  re: /\bauth_pode_filial\(/g },
  { nome: 'auth_gerente_da por linha',   re: /\bauth_gerente_da\(/g },
];

const JSON_OUT = process.argv.includes('--json');

function tokenDoEnv() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    const linha = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .find(l => l.trim().startsWith('SUPABASE_ACCESS_TOKEN='));
    return linha?.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null;
  } catch {
    return null;
  }
}

const TOKEN = tokenDoEnv();
if (!TOKEN) {
  console.error('\nFalta SUPABASE_ACCESS_TOKEN (ambiente ou .env) — o mesmo do npm run drift.\n');
  process.exit(2);
}

const PROJETOS = (() => {
  const bruto = process.env.LOGMAX_PROJETOS;
  if (!bruto) return PROJETOS_PADRAO;
  return bruto.split(',').map(par => {
    const [nome, ref] = par.split(':').map(s => s.trim());
    return { nome, ref };
  }).filter(p => p.nome && p.ref);
})();

const SQL = `
  select tablename, policyname,
         coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
    from pg_policies
   where schemaname = 'public'
`;

async function consultar(ref, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${ref}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

function crusDe(linhas) {
  const achados = [];
  for (const l of linhas) {
    if (TABELAS_ISENTAS.has(l.tablename)) continue;
    for (const { nome, re } of PADROES) {
      const ocorrencias = String(l.expr).match(re);
      if (ocorrencias) {
        achados.push({
          policy: `${l.tablename}.${l.policyname}`,
          padrao: nome,
          exemplo: ocorrencias[0],
          vezes: ocorrencias.length,
        });
      }
    }
  }
  return achados;
}

const relatorio = [];
for (const projeto of PROJETOS) {
  const linhas = await consultar(projeto.ref, SQL);
  relatorio.push({ projeto: projeto.nome, total: linhas.length, crus: crusDe(linhas) });
}

if (JSON_OUT) {
  console.log(JSON.stringify(relatorio, null, 2));
} else {
  for (const r of relatorio) {
    if (r.crus.length === 0) {
      console.log(`[OK  ] ${r.projeto}: ${r.total} policies, nenhuma recalcula por linha`);
      continue;
    }
    console.log(`[FALHA] ${r.projeto}: ${r.crus.length} de ${r.total} policies recalculam por linha`);
    for (const c of r.crus.slice(0, 25)) {
      console.log(`         ${c.policy} — ${c.padrao} (${c.vezes}×): ${c.exemplo}`);
    }
    if (r.crus.length > 25) console.log(`         … e mais ${r.crus.length - 25}`);
  }
}

const falhou = relatorio.some(r => r.crus.length > 0);
if (falhou) {
  console.log('\nConserto: aplicar de novo as migrações 597 e 598 no projeto apontado — as duas são idempotentes.');
}
process.exit(falhou ? 1 : 0);
