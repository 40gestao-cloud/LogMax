// Estado da simulação de perda de dados (migr. 339).
//
// Mesmo formato do `useAulaConfig`: uma linha só, realtime, sem polling.
//
// O recarregamento na virada não é firula. Os dados já carregados vivem no
// estado do React; sem forçar uma leitura nova, o aluno que estivesse com a
// tela aberta continuaria vendo tudo e concluiria que a simulação não faz nada
// — e quem estivesse com ela aberta quando a simulação termina continuaria
// vendo a tela vazia. Recarregar é o jeito mais simples de garantir que as duas
// bordas do apagão sejam visíveis na hora.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface BlackoutConfig {
  ativo: boolean;
  mensagem: string | null;
  iniciado_nome: string | null;
  iniciado_em: string | null;
}

const DEFAULT: BlackoutConfig = { ativo: false, mensagem: null, iniciado_nome: null, iniciado_em: null };

const CAMPOS = 'ativo, mensagem, iniciado_nome, iniciado_em';

export function useBlackout() {
  const [config, setConfig] = useState<BlackoutConfig>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  // Guarda o estado da primeira leitura: só recarrega quando o valor MUDA
  // depois de a página já estar de pé, nunca no carregamento inicial.
  const anterior = useRef<boolean | null>(null);

  useEffect(() => {
    if (!supabase) { setLoaded(true); return; }
    let cancelado = false;

    const aplicar = (row: any) => {
      const novo: BlackoutConfig = {
        ativo: !!row?.ativo,
        mensagem: row?.mensagem ?? null,
        iniciado_nome: row?.iniciado_nome ?? null,
        iniciado_em: row?.iniciado_em ?? null,
      };
      setConfig(novo);
      if (anterior.current !== null && anterior.current !== novo.ativo) {
        window.location.reload();
        return;
      }
      anterior.current = novo.ativo;
    };

    (async () => {
      const { data } = await supabase!.from('blackout_config').select(CAMPOS).eq('id', true).maybeSingle();
      if (cancelado) return;
      if (data) aplicar(data);
      setLoaded(true);
    })();

    const channelId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = supabase
      .channel(`blackout_realtime_${channelId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'blackout_config' },
          payload => aplicar(payload.new))
      .subscribe();

    return () => { cancelado = true; supabase?.removeChannel(ch); };
  }, []);

  return { blackout: config, blackoutLoaded: loaded };
}
