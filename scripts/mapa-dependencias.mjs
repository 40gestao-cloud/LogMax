#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/mapa-dependencias.mjs — `npm run mapa`
//
// Gera docs/mapa/: o que cada menu/tela lê e grava, quem mais mexe nas mesmas
// tabelas, quais funções (RPC) e gatilhos disparam em cadeia, o que cai junto
// quando algo é apagado. Existe para responder, ANTES de uma mudança, "se eu
// mexer aqui, o que mais eu preciso olhar?" — pergunta que em 28/09/2026 ficou
// sem resposta até quebrar (cancelar pedido falhava por causa do guard da
// REQUISIÇÃO, outra tabela, outra regra).
//
// É GERADO, não escrito à mão: mapa escrito envelhece em dias e passa segurança
// falsa. Rode de novo depois de mexer em tela, RPC, gatilho ou policy; o
// `git diff` de docs/mapa mostra a ligação nova que a mudança criou.
//
// Fontes:
//   • banco: pg_proc, pg_trigger, pg_constraint, pg_depend, pg_policies de UMA
//     turma (as 4 são idênticas — `npm run drift`). Padrão: LogMax-ERP.
//   • código: App.tsx (menus, switch de telas), SessoesGeraisView (hubs da
//     Matriz), cada tela e o que ela importa de src/, api/*.ts, api/cron.ts.
//
// Limites (detecção estática): SQL dinâmico (EXECUTE format(...)) e endpoint
// passado por variável não aparecem. O mapa diz ONDE olhar; o teste do fluxo
// diz se quebrou.
//
// Precisa de SUPABASE_ACCESS_TOKEN no ambiente ou no .env (o mesmo do drift).
// Opcional: MAPA_REF=<ref do projeto> para ler outra turma.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = join(RAIZ, 'docs', 'mapa');
const REF = process.env.MAPA_REF || 'jvqsaccupxkvezriiede';

// Tabelas que quase toda tela toca por uma ferramenta comum (aviso, trilha de
// auditoria, numeração, Max Show/planilhas do aluno). Elas aparecem nas listas,
// mas não entram no "Confira também" — ligariam tudo com tudo e esconderiam a
// ligação que importa.
const TRANSVERSAIS = new Set([
  'notificacoes', 'notificacoes_lidas', 'historico_operacoes', 'documento_sequencias',
  'max_shows', 'planilhas_trabalho', 'trabalho_reservas',
]);

const ler = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rel = (p) => relative(RAIZ, p).replace(/\\/g, '/');
const ordenar = (xs) => [...xs].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ── Token ───────────────────────────────────────────────────────────────────
function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const env = join(RAIZ, '.env');
  if (existsSync(env)) {
    const linha = ler(env).split('\n').find((l) => l.trim().startsWith('SUPABASE_ACCESS_TOKEN='));
    if (linha) return linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  console.error('Falta SUPABASE_ACCESS_TOKEN (ambiente ou .env).');
  process.exit(2);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Management API ${r.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt);
}

// ── 1. Banco ────────────────────────────────────────────────────────────────
async function lerBanco() {
  const [linha] = await sql(`
    select json_build_object(
      'rels', (select json_agg(json_build_object('n', c.relname, 'k', c.relkind))
                 from pg_class c where c.relnamespace = 'public'::regnamespace
                  and c.relkind in ('r','p','v','m')),
      'fns',  (select json_agg(json_build_object(
                  'n', p.proname, 'sd', p.prosecdef,
                  'trg', p.prorettype = 'trigger'::regtype, 'src', p.prosrc))
                 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'),
      'trgs', (select json_agg(json_build_object('t', c.relname, 'n', t.tgname, 'f', p.proname, 'tipo', t.tgtype))
                 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 join pg_proc p on p.oid = t.tgfoid
                where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
      'fks',  (select json_agg(json_build_object(
                  't', cl.relname, 'ref', cr.relname, 'del', co.confdeltype,
                  'col', (select string_agg(a.attname, ',') from unnest(co.conkey) k
                            join pg_attribute a on a.attrelid = co.conrelid and a.attnum = k)))
                 from pg_constraint co
                 join pg_class cl on cl.oid = co.conrelid
                 join pg_class cr on cr.oid = co.confrelid
                where co.contype = 'f' and co.connamespace = 'public'::regnamespace
                  and cr.relnamespace = 'public'::regnamespace),
      'vdeps', (select json_agg(distinct jsonb_build_object('v', v.relname, 't', t.relname))
                 from pg_depend d join pg_rewrite r on r.oid = d.objid
                 join pg_class v on v.oid = r.ev_class
                 join pg_class t on t.oid = d.refobjid
                where v.relnamespace = 'public'::regnamespace and v.relkind in ('v','m')
                  and t.relnamespace = 'public'::regnamespace and t.relkind in ('r','p','v','m')
                  and v.oid <> t.oid),
      'pols', (select json_agg(json_build_object('t', tablename, 'cmd', cmd, 'n', policyname,
                  'e', coalesce(with_check, qual, '')))
                 from pg_policies where schemaname = 'public')
    ) as dados`);
  return linha.dados;
}

