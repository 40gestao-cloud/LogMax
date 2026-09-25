import { isConselheiro } from '../lib/rbac';
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2, Lock, Calendar, CheckCircle2, X, Edit3, History, ListTodo, AlertTriangle, Send, Trash2, RefreshCw } from 'lucide-react';
import { BotaoWhatsApp } from '../components/BotaoWhatsApp';
import { montarMensagemWhats } from '../lib/whatsappShare';
import { supabase } from '../lib/supabase';
import { notificarSetor } from '../lib/notificar';
import { freshToken } from '../lib/authFetch';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { FILIAIS } from '../components/FilialSelector';

const SETOR_LABEL: Record<string, string> = {
  empresa:    'Empresa',
  compras:    'Compras',
  estoque:    'Estoque',
  financeiro: 'Financeiro',
  rh:         'Recursos Humanos',
  vendas:     'Vendas',
  marketing:  'Marketing',
};

const SETOR_COLOR: Record<string, string> = {
  empresa:    'bg-purple-500/10  text-purple-400  border-purple-500/20',
  compras:    'bg-amber-500/10   text-amber-400   border-amber-500/20',
  estoque:    'bg-blue-500/10    text-blue-400    border-blue-500/20',
  financeiro: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rh:         'bg-pink-500/10    text-pink-400    border-pink-500/20',
  vendas:     'bg-cyan-500/10    text-cyan-400    border-cyan-500/20',
  marketing:  'bg-orange-500/10  text-orange-400  border-orange-500/20',
};

const JANELAS_OPCOES = [7, 15, 30] as const;
type JanelaDias = typeof JANELAS_OPCOES[number];

const PRIO_BADGE: Record<string, string> = {
  'Alta':  'bg-red-500/10    text-red-400    border-red-500/20',
  'Média': 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Baixa': 'bg-gray-500/10   text-gray-400   border-gray-500/20',
};

type TarefaProposta = {
  _id: string;
  modulo: string;
  titulo: string;
  descricao: string;
  prioridade: 'Alta' | 'Média' | 'Baixa';
  prazo_dias: number;
  contexto_origem: string;
  aprovada: boolean;
  descartada: boolean;
  editada: boolean;
};

type Briefing = {
  id: string;
  data_referencia: string;
  janela_dias: JanelaDias;
  status: 'rascunho_ia' | 'aprovado_parcial' | 'aprovado_total' | 'descartado';
  dados_snapshot: any;
  tarefas_propostas: TarefaProposta[];
  total_propostas: number;
  total_aprovadas: number;
  gerado_por: string | null;
  nome_gerador: string | null;
  aprovado_por: string | null;
  nome_aprovador: string | null;
  modelo_ia: string | null;
  created_at: string;
};

const todayAcre = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Rio_Branco',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

const fmtDataBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const briefingParaTextoWhats = (tarefas: TarefaProposta[]): string => {
  const ativas = tarefas.filter(t => !t.descartada);
  if (ativas.length === 0) return '_Nenhuma tarefa proposta._';
  return ativas
    .map(t => `• *${t.titulo}* (${t.prioridade}, ${t.prazo_dias}d)\n  ${t.descricao}`)
    .join('\n\n');
};

