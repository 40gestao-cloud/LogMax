import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Star, CheckCircle2, Lock, ClipboardList, Eye, Send, BarChart3, ChevronDown, ChevronRight, Pencil, Trash2, FileDown, ArrowLeft, Building2 } from 'lucide-react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, StatusBadge } from '../components/ui';
import { PDISection } from '../components/PDISection';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { allSetores, hasSetor, isConselheiro } from '../lib/rbac';
import { exportAvaliacoesCicloPDF, exportAvaliacaoIndividualPDF } from '../lib/avaliacoesPdf';
import { CRITERIOS, CRITERIOS_MATRIZ, CATEGORIA_LABEL, CATEGORIA_LABEL_MATRIZ, ESCALA_MAX, type CriteriosSet } from '../lib/avaliacaoCriterios';
import { CriteriosAvaliacaoForm, notasIniciais } from '../components/CriteriosAvaliacaoForm';
import { useConfirm } from '../contexts/ConfirmContext';

type Ciclo = { id: string; nome: string; data_inicio: string; data_fim: string; status: string; feedback_anonimo: boolean; filial: string };
type Avaliacao = {
  id: string;
  ciclo_id: string;
  avaliador_id: string;
  avaliado_id: string | null;
  avaliada_filial: string | null;
  tipo: string;
  observacao: string | null;
  created_at: string;
};
type Criterio = { id: string; avaliacao_id: string; categoria: string; criterio: string; nota: number };

// Alvo de uma avaliação: usuário ou filial como entidade
type AvaliadoTarget =
  | { kind: 'user'; user: UserProfile }
  | { kind: 'filial'; filial: string };

const FILIAIS_OP = ['SuperMax', 'MaxLook', 'TechMax'] as const;

const fmtData = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

// ----------------------------------------------------------------------
// Modal de Avaliação
// ----------------------------------------------------------------------

