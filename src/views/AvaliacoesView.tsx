import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Star, CheckCircle2, Lock, LockOpen, ClipboardList, Eye, Send, BarChart3, ChevronDown, ChevronRight, Pencil, Trash2, FileDown, Building2, Image as ImageIcon, Upload, Loader2, Award, Crown, Briefcase, Users, MessageCircle, type LucideIcon } from 'lucide-react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, StatusBadge } from '../components/ui';
import { PDISection } from '../components/PDISection';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { allSetores, hasSetor, isConselheiro } from '../lib/rbac';
import { exportAvaliacoesCicloPDF, exportAvaliacaoIndividualPDF } from '../lib/avaliacoesPdf';
import { CRITERIOS, CRITERIOS_MATRIZ, CRITERIOS_ADMIN, CATEGORIA_LABEL, CATEGORIA_LABEL_MATRIZ, CATEGORIA_LABEL_ADMIN, ESCALA_MAX, type CriteriosSet } from '../lib/avaliacaoCriterios';
import { FILIAL_COLOR } from '../lib/filiais';
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
type Evidencia = { id: string; ciclo_id: string; colaborador_id: string; imagem_url: string; created_at: string };

// Alvo de uma avaliação: usuário ou filial como entidade
type AvaliadoTarget =
  | { kind: 'user'; user: UserProfile }
  | { kind: 'filial'; filial: string };

const FILIAIS_OP = ['SuperMax', 'MaxLook', 'TechMax'] as const;

// Retorna o set de critérios adequado a partir do tipo/alvo.
// admin_ceo / admin_conselheiro usam o set estratégico do admin.
const criteriosSetPorTipo = (tipo: string | undefined, alvoKind: 'user' | 'filial'): { cs: CriteriosSet; label: Record<string, string> } => {
  if (alvoKind === 'filial') return { cs: CRITERIOS_MATRIZ, label: CATEGORIA_LABEL_MATRIZ };
  if (tipo === 'admin_ceo' || tipo === 'admin_conselheiro') return { cs: CRITERIOS_ADMIN, label: CATEGORIA_LABEL_ADMIN };
  return { cs: CRITERIOS, label: CATEGORIA_LABEL };
};

// ── Agrupamento visual de "Avaliações a Fazer" por hierarquia ──────────────
// Cada avaliação tem um `tipo` distinto no schema; visualmente elas caem em
// 4 grupos com peso/critérios/mensagem próprios:
//   estrategico  → admin/CEO avaliando CEO/Conselheiro (6 critérios estratégicos)
//   gerentes     → CEO/admin avaliando gerentes
//   colaboradores→ CEO/admin/gerente avaliando colaboradores
//   feedback     → colaborador dando feedback pro gerente/CEO
type HierGrupo = 'estrategico' | 'gerentes' | 'colaboradores' | 'feedback';

const grupoDoTipo = (tipo: string): HierGrupo => {
  if (tipo === 'admin_ceo' || tipo === 'admin_conselheiro' || tipo === 'ceo_conselheiro') return 'estrategico';
  if (tipo === 'ceo_gerente') return 'gerentes';
  if (tipo === 'ceo_colaborador' || tipo === 'gerente_colaborador') return 'colaboradores';
  return 'feedback';
};

