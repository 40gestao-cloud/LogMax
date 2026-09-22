import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, ENDPOINT_TABLE_MAP, TABLES_WITH_ATIVO, isSupabaseConfigured } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { sanitizeUuidFks } from '../lib/viewUtils';

export const PAGE_SIZE = 50;

// Escapa caracteres com significado especial em PostgREST `or()` filters.
// Vírgula separa cláusulas; parêntesis agrupam; `*` é wildcard PostgREST.
function escapePostgrestSearch(s: string): string {
  return s.replace(/[,()*]/g, ' ');
}

// Valor que pode entrar num filtro de realtime sem escapar nada. Nome de
// filial é SuperMax/MaxLook/TechMax/Matriz; qualquer coisa fora disso não
// entra no canal — filtro malformado derruba a assinatura inteira, e realtime
// morto é calado.
const VALOR_FILTRAVEL = /^[A-Za-z0-9_-]+$/;

/**
 * Filtro de filial para o canal de realtime — ou null, quando não dá para
 * filtrar com segurança.
 *
 * Por que existe. O canal ouvia a tabela INTEIRA mesmo quando a tela só lia
 * uma unidade: uma venda na SuperMax acordava a máquina da TechMax, que relia
 * `produtos` e recebia de volta exatamente o que já tinha. Com três unidades
 * na sala, dois terços das releituras eram isso.
 *
 * Por que só em tabela com soft delete. O filtro do realtime é avaliado sobre
 * o registro NOVO, e num DELETE o registro velho só traz o que a REPLICA
 * IDENTITY manda — que nestes 64 casos é a chave primária, sem `filial`. Um
 * DELETE real nunca casaria com `filial=eq.X` e a linha sumiria do banco sem
 * sumir da tela. Em tabela com `ativo` o apagar é UPDATE (dbDelete), o
 * registro novo vem completo e o filtro casa. Fora dessas, ouve tudo.
 *
 * O caso que escapa: linha que MUDA de filial deixa de avisar quem ouvia a
 * filial antiga. Não acontece nos cadastros desta casa (produto não muda de
 * unidade), e a reconexão do websocket relê tudo de qualquer jeito.
 */
function filtroFilialDoCanal(
  table: string | undefined,
  extraFilter: Record<string, any> | undefined,
): string | null {
  if (!table || !TABLES_WITH_ATIVO.has(table)) return null;
  const valor = extraFilter?.filial;
  // Array (`{ filial: ['TechMax', 'Matriz'] }`) fica de fora por ora: o `in`
  // do realtime é outra sintaxe e não vale arriscar o canal por ele.
  if (typeof valor !== 'string' || !VALOR_FILTRAVEL.test(valor)) return null;
  return `filial=eq.${valor}`;
}

