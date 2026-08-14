#!/usr/bin/env node
// schema-drift.mjs
// Compara o schema das 4 turmas do LogMax e aponta o que divergiu.
//
// POR QUE ISTO EXISTE
//
// As 4 turmas rodam o mesmo produto em 4 projetos Supabase separados, e cada
// migração é aplicada quatro vezes, à mão. Basta uma falhar no meio (ou nunca
// ter sido rodada) para uma turma passar semanas com o schema diferente sem
// ninguém notar — até uma tela quebrar no meio da aula.
//
// O caso que motivou o script (2026-08-14): a migração 417 tinha a lista de
// colunas da view escrita à mão a partir da LogMax-ERP e quebrou na Aprendiz
// com 42P16, porque lá `categoria` é a 4ª coluna e não a 9ª. A divergência
// existia havia meses e só apareceu quando um DDL dependeu da posição.
//
// Requisitos:
//   - Node 18+ (usa fetch nativo, sem dependência nenhuma)
//   - SUPABASE_ACCESS_TOKEN no ambiente ou no .env — Personal Access Token da
//     conta principal, o mesmo que o MCP da Supabase usa. Um PAT cobre os 4
//     projetos porque a conta é membro das 4 orgs.
//     Criar em: https://supabase.com/dashboard/account/tokens
//
// Uso:
//   npm run drift                 # compara tudo, sai 1 se houver divergência
//   npm run drift -- --verbose    # mostra o valor de cada lado
//   npm run drift -- --only=views,funcoes
//   npm run drift -- --json       # saída para CI
//
// O token NUNCA é impresso, nem em erro.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ─── Projetos ───────────────────────────────────────────────────────────────
// Refs fixos aqui de propósito: são 4 e mudam quando nasce turma nova, que é
// exatamente a hora de editar este arquivo. Override por env para quem quiser
// rodar contra um subconjunto (ex.: LOGMAX_PROJETOS='ERP:jvqsa...,Adm:pvzfa...').
const PROJETOS_PADRAO = [
  { nome: 'LogMax-ERP',     ref: 'jvqsaccupxkvezriiede' },
  { nome: 'Aprendiz',       ref: 'ythesivrqzxhjueuwswq' },
  { nome: 'Contabilidade',  ref: 'yinwjvadtbjgiksdadbt' },
  { nome: 'Adm',            ref: 'pvzfaejminpxkuuhilhz' },
];

