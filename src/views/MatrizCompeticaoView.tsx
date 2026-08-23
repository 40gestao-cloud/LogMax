import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Calendar, Sparkles, Loader2, Plus, Award, ThumbsUp, ThumbsDown, MessageCircle, X, Crown, StopCircle, Pencil, Trash2, FileDown, Presentation, Star, Users, Unlock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { freshToken } from '../lib/authFetch';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FormField, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { isConselheiro } from '../lib/rbac';
import { BotaoWhatsApp } from '../components/BotaoWhatsApp';
import { montarMensagemWhats } from '../lib/whatsappShare';
import type { UserProfile } from '../hooks/useUserProfile';
import { exportCompeticaoResultadoPDF } from '../lib/competicaoPdf';
import { ordenarRanking } from '../lib/competicaoRanking';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_COLOR: Record<FilialOp, string> = {
  SuperMax: 'text-sky-400',
  MaxLook:  'text-amber-300',
  TechMax:  'text-orange-400',
};

type Competicao = {
  id: string;
  nome: string;
  descricao: string | null;
  data_inicio: string;
  data_fim: string;
  status: 'em_andamento'|'aguardando_encerramento'|'encerrada';
  vencedora: string | null;
  analise_ia: string | null;
  placar_snapshot: any | null;
  created_at: string;
  // Migr. 372: corte do mandato. Voto anterior a isto é da rodada passada.
  reaberta_em: string | null;
  declaracao_justificativa: string | null;
};

type CompeticaoStatus = Competicao['status'];

// Rótulo e cor do estado da competição, em um lugar só: o chip do placar, a
// lista de Configuração e o PDF diziam a mesma coisa em três ternários
// separados, e o do placar tinha só dois braços para três estados.
const STATUS_LABEL: Record<CompeticaoStatus, string> = {
  em_andamento:            'Em andamento',
  aguardando_encerramento: 'Aguardando encerramento',
  encerrada:               'Encerrada',
};

const STATUS_CHIP_CLASSE: Record<CompeticaoStatus, string> = {
  em_andamento:            'btn-shimmer--glass-green',
  aguardando_encerramento: 'btn-shimmer--glass-yellow',
  encerrada:               'btn-shimmer--glass-gray',
};

type Voto = {
  id: string;
  competicao_id: string;
  votante_id: string;
  voto: 'aceita' | 'rejeita';
  filial_escolhida: string | null;
  comentario: string | null;
  created_at: string;
  // `created_at` não se move ao trocar o voto; `votado_em` sim (trigger da 372).
  votado_em: string | null;
};

type Avaliador = {
  id: string;
  nome: string | null;
  role: string | null;
  is_conselheiro: boolean | null;
};

type ProgressoAvaliador = {
  avaliador_id: string;
  nome: string | null;
  role: string | null;
  notas_dadas: number;
};

type NotaConselho = {
  id: string;
  item_tipo: string | null;
  avaliador_id: string;
  filial_avaliada: string | null;
  nota: number | null;
  avaliador?: { nome: string | null; role: string | null } | null;
};

type Placar = {
  competicao: any;
  por_filial: Record<string, {
    media: number;
    n: number;
    // Migr. 375: o placar passou a medir ITEM (participante, ou o eixo da
    // filial), não nota solta — `n` continua sendo a contagem de notas.
    itens?: number;
    // Migr. 349: a nota final passou a misturar o julgamento do conselho com
    // a frequência medida no ponto. `media` é o resultado; estes dois campos
    // mostram de onde ele veio.
    media_conselho?: number;
    frequencia?: {
      taxa: number | null; registros: number; presencas: number;
      faltas: number; justificados: number; atrasos?: number; entrou: boolean;
      // Migr. 374/376: cobertura do lançamento. `esperado` é o universo de
      // pessoa-dia (com calendário da turma, dias letivos × gente ativa);
      // `ausencias` é o que não foi lançado — e, com calendário, já entrou
      // como falta. Ausentes em snapshot anterior à 374.
      dias_distintos?: number; funcionarios_ativos?: number;
      dias_letivos?: number; esperado?: number; ausencias?: number; calendario?: boolean;
    } | null;
  }>;
  inclui_eixos_conselho?: boolean;
  peso_frequencia?: number;
  media_por_item?: boolean;
  // Migr. 376: com calendário da turma, dia letivo sem lançamento vira falta.
  calendario_turma?: boolean;
  // Migr. 350: false enquanto o horário da turma não for confirmado em
  // `ponto_jornada` — nesse estado o atraso não desconta.
  atraso_conta?: boolean;
  jornada_entrada?: string | null;
};

// Snapshots antigos (pré-migração 227) tinham forma { placar: { total_por_filial } }
// — este helper normaliza pra podium consistente na aba Histórico.
function podiumFromSnapshot(snap: any): { filial: string; total: number }[] {
  if (!snap) return [];
  // Formato novo
  if (snap.por_filial) {
    return OP_FILIAIS
      .map(f => ({ filial: f as string, total: Number(snap.por_filial?.[f]?.media ?? 0) }))
      .sort((a, b) => b.total - a.total);
  }
  // Formato legado
  const totais = snap.placar?.total_por_filial ?? {};
  return OP_FILIAIS
    .map(f => ({ filial: f as string, total: Number(totais[f] ?? 0) }))
    .sort((a, b) => b.total - a.total);
}

type Tab = 'config' | 'placar' | 'historico';
const fmtDataBR = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

const isoToday   = () => new Date().toISOString().slice(0, 10);
const isoIn = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };

