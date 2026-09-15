// Avisos da Matriz pendentes para o usuário atual.
//
// A RLS de `avisos_matriz` já entrega só o que alcança o usuário e ainda está
// vigente — mas admin/CEO/conselheiro (auth_is_admin) leem TUDO, e gerente com
// is_conselheiro cai nesse balde. Por isso o alvo é reconferido aqui: quem
// publica não recebe o próprio FAB, e o gerente-conselheiro só vê o que é dele.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import type { UserProfile } from './useUserProfile';

export type AvisoMatriz = {
  id: string;
  titulo: string;
  descricao: string;
  filiais: string[];
  publico: 'gerentes' | 'colaboradores' | 'todos';
  expira_em: string;
  nome_criador: string | null;
  created_at: string;
};

/** O aviso alcança este perfil? Espelha `aviso_matriz_alcanca()` no banco. */
export function avisoAlcanca(aviso: Pick<AvisoMatriz, 'filiais' | 'publico'>, profile: UserProfile): boolean {
  const filiais = aviso.filiais ?? [];
  const naFilial = filiais.length === 0 || (!!profile.filial && filiais.includes(profile.filial));
  const noPublico =
    aviso.publico === 'todos' ||
    (aviso.publico === 'gerentes' && profile.role === 'gerente') ||
    (aviso.publico === 'colaboradores' && profile.role === 'colaborador');
  return naFilial && noPublico;
}

export function useAvisosMatriz(profile: UserProfile | null) {
  const [pendentes, setPendentes] = useState<AvisoMatriz[]>([]);
  const [loading, setLoading] = useState(true);

  // Só gerente e colaborador recebem aviso — admin/CEO/conselheiro são a origem.
  const ehDestinatario = profile?.role === 'gerente' || profile?.role === 'colaborador';

  const carregar = useCallback(async () => {
    if (!supabase || !profile || !ehDestinatario) { setPendentes([]); setLoading(false); return; }

    const { data: avisos } = await supabase
      .from('avisos_matriz')
      .select('id,titulo,descricao,filiais,publico,expira_em,nome_criador,created_at')
      .eq('ativo', true)
      .gt('expira_em', new Date().toISOString())
      .order('created_at', { ascending: true });

    const alvo = ((avisos ?? []) as AvisoMatriz[]).filter(a => avisoAlcanca(a, profile));
    if (alvo.length === 0) { setPendentes([]); setLoading(false); return; }

    const { data: ciencias } = await supabase
      .from('avisos_matriz_ciencia')
      .select('aviso_id')
      .eq('user_id', profile.id)
      .in('aviso_id', alvo.map(a => a.id));

    const lidos = new Set((ciencias ?? []).map((c: any) => c.aviso_id));
    setPendentes(alvo.filter(a => !lidos.has(a.id)));
    setLoading(false);
  }, [profile, ehDestinatario]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: aviso publicado pela Matriz aparece sem F5. Um aviso novo vale
  // para a turma inteira ao mesmo tempo — sem a janela do `assinarRealtime`,
  // é uma leitura por máquina no mesmo segundo.
  useEffect(() => {
    if (!ehDestinatario) return;
    return assinarRealtime({
      nome: 'avisos-matriz-fab',
      alvos: ['avisos_matriz'],
      aoMudar: () => { carregar(); },
    });
  }, [carregar, ehDestinatario]);

  const darCiencia = useCallback(async (avisoId: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('dar_ciencia_aviso', { p_aviso_id: avisoId });
    if (error) return { error: error.message };
    setPendentes(prev => prev.filter(a => a.id !== avisoId));
    return {};
  }, []);

  return { pendentes, loading, darCiencia, recarregar: carregar };
}