const dataMaisDias = (iso: string, dias: number): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const BriefingDiarioView = ({ showToast, profile }: any) => {
  const confirm = useConfirm();
  const podeAcessar = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

  const [dataRef, setDataRef]     = useState(todayAcre());
  const [janelaDias, setJanelaDias] = useState<JanelaDias>(7);
  const [briefing, setBriefing]   = useState<Briefing | null>(null);
  const [tarefas, setTarefas]     = useState<TarefaProposta[]>([]);
  const [loading, setLoading]     = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [erro, setErro]           = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState<{ titulo: string; descricao: string; prazo_dias: number }>({ titulo: '', descricao: '', prazo_dias: 3 });

  const [historico, setHistorico] = useState<Briefing[]>([]);
  const [showHistorico, setShowHistorico] = useState(false);

  // Tarefas agrupadas por setor (só não descartadas)
  const porSetor = useMemo(() => {
    const m: Record<string, TarefaProposta[]> = {};
    for (const t of tarefas) {
      if (t.descartada) continue;
      (m[t.modulo] ??= []).push(t);
    }
    return m;
  }, [tarefas]);

  const totalAtivas    = tarefas.filter(t => !t.descartada).length;
  const totalAprovadas = tarefas.filter(t => t.aprovada && !t.descartada).length;
  // isAprovado: já passou pelo "Enviar pros setores". Não permite re-aprovar
  // nem desmarcar (checkbox + footer somem), mas admin/CEO ainda pode editar
  // OU descartar tarefas individuais — as mudanças vão pro DB via RPC e
  // propagam pras linhas em tarefas/marketing_tarefas que ainda estão
  // Pendente (preserva trabalho já iniciado).
  const isAprovado     = briefing?.status === 'aprovado_total' || briefing?.status === 'aprovado_parcial';

  // Carrega briefing existente da combinação (data, janela) se houver.
  // O UNIQUE no DB é parcial (data + janela_dias) — trocar a janela pode
  // mostrar um briefing diferente do mesmo dia.
  useEffect(() => {
    if (!podeAcessar || !supabase) return;
    (async () => {
      const { data } = await supabase
        .from('briefings_diarios')
        .select('*')
        .eq('data_referencia', dataRef)
        .eq('janela_dias', janelaDias)
        .eq('ativo', true)
        .neq('status', 'descartado')
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setBriefing(data[0]);
        setTarefas(data[0].tarefas_propostas ?? []);
      } else {
        setBriefing(null);
        setTarefas([]);
      }
    })();
  }, [podeAcessar, dataRef, janelaDias]);

  const carregarHistorico = async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('briefings_diarios')
      .select('id, data_referencia, status, total_propostas, total_aprovadas, nome_gerador, nome_aprovador, created_at')
      .eq('ativo', true)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistorico((data ?? []) as Briefing[]);
  };
  useEffect(() => { if (podeAcessar) carregarHistorico(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [podeAcessar]);

  const gerar = async (forcar = false) => {
    const jwt = await freshToken();
    if (!jwt) { setErro('Sessão expirada.'); return; }
    setLoading(true);
    setErro(null);

    // Se forçar e existe briefing, descarta antes pra liberar o UNIQUE parcial.
    if (forcar && briefing && supabase) {
      await supabase.from('briefings_diarios')
        .update({ status: 'descartado' })
        .eq('id', briefing.id);
      setBriefing(null);
      setTarefas([]);
    }

    try {
      const resp = await fetch('/api/ai-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ data: dataRef, janela_dias: janelaDias }),
      });
      const data = await resp.json();
      if (!resp.ok) { setErro(data?.error ?? 'Falha na IA.'); setLoading(false); return; }
      setBriefing(data);
      setTarefas(data.tarefas_propostas ?? []);
      if (data.from_cache) showToast?.('Briefing existente recuperado.', 'success');
      else showToast?.(`Briefing gerado com ${(data.tarefas_propostas ?? []).length} tarefas.`, 'success');
      carregarHistorico();
    } catch (err: any) {
      setErro(err?.message ?? 'Erro de rede.');
    }
    setLoading(false);
  };

  // Aprovação só faz sentido em rascunho. Briefing já enviado pros setores
  // (aprovado_parcial/total) não tem como "re-aprovar" — admin pode editar
  // ou descartar tarefas individuais via RPC (abaixo).
  const toggleAprovacao = (id: string) => {
    if (isAprovado) return;
    setTarefas(prev => prev.map(t => t._id === id ? { ...t, aprovada: !t.aprovada } : t));
  };

  const aprovarTodas = () => {
    if (isAprovado) return;
    setTarefas(prev => prev.map(t => t.descartada ? t : { ...t, aprovada: true }));
  };

  const desmarcarTodas = () => {
    if (isAprovado) return;
    setTarefas(prev => prev.map(t => ({ ...t, aprovada: false })));
  };

  const parseIdx = (id: string): number => {
    const m = /^t-(\d+)$/.exec(id);
    return m ? Number(m[1]) : 0;
  };

  // Descartar tarefa individual: em rascunho_ia é só state local (vai pro DB
  // quando aprovar). Em briefing já aprovado, RPC propaga: marca descartada
  // no JSON + apaga linha em tarefas/marketing_tarefas (se Pendente).
  const descartar = async (id: string) => {
    if (!isAprovado) {
      setTarefas(prev => prev.map(t => t._id === id ? { ...t, descartada: true, aprovada: false } : t));
      return;
    }
    if (!briefing || !supabase) return;
    if (!await confirm('Descartar esta tarefa? Se algum setor ainda não começou a executar, ela some imediatamente do submenu Tarefas.')) return;
    try {
      const { data, error } = await supabase.rpc('descartar_tarefa_briefing', {
        p_briefing_id: briefing.id,
        p_idx:         parseIdx(id),
      });
      if (error) throw error;
      setTarefas(prev => prev.map(t => t._id === id ? { ...t, descartada: true, aprovada: false } : t));
      const apagada = (data as any)?.tarefa_apagada === true;
      showToast?.(apagada ? 'Tarefa descartada e removida do setor.' : 'Tarefa descartada. (Setor já havia iniciado — linha mantida.)', 'success');
      carregarHistorico();
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
  };

  const abrirEdicao = (t: TarefaProposta) => {
    setEditandoId(t._id);
    setEditForm({ titulo: t.titulo, descricao: t.descricao, prazo_dias: t.prazo_dias });
  };

  // Em rascunho_ia, salva no state local (vai pro DB quando aprovar). Em
  // briefing já aprovado, chama RPC que atualiza JSON + propaga pra tarefas
  // derivadas Pendentes em tarefas/marketing_tarefas.
  const salvarEdicao = async () => {
    if (!editandoId) return;
    if (!editForm.titulo.trim()) { showToast?.('Título não pode ficar vazio.', 'error'); return; }
    const prazoDias = Math.max(1, Math.min(14, editForm.prazo_dias));
    const tarefaAtual = tarefas.find(t => t._id === editandoId);
    if (!tarefaAtual) { setEditandoId(null); return; }

    if (isAprovado && briefing && supabase) {
      try {
        const { data, error } = await supabase.rpc('editar_tarefa_briefing', {
          p_briefing_id: briefing.id,
          p_idx:         parseIdx(editandoId),
          p_titulo:      editForm.titulo.trim(),
          p_descricao:   editForm.descricao.trim(),
          p_prioridade:  tarefaAtual.prioridade,
          p_prazo_dias:  prazoDias,
        });
        if (error) throw error;
        const propagada = (data as any)?.tarefa_propagada === true;
        showToast?.(propagada ? 'Tarefa atualizada no briefing e no setor.' : 'Tarefa atualizada no briefing. (Setor já iniciou — linha mantida intacta.)', 'success');
        carregarHistorico();
      } catch (err: any) {
        showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
        return;
      }
    }

    setTarefas(prev => prev.map(t => t._id === editandoId
      ? { ...t, titulo: editForm.titulo.trim(), descricao: editForm.descricao.trim(), prazo_dias: prazoDias, editada: true }
      : t,
    ));
    setEditandoId(null);
  };

  const aprovarSelecionadas = async () => {
    if (!briefing || !supabase) return;
    const aprovadas = tarefas.filter(t => t.aprovada && !t.descartada);
    if (aprovadas.length === 0) {
      showToast?.('Selecione pelo menos uma tarefa pra aprovar.', 'error');
      return;
    }
    setAprovando(true);
    try {
      // 1. Insere as tarefas aprovadas em DUAS tabelas distintas:
      //    - `tarefas` (genérica)        → todos os módulos exceto marketing
      //    - `marketing_tarefas` (própria) → marketing
      // Marketing tem fluxo próprio (status "Em Produção", "Postado", link
      // aprovação) — não cabe em `tarefas`. Ambas tabelas ganharam origem/
      // briefing_id/contexto via migração 20260615c.
      const nomeCriador = `IA (briefing ${fmtDataBR(briefing.data_referencia)})`;
      const prazoIso = (prazoDias: number) => dataMaisDias(briefing.data_referencia, prazoDias);

      const aprovadasGenericas = aprovadas.filter(t => t.modulo !== 'marketing');
      const aprovadasMarketing = aprovadas.filter(t => t.modulo === 'marketing');

      // Extrai índice estável do _id ("t-N" → N) — usado pra linkar a tarefa
      // derivada ao item no JSON pra propagar edições/exclusões posteriores
      // via RPCs editar_tarefa_briefing / descartar_tarefa_briefing.
      const parseIdx = (id: string): number => {
        const m = /^t-(\d+)$/.exec(id);
        return m ? Number(m[1]) : 0;
      };

      // Fanout: cada tarefa aprovada vira 1 cópia por filial operacional
      // (SuperMax/MaxLook/TechMax). Colaborador de cada filial vê a própria cópia
      // via RLS. RPCs de edição/descarte usam briefing_id + briefing_tarefa_idx
      // pra propagar mudança nas 3 cópias juntas.
      if (aprovadasGenericas.length > 0) {
        const payload = aprovadasGenericas.flatMap(t => FILIAIS.map(filial => ({
          modulo:               t.modulo,
          titulo:               t.titulo,
          descricao:            t.descricao,
          prioridade:           t.prioridade,
          prazo:                prazoIso(t.prazo_dias),
          status:               'Pendente',
          nome_criador:         nomeCriador,
          criado_por:           profile?.id ?? null,
          origem:               'briefing_ia',
          briefing_id:          briefing.id,
          briefing_tarefa_idx:  parseIdx(t._id),
          contexto:             t.contexto_origem || null,
          filial,
        })));
        const { error: insErr } = await supabase.from('tarefas').insert(payload);
        if (insErr) throw insErr;
      }

      if (aprovadasMarketing.length > 0) {
        // marketing_tarefas não tem coluna `modulo` (é implicitamente marketing).
        const payload = aprovadasMarketing.flatMap(t => FILIAIS.map(filial => ({
          titulo:               t.titulo,
          descricao:            t.descricao,
          prioridade:           t.prioridade,
          prazo:                prazoIso(t.prazo_dias),
          status:               'Pendente',
          nome_criador:         nomeCriador,
          criado_por:           profile?.id ?? null,
          origem:               'briefing_ia',
          briefing_id:          briefing.id,
          briefing_tarefa_idx:  parseIdx(t._id),
          contexto:             t.contexto_origem || null,
          filial,
        })));
        const { error: insErr } = await supabase.from('marketing_tarefas').insert(payload);
        if (insErr) throw insErr;
      }

      // 2. Atualiza o briefing com flags + status final.
      const restantes = tarefas.filter(t => !t.descartada && !t.aprovada).length;
      const novoStatus = restantes === 0 ? 'aprovado_total' : 'aprovado_parcial';
      const { data: updBriefing, error: updErr } = await supabase
        .from('briefings_diarios')
        .update({
          tarefas_propostas: tarefas,
          total_aprovadas:   aprovadas.length,
          status:            novoStatus,
          aprovado_por:      profile?.id ?? null,
          nome_aprovador:    profile?.nome ?? null,
        })
        .eq('id', briefing.id)
        .select()
        .single();
      if (updErr) throw updErr;

      // 3. Notifica cada setor uma única vez.
      const setoresAfetados = Array.from(new Set(aprovadas.map(a => a.modulo)));
      for (const s of setoresAfetados) {
        const qtd = aprovadas.filter(a => a.modulo === s).length;
        // filial null de propósito: cada tarefa ganhou uma cópia por unidade
        // (fanout acima), então o aviso é mesmo para todas.
        await notificarSetor({
          setor:     s,
          tipo:      'briefing_diario',
          titulo:    `Nova pauta: ${qtd} tarefa(s) do briefing diário`,
          mensagem:  `Confira no submenu Tarefas do módulo ${SETOR_LABEL[s]}.`,
          link_view: `${s}-tarefas`,
          ref_id:    briefing.id,
          filial:    null,
        });
      }

      setBriefing(updBriefing);
      showToast?.(`${aprovadas.length} tarefa(s) enviadas pros setores.`, 'success');
      carregarHistorico();
    } catch (err: any) {
      console.error('[Briefing] aprovar:', err);
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
    setAprovando(false);
  };

  // Exclusão definitiva: usa RPC com cascade.
  //   - rascunho_ia: só marca como descartado (nenhuma tarefa derivada existe ainda).
  //   - aprovado_*: marca briefing + APAGA tarefas derivadas Pendentes em
  //     tarefas/marketing_tarefas. Tarefas Em Andamento/Concluído ficam (não
  //     destrói trabalho já iniciado).
  const excluirBriefing = async () => {
    if (!briefing || !supabase) return;
    const msg = isAprovado
      ? 'Excluir este briefing? As tarefas Pendentes nos setores vão sumir. As que já estão Em Andamento ou Concluído são preservadas.'
      : 'Descartar este briefing? Você poderá gerar outro pro mesmo dia.';
    if (!await confirm(msg)) return;
    try {
      const { data, error } = await supabase.rpc('excluir_briefing_cascade', {
        p_briefing_id: briefing.id,
      });
      if (error) throw error;
      setBriefing(null);
      setTarefas([]);
      const r = data as any;
      const total = (r?.tarefas_apagadas ?? 0) + (r?.marketing_apagadas ?? 0);
      showToast?.(
        total > 0 ? `Briefing excluído. ${total} tarefa(s) Pendente(s) removida(s) dos setores.` : 'Briefing excluído.',
        'success',
      );
      carregarHistorico();
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
  };

  const carregarBriefingAntigo = async (id: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('briefings_diarios').select('*').eq('id', id).single();
    if (data) {
      setBriefing(data);
      setTarefas(data.tarefas_propostas ?? []);
      setDataRef(data.data_referencia);
      // Briefings antigos podem não ter janela_dias — cai pro 7 antigo.
      if (data.janela_dias && JANELAS_OPCOES.includes(data.janela_dias)) {
        setJanelaDias(data.janela_dias);
      }
      setShowHistorico(false);
    }
  };

  if (!podeAcessar) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="neu-flat rounded-3xl p-8 border border-white/5 max-w-md text-center">
          <Lock size={28} className="text-gray-500 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-gray-300 mb-2">Acesso restrito</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            O Briefing Diário é exclusivo para <strong className="text-gray-300">Admin e CEO</strong>.
            As tarefas aprovadas aparecem no submenu <strong className="text-gray-300">Tarefas</strong> de cada setor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Briefing Diário</h2>
      </div>

      {/* Filtros + ação */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar size={14} className="text-gray-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Data</span>
          <input type="date" value={dataRef} onChange={e => setDataRef(e.target.value)}
            className="neu-input rounded-lg px-3 py-2 text-xs" />
          <button onClick={() => setDataRef(todayAcre())}
            className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors">
            hoje
          </button>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 ml-3">Janela</span>
          <div className="flex items-center gap-1 neu-pressed rounded-lg p-0.5 border border-white/5"
            title="Quantos dias para trás o snapshot do BI considera">
            {JANELAS_OPCOES.map(d => (
              <button key={d} onClick={() => setJanelaDias(d)}
                className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md transition-colors ${
                  janelaDias === d
                    ? 'bg-accent/15 text-accent'
                    : 'text-gray-500 hover:text-gray-300'
                }`}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        {briefing && (
          <button onClick={() => setShowHistorico(s => !s)}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors">
            <History size={11} />Histórico ({historico.length})
          </button>
        )}
        {!briefing && (
          <NeuButtonAccent variant="" onClick={() => gerar(false)} disabled={loading}>
            {loading ? <><Loader2 size={14} className="animate-spin" />Analisando…</> : <><Sparkles size={14} />Gerar Briefing do Dia</>}
          </NeuButtonAccent>
        )}
        {briefing && !isAprovado && (
          <button onClick={() => gerar(true)} disabled={loading}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest border border-yellow-400/30 text-yellow-400 rounded-lg px-3 py-2 hover:bg-yellow-400/10 transition-colors">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />Gerar nova versão
          </button>
        )}
      </div>

      {erro && (
        <div className="neu-pressed rounded-2xl p-4 border border-red-500/30 shrink-0">
          <p className="text-xs text-red-400">{erro}</p>
        </div>
      )}

      {/* Histórico expansível */}
      <AnimatePresence>
        {showHistorico && historico.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden shrink-0">
            <div className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Briefings recentes</p>
              {historico.map(h => (
                <button key={h.id} onClick={() => carregarBriefingAntigo(h.id)}
                  className="text-left flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-300">{fmtDataBR(h.data_referencia)}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                      h.status === 'aprovado_total'   ? 'text-accent border border-accent/30' :
                      h.status === 'aprovado_parcial' ? 'text-yellow-400 border border-yellow-400/30' :
                      h.status === 'descartado'       ? 'text-red-400 border border-red-400/30' :
                                                        'text-gray-400 border border-white/10'
                    }`}>{h.status.replace('_', ' ')}</span>
                    <span className="text-[10px] text-gray-500">{h.total_aprovadas}/{h.total_propostas} aprovadas</span>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conteúdo do briefing */}
      {loading && !briefing && (
        <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>
      )}

      {!loading && !briefing && (
        <div className="neu-flat rounded-3xl p-12 border border-white/5 shrink-0">
          <EmptyState message='Selecione a data e clique em "Gerar Briefing do Dia" pra a IA analisar o ERP e propor as tarefas.' />
        </div>
      )}

      {briefing && (
        <>
          {/* Status do briefing */}
          <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Briefing de {fmtDataBR(briefing.data_referencia)} · janela {briefing.janela_dias ?? 7}d</p>
              <p className="text-sm text-gray-300 mt-1">
                {briefing.total_propostas} tarefa(s) propostas
                {isAprovado && <> · <span className="text-accent">{briefing.total_aprovadas} aprovadas</span></>}
                {briefing.nome_gerador && <span className="text-gray-500"> · gerado por {briefing.nome_gerador}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Em rascunho: ações de aprovação em lote + descartar */}
              {!isAprovado && (
                <>
                  <button onClick={aprovarTodas}
                    className="text-[10px] font-bold uppercase tracking-widest border border-accent/30 text-accent rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors">
                    Aprovar todas
                  </button>
                  <button onClick={desmarcarTodas}
                    className="text-[10px] font-bold uppercase tracking-widest border border-white/10 text-gray-400 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                    Desmarcar
                  </button>
                </>
              )}
              {/* Em briefing aprovado: badge de status */}
              {isAprovado && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-1.5">
                  <CheckCircle2 size={10} />Briefing aplicado
                </span>
              )}
              <BotaoWhatsApp
                showToast={showToast}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-white/10 text-gray-400 rounded-lg px-3 py-1.5 hover:text-accent hover:border-accent/40 transition-colors"
                getTexto={() => montarMensagemWhats({
                  titulo: 'Briefing Diário',
                  subtitulo: `${fmtDataBR(briefing.data_referencia)} · janela ${briefing.janela_dias ?? 7}d`,
                  corpoMarkdown: briefingParaTextoWhats(tarefas),
                })}
              />
              {/* Excluir sempre disponível pra admin/CEO — RPC propaga */}
              <button onClick={excluirBriefing}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-red-400/30 text-red-400 rounded-lg px-3 py-1.5 hover:bg-red-400/10 transition-colors">
                <Trash2 size={10} />Excluir briefing
              </button>
            </div>
          </div>

          {/* Tarefas agrupadas por setor */}
          {Object.keys(porSetor).length === 0 ? (
            <div className="neu-flat rounded-3xl p-8 border border-white/5 shrink-0">
              <EmptyState message="Todas as tarefas foram descartadas. Você pode descartar o briefing inteiro e gerar outro." />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(porSetor).map(([setor, lista]) => (
                <div key={setor} className="neu-flat rounded-3xl p-5 border border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${SETOR_COLOR[setor] ?? ''}`}>
                      <ListTodo size={10} />{SETOR_LABEL[setor] ?? setor}
                    </span>
                    <span className="text-[10px] text-gray-500">{lista.length} tarefa(s)</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {lista.map(t => (
                      <div key={t._id} className={`neu-pressed rounded-xl p-4 border transition-colors ${
                        t.aprovada ? 'border-accent/30 bg-accent/5' : 'border-white/5'
                      }`}>
                        {editandoId === t._id ? (
                          <div className="flex flex-col gap-2">
                            <input type="text" value={editForm.titulo}
                              onChange={e => setEditForm(f => ({ ...f, titulo: e.target.value }))}
                              className="neu-input rounded-lg px-3 py-2 text-xs font-bold" />
                            <textarea value={editForm.descricao} rows={2}
                              onChange={e => setEditForm(f => ({ ...f, descricao: e.target.value }))}
                              className="neu-input rounded-lg px-3 py-2 text-xs resize-none" />
                            <div className="flex items-center gap-2">
                              <label htmlFor={`prazo-${t._id}`} className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Prazo (dias)</label>
                              <input id={`prazo-${t._id}`} type="number" min={1} max={14}
                                value={editForm.prazo_dias}
                                onChange={e => setEditForm(f => ({ ...f, prazo_dias: Number(e.target.value) }))}
                                className="neu-input rounded-lg px-2 py-1 text-xs w-20" />
                              <div className="flex-1" />
                              <button onClick={() => setEditandoId(null)}
                                className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-white px-3 py-1.5">
                                Cancelar
                              </button>
                              <button onClick={salvarEdicao}
                                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-1.5 hover:bg-accent/10">
                                <CheckCircle2 size={10} />Salvar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            {/* Checkbox de aprovação só em rascunho */}
                            {!isAprovado && (
                              <button onClick={() => toggleAprovacao(t._id)}
                                className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mt-0.5 ${
                                  t.aprovada ? 'bg-accent border-accent' : 'border-white/20 hover:border-accent/50'
                                }`}>
                                {t.aprovada && <CheckCircle2 size={12} className="text-black" />}
                              </button>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <p className="text-sm font-bold text-gray-200">{t.titulo}</p>
                                <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${PRIO_BADGE[t.prioridade]}`}>
                                  {t.prioridade}
                                </span>
                                <span className="text-[9px] text-gray-500">prazo {t.prazo_dias}d</span>
                                {t.editada && <span className="text-[9px] text-yellow-400">editada</span>}
                              </div>
                              {t.descricao && <p className="text-xs text-gray-400 leading-relaxed">{t.descricao}</p>}
                              {t.contexto_origem && (
                                <p className="text-[10px] text-gray-500 italic mt-2 flex items-start gap-1.5">
                                  <AlertTriangle size={9} className="text-yellow-400 shrink-0 mt-0.5" />
                                  {t.contexto_origem}
                                </p>
                              )}
                            </div>
                            {/* Editar/Descartar individual sempre disponível pra admin/CEO.
                                Em rascunho: muda só local. Em aprovado: RPC propaga pra tarefas/marketing_tarefas. */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => abrirEdicao(t)} title={isAprovado ? 'Editar (propaga pro setor)' : 'Editar'} className="action-btn-edit">
                                <Edit3 size={12} />
                              </button>
                              <button onClick={() => descartar(t._id)} title={isAprovado ? 'Descartar (remove do setor)' : 'Descartar'} className="action-btn-delete">
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer com ação principal */}
          {!isAprovado && totalAtivas > 0 && (
            <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex items-center justify-between gap-4 sticky bottom-0"
              style={{ background: 'color-mix(in srgb, var(--color-bg-base) 95%, transparent)' }}>
              <p className="text-sm text-gray-300">
                <strong className="text-accent">{totalAprovadas}</strong> de <strong>{totalAtivas}</strong> tarefas selecionadas pra aprovação
              </p>
              <NeuButtonAccent variant="" onClick={aprovarSelecionadas} disabled={aprovando || totalAprovadas === 0}>
                {aprovando ? <><Loader2 size={14} className="animate-spin" />Enviando…</> : <><Send size={14} />Enviar {totalAprovadas} tarefa(s) pros setores</>}
              </NeuButtonAccent>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};
