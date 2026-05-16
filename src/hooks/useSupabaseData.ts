import { useState, useEffect, useCallback } from 'react';
import { supabase, ENDPOINT_TABLE_MAP, isSupabaseConfigured } from '../lib/supabase';

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
  options?: { page?: number; searchTerm?: string; searchColumns?: string[] },
) {
  const table = ENDPOINT_TABLE_MAP[endpoint];
  const [data, setData]             = useState<T[]>([]);
  const [isLoading, setLoading]     = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const page    = options?.page;
  const isPaged = page !== undefined;
  const rawSearch = (options?.searchTerm ?? '').trim();
  const searchCols = options?.searchColumns;
  const hasSearch = rawSearch.length > 0 && Array.isArray(searchCols) && searchCols.length > 0;

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

    setLoading(true);
    setError(null);

    const applyFilters = (q: any) => {
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
        .order('created_at', { ascending: false });
      q = applyFilters(q);
      const { data: rows, error: err, count } = await q.range(from, to);
      if (err) {
        console.error('[useFetchData] Erro Supabase:', err.message);
        setError(err.message);
      } else {
        setData((rows ?? []) as T[]);
        setTotalCount(count ?? null);
      }
    } else {
      let q = supabase.from(table).select('*').order('created_at', { ascending: false });
      q = applyFilters(q);
      const { data: rows, error: err } = await q;
      if (err) {
        console.error('[useFetchData] Erro Supabase:', err.message);
        setError(err.message);
      } else {
        setData((rows ?? []) as T[]);
      }
    }

    setLoading(false);
  }, [table, JSON.stringify(extraFilter), page, rawSearch, JSON.stringify(searchCols)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    if (!realtime || !supabase || !table) return;
    const channel = supabase
      .channel(`rt-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => load())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[Realtime] Erro no canal ${table} — dados podem estar desatualizados.`);
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [load, realtime]);

  return { data, setData, isLoading, error, reload: load, totalCount };
}

export async function dbInsert<T = any>(endpoint: string, payload: Partial<T>): Promise<T | null> {
  if (!supabase) throw new Error('Supabase não configurado');
  const table = ENDPOINT_TABLE_MAP[endpoint];
  if (!table) throw new Error(`[dbInsert] Tabela não mapeada para "${endpoint}"`);

  console.debug(`[dbInsert] → ${table}`, payload);

  const { data, error } = await supabase
    .from(table)
    .insert(payload as any)
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

  const { data, error } = await supabase
    .from(table)
    .update(payload as any)
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

  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function dbSetStatus(endpoint: string, id: string, status: string): Promise<void> {
  await dbUpdate(endpoint, id, { status } as any);
}
