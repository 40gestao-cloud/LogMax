import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LockOpen, Lock, Clock, DollarSign, User, Calendar, ChevronDown, Trash2, RotateCcw } from 'lucide-react';
import { useCaixaAberto } from '../hooks/useCaixaAberto';
import { useFetchData, dbDelete } from '../hooks/useSupabaseData';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtHora = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
};

const fmtData = (str: string) => {
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
};

export const ControleCaixaView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { user } = useAuth();
  const { caixa, isLoading: caixaLoading, refresh } = useCaixaAberto();
  const { data: historico, isLoading: histLoading, reload } = useFetchData<any>('/api/controlecaixaview');

  const [valorAbertura, setValorAbertura] = useState('');
  const [observacao, setObservacao]       = useState('');
  const [saving, setSaving]               = useState(false);
  const [confirmFechar, setConfirmFechar] = useState(false);
  const today = new Date().toISOString().split('T')[0];

  const handleAbrir = async () => {
    const valor = parseFloat(valorAbertura.replace(',', '.'));
    if (!valor || valor <= 0) { showToast('Informe um valor de abertura válido.', 'error'); return; }
    if (!supabase) { showToast('Supabase não configurado.', 'error'); return; }

    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('controle_caixa').insert({
        data:             today,
        valor_abertura:   valor,
        status:           'Aberto',
        aberto_por:       user?.id ?? null,
        aberto_por_nome:  profile?.nome ?? user?.email ?? 'Usuário',
        aberto_em:        new Date().toISOString(),
        observacao:       observacao || null,
      });
      if (error) {
        if (error.code === '23505') showToast('Já existe uma sessão registrada para hoje. Reabra ou inative a anterior no histórico.', 'error');
        else throw error;
        return;
      }
      setValorAbertura('');
      setObservacao('');
      await refresh();
      await reload();
      showToast('Caixa aberto com sucesso!', 'success');
    } catch {
      showToast('Erro ao abrir o caixa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFechar = async () => {
    if (!caixa || !supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('controle_caixa')
        .update({
          status:           'Fechado',
          fechado_por:      user?.id ?? null,
          fechado_por_nome: profile?.nome ?? user?.email ?? 'Usuário',
          fechado_em:       new Date().toISOString(),
        })
        .eq('id', caixa.id);
      if (error) throw error;
      setConfirmFechar(false);
      await refresh();
      await reload();
      showToast('Caixa fechado.', 'success');
    } catch {
      showToast('Erro ao fechar o caixa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReabrir = async (id: string) => {
    if (!supabase) return;
    if (!confirm('Reabrir esta sessão? O fechamento anterior será descartado.')) return;
    try {
      const { error } = await supabase
        .from('controle_caixa')
        .update({
          status: 'Aberto',
          fechado_por: null,
          fechado_por_nome: null,
          fechado_em: null,
        })
        .eq('id', id);
      if (error) throw error;
      await refresh();
      await reload();
      showToast('Caixa reaberto.', 'success');
    } catch (err: any) {
      showToast(`Erro ao reabrir: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const handleDeleteSessao = async (id: string) => {
    if (!confirm('Inativar esta sessão de caixa? O histórico será preservado mas não aparecerá mais na listagem.')) return;
    try {
      await dbDelete('/api/controlecaixaview', id);
      await reload();
      showToast('Sessão inativada.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[ControleCaixa] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error');
    }
  };

  if (caixaLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      {/* Título */}
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Caixa</h2>
        <p className="text-sm text-gray-400 mt-1">Abertura e fechamento do caixa diário. O PDV só opera com caixa aberto.</p>
      </div>

      {/* Status de hoje */}
      <div className="shrink-0">
        {caixa ? (
          /* ── CAIXA ABERTO ── */
          <motion.div key="aberto" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="neu-flat rounded-3xl p-6 border border-emerald-500/20" style={{ background: 'color-mix(in srgb, #10B981 6%, var(--color-bg-base))' }}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #10B981 15%, var(--color-bg-base))' }}>
                  <LockOpen size={22} className="text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-black uppercase tracking-widest text-emerald-400">Caixa Aberto</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <p className="text-2xl font-black text-gray-100 tabular-nums">{fmtBRL(caixa.valor_abertura)}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><User size={10} />{caixa.aberto_por_nome ?? '—'}</span>
                    <span className="flex items-center gap-1"><Clock size={10} />{fmtHora(caixa.aberto_em)}</span>
                    <span className="flex items-center gap-1"><Calendar size={10} />{fmtData(caixa.data)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-start sm:items-end gap-2">
                {!confirmFechar ? (
                  <button
                    onClick={() => setConfirmFechar(true)}
                    className="neu-button px-5 py-2.5 rounded-xl text-sm font-bold text-gray-400 hover:text-red-400 transition-colors flex items-center gap-2">
                    <Lock size={14} /> Fechar Caixa
                  </button>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div key="confirm" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2">
                      <span className="text-xs text-red-400 font-bold">Confirmar fechamento?</span>
                      <button onClick={handleFechar} disabled={saving}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-300 bg-red-900/30 border border-red-500/20 hover:bg-red-900/50 transition-colors disabled:opacity-50">
                        {saving ? '...' : 'Confirmar'}
                      </button>
                      <button onClick={() => setConfirmFechar(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-500 hover:text-gray-300 transition-colors">
                        Cancelar
                      </button>
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          /* ── CAIXA FECHADO ── */
          <motion.div key="fechado" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="neu-flat rounded-3xl p-6 border border-white/5">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl neu-pressed flex items-center justify-center shrink-0">
                <Lock size={22} className="text-gray-500" />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Caixa Fechado</span>
                <p className="text-sm text-gray-400 mt-0.5">Nenhuma sessão aberta para hoje. Informe o valor para iniciar.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  Valor de Abertura (R$) *
                </label>
                <div className="relative">
                  <DollarSign size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="number" min="0" step="0.01"
                    className="neu-input py-2.5 pl-8 pr-3 rounded-xl text-sm w-full"
                    placeholder="0,00"
                    value={valorAbertura}
                    onChange={e => setValorAbertura(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAbrir()}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Observação</label>
                <input className="neu-input py-2.5 px-3 rounded-xl text-sm"
                  placeholder="Opcional"
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-start mt-4">
              <NeuButtonAccent onClick={handleAbrir} isLoading={saving}>
                <LockOpen size={14} /> Abrir Caixa
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </div>

      {/* Histórico */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <h3 className="text-sm font-bold text-gray-300 mb-5 flex items-center gap-2">
          <ChevronDown size={14} className="text-gray-500" /> Histórico de Sessões
        </h3>

        {histLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : historico.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-6">Nenhuma sessão registrada.</p>
        ) : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-4">Data</th>
                  <th className="pb-3 font-bold px-4 text-right">Abertura</th>
                  <th className="pb-3 font-bold px-4">Aberto por</th>
                  <th className="pb-3 font-bold px-4 text-center">Hora Abert.</th>
                  <th className="pb-3 font-bold px-4 text-center">Hora Fech.</th>
                  <th className="pb-3 font-bold px-4 text-center">Status</th>
                  <th className="pb-3 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h: any) => (
                  <tr key={h.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                    <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(h.data)}</td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right font-bold">{fmtBRL(Number(h.valor_abertura))}</td>
                    <td className="py-3 px-4 text-xs text-gray-400">{h.aberto_por_nome ?? '—'}</td>
                    <td className="py-3 px-4 text-xs font-mono text-center text-gray-500">{fmtHora(h.aberto_em)}</td>
                    <td className="py-3 px-4 text-xs font-mono text-center text-gray-500">{fmtHora(h.fechado_em)}</td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${h.status === 'Aberto' ? 'bg-emerald-500/15 text-emerald-500' : 'text-gray-500'}`}
                        style={h.status !== 'Aberto' ? { background: 'var(--color-badge-neutral-bg)' } : {}}
                      >{h.status}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-2">
                        {h.status === 'Fechado' && h.data === today && !caixa && (
                          <button onClick={() => handleReabrir(h.id)} title="Reabrir caixa" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-emerald-500"><RotateCcw size={12} /></button>
                        )}
                        <button onClick={() => handleDeleteSessao(h.id)} title="Inativar sessão" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
