import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Grupo de apoio do Modo Aula (migr. 669): uma segunda config da aula, que
// vale para os integrantes no lugar da config da turma.
//
// A RLS já recorta o que cada um enxerga: o integrante lê a própria linha e a
// config; quem está fora não lê nada (e nem fica sabendo que o grupo existe).
// O admin lê tudo, mas nunca é filtrado pelo Modo Aula.
//
// Vive no `App.tsx`, junto do `useAulaConfig`, acima dos early returns.

import type { GrupoApoioConfig } from '../lib/aulaModulos';

const ler = (raw: any): GrupoApoioConfig => ({
  ativo: !!raw?.ativo,
  modulos_ativos: raw?.modulos_ativos ?? [],
  submenus_ativos: raw?.submenus_ativos ?? [],
  atualizado_em: raw?.atualizado_em ?? null,
});

export function useGrupoApoio(userId: string | null | undefined) {
  const [membro, setMembro] = useState(false);
  const [config, setConfig] = useState<GrupoApoioConfig | null>(null);
  const cancelado = useRef(false);

  // Relê as duas coisas juntas: o evento da config é o único aviso que chega
  // (a lista de integrantes não é publicada), e quem acabou de ser incluído só
  // passa a receber evento justamente por já estar no grupo.
  const carregar = useCallback(async () => {
    if (!supabase || !userId) return;
    const [m, c] = await Promise.all([
      supabase.from('aula_grupo_apoio').select('user_id').eq('user_id', userId).maybeSingle(),
      supabase.from('aula_grupo_apoio_config')
        .select('ativo, modulos_ativos, submenus_ativos, atualizado_em').eq('id', 1).maybeSingle(),
    ]);
    if (cancelado.current) return;
    // Banco sem as tabelas (turma sem a 669) devolve erro: fica de fora, que é
    // o comportamento de antes do recurso existir.
    if (!m.error) setMembro(!!m.data);
    if (!c.error) setConfig(c.data ? ler(c.data) : null);
  }, [userId]);

  useEffect(() => {
    cancelado.current = false;
    if (!userId || !isSupabaseConfigured || !supabase) {
      setMembro(false); setConfig(null);
      return;
    }
    const sb = supabase;
    carregar();

    // Nome único por instância: canal com nome fixo montado duas vezes derruba
    // a si mesmo. Quem está fora do grupo não recebe evento (RLS).
    const sufixo = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = sb
      .channel(`aula-grupo-apoio-${sufixo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_grupo_apoio_config' },
        () => { carregar(); })
      .subscribe(status => { if (status === 'SUBSCRIBED') carregar(); });

    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', carregar);

    return () => {
      cancelado.current = true;
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', carregar);
      sb.removeChannel(ch);
    };
  }, [userId, carregar]);

  return { membro, config };
}
