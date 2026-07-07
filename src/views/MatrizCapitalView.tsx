import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Landmark, Plus, X, Clock, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';

// ── Tipos ──────────────────────────────────────────────────────────────────
type CapitalRow = {
  id: string;
  filial: string;
  valor: number;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  observacao: string | null;
  created_at: string;
};

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type Filial = typeof FILIAIS[number];

const FILIAL_COLOR: Record<Filial, { accent: string; ring: string; bg: string }> = {
  SuperMax: { accent: 'text-sky-400',    ring: 'ring-sky-500/30',    bg: 'bg-sky-500/10' },
  MaxLook:  { accent: 'text-amber-300',  ring: 'ring-amber-400/30',  bg: 'bg-amber-400/10' },
  TechMax:  { accent: 'text-orange-400', ring: 'ring-orange-500/30', bg: 'bg-orange-500/10' },
};

// ── Helpers ────────────────────────────────────────────────────────────────
const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });

function parseBRL(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function formatBRL(s: string): string {
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10) / 100;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function podeCriar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo' || isConselheiro(p);
}

function podeExcluir(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}

// ── Modal de novo aporte ───────────────────────────────────────────────────
function ModalCapital({
  filial, onClose, onSaved, showToast, profile,
}: {
  filial: Filial;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
  profile: UserProfile | null;
}) {
  const [valorStr, setValorStr] = useState('');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);
  const cor = FILIAL_COLOR[filial];

  const handleSalvar = async () => {
    if (!supabase) return;
    const valor = parseBRL(valorStr);
    if (valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('capital_filial').insert({
        filial,
        valor,
        registrado_por: profile?.id ?? null,
        registrado_por_nome: profile?.nome ?? null,
        observacao: observacao.trim() || null,
      });
      if (error) throw error;
      showToast(`Capital registrado para ${filial}.`, 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-sm border border-accent/20 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Novo Aporte de Capital</h2>
            <span className={`text-xs font-bold ${cor.accent}`}>{filial}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor (R$) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">R$</span>
            <input
              type="text"
              inputMode="numeric"
              value={valorStr}
              onChange={e => setValorStr(formatBRL(e.target.value))}
              className="neu-pressed rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none w-full tabular-nums"
              placeholder="0,00"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Observação</label>
          <textarea
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Ex.: Capital social inicial, reinvestimento..."
          />
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
          Registrar Capital
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Card por filial ────────────────────────────────────────────────────────
function FilialCapitalCard({
  filial, registros, profile, onNovo, onExcluir,
}: {
  filial: Filial;
  registros: CapitalRow[];
  profile: UserProfile | null;
  onNovo: (f: Filial) => void;
  onExcluir: (id: string, filial: string) => void;
}) {
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const cor = FILIAL_COLOR[filial];
  const atual = registros[0] ?? null;
  const historico = registros.slice(1);

  return (
    <div className={`neu-flat rounded-3xl border border-accent/20 overflow-hidden`}>
      {/* Header da filial */}
      <div className={`p-5 ${cor.bg} border-b border-white/5`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark size={16} className={cor.accent} />
            <h3 className={`text-sm font-black uppercase tracking-widest ${cor.accent}`}>{filial}</h3>
          </div>
          {podeCriar(profile) && (
            <button
              onClick={() => onNovo(filial)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/10 text-gray-300 border border-white/10 hover:bg-white/20 transition-colors"
            >
              <Plus size={13} /> Registrar
            </button>
          )}
        </div>

        {/* Capital atual */}
        <div className="mt-4">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Capital Atual</span>
          {atual ? (
            <div className="mt-1">
              <span className={`text-3xl font-black tabular-nums ${cor.accent}`}>
                {BRL(atual.valor)}
              </span>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-500">
                <Clock size={10} />
                <span>{fmtDateTime(atual.created_at)}</span>
                {atual.registrado_por_nome && <span>· {atual.registrado_por_nome}</span>}
              </div>
              {atual.observacao && (
                <p className="text-xs text-gray-400 mt-1 italic">"{atual.observacao}"</p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Nenhum capital registrado.</p>
          )}
        </div>
      </div>

      {/* Histórico */}
      {historico.length > 0 && (
        <div className="p-4">
          <button
            onClick={() => setHistoricoAberto(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {historicoAberto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Histórico ({historico.length} registro{historico.length > 1 ? 's' : ''})
          </button>

          <AnimatePresence>
            {historicoAberto && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex flex-col gap-1.5">
                  {historico.map(r => (
                    <div key={r.id} className="flex items-start gap-2 px-3 py-2 neu-pressed rounded-xl group">
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-bold tabular-nums ${cor.accent}`}>{BRL(r.valor)}</span>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {fmtDateTime(r.created_at)}
                          {r.registrado_por_nome && ` · ${r.registrado_por_nome}`}
                        </div>
                        {r.observacao && (
                          <p className="text-[11px] text-gray-400 italic mt-0.5">"{r.observacao}"</p>
                        )}
                      </div>
                      {podeExcluir(profile) && (
                        <button
                          onClick={() => onExcluir(r.id, filial)}
                          className="shrink-0 p-1 rounded-lg text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── View principal ─────────────────────────────────────────────────────────
export function MatrizCapitalView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const [modalFilial, setModalFilial] = useState<Filial | null>(null);
  const confirm = useConfirm();

  const { data: registros = [], isLoading, reload } = useFetchData<CapitalRow>(
    'capital_filial', undefined, false,
  );

  const porFilial = useMemo(() => {
    const map: Record<Filial, CapitalRow[]> = { SuperMax: [], MaxLook: [], TechMax: [] };
    for (const r of registros) {
      if (r.filial in map) map[r.filial as Filial].push(r);
    }
    // já vem ordenado por created_at DESC do hook
    return map;
  }, [registros]);

  const totalGeral = useMemo(() =>
    FILIAIS.reduce((acc, f) => acc + (porFilial[f][0]?.valor ?? 0), 0),
    [porFilial],
  );

  const handleExcluir = async (id: string, filial: string) => {
    const ok = await confirm({
      message: `Excluir este registro de capital de ${filial}? Esta ação não pode ser desfeita.`,
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('capital_filial').delete().eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Registro excluído.', 'success');
    reload();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6 pb-16"
    >
      {/* Total consolidado */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <div className="flex items-center gap-2 mb-1">
          <Landmark size={14} className="text-accent" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Capital Total Consolidado</span>
        </div>
        <span className="text-4xl font-black text-accent tabular-nums">{BRL(totalGeral)}</span>
        <p className="text-xs text-gray-500 mt-1">Soma do capital atual das 3 filiais</p>
      </div>

      {/* Cards por filial */}
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FILIAIS.map(f => (
            <FilialCapitalCard
              key={f}
              filial={f}
              registros={porFilial[f]}
              profile={profile}
              onNovo={setModalFilial}
              onExcluir={handleExcluir}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {modalFilial && (
          <ModalCapital
            filial={modalFilial}
            profile={profile}
            onClose={() => setModalFilial(null)}
            onSaved={reload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
