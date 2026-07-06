import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Instagram, Youtube, Facebook, Plus, Trash2, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { hasSetor } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import type { UserProfile } from '../hooks/useUserProfile';

type Plataforma = 'Instagram' | 'TikTok' | 'Facebook' | 'YouTube';
const PLATAFORMAS: Plataforma[] = ['Instagram', 'TikTok', 'Facebook', 'YouTube'];

const PLAT_COLOR: Record<Plataforma, string> = {
  Instagram: 'text-pink-400',
  TikTok:    'text-cyan-300',
  Facebook:  'text-blue-400',
  YouTube:   'text-red-400',
};

const PLAT_ICON: Record<Plataforma, React.ReactNode> = {
  Instagram: <Instagram size={14} />,
  TikTok:    <span className="text-xs font-black">TT</span>,
  Facebook:  <Facebook size={14} />,
  YouTube:   <Youtube size={14} />,
};

const METRICAS: { key: string; label: string }[] = [
  { key: 'seguidores',       label: 'Seguidores' },
  { key: 'curtidas',         label: 'Curtidas' },
  { key: 'visualizacoes',    label: 'Visualizações' },
  { key: 'compartilhamentos',label: 'Compartilhamentos' },
  { key: 'comentarios',      label: 'Comentários' },
];

const EMPTY_FORM = {
  plataforma: 'Instagram' as Plataforma,
  data_registro: new Date().toISOString().slice(0, 10),
  seguidores: '',
  curtidas: '',
  visualizacoes: '',
  compartilhamentos: '',
  comentarios: '',
};

