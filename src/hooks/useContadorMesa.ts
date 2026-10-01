import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { freshToken } from '../lib/authFetch';
import { podeLerPorAutomacao } from '../lib/disjuntor';
import type { UserProfile } from './useUserProfile';

// Número da coluna "Precisa de mim" da Mesa do Gestor, para a bolinha do menu
// (migr. 668, `contar_minha_mesa`).
//
// NÃO escuta realtime, de propósito: a mesa junta filas de vinte tabelas, e
// recontar a cada INSERT da sala é exatamente a manada de 15/09. Conta ao
// montar, ao trocar de unidade, ao voltar ao foco (no máximo a cada 2 min) e
// quando a própria tela da Mesa carrega — ela já tem o número e o anuncia em
// `mesa:contagem`, sem ida extra ao banco.

export const EVENTO_CONTAGEM_MESA = 'mesa:contagem';
const PAPEIS_DA_MESA = new Set(['admin', 'ceo', 'conselheiro', 'gerente']);
const FOCO_INTERVALO_MIN_MS = 120_000;

export function useContadorMesa(profile: UserProfile | null, filialAtiva: string | null): number {
  const [n, setN] = useState(0);
  const ativo = !!profile && PAPEIS_DA_MESA.has(String(profile.role));
  const reqId = useRef(0);
  const ultimo = useRef(0);
  // Gerente: a RPC já recorta pela unidade dele; os demais seguem a unidade ativa.
  const filial = profile?.role === 'gerente' ? null : filialAtiva;

  const contar = useCallback(async () => {
    if (!ativo || !supabase) { setN(0); return; }
    const id = ++reqId.current;
    if (!(await freshToken())) { if (id === reqId.current) setN(0); return; }
    ultimo.current = Date.now();
    const { data, error } = await supabase.rpc('contar_minha_mesa', { p_filial: filial });
    if (id !== reqId.current) return;
    if (error) { console.warn('[useContadorMesa]', error.message); setN(0); return; }
    setN(Number(data) || 0);
  }, [ativo, filial]);

  useEffect(() => { void contar(); }, [contar, profile?.id]);

  useEffect(() => {
    if (!ativo) return;
    const refazer = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimo.current < FOCO_INTERVALO_MIN_MS) return;
      if (!podeLerPorAutomacao()) return;
      void contar();
    };
    const daTela = (e: Event) => {
      const v = Number((e as CustomEvent).detail);
      if (Number.isFinite(v)) { ++reqId.current; ultimo.current = Date.now(); setN(v); }
    };
    window.addEventListener('focus', refazer);
    document.addEventListener('visibilitychange', refazer);
    window.addEventListener(EVENTO_CONTAGEM_MESA, daTela);
    return () => {
      window.removeEventListener('focus', refazer);
      document.removeEventListener('visibilitychange', refazer);
      window.removeEventListener(EVENTO_CONTAGEM_MESA, daTela);
    };
  }, [ativo, contar]);

  return ativo ? n : 0;
}
