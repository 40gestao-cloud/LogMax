import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  GraduationCap, Cpu, Presentation, Handshake, Plus, X, Trash2, Loader2,
  Star, MessageSquare, ChevronRight, ChevronDown, ArrowLeft, Check, Users,
  UserCircle, Megaphone, DollarSign, Package, Pencil, Lock, Unlock, Sparkles,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';
import { CENTRAL_FILIAL_TONE, CENTRAL_OP_FILIAIS, type CentralCompeticao as Competicao } from './MatrizAvaliacoesView';

type TipoTarefa =
  | 'tarefa_treinamento_vendas' | 'tarefa_treinamento_ia' | 'tarefa_apresentacao'
  | 'tarefa_rh' | 'tarefa_marketing' | 'tarefa_financeiro' | 'tarefa_logistica';
type FilialOp = typeof CENTRAL_OP_FILIAIS[number];

type TipoConfig = {
  id: TipoTarefa;
  label: string;
  hint: string;
  icon: any;
  glow: string;
  iconBg: string;
  iconRing: string;
  iconColor: string;
  novoLabel: string;
};

const TIPOS: TipoConfig[] = [
  {
    id: 'tarefa_apresentacao',
    label: 'Apresentação Profissional',
    hint: 'Criar pauta de apresentação, selecionar participantes e nota 0-10 do conselho.',
    icon: Presentation,
    glow: 'bg-amber-500/25', iconBg: 'bg-amber-500/10', iconRing: 'ring-amber-500/25', iconColor: 'text-amber-300',
    novoLabel: 'Nova apresentação',
  },
  {
    id: 'tarefa_treinamento_ia',
    label: 'Desenvolvimento com IA',
    hint: 'Criar atividade de Desenvolvimento com IA, participantes por filial, nota 0-10 do conselho.',
    icon: Cpu,
    glow: 'bg-orange-500/25', iconBg: 'bg-orange-500/10', iconRing: 'ring-orange-500/25', iconColor: 'text-orange-400',
    novoLabel: 'Nova atividade de Desenvolvimento com IA',
  },
  {
    id: 'tarefa_rh',
    label: 'Recursos Humanos',
    hint: 'Criar atividade de RH, definir participantes por filial e nota 0-10 do conselho.',
    icon: UserCircle,
    glow: 'bg-sky-500/25', iconBg: 'bg-sky-500/10', iconRing: 'ring-sky-500/25', iconColor: 'text-sky-400',
    novoLabel: 'Nova atividade de Recursos Humanos',
  },
  {
    id: 'tarefa_financeiro',
    label: 'Financeiro',
    hint: 'Criar atividade Financeira, participantes por filial e nota 0-10 do conselho.',
    icon: DollarSign,
    glow: 'bg-rose-500/25', iconBg: 'bg-rose-500/10', iconRing: 'ring-rose-500/25', iconColor: 'text-rose-400',
    novoLabel: 'Nova atividade de Financeiro',
  },
  {
    id: 'tarefa_logistica',
    label: 'Logística',
    hint: 'Criar atividade de Logística, participantes por filial e nota 0-10 do conselho.',
    icon: Package,
    glow: 'bg-emerald-500/25', iconBg: 'bg-emerald-500/10', iconRing: 'ring-emerald-500/25', iconColor: 'text-emerald-400',
    novoLabel: 'Nova atividade de Logística',
  },
  {
    id: 'tarefa_marketing',
    label: 'Marketing',
    hint: 'Criar atividade de Marketing, participantes por filial e nota 0-10 do conselho.',
    icon: Megaphone,
    glow: 'bg-pink-500/25', iconBg: 'bg-pink-500/10', iconRing: 'ring-pink-500/25', iconColor: 'text-pink-400',
    novoLabel: 'Nova atividade de Marketing',
  },
  {
    id: 'tarefa_treinamento_vendas',
    label: 'Vendas e Atendimento',
    hint: 'Criar atividade, definir participantes por filial e nota 0-10 do conselho.',
    icon: Handshake,
    glow: 'bg-blue-500/25', iconBg: 'bg-blue-500/10', iconRing: 'ring-blue-500/25', iconColor: 'text-blue-400',
    novoLabel: 'Nova atividade de Vendas e Atendimento',
  },
];

const TIPO_BY_ID = new Map(TIPOS.map(t => [t.id, t] as const));

type Tarefa = {
  id: string;
  competicao_id: string;
  tipo: TipoTarefa;
  nome: string;
  descricao: string | null;
  data: string;
  criado_por: string;
  created_at: string;
  status: 'aberta' | 'encerrada';
};

type Participante = {
  id: string;
  tarefa_id: string;
  funcionario_id: string | null;
  nome_snapshot: string;
  filial: FilialOp;
};

type AvaliacaoParticipante = {
  id: string;
  item_id: string;
  filial_avaliada: string;
  avaliador_id: string;
  nota: number | null;
  comentario: string | null;
  // Vem via JOIN — `role` exclui notas de admin da média exibida (mesma
  // regra do placar em calcular_placar_competicao) e `nome` identifica
  // quem já avaliou na quebra por avaliador.
  avaliador?: { nome: string | null; role: string | null } | null;
};

// ──────────────────────────────────────────────────────────────────────
export function MatrizTarefasPanel({ competicao, profile, podeAvaliar, showToast, extras }: {
  competicao: Competicao;
  profile: UserProfile;
  podeAvaliar: boolean;
  showToast: any;
  // Cards extras da landing (Avaliação das Filiais, Visão do Ciclo). Ficam
  // ao lado dos tipos de tarefa e somem quando se entra numa tarefa — o
  // avaliador vê só o que está avaliando.
  extras?: React.ReactNode;
}) {
  const [tipoAtivo, setTipoAtivo] = useState<TipoTarefa | null>(null);

  if (tipoAtivo === null) {
    return <LandingTipos onSelect={setTipoAtivo} competicao={competicao} extras={extras} />;
  }

  return (
    <PainelTipoTarefa
      key={tipoAtivo}
      tipoConfig={TIPO_BY_ID.get(tipoAtivo)!}
      competicao={competicao}
      profile={profile}
      podeAvaliar={podeAvaliar}
      showToast={showToast}
      onVoltar={() => setTipoAtivo(null)}
    />
  );
}