export function useFetchData<T = any>(
  endpoint: string,
  extraFilter?: Record<string, any>,
  realtime?: boolean,
  options?: {
    page?: number;
    searchTerm?: string;
    searchColumns?: string[];
    includeInactive?: boolean;
    /** Coluna usada no ORDER BY. Default: 'created_at'. Tabelas
     *  sem essa coluna (ex.: snapshot, append-only com timestamp próprio)
     *  devem passar a coluna correta — senão PostgREST devolve 400 e a
     *  UI fica vazia silenciosamente. */
    orderBy?: string;
    /** Direção do ORDER BY. Default: false (DESC — mais novo primeiro,
     *  natural para timestamps). Use `true` quando ordenar por código
     *  ou nome em ordem crescente. */
    ascending?: boolean;
  },
) {
  const table = ENDPOINT_TABLE_MAP[endpoint];
  const softDelete = !!table && TABLES_WITH_ATIVO.has(table);
  const includeInactive = !!options?.includeInactive;
  const orderBy = options?.orderBy ?? 'created_at';
  const ascending = options?.ascending ?? false;
  const [data, setData]             = useState<T[]>([]);
  const [isLoading, setLoading]     = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const page    = options?.page;
  const isPaged = page !== undefined;
  const rawSearch = (options?.searchTerm ?? '').trim();
  const searchCols = options?.searchColumns;
  const hasSearch = rawSearch.length > 0 && Array.isArray(searchCols) && searchCols.length > 0;

  // Sequência incremental para descartar respostas obsoletas. Sem isto,
  // se o utilizador digitar rápido na busca a query A (lenta) chega depois
  // da B (rápida) e sobrescreve a UI com resultados antigos. Cada chamada
  // de load() captura o seu ID e só faz setState se ainda for o pedido
  // corrente — caso contrário a resposta é ignorada.
  const reqIdRef = useRef(0);

  // `silent` = refetch em background (disparado por realtime). NÃO liga
  // isLoading: telas que fazem `if (isLoading) return <spinner>` desmontam a
  // árvore inteira a cada evento — no PDV isso piscava a tela e apagava o
  // modal do PIX no meio da operação, porque `produtos` está na publicação
  // realtime e qualquer venda da turma dispara o evento.
  // Objeto (e não boolean) porque `reload` é passado direto como onClick em
  // várias telas — um MouseEvent como 1º arg viraria `silent = true`.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!table) {
      // Antes isto só logava um warn e devolvia lista vazia. O resultado é
      // uma tela que abre bonita e sem dado nenhum — indistinguível de "não
      // há registros" — e o defeito sobrevive meses. Aconteceu com seis
      // endpoints de Capital e Pedidos Online. Agora popula `error`, que as
      // telas já sabem exibir.
      const msg = `Tabela não mapeada para "${endpoint}" — adicione a chave em ENDPOINT_TABLE_MAP (src/lib/supabase.ts).`;
      console.error(`[useFetchData] ${msg}`);
      setError(msg);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    const myId = ++reqIdRef.current;
    if (!silent) setLoading(true);
    setError(null);

    const applyFilters = (q: any) => {
      // Soft delete: por padrão lista só registros ativos. Opt-out via
      // options.includeInactive (ex.: telas de "arquivados").
      if (softDelete && !includeInactive) {
        q = q.eq('ativo', true);
      }
      if (extraFilter) {
        for (const [col, val] of Object.entries(extraFilter)) {
          // Array          -> IN (...)   ex.: { status: ['Ativo', 'Pausado'] }
          // { neq }        -> <> valor   ex.: { tipo: { neq: 'patrimonio' } }
          // { gte?, lte? } -> intervalo  ex.: { vencimento: { gte: 'a', lte: 'b' } }
          // { notNull }    -> IS NOT NULL ex.: { folha_pagamento_id: { notNull: true } }
          // escalar        -> = valor    ex.: { filial: 'SuperMax' }
          // Todos precisam ser resolvidos no servidor (e não filtrando o array
          // já carregado) senão `totalCount` e a paginação passam a contar
          // linhas que a tela não mostra.
          if (val !== null && typeof val === 'object' && !Array.isArray(val) && 'neq' in (val as object)) {
            q = q.neq(col, (val as { neq: unknown }).neq);
          } else if (val !== null && typeof val === 'object' && !Array.isArray(val) && 'notNull' in (val as object)) {
            q = (val as { notNull: boolean }).notNull ? q.not(col, 'is', null) : q.is(col, null);
          } else if (
            val !== null && typeof val === 'object' && !Array.isArray(val) &&
            ('gte' in (val as object) || 'lte' in (val as object))
          ) {
            const range = val as { gte?: unknown; lte?: unknown };
            if (range.gte !== undefined) q = q.gte(col, range.gte);
            if (range.lte !== undefined) q = q.lte(col, range.lte);
          } else {
            q = Array.isArray(val) ? q.in(col, val) : q.eq(col, val);
          }
        }
      }
      if (hasSearch) {
        const safe = escapePostgrestSearch(rawSearch);
        const orClause = searchCols!.map(c => `${c}.ilike.%${safe}%`).join(',');
        q = q.or(orClause);
      }
      return q;
    };

    if (isPaged) {
      const from = page! * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from(table)
        .select('*', { count: 'exact' })
        .order(orderBy, { ascending });
      q = applyFilters(q);
      const { data: rows, error: err, count } = await q.range(from, to);
      if (myId !== reqIdRef.current) return; // resposta obsoleta — ignora
      if (err) {
        console.error('[useFetchData] Erro Supabase:', err.message);
        setError(err.message);
      } else {
        setData((rows ?? []) as T[]);
        setTotalCount(count ?? null);
      }
    } else {
      let q = supabase.from(table).select('*').order(orderBy, { ascending });
      q = applyFilters(q);
      const { data: rows, error: err } = await q;
      if (myId !== reqIdRef.current) return; // resposta obsoleta — ignora
      if (err) {
        console.error('[useFetchData] Erro Supabase:', err.message);
        setError(err.message);
      } else {
        setData((rows ?? []) as T[]);
      }
    }

    setLoading(false);
  }, [table, softDelete, includeInactive, JSON.stringify(extraFilter), page, rawSearch, JSON.stringify(searchCols), orderBy, ascending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 1: chama load() quando filtros / paginação / busca mudam.
  useEffect(() => {
    load();
  }, [load]);

  // Effect 2: subscrição realtime separada — só reconecta quando a tabela
  // ou o flag `realtime` mudam. Antes o canal era recriado a cada keystroke
  // de busca / mudança de filtro / paginação (effect dependia de `load`),
  // causando churn na conexão WebSocket. Agora o canal sobrevive a mudanças
  // de filtro e dispara o load mais recente via ref.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // A janela sorteada do `assinarRealtime` substitui o debounce de 250ms: o
  // problema não era só a rajada de um import em massa, era a turma inteira
  // relendo a MESMA tabela no mesmo instante. Este hook é o mais usado do app,
  // então é aqui que a manada era maior.
  //
  // O canal também estreita para a filial quando a tela já está lendo só ela
  // (vide `filtroFilialDoCanal`) — evento de outra unidade não acorda mais
  // esta máquina.
  const filtroCanal = filtroFilialDoCanal(table, extraFilter);
  useEffect(() => {
    if (!realtime || !table) return;
    return assinarRealtime({
      nome: `rt-${table}`,
      alvos: [filtroCanal ? { tabela: table, filtro: filtroCanal } : table],
      aoMudar: () => { void loadRef.current({ silent: true }); }, // não pisca a UI
    });
  }, [table, realtime, filtroCanal]);

  return { data, setData, isLoading, error, reload: load, totalCount };
}

