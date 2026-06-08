import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LockOpen, Lock, Clock, DollarSign, User, ChevronDown, Trash2, RotateCcw } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useCaixasDoDia, FILIAIS_OPERACIONAIS, type FilialOperacional } from '../hooks/useCaixaAberto';
import { useFetchData, dbDelete } from '../hooks/useSupabaseData';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { LoadingSpinner, NeuButtonAccent, FilialBadge } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { hasAnySetor } from '../lib/rbac';
import { formatBRL, parseBRL } from '../lib/viewUtils';

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtHora = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
};

const fmtData = (str: string) => {
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
};

// Quem opera caixa de QUALQUER filial: admin, CEO e gerente cobrem cross-filial.
// Colaborador fica travado na própria filial pra evitar abertura indevida em outra unidade.
const podeOperarTodasFiliais = (profile: UserProfile | null | undefined): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente';

// Cada filial tem seu próprio card de status + abertura/fechamento.
// Extraído porque o ControleCaixaView pode renderizar 1, 2 ou 3 deles dependendo
// do role/filial do operador.
const CaixaCard = ({ filial, caixa, showToast, profile, onChanged }: any) => {
  const { user } = useAuth();
  const [valorAbertura, setValorAbertura] = useState('');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmFechar, setConfirmFechar] = useState(false);
  const today = todayBR();

  const handleAbrir = async () => {
    const valor = parseBRL(valorAbertura);
    if (!valor || valor <= 0) { showToast('Informe um valor de abertura válido.', 'error'); return; }
    if (!supabase) { showToast('Supabase não configurado.', 'error'); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from('controle_caixa').insert({
        data:             today,
        filial,
        valor_abertura:   valor,
        status:           'Aberto',
        aberto_por:       user?.id ?? null,
        aberto_por_nome:  profile?.nome ?? user?.email ?? 'Usuário',
        aberto_em:        new Date().toISOString(),
        observacao:       observacao || null,
      });
      if (error) {
        if (error.code === '23505') showToast(`Já existe sessão aberta hoje para ${filial}.`, 'error');
        else throw error;
        return;
      }
      setValorAbertura('');
      setObservacao('');
      onChanged();
      showToast(`Caixa ${filial} aberto!`, 'success');
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
      onChanged();
      showToast(`Caixa ${filial} fechado.`, 'success');
    } catch {
      showToast('Erro ao fechar o caixa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return caixa ? (
    /* ── CAIXA ABERTO ── */
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="neu-flat rounded-3xl p-6 border border-emerald-500/20 flex flex-col gap-4"
      style={{ background: 'color-mix(in srgb, #10B981 6%, var(--color-bg-base))' }}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #10B981 15%, var(--color-bg-base))' }}>
          <LockOpen size={22} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <FilialBadge filial={filial} />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Aberto</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="text-xl font-black text-gray-100 tabular-nums">{fmtBRL(caixa.valor_abertura)}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><User size={9} />{caixa.aberto_por_nome ?? '—'}</span>
            <span className="flex items-center gap-1"><Clock size={9} />{fmtHora(caixa.aberto_em)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        {!confirmFechar ? (
          <button onClick={() => setConfirmFechar(true)}
            className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-red-400 transition-colors flex items-center gap-1.5">
            <Lock size={12} /> Fechar
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={handleFechar} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-300 bg-red-900/30 border border-red-500/20 hover:bg-red-900/50 transition-colors disabled:opacity-50">
              {saving ? '...' : 'Confirmar'}
            </button>
            <button onClick={() => setConfirmFechar(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-gray-500 hover:text-gray-300 transition-colors">
              Cancelar
            </button>
          </div>
        )}
      </div>
    </motion.div>
  ) : (
    /* ── CAIXA FECHADO ── */
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl neu-pressed flex items-center justify-center shrink-0">
          <Lock size={22} className="text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <FilialBadge filial={filial} />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Fechado</span>
          </div>
          <p className="text-xs text-gray-400">Informe o valor para abrir.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="relative">
          <DollarSign size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" inputMode="numeric"
            className="neu-input py-2.5 pl-8 pr-3 rounded-xl text-sm w-full"
            placeholder="Valor de abertura"
            value={valorAbertura}
            onChange={e => setValorAbertura(formatBRL(e.target.value))}
            onKeyDown={e => e.key === 'Enter' && handleAbrir()}
          />
        </div>
        <input className="neu-input py-2.5 px-3 rounded-xl text-xs"
          placeholder="Observação (opcional)"
          value={observacao}
          onChange={e => setObservacao(e.target.value)} />
      </div>

      <div className="flex justify-end">
        <NeuButtonAccent onClick={handleAbrir} isLoading={saving}>
          <LockOpen size={14} /> Abrir Caixa
        </NeuButtonAccent>
      </div>
    </motion.div>
  );
};

export const ControleCaixaView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  // Guard: caixa é financeiro+vendas (RLS já reflete isso).
  if (!hasAnySetor(profile, 'financeiro', 'vendas')) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <Lock size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas Financeiro, Vendas, admin ou CEO podem acessar o Caixa.</p>
      </div>
    );
  }
  const { caixas, isLoading: caixaLoading, refresh } = useCaixasDoDia();
  const { data: historico, isLoading: histLoading, reload } = useFetchData<any>('/api/controlecaixaview');

  const today = todayBR();

  const cross = podeOperarTodasFiliais(profile);
  // Colaborador trava na própria filial. Se não tem filial operacional definida
  // (ex: 'Matriz'), não tem caixa pra abrir.
  const filiaisVisiveis: readonly FilialOperacional[] = cross
    ? FILIAIS_OPERACIONAIS
    : (FILIAIS_OPERACIONAIS as readonly string[]).includes(profile?.filial)
      ? [profile.filial as FilialOperacional]
      : [];

  const handleReabrir = async (h: any) => {
    if (!supabase) return;
    if (!confirm(`Reabrir esta sessão de ${h.filial}? O fechamento anterior será descartado.`)) return;
    try {
      const { error } = await supabase
        .from('controle_caixa')
        .update({
          status: 'Aberto',
          fechado_por: null,
          fechado_por_nome: null,
          fechado_em: null,
        })
        .eq('id', h.id);
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
        <p className="text-sm text-gray-400 mt-1">
          {cross
            ? 'Abertura e fechamento por unidade. O PDV de cada empresa só opera com o respectivo caixa aberto.'
            : `Abertura e fechamento do caixa da unidade ${profile?.filial ?? '—'}.`}
        </p>
      </div>

      {/* Cards por filial */}
      {filiaisVisiveis.length === 0 ? (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 text-center">
          <p className="text-sm text-gray-400">
            Sua filial atual (<span className="font-bold">{profile?.filial ?? '—'}</span>) não opera PDV. Peça ao admin para te associar a SuperMax, MaxLook ou TechMax.
          </p>
        </div>
      ) : (
        <div className={`shrink-0 grid gap-4 ${filiaisVisiveis.length === 1 ? 'grid-cols-1 max-w-md' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
          {filiaisVisiveis.map(f => (
            <CaixaCard
              key={f}
              filial={f}
              caixa={caixas[f]}
              showToast={showToast}
              profile={profile}
              onChanged={() => { refresh(); reload(); }}
            />
          ))}
        </div>
      )}

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
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-4">Data</th>
                  <th className="pb-3 font-bold px-4">Filial</th>
                  <th className="pb-3 font-bold px-4 text-right">Abertura</th>
                  <th className="pb-3 font-bold px-4">Aberto por</th>
                  <th className="pb-3 font-bold px-4 text-center">Hora Abert.</th>
                  <th className="pb-3 font-bold px-4 text-center">Hora Fech.</th>
                  <th className="pb-3 font-bold px-4 text-center">Status</th>
                  <th className="pb-3 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h: any) => {
                  const podeReabrir = h.status === 'Fechado' && h.data === today
                    && (FILIAIS_OPERACIONAIS as readonly string[]).includes(h.filial)
                    && !caixas[h.filial as FilialOperacional];
                  return (
                    <tr key={h.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(h.data)}</td>
                      <td className="py-3 px-4"><FilialBadge filial={h.filial} /></td>
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
                          <AuditoriaInspect criadoPor={h.criado_por} criadoEm={h.created_at} atualizadoPor={h.atualizado_por} atualizadoEm={h.updated_at} />
                          {podeReabrir && (
                            <button onClick={() => handleReabrir(h)} title="Reabrir caixa" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-emerald-500"><RotateCcw size={12} /></button>
                          )}
                          <button onClick={() => handleDeleteSessao(h.id)} title="Inativar sessão" className="action-btn-delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
