import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Loader2, FileDown, FileSpreadsheet, Presentation, BarChart3, ChevronDown, ChevronRight, Users, Building2, ArrowLeft, TrendingUp, TrendingDown, Minus, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { MatrizTarefasPanel } from './MatrizTarefasPanel';
import { AvaliacaoFilialPanel } from './AvaliacaoFilialPanel';
import { PainelComparativoEixos } from './PainelComparativoEixos';
import { FrequenciaFiliaisCard } from './FrequenciaFiliaisCard';
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
  ciclo_id: string | null;
};

// Central de Avaliação — Competição: hoje é só o painel de Tarefas da Matriz.
// Admin/CEO cadastra atividades por tipo (treinamento em vendas, treinamento em IA,
// apresentação, etc.); CEO+conselheiros julgam por participante.
export function MatrizAvaliacoesView({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const ehAvaliador = profile.role === 'ceo' || isConselheiro(profile);
  const podeAcessar = profile.role === 'admin' || ehAvaliador;

  const [competicao, setCompeticao] = useState<Competicao | null>(null);
  const [loadingComp, setLoadingComp] = useState(true);
  const [exportando, setExportando] = useState<'pdf' | 'excel' | 'maxshow' | null>(null);
  // Seção aberta fora das tarefas. null = landing (cards). Isso tira da
  // tela os painéis de filial/ciclo enquanto se avalia uma tarefa — antes
  // eles apareciam embaixo de TODA tarefa aberta.
  const [secao, setSecao] = useState<'filiais' | 'ciclo' | null>(null);

  useEffect(() => {
    let cancelou = false;
    const carregar = async (comMask = true) => {
      if (comMask) setLoadingComp(true);
      const { data } = await supabase
        .from('competicoes_matriz')
        .select('id,nome,data_inicio,data_fim,status,ciclo_id')
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

  // Fora de 'em_andamento' (a competição já foi pro cron de encerramento e
  // espera o voto do conselho) TODAS as RPCs de escrita recusam: avaliar,
  // remover avaliação, criar e liberar tarefa. Aqui a tela desce junto pra
  // leitura em vez de oferecer botão que só devolve erro.
  const emAndamento = competicao.status === 'em_andamento';
  const podeAvaliar = ehAvaliador && emAndamento;

  const nomeArquivo = `central-avaliacao-${competicao.nome.trim().replace(/[^a-zA-Z0-9]+/g, '-')}`;

  const gerarPDF = async (destino: 'download' | 'maxshow') => {
    setExportando(destino === 'maxshow' ? 'maxshow' : 'pdf');
    try {
      const rel = await buscarRelatorioCentralAvaliacao(competicao, profile.role === 'admin');
      await exportCentralAvaliacaoPDF(rel, nomeArquivo, destino, profile, showToast);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setExportando(null);
    }
  };
  const baixarPDF = () => gerarPDF('download');
  const enviarMaxShow = () => gerarPDF('maxshow');

  const baixarExcel = async () => {
    setExportando('excel');
    try {
      const rel = await buscarRelatorioCentralAvaliacao(competicao, profile.role === 'admin');
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
              onClick={enviarMaxShow}
              disabled={exportando !== null}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
              title="Enviar consolidado ao Max Show pra apresentar"
            >
              {exportando === 'maxshow' ? <Loader2 size={12} className="animate-spin" /> : <Presentation size={12} />}
              Max Show
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

      {!emAndamento && (
        <div className="neu-flat rounded-2xl border border-amber-500/30 px-5 py-3 flex items-start gap-3">
          <Lock size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-300 leading-snug">
            <b className="text-amber-300">Competição fechada para notas.</b> "{competicao.nome}" saiu de
            "em andamento" e agora aguarda o voto de encerramento do conselho — nenhuma nota, tarefa nova
            ou liberação é aceita. Consulta e exportação seguem liberadas.
          </p>
        </div>
      )}

      {secao === null && (
        <MatrizTarefasPanel
          competicao={competicao}
          profile={profile}
          podeAvaliar={podeAvaliar}
          ehAvaliador={ehAvaliador}
          emAndamento={emAndamento}
          showToast={showToast}
          extras={
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CardSecao
                icon={Building2}
                titulo="Avaliação das Filiais"
                hint="Frequência medida pelo ponto + nota de Planejamento e Organização, com o comparativo dos eixos."
                selo="Alimenta o placar"
                onClick={() => setSecao('filiais')}
                tone="bg-sky-500/15 ring-sky-500/40 text-sky-300"
                borda="border-sky-500/30 hover:border-sky-400/60"
                seloTone="bg-sky-500/15 text-sky-300 border-sky-500/30"
                glow="bg-sky-500/25"
              />
              <CardSecao
                icon={Users}
                titulo="Visão do Ciclo"
                hint="Consolidado por pessoa: todas as notas que cada participante recebeu na competição."
                selo="Somente leitura"
                onClick={() => setSecao('ciclo')}
                tone="bg-violet-500/15 ring-violet-500/40 text-violet-300"
                borda="border-violet-500/30 hover:border-violet-400/60"
                seloTone="bg-violet-500/15 text-violet-300 border-violet-500/30"
                glow="bg-violet-500/25"
              />
            </div>
          }
        />
      )}

      {secao !== null && (
        <button
          onClick={() => setSecao(null)}
          className="self-start flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={12} /> Voltar à Central
        </button>
      )}

      {secao === 'filiais' && (
        <>
          {/* Frequência não é voto: vem do ponto do período (migr. 349). */}
          <FrequenciaFiliaisCard competicaoId={competicao.id} />
          {competicao.ciclo_id ? (
            <AvaliacaoFilialPanel
              profile={profile}
              cicloId={competicao.ciclo_id}
              showToast={showToast}
            />
          ) : (
            <EmptyState message="Esta competição não gerou ciclo de avaliação — só competições criadas a partir da migração 238 têm avaliação de filial." />
          )}
          <PainelComparativoEixos showToast={showToast} />
        </>
      )}

      {secao === 'ciclo' && (
        <VisaoCicloPorParticipante competicao={competicao} ehAdmin={profile.role === 'admin'} />
      )}
    </motion.div>
  );
}

// Card da landing pras seções que não são tarefa. Mesmo desenho dos cards
// de tipo em MatrizTarefasPanel pra landing ficar coesa.
function CardSecao({ icon: Icon, titulo, hint, selo, onClick, tone, borda, seloTone, glow }: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  titulo: string;
  hint: string;
  selo: string;
  onClick: () => void;
  tone: string;
  borda: string;
  seloTone: string;
  glow: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative neu-flat rounded-2xl p-5 text-left overflow-hidden group border transition-all flex items-center gap-4 ${borda}`}
    >
      <div className={`pointer-events-none absolute -top-20 -left-10 w-48 h-48 rounded-full blur-3xl opacity-60 ${glow}`} />

      <div className={`relative w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center ring-1 ${tone}`}>
        <Icon size={26} strokeWidth={1.7} />
      </div>

      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-black text-gray-100 tracking-tight">{titulo}</h3>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${seloTone}`}>
            {selo}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1 leading-snug">{hint}</p>
      </div>

      <ChevronRight size={18} className="relative shrink-0 text-gray-600 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
    </button>
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

// Bloco de um grupo do corte (desenvolveu / não desenvolveu / sem nota).
function GrupoDesenvolvimento({ titulo, hint, lista, tom, icone }: {
  titulo: string;
  hint: string;
  lista: LinhaParticipante[];
  tom: string;
  icone: React.ReactNode;
}) {
  return (
    <div className={`neu-flat rounded-xl border p-3 flex flex-col gap-2 ${tom.split(' ')[0]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5 ${tom.split(' ')[1]}`}>
          {icone} {titulo}
        </span>
        <span className="text-lg font-mono font-black text-gray-200 tabular-nums">{lista.length}</span>
      </div>
      <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">{hint}</span>
      {lista.length === 0 ? (
        <span className="text-[11px] text-gray-600 italic">Ninguém aqui.</span>
      ) : (
        <div className="flex flex-col gap-1">
          {lista.map(l => (
            <div key={l.chave} className="flex items-center gap-2 text-xs">
              <span className="text-gray-200 flex-1 truncate">{l.nome}</span>
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${FILIAL_TONE[l.filial]}`}>
                {l.filial}
              </span>
              <span className="font-mono font-black text-amber-300 tabular-nums w-9 text-right">
                {l.mediaGeral !== null ? l.mediaGeral.toFixed(1) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisaoCicloPorParticipante({ competicao, ehAdmin }: { competicao: Competicao; ehAdmin: boolean }) {
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<LinhaParticipante[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Fetch. `comMask` só na primeira carga — refetch disparado por nota nova
  // não pode jogar a tela inteira de volta pro spinner.
  useEffect(() => {
    let cancelou = false;
    (async () => {
      if (refreshTick === 0) setLoading(true);
      const { data: tarefas } = await supabase
        .from('matriz_tarefas')
        .select('id, tipo, nome, data, status')
        .eq('competicao_id', competicao.id)
        .eq('ativo', true);
      // Voto selado (migr. 345): fora do admin, a RLS só devolve a própria
      // nota enquanto a tarefa não encerra. Consolidar tarefa em avaliação
      // aqui produziria uma "média do conselho" feita de uma nota só —
      // número errado numa tela de consolidação. Só entram as encerradas.
      const tsArr = (tarefas ?? []).filter((t: any) => ehAdmin || t.status === 'encerrada');
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
        // Notas de admin não entram — admin modera mas não pesa
        // (mesma regra do placar em calcular_placar_competicao).
        supabase.from('avaliacoes_matriz')
          .select('item_id, item_tipo, nota, avaliador:user_profiles!avaliador_id(role)')
          .eq('competicao_id', competicao.id)
          .in('item_tipo', TAREFA_TIPOS_MATRIZ)
          .eq('ativo', true),
      ]);

      const tarefaById = new Map<string, any>();
      tsArr.forEach((t: any) => tarefaById.set(t.id, t));
      const avalsPorItem = new Map<string, number[]>();
      (avals ?? []).forEach((a: any) => {
        if (a.nota == null) return;
        if (a.avaliador?.role === 'admin') return;
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
    return () => { cancelou = true; };
  }, [competicao.id, refreshTick]);

  // Realtime num efeito próprio: junto do fetch, cada evento derrubava e
  // recriava o canal (com janela cega entre um e outro) só pra refazer a
  // consulta.
  useEffect(() => {
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
    return () => { supabase.removeChannel(canal); };
  }, [competicao.id]);

  const porFilial = useMemo(() => {
    const m: Record<string, LinhaParticipante[]> = {};
    linhas.forEach(l => { (m[l.filial] ??= []).push(l); });
    return m;
  }, [linhas]);

  // Corte desenvolveu / não desenvolveu. 7,0 é só o default — o professor
  // ajusta na tela conforme a turma, sem migração nem config no banco.
  const [corte, setCorte] = useState(7);

  const grupos = useMemo(() => {
    const desenvolveram: LinhaParticipante[] = [];
    const naoDesenvolveram: LinhaParticipante[] = [];
    // Terceiro balde de propósito: quem não recebeu nota nenhuma NÃO é
    // "não desenvolveu" — é gente que o conselho ainda não avaliou.
    // Jogar os dois no mesmo grupo seria acusar alguém pela omissão alheia.
    const semNota: LinhaParticipante[] = [];
    linhas.forEach(l => {
      if (l.mediaGeral === null) semNota.push(l);
      else if (l.mediaGeral >= corte) desenvolveram.push(l);
      else naoDesenvolveram.push(l);
    });
    return { desenvolveram, naoDesenvolveram, semNota };
  }, [linhas, corte]);

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
        {!ehAdmin && ' Entram só as tarefas já encerradas: enquanto uma tarefa está em avaliação, as notas ficam seladas.'}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 size={16} className="animate-spin text-accent" /></div>
      ) : linhas.length === 0 ? (
        // Fora do admin, a lista só considera tarefa encerrada (voto selado).
        // Sem essa distinção a tela mandava criar tarefa que já existe.
        <EmptyState message={ehAdmin
          ? 'Nenhum participante avaliado ainda. Crie uma tarefa e adicione participantes.'
          : 'Nenhuma tarefa encerrada nesta competição ainda. As notas se revelam aqui quando a tarefa for encerrada — enquanto isso, cada avaliação fica selada.'} />
      ) : (
        <div className="flex flex-col gap-5">
          {/* Corte de desenvolvimento — leitura da Matriz, não vai pro aluno */}
          <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h4 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                <TrendingUp size={14} className="text-accent" /> Desenvolvimento da turma
              </h4>
              <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                Corte
                <input
                  type="number" min={0} max={10} step={0.5}
                  value={corte}
                  onChange={e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n <= 10) setCorte(n);
                  }}
                  className="neu-input w-20 py-1.5 px-2 text-sm font-mono font-black rounded-lg text-gray-100"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <GrupoDesenvolvimento
                titulo="Desenvolveram"
                hint={`média ≥ ${corte.toFixed(1)}`}
                lista={grupos.desenvolveram}
                tom="border-emerald-500/30 text-emerald-300"
                icone={<TrendingUp size={13} />}
              />
              <GrupoDesenvolvimento
                titulo="Não desenvolveram"
                hint={`média < ${corte.toFixed(1)}`}
                lista={grupos.naoDesenvolveram}
                tom="border-red-500/30 text-red-300"
                icone={<TrendingDown size={13} />}
              />
              <GrupoDesenvolvimento
                titulo="Ainda sem nota"
                hint="o conselho não avaliou"
                lista={grupos.semNota}
                tom="border-gray-500/30 text-gray-400"
                icone={<Minus size={13} />}
              />
            </div>

            <p className="text-[10px] text-gray-500">
              Classificação pela média das notas do conselho, só para leitura da Matriz — nada disso aparece
              para o aluno. Quem está em "ainda sem nota" não é baixo desempenho: é gente que o conselho não
              avaliou, e entra num grupo separado justamente pra não ser confundida com quem foi mal.
            </p>
          </div>

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
