import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Loader2, FileDown, FileSpreadsheet, BarChart3, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { MatrizTarefasPanel } from './MatrizTarefasPanel';
import { AvaliacaoFilialPanel } from './AvaliacaoFilialPanel';
import { buscarRelatorioCentralAvaliacao, exportCentralAvaliacaoPDF, exportCentralAvaliacaoExcel } from '../lib/centralAvaliacaoExports';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_TONE: Record<FilialOp, string> = {
  SuperMax: 'bg-sky-500/20 text-sky-300',
  MaxLook:  'bg-amber-400/20 text-amber-200',
  TechMax:  'bg-orange-500/20 text-orange-300',
};

type Competicao = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: string;
};

// Central de Avaliação — Competição: hoje é só o painel de Tarefas da Matriz.
// Admin/CEO cadastra atividades por tipo (treinamento em vendas, treinamento em IA,
// apresentação, etc.); CEO+conselheiros julgam por participante.
export function MatrizAvaliacoesView({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const podeAvaliar = profile.role === 'ceo' || isConselheiro(profile);
  const podeAcessar = profile.role === 'admin' || podeAvaliar;

  const [competicao, setCompeticao] = useState<Competicao | null>(null);
  const [loadingComp, setLoadingComp] = useState(true);
  const [exportando, setExportando] = useState<'pdf' | 'excel' | null>(null);

  useEffect(() => {
    let cancelou = false;
    const carregar = async (comMask = true) => {
      if (comMask) setLoadingComp(true);
      const { data } = await supabase
        .from('competicoes_matriz')
        .select('id,nome,data_inicio,data_fim,status')
        .eq('ativo', true)
        .in('status', ['em_andamento', 'aguardando_encerramento'])
        .maybeSingle();
      if (!cancelou) {
        setCompeticao(data as any);
        setLoadingComp(false);
      }
    };
    carregar();
    // Realtime: se admin cria/encerra uma competição em outra sessão, este painel reflete sem F5.
    const canal = supabase
      .channel('matriz-avaliacoes-competicao')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competicoes_matriz' }, () => {
        carregar(false);
      })
      .subscribe();
    return () => { cancelou = true; supabase.removeChannel(canal); };
  }, []);

  if (!podeAcessar) {
    return <EmptyState message="⛔ Acesso restrito — Central de Avaliação Matriz é exclusiva de admin, CEO e conselheiros." />;
  }
  if (loadingComp) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  if (!competicao) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Avaliação — Matriz</h2>
          <p className="text-sm text-gray-400 mt-1">Tarefas propostas pela Matriz para as filiais durante a competição.</p>
        </div>
        <EmptyState message="🏆 Nenhuma competição em andamento — abra uma em Matriz → Competição para começar a cadastrar tarefas." />
      </motion.div>
    );
  }

  const nomeArquivo = `central-avaliacao-${competicao.nome.trim().replace(/[^a-zA-Z0-9]+/g, '-')}`;

  const baixarPDF = async () => {
    setExportando('pdf');
    try {
      const rel = await buscarRelatorioCentralAvaliacao(competicao);
      await exportCentralAvaliacaoPDF(rel, nomeArquivo);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setExportando(null);
    }
  };

  const baixarExcel = async () => {
    setExportando('excel');
    try {
      const rel = await buscarRelatorioCentralAvaliacao(competicao);
      await exportCentralAvaliacaoExcel(rel, nomeArquivo);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar Excel.', 'error');
    } finally {
      setExportando(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="neu-flat rounded-2xl border border-accent/20 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-accent tracking-tight truncate">Central de Avaliação — Matriz</h2>
            <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
              <Trophy size={12} className="text-amber-400" />
              <span className="font-mono font-bold text-gray-200">{competicao.nome}</span>
              <span className="text-gray-500">·</span>
              <span className="font-mono">{competicao.data_inicio} → {competicao.data_fim}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              onClick={baixarPDF}
              disabled={exportando !== null}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
              title="Baixar consolidado em PDF"
            >
              {exportando === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
              PDF
            </button>
            <button
              onClick={baixarExcel}
              disabled={exportando !== null}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
              title="Baixar consolidado em Excel"
            >
              {exportando === 'excel' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
              Excel
            </button>
            {!podeAvaliar && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg bg-gray-500/15 text-gray-400 border border-gray-500/30">
                Modo leitura
              </span>
            )}
          </div>
        </div>
      </div>

      <MatrizTarefasPanel
        competicao={competicao}
        profile={profile}
        podeAvaliar={podeAvaliar}
        showToast={showToast}
      />

      <AvaliacaoFilialPanel
        profile={profile}
        podeAvaliar={podeAvaliar}
        showToast={showToast}
      />

      <VisaoCicloPorParticipante competicao={competicao} />
    </motion.div>
  );
}

// ── Visão do Ciclo — agrega por participante todas as notas do conselho ──
// Complementa o pódio por filial (MatrizCompeticaoView) e o painel de tarefas
// (MatrizTarefasPanel), que mostra por tarefa isolada. Aqui cada linha é
// UMA pessoa, com a média de todas as notas que ela recebeu em toda a
// competição — gerentes/colaboradores participantes de tarefas + qualquer
// CEO/conselheiro que também tenha entrado como participante.
type LinhaParticipante = {
  chave: string;
  nome: string;
  filial: FilialOp;
  tarefas: { tarefaId: string; tarefaNome: string; tarefaTipo: string; notas: number[]; media: number | null }[];
  totalNotas: number;
  mediaGeral: number | null;
};

const TAREFA_TIPOS_MATRIZ = [
  'tarefa_treinamento_vendas', 'tarefa_treinamento_ia', 'tarefa_apresentacao',
  'tarefa_rh', 'tarefa_marketing', 'tarefa_financeiro', 'tarefa_logistica',
];

const TAREFA_TIPO_LABEL: Record<string, string> = {
  tarefa_treinamento_vendas: 'Vendas e Atendimento',
  tarefa_treinamento_ia:     'Desenvolvimento com IA',
  tarefa_apresentacao:       'Apresentação Profissional',
  tarefa_rh:                 'Recursos Humanos',
  tarefa_marketing:          'Marketing',
  tarefa_financeiro:         'Financeiro',
  tarefa_logistica:          'Logística',
};

function VisaoCicloPorParticipante({ competicao }: { competicao: Competicao }) {
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<LinhaParticipante[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelou = false;
    (async () => {
      setLoading(true);
      const { data: tarefas } = await supabase
        .from('matriz_tarefas')
        .select('id, tipo, nome, data')
        .eq('competicao_id', competicao.id)
        .eq('ativo', true);
      const tsArr = tarefas ?? [];
      if (tsArr.length === 0) {
        if (!cancelou) { setLinhas([]); setLoading(false); }
        return;
      }
      const tarefaIds = tsArr.map((t: any) => t.id);
      const [{ data: parts }, { data: avals }] = await Promise.all([
        supabase.from('matriz_tarefa_participantes')
          .select('id, tarefa_id, nome_snapshot, filial, funcionario_id')
          .in('tarefa_id', tarefaIds)
          .eq('ativo', true),
        supabase.from('avaliacoes_matriz')
          .select('item_id, item_tipo, nota')
          .eq('competicao_id', competicao.id)
          .in('item_tipo', TAREFA_TIPOS_MATRIZ)
          .eq('ativo', true),
      ]);

      const tarefaById = new Map<string, any>();
      tsArr.forEach((t: any) => tarefaById.set(t.id, t));
      const avalsPorItem = new Map<string, number[]>();
      (avals ?? []).forEach((a: any) => {
        if (a.nota == null) return;
        if (!avalsPorItem.has(a.item_id)) avalsPorItem.set(a.item_id, []);
        avalsPorItem.get(a.item_id)!.push(Number(a.nota));
      });

      // Agrupa participantes pela mesma pessoa (funcionario_id quando existe,
      // senão nome+filial) — a mesma pessoa pode participar de N tarefas.
      const porPessoa = new Map<string, LinhaParticipante>();
      (parts ?? []).forEach((p: any) => {
        const chave = p.funcionario_id ?? `${p.nome_snapshot}::${p.filial}`;
        const tarefa = tarefaById.get(p.tarefa_id);
        const notas = avalsPorItem.get(p.id) ?? [];
        const media = notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
        const entrada = porPessoa.get(chave) ?? {
          chave, nome: p.nome_snapshot, filial: p.filial as FilialOp,
          tarefas: [], totalNotas: 0, mediaGeral: null,
        };
        entrada.tarefas.push({
          tarefaId: p.tarefa_id,
          tarefaNome: tarefa?.nome ?? '—',
          tarefaTipo: tarefa?.tipo ?? '—',
          notas, media,
        });
        entrada.totalNotas += notas.length;
        porPessoa.set(chave, entrada);
      });

      // Média geral da pessoa = média das notas planas de todas as tarefas dela.
      const arr = Array.from(porPessoa.values()).map(p => {
        const todas = p.tarefas.flatMap(t => t.notas);
        return {
          ...p,
          mediaGeral: todas.length > 0 ? todas.reduce((s, n) => s + n, 0) / todas.length : null,
        };
      }).sort((a, b) => (b.mediaGeral ?? -1) - (a.mediaGeral ?? -1) || a.nome.localeCompare(b.nome));

      if (!cancelou) { setLinhas(arr); setLoading(false); }
    })();

    // Realtime: nova nota/remoção de participante disparam refetch via tick.
    const canal = supabase
      .channel(`visao-ciclo-participante-${competicao.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avaliacoes_matriz', filter: `competicao_id=eq.${competicao.id}` }, () => {
        setRefreshTick(t => t + 1);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matriz_tarefa_participantes' }, () => {
        setRefreshTick(t => t + 1);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matriz_tarefas', filter: `competicao_id=eq.${competicao.id}` }, () => {
        setRefreshTick(t => t + 1);
      })
      .subscribe();
    return () => { cancelou = true; supabase.removeChannel(canal); };
  }, [competicao.id, refreshTick]);

  const porFilial = useMemo(() => {
    const m: Record<string, LinhaParticipante[]> = {};
    linhas.forEach(l => { (m[l.filial] ??= []).push(l); });
    return m;
  }, [linhas]);

  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={16} className="text-accent" />
        <h3 className="text-sm font-bold text-gray-200">Visão do Ciclo — por Participante</h3>
        {linhas.length > 0 && (
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold ml-1">
            {linhas.length} pessoa{linhas.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 mb-4">
        Cada linha é uma pessoa avaliada nesta competição — média das notas do conselho em todas as Tarefas da Matriz em que ela participou.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 size={16} className="animate-spin text-accent" /></div>
      ) : linhas.length === 0 ? (
        <EmptyState message="Nenhum participante avaliado ainda. Crie uma tarefa e adicione participantes." />
      ) : (
        <div className="flex flex-col gap-5">
          {(['SuperMax','MaxLook','TechMax'] as FilialOp[]).map(f => {
            const lista = porFilial[f] ?? [];
            if (lista.length === 0) return null;
            const tone = FILIAL_TONE[f];
            return (
              <div key={f} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${tone}`}>{f}</span>
                  <span className="text-[10px] text-gray-500 font-mono">{lista.length} pessoa{lista.length === 1 ? '' : 's'}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-widest text-gray-500">
                      <tr className="border-b border-white/10">
                        <th className="text-left pb-2 font-bold px-2 w-6"></th>
                        <th className="text-left pb-2 font-bold px-2">Nome</th>
                        <th className="text-right pb-2 font-bold px-2">Tarefas</th>
                        <th className="text-right pb-2 font-bold px-2">Notas</th>
                        <th className="text-right pb-2 font-bold px-2">Média</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map(l => {
                        const aberto = expandido === l.chave;
                        return (
                          <React.Fragment key={l.chave}>
                            <tr
                              className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                              onClick={() => setExpandido(aberto ? null : l.chave)}
                            >
                              <td className="py-2 px-2 text-gray-500">
                                {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </td>
                              <td className="py-2 px-2 text-gray-200 font-semibold flex items-center gap-1.5">
                                <Users size={11} className="text-gray-500 shrink-0" />
                                {l.nome}
                              </td>
                              <td className="py-2 px-2 text-right text-gray-400 tabular-nums">{l.tarefas.length}</td>
                              <td className="py-2 px-2 text-right text-gray-400 tabular-nums">{l.totalNotas}</td>
                              <td className="py-2 px-2 text-right font-black tabular-nums">
                                {l.mediaGeral == null
                                  ? <span className="text-gray-600">—</span>
                                  : <span className="text-amber-300">{l.mediaGeral.toFixed(1)}<span className="text-gray-500">/10</span></span>}
                              </td>
                            </tr>
                            {aberto && (
                              <tr className="border-b border-white/5 bg-white/[0.02]">
                                <td colSpan={5} className="px-4 py-3">
                                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">
                                    Detalhe por tarefa
                                  </p>
                                  <div className="flex flex-col gap-1.5">
                                    {l.tarefas.map(t => (
                                      <div key={t.tarefaId} className="flex items-center justify-between text-xs">
                                        <span className="text-gray-300 flex items-center gap-1.5">
                                          <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">
                                            {TAREFA_TIPO_LABEL[t.tarefaTipo] ?? t.tarefaTipo}
                                          </span>
                                          <span className="text-gray-500">·</span>
                                          <span>{t.tarefaNome}</span>
                                        </span>
                                        <span className="tabular-nums text-gray-300">
                                          {t.notas.length === 0
                                            ? <span className="text-gray-600">sem notas</span>
                                            : <>{t.notas.length} nota{t.notas.length === 1 ? '' : 's'} · <span className="font-bold text-amber-300">{t.media!.toFixed(1)}/10</span></>}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Re-exports preservados — MatrizTarefasPanel consome esses símbolos.
export type { Competicao as CentralCompeticao };
export const CENTRAL_FILIAL_TONE = FILIAL_TONE;
export { OP_FILIAIS as CENTRAL_OP_FILIAIS };