function ModalAvaliacao({
  ciclo, alvo, tipo, avaliacaoExistente, onClose, onSaved, showToast, criteriosSet, categoriaLabel,
}: {
  ciclo: Ciclo;
  alvo: AvaliadoTarget;
  tipo?: 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador';
  avaliacaoExistente?: { id: string; observacao: string | null; criterios: Criterio[] };
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  showToast: any;
  criteriosSet?: CriteriosSet;
  categoriaLabel?: Record<string, string>;
}) {
  const isEdicao = !!avaliacaoExistente;
  const cs = criteriosSet ?? CRITERIOS;
  const nomeAlvo = alvo.kind === 'user' ? alvo.user.nome : alvo.filial;

  const [notas, setNotas] = useState<Record<string, number>>(() => {
    const init = notasIniciais(cs);
    if (avaliacaoExistente) {
      avaliacaoExistente.criterios.forEach(c => {
        init[`${c.categoria}::${c.criterio}`] = c.nota;
      });
    }
    return init;
  });
  const [observacao, setObservacao] = useState(avaliacaoExistente?.observacao ?? '');
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const p_criterios = Object.keys(cs).flatMap(cat =>
        cs[cat].map(c => ({ categoria: cat, criterio: c, nota: notas[`${cat}::${c}`] }))
      );

      if (isEdicao) {
        const { error } = await supabase.rpc('atualizar_avaliacao', {
          p_avaliacao_id: avaliacaoExistente!.id,
          p_observacao: observacao || null,
          p_criterios,
        });
        if (error) throw error;
      } else if (alvo.kind === 'filial') {
        const { error } = await supabase.rpc('criar_avaliacao_filial', {
          p_ciclo_id: ciclo.id,
          p_avaliada_filial: alvo.filial,
          p_observacao: observacao || null,
          p_criterios,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('criar_avaliacao', {
          p_ciclo_id: ciclo.id,
          p_avaliado_id: alvo.user.id,
          p_tipo: tipo!,
          p_observacao: observacao || null,
          p_criterios,
        });
        if (error) throw error;
      }

      showToast?.(isEdicao ? 'Avaliação atualizada.' : 'Avaliação registrada com sucesso.', 'success');
      await onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.message?.includes('unq_avaliacao')
        ? 'Você já avaliou esta pessoa neste ciclo.'
        : err?.message?.includes('unq_avaliacao_filial')
        ? 'Você já avaliou esta filial neste ciclo.'
        : err?.message ?? (isEdicao ? 'Erro ao atualizar avaliação.' : 'Erro ao salvar avaliação.');
      showToast?.(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="neu-flat rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto main-scrollbar border border-white/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-accent">{isEdicao ? 'Editar Avaliação' : 'Avaliação de Desempenho'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="font-bold text-gray-300">{nomeAlvo}</span>
              {alvo.kind === 'filial' && <span className="ml-1 text-accent text-[10px] font-bold uppercase tracking-widest">· Filial</span>}
              {' '}· Ciclo {ciclo.nome}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          <CriteriosAvaliacaoForm notas={notas} setNotas={setNotas} criteriosSet={cs} categoriaLabel={categoriaLabel} />

          <div>
            <label htmlFor="avaliacao-observacao" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
              Observação (opcional)
            </label>
            <textarea
              id="avaliacao-observacao"
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={3}
              placeholder="Comentários sobre o desempenho avaliado..."
              className="neu-input rounded-xl px-3 py-2.5 text-sm w-full resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 neu-button hover:text-white"
            >
              Cancelar
            </button>
            <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
              <CheckCircle2 size={14} /> {isEdicao ? 'Salvar Alterações' : 'Salvar Avaliação'}
            </NeuButtonAccent>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------
// Modal: novo ciclo
// ----------------------------------------------------------------------

function ModalNovoCiclo({ onClose, onSaved, showToast, filial }: { onClose: () => void; onSaved: () => void; showToast: any; filial: string | null }) {
  // Modo Matriz: default é 'Matriz' (ciclo consolidado)
  const [form, setForm] = useState({ nome: '', data_inicio: '', data_fim: '', feedback_anonimo: true, filial_sel: filial ?? 'Matriz' });
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    if (!form.nome || !form.data_inicio || !form.data_fim) {
      showToast?.('Preencha nome e período.', 'error'); return;
    }
    setSaving(true);
    const filialAlvo = filial ?? form.filial_sel;
    try {
      const { error } = await supabase.from('ciclos_avaliacao').insert({ nome: form.nome, data_inicio: form.data_inicio, data_fim: form.data_fim, feedback_anonimo: form.feedback_anonimo, filial: filialAlvo });
      if (error) throw error;
      showToast?.('Ciclo criado!', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao criar ciclo.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }} animate={{ scale: 1 }}
        className="neu-flat rounded-3xl p-6 max-w-md w-full border border-white/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-accent">Novo Ciclo de Avaliação</h3>
          <button onClick={onClose} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {filial === null && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="avaliacao-ciclo-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Unidade</label>
              <select
                id="avaliacao-ciclo-filial"
                value={form.filial_sel}
                onChange={e => setForm(p => ({ ...p, filial_sel: e.target.value }))}
                className="neu-input rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="Matriz">Matriz (todas as filiais)</option>
                {FILIAIS_OP.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="avaliacao-ciclo-nome" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome</label>
            <input
              id="avaliacao-ciclo-nome"
              type="text"
              value={form.nome}
              onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
              placeholder="Ex: 2026 Q1"
              className="neu-input rounded-xl px-3 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="avaliacao-ciclo-inicio" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início</label>
              <input
                id="avaliacao-ciclo-inicio"
                type="date"
                value={form.data_inicio}
                onChange={e => setForm(p => ({ ...p, data_inicio: e.target.value }))}
                className="neu-input rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="avaliacao-ciclo-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim</label>
              <input
                id="avaliacao-ciclo-fim"
                type="date"
                value={form.data_fim}
                onChange={e => setForm(p => ({ ...p, data_fim: e.target.value }))}
                className="neu-input rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.feedback_anonimo}
              onChange={e => setForm(p => ({ ...p, feedback_anonimo: e.target.checked }))}
              className="w-4 h-4 accent-emerald-500"
            />
            <span className="text-xs text-gray-300">Feedback de colaboradores é anônimo</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/5 mt-2">
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 neu-button hover:text-white">
              Cancelar
            </button>
            <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
              <CheckCircle2 size={14} /> Criar
            </NeuButtonAccent>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------
// Card de detalhe de avaliação
// ----------------------------------------------------------------------

const CardAvaliacao: React.FC<{
  avaliacao: Avaliacao;
  criterios: Criterio[];
  direcaoLabel: string;
  nomeContraparte: string;
  canEditar?: boolean;
  onEditar?: () => void;
  canExcluir?: boolean;
  onExcluir?: () => void;
  onExportPDF?: () => void;
  canEditarPDI?: boolean;
  showPDI?: boolean;
  profile: UserProfile;
  treinamentos: { id: string; nome: string; status: string }[];
  showToast?: any;
  categoriaLabel?: Record<string, string>;
}> = ({
  avaliacao, criterios, direcaoLabel, nomeContraparte,
  canEditar, onEditar, canExcluir, onExcluir, onExportPDF,
  canEditarPDI, showPDI = true, profile, treinamentos, showToast, categoriaLabel,
}) => {
  const [expanded, setExpanded] = useState(false);
  const catLabel = categoriaLabel ?? CATEGORIA_LABEL;

  const mediaTotal = useMemo(() => {
    if (criterios.length === 0) return 0;
    return criterios.reduce((s, c) => s + c.nota, 0) / criterios.length;
  }, [criterios]);

  const mediaPorCat = useMemo(() => {
    const acc: Record<string, { soma: number; count: number }> = {};
    criterios.forEach(c => {
      if (!acc[c.categoria]) acc[c.categoria] = { soma: 0, count: 0 };
      acc[c.categoria].soma += c.nota;
      acc[c.categoria].count += 1;
    });
    return Object.entries(acc).map(([cat, { soma, count }]) => ({
      categoria: cat,
      media: soma / count,
    }));
  }, [criterios]);

  return (
    <div className="neu-flat rounded-2xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs text-gray-500">{direcaoLabel}</p>
          <p className="text-sm font-bold text-gray-200">{nomeContraparte}</p>
        </div>
        <div className="flex items-center gap-2">
          {onExportPDF && (
            <button
              onClick={onExportPDF}
              title="Baixar PDF desta avaliação"
              className="w-7 h-7 neu-button rounded-md flex items-center justify-center text-gray-500 hover:text-accent transition-colors"
            >
              <FileDown size={12} />
            </button>
          )}
          {canEditar && (
            <button onClick={onEditar} title="Editar avaliação" className="action-btn-edit">
              <Pencil size={12} />
            </button>
          )}
          {canExcluir && (
            <button onClick={onExcluir} title="Excluir avaliação" className="action-btn-delete">
              <Trash2 size={12} />
            </button>
          )}
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Média</p>
            <p className="text-2xl font-black text-accent">{mediaTotal.toFixed(1)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {mediaPorCat.map(m => (
          <div key={m.categoria} className="text-center p-2 rounded-lg neu-pressed">
            <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">{catLabel[m.categoria] ?? m.categoria}</p>
            <p className="text-base font-black text-gray-200 mt-0.5">{m.media.toFixed(1)}</p>
          </div>
        ))}
      </div>

      {avaliacao.observacao && (
        <div className="mb-3 p-3 rounded-xl bg-white/[0.02] border-l-2 border-accent/40">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Observação</p>
          <p className="text-xs text-gray-300 italic whitespace-pre-wrap">"{avaliacao.observacao}"</p>
        </div>
      )}

      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-[11px] text-gray-500 hover:text-accent flex items-center justify-center gap-1 py-1 transition-colors"
      >
        <Eye size={11} /> {expanded ? 'Ocultar detalhes' : 'Ver notas por critério'}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-3 mt-2 border-t border-white/5 flex flex-col gap-1.5">
              {criterios.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{c.criterio}</span>
                  <span className="font-bold text-gray-200">{c.nota}/{ESCALA_MAX}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showPDI && (
        <PDISection
          avaliacaoId={avaliacao.id}
          canEditar={!!canEditarPDI}
          profile={profile}
          treinamentos={treinamentos}
          showToast={showToast}
        />
      )}
    </div>
  );
};

// ----------------------------------------------------------------------
// View principal
// ----------------------------------------------------------------------

const AvaliacoesViewInner = ({ showToast, profile, filial, onTrocarFilial }: { showToast: any; profile: UserProfile; filial: FilialOp | null; onTrocarFilial: () => void }) => {
  const [ciclos, setCiclos] = useState<Ciclo[]>([]);
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNovoCiclo, setShowNovoCiclo] = useState(false);

  // Modo Matriz: filial === null (escolha explícita de consolidado)
  const isMatriz = filial === null;

  const [avaliando, setAvaliando] = useState<{
    ciclo: Ciclo;
    alvo: AvaliadoTarget;
    tipo?: 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador';
  } | null>(null);

  const [editando, setEditando] = useState<{
    ciclo: Ciclo;
    alvo: AvaliadoTarget;
    tipo: string;
    avaliacaoExistente: { id: string; observacao: string | null; criterios: Criterio[] };
  } | null>(null);

  const isAdminOuCEO = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  // Critérios e rótulos conforme o contexto ativo
  const csAtivo    = isMatriz ? CRITERIOS_MATRIZ : CRITERIOS;
  const clAtivo    = isMatriz ? CATEGORIA_LABEL_MATRIZ : CATEGORIA_LABEL;
  const isGerente   = profile.role === 'gerente';
  const isRH        = hasSetor(profile, 'rh');
  const podeVerConsolidado = isAdminOuCEO || isRH;

  const { data: treinamentos } = useFetchData<any>('/api/treinamentosview');

  const podeEditarAvaliacao = (av: Avaliacao): boolean => {
    const ciclo = ciclos.find(c => c.id === av.ciclo_id);
    if (!ciclo || ciclo.status !== 'Aberto') return false;
    return isAdminOuCEO || av.avaliador_id === profile.id;
  };

  const excluirAvaliacao = async (av: Avaliacao) => {
    if (!supabase) return;
    if (!isAdminOuCEO) return;
    const critsCount = criterios.filter(c => c.avaliacao_id === av.id).length;
    const avaliadoNome = av.avaliada_filial ?? users.find(u => u.id === av.avaliado_id)?.nome ?? '—';
    const avaliador = users.find(u => u.id === av.avaliador_id);
    const ciclo     = ciclos.find(c => c.id === av.ciclo_id);
    const msg =
      `Excluir esta avaliação?\n\n` +
      `  • De: ${avaliador?.nome ?? '—'}\n` +
      `  • Para: ${avaliadoNome}\n` +
      `  • Ciclo: ${ciclo?.nome ?? '—'}\n` +
      `  • ${critsCount} critério(s) com notas\n\n` +
      `Esta ação é irreversível.`;
    if (!await confirm(msg)) return;
    try {
      const { data, error } = await supabase
        .from('avaliacoes')
        .delete()
        .eq('id', av.id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Nenhuma avaliação removida (RLS pode ter bloqueado).');
      }
      showToast?.('Avaliação excluída.', 'success');
      reload();
    } catch (err: any) {
      showToast?.(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const abrirEdicao = (av: Avaliacao) => {
    const ciclo = ciclos.find(c => c.id === av.ciclo_id);
    if (!ciclo) return;

    let alvo: AvaliadoTarget;
    if (av.avaliada_filial) {
      alvo = { kind: 'filial', filial: av.avaliada_filial };
    } else {
      const avaliado = users.find(u => u.id === av.avaliado_id);
      if (!avaliado) return;
      alvo = { kind: 'user', user: avaliado };
    }

    setEditando({
      ciclo,
      alvo,
      tipo: av.tipo,
      avaliacaoExistente: {
        id: av.id,
        observacao: av.observacao,
        criterios: criterios.filter(c => c.avaliacao_id === av.id),
      },
    });
  };

  const hasLoadedOnce = useRef(false);
  const reload = async () => {
    if (!supabase) { setIsLoading(false); return; }
    if (!hasLoadedOnce.current) setIsLoading(true);
    try {
      // Em modo Matriz carrega tudo (sem filtro de filial)
      const ciclosQ = supabase.from('ciclos_avaliacao').select('*').order('created_at', { ascending: false });
      const avalsQ  = supabase.from('avaliacoes').select('*');
      if (filial) { ciclosQ.eq('filial', filial); avalsQ.eq('filial', filial); }
      const [resC, resU, resA, resCr] = await Promise.all([
        ciclosQ,
        supabase.from('user_profiles').select('*'),
        avalsQ,
        supabase.from('criterios_avaliacao').select('*'),
      ]);
      const firstErr = resC.error || resU.error || resA.error || resCr.error;
      if (firstErr) {
        showToast?.(`Erro ao carregar avaliações: ${firstErr.message}`, 'error');
      }
      setCiclos(resC.data ?? []);
      setUsers(resU.data ?? []);
      setAvaliacoes(resA.data ?? []);
      setCriterios(resCr.data ?? []);
    } catch (err: any) {
      showToast?.(`Erro ao carregar avaliações: ${err?.message ?? 'desconhecido'}`, 'error');
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filial]);

  const fecharCiclo = async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('ciclos_avaliacao').update({ status: 'Fechado' }).eq('id', id);
      if (error) throw error;
      showToast?.('Ciclo fechado.', 'success');
      reload();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao fechar.', 'error');
    }
  };

  const excluirCiclo = async (ciclo: Ciclo) => {
    if (!supabase) return;
    const avaliacoesCiclo = avaliacoes.filter(a => a.ciclo_id === ciclo.id);
    const avalIds = new Set(avaliacoesCiclo.map(a => a.id));
    const critsCount = criterios.filter(c => avalIds.has(c.avaliacao_id)).length;
    const isAberto = ciclo.status === 'Aberto';

    const msg =
      `Excluir o ciclo "${ciclo.nome}"?\n\n` +
      (isAberto ? '⚠️ Este ciclo está ABERTO — pessoas podem estar avaliando agora.\n\n' : '') +
      `Isso vai apagar PERMANENTEMENTE:\n` +
      `  • ${avaliacoesCiclo.length} avaliação(ões)\n` +
      `  • ${critsCount} critério(s) com notas\n\n` +
      `Esta ação é irreversível.`;
    if (!await confirm(msg)) return;

    try {
      const { data, error } = await supabase
        .from('ciclos_avaliacao')
        .delete()
        .eq('id', ciclo.id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Nenhum ciclo removido (RLS pode ter bloqueado).');
      }
      if (cicloConsolidadoId === ciclo.id) setCicloConsolidadoId(null);
      setLinhaExpandida(null);
      showToast?.('Ciclo excluído.', 'success');
      reload();
    } catch (err: any) {
      showToast?.(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  // Ciclo aberto de filial (para avaliações de colaboradores/gerentes)
  const cicloAberto = ciclos.find(c => c.status === 'Aberto' && (filial ? c.filial === filial : c.filial !== 'Matriz')) ?? null;

  // Em modo Matriz: ciclo Matriz aberto (para avaliações de filiais como entidade)
  const cicloMatrizAberto = isMatriz ? (ciclos.find(c => c.status === 'Aberto' && c.filial === 'Matriz') ?? null) : null;

  // Pendentes: quem o usuário deve avaliar no ciclo aberto
  const pendentes = useMemo(() => {
    if (!cicloAberto) return [];
    const minhasFeitas = avaliacoes
      .filter(a => a.ciclo_id === cicloAberto.id && a.avaliador_id === profile.id)
      .map(a => `${a.avaliado_id}::${a.tipo}`);

    let alvos: { user: UserProfile; tipo: 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador' }[] = [];
    const usersFilial = filial ? users.filter(u => !u.filial || u.filial === filial || u.role === 'ceo' || u.role === 'admin') : users;

    if (isAdminOuCEO) {
      alvos = usersFilial
        .filter(u => u.role === 'gerente' && u.id !== profile.id)
        .map(user => ({ user, tipo: 'ceo_gerente' as const }));
    } else if (isGerente) {
      const setoresGerente = allSetores(profile);
      alvos = usersFilial
        .filter(u => u.role === 'colaborador' && setoresGerente.includes(u.setor))
        .map(user => ({ user, tipo: 'gerente_colaborador' as const }));
    } else {
      const setoresColaborador = allSetores(profile);
      const gerentesSetor = usersFilial.filter(u => u.role === 'gerente' && setoresColaborador.includes(u.setor));
      const ceos = users.filter(u => u.role === 'ceo');
      alvos = [...gerentesSetor, ...ceos].map(user => ({ user, tipo: 'feedback_colaborador' as const }));
    }

    return alvos.filter(({ user, tipo }) => !minhasFeitas.includes(`${user.id}::${tipo}`));
  }, [cicloAberto, avaliacoes, users, profile.id, profile.setor, isAdminOuCEO, isGerente, filial]);

  // Filiais ainda não avaliadas no ciclo Matriz aberto
  const filiaisJaAvaliadas = useMemo((): Set<string> => {
    if (!cicloMatrizAberto) return new Set();
    const feitas = avaliacoes.filter(
      a => a.ciclo_id === cicloMatrizAberto.id && a.avaliador_id === profile.id && a.tipo === 'matriz_filial'
    );
    return new Set(feitas.map(a => a.avaliada_filial).filter(Boolean) as string[]);
  }, [cicloMatrizAberto, avaliacoes, profile.id]);

  // Agrupa pendentes de colaboradores/gerentes por filial (modo Matriz)
  const pendentesAgrupadosPorFilial = useMemo(() => {
    if (!isMatriz) return null;
    const grupos: Record<string, typeof pendentes> = {};
    pendentes.forEach(p => {
      const f = p.user.filial ?? 'Sem filial';
      if (!grupos[f]) grupos[f] = [];
      grupos[f].push(p);
    });
    return grupos;
  }, [isMatriz, pendentes]);

  const recebidas = useMemo(() => {
    return avaliacoes
      .filter(a => a.avaliado_id === profile.id)
      .map(av => {
        const ciclo = ciclos.find(c => c.id === av.ciclo_id);
        const avaliador = users.find(u => u.id === av.avaliador_id);
        const isAnonimo = av.tipo === 'feedback_colaborador' && (ciclo?.feedback_anonimo ?? true);
        return {
          avaliacao: av,
          criterios: criterios.filter(c => c.avaliacao_id === av.id),
          avaliadorNome: isAnonimo ? 'Anônimo' : (avaliador?.nome ?? '—'),
          cicloNome: ciclo?.nome ?? '—',
        };
      })
      .sort((a, b) => b.avaliacao.created_at.localeCompare(a.avaliacao.created_at));
  }, [avaliacoes, criterios, users, ciclos, profile.id]);

  const feitas = useMemo(() => {
    return avaliacoes
      .filter(a => a.avaliador_id === profile.id)
      .map(av => {
        const ciclo = ciclos.find(c => c.id === av.ciclo_id);
        // Pode ser avaliação de filial (avaliado_id=null) ou de pessoa
        const avaliadoNome = av.avaliada_filial
          ? av.avaliada_filial
          : (users.find(u => u.id === av.avaliado_id)?.nome ?? '—');
        return {
          avaliacao: av,
          criterios: criterios.filter(c => c.avaliacao_id === av.id),
          avaliadoNome,
          cicloNome: ciclo?.nome ?? '—',
          isFilialEval: av.tipo === 'matriz_filial',
        };
      })
      .sort((a, b) => b.avaliacao.created_at.localeCompare(a.avaliacao.created_at));
  }, [avaliacoes, criterios, users, ciclos, profile.id]);

  // ── Consolidado do ciclo ──────────────────────────────────────────────────
  const [cicloConsolidadoId, setCicloConsolidadoId] = useState<string | null>(null);
  const [linhaExpandida, setLinhaExpandida] = useState<string | null>(null);
  const [exportandoPDF, setExportandoPDF] = useState(false);
  const [pdiAvaliacaoAberta, setPdiAvaliacaoAberta] = useState<string | null>(null);

  useEffect(() => {
    if (cicloConsolidadoId || ciclos.length === 0) return;
    const aberto = ciclos.find(c => c.status === 'Aberto');
    setCicloConsolidadoId(aberto?.id ?? ciclos[0].id);
  }, [ciclos, cicloConsolidadoId]);

  const consolidado = useMemo(() => {
    if (!podeVerConsolidado || !cicloConsolidadoId) return null;
    const usersFilialSet = new Set(
      (filial ? users.filter(u => !u.filial || u.filial === filial || u.role === 'ceo' || u.role === 'admin') : users).map(u => u.id)
    );
    const avalCiclo = avaliacoes.filter(a => a.ciclo_id === cicloConsolidadoId &&
      (a.avaliado_id ? usersFilialSet.has(a.avaliado_id) : !!a.avaliada_filial)
    );
    const ciclo = ciclos.find(c => c.id === cicloConsolidadoId);

    const buildLinhas = (avals: Avaliacao[]) => {
      const porAvaliado = new Map<string, Avaliacao[]>();
      avals.forEach(a => {
        if (!a.avaliado_id) return;
        const list = porAvaliado.get(a.avaliado_id) ?? [];
        list.push(a);
        porAvaliado.set(a.avaliado_id, list);
      });
      return Array.from(porAvaliado.entries()).map(([avaliadoId, avs]) => {
        const user = users.find(u => u.id === avaliadoId);
        const critsDestaPessoa = criterios.filter(c => avs.some(a => a.id === c.avaliacao_id));
        const mediaGeral = critsDestaPessoa.length === 0
          ? 0
          : critsDestaPessoa.reduce((s, c) => s + c.nota, 0) / critsDestaPessoa.length;
        const porAvaliador = avs.map(av => {
          const crits = criterios.filter(c => c.avaliacao_id === av.id);
          const media = crits.length === 0 ? 0 : crits.reduce((s, c) => s + c.nota, 0) / crits.length;
          const avaliador = users.find(u => u.id === av.avaliador_id);
          const isAnonimo = av.tipo === 'feedback_colaborador' && (ciclo?.feedback_anonimo ?? true);
          return { avaliacaoId: av.id, nome: isAnonimo ? 'Anônimo' : (avaliador?.nome ?? '—'), tipo: av.tipo, media, observacao: av.observacao };
        });
        return {
          avaliadoId,
          nome: user?.nome ?? '—',
          role: user?.role ?? '—',
          setor: user?.setor ?? '—',
          filial: user?.filial ?? '—',
          qtdAvaliacoes: avs.length,
          mediaGeral,
          porAvaliador,
        };
      }).sort((a, b) => b.mediaGeral - a.mediaGeral || a.nome.localeCompare(b.nome));
    };

    // Grupo especial para avaliações de filial como entidade
    const buildLinhasFilial = (avals: Avaliacao[]) => {
      const porFilial = new Map<string, Avaliacao[]>();
      avals.forEach(a => {
        if (!a.avaliada_filial) return;
        const list = porFilial.get(a.avaliada_filial) ?? [];
        list.push(a);
        porFilial.set(a.avaliada_filial, list);
      });
      return Array.from(porFilial.entries()).map(([filialNome, avs]) => {
        const critsFilial = criterios.filter(c => avs.some(a => a.id === c.avaliacao_id));
        const mediaGeral = critsFilial.length === 0
          ? 0
          : critsFilial.reduce((s, c) => s + c.nota, 0) / critsFilial.length;
        const porAvaliador = avs.map(av => {
          const crits = criterios.filter(c => c.avaliacao_id === av.id);
          const media = crits.length === 0 ? 0 : crits.reduce((s, c) => s + c.nota, 0) / crits.length;
          const avaliador = users.find(u => u.id === av.avaliador_id);
          return { avaliacaoId: av.id, nome: avaliador?.nome ?? '—', tipo: av.tipo, media, observacao: av.observacao };
        });
        return {
          avaliadoId: filialNome,
          nome: filialNome,
          role: 'filial',
          setor: '—',
          filial: filialNome,
          qtdAvaliacoes: avs.length,
          mediaGeral,
          porAvaliador,
        };
      }).sort((a, b) => b.mediaGeral - a.mediaGeral || a.nome.localeCompare(b.nome));
    };

    const mkGrupo = (
      tipo: string,
      label: string,
      descricao: string,
    ) => {
      const avs = avalCiclo.filter(a => a.tipo === tipo);
      const linhas = tipo === 'matriz_filial' ? buildLinhasFilial(avs) : buildLinhas(avs);
      return { tipo, label, descricao, linhas, totalAvaliacoes: avs.length };
    };

    const grupos = [
      mkGrupo('ceo_gerente', 'CEO → Gerentes', 'Avaliações que o CEO/admin entregou aos gerentes.'),
      mkGrupo('gerente_colaborador', 'Gerentes → Colaboradores', 'Avaliações que os gerentes entregaram aos colaboradores dos seus setores.'),
      mkGrupo('feedback_colaborador', 'Feedback Reverso', 'Colaboradores avaliando seus gerentes e o CEO. Quando o ciclo é anônimo, o autor é ocultado.'),
      mkGrupo('matriz_filial', 'Avaliação das Filiais', 'Notas atribuídas às filiais como unidade nos 7 eixos da competição.'),
    ];

    const todosCrits = criterios.filter(c => avalCiclo.some(a => a.id === c.avaliacao_id));
    const mediaCiclo = todosCrits.length === 0
      ? 0
      : todosCrits.reduce((s, c) => s + c.nota, 0) / todosCrits.length;

    return {
      totalAvaliacoes: avalCiclo.length,
      totalAvaliados: new Set([
        ...avalCiclo.filter(a => a.avaliado_id).map(a => a.avaliado_id!),
        ...avalCiclo.filter(a => a.avaliada_filial).map(a => a.avaliada_filial!),
      ]).size,
      mediaCiclo,
      cicloStatus: ciclo?.status ?? 'Aberto',
      grupos,
    };
  }, [podeVerConsolidado, cicloConsolidadoId, avaliacoes, criterios, users, ciclos]);

  const handleExportarCicloPDF = async () => {
    const ciclo = ciclos.find(c => c.id === cicloConsolidadoId);
    if (!ciclo || !consolidado) return;
    setExportandoPDF(true);
    try {
      const slug = ciclo.nome.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
      await exportAvaliacoesCicloPDF(
        { id: ciclo.id, nome: ciclo.nome, data_inicio: ciclo.data_inicio, data_fim: ciclo.data_fim, status: ciclo.status, feedback_anonimo: ciclo.feedback_anonimo },
        { totalAvaliacoes: consolidado.totalAvaliacoes, totalAvaliados: consolidado.totalAvaliados, mediaCiclo: consolidado.mediaCiclo, grupos: consolidado.grupos },
        criterios.map(c => ({ avaliacao_id: c.avaliacao_id, categoria: c.categoria, criterio: c.criterio, nota: c.nota })),
        `avaliacoes-${slug}`,
      );
      showToast?.('PDF do ciclo gerado.', 'success');
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    } finally {
      setExportandoPDF(false);
    }
  };

  const handleExportarAvaliacaoIndividualPDF = async (av: Avaliacao) => {
    const ciclo = ciclos.find(c => c.id === av.ciclo_id);
    const avaliador = users.find(u => u.id === av.avaliador_id);
    const avaliadoNome = av.avaliada_filial ?? users.find(u => u.id === av.avaliado_id)?.nome ?? '—';
    if (!ciclo) return;
    const isAnonimo = av.tipo === 'feedback_colaborador' && (ciclo.feedback_anonimo ?? true);
    try {
      const slug = `${avaliadoNome.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${ciclo.nome.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
      await exportAvaliacaoIndividualPDF(
        {
          avaliadorNome: isAnonimo ? 'Anônimo' : (avaliador?.nome ?? '—'),
          avaliadoNome,
          cicloNome: ciclo.nome,
          cicloPeriodo: { inicio: ciclo.data_inicio, fim: ciclo.data_fim },
          tipo: av.tipo,
          observacao: av.observacao,
          criterios: criterios
            .filter(c => c.avaliacao_id === av.id)
            .map(c => ({ avaliacao_id: c.avaliacao_id, categoria: c.categoria, criterio: c.criterio, nota: c.nota })),
        },
        `avaliacao-${slug}`,
      );
      showToast?.('PDF gerado.', 'success');
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao gerar PDF.', 'error');
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="shrink-0 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            Avaliações de Desempenho{filial ? ` — ${filial}` : ' — Matriz'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {isAdminOuCEO && 'Gerencie ciclos, avalie gerentes e filiais, acompanhe o consolidado. '}
            {!isAdminOuCEO && isRH && 'RH: você vê o consolidado de todos os setores e pode propor itens de PDI em qualquer avaliação. '}
            {!isRH && isGerente && 'Avalie os colaboradores do seu setor e veja a nota que recebeu do CEO. '}
            {!isRH && profile.role === 'colaborador' && 'Dê feedback sobre seu gerente e CEO e veja a nota que recebeu. '}
            Veja o histórico do que você avaliou e o que recebeu.
          </p>
        </div>
        <button onClick={onTrocarFilial} className="neu-button py-2 px-4 rounded-xl text-xs text-gray-400 flex items-center gap-2 shrink-0">
          <ArrowLeft size={13} /> Trocar unidade
        </button>
      </div>

      {/* ── A. CICLOS (admin/CEO) ── */}
      {isAdminOuCEO && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Ciclos de Avaliação</h3>
            </div>
            <NeuButtonAccent onClick={() => setShowNovoCiclo(true)}>
              <Plus size={14} /> Novo Ciclo
            </NeuButtonAccent>
          </div>

          {ciclos.length === 0 ? (
            <EmptyState message="Nenhum ciclo criado. Abra o primeiro para começar." />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-4">Nome</th>
                    <th className="pb-3 font-bold px-4">Unidade</th>
                    <th className="pb-3 font-bold px-4">Início</th>
                    <th className="pb-3 font-bold px-4">Fim</th>
                    <th className="pb-3 font-bold px-4 text-center">Status</th>
                    <th className="pb-3 font-bold px-4 text-center">Anônimo</th>
                    <th className="pb-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {ciclos.map(c => (
                    <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{c.nome}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{c.filial}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(c.data_inicio)}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(c.data_fim)}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={c.status} /></td>
                      <td className="py-3 px-4 text-center text-xs text-gray-400">{c.feedback_anonimo ? 'Sim' : 'Não'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {c.status === 'Aberto' && (
                            <button
                              onClick={() => fecharCiclo(c.id)}
                              className="text-[10px] text-gray-500 hover:text-yellow-400 font-bold uppercase tracking-widest flex items-center gap-1"
                            >
                              <Lock size={11} /> Fechar
                            </button>
                          )}
                          <button
                            onClick={() => excluirCiclo(c)}
                            title="Excluir ciclo (apaga avaliações em cascata)"
                            className="text-[10px] text-gray-500 hover:text-red-500 font-bold uppercase tracking-widest flex items-center gap-1"
                          >
                            <Trash2 size={11} /> Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── E. CONSOLIDADO DO CICLO (admin/CEO + RH) ── */}
      {podeVerConsolidado && ciclos.length > 0 && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Visão do Ciclo</h3>
              {consolidado && (
                consolidado.cicloStatus === 'Aberto'
                  ? <span className="px-2 py-1 rounded-lg bg-emerald-900/40 text-emerald-400 text-[10px] font-bold uppercase tracking-widest">Aberto</span>
                  : <span className="px-2 py-1 rounded-lg bg-gray-700/50 text-gray-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1"><Lock size={10} /> Fechado</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="aval-consolidado-ciclo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Ciclo</label>
              <select
                id="aval-consolidado-ciclo"
                value={cicloConsolidadoId ?? ''}
                onChange={e => { setCicloConsolidadoId(e.target.value); setLinhaExpandida(null); }}
                className="neu-input rounded-xl px-3 py-2 text-sm"
              >
                {ciclos.map(c => (
                  <option key={c.id} value={c.id}>{c.nome} · {c.filial} {c.status === 'Aberto' ? '· Aberto' : '· Fechado'}</option>
                ))}
              </select>
              <NeuButtonAccent
                onClick={handleExportarCicloPDF}
                isLoading={exportandoPDF}
                disabled={!consolidado || consolidado.totalAvaliacoes === 0}
              >
                <FileDown size={14} /> PDF
              </NeuButtonAccent>
            </div>
          </div>

          {consolidado?.cicloStatus === 'Fechado' && (
            <div className="mb-4 p-3 rounded-xl bg-gray-800/30 border border-gray-700/50 text-xs text-gray-400 flex items-center gap-2">
              <Lock size={12} className="shrink-0" /> Este ciclo está fechado — nenhuma nova avaliação pode ser registrada nem editada.
            </div>
          )}

          {!consolidado || consolidado.totalAvaliacoes === 0 ? (
            <EmptyState message="Nenhuma avaliação registrada neste ciclo ainda." />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="text-center p-3 rounded-xl neu-pressed">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Avaliações</p>
                  <p className="text-xl font-black text-gray-200 mt-0.5">{consolidado.totalAvaliacoes}</p>
                </div>
                <div className="text-center p-3 rounded-xl neu-pressed">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Avaliados</p>
                  <p className="text-xl font-black text-gray-200 mt-0.5">{consolidado.totalAvaliados}</p>
                </div>
                <div className="text-center p-3 rounded-xl neu-pressed">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Média Geral</p>
                  <p className="text-xl font-black text-accent mt-0.5">{consolidado.mediaCiclo.toFixed(1)}</p>
                </div>
              </div>

              <div className="flex flex-col gap-6">
                {consolidado.grupos.map(grupo => grupo.linhas.length === 0 ? null : (
                  <div key={grupo.tipo}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-1 h-4 bg-accent rounded-full" />
                      <h4 className="text-xs font-bold text-gray-300 uppercase tracking-widest">{grupo.label}</h4>
                      <span className="text-[10px] text-gray-500 font-bold ml-1">
                        {grupo.linhas.length} {grupo.linhas.length === 1 ? 'avaliado' : 'avaliados'}
                        {' · '}
                        {grupo.totalAvaliacoes} {grupo.totalAvaliacoes === 1 ? 'avaliação' : 'avaliações'}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mb-3 pl-3">{grupo.descricao}</p>

                    <div className="overflow-x-auto main-scrollbar">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                            <th className="pb-3 font-bold px-2 w-6"></th>
                            <th className="pb-3 font-bold px-4">
                              {grupo.tipo === 'matriz_filial' ? 'Filial' : 'Avaliado'}
                            </th>
                            <th className="pb-3 font-bold px-4">
                              {grupo.tipo === 'matriz_filial' ? 'Unidade' : 'Role · Setor'}
                            </th>
                            <th className="pb-3 font-bold px-4 text-center">Avaliações</th>
                            <th className="pb-3 font-bold px-4 text-center">Média</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grupo.linhas.map(l => {
                            const linhaKey = `${grupo.tipo}::${l.avaliadoId}`;
                            const aberto = linhaExpandida === linhaKey;
                            return (
                              <React.Fragment key={linhaKey}>
                                <tr
                                  className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                                  onClick={() => setLinhaExpandida(aberto ? null : linhaKey)}
                                >
                                  <td className="py-3 px-2 text-gray-500">
                                    {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </td>
                                  <td className="py-3 px-4 text-sm font-semibold text-gray-200 flex items-center gap-1.5">
                                    {grupo.tipo === 'matriz_filial' && <Building2 size={12} className="text-accent shrink-0" />}
                                    {l.nome}
                                  </td>
                                  <td className="py-3 px-4 text-xs text-gray-500">
                                    {grupo.tipo === 'matriz_filial' ? l.filial : `${l.role} · ${l.setor}`}
                                  </td>
                                  <td className="py-3 px-4 text-xs font-mono text-center text-gray-300 tabular-nums">{l.qtdAvaliacoes}</td>
                                  <td className="py-3 px-4 text-center">
                                    <span className="text-base font-black text-accent tabular-nums">{l.mediaGeral.toFixed(1)}</span>
                                  </td>
                                </tr>
                                {aberto && (
                                  <tr className="border-b border-white/5">
                                    <td colSpan={5} className="px-4 py-3 bg-white/[0.02]">
                                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Avaliadores</p>
                                      <div className="flex flex-col gap-2.5">
                                        {l.porAvaliador.map(pa => {
                                          const avObj = avaliacoes.find(a => a.id === pa.avaliacaoId);
                                          const podeEdit = avObj ? podeEditarAvaliacao(avObj) : false;
                                          const pdiAberto = pdiAvaliacaoAberta === pa.avaliacaoId;
                                          const podeEditarPDIAqui = isAdminOuCEO || isRH || (avObj?.avaliador_id === profile.id);
                                          const isFilialEval = grupo.tipo === 'matriz_filial';
                                          return (
                                            <div key={pa.avaliacaoId} className="flex flex-col gap-1 pb-2 border-b border-white/5 last:border-0 last:pb-0">
                                              <div className="flex items-center justify-between text-xs gap-2">
                                                <span className="text-gray-300">{pa.nome}</span>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-bold text-gray-200 tabular-nums">{pa.media.toFixed(1)}</span>
                                                  {!isFilialEval && (
                                                    <button
                                                      onClick={() => setPdiAvaliacaoAberta(pdiAberto ? null : pa.avaliacaoId)}
                                                      title={pdiAberto ? 'Fechar PDI' : 'Ver / propor PDI'}
                                                      className={`h-6 px-2 neu-button rounded-md flex items-center justify-center text-[9px] font-bold uppercase tracking-widest transition-colors ${pdiAberto ? 'text-accent border border-accent/30' : 'text-gray-500 hover:text-accent'}`}
                                                    >
                                                      PDI
                                                    </button>
                                                  )}
                                                  {podeEdit && avObj && (
                                                    <button
                                                      onClick={() => abrirEdicao(avObj)}
                                                      title="Editar avaliação"
                                                      className="w-6 h-6 neu-button rounded-md flex items-center justify-center text-gray-500 hover:text-accent transition-colors"
                                                    >
                                                      <Pencil size={10} />
                                                    </button>
                                                  )}
                                                  {avObj && isAdminOuCEO && (
                                                    <button
                                                      onClick={() => excluirAvaliacao(avObj)}
                                                      title="Excluir avaliação"
                                                      className="w-6 h-6 neu-button rounded-md flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors"
                                                    >
                                                      <Trash2 size={10} />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                              {pa.observacao && (
                                                <p className="text-[11px] text-gray-400 italic pl-2 border-l-2 border-accent/30 whitespace-pre-wrap">
                                                  "{pa.observacao}"
                                                </p>
                                              )}
                                              {!isFilialEval && pdiAberto && (
                                                <div className="mt-2 neu-pressed rounded-xl p-3 border border-white/5">
                                                  <PDISection
                                                    avaliacaoId={pa.avaliacaoId}
                                                    canEditar={podeEditarPDIAqui}
                                                    profile={profile}
                                                    treinamentos={treinamentos}
                                                    showToast={showToast}
                                                  />
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
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
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── B. AVALIAR FILIAIS (apenas modo Matriz, admin/CEO) ── */}
      {isMatriz && isAdminOuCEO && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Avaliar Filiais</h3>
              <span className="text-[10px] text-gray-500 font-bold">7 eixos da competição</span>
            </div>
            {cicloMatrizAberto && (
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                Ciclo: {cicloMatrizAberto.nome}
              </span>
            )}
          </div>

          {!cicloMatrizAberto ? (
            <EmptyState message="Nenhum ciclo Matriz aberto. Crie um ciclo com unidade = Matriz para avaliar as filiais." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {FILIAIS_OP.map(f => {
                const jaAvaliou = filiaisJaAvaliadas.has(f);
                return (
                  <button
                    key={f}
                    onClick={() => !jaAvaliou && setAvaliando({ ciclo: cicloMatrizAberto, alvo: { kind: 'filial', filial: f } })}
                    disabled={jaAvaliou}
                    className={`neu-button rounded-2xl p-5 flex flex-col gap-2 text-left transition-all ${jaAvaliou ? 'opacity-50 cursor-not-allowed' : 'hover:border-accent'}`}
                    style={{ border: `1px solid ${jaAvaliou ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.05)'}` }}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className={jaAvaliou ? 'text-emerald-500' : 'text-accent'} />
                      <span className="text-sm font-bold text-gray-200">{f}</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 ${jaAvaliou ? 'text-emerald-500' : 'text-accent'}`}>
                      {jaAvaliou ? <><CheckCircle2 size={10} /> Avaliada</> : <><Star size={10} /> Avaliar agora</>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── C. A FAZER (avaliações de pessoas) ── */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Star size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-300">Avaliações a Fazer</h3>
            {pendentes.length > 0 && (
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}>
                {pendentes.length}
              </span>
            )}
          </div>
          {cicloAberto && (
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Ciclo: {cicloAberto.nome}
            </span>
          )}
        </div>

        {!cicloAberto ? (
          <EmptyState message="Nenhum ciclo de filial aberto no momento." />
        ) : pendentes.length === 0 ? (
          <EmptyState message="Você concluiu todas as suas avaliações deste ciclo. 🎉" />
        ) : isMatriz && pendentesAgrupadosPorFilial ? (
          // Modo Matriz: agrupa por filial
          <div className="flex flex-col gap-6">
            {Object.entries(pendentesAgrupadosPorFilial).map(([filialGrupo, grupo]) => (
              <div key={filialGrupo}>
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={12} className="text-accent" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{filialGrupo}</span>
                  <span className="text-[10px] text-gray-600">{grupo.length} pendente(s)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {grupo.map(({ user, tipo }) => (
                    <button
                      key={`${user.id}::${tipo}`}
                      onClick={() => cicloAberto && setAvaliando({ ciclo: cicloAberto, alvo: { kind: 'user', user }, tipo })}
                      className="neu-button rounded-2xl p-4 flex flex-col gap-1 text-left transition-all hover:border-accent"
                      style={{ border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                        {user.role} · {user.setor}
                      </span>
                      <span className="text-sm font-bold text-gray-200">{user.nome}</span>
                      <span className="text-[10px] text-accent flex items-center gap-1 mt-1">
                        <Star size={10} /> Avaliar agora
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Modo filial: lista simples
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendentes.map(({ user, tipo }) => (
              <button
                key={`${user.id}::${tipo}`}
                onClick={() => cicloAberto && setAvaliando({ ciclo: cicloAberto, alvo: { kind: 'user', user }, tipo })}
                className="neu-button rounded-2xl p-4 flex flex-col gap-1 text-left transition-all hover:border-accent"
                style={{ border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {user.role} · {user.setor}
                </span>
                <span className="text-sm font-bold text-gray-200">{user.nome}</span>
                <span className="text-[10px] text-accent flex items-center gap-1 mt-1">
                  <Star size={10} /> Avaliar agora
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── D. AVALIAÇÕES RECEBIDAS ── */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <div className="flex items-center gap-2 mb-5">
          <Eye size={16} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-300">Avaliações Recebidas</h3>
          {recebidas.length > 0 && (
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold ml-1">
              {recebidas.length} {recebidas.length === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </div>

        {recebidas.length === 0 ? (
          <EmptyState message="Você ainda não recebeu nenhuma avaliação." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recebidas.map(r => (
              <CardAvaliacao
                key={r.avaliacao.id}
                avaliacao={r.avaliacao}
                criterios={r.criterios}
                direcaoLabel="de"
                nomeContraparte={`${r.avaliadorNome} · ${r.cicloNome}`}
                onExportPDF={() => handleExportarAvaliacaoIndividualPDF(r.avaliacao)}
                canEditarPDI={isAdminOuCEO || isRH}
                categoriaLabel={clAtivo}
                profile={profile}
                treinamentos={treinamentos}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── E. AVALIAÇÕES FEITAS ── */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <div className="flex items-center gap-2 mb-5">
          <Send size={16} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-300">Avaliações que Você Fez</h3>
          {feitas.length > 0 && (
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold ml-1">
              {feitas.length} {feitas.length === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </div>

        {feitas.length === 0 ? (
          <EmptyState message="Você ainda não fez nenhuma avaliação." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {feitas.map(f => (
              <CardAvaliacao
                key={f.avaliacao.id}
                avaliacao={f.avaliacao}
                criterios={f.criterios}
                direcaoLabel="para"
                nomeContraparte={`${f.avaliadoNome} · ${f.cicloNome}`}
                canEditar={podeEditarAvaliacao(f.avaliacao)}
                onEditar={() => abrirEdicao(f.avaliacao)}
                canExcluir={isAdminOuCEO}
                onExcluir={() => excluirAvaliacao(f.avaliacao)}
                canEditarPDI={!f.isFilialEval && (isAdminOuCEO || isRH || f.avaliacao.avaliador_id === profile.id)}
                showPDI={!f.isFilialEval}
                categoriaLabel={f.isFilialEval ? CATEGORIA_LABEL_MATRIZ : clAtivo}
                profile={profile}
                treinamentos={treinamentos}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modais */}
      <AnimatePresence>
        {showNovoCiclo && (
          <ModalNovoCiclo
            onClose={() => setShowNovoCiclo(false)}
            onSaved={reload}
            showToast={showToast}
            filial={filial}
          />
        )}
        {avaliando && (
          <ModalAvaliacao
            ciclo={avaliando.ciclo}
            alvo={avaliando.alvo}
            tipo={avaliando.tipo}
            onClose={() => setAvaliando(null)}
            onSaved={reload}
            showToast={showToast}
            criteriosSet={avaliando.alvo.kind === 'filial' ? CRITERIOS_MATRIZ : csAtivo}
            categoriaLabel={avaliando.alvo.kind === 'filial' ? CATEGORIA_LABEL_MATRIZ : clAtivo}
          />
        )}
        {editando && (
          <ModalAvaliacao
            ciclo={editando.ciclo}
            alvo={editando.alvo}
            tipo={editando.tipo as 'ceo_gerente' | 'gerente_colaborador' | 'feedback_colaborador'}
            avaliacaoExistente={editando.avaliacaoExistente}
            onClose={() => setEditando(null)}
            onSaved={reload}
            showToast={showToast}
            criteriosSet={editando.alvo.kind === 'filial' ? CRITERIOS_MATRIZ : csAtivo}
            categoriaLabel={editando.alvo.kind === 'filial' ? CATEGORIA_LABEL_MATRIZ : clAtivo}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const AvaliacoesView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva, clearFilial } = useFilial();
  return <AvaliacoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} onTrocarFilial={clearFilial} />;
};
