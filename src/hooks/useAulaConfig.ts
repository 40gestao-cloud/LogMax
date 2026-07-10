import { useEffect, useState } from 'react';
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

export function useAulaConfig() {
  const [config, setConfig] = useState<AulaConfig>(DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoaded(true); return; }
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from('aula_config')
        .select('ativo, modulos_ativos, submenus_ativos, roles_afetados, atualizado_em')
        .eq('id', 1)
        .maybeSingle();
      if (cancelled) return;
      if (data) setConfig({
        ativo: !!data.ativo,
        modulos_ativos: data.modulos_ativos ?? [],
        submenus_ativos: data.submenus_ativos ?? [],
        roles_afetados: data.roles_afetados ?? [],
        atualizado_em: data.atualizado_em ?? null,
      });
      setLoaded(true);
    };
    load();

    // channelId único por instância — evita "cannot add postgres_changes callbacks
    // after subscribe()" quando StrictMode remonta o efeito e supabase.channel(name)
    // retorna o canal já subscrito com o mesmo nome.
    const channelId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = supabase
      .channel(`aula_config_realtime_${channelId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'aula_config' }, (payload) => {
        const row = payload.new as AulaConfig;
        setConfig({
          ativo: !!row.ativo,
          modulos_ativos: row.modulos_ativos ?? [],
          submenus_ativos: row.submenus_ativos ?? [],
          roles_afetados: row.roles_afetados ?? [],
          atualizado_em: row.atualizado_em ?? null,
        });
      })
      .subscribe();

    return () => { cancelled = true; supabase!.removeChannel(ch); };
  }, []);

  return { config, loaded };
}
