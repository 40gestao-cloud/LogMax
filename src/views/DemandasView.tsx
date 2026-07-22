import React, { useEffect, useMemo, useState } from 'react';
import {
  Target, ClipboardList, Calendar, Users, Trophy,
  GraduationCap, Cpu, Presentation, UserCircle, DollarSign, Package, Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { LoadingSpinner, EmptyState, FilialBadge } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { MetasView } from './MetasView';

type Aba = 'metas' | 'conselho';

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
        <TabBtn active={aba === 'conselho'} onClick={() => setAba('conselho')}
                icon={<ClipboardList size={12} className="text-amber-300" />}
                label="Demandas do Conselho" />
      </div>

      {aba === 'metas'    && <MetasView profile={profile} showToast={showToast} />}
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
type Tarefa = { id: string; competicao_id: string; tipo: string; nome: string; descricao: string | null; data: string; criado_por: string; created_at: string };
type Participante = { id: string; tarefa_id: string; funcionario_id: string | null; nome_snapshot: string; filial: string };
type AvaliacaoP = { item_id: string; filial_avaliada: string; media_nota: number | null };

const TIPO_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  tarefa_apresentacao:       { label: 'Apresentação Profissional', icon: Presentation, color: 'text-amber-300' },
  tarefa_treinamento_ia:     { label: 'Desenvolvimento com IA',    icon: Cpu,          color: 'text-orange-400' },
  tarefa_treinamento_vendas: { label: 'Vendas e Atendimento',      icon: GraduationCap, color: 'text-blue-400' },
  tarefa_rh:                 { label: 'Recursos Humanos',          icon: UserCircle,   color: 'text-sky-400' },
  tarefa_financeiro:         { label: 'Financeiro',                icon: DollarSign,   color: 'text-rose-400' },
  tarefa_logistica:          { label: 'Logística',                 icon: Package,      color: 'text-emerald-400' },
  tarefa_marketing:          { label: 'Marketing',                 icon: Megaphone,    color: 'text-pink-400' },
};

const fmtData = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

function DemandasConselhoList({ profile: _profile, filial, showToast: _showToast }: {
  profile: UserProfile;
  filial: string | null;
  showToast: any;
}) {
  const [loading, setLoading] = useState(true);
  const [comp, setComp] = useState<CompMini | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoP[]>([]);

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
        // View agregada preserva o segredo do voto: só media_nota por
        // participante, sem avaliador_id/comentario/decisao individuais.
        const { data: as } = await supabase!
          .from('avaliacoes_matriz_agregado')
          .select('item_id,filial_avaliada,media_nota')
          .eq('competicao_id', c.id)
          .in('item_id', partIds);
        if (cancelou) return;
        setAvaliacoes((as ?? []) as AvaliacaoP[]);
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
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Trophy size={14} className="text-amber-300" />
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Competição do Conselho</p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
            {comp.status === 'em_andamento' ? 'Em andamento'
              : comp.status === 'aguardando_encerramento' ? 'Aguardando encerramento'
              : 'Encerrada'}
          </span>
        </div>
        <h3 className="text-lg font-black text-gray-100">{comp.nome}</h3>
        <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
          <Calendar size={11} /> {fmtData(comp.data_inicio)} → {fmtData(comp.data_fim)}
        </p>
      </div>

      {/* Lista de tarefas */}
      {tarefas.length === 0 ? (
        <div className="neu-flat rounded-3xl p-12 border border-white/5">
          <EmptyState message="Nenhuma tarefa criada nesta competição ainda." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tarefas.map(t => {
            const meta = TIPO_META[t.tipo] ?? { label: t.tipo, icon: ClipboardList, color: 'text-gray-400' };
            const Icone = meta.icon;
            const parts = partPorTarefa[t.id] ?? [];
            const meusParts = filial ? parts.filter(p => p.filial === filial) : [];
            const outrosParts = filial ? parts.filter(p => p.filial !== filial) : parts;

            // Média da filial ativa = média das médias dos participantes desta filial nesta tarefa.
            const notasFilial = meusParts.map(p => notasPorParticipante[p.id]).filter((n): n is number => n != null);
            const mediaFilial = notasFilial.length === 0 ? null
              : notasFilial.reduce((s, n) => s + n, 0) / notasFilial.length;

            return (
              <div key={t.id} className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icone size={14} className={meta.color} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${meta.color}`}>{meta.label}</span>
                    </div>
                    <h4 className="text-base font-black text-gray-100 leading-tight">{t.nome}</h4>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-1">
                      <Calendar size={10} /> {fmtData(t.data)}
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
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{t.descricao}</p>
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
                      {Object.entries(
                        outrosParts.reduce<Record<string, number>>((acc, p) => { acc[p.filial] = (acc[p.filial] ?? 0) + 1; return acc; }, {})
                      ).map(([f, count]) => (
                        <span key={f} className="flex items-center gap-1 text-[11px]">
                          <FilialBadge filial={f} />
                          <span className="text-gray-500">×{count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
