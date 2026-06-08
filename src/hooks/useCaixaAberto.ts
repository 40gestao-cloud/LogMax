import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { FILIAIS_HOLDING, type FilialHolding } from '../lib/filiais';

// Filiais que operam PDV/caixa (Matriz é administrativa, fica de fora).
export const FILIAIS_OPERACIONAIS = FILIAIS_HOLDING.filter(f => f !== 'Matriz') as readonly Exclude<FilialHolding, 'Matriz'>[];
export type FilialOperacional = typeof FILIAIS_OPERACIONAIS[number];

export interface CaixaAberto {
  id: string;
  data: string;
  filial: FilialOperacional;
  valor_abertura: number;
  status: 'Aberto' | 'Fechado';
  aberto_por: string | null;
  aberto_por_nome: string | null;
  aberto_em: string | null;
}

// Caixa aberto de UMA filial específica. PDV usa este — só vende quando o
// caixa daquela unidade está aberto.
export function useCaixaAberto(filial: FilialOperacional | null) {
  const [caixa, setCaixa] = useState<CaixaAberto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const today = todayBR();

  const refresh = useCallback(async () => {
    if (!supabase || !filial) { setCaixa(null); setIsLoading(false); return; }
    try {
      const { data } = await supabase
        .from('controle_caixa')
        .select('*')
        .eq('data', today)
        .eq('filial', filial)
        .eq('status', 'Aberto')
        .eq('ativo', true)
        .maybeSingle();
      setCaixa(data ?? null);
    } catch {
      setCaixa(null);
    } finally {
      setIsLoading(false);
    }
  }, [today, filial]);

  useEffect(() => {
    refresh();
    if (!supabase || !filial) return;
    const channel = supabase
      .channel(`caixa-aberto-${filial}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'controle_caixa', filter: `filial=eq.${filial}` },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh, filial]);

  return { caixa, isLoading, refresh };
}

// Mapa { SuperMax, MaxLook, TechMax } pra ControleCaixaView mostrar 3 cards
// de uma vez, com status independente. Realtime watch único pra todos.
export function useCaixasDoDia() {
  const [caixas, setCaixas] = useState<Record<FilialOperacional, CaixaAberto | null>>(
    () => Object.fromEntries(FILIAIS_OPERACIONAIS.map(f => [f, null])) as Record<FilialOperacional, CaixaAberto | null>,
  );
  const [isLoading, setIsLoading] = useState(true);
  const today = todayBR();

  const refresh = useCallback(async () => {
    if (!supabase) { setIsLoading(false); return; }
    try {
      const { data } = await supabase
        .from('controle_caixa')
        .select('*')
        .eq('data', today)
        .eq('status', 'Aberto')
        .eq('ativo', true);
      const next = Object.fromEntries(FILIAIS_OPERACIONAIS.map(f => [f, null])) as Record<FilialOperacional, CaixaAberto | null>;
      (data ?? []).forEach((row: any) => {
        if ((FILIAIS_OPERACIONAIS as readonly string[]).includes(row.filial)) {
          next[row.filial as FilialOperacional] = row;
        }
      });
      setCaixas(next);
    } finally {
      setIsLoading(false);
    }
  }, [today]);

  useEffect(() => {
    refresh();
    if (!supabase) return;
    const channel = supabase
      .channel('caixas-do-dia-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'controle_caixa' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  return { caixas, isLoading, refresh };
}
