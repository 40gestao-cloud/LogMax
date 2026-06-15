import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Edit3, Calendar, ChevronRight, ExternalLink, Filter } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { formatDataHoraBR } from '../lib/dates';
import { hasSetor } from '../lib/rbac';

const CANAIS = [
  'Instagram Feed',
  'Instagram Reels',
  'Status (WhatsApp)',
  'WhatsApp Comunidade',
  'Facebook',
  'TikTok',
  'YouTube Shorts',
  'E-mail Marketing',
  'Outros',
] as const;

const STATUS_FLOW = ['Rascunho', 'Agendado', 'Publicado', 'Cancelado'] as const;
type Status = typeof STATUS_FLOW[number];

const STATUS_STYLE: Record<Status, string> = {
  'Rascunho':   'bg-gray-500/10  text-gray-400  border-gray-500/20',
  'Agendado':   'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Publicado':  'bg-accent/10    text-accent    border-accent/20',
  'Cancelada':  'bg-red-500/10   text-red-500   border-red-500/20',
} as any;
STATUS_STYLE['Cancelado'] = 'bg-red-500/10 text-red-500 border-red-500/20';

const CANAL_BADGE: Record<string, string> = {
  'Instagram Feed':    'bg-pink-500/10 text-pink-400 border-pink-500/20',
  'Instagram Reels':   'bg-pink-500/10 text-pink-400 border-pink-500/20',
  'Status (WhatsApp)': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'WhatsApp Comunidade': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Facebook':          'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'TikTok':            'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20',
  'YouTube Shorts':    'bg-red-500/10 text-red-400 border-red-500/20',
  'E-mail Marketing':  'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Outros':            'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

type Post = {
  id: string;
  titulo: string;
  canal: string;
  data_post: string;
  responsavel_id: string | null;
  nome_responsavel: string | null;
  status: Status;
  conteudo: string | null;
  link_arte: string | null;
  promocao_id: string | null;
  nome_criador: string | null;
  created_at: string;
};

type Promocao = { id: string; nome_produto: string; status: string };

const EMPTY_FORM = {
  titulo: '',
  canal: 'Instagram Feed' as string,
  data_post: '',
  hora_post: '18:00',
  nome_responsavel: '',
  conteudo: '',
  link_arte: '',
  promocao_id: '',
  status: 'Rascunho' as Status,
};

// Combina date + time num timestamptz local — o input HTML retorna no
// fuso local do navegador, que coincide com o fuso operacional na maior
// parte das máquinas usadas pelos alunos. Salvamos sem suffix; o Postgres
// converte pra UTC. Para máxima precisão no Acre, o ideal seria forçar
// -05:00 — mas isso quebraria a UX de edição (rerender mostraria horário
// errado pro usuário em outro fuso). Trade-off aceitável pra ambiente
// didático.
const combinarDataHora = (data: string, hora: string): string | null => {
  if (!data) return null;
  return `${data}T${hora || '18:00'}:00`;
};

const splitDataHora = (iso: string): { data: string; hora: string } => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { data: '', hora: '18:00' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};

export const CalendarioEditorialView = ({ showToast, profile }: any) => {
  const { data: posts, setData, isLoading } = useFetchData<Post>('/api/marketingcalendarioview');
  const { data: promocoes } = useFetchData<Promocao>('/api/marketingpromocoesview');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filtroCanal, setFiltroCanal] = useState<string>('todos');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');

  const canCRUD = hasSetor(profile, 'marketing');

  const promocoesAprovadas = useMemo(
    () => (promocoes ?? []).filter((p: any) => p.status === 'Aprovado'),
    [promocoes],
  );

  const resetForm = () => { setForm(EMPTY_FORM); setEditing(null); setShowForm(false); };

  const openEdit = (p: Post) => {
    const { data, hora } = splitDataHora(p.data_post);
    setEditing(p);
    setForm({
      titulo:           p.titulo,
      canal:            p.canal,
      data_post:        data,
      hora_post:        hora,
      nome_responsavel: p.nome_responsavel ?? '',
      conteudo:         p.conteudo ?? '',
      link_arte:        p.link_arte ?? '',
      promocao_id:      p.promocao_id ?? '',
      status:           p.status,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.titulo.trim()) { showToast('Informe o título do post.', 'error'); return; }
    if (!form.data_post)     { showToast('Informe a data do post.', 'error'); return; }
    if (!form.canal)         { showToast('Selecione o canal.', 'error'); return; }

    setSaving(true);
    try {
      const payload: any = {
        titulo:           form.titulo.trim(),
        canal:            form.canal,
        data_post:        combinarDataHora(form.data_post, form.hora_post),
        nome_responsavel: form.nome_responsavel.trim() || null,
        conteudo:         form.conteudo.trim() || null,
        link_arte:        form.link_arte.trim() || null,
        promocao_id:      form.promocao_id || null,
        status:           form.status,
      };
      if (editing) {
        const updated = await dbUpdate('/api/marketingcalendarioview', editing.id, payload);
        setData((prev: any[]) => prev.map((x: any) => x.id === editing.id ? { ...x, ...updated } : x));
        showToast('Post atualizado.', 'success');
      } else {
        payload.nome_criador     = profile?.nome ?? '';
        payload.criado_por       = profile?.id ?? null;
        // Se o nome do responsável não foi informado, assume o criador.
        if (!payload.nome_responsavel) payload.nome_responsavel = profile?.nome ?? null;
        payload.responsavel_id   = profile?.id ?? null;
        const created = await dbInsert('/api/marketingcalendarioview', payload);
        setData((prev: any[]) => [created, ...prev]);
        showToast('Post agendado.', 'success');
      }
      resetForm();
    } catch (err: any) {
      console.error('[Calendario] salvar:', err);
      showToast(`Erro ao salvar: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const handleAdvance = async (p: Post) => {
    // Rascunho → Agendado → Publicado. Cancelado fica fora do fluxo.
    const proximo: Status | null =
      p.status === 'Rascunho' ? 'Agendado' :
      p.status === 'Agendado' ? 'Publicado' : null;
    if (!proximo) return;
    try {
      const updated = await dbUpdate('/api/marketingcalendarioview', p.id, { status: proximo } as any);
      setData((prev: any[]) => prev.map((x: any) => x.id === p.id ? { ...x, ...updated } : x));
      showToast(`Status: ${proximo}`, 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const handleDelete = async (p: Post) => {
    if (!confirm(`Inativar o post "${p.titulo}"?`)) return;
    try {
      await dbDelete('/api/marketingcalendarioview', p.id);
      setData((prev: any[]) => prev.filter((x: any) => x.id !== p.id));
      showToast('Post inativado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const postsFiltrados = posts
    .filter((p: any) => filtroCanal  === 'todos' || p.canal  === filtroCanal)
    .filter((p: any) => filtroStatus === 'todos' || p.status === filtroStatus)
    .sort((a: any, b: any) => new Date(a.data_post).getTime() - new Date(b.data_post).getTime());

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const proximos7 = posts.filter((p: any) => {
    const d = new Date(p.data_post);
    const diffDias = (d.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24);
    return diffDias >= 0 && diffDias <= 7 && p.status !== 'Cancelado';
  }).length;
  const rascunhos = posts.filter((p: any) => p.status === 'Rascunho').length;
  const agendados = posts.filter((p: any) => p.status === 'Agendado').length;
  const publicados = posts.filter((p: any) => p.status === 'Publicado').length;

  const kpis = [
    { label: 'Próximos 7 dias', value: proximos7, warn: proximos7 === 0 },
    { label: 'Rascunhos',       value: rascunhos, warn: false },
    { label: 'Agendados',       value: agendados, warn: false },
    { label: 'Publicados',      value: publicados, warn: false },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Calendário Editorial</h2>
        <p className="text-sm text-gray-400 mt-1">
          Agenda de posts por canal × data × responsável × status. Planeje a semana antes de produzir as artes.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'} tabular-nums`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-gray-500" />
          <select value={filtroCanal} onChange={e => setFiltroCanal(e.target.value)}
            className="neu-input py-1.5 px-3 rounded-xl text-xs">
            <option value="todos">Todos os canais</option>
            {CANAIS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
            className="neu-input py-1.5 px-3 rounded-xl text-xs">
            <option value="todos">Todos os status</option>
            {STATUS_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {canCRUD && (
          <NeuButtonAccent variant="" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={14} />Novo Post
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editing ? 'Editar Post' : 'Novo Post no Calendário'}</h3>
              <button onClick={resetForm} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label htmlFor="cal-titulo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Título *</label>
                <input id="cal-titulo" type="text" value={form.titulo}
                  onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Lançamento Coleção Verão" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cal-canal" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Canal *</label>
                <select id="cal-canal" value={form.canal}
                  onChange={e => setForm(f => ({ ...f, canal: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {CANAIS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cal-data" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data *</label>
                <input id="cal-data" type="date" value={form.data_post}
                  onChange={e => setForm(f => ({ ...f, data_post: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cal-hora" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Horário</label>
                <input id="cal-hora" type="time" value={form.hora_post}
                  onChange={e => setForm(f => ({ ...f, hora_post: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cal-status" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                <select id="cal-status" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as Status }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {STATUS_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cal-responsavel" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Responsável</label>
                <input id="cal-responsavel" type="text" value={form.nome_responsavel}
                  onChange={e => setForm(f => ({ ...f, nome_responsavel: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Default: você" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cal-promocao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Promoção vinculada</label>
                <select id="cal-promocao" value={form.promocao_id}
                  onChange={e => setForm(f => ({ ...f, promocao_id: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Sem promoção</option>
                  {promocoesAprovadas.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nome_produto}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="cal-link" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Link da arte (Canva, Drive)</label>
                <input id="cal-link" type="url" value={form.link_arte}
                  onChange={e => setForm(f => ({ ...f, link_arte: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="https://..." />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="cal-conteudo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Conteúdo / Legenda</label>
                <textarea id="cal-conteudo" value={form.conteudo} rows={3}
                  onChange={e => setForm(f => ({ ...f, conteudo: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
                  placeholder="Copy do post. Use o botão Gerar legenda na tela de Promoções pra obter sugestões da IA." />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetForm} className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                Cancelar
              </button>
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : (editing ? 'Salvar' : 'Agendar Post')}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-3 shrink-0">
        {postsFiltrados.length === 0 ? (
          <EmptyState message={posts.length === 0 ? 'Nenhum post agendado ainda' : 'Nenhum post bate com o filtro'} />
        ) : (
          <AnimatePresence>
            {postsFiltrados.map((p: any) => {
              const status = p.status as Status;
              const podeAvancar = status === 'Rascunho' || status === 'Agendado';
              const atrasado = status === 'Agendado' && new Date(p.data_post) < new Date();
              return (
                <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col sm:flex-row sm:items-center gap-3 group">
                  <div className="flex flex-col items-center sm:items-start sm:w-32 shrink-0">
                    <div className="flex items-center gap-1.5 text-gray-300">
                      <Calendar size={12} className="text-accent" />
                      <span className="text-sm font-bold tabular-nums">{formatDataHoraBR(p.data_post)}</span>
                    </div>
                    {atrasado && (
                      <span className="text-[9px] font-bold text-red-400 uppercase mt-0.5">atrasado</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${CANAL_BADGE[p.canal] ?? CANAL_BADGE['Outros']}`}>
                        {p.canal}
                      </span>
                      <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[status]}`}>
                        {status}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-gray-200 truncate">{p.titulo}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500 flex-wrap">
                      {p.nome_responsavel && <span>👤 {p.nome_responsavel}</span>}
                      {p.link_arte && (
                        <a href={p.link_arte} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline">
                          <ExternalLink size={9} />arte
                        </a>
                      )}
                    </div>
                    {p.conteudo && (
                      <p className="text-xs text-gray-400 mt-2 line-clamp-2 whitespace-pre-wrap">{p.conteudo}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {podeAvancar && (canCRUD || p.responsavel_id === profile?.id) && (
                      <button onClick={() => handleAdvance(p)}
                        className="neu-button py-1.5 px-3 rounded-xl text-xs font-bold text-accent border border-accent/20 hover:bg-accent/10 transition-all flex items-center gap-1.5">
                        <ChevronRight size={12} />
                        {status === 'Rascunho' ? 'Agendar' : 'Publicar'}
                      </button>
                    )}
                    {canCRUD && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(p)} title="Editar" className="action-btn-edit">
                          <Edit3 size={12} />
                        </button>
                        <button onClick={() => handleDelete(p)} title="Inativar" className="action-btn-delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
};
