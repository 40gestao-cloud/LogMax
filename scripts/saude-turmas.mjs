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
// ─── A MEDIDA É POR MINUTO, E ISSO É O PONTO ───────────────────────────────
//
// Este vigia falhou nas duas quedas que existiram. Em 15/09 ele ainda não
// existia. Em 22/09 ele existia, rodou às 19:43 UTC, olhou os 20 minutos
// anteriores (19:23 em diante) — e a queda foi 19:03–19:11. Passou verde.
//
// O agendamento do GitHub é a primeira metade do problema: o cron pede a cada
// 15 min e o que chega é aproximadamente de hora em hora (em 22/09: 16:04,
// 19:43, 20:52). Janela de 20 min com folga real de 70 min deixa buraco por
// onde cabe a aula inteira. Isso se conserta alargando a janela.
//
// Mas alargar a janela quebrava o critério, que era a segunda metade. Medido
// aqui: a queda de 22/09 numa janela de 480 min dá p95 de 3.131 ms — a mesma
// queda que teve minutos a 190.000 ms. Percentil e porcentagem DILUEM; só a
// contagem de 504 sobreviveu, e foi ela que reprovou.
//
// E a contagem de 504 é justamente o que vamos deixar de ter. O disjuntor
// (src/lib/disjuntor.ts) abre no primeiro 504 e corta a leitura automática —
// ele existe para impedir a cascata que produzia os 272. A próxima queda vai
// ser curta, com poucos ou nenhum 504, e teria ficado invisível para a versão
// anterior deste script.
//
// Por isso a avaliação passou a ser por MINUTO. Numa janela larga, uma queda de
// oito minutos aparece como oito minutos ruins, e uma de trinta segundos
// aparece como um. Diluição deixa de existir, e a janela pode ser generosa sem
// custo nenhum de sensibilidade.
//
// LIMITES (ajustáveis por flag)
//   504 em qualquer quantidade     → FALHA. O sintoma exato das duas quedas: a
//                                    requisição estoura no gateway e a tela
//                                    fica carregando para sempre.
//   p50 de um minuto acima de 3s   → FALHA. "A sala inteira esperando": metade
//                                    das respostas daquele minuto. No dia 22
//                                    foram minutos a 149s, 101s, 83s, 53s.
//                                    Percentil por minuto não dilui.
//   5xx acima de 1% num minuto     → FALHA.
//   3+ respostas acima de 5s num   → ALERTA. É LITERALMENTE a régua do
//   minuto                           disjuntor no cliente (3 faltas seguidas
//                                    acima de 5s abrem). Se este alerta acende,
//                                    alguma máquina abriu o disjuntor — é o
//                                    começo do laço, antes do 504. A métrica
//                                    `lentas` já era calculada e nunca tinha
//                                    sido usada para nada.
//   401 acima de 20 na janela      → ALERTA. Sessão caindo em série.
//
// O p95 aparece no relatório e NÃO reprova — ver o comentário em LIMIAR_P50.
//
// Minuto com pouco tráfego não é avaliado (ver MIN_TRAFEGO_MINUTO): duas
// requisições lentas às 3 da manhã não são aula travando.
//
// Turma sem tráfego na janela = "sem aula agora", não reprova.
//
// Erro AO MEDIR é outra coisa: rede caindo entre o runner e a api.supabase.com
// não diz nada sobre a aula. Esses (e 429/5xx da API) são tentados 3 vezes e,
// se persistirem, saem como INDET — aparecem no relatório e não reprovam.
// Token recusado (401/403) e consulta malformada continuam FALHA: é problema
// do vigia, e vigia quebrado em silêncio é como este script passou dois dias
// sem medir nada.
//
// Requisitos: Node 18+ e SUPABASE_ACCESS_TOKEN (ambiente ou .env) — o mesmo do
// `npm run drift`. O token NUNCA é impresso, nem em erro.
//
// Uso:
//   npm run saude                    # últimas 2 horas das 4 turmas
//   npm run saude -- --minutos=480   # a aula inteira (máximo da API: 24h)
//   npm run saude -- --json          # para CI
//   npm run saude -- --p50=5000      # afrouxa o "sala travada"
//   npm run saude -- --fim=2026-09-22T20:00:00Z --minutos=90
//                                    # janela que termina no passado, para
//                                    # investigar a aula de ontem (a API dos
//                                    # logs guarda 24h)

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
// 120 min por padrão, e não 20. Com a avaliação por minuto, janela larga não
// custa sensibilidade — e é o que cobre a folga real entre execuções do cron do
// GitHub, que pede 15 min e entrega ~70.
const MINUTOS  = Number(valorDe('--minutos') ?? 120);
// NÃO existe limiar de p95, e havia. O p95 POR MINUTO grita à toa: medido na
// hora saudável de 22/09 na Contabilidade (18:00–19:00 UTC, 12.834 requisições,
// zero 504, zero 5xx), ele acusaria 3 minutos dos 60. Com ~200 requisições por
// minuto, o p95 são as 10 mais lentas, e duas ou três respostas de 2–3s numa
// sala cheia é o normal — o p95 da JANELA inteira escondia isso, o do minuto
// não. Alarme que às vezes mente é alarme que se aprende a ignorar.
//
// O que ficou no lugar, medido na mesma hora saudável e quieto nela:
//   p50 do minuto  — nunca passou de 171 ms com a sala inteira trabalhando
//   `lentas` >= 3  — nunca chegou a 3 (a pior resposta da hora foi uma, 6.165 ms)
// O p95 continua no relatório, como informação; só não reprova nada.
const LIMIAR_P50 = Number(valorDe('--p50') ?? 3000);
const LIMIAR_401 = Number(valorDe('--401') ?? 20);
/** Respostas acima disto o disjuntor do cliente conta como falta. Mesmo número
 *  do `LIMIAR_LENTO_MS` em src/lib/disjuntor.ts — se um mudar, o outro muda. */
