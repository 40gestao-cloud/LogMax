import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Calendar, Sparkles, Loader2, Plus, Award, ThumbsUp, ThumbsDown, MessageCircle, X, Crown, StopCircle, Pencil, Trash2, FileDown, Star } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FormField } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { exportCompeticaoResultadoPDF } from '../lib/competicaoPdf';

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
};

type Voto = {
  id: string;
  competicao_id: string;
  votante_id: string;
  voto: 'aceita' | 'rejeita';
  filial_escolhida: string | null;
  comentario: string | null;
  created_at: string;
};

type Placar = {
  competicao: any;
  por_filial: Record<string, { media: number; n: number }>;
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
  const { session } = useAuth();
  const confirm = useConfirm();
  const podeGerenciar = profile.role === 'admin' || profile.role === 'ceo';
  // Votação restrita a CEO + conselheiros (alinha com RLS voto_write).
  // Admin gerencia mas não vota.
  const podeVotar     = profile.role === 'ceo' || isConselheiro(profile);
  const podeAcessar   = podeGerenciar || isConselheiro(profile);

  const [tab, setTab] = useState<Tab>('placar');
  const [competicoes, setCompeticoes] = useState<Competicao[]>([]);
  const [placar, setPlacar] = useState<Placar | null>(null);
  const [competicaoAtual, setCompeticaoAtual] = useState<Competicao | null>(null);
  const [votos, setVotos] = useState<Voto[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPlacar, setLoadingPlacar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [gerandoAnalise, setGerandoAnalise] = useState(false);
  const [votando, setVotando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [encerrandoAgora, setEncerrandoAgora] = useState(false);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const [modalParabens, setModalParabens] = useState<string | null>(null);
  const [editandoVoto, setEditandoVoto] = useState(false);
  // Total de eleitores elegíveis (CEO + conselheiros da Matriz). Alimenta
  // o quórum dinâmico (maioria simples). RPC contar_votantes_matriz.
  const [totalVotantes, setTotalVotantes] = useState<number>(0);

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

  const carregarLista = useCallback(async () => {
    if (!supabase) return;
    setLoadingList(true);
    const { data } = await supabase
      .from('competicoes_matriz')
      .select('id, nome, descricao, data_inicio, data_fim, status, vencedora, analise_ia, placar_snapshot, created_at')
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
    })();
  }, [podeAcessar]);

  const quorumMinimo = useMemo(
    () => Math.max(1, Math.ceil((totalVotantes || 1) / 2)),
    [totalVotantes],
  );

  const carregarVotos = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('competicao_votos')
      .select('id, competicao_id, votante_id, voto, filial_escolhida, comentario, created_at')
      .eq('competicao_id', id)
      .order('created_at', { ascending: true });
    setVotos(data ?? []);
  }, []);

  const carregarPlacar = useCallback(async (comp: Competicao) => {
    if (!supabase) return;
    setLoadingPlacar(true);
    setPlacar(null);
    setCompeticaoAtual(comp);
    const { data, error } = await supabase.rpc('calcular_placar_competicao', { p_competicao_id: comp.id });
    if (error) {
      showToast?.(`Erro ao calcular placar: ${error.message}`, 'error');
    } else {
      setPlacar(data as Placar);
    }
    await carregarVotos(comp.id);
    setLoadingPlacar(false);
  }, [showToast, carregarVotos]);

  useEffect(() => {
    // Prioridade: em_andamento > aguardando_encerramento > última encerrada
    const alvo = ativa ?? aguardando[0] ?? competicoes.find(c => c.status === 'encerrada') ?? null;
    if (alvo) carregarPlacar(alvo);
    else { setPlacar(null); setCompeticaoAtual(null); }
  }, [ativa, aguardando, competicoes, carregarPlacar]);

  const jaVotei = useMemo(() => votos.some(v => v.votante_id === profile.id), [votos, profile.id]);
  const contagemVotos = useMemo(() => ({
    aceita:  votos.filter(v => v.voto === 'aceita').length,
    rejeita: votos.filter(v => v.voto === 'rejeita').length,
  }), [votos]);

  // Sincroniza o voto que o usuário já registrou (pra permitir editar).
  useEffect(() => {
    const meu = votos.find(v => v.votante_id === profile.id) ?? null;
    setMeuVotoAtual(meu);
    if (meu && editandoVoto) {
      setMeuVoto(meu.voto);
      setComentario(meu.comentario ?? '');
      setFilialSugerida((meu.filial_escolhida as FilialOp) ?? '');
    }
  }, [votos, profile.id, editandoVoto]);

  // Sugestão de vencedora quando conselho rejeita o placar automático:
  // filial mais votada nos "rejeita → filial_escolhida". Empate ou sem
  // rejeição → mantém o 1º do pódio.
  const sugestaoRejeicao = useMemo(() => {
    if (contagemVotos.rejeita <= contagemVotos.aceita) return null;
    const contagem: Record<string, number> = {};
    votos.forEach(v => {
      if (v.voto === 'rejeita' && v.filial_escolhida) {
        contagem[v.filial_escolhida] = (contagem[v.filial_escolhida] ?? 0) + 1;
      }
    });
    const entries = Object.entries(contagem);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length > 1 && entries[0][1] === entries[1][1]) return null;
    return entries[0][0] as FilialOp;
  }, [votos, contagemVotos]);

  const gerarAnalise = async () => {
    if (!competicaoAtual || !session?.access_token) return;
    setGerandoAnalise(true);
    try {
      const resp = await fetch('/api/ai-competicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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

  const declararVencedora = async (filial: FilialOp) => {
    if (!competicaoAtual || !supabase) return;
    if (!await confirm({
      message: `Confirma declarar ${filial} como vencedora de "${competicaoAtual.nome}"?`,
      confirmLabel: 'Declarar vencedora',
    })) return;
    setEncerrando(true);
    const { error } = await supabase.rpc('declarar_vencedora', {
      p_competicao_id: competicaoAtual.id,
      p_vencedora: filial,
    });
    setEncerrando(false);
    if (error) return showToast?.(`Erro: ${error.message}`, 'error');
    setModalParabens(filial);
    await carregarLista();
  };

  const excluirCompeticao = async (c: Competicao) => {
    if (!supabase) return;
    if (!await confirm({
      message: `Excluir "${c.nome}" definitivamente da lista? Use pra descartar competições de teste. Essa ação não pode ser desfeita pela UI.`,
      confirmLabel: 'Excluir',
      danger: true,
    })) return;
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
  const podio = useMemo(() => {
    if (!placar) return [];
    return OP_FILIAIS
      .map(f => ({
        filial: f,
        media: Number(placar.por_filial?.[f]?.media ?? 0),
        n:     Number(placar.por_filial?.[f]?.n ?? 0),
      }))
      .sort((a, b) => b.media - a.media);
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

  const baixarPdfResultado = async () => {
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
      );
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setBaixandoPdf(false);
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
            <div className="neu-flat rounded-3xl p-12 border border-white/5">
              <EmptyState message={podeGerenciar
                ? 'Nenhuma competição em andamento. Vá em Config pra criar.'
                : 'Nenhuma competição em andamento. Aguarde admin/CEO abrir uma.'} />
            </div>
          ) : (
            <>
              {/* Cabeçalho da competição + pódio */}
              <div className="neu-flat rounded-3xl p-6 border border-accent/20">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Competição ativa</p>
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
                    <button
                      onClick={baixarPdfResultado}
                      disabled={baixandoPdf}
                      className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all disabled:opacity-50"
                      title="Baixar resultado por filial em PDF"
                    >
                      {baixandoPdf ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                      Baixar PDF
                    </button>
                    {placar.competicao.status === 'em_andamento' && navigate && (
                      <button
                        onClick={() => navigate('matriz-avaliacoes')}
                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 transition-all"
                        title="Avaliar itens das 3 filiais"
                      >
                        <Award size={12} /> Central de Avaliação
                      </button>
                    )}
                    {podeGerenciar && placar.competicao.status === 'em_andamento' && (
                      <button
                        onClick={encerrarAgora}
                        disabled={encerrandoAgora}
                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-red-400 hover:ring-1 hover:ring-red-400/40 transition-all"
                        title="Força encerramento antes da data_fim"
                      >
                        {encerrandoAgora ? <Loader2 size={12} className="animate-spin" /> : <StopCircle size={12} />}
                        Encerrar agora
                      </button>
                    )}
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg ${
                      placar.competicao.status === 'em_andamento'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                    }`}>
                      {placar.competicao.status === 'em_andamento' ? 'Em andamento' : 'Aguardando encerramento'}
                    </span>
                    {podeGerenciar && competicaoAtual && (
                      <button
                        onClick={() => excluirCompeticao(competicaoAtual)}
                        disabled={excluindo === competicaoAtual.id}
                        title="Excluir competição (uso pra descartar testes)"
                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-gray-500 hover:text-red-400 hover:ring-1 hover:ring-red-400/40 transition-all"
                      >
                        {excluindo === competicaoAtual.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Excluir
                      </button>
                    )}
                  </div>
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
                      <p className={`text-xs font-black uppercase tracking-wider ${FILIAL_COLOR[p.filial as FilialOp]}`}>{p.filial}</p>
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
                        <th className="text-right pb-3 font-bold pr-4">Notas registradas</th>
                        <th className="text-right pb-3 font-bold pr-4">Média (0-10)</th>
                        <th className="text-right pb-3 font-bold pr-4">Escala 0-100</th>
                      </tr>
                    </thead>
                    <tbody>
                      {podio.map(p => {
                        const isBest = p.n > 0 && p.media === Math.max(...podio.map(x => x.n > 0 ? x.media : -Infinity));
                        return (
                          <tr key={p.filial} className="border-t border-white/5">
                            <td className={`py-3 font-bold ${FILIAL_COLOR[p.filial as FilialOp]}`}>{p.filial}</td>
                            <td className="py-3 text-right text-gray-300 tabular-nums pr-4">{p.n}</td>
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
                  Média das notas 0-10 que CEO/conselheiros deram aos participantes das Tarefas da Matriz, agrupada pela filial do participante.
                </p>
              </div>

              {/* Análise IA */}
              {competicaoAtual && competicaoAtual.status !== 'em_andamento' && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <Sparkles size={13} className="text-accent" /> Análise IA
                    </h3>
                    {competicaoAtual.status !== 'encerrada' && (
                      <NeuButtonAccent onClick={gerarAnalise} disabled={gerandoAnalise} variant="">
                        {gerandoAnalise
                          ? <><Loader2 size={12} className="animate-spin" /> Analisando…</>
                          : <><Sparkles size={12} /> {competicaoAtual.analise_ia ? 'Regenerar' : 'Gerar análise'}</>}
                      </NeuButtonAccent>
                    )}
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
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && podeVotar && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <MessageCircle size={13} className="text-accent" /> Votação do conselho
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold">
                      <span className="text-emerald-400">Aceita: {contagemVotos.aceita}</span>
                      <span className="text-red-400">Rejeita: {contagemVotos.rejeita}</span>
                      <span className={votos.length >= quorumMinimo ? 'text-emerald-400' : 'text-yellow-400'}>
                        Quórum: {votos.length}/{quorumMinimo}
                      </span>
                    </div>
                  </div>

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

                  {votos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2">
                        Votos registrados ({votos.length})
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {votos.map(v => (
                          <div key={v.id} className="flex items-start gap-2 text-xs">
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                              v.voto === 'aceita'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}>
                              {v.voto === 'aceita' ? 'Aceita' : `Rejeita → ${v.filial_escolhida}`}
                            </span>
                            <span className="text-gray-400 truncate">{v.comentario ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Aguardando votação — visão somente-leitura pra quem gerencia mas não vota (admin) */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && !podeVotar && (
                <div className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                      <MessageCircle size={13} className="text-accent" /> Votação do conselho
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold">
                      <span className="text-emerald-400">Aceita: {contagemVotos.aceita}</span>
                      <span className="text-red-400">Rejeita: {contagemVotos.rejeita}</span>
                      <span className={votos.length >= quorumMinimo ? 'text-emerald-400' : 'text-yellow-400'}>
                        Quórum: {votos.length}/{quorumMinimo}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Aguardando CEO e conselheiros votarem pra declarar a filial vencedora. Nenhuma ação sua é necessária aqui.
                  </p>
                  {votos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2">
                        Votos registrados ({votos.length})
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {votos.map(v => (
                          <div key={v.id} className="flex items-start gap-2 text-xs">
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                              v.voto === 'aceita'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}>
                              {v.voto === 'aceita' ? 'Aceita' : `Rejeita → ${v.filial_escolhida}`}
                            </span>
                            <span className="text-gray-400 truncate">{v.comentario ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Declaração de vencedora — quórum dinâmico (maioria simples dos eleitores) */}
              {competicaoAtual && competicaoAtual.status === 'aguardando_encerramento' && podeVotar && votos.length >= quorumMinimo && (() => {
                const sugerida = sugestaoRejeicao ?? podio[0]?.filial;
                const origem = sugestaoRejeicao ? 'maioria do conselho rejeitou o placar' : 'placar automático';
                return (
                  <div className="neu-flat rounded-3xl p-5 border border-accent/30">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2 mb-2">
                      <Crown size={13} className="text-accent" /> Declarar vencedora
                    </h3>
                    <p className="text-xs text-gray-400 mb-4">
                      Sugestão ({origem}): <span className="text-emerald-400 font-bold">{sugerida}</span>
                      {!sugestaoRejeicao && podio[0] && podio[0].n > 0 && <> (nota média {(podio[0].media / 10).toFixed(1)})</>}.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {OP_FILIAIS.map(f => {
                        const isSugerida = f === sugerida;
                        return (
                          <button key={f} onClick={() => declararVencedora(f)} disabled={encerrando}
                            className={`neu-button rounded-xl p-3 text-xs font-bold uppercase tracking-widest transition-colors ${FILIAL_COLOR[f]} hover:border-accent ${isSugerida ? 'ring-2 ring-accent/60' : ''}`}
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
                  </div>
                );
              })()}

              {/* Estado encerrado — mostra vencedora + votos */}
              {competicaoAtual && competicaoAtual.status === 'encerrada' && (
                <div className="neu-flat rounded-3xl p-6 border border-emerald-500/30 text-center">
                  <Crown size={32} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Vencedora declarada</p>
                  <p className={`text-2xl font-black tracking-wider mt-1 ${FILIAL_COLOR[competicaoAtual.vencedora as FilialOp]}`}>
                    🏆 {competicaoAtual.vencedora}
                  </p>
                  {votos.length > 0 && (
                    <p className="text-[10px] text-gray-500 mt-3">
                      {contagemVotos.aceita} aceita · {contagemVotos.rejeita} rejeita
                    </p>
                  )}
                </div>
              )}
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
                className="absolute top-4 right-4 text-gray-500 hover:text-white">
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
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg ${
                        c.status === 'em_andamento' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : c.status === 'aguardando_encerramento' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                          : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                      }`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                      <button
                        onClick={() => excluirCompeticao(c)}
                        disabled={excluindo === c.id}
                        title="Excluir competição (uso pra descartar testes)"
                        className="flex items-center justify-center w-7 h-7 rounded-lg neu-button text-gray-500 hover:text-red-400 hover:ring-1 hover:ring-red-400/40 transition-all shrink-0"
                      >
                        {excluindo === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
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
                        {c.vencedora && (
                          <span className={`text-sm font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 ${FILIAL_COLOR[c.vencedora as FilialOp] ?? ''}`}>
                            🏆 {c.vencedora}
                          </span>
                        )}
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