// ─── Verificações ───────────────────────────────────────────────────────────
// Cada uma vira um Map chave→valor por projeto. A chave identifica o objeto
// (ex.: 'produtos.preco'); o valor é o que precisa ser igual nos 4.
//
// `informativo: true` = reporta mas não reprova. Hoje só a ordem física das
// colunas: ela diverge por herança de `ADD COLUMN` (que só acrescenta no fim),
// é invisível para o app (PostgREST acessa por nome) e só se corrige
// reconstruindo a tabela — não vale o risco. Mas continua valendo o aviso,
// porque é ela que quebra `CREATE OR REPLACE VIEW`.
const CHECKS = [
  {
    id: 'tabelas',
    titulo: 'Tabelas',
    sql: `select table_name as chave, 'existe' as valor
            from information_schema.tables
           where table_schema='public' and table_type='BASE TABLE'`,
  },
  {
    id: 'colunas',
    titulo: 'Colunas (tipo, nulidade, default)',
    sql: `select c.table_name||'.'||c.column_name as chave,
                 c.data_type||' | '||c.is_nullable||' | '||coalesce(c.column_default,'-') as valor
            from information_schema.columns c
            join information_schema.tables t
              on t.table_schema=c.table_schema and t.table_name=c.table_name
                 and t.table_type='BASE TABLE'
           where c.table_schema='public'`,
  },
  {
    id: 'ordem_colunas',
    titulo: 'Ordem física das colunas',
    informativo: true,
    sql: `select table_name as chave,
                 md5(string_agg(column_name, ',' order by ordinal_position)) as valor
            from information_schema.columns
           where table_schema='public'
           group by table_name`,
  },
  {
    id: 'views',
    titulo: 'Views (definição, colunas, security_invoker)',
    sql: `select c.relname as chave,
                 md5(pg_get_viewdef(c.oid, true))
                 ||' | cols='||(
                   select md5(string_agg(a.attname, ',' order by a.attnum))
                     from pg_attribute a
                    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
                 )
                 ||' | invoker='||coalesce((
                   select 'sim' from unnest(c.reloptions) o
                    where o = 'security_invoker=true' limit 1), 'nao') as valor
            from pg_class c
            join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='v'`,
  },
  {
    id: 'funcoes',
    titulo: 'Funções e RPCs (corpo, security definer)',
    sql: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as chave,
                 md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g'))
                 ||' | definer='||case when p.prosecdef then 'sim' else 'nao' end
                 ||' | ret='||pg_get_function_result(p.oid) as valor
            from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public'`,
  },
  {
    id: 'triggers',
    titulo: 'Triggers',
    sql: `select c.relname||'.'||t.tgname as chave,
                 md5(regexp_replace(pg_get_triggerdef(t.oid), '\\s+', ' ', 'g')) as valor
            from pg_trigger t
            join pg_class c on c.oid=t.tgrelid
            join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and not t.tgisinternal`,
  },
  {
    id: 'policies',
    titulo: 'Policies (RLS)',
    sql: `select tablename||'.'||policyname as chave,
                 cmd||' | '||array_to_string(roles,',')
                 ||' | using='||coalesce(md5(regexp_replace(qual,'\\s+',' ','g')),'-')
                 ||' | check='||coalesce(md5(regexp_replace(with_check,'\\s+',' ','g')),'-') as valor
            from pg_policies
           where schemaname='public'`,
  },
  {
    id: 'rls',
    titulo: 'RLS ligado por tabela',
    sql: `select c.relname as chave,
                 case when c.relrowsecurity then 'ligado' else 'DESLIGADO' end as valor
            from pg_class c
            join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r'`,
  },
  {
    id: 'grants',
    titulo: 'Grants por tabela/view',
    // information_schema.role_table_grants volta vazio neste cluster e engana
    // quem confia nela — a fonte é relacl. Ordenado porque a ordem interna do
    // array varia sem significar nada.
    sql: `select c.relname as chave,
                 coalesce((select string_agg(a, ',' order by a)
                             from unnest(c.relacl::text[]) a), '-') as valor
            from pg_class c
            join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind in ('r','v')`,
  },
  {
    id: 'constraints',
    titulo: 'Constraints (PK, FK, UNIQUE, CHECK)',
    sql: `select c.conrelid::regclass::text||'.'||c.conname as chave,
                 regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g')
                 ||case when c.convalidated then '' else ' [NOT VALID]' end as valor
            from pg_constraint c
            join pg_namespace n on n.oid=c.connamespace
           where n.nspname='public'`,
  },
  {
    id: 'indices',
    titulo: 'Índices',
    sql: `select tablename||'.'||indexname as chave,
                 regexp_replace(indexdef, '\\s+', ' ', 'g') as valor
            from pg_indexes
           where schemaname='public'`,
  },
  {
    id: 'realtime',
    titulo: 'Publicação do Realtime',
    // Tabela fora da publicação = canal que ouve silêncio, e o sintoma no app
    // é "a tela não atualiza sozinha nesta turma".
    sql: `select schemaname||'.'||tablename as chave, 'publicada' as valor
            from pg_publication_tables
           where pubname='supabase_realtime'`,
  },
];

// ─── Argumentos ─────────────────────────────────────────────────────────────
const argv     = process.argv.slice(2);
const temFlag  = (f) => argv.includes(f);
const valorDe  = (f) => argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const VERBOSE  = temFlag('--verbose');
const TODAS    = temFlag('--all');
const JSON_OUT = temFlag('--json');
const ONLY     = valorDe('--only')?.split(',').map(s => s.trim()).filter(Boolean);

const AJUDA = `
Uso: npm run drift [-- opções]

  --only=a,b     roda só estas verificações (${CHECKS.map(c => c.id).join(', ')})
  --all          lista todas as divergências (o padrão corta em 25 por bloco)
  --verbose      mostra o valor divergente de cada projeto (implica --all)
  --json         imprime o relatório em JSON (para CI)
  --help         esta ajuda

Precisa de SUPABASE_ACCESS_TOKEN no ambiente ou no .env.
`;

// ─── Token ──────────────────────────────────────────────────────────────────
// Lê do .env se não veio do ambiente, para não obrigar a exportar variável a
// cada terminal. Parser mínimo de propósito: não vale puxar dependência para
// ler uma linha.
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

