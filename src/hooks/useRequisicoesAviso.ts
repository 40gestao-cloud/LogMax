// Fila de requisições que precisam de um empurrão — os dois lados da devolução.
//
// A 518 já notifica o sino nos dois sentidos. Sino é badge: depende de a
// pessoa reparar. Foi por não repararem que nasceram as quatro requisições em
// duplicata da TechMax (vide migr. 520). Este hook alimenta o modal que
// interrompe, no mesmo desenho dos Avisos da Matriz e do Novo Documento.
//
// Cobre os DOIS documentos do fluxo de requisições (migr. 522 trouxe o
// segundo): compra (`requisicoes`) e material do almoxarifado
// (`requisicoes_estoque`). São tabelas irmãs com o mesmo desenho — cada
// evento tem sua própria tabela de ciência, porque a FK de cada uma aponta
// para o documento certo.
//
// Quem entra na fila:
//   · devolvida  → SÓ quem abriu (`criado_por`). Gerente/Estoque e Matriz
//                  ficam de fora: foram eles que devolveram — cobrar deles
//                  seria cobrar a própria decisão.
//   · reenviada  → quem decide: gerente da unidade e Matriz (compra), Estoque
//                  ou gerente (material) — mas só quando a Matriz está DENTRO
//                  de uma unidade (`filialAtiva` ≠ null). Sem esse recorte
//                  (2026-08-24), o admin em modo Matriz consolidado — sem
//                  unidade escolhida — recebia o modal de CADA reenvio das
//                  três filiais: o professor não é a fila de decisão, é quem
//                  destrava quando ninguém decide.
//
// A ciência é por pessoa E por instante do evento: o mesmo documento vai e
// volta várias vezes na mesma aula, e ciência que só diz "já vi esta
// requisição" calaria o modal na segunda devolução.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from './useUserProfile';

export type EventoRequisicao = 'devolvida' | 'reenviada';
export type TipoRequisicaoAviso = 'compra' | 'estoque';

