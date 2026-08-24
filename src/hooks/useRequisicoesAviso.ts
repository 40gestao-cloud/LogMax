// Fila de requisições que precisam de um empurrão — os dois lados da devolução.
//
// A 518 já notifica o sino nos dois sentidos. Sino é badge: depende de a
// pessoa reparar. Foi por não repararem que nasceram as quatro requisições em
// duplicata da TechMax (vide migr. 520). Este hook alimenta o modal que
// interrompe, no mesmo desenho dos Avisos da Matriz e do Novo Documento.
//
// Quem entra na fila:
//   · devolvida  → SÓ quem abriu (`criado_por`). Gerente e Matriz ficam de
//                  fora: foram eles que devolveram — cobrar deles seria cobrar
//                  a própria decisão.
//   · reenviada  → quem decide: gerente da unidade e Matriz.
//
// A ciência é por pessoa E por instante do evento (`requisicao_ciencia`): o
// mesmo documento vai e volta várias vezes na mesma aula, e ciência que só
// diz "já vi esta requisição" calaria o modal na segunda devolução.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from './useUserProfile';

export type EventoRequisicao = 'devolvida' | 'reenviada';

export type RequisicaoAviso = {
  id: string;
  numero: string | null;
  item: string;
  qtd: number | null;
  unidade: string | null;
  filial: string | null;
  solicitante: string | null;
  correcao_motivo: string | null;
  evento: EventoRequisicao;
  /** Instante do evento — é ele que a ciência carimba. */
  evento_em: string;
};

const COLS =
  'id,numero,item,qtd,unidade,filial,solicitante,criado_por,status,correcao_motivo,correcao_solicitada_em,reenviada_em,created_at';

const ms = (t: string) => new Date(t).getTime();

export function useRequisicoesAviso(profile: UserProfile | null, filialAtiva: string | null) {
  const [pendentes, setPendentes] = useState<RequisicaoAviso[]>([]);
  const [loading, setLoading] = useState(true);

  // Quem decide: gerente da unidade e a direção. Mesma régua de
  // AprovacoesComprasView — se muda lá, muda aqui.
  const decide =
    profile?.role === 'gerente' || profile?.role === 'admin' ||
    profile?.role === 'ceo' || isConselheiro(profile);

  const carregar = useCallback(async () => {
    if (!supabase || !profile?.id) { setPendentes([]); setLoading(false); return; }
    const alvo: RequisicaoAviso[] = [];

    const monta = (r: any, evento: EventoRequisicao, em: string | null): RequisicaoAviso => ({
      id: r.id, numero: r.numero ?? null, item: r.item, qtd: r.qtd ?? null,
      unidade: r.unidade ?? null, filial: r.filial ?? null,
      solicitante: r.solicitante ?? null, correcao_motivo: r.correcao_motivo ?? null,
      // Requisição devolvida antes da 517 pode não ter carimbo; o `created_at`
      // segura o caso em vez de deixar a linha sem instante nenhum.
      evento, evento_em: em ?? r.created_at,
    });

    // Devolvidas para mim.
    const { data: devolvidas } = await supabase
      .from('requisicoes').select(COLS)
      .eq('ativo', true).eq('status', 'Em correção').eq('criado_por', profile.id)
      .order('correcao_solicitada_em', { ascending: true }).limit(20);
    for (const r of (devolvidas ?? []) as any[]) {
      alvo.push(monta(r, 'devolvida', r.correcao_solicitada_em));
    }

    // Corrigidas e reenviadas, esperando a minha decisão.
    if (decide) {
      const { data: reenviadas } = await supabase
        .from('requisicoes').select(COLS)
        .eq('ativo', true).eq('status', 'Pendente').not('reenviada_em', 'is', null)
        .order('reenviada_em', { ascending: true }).limit(20);
      for (const r of (reenviadas ?? []) as any[]) {
        // Quem reenviou não precisa ser avisado do próprio reenvio — acontece
        // com o gerente que corrige a requisição do aluno ausente.
        if (r.criado_por === profile.id) continue;
        alvo.push(monta(r, 'reenviada', r.reenviada_em));
      }
    }

    // A fila segue a unidade aberta, como o modal de documentos. Em modo
    // Matriz (`filialAtiva` nulo) volta a ser a das três.
    const naUnidade = alvo.filter(a => !filialAtiva || !a.filial || a.filial === filialAtiva);
    if (naUnidade.length === 0) { setPendentes([]); setLoading(false); return; }

    const { data: ciencias } = await supabase
      .from('requisicao_ciencia').select('requisicao_id,evento,evento_em')
      .eq('user_id', profile.id)
      .in('requisicao_id', [...new Set(naUnidade.map(a => a.id))]);

    const visto = new Map<string, number>();
    for (const c of (ciencias ?? []) as any[]) {
      visto.set(`${c.requisicao_id}:${c.evento}`, ms(c.evento_em));
    }

    setPendentes(naUnidade.filter(a => {
      const quando = visto.get(`${a.id}:${a.evento}`);
      return quando === undefined || quando < ms(a.evento_em);
    }));
    setLoading(false);
  }, [profile?.id, decide, filialAtiva]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: devolveu numa ponta, o modal sobe na outra sem F5. Nome de canal
  // único — dois componentes com o mesmo nome derrubam a inscrição um do outro.
  useEffect(() => {
    if (!supabase || !profile?.id) return;
    const sb = supabase;
    const sufixo = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canal = sb
      .channel(`requisicoes-aviso-${sufixo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requisicoes' }, () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; carregar(); }, 400);
      })
      .subscribe();
    return () => { if (timer !== null) clearTimeout(timer); sb.removeChannel(canal); };
  }, [carregar, profile?.id]);

  const darCiencia = useCallback(async (item: RequisicaoAviso) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = await supabase.rpc('dar_ciencia_requisicao', {
      p_requisicao_id: item.id,
      p_evento: item.evento,
    });
    if (error) return { error: error.message };
    setPendentes(prev => prev.filter(a => !(a.id === item.id && a.evento === item.evento)));
    return {};
  }, []);

  return { pendentes, loading, darCiencia, recarregar: carregar };
}
