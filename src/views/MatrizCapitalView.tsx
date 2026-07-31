import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { todayBR } from '../lib/dates';
import { motion, AnimatePresence } from 'motion/react';
import {
  Landmark, Plus, X, Clock, Trash2, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle,
  Settings, BarChart3, CreditCard, ShieldAlert, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent, FormField } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatBRL, parseBRL } from '../lib/viewUtils';

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

type CapitalConfig = {
  id: string;
  data_inicio: string;
  data_fim: string | null;
  reserva_min_pct: number;
  taxa_juros_padrao: number;
  criado_por_nome: string | null;
  created_at: string;
};

type SaldoFilial = {
  capital_total: number;
  despesas_pagas: number;
  receitas_pagas: number;
  reserva_valor: number;
  reserva_pct: number;
  saldo_livre: number;
  saldo_real: number;
  bloqueado: boolean;
  em_reserva: boolean;
  data_inicio: string;
  data_fim: string | null;
};

type Emprestimo = {
  id: string;
  filial: string;
  valor: number;
  num_parcelas: number;
  taxa_juros: number;
  justificativa: string;
  banco_id: string | null;
  banco_nome: string | null;
  status: 'Pendente' | 'Aprovado' | 'Negado';
  solicitado_por_nome: string | null;
  aprovado_por_nome: string | null;
  justificativa_resposta: string | null;
  created_at: string;
};

type Banco = { id: string; banco: string; conta: string; tipo: string };

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type Filial = typeof FILIAIS[number];

const FILIAL_COLOR: Record<Filial, { accent: string; ring: string; bg: string }> = {
  SuperMax: { accent: 'text-sky-400',    ring: 'ring-sky-500/30',    bg: 'bg-sky-500/10' },
  MaxLook:  { accent: 'text-amber-300',  ring: 'ring-amber-400/30',  bg: 'bg-amber-400/10' },
  TechMax:  { accent: 'text-orange-400', ring: 'ring-orange-500/30', bg: 'bg-orange-500/10' },
};

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });

function podeCriar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo' || isConselheiro(p);
}
function podeExcluir(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}
function podeAprovar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo' || isConselheiro(p);
}
function podeConfigurar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}

// ── Barra de saúde financeira ──────────────────────────────────────────────
function HealthBar({ saldo, total }: { saldo: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (saldo / total) * 100)) : 0;
  const color = pct > 40 ? 'bg-green-500' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mt-2">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Modal: Novo aporte ─────────────────────────────────────────────────────