const TG = { BEFORE: 2, INSERT: 4, DELETE: 8, UPDATE: 16, TRUNCATE: 32, INSTEAD: 64 };
const descreverGatilho = (tipo) => {
  const quando = tipo & TG.INSTEAD ? 'INSTEAD OF' : tipo & TG.BEFORE ? 'BEFORE' : 'AFTER';
  const ev = [tipo & TG.INSERT && 'INSERT', tipo & TG.UPDATE && 'UPDATE', tipo & TG.DELETE && 'DELETE', tipo & TG.TRUNCATE && 'TRUNCATE']
    .filter(Boolean).join('/');
  return `${quando} ${ev}`;
};
const ON_DELETE = { a: 'bloqueia (NO ACTION)', r: 'bloqueia (RESTRICT)', c: 'APAGA JUNTO (CASCADE)', n: 'zera o vínculo (SET NULL)', d: 'volta ao padrão (SET DEFAULT)' };

// Corpo de função: escritas, leituras, chamadas, flags. Filtra por nomes que
// existem de verdade — "UPDATE SET" de ON CONFLICT não vira tabela "set".
function analisarCorpo(src, tabelas, relacoes, nomesFn, proprio) {
  const semComent = src.replace(/--[^\n]*/g, ' ');
  const escreve = new Set();
  for (const m of semComent.matchAll(/\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    const t = m[1].toLowerCase();
    if (tabelas.has(t)) escreve.add(t);
  }
  const le = new Set();
  for (const m of semComent.matchAll(/\b(from|join)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    const antes = semComent.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
    if (/delete\s*$/.test(antes)) continue;
    const t = m[2].toLowerCase();
    if (relacoes.has(t)) le.add(t);
  }
  const chama = new Set();
  for (const m of semComent.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const f = m[1].toLowerCase();
    if (f !== proprio && nomesFn.has(f)) chama.add(f);
  }
  const flags = new Set([...semComent.matchAll(/set_config\(\s*'(app\.[a-z_]+)'/gi)].map((m) => m[1]));
  const dinamico = /\bexecute\s+format\s*\(|\bexecute\s+'/i.test(semComent);
  return { escreve, le, chama, flags, dinamico };
}

// Setores citados na policy — resumo legível de quem a RLS deixa passar.
function resumoPolicy(e) {
  const setores = new Set();
  for (const m of e.matchAll(/ARRAY\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/'([a-z_]+)'/g)) setores.add(s[1]);
  }
  const partes = [];
  if (setores.size) partes.push(`setores: ${ordenar(setores).join(', ')}`);
  if (/'gerente'/.test(e)) partes.push('gerente da filial');
  // `auth_is_admin() OR auth_user_filial() = filial` sem setor nenhum: a regra
  // é só a unidade — qualquer aluno dela passa. Dizer só "Matriz" enganaria.
  if (!setores.size && !/'gerente'/.test(e) && /auth_user_filial\(\)[^=]*=\s*filial/.test(e)) partes.push('qualquer um da própria filial');
  if (/auth_is_admin|eh_perfil_admin|role\s*=\s*'admin'/.test(e)) partes.push('Matriz/professor');
  if (/auth\.uid\(\)/.test(e) && !partes.length) partes.push('o próprio usuário');
  if (/^\s*\(?true\)?\s*$/i.test(e)) partes.push('todos');
  if (/^\s*\(?false\)?\s*$/i.test(e)) partes.push('ninguém (só via RPC)');
  if (/auth_blackout/.test(e) && !partes.length) partes.push('trava de simulação de perda');
  if (/auth_desligado/.test(e) && !partes.length) partes.push('trava de desligado');
  return partes.join(' · ') || 'regra própria';
}

// ── 2. Código ───────────────────────────────────────────────────────────────
const SRC = join(RAIZ, 'src');
const APP = ler(join(SRC, 'App.tsx'));
const ENDPOINTS = Object.fromEntries(
  [...ler(join(SRC, 'lib', 'supabase.ts')).matchAll(/'(\/api\/[^']+)':\s*'([a-z_0-9]+)'/g)].map((m) => [m[1], m[2]]),
);
const tabelaDoEndpoint = (e) => ENDPOINTS[e] ?? (e.startsWith('/api/') ? null : e);

function resolverImport(de, alvo) {
  if (!alvo.startsWith('.')) return null;
  const base = resolve(dirname(de), alvo);
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const cacheArquivo = new Map();
function analisarArquivo(caminho) {
  if (cacheArquivo.has(caminho)) return cacheArquivo.get(caminho);
  const txt = ler(caminho).replace(/\/\/[^\n]*/g, ' ');
  const a = { le: new Set(), grava: new Set(), rpcs: new Set(), apis: new Set(), buckets: new Set(), realtime: new Set(), imports: [] };
  cacheArquivo.set(caminho, a);

  for (const m of txt.matchAll(/useFetchData\s*(?:<[^>]*>)?\(\s*'([^']+)'/g)) {
    const t = tabelaDoEndpoint(m[1]); if (t) a.le.add(t);
  }
  for (const m of txt.matchAll(/\b(dbInsert|dbUpdate|dbDelete|dbSetStatus)\s*(?:<[^>]*>)?\(\s*'([^']+)'/g)) {
    const t = tabelaDoEndpoint(m[2]); if (t) a.grava.add(t);
  }
  // Endpoint citado solto (constante, prop) conta como leitura — menos no
  // próprio src/lib/supabase.ts, que é o dicionário de TODOS os endpoints e
  // faria toda tela parecer ler o banco inteiro.
  if (!caminho.endsWith(join('lib', 'supabase.ts'))) {
    for (const m of txt.matchAll(/'(\/api\/[a-z0-9-]+view[a-z0-9-]*)'/g)) {
      const t = tabelaDoEndpoint(m[1]); if (t) a.le.add(t);
    }
  }
  for (const m of txt.matchAll(/\.from\(\s*'([a-z_0-9-]+)'\s*\)/g)) {
    const antes = txt.slice(Math.max(0, m.index - 12), m.index);
    if (/storage\s*$/.test(antes)) { a.buckets.add(m[1]); continue; }
    const fim = txt.indexOf(';', m.index);
    const trecho = txt.slice(m.index, fim < 0 ? m.index + 800 : Math.min(fim, m.index + 800));
    if (/\.(insert|update|upsert|delete)\(/.test(trecho)) a.grava.add(m[1]); else a.le.add(m[1]);
  }
  for (const m of txt.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'/g)) a.rpcs.add(m[1]);
  for (const m of txt.matchAll(/fetch\(\s*[`'"]\/api\/([a-z0-9-]+)/g)) a.apis.add(m[1]);
  for (const m of txt.matchAll(/postgres_changes[\s\S]{0,240}?table:\s*'([a-z_0-9]+)'/g)) a.realtime.add(m[1]);
  for (const m of txt.matchAll(/(?:import|from)\s*\(?\s*'(\.[^']+)'/g)) {
    const alvo = resolverImport(caminho, m[1]);
    if (alvo && alvo.startsWith(SRC)) a.imports.push(alvo);
  }
  return a;
}

// Tudo que a tela alcança pelo que importa de src/ (views, components, lib,
// hooks). Guarda quais arquivos contribuíram, para o leitor saber onde abrir.
function agregarTela(arquivoRaiz) {
  const visto = new Set();
  const total = { le: new Set(), grava: new Set(), rpcs: new Set(), apis: new Set(), buckets: new Set(), realtime: new Set(), arquivos: new Set() };
  const fila = [arquivoRaiz];
  while (fila.length) {
    const f = fila.pop();
    if (visto.has(f)) continue;
    visto.add(f);
    const a = analisarArquivo(f);
    let contribuiu = false;
    for (const k of ['le', 'grava', 'rpcs', 'apis', 'buckets', 'realtime']) {
      for (const x of a[k]) { total[k].add(x); contribuiu = true; }
    }
    if (contribuiu) total.arquivos.add(rel(f));
    fila.push(...a.imports);
  }
  return total;
}

// Componente → arquivo, pelos imports do App.tsx (lazy e diretos).
function arquivosDosComponentes() {
  const mapa = {};
  for (const m of APP.matchAll(/const\s+(\w+)\s*=\s*lazyView\(\s*\(\)\s*=>\s*import\('(\.[^']+)'\)/g)) {
    const f = resolverImport(join(SRC, 'App.tsx'), m[2]); if (f) mapa[m[1]] = f;
  }
  for (const m of APP.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const f = resolverImport(join(SRC, 'App.tsx'), m[2]);
    if (!f) continue;
    for (const nome of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) mapa[nome] ??= f;
  }
  for (const m of APP.matchAll(/import\s+(\w+)\s+from\s*'(\.[^']+)'/g)) {
    const f = resolverImport(join(SRC, 'App.tsx'), m[2]); if (f) mapa[m[1]] ??= f;
  }
  return mapa;
}

// `switch (activeView)`: cada case → componente (+ endpoint/type quando houver).
function casosDoSwitch() {
  const ini = APP.indexOf('switch (activeView) {');
  const fim = APP.indexOf('default:', ini);
  const bloco = APP.slice(ini, fim);
  const casos = {};
  let pendentes = [];
  for (const parte of bloco.split(/\n(?=\s*case\s)/)) {
    const ids = [...parte.matchAll(/case\s+'([^']+)'\s*:/g)].map((m) => m[1]);
    pendentes.push(...ids);
    const ret = parte.match(/return\s*(?:\(\s*)?<(\w+)/);
    if (!ret) continue;
    const endpoint = parte.match(/endpoint="([^"]+)"/)?.[1] ?? null;
    const tipo = parte.match(/\stype="([^"]+)"/)?.[1] ?? null;
    for (const id of pendentes) casos[id] = { comp: ret[1], endpoint, tipo };
    pendentes = [];
  }
  return casos;
}

const viewIdDe = (modId, label) => `${modId}-${label.toLowerCase().replace(/ /g, '').replace(/\//g, '')}`;

function lerModulos(texto, marcaIni, marcaFim) {
  const ini = texto.indexOf(marcaIni);
  const fim = marcaFim ? texto.indexOf(marcaFim, ini) : texto.length;
  const bloco = texto.slice(ini, fim)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/require(Role|Setor):\s*\[[^\]]*\]/g, '');
  const mods = [];
  for (const m of bloco.matchAll(/id:\s*'([a-z-]+)',\s*label:\s*'([^']+)'[\s\S]*?submenus:\s*\[([\s\S]*?)\]\s*,?\s*\}/g)) {
    const labels = [...m[3].matchAll(/label:\s*'([^']+)'|'([^']+)'/g)].map((x) => x[1] ?? x[2]);
    mods.push({ id: m[1], label: m[2], submenus: labels });
  }
  return mods;
}

function itensSoltosDaSidebar() {
  const itens = {};
  for (const m of APP.matchAll(/navigate\('([a-z0-9-]+)'\)[\s\S]{0,700}?<span[^>]*>([^<{]+)<\/span>/g)) {
    itens[m[1]] ??= m[2].trim();
  }
  return itens;
}

function hubsDaMatriz() {
  const arq = join(SRC, 'views', 'SessoesGeraisView.tsx');
  if (!existsSync(arq)) return { modulos: [], folhas: [] };
  const txt = ler(arq);
  const modulos = lerModulos(txt, 'export const SESSOES_MATRIZ_MACROS', null);
  const folhas = [...txt.matchAll(/kind:\s*'leaf',\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'[\s\S]*?viewId:\s*'([^']+)'/g)]
    .map((m) => ({ label: m[2], viewId: m[3] }));
  return { modulos, folhas };
}

// ── 3. API (servidor) e cron ────────────────────────────────────────────────
function lerApis() {
  const dir = join(RAIZ, 'api');
  const apis = {};
  if (!existsSync(dir)) return apis;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const txt = ler(join(dir, f));
    const a = { le: new Set(), grava: new Set(), rpcs: new Set() };
    for (const m of txt.matchAll(/\.from\(\s*'([a-z_0-9]+)'\s*\)/g)) {
      const fim = txt.indexOf(';', m.index);
      const trecho = txt.slice(m.index, fim < 0 ? m.index + 800 : Math.min(fim, m.index + 800));
      if (/\.(insert|update|upsert|delete)\(/.test(trecho)) a.grava.add(m[1]); else a.le.add(m[1]);
    }
    for (const m of txt.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'/g)) a.rpcs.add(m[1]);
    // cron.ts: o mapa TASKS aponta RPC por texto.
    if (f === 'cron.ts') for (const m of txt.matchAll(/'[a-z-]+':\s*'([a-z_0-9]+)'/g)) a.rpcs.add(m[1]);
    apis[f.replace(/\.ts$/, '')] = a;
  }
  return apis;
}

// ── 4. Montagem ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`Lendo o banco (${REF})…`);
  const db = await lerBanco();
  const tabelas = new Set(db.rels.filter((r) => r.k === 'r' || r.k === 'p').map((r) => r.n));
  const views = new Set(db.rels.filter((r) => r.k === 'v' || r.k === 'm').map((r) => r.n));
  const relacoes = new Set([...tabelas, ...views]);
  const nomesFn = new Set(db.fns.map((f) => f.n));

  // Funções (sobrecargas somam o corpo: o mapa é por nome).
  const fns = {};
  for (const f of db.fns) {
    const a = analisarCorpo(f.src, tabelas, relacoes, nomesFn, f.n);
    const x = fns[f.n] ??= { nome: f.n, secdef: false, gatilho: false, escreve: new Set(), le: new Set(), chama: new Set(), flags: new Set(), dinamico: false };
    x.secdef ||= f.sd; x.gatilho ||= f.trg; x.dinamico ||= a.dinamico;
    for (const k of ['escreve', 'le', 'chama', 'flags']) for (const v of a[k]) x[k].add(v);
  }

  const gatilhosPorTabela = {};
  for (const t of db.trgs) (gatilhosPorTabela[t.t] ??= []).push({ nome: t.n, fn: t.f, quando: descreverGatilho(t.tipo) });

  // Escrita transitiva de uma RPC: o que ela grava, o que as funções que ela
  // chama gravam (até 3 níveis) — sem os gatilhos, que entram à parte.
  const escritaDaFn = (nome, prof = 0, visto = new Set()) => {
    const out = new Set();
    if (!fns[nome] || visto.has(nome) || prof > 3) return out;
    visto.add(nome);
    for (const t of fns[nome].escreve) out.add(t);
    for (const c of fns[nome].chama) if (!fns[c]?.gatilho) for (const t of escritaDaFn(c, prof + 1, visto)) out.add(t);
    return out;
  };
  // Cascata por gatilho: gravar em T dispara os gatilhos de T, que gravam em
  // outras tabelas, que disparam os seus… (até 4 saltos).
  const cascata = (tabela) => {
    const passos = [];
    const visto = new Set([tabela]);
    let fronteira = [tabela];
    for (let salto = 1; salto <= 4 && fronteira.length; salto++) {
      const prox = [];
      for (const t of fronteira) {
        for (const g of gatilhosPorTabela[t] ?? []) {
          for (const destino of escritaDaFn(g.fn)) {
            if (destino === t || TRANSVERSAIS.has(destino)) continue;
            passos.push({ salto, de: t, fn: g.fn, para: destino });
            if (!visto.has(destino)) { visto.add(destino); prox.push(destino); }
          }
        }
      }
      fronteira = prox;
    }
    return passos;
  };

  // Telas.
  const arquivos = arquivosDosComponentes();
  const casos = casosDoSwitch();
  const telas = {};
  for (const [id, c] of Object.entries(casos)) {
    const arq = arquivos[c.comp];
    const ag = arq ? agregarTela(arq) : { le: new Set(), grava: new Set(), rpcs: new Set(), apis: new Set(), buckets: new Set(), realtime: new Set(), arquivos: new Set() };
    // GenericCRUDView e afins recebem o endpoint pela prop: a tela é dele.
    if (c.endpoint) { const t = tabelaDoEndpoint(c.endpoint); if (t) { ag.le.add(t); ag.grava.add(t); } }
    if (c.comp === 'CRMView' && c.tipo) {
      const t = tabelaDoEndpoint(`/api/crmview-${c.tipo}`) ?? (c.tipo === 'fornecedores' ? 'fornecedores' : null);
      if (t) { ag.le.add(t); ag.grava.add(t); }
    }
    const viaRpc = new Set();
    for (const r of ag.rpcs) for (const t of escritaDaFn(r)) viaRpc.add(t);
    telas[id] = { id, comp: c.comp, arquivo: arq ? rel(arq) : null, ...ag, gravaViaRpc: viaRpc };
  }

  // Nome de cada tela como aparece no app.
  const nomes = {};
  const menuFilial = lerModulos(APP, 'const menuModules', '// Helpers: extrai label');
  for (const m of menuFilial) for (const s of m.submenus) nomes[viewIdDe(m.id, s)] ??= `${m.label} › ${s}`;
  const hubs = hubsDaMatriz();
  for (const m of hubs.modulos) for (const s of m.submenus) nomes[viewIdDe(m.id, s)] ??= `Matriz › ${m.label} › ${s}`;
  for (const f of hubs.folhas) nomes[f.viewId] ??= `Matriz › ${f.label}`;
  for (const [id, label] of Object.entries(itensSoltosDaSidebar())) nomes[id] ??= label;
  // Rota sem item de menu achado (hub, atalho, card): nome montado da própria
  // rota, com o módulo por extenso quando o prefixo é um módulo conhecido.
  const rotuloModulo = Object.fromEntries([...menuFilial, ...hubs.modulos].map((m) => [m.id, m.label]));
  const humanizar = (id) => {
    const [pre, ...resto] = id.split('-');
    const cauda = resto.join(' ');
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    return rotuloModulo[pre] && cauda ? `${rotuloModulo[pre]} › ${cap(cauda)}` : cap(id.replace(/-/g, ' '));
  };
  const nomeTela = (id) => nomes[id] ?? `${humanizar(id)} *(rota ${id})*`;

  const apis = lerApis();

  // Índices reversos.
  const idx = (tipo) => { const m = {}; return { m, add: (t, quem) => (m[t] ??= new Set()).add(quem) }; };
  const telaGrava = idx(), telaLe = idx(), telaRpc = idx(), rpcGrava = idx(), rpcLe = idx(), trgGrava = idx(),
    apiGrava = idx(), apiLe = idx(), apiRpc = idx(), fnChamadaPor = idx(), telaRealtime = idx();
  for (const t of Object.values(telas)) {
    for (const x of t.grava) telaGrava.add(x, t.id);
    for (const x of t.le) telaLe.add(x, t.id);
    for (const x of t.rpcs) telaRpc.add(x, t.id);
    for (const x of t.realtime) telaRealtime.add(x, t.id);
  }
  for (const f of Object.values(fns)) {
    for (const x of f.escreve) (f.gatilho ? trgGrava : rpcGrava).add(x, f.nome);
    for (const x of f.le) if (!f.gatilho) rpcLe.add(x, f.nome);
    for (const c of f.chama) fnChamadaPor.add(c, f.nome);
  }
  for (const [nome, a] of Object.entries(apis)) {
    for (const x of a.grava) apiGrava.add(x, nome);
    for (const x of a.le) apiLe.add(x, nome);
    for (const x of a.rpcs) apiRpc.add(x, nome);
  }
  const trgsDaFn = {};
  for (const t of db.trgs) (trgsDaFn[t.f] ??= new Set()).add(t.t);
  const fksFilhas = {}, fksPais = {};
  for (const f of db.fks) { (fksFilhas[f.ref] ??= []).push(f); (fksPais[f.t] ??= []).push(f); }
  const viewsDaTabela = {};
  for (const d of db.vdeps) (viewsDaTabela[d.t] ??= new Set()).add(d.v);
  const polsDaTabela = {};
  for (const p of db.pols) (polsDaTabela[p.t] ??= []).push(p);

  // Quem grava T por qualquer caminho: tela direta ou tela via RPC.
  const telasQueGravam = (t) => {
    const s = new Set(telaGrava.m[t] ?? []);
    for (const tela of Object.values(telas)) if (tela.gravaViaRpc.has(t)) s.add(tela.id);
    return s;
  };

  // ── 5. Markdown ────────────────────────────────────────────────────────────
  mkdirSync(SAIDA, { recursive: true });
  const aT = (t) => `[${t}](tabelas.md#t-${t})`;
  const aF = (f) => `[${f}](funcoes.md#f-${f})`;
  const aS = (id) => `[${nomeTela(id)}](telas.md#s-${id})`;
  const lista = (xs, fmt, vazio = '—') => (xs && [...xs].length ? ordenar([...xs]).map(fmt).join(', ') : vazio);
  const cab = (titulo) => [
    `# ${titulo}`, '',
    '> **Gerado por `npm run mapa` — não edite à mão.** Rode de novo depois de mexer em tela, RPC, gatilho ou policy; o `git diff` desta pasta mostra a ligação nova.',
    `> Banco lido: \`${REF}\` (as 4 turmas são idênticas — \`npm run drift\`). Detecção estática: SQL dinâmico e endpoint passado por variável não aparecem.`,
    '',
  ];

  // telas.md
  const ordemTelas = [];
  for (const m of menuFilial) for (const s of m.submenus) { const id = viewIdDe(m.id, s); if (telas[id] && !ordemTelas.includes(id)) ordemTelas.push(id); }
  for (const m of hubs.modulos) for (const s of m.submenus) { const id = viewIdDe(m.id, s); if (telas[id] && !ordemTelas.includes(id)) ordemTelas.push(id); }
  for (const id of ordenar(Object.keys(telas))) if (!ordemTelas.includes(id)) ordemTelas.push(id);

  const L = cab('Mapa por tela (menu › submenu)');
  L.push('Para cada tela: o que ela lê e grava, as funções do banco que chama, e **quem mais mexe nas mesmas tabelas** — é a lista do "se mexer aqui, confira também".', '');
  let grupoAtual = null;
  for (const id of ordemTelas) {
    const t = telas[id];
    const nome = nomeTela(id);
    const grupo = nome.includes(' › ') ? nome.split(' › ').slice(0, nome.startsWith('Matriz') ? 2 : 1).join(' › ') : 'Outras telas (barra lateral, hubs, atalhos)';
    if (grupo !== grupoAtual) { L.push(`## ${grupo}`, ''); grupoAtual = grupo; }
    L.push(`<a id="s-${id}"></a>`, `### ${nome}`, '');
    L.push(`- **Rota:** \`${id}\` · **Componente:** \`${t.comp}\`${t.arquivo ? ` ([${t.arquivo}](../../${t.arquivo}))` : ''}`);
    L.push(`- **Lê:** ${lista(t.le, aT)}`);
    L.push(`- **Grava direto:** ${lista(t.grava, aT)}`);
    L.push(`- **Chama (RPC):** ${lista(t.rpcs, aF)}`);
    const viaRpcSo = [...t.gravaViaRpc].filter((x) => !t.grava.has(x));
    if (viaRpcSo.length) L.push(`- **Grava via RPC:** ${lista(viaRpcSo, aT)}`);
    if (t.apis.size) L.push(`- **API do servidor:** ${lista(t.apis, (x) => `\`/api/${x}\``)}`);
    if (t.buckets.size) L.push(`- **Storage:** ${lista(t.buckets, (x) => `\`${x}\``)}`);
    if (t.realtime.size) L.push(`- **Escuta em tempo real:** ${lista(t.realtime, aT)}`);
    // Confira também: outras telas que gravam o que esta grava (direto ou via RPC),
    // e o que os gatilhos das tabelas gravadas alcançam.
    const gravadas = new Set([...t.grava, ...t.gravaViaRpc]);
    const alcancadas = new Set();
    for (const x of gravadas) for (const p of cascata(x)) alcancadas.add(p.para);
    for (const x of gravadas) alcancadas.delete(x);
    if (alcancadas.size) L.push(`- **Gatilhos levam a mudança até:** ${lista(alcancadas, aT)}`);
    // Agrupado pela tabela que liga as telas: o leitor vê o PORQUÊ da ligação.
    const porTabela = [];
    for (const x of ordenar(gravadas)) {
      if (TRANSVERSAIS.has(x)) continue;
      const outras = [...telasQueGravam(x)].filter((s) => s !== id);
      if (outras.length) porTabela.push(`  - por ${aT(x)}: ${lista(outras, aS)}`);
    }
    if (porTabela.length) L.push('- **⚠ Confira também — outras telas que gravam as mesmas tabelas:**', ...porTabela);
    if (t.arquivos.size > 1) L.push(`- **Arquivos que acessam dados:** ${lista(t.arquivos, (x) => `\`${x}\``)}`);
    L.push('');
  }
  writeFileSync(join(SAIDA, 'telas.md'), L.join('\n'));

  // tabelas.md
  const T = cab('Mapa por tabela');
  T.push('Para cada tabela: quem grava (tela, RPC, gatilho, servidor), quem lê, os gatilhos que disparam nela e a cadeia que eles provocam, e o que acontece quando uma linha é apagada.', '');
  for (const nome of ordenar([...tabelas, ...views])) {
    const ehView = views.has(nome);
    T.push(`<a id="t-${nome}"></a>`, `## ${nome}${ehView ? ' (view)' : ''}`, '');
    if (!ehView) {
      T.push(`- **Telas que gravam:** ${lista(telaGrava.m[nome], aS)}`);
      const viaRpc = [...telasQueGravam(nome)].filter((s) => !(telaGrava.m[nome] ?? new Set()).has(s));
      if (viaRpc.length) T.push(`- **Telas que gravam via RPC:** ${lista(viaRpc, aS)}`);
      T.push(`- **RPCs que gravam:** ${lista(rpcGrava.m[nome], aF)}`);
      if (trgGrava.m[nome]) T.push(`- **Gatilhos (de outras tabelas) que gravam aqui:** ${lista(trgGrava.m[nome], (f) => `${aF(f)} (em ${lista(trgsDaFn[f], aT)})`)}`);
      if (apiGrava.m[nome]) T.push(`- **Servidor (api/) grava:** ${lista(apiGrava.m[nome], (a) => `\`api/${a}.ts\``)}`);
    }
    T.push(`- **Telas que leem:** ${lista(telaLe.m[nome], aS)}`);
    if (rpcLe.m[nome]) T.push(`- **RPCs que leem:** ${lista(rpcLe.m[nome], aF)}`);
    if (apiLe.m[nome]) T.push(`- **Servidor (api/) lê:** ${lista(apiLe.m[nome], (a) => `\`api/${a}.ts\``)}`);
    if (viewsDaTabela[nome]) T.push(`- **Views que dependem desta:** ${lista(viewsDaTabela[nome], aT)}`);
    if (telaRealtime.m[nome]) T.push(`- **Telas escutando em tempo real:** ${lista(telaRealtime.m[nome], aS)}`);
    const gs = gatilhosPorTabela[nome] ?? [];
    if (gs.length) {
      T.push('- **Gatilhos nesta tabela:**');
      for (const g of [...gs].sort((a, b) => a.nome.localeCompare(b.nome))) {
        const efeito = [...escritaDaFn(g.fn)].filter((x) => x !== nome);
        T.push(`  - \`${g.nome}\` — ${g.quando} → ${aF(g.fn)}${efeito.length ? ` · grava em ${lista(efeito, aT)}` : ''}`);
      }
    }
    const casc = cascata(nome);
    if (casc.length) {
      T.push('- **Cadeia de gatilhos ao gravar aqui:**');
      for (const p of casc) T.push(`  - ${'  '.repeat(p.salto - 1)}${p.salto}. ${aT(p.de)} → ${aF(p.fn)} → ${aT(p.para)}`);
    }
    const filhas = fksFilhas[nome] ?? [];
    if (filhas.length) T.push(`- **Ao apagar uma linha daqui:** ${filhas.sort((a, b) => a.t.localeCompare(b.t)).map((f) => `${aT(f.t)}.${f.col} ${ON_DELETE[f.del] ?? f.del}`).join('; ')}`);
    const pais = fksPais[nome] ?? [];
    if (pais.length) T.push(`- **Aponta para:** ${pais.sort((a, b) => a.ref.localeCompare(b.ref)).map((f) => `${f.col} → ${aT(f.ref)}`).join('; ')}`);
    const pols = (polsDaTabela[nome] ?? []).filter((p) => !/^zz_/.test(p.n));
    if (pols.length) T.push(`- **RLS:** ${pols.sort((a, b) => `${a.cmd}${a.n}`.localeCompare(`${b.cmd}${b.n}`)).map((p) => `${p.cmd} \`${p.n}\` (${resumoPolicy(p.e)})`).join('; ')}`);
    T.push('');
  }
  writeFileSync(join(SAIDA, 'tabelas.md'), T.join('\n'));

  // funcoes.md
  const F = cab('Mapa por função do banco (RPC e gatilho)');
  F.push('Para cada função: quem a chama (tela, servidor, outra função, gatilho), o que ela grava e lê, e as funções que ela chama.', '');
  for (const nome of ordenar(Object.keys(fns))) {
    const f = fns[nome];
    const tipo = f.gatilho ? 'gatilho' : 'RPC';
    F.push(`<a id="f-${nome}"></a>`, `## ${nome} (${tipo}${f.secdef ? ', SECURITY DEFINER' : ''})`, '');
    if (f.gatilho) F.push(`- **Dispara em:** ${lista(trgsDaFn[nome], aT)}`);
    else {
      F.push(`- **Telas que chamam:** ${lista(telaRpc.m[nome], aS)}`);
      if (apiRpc.m[nome]) F.push(`- **Servidor (api/) chama:** ${lista(apiRpc.m[nome], (a) => `\`api/${a}.ts\``)}`);
    }
    if (fnChamadaPor.m[nome]) F.push(`- **Chamada por outras funções:** ${lista(fnChamadaPor.m[nome], aF)}`);
    F.push(`- **Grava:** ${lista(f.escreve, aT)}`);
    // Os gatilhos que a escrita dela acorda — foi a ligação que ninguém via no
    // cancelar_pedido_compra (grava em requisicoes → requisicao_decisao_guard).
    // Sem os genéricos (auditoria, histórico): estão em toda tabela.
    const acorda = [];
    for (const t of ordenar(f.escreve)) {
      const gs = (gatilhosPorTabela[t] ?? []).filter((g) => !['set_auditoria_campos', 'registrar_historico'].includes(g.fn) && g.fn !== nome);
      if (gs.length) acorda.push(`${aT(t)} (${ordenar(new Set(gs.map((g) => g.fn))).map(aF).join(', ')})`);
    }
    if (acorda.length) F.push(`- **Ao gravar, acorda os gatilhos de:** ${acorda.join('; ')}`);
    if (f.le.size) F.push(`- **Lê:** ${lista(f.le, aT)}`);
    if (f.chama.size) F.push(`- **Chama:** ${lista(f.chama, aF)}`);
    if (f.flags.size) F.push(`- **Liga flags de sessão:** ${lista(f.flags, (x) => `\`${x}\``)}`);
    if (f.dinamico) F.push('- **Tem SQL dinâmico** (EXECUTE): o que ele toca não aparece acima.');
    F.push('');
  }
  writeFileSync(join(SAIDA, 'funcoes.md'), F.join('\n'));

  // README.md — índice por menu
  const R = cab('Mapa de dependências do LogMax');
  R.push(
    '## Como usar', '',
    '1. **Antes de mexer** numa tela, abra ela em [telas.md](telas.md) e leia o **⚠ Confira também**: são as outras telas que gravam nas mesmas tabelas.',
    '2. **Antes de mexer numa tabela, RPC ou gatilho**, abra em [tabelas.md](tabelas.md) ou [funcoes.md](funcoes.md): quem grava, quem lê, a cadeia de gatilhos e o que cai junto quando algo é apagado.',
    '3. **Depois de mexer**, rode `npm run mapa` e olhe o `git diff docs/mapa`: ligação nova que você não esperava é o aviso.', '',
    `**Tabelas transversais** (aparecem nas listas, mas não entram no "Confira também", porque quase toda tela as toca por uma ferramenta comum): ${ordenar(TRANSVERSAIS).map((t) => `\`${t}\``).join(', ')}.`, '',
    `**Tamanho:** ${ordemTelas.length} telas · ${tabelas.size} tabelas · ${views.size} views · ${Object.values(fns).filter((f) => !f.gatilho).length} RPCs · ${Object.values(fns).filter((f) => f.gatilho).length} funções de gatilho · ${db.trgs.length} gatilhos`, '',
    '## Menus', '',
  );
  for (const m of menuFilial) {
    R.push(`### ${m.label}`, '');
    for (const s of m.submenus) { const id = viewIdDe(m.id, s); R.push(`- ${telas[id] ? aS(id) : `${s} *(sem tela no switch)*`}`); }
    R.push('');
  }
  R.push('### Matriz (hubs de Sessões Gerais)', '');
  const vistosMatriz = new Set();
  for (const m of hubs.modulos) for (const s of m.submenus) {
    const id = viewIdDe(m.id, s);
    if (vistosMatriz.has(id) || !telas[id]) continue; vistosMatriz.add(id);
    R.push(`- ${aS(id)}`);
  }
  for (const f of hubs.folhas) if (telas[f.viewId] && !vistosMatriz.has(f.viewId)) { vistosMatriz.add(f.viewId); R.push(`- ${aS(f.viewId)}`); }
  R.push('', '### Outras telas', '');
  const listadas = new Set([...menuFilial.flatMap((m) => m.submenus.map((s) => viewIdDe(m.id, s))), ...vistosMatriz]);
  for (const id of ordenar(Object.keys(telas))) if (!listadas.has(id)) R.push(`- ${aS(id)}`);
  R.push('');
  writeFileSync(join(SAIDA, 'README.md'), R.join('\n'));

  // mapa.json — para ferramenta (e para o Claude consultar sem ler o markdown).
  const json = {
    gerado_de: REF,
    telas: Object.fromEntries(ordemTelas.map((id) => [id, {
      nome: nomeTela(id), componente: telas[id].comp, arquivo: telas[id].arquivo,
      le: ordenar(telas[id].le), grava: ordenar(telas[id].grava), rpcs: ordenar(telas[id].rpcs),
      grava_via_rpc: ordenar(telas[id].gravaViaRpc), apis: ordenar(telas[id].apis),
    }])),
    funcoes: Object.fromEntries(ordenar(Object.keys(fns)).map((n) => [n, {
      gatilho: fns[n].gatilho, secdef: fns[n].secdef, grava: ordenar(fns[n].escreve), le: ordenar(fns[n].le), chama: ordenar(fns[n].chama),
    }])),
    gatilhos: Object.fromEntries(ordenar(Object.keys(gatilhosPorTabela)).map((t) => [t, gatilhosPorTabela[t].map((g) => `${g.nome}:${g.fn}`).sort()])),
  };
  writeFileSync(join(SAIDA, 'mapa.json'), JSON.stringify(json, null, 1));

  const semNome = ordemTelas.filter((id) => !nomes[id]);
  console.log(`docs/mapa gerado: ${ordemTelas.length} telas, ${tabelas.size} tabelas, ${views.size} views, ${Object.keys(fns).length} funções.`);
  if (semNome.length) console.log(`Telas sem nome de menu (aparecem pela rota): ${semNome.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
