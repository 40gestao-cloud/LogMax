import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, ENDPOINT_TABLE_MAP, TABLES_WITH_ATIVO, isSupabaseConfigured } from '../lib/supabase';
import { sanitizeUuidFks } from '../lib/viewUtils';

export const PAGE_SIZE = 50;

// Escapa caracteres com significado especial em PostgREST `or()` filters.
// Vírgula separa cláusulas; parêntesis agrupam; `*` é wildcard PostgREST.
function escapePostgrestSearch(s: string): string {
  return s.replace(/[,()*]/g, ' ');
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
    /** Coluna usada no ORDER BY DESC. Default: 'created_at'. Tabelas
     *  sem essa coluna (ex.: snapshot, append-only com timestamp próprio)
     *  devem passar a coluna correta — senão PostgREST devolve 400 e a
     *  UI fica vazia silenciosamente. */
    orderBy?: string;
  },
) {
  const table = ENDPOINT_TABLE_MAP[endpoint];
  const softDelete = !!table && TABLES_WITH_ATIVO.has(table);
  const includeInactive = !!options?.includeInactive;
  const orderBy = options?.orderBy ?? 'created_at';
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

  const load = useCallback(async () => {
    if (!table) {
      console.warn(`[useFetchData] Tabela não mapeada para "${endpoint}"`);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    const applyFilters = (q: any) => {
      // Soft delete: por padrão lista só registros ativos. Opt-out via
      // options.includeInactive (ex.: telas de "arquivados").
      if (softDelete && !includeInactive) {
        q = q.eq('ativo', true);
      }
      if (extraFilter) {
        for (const [col, val] of Object.entries(extraFilter)) {
          q = q.eq(col, val);
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
        .order(orderBy, { ascending: false });
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
      let q = supabase.from(table).select('*').order(orderBy, { ascending: false });
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
  }, [table, softDelete, includeInactive, JSON.stringify(extraFilter), page, rawSearch, JSON.stringify(searchCols), orderBy]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (!realtime || !supabase || !table) return;
    // crypto.randomUUID() em vez de Math.random — qualidade criptográfica,
    // sem chance teórica de colisão entre instâncias paralelas do hook.
    const channelId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`rt-${table}-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => loadRef.current())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[Realtime] Erro no canal ${table} — dados podem estar desatualizados.`);
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [table, realtime]);

  return { data, setData, isLoading, error, reload: load, totalCount };
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
    throw new Error(error.message);
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

  if (error) throw new Error(error.message);
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
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error('Nenhum registro removido. Permissão (RLS) negada ou registro já não existe.');
  }
}

export async function dbSetStatus(endpoint: string, id: string, status: string): Promise<void> {
  await dbUpdate(endpoint, id, { status } as any);
}
