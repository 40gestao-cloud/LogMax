// Atividades da aula vigentes para o usuário atual (migr. 403).
//
// Espelha `useAvisosMatriz` com duas diferenças:
//   • a atividade NÃO some quando o aluno dá ciência — ele precisa dela aberta
//     durante toda a aula. "Ciente" aqui só marca que ele leu, para o professor
//     saber quem começou; o roteiro continua na tela e o PDF continua baixável.
//   • quem publica é admin/CEO (mesma régua de `aula_config`), então o
//     destinatário é todo o resto.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizarRoteiro, type Atividade } from '../lib/aulaAtividade';
import type { UserProfile } from './useUserProfile';

export type AtividadeAula = Atividade & {
  id: string;
  filiais: string[];
  publico: 'gerentes' | 'colaboradores' | 'todos';
  createdAt: string;
  lida: boolean;
};

/** A atividade alcança este perfil? Espelha `atividade_aula_alcanca()` no banco. */
export function atividadeAlcanca(
  a: { filiais: string[]; publico: string },
  profile: UserProfile,
): boolean {
  const filiais = a.filiais ?? [];
  const naFilial = filiais.length === 0 || (!!profile.filial && filiais.includes(profile.filial));
  const noPublico =
    a.publico === 'todos' ||
    (a.publico === 'gerentes' && profile.role === 'gerente') ||
    (a.publico === 'colaboradores' && profile.role === 'colaborador');
  return naFilial && noPublico;
}

const mapear = (row: any, lida: boolean): AtividadeAula => ({
  id: row.id,
  titulo: row.titulo,
  fluxoId: row.fluxo_id,
  fluxoNome: row.fluxo_nome,
  objetivo: row.objetivo ?? null,
  roteiro: normalizarRoteiro(row.roteiro),
  criador: row.nome_criador ?? null,
  expiraEm: row.expira_em ?? null,
  geradoPorIa: !!row.gerado_por_ia,
  filiais: row.filiais ?? [],
  publico: row.publico,
  createdAt: row.created_at,
  lida,
});

export function useAulaAtividades(profile: UserProfile | null) {
  const [atividades, setAtividades] = useState<AtividadeAula[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin/CEO são a origem — a lista deles é a da própria tela de Modo Aula.
  const ehDestinatario = !!profile && profile.role !== 'admin' && profile.role !== 'ceo';

  const carregar = useCallback(async () => {
    if (!supabase || !profile || !ehDestinatario) { setAtividades([]); setLoading(false); return; }

    const { data } = await supabase
      .from('aula_atividades')
      .select('id,titulo,fluxo_id,fluxo_nome,objetivo,roteiro,filiais,publico,expira_em,gerado_por_ia,nome_criador,created_at')
      .eq('ativo', true)
      .gt('expira_em', new Date().toISOString())
      .order('created_at', { ascending: false });

    const alvo = (data ?? []).filter((a: any) => atividadeAlcanca(a, profile));
    if (alvo.length === 0) { setAtividades([]); setLoading(false); return; }

    const { data: ciencias } = await supabase
      .from('aula_atividades_ciencia')
      .select('atividade_id')
      .eq('user_id', profile.id)
      .in('atividade_id', alvo.map((a: any) => a.id));

    const lidos = new Set((ciencias ?? []).map((c: any) => c.atividade_id));
    setAtividades(alvo.map((a: any) => mapear(a, lidos.has(a.id))));
    setLoading(false);
  }, [profile, ehDestinatario]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime é o único canal: o Modo Aula esconde o sino do aluno, então sem
  // isto o professor publica e a turma só descobre recarregando a página.
  useEffect(() => {
    if (!supabase || !ehDestinatario) return;
    const canal = supabase
      .channel('aula-atividades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_atividades' }, () => { carregar(); })
      .subscribe();
    return () => { supabase!.removeChannel(canal); };
  }, [carregar, ehDestinatario]);

  const darCiencia = useCallback(async (atividadeId: string) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('dar_ciencia_atividade', { p_atividade_id: atividadeId });
    if (error) return { error: error.message };
    setAtividades(prev => prev.map(a => (a.id === atividadeId ? { ...a, lida: true } : a)));
    return {};
  }, []);

  const naoLidas = atividades.filter(a => !a.lida).length;

  return { atividades, naoLidas, loading, darCiencia, recarregar: carregar };
}