const SEM_TOKEN = `
Falta SUPABASE_ACCESS_TOKEN.

  1. Gere um Personal Access Token em
     https://supabase.com/dashboard/account/tokens
  2. Ponha no .env (o arquivo está no .gitignore):
     SUPABASE_ACCESS_TOKEN=sbp_...

É o mesmo token que o MCP da Supabase usa, e um só cobre os 4 projetos.
`;

const PROJETOS = (() => {
  const bruto = process.env.LOGMAX_PROJETOS;
  if (!bruto) return PROJETOS_PADRAO;
  return bruto.split(',').map(par => {
    const [nome, ref] = par.split(':').map(s => s.trim());
    return { nome, ref };
  }).filter(p => p.nome && p.ref);
})();

// ─── Management API ─────────────────────────────────────────────────────────
async function consultar(ref, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    // Corpo pode trazer a query inteira de volta; o token nunca aparece nele,
    // mas cortamos mesmo assim para o log não virar parede.
    const corpo = (await res.text()).slice(0, 400);
    throw new Error(`HTTP ${res.status} em ${ref}: ${corpo}`);
  }
  return res.json();
}

// ─── Coleta e comparação ────────────────────────────────────────────────────
const checksAtivos = ONLY ? CHECKS.filter(c => ONLY.includes(c.id)) : CHECKS;

const hash = (s) => createHash('md5').update(s).digest('hex').slice(0, 8);

// Sentinela para "o objeto não existe neste projeto". Precisa ser um valor que
// nenhuma consulta devolveria, para não confundir ausência com igualdade.
const AUSENTE = '<<ausente>>';

// Normaliza antes de comparar: os corpos de função vêm com \r\n em uns bancos
// e \n em outros (herança de quem colou o SQL de onde), e isso não é drift.
const normalizar = (v) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

async function coletar(projeto) {
  const mapas = {};
  for (const check of checksAtivos) {
    const linhas = await consultar(projeto.ref, check.sql);
    const m = new Map();
    for (const l of linhas) m.set(String(l.chave), normalizar(l.valor));
    mapas[check.id] = m;
  }
  return mapas;
}

// ─── Comparação ─────────────────────────────────────────────────────────────
// Separada e exportada porque é a única parte com regra de decisão — o resto é
// I/O e impressão. `tests/schemaDrift.test.ts` exercita ela sem tocar na rede.
//
// coletas: [{ projeto: {nome}, mapas: { <checkId>: Map<chave, valor> } }]
export function comparar(coletas, checks) {
  const relatorio = [];
  for (const check of checks) {
    const chaves = new Set();
    for (const { mapas } of coletas) for (const k of mapas[check.id].keys()) chaves.add(k);

    const divergencias = [];
    for (const chave of [...chaves].sort()) {
      const valores = coletas.map(({ projeto, mapas }) => ({
        projeto: projeto.nome,
        valor: mapas[check.id].get(chave) ?? null,
      }));
      // Ausente conta como valor distinto: objeto que existe em três turmas e
      // falta na quarta é o caso mais comum de migração não aplicada, e é o
      // que este script existe para pegar.
      const distintos = new Set(valores.map(v => v.valor === null ? AUSENTE : v.valor));
      if (distintos.size > 1) {
        divergencias.push({
          chave,
          ausenteEm: valores.filter(v => v.valor === null).map(v => v.projeto),
          valores,
        });
      }
    }
    relatorio.push({ id: check.id, titulo: check.titulo, informativo: !!check.informativo, divergencias });
  }
  return relatorio;
}