// Erro de RLS chegava cru na tela: "new row violates row-level security policy
// for table \"categorias_produto\"". O aluno lê "política de segurança" e acha
// que quebrou o sistema; o professor recebe o print sem saber o que olhar.
//
// Na prática, quase sempre é a UNIDADE: conta sem filial no perfil (criada numa
// leva e ainda não distribuída, migr. 411) ou operando uma unidade que não é a
// dela. `auth_pode_filial(NULL)` devolve NULL, e NULL numa policy é recusa —
// idêntica a "não pode", sem dizer por quê.
// Índice único → frase que diz o que fazer. O gatilho companheiro (migr. 538)
// já explica no caso normal; isto aqui é para a corrida rara em que dois
// INSERTs simultâneos passam os dois pelo `EXISTS` do gatilho e é o índice que
// barra o segundo — aí a mensagem que chega é o texto cru do Postgres
// ("duplicate key value violates unique constraint ..."), que não diz nada a
// quem está na tela.
const MSG_POR_CONSTRAINT: Record<string, string> = {
  uq_cotacao_viva_requisicao_fornecedor:
    'Já existe uma proposta viva deste fornecedor para esta requisição. Comparar '
    + 'preço é cotar fornecedores DIFERENTES — escolha outro fornecedor, ou cancele '
    + 'a proposta anterior antes de repetir este.',
  // Migr. 535. Aqui não há gatilho companheiro: o índice fala sozinho, então
  // esta frase é a única explicação que o aluno recebe.
  uq_produtos_nome_filial_ativo:
    'Já existe um produto ativo com este nome nesta unidade. Se é o mesmo item, '
    + 'use o que já está no catálogo em vez de cadastrar de novo — dois cadastros '
    + 'partem o estoque em dois. Se é outro produto, diferencie o nome (marca, '
    + 'tamanho, volume).',
  // Migr. 550. Os gatilhos companheiros (`fn_produto_ean_valido` e
  // `fn_produto_variante_ja_existe`) barram antes e conseguem NOMEAR o cadastro
  // que está no caminho — coisa que o índice não faz. Estas frases são a rede
  // de baixo, para o caso de o índice pegar primeiro (corrida entre duas abas).
  uq_produtos_ean_filial:
    'Este código de barras já está em outro produto desta unidade. Dois produtos '
    + 'com o mesmo EAN fazem o PDV vender o errado — confira o número na embalagem, '
    + 'ou clique em "Gerar" para um código interno.',
  uq_produtos_variante:
    'Esta combinação de tamanho e cor já existe neste modelo. Cada variante é um '
    + 'cadastro só — dois partem o estoque da peça em dois. Edite a que já existe, '
    + 'ou escolha outra combinação.',
  // Migr. 491, índice (filial, nf_numero, nf_serie). Sem esta frase o aluno
  // recebia o texto cru do Postgres, não entendia que a carga já tinha entrado
  // e clicava em Registrar de novo — na turma da tarde de 22/09 isso virou 42
  // reenvios em meia hora, cada um acordando a sala inteira para recontar
  // badge. A mensagem que explica é o que faz a repetição parar.
  uq_recebimento_nf_por_filial:
    'Esta nota fiscal já foi lançada nesta unidade. Se você acabou de registrar '
    + 'e a tela demorou, a carga PROVAVELMENTE já entrou — procure-a na lista '
    + 'antes de lançar de novo. Se é outra carga, confira o número e a série da '
    + 'nota: duas entradas com a mesma nota cobram o fornecedor duas vezes.',
};