const HIER_META: Record<HierGrupo, {
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: string;   // cor do ícone/label
  border: string;   // borda do card (por role dentro do grupo)
  chip: string;     // pill do tipo de critério
}> = {
  estrategico:   { label: 'Estratégico',    hint: 'CEO & Conselheiros · 6 critérios estratégicos', icon: Crown,          accent: 'text-amber-300',   border: 'border-amber-500/30',   chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  gerentes:      { label: 'Gerentes',       hint: '4 critérios de desempenho',                     icon: Briefcase,      accent: 'text-sky-300',      border: 'border-sky-500/25',      chip: 'bg-sky-500/10 text-sky-300 border-sky-500/25' },
  colaboradores: { label: 'Colaboradores',  hint: '4 critérios de desempenho',                     icon: Users,          accent: 'text-gray-300',     border: 'border-white/10',        chip: 'bg-white/5 text-gray-400 border-white/10' },
  feedback:      { label: 'Meu feedback',   hint: 'Sobre meu gerente / CEO',                       icon: MessageCircle,  accent: 'text-emerald-300',  border: 'border-emerald-500/25', chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' },
};

const ORDEM_HIER: HierGrupo[] = ['estrategico', 'gerentes', 'colaboradores', 'feedback'];

const fmtData = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

// ----------------------------------------------------------------------
// Modal de Avaliação
// ----------------------------------------------------------------------

function ModalAvaliacao({
  ciclo, alvo, tipo, avaliacaoExistente, onClose, onSaved, showToast, criteriosSet, categoriaLabel, evidenciasAvaliado,
}: {
  ciclo: Ciclo;
  alvo: AvaliadoTarget;
  tipo?: 'ceo_gerente' | 'ceo_colaborador' | 'ceo_conselheiro' | 'admin_ceo' | 'admin_conselheiro' | 'gerente_colaborador' | 'feedback_colaborador';
  avaliacaoExistente?: { id: string; observacao: string | null; criterios: Criterio[] };
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  showToast: any;
  criteriosSet?: CriteriosSet;
  categoriaLabel?: Record<string, string>;
  evidenciasAvaliado?: Evidencia[];
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
          {evidenciasAvaliado && evidenciasAvaliado.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <ImageIcon size={11} /> Comprovantes de Vendas Online ({evidenciasAvaliado.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {evidenciasAvaliado.map(ev => (
                  <a key={ev.id} href={ev.imagem_url} target="_blank" rel="noopener noreferrer"
                    className="rounded-xl overflow-hidden border border-white/10 hover:border-accent/50 transition-colors"
                    style={{ aspectRatio: '1' }}>
                    <img src={ev.imagem_url} alt="Comprovante" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

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

function ModalNovoCiclo({ onClose, onSaved, showToast, filial, cicloEditar }: { onClose: () => void; onSaved: () => void; showToast: any; filial: string | null; cicloEditar?: Ciclo | null }) {
  const isEdit = !!cicloEditar;
  // Modo Matriz: default é 'Matriz' (ciclo consolidado)
  const [form, setForm] = useState({
    nome: cicloEditar?.nome ?? '',
    data_inicio: cicloEditar?.data_inicio ?? '',
    data_fim: cicloEditar?.data_fim ?? '',
    feedback_anonimo: cicloEditar?.feedback_anonimo ?? true,
    filial_sel: cicloEditar?.filial ?? filial ?? 'Matriz',
  });
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    if (!form.nome || !form.data_inicio || !form.data_fim) {
      showToast?.('Preencha nome e período.', 'error'); return;
    }
    setSaving(true);
    // Em edit mode preserva a filial original do ciclo (form.filial_sel foi inicializado com ela);
    // isso evita que um admin/CEO em modo filial reescreva sem querer a filial de um ciclo Matriz.
    const filialAlvo = isEdit ? form.filial_sel : (filial ?? form.filial_sel);
    try {
      if (isEdit && cicloEditar) {
        const { error } = await supabase.from('ciclos_avaliacao')
          .update({ nome: form.nome, data_inicio: form.data_inicio, data_fim: form.data_fim, feedback_anonimo: form.feedback_anonimo, filial: filialAlvo })
          .eq('id', cicloEditar.id);
        if (error) throw error;
        showToast?.('Ciclo atualizado!', 'success');
      } else {
        const { error } = await supabase.from('ciclos_avaliacao').insert({ nome: form.nome, data_inicio: form.data_inicio, data_fim: form.data_fim, feedback_anonimo: form.feedback_anonimo, filial: filialAlvo });
        if (error) throw error;
        showToast?.('Ciclo criado!', 'success');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao salvar ciclo.', 'error');
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
          <h3 className="text-lg font-bold text-accent">{isEdit ? 'Editar Ciclo de Avaliação' : 'Novo Ciclo de Avaliação'}</h3>
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
              <CheckCircle2 size={14} /> {isEdit ? 'Salvar' : 'Criar'}
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

const AvaliacoesViewInner = ({ showToast, profile, filial }: { showToast: any; profile: UserProfile; filial: FilialOp | null }) => {
  const [ciclos, setCiclos] = useState<Ciclo[]>([]);
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNovoCiclo, setShowNovoCiclo] = useState(false);
  const [editandoCiclo, setEditandoCiclo] = useState<Ciclo | null>(null);
  const [uploadingEv, setUploadingEv] = useState(false);
  const evidFileRef = useRef<HTMLInputElement>(null);
  const [painel, setPainel] = useState<Array<{ filial: string; eixo: string; nota_subjetiva: number | null; metrica_valor: number | null; metrica_label: string | null }> | null>(null);
  const [carregandoPainel, setCarregandoPainel] = useState(false);

  // Modo Matriz: filial === null (escolha explícita de consolidado)
  const isMatriz = filial === null;

  const [avaliando, setAvaliando] = useState<{
    ciclo: Ciclo;
    alvo: AvaliadoTarget;
    tipo?: 'ceo_gerente' | 'ceo_colaborador' | 'ceo_conselheiro' | 'admin_ceo' | 'admin_conselheiro' | 'gerente_colaborador' | 'feedback_colaborador';
  } | null>(null);

  const [editando, setEditando] = useState<{
    ciclo: Ciclo;
    alvo: AvaliadoTarget;
    tipo: string;
    avaliacaoExistente: { id: string; observacao: string | null; criterios: Criterio[] };
  } | null>(null);

  const isAdminOuCEO = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  // Gestão (editar/excluir avaliações, avaliar na Matriz) é restrita a admin/CEO —
  // a RPC `atualizar_avaliacao` só aceita esses dois roles; conselheiro veria botões
  // que falham no save. Também alinha com a régua "conselho recebe, admin/CEO avalia".
  const podeGerirAvaliacoes = profile.role === 'admin' || profile.role === 'ceo';
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
    return podeGerirAvaliacoes || av.avaliador_id === profile.id;
  };

  const excluirAvaliacao = async (av: Avaliacao) => {
    if (!supabase) return;
    if (!podeGerirAvaliacoes) return;
    const ciclo = ciclos.find(c => c.id === av.ciclo_id);
    if (!ciclo || ciclo.status !== 'Aberto') {
      showToast?.('Ciclo fechado — exclusão não permitida.', 'error');
      return;
    }
    const critsCount = criterios.filter(c => c.avaliacao_id === av.id).length;
    const avaliadoNome = av.avaliada_filial ?? users.find(u => u.id === av.avaliado_id)?.nome ?? '—';
    const avaliador = users.find(u => u.id === av.avaliador_id);
    const msg =
      `Excluir esta avaliação?\n\n` +
      `  • De: ${avaliador?.nome ?? '—'}\n` +
      `  • Para: ${avaliadoNome}\n` +
      `  • Ciclo: ${ciclo.nome}\n` +
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
      // Em modo Matriz carrega tudo (sem filtro de filial).
      // Em modo filial, também traz o ciclo Matriz + avaliações matriz_filial
      // dessa filial — pra a filial ver o feedback do conselho sobre ela.
      const ciclosQ = supabase.from('ciclos_avaliacao').select('*').order('created_at', { ascending: false });
      const avalsQ  = supabase.from('avaliacoes').select('*');
      if (filial) {
        ciclosQ.or(`filial.eq.${filial},filial.eq.Matriz`);
        avalsQ.or(`filial.eq.${filial},avaliada_filial.eq.${filial}`);
      }
      const [resC, resU, resA, resCr, resEv] = await Promise.all([
        ciclosQ,
        supabase.from('user_profiles').select('*'),
        avalsQ,
        supabase.from('criterios_avaliacao').select('*'),
        supabase.from('evidencias_avaliacao').select('*').order('created_at', { ascending: false }),
      ]);
      const firstErr = resC.error || resU.error || resA.error || resCr.error;
      if (firstErr) {
        showToast?.(`Erro ao carregar avaliações: ${firstErr.message}`, 'error');
      }
      setCiclos(resC.data ?? []);
      setUsers(resU.data ?? []);
      setAvaliacoes(resA.data ?? []);
      setCriterios(resCr.data ?? []);
      setEvidencias(resEv.data ?? []);
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

  const reabrirCiclo = async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('ciclos_avaliacao').update({ status: 'Aberto' }).eq('id', id);
      if (error) throw error;
      showToast?.('Ciclo reaberto — voltou a aceitar avaliações.', 'success');
      reload();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao reabrir.', 'error');
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

  // Ciclos operacionais (de filial) abertos.
  // Em modo Matriz: todos os ciclos de filial abertos (SuperMax, MaxLook, TechMax).
  // Em modo filial: só o ciclo da filial ativa.
  const ciclosOperacionaisAbertos = useMemo(() =>
    ciclos.filter(c => c.status === 'Aberto' && c.filial !== 'Matriz' && (filial ? c.filial === filial : true)),
  [ciclos, filial]);

  // Alias mantido para compatibilidade com JSX que exibe "Ciclo: nome" e para modo filial.
  const cicloAberto = ciclosOperacionaisAbertos[0] ?? null;

  // Em modo Matriz: ciclo Matriz aberto (para avaliações de filiais como entidade)
  const cicloMatrizAberto = isMatriz ? (ciclos.find(c => c.status === 'Aberto' && c.filial === 'Matriz') ?? null) : null;

  // Pendentes: quem o usuário deve avaliar. Em Matriz agrega todos os ciclos de filial abertos
  // + o ciclo Matriz (que cobre gerentes/colaboradores de todas as filiais + conselheiros).
  const pendentes = useMemo(() => {
    if (ciclosOperacionaisAbertos.length === 0 && !cicloMatrizAberto) return [];
    const minhasFeitasPorCiclo = new Map<string, Set<string>>();
    avaliacoes.forEach(a => {
      if (a.avaliador_id !== profile.id) return;
      if (!minhasFeitasPorCiclo.has(a.ciclo_id)) minhasFeitasPorCiclo.set(a.ciclo_id, new Set());
      minhasFeitasPorCiclo.get(a.ciclo_id)!.add(`${a.avaliado_id}::${a.tipo}`);
    });

    const out: { user: UserProfile; tipo: 'ceo_gerente' | 'ceo_colaborador' | 'ceo_conselheiro' | 'admin_ceo' | 'admin_conselheiro' | 'gerente_colaborador' | 'feedback_colaborador'; ciclo: Ciclo }[] = [];
    ciclosOperacionaisAbertos.forEach(ciclo => {
      const feitas = minhasFeitasPorCiclo.get(ciclo.id) ?? new Set();
      const usersFilial = users.filter(u => !u.filial || u.filial === ciclo.filial || u.role === 'ceo' || u.role === 'admin');
      let alvos: { user: UserProfile; tipo: 'ceo_gerente' | 'ceo_colaborador' | 'ceo_conselheiro' | 'admin_ceo' | 'admin_conselheiro' | 'gerente_colaborador' | 'feedback_colaborador' }[] = [];
      if (podeGerirAvaliacoes) {
        // Em Matriz com ciclo Matriz aberto, admin/CEO avalia gerentes/colaboradores
        // pelo ciclo Matriz (bloco abaixo) — evita listar a mesma pessoa 2×.
        if (isMatriz && cicloMatrizAberto) {
          alvos = [];
        } else {
          const gerentes = usersFilial
            .filter(u => u.role === 'gerente' && u.id !== profile.id)
            .map(user => ({ user, tipo: 'ceo_gerente' as const }));
          const colaboradores = isMatriz
            ? usersFilial
                .filter(u => u.role === 'colaborador' && u.id !== profile.id)
                .map(user => ({ user, tipo: 'ceo_colaborador' as const }))
            : [];
          alvos = [...gerentes, ...colaboradores];
        }
      } else if (isGerente) {
        const setoresGerente = allSetores(profile);
        alvos = usersFilial
          .filter(u => u.role === 'colaborador' && setoresGerente.includes(u.setor))
          .map(user => ({ user, tipo: 'gerente_colaborador' as const }));
      } else if (profile.role === 'colaborador') {
        const setoresColaborador = allSetores(profile);
        const gerentesSetor = usersFilial.filter(u => u.role === 'gerente' && setoresColaborador.includes(u.setor));
        const ceos = users.filter(u => u.role === 'ceo');
        alvos = [...gerentesSetor, ...ceos].map(user => ({ user, tipo: 'feedback_colaborador' as const }));
      }
      // Conselheiro puro não avalia indivíduos no Padrão — atua só na Competição/Matriz.
      alvos.forEach(a => {
        if (!feitas.has(`${a.user.id}::${a.tipo}`)) out.push({ ...a, ciclo });
      });
    });

    // Ciclo Matriz — admin/CEO em modo Matriz avalia conselheiros + gerentes + colaboradores
    // de todas as filiais (ciclo consolidado). Só role='conselheiro' puro; gerente+is_conselheiro=true
    // continua sendo avaliado como gerente na filial dele.
    if (podeGerirAvaliacoes && isMatriz && cicloMatrizAberto) {
      const feitasMatriz = minhasFeitasPorCiclo.get(cicloMatrizAberto.id) ?? new Set();
      const isAdmin = profile.role === 'admin';
      const conselheiros = users.filter(u => u.role === 'conselheiro' && u.id !== profile.id);
      conselheiros.forEach(user => {
        // Admin usa set estratégico próprio (admin_conselheiro); CEO/conselheiro mantêm ceo_conselheiro.
        const tipoConsel = isAdmin ? 'admin_conselheiro' as const : 'ceo_conselheiro' as const;
        if (!feitasMatriz.has(`${user.id}::${tipoConsel}`)) out.push({ user, tipo: tipoConsel, ciclo: cicloMatrizAberto });
      });
      const gerentesMatriz = users.filter(u => u.role === 'gerente' && u.id !== profile.id);
      gerentesMatriz.forEach(user => {
        if (!feitasMatriz.has(`${user.id}::ceo_gerente`)) out.push({ user, tipo: 'ceo_gerente' as const, ciclo: cicloMatrizAberto });
      });
      const colaboradoresMatriz = users.filter(u => u.role === 'colaborador' && u.id !== profile.id);
      colaboradoresMatriz.forEach(user => {
        if (!feitasMatriz.has(`${user.id}::ceo_colaborador`)) out.push({ user, tipo: 'ceo_colaborador' as const, ciclo: cicloMatrizAberto });
      });
      // Admin avalia CEOs com o set estratégico.
      if (isAdmin) {
        const ceos = users.filter(u => u.role === 'ceo' && u.id !== profile.id);
        ceos.forEach(user => {
          if (!feitasMatriz.has(`${user.id}::admin_ceo`)) out.push({ user, tipo: 'admin_ceo' as const, ciclo: cicloMatrizAberto });
        });
      }
    }
    return out;
  }, [ciclosOperacionaisAbertos, cicloMatrizAberto, avaliacoes, users, profile.id, profile.role, profile.setor, isAdminOuCEO, isGerente, isMatriz]);

  // Filiais ainda não avaliadas no ciclo Matriz aberto
  const filiaisJaAvaliadas = useMemo((): Set<string> => {
    if (!cicloMatrizAberto) return new Set();
    const feitas = avaliacoes.filter(
      a => a.ciclo_id === cicloMatrizAberto.id && a.avaliador_id === profile.id && a.tipo === 'matriz_filial'
    );
    return new Set(feitas.map(a => a.avaliada_filial).filter(Boolean) as string[]);
  }, [cicloMatrizAberto, avaliacoes, profile.id]);

  // Evidências do próprio usuário no ciclo aberto atual
  const minhasEvidencias = useMemo(() =>
    cicloAberto ? evidencias.filter(e => e.colaborador_id === profile.id && e.ciclo_id === cicloAberto.id) : [],
  [evidencias, cicloAberto, profile.id]);

  const uploadEvidencia = async (file: File) => {
    if (!supabase || !cicloAberto) return;
    const MAX = 120 * 1024;
    if (file.size > MAX) {
      showToast?.(`Arquivo com ${(file.size / 1024).toFixed(1)} KB — limite é 120 KB.`, 'error');
      return;
    }
    const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    if (!ALLOWED.has(file.type)) {
      showToast?.('Formato inválido. Use JPG, PNG ou WEBP.', 'error');
      return;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${cicloAberto.id}/${profile.id}/${Date.now()}.${ext}`;
    setUploadingEv(true);
    try {
      const { error: upErr } = await supabase.storage
        .from('evidencias-avaliacao')
        .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('evidencias-avaliacao').getPublicUrl(path);
      const { error: insErr } = await supabase.from('evidencias_avaliacao').insert({
        ciclo_id: cicloAberto.id,
        colaborador_id: profile.id,
        imagem_url: pub.publicUrl,
      });
      if (insErr) throw insErr;
      showToast?.('Comprovante enviado!', 'success');
      reload();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao enviar imagem.', 'error');
    } finally {
      setUploadingEv(false);
    }
  };

  const carregarPainelMatriz = async () => {
    if (!supabase || !cicloMatrizAberto) return;
    setCarregandoPainel(true);
    try {
      const { data, error } = await supabase.rpc('painel_matriz_metricas', {
        p_ciclo_matriz_id: cicloMatrizAberto.id,
      });
      if (error) throw error;
      setPainel(data ?? []);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao carregar painel.', 'error');
    } finally {
      setCarregandoPainel(false);
    }
  };

  useEffect(() => { if (cicloMatrizAberto) carregarPainelMatriz(); else setPainel(null);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cicloMatrizAberto?.id]);

  // Ranking por eixo: melhor filial em cada critério (com base em nota_subjetiva, fallback em metrica_valor)
  const rankingPorEixo = useMemo(() => {
    if (!painel) return {};
    const porEixo: Record<string, { filial: string; score: number }[]> = {};
    painel.forEach(p => {
      if (!porEixo[p.eixo]) porEixo[p.eixo] = [];
      const score = p.nota_subjetiva != null ? Number(p.nota_subjetiva) : (p.metrica_valor ?? 0);
      porEixo[p.eixo].push({ filial: p.filial, score });
    });
    Object.values(porEixo).forEach(arr => arr.sort((a, b) => b.score - a.score));
    return porEixo;
  }, [painel]);

  const excluirEvidencia = async (ev: Evidencia) => {
    if (!supabase) return;
    try {
      const marker = `/object/public/evidencias-avaliacao/`;
      const idx = ev.imagem_url.indexOf(marker);
      if (idx !== -1) {
        await supabase.storage.from('evidencias-avaliacao').remove([ev.imagem_url.slice(idx + marker.length)]);
      }
      const { error } = await supabase.from('evidencias_avaliacao').delete().eq('id', ev.id);
      if (error) throw error;
      reload();
    } catch (err: any) {
      showToast?.(err?.message ?? 'Erro ao remover comprovante.', 'error');
    }
  };

  // Agrupa pendentes por hierarquia (estratégico / gerentes / colaboradores /
  // feedback). Vale nos dois modos — em Matriz cada card mostra a filial num
  // chip secundário. Ordena por filial → nome dentro de cada grupo.
  const pendentesPorHierarquia = useMemo(() => {
    const grupos: Record<HierGrupo, typeof pendentes> = { estrategico: [], gerentes: [], colaboradores: [], feedback: [] };
    pendentes.forEach(p => grupos[grupoDoTipo(p.tipo)].push(p));
    (Object.keys(grupos) as HierGrupo[]).forEach(g => {
      grupos[g].sort((a, b) => {
        const fa = a.user.filial ?? '';
        const fb = b.user.filial ?? '';
        return fa === fb ? a.user.nome.localeCompare(b.user.nome) : fa.localeCompare(fb);
      });
    });
    return grupos;
  }, [pendentes]);

  const recebidas = useMemo(() => {
    return avaliacoes
      // Exclui `ti_dev_ia` — pertence ao submódulo TI Desenvolvimento IA, tem set de
      // critérios próprio e é exibido lá, não na Central de Avaliação.
      .filter(a => a.avaliado_id === profile.id && a.tipo !== 'ti_dev_ia')
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
      .filter(a => a.avaliador_id === profile.id && a.tipo !== 'ti_dev_ia')
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

  // ── Feedback da Matriz para a filial atual (modo filial) ────────────────
  // Traz avaliações 'matriz_filial' que o conselho registrou sobre esta filial.
  // Como avaliado_id é null, elas não caem em "Recebidas". Este bloco existe
  // pra qualquer usuário da filial ver o feedback consolidado.
  const feedbackMatriz = useMemo(() => {
    if (!filial) return [];
    return avaliacoes
      .filter(a => a.tipo === 'matriz_filial' && a.avaliada_filial === filial)
      .map(av => {
        const ciclo = ciclos.find(c => c.id === av.ciclo_id);
        const avaliador = users.find(u => u.id === av.avaliador_id);
        const crits = criterios.filter(c => c.avaliacao_id === av.id);
        const media = crits.length === 0 ? 0 : crits.reduce((s, c) => s + c.nota, 0) / crits.length;
        return {
          avaliacao: av,
          criterios: crits,
          media,
          avaliadorNome: avaliador?.nome ?? '—',
          cicloNome: ciclo?.nome ?? '—',
        };
      })
      .sort((a, b) => b.avaliacao.created_at.localeCompare(a.avaliacao.created_at));
  }, [filial, avaliacoes, criterios, users, ciclos]);

  const feedbackMatrizMediaGeral = useMemo(() => {
    if (feedbackMatriz.length === 0) return 0;
    return feedbackMatriz.reduce((s, f) => s + f.media, 0) / feedbackMatriz.length;
  }, [feedbackMatriz]);

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

    // Agrupa os 8 tipos crus em 3 supergrupos visíveis na Visão do Ciclo.
    // Cada pessoa aparece 1× por supergrupo (buildLinhas agrega por avaliado_id
    // mesmo se recebeu avaliações de tipos diferentes dentro do mesmo bloco).
    const mkSuperGrupo = (
      id: 'matriz_filial' | 'gerentes_colaboradores' | 'ceo_conselheiros',
      tipos: string[],
      label: string,
      descricao: string,
    ) => {
      const avs = avalCiclo.filter(a => tipos.includes(a.tipo));
      const linhas = id === 'matriz_filial' ? buildLinhasFilial(avs) : buildLinhas(avs);
      return { tipo: id, label, descricao, linhas, totalAvaliacoes: avs.length };
    };

    const grupos = [
      mkSuperGrupo(
        'matriz_filial',
        ['matriz_filial'],
        'Avaliação das Filiais',
        'Notas atribuídas às filiais como unidade nos 7 eixos da competição.',
      ),
      mkSuperGrupo(
        'gerentes_colaboradores',
        ['ceo_gerente', 'ceo_colaborador', 'gerente_colaborador', 'feedback_colaborador'],
        'Avaliação de Gerentes e Colaboradores',
        'Notas do CEO/admin e dos gerentes aos gerentes e colaboradores, mais o feedback reverso (anônimo quando o ciclo pede).',
      ),
      mkSuperGrupo(
        'ceo_conselheiros',
        ['admin_ceo', 'admin_conselheiro', 'ceo_conselheiro'],
        'Avaliação de CEO e Conselheiros',
        'Notas estratégicas do admin ao CEO e aos conselheiros + notas do CEO aos conselheiros (ciclo Matriz).',
      ),
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
      </div>

      {/* ── FEEDBACK DA MATRIZ (só modo filial) ── */}
      {filial && feedbackMatriz.length > 0 && (
        <div className="neu-flat rounded-3xl p-6 border border-amber-500/20 shrink-0">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Award size={16} className="text-amber-300" />
              <h3 className="text-sm font-bold text-gray-300">Feedback da Matriz para {filial}</h3>
              <span className="text-[10px] text-gray-500 font-bold">
                {feedbackMatriz.length} {feedbackMatriz.length === 1 ? 'avaliação' : 'avaliações'} do conselho
              </span>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Média geral</p>
              <p className="text-xl font-black text-amber-300 tabular-nums">{feedbackMatrizMediaGeral.toFixed(1)}<span className="text-sm text-gray-500">/{ESCALA_MAX}</span></p>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mb-4">
            Notas e comentários que o CEO / conselheiros registraram sobre a filial nos 7 eixos da competição.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {feedbackMatriz.map(f => (
              <CardAvaliacao
                key={f.avaliacao.id}
                avaliacao={f.avaliacao}
                criterios={f.criterios}
                direcaoLabel="Conselho"
                nomeContraparte={`${f.avaliadorNome} · ${f.cicloNome}`}
                showPDI={false}
                categoriaLabel={CATEGORIA_LABEL_MATRIZ}
                profile={profile}
                treinamentos={treinamentos}
                showToast={showToast}
              />
            ))}
          </div>
        </div>
      )}

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
                          {c.status === 'Aberto' ? (
                            <button
                              onClick={() => fecharCiclo(c.id)}
                              className="text-[10px] text-gray-500 hover:text-yellow-400 font-bold uppercase tracking-widest flex items-center gap-1"
                            >
                              <Lock size={11} /> Fechar
                            </button>
                          ) : (
                            <button
                              onClick={() => reabrirCiclo(c.id)}
                              title="Volta o ciclo para Aberto — libera edição/nova avaliação"
                              className="text-[10px] text-gray-500 hover:text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1"
                            >
                              <LockOpen size={11} /> Reabrir
                            </button>
                          )}
                          <button
                            onClick={() => setEditandoCiclo(c)}
                            title="Editar ciclo (nome, período, unidade, anonimato)"
                            className="text-[10px] text-gray-500 hover:text-accent font-bold uppercase tracking-widest flex items-center gap-1"
                          >
                            <Pencil size={11} /> Editar
                          </button>
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
                {consolidado.grupos.map(grupo => (
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

                    {grupo.linhas.length === 0 ? (
                      <div className="pl-3 py-4 text-[11px] text-gray-500 italic border-l border-white/5">
                        Nenhuma avaliação registrada neste bloco ainda.
                      </div>
                    ) : (
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
                    )}
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

      {/* ── B2. PAINEL COMPARATIVO DOS 7 EIXOS (Matriz, admin/CEO/RH) ── */}
      {isMatriz && podeVerConsolidado && cicloMatrizAberto && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Painel Comparativo dos 7 Eixos</h3>
              <span className="text-[10px] text-gray-500 font-bold">Ciclo: {cicloMatrizAberto.nome}</span>
            </div>
            <button
              onClick={carregarPainelMatriz}
              disabled={carregandoPainel}
              className="text-[10px] text-gray-500 hover:text-accent font-bold uppercase tracking-widest flex items-center gap-1"
            >
              {carregandoPainel ? <Loader2 size={11} className="animate-spin" /> : <BarChart3 size={11} />}
              Recarregar
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-4">
            Notas subjetivas do avaliador (0-10) + métricas objetivas coletadas do sistema no período do ciclo.
            Ranking por eixo destaca a filial líder em cada critério.
          </p>

          {carregandoPainel && !painel ? (
            <LoadingSpinner />
          ) : !painel || painel.length === 0 ? (
            <EmptyState message="Sem dados do painel. Avalie ao menos uma filial ou aguarde geração de vendas/contas no período." />
          ) : (() => {
            // Totais por filial: soma das notas subjetivas (0-10) por eixo — mesma
            // base do ranking. Fallback pra metrica_valor quando nota_subjetiva é null.
            const totaisPorFilial: Record<string, number> = {};
            const vitoriasPorFilial: Record<string, number> = {};
            FILIAIS_OP.forEach(f => { totaisPorFilial[f] = 0; vitoriasPorFilial[f] = 0; });
            CRITERIOS_MATRIZ.criterios.forEach(eixo => {
              const rank = rankingPorEixo[eixo] ?? [];
              const lider = rank[0];
              if (lider && lider.score > 0) vitoriasPorFilial[lider.filial] = (vitoriasPorFilial[lider.filial] ?? 0) + 1;
              painel.filter(p => p.eixo === eixo).forEach(p => {
                const s = p.nota_subjetiva != null ? Number(p.nota_subjetiva) : (p.metrica_valor ?? 0);
                totaisPorFilial[p.filial] = (totaisPorFilial[p.filial] ?? 0) + s;
              });
            });
            const totalRank = FILIAIS_OP
              .map(f => ({ filial: f, total: totaisPorFilial[f] }))
              .sort((a, b) => b.total - a.total);
            const liderGeral = totalRank[0]?.total > 0 ? totalRank[0].filial : null;
            const posGeral: Record<string, number> = {};
            totalRank.forEach((r, i) => { posGeral[r.filial] = i + 1; });

            const MEDALHA = ['🥇', '🥈', '🥉'];

            return (
              <div className="overflow-x-auto main-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      <th className="pb-3 font-bold px-3">Eixo</th>
                      {FILIAIS_OP.map(f => {
                        const cor = FILIAL_COLOR[f];
                        return (
                          <th key={f} className="pb-3 font-bold px-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}>
                              <Building2 size={9} /> {f}
                            </span>
                          </th>
                        );
                      })}
                      <th className="pb-3 font-bold px-3 text-center">Líder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CRITERIOS_MATRIZ.criterios.map(eixo => {
                      const linhaPorFilial: Record<string, typeof painel[number] | undefined> = {};
                      painel.filter(p => p.eixo === eixo).forEach(p => { linhaPorFilial[p.filial] = p; });
                      const rank = rankingPorEixo[eixo] ?? [];
                      const lider = rank[0];
                      const posPorFilial: Record<string, number> = {};
                      rank.forEach((r, i) => { posPorFilial[r.filial] = i + 1; });
                      const label = linhaPorFilial[FILIAIS_OP[0]]?.metrica_label ?? null;
                      return (
                        <tr key={eixo} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="py-3 px-3 font-semibold text-gray-200">
                            {eixo}
                            {label && <span className="block text-[9px] text-gray-500 font-normal mt-0.5">{label}</span>}
                          </td>
                          {FILIAIS_OP.map(f => {
                            const cell = linhaPorFilial[f];
                            const isLider = lider && lider.filial === f && lider.score > 0;
                            const pos = posPorFilial[f];
                            const nota = cell?.nota_subjetiva;
                            const metrica = cell?.metrica_valor;
                            const notaN = nota != null ? Number(nota) : null;
                            // barra de intensidade: 0-10 → 0-100% da célula, opacidade suave
                            const intensity = notaN != null ? Math.max(0, Math.min(1, notaN / ESCALA_MAX)) : 0;
                            return (
                              <td key={f} className={`py-2 px-2 text-center tabular-nums ${isLider ? 'text-accent font-black' : 'text-gray-300'}`}>
                                <div className="relative rounded-lg overflow-hidden px-2 py-2">
                                  {notaN != null && (
                                    <div
                                      className="absolute inset-0 pointer-events-none"
                                      style={{
                                        background: `linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent) ${intensity * 100}%, transparent ${intensity * 100}%)`,
                                        opacity: isLider ? 0.22 : 0.10,
                                      }}
                                    />
                                  )}
                                  <div className="relative">
                                    {notaN != null && (
                                      <div className="flex items-center justify-center gap-1">
                                        {pos && pos <= 3 && lider && lider.score > 0 && (
                                          <span className="text-[10px] leading-none" title={`${pos}º lugar`}>{MEDALHA[pos - 1]}</span>
                                        )}
                                        <span>{notaN.toFixed(1)}<span className="text-[9px] text-gray-500">/10</span></span>
                                      </div>
                                    )}
                                    {metrica != null && (
                                      <div className="text-[10px] text-gray-500 font-mono">
                                        {label?.startsWith('R$') || label?.includes('(R$)')
                                          ? `R$ ${Number(metrica).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                          : label?.includes('(%)')
                                          ? `${Number(metrica).toFixed(1)}%`
                                          : Number(metrica).toLocaleString('pt-BR')}
                                      </div>
                                    )}
                                    {nota == null && metrica == null && <span className="text-gray-600">—</span>}
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                          <td className="py-3 px-3 text-center">
                            {lider && lider.score > 0 ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${FILIAL_COLOR[lider.filial as keyof typeof FILIAL_COLOR]?.bg ?? ''} ${FILIAL_COLOR[lider.filial as keyof typeof FILIAL_COLOR]?.text ?? ''} ${FILIAL_COLOR[lider.filial as keyof typeof FILIAL_COLOR]?.border ?? ''}`}>
                                🥇 {lider.filial}
                              </span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Linha TOTAL: soma dos scores + líder geral */}
                    <tr className="border-t-2 border-white/10 bg-white/[0.03]">
                      <td className="py-3 px-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Total (0-70)
                        <span className="block text-[9px] text-gray-600 font-normal normal-case tracking-normal mt-0.5">
                          Soma dos 7 eixos · vitórias por eixo
                        </span>
                      </td>
                      {FILIAIS_OP.map(f => {
                        const total = totaisPorFilial[f] ?? 0;
                        const vits = vitoriasPorFilial[f] ?? 0;
                        const pos = posGeral[f];
                        const isLiderGeral = liderGeral === f;
                        return (
                          <td key={f} className={`py-3 px-3 text-center tabular-nums ${isLiderGeral ? 'text-accent font-black' : 'text-gray-300 font-bold'}`}>
                            <div className="flex items-center justify-center gap-1">
                              {pos && liderGeral && <span className="text-[11px] leading-none">{MEDALHA[pos - 1]}</span>}
                              <span>{total.toFixed(1)}</span>
                            </div>
                            <div className="text-[9px] text-gray-500 font-normal mt-0.5">
                              {vits} {vits === 1 ? 'vitória' : 'vitórias'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-3 px-3 text-center">
                        {liderGeral ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${FILIAL_COLOR[liderGeral as keyof typeof FILIAL_COLOR]?.bg ?? ''} ${FILIAL_COLOR[liderGeral as keyof typeof FILIAL_COLOR]?.text ?? ''} ${FILIAL_COLOR[liderGeral as keyof typeof FILIAL_COLOR]?.border ?? ''}`}>
                            👑 {liderGeral}
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()}
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

        {ciclosOperacionaisAbertos.length === 0 && !cicloMatrizAberto ? (
          <EmptyState message="Nenhum ciclo aberto no momento." />
        ) : pendentes.length === 0 ? (
          <EmptyState message="Você concluiu todas as suas avaliações. 🎉" />
        ) : (
          <div className="flex flex-col gap-7">
            {ORDEM_HIER.map(gid => {
              const grupo = pendentesPorHierarquia[gid];
              if (grupo.length === 0) return null;
              const meta = HIER_META[gid];
              const Icone = meta.icon;
              return (
                <div key={gid}>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Icone size={14} className={meta.accent} />
                    <span className={`text-xs font-bold uppercase tracking-widest ${meta.accent}`}>{meta.label}</span>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black bg-white/5 text-gray-300">
                      {grupo.length}
                    </span>
                    <span className="text-[10px] text-gray-600">· {meta.hint}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {grupo.map(({ user, tipo, ciclo }) => (
                      <button
                        key={`${ciclo.id}::${user.id}::${tipo}`}
                        onClick={() => setAvaliando({ ciclo, alvo: { kind: 'user', user }, tipo })}
                        className={`neu-button rounded-2xl p-4 flex flex-col gap-1.5 text-left transition-all hover:border-accent border ${meta.border}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-bold text-gray-100 leading-tight">{user.nome}</span>
                          <Icone size={13} className={`${meta.accent} shrink-0 mt-0.5`} />
                        </div>
                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                          {user.role} · {user.setor}
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {isMatriz && user.filial && (
                            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10 flex items-center gap-1">
                              <Building2 size={9} /> {user.filial}
                            </span>
                          )}
                          <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${meta.chip}`}>
                            {ciclo.nome}
                          </span>
                        </div>
                        <span className="text-[10px] text-accent flex items-center gap-1 mt-1">
                          <Star size={10} /> Avaliar agora
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── D. COMPROVANTES DE VENDAS ONLINE ── */}
      {cicloAberto && (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ImageIcon size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-gray-300">Comprovantes de Vendas Online</h3>
              <span className="text-[10px] text-gray-500 font-bold">{cicloAberto.nome}</span>
            </div>
            <div>
              <input
                ref={evidFileRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadEvidencia(f); e.target.value = ''; }}
              />
              <NeuButtonAccent onClick={() => evidFileRef.current?.click()} disabled={uploadingEv}>
                {uploadingEv
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Upload size={13} />}
                {uploadingEv ? 'Enviando...' : 'Enviar Comprovante'}
              </NeuButtonAccent>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mb-4">
            Envie prints ou fotos comprovando vendas online (JPG/PNG/WEBP · máx 120 KB).
            Seus avaliadores visualizam estes comprovantes ao pontuar o critério{' '}
            <strong className="text-gray-400">Vendas e Atendimento</strong>.
          </p>
          {minhasEvidencias.length === 0 ? (
            <EmptyState message="Nenhum comprovante enviado para este ciclo." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {minhasEvidencias.map(ev => (
                <div key={ev.id} className="relative group rounded-xl overflow-hidden border border-white/10" style={{ aspectRatio: '1' }}>
                  <a href={ev.imagem_url} target="_blank" rel="noopener noreferrer">
                    <img src={ev.imagem_url} alt="Comprovante" className="w-full h-full object-cover" />
                  </a>
                  <button
                    onClick={() => excluirEvidencia(ev)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── E. AVALIAÇÕES RECEBIDAS ── admin/CEO não recebem avaliação */}
      {profile.role !== 'admin' && profile.role !== 'ceo' && (
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
                  categoriaLabel={criteriosSetPorTipo(r.avaliacao.tipo, 'user').label}
                  profile={profile}
                  treinamentos={treinamentos}
                  showToast={showToast}
                />
              ))}
            </div>
          )}
        </div>
      )}

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
                canExcluir={podeGerirAvaliacoes}
                onExcluir={() => excluirAvaliacao(f.avaliacao)}
                canEditarPDI={!f.isFilialEval && (isAdminOuCEO || isRH || f.avaliacao.avaliador_id === profile.id)}
                showPDI={!f.isFilialEval}
                categoriaLabel={criteriosSetPorTipo(f.avaliacao.tipo, f.isFilialEval ? 'filial' : 'user').label}
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
        {editandoCiclo && (
          <ModalNovoCiclo
            onClose={() => setEditandoCiclo(null)}
            onSaved={reload}
            showToast={showToast}
            filial={filial}
            cicloEditar={editandoCiclo}
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
            criteriosSet={criteriosSetPorTipo(avaliando.tipo, avaliando.alvo.kind).cs}
            categoriaLabel={criteriosSetPorTipo(avaliando.tipo, avaliando.alvo.kind).label}
            evidenciasAvaliado={avaliando.alvo.kind === 'user'
              ? evidencias.filter(e =>
                  e.colaborador_id === (avaliando.alvo as Extract<AvaliadoTarget, { kind: 'user' }>).user.id &&
                  e.ciclo_id === avaliando.ciclo.id)
              : undefined}
          />
        )}
        {editando && (
          <ModalAvaliacao
            ciclo={editando.ciclo}
            alvo={editando.alvo}
            tipo={editando.tipo as 'ceo_gerente' | 'ceo_colaborador' | 'ceo_conselheiro' | 'admin_ceo' | 'admin_conselheiro' | 'gerente_colaborador' | 'feedback_colaborador'}
            avaliacaoExistente={editando.avaliacaoExistente}
            onClose={() => setEditando(null)}
            onSaved={reload}
            showToast={showToast}
            criteriosSet={criteriosSetPorTipo(editando.tipo, editando.alvo.kind).cs}
            categoriaLabel={criteriosSetPorTipo(editando.tipo, editando.alvo.kind).label}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const AvaliacoesView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  return <AvaliacoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