// ─── Execução ───────────────────────────────────────────────────────────────
// Tudo dentro de main(), e o código de saída via `process.exitCode` em vez de
// `process.exit()`: no Windows, sair com socket do fetch ainda no pool derruba
// o Node com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" e engole
// o relatório recém-impresso. Deixar o processo terminar sozinho resolve.
async function main() {
  if (temFlag('--help') || temFlag('-h')) { console.log(AJUDA); return 0; }

  if (checksAtivos.length === 0) {
    console.error(`Nenhuma verificação casou com --only. Válidas: ${CHECKS.map(c => c.id).join(', ')}`);
    return 2;
  }

  if (!TOKEN) { console.error(SEM_TOKEN); return 2; }

  console.error(`Lendo ${PROJETOS.length} projetos (${checksAtivos.length} verificações cada)...`);

  // allSettled, e não all: com `all` a primeira falha abandona as outras
  // requisições no ar e o erro sai truncado. Esperar todas custa nada.
  const resultados = await Promise.allSettled(
    PROJETOS.map(async p => ({ projeto: p, mapas: await coletar(p) })),
  );

  const falhas = resultados.filter(r => r.status === 'rejected');
  if (falhas.length > 0) {
    console.error('\nFalhou ao ler:');
    for (const f of falhas) console.error(`  - ${f.reason?.message ?? f.reason}`);
    console.error('\nSe for 401, o PAT expirou ou não tem acesso a algum projeto.');
    // Comparar só as turmas que responderam daria um "está tudo igual" que é
    // mentira — o silêncio de uma turma é justamente o que se quer detectar.
    return 2;
  }

  const coletas = resultados.map(r => r.value);

  const relatorio = comparar(coletas, checksAtivos);
  const reprovaveis = relatorio.filter(r => !r.informativo && r.divergencias.length > 0);

  // ── Saída ──
  if (JSON_OUT) {
    console.log(JSON.stringify({
      projetos: PROJETOS.map(p => p.nome),
      gerado_em: new Date().toISOString(),
      ok: reprovaveis.length === 0,
      relatorio,
    }, null, 2));
    return reprovaveis.length === 0 ? 0 : 1;
  }

  console.log(`\nProjetos: ${PROJETOS.map(p => p.nome).join(' | ')}\n`);

  for (const r of relatorio) {
    const marca = r.divergencias.length === 0 ? 'OK  ' : (r.informativo ? 'nota' : 'DIFF');
    const sufixo = r.divergencias.length === 0
      ? `igual nos ${coletas.length}`
      : `${r.divergencias.length} divergência(s)${r.informativo ? ' - informativo, não reprova' : ''}`;
    console.log(`[${marca}] ${r.titulo}: ${sufixo}`);

    // Teto de linhas: são ~370 funções e ~170 tabelas por banco. Uma turma
    // atrasada em 20 migrações imprimiria um muro que ninguém lê.
    const mostrar = (VERBOSE || TODAS) ? r.divergencias : r.divergencias.slice(0, 25);

    for (const d of mostrar) {
      if (d.ausenteEm.length > 0) {
        console.log(`       - ${d.chave}: não existe em ${d.ausenteEm.join(', ')}`);
        continue;
      }
      // Agrupa quem tem o mesmo valor: "ERP+Adm=a1b2 <> Aprendiz+Contab=c3d4"
      // diz de cara se uma turma ficou sozinha ou se o grupo é que se moveu.
      const grupos = new Map();
      for (const v of d.valores) {
        const g = grupos.get(v.valor) ?? [];
        g.push(v.projeto);
        grupos.set(v.valor, g);
      }
      const resumo = [...grupos.entries()]
        .map(([valor, projs]) => `${projs.join('+')}=${hash(valor)}`)
        .join(' <> ');
      console.log(`       - ${d.chave}: ${resumo}`);
      if (VERBOSE) {
        for (const [valor, projs] of grupos) {
          console.log(`           ${projs.join(', ')}:`);
          console.log(`             ${valor.slice(0, 500)}`);
        }
      }
    }

    if (mostrar.length < r.divergencias.length) {
      console.log(`       ... e mais ${r.divergencias.length - mostrar.length} (use --all)`);
    }
    if (r.divergencias.length > 0) console.log('');
  }

  if (reprovaveis.length === 0) {
    console.log(`\nSem divergência que importe. As ${coletas.length} turmas estão alinhadas.`);
    if (relatorio.some(r => r.informativo && r.divergencias.length > 0)) {
      console.log('(As notas acima são conhecidas e inertes - vide o cabeçalho do script.)');
    }
    return 0;
  }

  console.log(`\n${reprovaveis.length} verificação(ões) com divergência real.`);
  console.log('Rode com --verbose para ver os dois lados antes de escrever a migração de correção.');
  return 1;
}

// Só roda quando chamado direto (`npm run drift`). O teste importa `comparar`
// deste mesmo arquivo, e sem esta guarda o import dispararia o script inteiro.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

