import React, { useState, useMemo, useEffect } from 'react';
import { todayBR } from '../lib/dates';
import { motion } from 'motion/react';
import { Instagram, Plus, Trash2, TrendingUp, TrendingDown, Loader2, Link2, ExternalLink, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner } from '../components/ui';
import { hasSetor } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import { FILIAIS_HOLDING } from '../lib/filiais';
import type { UserProfile } from '../hooks/useUserProfile';

type Plataforma = 'Instagram' | 'TikTok';
const PLATAFORMAS: Plataforma[] = ['Instagram', 'TikTok'];

const PLAT_COLOR: Record<Plataforma, string> = {
  Instagram: 'text-pink-400',
  TikTok:    'text-cyan-300',
};

const PLAT_ICON: Record<Plataforma, React.ReactNode> = {
  Instagram: <Instagram size={14} />,
  TikTok:    <span className="text-xs font-black">TT</span>,
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
  data_registro: todayBR(),
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
  // Escopo de unidade: `auth_pode_filial()` deixa admin, CEO e conselheiro
  // passarem em todas as filiais, então a RLS sozinha não basta — quem opera
  // dentro de uma unidade via catálogo/cadastro de outra.
  const { data: raw, isLoading, reload } = useFetchData('/api/metricasredessociaisview', filialAtiva ? { filial: filialAtiva } : undefined);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [filtroPlat, setFiltroPlat] = useState<Plataforma | 'Todas'>('Todas');
  // Só usado no modo Matriz consolidado (filialAtiva null) — sem isso o
  // registro caía em profile.filial ('Matriz', que não é unidade operacional
  // real) e sumia de qualquer tela filtrada por uma filial específica.
  const [filialForm, setFilialForm] = useState('');

  const isAdminCeo = profile.role === 'admin' || profile.role === 'ceo';
  const podeRegistrar = isAdminCeo || hasSetor(profile, 'marketing') || profile.role === 'gerente';

  // Links das redes sociais — configuração por filial (1 link por
  // plataforma, no máximo 4), não por registro de métrica. Editado uma
  // vez em "Links das Redes Sociais" e reaproveitado em toda a tela.
  // Só carrega em modo filial (filialAtiva setado) — em modo Matriz
  // consolidado não há uma única filial pra resolver os links.
  const [links, setLinks] = useState<Partial<Record<Plataforma, string>>>({});
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkDrafts, setLinkDrafts] = useState<Partial<Record<Plataforma, string>>>({});
  const [savingLink, setSavingLink] = useState<Plataforma | null>(null);

  useEffect(() => {
    if (!supabase || !filialAtiva) { setLinks({}); setLinkDrafts({}); return; }
    let cancelled = false;
    setLinksLoading(true);
    supabase.from('redes_sociais_links').select('plataforma, link').eq('filial', filialAtiva)
      .then(({ data }) => {
        if (cancelled) return;
        const map: Partial<Record<Plataforma, string>> = {};
        for (const row of data ?? []) map[row.plataforma as Plataforma] = row.link ?? '';
        setLinks(map);
        setLinkDrafts(map);
        setLinksLoading(false);
      });
    return () => { cancelled = true; };
  }, [filialAtiva]);

  async function salvarLink(plat: Plataforma) {
    if (!supabase || !filialAtiva) return;
    const link = (linkDrafts[plat] ?? '').trim();
    setSavingLink(plat);
    try {
      const { error } = await supabase.from('redes_sociais_links')
        .upsert({ filial: filialAtiva, plataforma: plat, link: link || null, atualizado_por: profile.id }, { onConflict: 'filial,plataforma' });
      if (error) throw error;
      setLinks(l => ({ ...l, [plat]: link }));
      showToast?.('Link salvo!', 'success');
    } catch (e: any) {
      showToast?.(e.message ?? 'Erro ao salvar link.', 'error');
    } finally {
      setSavingLink(null);
    }
  }

  // Filtra por filial ativa (admin/CEO veem tudo em Matriz; em filial veem só a própria)
  const registros = useMemo(() => {
    const base = filialAtiva ? raw.filter((r: any) => r.filial === filialAtiva) : raw;
    return filtroPlat === 'Todas' ? base : base.filter((r: any) => r.plataforma === filtroPlat);
  }, [raw, filialAtiva, filtroPlat]);

  async function salvar() {
    if (!supabase || !profile) return;
    const filial = filialAtiva ?? filialForm;
    if (!filial) { showToast?.('Selecione a filial deste registro.', 'error'); return; }
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
      setFilialForm('');
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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Redes Sociais</h2>
        </div>
        {podeRegistrar && (
          <button onClick={() => setShowForm(v => !v)} className="neu-button flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-accent">
            <Plus size={15}/>{showForm ? 'Cancelar' : 'Registrar métricas'}
          </button>
        )}
      </div>

      {/* Links das redes sociais — 1 por plataforma, configurado uma vez por
          filial (não redigitado a cada registro de métrica). Só em modo filial. */}
      {podeRegistrar && filialAtiva && (
        <div className="neu-flat rounded-3xl border border-white/5 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2"><Link2 size={14} className="text-accent"/> Links das Redes Sociais — {filialAtiva}</h3>
          {linksLoading ? (
            <div className="py-4"><LoadingSpinner /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PLATAFORMAS.map(plat => {
                const draft = linkDrafts[plat] ?? '';
                const dirty = draft !== (links[plat] ?? '');
                return (
                  <div key={plat} className="flex items-center gap-2">
                    <span className={`shrink-0 w-6 flex justify-center ${PLAT_COLOR[plat]}`}>{PLAT_ICON[plat]}</span>
                    <input
                      type="url"
                      value={draft}
                      onChange={e => setLinkDrafts(d => ({ ...d, [plat]: e.target.value }))}
                      placeholder={`Link do ${plat}...`}
                      className="neu-input rounded-lg px-3 py-1.5 text-xs flex-1"
                    />
                    <button
                      onClick={() => salvarLink(plat)}
                      disabled={!dirty || savingLink === plat}
                      className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      title="Salvar link"
                    >
                      {savingLink === plat ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Formulário */}
      {showForm && (
        <div className="neu-flat rounded-3xl border border-accent/20 p-5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-gray-200">Novo Registro</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Filial — só aparece no modo Matriz consolidado, onde não há
                uma unidade ativa implícita pra gravar o registro. */}
            {!filialAtiva && (
              <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Filial *</label>
                <select value={filialForm} onChange={e => setFilialForm(e.target.value)} className="neu-input rounded-xl px-3 py-2 text-sm">
                  <option value="">— Selecione —</option>
                  {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}
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
            <button onClick={salvar} disabled={saving || (!filialAtiva && !filialForm)} className="neu-button px-5 py-2 rounded-xl text-sm font-bold text-accent disabled:opacity-50">
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
            const platLink = links[plat];
            return (
              <div key={plat} className="neu-flat rounded-3xl border border-accent/10 overflow-hidden">
                {/* Header plataforma — link vem de "Links das Redes Sociais" (só em modo filial) */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5">
                  <span className={PLAT_COLOR[plat]}>{PLAT_ICON[plat]}</span>
                  <span className={`text-sm font-black ${PLAT_COLOR[plat]}`}>{plat}</span>
                  <span className="text-xs text-gray-500 ml-1">{regs.length} registros</span>
                  {platLink && (
                    <a href={platLink} target="_blank" rel="noopener noreferrer"
                      className="ml-auto flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-accent transition-colors">
                      <ExternalLink size={11}/> Abrir perfil
                    </a>
                  )}
                </div>
                {/* Linhas */}
                <div className="overflow-x-auto">
                  <table className="tabela w-full text-xs">
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
                                <button onClick={() => excluir(r.id)} className="action-btn-delete">
                                  <Trash2 size={12}/>
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