const LIMIAR_LENTA_MS = 5000;
/** Faltas num minuto que indicam que alguma máquina abriu o disjuntor. Mesmo
 *  número do `FALTAS_PARA_ABRIR` de lá. */
const LENTAS_PARA_ALERTA = 3;
/** Abaixo disso a turma não está em aula: nenhum limite se aplica, exceto 504. */
const MIN_TRAFEGO = 50;
/** Minuto com menos que isto não é avaliado — percentil de 5 requisições diz
 *  mais sobre o azar de quem clicou do que sobre a aula. */
const MIN_TRAFEGO_MINUTO = 20;

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
// Uma linha por MINUTO. `minuto` volta em microssegundos desde a época (é o
// tipo TIMESTAMP do dialeto), por isso a divisão por 1000 ao formatar.
//
// `order by` + `limit` NÃO entram: precisamos de todos os minutos da janela para
// avaliar cada um. A janela é de horas, então são centenas de linhas — barato.
const SQL = `
select
  timestamp_trunc(t.timestamp, minute)                                as minuto,
  count(*)                                                            as n,
  countIf(response.status_code = 504)                                 as e504,
  countIf(response.status_code >= 500)                                as e5xx,
  countIf(response.status_code = 401)                                 as e401,
  countIf(response.origin_time > ${LIMIAR_LENTA_MS})                  as lentas,
  approx_quantiles(response.origin_time, 100)[offset(50)]             as p50,
  approx_quantiles(response.origin_time, 100)[offset(95)]             as p95,
  max(response.origin_time)                                           as pior
from edge_logs t
cross join unnest(t.metadata) as m
cross join unnest(m.response) as response
group by minuto
`;

// Um erro AO MEDIR não é a mesma coisa que uma turma doente, e tratar os dois
// igual estraga o alarme. Blip de rede do runner ("fetch failed") pintava o job
// de vermelho como se a aula estivesse caindo — aconteceu aqui em 17/09, duas
// turmas "FALHA" numa execução e as mesmas duas OK na seguinte, segundos
// depois. Alarme que às vezes mente é alarme que se aprende a ignorar, que é
// exatamente o que este script existe para não ser.
//
// A divisão é entre o que melhora sozinho e o que não melhora:
//   transporte, 429, 5xx da própria api.supabase.com → tenta de novo;
//   401/403 (token errado) e consulta recusada       → não adianta insistir.
// O segundo grupo continua reprovando o job, e tem de continuar: foi um token
// ausente que deixou este vigia cego por dois dias sem ninguém notar.
const TENTATIVAS = 3;
const ESPERA_MS  = [800, 2500];

function transitorio(err) {
  return err?.transitorio === true;
}