function ModalCapital({
  filial, onClose, onSaved, showToast, profile,
}: {
  filial: Filial; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void; profile: UserProfile | null;
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
        filial, valor,
        registrado_por: profile?.id ?? null,
        registrado_por_nome: profile?.nome ?? null,
        observacao: observacao.trim() || null,
      });
      if (error) throw error;
      showToast(`Capital registrado para ${filial}.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally { setSaving(false); }
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
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor (R$) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">R$</span>
            <input
              type="text" inputMode="numeric" value={valorStr}
              onChange={e => setValorStr(formatBRL(e.target.value))}
              className="neu-pressed rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none w-full tabular-nums"
              placeholder="0,00"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Observação</label>
          <textarea
            value={observacao} onChange={e => setObservacao(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Ex.: Capital social inicial, reinvestimento..."
          />
        </div>
        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>Registrar Capital</NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Modal: Aprovar/Negar empréstimo ───────────────────────────────────────
function ModalAprovarEmprestimo({
  emp, bancos, taxaPadrao, onClose, onSaved, showToast,
}: {
  emp: Emprestimo; bancos: Banco[]; taxaPadrao: number;
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [bancoId, setBancoId] = useState('');
  const [taxa, setTaxa] = useState(String(taxaPadrao));
  const [parcelas, setParcelas] = useState(String(emp.num_parcelas));
  const [justResp, setJustResp] = useState('');
  const [saving, setSaving] = useState(false);

  const valorComJuros = emp.valor * (1 + (parseFloat(taxa) || 0) / 100);
  const valorParcela = valorComJuros / (parseInt(parcelas) || 1);
  const bancoCont = bancos.find(b => b.id === bancoId);

  const aprovar = async () => {
    if (!supabase) return;
    if (!bancoId) { showToast('Selecione um banco.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('aprovar_emprestimo', {
        p_emprestimo_id: emp.id,
        p_banco_id: bancoId,
        p_banco_nome: bancoCont ? `${bancoCont.banco} — ${bancoCont.conta}` : '',
        p_taxa_juros: parseFloat(taxa) || 0,
        p_num_parcelas: parseInt(parcelas) || 1,
        p_justificativa_resp: justResp.trim() || null,
      });
      if (error) throw error;
      showToast('Empréstimo aprovado. Parcelas geradas.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
  };

  const negar = async () => {
    if (!supabase) return;
    if (!justResp.trim()) { showToast('Informe a justificativa para negar.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('negar_emprestimo', {
        p_emprestimo_id: emp.id,
        p_justificativa_resp: justResp.trim(),
      });
      if (error) throw error;
      showToast('Empréstimo negado.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
  };

  const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Analisar Empréstimo</h2>
            <span className={`text-xs font-bold ${cor.accent}`}>{emp.filial}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>

        {/* Resumo da solicitação */}
        <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Valor solicitado</span>
            <span className="font-bold text-gray-100 tabular-nums">{BRL(emp.valor)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Solicitante</span>
            <span className="text-gray-300">{emp.solicitado_por_nome ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Parcelas solicitadas</span>
            <span className="text-gray-300">{emp.num_parcelas}x</span>
          </div>
          <div className="text-xs text-gray-400 mt-1 italic border-t border-white/5 pt-2">
            "{emp.justificativa}"
          </div>
        </div>

        {/* Configurar aprovação */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Banco *</label>
            <select
              value={bancoId} onChange={e => setBancoId(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            >
              <option value="">Selecione...</option>
              {bancos.map(b => (
                <option key={b.id} value={b.id}>{b.banco} — {b.conta} ({b.tipo})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Taxa de juros (%)</label>
              <input
                type="number" min="0" step="0.1" value={taxa}
                onChange={e => setTaxa(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nº de parcelas</label>
              <input
                type="number" min="1" max="60" value={parcelas}
                onChange={e => setParcelas(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="neu-pressed rounded-xl p-3 text-xs text-gray-400 flex justify-between">
            <span>Total com juros: <strong className="text-gray-200 tabular-nums">{BRL(valorComJuros)}</strong></span>
            <span>Parcela: <strong className="text-gray-200 tabular-nums">{BRL(valorParcela)}</strong></span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Justificativa / Comentário</label>
            <textarea
              value={justResp} onChange={e => setJustResp(e.target.value)} rows={2}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
              placeholder="Obrigatório para negar; opcional para aprovar."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={negar} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            <XCircle size={15} /> Negar
          </button>
          <NeuButtonAccent onClick={aprovar} isLoading={saving} className="flex-1">
            <CheckCircle size={15} /> Aprovar
          </NeuButtonAccent>
        </div>
      </motion.div>
    </div>
  );
}

// ── Modal: Configuração de período ────────────────────────────────────────
function ModalConfig({
  config, onClose, onSaved, showToast, profile,
}: {
  config: CapitalConfig | null; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void; profile: UserProfile | null;
}) {
  const hoje = todayBR();
  const [dataInicio, setDataInicio] = useState(config?.data_inicio ?? hoje);
  const [dataFim, setDataFim] = useState(config?.data_fim ?? '');
  const [reservaPct, setReservaPct] = useState(String(config?.reserva_min_pct ?? 0));
  const [taxaPadrao, setTaxaPadrao] = useState(String(config?.taxa_juros_padrao ?? 0));
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const payload = {
        data_inicio: dataInicio,
        data_fim: dataFim || null,
        reserva_min_pct: parseFloat(reservaPct) || 0,
        taxa_juros_padrao: parseFloat(taxaPadrao) || 0,
        criado_por: profile?.id ?? null,
        criado_por_nome: profile?.nome ?? null,
      };
      const { error } = await supabase.from('capital_config').insert(payload);
      if (error) throw error;
      showToast('Configuração salva.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
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
          <h2 className="text-base font-bold text-gray-100">Configuração de Período</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        {config && (
          <div className="text-xs text-gray-500 neu-pressed rounded-xl p-3">
            Ativo desde {fmtDate(config.data_inicio)}
            {config.data_fim ? ` até ${fmtDate(config.data_fim)}` : ' (sem prazo)'}
            {' · '}Reserva {config.reserva_min_pct}% · Juros padrão {config.taxa_juros_padrao}%
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Início *</label>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Fim (opcional)</label>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Reserva mínima (%)</label>
            <input type="number" min="0" max="99" step="1" value={reservaPct}
              onChange={e => setReservaPct(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Taxa juros padrão (%)</label>
            <input type="number" min="0" step="0.1" value={taxaPadrao}
              onChange={e => setTaxaPadrao(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
        </div>
        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>Salvar Nova Configuração</NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Card por filial (Aportes) ──────────────────────────────────────────────
function FilialCapitalCard({
  filial, registros, saldo, profile, onNovo, onExcluir,
}: {
  filial: Filial; registros: CapitalRow[]; saldo: SaldoFilial | null;
  profile: UserProfile | null; onNovo: (f: Filial) => void; onExcluir: (id: string, filial: string) => void;
}) {
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const cor = FILIAL_COLOR[filial];
  const ultimo = registros[0] ?? null;
  const bloqueado = saldo?.bloqueado ?? false;
  const emReserva = saldo?.em_reserva ?? false;
  const pctGasto = saldo && saldo.capital_total > 0
    ? Math.min(100, (saldo.despesas_pagas / saldo.capital_total) * 100)
    : 0;

  return (
    <div className="neu-flat rounded-3xl border border-accent/20 overflow-hidden">
      <div className={`p-5 ${cor.bg} border-b border-white/5`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark size={16} className={cor.accent} />
            <h3 className={`text-sm font-black uppercase tracking-widest ${cor.accent}`}>{filial}</h3>
            {bloqueado && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                <ShieldAlert size={10} /> BLOQUEADO
              </span>
            )}
          </div>
          {podeCriar(profile) && (
            <button
              onClick={() => onNovo(filial)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/10 text-gray-300 border border-white/10 hover:bg-white/20 transition-colors"
            >
              <Plus size={13} /> Aporte
            </button>
          )}
        </div>

        {/* Capital e saldo */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Capital Total</span>
            <div className={`text-xl font-black tabular-nums mt-0.5 ${cor.accent}`}>
              {saldo ? BRL(saldo.capital_total) : ultimo ? BRL(ultimo.valor) : '—'}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Saldo Livre</span>
            <div className={`text-xl font-black tabular-nums mt-0.5 ${bloqueado ? 'text-red-400' : 'text-green-400'}`}>
              {saldo ? BRL(saldo.saldo_livre) : '—'}
            </div>
          </div>
        </div>

        {saldo && (
          <>
            <HealthBar saldo={saldo.saldo_real} total={saldo.capital_total} />
            <div className="flex justify-between text-[10px] text-gray-500 mt-1">
              <span>Gasto: {BRL(saldo.despesas_pagas)} ({pctGasto.toFixed(0)}%)</span>
              {saldo.reserva_pct > 0 && <span>Reserva: {BRL(saldo.reserva_valor)}</span>}
            </div>
            {/* A receita aparece aqui só para leitura: quem vende bem e mesmo
                assim vê o saldo cair achava que a DRE discordava do card. Ela
                NÃO entra no saldo livre — capital é aporte menos despesa. */}
            <div className="flex justify-between text-[10px] mt-1 pt-1 border-t border-white/5">
              <span className="text-gray-500">
                Receita no período: <span className="text-green-400 font-bold tabular-nums">{BRL(saldo.receitas_pagas)}</span>
              </span>
              <span className="text-gray-600" title="O capital é aporte − despesas. A receita entra no caixa da filial e aparece na DRE, mas não aumenta o capital.">
                não entra no saldo livre
              </span>
            </div>
            {bloqueado && (
              <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1">
                <AlertTriangle size={10} /> Capital estourado — novos lançamentos bloqueados.
              </p>
            )}
            {emReserva && (
              <p className="text-[11px] text-yellow-400 mt-2 flex items-center gap-1">
                <AlertTriangle size={10} /> Invadiu reserva mínima — atenção.
              </p>
            )}
          </>
        )}
      </div>

      {/* Histórico de aportes (todos, sem "atual" separado) */}
      {registros.length > 0 && (
        <div className="p-4">
          <button
            onClick={() => setHistoricoAberto(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {historicoAberto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Aportes registrados ({registros.length})
            {ultimo && <span className="text-gray-600">· último: {BRL(ultimo.valor)} em {fmtDateTime(ultimo.created_at).slice(0, 10)}</span>}
          </button>
          <AnimatePresence>
            {historicoAberto && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex flex-col gap-1.5">
                  {registros.map(r => (
                    <div key={r.id} className="flex items-start gap-2 px-3 py-2 neu-pressed rounded-xl group">
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-bold tabular-nums ${cor.accent}`}>{BRL(r.valor)}</span>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {fmtDateTime(r.created_at)}{r.registrado_por_nome && ` · ${r.registrado_por_nome}`}
                        </div>
                        {r.observacao && <p className="text-[11px] text-gray-400 italic mt-0.5">"{r.observacao}"</p>}
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

