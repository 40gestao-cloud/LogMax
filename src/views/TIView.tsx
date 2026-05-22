import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Monitor, X, Plus, Loader2, Check, ChevronRight, LifeBuoy,
} from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useTheme } from '../contexts/ThemeContext';
import { SETOR_GRID, corDoSetor, setorLabel } from '../lib/setores';
import type { UserProfile } from '../hooks/useUserProfile';

type TIChamado = {
  id: string;
  setor_origem: string;
  tipo_problema: string;
  descricao: string;
  urgencia: 'Baixa' | 'Média' | 'Alta';
  status: 'Aberto' | 'Em andamento' | 'Resolvido';
  nome_criador?: string | null;
  created_at: string;
  resolvido_em?: string | null;
};

const TIPO_PROBLEMA = ['Hardware', 'Software', 'Rede', 'Inteligência Artificial', 'Outro'];
const URGENCIAS    = ['Baixa', 'Média', 'Alta'] as const;

const STATUS_STYLE: Record<string, string> = {
  'Aberto':       'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  'Em andamento': 'bg-yellow-400/15 text-yellow-400 border border-yellow-400/30',
  'Resolvido':    'bg-accent/15 text-accent border border-accent/30',
};

const URGENCIA_STYLE: Record<string, string> = {
  'Baixa': 'text-gray-400',
  'Média': 'text-yellow-400',
  'Alta':  'text-red-500',
};

const EMPTY_FORM = {
  setor_origem: '',
  tipo_problema: 'Hardware',
  descricao: '',
  urgencia: 'Média' as 'Baixa' | 'Média' | 'Alta',
};

const isThisMonth = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

const formatRelative = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)     return 'agora';
  if (diff < 3600)   return `${Math.floor(diff / 60)} min atrás`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h atrás`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d atrás`;
  return d.toLocaleDateString('pt-BR');
};

type TIViewProps = {
  showToast: (msg: string, type?: string) => void;
  profile: UserProfile;
};