async function medirUmaVez(ref, inicio, fim) {
  const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all`);
  url.searchParams.set('sql', SQL);
  url.searchParams.set('iso_timestamp_start', inicio);
  url.searchParams.set('iso_timestamp_end', fim);

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  } catch (err) {
    // DNS, TLS, socket derrubado: nada disso fala sobre a turma.
    const e = new Error(`falha de rede ao falar com a API (${err?.message ?? 'fetch failed'})`);
    e.transitorio = true;
    throw e;
  }

  if (!res.ok) {
    const corpo = (await res.text()).slice(0, 300);
    const e = new Error(`HTTP ${res.status} em ${ref}: ${corpo}`);
    e.transitorio = res.status === 429 || res.status >= 500;
    throw e;
  }

  const corpo = await res.json();
  if (corpo.error) throw new Error(`Consulta recusada em ${ref}: ${String(corpo.error).slice(0, 200)}`);
  return corpo.result ?? [];
}

async function medir(ref, inicio, fim) {
  let ultimo;
  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      return await medirUmaVez(ref, inicio, fim);
    } catch (err) {
      ultimo = err;
      if (!transitorio(err) || i === TENTATIVAS - 1) throw err;
      await new Promise(r => setTimeout(r, ESPERA_MS[i] ?? 2500));
    }
  }
  throw ultimo;
}

/** Hora do relógio da turma. O fuso da operação é o Acre, nunca São Paulo —
 *  relatório em UTC obriga o professor a fazer conta de cabeça no meio da aula. */
const horaAcre = (microssegundos) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco', hour: '2-digit', minute: '2-digit',
}).format(new Date(Number(microssegundos) / 1000));

const num = (v) => Number(v ?? 0);

/**
 * Soma a janela e avalia MINUTO A MINUTO.
 *
 * Devolve também `pioresMinutos` — os minutos que reprovaram, em ordem de
 * gravidade. É o que transforma "a turma está mal" em "às 14h06 metade das
 * respostas levou 101 s", que é a diferença entre um alarme e um diagnóstico.
 */
function avaliar(linhas) {
  const minutos = (Array.isArray(linhas) ? linhas : []).map(l => ({
    minuto: l.minuto,
    n: num(l.n), e504: num(l.e504), e5xx: num(l.e5xx), e401: num(l.e401),
    lentas: num(l.lentas), p50: num(l.p50), p95: num(l.p95), pior: num(l.pior),
  }));

  const total = minutos.reduce((a, m) => ({
    n: a.n + m.n, e504: a.e504 + m.e504, e5xx: a.e5xx + m.e5xx,
    e401: a.e401 + m.e401, lentas: a.lentas + m.lentas,
    p50: Math.max(a.p50, m.p50), p95: Math.max(a.p95, m.p95),
    pior: Math.max(a.pior, m.pior),
  }), { n: 0, e504: 0, e5xx: 0, e401: 0, lentas: 0, p50: 0, p95: 0, pior: 0 });

  const problemas = [];

  // 504 conta na janela inteira: um só já é a tela pendurada de alguém, e não
  // depende de o minoto ter movimento.
  if (total.e504 > 0) {
    problemas.push({ nivel: 'FALHA', texto: `${total.e504} respostas 504 (a tela fica carregando)` });
  }

  // Só minutos com movimento entram na avaliação por minuto.
  const comMovimento = minutos.filter(m => m.n >= MIN_TRAFEGO_MINUTO);
  const ruins = [];

  for (const m of comMovimento) {
    const doMinuto = [];
    if (m.p50 > LIMIAR_P50) {
      doMinuto.push({
        nivel: 'FALHA',
        texto: `${horaAcre(m.minuto)} — p50 em ${Math.round(m.p50)} ms: metade das `
          + `${m.n} respostas desse minuto ficou esperando (a sala travada)`,
      });
    }
    if (m.e5xx / m.n > 0.01) {
      doMinuto.push({
        nivel: 'FALHA',
        texto: `${horaAcre(m.minuto)} — ${m.e5xx} erros 5xx em ${m.n} respostas `
          + `(${(100 * m.e5xx / m.n).toFixed(1)}%)`,
      });
    }
    if (m.lentas >= LENTAS_PARA_ALERTA) {
      doMinuto.push({
        nivel: 'ALERTA',
        texto: `${horaAcre(m.minuto)} — ${m.lentas} respostas acima de `
          + `${LIMIAR_LENTA_MS} ms: o disjuntor do cliente abriu (ou quase)`,
      });
    }
    if (doMinuto.length > 0) ruins.push({ ...m, problemas: doMinuto });
  }

  // Gravidade = pior primeiro, e "pior" aqui é o p50: é o que mede quanta gente
  // estava esperando, não quão azarado foi um clique.
  ruins.sort((a, b) => b.p50 - a.p50);

  // Um problema por TIPO, dizendo em quantos minutos aconteceu e no pior deles.
  // Reprovar 40 vezes a mesma coisa enche a tela e esconde o resto.
  const porTipo = new Map();
  for (const r of ruins) {
    for (const pr of r.problemas) {
      const tipo = pr.texto.replace(/^\d{2}:\d{2} — /, '').replace(/\d+/g, '#');
      if (!porTipo.has(tipo)) porTipo.set(tipo, { ...pr, minutos: 0 });
      porTipo.get(tipo).minutos += 1;
    }
  }
  for (const pr of porTipo.values()) {
    problemas.push({
      nivel: pr.nivel,
      texto: pr.minutos > 1 ? `${pr.texto} — e em ${pr.minutos} minutos da janela` : pr.texto,
    });
  }

  if (total.n >= MIN_TRAFEGO && total.e401 > LIMIAR_401) {
    problemas.push({ nivel: 'ALERTA', texto: `${total.e401} respostas 401 — sessão caindo em série` });
  }

  return { problemas, total, minutosRuins: ruins.length, pior: ruins[0] ?? null };
}

// `--fim` existe para olhar para trás: a aula de ontem, o minuto que o aluno
// reclamou, a janela que a execução do cron perdeu. Sem ele não havia como
// conferir se um limite novo acusa aula saudável — e limite que grita à toa é
// limite que se aprende a ignorar. A API guarda 24h.
const FIM_FLAG = valorDe('--fim');
const fim = FIM_FLAG ? new Date(FIM_FLAG) : new Date();
if (Number.isNaN(fim.getTime())) {
  console.error(`
--fim inválido: ${FIM_FLAG}. Use ISO, ex.: --fim=2026-09-22T20:00:00Z
`);
  process.exit(2);
}
const inicio = new Date(fim.getTime() - MINUTOS * 60_000);
const janela = `${inicio.toISOString()} → ${fim.toISOString()} (${MINUTOS} min)`;

const relatorio = [];
for (const p of PROJETOS) {
  try {
    const linhas = await medir(p.ref, inicio.toISOString(), fim.toISOString());
    const a = avaliar(linhas);
    relatorio.push({
      turma: p.nome, periodo: p.periodo,
      metricas: a.total, problemas: a.problemas,
      minutosRuins: a.minutosRuins, piorMinuto: a.pior,
    });
  } catch (err) {
    // Depois de 3 tentativas ainda sem resposta: continua sendo ignorância
    // sobre a turma, não diagnóstico dela. Aparece no relatório em voz alta,
    // mas não reprova — só o que fala da AULA reprova.
    const indet = transitorio(err);
    relatorio.push({
      turma: p.nome, periodo: p.periodo, erro: err.message, indeterminado: indet,
      problemas: [{
        nivel: indet ? 'INDET' : 'FALHA',
        texto: indet
          ? `não deu para medir depois de ${TENTATIVAS} tentativas: ${err.message}. Nada se pode afirmar sobre esta turma.`
          : `não deu para medir: ${err.message}`,
      }],
    });
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
      : r.indeterminado ? 'INDET'
      : r.problemas.length > 0 ? 'ALERTA' : 'OK  ';
    const m = r.metricas ?? {};
    // Os percentis do resumo são do PIOR MINUTO da janela, não da janela toda —
    // é o que não dilui. Ver o cabeçalho.
    const resumo = r.erro
      ? r.erro
      : `${n} req · 504=${m.e504 ?? 0} · 5xx=${m.e5xx ?? 0} · 401=${m.e401 ?? 0}`
        + ` · pior minuto: p50=${Math.round(Number(m.p50 ?? 0))}ms`
        + ` p95=${Math.round(Number(m.p95 ?? 0))}ms · pior resposta=${Math.round(Number(m.pior ?? 0))}ms`
        + (r.minutosRuins ? ` · ${r.minutosRuins} minuto(s) ruim(ns)` : '');
    console.log(`[${pior}] ${r.turma} (${r.periodo}): ${resumo}`);
    for (const p of r.problemas) console.log(`         ${p.nivel}: ${p.texto}`);
  }
}

const reprovou = relatorio.some(r => !r.indeterminado && r.problemas.length > 0);
if (reprovou && !JSON_OUT) {
  console.log(`
O que olhar primeiro:
  1. A hora do pior minuto acima  — é o relógio da turma (Acre); procure o que
                                    a sala estava fazendo nesse minuto
  2. npm run rls:check            — policy recalculando por linha (derrubou 15/09)
  3. Logs do projeto no painel    — qual endpoint está estourando o tempo
  4. Se for uma tela só, ver se o hook dela passa por assinarRealtime

Se o ÚNICO aviso for "o disjuntor do cliente abriu", ele fez o trabalho: a
leitura automática foi cortada e a sala voltou sozinha. Vale olhar o que
apertou, não correr. Se vier junto com 504 ou p50 alto, o freio não deu conta.
`);
}
process.exit(reprovou ? 1 : 0);
