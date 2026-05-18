import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface CaixaAberto {
  id: string;
  data: string;
  valor_abertura: number;
  status: 'Aberto' | 'Fechado';
  aberto_por: string | null;
  aberto_por_nome: string | null;
  aberto_em: string | null;
}

export function useCaixaAberto() {
  const [caixa, setCaixa] = useState<CaixaAberto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];

  const refresh = useCallback(async () => {
    if (!supabase) { setIsLoading(false); return; }
    try {
      const { data } = await supabase
        .from('controle_caixa')
        .select('*')
        .eq('data', today)
        .eq('status', 'Aberto')
        .eq('ativo', true)
        .maybeSingle();
      setCaixa(data ?? null);
    } catch {
      setCaixa(null);
    } finally {
      setIsLoading(false);
    }
  }, [today]);

  useEffect(() => {
    refresh();
    if (!supabase) return;
    // Realtime: quando alguém abrir o caixa, todos os outros são notificados automaticamente
    const channel = supabase
      .channel('caixa-aberto-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'controle_caixa' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  return { caixa, isLoading, refresh };
}