export function MatrizCompeticaoView({ showToast, profile, navigate }: { showToast: any; profile: UserProfile; navigate?: (view: string) => void }) {
  const confirm = useConfirm();
  const podeGerenciar = profile.role === 'admin' || profile.role === 'ceo';
  // Votação restrita a CEO + conselheiros (alinha com RLS voto_write).
  // Admin gerencia e não vota — exceto para desfazer empate, e é ele quem
  // declara a vencedora (migr. 369).
  const podeVotar     = profile.role === 'ceo' || isConselheiro(profile);
  const podeAcessar   = podeGerenciar || isConselheiro(profile);
  // Só admin lê nota individual alheia enquanto a tarefa não encerra
  // (migr. 345). Pro conselho, esta tela mostra participação, não valores.
  const vejoNotaAlheia = profile.role === 'admin';

  const [tab, setTab] = useState<Tab>('placar');
  // Id da competição encerrada aberta para análise (leitura). Guardado como id
  // e não como objeto pra não congelar uma linha velha: a lista recarrega
  // depois de reabrir/declarar e o estado tem de acompanhar.
  const [analiseId, setAnaliseId] = useState<string | null>(null);
  const [competicoes, setCompeticoes] = useState<Competicao[]>([]);
  const [placar, setPlacar] = useState<Placar | null>(null);
  const [competicaoAtual, setCompeticaoAtual] = useState<Competicao | null>(null);
  // Estado vigente vem da LINHA, não do placar. Para quem não é da Matriz o
  // placar é o snapshot congelado na declaração (migr. 373) — e até a 391 ele
  // guardava o instante anterior a ela, dizendo "aguardando encerramento" de
  // uma competição com vencedora na tela. A linha nunca mente sobre isso.
  const statusVigente = competicaoAtual?.status ?? placar?.competicao.status ?? null;
  const [votos, setVotos] = useState<Voto[]>([]);
  // Quem deu nota (e qual) na competição atual + quem ainda não deu.
  // Notas individuais só rodam dentro da Matriz — a RLS de avaliacoes_matriz
  // (migr. 234) já barra filial; aqui só quem é admin/CEO/conselheiro entra.
  const [notasConselho, setNotasConselho] = useState<NotaConselho[]>([]);
  const [avaliadores, setAvaliadores] = useState<Avaliador[]>([]);
  const [progresso, setProgresso] = useState<ProgressoAvaliador[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPlacar, setLoadingPlacar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [gerandoAnalise, setGerandoAnalise] = useState(false);
  const [votando, setVotando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [encerrandoAgora, setEncerrandoAgora] = useState(false);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [editando, setEditando] = useState<Competicao | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [formEdit, setFormEdit] = useState({ nome: '', descricao: '', data_inicio: '', data_fim: '' });
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const [modalParabens, setModalParabens] = useState<string | null>(null);
  // Filial escolhida que ainda precisa de justificativa — por contrariar o
  // resultado (372) ou por a avaliação estar incompleta (375).
  const [escolhaDeclaracao, setEscolhaDeclaracao] = useState<FilialOp | null>(null);
  const [justificativa, setJustificativa] = useState('');
  // Voto selado (375): o conselho não enxerga mais o voto alheio antes da
  // declaração, então quórum vem de RPC que não revela valor nenhum.
  const [progressoVoto, setProgressoVoto] = useState<
    { votos: number; eleitores: number; quorum: number; ja_votei: boolean } | null
  >(null);
  // Participantes de tarefa liberada sem nota de todo o conselho (375).
  const [semNota, setSemNota] = useState<number>(0);
  const [editandoVoto, setEditandoVoto] = useState(false);
  // Total de eleitores elegíveis (CEO + conselheiros da Matriz). Alimenta
  // o quórum dinâmico (maioria simples). RPC contar_votantes_matriz.
  const [totalVotantes, setTotalVotantes] = useState<number>(0);
  // `totalVotantes === 0` é ambíguo: pode ser "sem eleitores" ou "ainda não
  // respondeu". Enquanto não carrega, o quórum calculado daria 1 e o bloco
  // de declarar vencedora apareceria com um voto só — e o banco não tem
  // segunda barreira, exige apenas 1 voto.
  const [votantesCarregados, setVotantesCarregados] = useState(false);

  // Voto em elaboração
  const [meuVoto, setMeuVoto] = useState<'aceita' | 'rejeita' | ''>('');
  const [comentario, setComentario] = useState('');
  const [filialSugerida, setFilialSugerida] = useState<FilialOp | ''>('');
  const [meuVotoAtual, setMeuVotoAtual] = useState<Voto | null>(null);

  // Form da nova competição
  const [form, setForm] = useState({
    nome: '',
    descricao: '',
    data_inicio: isoToday(),
    data_fim: isoIn(90),
  });

  const ativa = useMemo(() => competicoes.find(c => c.status === 'em_andamento') ?? null, [competicoes]);
  const aguardando = useMemo(() => competicoes.filter(c => c.status === 'aguardando_encerramento'), [competicoes]);
  // Competição encerrada aberta em LEITURA. Existe porque ver as notas de uma
  // competição declarada só era possível reabrindo ela — e reabrir joga tudo
  // de volta pra votação, anula os votos da rodada e apaga o placar congelado.
  // Conferir resultado não pode custar o resultado.
  const emAnalise = useMemo(
    // O filtro por 'encerrada' é o que faz a análise se desfazer sozinha: se
    // o admin reabrir a competição que está sendo analisada, ela deixa de
    // casar aqui e a tela volta a seguir a competição viva.
    () => (analiseId ? competicoes.find(c => c.id === analiseId && c.status === 'encerrada') ?? null : null),
    [analiseId, competicoes],
  );

  const carregarLista = useCallback(async () => {
    if (!supabase) return;
    setLoadingList(true);
    const { data } = await supabase
      .from('competicoes_matriz')
      .select('id, nome, descricao, data_inicio, data_fim, status, vencedora, analise_ia, placar_snapshot, created_at, reaberta_em, declaracao_justificativa')
      .eq('ativo', true)
      .order('created_at', { ascending: false });
    setCompeticoes(data ?? []);
    setLoadingList(false);
  }, []);

  useEffect(() => { if (podeAcessar) carregarLista(); }, [podeAcessar, carregarLista]);

  // Quórum dinâmico: pega o total de eleitores elegíveis. Se a RPC não
  // existir (migração 212 não aplicada ainda), cai em 3 como fallback.
  useEffect(() => {
    if (!podeAcessar || !supabase) return;
    (async () => {
      const { data, error } = await supabase.rpc('contar_votantes_matriz');
      if (!error && typeof data === 'number') setTotalVotantes(data);
      else setTotalVotantes(3);
      setVotantesCarregados(true);
    })();
  }, [podeAcessar]);

  // CEO + conselheiros da Matriz — pra listar também quem ainda não avaliou.
  useEffect(() => {
    if (!podeAcessar || !supabase) return;
    (async () => {
      // Desligado fora do eleitorado (migr. 369): ele nunca vota, e como o
      // empate exige que TODOS votem, uma vaga morta impediria o desempate
      // para sempre. Tem de casar com `contar_votantes_matriz`.
      const { data } = await supabase
        .from('user_profiles')
        .select('id, nome, role, is_conselheiro, desligado_em')
        .eq('filial', 'Matriz')
        .is('desligado_em', null)
        .order('nome', { ascending: true });
      setAvaliadores((data ?? []).filter((u: Avaliador) =>
        u.role === 'ceo' || u.role === 'conselheiro' || (u.role === 'gerente' && u.is_conselheiro === true),
      ));
    })();
  }, [podeAcessar]);

  // Maioria simples é MAIS da metade, não a metade. `ceil(n/2)` acerta em
  // número ímpar e erra em par: com 4 eleitores dava 2, e 2×2 é empate —
  // liberava declarar vencedora sem maioria nenhuma.
  // A conta oficial vem da RPC (375), que usa a mesma régua de
  // `declarar_vencedora`. O cálculo local fica de fallback enquanto ela não
  // responde.
  const quorumMinimo = useMemo(
    () => progressoVoto?.quorum ?? Math.floor((totalVotantes || 1) / 2) + 1,
    [progressoVoto, totalVotantes],
  );

  const carregarVotos = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('competicao_votos')
      .select('id, competicao_id, votante_id, voto, filial_escolhida, comentario, created_at, votado_em')
      .eq('competicao_id', id)
      .order('created_at', { ascending: true });
    setVotos(data ?? []);
  }, []);

  // Participação de cada eleitor (quantas notas deu), via RPC — o voto é
  // selado até a tarefa encerrar (migr. 345), então contar as notas dos
  // outros pela tabela devolveria número truncado. A RPC não expõe valor
  // nenhum, só a contagem.
  const carregarProgresso = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('progresso_avaliacao_matriz', { p_competicao_id: id });
    if (!error) setProgresso((data ?? []) as ProgressoAvaliador[]);
  }, []);

  // Quantos votaram (sem dizer em quê) e quantos participantes ainda estão
  // sem nota de todo o conselho. As duas RPCs são da Matriz.
  const carregarFecho = useCallback(async (id: string) => {
    if (!supabase) return;
    const [{ data: pv }, { data: sn }] = await Promise.all([
      supabase.rpc('progresso_votacao_competicao', { p_competicao_id: id }),
      supabase.rpc('participantes_sem_nota_competicao', { p_competicao_id: id }),
    ]);
    if (pv) setProgressoVoto(pv as any);
    setSemNota(typeof sn === 'number' ? sn : 0);
  }, []);

  // Notas individuais — só chegam completas pro admin (RLS da 345). Pro
  // conselho vêm só as próprias, por isso a média por avaliador fica
  // restrita a admin lá embaixo.
  const carregarNotasConselho = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('avaliacoes_matriz')
      .select('id, item_tipo, avaliador_id, filial_avaliada, nota, avaliador:user_profiles!avaliador_id(nome,role)')
      .eq('competicao_id', id)
      .eq('ativo', true)
      .not('nota', 'is', null);
    // Só notas de tarefa entram no placar (calcular_placar_competicao filtra
    // `item_tipo LIKE 'tarefa_%'`). Notas de arte/promoção/campanha existem na
    // mesma tabela e NÃO pesam — misturá-las aqui daria um número que não bate
    // com o pódio. Filtro no cliente pra não depender do escape de LIKE.
    setNotasConselho(((data ?? []) as any as NotaConselho[])
      .filter(n => (n.item_tipo ?? '').startsWith('tarefa_')));
  }, []);

  const carregarPlacar = useCallback(async (comp: Competicao) => {
    if (!supabase) return;
    setCompeticaoAtual(prev => {
      // Só ativa o loading + limpa o pódio quando muda de competição — refresh
      // da mesma competição (nova tarefa, nota, voto) troca a data em placa
      // pelo dado novo sem piscar.
      const mudouComp = prev?.id !== comp.id;
      if (mudouComp) {
        setPlacar(null);
        setLoadingPlacar(true);
      }
      return comp;
    });
    // Competição declarada mostra o placar CONGELADO, não um recálculo. O
    // snapshot é a saída desta mesma RPC gravada na declaração (372); recalcular
    // faria o resultado publicado mudar sozinho se uma nota fosse mexida — ou
    // se a régua do cálculo evoluísse, como na 375. A filial já recebe o
    // snapshot pelo próprio banco (373); aqui a Matriz passa a ver o mesmo.
    if (comp.status === 'encerrada' && comp.placar_snapshot?.por_filial) {
      setPlacar(comp.placar_snapshot as Placar);
    } else {
      const { data, error } = await supabase.rpc('calcular_placar_competicao', { p_competicao_id: comp.id });
      if (error) {
        showToast?.(`Erro ao calcular placar: ${error.message}`, 'error');
      } else {
        setPlacar(data as Placar);
      }
    }
    await carregarVotos(comp.id);
    await carregarNotasConselho(comp.id);
    await carregarProgresso(comp.id);
    await carregarFecho(comp.id);
    setLoadingPlacar(false);
  }, [showToast, carregarVotos, carregarNotasConselho, carregarProgresso, carregarFecho]);

  useEffect(() => {
    // O Placar é da competição VIVA: em andamento ou em votação. Declarada a
    // vencedora, a aba esvazia e o resultado passa a morar no Histórico —
    // antes ela seguia exibindo a competição encerrada como se fosse a
    // corrente, e quem abria o módulo não distinguia o que acabou do que
    // está correndo.
    // ...a não ser que o admin tenha aberto uma encerrada para análise: aí ela
    // ocupa o Placar em leitura, com o snapshot congelado, até ele sair.
    const alvo = emAnalise ?? ativa ?? aguardando[0] ?? null;
    if (alvo) carregarPlacar(alvo);
    else { setPlacar(null); setCompeticaoAtual(null); }
  }, [emAnalise, ativa, aguardando, carregarPlacar]);

  // Central de Avaliação altera notas de eixos/tarefas → refaz o placar sem F5.
  // Especialmente crítico após 240: gate `v_incluir_eixos` pode virar true/false.
  useEffect(() => {
    const h = () => { if (competicaoAtual) carregarPlacar(competicaoAtual); };
    window.addEventListener('avaliacao-matriz:changed', h);
    return () => window.removeEventListener('avaliacao-matriz:changed', h);
  }, [competicaoAtual, carregarPlacar]);

  // O evento acima é `window`: só alcança quem mexeu, na própria aba. Quando
  // um conselheiro apaga a nota dele na máquina dele, quem está com o Placar
  // aberto em outra sessão continuava vendo o número velho até dar F5 — o
  // placar não tinha canal nenhum. `avaliacoes_matriz` já está na publicação
  // realtime, e o soft-delete de nota é um UPDATE, então o DELETE lógico
  // chega aqui como '*'. A RLS de voto selado (345) vale no realtime também:
  // conselheiro só recebe evento da própria linha, admin recebe tudo.
  // Debounce: o conselho avalia em rajada (um participante atrás do outro), e
  // `calcular_placar_competicao` varre ponto_eletronico + avaliações a cada
  // chamada. Sem isto, 20 notas seguidas viram 20 recálculos.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!supabase || !competicaoAtual) return;
    const id = competicaoAtual.id;
    const agendar = () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        carregarPlacar(competicaoAtual);
      }, 500);
    };
    const canal = supabase
      .channel(`placar-competicao-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'avaliacoes_matriz', filter: `competicao_id=eq.${id}` }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matriz_tarefas', filter: `competicao_id=eq.${id}` }, agendar)
      .subscribe();
    return () => {
      if (refetchTimer.current !== null) { clearTimeout(refetchTimer.current); refetchTimer.current = null; }
      supabase!.removeChannel(canal);
    };
  }, [competicaoAtual, carregarPlacar]);

  // Quem já avaliou × média que deu por filial. Nota de admin aparece
  // marcada — ela não pesa no placar (regra da migr. 240).
  // Contagem vem da RPC (não vaza valor). Médias por filial só existem pro
  // admin, que é o único com leitura completa depois do voto selado.
  const porAvaliador = useMemo(() => {
    const m = new Map<string, {
      id: string; nome: string; role: string | null; total: number;
      porFilial: Record<string, { soma: number; n: number }>;
    }>();
    const garantir = (id: string, nome: string | null, role: string | null) => {
      let e = m.get(id);
      if (!e) {
        e = { id, nome: nome ?? 'Sem nome', role, total: 0, porFilial: {} };
        m.set(id, e);
      } else if (e.nome === 'Sem nome' && nome) {
        e.nome = nome;
      }
      return e;
    };
    avaliadores.forEach(a => garantir(a.id, a.nome, a.role));
    progresso.forEach(p => {
      const e = garantir(p.avaliador_id, p.nome, p.role);
      e.total = p.notas_dadas;
    });
    if (vejoNotaAlheia) {
      notasConselho.forEach(n => {
        const e = garantir(n.avaliador_id, n.avaliador?.nome ?? null, n.avaliador?.role ?? null);
        const f = n.filial_avaliada ?? '—';
        const acc = (e.porFilial[f] ??= { soma: 0, n: 0 });
        acc.soma += Number(n.nota);
        acc.n += 1;
      });
    }
    return [...m.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  }, [avaliadores, notasConselho, progresso, vejoNotaAlheia]);

  // Reabrir descarta o mandato (migr. 372): o voto descrevia um placar que
  // não existe mais. Ele continua listado como registro da rodada anterior,
  // mas fora de quórum, contagem e empate — igualzinho ao que o banco faz em
  // `_competicao_votos_validos`.
  const votosValidos = useMemo(() => {
    const corte = competicaoAtual?.reaberta_em;
    if (!corte) return votos;
    return votos.filter(v => (v.votado_em ?? v.created_at) >= corte);
  }, [votos, competicaoAtual]);

  // O próprio voto a RLS sempre entrega, então isto continua valendo mesmo
  // com o voto alheio selado.
  const jaVotei = useMemo(
    () => votosValidos.some(v => v.votante_id === profile.id),
    [votosValidos, profile.id],
  );

  // Voto alheio só chega pro admin, ou pra todo o conselho depois da
  // declaração (RLS da 375). Sem isto a tela mostraria "Aceita: 1" pra quem
  // só enxerga o próprio voto, o que é pior que não mostrar nada.
  const vejoVotoAlheio = profile.role === 'admin' || competicaoAtual?.status === 'encerrada';
  const votosNoQuorum = progressoVoto?.votos ?? votosValidos.length;
  const contagemVotos = useMemo(() => ({
    aceita:  votosValidos.filter(v => v.voto === 'aceita').length,
    rejeita: votosValidos.filter(v => v.voto === 'rejeita').length,
  }), [votosValidos]);

  // Empate é medido só entre os votos do conselho — o desempate do admin
  // não pode se anular (migr. 369). Com eleitorado par (hoje 1 CEO + 3
  // conselheiros) o 2×2 é possível, e é aí que a Administração entra.
  const empate = useMemo(() => {
    const doConselho = votosValidos.filter(v => avaliadores.some(a => a.id === v.votante_id));
    if (doConselho.length === 0 || doConselho.length !== totalVotantes) return false;
    const aceita  = doConselho.filter(v => v.voto === 'aceita').length;
    const rejeita = doConselho.filter(v => v.voto === 'rejeita').length;
    return aceita === rejeita;
  }, [votosValidos, avaliadores, totalVotantes]);

  const podeDesempatar = profile.role === 'admin' && empate;

  // Sincroniza o voto que o usuário já registrou (pra permitir editar).
  useEffect(() => {
    const meu = votosValidos.find(v => v.votante_id === profile.id) ?? null;
    setMeuVotoAtual(meu);
    if (meu && editandoVoto) {
      setMeuVoto(meu.voto);
      setComentario(meu.comentario ?? '');
      setFilialSugerida((meu.filial_escolhida as FilialOp) ?? '');
    }
  }, [votosValidos, profile.id, editandoVoto]);

  // Sugestão de vencedora quando conselho rejeita o placar automático:
  // filial mais votada nos "rejeita → filial_escolhida". Empate ou sem
  // rejeição → mantém o 1º do pódio.
  const sugestaoRejeicao = useMemo(() => {
    if (contagemVotos.rejeita <= contagemVotos.aceita) return null;
    const contagem: Record<string, number> = {};
    votosValidos.forEach(v => {
      if (v.voto === 'rejeita' && v.filial_escolhida) {
        contagem[v.filial_escolhida] = (contagem[v.filial_escolhida] ?? 0) + 1;
      }
    });
    const entries = Object.entries(contagem);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length > 1 && entries[0][1] === entries[1][1]) return null;
    return entries[0][0] as FilialOp;
  }, [votosValidos, contagemVotos]);

  const gerarAnalise = async () => {
    if (!competicaoAtual) return;
    const jwt = await freshToken();
    if (!jwt) { showToast?.('Sessão expirada.', 'error'); return; }
    setGerandoAnalise(true);
    try {
      const resp = await fetch('/api/ai-competicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ competicao_id: competicaoAtual.id }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showToast?.(data?.error ?? 'Falha na IA.', 'error');
      } else {
        showToast?.(data.from_cache ? 'Análise recuperada do cache.' : 'Análise gerada!', 'success');
        await carregarLista();
      }
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro de rede.', 'error');
    }
    setGerandoAnalise(false);
  };

  const registrarVoto = async () => {
    if (!competicaoAtual || !supabase || !meuVoto) return;
    if (meuVoto === 'rejeita' && !filialSugerida) {
      return showToast?.('Ao rejeitar, indique qual filial você acha vencedora.', 'error');
    }
    setVotando(true);
    // UPSERT: se conselheiro já votou, atualiza o próprio voto
    // (RLS voto_update libera enquanto status='aguardando_encerramento').
    const { error } = await supabase.from('competicao_votos').upsert({
      competicao_id: competicaoAtual.id,
      votante_id:    profile.id,
      voto:          meuVoto,
      filial_escolhida: meuVoto === 'rejeita' ? filialSugerida : null,
      comentario:    comentario.trim() || null,
    }, { onConflict: 'competicao_id,votante_id' });
    setVotando(false);
    if (error) return showToast?.(`Erro ao votar: ${error.message}`, 'error');
    showToast?.(editandoVoto ? 'Voto atualizado.' : 'Voto registrado.', 'success');
    setMeuVoto(''); setComentario(''); setFilialSugerida('');
    setEditandoVoto(false);
    await carregarVotos(competicaoAtual.id);
    await carregarFecho(competicaoAtual.id);
  };

  const encerrarAgora = async () => {
    if (!competicaoAtual || !supabase) return;
    if (!await confirm({
      message: `Encerrar "${competicaoAtual.nome}" agora? A competição vai pra "aguardando encerramento" e libera votação do conselho.`,
      confirmLabel: 'Encerrar',
      danger: true,
    })) return;
    setEncerrandoAgora(true);
    const { error } = await supabase.rpc('encerrar_competicao_agora', {
      p_competicao_id: competicaoAtual.id,
    });
    setEncerrandoAgora(false);
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    showToast?.('Competição encerrada — abra a votação.', 'success');
    await carregarLista();
  };

  // Divergir do resultado é prerrogativa da Administração, mas o banco exige
  // justificativa (migr. 372) — pedimos aqui pra o admin não descobrir isso
  // por mensagem de erro.
  const declararVencedora = async (filial: FilialOp, justificativa?: string) => {
    if (!competicaoAtual || !supabase) return;
    if (!justificativa && !await confirm({
      message: `Confirma declarar ${filial} como vencedora de "${competicaoAtual.nome}"?`,
      confirmLabel: 'Declarar vencedora',
    })) return;
    setEncerrando(true);
    const { error } = await supabase.rpc('declarar_vencedora', {
      p_competicao_id: competicaoAtual.id,
      p_vencedora: filial,
      p_justificativa: justificativa ?? null,
    });
    setEncerrando(false);
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    setEscolhaDeclaracao(null);
    setJustificativa('');
    setModalParabens(filial);
    await carregarLista();
  };

  // Volta a competição para 'em_andamento' (migr. 371): é o único estado em
  // que o conselho consegue corrigir nota — em 'aguardando_encerramento'
  // todas as RPCs de escrita recusam. Só admin, e só sobre encerrada.
  const reabrirCompeticao = async (c: Competicao) => {
    if (!supabase) return;
    // `isoToday` local usa toISOString (UTC) e divergiria da RPC perto da
    // meia-noite; a régua da reabertura é o Acre, igual ao cron.
    const hojeAcre = todayBR();
    const venceu = c.data_fim < hojeAcre;
    if (!await confirm({
      message: `Reabrir "${c.nome}"?\n\n`
        + `A competição volta a correr: o conselho pode dar e corrigir nota, e a Matriz volta a criar e liberar tarefa. `
        + `${c.vencedora ?? 'A vencedora'} deixa de ser a vencedora declarada e o placar congelado é descartado — ele é recalculado quando você declarar de novo.\n\n`
        + (venceu
            ? `O prazo dela terminou em ${fmtDataBR(c.data_fim)}, então a data de fim passa para hoje (${fmtDataBR(hojeAcre)}). Sem isso o cron da madrugada fecharia ela de novo. Ajuste em Config se precisar de mais tempo.\n\n`
            : '')
        + `Os votos da rodada anterior continuam registrados, mas deixam de contar: o conselho precisa votar de novo antes da próxima declaração.`,
      confirmLabel: 'Reabrir',
      danger: true,
    })) return;
    const { data, error } = await supabase.rpc('reabrir_competicao', { p_competicao_id: c.id });
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    showToast?.(`Competição reaberta — vale até ${fmtDataBR(String(data))}.`, 'success');
    await carregarLista();
  };

  const excluirCompeticao = async (c: Competicao) => {
    if (!supabase) return;
    // Hard delete via RPC. Se a competição está em andamento ou aguardando
    // encerramento, tarefas, participantes, notas do conselho e votos vão
    // TODOS embora — não dá pra reverter pela UI. Aviso mais forte nesse
    // caso e pede confirmação dupla.
    const ativa = c.status === 'em_andamento' || c.status === 'aguardando_encerramento';
    const aviso = ativa
      ? `⚠️ ATENÇÃO: "${c.nome}" está ${c.status === 'em_andamento' ? 'EM ANDAMENTO' : 'AGUARDANDO ENCERRAMENTO'}.\n\n` +
        `Excluir vai remover PERMANENTEMENTE:\n` +
        `  • todas as tarefas cadastradas\n` +
        `  • todos os participantes\n` +
        `  • todas as notas do conselho\n` +
        `  • todos os votos registrados\n\n` +
        `Isso não pode ser desfeito pela UI. Use "Encerrar agora" se quer só finalizar. Tem certeza que quer excluir?`
      : `Excluir "${c.nome}" definitivamente da lista? Use pra descartar competições de teste. Essa ação não pode ser desfeita pela UI.`;
    if (!await confirm({
      message: aviso,
      confirmLabel: ativa ? 'Excluir mesmo assim' : 'Excluir',
      danger: true,
    })) return;
    if (ativa) {
      // Segunda barreira só pra ativa/aguardando — evita clique acidental.
      if (!await confirm({
        message: `Última confirmação: excluir "${c.nome}" ${c.status === 'em_andamento' ? 'em andamento' : 'aguardando encerramento'} de vez?`,
        confirmLabel: 'Sim, excluir',
        danger: true,
      })) return;
    }
    setExcluindo(c.id);
    const { error } = await supabase.rpc('excluir_competicao_matriz', {
      p_competicao_id: c.id,
    });
    setExcluindo(null);
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    showToast?.('Competição excluída.', 'success');
    if (competicaoAtual?.id === c.id) {
      setCompeticaoAtual(null);
      setPlacar(null);
      setVotos([]);
    }
    await carregarLista();
  };

  const abrirEdicao = (c: Competicao) => {
    setEditando(c);
    setFormEdit({
      nome: c.nome,
      descricao: c.descricao ?? '',
      data_inicio: c.data_inicio,
      data_fim: c.data_fim,
    });
  };

  const salvarEdicao = async () => {
    if (!editando || !supabase) return;
    if (!formEdit.nome.trim()) return showToast?.('Informe o nome da competição.', 'error');
    setSalvandoEdicao(true);
    const { error } = await supabase.rpc('atualizar_competicao', {
      p_competicao_id: editando.id,
      p_nome: formEdit.nome.trim(),
      p_data_inicio: formEdit.data_inicio,
      p_data_fim: formEdit.data_fim,
      p_descricao: formEdit.descricao.trim() || null,
    });
    setSalvandoEdicao(false);
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    showToast?.('Competição atualizada.', 'success');
    setEditando(null);
    await carregarLista();
  };

  const criar = async () => {
    if (!supabase) return;
    if (!form.nome.trim()) return showToast?.('Informe o nome da competição.', 'error');
    setSalvando(true);
    const { error } = await supabase.rpc('criar_competicao', {
      p_nome: form.nome.trim(),
      p_data_inicio: form.data_inicio,
      p_data_fim: form.data_fim,
      p_descricao: form.descricao.trim() || null,
    });
    setSalvando(false);
    if (error) {
      showToast?.(`Erro: ${error.message}`, 'error');
      return;
    }
    showToast?.('Competição criada!', 'success');
    setForm(f => ({ ...f, nome: '', descricao: '' }));
    await carregarLista();
    setTab('placar');
  };

  // Pódio ordenado por pontuação total.
  // Todos os hooks precisam ser chamados incondicionalmente — este useMemo
  // fica ANTES do early return de acesso.
  // Ordem pela régua única (migr. 372 / lib competicaoRanking): mesma cascata
  // de desempate que o banco usa pra validar a filial declarada.
  const podio = useMemo(() => {
    if (!placar) return [];
    return ordenarRanking(OP_FILIAIS.map(f => ({
      filial: f,
      media: Number(placar.por_filial?.[f]?.media ?? 0),
      n:     Number(placar.por_filial?.[f]?.n ?? 0),
      // Parcela objetiva (migr. 349): frequência do ponto no período.
      media_conselho: Number(placar.por_filial?.[f]?.media_conselho ?? 0),
      itens: Number(placar.por_filial?.[f]?.itens ?? 0),
      taxa:  placar.por_filial?.[f]?.frequencia?.taxa ?? null,
      freq:  placar.por_filial?.[f]?.frequencia ?? null,
    })));
  }, [placar]);

  if (!podeAcessar) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="neu-flat rounded-3xl p-8 border border-white/5 max-w-md text-center">
          <Trophy size={28} className="text-gray-500 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Competição visível apenas para Admin, CEO e Conselheiros.</p>
        </div>
      </div>
    );
  }

  const gerarPdfResultado = async (destino: 'download' | 'maxshow') => {
    if (!placar || !competicaoAtual) return;
    setBaixandoPdf(true);
    try {
      await exportCompeticaoResultadoPDF(
        {
          nome: competicaoAtual.nome,
          data_inicio: competicaoAtual.data_inicio,
          data_fim: competicaoAtual.data_fim,
          status: competicaoAtual.status,
          vencedora: competicaoAtual.vencedora,
          analise_ia: competicaoAtual.analise_ia,
        },
        podio.map(p => ({ filial: p.filial, media: p.media, n: p.n })),
        votos,
        `competicao-${competicaoAtual.nome.trim().replace(/[^a-zA-Z0-9]+/g, '-')}`,
        destino,
        profile,
        showToast,
      );
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setBaixandoPdf(false);
    }
  };
  const baixarPdfResultado = () => gerarPdfResultado('download');
  const enviarPdfAoMaxShow = () => gerarPdfResultado('maxshow');

  // Mesmo PDF, para uma competição do Histórico. Existe porque o Placar
  // deixou de exibir competição encerrada: sem isto, declarar a vencedora
  // apagaria o botão de exportar o resultado — justo quando ele serve.
  // Os números vêm do snapshot congelado; os votos, da tabela (o voto não
  // muda depois do fecho, e carregá-los sob demanda evita puxar os votos de
  // todas as encerradas ao abrir a aba).
  const [pdfHistoricoId, setPdfHistoricoId] = useState<string | null>(null);
  const gerarPdfDeEncerrada = async (c: Competicao, destino: 'download' | 'maxshow') => {
    if (!supabase) return;
    setPdfHistoricoId(c.id);
    try {
      const snap = c.placar_snapshot as any;
      const porFilial = snap?.por_filial ?? {};
      const podioSnap = ordenarRanking(OP_FILIAIS.map(f => ({
        filial: f as string,
        media: Number(porFilial?.[f]?.media ?? 0),
        n:     Number(porFilial?.[f]?.n ?? 0),
      })));
      const { data: votosDela } = await supabase
        .from('competicao_votos')
        .select('voto, filial_escolhida, comentario')
        .eq('competicao_id', c.id)
        .order('created_at', { ascending: true });
      await exportCompeticaoResultadoPDF(
        {
          nome: c.nome, data_inicio: c.data_inicio, data_fim: c.data_fim,
          status: c.status, vencedora: c.vencedora, analise_ia: c.analise_ia,
        },
        podioSnap,
        (votosDela ?? []) as any,
        `competicao-${c.nome.trim().replace(/[^a-zA-Z0-9]+/g, '-')}`,
        destino,
        profile,
        showToast,
      );
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setPdfHistoricoId(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
            <Trophy size={24} /> Competição entre Filiais
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Média das notas do conselho por filial nas Tarefas da Matriz. Ranking direto pela média.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {((podeGerenciar
              ? ['placar','config','historico']
              : ['placar','historico']) as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-lg transition-colors ${
                tab === t ? 'bg-accent/15 text-accent border border-accent/30' : 'neu-button text-gray-400 hover:text-white'
              }`}>
              {t === 'placar' ? 'Placar' : t === 'config' ? 'Config' : 'Histórico'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'placar' && (
        <>
          {loadingList || loadingPlacar ? (
            <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
          ) : !placar ? (
            <div className="neu-flat rounded-3xl p-12 border border-white/5 flex flex-col items-center gap-4">
              <EmptyState message={podeGerenciar
                ? 'Nenhuma competição em andamento. Vá em Config pra criar.'
                : 'Nenhuma competição em andamento. Aguarde admin/CEO abrir uma.'} />
              {/* Só oferece o Histórico quando há o que ver lá: botão que leva a
                  uma aba vazia ensina que a aba é inútil. */}
              {competicoes.some(c => c.status === 'encerrada') && (
                <button onClick={() => setTab('historico')} className="btn-shimmer btn-shimmer--glass-black">
                  <Trophy size={12} /> Ver competições encerradas
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Cabeçalho da competição + pódio */}
              <div className="neu-flat rounded-3xl p-6 border border-accent/20">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                  <div>
                    <p className={`text-[10px] uppercase tracking-widest font-bold ${emAnalise ? 'text-amber-400' : 'text-gray-500'}`}>
                      {emAnalise ? 'Análise · competição encerrada (somente leitura)' : 'Competição ativa'}
                    </p>
                    <h3 className="text-lg font-black text-gray-100">{placar.competicao.nome}</h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
                      <Calendar size={11} />
                      {fmtDataBR(placar.competicao.data_inicio)} → {fmtDataBR(placar.competicao.data_fim)}
                    </p>
                    {/* Descrição vem da lista completa (competicaoAtual) — a RPC de placar
                        não devolve esse campo, então placar.competicao.descricao é sempre undefined. */}
                    {competicaoAtual?.descricao && (
                      <p className="text-xs text-gray-300 mt-2 whitespace-pre-wrap max-w-xl">
                        {competicaoAtual.descricao}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Ordem: Central de Avaliação → Baixar PDF → Status → Encerrar agora → Excluir */}
                    {/* Em análise as duas saídas ficam lado a lado: voltar pro
                        que está correndo, ou reabrir de fato — que aí sim é o
                        gesto que devolve a competição pra votação. */}
                    {emAnalise && (
                      <button
                        onClick={() => { setAnaliseId(null); setTab('historico'); }}
                        className="btn-shimmer btn-shimmer--glass-black"
                        title="Voltar ao Histórico e devolver o Placar à competição em curso"
                      >
                        <X size={12} /> Sair da análise
                      </button>
                    )}
                    {emAnalise && profile.role === 'admin' && (
                      <button
                        onClick={() => reabrirCompeticao(emAnalise)}
                        className="btn-shimmer btn-shimmer--glass-yellow"
                        title="Devolver a competição para a votação do conselho e desfazer a declaração"
                      >
                        <Unlock size={12} /> Reabrir de verdade
                      </button>
                    )}
                    {/* Este botão é a ÚNICA porta para `matriz-avaliacoes` no app
                        inteiro. Prendê-lo a 'em_andamento' deixava as tarefas, as
                        notas e quem fez o quê inalcançáveis assim que a competição
                        encerrava — justo quando se quer consultar. Fora de
                        andamento a tela abre em leitura, que ela já sabe fazer. */}
                    {navigate && (
                      <button
                        onClick={() => navigate('matriz-avaliacoes')}
                        className="btn-shimmer btn-shimmer--gold"
                        title={statusVigente === 'em_andamento'
                          ? 'Avaliar itens das 3 filiais'
                          : 'Consultar tarefas, notas e participantes desta competição'}
                      >
                        <Award size={12} /> Central de Avaliação
                      </button>
                    )}
                    <button
                      onClick={baixarPdfResultado}
                      disabled={baixandoPdf}
                      className="btn-shimmer btn-shimmer--glass-black"
                      title="Baixar resultado por filial em PDF"
                    >
                      {baixandoPdf ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                      Baixar PDF
                    </button>
                    <button
                      onClick={enviarPdfAoMaxShow}
                      disabled={baixandoPdf}
                      className="btn-shimmer btn-shimmer--glass-black"
                      title="Enviar PDF direto ao Max Show pra apresentar em tela cheia"
                    >
                      {baixandoPdf ? <Loader2 size={12} className="animate-spin" /> : <Presentation size={12} />}
                      Enviar ao Max Show
                    </button>
                    {/* Três estados, três rótulos. O ternário de dois braços que
                        existia aqui chamava a competição já declarada de
                        "Aguardando encerramento" — o pior momento para errar,
                        porque é exatamente quando se apresenta o resultado. */}
                    {statusVigente && (
                      <span
                        className={`btn-shimmer ${STATUS_CHIP_CLASSE[statusVigente] ?? 'btn-shimmer--glass-gray'}`}
                        style={{ cursor: 'default' }}
                      >
                        {STATUS_LABEL[statusVigente] ?? statusVigente}
                      </span>
                    )}
                    {podeGerenciar && statusVigente === 'em_andamento' && (
                      <button
                        onClick={encerrarAgora}
                        disabled={encerrandoAgora}
                        className="btn-shimmer btn-shimmer--glass-yellow"
                        title="Força encerramento antes da data_fim"
                      >
                        {encerrandoAgora ? <Loader2 size={12} className="animate-spin" /> : <StopCircle size={12} />}
                        Encerrar agora
                      </button>
                    )}
                    {/* Análise é leitura: excluir a competição que se está
                        conferindo não é uma opção que deva estar à mão. */}
                    {podeGerenciar && competicaoAtual && !emAnalise && (
                      <button
                        onClick={() => excluirCompeticao(competicaoAtual)}
                        disabled={excluindo === competicaoAtual.id}
                        title="Excluir competição (uso pra descartar testes)"
                        className="btn-shimmer btn-shimmer--glass-red"
                      >
                        {excluindo === competicaoAtual.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Excluir
                      </button>
                    )}
                  </div>
                </div>

                {/* Composição do placar — sinaliza se os eixos subjetivos da
                    Avaliação de Filial entraram (gate: as 3 filiais precisam
                    ter ≥1 avaliação matriz_filial no período). */}
                <div className="mb-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                  <span className="text-gray-500">Fontes:</span>
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300">
                    Tarefas da Matriz
                  </span>
                  <span className={`px-2 py-0.5 rounded-full border ${
                    placar.inclui_eixos_conselho
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-gray-500 line-through'
                  }`} title={placar.inclui_eixos_conselho
                    ? 'Notas dos eixos subjetivos entraram na média'
                    : 'Alguma filial ainda não recebeu avaliação de filial no período — fonte ignorada'}>
                    Avaliação de Filial (eixos subjetivos)
                  </span>
                  {/* Frequência não é voto: sai do ponto do período (migr. 349). */}
                  <span
                    className="px-2 py-0.5 rounded-full border bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    title="Presenças e faltas do ponto eletrônico no período da competição. Justificado fica fora da conta."
                  >
                    Frequência do ponto ({Math.round((placar.peso_frequencia ?? 0.2) * 100)}%)
                  </span>
                </div>

                {/* Pódio — média das notas por filial (× 10, escala 0-100) */}
                <div className="grid grid-cols-3 gap-3">
                  {podio.map((p, idx) => (
                    <div key={p.filial}
                      className={`neu-pressed rounded-2xl p-4 text-center ${idx === 0 && p.n > 0 ? 'ring-1 ring-emerald-500/40' : ''}`}>
                      <div className="flex items-center justify-center gap-1 mb-1">
                        {idx === 0 && p.n > 0 && <Award size={14} className="text-emerald-400" />}
                        <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">
                          {['1º','2º','3º'][idx]}
                        </span>
                      </div>
                      <div className="flex justify-center"><FilialBadge filial={p.filial} /></div>
                      <p className={`text-2xl font-black font-mono tabular-nums mt-1 ${idx === 0 && p.n > 0 ? 'text-emerald-400' : 'text-gray-200'}`}>
                        {p.n === 0 ? '—' : (p.media / 10).toFixed(1)}
                      </p>
                      <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-0.5">
                        {p.n === 0 ? 'sem notas' : `nota média (${p.n} nota${p.n === 1 ? '' : 's'})`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detalhe por filial */}
              <div className="neu-flat rounded-3xl p-5 border border-white/5">
                <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                  <Star size={13} className="text-accent" /> Notas do conselho por filial
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-widest text-gray-500">
                      <tr>
                        <th className="text-left pb-3 font-bold">Filial</th>
                        <th className="text-right pb-3 font-bold pr-4">Notas / itens</th>
                        <th className="text-right pb-3 font-bold pr-4">Conselho (0-10)</th>
                        <th className="text-right pb-3 font-bold pr-4">Frequência</th>
                        <th className="text-right pb-3 font-bold pr-4">Cobertura do ponto</th>
                        <th className="text-right pb-3 font-bold pr-4">Final (0-10)</th>
                        <th className="text-right pb-3 font-bold pr-4">Escala 0-100</th>
                      </tr>
                    </thead>
                    <tbody>
                      {podio.map(p => {
                        const isBest = p.n > 0 && p.media === Math.max(...podio.map(x => x.n > 0 ? x.media : -Infinity));
                        return (
                          <tr key={p.filial} className="border-t border-white/5">
                            <td className="py-3"><FilialBadge filial={p.filial} /></td>
                            <td className="py-3 text-right text-gray-300 tabular-nums pr-4"
                                title={p.itens ? `${p.n} nota(s) sobre ${p.itens} item(ns) julgado(s)` : undefined}>
                              {p.n}{p.itens ? <span className="text-gray-600"> / {p.itens}</span> : null}
                            </td>
                            <td className="py-3 text-right text-gray-400 tabular-nums pr-4">
                              {p.n === 0 ? '—' : (p.media_conselho / 10).toFixed(1)}
                            </td>
                            <td
                              className="py-3 text-right tabular-nums pr-4"
                              title={p.freq
                                ? `${p.freq.presencas} presença(s) — ${p.freq.atrasos ?? 0} com atraso (meio ponto), ${p.freq.faltas} falta(s), ${p.freq.justificados} justificado(s) fora da conta`
                                : 'Sem ponto lançado no período'}
                            >
                              {p.freq?.taxa == null
                                ? <span className="text-gray-600">—</span>
                                : <span className={p.freq.entrou ? 'text-emerald-300' : 'text-gray-500'}>
                                    {(p.freq.taxa * 100).toFixed(0)}%
                                  </span>}
                            </td>
                            {/* Cobertura: o que foi lançado sobre o que se
                                esperava lançar (dias com ponto × gente ativa).
                                Sem ela, 100% em 6 registros e 100% em 24 são o
                                mesmo número — e a frequência vale 20% da nota. */}
                            {(() => {
                              // `esperado` vem do banco desde a 376; o produto
                              // é o fallback pro snapshot da 374.
                              const esperado = p.freq?.esperado
                                ?? ((p.freq?.dias_distintos ?? 0) * (p.freq?.funcionarios_ativos ?? 0));
                              const lancados = p.freq?.registros ?? 0;
                              if (!esperado) {
                                return (
                                  <td className="py-3 text-right tabular-nums pr-4 text-gray-600"
                                      title="Snapshot anterior à migr. 374 não guarda a cobertura.">—</td>
                                );
                              }
                              const comCalendario = !!p.freq?.calendario;
                              const pct = Math.round((lancados / esperado) * 100);
                              return (
                                <td className="py-3 text-right tabular-nums pr-4"
                                    title={comCalendario
                                      ? `${lancados} de ${esperado} lançamento(s) esperado(s) — ${p.freq?.dias_letivos} dia(s) letivo(s) × ${p.freq?.funcionarios_ativos} pessoa(s). Os ${p.freq?.ausencias ?? 0} que faltaram já contam como falta na taxa.`
                                      : `${lancados} de ${esperado} — sem calendário da turma configurado, o que não foi lançado não entra na conta e a taxa pode estar inflada.`}>
                                  <span className={pct >= 100 ? 'text-gray-400' : comCalendario ? 'text-gray-400' : 'text-amber-400 font-bold'}>
                                    {pct}%
                                  </span>
                                  <span className="text-gray-600"> ({lancados}/{esperado})</span>
                                </td>
                              );
                            })()}
                            <td className={`py-3 text-right tabular-nums pr-4 ${isBest ? 'text-emerald-400 font-bold' : 'text-gray-300'}`}>
                              {p.n === 0 ? '—' : (p.media / 10).toFixed(1)}
                            </td>
                            <td className="py-3 text-right text-gray-500 tabular-nums pr-4">
                              {p.n === 0 ? '—' : p.media.toFixed(1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-500 mt-3">
                  Conselho = média por participante primeiro (as notas que ele recebeu), depois média dos
                  participantes da filial — assim um avaliador que julgue mais gente de uma unidade não pesa
                  mais que os outros. O eixo subjetivo da Avaliação de Filial entra como um item da unidade. Frequência = ponto do período, com presença pontual valendo o dia
                  inteiro, {placar.atraso_conta === false
                    ? 'atraso ainda sem desconto (horário da turma não confirmado — veja o card em Avaliação das Filiais)'
                    : `atraso valendo meio dia (entrada após ${placar.jornada_entrada ?? '—'})`}, falta zerando e
                  justificado fora da conta; entra na nota final com peso {Math.round((placar.peso_frequencia ?? 0.2) * 100)}%.
                  Filial sem ponto lançado não é punida — a parcela simplesmente não entra e a final repete a do conselho.
                  {placar.calendario_turma
                    ? ' Com o calendário da turma configurado, cada pessoa ativa responde por cada dia letivo: dia sem lançamento conta como falta, e a cobertura mostra quanto foi de fato registrado.'
                    : ' Sem o calendário da turma configurado, o que não foi lançado não entra na conta — configure os dias de aula no card de Frequência, na Central de Avaliação, para a falta descontar.'}
                </p>
              </div>

              {/* Quem já avaliou — nominal, com a média que cada um deu */}
              <div className="neu-flat rounded-3xl p-5 border border-white/5">
                <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                  <Users size={13} className="text-accent" /> Quem já avaliou — Tarefas da Matriz
                </h3>
                {porAvaliador.length === 0 ? (
                  <EmptyState message="Nenhum eleitor cadastrado na Matriz." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase tracking-widest text-gray-500">
                        <tr>
                          <th className="text-left pb-3 font-bold">Avaliador</th>
                          <th className="text-right pb-3 font-bold pr-4">Notas em tarefas</th>
                          {vejoNotaAlheia && OP_FILIAIS.map(f => (
                            <th key={f} className={`text-right pb-3 font-bold pr-4 ${FILIAL_COLOR[f]}`}>{f}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {porAvaliador.map(a => (
                          <tr key={a.id} className="border-t border-white/5">
                            <td className="py-3">
                              <span className="text-gray-200">{a.nome}</span>
                              {a.id === profile.id && <span className="text-accent"> (você)</span>}
                              <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold ml-2">
                                {a.role === 'ceo' ? 'CEO' : a.role === 'admin' ? 'admin · fora da média' : 'Conselheiro'}
                              </span>
                            </td>
                            <td className={`py-3 text-right tabular-nums pr-4 ${a.total === 0 ? 'text-yellow-400' : 'text-gray-300'}`}>
                              {a.total === 0 ? 'sem nota em tarefas' : a.total}
                            </td>
                            {vejoNotaAlheia && OP_FILIAIS.map(f => {
                              const acc = a.porFilial[f];
                              return (
                                <td key={f} className="py-3 text-right tabular-nums pr-4 text-gray-300">
                                  {acc ? (acc.soma / acc.n).toFixed(1) : <span className="text-gray-600">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[10px] text-gray-500 mt-3">
                  {vejoNotaAlheia ? (
                    <>Média 0-10 que cada eleitor deu por filial nas Tarefas da Matriz — mesma fonte do pódio.
                    Os eixos da Avaliação de Filial também pesam no placar quando o selo acima está aceso, mas
                    não aparecem nesta tabela. Nota de admin nunca entra na média.</>
                  ) : (
                    <>Quantas notas cada eleitor já registrou nas Tarefas da Matriz. O valor de cada nota fica
                    selado até a tarefa ser encerrada — daí ele aparece por participante, dentro da tarefa.</>
                  )}
                </p>
              </div>

              {/* Análise IA */}
              {competicaoAtual && competicaoAtual.status !== 'em_andamento' && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <Sparkles size={13} className="text-accent" /> Análise IA
                    </h3>
                    <div className="flex items-center gap-2">
                      {competicaoAtual.analise_ia && (
                        <BotaoWhatsApp
                          showToast={showToast}
                          getTexto={() => montarMensagemWhats({
                            titulo: 'Análise da Competição',
                            subtitulo: competicaoAtual.nome,
                            corpoMarkdown: competicaoAtual.analise_ia,
                          })}
                        />
                      )}
                      {competicaoAtual.status !== 'encerrada' && (
                        <NeuButtonAccent onClick={gerarAnalise} disabled={gerandoAnalise} variant="">
                          {gerandoAnalise
                            ? <><Loader2 size={12} className="animate-spin" /> Analisando…</>
                            : <><Sparkles size={12} /> {competicaoAtual.analise_ia ? 'Regenerar' : 'Gerar análise'}</>}
                        </NeuButtonAccent>
                      )}
                    </div>
                  </div>
                  {competicaoAtual.analise_ia ? (
                    <div className="text-sm text-gray-200 leading-relaxed">
                      <ReactMarkdown>{competicaoAtual.analise_ia}</ReactMarkdown>
                    </div>
                  ) : (
                    <EmptyState message="Análise ainda não gerada. Clique em Gerar análise pra ouvir a opinião da IA." />
                  )}
                </div>
              )}

              {/* Votação */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && (podeVotar || podeDesempatar) && (
                <div className={`neu-flat rounded-3xl p-5 border ${podeDesempatar && !jaVotei ? 'border-amber-500/40' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <MessageCircle size={13} className="text-accent" />
                      {podeDesempatar ? 'Desempate da Administração' : 'Votação do conselho'}
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold">
                      {vejoVotoAlheio ? (
                        <>
                          <span className="text-emerald-400">Aceita: {contagemVotos.aceita}</span>
                          <span className="text-red-400">Rejeita: {contagemVotos.rejeita}</span>
                        </>
                      ) : (
                        <span className="text-gray-500" title="O voto de cada eleitor fica selado até a vencedora ser declarada (migr. 375).">
                          Votos selados
                        </span>
                      )}
                      <span className={votosNoQuorum >= quorumMinimo ? 'text-emerald-400' : 'text-yellow-400'}>
                        Quórum: {votosNoQuorum}/{quorumMinimo}
                      </span>
                    </div>
                  </div>

                  {/* O conselho empatou e o eleitorado é par: quem desempata é
                      a Administração. Só aparece nesse estado — fora dele o
                      admin modera a competição e não julga. */}
                  {podeDesempatar && !jaVotei && (
                    <p className="text-xs text-amber-300/90 mb-4 leading-relaxed">
                      O conselho empatou em {contagemVotos.aceita}×{contagemVotos.rejeita} com todos os
                      {' '}{totalVotantes} eleitores votando. Seu voto entra na contagem como qualquer
                      outro e desfaz o empate.
                    </p>
                  )}

                  {jaVotei && !editandoVoto ? (
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <p className="text-xs text-gray-400">
                        Você já registrou seu voto ({meuVotoAtual?.voto === 'aceita'
                          ? 'Aceita'
                          : `Rejeita → ${meuVotoAtual?.filial_escolhida ?? '—'}`}). Aguarde os demais eleitores.
                      </p>
                      <button
                        onClick={() => setEditandoVoto(true)}
                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all shrink-0"
                      >
                        <Pencil size={11} /> Trocar voto
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setMeuVoto('aceita')}
                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
                            meuVoto === 'aceita'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
                              : 'neu-button text-gray-400 hover:text-white'
                          }`}>
                          <ThumbsUp size={13} /> Aceito o placar
                        </button>
                        <button onClick={() => setMeuVoto('rejeita')}
                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
                            meuVoto === 'rejeita'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/40'
                              : 'neu-button text-gray-400 hover:text-white'
                          }`}>
                          <ThumbsDown size={13} /> Rejeito
                        </button>
                      </div>

                      {meuVoto === 'rejeita' && (
                        <FormField label="Filial que você acha vencedora">
                          <select value={filialSugerida}
                            onChange={e => setFilialSugerida(e.target.value as FilialOp)}
                            className="neu-input rounded-lg px-3 py-2 text-xs w-full">
                            <option value="">Selecione…</option>
                            {OP_FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </FormField>
                      )}

                      {meuVoto && (
                        <>
                          <FormField label="Comentário (opcional)">
                            <textarea value={comentario} onChange={e => setComentario(e.target.value)}
                              className="neu-input rounded-lg px-3 py-2 text-xs w-full" rows={2}
                              placeholder="Justifique seu voto…" />
                          </FormField>
                          <div className="flex justify-end gap-2">
                            {editandoVoto && (
                              <button
                                onClick={() => {
                                  setEditandoVoto(false);
                                  setMeuVoto(''); setComentario(''); setFilialSugerida('');
                                }}
                                className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-white"
                              >
                                Cancelar
                              </button>
                            )}
                            <NeuButtonAccent onClick={registrarVoto} disabled={votando} variant="">
                              {votando
                                ? <><Loader2 size={12} className="animate-spin" /> Registrando…</>
                                : editandoVoto ? 'Atualizar voto' : 'Registrar voto'}
                            </NeuButtonAccent>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {vejoVotoAlheio && votos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2">
                        Votos registrados ({votosValidos.length}
                        {votos.length > votosValidos.length && <> · {votos.length - votosValidos.length} da rodada anterior</>})
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {votos.map(v => {
                          // Voto anterior à reabertura fica visível como registro,
                          // mas não conta (migr. 372).
                          const valido = votosValidos.some(x => x.id === v.id);
                          return (
                          <div key={v.id} className={`flex items-start gap-2 text-xs ${valido ? '' : 'opacity-40'}`}>
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                              !valido
                                ? 'bg-white/5 text-gray-500 line-through'
                                : v.voto === 'aceita'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                            }`}>
                              {v.voto === 'aceita' ? 'Aceita' : `Rejeita → ${v.filial_escolhida}`}
                            </span>
                            <span className="text-gray-400 truncate">{v.comentario ?? '—'}</span>
                            {!valido && (
                              <span className="shrink-0 text-[9px] uppercase tracking-widest text-gray-600">
                                rodada anterior
                              </span>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Aguardando votação — visão somente-leitura pra quem gerencia mas não vota (admin) */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && !podeVotar && !podeDesempatar && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <MessageCircle size={13} className="text-accent" /> Votação do conselho
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold">
                      {vejoVotoAlheio ? (
                        <>
                          <span className="text-emerald-400">Aceita: {contagemVotos.aceita}</span>
                          <span className="text-red-400">Rejeita: {contagemVotos.rejeita}</span>
                        </>
                      ) : (
                        <span className="text-gray-500" title="O voto de cada eleitor fica selado até a vencedora ser declarada (migr. 375).">
                          Votos selados
                        </span>
                      )}
                      <span className={votosNoQuorum >= quorumMinimo ? 'text-emerald-400' : 'text-yellow-400'}>
                        Quórum: {votosNoQuorum}/{quorumMinimo}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Aguardando CEO e conselheiros votarem pra declarar a filial vencedora. Nenhuma ação sua é necessária aqui.
                  </p>
                  {vejoVotoAlheio && votos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2">
                        Votos registrados ({votosValidos.length}
                        {votos.length > votosValidos.length && <> · {votos.length - votosValidos.length} da rodada anterior</>})
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {votos.map(v => {
                          // Voto anterior à reabertura fica visível como registro,
                          // mas não conta (migr. 372).
                          const valido = votosValidos.some(x => x.id === v.id);
                          return (
                          <div key={v.id} className={`flex items-start gap-2 text-xs ${valido ? '' : 'opacity-40'}`}>
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                              !valido
                                ? 'bg-white/5 text-gray-500 line-through'
                                : v.voto === 'aceita'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                            }`}>
                              {v.voto === 'aceita' ? 'Aceita' : `Rejeita → ${v.filial_escolhida}`}
                            </span>
                            <span className="text-gray-400 truncate">{v.comentario ?? '—'}</span>
                            {!valido && (
                              <span className="shrink-0 text-[9px] uppercase tracking-widest text-gray-600">
                                rodada anterior
                              </span>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Declaração de vencedora — só a Administração, e só com o
                  quórum de maioria simples atingido (migr. 369). O conselho
                  julga; quem homologa o julgamento é o admin. */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && profile.role === 'admin' && votantesCarregados && votosNoQuorum >= quorumMinimo && (() => {
                const sugerida = sugestaoRejeicao ?? podio[0]?.filial;
                const origem = sugestaoRejeicao ? 'maioria do conselho rejeitou o placar' : 'placar automático';
                // O banco cobra justificativa em dois casos (372 e 375):
                // declarar contra o apurado, ou homologar com participante
                // sem nota de todo o conselho. A tela pede antes, pra o
                // admin não descobrir por mensagem de erro.
                const precisaJustificar = (f: FilialOp) => f !== sugerida || semNota > 0;
                return (
                  <div className="neu-flat rounded-3xl p-5 border border-accent/30">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2 mb-2">
                      <Crown size={13} className="text-accent" /> Declarar vencedora
                    </h3>
                    <p className="text-xs text-gray-400 mb-4">
                      Resultado ({origem}): <span className="text-emerald-400 font-bold">{sugerida}</span>
                      {!sugestaoRejeicao && podio[0] && podio[0].n > 0 && <> (nota média {(podio[0].media / 10).toFixed(1)})</>}.
                      {' '}Declarar outra filial contraria o resultado e exige justificativa registrada.
                    </p>
                    {semNota > 0 && (
                      <p className="text-xs text-amber-300/90 mb-4 leading-relaxed">
                        ⚠ {semNota} participante(s) de tarefa liberada ainda sem nota de todo o conselho.
                        Dá pra homologar assim, mas o banco vai pedir justificativa por escrito — o caminho
                        limpo é a Central de Avaliação antes de declarar.
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {OP_FILIAIS.map(f => {
                        const isSugerida = f === sugerida;
                        return (
                          <button key={f}
                            onClick={() => (precisaJustificar(f)
                              ? (setEscolhaDeclaracao(f), setJustificativa(''))
                              : declararVencedora(f))}
                            disabled={encerrando}
                            className={`neu-button rounded-xl p-3 text-xs font-bold uppercase tracking-widest transition-colors ${FILIAL_COLOR[f]} hover:border-accent ${
                              isSugerida ? 'ring-2 ring-accent/60' : escolhaDeclaracao === f ? 'ring-2 ring-amber-500/60' : ''
                            }`}
                            style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                            {encerrando ? <Loader2 size={12} className="animate-spin inline" /> : (
                              <>
                                {isSugerida && <Award size={11} className="inline mr-1 text-accent" />}
                                Declarar {f}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {escolhaDeclaracao && (
                      <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
                        <p className="text-xs text-amber-300/90 leading-relaxed">
                          {escolhaDeclaracao !== sugerida && (
                            <>{escolhaDeclaracao} não é o resultado apurado ({sugerida}). </>
                          )}
                          {semNota > 0 && (
                            <>{semNota} participante(s) de tarefa liberada ainda não receberam nota de todo o
                            conselho — a média que você vai congelar não descreve a filial inteira. </>
                          )}
                          A justificativa fica gravada na competição — escreva ao menos 20 caracteres.
                        </p>
                        <FormField label="Justificativa da Administração">
                          <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)}
                            className="neu-input rounded-lg px-3 py-2 text-xs w-full" rows={3}
                            placeholder="Ex.: apuração revista após identificação de tarefa lançada na filial errada…" />
                        </FormField>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setEscolhaDeclaracao(null); setJustificativa(''); }}
                            className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-white"
                          >
                            Cancelar
                          </button>
                          <NeuButtonAccent
                            onClick={() => declararVencedora(escolhaDeclaracao, justificativa.trim())}
                            disabled={encerrando || justificativa.trim().length < 20}
                            variant=""
                          >
                            {encerrando
                              ? <><Loader2 size={12} className="animate-spin" /> Declarando…</>
                              : <>Declarar {escolhaDeclaracao} mesmo assim</>}
                          </NeuButtonAccent>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* O painel "Vencedora declarada" saiu daqui: declarada a
                  vencedora, esta aba não carrega mais a competição. O momento
                  da declaração tem o modal de parabéns, e a consulta depois é
                  no Histórico. */}
            </>
          )}
        </>
      )}

      {/* Modal de parabenização */}
      <AnimatePresence>
        {modalParabens && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            onClick={() => setModalParabens(null)}
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.8, y: 20 }}
              transition={{ type: 'spring', damping: 20 }}
              className="neu-flat rounded-3xl p-8 sm:p-12 border border-emerald-500/40 max-w-lg w-full text-center relative"
              onClick={e => e.stopPropagation()}
              style={{ background: 'radial-gradient(circle at top, rgba(16,185,129,0.15), transparent 70%)' }}
            >
              <button onClick={() => setModalParabens(null)}
                className="absolute top-4 right-4 modal-close-btn">
                <X size={18} />
              </button>
              <div className="text-7xl mb-3">🏆</div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 mb-2">
                Parabéns
              </p>
              <h2 className={`text-4xl font-black tracking-wider ${FILIAL_COLOR[modalParabens as FilialOp]}`}>
                {modalParabens}
              </h2>
              <p className="text-sm text-gray-300 mt-4">
                venceu a competição <strong>{competicaoAtual?.nome}</strong>!
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Período: {fmtDataBR(competicaoAtual?.data_inicio ?? '')} → {fmtDataBR(competicaoAtual?.data_fim ?? '')}
              </p>
              <div className="mt-6">
                <NeuButtonAccent onClick={() => setModalParabens(null)} variant="">
                  Fechar
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de edição da competição */}
      <AnimatePresence>
        {editando && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
            onClick={() => !salvandoEdicao && setEditando(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 22 }}
              className="neu-flat rounded-3xl p-6 border border-accent/30 max-w-xl w-full relative"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setEditando(null)}
                disabled={salvandoEdicao}
                className="absolute top-4 right-4 modal-close-btn"
              >
                <X size={18} />
              </button>
              <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                <Pencil size={13} className="text-accent" /> Editar competição
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div className="md:col-span-2">
                  <FormField label="Nome">
                    <input type="text" value={formEdit.nome}
                      onChange={e => setFormEdit(f => ({ ...f, nome: e.target.value }))}
                      className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                  </FormField>
                </div>
                <div className="md:col-span-2">
                  <FormField label="Descrição (opcional)">
                    <textarea value={formEdit.descricao}
                      onChange={e => setFormEdit(f => ({ ...f, descricao: e.target.value }))}
                      className="neu-input rounded-lg px-3 py-2 text-xs w-full" rows={3} />
                  </FormField>
                </div>
                <FormField label="Início">
                  <input type="date" value={formEdit.data_inicio}
                    onChange={e => setFormEdit(f => ({ ...f, data_inicio: e.target.value }))}
                    className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                </FormField>
                <FormField label="Fim">
                  <input type="date" value={formEdit.data_fim}
                    onChange={e => setFormEdit(f => ({ ...f, data_fim: e.target.value }))}
                    className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                </FormField>
              </div>
              <p className="text-[10px] text-gray-500 mb-4">
                As datas do ciclo da Avaliação de Filial vinculado são atualizadas junto.
              </p>
              {/* O período não é rótulo: é o filtro do placar. Os eixos da
                  Avaliação de Filial entram por `created_at` dentro da janela, e
                  a frequência soma o ponto do intervalo — mexer aqui recalcula o
                  resultado de todas as filiais. Fica registrado na trilha (374),
                  mas quem clica merece saber antes. */}
              {editando.status !== 'encerrada' && (
                <p className="text-[10px] text-amber-400/90 mb-4 leading-relaxed">
                  ⚠ Mudar o período muda o placar: as notas dos eixos e o ponto que entram na conta são os
                  que caem dentro dele. A alteração fica registrada no histórico da competição.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditando(null)}
                  disabled={salvandoEdicao}
                  className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg neu-button text-gray-400 hover:text-white"
                >
                  Cancelar
                </button>
                <NeuButtonAccent onClick={salvarEdicao} disabled={salvandoEdicao || !formEdit.nome.trim()} variant="">
                  {salvandoEdicao
                    ? <><Loader2 size={13} className="animate-spin" /> Salvando…</>
                    : <>Salvar</>}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'config' && (
        <>
          {podeGerenciar && (
            <div className="neu-flat rounded-3xl p-6 border border-white/5">
              <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
                <Plus size={13} className="text-accent" /> Nova competição
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="md:col-span-3">
                  <FormField label="Nome">
                    <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                      className="neu-input rounded-lg px-3 py-2 text-xs w-full" placeholder="Ex.: Trimestre Q3 2026" />
                  </FormField>
                </div>
                <div className="md:col-span-3">
                  <FormField label="Descrição (opcional)">
                    <textarea value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                      className="neu-input rounded-lg px-3 py-2 text-xs w-full" rows={3}
                      placeholder="Objetivo, regras ou tema da competição…" />
                  </FormField>
                </div>
                <FormField label="Início">
                  <input type="date" value={form.data_inicio}
                    onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                    className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                </FormField>
                <FormField label="Fim">
                  <input type="date" value={form.data_fim}
                    onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                    className="neu-input rounded-lg px-3 py-2 text-xs w-full" />
                </FormField>
                <div />
              </div>

              <p className="text-[10px] text-gray-500 mb-4">
                Ranking será a média das notas 0-10 do conselho nas Tarefas da Matriz, por filial do participante.
              </p>
              <div className="mt-5 flex items-center justify-end">
                <NeuButtonAccent onClick={criar} disabled={salvando || !form.nome.trim()} variant="">
                  {salvando ? <><Loader2 size={13} className="animate-spin" /> Criando…</> : <><Plus size={13} /> Criar competição</>}
                </NeuButtonAccent>
              </div>
            </div>
          )}

          <div className="neu-flat rounded-3xl p-5 border border-white/5">
            <h3 className="text-sm font-bold text-gray-200 mb-4">Todas as competições</h3>
            {loadingList ? (
              <LoadingSpinner />
            ) : competicoes.length === 0 ? (
              <EmptyState message="Nenhuma competição criada ainda." />
            ) : (
              <div className="flex flex-col gap-2">
                {competicoes.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-xl border border-white/5 hover:border-accent/30 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-200 truncate">{c.nome}</p>
                      <p className="text-[10px] text-gray-500">
                        {fmtDataBR(c.data_inicio)} → {fmtDataBR(c.data_fim)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.vencedora && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${FILIAL_COLOR[c.vencedora as FilialOp] ?? ''}`}>
                          🏆 {c.vencedora}
                        </span>
                      )}
                      {c.status === 'em_andamento' ? (
                        <span className="btn-shimmer btn-shimmer--glass-green" style={{ cursor: 'default' }}>
                          Em Andamento
                        </span>
                      ) : c.status === 'aguardando_encerramento' ? (
                        <span className="btn-shimmer btn-shimmer--glass-yellow" style={{ cursor: 'default' }}>
                          Aguardando Encerramento
                        </span>
                      ) : (
                        <span className="btn-shimmer btn-shimmer--glass-gray" style={{ cursor: 'default' }}>
                          Encerrada
                        </span>
                      )}
                      {c.status !== 'encerrada' && (
                        <button
                          onClick={() => abrirEdicao(c)}
                          title="Editar competição"
                          className="btn-shimmer btn-shimmer--glass-blue"
                        >
                          <Pencil size={12} /> Editar
                        </button>
                      )}
                      <button
                        onClick={() => excluirCompeticao(c)}
                        disabled={excluindo === c.id}
                        title="Excluir competição (uso pra descartar testes)"
                        className="btn-shimmer btn-shimmer--glass-red"
                      >
                        {excluindo === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Excluir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'historico' && (
        <>
          {loadingList ? (
            <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
          ) : (() => {
            const encerradas = competicoes.filter(c => c.status === 'encerrada');
            if (encerradas.length === 0) {
              return (
                <div className="neu-flat rounded-3xl p-12 border border-white/5">
                  <EmptyState message="Nenhuma competição encerrada ainda." />
                </div>
              );
            }
            return (
              <div className="flex flex-col gap-4">
                {encerradas.map(c => {
                  const snap = c.placar_snapshot as any;
                  const podioSnap = podiumFromSnapshot(snap);
                  const escalaLegado = !!snap?.placar?.total_por_filial; // snapshot antigo → pontos ponderados
                  return (
                    <div key={c.id} className="neu-flat rounded-3xl p-5 border border-white/5">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div>
                          <h4 className="text-base font-bold text-gray-100">{c.nome}</h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            {fmtDataBR(c.data_inicio)} → {fmtDataBR(c.data_fim)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Conferir o resultado não pode custar o resultado:
                              antes disto, ver as notas de uma competição
                              declarada exigia REABRIR — e reabrir devolve tudo
                              pra votação, invalida os votos da rodada e
                              descarta o placar congelado. Análise abre o mesmo
                              Placar em leitura, sem tocar em status nenhum. */}
                          <button
                            onClick={() => { setAnaliseId(c.id); setTab('placar'); }}
                            className="btn-shimmer btn-shimmer--glass-black"
                            title="Abrir o Placar desta competição em leitura — notas, votos e pódio, sem reabrir"
                          >
                            <Star size={12} /> Abrir para análise
                          </button>
                          {/* É aqui que se procura uma competição encerrada, então é
                              aqui que precisa existir a porta para as notas. Sem
                              isso o Histórico mostrava só o pódio e as tarefas,
                              notas e participantes ficavam inalcançáveis. */}
                          {navigate && (
                            <button
                              onClick={() => {
                                // A Central escolhe sozinha qual competição abrir;
                                // isto diz qual foi clicada, senão com várias
                                // encerradas ela abriria sempre a mais recente.
                                try { sessionStorage.setItem('logmax:competicaoAlvo', c.id); } catch { /* modo privado */ }
                                navigate('matriz-avaliacoes');
                              }}
                              className="btn-shimmer btn-shimmer--gold"
                              title="Ver tarefas, notas e participantes desta competição"
                            >
                              <Award size={12} /> Central de Avaliação
                            </button>
                          )}
                          <button
                            onClick={() => gerarPdfDeEncerrada(c, 'download')}
                            disabled={pdfHistoricoId === c.id}
                            className="btn-shimmer btn-shimmer--glass-black"
                            title="Baixar o resultado desta competição em PDF"
                          >
                            {pdfHistoricoId === c.id ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                            Baixar PDF
                          </button>
                          <button
                            onClick={() => gerarPdfDeEncerrada(c, 'maxshow')}
                            disabled={pdfHistoricoId === c.id}
                            className="btn-shimmer btn-shimmer--glass-black"
                            title="Enviar o resultado ao Max Show pra apresentar em tela cheia"
                          >
                            {pdfHistoricoId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Presentation size={12} />}
                            Enviar ao Max Show
                          </button>
                          {/* Declarar a vencedora era irreversível. Errar a filial
                              ou encerrar cedo não pode custar a competição inteira. */}
                          {profile.role === 'admin' && (
                            <button
                              onClick={() => reabrirCompeticao(c)}
                              className="btn-shimmer btn-shimmer--glass-yellow"
                              title="Desfaz a declaração e devolve a competição para a votação. Só pra corrigir o resultado — pra apenas consultar as notas, use Abrir para análise."
                            >
                              <Unlock size={12} /> Reabrir
                            </button>
                          )}
                          {c.vencedora && (
                            <span className={`text-sm font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 ${FILIAL_COLOR[c.vencedora as FilialOp] ?? ''}`}>
                              🏆 {c.vencedora}
                            </span>
                          )}
                        </div>
                      </div>
                      {snap ? (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {podioSnap.map((p, idx) => (
                            <div key={p.filial}
                              className={`neu-pressed rounded-xl p-3 text-center ${p.filial === c.vencedora ? 'ring-1 ring-emerald-500/40' : ''}`}>
                              <p className={`text-[10px] font-black uppercase tracking-widest ${FILIAL_COLOR[p.filial as FilialOp]}`}>
                                {['1º','2º','3º'][idx]} · {p.filial}
                              </p>
                              <p className={`text-lg font-black font-mono tabular-nums mt-1 ${p.filial === c.vencedora ? 'text-emerald-400' : 'text-gray-200'}`}>
                                {escalaLegado ? `${p.total.toFixed(2)} pts` : (p.total === 0 ? '—' : (p.total / 10).toFixed(1))}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-gray-500 mb-3">Placar snapshot indisponível.</p>
                      )}
                      {/* Declaração que contrariou o resultado apurado fica
                          registrada na tela, não só no banco (migr. 372).
                          Estava no Placar; veio junto quando a competição
                          encerrada deixou de aparecer lá. */}
                      {c.declaracao_justificativa && (
                        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-[10px] uppercase tracking-widest font-bold text-amber-400/80 mb-1">
                            Declarada contra o resultado apurado — justificativa da Administração
                          </p>
                          <p className="text-xs text-gray-300 whitespace-pre-wrap">
                            {c.declaracao_justificativa}
                          </p>
                        </div>
                      )}
                      {c.analise_ia && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-accent">
                            Análise IA
                          </summary>
                          <div className="mt-3 text-gray-300 leading-relaxed">
                            <ReactMarkdown>{c.analise_ia}</ReactMarkdown>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}
    </motion.div>
  );
}
