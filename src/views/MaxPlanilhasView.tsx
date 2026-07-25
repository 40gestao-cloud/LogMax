import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Sheet, Plus, Trash2, Loader2, Eye, Pencil, RotateCcw, Inbox } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageLoadingFallback } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';

const MaxPlanilhaEditor = lazy(() =>
  import('./MaxPlanilhaEditor').then(m => ({ default: m.MaxPlanilhaEditor }))
);

type Planilha = {
  id: string;
  user_id: string;
  titulo: string;
  conteudo: any;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
};

const PURGE_DAYS = 30;

const fmt = (iso: string) => {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Rio_Branco',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
};

const diasAtras = (iso: string): number => {
  const d = new Date(iso).getTime();
  return Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24));
};

export const MaxPlanilhasView = ({ showToast, profile }: any) => {
  const confirm = useConfirm();
  const [tab, setTab] = useState<'ativos' | 'lixeira'>('ativos');
  const [planilhas, setPlanilhas] = useState<Planilha[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<'view' | 'edit'>('edit');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    let query = supabase.from('max_planilhas')
      .select('id,user_id,titulo,conteudo,updated_at,created_at,deleted_at')
      .order('updated_at', { ascending: false });
    query = tab === 'lixeira' ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) {
      showToast?.(`Erro ao carregar planilhas: ${error.message}`, 'error');
    } else {
      setPlanilhas((data ?? []) as Planilha[]);
    }
    setLoading(false);
  }, [tab, showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'lixeira' || !supabase || !profile?.id) return;
    const cutoff = new Date(Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('max_planilhas').delete()
      .eq('user_id', profile.id)
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
      .then(({ error }) => { if (!error) load(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile?.id]);

  const criar = async () => {
    if (!supabase || !profile?.id) return;
    const { data, error } = await supabase
      .from('max_planilhas')
      .insert({ user_id: profile.id, titulo: 'Planilha sem título', conteudo: [] })
      .select().single();
    if (error) { showToast?.(`Erro ao criar: ${error.message}`, 'error'); return; }
    setOpenMode('edit');
    setOpenId(data.id);
    load();
  };

  const abrir = (id: string, mode: 'view' | 'edit') => { setOpenMode(mode); setOpenId(id); };

  const excluir = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ message: 'Mover esta planilha para a lixeira? Fica lá por 30 dias antes de sumir de vez.', confirmLabel: 'Mover para lixeira' }))) return;
    const { error } = await supabase.from('max_planilhas').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { showToast?.(`Erro ao excluir: ${error.message}`, 'error'); return; }
    showToast?.('Movida para a lixeira.', 'success');
    load();
  };

  const restaurar = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('max_planilhas').update({ deleted_at: null }).eq('id', id);
    if (error) { showToast?.(`Erro ao restaurar: ${error.message}`, 'error'); return; }
    showToast?.('Planilha restaurada.', 'success');
    load();
  };

  const excluirDefinitivo = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ message: 'Excluir permanentemente? Some pra todos agora e não dá pra recuperar.', confirmLabel: 'Excluir agora', danger: true }))) return;
    const { error } = await supabase.from('max_planilhas').delete().eq('id', id);
    if (error) { showToast?.(`Erro ao excluir: ${error.message}`, 'error'); return; }
    showToast?.('Planilha excluída permanentemente.', 'success');
    load();
  };

  const minhas = useMemo(() => planilhas.filter(p => p.user_id === profile?.id), [planilhas, profile?.id]);
  const outras = useMemo(() => planilhas.filter(p => p.user_id !== profile?.id), [planilhas, profile?.id]);
  const ehDocente = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.is_conselheiro;

  if (openId) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <MaxPlanilhaEditor
          planilhaId={openId} mode={openMode}
          onClose={() => { setOpenId(null); load(); }}
          showToast={showToast} profile={profile}
        />
      </Suspense>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-100 flex items-center gap-2">
            <Sheet size={22} className="text-accent" /> Max Planilhas
          </h1>
          <p className="text-xs text-gray-500 mt-1">Monte planilhas estilo Excel com fórmulas e formatação.</p>
        </div>
        {tab === 'ativos' && (
          <button onClick={criar} className="neu-button-accent px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
            <Plus size={16} /> Nova planilha
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6 border-b border-white/5">
        <TabBtn active={tab === 'ativos'} onClick={() => setTab('ativos')} icon={<Sheet size={14} />}>Minhas planilhas</TabBtn>
        <TabBtn active={tab === 'lixeira'} onClick={() => setTab('lixeira')} icon={<Inbox size={14} />}>Lixeira</TabBtn>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Carregando…
        </div>
      ) : tab === 'ativos' ? (
        <>
          <Section titulo="Minhas planilhas" items={minhas} canEdit
            onAbrir={abrir} onDelete={excluir}
            emptyMsg="Você ainda não criou nenhuma planilha." />
          {ehDocente && outras.length > 0 && (
            <Section titulo="Planilhas de outros usuários (visão docente)" items={outras}
              canEdit={false} showOwner
              onAbrir={abrir} onDelete={excluir} emptyMsg="" />
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] text-gray-500 italic mb-4">
            Itens na lixeira são apagados permanentemente após {PURGE_DAYS} dias.
          </p>
          <TrashSection titulo="Minhas planilhas excluídas" items={minhas}
            onRestore={restaurar} onDeleteForever={excluirDefinitivo}
            emptyMsg="Sua lixeira está vazia." />
          {ehDocente && outras.length > 0 && (
            <TrashSection titulo="Excluídas de outros usuários (visão docente)"
              items={outras} showOwner
              onRestore={restaurar} onDeleteForever={excluirDefinitivo} emptyMsg="" />
          )}
        </>
      )}
    </div>
  );
};