export type RequisicaoAviso = {
  id: string;
  tipo: TipoRequisicaoAviso;
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

const COLS_COMPRA =
  'id,numero,item,qtd,unidade,filial,solicitante,criado_por,status,correcao_motivo,correcao_solicitada_em,reenviada_em,created_at';

// `requisicoes_estoque` não tem `item` (é o nome do produto, via FK) nem
// `numero` — o embed `produtos(nome)` traz o primeiro, e `numeroRequisicao`
// no modal já sabe cair no fallback REQ-xxxxxx sem o segundo.
const COLS_ESTOQUE =
  'id,qtd,destino,filial,solicitante,criado_por,status,correcao_motivo,correcao_solicitada_em,reenviada_em,created_at,produtos(nome)';

const ms = (t: string) => new Date(t).getTime();

export function useRequisicoesAviso(profile: UserProfile | null, filialAtiva: string | null) {
  const [pendentes, setPendentes] = useState<RequisicaoAviso[]>([]);
  const [loading, setLoading] = useState(true);

  // Quem decide: gerente da unidade e a direção. Mesma régua de
  // AprovacoesComprasView (compra) e AprovacoesEstoqueBloco (material) — se
  // muda lá, muda aqui.
  //
  // A fila de "reenviada" só entra com `filialAtiva` definida (2026-08-24):
  // em modo Matriz consolidado (`filialAtiva === null`) o admin decide na
  // tela de Aprovações filtrada por unidade, não aqui — sem o recorte, ele
  // recebia o modal de CADA reenvio das três filiais só por estar logado.
  const decide =
    !!filialAtiva && (
      profile?.role === 'gerente' || profile?.role === 'admin' ||
      profile?.role === 'ceo' || isConselheiro(profile)
    );

  const carregar = useCallback(async () => {
    if (!supabase || !profile?.id) { setPendentes([]); setLoading(false); return; }
    const alvo: RequisicaoAviso[] = [];

    const montaCompra = (r: any, evento: EventoRequisicao, em: string | null): RequisicaoAviso => ({
      id: r.id, tipo: 'compra', numero: r.numero ?? null, item: r.item, qtd: r.qtd ?? null,
      unidade: r.unidade ?? null, filial: r.filial ?? null,
      solicitante: r.solicitante ?? null, correcao_motivo: r.correcao_motivo ?? null,
      // Requisição devolvida antes da 517 pode não ter carimbo; o `created_at`
      // segura o caso em vez de deixar a linha sem instante nenhum.
      evento, evento_em: em ?? r.created_at,
    });
    const montaEstoque = (r: any, evento: EventoRequisicao, em: string | null): RequisicaoAviso => ({
      id: r.id, tipo: 'estoque', numero: null, item: r.produtos?.nome ?? 'Material', qtd: r.qtd ?? null,
      unidade: null, filial: r.filial ?? null,
      solicitante: r.solicitante ?? null, correcao_motivo: r.correcao_motivo ?? null,
      evento, evento_em: em ?? r.created_at,
    });

    // Devolvidas para mim — compra e material.
    const [{ data: devolvidas }, { data: devolvidasEst }] = await Promise.all([
      supabase.from('requisicoes').select(COLS_COMPRA)
        .eq('ativo', true).eq('status', 'Em correção').eq('criado_por', profile.id)
        .order('correcao_solicitada_em', { ascending: true }).limit(20),
      supabase.from('requisicoes_estoque').select(COLS_ESTOQUE)
        .eq('ativo', true).eq('status', 'Em correção').eq('criado_por', profile.id)
        .order('correcao_solicitada_em', { ascending: true }).limit(20),
    ]);
    for (const r of (devolvidas ?? []) as any[]) alvo.push(montaCompra(r, 'devolvida', r.correcao_solicitada_em));
    for (const r of (devolvidasEst ?? []) as any[]) alvo.push(montaEstoque(r, 'devolvida', r.correcao_solicitada_em));

    // Corrigidas e reenviadas, esperando a minha decisão — compra e material.
    if (decide) {
      const [{ data: reenviadas }, { data: reenviadasEst }] = await Promise.all([
        supabase.from('requisicoes').select(COLS_COMPRA)
          .eq('ativo', true).eq('status', 'Pendente').not('reenviada_em', 'is', null)
          .order('reenviada_em', { ascending: true }).limit(20),
        supabase.from('requisicoes_estoque').select(COLS_ESTOQUE)
          .eq('ativo', true).eq('status', 'Pendente').not('reenviada_em', 'is', null)
          .order('reenviada_em', { ascending: true }).limit(20),
      ]);
      // Quem reenviou não precisa ser avisado do próprio reenvio — acontece
      // com o gerente que corrige a requisição do aluno ausente.
      for (const r of (reenviadas ?? []) as any[]) {
        if (r.criado_por !== profile.id) alvo.push(montaCompra(r, 'reenviada', r.reenviada_em));
      }
      for (const r of (reenviadasEst ?? []) as any[]) {
        if (r.criado_por !== profile.id) alvo.push(montaEstoque(r, 'reenviada', r.reenviada_em));
      }
    }

    // A fila segue a unidade aberta, como o modal de documentos. Em modo
    // Matriz (`filialAtiva` nulo) volta a ser a das três.
    const naUnidade = alvo.filter(a => !filialAtiva || !a.filial || a.filial === filialAtiva);
    if (naUnidade.length === 0) { setPendentes([]); setLoading(false); return; }

    const idsCompra  = [...new Set(naUnidade.filter(a => a.tipo === 'compra').map(a => a.id))];
    const idsEstoque = [...new Set(naUnidade.filter(a => a.tipo === 'estoque').map(a => a.id))];
    const [{ data: ciencias }, { data: cienciasEst }] = await Promise.all([
      idsCompra.length
        ? supabase.from('requisicao_ciencia').select('requisicao_id,evento,evento_em')
            .eq('user_id', profile.id).in('requisicao_id', idsCompra)
        : Promise.resolve({ data: [] as any[] }),
      idsEstoque.length
        ? supabase.from('requisicao_estoque_ciencia').select('requisicao_estoque_id,evento,evento_em')
            .eq('user_id', profile.id).in('requisicao_estoque_id', idsEstoque)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const visto = new Map<string, number>();
    for (const c of (ciencias ?? []) as any[]) visto.set(`compra:${c.requisicao_id}:${c.evento}`, ms(c.evento_em));
    for (const c of (cienciasEst ?? []) as any[]) visto.set(`estoque:${c.requisicao_estoque_id}:${c.evento}`, ms(c.evento_em));

    setPendentes(naUnidade.filter(a => {
      const quando = visto.get(`${a.tipo}:${a.id}:${a.evento}`);
      return quando === undefined || quando < ms(a.evento_em);
    }));
    setLoading(false);
  }, [profile?.id, decide, filialAtiva]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: devolveu numa ponta, o modal sobe na outra sem F5. Nome de canal
  // único — dois componentes com o mesmo nome derrubam a inscrição um do outro.
  useEffect(() => {
    if (!profile?.id) return;
    return assinarRealtime({
      nome: 'requisicoes-aviso',
      alvos: ['requisicoes', 'requisicoes_estoque'],
      aoMudar: () => { carregar(); },
    });
  }, [carregar, profile?.id]);

  const darCiencia = useCallback(async (item: RequisicaoAviso) => {
    if (!supabase) return { error: 'Sem conexão.' };
    const { error } = item.tipo === 'estoque'
      ? await supabase.rpc('dar_ciencia_requisicao_estoque', {
          p_requisicao_estoque_id: item.id,
          p_evento: item.evento,
        })
      : await supabase.rpc('dar_ciencia_requisicao', {
          p_requisicao_id: item.id,
          p_evento: item.evento,
        });
    if (error) return { error: error.message };
    setPendentes(prev => prev.filter(a => !(a.id === item.id && a.evento === item.evento && a.tipo === item.tipo)));
    return {};
  }, []);

  return { pendentes, loading, darCiencia, recarregar: carregar };
}
