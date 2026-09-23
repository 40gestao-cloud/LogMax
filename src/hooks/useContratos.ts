// Contratos entre unidades (migr. 623).
//
// A RLS já recorta: o gerente vê os contratos em que a unidade dele é parte
// (rascunho só do lado que criou); professor, CEO e conselheiro veem todos.
// Este hook junta contrato e assinaturas e relê quando o outro lado mexe —
// é a assinatura da contraparte chegando sem F5.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { CAMPOS_CONTRATO, type Contrato, type AssinaturaContrato } from '../lib/contratos';
import type { UserProfile } from './useUserProfile';

export function useContratos(profile: UserProfile | null) {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [assinaturas, setAssinaturas] = useState<Record<string, AssinaturaContrato[]>>({});
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!supabase || !profile) { setContratos([]); setAssinaturas({}); setLoading(false); return; }

    const [{ data: cs }, { data: as }] = await Promise.all([
      supabase.from('contratos').select(CAMPOS_CONTRATO).order('created_at', { ascending: false }),
      supabase.from('contratos_assinaturas')
        .select('id,contrato_id,parte,nome_snapshot,cargo_snapshot,arquivo_sha256,assinado_em')
        .order('assinado_em', { ascending: true }),
    ]);

    const porContrato: Record<string, AssinaturaContrato[]> = {};
    for (const a of (as ?? []) as unknown as AssinaturaContrato[]) {
      (porContrato[a.contrato_id] ??= []).push(a);
    }
    setContratos((cs ?? []) as unknown as Contrato[]);
    setAssinaturas(porContrato);
    setLoading(false);
  }, [profile]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!profile) return;
    const parar = assinarRealtime({
      nome: 'contratos',
      alvos: ['contratos', 'contratos_assinaturas'],
      aoMudar: () => { carregar(); },
    });
    return parar;
  }, [carregar, profile]);

  const assinar = useCallback(async (id: string, sha256: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { data, error } = await supabase.rpc('assinar_contrato', { p_contrato_id: id, p_sha256: sha256 });
    if (error) return { error: error.message };
    await carregar();
    return { status: data as string };
  }, [carregar]);

  const recusar = useCallback(async (id: string, motivo: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('recusar_contrato', { p_contrato_id: id, p_motivo: motivo });
    if (error) return { error: error.message };
    await carregar();
    return {};
  }, [carregar]);

  const encerrar = useCallback(async (id: string, rescisao: boolean, motivo: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('encerrar_contrato', {
      p_contrato_id: id, p_rescisao: rescisao, p_motivo: motivo,
    });
    if (error) return { error: error.message };
    await carregar();
    return {};
  }, [carregar]);

  return { contratos, assinaturas, loading, assinar, recusar, encerrar, recarregar: carregar };
}