const TabBtn = ({ active, onClick, icon, children }: any) => (
  <button onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-all ${active ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
    {icon}{children}
  </button>
);

const Section = ({ titulo, items, onAbrir, onDelete, canEdit, emptyMsg, showOwner }: {
  titulo: string; items: Planilha[];
  onAbrir: (id: string, mode: 'view' | 'edit') => void;
  onDelete: (id: string) => void;
  canEdit: boolean; emptyMsg: string; showOwner?: boolean;
}) => (
  <div className="mb-8">
    <h2 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">{titulo}</h2>
    {items.length === 0 ? (
      <p className="text-sm text-gray-500 italic py-6 text-center neu-pressed rounded-xl">{emptyMsg}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {items.map(p => (
          <li key={p.id} className="neu-flat rounded-xl px-4 py-3 flex items-center gap-3">
            <Sheet size={18} className="text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-200 truncate">{p.titulo || 'Sem título'}</div>
              <div className="text-[11px] text-gray-500">
                Editado {fmt(p.updated_at)}
                {showOwner && ` • autor: ${p.user_id.slice(0, 8)}`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => onAbrir(p.id, 'view')} className="btn-shimmer btn-shimmer--glass-yellow" title="Abrir apenas para leitura">
                <Eye size={13} /> Abrir
              </button>
              {canEdit && (
                <button onClick={() => onAbrir(p.id, 'edit')} className="btn-shimmer btn-shimmer--glass-blue" title="Abrir para edição">
                  <Pencil size={13} /> Editar
                </button>
              )}
              <button onClick={() => onDelete(p.id)} className="btn-shimmer btn-shimmer--glass-red" title="Mover para lixeira">
                <Trash2 size={13} /> Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const TrashSection = ({ titulo, items, onRestore, onDeleteForever, emptyMsg, showOwner }: {
  titulo: string; items: Planilha[];
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  emptyMsg: string; showOwner?: boolean;
}) => (
  <div className="mb-8">
    <h2 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">{titulo}</h2>
    {items.length === 0 ? (
      <p className="text-sm text-gray-500 italic py-6 text-center neu-pressed rounded-xl">{emptyMsg}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {items.map(p => {
          const dias = p.deleted_at ? diasAtras(p.deleted_at) : 0;
          const restam = Math.max(0, PURGE_DAYS - dias);
          return (
            <li key={p.id} className="neu-flat rounded-xl px-4 py-3 flex items-center gap-3 opacity-70">
              <Sheet size={18} className="text-gray-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-300 truncate line-through">{p.titulo || 'Sem título'}</div>
                <div className="text-[11px] text-gray-500">
                  Excluída há {dias === 0 ? 'menos de 1 dia' : `${dias} dia${dias > 1 ? 's' : ''}`} • some em {restam} dia{restam !== 1 ? 's' : ''}
                  {showOwner && ` • autor: ${p.user_id.slice(0, 8)}`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onRestore(p.id)} className="btn-shimmer btn-shimmer--glass-green" title="Restaurar">
                  <RotateCcw size={13} /> Restaurar
                </button>
                <button onClick={() => onDeleteForever(p.id)} className="btn-shimmer btn-shimmer--glass-red" title="Excluir permanentemente">
                  <Trash2 size={13} /> Excluir agora
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
