import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Presentation, Trash2, Loader2, Eye, RotateCcw, Inbox, FileUp, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageLoadingFallback } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';

const MaxShowEditor = lazy(() =>
  import('./MaxShowEditor').then(m => ({ default: m.MaxShowEditor }))
);

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB — bate com o teto do bucket

type Show = {
  id: string;
  user_id: string;
  titulo: string;
  arquivo_url: string;
  arquivo_nome: string | null;
  arquivo_tamanho: number | null;
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

// Recupera o path dentro do bucket a partir da URL pública gerada pelo
// getPublicUrl (`.../object/public/max-show-anexos/{path}`).
const extractStoragePath = (publicUrl: string): string | null => {
  const marker = '/max-show-anexos/';
  const idx = publicUrl.indexOf(marker);
  return idx < 0 ? null : decodeURIComponent(publicUrl.slice(idx + marker.length));
};

export const MaxShowsView = ({ showToast, profile }: any) => {
  const confirm = useConfirm();
  const [tab, setTab] = useState<'ativos' | 'lixeira'>('ativos');
  const [shows, setShows] = useState<Show[]>([]);
  const [autores, setAutores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<'view' | 'edit'>('edit');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    let query = supabase.from('max_shows')
      .select('id,user_id,titulo,arquivo_url,arquivo_nome,arquivo_tamanho,updated_at,created_at,deleted_at')
      .order('updated_at', { ascending: false });
    query = tab === 'lixeira' ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) {
      showToast?.(`Erro ao carregar apresentações: ${error.message}`, 'error');
    } else {
      const rows = (data ?? []) as Show[];
      setShows(rows);
      const ids = [...new Set(rows.map(r => r.user_id).filter(id => id && id !== profile?.id))];
      if (ids.length) {
        const { data: profs } = await supabase.from('user_profiles').select('id,nome').in('id', ids);
        const map: Record<string, string> = {};
        (profs ?? []).forEach((p: any) => { if (p?.id && p?.nome) map[p.id] = p.nome; });
        setAutores(map);
      } else {
        setAutores({});
      }
    }
    setLoading(false);
  }, [tab, showToast, profile?.id]);

  useEffect(() => { load(); }, [load]);

  // Auto-purge lazy — mesmo padrão de MaxDocsView.
  useEffect(() => {
    if (tab !== 'lixeira' || !supabase || !profile?.id) return;
    const cutoff = new Date(Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('max_shows').delete()
      .eq('user_id', profile.id)
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
      .then(({ error }) => { if (!error) load(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile?.id]);

  const abrir = (id: string, mode: 'view' | 'edit') => { setOpenMode(mode); setOpenId(id); };

  // Upload de PDF — pega file, valida, sobe pro bucket, INSERT no banco.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const onPickPdf = () => fileInputRef.current?.click();
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reescolher o mesmo arquivo depois
    if (!file || !supabase || !profile?.id) return;
    if (file.type !== 'application/pdf') { showToast?.('Só aceito PDF por enquanto.', 'error'); return; }
    if (file.size > MAX_PDF_BYTES) { showToast?.(`PDF muito grande (máx ${Math.floor(MAX_PDF_BYTES / 1024 / 1024)} MB).`, 'error'); return; }
    setUploading(true);
    try {
      const path = `${profile.id}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('max-show-anexos').upload(path, file, {
        contentType: 'application/pdf', upsert: false,
      });
      if (upErr) { showToast?.(`Erro no upload: ${upErr.message}`, 'error'); return; }
      const { data: pub } = supabase.storage.from('max-show-anexos').getPublicUrl(path);
      const titulo = file.name.replace(/\.pdf$/i, '');
      const { error: insErr } = await supabase.from('max_shows').insert({
        user_id: profile.id, titulo,
        arquivo_url: pub.publicUrl,
        arquivo_nome: file.name,
        arquivo_tamanho: file.size,
      });
      if (insErr) {
        // rollback melhor esforço — tenta remover o arquivo já subido
        await supabase.storage.from('max-show-anexos').remove([path]);
        showToast?.(`Erro ao cadastrar: ${insErr.message}`, 'error'); return;
      }
      showToast?.('PDF importado com sucesso.', 'success');
      load();
    } finally {
      setUploading(false);
    }
  };

  const excluir = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ message: 'Mover esta apresentação para a lixeira? Fica lá por 30 dias antes de sumir de vez.', confirmLabel: 'Mover para lixeira' }))) return;
    // `.select()` nao e enfeite: um UPDATE que a RLS recorta para zero
    // linhas nao e erro — o PostgREST devolve 200 com lista vazia. Sem
    // olhar para o que voltou, a tela anunciava "movido para a lixeira" e
    // recarregava com o arquivo ainda la. Foi assim que a falta do ramo de
    // admin na policy de UPDATE (migr. 253, corrigida na 567) passou
    // despercebida: nunca houve mensagem de erro para investigar.
    const { data, error } = await supabase.from('max_shows')
      .update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) { showToast?.(`Erro ao excluir: ${error.message}`, 'error'); return; }
    if (!data?.length) { showToast?.('Sem permissão para excluir esta apresentação.', 'error'); return; }
    showToast?.('Movido para a lixeira.', 'success');
    load();
  };

  const restaurar = async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('max_shows')
      .update({ deleted_at: null }).eq('id', id).select('id');
    if (error) { showToast?.(`Erro ao restaurar: ${error.message}`, 'error'); return; }
    if (!data?.length) { showToast?.('Sem permissão para restaurar esta apresentação.', 'error'); return; }
    showToast?.('Apresentação restaurada.', 'success');
    load();
  };

  const excluirDefinitivo = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ message: 'Excluir permanentemente? Some pra todos agora e não dá pra recuperar.', confirmLabel: 'Excluir agora', danger: true }))) return;
    // Se for PDF, precisa remover o arquivo do storage antes (o hard delete
    // do banco não cascateia pra storage.objects).
    // A linha cai primeiro. Na ordem antiga o PDF saia do storage ANTES do
    // DELETE — e se a RLS recusasse a linha (o caso deste bug), o arquivo
    // ja tinha sumido do bucket e sobrava um registro apontando para o
    // vazio. O bucket nao cascateia do banco, entao a remocao continua
    // manual; so deixou de acontecer antes da hora.
    const { data, error } = await supabase.from('max_shows').delete().eq('id', id).select('id');
    if (error) { showToast?.(`Erro ao excluir: ${error.message}`, 'error'); return; }
    if (!data?.length) { showToast?.('Sem permissão para excluir esta apresentação.', 'error'); return; }
    const target = shows.find(s => s.id === id);
    if (target?.arquivo_url) {
      const path = extractStoragePath(target.arquivo_url);
      if (path) await supabase.storage.from('max-show-anexos').remove([path]);
    }
    showToast?.('Apresentação excluída permanentemente.', 'success');
    load();
  };

  const meus = useMemo(() => shows.filter(s => s.user_id === profile?.id), [shows, profile?.id]);
  const outros = useMemo(() => shows.filter(s => s.user_id !== profile?.id), [shows, profile?.id]);
  // Ver o material da turma e a premissa do modulo (migr. 253). MEXER nele
  // e outra coisa: CEO e conselheiro sao alunos, e apagar o trabalho de um
  // colega nao e papel de colega. A migr. 567 recorta a policy em
  // role='admin'; aqui o botao segue a mesma regua, para nao existir botao
  // que so serve para dar erro.
  const ehDocente = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.is_conselheiro;
  const podeGerirDeOutros = profile?.role === 'admin';

  if (openId) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <MaxShowEditor
          showId={openId} mode={openMode}
          onClose={() => { setOpenId(null); load(); }}
          showToast={showToast} profile={profile}
        />
      </Suspense>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-gray-100 flex items-center gap-2">
            <Presentation size={22} className="text-accent shrink-0" /> Max Show
          </h1>
        </div>
        {tab === 'ativos' && (
          <div className="flex gap-2 self-start sm:self-auto">
            <button onClick={onPickPdf} disabled={uploading} className="neu-button-accent px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 whitespace-nowrap">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
              <span className="sm:hidden">PDF</span><span className="hidden sm:inline">Importar PDF</span>
            </button>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={onFileChosen} className="hidden" />
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6 border-b border-white/5">
        <TabBtn active={tab === 'ativos'} onClick={() => setTab('ativos')} icon={<Presentation size={14} />}>Minhas apresentações</TabBtn>
        <TabBtn active={tab === 'lixeira'} onClick={() => setTab('lixeira')} icon={<Inbox size={14} />}>Lixeira</TabBtn>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Carregando…
        </div>
      ) : tab === 'ativos' ? (
        <>
          <Section titulo="Minhas apresentações" shows={meus}
            onAbrir={abrir} onDelete={excluir}
            emptyMsg="Você ainda não importou nenhum PDF." />
          {ehDocente && outros.length > 0 && (
            <Section titulo="Apresentações de outros usuários (visão docente)" shows={outros}
              showOwner autores={autores}
              onAbrir={abrir} onDelete={podeGerirDeOutros ? excluir : undefined} emptyMsg="" />
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] text-gray-500 italic mb-4">
            Itens na lixeira são apagados permanentemente após {PURGE_DAYS} dias.
          </p>
          <TrashSection titulo="Minhas apresentações excluídas" shows={meus}
            onRestore={restaurar} onDeleteForever={excluirDefinitivo}
            emptyMsg="Sua lixeira está vazia." />
          {ehDocente && outros.length > 0 && (
            <TrashSection titulo="Excluídas de outros usuários (visão docente)"
              shows={outros} showOwner autores={autores}
              onRestore={podeGerirDeOutros ? restaurar : undefined}
              onDeleteForever={podeGerirDeOutros ? excluirDefinitivo : undefined} emptyMsg="" />
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

const fmtBytes = (b: number | null): string => {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const Section = ({ titulo, shows, onAbrir, onDelete, emptyMsg, showOwner, autores }: {
  titulo: string; shows: Show[];
  onAbrir: (id: string, mode: 'view' | 'edit') => void;
  /** Ausente = secao so de leitura (aluno olhando o material de outro). */
  onDelete?: (id: string) => void;
  emptyMsg: string; showOwner?: boolean;
  autores?: Record<string, string>;
}) => (
  <div className="mb-8">
    <h2 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">{titulo}</h2>
    {shows.length === 0 ? (
      <p className="text-sm text-gray-500 italic py-6 text-center neu-pressed rounded-xl">{emptyMsg}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {shows.map(s => (
          <li key={s.id} className="neu-flat rounded-xl px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={18} className="text-red-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-200 truncate">{s.titulo || 'Sem título'}</div>
                <div className="text-[11px] text-gray-500">
                  {`PDF • ${fmtBytes(s.arquivo_tamanho)} • Enviado ${fmt(s.updated_at)}`}
                  {showOwner && ` • autor: ${autores?.[s.user_id] ?? s.user_id.slice(0, 8)}`}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end sm:shrink-0">
              <button onClick={() => onAbrir(s.id, 'view')} className="btn-shimmer btn-shimmer--glass-yellow" title="Abrir o PDF">
                <Eye size={13} /> Abrir
              </button>
              {onDelete && (
                <button onClick={() => onDelete(s.id)} className="btn-shimmer btn-shimmer--glass-red" title="Mover para lixeira">
                  <Trash2 size={13} /> Excluir
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const TrashSection = ({ titulo, shows, onRestore, onDeleteForever, emptyMsg, showOwner, autores }: {
  titulo: string; shows: Show[];
  /** Ausentes = secao so de leitura. Ver `podeGerirDeOutros`. */
  onRestore?: (id: string) => void;
  onDeleteForever?: (id: string) => void;
  emptyMsg: string; showOwner?: boolean;
  autores?: Record<string, string>;
}) => (
  <div className="mb-8">
    <h2 className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-3">{titulo}</h2>
    {shows.length === 0 ? (
      <p className="text-sm text-gray-500 italic py-6 text-center neu-pressed rounded-xl">{emptyMsg}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {shows.map(s => {
          const dias = s.deleted_at ? diasAtras(s.deleted_at) : 0;
          const restam = Math.max(0, PURGE_DAYS - dias);
          // Max Show hoje so trabalha com PDF importado — ver commit 258f480.
          const Icon = FileText;
          return (
            <li key={s.id} className="neu-flat rounded-xl px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 opacity-70">
              <div className="flex items-center gap-3 min-w-0">
                <Icon size={18} className="text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-300 truncate line-through">{s.titulo || 'Sem título'}</div>
                  <div className="text-[11px] text-gray-500">
                    Excluída há {dias === 0 ? 'menos de 1 dia' : `${dias} dia${dias > 1 ? 's' : ''}`} • some em {restam} dia{restam !== 1 ? 's' : ''}
                    {showOwner && ` • autor: ${autores?.[s.user_id] ?? s.user_id.slice(0, 8)}`}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-end sm:shrink-0">
                {onRestore && (
                  <button onClick={() => onRestore(s.id)} className="btn-shimmer btn-shimmer--glass-green" title="Restaurar">
                    <RotateCcw size={13} /> Restaurar
                  </button>
                )}
                {onDeleteForever && (
                  <button onClick={() => onDeleteForever(s.id)} className="btn-shimmer btn-shimmer--glass-red" title="Excluir permanentemente">
                    <Trash2 size={13} /> Excluir agora
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