function traduzErroDeGravacao(error: { code?: string; message?: string }): string {
  const msg = error?.message ?? '';

  if (error?.code === '23505') {
    for (const [constraint, amigavel] of Object.entries(MSG_POR_CONSTRAINT)) {
      if (msg.includes(constraint)) return amigavel;
    }
  }

  const ehRls = error?.code === '42501' || /row-level security|violates row-level/i.test(msg);
  if (!ehRls) return msg;
  return 'Sem permissão para gravar neste registro. Quase sempre é a unidade: '
       + 'confira se você está operando a sua unidade e se o seu cadastro tem uma '
       + 'unidade definida — conta sem unidade não grava em lugar nenhum. '
       + 'Persistindo, chame o professor.';
}

export async function dbInsert<T = any>(endpoint: string, payload: Partial<T>): Promise<T | null> {
  if (!supabase) throw new Error('Supabase não configurado');
  const table = ENDPOINT_TABLE_MAP[endpoint];
  if (!table) throw new Error(`[dbInsert] Tabela não mapeada para "${endpoint}"`);

  const cleaned = sanitizeUuidFks(payload as any);
  console.debug(`[dbInsert] → ${table}`, cleaned);

  const { data, error } = await supabase
    .from(table)
    .insert(cleaned as any)
    .select()
    .single();

  if (error) {
    console.error(`[dbInsert] ✗ ${table}:`, error.message, '| código:', error.code, '| detalhe:', error.details);
    throw new Error(traduzErroDeGravacao(error));
  }

  console.debug(`[dbInsert] ✓ ${table}`, data);
  return data as T;
}

export async function dbUpdate<T = any>(endpoint: string, id: string, payload: Partial<T>): Promise<T | null> {
  if (!supabase) throw new Error('Supabase não configurado');
  const table = ENDPOINT_TABLE_MAP[endpoint];
  if (!table) throw new Error(`[dbUpdate] Tabela não mapeada para "${endpoint}"`);

  const cleaned = sanitizeUuidFks(payload as any);

  const { data, error } = await supabase
    .from(table)
    .update(cleaned as any)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error(`[dbUpdate] ✗ ${table}:`, error.message, '| código:', error.code, '| detalhe:', error.details);
    throw new Error(traduzErroDeGravacao(error));
  }
  return data as T;
}

export async function dbDelete(endpoint: string, id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase não configurado');
  const table = ENDPOINT_TABLE_MAP[endpoint];
  if (!table) return;

  // Soft delete por padrão (preserva histórico, evita FK violation). Hard delete
  // só nas tabelas fora de TABLES_WITH_ATIVO (auditoria, cascades, efêmeras).
  if (TABLES_WITH_ATIVO.has(table)) {
    const { data, error } = await supabase
      .from(table)
      .update({ ativo: false })
      .eq('id', id)
      .select();
    if (error) {
      console.error(`[dbDelete:soft] ✗ ${table}:`, error.message, '| código:', error.code, '| detalhe:', error.details);
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      throw new Error('Nenhum registro inativado. Permissão (RLS) negada ou registro já não existe.');
    }
    return;
  }

  // Hard delete (tabelas fora do soft delete). `.select()` detecta RLS silent fail.
  const { data, error } = await supabase.from(table).delete().eq('id', id).select();
  if (error) {
    console.error(`[dbDelete:hard] ✗ ${table}:`, error.message, '| código:', error.code, '| detalhe:', error.details);
    throw new Error(traduzErroDeGravacao(error));
  }
  if (!data || data.length === 0) {
    throw new Error('Nenhum registro removido. Permissão (RLS) negada ou registro já não existe.');
  }
}

export async function dbSetStatus(endpoint: string, id: string, status: string): Promise<void> {
  await dbUpdate(endpoint, id, { status } as any);
}
