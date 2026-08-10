import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface AulaConfig {
  ativo: boolean;
  modulos_ativos: string[];
  submenus_ativos: string[];
  roles_afetados: string[];
  atualizado_em: string | null;
}

const DEFAULT: AulaConfig = {
  ativo: false,
  modulos_ativos: [],
  submenus_ativos: [],
  roles_afetados: ['colaborador', 'gerente'],
  atualizado_em: null,
};

// Última config conhecida, guardada no próprio dispositivo.
//
// Enquanto o fetch não volta, `config` valia DEFAULT — e DEFAULT é
// `ativo: false`, ou seja, "sem aula, mostre tudo". Numa rede que demora (ou
// numa requisição que morre), a turma passava a aula inteira com o menu
// completo aberto e nada no app dizia que aquilo era um estado provisório.
//
// Partir da última config conhecida erra para o lado certo: se a aula estava
// ligada, ela continua ligada até o servidor dizer o contrário. O engano dura
// o tempo de uma resposta e, no pior caso, mantém a turma focada em vez de
// abrir o sistema inteiro.
const CACHE_KEY = 'logmax.aula_config';

const ler = (raw: any): AulaConfig => ({
  ativo: !!raw?.ativo,
  modulos_ativos: raw?.modulos_ativos ?? [],
  submenus_ativos: raw?.submenus_ativos ?? [],
  roles_afetados: raw?.roles_afetados ?? [],
  atualizado_em: raw?.atualizado_em ?? null,
});

const lerCache = (): AulaConfig => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? ler(JSON.parse(raw)) : DEFAULT;
  } catch {
    return DEFAULT;
  }
};

const gravarCache = (c: AulaConfig) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota/privado */ }
};

export function useAulaConfig() {
  const [config, setConfig] = useState<AulaConfig>(lerCache);
  const [loaded, setLoaded] = useState(false);
  const cancelado = useRef(false);

  const aplicar = useCallback((raw: any) => {
    if (cancelado.current) return;
    const c = ler(raw);
    setConfig(c);
    gravarCache(c);
  }, []);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('aula_config')
      .select('ativo, modulos_ativos, submenus_ativos, roles_afetados, atualizado_em')
      .eq('id', 1)
      .maybeSingle();
    // Sem `data` (rede caída, RLS, linha ausente) mantém-se o que já estava:
    // sobrescrever com DEFAULT aqui destravaria o menu justamente na falha.
    if (!error && data) aplicar(data);
    if (!cancelado.current) setLoaded(true);
  }, [aplicar]);

  useEffect(() => {
    cancelado.current = false;
    if (!supabase) { setLoaded(true); return; }
    carregar();

    // channelId único por instância — evita "cannot add postgres_changes callbacks
    // after subscribe()" quando StrictMode remonta o efeito e supabase.channel(name)
    // retorna o canal já subscrito com o mesmo nome.
    const channelId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = supabase
      .channel(`aula_config_realtime_${channelId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'aula_config' }, (payload) => {
        aplicar(payload.new);
      })
      .subscribe((status) => {
        // Reconexão do websocket é ponto cego: tudo que mudou enquanto o socket
        // esteve fora não é reenviado. Quem fecha a tampa do notebook no
        // intervalo voltava com a config de antes da aula, sem evento nenhum
        // para corrigi-la. Reler a cada (re)assinatura fecha essa janela.
        if (status === 'SUBSCRIBED') carregar();
      });

    // Mesma janela pelo lado do navegador: aba em segundo plano suspende o
    // socket sem avisar, e voltar à aba não dispara reassinatura sozinho.
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', carregar);

    return () => {
      cancelado.current = true;
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', carregar);
      supabase!.removeChannel(ch);
    };
  }, [carregar, aplicar]);

  return { config, loaded };
}
