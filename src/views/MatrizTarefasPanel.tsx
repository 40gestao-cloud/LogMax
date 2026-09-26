import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  GraduationCap, Cpu, Presentation, Handshake, Plus, X, Trash2, Loader2,
  Star, MessageSquare, ChevronRight, ChevronDown, ArrowLeft, Check, Users,
  UserCircle, Megaphone, DollarSign, Package, Pencil, Lock, Unlock, Sparkles,
  EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { LoadingSpinner, EmptyState, CardContador, FilialBadge, NeuButtonAccent } from '../components/ui';
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
  // Ladrilho do ícone em cor cheia (landing e cabeçalho do tipo).
  solido: string;
  novoLabel: string;
};

const TIPOS: TipoConfig[] = [
  {
    id: 'tarefa_apresentacao',
    label: 'Apresentação Profissional',
    hint: 'Criar pauta de apresentação, selecionar participantes e nota 0-10 do conselho.',
    icon: Presentation,
    glow: 'bg-amber-500/25', iconBg: 'bg-amber-500/10', iconRing: 'ring-amber-500/25', iconColor: 'text-amber-300',
    solido: 'bg-amber-500 text-black',
    novoLabel: 'Nova apresentação',
  },
  {
    id: 'tarefa_treinamento_ia',
    label: 'Desenvolvimento com IA',
    hint: 'Criar atividade de Desenvolvimento com IA, participantes por filial, nota 0-10 do conselho.',
    icon: Cpu,
    glow: 'bg-orange-500/25', iconBg: 'bg-orange-500/10', iconRing: 'ring-orange-500/25', iconColor: 'text-orange-400',
    solido: 'bg-orange-600 text-white',
    novoLabel: 'Nova atividade de Desenvolvimento com IA',
  },
  {
    id: 'tarefa_rh',
    label: 'Recursos Humanos',
    hint: 'Criar atividade de RH, definir participantes por filial e nota 0-10 do conselho.',
    icon: UserCircle,
    glow: 'bg-sky-500/25', iconBg: 'bg-sky-500/10', iconRing: 'ring-sky-500/25', iconColor: 'text-sky-400',
    solido: 'bg-sky-600 text-white',
    novoLabel: 'Nova atividade de Recursos Humanos',
  },
  {
    id: 'tarefa_financeiro',
    label: 'Financeiro',
    hint: 'Criar atividade Financeira, participantes por filial e nota 0-10 do conselho.',
    icon: DollarSign,
    glow: 'bg-rose-500/25', iconBg: 'bg-rose-500/10', iconRing: 'ring-rose-500/25', iconColor: 'text-rose-400',
    solido: 'bg-rose-600 text-white',
    novoLabel: 'Nova atividade de Financeiro',
  },
  {
    id: 'tarefa_logistica',
    label: 'Logística',
    hint: 'Criar atividade de Logística, participantes por filial e nota 0-10 do conselho.',
    icon: Package,
    glow: 'bg-emerald-500/25', iconBg: 'bg-emerald-500/10', iconRing: 'ring-emerald-500/25', iconColor: 'text-emerald-400',
    solido: 'bg-emerald-600 text-white',
    novoLabel: 'Nova atividade de Logística',
  },
  {
    id: 'tarefa_marketing',
    label: 'Marketing',
    hint: 'Criar atividade de Marketing, participantes por filial e nota 0-10 do conselho.',
    icon: Megaphone,
    glow: 'bg-pink-500/25', iconBg: 'bg-pink-500/10', iconRing: 'ring-pink-500/25', iconColor: 'text-pink-400',
    solido: 'bg-pink-600 text-white',
    novoLabel: 'Nova atividade de Marketing',
  },
  {
    id: 'tarefa_treinamento_vendas',
    label: 'Vendas e Atendimento',
    hint: 'Criar atividade, definir participantes por filial e nota 0-10 do conselho.',
    icon: Handshake,
    glow: 'bg-blue-500/25', iconBg: 'bg-blue-500/10', iconRing: 'ring-blue-500/25', iconColor: 'text-blue-400',
    solido: 'bg-blue-600 text-white',
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
  // rascunho = criada, ainda não aceita nota (migr. 345)
  status: 'rascunho' | 'aberta' | 'encerrada';
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
export function MatrizTarefasPanel({ competicao, profile, podeAvaliar, ehAvaliador, emAndamento, showToast, extras }: {
  competicao: Competicao;
  profile: UserProfile;
  // Pode escrever nota agora (papel de avaliador + competição em andamento).
  podeAvaliar: boolean;
  // É avaliador por papel (CEO/conselheiro), independente do estado da
  // competição. É esta régua que sela o voto — não a de escrita: com a
  // competição fechada o conselheiro continua sem poder ver nota alheia.
  ehAvaliador: boolean;
  // Competição em 'em_andamento'. Fora disso as RPCs de criar tarefa,
  // liberar e avaliar recusam — os botões correspondentes somem.
  emAndamento: boolean;
  showToast: any;
  // Cards extras da landing (Avaliação das Filiais, Visão do Ciclo). Ficam
  // ao lado dos tipos de tarefa e somem quando se entra numa tarefa — o
  // avaliador vê só o que está avaliando.
  extras?: React.ReactNode;
}) {
  const [tipoAtivo, setTipoAtivo] = useState<TipoTarefa | null>(null);

  if (tipoAtivo === null) {
    return (
      <LandingTipos
        onSelect={setTipoAtivo}
        competicao={competicao}
        extras={extras}
        minhaId={profile.id}
        podeAvaliar={podeAvaliar}
      />
    );
  }

  return (
    <PainelTipoTarefa
      key={tipoAtivo}
      tipoConfig={TIPO_BY_ID.get(tipoAtivo)!}
      competicao={competicao}
      profile={profile}
      podeAvaliar={podeAvaliar}
      ehAvaliador={ehAvaliador}
      emAndamento={emAndamento}
      showToast={showToast}
      onVoltar={() => setTipoAtivo(null)}
    />
  );
}

// ── Landing: cards por tipo de tarefa ────────────────────────────────
function LandingTipos({ onSelect, competicao, extras, minhaId, podeAvaliar }: {
  onSelect: (t: TipoTarefa) => void;
  competicao: Competicao;
  extras?: React.ReactNode;
  minhaId: string;
  podeAvaliar: boolean;
}) {
  const zerado = (): Record<TipoTarefa, number> => ({
    tarefa_treinamento_vendas: 0,
    tarefa_treinamento_ia: 0,
    tarefa_apresentacao: 0,
    tarefa_rh: 0,
    tarefa_marketing: 0,
    tarefa_financeiro: 0,
    tarefa_logistica: 0,
  });
  const [contadores, setContadores] = useState<Record<TipoTarefa, number>>(zerado);
  // Participantes de tarefa ABERTA que ainda não têm a MINHA nota. É o que
  // responde "o que falta eu avaliar" sem entrar tipo por tipo.
  const [pendentes, setPendentes] = useState<Record<TipoTarefa, number>>(zerado);
  const [loading, setLoading] = useState(true);
  // Quem do conselho já votou nesta competição. Vem da RPC
  // `progresso_avaliacao_matriz` (migr. 345), que devolve só a CONTAGEM de
  // notas por avaliador — nunca o valor. Contar pela tabela devolveria
  // número truncado, porque o voto fica selado até a tarefa encerrar.
  const [progresso, setProgresso] = useState<{ avaliador_id: string; nome: string; role: string; notas_dadas: number }[]>([]);
  const [totalParticipantesAbertos, setTotalParticipantesAbertos] = useState(0);
  const [porStatus, setPorStatus] = useState({ rascunho: 0, aberta: 0, encerrada: 0 });

  useEffect(() => {
    (async () => {
      setLoading(true);
      supabase.rpc('progresso_avaliacao_matriz', { p_competicao_id: competicao.id })
        .then(({ data, error }) => { if (!error) setProgresso((data ?? []) as any); });
      const { data: tarefas } = await supabase
        .from('matriz_tarefas')
        .select('id, tipo, status')
        .eq('competicao_id', competicao.id)
        .eq('ativo', true);

      const contagens: Record<string, number> = {};
      (tarefas ?? []).forEach((r: any) => { contagens[r.tipo] = (contagens[r.tipo] ?? 0) + 1; });
      const porTipo = zerado();
      (Object.keys(porTipo) as TipoTarefa[]).forEach(k => { porTipo[k] = contagens[k] ?? 0; });
      setContadores(porTipo);
      const st = { rascunho: 0, aberta: 0, encerrada: 0 };
      (tarefas ?? []).forEach((t: any) => { if (t.status in st) st[t.status as keyof typeof st] += 1; });
      setPorStatus(st);

      // Pendência só conta tarefa liberada: rascunho ainda não aceita nota.
      const abertas = (tarefas ?? []).filter((t: any) => t.status === 'aberta');
      // Denominador do progresso do conselho: participante de tarefa que já
      // aceitou nota alguma vez (aberta ou encerrada) — rascunho fica fora,
      // ninguém podia ter votado nele.
      const votaveis = (tarefas ?? []).filter((t: any) => t.status !== 'rascunho');
      if (votaveis.length === 0) {
        setPendentes(zerado());
        setTotalParticipantesAbertos(0);
        setLoading(false);
        return;
      }

      const tipoPorTarefa = new Map<string, TipoTarefa>();
      abertas.forEach((t: any) => tipoPorTarefa.set(t.id, t.tipo));

      const [{ data: todosParts }, { data: minhas }] = await Promise.all([
        supabase.from('matriz_tarefa_participantes')
          .select('id, tarefa_id, funcionario_id')
          .in('tarefa_id', votaveis.map((t: any) => t.id))
          .eq('ativo', true),
        podeAvaliar
          ? supabase.from('avaliacoes_matriz')
              .select('item_id, nota')
              .eq('competicao_id', competicao.id)
              .eq('avaliador_id', minhaId)
              .eq('ativo', true)
              .not('nota', 'is', null)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // Desligado nao gera pendencia nem entra no denominador do progresso:
      // a RPC recusa nota nele (migr. 364), entao contar seria prometer um
      // contador que o conselheiro nunca consegue zerar.
      const funcIdsLanding = (todosParts ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
      // Guarda o `.in()` com lista vazia: tarefa liberada sem participante
      // existe (o gestor libera e escala depois) e viraria `id=in.()`.
      const { data: deslLanding } = funcIdsLanding.length > 0
        ? await supabase.from('funcionarios').select('id')
            .in('id', funcIdsLanding).eq('status', 'Desligado')
        : { data: [] as any[] };
      const deslSet = new Set((deslLanding ?? []).map((d: any) => d.id));
      const partsValidos = (todosParts ?? []).filter(
        (p: any) => !(p.funcionario_id && deslSet.has(p.funcionario_id)),
      );

      setTotalParticipantesAbertos(partsValidos.length);

      const jaNotei = new Set((minhas ?? []).map((a: any) => a.item_id));
      const falta = zerado();
      if (podeAvaliar) {
        partsValidos.forEach((p: any) => {
          if (jaNotei.has(p.id)) return;
          const tipo = tipoPorTarefa.get(p.tarefa_id);   // só tarefas abertas
          if (tipo) falta[tipo] += 1;
        });
      }
      setPendentes(falta);
      setLoading(false);
    })();
  }, [competicao.id, minhaId, podeAvaliar]);

  const totalPendente = (Object.values(pendentes) as number[]).reduce((s, n) => s + n, 0);
  const totalTarefas = (Object.values(contadores) as number[]).reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardContador label="Tarefas" value={loading ? '…' : totalTarefas} tom="laranja" />
        <CardContador label="Em avaliação" value={loading ? '…' : porStatus.aberta} tom="verde" />
        <CardContador label="Participantes" value={loading ? '…' : totalParticipantesAbertos} tom="azul" />
        {podeAvaliar ? (
          <CardContador label="Sem sua nota" value={loading ? '…' : totalPendente} tom="amarelo" />
        ) : (
          <CardContador label="Encerradas" value={loading ? '…' : porStatus.encerrada} tom="roxo" />
        )}
      </div>

      {/* Só a CONTAGEM de notas por avaliador — o valor segue selado até a
          tarefa encerrar (RPC progresso_avaliacao_matriz, migr. 345). */}
      {!loading && progresso.length > 0 && totalParticipantesAbertos > 0 && (
        <div className="neu-flat rounded-2xl border border-white/5 p-4 flex flex-col gap-3">
          <h4 className="text-sm font-bold text-gray-200 flex items-center gap-2"
            title="Quantidade de notas dadas. O valor de cada nota segue selado até a tarefa encerrar.">
            <Users size={14} className="text-accent" /> Progresso do conselho
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-3">
            {progresso.map(p => {
              const pct = Math.min(100, Math.round((p.notas_dadas / totalParticipantesAbertos) * 100));
              const completo = p.notas_dadas >= totalParticipantesAbertos;
              return (
                <div key={p.avaliador_id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-200 flex-1 truncate">{p.nome ?? 'Conselheiro'}</span>
                    <span className={`font-black tabular-nums ${completo ? 'text-green-400' : 'text-amber-400'}`}>
                      {p.notas_dadas}/{totalParticipantesAbertos}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${completo ? 'bg-green-500' : 'bg-amber-500'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <SecaoTitulo>Tarefas por área</SecaoTitulo>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {TIPOS.map(t => {
            const Icon = t.icon;
            const n = contadores[t.id];
            const falta = podeAvaliar ? pendentes[t.id] : 0;
            return (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                className={`group neu-flat rounded-2xl p-4 text-left border transition-colors flex items-center gap-3 ${
                  falta > 0 ? 'border-amber-500/40 hover:border-amber-400' : 'border-white/5 hover:border-accent/40'}`}
              >
                <span className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${t.solido} ${n === 0 ? 'opacity-50' : ''}`}>
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-black text-gray-100 leading-tight truncate">{t.label}</span>
                  <span className="text-[11px] text-gray-500 tabular-nums flex items-center gap-1.5">
                    {loading ? <Loader2 size={11} className="animate-spin" /> : (n === 0 ? 'Nenhuma tarefa' : `${n} tarefa${n === 1 ? '' : 's'}`)}
                    {!loading && falta > 0 && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-yellow-400 text-black">{falta} sem sua nota</span>
                    )}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-gray-600 group-hover:text-accent transition-colors" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Painéis que não são tarefa — faixa separada pra não competir com os
          cards de tipo, que é onde o avaliador entra no dia a dia. */}
      {extras && (
        <div className="flex flex-col gap-3">
          <SecaoTitulo>Painéis consolidados</SecaoTitulo>
          {extras}
        </div>
      )}
    </div>
  );
}

function SecaoTitulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500 shrink-0">{children}</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

// ── Painel de um tipo: lista + criar + avaliar participantes ─────────
function PainelTipoTarefa({ tipoConfig, competicao, profile, podeAvaliar, ehAvaliador, emAndamento, showToast, onVoltar }: {
  tipoConfig: TipoConfig;
  competicao: Competicao;
  profile: UserProfile;
  podeAvaliar: boolean;
  ehAvaliador: boolean;
  emAndamento: boolean;
  showToast: any;
  onVoltar: () => void;
}) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoParticipante[]>([]);
  // funcionario_id de quem foi desligado depois de entrar na tarefa.
  const [desligados, setDesligados] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editandoTarefa, setEditandoTarefa] = useState<Tarefa | null>(null);
  const [briefingTarefa, setBriefingTarefa] = useState<Tarefa | null>(null);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  // Participante aberto no modal de avaliação (nota + comentário + exclusão).
  const [avaliando, setAvaliando] = useState<{ participante: Participante; tarefa: Tarefa } | null>(null);
  const confirm = useConfirm();

  // Criar exige competição em andamento — `criar_matriz_tarefa` recusa fora
  // disso, e botão que só devolve erro não é botão.
  const ehGestorMatriz = profile.role === 'admin' || profile.role === 'ceo';
  const ehConselheiroCriador = profile.role === 'conselheiro'
    || (profile.role === 'gerente' && (profile as any).is_conselheiro === true);
  const podeCriar = (ehGestorMatriz || ehConselheiroCriador) && emAndamento;

  // comMask=false nos refetches do realtime: trocar a lista inteira por um
  // spinner a cada nota salva por outro conselheiro é pior que não atualizar.
  const carregar = useCallback(async (comMask = true) => {
    if (comMask) setLoading(true);
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

    // Quem já estava na tarefa e foi desligado depois. A lista de
    // participantes é snapshot do dia da criação — ninguém sai dela pela
    // rescisão —, então a marcação precisa vir de fora. A barreira real é
    // a RPC (migr. 364); aqui é só pra não oferecer um botão que falha.
    const funcIds = (ps ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
    if (funcIds.length > 0) {
      const { data: desl } = await supabase
        .from('funcionarios')
        .select('id')
        .in('id', funcIds)
        .eq('status', 'Desligado');
      setDesligados(new Set((desl ?? []).map((d: any) => d.id)));
    } else {
      setDesligados(new Set());
    }

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

  // Realtime: era a única tela do módulo sem canal. Sem isso, encerrar uma
  // tarefa (que revela as notas seladas) ou um participante entrando pela
  // sessão do admin só apareciam com F5.
  useEffect(() => {
    return assinarRealtime({
      nome: `matriz-tarefas-${competicao.id}-${tipoConfig.id}`,
      alvos: [
        { tabela: 'matriz_tarefas', filtro: `competicao_id=eq.${competicao.id}` },
        'matriz_tarefa_participantes',
        { tabela: 'avaliacoes_matriz', filtro: `competicao_id=eq.${competicao.id}` },
      ],
      aoMudar: () => carregar(false),
    });
  }, [competicao.id, tipoConfig.id, carregar]);

  const participantesPorTarefa = useMemo(() => {
    const m: Record<string, Participante[]> = {};
    for (const p of participantes) {
      (m[p.tarefa_id] ??= []).push(p);
    }
    return m;
  }, [participantes]);

  // Próximo participante da MESMA tarefa que ainda não tem minha nota, na
  // ordem em que a tela mostra (SuperMax → MaxLook → TechMax). Alimenta o
  // "Salvar e próximo" — sem isso é fechar modal, caçar o próximo, clicar.
  const proximoSemMinhaNota = useCallback((tarefaId: string, atualId: string): Participante | null => {
    const daTarefa = CENTRAL_OP_FILIAIS.flatMap(f =>
      participantes.filter(p => p.tarefa_id === tarefaId && p.filial === f),
    );
    const idx = daTarefa.findIndex(p => p.id === atualId);
    const depois = idx >= 0 ? [...daTarefa.slice(idx + 1), ...daTarefa.slice(0, idx)] : daTarefa;
    return depois.find(p =>
      !(p.funcionario_id && desligados.has(p.funcionario_id))
      && !avaliacoes.some(a => a.item_id === p.id && a.avaliador_id === profile.id && a.nota != null),
    ) ?? null;
  }, [participantes, avaliacoes, desligados, profile.id]);

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
    carregar(false);
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
    carregar(false);
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
    return true;
  }

  async function liberarTarefa(tarefa: Tarefa) {
    if (!await confirm({
      message: `Permitir notas em "${tarefa.nome}"? O conselho recebe aviso no sino e passa a poder avaliar. Antes disso ninguém consegue dar nota.`,
      confirmLabel: 'Permitir notas',
    })) return;
    const { error } = await supabase.rpc('liberar_matriz_tarefa', { p_tarefa_id: tarefa.id });
    if (error) return showToast(error.message || 'Erro ao liberar', 'error');
    showToast('Notas liberadas — conselho avisado', 'success');
    carregar(false);
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  }

  async function encerrarTarefa(tarefa: Tarefa) {
    if (!await confirm({
      message: `Encerrar "${tarefa.nome}"? Notas continuam contando no placar, mas ninguém poderá mais alterar nota, adicionar/remover participante ou editar a tarefa. Você pode reabrir depois.`,
      confirmLabel: 'Encerrar',
    })) return;
    const { error } = await supabase.rpc('encerrar_matriz_tarefa', { p_tarefa_id: tarefa.id });
    if (error) return showToast(error.message || 'Erro ao encerrar', 'error');
    showToast('Tarefa encerrada', 'success');
    carregar(false);
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
    carregar(false);
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
    carregar(false);
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  }

  const Icon = tipoConfig.icon;

  return (
    <section className="flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onVoltar} title="Voltar às áreas"
            className="shrink-0 w-9 h-9 rounded-xl neu-button flex items-center justify-center text-gray-400 hover:text-accent">
            <ArrowLeft size={16} />
          </button>
          <span className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${tipoConfig.solido}`}>
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="text-xl font-black text-gray-100 leading-tight">{tipoConfig.label}</h3>
            <span className="text-xs text-gray-500">
              {tarefas.length} tarefa{tarefas.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        {podeCriar && (
          <NeuButtonAccent variant="" onClick={() => setModalOpen(true)} title={tipoConfig.novoLabel}>
            <Plus size={14} /> Nova tarefa
          </NeuButtonAccent>
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
              ehAvaliador={ehAvaliador}
              podeGerenciar={ehGestorMatriz}
              // Conselheiro gerencia a tarefa que ele mesmo criou (liberar,
              // editar, participantes; remover só enquanto rascunho). É o que
              // a migr. 348 abriu no banco — antes ele criava e a tarefa
              // ficava encalhada esperando admin/CEO.
              souCriador={ehConselheiroCriador && t.criado_por === profile.id}
              emAndamento={emAndamento}
              desligados={desligados}
              minhaId={profile.id}
              onAbrirAvaliacao={p => setAvaliando({ participante: p, tarefa: t })}
              onRemover={() => removerTarefa(t.id)}
              onEditar={() => setEditandoTarefa(t)}
              onEncerrar={() => encerrarTarefa(t)}
              onReabrir={() => reabrirTarefa(t)}
              onLiberar={() => liberarTarefa(t)}
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
          onCriada={() => { setModalOpen(false); carregar(false); }}
          showToast={showToast}
        />
      )}

      {editandoTarefa && (
        <ModalEditarTarefa
          tipoConfig={tipoConfig}
          tarefa={tarefas.find(t => t.id === editandoTarefa.id) ?? editandoTarefa}
          participantes={participantesPorTarefa[editandoTarefa.id] ?? []}
          onClose={() => setEditandoTarefa(null)}
          onSalvo={() => { setEditandoTarefa(null); carregar(false); }}
          onRefresh={() => carregar(false)}
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
          ehAvaliador={ehAvaliador}
          emAndamento={emAndamento}
          desligado={!!avaliando.participante.funcionario_id && desligados.has(avaliando.participante.funcionario_id)}
          proximo={proximoSemMinhaNota(avaliando.tarefa.id, avaliando.participante.id)}
          onIrPara={p => setAvaliando({ participante: p, tarefa: avaliando.tarefa })}
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
          onAprovada={() => { carregar(false); window.dispatchEvent(new Event('avaliacao-matriz:changed')); }}
          showToast={showToast}
        />
      )}
    </section>
  );
}

// Cor de cada unidade — a mesma do FilialBadge (index.css). Pinta o círculo
// de iniciais e a barra de progresso da coluna.
const FILIAL_COR: Record<FilialOp, { bg: string; texto: string }> = {
  SuperMax: { bg: '#2563eb', texto: '#fff' },
  MaxLook:  { bg: '#c9a882', texto: '#1c1917' },
  TechMax:  { bg: '#ea580c', texto: '#fff' },
};

const iniciais = (nome: string) => {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (partes[0][0] + ultima).toUpperCase();
};

// Quem já tem nota, pela régua de quem olha: o conselheiro enxerga só a
// própria (voto selado), o admin e a tarefa encerrada enxergam a do conselho.
const temNota = (avals: AvaliacaoParticipante[], minhaId: string, revelado: boolean) =>
  revelado
    ? avals.some(a => a.avaliador?.role !== 'admin' && a.nota != null)
    : avals.some(a => a.avaliador_id === minhaId && a.nota != null);

// ── Card de uma tarefa com lista de participantes votáveis ───────────
function TarefaCard({ tarefa, tipoConfig, participantes, avalsPorParticipante, submittingIds, podeAvaliar, ehAvaliador, podeGerenciar, souCriador, emAndamento, desligados, minhaId, onAbrirAvaliacao, onRemover, onEditar, onEncerrar, onReabrir, onLiberar, onBriefingIa }: {
  tarefa: Tarefa;
  tipoConfig: TipoConfig;
  participantes: Participante[];
  avalsPorParticipante: Record<string, AvaliacaoParticipante[]>;
  submittingIds: Set<string>;
  podeAvaliar: boolean;
  ehAvaliador: boolean;
  // admin/CEO da Matriz: gestão completa da tarefa.
  podeGerenciar: boolean;
  // conselheiro que criou ESTA tarefa: gestão parcial (migr. 348).
  souCriador: boolean;
  emAndamento: boolean;
  // funcionario_id desligado depois de entrar na tarefa (migr. 364).
  desligados: Set<string>;
  minhaId: string;
  onAbrirAvaliacao: (p: Participante) => void;
  onRemover: () => void;
  onEditar: () => void;
  onEncerrar: () => void;
  onReabrir: () => void;
  onLiberar: () => void;
  onBriefingIa: () => void;
}) {
  const porFilial = useMemo(() => {
    const m: Record<FilialOp, Participante[]> = { SuperMax: [], MaxLook: [], TechMax: [] };
    for (const p of participantes) m[p.filial]?.push(p);
    return m;
  }, [participantes]);
  const encerrada = tarefa.status === 'encerrada';
  const rascunho  = tarefa.status === 'rascunho';
  // Voto selado: nota alheia só aparece com a tarefa encerrada. A RLS da
  // migr. 345 garante isso no banco — aqui é só não exibir número parcial
  // como se fosse a média do conselho. Admin não vota e vê sempre.
  // Régua é o PAPEL (ehAvaliador), não a permissão de escrita: com a
  // competição fora de 'em_andamento' o conselheiro perde o direito de
  // escrever, mas a nota dele continua selada — usar `podeAvaliar` aqui
  // faria a tela exibir uma "média do conselho" feita da própria nota.
  const revelado = !ehAvaliador || encerrada;
  // Descrição fica em 2 linhas até o conselheiro clicar. Pauta longa empurrava
  // a grade de participantes pra fora da tela quando havia várias tarefas.
  const [expandido, setExpandido] = useState(false);

  const status = encerrada
    ? { label: 'Encerrada', cls: 'bg-zinc-600 text-white', icon: <Lock size={10} /> }
    : rascunho
      ? { label: 'Notas bloqueadas', cls: 'bg-yellow-400 text-black', icon: <Lock size={10} /> }
      : { label: 'Em avaliação', cls: 'bg-green-600 text-white', icon: <Unlock size={10} /> };

  return (
    <div className={`neu-flat rounded-2xl border overflow-hidden flex flex-col ${encerrada ? 'border-white/5' : 'border-white/10'}`}>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded flex items-center gap-1 ${status.cls}`}>
                {status.icon} {status.label}
              </span>
              <span className="tabular-nums">{new Date(tarefa.data + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
              <span>· {participantes.length} participante{participantes.length === 1 ? '' : 's'}</span>
            </div>
            <h4 className="text-lg font-black text-gray-100 leading-snug">{tarefa.nome}</h4>
          </div>
          {(podeGerenciar || souCriador) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Liberar exige competição em andamento (migr. 348): fora dela
                  a tarefa abriria pra um conselho que não consegue votar. */}
              {rascunho && emAndamento && (
                <button onClick={onLiberar} className="btn-solido btn-solido--verde" title="Liberar para o conselho dar nota — avisa no sino">
                  <Unlock size={13} /> Permitir notas
                </button>
              )}
              {!encerrada && podeGerenciar && (
                <button onClick={onBriefingIa} className="btn-solido btn-solido--roxo" title="MaxAI sugere sub-tarefas nos outros tipos para apoiar esta">
                  <Sparkles size={13} /> MaxAI
                </button>
              )}
              {/* Encerrar/reabrir seguem admin/CEO: encerrar é o gesto que
                  revela o voto selado — quem avalia não controla isso. */}
              {!encerrada && podeGerenciar && (
                <button onClick={onEncerrar} className="btn-solido btn-solido--amarelo" title="Encerrar e revelar as notas">
                  <Lock size={13} /> Encerrar
                </button>
              )}
              {encerrada && podeGerenciar && (
                <button onClick={onReabrir} className="btn-solido btn-solido--amarelo" title="Reabrir tarefa">
                  <Unlock size={13} /> Reabrir
                </button>
              )}
              {!encerrada && (
                <button onClick={onEditar} className="action-btn-edit" title="Editar tarefa">
                  <Pencil size={12} />
                </button>
              )}
              {(podeGerenciar || rascunho) && (
                <button onClick={onRemover} className="action-btn-delete" title="Remover tarefa">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>
        {/* Descrição em 2 linhas até o clique: pauta longa empurrava a grade
            de participantes pra fora da tela quando havia várias tarefas. */}
        {tarefa.descricao && (
          <button type="button" onClick={() => setExpandido(v => !v)}
            title={expandido ? 'Recolher' : 'Ler a descrição inteira'}
            className="group text-left flex items-start gap-1.5">
            <p className={`text-[13px] text-gray-400 leading-relaxed whitespace-pre-wrap flex-1 ${expandido ? '' : 'line-clamp-2'}`}>
              {tarefa.descricao}
            </p>
            <ChevronDown size={14} className={`shrink-0 mt-0.5 text-gray-500 group-hover:text-accent transition-transform ${expandido ? 'rotate-180 text-accent' : ''}`} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 border-t border-white/5 md:divide-x divide-white/5">
        {CENTRAL_OP_FILIAIS.map(f => {
          const lista = porFilial[f];
          return (
            <div key={f} className="p-3 flex flex-col gap-1.5 border-b md:border-b-0 border-white/5 last:border-b-0">
              {(() => {
                const feitos = lista.filter(p => temNota(avalsPorParticipante[p.id] ?? [], minhaId, revelado)).length;
                const pct = lista.length > 0 ? Math.round((feitos / lista.length) * 100) : 0;
                return (
                  <div className="flex flex-col gap-2 pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <FilialBadge filial={f} />
                      <span className="text-[11px] text-gray-500 tabular-nums"
                        title={revelado ? 'Participantes com nota do conselho' : 'Participantes com a sua nota'}>
                        <b className="text-gray-200">{feitos}</b>/{lista.length} com nota
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: FILIAL_COR[f].bg }} />
                    </div>
                  </div>
                );
              })()}
              {lista.length === 0 ? (
                <span className="text-xs text-gray-600 py-1.5">Sem participantes</span>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {lista.map(p => (
                    <ParticipanteRow
                      key={p.id}
                      participante={p}
                      avals={avalsPorParticipante[p.id] ?? []}
                      minhaId={minhaId}
                      desligado={!!p.funcionario_id && desligados.has(p.funcionario_id)}
                      podeAvaliar={podeAvaliar && !encerrada && !rascunho}
                      revelado={revelado}
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

function ParticipanteRow({ participante, avals, minhaId, desligado, podeAvaliar, revelado, submitting, onAbrir }: {
  participante: Participante;
  avals: AvaliacaoParticipante[];
  minhaId: string;
  // Saiu da filial depois de escalado: a nota dele nao conta mais no placar
  // e a RPC recusa nota nova (migr. 364).
  desligado: boolean;
  podeAvaliar: boolean;
  // Notas alheias já podem ser mostradas? (tarefa encerrada, ou admin)
  revelado: boolean;
  submitting: boolean;
  onAbrir: () => void;
}) {
  const minha = avals.find(a => a.avaliador_id === minhaId);
  // Notas de admin não entram na média — admin é moderador aqui.
  const notas = avals
    .filter(a => a.avaliador?.role !== 'admin' && a.nota !== null && a.nota !== undefined)
    .map(a => Number(a.nota));
  const media = notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
  const cor = FILIAL_COR[participante.filial] ?? { bg: '#52525b', texto: '#fff' };

  // Sem nota não escreve nada: o vazio já diz. Só aparece o que existe —
  // a nota (sua, ou a média revelada), o cadeado do voto selado, o desligado.
  let fim: React.ReactNode = null;
  if (submitting) fim = <Loader2 size={14} className="animate-spin text-accent" />;
  else if (desligado) fim = <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-red-600 text-white">Desligado</span>;
  else if (revelado && media !== null) fim = (
    <span className="text-sm font-black text-amber-400 tabular-nums" title={`${notas.length} nota${notas.length === 1 ? '' : 's'} do conselho`}>
      {media.toFixed(1)}
    </span>
  );
  else if (minha?.nota != null) fim = (
    <span className="text-[11px] font-black px-1.5 py-0.5 rounded btn-solido--dourado tabular-nums" title="Sua nota (as demais seguem seladas)">
      {Number(minha.nota).toFixed(1)}
    </span>
  );
  else if (!revelado) fim = <EyeOff size={13} className="text-gray-700" aria-label="Nota selada" />;
  else if (podeAvaliar) fim = <Star size={14} className="text-gray-700 group-hover:text-amber-400 transition-colors" />;

  return (
    <button
      onClick={onAbrir}
      disabled={submitting}
      title={participante.nome_snapshot}
      className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg hover:bg-white/5 text-left group disabled:opacity-60"
    >
      <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${desligado ? 'opacity-40' : ''}`}
        style={{ background: cor.bg, color: cor.texto }}>
        {iniciais(participante.nome_snapshot)}
      </span>
      <span className={`text-sm flex-1 min-w-0 truncate ${desligado ? 'text-gray-500 line-through' : 'text-gray-200 group-hover:text-white'}`}>
        {participante.nome_snapshot}
      </span>
      {minha?.comentario && <MessageSquare size={12} className="text-accent shrink-0" aria-label="Você comentou" />}
      <span className="shrink-0 min-w-[1.75rem] flex justify-end">{fim}</span>
    </button>
  );
}

// ── Modal de avaliação de um participante ────────────────────────────
// Nota e comentário salvam JUNTOS num único UPSERT. A RPC faz
// `nota = EXCLUDED.nota, comentario = EXCLUDED.comentario`, então mandar
// os dois de uma vez é o que impede um campo apagar o outro.
function ModalAvaliarParticipante({ participante, tarefa, avals, minhaId, podeAvaliar, ehAvaliador, emAndamento, desligado, proximo, onFechar, onSalvar, onExcluir, onIrPara }: {
  participante: Participante;
  tarefa: Tarefa;
  avals: AvaliacaoParticipante[];
  minhaId: string;
  podeAvaliar: boolean;
  ehAvaliador: boolean;
  emAndamento: boolean;
  // Desligado depois de escalado: a RPC recusa nota (migr. 364), então o
  // form some e o motivo aparece no lugar.
  desligado: boolean;
  // Próximo participante da tarefa ainda sem a minha nota (ordem da tela).
  proximo: Participante | null;
  onFechar: () => void;
  onSalvar: (patch: { nota: number | null; comentario: string | null }) => Promise<boolean>;
  onExcluir: () => Promise<boolean>;
  onIrPara: (p: Participante) => void;
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
  // Voto selado: nota alheia só depois da tarefa encerrada (a RLS da
  // migr. 345 já esconde no banco — aqui é a mesma régua na tela). Vale o
  // papel, não a permissão de escrita: ver TarefaCard.
  const revelado = !ehAvaliador || tarefa.status === 'encerrada';

  async function salvar(seguirParaProximo = false) {
    const bruto = nota.trim();
    const n = bruto === '' ? null : Number(bruto);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10)) {
      return setErro('Nota precisa ser um número entre 0 e 10.');
    }
    const c = comentario.trim() === '' ? null : comentario.trim();
    if (n === null && c === null) {
      return setErro('Preencha a nota ou o comentário. Pra apagar tudo, use "Excluir minha avaliação".');
    }
    // Nota extrema move muito a média da filial com um voto só — pede uma
    // linha de justificativa. No meio da escala segue opcional.
    if (n !== null && (n <= 3 || n >= 9) && c === null) {
      return setErro(`Nota ${n.toFixed(1).replace('.0', '')} pesa muito na média da filial — escreva uma linha justificando.`);
    }
    setErro(null);
    setSalvando(true);
    const ok = await onSalvar({ nota: n, comentario: c });
    setSalvando(false);
    if (!ok) return;
    if (seguirParaProximo && proximo) onIrPara(proximo);
    else onFechar();
  }

  async function excluir() {
    if (!await confirm({
      // Em desligado a frase padrão mentiria: a nota dele já saiu da média
      // na migr. 364, então excluir não mexe em placar nenhum.
      message: desligado
        ? `Excluir sua avaliação de ${participante.nome_snapshot}? Ele está desligado, então a nota já não entra no placar — isto só apaga o registro.`
        : `Excluir sua avaliação de ${participante.nome_snapshot}? A nota sai da média da filial no placar.`,
      confirmLabel: 'Excluir avaliação',
      danger: true,
    })) return;
    setExcluindo(true);
    const ok = await onExcluir();
    setExcluindo(false);
    if (ok) onFechar();
  }

  const cor = FILIAL_COR[participante.filial] ?? { bg: '#52525b', texto: '#fff' };
  const notaNum = nota.trim() === '' ? null : Number(nota);

  // Faixa única para os estados em que não se dá nota: um ícone e uma frase.
  const Faixa = ({ tom, icon, children }: { tom: 'amarelo' | 'vermelho' | 'neutro'; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className={`rounded-xl px-3 py-2.5 flex items-center gap-2.5 text-xs ${
      tom === 'amarelo' ? 'bg-yellow-400/10 text-yellow-200 border border-yellow-400/25'
      : tom === 'vermelho' ? 'bg-red-600/10 text-red-200 border border-red-500/25'
      : 'bg-white/[0.04] text-gray-400 border border-white/5'}`}>
      <span className="shrink-0">{icon}</span>
      <span className="leading-snug">{children}</span>
    </div>
  );

  const botaoExcluir = minha && podeAvaliar && (
    <button onClick={excluir} disabled={excluindo || salvando} className="btn-solido btn-solido--vermelho">
      {excluindo ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      Excluir minha nota
    </button>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onFechar}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-3xl border border-white/10 w-full max-w-lg my-6 flex flex-col overflow-hidden"
        style={{ background: 'var(--color-bg-base)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho: quem é, de onde, em qual tarefa — e a nota em destaque. */}
        <div className="p-5 flex items-center gap-4 border-b border-white/5">
          <span className="w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-lg font-black"
            style={{ background: cor.bg, color: cor.texto }}>
            {iniciais(participante.nome_snapshot)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-black text-gray-100 leading-tight truncate">{participante.nome_snapshot}</h3>
            <div className="flex items-center gap-x-2 gap-y-1 mt-1 flex-wrap">
              <FilialBadge filial={participante.filial} />
              <span className="text-xs text-gray-500">{tarefa.nome}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {revelado ? (
              media !== null ? (
                <>
                  <div className="text-3xl font-black tabular-nums leading-none text-amber-400">{media.toFixed(1)}</div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mt-1">
                    {notas.length} nota{notas.length === 1 ? '' : 's'}
                  </div>
                </>
              ) : (
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded bg-zinc-700 text-gray-300">Sem nota</span>
              )
            ) : (
              <div className="flex flex-col items-end gap-1 text-gray-500" title="As notas dos outros conselheiros aparecem quando a tarefa for encerrada.">
                <EyeOff size={22} />
                <span className="text-[10px] uppercase tracking-widest font-bold">Selada</span>
              </div>
            )}
          </div>
          <button onClick={onFechar} className="shrink-0 modal-close-btn self-start" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* `!desligado` primeiro: sem isso o form de nota ganharia do ramo
              de desligado abaixo, e o conselheiro digitaria uma nota que a
              RPC recusa (migr. 364). */}
          {podeAvaliar && !desligado ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Sua nota</span>
                  <input
                    type="number" min={0} max={10} step={0.5}
                    value={nota}
                    onChange={e => { setNota(e.target.value); setErro(null); }}
                    placeholder="—"
                    aria-label="Nota com meio ponto"
                    title="Para meio ponto, digite aqui (ex.: 7,5)"
                    className="neu-input w-20 py-1.5 px-2 text-center text-base font-black rounded-lg text-gray-100"
                  />
                </div>
                <div className="grid grid-cols-11 gap-1">
                  {Array.from({ length: 11 }, (_, i) => i).map(i => {
                    const ativo = notaNum !== null && Math.floor(notaNum) === i;
                    return (
                      <button key={i} type="button" onClick={() => { setNota(String(i)); setErro(null); }}
                        className={`h-9 rounded-lg text-sm font-black tabular-nums transition-colors ${
                          ativo ? 'btn-solido--dourado' : 'neu-pressed text-gray-400 hover:text-gray-100'}`}>
                        {i}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-gray-600 px-0.5">
                  <span>0 não entregou</span><span>5 o combinado</span><span>8 superou</span><span>10 referência</span>
                </div>
              </div>

              <textarea
                value={comentario}
                onChange={e => { setComentario(e.target.value); setErro(null); }}
                rows={3}
                placeholder="Comentário (opcional) — só o conselho lê"
                className="neu-input w-full py-2.5 px-3 text-sm rounded-xl text-gray-100 resize-none"
              />

              {erro && <Faixa tom="vermelho" icon={<X size={13} />}>{erro}</Faixa>}

              <div className="flex items-center gap-2 flex-wrap">
                {botaoExcluir}
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={() => salvar(false)} disabled={salvando || excluindo} className="btn-solido btn-solido--verde">
                    {salvando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {minha ? 'Atualizar' : 'Salvar'}
                  </button>
                  {proximo && (
                    <button onClick={() => salvar(true)} disabled={salvando || excluindo}
                      title={`Salvar e abrir ${proximo.nome_snapshot}`} className="btn-solido btn-solido--dourado">
                      Salvar e próximo <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : desligado ? (
            <>
              <Faixa tom="vermelho" icon={<Lock size={13} />}>
                Desligado — não recebe mais nota. As notas que já tinha saíram do placar da filial.
              </Faixa>
              {/* Bloquear nota NOVA não pode bloquear desfazer a que já existe:
                  `remover_avaliacao_matriz` não recusa desligado. */}
              {botaoExcluir && <div>{botaoExcluir}</div>}
            </>
          ) : tarefa.status === 'rascunho' ? (
            <Faixa tom="amarelo" icon={<Lock size={13} />}>
              Notas ainda bloqueadas — falta clicar em "Permitir notas" na tarefa.
            </Faixa>
          ) : !emAndamento && tarefa.status !== 'encerrada' ? (
            <Faixa tom="amarelo" icon={<Lock size={13} />}>
              A competição não aceita mais nota. O que já foi dado continua valendo.
            </Faixa>
          ) : tarefa.status === 'encerrada' ? (
            <Faixa tom="neutro" icon={<Lock size={13} />}>Tarefa encerrada — notas congeladas.</Faixa>
          ) : (
            <Faixa tom="neutro" icon={<EyeOff size={13} />}>Você acompanha — quem dá nota é o CEO e o conselho.</Faixa>
          )}

          {revelado && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
                Avaliações do conselho · {outras.length + (minha ? 1 : 0)}
              </span>
              {outras.length === 0 && !minha ? (
                <div className="rounded-xl border border-dashed border-white/10 py-5 flex flex-col items-center gap-1.5 text-gray-600">
                  <Star size={18} />
                  <span className="text-xs">Ninguém avaliou ainda</span>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/5 overflow-hidden">
                  {minha && <LinhaAvaliacao aval={minha} sou />}
                  {outras.map(a => <LinhaAvaliacao key={a.id} aval={a} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function LinhaAvaliacao({ aval, sou }: { aval: AvaliacaoParticipante; sou?: boolean }) {
  const nome = aval.avaliador?.nome ?? 'Avaliador';
  const foraDaMedia = aval.avaliador?.role === 'admin';
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="w-8 h-8 shrink-0 rounded-full bg-zinc-700 text-gray-200 flex items-center justify-center text-[10px] font-black">
        {iniciais(nome)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-200">
          {nome}{sou && <span className="text-accent"> · você</span>}
          {foraDaMedia && <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold ml-1.5">fora da média</span>}
        </div>
        {aval.comentario && <p className="text-xs text-gray-400 break-words mt-0.5">{aval.comentario}</p>}
      </div>
      <span className={`shrink-0 text-sm font-black tabular-nums px-2 py-0.5 rounded ${
        aval.nota != null ? (foraDaMedia ? 'bg-zinc-700 text-gray-300' : 'bg-amber-500 text-black') : 'text-gray-600'}`}>
        {aval.nota != null ? Number(aval.nota).toFixed(1) : '—'}
      </span>
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
        .select('id,nome,filial,cargo,ativo,status')
        .in('filial', CENTRAL_OP_FILIAIS as unknown as string[])
        .eq('ativo', true)
        // `ativo` NÃO cai no desligamento — a rescisão seta status='Desligado'
        // e deixa ativo=true. Sem este filtro o desligado continuava
        // aparecendo pra ser escalado em tarefa nova (migr. 364).
        .neq('status', 'Desligado')
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
          <button onClick={onClose} className="modal-close-btn">
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
        .select('id,nome,filial,cargo,ativo,status')
        .in('filial', CENTRAL_OP_FILIAIS as unknown as string[])
        .eq('ativo', true)
        // `ativo` NÃO cai no desligamento — a rescisão seta status='Desligado'
        // e deixa ativo=true. Sem este filtro o desligado continuava
        // aparecendo pra ser escalado em tarefa nova (migr. 364).
        .neq('status', 'Desligado')
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
          <button onClick={onClose} className="modal-close-btn">
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
          <button onClick={onClose} className="shrink-0 modal-close-btn">
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