// ── Landing: cards por tipo de tarefa ────────────────────────────────
function LandingTipos({ onSelect, competicao, extras }: { onSelect: (t: TipoTarefa) => void; competicao: Competicao; extras?: React.ReactNode }) {
  const [contadores, setContadores] = useState<Record<TipoTarefa, number>>({
    tarefa_treinamento_vendas: 0,
    tarefa_treinamento_ia: 0,
    tarefa_apresentacao: 0,
    tarefa_rh: 0,
    tarefa_marketing: 0,
    tarefa_financeiro: 0,
    tarefa_logistica: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('matriz_tarefas')
        .select('tipo')
        .eq('competicao_id', competicao.id)
        .eq('ativo', true);
      const contagens: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { contagens[r.tipo] = (contagens[r.tipo] ?? 0) + 1; });
      setContadores({
        tarefa_treinamento_vendas: contagens['tarefa_treinamento_vendas'] ?? 0,
        tarefa_treinamento_ia:     contagens['tarefa_treinamento_ia'] ?? 0,
        tarefa_apresentacao:       contagens['tarefa_apresentacao'] ?? 0,
        tarefa_rh:                 contagens['tarefa_rh'] ?? 0,
        tarefa_marketing:          contagens['tarefa_marketing'] ?? 0,
        tarefa_financeiro:         contagens['tarefa_financeiro'] ?? 0,
        tarefa_logistica:          contagens['tarefa_logistica'] ?? 0,
      });
      setLoading(false);
    })();
  }, [competicao.id]);

  return (
    <div className="flex flex-col gap-6">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {TIPOS.map((t, idx) => {
        const Icon = t.icon;
        // Sobrando 1 card na última linha (7 tipos em 3 colunas), ele desce
        // pra coluna do meio — fica embaixo de Logística em vez de pendurado
        // na esquerda. Em 2 colunas o fluxo natural já alinha.
        const centralizaSozinho = TIPOS.length % 3 === 1 && idx === TIPOS.length - 1;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`relative neu-flat rounded-2xl p-5 text-left overflow-hidden group hover:border-accent/40 hover:ring-1 hover:ring-accent/25 transition-all flex flex-col gap-4 ${
              centralizaSozinho ? 'lg:col-start-2' : ''
            }`}
          >
            <div className={`pointer-events-none absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl opacity-50 ${t.glow}`} />

            <div className="relative flex items-start justify-between gap-2">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ring-1 ${t.iconBg} ${t.iconRing}`}>
                <Icon size={20} strokeWidth={1.8} className={t.iconColor} />
              </div>
              <ChevronRight size={16} className="text-gray-600 group-hover:text-accent transition-colors" />
            </div>

            <div className="relative">
              <h3 className="text-base font-black text-gray-100 tracking-tight">{t.label}</h3>
              <p className="text-[11px] text-gray-400 mt-1 leading-snug">{t.hint}</p>
            </div>

            <div className="relative flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold pt-3 border-t border-white/5">
              {loading ? (
                <Loader2 size={11} className="animate-spin text-gray-500" />
              ) : (
                <span className="text-gray-400 tabular-nums">
                  {contadores[t.id]} tarefa{contadores[t.id] === 1 ? '' : 's'} nesta competição
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>

    {/* Painéis que não são tarefa — faixa separada pra não competir com os
        cards de tipo, que é onde o avaliador entra no dia a dia. */}
    {extras && (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500 shrink-0">
            Painéis consolidados
          </span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        {extras}
      </div>
    )}
    </div>
  );
}

// ── Painel de um tipo: lista + criar + avaliar participantes ─────────
function PainelTipoTarefa({ tipoConfig, competicao, profile, podeAvaliar, showToast, onVoltar }: {
  tipoConfig: TipoConfig;
  competicao: Competicao;
  profile: UserProfile;
  podeAvaliar: boolean;
  showToast: any;
  onVoltar: () => void;
}) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoParticipante[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editandoTarefa, setEditandoTarefa] = useState<Tarefa | null>(null);
  const [briefingTarefa, setBriefingTarefa] = useState<Tarefa | null>(null);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  // Participante aberto no modal de avaliação (nota + comentário + exclusão).
  const [avaliando, setAvaliando] = useState<{ participante: Participante; tarefa: Tarefa } | null>(null);
  const confirm = useConfirm();

  const podeCriar = profile.role === 'admin' || profile.role === 'ceo' || (profile.role === 'gerente' && (profile as any).is_conselheiro) || profile.role === 'conselheiro';

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data: ts } = await supabase
      .from('matriz_tarefas')
      .select('id,competicao_id,tipo,nome,descricao,data,criado_por,created_at,status')
      .eq('competicao_id', competicao.id)
      .eq('tipo', tipoConfig.id)
      .eq('ativo', true)
      .order('data', { ascending: false });
    const tsArr = (ts ?? []) as Tarefa[];
    setTarefas(tsArr);

    if (tsArr.length === 0) {
      setParticipantes([]); setAvaliacoes([]); setLoading(false); return;
    }
    const ids = tsArr.map(t => t.id);
    const { data: ps } = await supabase
      .from('matriz_tarefa_participantes')
      .select('id,tarefa_id,funcionario_id,nome_snapshot,filial')
      .in('tarefa_id', ids)
      .eq('ativo', true);
    setParticipantes((ps ?? []) as Participante[]);

    const partIds = (ps ?? []).map((p: any) => p.id);
    if (partIds.length > 0) {
      const { data: as } = await supabase
        .from('avaliacoes_matriz')
        .select('id,item_id,filial_avaliada,avaliador_id,nota,comentario,avaliador:user_profiles!avaliador_id(nome,role)')
        .eq('competicao_id', competicao.id)
        .eq('item_tipo', tipoConfig.id)
        .in('item_id', partIds)
        .eq('ativo', true);
      setAvaliacoes((as ?? []) as any as AvaliacaoParticipante[]);
    } else {
      setAvaliacoes([]);
    }
    setLoading(false);
  }, [competicao.id, tipoConfig.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const participantesPorTarefa = useMemo(() => {
    const m: Record<string, Participante[]> = {};
    for (const p of participantes) {
      (m[p.tarefa_id] ??= []).push(p);
    }
    return m;
  }, [participantes]);

  const avalsPorParticipante = useMemo(() => {
    const m: Record<string, AvaliacaoParticipante[]> = {};
    for (const a of avaliacoes) {
      (m[a.item_id] ??= []).push(a);
    }
    return m;
  }, [avaliacoes]);

  // Nota e comentário vão sempre juntos: o UPSERT da RPC sobrescreve os dois
  // campos, então mandar um só apagaria o outro.
  async function avaliarParticipante(part: Participante, patch: { nota: number|null; comentario: string|null }): Promise<boolean> {
    if (!podeAvaliar) return false;
    setSubmittingIds(s => new Set(s).add(part.id));
    const { error } = await supabase.rpc('avaliar_item_matriz', {
      p_competicao_id:   competicao.id,
      p_filial_avaliada: part.filial,
      p_item_tipo:       tipoConfig.id,
      p_item_id:         part.id,
      p_decisao:         null,
      p_nota:            patch.nota,
      p_comentario:      patch.comentario,
    });
    setSubmittingIds(s => { const n = new Set(s); n.delete(part.id); return n; });

    if (error) { showToast(error.message || 'Erro ao avaliar', 'error'); return false; }
    showToast('Avaliação salva', 'success');
    carregar();
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
    return true;
  }

  // Soft delete da própria avaliação (RPC da migr. 343). Sai da média na hora.
  async function excluirAvaliacao(part: Participante): Promise<boolean> {
    if (!podeAvaliar) return false;
    setSubmittingIds(s => new Set(s).add(part.id));
    const { error } = await supabase.rpc('remover_avaliacao_matriz', {
      p_competicao_id: competicao.id,
      p_item_tipo:     tipoConfig.id,
      p_item_id:       part.id,
    });
    setSubmittingIds(s => { const n = new Set(s); n.delete(part.id); return n; });

    if (error) { showToast(error.message || 'Erro ao excluir', 'error'); return false; }
    showToast('Avaliação excluída', 'success');
    carregar();
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
    return true;
  }

  async function encerrarTarefa(tarefa: Tarefa) {
    if (!await confirm({
      message: `Encerrar "${tarefa.nome}"? Notas continuam contando no placar, mas ninguém poderá mais alterar nota, adicionar/remover participante ou editar a tarefa. Você pode reabrir depois.`,
      confirmLabel: 'Encerrar',
    })) return;
    const { error } = await supabase.rpc('encerrar_matriz_tarefa', { p_tarefa_id: tarefa.id });
    if (error) return showToast(error.message || 'Erro ao encerrar', 'error');
    showToast('Tarefa encerrada', 'success');
    carregar();
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  }

  async function reabrirTarefa(tarefa: Tarefa) {
    if (!await confirm({
      message: `Reabrir "${tarefa.nome}"? Volta a aceitar notas, edição e mudança de participantes.`,
      confirmLabel: 'Reabrir',
    })) return;
    const { error } = await supabase.rpc('reabrir_matriz_tarefa', { p_tarefa_id: tarefa.id });
    if (error) return showToast(error.message || 'Erro ao reabrir', 'error');
    showToast('Tarefa reaberta', 'success');
    carregar();
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  }

  async function removerTarefa(tarefaId: string) {
    if (!await confirm({
      message: 'Remover esta tarefa? Notas ficarão preservadas no histórico mas somem do placar ativo.',
      confirmLabel: 'Remover',
      danger: true,
    })) return;
    const { error } = await supabase.rpc('remover_matriz_tarefa', { p_tarefa_id: tarefaId });
    if (error) return showToast(error.message || 'Erro ao remover', 'error');
    showToast('Tarefa removida', 'success');
    carregar();
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  }

  const Icon = tipoConfig.icon;

  return (
    <section className="flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onVoltar}
            className="shrink-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg neu-button text-gray-300 hover:text-accent">
            <ArrowLeft size={12} /> Voltar
          </button>
          <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center ring-1 ring-accent/25">
            <Icon size={18} className="text-accent" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-100">{tipoConfig.label}</h3>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              {tarefas.length} tarefa{tarefas.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        {podeCriar && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40">
            <Plus size={14} /> {tipoConfig.novoLabel}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
      ) : tarefas.length === 0 ? (
        <EmptyState message={`Nenhuma tarefa deste tipo criada nesta competição ainda.${podeCriar ? ' Use o botão acima pra criar a primeira.' : ''}`} />
      ) : (
        <div className="flex flex-col gap-4">
          {tarefas.map(t => (
            <TarefaCard
              key={t.id}
              tarefa={t}
              tipoConfig={tipoConfig}
              participantes={participantesPorTarefa[t.id] ?? []}
              avalsPorParticipante={avalsPorParticipante}
              submittingIds={submittingIds}
              podeAvaliar={podeAvaliar}
              podeGerenciar={profile.role === 'admin' || profile.role === 'ceo'}
              minhaId={profile.id}
              onAbrirAvaliacao={p => setAvaliando({ participante: p, tarefa: t })}
              onRemover={() => removerTarefa(t.id)}
              onEditar={() => setEditandoTarefa(t)}
              onEncerrar={() => encerrarTarefa(t)}
              onReabrir={() => reabrirTarefa(t)}
              onBriefingIa={() => setBriefingTarefa(t)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <ModalCriarTarefa
          tipoConfig={tipoConfig}
          competicao={competicao}
          onClose={() => setModalOpen(false)}
          onCriada={() => { setModalOpen(false); carregar(); }}
          showToast={showToast}
        />
      )}

      {editandoTarefa && (
        <ModalEditarTarefa
          tipoConfig={tipoConfig}
          tarefa={tarefas.find(t => t.id === editandoTarefa.id) ?? editandoTarefa}
          participantes={participantesPorTarefa[editandoTarefa.id] ?? []}
          onClose={() => setEditandoTarefa(null)}
          onSalvo={() => { setEditandoTarefa(null); carregar(); }}
          onRefresh={carregar}
          showToast={showToast}
        />
      )}

      {avaliando && (
        <ModalAvaliarParticipante
          // key por participante: garante que nota/comentário do form remontem
          // se a tela trocar de avaliado sem desmontar o modal.
          key={avaliando.participante.id}
          participante={avaliando.participante}
          tarefa={tarefas.find(t => t.id === avaliando.tarefa.id) ?? avaliando.tarefa}
          avals={avalsPorParticipante[avaliando.participante.id] ?? []}
          minhaId={profile.id}
          // Tarefa encerrada vira leitura: a RPC recusaria a escrita de qualquer jeito.
          podeAvaliar={podeAvaliar && (tarefas.find(t => t.id === avaliando.tarefa.id)?.status ?? 'aberta') !== 'encerrada'}
          onFechar={() => setAvaliando(null)}
          onSalvar={patch => avaliarParticipante(avaliando.participante, patch)}
          onExcluir={() => excluirAvaliacao(avaliando.participante)}
        />
      )}

      {briefingTarefa && (
        <ModalBriefingIa
          tarefa={briefingTarefa}
          competicao={competicao}
          onClose={() => setBriefingTarefa(null)}
          onAprovada={() => { carregar(); window.dispatchEvent(new Event('avaliacao-matriz:changed')); }}
          showToast={showToast}
        />
      )}
    </section>
  );
}

// ── Card de uma tarefa com lista de participantes votáveis ───────────
function TarefaCard({ tarefa, tipoConfig, participantes, avalsPorParticipante, submittingIds, podeAvaliar, podeGerenciar, minhaId, onAbrirAvaliacao, onRemover, onEditar, onEncerrar, onReabrir, onBriefingIa }: {
  tarefa: Tarefa;
  tipoConfig: TipoConfig;
  participantes: Participante[];
  avalsPorParticipante: Record<string, AvaliacaoParticipante[]>;
  submittingIds: Set<string>;
  podeAvaliar: boolean;
  podeGerenciar: boolean;
  minhaId: string;
  onAbrirAvaliacao: (p: Participante) => void;
  onRemover: () => void;
  onEditar: () => void;
  onEncerrar: () => void;
  onReabrir: () => void;
  onBriefingIa: () => void;
}) {
  const porFilial = useMemo(() => {
    const m: Record<FilialOp, Participante[]> = { SuperMax: [], MaxLook: [], TechMax: [] };
    for (const p of participantes) m[p.filial]?.push(p);
    return m;
  }, [participantes]);
  const encerrada = tarefa.status === 'encerrada';
  // Descrição fica em 2 linhas até o conselheiro clicar. Pauta longa empurrava
  // a grade de participantes pra fora da tela quando havia várias tarefas.
  const [expandido, setExpandido] = useState(false);

  return (
    <div className={`neu-flat rounded-2xl border p-4 flex flex-col gap-3 ${encerrada ? 'border-gray-500/25 opacity-95' : 'border-accent/10'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold flex items-center gap-2 flex-wrap">
            {new Date(tarefa.data + 'T00:00:00').toLocaleDateString('pt-BR')} · {participantes.length} participante{participantes.length === 1 ? '' : 's'}
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1 ${
              encerrada
                ? 'bg-gray-500/20 text-gray-300 ring-1 ring-gray-500/30'
                : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
            }`}>
              {encerrada ? <><Lock size={9} /> Encerrada</> : <><Unlock size={9} /> Aberta</>}
            </span>
          </span>
          {tarefa.descricao ? (
            <button
              type="button"
              onClick={() => setExpandido(v => !v)}
              title={expandido ? 'Recolher descrição' : 'Clique para ler a descrição inteira'}
              className="group text-left flex flex-col gap-1 min-w-0"
            >
              <h4 className="text-lg font-black text-gray-100 flex items-center gap-1.5">
                {tarefa.nome}
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-gray-500 group-hover:text-accent transition-all ${expandido ? 'rotate-180 text-accent' : ''}`}
                />
              </h4>
              <p className={`text-[13px] text-gray-400 leading-snug whitespace-pre-wrap ${expandido ? '' : 'line-clamp-2'}`}>
                {tarefa.descricao}
              </p>
            </button>
          ) : (
            <h4 className="text-lg font-black text-gray-100">{tarefa.nome}</h4>
          )}
        </div>
        {podeGerenciar && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {!encerrada && (
              <>
                <button onClick={onBriefingIa} className="btn-shimmer btn-shimmer--glass-purple" title="MaxAI Briefing — IA sugere sub-tarefas nos outros tipos pra apoiar esta tarefa">
                  <Sparkles size={11} /> MaxAI Briefing
                </button>
                <button onClick={onEditar} className="btn-shimmer btn-shimmer--glass-blue" title="Editar tarefa">
                  <Pencil size={11} /> Editar
                </button>
                <button onClick={onEncerrar} className="btn-shimmer btn-shimmer--glass-yellow" title="Encerrar tarefa">
                  <Lock size={11} /> Encerrar
                </button>
              </>
            )}
            {encerrada && (
              <button onClick={onReabrir} className="btn-shimmer btn-shimmer--glass-yellow" title="Reabrir tarefa">
                <Unlock size={11} /> Reabrir
              </button>
            )}
            <button onClick={onRemover} className="btn-shimmer btn-shimmer--glass-red" title="Remover tarefa">
              <Trash2 size={11} /> Remover
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {CENTRAL_OP_FILIAIS.map(f => {
          const lista = porFilial[f];
          const tone = CENTRAL_FILIAL_TONE[f];
          return (
            <div key={f} className="neu-pressed rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${tone}`}>{f}</span>
                <span className="text-[11px] font-mono text-gray-500">{lista.length}</span>
              </div>
              {lista.length === 0 ? (
                <span className="text-xs text-gray-500 italic">Sem participantes</span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {lista.map(p => (
                    <ParticipanteRow
                      key={p.id}
                      participante={p}
                      avals={avalsPorParticipante[p.id] ?? []}
                      minhaId={minhaId}
                      podeAvaliar={podeAvaliar && !encerrada}
                      submitting={submittingIds.has(p.id)}
                      onAbrir={() => onAbrirAvaliacao(p)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParticipanteRow({ participante, avals, minhaId, podeAvaliar, submitting, onAbrir }: {
  participante: Participante;
  avals: AvaliacaoParticipante[];
  minhaId: string;
  podeAvaliar: boolean;
  submitting: boolean;
  onAbrir: () => void;
}) {
  const minha = avals.find(a => a.avaliador_id === minhaId);
  // Notas de admin não entram na média — admin é moderador aqui.
  const avalsConselho = avals.filter(a => a.avaliador?.role !== 'admin');
  const notas = avalsConselho.filter(a => a.nota !== null && a.nota !== undefined).map(a => Number(a.nota));
  const media = notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
  // Conta quem deu nota OU só comentou (comentário sem nota é avaliação
  // válida — constraint chk_algo_avaliado da migr. 210).
  const total = avals.filter(a => (a.nota !== null && a.nota !== undefined) || !!a.comentario).length;

  return (
    <button
      onClick={onAbrir}
      disabled={submitting}
      className="w-full flex items-center gap-2 py-1.5 border-b border-white/5 last:border-b-0 text-left group disabled:opacity-60"
    >
      <Users size={13} className="text-gray-500 shrink-0" />
      <span className="text-sm text-gray-200 flex-1 truncate group-hover:text-white transition-colors">
        {participante.nome_snapshot}
      </span>

      {total > 0 && (
        <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500 tabular-nums shrink-0">
          {total} aval.
        </span>
      )}

      {minha?.comentario && <MessageSquare size={13} className="text-accent shrink-0" />}

      {minha?.nota != null && (
        <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent tabular-nums shrink-0">
          sua {Number(minha.nota).toFixed(1)}
        </span>
      )}

      {media !== null ? (
        <span className="text-sm font-mono font-black text-amber-300 tabular-nums shrink-0">
          {media.toFixed(1)}<span className="text-gray-500 text-[11px]">/10</span>
        </span>
      ) : (
        <span className="text-[10px] uppercase tracking-widest font-bold text-gray-600 shrink-0">sem nota</span>
      )}

      {submitting
        ? <Loader2 size={14} className="animate-spin text-accent shrink-0" />
        : podeAvaliar
          ? <Star size={14} className="text-gray-600 group-hover:text-amber-400 transition-colors shrink-0" />
          : <ChevronRight size={14} className="text-gray-600 group-hover:text-accent transition-colors shrink-0" />}
    </button>
  );
}

// ── Modal de avaliação de um participante ────────────────────────────
// Nota e comentário salvam JUNTOS num único UPSERT. A RPC faz
// `nota = EXCLUDED.nota, comentario = EXCLUDED.comentario`, então mandar
// os dois de uma vez é o que impede um campo apagar o outro.
function ModalAvaliarParticipante({ participante, tarefa, avals, minhaId, podeAvaliar, onFechar, onSalvar, onExcluir }: {
  participante: Participante;
  tarefa: Tarefa;
  avals: AvaliacaoParticipante[];
  minhaId: string;
  podeAvaliar: boolean;
  onFechar: () => void;
  onSalvar: (patch: { nota: number | null; comentario: string | null }) => Promise<boolean>;
  onExcluir: () => Promise<boolean>;
}) {
  const confirm = useConfirm();
  const minha = avals.find(a => a.avaliador_id === minhaId);
  const [nota, setNota] = useState<string>(minha?.nota != null ? String(minha.nota) : '');
  const [comentario, setComentario] = useState<string>(minha?.comentario ?? '');
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const avalsConselho = avals.filter(a => a.avaliador?.role !== 'admin');
  const notas = avalsConselho.filter(a => a.nota != null).map(a => Number(a.nota));
  const media = notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
  const outras = avals
    .filter(a => a.avaliador_id !== minhaId && (a.nota != null || !!a.comentario))
    .sort((a, b) => (a.avaliador?.nome ?? '').localeCompare(b.avaliador?.nome ?? ''));

  async function salvar() {
    const bruto = nota.trim();
    const n = bruto === '' ? null : Number(bruto);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10)) {
      return setErro('Nota precisa ser um número entre 0 e 10.');
    }
    const c = comentario.trim() === '' ? null : comentario.trim();
    if (n === null && c === null) {
      return setErro('Preencha a nota ou o comentário. Pra apagar tudo, use "Excluir minha avaliação".');
    }
    setErro(null);
    setSalvando(true);
    const ok = await onSalvar({ nota: n, comentario: c });
    setSalvando(false);
    if (ok) onFechar();
  }

  async function excluir() {
    if (!await confirm({
      message: `Excluir sua avaliação de ${participante.nome_snapshot}? A nota sai da média da filial no placar.`,
      confirmLabel: 'Excluir avaliação',
      danger: true,
    })) return;
    setExcluindo(true);
    const ok = await onExcluir();
    setExcluindo(false);
    if (ok) onFechar();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onFechar}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-accent/20 p-5 sm:p-6 w-full max-w-lg my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-black text-gray-100 truncate">{participante.nome_snapshot}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${CENTRAL_FILIAL_TONE[participante.filial]}`}>
                {participante.filial}
              </span>
              <span className="text-xs text-gray-500 truncate">{tarefa.nome}</span>
            </div>
          </div>
          <button onClick={onFechar} className="neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200 shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="neu-pressed rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest font-bold text-gray-500">Média do conselho</span>
          <span className="text-2xl font-mono font-black text-amber-300 tabular-nums">
            {media !== null
              ? <>{media.toFixed(1)}<span className="text-gray-500 text-sm">/10</span></>
              : <span className="text-gray-600 text-sm">sem nota</span>}
          </span>
        </div>

        {podeAvaliar ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-start">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Sua nota (0-10)</label>
                <input
                  autoFocus
                  type="number" min={0} max={10} step={0.5}
                  value={nota}
                  onChange={e => { setNota(e.target.value); setErro(null); }}
                  placeholder="0-10"
                  className="neu-input w-28 py-2.5 px-3 text-lg font-mono font-black rounded-lg text-gray-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Comentário (opcional)</label>
                <textarea
                  value={comentario}
                  onChange={e => { setComentario(e.target.value); setErro(null); }}
                  rows={3}
                  placeholder="O que sustenta essa nota? Só o conselho lê."
                  className="neu-input w-full py-2 px-3 text-sm rounded-lg text-gray-100"
                />
              </div>
            </div>

            {erro && <p className="text-xs text-red-400">{erro}</p>}

            <div className="flex items-center gap-2 flex-wrap">
              {minha && (
                <button
                  onClick={excluir}
                  disabled={excluindo || salvando}
                  className="btn-shimmer btn-shimmer--glass-red"
                >
                  {excluindo ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  Excluir minha avaliação
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={onFechar}
                  className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvar}
                  disabled={salvando || excluindo}
                  className="flex items-center gap-1.5 text-[11px] font-bold px-4 py-2 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
                >
                  {salvando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {minha ? 'Atualizar avaliação' : 'Salvar avaliação'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            Modo leitura — só CEO e conselheiros da Matriz dão nota.
          </p>
        )}

        <div className="pt-3 border-t border-white/5 flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Avaliações do conselho ({outras.length + (minha ? 1 : 0)})
          </p>
          {outras.length === 0 && !minha ? (
            <p className="text-xs text-gray-600 italic">Ninguém avaliou este participante ainda.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {minha && <LinhaAvaliacao aval={minha} sou />}
              {outras.map(a => <LinhaAvaliacao key={a.id} aval={a} />)}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function LinhaAvaliacao({ aval, sou }: { aval: AvaliacaoParticipante; sou?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <span className="font-mono font-black text-amber-300 tabular-nums w-10 shrink-0">
        {aval.nota != null ? Number(aval.nota).toFixed(1) : <span className="text-gray-600">—</span>}
      </span>
      <div className="min-w-0">
        <span className="text-gray-300">{aval.avaliador?.nome ?? 'Avaliador'}</span>
        {sou && <span className="text-accent"> (você)</span>}
        {aval.avaliador?.role === 'admin' && (
          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold ml-1.5">
            admin · fora da média
          </span>
        )}
        {aval.comentario && <p className="text-gray-500 break-words">{aval.comentario}</p>}
      </div>
    </div>
  );
}

// ── Modal de criação ─────────────────────────────────────────────────
function ModalCriarTarefa({ tipoConfig, competicao, onClose, onCriada, showToast }: {
  tipoConfig: TipoConfig;
  competicao: Competicao;
  onClose: () => void;
  onCriada: () => void;
  showToast: any;
}) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [data, setData] = useState(todayBR());
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>({});
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [loadingFn, setLoadingFn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filtroFilial, setFiltroFilial] = useState<'todas' | FilialOp>('todas');

  useEffect(() => {
    (async () => {
      setLoadingFn(true);
      const { data } = await supabase
        .from('funcionarios')
        .select('id,nome,filial,cargo,ativo')
        .in('filial', CENTRAL_OP_FILIAIS as unknown as string[])
        .eq('ativo', true)
        .order('nome', { ascending: true });
      setFuncionarios(data ?? []);
      setLoadingFn(false);
    })();
  }, []);

  const funcionariosFiltrados = useMemo(() =>
    filtroFilial === 'todas' ? funcionarios : funcionarios.filter(f => f.filial === filtroFilial),
    [funcionarios, filtroFilial]);

  const totalSelecionados = Object.values(selecionados).filter(Boolean).length;

  async function criar() {
    if (!nome.trim()) return showToast('Informe o nome da tarefa', 'error');
    if (totalSelecionados === 0) return showToast('Selecione ao menos 1 participante', 'error');
    setSaving(true);
    const participantes = funcionarios
      .filter(f => selecionados[f.id])
      .map(f => ({ funcionario_id: f.id, nome: f.nome, filial: f.filial }));
    const { error } = await supabase.rpc('criar_matriz_tarefa', {
      p_competicao_id: competicao.id,
      p_tipo:          tipoConfig.id,
      p_nome:          nome.trim(),
      p_descricao:     descricao.trim(),
      p_data:          data,
      p_participantes: participantes,
    });
    setSaving(false);
    if (error) return showToast(error.message || 'Erro ao criar tarefa', 'error');
    showToast('Tarefa criada', 'success');
    onCriada();
  }

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
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-black text-gray-100">{tipoConfig.novoLabel}</h3>
          <button onClick={onClose} className="neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Nome</label>
            <input
              type="text" value={nome} onChange={e => setNome(e.target.value)}
              placeholder={tipoConfig.id === 'tarefa_apresentacao' ? 'Ex.: Pauta comercial Q3' : 'Ex.: Vendas consultivas'}
              className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Data</label>
            <input
              type="date" value={data} onChange={e => setData(e.target.value)}
              className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            Descrição / pauta (opcional)
          </label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={2}
            className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100 resize-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              Participantes ({totalSelecionados} selecionados)
            </label>
            <div className="flex items-center gap-1 neu-pressed rounded-lg p-0.5">
              {(['todas', ...CENTRAL_OP_FILIAIS] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFiltroFilial(f as any)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded transition-all ${
                    filtroFilial === f ? 'neu-button text-accent' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {f === 'todas' ? 'Todas' : f}
                </button>
              ))}
            </div>
          </div>

          {loadingFn ? (
            <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-accent" /></div>
          ) : funcionariosFiltrados.length === 0 ? (
            <p className="text-xs text-gray-500 italic py-3 text-center">Nenhum funcionário disponível.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto neu-pressed rounded-xl p-2 flex flex-col gap-1">
              {funcionariosFiltrados.map(f => {
                const marcado = !!selecionados[f.id];
                const tone = CENTRAL_FILIAL_TONE[f.filial as FilialOp] ?? 'bg-gray-500/20 text-gray-300';
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      marcado ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <input
                      type="checkbox" checked={marcado}
                      onChange={e => setSelecionados(s => ({ ...s, [f.id]: e.target.checked }))}
                      className="accent-current"
                    />
                    <span className="text-xs text-gray-200 flex-1 truncate">{f.nome}</span>
                    {f.cargo && <span className="text-[10px] text-gray-500 hidden sm:inline">{f.cargo}</span>}
                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${tone}`}>{f.filial}</span>
                    {marcado && <Check size={12} className="text-accent" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <button onClick={onClose} disabled={saving}
            className="text-xs font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200">
            Cancelar
          </button>
          <button onClick={criar} disabled={saving || !nome.trim() || totalSelecionados === 0}
            className="text-xs font-bold px-4 py-2 rounded-lg neu-button text-accent ring-1 ring-accent/40 hover:ring-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={12} className="animate-spin" />}
            Criar tarefa
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Modal de edição (nome/descrição/data + participantes) ────────────
function ModalEditarTarefa({ tipoConfig: _tipoConfig, tarefa, participantes, onClose, onSalvo, onRefresh, showToast }: {
  tipoConfig: TipoConfig;
  tarefa: Tarefa;
  participantes: Participante[];
  onClose: () => void;
  onSalvo: () => void;
  onRefresh: () => void | Promise<void>;
  showToast: any;
}) {
  const [nome, setNome] = useState(tarefa.nome);
  const [descricao, setDescricao] = useState(tarefa.descricao ?? '');
  const [data, setData] = useState(tarefa.data);
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [loadingFn, setLoadingFn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filtroFilial, setFiltroFilial] = useState<'todas' | FilialOp>('todas');
  const partByFuncId = useMemo(() => {
    const m = new Map<string, Participante>();
    participantes.forEach(p => { if (p.funcionario_id) m.set(p.funcionario_id, p); });
    return m;
  }, [participantes]);

  useEffect(() => {
    (async () => {
      setLoadingFn(true);
      const { data } = await supabase
        .from('funcionarios')
        .select('id,nome,filial,cargo,ativo')
        .in('filial', CENTRAL_OP_FILIAIS as unknown as string[])
        .eq('ativo', true)
        .order('nome', { ascending: true });
      setFuncionarios(data ?? []);
      setLoadingFn(false);
    })();
  }, []);

  const funcionariosFiltrados = useMemo(() =>
    filtroFilial === 'todas' ? funcionarios : funcionarios.filter(f => f.filial === filtroFilial),
    [funcionarios, filtroFilial]);

  async function toggle(f: any, marcar: boolean) {
    const part = partByFuncId.get(f.id);
    if (marcar && !part) {
      const { error } = await supabase.rpc('adicionar_matriz_participante', {
        p_tarefa_id: tarefa.id,
        p_funcionario_id: f.id,
        p_nome: f.nome,
        p_filial: f.filial,
      });
      if (error) return showToast(error.message || 'Erro ao adicionar participante', 'error');
      await onRefresh();
      return;
    }
    if (!marcar && part) {
      const { error } = await supabase.rpc('remover_matriz_participante', { p_participante_id: part.id });
      if (error) return showToast(error.message || 'Erro ao remover participante', 'error');
      await onRefresh();
    }
  }

  async function salvar() {
    if (!nome.trim()) return showToast('Informe o nome da tarefa', 'error');
    setSaving(true);
    const { error } = await supabase.rpc('atualizar_matriz_tarefa', {
      p_tarefa_id: tarefa.id,
      p_nome:      nome.trim(),
      p_descricao: descricao.trim(),
      p_data:      data,
    });
    setSaving(false);
    if (error) return showToast(error.message || 'Erro ao salvar', 'error');
    showToast('Tarefa atualizada', 'success');
    onSalvo();
  }

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
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-black text-gray-100">Editar tarefa</h3>
          <button onClick={onClose} className="neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Nome</label>
            <input
              type="text" value={nome} onChange={e => setNome(e.target.value)}
              className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Data</label>
            <input
              type="date" value={data} onChange={e => setData(e.target.value)}
              className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Descrição (opcional)</label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={2}
            className="neu-input py-2 px-3 text-sm rounded-lg text-gray-100 resize-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              Participantes ({partByFuncId.size} nesta tarefa)
            </label>
            <div className="flex items-center gap-1 neu-pressed rounded-lg p-0.5">
              {(['todas', ...CENTRAL_OP_FILIAIS] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFiltroFilial(f as any)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded transition-all ${
                    filtroFilial === f ? 'neu-button text-accent' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {f === 'todas' ? 'Todas' : f}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-gray-500">
            Marcar/desmarcar aplica na hora. Ao remover, as notas do conselho pra essa pessoa somem do placar.
          </p>

          {loadingFn ? (
            <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-accent" /></div>
          ) : funcionariosFiltrados.length === 0 ? (
            <p className="text-xs text-gray-500 italic py-3 text-center">Nenhum funcionário disponível.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto neu-pressed rounded-xl p-2 flex flex-col gap-1">
              {funcionariosFiltrados.map(f => {
                const marcado = partByFuncId.has(f.id);
                const tone = CENTRAL_FILIAL_TONE[f.filial as FilialOp] ?? 'bg-gray-500/20 text-gray-300';
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      marcado ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <input
                      type="checkbox" checked={marcado}
                      onChange={e => toggle(f, e.target.checked)}
                      className="accent-current"
                    />
                    <span className="text-xs text-gray-200 flex-1 truncate">{f.nome}</span>
                    {f.cargo && <span className="text-[10px] text-gray-500 hidden sm:inline">{f.cargo}</span>}
                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${tone}`}>{f.filial}</span>
                    {marcado && <Check size={12} className="text-accent" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <button onClick={onClose} disabled={saving}
            className="text-xs font-bold px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-gray-200">
            Fechar
          </button>
          <button onClick={salvar} disabled={saving || !nome.trim()}
            className="text-xs font-bold px-4 py-2 rounded-lg neu-button text-accent ring-1 ring-accent/40 hover:ring-accent flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={12} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Modal MaxAI Briefing ─────────────────────────────────────────────
// Chama /api/ai-briefing-tarefa com a tarefa selecionada. IA devolve
// até 6 sugestões (uma por tipo restante). Admin/CEO aprova uma-a-uma;
// cada aprovação chama criar_matriz_tarefa com p_origem='briefing_ia'.
// Não persiste as sugestões — descarte é implícito (fechar sem aprovar).
type Sugestao = {
  tipo: TipoTarefa;
  nome: string;
  descricao: string;
  justificativa: string;
};

function ModalBriefingIa({ tarefa, competicao, onClose, onAprovada, showToast }: {
  tarefa: Tarefa;
  competicao: Competicao;
  onClose: () => void;
  onAprovada: () => void;
  showToast: any;
}) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [aprovadas, setAprovadas] = useState<Set<string>>(new Set());
  const [aprovando, setAprovando] = useState<string | null>(null);
  const [modelo, setModelo] = useState<string | null>(null);

  useEffect(() => {
    let cancelou = false;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
        const resp = await fetch('/api/ai-briefing-tarefa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ tarefa_id: tarefa.id }),
        });
        const data = await resp.json();
        if (cancelou) return;
        if (!resp.ok) {
          setErro(data?.error ?? 'Falha na IA.');
          setLoading(false);
          return;
        }
        setSugestoes(data.sugestoes ?? []);
        setModelo(data.modelo_ia ?? null);
      } catch (err: any) {
        if (!cancelou) setErro(err?.message ?? 'Falha na IA.');
      } finally {
        if (!cancelou) setLoading(false);
      }
    })();
    return () => { cancelou = true; };
  }, [tarefa.id]);

  const aprovar = async (s: Sugestao) => {
    setAprovando(s.tipo);
    const { error } = await supabase.rpc('criar_matriz_tarefa', {
      p_competicao_id: competicao.id,
      p_tipo:          s.tipo,
      p_nome:          s.nome,
      p_descricao:     s.descricao,
      p_data:          todayBR(),
      p_participantes: [],
      p_origem:        'briefing_ia',
    });
    setAprovando(null);
    if (error) return showToast(error.message || 'Erro ao aprovar sugestão', 'error');
    setAprovadas(prev => { const n = new Set(prev); n.add(s.tipo); return n; });
    showToast(`Tarefa criada em ${TIPO_BY_ID.get(s.tipo)?.label ?? s.tipo}`, 'success');
    onAprovada();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-purple-400/25 p-5 w-full max-w-2xl max-h-[90vh] flex flex-col gap-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center ring-1 ring-purple-500/30 shrink-0">
              <Sparkles size={16} className="text-purple-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black uppercase tracking-widest text-purple-200">MaxAI Briefing</h3>
              <p className="text-[11px] text-gray-400 truncate">Sub-tarefas sugeridas para apoiar: <span className="text-gray-200 font-bold">{tarefa.nome}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 size={24} className="animate-spin text-purple-300" />
              <p className="text-[11px] text-gray-400">IA analisando a tarefa e propondo sub-tarefas nos outros 6 tipos…</p>
            </div>
          )}

          {!loading && erro && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
              {erro}
            </div>
          )}

          {!loading && !erro && sugestoes.length === 0 && (
            <EmptyState message="IA não retornou sugestões desta vez. Feche e tente novamente." />
          )}

          {!loading && !erro && sugestoes.map(s => {
            const cfg = TIPO_BY_ID.get(s.tipo);
            const Icon = cfg?.icon ?? Sparkles;
            const jaAprovada = aprovadas.has(s.tipo);
            const emAndamento = aprovando === s.tipo;
            return (
              <div key={s.tipo} className={`neu-pressed rounded-xl p-3 flex flex-col gap-2 border ${jaAprovada ? 'border-emerald-500/40 opacity-70' : 'border-white/5'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ring-1 ${cfg?.iconRing ?? 'ring-gray-500/30'} ${cfg?.iconBg ?? 'bg-gray-500/10'}`}>
                    <Icon size={13} className={cfg?.iconColor ?? 'text-gray-300'} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{cfg?.label ?? s.tipo}</span>
                </div>
                <p className="text-sm font-bold text-gray-100 leading-snug">{s.nome}</p>
                {s.descricao && <p className="text-xs text-gray-400 leading-snug">{s.descricao}</p>}
                {s.justificativa && (
                  <p className="text-[11px] text-purple-200/80 italic leading-snug border-l-2 border-purple-400/40 pl-2">
                    {s.justificativa}
                  </p>
                )}
                <div className="flex items-center justify-end pt-1">
                  {jaAprovada ? (
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300 flex items-center gap-1">
                      <Check size={11} /> Criada
                    </span>
                  ) : (
                    <button onClick={() => aprovar(s)} disabled={emAndamento}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg neu-button text-emerald-300 ring-1 ring-emerald-500/30 hover:ring-emerald-500 flex items-center gap-1.5 disabled:opacity-50">
                      {emAndamento ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      Aprovar e criar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {modelo && (
          <p className="text-[9px] text-gray-500 font-mono text-center">Modelo: {modelo}</p>
        )}
      </motion.div>
    </motion.div>
  );
}
