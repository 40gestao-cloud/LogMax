import React, { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, X as XIcon, Target, MessageSquare, Award, Settings, Users, ClipboardList, Pencil, Trash2, FileDown, Play, Pause, RefreshCw, StopCircle } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { hasSetor } from '../lib/rbac';
import { setorLabel } from '../lib/setores';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';

const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

const statusCls = (s: string) => {
  if (s === 'Aprovada')    return 'bg-green-900/30 text-green-400';
  if (s === 'Rejeitada')   return 'bg-red-950/50 text-red-500';
  if (s === 'Em Produção') return 'bg-emerald-900/30 text-emerald-400';
  if (s === 'Rascunho')    return 'bg-gray-700/40 text-gray-400';
  if (s === 'Pausada')     return 'bg-yellow-900/30 text-yellow-400';
  if (s === 'Encerrada')   return 'bg-blue-900/30 text-blue-400';
  // status aprovação tarefas
  if (s === 'Concluida')   return 'bg-purple-900/30 text-purple-400';
  return 'bg-yellow-900/30 text-yellow-400'; // Pendente
};

// "Concluida" no status de tarefa = aguardando aprovação
const statusLabel = (s: string) => s === 'Concluida' ? 'Aguardando' : s;

// Situacao da tarefa (ciclo de vida)
const situacaoCls = (s: string) => {
  if (s === 'Em Produção') return 'bg-emerald-900/30 text-emerald-400';
  if (s === 'Rascunho')    return 'bg-gray-700/40 text-gray-400';
  if (s === 'Pausada')     return 'bg-yellow-900/30 text-yellow-400';
  if (s === 'Encerrada')   return 'bg-blue-900/30 text-blue-400';
  return 'bg-gray-700/40 text-gray-400';
};

type Profile = {
  id: string;
  nome: string | null;
  email: string | null;
  role?: string;
  setor?: string;
  setores_extras?: string[];
  ativo?: boolean;
};

// Compras faz parte de Logística — não listamos separado aqui.
const SETORES = ['vendas', 'logistica', 'financeiro', 'rh', 'marketing', 'ti', 'all'] as const;

const SETOR_OPCAO_LABEL: Record<string, string> = {
  all: 'Geral (todos)',
};
const labelSetorOpcao = (s: string) => SETOR_OPCAO_LABEL[s] ?? setorLabel(s);

const EMPTY_META = {
  titulo: '',
  descricao: '',
  setor: '',
  bonificacao_equipe: '',
  limite_bonificacao_individual: '',
  data_inicio: '',
  hora_inicio: '',
  data_fim: '',
  hora_fim: '',
};

const EMPTY_TAREFA = {
  meta_estrategica_id: '',
  titulo: '',
  descricao: '',
  colaborador_id: '',
  valor_bonificacao: '',
  data_inicio: '',
  hora_inicio: '',
  data_fim: '',
  hora_fim: '',
};

