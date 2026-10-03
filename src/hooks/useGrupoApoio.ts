import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { GrupoApoioConfig } from '../lib/aulaModulos';

// Grupo de apoio do Modo Aula (migr. 669): uma segunda config da aula, que
// vale para os integrantes no lugar da config da turma.
//
// A RLS já recorta o que cada um enxerga: o integrante lê a própria linha e a
// config; quem está fora não lê nada (e nem fica sabendo que o grupo existe).
//
// Vive no `App.tsx`, junto do `useAulaConfig`, acima dos early returns. O App
// passa `null` para o admin: ele nunca é filtrado pelo Modo Aula, então não
// gasta leitura nem canal com isto.
//
// Custo no boot, porque é pago por cada máquina da sala no mesmo minuto:
// quem está fora do grupo faz UMA leitura (a própria participação, que volta
// vazia) e só lê a config se estiver dentro.

/** Quem está no grupo confere a participação de tempos em tempos: ser tirado
 *  do grupo não gera evento que chegue até ele (a RLS já não o deixa ver). */
const RECONFERIR_INTEGRANTE_MS = 60_000;

/** A primeira assinatura do canal chega logo depois da leitura do boot; reler
 *  ali só dobraria a consulta. Reassinatura (socket que caiu) relê. */
const JANELA_BOOT_MS = 5_000;

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
  const lidoEm = useRef(0);

  const carregar = useCallback(async () => {
    if (!supabase || !userId) return;
    lidoEm.current = Date.now();
    const m = await supabase.from('aula_grupo_apoio').select('user_id').eq('user_id', userId).maybeSingle();
    if (cancelado.current) return;
    // Banco sem as tabelas (turma sem a 669) devolve erro: fica de fora, que é
    // o comportamento de antes do recurso existir.
    if (m.error || !m.data) {
      if (!m.error) { setMembro(false); setConfig(null); }
      return;
    }
    const c = await supabase.from('aula_grupo_apoio_config')
      .select('ativo, modulos_ativos, submenus_ativos, atualizado_em').eq('id', 1).maybeSingle();
    if (cancelado.current) return;
    setMembro(true);
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

    // O evento da config é o aviso que chega a quem está DENTRO no momento da
    // mudança (RLS) — inclusive a quem acabou de ser incluído: a tela do
    // professor toca a config ao incluir com o grupo ligado. Nome único por
    // instância: canal com nome fixo montado duas vezes derruba a si mesmo.
    const sufixo = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = sb
      .channel(`aula-grupo-apoio-${sufixo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_grupo_apoio_config' },
        () => { carregar(); })
      .subscribe(status => {
        if (status === 'SUBSCRIBED' && Date.now() - lidoEm.current > JANELA_BOOT_MS) carregar();
      });

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

  // Só quem está no grupo (meia dúzia de máquinas, no máximo) reconfere.
  useEffect(() => {
    if (!membro) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, RECONFERIR_INTEGRANTE_MS);
    return () => clearInterval(id);
  }, [membro, carregar]);

  return { membro, config };
}
