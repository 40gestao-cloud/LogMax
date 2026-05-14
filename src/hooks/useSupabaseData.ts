import { useState, useEffect, useCallback } from 'react';
import { supabase, ENDPOINT_TABLE_MAP, isSupabaseConfigured } from '../lib/supabase';

export function useFetchData<T = any>(endpoint: string, extraFilter?: Record<string, any>) {
  const table = ENDPOINT_TABLE_MAP[endpoint];
  const [data, setData]         = useState<T[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);

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

    let query = supabase.from(table).select('*').order('created_at', { ascending: false });

    if (extraFilter) {
      for (const [col, val] of Object.entries(extraFilter)) {
        query = query.eq(col, val);
      }
    }

    const { data: rows, error: err } = await query;

    if (err) {
      console.error('[useFetchData] Erro Supabase:', err.message);
      setError(err.message);
    } else {
      setData((rows ?? []) as T[]);
    }
    setLoading(false);
  }, [table, JSON.stringify(extraFilter)]);

  useEffect(() => { load(); }, [load]);

  return { data, setData, isLoading, error, reload: load };
}

export async function dbInsert<T = any>(endpoint: string, payload: Partial<T>): Promise<T | null> {
  if (!supabase) throw new Error('Supabase não configurado');
  const table = ENDPOINT_TABLE_MAP[endpoint];
  if (!table) {
    console.warn(`[dbInsert] Tabela não mapeada para "${endpoint}"`);
    return null;
  }

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
  if (!table) return null;

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
