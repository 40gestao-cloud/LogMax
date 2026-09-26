import React, { useState, useMemo, useEffect } from 'react';
import { todayBR } from '../lib/dates';
import { motion } from 'motion/react';
import { Instagram, Plus, Trash2, TrendingUp, TrendingDown, Loader2, Link2, ExternalLink, Check, CalendarDays, BarChart3, Music2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent, CardContador, SecaoFormulario, AbaColorida, type CorAba } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
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
  TikTok:    <Music2 size={14} />,
};

// Cor de cada plataforma na aba e na caixa da tabela — a mesma nos dois
// lugares, para o aluno ligar o filtro à caixa sem ler o nome.
const PLAT_COR: Record<Plataforma, CorAba> = {
  Instagram: 'roxo',
  TikTok:    'azul',
};
const PLAT_ICONE: Record<Plataforma, any> = {
  Instagram,
  TikTok: Music2,
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

const numeroBR = (n: number) => n.toLocaleString('pt-BR');

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

  const confirm = useConfirm();
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

  // Resumo do topo: o último registro de cada plataforma (e de cada unidade,
  // no modo Matriz) é a foto atual da conta — somar todos os registros
  // contaria o mesmo seguidor a cada dia registrado. Ignora o filtro de
  // plataforma de propósito: os cards são o panorama, a tabela é o detalhe.
  const resumo = useMemo(() => {
    const base = filialAtiva ? raw.filter((r: any) => r.filial === filialAtiva) : raw;
    const ultimo = new Map<string, any>();
    for (const r of base as any[]) {
      const k = `${r.filial}|${r.plataforma}`;
      const atual = ultimo.get(k);
      if (!atual || String(r.data_registro) > String(atual.data_registro)) ultimo.set(k, r);
    }
    const soma = (plat: Plataforma | null, campo: string) => [...ultimo.values()]
      .filter(r => !plat || r.plataforma === plat)
      .reduce((a, r) => a + Number(r[campo] ?? 0), 0);
    return {
      insta: soma('Instagram', 'seguidores'),
      tiktok: soma('TikTok', 'seguidores'),
      visualizacoes: soma(null, 'visualizacoes'),
      engajamento: soma(null, 'curtidas') + soma(null, 'comentarios') + soma(null, 'compartilhamentos'),
      registros: base.length,
    };
  }, [raw, filialAtiva]);

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
    if (!(await confirm('Remover este registro de métricas?'))) return;
    const { error } = await supabase.from('metricas_redes_sociais').update({ ativo: false }).eq('id', id);
    if (error) { showToast?.(error.message, 'error'); return; }
    showToast?.('Registro removido.', 'success');
    reload();
  }

  // Campo numérico do formulário: um só molde para as cinco métricas — antes
  // eram cinco blocos copiados, cada um com o seu rótulo à mão.
  const campoMetrica = (m: { key: string; label: string }) => (
    <div key={m.key} className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{m.label}</label>
      <input type="text" inputMode="numeric" value={(form as any)[m.key]}
        onChange={e => setForm(f => ({ ...f, [m.key]: e.target.value.replace(/\D/g, '') }))}
        className="neu-input rounded-xl px-3 py-2 text-sm tabular-nums" placeholder="0" />
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
          Redes Sociais{filialAtiva ? ` — ${filialAtiva}` : ''}
        </h2>
        {podeRegistrar && !showForm && (
          <NeuButtonAccent onClick={() => setShowForm(true)}>
            <Plus size={15} /> Registrar métricas
          </NeuButtonAccent>
        )}
      </div>

      {/* Resumo — a foto atual das contas, cada card com a sua cor. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <CardContador label="Seguidores Instagram" value={numeroBR(resumo.insta)} tom="roxo" />
        <CardContador label="Seguidores TikTok" value={numeroBR(resumo.tiktok)} tom="azul" />
        <CardContador label="Visualizações" value={numeroBR(resumo.visualizacoes)} tom="laranja" corFixa sub="último registro" />
        <CardContador label="Engajamento" value={numeroBR(resumo.engajamento)} tom="verde" sub="curtidas + comentários + compart." />
        <CardContador label="Registros" value={resumo.registros} tom="dourado" />
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-gray-200">Novo Registro</h3>

          <SecaoFormulario titulo="Plataforma e data" icon={CalendarDays} cor="amarelo">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Filial — só aparece no modo Matriz consolidado, onde não há
                  uma unidade ativa implícita pra gravar o registro. */}
              {!filialAtiva && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Filial *</label>
                  <select value={filialForm} onChange={e => setFilialForm(e.target.value)} className="neu-input rounded-xl px-3 py-2 text-sm">
                    <option value="">— Selecione —</option>
                    {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Plataforma</label>
                <div className="flex gap-2">
                  {PLATAFORMAS.map(p => (
                    <AbaColorida key={p} label={p} icon={PLAT_ICONE[p]} cor={PLAT_COR[p]}
                      ativa={form.plataforma === p}
                      onClick={() => setForm(f => ({ ...f, plataforma: p }))} />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Data</label>
                <input type="date" value={form.data_registro} onChange={e => setForm(f => ({ ...f, data_registro: e.target.value }))} className="neu-input rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
          </SecaoFormulario>

          <SecaoFormulario titulo="Métricas do dia" icon={BarChart3} cor="verde">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {METRICAS.map(campoMetrica)}
            </div>
          </SecaoFormulario>

          <div className="flex gap-3 justify-end">
            <button onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }); setFilialForm(''); }}
              className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
            <NeuButtonAccent onClick={salvar} isLoading={saving} disabled={!filialAtiva && !filialForm}>
              <Check size={14} /> Salvar
            </NeuButtonAccent>
          </div>
        </div>
      )}

      {/* Links das redes sociais — 1 por plataforma, configurado uma vez por
          filial (não redigitado a cada registro de métrica). Só em modo filial. */}
      {podeRegistrar && filialAtiva && (
        <SecaoFormulario titulo="Links dos perfis" icon={Link2} cor="laranja">
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
                      className="btn-solido btn-solido--verde !w-8 !h-8 !p-0 justify-center shrink-0"
                      title="Salvar link"
                    >
                      {savingLink === plat ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SecaoFormulario>
      )}

      {/* Filtro por plataforma — abas na cor de cada plataforma. */}
      <div className="flex flex-wrap gap-2">
        <AbaColorida label="Todas" icon={BarChart3} cor="dourado" ativa={filtroPlat === 'Todas'} onClick={() => setFiltroPlat('Todas')} />
        {PLATAFORMAS.map(p => (
          <AbaColorida key={p} label={p} icon={PLAT_ICONE[p]} cor={PLAT_COR[p]} ativa={filtroPlat === p} onClick={() => setFiltroPlat(p)} />
        ))}
      </div>

      {/* Uma caixa por plataforma, com a faixa na cor dela */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
      ) : registros.length === 0 ? (
        <EmptyState message="Nenhum registro de métricas ainda." />
      ) : (
        <div className="flex flex-col gap-4">
          {PLATAFORMAS.filter(p => filtroPlat === 'Todas' || filtroPlat === p).map(plat => {
            const regs = registros.filter((r: any) => r.plataforma === plat);
            if (regs.length === 0) return null;
            const platLink = links[plat];
            return (
              <SecaoFormulario key={plat} titulo={plat} icon={PLAT_ICONE[plat]} cor={PLAT_COR[plat]}
                extra={<span className="flex items-center gap-3">
                  {regs.length} registro{regs.length === 1 ? '' : 's'}
                  {platLink && (
                    <a href={platLink} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 underline underline-offset-2 hover:opacity-80">
                      <ExternalLink size={11}/> Abrir perfil
                    </a>
                  )}
                </span>}>
                <div className="overflow-x-auto main-scrollbar -m-4 sm:-m-5">
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
                        // Registro anterior da MESMA unidade: no modo Matriz
                        // a linha de baixo pode ser de outra filial, e a
                        // variação compararia contas diferentes.
                        const prev = regs.slice(i + 1).find((x: any) => x.filial === r.filial);
                        const canDel = isAdminCeo || r.registrado_por === profile.id;
                        return (
                          <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-2.5 font-mono text-gray-300">{new Date(r.data_registro + 'T12:00').toLocaleDateString('pt-BR')}</td>
                            {!filialAtiva && <td className="px-4 py-2.5 text-gray-400">{r.filial}</td>}
                            {METRICAS.map(m => (
                              <td key={m.key} className="px-4 py-2.5 text-right font-mono text-gray-200">
                                <div className="flex flex-col items-end">
                                  <span>{numeroBR(Number(r[m.key] ?? 0))}</span>
                                  {variacao(Number(r[m.key] ?? 0), prev ? Number(prev[m.key] ?? 0) : undefined)}
                                </div>
                              </td>
                            ))}
                            <td className="px-3 py-2.5 text-right">
                              {canDel && (
                                <button onClick={() => excluir(r.id)} className="action-btn-delete" title="Remover registro">
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
              </SecaoFormulario>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
