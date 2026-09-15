#!/usr/bin/env node
// saude-turmas.mjs
// Olha os logs da API das 4 turmas e reprova quando a aula está sofrendo.
//
// POR QUE ISTO EXISTE
//
// Em 15/09 a logmax-contabilidade respondeu 504 em tudo — login incluído — das
// 14h05 às 14h11 e de novo das 14h21 às 14h28 (horário do Acre). Quem percebeu
// foi o professor, no meio da aula, pelo sintoma ("o app só fica carregando").
// Não havia nada olhando. As correções de hoje (597/598/599 no banco e a régua
// de realtime no app) tiram a causa conhecida; isto aqui é para a próxima, que
// será outra.
//
// Não virou endpoint na Vercel de propósito: o plano Hobby está em 12/12
// funções, e o cron de lá contaria como mais uma. Roda no GitHub Actions
// (.github/workflows/saude.yml), nas janelas de aula, e o job vermelho é o
// aviso. Também roda na mão, durante a aula: `npm run saude`.
//
// LIMITES (ajustáveis por flag)
//   504 em qualquer quantidade     → FALHA. É o sintoma exato de 15/09: a
//                                    requisição estoura o tempo no gateway e a
//                                    tela fica carregando para sempre.
//   5xx acima de 1% das respostas  → FALHA.
//   p95 acima de 2s (com ≥50 req)  → ALERTA. Foi o que ficou depois de baratear
//                                    a RLS, e é o aviso que antecede o 504.
//   401 acima de 20 (com ≥50 req)  → ALERTA. Sessão caindo em série: no dia,
//                                    máquinas seguiram consultando sem login.
//
// Turma sem tráfego na janela = "sem aula agora", não reprova.
//
// Requisitos: Node 18+ e SUPABASE_ACCESS_TOKEN (ambiente ou .env) — o mesmo do
// `npm run drift`. O token NUNCA é impresso, nem em erro.
//
// Uso:
//   npm run saude                    # últimos 20 minutos das 4 turmas
//   npm run saude -- --minutos=60
//   npm run saude -- --json          # para CI
//   npm run saude -- --p95=3000      # afrouxa o alerta de lentidão

import { readFileSync } from 'node:fs';

const PROJETOS_PADRAO = [
  { nome: 'LogMax-ERP',    ref: 'jvqsaccupxkvezriiede', periodo: 'manhã' },
  { nome: 'Aprendiz',      ref: 'ythesivrqzxhjueuwswq', periodo: 'manhã' },
  { nome: 'Contabilidade', ref: 'yinwjvadtbjgiksdadbt', periodo: 'tarde' },
  { nome: 'Adm',           ref: 'pvzfaejminpxkuuhilhz', periodo: 'tarde' },
];

const argv    = process.argv.slice(2);
const valorDe = (f) => argv.find(a => a.startsWith(`${f}=`))?.split('=')[1];
const JSON_OUT = argv.includes('--json');
const MINUTOS  = Number(valorDe('--minutos') ?? 20);
const LIMIAR_P95 = Number(valorDe('--p95') ?? 2000);
const LIMIAR_401 = Number(valorDe('--401') ?? 20);
/** Abaixo disso a turma não está em aula: nenhum limite se aplica, exceto 504. */
const MIN_TRAFEGO = 50;

if (argv.includes('--help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 40).join('\n'));
  process.exit(0);
}

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
    return { nome, ref, periodo: '—' };
  }).filter(p => p.nome && p.ref);
})();

// Dialeto do explorador de logs (BigQuery-like): `countIf` e `approx_quantiles`
// passam, `quantile(...)` não. Os campos da resposta moram em metadata.response,
// por isso os dois unnest.
const SQL = `
select
  count(*)                                                  as n,
  countIf(response.status_code = 504)                       as e504,
  countIf(response.status_code >= 500)                      as e5xx,
  countIf(response.status_code = 401)                       as e401,
  countIf(response.origin_time > 2000)                      as lentas,
  approx_quantiles(response.origin_time, 100)[offset(95)]   as p95,
  max(response.origin_time)                                 as pior
from edge_logs
cross join unnest(metadata) as m
cross join unnest(m.response) as response
`;