export const MetasView = ({ showToast, profile }: any) => {
  const confirm = useConfirm();
  const { data: metas, setData: setMetas, isLoading: loadingMetas, reload: reloadMetas } =
    useFetchData<any>('/api/metasestrategicasview');
  const { data: tarefas, setData: setTarefas, isLoading: loadingTarefas, reload: reloadTarefas } =
    useFetchData<any>('/api/tarefastaticasview');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  const isAdmin   = profile?.role === 'admin' || profile?.role === 'ceo';
  const isGerente = profile?.role === 'gerente';
  const isRH      = hasSetor(profile, 'rh');
  const isColaborador = profile?.role === 'colaborador';

  // Tabs visíveis dependem do role
  type Tab = 'estrategica' | 'tatica';
  const tabsDisponiveis: Tab[] = isColaborador ? ['tatica'] : ['estrategica', 'tatica'];
  const [tab, setTab] = useState<Tab>(isColaborador ? 'tatica' : 'estrategica');

  const [showFormMeta, setShowFormMeta] = useState(false);
  const formMetaRef = useRef<HTMLDivElement>(null);
  const formTarefaRef = useRef<HTMLDivElement>(null);
  const [formMeta, setFormMeta] = useState(EMPTY_META);
  const [savingMeta, setSavingMeta] = useState(false);
  const [editMetaId, setEditMetaId] = useState<string | null>(null);

  const [showFormTarefa, setShowFormTarefa] = useState(false);
  const [formTarefa, setFormTarefa] = useState(EMPTY_TAREFA);
  const [savingTarefa, setSavingTarefa] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState('');

  const [detailMeta, setDetailMeta] = useState<any | null>(null);
  const [detailTarefa, setDetailTarefa] = useState<any | null>(null);

  // Threshold da folga conquistada (mantém modelo MaxBank existente).
  const [threshold, setThreshold] = useState<number>(2500);
  const [showThresholdEdit, setShowThresholdEdit] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [{ data: profs }, { data: cfg }] = await Promise.all([
        supabase.from('user_profiles')
          .select('id, nome, email, role, setor, setores_extras, ativo')
          .order('nome', { ascending: true }),
        supabase.from('maxbank_config').select('meta_folga_threshold').eq('id', 1).maybeSingle(),
      ]);
      if (profs) setProfiles(profs as Profile[]);
      if (cfg?.meta_folga_threshold != null) setThreshold(Number(cfg.meta_folga_threshold));
      setLoadingProfiles(false);
    })();
  }, []);

  // ── Meta estratégica ───────────────────────────────────────────────
  const podeCriarMeta = isAdmin;

  const handleCriarMeta = async () => {
    if (!supabase) return;
    if (!formMeta.titulo.trim() || !formMeta.data_inicio || !formMeta.data_fim) {
      showToast('Preencha título e período.', 'error');
      return;
    }
    const bonusEquipe = formMeta.bonificacao_equipe ? parseBRL(formMeta.bonificacao_equipe) : 0;
    const limite      = formMeta.limite_bonificacao_individual ? parseBRL(formMeta.limite_bonificacao_individual) : 0;
    if (bonusEquipe < 0 || limite < 0) {
      showToast('Valores não podem ser negativos.', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      const { data: id, error } = await supabase.rpc('criar_meta_estrategica', {
        p_titulo:                        formMeta.titulo.trim(),
        p_descricao:                     formMeta.descricao.trim(),
        p_setor:                         formMeta.setor || null,
        p_bonificacao_equipe:            bonusEquipe,
        p_limite_bonificacao_individual: limite,
        p_data_inicio:                   formMeta.data_inicio,
        p_data_fim:                      formMeta.data_fim,
        p_hora_inicio:                   formMeta.hora_inicio || null,
        p_hora_fim:                      formMeta.hora_fim || null,
      });
      if (error) throw error;
      const { data: nova } = await supabase.from('metas_estrategicas').select('*').eq('id', id).single();
      if (nova) setMetas((prev: any[]) => [nova, ...prev]);
      showToast('Meta estratégica criada.', 'success');
      setShowFormMeta(false);
      setFormMeta(EMPTY_META);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingMeta(false);
  };

  const handleConcluirMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Concluir esta meta vai dividir a bonificação de equipe entre os colaboradores do setor. Continuar?')) return;
    setBusyId(id);
    try {
      const { data, error } = await supabase.rpc('concluir_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      const r = data as { colaboradores_beneficiados?: number; valor_por_colaborador?: number; folgas_total?: number } | null;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Encerrada', pool_distribuido: true, concluida_em: new Date().toISOString() } : m));
      const colabs = Number(r?.colaboradores_beneficiados ?? 0);
      const valor  = Number(r?.valor_por_colaborador ?? 0);
      const folgas = Number(r?.folgas_total ?? 0);
      if (colabs > 0 && valor > 0) {
        showToast(`Meta concluída — ${fmtBRL(valor)} para cada um dos ${colabs} colaboradores${folgas > 0 ? ` + ${folgas} folga(s) conquistada(s)` : ''}.`, 'success');
      } else {
        showToast('Meta concluída.', 'success');
      }
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const handleCancelarMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Cancelar esta meta? Nenhuma bonificação de equipe será paga.')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('cancelar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Encerrada' } : m));
      showToast('Meta encerrada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const abrirEdicaoMeta = (m: any) => {
    setEditMetaId(m.id);
    setFormMeta({
      titulo:                          m.titulo ?? '',
      descricao:                       m.descricao ?? '',
      setor:                           m.setor ?? '',
      bonificacao_equipe:              formatBRL(String(Number(m.bonificacao_equipe ?? 0).toFixed(2))),
      limite_bonificacao_individual:   formatBRL(String(Number(m.limite_bonificacao_individual ?? 0).toFixed(2))),
      data_inicio:                     m.data_inicio ?? '',
      hora_inicio:                     m.hora_inicio ?? '',
      data_fim:                        m.data_fim ?? '',
      hora_fim:                        m.hora_fim ?? '',
    });
    setShowFormMeta(true);
    requestAnimationFrame(() => formMetaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const fecharFormMeta = () => {
    setShowFormMeta(false);
    setEditMetaId(null);
    setFormMeta(EMPTY_META);
  };

  const handleEditarMeta = async () => {
    if (!supabase || !editMetaId) return;
    if (!formMeta.titulo.trim() || !formMeta.data_inicio || !formMeta.data_fim) {
      showToast('Preencha título e período.', 'error');
      return;
    }
    const bonusEquipe = formMeta.bonificacao_equipe ? parseBRL(formMeta.bonificacao_equipe) : 0;
    const limite      = formMeta.limite_bonificacao_individual ? parseBRL(formMeta.limite_bonificacao_individual) : 0;
    if (bonusEquipe < 0 || limite < 0) {
      showToast('Valores não podem ser negativos.', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      const { error } = await supabase.rpc('editar_meta_estrategica', {
        p_meta_id:                       editMetaId,
        p_titulo:                        formMeta.titulo.trim(),
        p_descricao:                     formMeta.descricao.trim(),
        p_setor:                         formMeta.setor || null,
        p_bonificacao_equipe:            bonusEquipe,
        p_limite_bonificacao_individual: limite,
        p_data_inicio:                   formMeta.data_inicio,
        p_data_fim:                      formMeta.data_fim,
        p_hora_inicio:                   formMeta.hora_inicio || null,
        p_hora_fim:                      formMeta.hora_fim || null,
      });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === editMetaId ? {
        ...m,
        titulo:                        formMeta.titulo.trim(),
        descricao:                     formMeta.descricao.trim(),
        setor:                         formMeta.setor || null,
        hora_inicio:                   formMeta.hora_inicio || null,
        hora_fim:                      formMeta.hora_fim || null,
        bonificacao_equipe:            bonusEquipe,
        limite_bonificacao_individual: limite,
        data_inicio:                   formMeta.data_inicio,
        data_fim:                      formMeta.data_fim,
      } : m));
      showToast('Meta atualizada.', 'success');
      fecharFormMeta();
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingMeta(false);
  };

  const handleApagarMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Apagar esta meta? As tarefas táticas vinculadas também serão removidas (pros gerentes e colaboradores). Esta ação não pode ser desfeita.')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('apagar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.filter(m => m.id !== id));
      setTarefas((prev: any[]) => prev.filter(t => t.meta_estrategica_id !== id));
      showToast('Meta apagada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  // ── Tarefa tática ──────────────────────────────────────────────────
  // Decisão de produto: gerente NÃO cria mais tarefas táticas — só admin/CEO.
  // Centraliza a hierarquia (meta estratégica + tática viram artefatos da
  // diretoria; gerente é executor/aprovador). A RPC `criar_tarefa_tatica`
  // também valida server-side (defesa em profundidade).
  const podeCriarTarefa = isAdmin;

  // Metas estratégicas elegíveis pra criar tarefa: Ativa + setor compatível com criador.
  const metasElegiveis = useMemo(() => {
    if (!podeCriarTarefa) return [];
    const setoresGerente = isGerente
      ? [profile.setor, ...(profile.setores_extras ?? [])].filter(Boolean)
      : null;
    return metas.filter((m: any) => {
      if (!['Em Produção', 'Rascunho'].includes(m.status) || !m.ativo) return false;
      if (isAdmin) return true;
      // Gerente: meta sem setor (=todos) OU meta do seu setor.
      if (!m.setor) return true;
      return setoresGerente?.includes(m.setor);
    });
  }, [metas, profile, podeCriarTarefa, isAdmin, isGerente]);

  // Meta selecionada no form (pra determinar limite e setor alvo).
  const metaSelecionada = useMemo(
    () => metas.find((m: any) => m.id === formTarefa.meta_estrategica_id) ?? null,
    [metas, formTarefa.meta_estrategica_id],
  );

  // Colaboradores elegíveis pra atribuição: ativos + role='colaborador' + setor compatível.
  const colaboradoresElegiveis = useMemo(() => {
    if (!metaSelecionada || !podeCriarTarefa) return [];
    const setorAlvo = metaSelecionada.setor
      ?? (isGerente ? profile.setor : null); // admin sem setor da meta → vê todos
    return profiles
      .filter(p => p.ativo !== false)
      .filter(p => p.role === 'colaborador')
      .filter(p => p.id !== profile?.id)
      .filter(p => {
        if (isAdmin && !setorAlvo) return true; // meta global, admin escolhe qualquer
        if (!setorAlvo) return false;
        const userSetores = [p.setor, ...(p.setores_extras ?? [])].filter(Boolean);
        return userSetores.includes(setorAlvo);
      });
  }, [profiles, profile, metaSelecionada, podeCriarTarefa, isAdmin, isGerente]);

  const limiteMetaSelecionada = Number(metaSelecionada?.limite_bonificacao_individual ?? 0);

  const handleCriarTarefa = async () => {
    if (!supabase) return;
    if (!formTarefa.meta_estrategica_id || !formTarefa.titulo.trim() ||
        !formTarefa.data_inicio || !formTarefa.data_fim) {
      showToast('Preencha meta, título e período.', 'error');
      return;
    }
    const valor = formTarefa.valor_bonificacao ? parseBRL(formTarefa.valor_bonificacao) : 0;
    if (valor < 0) { showToast('Valor não pode ser negativo.', 'error'); return; }
    if (limiteMetaSelecionada > 0 && valor > limiteMetaSelecionada) {
      showToast(`Valor excede o limite da meta (${fmtBRL(limiteMetaSelecionada)}).`, 'error');
      return;
    }
    setSavingTarefa(true);
    try {
      const { data: ids, error } = await supabase.rpc('criar_tarefa_tatica', {
        p_meta_estrategica_id: formTarefa.meta_estrategica_id,
        p_titulo:              formTarefa.titulo.trim(),
        p_descricao:           formTarefa.descricao.trim(),
        p_colaborador_id:      formTarefa.colaborador_id || null,
        p_valor_bonificacao:   valor,
        p_data_inicio:         formTarefa.data_inicio,
        p_data_fim:            formTarefa.data_fim,
        p_hora_inicio:         formTarefa.hora_inicio || null,
        p_hora_fim:            formTarefa.hora_fim || null,
      });
      if (error) throw error;
      await reloadTarefas();
      const count = Array.isArray(ids) ? ids.length : 1;
      showToast(`${count} tarefa(s) criada(s).`, 'success');
      setShowFormTarefa(false);
      setFormTarefa(EMPTY_TAREFA);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingTarefa(false);
  };

  const handleConcluirTarefa = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('concluir_tarefa_tatica', { p_tarefa_id: id });
      if (error) throw error;
      setTarefas((prev: any[]) => prev.map(t => t.id === id
        ? { ...t, status: 'Concluida', concluida_em: new Date().toISOString() }
        : t));
      showToast('Tarefa marcada como concluída — aguarde aprovação do gerente.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const handleAprovarTarefa = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { data, error } = await supabase.rpc('aprovar_tarefa_tatica', { p_tarefa_id: id });
      if (error) throw error;
      const r = data as { folgas_geradas?: number } | null;
      setTarefas((prev: any[]) => prev.map(t => t.id === id
        ? { ...t, status: 'Aprovada', aprovada_em: new Date().toISOString(), aprovada_por: profile?.id }
        : t));
      const folgas = Number(r?.folgas_geradas ?? 0);
      if (folgas > 0) {
        showToast(`Tarefa aprovada — bonificação creditada e ${folgas} folga(s) conquistada(s)!`, 'success');
      } else {
        showToast('Tarefa aprovada — bonificação creditada na carteira.', 'success');
      }
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const handleRejeitarTarefa = async () => {
    if (!supabase || !rejectId) return;
    if (!rejectFeedback.trim()) { showToast('Informe o motivo da rejeição.', 'error'); return; }
    setBusyId(rejectId);
    try {
      const { error } = await supabase.rpc('rejeitar_tarefa_tatica', {
        p_tarefa_id: rejectId, p_feedback: rejectFeedback.trim(),
      });
      if (error) throw error;
      setTarefas((prev: any[]) => prev.map(t => t.id === rejectId
        ? { ...t, status: 'Rejeitada', feedback_aprovacao: rejectFeedback.trim(), aprovada_em: new Date().toISOString() }
        : t));
      showToast('Tarefa rejeitada.', 'success');
      setRejectId(null);
      setRejectFeedback('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setBusyId(null);
  };

  const handleSaveThreshold = async () => {
    if (!supabase) return;
    const v = parseBRL(thresholdDraft);
    if (v <= 0) { showToast('Valor deve ser positivo.', 'error'); return; }
    setSavingThreshold(true);
    try {
      const { error } = await supabase.rpc('set_maxbank_threshold', { p_valor: v });
      if (error) throw error;
      setThreshold(v);
      setShowThresholdEdit(false);
      showToast('Limite da folga atualizado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? err}`, 'error');
    }
    setSavingThreshold(false);
  };

  // ── Ciclo de vida — Metas ─────────────────────────────────────────
  const handlePublicarMeta = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('publicar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Em Produção' } : m));
      showToast('Meta publicada — gerentes já conseguem visualizar.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handlePausarMeta = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('pausar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Pausada' } : m));
      showToast('Meta pausada.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handleEncerrarMeta = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Encerrar esta meta sem distribuir o pool? Esta ação pode ser revertida.')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('encerrar_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Encerrada' } : m));
      showToast('Meta encerrada.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handleReabrirMeta = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('reabrir_meta_estrategica', { p_meta_id: id });
      if (error) throw error;
      setMetas((prev: any[]) => prev.map(m => m.id === id ? { ...m, status: 'Em Produção', concluida_em: null } : m));
      showToast('Meta reaberta — está Em Produção novamente.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  // ── Ciclo de vida — Tarefas ───────────────────────────────────────
  const handlePublicarTarefa = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('publicar_tarefa_tatica', { p_tarefa_id: id });
      if (error) throw error;
      setTarefas((prev: any[]) => prev.map(t => t.id === id ? { ...t, situacao: 'Em Produção' } : t));
      showToast('Tarefa publicada — colaborador já consegue visualizar.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handlePausarTarefa = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('pausar_tarefa_tatica', { p_tarefa_id: id });
      if (error) throw error;
      setTarefas((prev: any[]) => prev.map(t => t.id === id ? { ...t, situacao: 'Pausada' } : t));
      showToast('Tarefa pausada.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handleEncerrarTarefa = async (id: string) => {
    if (!supabase) return;
    if (!await confirm('Encerrar esta tarefa? O colaborador não poderá mais agir sobre ela (pode reabrir).')) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('encerrar_tarefa_tatica', { p_tarefa_id: id });
      if (error) throw error;
      setTarefas((prev: any[]) => prev.map(t => t.id === id ? { ...t, situacao: 'Encerrada' } : t));
      showToast('Tarefa encerrada.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const handleReabrirTarefa = async (id: string) => {
    if (!supabase) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('reabrir_tarefa_tatica', { p_tarefa_id: id });
      if (error) throw error;
      setTarefas((prev: any[]) => prev.map(t => t.id === id ? { ...t, situacao: 'Em Produção' } : t));
      showToast('Tarefa reaberta — está Em Produção novamente.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message ?? err}`, 'error'); }
    setBusyId(null);
  };

  const gerarPdfMeta = (m: any) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { jsPDF } = require('jspdf');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('jspdf-autotable');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const accent = [34, 197, 94] as [number, number, number]; // verde

    doc.setFontSize(11).setFont('helvetica', 'normal').setTextColor(150);
    doc.text('Meta Estratégica', 40, 40);
    doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(0);
    const titleLines = doc.splitTextToSize(m.titulo || m.descricao || '', 515);
    doc.text(titleLines, 40, 56);

    let afterTitle = 56 + titleLines.length * 20 + 6;
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(100);
    doc.text(`Status: ${m.status}`, 40, afterTitle);
    afterTitle += 18;
    doc.setTextColor(0);

    let afterDesc = afterTitle;
    if (m.descricao && m.titulo) {
      doc.setFontSize(10).setFont('helvetica', 'bold');
      doc.text('Descrição', 40, afterDesc);
      afterDesc += 14;
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const descLines = doc.splitTextToSize(m.descricao ?? '', 515);
      doc.text(descLines, 40, afterDesc);
      afterDesc += descLines.length * 14 + 12;
    }

    (doc as any).autoTable({
      startY: afterDesc,
      head: [['Campo', 'Valor']],
      body: [
        ['Setor alvo', m.setor ? labelSetorOpcao(m.setor) : 'Todos os setores'],
        ['Período', `${m.data_inicio} → ${m.data_fim}`],
        ['Pool da equipe', fmtBRL(Number(m.bonificacao_equipe ?? 0))],
        ['Limite individual por tarefa', fmtBRL(Number(m.limite_bonificacao_individual ?? 0))],
      ],
      headStyles: { fillColor: accent, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 200, fontStyle: 'bold' } },
      margin: { left: 40, right: 40 },
    });

    doc.save(`meta-estrategica-${m.id?.slice(0, 8) ?? 'doc'}.pdf`);
  };

  const gerarPdfTarefa = (t: any) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { jsPDF } = require('jspdf');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('jspdf-autotable');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const accent = [34, 197, 94] as [number, number, number];
    const colabNome = t.colaborador?.nome ?? t.colaborador?.email ?? '—';
    const metaDesc  = t.meta?.descricao ?? '—';

    doc.setFontSize(11).setFont('helvetica', 'normal').setTextColor(150);
    doc.text('Tarefa Tática', 40, 40);
    doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(0);
    const titleLines = doc.splitTextToSize(t.titulo || t.descricao || '', 515);
    doc.text(titleLines, 40, 56);

    let y = 56 + titleLines.length * 20 + 6;
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(100);
    doc.text(`Situação: ${t.situacao ?? 'Em Produção'} · Aprovação: ${statusLabel(t.status)}`, 40, y);
    y += 18;
    doc.setTextColor(0);

    if (t.descricao && t.titulo) {
      doc.setFontSize(10).setFont('helvetica', 'bold');
      doc.text('Descrição', 40, y);
      y += 14;
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const descLines = doc.splitTextToSize(t.descricao ?? '', 515);
      doc.text(descLines, 40, y);
      y += descLines.length * 14 + 12;
    }

    doc.setFont('helvetica', 'bold').setFontSize(10);
    doc.text('Meta estratégica vinculada', 40, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    const metaLines = doc.splitTextToSize(metaDesc, 515);
    doc.text(metaLines, 40, y);
    y += metaLines.length * 14 + 12;

    (doc as any).autoTable({
      startY: y,
      head: [['Campo', 'Valor']],
      body: [
        ['Colaborador', colabNome],
        ['Setor', t.setor ? labelSetorOpcao(t.setor) : '—'],
        ['Bonificação', fmtBRL(Number(t.valor_bonificacao ?? 0))],
        ['Período', `${t.data_inicio} → ${t.data_fim}`],
      ],
      headStyles: { fillColor: accent, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 200, fontStyle: 'bold' } },
      margin: { left: 40, right: 40 },
    });

    if (t.status === 'Rejeitada' && t.feedback_aprovacao) {
      const finalY = (doc as any).lastAutoTable.finalY + 20;
      doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(180, 0, 0);
      doc.text('Feedback da rejeição', 40, finalY);
      doc.setFont('helvetica', 'normal').setTextColor(0);
      const fbLines = doc.splitTextToSize(t.feedback_aprovacao, 515);
      doc.text(fbLines, 40, finalY + 16);
    }

    doc.save(`tarefa-tatica-${t.id?.slice(0, 8) ?? 'doc'}.pdf`);
  };

  // Pode aprovar tarefa: admin/CEO/RH global; gerente só do setor da tarefa.
  const podeAprovarTarefa = (t: any) => {
    if (!profile) return false;
    if (isAdmin || isRH) return true;
    if (!isGerente) return false;
    const meus = [profile.setor, ...(profile.setores_extras ?? [])].filter(Boolean);
    return meus.includes(t.setor);
  };

  if (loadingMetas || loadingTarefas || loadingProfiles) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  const enrichedTarefas = tarefas.map((t: any) => ({
    ...t,
    colaborador: profiles.find(p => p.id === t.colaborador_id),
    meta:        metas.find((m: any) => m.id === t.meta_estrategica_id),
  }));

  // KPIs por tab
  const kpisMetas = [
    { label: 'Em Produção', value: metas.filter((m: any) => m.status === 'Em Produção').length },
    { label: 'Concluídas', value: metas.filter((m: any) => m.status === 'Encerrada' && m.pool_distribuido).length },
    { label: 'Bonificação acumulada', value: fmtBRL(metas.reduce((acc: number, m: any) => acc + Number(m.bonificacao_equipe ?? 0), 0)), isText: true },
  ];

  const kpisTarefas = [
    { label: 'Pendentes',  value: tarefas.filter((t: any) => t.status === 'Pendente').length },
    { label: 'Aguardando aprovação', value: tarefas.filter((t: any) => t.status === 'Concluida').length, warn: tarefas.some((t: any) => t.status === 'Concluida') },
    { label: 'Aprovadas',  value: tarefas.filter((t: any) => t.status === 'Aprovada').length },
    { label: 'Total bonificado', value: fmtBRL(tarefas.filter((t: any) => t.status === 'Aprovada').reduce((acc: number, t: any) => acc + Number(t.valor_bonificacao ?? 0), 0)), isText: true },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      {/* Título */}
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Metas</h2>
          <p className="text-sm text-gray-400 mt-1">
            Estratégicas (admin/CEO → gerente) e Tarefas (gerente → colaborador). A cada {' '}
            <span className="text-accent font-bold">{fmtBRL(threshold)}</span> em bonificações o colaborador conquista uma folga.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => { setThresholdDraft(formatBRL(threshold)); setShowThresholdEdit(true); }}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-accent transition-colors px-3 py-2 neu-button rounded-xl">
            <Settings size={12} />Ajustar limite
          </button>
        )}
      </div>

      {/* Tabs */}
      {tabsDisponiveis.length > 1 && (
        <div className="flex gap-2 shrink-0">
          {tabsDisponiveis.includes('estrategica') && (
            <button onClick={() => setTab('estrategica')}
              className={`flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold transition-all neu-button ${tab === 'estrategica' ? 'text-accent bg-accent/10 border border-accent/30' : 'text-gray-500'}`}>
              <Target size={12} />Estratégicas
            </button>
          )}
          {tabsDisponiveis.includes('tatica') && (
            <button onClick={() => setTab('tatica')}
              className={`flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold transition-all neu-button ${tab === 'tatica' ? 'text-accent bg-accent/10 border border-accent/30' : 'text-gray-500'}`}>
              <ClipboardList size={12} />Tarefas
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className={`grid gap-4 shrink-0 ${tab === 'tatica' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {(tab === 'estrategica' ? kpisMetas : kpisTarefas).map((k: any) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`${k.isText ? 'text-xl' : 'text-2xl'} font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Botão criar */}
      {tab === 'estrategica' && podeCriarMeta && (
        <div className="flex justify-end shrink-0">
          <NeuButtonAccent variant="" onClick={() => { if (showFormMeta) fecharFormMeta(); else { setEditMetaId(null); setFormMeta(EMPTY_META); setShowFormMeta(true); requestAnimationFrame(() => formMetaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); } }}>
            <Plus size={14} />{showFormMeta ? 'Cancelar' : 'Nova Meta Estratégica'}
          </NeuButtonAccent>
        </div>
      )}
      {tab === 'tatica' && podeCriarTarefa && (
        <div className="flex justify-end shrink-0">
          <NeuButtonAccent variant="" onClick={() => { const next = !showFormTarefa; setShowFormTarefa(next); setFormTarefa(EMPTY_TAREFA); if (next) requestAnimationFrame(() => formTarefaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>
            <Plus size={14} />{showFormTarefa ? 'Cancelar' : 'Nova Tarefa'}
          </NeuButtonAccent>
        </div>
      )}

      {/* Form Meta Estratégica */}
      <AnimatePresence>
        {tab === 'estrategica' && showFormMeta && podeCriarMeta && (
          <motion.div ref={formMetaRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 scroll-mt-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editMetaId ? 'Editar Meta Estratégica' : 'Nova Meta Estratégica'}</h3>
              {!editMetaId && (
                <span className="text-[10px] bg-gray-700/50 text-gray-400 px-2.5 py-1 rounded-lg border border-white/5">
                  Salva como Rascunho — publique quando quiser enviar aos gerentes
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Título *</label>
                <input value={formMeta.titulo}
                  onChange={e => setFormMeta(p => ({ ...p, titulo: e.target.value }))}
                  placeholder="Ex.: Aumentar vendas Q3"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <textarea value={formMeta.descricao}
                  onChange={e => setFormMeta(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Detalhes, critérios, contexto..."
                  rows={3}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor alvo</label>
                <select value={formMeta.setor}
                  onChange={e => setFormMeta(p => ({ ...p, setor: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Todos os setores</option>
                  {SETORES.map(s => <option key={s} value={s}>{labelSetorOpcao(s)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Bonificação de equipe (pool R$)</label>
                <input type="text" inputMode="numeric" value={formMeta.bonificacao_equipe}
                  onChange={e => setFormMeta(p => ({ ...p, bonificacao_equipe: formatBRL(e.target.value) }))}
                  onKeyDown={handleMoneyKeyDown}
                  placeholder="0,00"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                <span className="text-[10px] text-gray-500">Dividido igualmente ao concluir a meta.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Limite individual (R$)</label>
                <input type="text" inputMode="numeric" value={formMeta.limite_bonificacao_individual}
                  onChange={e => setFormMeta(p => ({ ...p, limite_bonificacao_individual: formatBRL(e.target.value) }))}
                  onKeyDown={handleMoneyKeyDown}
                  placeholder="0,00"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                <span className="text-[10px] text-gray-500">Teto por tarefa que o gerente atribui.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data de início *</label>
                <input type="date" value={formMeta.data_inicio}
                  onChange={e => setFormMeta(p => ({ ...p, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário de início</label>
                <input type="time" value={formMeta.hora_inicio}
                  onChange={e => setFormMeta(p => ({ ...p, hora_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data de fim *</label>
                <input type="date" value={formMeta.data_fim}
                  onChange={e => setFormMeta(p => ({ ...p, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário de fim</label>
                <input type="time" value={formMeta.hora_fim}
                  onChange={e => setFormMeta(p => ({ ...p, hora_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={editMetaId ? handleEditarMeta : handleCriarMeta} disabled={savingMeta}>
                {savingMeta ? 'Salvando...' : (editMetaId ? 'Salvar Alterações' : 'Salvar Rascunho')}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form Tarefa Tática */}
      <AnimatePresence>
        {tab === 'tatica' && showFormTarefa && podeCriarTarefa && (
          <motion.div ref={formTarefaRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 scroll-mt-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Nova Tarefa</h3>
              <span className="text-[10px] bg-gray-700/50 text-gray-400 px-2.5 py-1 rounded-lg border border-white/5">
                Salva como Rascunho — publique quando quiser enviar ao colaborador
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Meta Estratégica *</label>
                <select value={formTarefa.meta_estrategica_id}
                  onChange={e => setFormTarefa(p => ({ ...p, meta_estrategica_id: e.target.value, colaborador_id: '', valor_bonificacao: '' }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {metasElegiveis.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.titulo || m.descricao} — {m.setor ? labelSetorOpcao(m.setor) : 'Todos'} (limite {fmtBRL(Number(m.limite_bonificacao_individual ?? 0))})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Colaborador</label>
                <select value={formTarefa.colaborador_id}
                  disabled={!metaSelecionada}
                  onChange={e => setFormTarefa(p => ({ ...p, colaborador_id: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-40">
                  <option value="">Todos do setor</option>
                  {colaboradoresElegiveis.map(p => (
                    <option key={p.id} value={p.id}>{p.nome ?? p.email}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Título *</label>
                <input value={formTarefa.titulo}
                  onChange={e => setFormTarefa(p => ({ ...p, titulo: e.target.value }))}
                  placeholder="Ex.: Fechar 5 vendas acima de R$ 10k"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <textarea value={formTarefa.descricao}
                  onChange={e => setFormTarefa(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Detalhes, critérios, contexto..."
                  rows={3}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  Bonificação individual (R$) {limiteMetaSelecionada > 0 && <span className="text-gray-400">— máx {fmtBRL(limiteMetaSelecionada)}</span>}
                </label>
                <input type="text" inputMode="numeric" value={formTarefa.valor_bonificacao}
                  onChange={e => setFormTarefa(p => ({ ...p, valor_bonificacao: formatBRL(e.target.value) }))}
                  onKeyDown={handleMoneyKeyDown}
                  disabled={!metaSelecionada}
                  placeholder="0,00"
                  className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-40" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data de início *</label>
                <input type="date" value={formTarefa.data_inicio}
                  onChange={e => setFormTarefa(p => ({ ...p, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário de início</label>
                <input type="time" value={formTarefa.hora_inicio}
                  onChange={e => setFormTarefa(p => ({ ...p, hora_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data de fim *</label>
                <input type="date" value={formTarefa.data_fim}
                  onChange={e => setFormTarefa(p => ({ ...p, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário de fim</label>
                <input type="time" value={formTarefa.hora_fim}
                  onChange={e => setFormTarefa(p => ({ ...p, hora_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleCriarTarefa} disabled={savingTarefa}>
                {savingTarefa ? 'Salvando...' : (formTarefa.colaborador_id ? 'Salvar Rascunho' : 'Salvar Rascunho para todos do setor')}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lista — Metas Estratégicas */}
      {tab === 'estrategica' && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          {metas.length === 0 ? (
            <EmptyState message={podeCriarMeta ? 'Nenhuma meta estratégica criada. Comece pela primeira.' : 'Nenhuma meta ativa pro seu setor.'} />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse min-w-[820px]">
                <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4">Setor</th>
                  <th className="pb-4 font-bold px-4 text-right">Pool Equipe</th>
                  <th className="pb-4 font-bold px-4 text-right">Limite Indiv.</th>
                  <th className="pb-4 font-bold px-4 text-center">Período</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4" />
                </tr></thead>
                <tbody>
                  <AnimatePresence>
                    {metas.map((m: any) => (
                      <motion.tr key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        onClick={() => setDetailMeta(m)}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          <div className="flex items-center gap-2">
                            <Target size={13} className="text-accent shrink-0" />
                            <span className="truncate" title="Clique para ver detalhes">{m.titulo || m.descricao}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-300">{m.setor ? labelSetorOpcao(m.setor) : <span className="text-gray-500 italic">Todos</span>}</td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-gray-200">{fmtBRL(Number(m.bonificacao_equipe ?? 0))}</td>
                        <td className="py-3 px-4 text-xs font-mono text-right text-gray-400">{fmtBRL(Number(m.limite_bonificacao_individual ?? 0))}</td>
                        <td className="py-3 px-4 text-[10px] font-mono text-center text-gray-400">{m.data_inicio} → {m.data_fim}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusCls(m.status)}`}>{m.status}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1.5 justify-end items-center">
                            {(isAdmin || isGerente) && (
                              <button onClick={(e) => { e.stopPropagation(); gerarPdfMeta(m); }}
                                className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors"
                                title="Baixar PDF">
                                <FileDown size={13} />
                              </button>
                            )}
                            {isAdmin && (
                              <>
                                {(m.status === 'Rascunho' || m.status === 'Pausada') && (
                                  <button onClick={(e) => { e.stopPropagation(); handlePublicarMeta(m.id); }}
                                    disabled={busyId === m.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-emerald-400 transition-colors disabled:opacity-50"
                                    title={m.status === 'Rascunho' ? 'Publicar (enviar para gerentes)' : 'Retomar'}>
                                    <Play size={13} />
                                  </button>
                                )}
                                {m.status === 'Em Produção' && (
                                  <>
                                    <button onClick={(e) => { e.stopPropagation(); handleConcluirMeta(m.id); }}
                                      disabled={busyId === m.id}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors disabled:opacity-50"
                                      title="Concluir e distribuir pool">
                                      <Check size={13} />
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); handlePausarMeta(m.id); }}
                                      disabled={busyId === m.id}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-yellow-400 transition-colors disabled:opacity-50"
                                      title="Pausar">
                                      <Pause size={13} />
                                    </button>
                                  </>
                                )}
                                {(m.status === 'Rascunho' || m.status === 'Em Produção') && (
                                  <button onClick={(e) => { e.stopPropagation(); abrirEdicaoMeta(m); }}
                                    disabled={busyId === m.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors disabled:opacity-50"
                                    title="Editar meta">
                                    <Pencil size={13} />
                                  </button>
                                )}
                                {m.status !== 'Encerrada' && (
                                  <button onClick={(e) => { e.stopPropagation(); handleEncerrarMeta(m.id); }}
                                    disabled={busyId === m.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
                                    title="Encerrar (sem distribuir pool)">
                                    <StopCircle size={13} />
                                  </button>
                                )}
                                {m.status === 'Encerrada' && !m.pool_distribuido && (
                                  <button onClick={(e) => { e.stopPropagation(); handleReabrirMeta(m.id); }}
                                    disabled={busyId === m.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors disabled:opacity-50"
                                    title="Reabrir meta">
                                    <RefreshCw size={13} />
                                  </button>
                                )}
                                {m.status !== 'Encerrada' && (
                                  <button onClick={(e) => { e.stopPropagation(); handleApagarMeta(m.id); }}
                                    disabled={busyId === m.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
                                    title="Apagar meta e tarefas vinculadas">
                                    <Trash2 size={13} />
                                  </button>
                                )}
                                {m.status === 'Encerrada' && m.pool_distribuido && (
                                  <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold">
                                    <Award size={11} />Distribuída
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lista — Tarefas Táticas */}
      {tab === 'tatica' && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          {enrichedTarefas.length === 0 ? (
            <EmptyState message={
              isAdmin
                ? 'Nenhuma tarefa criada ainda.'
                : isGerente
                  ? 'Nenhuma tarefa do seu setor. Admin/CEO atribuem a pauta tática.'
                  : 'Você ainda não tem tarefas atribuídas.'
            } />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Colaborador</th>
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4">Meta</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4 text-center">Período</th>
                  <th className="pb-4 font-bold px-4 text-center">Situação</th>
                  <th className="pb-4 font-bold px-4 text-center">Aprovação</th>
                  <th className="pb-4 font-bold px-4" />
                </tr></thead>
                <tbody>
                  <AnimatePresence>
                    {enrichedTarefas.map((t: any) => {
                      const sou_alvo  = t.colaborador_id === profile?.id;
                      const aprovavel = podeAprovarTarefa(t);
                      return (
                        <motion.tr key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          onClick={() => setDetailTarefa(t)}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                            <div className="flex items-center gap-2">
                              <Users size={13} className="text-accent shrink-0" />
                              {t.colaborador?.nome ?? t.colaborador?.email ?? '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-300 max-w-md">
                            <div className="truncate font-semibold text-gray-200" title="Clique para ver detalhes">{t.titulo || t.descricao}</div>
                            {t.status === 'Rejeitada' && t.feedback_aprovacao && (
                              <div className="text-[10px] text-red-400 mt-1 flex items-start gap-1">
                                <MessageSquare size={10} className="mt-0.5 shrink-0" />
                                <span className="truncate">{t.feedback_aprovacao}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[11px] text-gray-400 max-w-[180px]">
                            <span className="truncate block" title="Clique para ler">{t.meta?.titulo || t.meta?.descricao || '—'}</span>
                          </td>
                          <td className="py-3 px-4 text-xs font-mono text-right text-gray-200">{fmtBRL(Number(t.valor_bonificacao ?? 0))}</td>
                          <td className="py-3 px-4 text-[10px] font-mono text-center text-gray-400">{t.data_inicio} → {t.data_fim}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${situacaoCls(t.situacao ?? 'Em Produção')}`}>{t.situacao ?? 'Em Produção'}</span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusCls(t.status)}`}>{statusLabel(t.status)}</span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex gap-1.5 justify-end items-center">
                              {(isAdmin || isGerente || sou_alvo) && (
                                <button onClick={(e) => { e.stopPropagation(); gerarPdfTarefa(t); }}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors"
                                  title="Baixar PDF">
                                  <FileDown size={13} />
                                </button>
                              )}
                              {/* Botões de ciclo de vida (admin/CEO/gerente do setor) */}
                              {(isAdmin || (isGerente && aprovavel)) && (
                                <>
                                  {(t.situacao === 'Rascunho' || t.situacao === 'Pausada') && (
                                    <button onClick={(e) => { e.stopPropagation(); handlePublicarTarefa(t.id); }}
                                      disabled={busyId === t.id}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-emerald-400 transition-colors disabled:opacity-50"
                                      title={t.situacao === 'Rascunho' ? 'Publicar (enviar para colaborador)' : 'Retomar'}>
                                      <Play size={13} />
                                    </button>
                                  )}
                                  {t.situacao === 'Em Produção' && t.status === 'Pendente' && (
                                    <button onClick={(e) => { e.stopPropagation(); handlePausarTarefa(t.id); }}
                                      disabled={busyId === t.id}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-yellow-400 transition-colors disabled:opacity-50"
                                      title="Pausar">
                                      <Pause size={13} />
                                    </button>
                                  )}
                                  {t.situacao !== 'Encerrada' && t.status === 'Pendente' && (
                                    <button onClick={(e) => { e.stopPropagation(); handleEncerrarTarefa(t.id); }}
                                      disabled={busyId === t.id}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
                                      title="Encerrar tarefa">
                                      <StopCircle size={13} />
                                    </button>
                                  )}
                                  {t.situacao === 'Encerrada' && t.status === 'Pendente' && (
                                    <button onClick={(e) => { e.stopPropagation(); handleReabrirTarefa(t.id); }}
                                      disabled={busyId === t.id}
                                      className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors disabled:opacity-50"
                                      title="Reabrir tarefa">
                                      <RefreshCw size={13} />
                                    </button>
                                  )}
                                </>
                              )}
                              {/* Fluxo de aprovação */}
                              {t.situacao === 'Em Produção' && t.status === 'Pendente' && sou_alvo && (
                                <button onClick={(e) => { e.stopPropagation(); handleConcluirTarefa(t.id); }}
                                  disabled={busyId === t.id}
                                  className="text-[10px] text-blue-400 hover:underline transition-colors font-bold disabled:opacity-50">
                                  Concluir
                                </button>
                              )}
                              {t.status === 'Concluida' && aprovavel && (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); handleAprovarTarefa(t.id); }}
                                    disabled={busyId === t.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors disabled:opacity-50"
                                    title="Aprovar e creditar">
                                    <Check size={13} />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); setRejectId(t.id); setRejectFeedback(''); }}
                                    disabled={busyId === t.id}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors disabled:opacity-50"
                                    title="Rejeitar">
                                    <XIcon size={13} />
                                  </button>
                                </>
                              )}
                              {t.status === 'Aprovada' && (
                                <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold">
                                  <Award size={11} />Creditado
                                </span>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modais */}
      <AnimatePresence>
        {detailMeta && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setDetailMeta(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-lg w-full max-h-[85vh] overflow-y-auto main-scrollbar">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <Target size={16} className="text-accent shrink-0" />
                  <h3 className="text-base font-bold text-gray-200">Meta Estratégica</h3>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${statusCls(detailMeta.status)}`}>{detailMeta.status}</span>
              </div>
              <div className="mb-3">
                <p className="text-lg font-bold text-gray-100 leading-snug">{detailMeta.titulo || detailMeta.descricao}</p>
              </div>
              {detailMeta.descricao && detailMeta.titulo && (
                <div className="mb-5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Descrição</p>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">{detailMeta.descricao}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Setor alvo</p>
                  <p className="text-sm text-gray-200">{detailMeta.setor ? labelSetorOpcao(detailMeta.setor) : <span className="text-gray-500 italic">Todos</span>}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Período</p>
                  <p className="text-sm font-mono text-gray-200">{detailMeta.data_inicio}{detailMeta.hora_inicio ? ` ${detailMeta.hora_inicio}` : ''} → {detailMeta.data_fim}{detailMeta.hora_fim ? ` ${detailMeta.hora_fim}` : ''}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Pool da equipe</p>
                  <p className="text-sm font-mono text-accent font-bold">{fmtBRL(Number(detailMeta.bonificacao_equipe ?? 0))}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Limite individual</p>
                  <p className="text-sm font-mono text-gray-200">{fmtBRL(Number(detailMeta.limite_bonificacao_individual ?? 0))}</p>
                </div>
              </div>
              <div className="flex justify-between items-center">
                {(isAdmin || isGerente) && (
                  <button onClick={() => gerarPdfMeta(detailMeta)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent px-3 py-2 transition-colors neu-button rounded-xl">
                    <FileDown size={13} />PDF
                  </button>
                )}
                <button onClick={() => setDetailMeta(null)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors ml-auto">Fechar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {detailTarefa && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setDetailTarefa(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-lg w-full max-h-[85vh] overflow-y-auto main-scrollbar">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <ClipboardList size={16} className="text-accent shrink-0" />
                  <h3 className="text-base font-bold text-gray-200">Tarefa Tática</h3>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${situacaoCls(detailTarefa.situacao ?? 'Em Produção')}`}>{detailTarefa.situacao ?? 'Em Produção'}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusCls(detailTarefa.status)}`}>{statusLabel(detailTarefa.status)}</span>
                </div>
              </div>
              <div className="mb-3">
                <p className="text-lg font-bold text-gray-100 leading-snug">{detailTarefa.titulo || detailTarefa.descricao}</p>
              </div>
              {detailTarefa.descricao && detailTarefa.titulo && (
                <div className="mb-5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Descrição</p>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">{detailTarefa.descricao}</p>
                </div>
              )}
              {detailTarefa.meta?.descricao && (
                <div className="mb-5">
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Meta estratégica vinculada</p>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">{detailTarefa.meta.descricao}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Colaborador</p>
                  <p className="text-sm text-gray-200">{detailTarefa.colaborador?.nome ?? detailTarefa.colaborador?.email ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Período</p>
                  <p className="text-sm font-mono text-gray-200">{detailTarefa.data_inicio}{detailTarefa.hora_inicio ? ` ${detailTarefa.hora_inicio}` : ''} → {detailTarefa.data_fim}{detailTarefa.hora_fim ? ` ${detailTarefa.hora_fim}` : ''}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Bonificação</p>
                  <p className="text-sm font-mono text-accent font-bold">{fmtBRL(Number(detailTarefa.valor_bonificacao ?? 0))}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Setor</p>
                  <p className="text-sm text-gray-200">{detailTarefa.setor ? labelSetorOpcao(detailTarefa.setor) : '—'}</p>
                </div>
              </div>
              {detailTarefa.status === 'Rejeitada' && detailTarefa.feedback_aprovacao && (
                <div className="mb-5 rounded-xl bg-red-950/30 border border-red-900/40 p-3">
                  <p className="text-[10px] text-red-400 uppercase tracking-widest font-bold mb-2 flex items-center gap-1">
                    <MessageSquare size={11} />Feedback da rejeição
                  </p>
                  <p className="text-sm text-red-200 whitespace-pre-wrap break-words leading-relaxed">{detailTarefa.feedback_aprovacao}</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                {(isAdmin || isGerente || detailTarefa.colaborador_id === profile?.id) && (
                  <button onClick={() => gerarPdfTarefa(detailTarefa)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent px-3 py-2 transition-colors neu-button rounded-xl">
                    <FileDown size={13} />PDF
                  </button>
                )}
                <button onClick={() => setDetailTarefa(null)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors ml-auto">Fechar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {showThresholdEdit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowThresholdEdit(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-md w-full">
              <h3 className="text-base font-bold text-gray-200 mb-2">Limite para folga conquistada</h3>
              <p className="text-xs text-gray-400 mb-4">
                Quando o colaborador acumula este valor em bonificações aprovadas (estratégicas ou táticas), ganha uma folga automática.
              </p>
              <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Valor (R$)</label>
              <input type="text" inputMode="numeric" value={thresholdDraft}
                onChange={e => setThresholdDraft(formatBRL(e.target.value))}
                onKeyDown={handleMoneyKeyDown}
                placeholder="2.500,00"
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1 mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowThresholdEdit(false)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors">Cancelar</button>
                <NeuButtonAccent variant="" onClick={handleSaveThreshold} disabled={savingThreshold}>
                  {savingThreshold ? 'Salvando...' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
        {rejectId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setRejectId(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/5 max-w-md w-full">
              <h3 className="text-base font-bold text-gray-200 mb-2">Rejeitar tarefa</h3>
              <p className="text-xs text-gray-400 mb-4">Explique o motivo — o colaborador verá esse feedback.</p>
              <textarea value={rejectFeedback}
                onChange={e => setRejectFeedback(e.target.value)}
                rows={4} placeholder="Ex.: Resultado não comprovado."
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setRejectId(null)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 transition-colors">Cancelar</button>
                <NeuButtonAccent variant="" onClick={handleRejeitarTarefa} disabled={busyId === rejectId}>
                  {busyId === rejectId ? 'Enviando...' : 'Rejeitar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