export const TIView = ({ showToast, profile }: TIViewProps) => {
  const { accentColor } = useTheme();

  // RLS já restringe: TI/admin vê tudo, demais setores só veem os próprios.
  const { data: chamados, setData, isLoading } =
    useFetchData<TIChamado>('/api/tichamadosview', undefined, true);

  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [updatingId, setUpdating] = useState<string | null>(null);
  // Drill-down: setor cujos chamados estão sendo exibidos no painel.
  const [setorAberto, setSetorAberto] = useState<string | null>(null);

  // O responsável TI é quem tem setor='ti'. Admin/CEO também vê o dashboard.
  const isTIStaff = profile.setor === 'ti' || profile.role === 'admin' || profile.role === 'ceo';

  const openForm = (setorId?: string) => {
    const setor = setorId ?? (isTIStaff ? '' : profile.setor);
    setForm({ ...EMPTY_FORM, setor_origem: setor });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.setor_origem)         { showToast('Selecione o setor.', 'error'); return; }
    if (!form.descricao.trim())     { showToast('Descreva o problema.', 'error'); return; }

    setSaving(true);
    try {
      const created = await dbInsert<TIChamado>('/api/tichamadosview', {
        ...form,
        descricao: form.descricao.trim(),
        status: 'Aberto',
        nome_criador: profile.nome,
        criado_por: profile.id,
      });
      if (created) setData(prev => [created, ...prev]);

      // Notifica o setor 'ti' — só o(s) usuário(s) responsáveis recebem.
      if (supabase) {
        await supabase.rpc('notificar_setor', {
          p_setor:     'ti',
          p_tipo:      'ti_chamado',
          p_titulo:    `Novo chamado: ${setorLabel(form.setor_origem)}`,
          p_mensagem:  `${form.tipo_problema} — ${form.descricao.slice(0, 80)}`,
          p_link_view: 'ti-chamados',
          p_urgencia:  form.urgencia,
          p_ref_id:    created?.id ?? null,
        });
      }

      showToast('Chamado aberto. TI foi notificado.', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err: any) {
      showToast(`Erro ao abrir chamado: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const advanceStatus = async (c: TIChamado) => {
    if (!isTIStaff) return;
    const next: TIChamado['status'] | null =
      c.status === 'Aberto' ? 'Em andamento'
      : c.status === 'Em andamento' ? 'Resolvido'
      : null;
    if (!next) return;

    setUpdating(c.id);
    try {
      const patch: Partial<TIChamado> = { status: next };
      if (next === 'Resolvido') patch.resolvido_em = new Date().toISOString();

      const updated = await dbUpdate<TIChamado>('/api/tichamadosview', c.id, patch);
      setData(prev => prev.map(x => x.id === c.id ? { ...x, ...updated } : x));

      // Avisa o setor que abriu (setores fictícios — ia/equipamentos — caem em 'all').
      const setorDestino =
        c.setor_origem === 'ia' || c.setor_origem === 'equipamentos' ? 'all' : c.setor_origem;
      if (supabase) {
        await supabase.rpc('notificar_setor', {
          p_setor:     setorDestino,
          p_tipo:      next === 'Resolvido' ? 'ti_resolvido' : 'info',
          p_titulo:    next === 'Resolvido' ? 'Chamado resolvido' : 'Chamado em andamento',
          p_mensagem:  c.descricao.slice(0, 120),
          p_link_view: 'ti-chamados',
          p_urgencia:  'Baixa',
          p_ref_id:    c.id,
        });
      }
      showToast(`Status atualizado: ${next}`, 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setUpdating(null);
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  // ──────────────────────────────────────────────
  // MODO 1: RESPONSÁVEL TI (setor='ti') + admin/CEO
  // ──────────────────────────────────────────────
  if (isTIStaff) {
    const kpis = (() => {
      const abertos       = chamados.filter(c => c.status === 'Aberto').length;
      const emAndamento   = chamados.filter(c => c.status === 'Em andamento').length;
      const resolvidosMes = chamados.filter(c => c.status === 'Resolvido' && c.resolvido_em && isThisMonth(c.resolvido_em)).length;
      return [
        { label: 'Abertos',        value: abertos,       color: 'text-blue-400'   },
        { label: 'Em andamento',   value: emAndamento,   color: 'text-yellow-400' },
        { label: 'Resolvidos/mês', value: resolvidosMes, color: 'text-accent'     },
      ];
    })();

    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

        <div className="shrink-0 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl neu-pressed flex items-center justify-center text-accent">
            <Monitor size={20} />
          </div>
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">TI & Suporte</h2>
            <p className="text-sm text-gray-400 mt-0.5">Painel da equipe de TI — chamados de todos os setores.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
          {kpis.map(k => (
            <div key={k.label} className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
              <p className={`text-2xl sm:text-3xl font-black ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        <section className="shrink-0">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Chamados por setor</h3>
          <p className="text-[11px] text-gray-600 mb-3 -mt-2">Clique em um setor para ver os chamados que ele abriu.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {SETOR_GRID.map(s => {
              const Icon = s.icon;
              const doSetor      = chamados.filter(c => c.setor_origem === s.id);
              const naoResolvidos = doSetor.filter(c => c.status !== 'Resolvido').length;
              const total         = doSetor.length;
              return (
                <button
                  key={s.id}
                  onClick={() => setSetorAberto(s.id)}
                  disabled={total === 0}
                  className={`neu-flat rounded-2xl p-4 border border-white/5 flex flex-col items-center gap-2 transition-all group relative ${
                    total === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:neu-pressed'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl neu-pressed flex items-center justify-center relative" style={{ color: corDoSetor(s.id, accentColor) }}>
                    <Icon size={22} />
                    {naoResolvidos > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center border-2 border-[var(--color-bg-base)]">
                        {naoResolvidos > 9 ? '9+' : naoResolvidos}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-gray-300 group-hover:text-gray-100">{s.label}</span>
                  <span className="text-[10px] text-gray-600">
                    {total === 0 ? 'sem chamados' : `${total} chamado${total > 1 ? 's' : ''}`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <SetorChamadosModal
          setorId={setorAberto}
          setorColor={setorAberto ? corDoSetor(setorAberto, accentColor) : null}
          chamados={chamados.filter(c => c.setor_origem === setorAberto)}
          updatingId={updatingId}
          onClose={() => setSetorAberto(null)}
          onAdvance={advanceStatus}
        />

        <FormModal
          show={showForm}
          onClose={() => !saving && setShowForm(false)}
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={handleSave}
          allowSetorChange={true}
        />
      </motion.div>
    );
  }

  // ──────────────────────────────────────────────
  // MODO 2: SOLICITANTE (qualquer outro setor)
  // ──────────────────────────────────────────────
  const meusChamados = [...chamados].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const meusAbertos      = meusChamados.filter(c => c.status === 'Aberto').length;
  const meusEmAndamento  = meusChamados.filter(c => c.status === 'Em andamento').length;
  const meusResolvidos   = meusChamados.filter(c => c.status === 'Resolvido').length;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="shrink-0 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl neu-pressed flex items-center justify-center text-accent">
          <LifeBuoy size={20} />
        </div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Suporte de TI</h2>
          <p className="text-sm text-gray-400 mt-0.5">Abra um chamado para a equipe de TI resolver o seu problema.</p>
        </div>
      </div>

      {/* CTA principal */}
      <div className="neu-flat rounded-3xl p-6 sm:p-8 border border-white/5 shrink-0 flex flex-col sm:flex-row items-center gap-6">
        <div className="flex-1">
          <h3 className="text-lg sm:text-xl font-bold text-gray-100 mb-1">Precisa de ajuda?</h3>
          <p className="text-sm text-gray-400">
            Descreva o problema (hardware, software, rede, IA ou outro) e o time de TI será notificado imediatamente.
          </p>
        </div>
        <NeuButtonAccent variant="" onClick={() => openForm()}>
          <Plus size={14} />Abrir novo chamado
        </NeuButtonAccent>
      </div>

      {/* KPIs pessoais */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
        <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">Abertos</p>
          <p className="text-2xl sm:text-3xl font-black text-blue-400">{meusAbertos}</p>
        </div>
        <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">Em andamento</p>
          <p className="text-2xl sm:text-3xl font-black text-yellow-400">{meusEmAndamento}</p>
        </div>
        <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">Resolvidos</p>
          <p className="text-2xl sm:text-3xl font-black text-accent">{meusResolvidos}</p>
        </div>
      </div>

      {/* Lista de chamados do próprio usuário */}
      <section className="shrink-0">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Meus chamados</h3>

        {meusChamados.length === 0 ? (
          <EmptyState message="Você ainda não abriu nenhum chamado" />
        ) : (
          <div className="flex flex-col gap-2.5">
            {meusChamados.map(c => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-2xl p-4 border border-white/5">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status] ?? ''}`}>{c.status}</span>
                  <span className={`text-[10px] font-black uppercase tracking-wide ${URGENCIA_STYLE[c.urgencia] ?? ''}`}>{c.urgencia}</span>
                  <span className="text-[10px] text-gray-600">• {c.tipo_problema}</span>
                </div>
                <p className="text-sm font-bold text-gray-200">{c.descricao}</p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="text-[10px] text-gray-600">{formatRelative(c.created_at)}</span>
                  {c.status === 'Resolvido' && c.resolvido_em && (
                    <span className="text-[10px] text-accent">• Resolvido em {new Date(c.resolvido_em).toLocaleDateString('pt-BR')}</span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <FormModal
        show={showForm}
        onClose={() => !saving && setShowForm(false)}
        form={form}
        setForm={setForm}
        saving={saving}
        onSave={handleSave}
        allowSetorChange={false}
      />
    </motion.div>
  );
};

// ──────────────────────────────────────────────
// Modal compartilhado entre os dois modos
// ──────────────────────────────────────────────
type FormModalProps = {
  show: boolean;
  onClose: () => void;
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  saving: boolean;
  onSave: () => void;
  allowSetorChange: boolean;
};

function FormModal({ show, onClose, form, setForm, saving, onSave, allowSetorChange }: FormModalProps) {
  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 top-12 sm:top-20 sm:left-1/2 sm:-translate-x-1/2 sm:inset-x-auto sm:w-full sm:max-w-lg z-50 neu-flat rounded-3xl p-6 border border-white/10"
            style={{ background: 'var(--color-bg-base)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-gray-100">Abrir chamado de TI</h3>
              <button
                onClick={onClose}
                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                {allowSetorChange ? (
                  <select
                    value={form.setor_origem}
                    onChange={e => setForm(f => ({ ...f, setor_origem: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm"
                  >
                    <option value="">Selecione...</option>
                    {SETOR_GRID.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                ) : (
                  <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-300 border border-white/5">
                    {setorLabel(form.setor_origem)}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Tipo de problema</label>
                <select
                  value={form.tipo_problema}
                  onChange={e => setForm(f => ({ ...f, tipo_problema: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm"
                >
                  {TIPO_PROBLEMA.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição *</label>
                <textarea
                  value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  rows={4}
                  placeholder="Descreva o que está acontecendo..."
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Urgência</label>
                <div className="grid grid-cols-3 gap-2">
                  {URGENCIAS.map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, urgencia: u }))}
                      className={`py-2 rounded-xl text-xs font-bold transition-all ${
                        form.urgencia === u
                          ? 'neu-pressed text-accent border border-accent/30'
                          : 'neu-button text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={onClose}
                disabled={saving}
                className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <NeuButtonAccent variant="" onClick={onSave} disabled={saving}>
                {saving ? <><Loader2 size={14} className="animate-spin" />Abrindo...</> : <><Plus size={14} />Abrir chamado</>}
              </NeuButtonAccent>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ──────────────────────────────────────────────
// Modal drill-down: chamados de um setor específico
// ──────────────────────────────────────────────
type SetorChamadosModalProps = {
  setorId: string | null;
  setorColor: string | null;
  chamados: TIChamado[];
  updatingId: string | null;
  onClose: () => void;
  onAdvance: (c: TIChamado) => void;
};

function SetorChamadosModal({ setorId, setorColor, chamados, updatingId, onClose, onAdvance }: SetorChamadosModalProps) {
  const setor = setorId ? SETOR_GRID.find((s) => s.id === setorId) : null;

  // Esc fecha o modal (padrão do AccentPicker no App.tsx).
  React.useEffect(() => {
    if (!setorId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setorId, onClose]);

  // Aberto → Em andamento → Resolvido (mais novos primeiro dentro de cada status)
  const ordered = [...chamados].sort((a, b) => {
    const order = { 'Aberto': 0, 'Em andamento': 1, 'Resolvido': 2 } as const;
    const so = order[a.status] - order[b.status];
    if (so !== 0) return so;
    return +new Date(b.created_at) - +new Date(a.created_at);
  });

  return (
    <AnimatePresence>
      {setorId && setor && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 top-8 sm:top-16 sm:left-1/2 sm:-translate-x-1/2 sm:inset-x-auto sm:w-full sm:max-w-2xl z-50 neu-flat rounded-3xl p-6 border border-white/10 max-h-[85vh] flex flex-col"
            style={{ background: 'var(--color-bg-base)' }}
          >
            <div className="flex items-center justify-between mb-5 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl neu-pressed flex items-center justify-center shrink-0" style={{ color: setorColor ?? setor.color }}>
                  <setor.icon size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-100 truncate">Chamados de {setor.label}</h3>
                  <p className="text-[11px] text-gray-500">{ordered.length} chamado{ordered.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white shrink-0"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2">
              {ordered.length === 0 ? (
                <EmptyState message={`Nenhum chamado de ${setor.label} ainda`} />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {ordered.map(c => (
                    <div key={c.id} className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status] ?? ''}`}>{c.status}</span>
                          <span className={`text-[10px] font-black uppercase tracking-wide ${URGENCIA_STYLE[c.urgencia] ?? ''}`}>{c.urgencia}</span>
                          <span className="text-[10px] text-gray-600">• {c.tipo_problema}</span>
                        </div>
                        <p className="text-sm font-bold text-gray-200 break-words">{c.descricao}</p>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {c.nome_criador && <span className="text-[10px] text-gray-500">Por: <span className="text-gray-300">{c.nome_criador}</span></span>}
                          <span className="text-[10px] text-gray-600">• {formatRelative(c.created_at)}</span>
                          {c.status === 'Resolvido' && c.resolvido_em && (
                            <span className="text-[10px] text-accent">• Resolvido em {new Date(c.resolvido_em).toLocaleDateString('pt-BR')}</span>
                          )}
                        </div>
                      </div>

                      {c.status !== 'Resolvido' && (
                        <button
                          onClick={() => onAdvance(c)}
                          disabled={updatingId === c.id}
                          className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0"
                        >
                          {updatingId === c.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <>{c.status === 'Aberto' ? <ChevronRight size={12} /> : <Check size={12} />}
                                {c.status === 'Aberto' ? 'Atender' : 'Resolver'}
                              </>}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