async function medir(ref, inicio, fim) {
  const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all`);
  url.searchParams.set('sql', SQL);
  url.searchParams.set('iso_timestamp_start', inicio);
  url.searchParams.set('iso_timestamp_end', fim);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${ref}: ${(await res.text()).slice(0, 300)}`);
  const corpo = await res.json();
  if (corpo.error) throw new Error(`Consulta recusada em ${ref}: ${String(corpo.error).slice(0, 200)}`);
  return corpo.result?.[0] ?? { n: 0 };
}

function avaliar(m) {
  const problemas = [];
  const n = Number(m.n ?? 0);
  const e504 = Number(m.e504 ?? 0);
  const e5xx = Number(m.e5xx ?? 0);
  const e401 = Number(m.e401 ?? 0);
  const p95  = Number(m.p95 ?? 0);

  if (e504 > 0) {
    problemas.push({ nivel: 'FALHA', texto: `${e504} respostas 504 (a tela fica carregando)` });
  }
  if (n >= MIN_TRAFEGO && e5xx / n > 0.01) {
    problemas.push({ nivel: 'FALHA', texto: `${e5xx} erros 5xx em ${n} respostas (${(100 * e5xx / n).toFixed(1)}%)` });
  }
  if (n >= MIN_TRAFEGO && p95 > LIMIAR_P95) {
    problemas.push({ nivel: 'ALERTA', texto: `p95 em ${Math.round(p95)} ms (limite ${LIMIAR_P95} ms)` });
  }
  if (n >= MIN_TRAFEGO && e401 > LIMIAR_401) {
    problemas.push({ nivel: 'ALERTA', texto: `${e401} respostas 401 — sessão caindo em série` });
  }
  return problemas;
}

const fim = new Date();
const inicio = new Date(fim.getTime() - MINUTOS * 60_000);
const janela = `${inicio.toISOString()} → ${fim.toISOString()} (${MINUTOS} min)`;

const relatorio = [];
for (const p of PROJETOS) {
  try {
    const m = await medir(p.ref, inicio.toISOString(), fim.toISOString());
    relatorio.push({ turma: p.nome, periodo: p.periodo, metricas: m, problemas: avaliar(m) });
  } catch (err) {
    relatorio.push({ turma: p.nome, periodo: p.periodo, erro: err.message, problemas: [{ nivel: 'FALHA', texto: `não deu para medir: ${err.message}` }] });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ janela, relatorio }, null, 2));
} else {
  console.log(`\nSaúde das turmas — ${janela}\n`);
  for (const r of relatorio) {
    const n = Number(r.metricas?.n ?? 0);
    if (!r.erro && n === 0) {
      console.log(`[ --  ] ${r.turma} (${r.periodo}): sem tráfego — ninguém em aula agora`);
      continue;
    }
    const pior = r.problemas.some(p => p.nivel === 'FALHA') ? 'FALHA'
      : r.problemas.length > 0 ? 'ALERTA' : 'OK  ';
    const m = r.metricas ?? {};
    const resumo = r.erro
      ? r.erro
      : `${n} req · 504=${m.e504 ?? 0} · 5xx=${m.e5xx ?? 0} · 401=${m.e401 ?? 0} · p95=${Math.round(Number(m.p95 ?? 0))}ms · pior=${Math.round(Number(m.pior ?? 0))}ms`;
    console.log(`[${pior}] ${r.turma} (${r.periodo}): ${resumo}`);
    for (const p of r.problemas) console.log(`         ${p.nivel}: ${p.texto}`);
  }
}

const reprovou = relatorio.some(r => r.problemas.length > 0);
if (reprovou && !JSON_OUT) {
  console.log(`
O que olhar primeiro:
  1. npm run rls:check            — policy recalculando por linha (o que derrubou 15/09)
  2. Logs do projeto no painel    — qual endpoint está estourando o tempo
  3. Se for uma tela só, ver se o hook dela passa por assinarRealtime
`);
}
process.exit(reprovou ? 1 : 0);
