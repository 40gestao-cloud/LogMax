import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export type Notificacao = {
  id: string;
  setor: string;
  tipo:
    | 'aprovacao_pendente' | 'aprovado' | 'reprovado'
    | 'mensagem_setor' | 'tarefa_atribuida' | 'tarefa_concluida'
    | 'ti_chamado' | 'ti_resolvido' | 'info';
  titulo: string;
  mensagem?: string | null;
  link_view?: string | null;
  urgencia: 'Baixa' | 'Média' | 'Alta';
  lido: boolean;
  origem_setor?: string | null;
  motivo?: string | null;
  created_at: string;
};

/**
 * Notificações por setor. `setor` é o setor do destinatário (geralmente o
 * setor do usuário logado). Admin/CEO (setor 'all') recebe todas as notif.
 * Realtime via Supabase channel.
 */
export function useNotificacoes(setor: string | undefined | null) {
  const [data, setData] = useState<Notificacao[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !setor) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let q = supabase
      .from('notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    // RLS já filtra por setor; aqui só ordenamos. Para setores específicos,
    // a UI pode optar por filtrar localmente (sino por página).
    const { data: rows, error } = await q;
    if (!error && rows) setData(rows as Notificacao[]);
    setLoading(false);
  }, [setor]);

  useEffect(() => {
    load();
    if (!supabase || !setor) return;
    const ch = supabase
      .channel(`notificacoes-${setor}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, setor]);

  const unreadCount = useMemo(() => data.filter(n => !n.lido).length, [data]);

  const markRead = useCallback(async (id: string) => {
    if (!supabase) return;
    setData(prev => prev.map(n => n.id === id ? { ...n, lido: true } : n));
    await supabase.rpc('marcar_notificacao_lida', { p_id: id });
  }, []);

  const markAllRead = useCallback(async () => {
    if (!supabase) return;
    setData(prev => prev.map(n => ({ ...n, lido: true })));
    await supabase.rpc('marcar_todas_lidas', { p_setor: setor ?? null });
  }, [setor]);

  return { data, isLoading, unreadCount, markRead, markAllRead, reload: load };
}