// ── Tab: DRE ──────────────────────────────────────────────────────────────
function TabDRE({ saldos, semConfig }: { saldos: Record<Filial, SaldoFilial | null>; semConfig: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="neu-flat rounded-2xl p-4 border border-accent/10 flex items-start gap-2 text-xs text-gray-400">
        <Info size={13} className="shrink-0 text-accent mt-0.5" />
        {semConfig
          ? <span>
              <b className="text-yellow-400">Sem período configurado</b> — a DRE está somando TODO o histórico,
              não só o período em Config. Receita = contas a receber quitadas (as vendas do PDV entram pela conta
              que elas geram). Despesa = contas pagas. Resultado = Receita − Despesa.
            </span>
          : <span>
              DRE calculado dentro do período configurado. Receita = contas a receber quitadas (as vendas do PDV
              entram pela conta que elas geram). Despesa = contas pagas. Resultado = Receita − Despesa.
            </span>}
      </div>
      {FILIAIS.map(filial => {
        const s = saldos[filial];
        const cor = FILIAL_COLOR[filial];
        const resultado = s ? (s.receitas_pagas - s.despesas_pagas) : 0;
        return (
          <div key={filial} className={`neu-flat rounded-3xl border border-accent/20 overflow-hidden`}>
            <div className={`${cor.bg} px-5 py-3 flex items-center gap-2`}>
              <Landmark size={14} className={cor.accent} />
              <span className={`text-sm font-black uppercase tracking-widest ${cor.accent}`}>{filial}</span>
              {/* Sem config a RPC devolve `data_inicio = CURRENT_DATE` e não
                  filtra nada — imprimir a data de hoje aqui fazia a tela
                  prometer um recorte que ela não aplicou. */}
              {semConfig ? (
                <span className="ml-auto text-[10px] text-gray-600">todo o histórico</span>
              ) : s?.data_inicio && (
                <span className="ml-auto text-[10px] text-gray-500">
                  {fmtDate(s.data_inicio)}{s.data_fim ? ` → ${fmtDate(s.data_fim)}` : ' → hoje'}
                </span>
              )}
            </div>
            <div className="p-5 grid grid-cols-3 gap-4">
              <div className="flex flex-col items-center gap-1">
                <TrendingUp size={14} className="text-green-400" />
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Receita</span>
                <span className="text-lg font-black text-green-400 tabular-nums">
                  {s ? BRL(s.receitas_pagas) : '—'}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <TrendingDown size={14} className="text-red-400" />
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Despesa</span>
                <span className="text-lg font-black text-red-400 tabular-nums">
                  {s ? BRL(s.despesas_pagas) : '—'}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <BarChart3 size={14} className={resultado >= 0 ? 'text-accent' : 'text-orange-400'} />
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Resultado</span>
                <span className={`text-lg font-black tabular-nums ${resultado >= 0 ? 'text-accent' : 'text-orange-400'}`}>
                  {s ? BRL(resultado) : '—'}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Empréstimos ──────────────────────────────────────────────────────
function TabEmprestimos({
  emprestimos, bancos, taxaPadrao, profile, onReload, showToast,
}: {
  emprestimos: Emprestimo[]; bancos: Banco[]; taxaPadrao: number;
  profile: UserProfile | null; onReload: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [modalEmp, setModalEmp] = useState<Emprestimo | null>(null);
  const pendentes = emprestimos.filter(e => e.status === 'Pendente');
  const historico = emprestimos.filter(e => e.status !== 'Pendente');

  const statusIcon = (s: string) => {
    if (s === 'Aprovado') return <CheckCircle size={13} className="text-green-400" />;
    if (s === 'Negado') return <XCircle size={13} className="text-red-400" />;
    return <Clock size={13} className="text-yellow-400" />;
  };

  return (
    <div className="flex flex-col gap-4">
      {pendentes.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-500">Nenhum empréstimo pendente de análise.</div>
      )}

      {pendentes.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-1">
            Aguardando análise ({pendentes.length})
          </span>
          {pendentes.map(emp => {
            const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;
            return (
              <div key={emp.id} className="neu-flat rounded-2xl p-4 border border-yellow-500/20 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={`text-xs font-bold ${cor.accent}`}>{emp.filial}</span>
                    <div className="text-xl font-black text-gray-100 tabular-nums">{BRL(emp.valor)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {emp.num_parcelas}x · por {emp.solicitado_por_nome ?? '—'} · {fmtDate(emp.created_at)}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-full shrink-0">
                    <Clock size={10} /> Pendente
                  </span>
                </div>
                <p className="text-xs text-gray-400 italic border-t border-white/5 pt-2">"{emp.justificativa}"</p>
                {podeAprovar(profile) && (
                  <button
                    onClick={() => setModalEmp(emp)}
                    className="self-end text-xs px-4 py-1.5 rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                  >
                    Analisar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {historico.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-1 mt-2">
            Histórico
          </span>
          {historico.map(emp => {
            const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;
            return (
              <div key={emp.id} className="neu-flat rounded-2xl p-3 border border-white/5 flex items-center gap-3">
                {statusIcon(emp.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${cor.accent}`}>{emp.filial}</span>
                    <span className="text-sm font-bold text-gray-200 tabular-nums">{BRL(emp.valor)}</span>
                    <span className="text-xs text-gray-500">{emp.num_parcelas}x</span>
                    {emp.banco_nome && <span className="text-xs text-gray-500 truncate">{emp.banco_nome}</span>}
                  </div>
                  {emp.justificativa_resposta && (
                    <p className="text-[11px] text-gray-500 mt-0.5 italic truncate">"{emp.justificativa_resposta}"</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-500">{fmtDate(emp.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modalEmp && (
          <ModalAprovarEmprestimo
            emp={modalEmp} bancos={bancos} taxaPadrao={taxaPadrao}
            onClose={() => setModalEmp(null)}
            onSaved={onReload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Ranking de saúde ──────────────────────────────────────────────────────
function RankingCard({ saldos }: { saldos: Record<Filial, SaldoFilial | null> }) {
  const ranked = [...FILIAIS].sort((a, b) => {
    const sa = saldos[a]?.saldo_livre ?? 0;
    const sb = saldos[b]?.saldo_livre ?? 0;
    return sb - sa;
  });
  return (
    <div className="neu-flat rounded-3xl p-5 border border-accent/20">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={14} className="text-accent" />
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Ranking Saúde Financeira</span>
      </div>
      <div className="flex flex-col gap-3">
        {ranked.map((f, i) => {
          const s = saldos[f];
          const cor = FILIAL_COLOR[f];
          const pct = s && s.capital_total > 0 ? Math.max(0, (s.saldo_livre / s.capital_total) * 100) : 0;
          return (
            <div key={f} className="flex items-center gap-3">
              <span className="text-lg font-black text-gray-600 w-5 text-center">{i + 1}</span>
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className={`text-xs font-bold ${cor.accent}`}>{f}</span>
                  <span className={`text-xs font-bold tabular-nums ${s?.bloqueado ? 'text-red-400' : 'text-gray-300'}`}>
                    {s ? BRL(s.saldo_livre) : '—'}
                  </span>
                </div>
                <HealthBar saldo={s?.saldo_livre ?? 0} total={s?.capital_total ?? 1} />
                <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                  <span>{pct.toFixed(0)}% disponível</span>
                  {s?.bloqueado && <span className="text-red-400 font-bold">ACUMULANDO DÍVIDA</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Prestação de Contas (aplicação do Capital por Filial × Categoria) ─
function TabPrestacaoContas({
  notas, saldos,
}: {
  notas: NotaRecebida[];
  saldos: Record<Filial, SaldoFilial | null>;
}) {
  // Agrupa notas por filial × categoria. Só entram capital_origem=true e ativas
  // (o useFetchData já filtra ativo; o filtro capital_origem foi passado no
  // extraFilter da chamada). Reservado defensivo caso o filtro server-side
  // devolva algo fora — .filter aqui protege.
  const matriz = useMemo(() => {
    const map: Record<Filial, Record<CategoriaGasto, { total: number; count: number }>> = {
      SuperMax: {} as any, MaxLook: {} as any, TechMax: {} as any,
    };
    for (const f of FILIAIS) {
      for (const c of CATEGORIAS_GASTO_CAPITAL) {
        map[f][c] = { total: 0, count: 0 };
      }
    }
    for (const n of notas) {
      if (!n.capital_origem || !n.ativo) continue;
      if (!(n.filial in map)) continue;
      const cat = (n.categoria_gasto ?? 'Outro') as CategoriaGasto;
      if (!CATEGORIAS_GASTO_CAPITAL.includes(cat)) continue;
      map[n.filial as Filial][cat].total += Number(n.valor_total ?? 0);
      map[n.filial as Filial][cat].count += 1;
    }
    return map;
  }, [notas]);

  const totaisPorFilial = useMemo(() => {
    const t: Record<Filial, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of FILIAIS) {
      t[f] = CATEGORIAS_GASTO_CAPITAL.reduce((acc, c) => acc + (matriz[f][c]?.total ?? 0), 0);
    }
    return t;
  }, [matriz]);

  const totaisPorCategoria = useMemo(() => {
    const t: Record<CategoriaGasto, number> = {} as any;
    for (const c of CATEGORIAS_GASTO_CAPITAL) {
      t[c] = FILIAIS.reduce((acc, f) => acc + (matriz[f][c]?.total ?? 0), 0);
    }
    return t;
  }, [matriz]);

  const totalGeral = FILIAIS.reduce((acc, f) => acc + totaisPorFilial[f], 0);
  const totalCapitalAportado = FILIAIS.reduce((acc, f) => acc + (saldos[f]?.capital_total ?? 0), 0);
  const pctAplicado = totalCapitalAportado > 0 ? (totalGeral / totalCapitalAportado) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Card resumo */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Landmark size={14} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Aplicação do Capital Inicial
              </span>
            </div>
            <span className="text-4xl font-black text-accent tabular-nums">{BRL(totalGeral)}</span>
            <p className="text-xs text-gray-500 mt-1">
              {notas.filter(n => n.capital_origem && n.ativo).length} notas registradas ·
              {' '}{pctAplicado.toFixed(1)}% do capital aportado ({BRL(totalCapitalAportado)})
            </p>
          </div>
          <div className="text-xs text-gray-400 max-w-md">
            <p className="flex items-start gap-2">
              <Info size={12} className="text-accent shrink-0 mt-0.5" />
              <span>
                Notas marcadas em <strong>Compras → Notas Recebidas</strong> pelas filiais como
                {' '}<em>"Saiu do Capital Inicial"</em>, agrupadas por unidade e categoria.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Matriz Filial × Categoria */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-x-auto main-scrollbar">
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="pb-4 pt-1 pl-2 font-bold">Filial</th>
              {CATEGORIAS_GASTO_CAPITAL.map(c => (
                <th key={c} className="pb-4 pt-1 px-3 font-bold text-right">{c}</th>
              ))}
              <th className="pb-4 pt-1 px-3 font-bold text-right text-accent">Total</th>
              <th className="pb-4 pt-1 px-3 font-bold text-right">% do Capital</th>
            </tr>
          </thead>
          <tbody>
            {FILIAIS.map(f => {
              const capitalF = saldos[f]?.capital_total ?? 0;
              const totalF = totaisPorFilial[f];
              const pctF = capitalF > 0 ? (totalF / capitalF) * 100 : 0;
              const c = FILIAL_COLOR[f];
              return (
                <tr key={f} className="border-b border-white/5">
                  <td className="py-3 pl-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold ${c.bg} ${c.accent}`}>
                      {f}
                    </span>
                  </td>
                  {CATEGORIAS_GASTO_CAPITAL.map(cat => {
                    const cell = matriz[f][cat];
                    return (
                      <td key={cat} className="py-3 px-3 text-right">
                        <div className="text-xs font-mono text-gray-200">
                          {cell.total > 0 ? BRL(cell.total) : <span className="text-gray-600">—</span>}
                        </div>
                        {cell.count > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{cell.count} NF</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 px-3 text-right">
                    <div className="text-sm font-bold font-mono text-accent">{BRL(totalF)}</div>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className={`text-xs font-mono font-bold ${pctF > 100 ? 'text-red-400' : pctF > 80 ? 'text-amber-400' : 'text-green-400'}`}>
                      {pctF.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">de {BRL(capitalF)}</div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-accent/20 bg-accent/5">
              <td className="py-3 pl-2 text-xs font-black text-accent uppercase tracking-widest">Total</td>
              {CATEGORIAS_GASTO_CAPITAL.map(cat => (
                <td key={cat} className="py-3 px-3 text-right text-xs font-mono font-bold text-gray-100">
                  {totaisPorCategoria[cat] > 0 ? BRL(totaisPorCategoria[cat]) : <span className="text-gray-600">—</span>}
                </td>
              ))}
              <td className="py-3 px-3 text-right text-sm font-black font-mono text-accent">{BRL(totalGeral)}</td>
              <td className="py-3 px-3 text-right text-xs font-mono font-bold text-gray-300">{pctAplicado.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Lista detalhada */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5">
        <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
          <Landmark size={14} className="text-accent" />
          Últimas notas aplicadas ao Capital
        </h3>
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-3 pl-2 font-bold">Data</th>
                <th className="pb-3 px-3 font-bold">Filial</th>
                <th className="pb-3 px-3 font-bold">Categoria</th>
                <th className="pb-3 px-3 font-bold">NF · Descrição</th>
                <th className="pb-3 px-3 font-bold text-center">Doc</th>
                <th className="pb-3 px-3 font-bold text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {notas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-500">
                    Nenhuma nota marcada como aplicação do Capital ainda.
                  </td>
                </tr>
              ) : (
                notas.slice(0, 30).map(n => {
                  const c = n.filial in FILIAL_COLOR ? FILIAL_COLOR[n.filial as Filial] : FILIAL_COLOR.SuperMax;
                  return (
                    <tr key={n.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pl-2 text-[10px] font-mono text-gray-400">
                        {n.data_emissao ?? fmtDate(n.created_at)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${c.bg} ${c.accent}`}>
                          {n.filial}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-bold">
                          {n.categoria_gasto ?? 'Outro'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        <div className="font-semibold text-gray-200">{n.numero_nf}</div>
                        {n.descricao && (
                          <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{n.descricao}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {n.anexo_url ? (
                          <a href={n.anexo_url} target="_blank" rel="noopener noreferrer"
                            title={n.anexo_nome ?? 'Ver documento'}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                            Ver
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-600">sem doc</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono text-gray-200 text-right">
                        {BRL(Number(n.valor_total ?? 0))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Faturamento (notas_emitidas por filial × tipo) ────────────────────
function TabFaturamento({ notas }: { notas: NotaEmitidaMatriz[] }) {
  // Filtro de período (default: últimos 30 dias).
  const hoje = new Date();
  const dias30 = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [dtIni, setDtIni] = useState(dias30.toISOString().slice(0, 10));
  const [dtFim, setDtFim] = useState(hoje.toISOString().slice(0, 10));

  const filtradas = useMemo(() => {
    return notas.filter(n => {
      if (!n.ativo) return false;
      if (n.data_emissao < dtIni) return false;
      if (n.data_emissao > dtFim) return false;
      return true;
    });
  }, [notas, dtIni, dtFim]);

  const matriz = useMemo(() => {
    const map: Record<Filial, Record<typeof TIPOS_EMITIDAS[number], { total: number; count: number }>> = {
      SuperMax: {} as any, MaxLook: {} as any, TechMax: {} as any,
    };
    for (const f of FILIAIS) {
      for (const t of TIPOS_EMITIDAS) map[f][t] = { total: 0, count: 0 };
    }
    for (const n of filtradas) {
      if (!(n.filial in map)) continue;
      if (!TIPOS_EMITIDAS.includes(n.tipo)) continue;
      map[n.filial as Filial][n.tipo].total += Number(n.valor_total ?? 0);
      map[n.filial as Filial][n.tipo].count += 1;
    }
    return map;
  }, [filtradas]);

  const totaisFilial: Record<Filial, number> = FILIAIS.reduce((acc, f) => {
    acc[f] = TIPOS_EMITIDAS.reduce((s, t) => s + matriz[f][t].total, 0);
    return acc;
  }, {} as Record<Filial, number>);

  const totaisTipo: Record<typeof TIPOS_EMITIDAS[number], number> = TIPOS_EMITIDAS.reduce((acc, t) => {
    acc[t] = FILIAIS.reduce((s, f) => s + matriz[f][t].total, 0);
    return acc;
  }, {} as any);

  const totalGeral = FILIAIS.reduce((s, f) => s + totaisFilial[f], 0);
  const totalNotas = filtradas.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header + filtros */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 size={14} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Faturamento por Filial
              </span>
            </div>
            <span className="text-4xl font-black text-accent tabular-nums">{BRL(totalGeral)}</span>
            <p className="text-xs text-gray-500 mt-1">{totalNotas} nota{totalNotas !== 1 && 's'} emitida{totalNotas !== 1 && 's'} no período</p>
          </div>
          <div className="flex gap-3 items-end">
            <FormField label="De">
              <input type="date" className="neu-input py-1.5 px-3 rounded-xl text-xs"
                value={dtIni} onChange={e => setDtIni(e.target.value)} />
            </FormField>
            <FormField label="Até">
              <input type="date" className="neu-input py-1.5 px-3 rounded-xl text-xs"
                value={dtFim} onChange={e => setDtFim(e.target.value)} />
            </FormField>
          </div>
        </div>
      </div>

      {/* Matriz Filial × Tipo */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-x-auto main-scrollbar">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="pb-4 pt-1 pl-2 font-bold">Filial</th>
              {TIPOS_EMITIDAS.map(t => (
                <th key={t} className="pb-4 pt-1 px-3 font-bold text-right">{t}</th>
              ))}
              <th className="pb-4 pt-1 px-3 font-bold text-right text-accent">Total</th>
            </tr>
          </thead>
          <tbody>
            {FILIAIS.map(f => {
              const c = FILIAL_COLOR[f];
              return (
                <tr key={f} className="border-b border-white/5">
                  <td className="py-3 pl-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold ${c.bg} ${c.accent}`}>
                      {f}
                    </span>
                  </td>
                  {TIPOS_EMITIDAS.map(t => {
                    const cell = matriz[f][t];
                    return (
                      <td key={t} className="py-3 px-3 text-right">
                        <div className="text-xs font-mono text-gray-200">
                          {cell.total > 0 ? BRL(cell.total) : <span className="text-gray-600">—</span>}
                        </div>
                        {cell.count > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{cell.count} nota{cell.count !== 1 && 's'}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 px-3 text-right">
                    <div className="text-sm font-bold font-mono text-accent">{BRL(totaisFilial[f])}</div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-accent/20 bg-accent/5">
              <td className="py-3 pl-2 text-xs font-black text-accent uppercase tracking-widest">Total</td>
              {TIPOS_EMITIDAS.map(t => (
                <td key={t} className="py-3 px-3 text-right text-xs font-mono font-bold text-gray-100">
                  {totaisTipo[t] > 0 ? BRL(totaisTipo[t]) : <span className="text-gray-600">—</span>}
                </td>
              ))}
              <td className="py-3 px-3 text-right text-sm font-black font-mono text-accent">{BRL(totalGeral)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Últimas notas emitidas */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5">
        <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
          <BarChart3 size={14} className="text-accent" /> Últimas notas emitidas no período
        </h3>
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-3 pl-2 font-bold">Data</th>
                <th className="pb-3 px-3 font-bold">Filial</th>
                <th className="pb-3 px-3 font-bold">Nº</th>
                <th className="pb-3 px-3 font-bold">Tipo</th>
                <th className="pb-3 px-3 font-bold">Cliente / Descrição</th>
                <th className="pb-3 px-3 font-bold text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-500">
                    Nenhuma nota emitida no período.
                  </td>
                </tr>
              ) : (
                filtradas.slice(0, 30).map(n => {
                  const c = n.filial in FILIAL_COLOR ? FILIAL_COLOR[n.filial as Filial] : FILIAL_COLOR.SuperMax;
                  return (
                    <tr key={n.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pl-2 text-[10px] font-mono text-gray-400">{n.data_emissao}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${c.bg} ${c.accent}`}>
                          {n.filial}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[10px] font-mono text-gray-300">
                        {String(n.numero).padStart(6, '0')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-bold">
                          {n.tipo}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        <div className="font-semibold text-gray-200">{n.cliente_nome ?? 'Consumidor'}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{n.descricao}</div>
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono text-gray-200 text-right">{BRL(Number(n.valor_total ?? 0))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── View principal ─────────────────────────────────────────────────────────
type Tab = 'geral' | 'dre' | 'prestacao' | 'faturamento' | 'emprestimos' | 'config';

type NotaEmitidaMatriz = {
  id: string;
  filial: string;
  tipo: 'NF Produto' | 'NFS-e Serviço' | 'Recibo Simples';
  origem: 'pdv' | 'servico_manual' | 'avulso';
  valor_total: number;
  data_emissao: string;
  descricao: string;
  cliente_nome: string | null;
  ativo: boolean;
  numero: number;
  serie: string;
};

const TIPOS_EMITIDAS = ['NF Produto', 'NFS-e Serviço', 'Recibo Simples'] as const;

// Categorias de gasto que a filial reporta em notas_recebidas quando o
// pagamento sai do Capital Inicial. Fonte: mig. 220 (chk_notas_recebidas_categoria).
const CATEGORIAS_GASTO_CAPITAL = ['Produto', 'Equipamento', 'Mobiliário', 'Aluguel', 'Serviço', 'Outro'] as const;
type CategoriaGasto = typeof CATEGORIAS_GASTO_CAPITAL[number];

type NotaRecebida = {
  id: string;
  filial: string;
  numero_nf: string;
  categoria_gasto: CategoriaGasto | null;
  descricao: string | null;
  valor_total: number | null;
  data_emissao: string | null;
  capital_origem: boolean;
  anexo_url: string | null;
  anexo_nome: string | null;
  anexo_tamanho: number | null;
  criado_por: string | null;
  created_at: string;
  ativo: boolean;
};

export function MatrizCapitalView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('geral');
  const [modalFilial, setModalFilial] = useState<Filial | null>(null);
  const [modalConfig, setModalConfig] = useState(false);
  const [saldos, setSaldos] = useState<Record<Filial, SaldoFilial | null>>({
    SuperMax: null, MaxLook: null, TechMax: null,
  });
  const confirm = useConfirm();

  const { data: registros = [], isLoading, reload } = useFetchData<CapitalRow>('capital_filial', undefined, false);
  const { data: emprestimos = [], reload: reloadEmp } = useFetchData<Emprestimo>('emprestimos_filial', undefined, false);
  const { data: configs = [] } = useFetchData<CapitalConfig>('capital_config', undefined, false);
  const { data: bancos = [] } = useFetchData<Banco>('caixa_bancos', { status: 'Ativo' }, false);
  const { data: notasRecebidas = [] } = useFetchData<NotaRecebida>('/api/notasrecebidasview', { capital_origem: true }, false);
  const { data: notasEmitidas = [] } = useFetchData<NotaEmitidaMatriz>('/api/notasemitidasview', undefined, false);

  const configAtiva = configs[0] ?? null;
  const taxaPadrao = configAtiva?.taxa_juros_padrao ?? 0;

  const porFilial = useMemo(() => {
    const map: Record<Filial, CapitalRow[]> = { SuperMax: [], MaxLook: [], TechMax: [] };
    for (const r of registros) {
      if (r.filial in map) map[r.filial as Filial].push(r);
    }
    return map;
  }, [registros]);

  const carregarSaldos = useCallback(async () => {
    if (!supabase) return;
    const results: Record<Filial, SaldoFilial | null> = { SuperMax: null, MaxLook: null, TechMax: null };
    await Promise.all(FILIAIS.map(async f => {
      const { data, error } = await supabase.rpc('calcular_saldo_capital', { p_filial: f });
      if (!error && data?.[0]) results[f] = data[0];
    }));
    setSaldos(results);
  }, []);

  useEffect(() => { carregarSaldos(); }, [carregarSaldos, registros, emprestimos]);

  const totalCapital = FILIAIS.reduce((acc, f) => acc + (saldos[f]?.capital_total ?? 0), 0);
  const totalSaldo = FILIAIS.reduce((acc, f) => acc + (saldos[f]?.saldo_livre ?? 0), 0);
  const pendentesCount = emprestimos.filter(e => e.status === 'Pendente').length;

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

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'geral', label: 'Visão Geral' },
    { id: 'dre', label: 'DRE' },
    { id: 'prestacao', label: 'Prestação de Contas' },
    { id: 'faturamento', label: 'Faturamento' },
    { id: 'emprestimos', label: 'Empréstimos', badge: pendentesCount > 0 ? pendentesCount : undefined },
    { id: 'config', label: 'Config' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6 pb-16"
    >
      {/* Header consolidado */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Landmark size={14} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Capital Consolidado</span>
            </div>
            <span className="text-4xl font-black text-accent tabular-nums">{BRL(totalCapital)}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-1">Saldo Livre Total</span>
            <span className={`text-2xl font-black tabular-nums ${totalSaldo < 0 ? 'text-red-400' : 'text-green-400'}`}>
              {BRL(totalSaldo)}
            </span>
          </div>
        </div>
        {configAtiva && (
          <p className="text-xs text-gray-500 mt-2">
            Período: {fmtDate(configAtiva.data_inicio)}
            {configAtiva.data_fim ? ` → ${fmtDate(configAtiva.data_fim)}` : ' → sem prazo'}
            {configAtiva.reserva_min_pct > 0 && ` · Reserva ${configAtiva.reserva_min_pct}%`}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 neu-flat rounded-2xl border border-white/5">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
              tab === t.id
                ? 'bg-accent text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.badge && (
              <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Conteúdo das tabs */}
      {tab === 'geral' && (
        <div className="flex flex-col gap-4">
          <RankingCard saldos={saldos} />
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {FILIAIS.map(f => (
                <FilialCapitalCard
                  key={f} filial={f} registros={porFilial[f]}
                  saldo={saldos[f]} profile={profile}
                  onNovo={setModalFilial} onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'dre' && <TabDRE saldos={saldos} semConfig={!configAtiva} />}

      {tab === 'prestacao' && <TabPrestacaoContas notas={notasRecebidas} saldos={saldos} />}

      {tab === 'faturamento' && <TabFaturamento notas={notasEmitidas} />}

      {tab === 'emprestimos' && (
        <TabEmprestimos
          emprestimos={emprestimos} bancos={bancos} taxaPadrao={taxaPadrao}
          profile={profile}
          onReload={() => { reloadEmp(); carregarSaldos(); }}
          showToast={showToast}
        />
      )}

      {tab === 'config' && (
        <div className="flex flex-col gap-4">
          <div className="neu-flat rounded-3xl p-5 border border-accent/20">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Settings size={14} className="text-accent" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Configuração Ativa</span>
              </div>
              {podeConfigurar(profile) && (
                <button
                  onClick={() => setModalConfig(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                >
                  <Plus size={12} /> Novo Período
                </button>
              )}
            </div>
            {configAtiva ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">Início</span>
                  <p className="text-sm font-bold text-gray-100 mt-0.5">{fmtDate(configAtiva.data_inicio)}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">Fim</span>
                  <p className="text-sm font-bold text-gray-100 mt-0.5">{configAtiva.data_fim ? fmtDate(configAtiva.data_fim) : 'Sem prazo'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">Reserva mínima</span>
                  <p className="text-sm font-bold text-gray-100 mt-0.5">{configAtiva.reserva_min_pct}%</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">Juros padrão</span>
                  <p className="text-sm font-bold text-gray-100 mt-0.5">{configAtiva.taxa_juros_padrao}%</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Nenhuma configuração definida. O cálculo de saldo usará todos os aportes sem período fixo.</p>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {modalFilial && (
          <ModalCapital
            filial={modalFilial} profile={profile}
            onClose={() => setModalFilial(null)}
            onSaved={() => { reload(); carregarSaldos(); }}
            showToast={showToast}
          />
        )}
        {modalConfig && (
          <ModalConfig
            config={configAtiva} profile={profile}
            onClose={() => setModalConfig(false)}
            onSaved={reload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
