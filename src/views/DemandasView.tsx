import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Target, ClipboardList, Calendar, Users, Trophy, FileDown, Loader2,
  X, Maximize2, Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import { metaDoTipo } from '../lib/cicloTarefaTipos';
import type { UserProfile } from '../hooks/useUserProfile';
import { MetasView } from './MetasView';
import { exportDemandasPDF, type DemandasRelatorio } from '../lib/demandasPdf';

type Aba = 'metas' | 'padrao' | 'conselho';

// Único ponto de entrada do módulo Demandas (modo Filial).
export function DemandasView({ profile, showToast, initialTab = 'metas' }: {
  profile: UserProfile;
  showToast: any;
  initialTab?: Aba;
}) {
  const { filialAtiva } = useFilial();
  const [aba, setAba] = useState<Aba>(initialTab);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 neu-pressed rounded-xl p-1 self-start flex-wrap">
        <TabBtn active={aba === 'metas'}    onClick={() => setAba('metas')}
                icon={<Target size={12} className="text-emerald-300" />}
                label="Metas Estratégicas" />
        <TabBtn active={aba === 'padrao'}   onClick={() => setAba('padrao')}
                icon={<Star size={12} className="text-accent" />}
                label="Padrão" />
        <TabBtn active={aba === 'conselho'} onClick={() => setAba('conselho')}
                icon={<ClipboardList size={12} className="text-amber-300" />}
                label="Demandas do Conselho" />
      </div>

      {aba === 'metas'    && <MetasView profile={profile} showToast={showToast} />}
      {aba === 'padrao'   && <DemandasPadraoList filial={filialAtiva} showToast={showToast} />}
      {aba === 'conselho' && <DemandasConselhoList profile={profile} filial={filialAtiva} showToast={showToast} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
        active ? 'neu-button text-accent ring-1 ring-accent/30' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Demandas do Conselho ────────────────────────────────────────────
// Lista as tarefas criadas em Matriz > Competição do Conselho,
// completa. Cada card mostra tipo, título, data, quem criou, participantes
// (com destaque na filial ativa) e nota média que a filial ativa recebeu.

type CompMini = { id: string; nome: string; status: string; data_inicio: string; data_fim: string };
// Campos que o card/modal/PDF realmente consomem. Vale pras tarefas da
// competição e pras do ciclo Padrão (migr. 361) — só assim o mesmo modal
// de leitura serve às duas abas.
type TarefaBase = { id: string; tipo: string; nome: string; descricao: string | null; data: string };
type Tarefa = TarefaBase & { competicao_id: string; criado_por: string; created_at: string };
type Participante = { id: string; tarefa_id: string; funcionario_id: string | null; nome_snapshot: string; filial: string };
type AvaliacaoP = { item_id: string; filial_avaliada: string; media_nota: number | null };

// Rótulo/ícone dos 7 tipos mora em `src/lib/cicloTarefaTipos.ts` — a mesma
// régua serve a Competição do Conselho e ao ciclo Padrão.

const fmtData = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

// Linha pronta de card: o mesmo objeto alimenta a grade, o modal e o PDF.
type CardTarefa = {
  tarefa: TarefaBase;
  meusParts: Participante[];
  outrosParts: Participante[];
  mediaFilial: number | null;
  outrasFiliais: { filial: string; total: number }[];
};

const rotuloStatus = (status: string) =>
  status === 'em_andamento' ? 'Em andamento'
    : status === 'aguardando_encerramento' ? 'Aguardando encerramento'
    : 'Encerrada';

function DemandasConselhoList({ profile, filial, showToast }: {
  profile: UserProfile;
  filial: string | null;
  showToast: any;
}) {
  const [loading, setLoading] = useState(true);
  const [comp, setComp] = useState<CompMini | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoP[]>([]);
  const [exportando, setExportando] = useState(false);
  // Tarefa aberta no modal de leitura. O card é um resumo (descrição cortada
  // em 3 linhas pra não estourar a grade); a pauta inteira mora aqui.
  const [detalhe, setDetalhe] = useState<CardTarefa | null>(null);

  // Gerente baixa o consolidado da própria filial; admin/CEO/conselheiro
  // também, já que enxergam a tela toda. Colaborador só lê na tela.
  const podeExportar = profile.role === 'gerente' || profile.role === 'admin'
    || profile.role === 'ceo' || isConselheiro(profile);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelou = false;
    (async () => {
      // Última competição relevante (mais recente ativa/em andamento/encerrada)
      const { data: comps } = await supabase!
        .from('competicoes_matriz')
        .select('id, nome, status, data_inicio, data_fim')
        .eq('ativo', true)
        .in('status', ['em_andamento', 'aguardando_encerramento', 'encerrada'])
        .order('data_inicio', { ascending: false })
        .limit(1);
      const c = (comps?.[0] ?? null) as CompMini | null;
      if (!c) { if (!cancelou) { setComp(null); setLoading(false); } return; }
      if (cancelou) return;
      setComp(c);

      const { data: ts } = await supabase!
        .from('matriz_tarefas')
        .select('id,competicao_id,tipo,nome,descricao,data,criado_por,created_at')
        .eq('competicao_id', c.id)
        .eq('ativo', true)
        .order('data', { ascending: true });
      if (cancelou) return;
      const listaT = (ts ?? []) as Tarefa[];
      setTarefas(listaT);

      const ids = listaT.map(t => t.id);
      if (ids.length === 0) { setParticipantes([]); setAvaliacoes([]); setLoading(false); return; }

      const { data: ps } = await supabase!
        .from('matriz_tarefa_participantes')
        .select('id,tarefa_id,funcionario_id,nome_snapshot,filial')
        .in('tarefa_id', ids)
        .eq('ativo', true);
      if (cancelou) return;
      const listaP = (ps ?? []) as Participante[];
      setParticipantes(listaP);

      const partIds = listaP.map(p => p.id);
      if (partIds.length > 0) {
        // RPC (migr. 346), não a view agregada: a view é security_invoker e a
        // RLS de avaliacoes_matriz é só da Matriz, então daqui ela vinha vazia.
        // A RPC devolve apenas média e quantidade, de tarefa já encerrada —
        // resultado, nunca o voto individual.
        const { data: as } = await supabase!
          .rpc('media_participantes_competicao', { p_competicao_id: c.id });
        if (cancelou) return;
        const doMeuEscopo = ((as ?? []) as AvaliacaoP[])
          .filter(a => partIds.includes(a.item_id));
        setAvaliacoes(doMeuEscopo);
      }
      setLoading(false);
    })();
    return () => { cancelou = true; };
  }, [filial]);

  const partPorTarefa = useMemo(() => {
    const m: Record<string, Participante[]> = {};
    for (const p of participantes) (m[p.tarefa_id] ??= []).push(p);
    return m;
  }, [participantes]);

  const notasPorParticipante = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of avaliacoes) {
      if (a.media_nota == null) continue;
      m[a.item_id] = Number(a.media_nota);
    }
    return m;
  }, [avaliacoes]);

  // Uma linha por card — a tela e o PDF consomem exatamente o mesmo cálculo,
  // na mesma ordem (tarefas já vêm por data asc).
  const cards = useMemo(() => tarefas.map(t => {
    const parts = partPorTarefa[t.id] ?? [];
    const meusParts = filial ? parts.filter(p => p.filial === filial) : [];
    const outrosParts = filial ? parts.filter(p => p.filial !== filial) : parts;

    // Média da filial ativa = média das médias dos participantes desta filial nesta tarefa.
    const notasFilial = meusParts.map(p => notasPorParticipante[p.id]).filter((n): n is number => n != null);
    const mediaFilial = notasFilial.length === 0 ? null
      : notasFilial.reduce((s, n) => s + n, 0) / notasFilial.length;

    const outrasFiliais = Object.entries(
      outrosParts.reduce<Record<string, number>>((acc, p) => { acc[p.filial] = (acc[p.filial] ?? 0) + 1; return acc; }, {})
    ).map(([f, total]) => ({ filial: f, total }));

    return { tarefa: t, meusParts, outrosParts, mediaFilial, outrasFiliais };
  }), [tarefas, partPorTarefa, notasPorParticipante, filial]) as CardTarefa[];

  const baixarPDF = async () => {
    if (!comp) return;
    setExportando(true);
    try {
      const rel: DemandasRelatorio = {
        competicaoNome: comp.nome,
        competicaoStatus: rotuloStatus(comp.status),
        dataInicio: comp.data_inicio,
        dataFim: comp.data_fim,
        filial,
        tarefas: cards.map(c => ({
          tipoLabel: metaDoTipo(c.tarefa.tipo).label,
          nome: c.tarefa.nome,
          data: c.tarefa.data,
          descricao: c.tarefa.descricao,
          mediaFilial: c.mediaFilial,
          participantes: c.meusParts.map(p => ({
            nome: p.nome_snapshot,
            media: notasPorParticipante[p.id] ?? null,
          })),
          outrasFiliais: c.outrasFiliais,
        })),
      };
      const base = `demandas-conselho-${comp.nome}${filial ? `-${filial}` : ''}`;
      await exportDemandasPDF(rel, base.trim().replace(/[^a-zA-Z0-9]+/g, '-'), 'download', profile, showToast);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setExportando(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;
  if (!comp) return (
    <div className="neu-flat rounded-3xl p-12 border border-white/5">
      <EmptyState message="Nenhuma competição do conselho no momento." />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho da competição atual */}
      <div className="neu-flat rounded-3xl p-6 border border-amber-500/20">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Trophy size={14} className="text-amber-300" />
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Competição do Conselho</p>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
                {rotuloStatus(comp.status)}
              </span>
            </div>
            <h3 className="text-lg font-black text-gray-100">{comp.nome}</h3>
            <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
              <Calendar size={11} /> {fmtData(comp.data_inicio)} → {fmtData(comp.data_fim)}
            </p>
          </div>
          {podeExportar && (
            <button
              onClick={baixarPDF}
              disabled={exportando || tarefas.length === 0}
              className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Baixar as demandas em PDF, com a descrição de cada tarefa"
            >
              {exportando ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
              PDF
            </button>
          )}
        </div>
      </div>

      {/* Lista de tarefas */}
      {tarefas.length === 0 ? (
        <div className="neu-flat rounded-3xl p-12 border border-white/5">
          <EmptyState message="Nenhuma tarefa criada nesta competição ainda." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((card) => {
            const { tarefa: t, meusParts, outrosParts, mediaFilial, outrasFiliais } = card;
            const meta = metaDoTipo(t.tipo);
            const Icone = meta.icon;

            return (
              // Card inteiro abre o modal de leitura: a descrição da pauta costuma
              // ser longa e ficava cortada num grid de 2 colunas.
              <button
                key={t.id}
                type="button"
                onClick={() => setDetalhe(card)}
                title="Abrir para ler a demanda inteira"
                className="group text-left w-full neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3 transition-all hover:border-accent/30 hover:ring-1 hover:ring-accent/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icone size={14} className={meta.color} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
                    </div>
                    <h4 className="text-base font-black text-gray-100 leading-tight">{t.nome}</h4>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-1">
                      <Calendar size={10} /> {fmtData(t.data)}
                      <span className="flex items-center gap-1 text-gray-600 group-hover:text-accent transition-colors">
                        <Maximize2 size={10} /> Abrir
                      </span>
                    </p>
                  </div>
                  {mediaFilial != null && (
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Sua nota</p>
                      <p className="text-2xl font-black text-accent tabular-nums leading-none mt-0.5">{mediaFilial.toFixed(1)}<span className="text-xs text-gray-500 font-bold">/10</span></p>
                    </div>
                  )}
                </div>

                {t.descricao && (
                  <p className="text-xs text-gray-300 whitespace-pre-wrap line-clamp-3">{t.descricao}</p>
                )}

                {/* Seus participantes (filial ativa) */}
                {filial && meusParts.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FilialBadge filial={filial} />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Seus participantes</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {meusParts.map(p => {
                        const media = notasPorParticipante[p.id] ?? null;
                        return (
                          <span key={p.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-200 flex items-center gap-2">
                            <Users size={10} className="text-accent" /> {p.nome_snapshot}
                            {media != null && <span className="text-accent font-black tabular-nums">{media.toFixed(1)}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Outras filiais participantes (só nome + contagem) */}
                {outrosParts.length > 0 && (
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">Outras filiais</p>
                    <div className="flex flex-wrap gap-1.5">
                      {outrasFiliais.map(({ filial: f, total }) => (
                        <span key={f} className="flex items-center gap-1 text-[11px]">
                          <FilialBadge filial={f} />
                          <span className="text-gray-500">×{total}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {detalhe && (
        <ModalDemandaDetalhe
          card={detalhe}
          filial={filial}
          notasPorParticipante={notasPorParticipante}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}

// ─── Demandas do Padrão ──────────────────────────────────────────────
// Pauta que a Matriz publica no ciclo Padrão (Central de Avaliação →
// Padrão → Demandas do Ciclo). Tabela `ciclo_tarefas`, migr. 361 — nota
// daqui é do ciclo, não do placar da competição. A filial só enxerga
// demanda já liberada (RLS) e só vê média de demanda encerrada (RPC).

type CicloMini = { id: string; nome: string; status: string; data_inicio: string; data_fim: string };
type MediaCiclo = { participante_id: string; filial: string; media_nota: number | null };

function DemandasPadraoList({ filial, showToast }: {
  filial: string | null;
  showToast: any;
}) {
  const [loading, setLoading] = useState(true);
  const [ciclo, setCiclo] = useState<CicloMini | null>(null);
  const [tarefas, setTarefas] = useState<TarefaBase[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [medias, setMedias] = useState<MediaCiclo[]>([]);
  const [detalhe, setDetalhe] = useState<CardTarefa | null>(null);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelou = false;
    (async () => {
      setLoading(true);
      try {
        // Uma query só: as tarefas visíveis já trazem o ciclo embutido. Sem
        // `!inner` a RLS de ciclos_avaliacao devolveria a tarefa com ciclo
        // null e a tela ficaria sem cabeçalho.
        const { data: ts, error } = await supabase!
          .from('ciclo_tarefas')
          .select('id,tipo,nome,descricao,data,status,ciclos_avaliacao!inner(id,nome,status,data_inicio,data_fim)')
          .eq('ativo', true)
          .neq('status', 'rascunho')
          .order('data', { ascending: true });
        if (error) throw error;
        if (cancelou) return;

        const linhas = (ts ?? []) as any[];
        if (linhas.length === 0) {
          setCiclo(null); setTarefas([]); setParticipantes([]); setMedias([]);
          return;
        }

        // Ciclo mais recente entre os que têm demanda. PostgREST devolve o
        // embed como objeto, mas versões antigas devolvem array — normaliza.
        const cicloDe = (l: any): CicloMini => Array.isArray(l.ciclos_avaliacao)
          ? l.ciclos_avaliacao[0] : l.ciclos_avaliacao;
        const ciclos = new Map<string, CicloMini>();
        linhas.forEach(l => { const c = cicloDe(l); if (c) ciclos.set(c.id, c); });
        const escolhido = [...ciclos.values()]
          .sort((a, b) => b.data_inicio.localeCompare(a.data_inicio))[0] ?? null;
        if (!escolhido) { setCiclo(null); setTarefas([]); return; }
        setCiclo(escolhido);

        const doCiclo = linhas.filter(l => cicloDe(l)?.id === escolhido.id);
        const listaT: TarefaBase[] = doCiclo.map(l => ({
          id: l.id, tipo: l.tipo, nome: l.nome, descricao: l.descricao, data: l.data,
        }));
        setTarefas(listaT);

        const ids = listaT.map(t => t.id);
        if (ids.length === 0) { setParticipantes([]); setMedias([]); return; }

        const { data: ps } = await supabase!
          .from('ciclo_tarefa_participantes')
          .select('id,tarefa_id,funcionario_id,nome_snapshot,filial')
          .in('tarefa_id', ids)
          .eq('ativo', true);
        if (cancelou) return;
        setParticipantes((ps ?? []) as Participante[]);

        // RPC: a tabela de notas é fechada pra filial (voto selado). O que
        // sai daqui é média de demanda ENCERRADA — resultado, não voto.
        const { data: ms } = await supabase!
          .rpc('media_participantes_ciclo', { p_ciclo_id: escolhido.id });
        if (cancelou) return;
        setMedias((ms ?? []) as MediaCiclo[]);
      } catch (err: any) {
        if (!cancelou) showToast?.(err?.message ?? 'Erro ao carregar demandas do Padrão.', 'error');
      } finally {
        if (!cancelou) setLoading(false);
      }
    })();
    return () => { cancelou = true; };
  }, [filial, showToast]);

  const partPorTarefa = useMemo(() => {
    const m: Record<string, Participante[]> = {};
    for (const p of participantes) (m[p.tarefa_id] ??= []).push(p);
    return m;
  }, [participantes]);

  const notasPorParticipante = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of medias) {
      if (a.media_nota == null) continue;
      m[a.participante_id] = Number(a.media_nota);
    }
    return m;
  }, [medias]);

  const cards = useMemo(() => tarefas.map(t => {
    const parts = partPorTarefa[t.id] ?? [];
    const meusParts = filial ? parts.filter(p => p.filial === filial) : [];
    const outrosParts = filial ? parts.filter(p => p.filial !== filial) : parts;

    const notasFilial = meusParts.map(p => notasPorParticipante[p.id]).filter((n): n is number => n != null);
    const mediaFilial = notasFilial.length === 0 ? null
      : notasFilial.reduce((s, n) => s + n, 0) / notasFilial.length;

    const outrasFiliais = Object.entries(
      outrosParts.reduce<Record<string, number>>((acc, p) => { acc[p.filial] = (acc[p.filial] ?? 0) + 1; return acc; }, {})
    ).map(([f, total]) => ({ filial: f, total }));

    return { tarefa: t, meusParts, outrosParts, mediaFilial, outrasFiliais };
  }), [tarefas, partPorTarefa, notasPorParticipante, filial]) as CardTarefa[];

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;
  if (!ciclo) return (
    <div className="neu-flat rounded-3xl p-12 border border-white/5">
      <EmptyState message="Nenhuma demanda do ciclo Padrão publicada no momento." />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="neu-flat rounded-3xl p-6 border border-accent/20">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Star size={14} className="text-accent" />
          <p className="text-[10px] font-black uppercase tracking-widest text-accent">Demandas do ciclo Padrão</p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300">
            {ciclo.status}
          </span>
        </div>
        <h3 className="text-lg font-black text-gray-100">{ciclo.nome}</h3>
        <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
          <Calendar size={11} /> {fmtData(ciclo.data_inicio)} → {fmtData(ciclo.data_fim)}
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="neu-flat rounded-3xl p-12 border border-white/5">
          <EmptyState message="Nenhuma demanda publicada neste ciclo ainda." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(card => {
            const { tarefa: t, meusParts, outrosParts, mediaFilial, outrasFiliais } = card;
            const meta = metaDoTipo(t.tipo);
            const Icone = meta.icon;

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setDetalhe(card)}
                title="Abrir para ler a demanda inteira"
                className="group text-left w-full neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3 transition-all hover:border-accent/30 hover:ring-1 hover:ring-accent/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icone size={14} className={meta.color} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
                    </div>
                    <h4 className="text-base font-black text-gray-100 leading-tight">{t.nome}</h4>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-1">
                      <Calendar size={10} /> {fmtData(t.data)}
                      <span className="flex items-center gap-1 text-gray-600 group-hover:text-accent transition-colors">
                        <Maximize2 size={10} /> Abrir
                      </span>
                    </p>
                  </div>
                  {mediaFilial != null && (
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Sua nota</p>
                      <p className="text-2xl font-black text-accent tabular-nums leading-none mt-0.5">
                        {mediaFilial.toFixed(1)}<span className="text-xs text-gray-500 font-bold">/10</span>
                      </p>
                    </div>
                  )}
                </div>

                {t.descricao && (
                  <p className="text-xs text-gray-300 whitespace-pre-wrap line-clamp-3">{t.descricao}</p>
                )}

                {filial && meusParts.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FilialBadge filial={filial} />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Seus participantes</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {meusParts.map(p => {
                        const media = notasPorParticipante[p.id] ?? null;
                        return (
                          <span key={p.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-200 flex items-center gap-2">
                            <Users size={10} className="text-accent" /> {p.nome_snapshot}
                            {media != null && <span className="text-accent font-black tabular-nums">{media.toFixed(1)}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {outrosParts.length > 0 && (
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">Outras filiais</p>
                    <div className="flex flex-wrap gap-1.5">
                      {outrasFiliais.map(({ filial: f, total }) => (
                        <span key={f} className="flex items-center gap-1 text-[11px]">
                          <FilialBadge filial={f} />
                          <span className="text-gray-500">×{total}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {detalhe && (
        <ModalDemandaDetalhe
          card={detalhe}
          filial={filial}
          notasPorParticipante={notasPorParticipante}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  );
}

// ─── Modal de leitura de uma demanda ─────────────────────────────────
// Só leitura: quem avalia é o conselho, na Central de Avaliação. Aqui a
// filial lê a pauta inteira e vê como foi pontuada.
function ModalDemandaDetalhe({ card, filial, notasPorParticipante, onClose }: {
  card: CardTarefa;
  filial: string | null;
  notasPorParticipante: Record<string, number>;
  onClose: () => void;
}) {
  const { tarefa: t, meusParts, outrosParts, mediaFilial, outrasFiliais } = card;
  const meta = metaDoTipo(t.tipo);
  const Icone = meta.icon;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-accent/20 p-5 sm:p-6 w-full max-w-2xl my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Icone size={14} className={meta.color} />
              <span className={`text-[10px] font-black uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
            </div>
            <h3 className="text-lg font-black text-gray-100 leading-tight">{t.nome}</h3>
            <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-1">
              <Calendar size={10} /> {fmtData(t.data)}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {mediaFilial != null && (
          <div className="neu-pressed rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Nota da {filial ?? 'sua filial'} nesta demanda
            </span>
            <span className="text-2xl font-black text-accent tabular-nums leading-none">
              {mediaFilial.toFixed(1)}<span className="text-xs text-gray-500 font-bold">/10</span>
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Descrição / pauta</p>
          {t.descricao ? (
            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{t.descricao}</p>
          ) : (
            <p className="text-sm text-gray-500 italic">Sem descrição — o conselho não detalhou esta demanda.</p>
          )}
        </div>

        {filial && meusParts.length > 0 && (
          <div className="pt-3 border-t border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <FilialBadge filial={filial} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Seus participantes</span>
            </div>
            <div className="flex flex-col gap-1">
              {meusParts.map(p => {
                const media = notasPorParticipante[p.id] ?? null;
                return (
                  <div key={p.id} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-b-0">
                    <Users size={11} className="text-accent shrink-0" />
                    <span className="text-xs text-gray-200 flex-1 min-w-0">{p.nome_snapshot}</span>
                    <span className="text-[11px] font-black tabular-nums text-accent">
                      {media != null ? `${media.toFixed(1)}/10` : <span className="text-gray-500 font-semibold">sem nota</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {outrosParts.length > 0 && (
          <div className="pt-3 border-t border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">Outras filiais</p>
            <div className="flex flex-wrap gap-2">
              {outrasFiliais.map(({ filial: f, total }) => (
                <span key={f} className="flex items-center gap-1 text-[11px]">
                  <FilialBadge filial={f} />
                  <span className="text-gray-500">×{total}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