function variacao(atual: number, anterior: number | undefined): React.ReactNode {
  if (anterior === undefined || anterior === 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-0.5"><TrendingUp size={9}/>{abs}%</span>;
  if (pct < 0) return <span className="text-red-400 text-[10px] font-bold flex items-center gap-0.5"><TrendingDown size={9}/>{abs}%</span>;
  return null;
}

export function MetricasRedesSociaisView({ showToast, profile }: { showToast: any; profile: UserProfile }) {
  const { filialAtiva } = useFilial();
  const { data: raw, isLoading, reload } = useFetchData('/api/metricasredessociaisview');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [filtroPlat, setFiltroPlat] = useState<Plataforma | 'Todas'>('Todas');

  const isAdminCeo = profile.role === 'admin' || profile.role === 'ceo';
  const podeRegistrar = isAdminCeo || hasSetor(profile, 'marketing');

  // Filtra por filial ativa (admin/CEO veem tudo em Matriz; em filial veem só a própria)
  const registros = useMemo(() => {
    const base = filialAtiva ? raw.filter((r: any) => r.filial === filialAtiva) : raw;
    return filtroPlat === 'Todas' ? base : base.filter((r: any) => r.plataforma === filtroPlat);
  }, [raw, filialAtiva, filtroPlat]);

  async function salvar() {
    if (!supabase || !profile) return;
    const filial = filialAtiva ?? profile.filial;
    if (!filial) { showToast?.('Filial não identificada.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('metricas_redes_sociais').insert({
        filial,
        plataforma:       form.plataforma,
        data_registro:    form.data_registro,
        seguidores:       Number(form.seguidores)        || 0,
        curtidas:         Number(form.curtidas)          || 0,
        visualizacoes:    Number(form.visualizacoes)     || 0,
        compartilhamentos:Number(form.compartilhamentos) || 0,
        comentarios:      Number(form.comentarios)       || 0,
        registrado_por:   profile.id,
      });
      if (error) throw error;
      showToast?.('Métricas registradas!', 'success');
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      reload();
    } catch (e: any) {
      showToast?.(e.message ?? 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from('metricas_redes_sociais').update({ ativo: false }).eq('id', id);
    if (error) { showToast?.(error.message, 'error'); return; }
    showToast?.('Registro removido.', 'success');
    reload();
  }

  // Último registro por plataforma — usado para variação
  const ultimoPorPlat = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const r of registros) {
      if (!map[r.plataforma]) map[r.plataforma] = [];
      map[r.plataforma].push(r);
    }
    return map;
  }, [registros]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Redes Sociais</h2>
          <p className="text-sm text-gray-400 mt-1">Registros de desempenho por plataforma{filialAtiva ? ` — ${filialAtiva}` : ' — todas as filiais'}.</p>
        </div>
        {podeRegistrar && (
          <button onClick={() => setShowForm(v => !v)} className="neu-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-accent">
            <Plus size={15}/>{showForm ? 'Cancelar' : 'Registrar métricas'}
          </button>
        )}
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="neu-flat rounded-3xl border border-accent/20 p-5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-gray-200">Novo Registro</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Plataforma */}
            <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Plataforma</label>
              <select value={form.plataforma} onChange={e => setForm(f => ({ ...f, plataforma: e.target.value as Plataforma }))} className="neu-input rounded-xl px-3 py-2 text-sm">
                {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {/* Data */}
            <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Data</label>
              <input type="date" value={form.data_registro} onChange={e => setForm(f => ({ ...f, data_registro: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm"/>
            </div>
            {/* Seguidores */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Seguidores</label>
              <input type="number" min="0" value={form.seguidores} onChange={e => setForm(f => ({ ...f, seguidores: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm" placeholder="0"/>
            </div>
            {/* Curtidas */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Curtidas</label>
              <input type="number" min="0" value={form.curtidas} onChange={e => setForm(f => ({ ...f, curtidas: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm" placeholder="0"/>
            </div>
            {/* Visualizações */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Visualizações</label>
              <input type="number" min="0" value={form.visualizacoes} onChange={e => setForm(f => ({ ...f, visualizacoes: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm" placeholder="0"/>
            </div>
            {/* Compartilhamentos */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Compartilhamentos</label>
              <input type="number" min="0" value={form.compartilhamentos} onChange={e => setForm(f => ({ ...f, compartilhamentos: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm" placeholder="0"/>
            </div>
            {/* Comentários */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Comentários</label>
              <input type="number" min="0" value={form.comentarios} onChange={e => setForm(f => ({ ...f, comentarios: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm" placeholder="0"/>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={salvar} disabled={saving} className="neu-button px-5 py-2 rounded-xl text-sm font-bold text-accent disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin"/> : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtro por plataforma */}
      <div className="flex flex-wrap gap-2">
        {(['Todas', ...PLATAFORMAS] as const).map(p => (
          <button
            key={p}
            onClick={() => setFiltroPlat(p as any)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filtroPlat === p ? 'neu-pressed text-accent' : 'neu-button text-gray-400'}`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
      ) : registros.length === 0 ? (
        <div className="neu-flat rounded-3xl p-10 text-center text-gray-500 text-sm">Nenhum registro encontrado.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {PLATAFORMAS.filter(p => filtroPlat === 'Todas' || filtroPlat === p).map(plat => {
            const regs = registros.filter((r: any) => r.plataforma === plat);
            if (regs.length === 0) return null;
            return (
              <div key={plat} className="neu-flat rounded-3xl border border-accent/10 overflow-hidden">
                {/* Header plataforma */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5">
                  <span className={PLAT_COLOR[plat]}>{PLAT_ICON[plat]}</span>
                  <span className={`text-sm font-black ${PLAT_COLOR[plat]}`}>{plat}</span>
                  <span className="text-xs text-gray-500 ml-1">{regs.length} registros</span>
                </div>
                {/* Linhas */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left px-5 py-2.5 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Data</th>
                        {!filialAtiva && <th className="text-left px-4 py-2.5 text-gray-500 font-bold uppercase tracking-wider text-[10px]">Filial</th>}
                        {METRICAS.map(m => (
                          <th key={m.key} className="text-right px-4 py-2.5 text-gray-500 font-bold uppercase tracking-wider text-[10px]">{m.label}</th>
                        ))}
                        <th className="w-8"/>
                      </tr>
                    </thead>
                    <tbody>
                      {regs.map((r: any, i: number) => {
                        const prev = regs[i + 1];
                        const canDel = isAdminCeo || r.registrado_por === profile.id;
                        return (
                          <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-2.5 font-mono text-gray-300">{new Date(r.data_registro + 'T12:00').toLocaleDateString('pt-BR')}</td>
                            {!filialAtiva && <td className="px-4 py-2.5 text-gray-400">{r.filial}</td>}
                            {METRICAS.map(m => (
                              <td key={m.key} className="px-4 py-2.5 text-right font-mono text-gray-200">
                                <div className="flex flex-col items-end">
                                  <span>{(r[m.key] ?? 0).toLocaleString('pt-BR')}</span>
                                  {m.key === 'seguidores' && variacao(r.seguidores, prev?.seguidores)}
                                </div>
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-right">
                              {canDel && (
                                <button onClick={() => excluir(r.id)} className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors">
                                  <Trash2 size={11}/>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

