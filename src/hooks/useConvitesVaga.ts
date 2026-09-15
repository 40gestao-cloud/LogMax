// Convocações de processo seletivo interno pendentes para o usuário atual.
//
// Espelha `useAvisosMatriz`, com uma diferença: aqui não há reconferência de
// alvo no cliente. O convite é NOMINAL — a RLS da 314 entrega por
// `user_profile_id = auth.uid()`, então o que chega já é do usuário e de mais
// ninguém. O filtro de prazo fica no fetch porque a policy não olha `prazo`:
// convite vencido continua legível (o RH precisa ver que expirou), só não
// pode mais ser respondido — quem barra isso de verdade é a RPC.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import type { UserProfile } from './useUserProfile';

export type ConviteVaga = {
  id: string;
  vaga_id: string;
  prazo: string;
  filial: string;
  convidado_por_nome: string | null;
  created_at: string;
  vagas: {
    cargo: string;
    departamento: string | null;
    filial: string;
    escopo: string;
    quantidade: number;
    salario_min: number | null;
    salario_max: number | null;
    justificativa: string | null;
    nota_minima: number | null;
  } | null;
};

const SELECT = `
  id, vaga_id, prazo, filial, convidado_por_nome, created_at,
  vagas ( cargo, departamento, filial, escopo, quantidade,
          salario_min, salario_max, justificativa, nota_minima )
`;

export function useConvitesVaga(profile: UserProfile | null) {
  const [pendentes, setPendentes] = useState<ConviteVaga[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!supabase || !profile?.id) { setPendentes([]); setLoading(false); return; }

    const { data } = await supabase
      .from('vaga_convites')
      .select(SELECT)
      .eq('user_profile_id', profile.id)
      .eq('ativo', true)
      .eq('status', 'Pendente')
      .gt('prazo', new Date().toISOString())
      .order('created_at', { ascending: true });

    setPendentes((data ?? []) as unknown as ConviteVaga[]);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: a convocação aparece sem F5, igual ao FAB de avisos.
  useEffect(() => {
    if (!profile?.id) return;
    return assinarRealtime({
      nome: 'convites-vaga-fab',
      alvos: ['vaga_convites'],
      aoMudar: () => { carregar(); },
    });
  }, [carregar, profile?.id]);

  /**
   * Sobe o PDF para o bucket privado `curriculos`.
   *
   * O caminho é `<uid>/<uuid>.pdf` porque é assim que a policy de Storage e a
   * RPC reconhecem o dono — mudar a convenção quebra as duas de uma vez.
   */
  const enviarCurriculo = useCallback(async (file: File): Promise<{ path?: string; error?: string }> => {
    if (!supabase || !profile?.id) return { error: 'Sem conexão.' };
    if (file.type !== 'application/pdf') return { error: 'O currículo precisa ser um PDF.' };
    if (file.size > 2 * 1024 * 1024)    return { error: 'O arquivo passa de 2 MB.' };

    const path = `${profile.id}/${crypto.randomUUID()}.pdf`;
    const { error } = await supabase.storage
      .from('curriculos')
      .upload(path, file, { contentType: 'application/pdf', upsert: false });

    if (error) return { error: error.message };
    return { path };
  }, [profile?.id]);

  const responder = useCallback(async (
    conviteId: string,
    aceitar: boolean,
    curriculoPath?: string | null,
    motivo?: string | null,
  ) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('responder_convite_vaga', {
      p_convite_id: conviteId,
      p_aceitar: aceitar,
      p_curriculo_path: curriculoPath ?? null,
      p_motivo: motivo ?? null,
    });
    if (error) return { error: error.message };
    setPendentes(prev => prev.filter(c => c.id !== conviteId));
    return {};
  }, []);

  return { pendentes, loading, responder, enviarCurriculo, recarregar: carregar };
}
