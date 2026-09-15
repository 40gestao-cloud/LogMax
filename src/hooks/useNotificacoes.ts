import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';

export type Notificacao = {
  id: string;
  setor: string;
  // Espelha `chk_notif_tipo` no banco. Os quatro últimos existiam na CHECK e
  // faltavam aqui — e o mapa de ícones do sino é indexado por este tipo, então
  // notificação de treinamento ou briefing chegava com ícone `undefined`.
  tipo:
    | 'aprovacao_pendente' | 'aprovado' | 'reprovado'
    | 'mensagem_setor' | 'tarefa_atribuida' | 'tarefa_concluida'
    | 'ti_chamado' | 'ti_resolvido' | 'info'
    | 'treinamento_atribuido' | 'briefing_diario' | 'justificativa_falta'
    | 'devolvido_correcao';
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
 *
 * `filial` é a unidade em que a pessoa está operando. A RLS sozinha não
 * resolve: `auth_pode_filial()` deixa admin, CEO e conselheiro passarem em
 * todas as filiais, então o sino do professor dentro da TechMax mostrava o
 * chamado de TI do SuperMax. Quem opera dentro de uma unidade só tem de ver o
 * que é dela; em Matriz (`filial` nulo) continua vendo tudo, que é o ponto de
 * estar na Matriz.
 */
export function useNotificacoes(setor: string | undefined | null, filial?: string | null) {
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

    // RLS filtra por setor; a unidade é filtrada aqui. `is('filial', null)` no
    // OR porque notificação sem filial é recado do sistema para todo mundo —
    // some se o filtro for só `eq`.
    if (filial) q = q.or(`filial.eq.${filial},filial.is.null`);

    const { data: rows, error } = await q;
    if (!error && rows) setData(rows as Notificacao[]);
    setLoading(false);
  }, [setor, filial]);

  // A janela do `assinarRealtime` substitui o debounce de 250ms daqui: o
  // sino também piscava, mas o problema maior era a turma inteira relendo a
  // lista no mesmo instante a cada `notificar_setor()`.
  useEffect(() => {
    load();
    if (!setor) return;
    return assinarRealtime({
      nome: `notificacoes-${setor}`,
      alvos: ['notificacoes'],
      aoMudar: () => { load(); },
    });
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
