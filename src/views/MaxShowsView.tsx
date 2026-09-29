import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { motion } from 'motion/react';
import { Presentation, Trash2, Loader2, Eye, RotateCcw, Inbox, FileUp, FileText, Search, Users, ShieldCheck, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageLoadingFallback, LoadingSpinner, AbaComContador, SecaoFormulario, CardContador, COR_ABA, type CorAba } from '../components/ui';
import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import { useConfirm } from '../contexts/ConfirmContext';
import { useVoltarInterno } from '../hooks/useVoltarInterno';

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

const fmtBytes = (b: number | null): string => {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

// Recupera o path dentro do bucket a partir da URL pública gerada pelo
// getPublicUrl (`.../object/public/max-show-anexos/{path}`).
const extractStoragePath = (publicUrl: string): string | null => {
  const marker = '/max-show-anexos/';
  const idx = publicUrl.indexOf(marker);
  return idx < 0 ? null : decodeURIComponent(publicUrl.slice(idx + marker.length));
};

// ── Abas por autor: Admin Master · Gerente · Colaborador ─────────────────
//
// Quem vê o quê é a RLS que decide (migr. 655): o admin vê tudo; o gerente vê
// as dele e as dos colaboradores da unidade; o colaborador, só as próprias. A
// tela só não oferece aba que para aquele papel viria sempre vazia.
//
// CEO e conselheiro caem em Gerente: são a liderança da turma e nenhuma das
// outras duas caixas descreve o que eles publicam. O admin não aparece no
// `user_profiles` de quem não é admin (a RLS esconde `role='admin'`), por isso
// autor sem perfil visível cai em Admin Master — mesma leitura de Documentos.
type Papel = 'admin' | 'gerente' | 'colaborador';
type Aba = Papel | 'lixeira';
const papelDe = (role: string | null | undefined): Papel =>
  role === undefined || role === 'admin' ? 'admin' : role === 'colaborador' ? 'colaborador' : 'gerente';

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const MaxShowsView = ({ showToast, profile }: any) => {
  const confirm = useConfirm();
  const meuPapel = papelDe(profile?.role ?? 'colaborador');
  // Docente (admin, CEO, conselheiro) enxerga a turma inteira; o gerente, a
  // equipe dele; o colaborador fica só com a aba dele.
  const ehDocente = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.is_conselheiro;
  const abasVisiveis: Papel[] = ehDocente ? ['admin', 'gerente', 'colaborador']
    : meuPapel === 'gerente' ? ['gerente', 'colaborador'] : ['colaborador'];
  const [tabEscolhida, setTab] = useState<Aba | null>(null);
  // Até a pessoa escolher, abre na aba do próprio papel (o perfil pode chegar
  // depois do primeiro render).
  const tab: Aba = tabEscolhida && (tabEscolhida === 'lixeira' || abasVisiveis.includes(tabEscolhida))
    ? tabEscolhida : (abasVisiveis.includes(meuPapel) ? meuPapel : abasVisiveis[0]);
  // Ativas e lixeira numa consulta só: as abas mostram a contagem das duas,
  // e trocar de aba deixa de recarregar a lista.
  const [shows, setShows] = useState<Show[]>([]);
  const [autores, setAutores] = useState<Record<string, string>>({});
  const [papeis, setPapeis] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<'view' | 'edit'>('edit');
  // PDF aberto: o Voltar do topo e o gesto do celular fecham o PDF, não o módulo.
  useVoltarInterno(!!openId, () => { setOpenId(null); load(); });
  const [busca, setBusca] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('max_shows')
      .select('id,user_id,titulo,arquivo_url,arquivo_nome,arquivo_tamanho,updated_at,created_at,deleted_at')
      .order('updated_at', { ascending: false });
    if (error) {
      showToast?.(`Erro ao carregar apresentações: ${error.message}`, 'error');
    } else {
      const rows = (data ?? []) as Show[];
      setShows(rows);
      const ids = [...new Set(rows.map(r => r.user_id).filter(id => id && id !== profile?.id))];
      if (ids.length) {
        const { data: profs } = await supabase.from('user_profiles').select('id,nome,role').in('id', ids);
        const map: Record<string, string> = {};
        const roles: Record<string, string> = {};
        (profs ?? []).forEach((p: any) => {
          if (p?.id && p?.nome) map[p.id] = p.nome;
          if (p?.id) roles[p.id] = String(p.role ?? '');
        });
        setAutores(map);
        setPapeis(roles);
      } else {
        setAutores({});
        setPapeis({});
      }
    }
    setLoading(false);
  }, [showToast, profile?.id]);

  // Auto-purge lazy da própria lixeira antes da primeira carga.
  useEffect(() => {
    if (!supabase || !profile?.id) { load(); return; }
    const cutoff = new Date(Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('max_shows').delete()
      .eq('user_id', profile.id)
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
      .then(() => load());
  }, [load, profile?.id]);

  const abrir = (id: string, mode: 'view' | 'edit') => { setOpenMode(mode); setOpenId(id); };

  // Upload de PDF — pega file, valida, sobe pro bucket, INSERT no banco.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const onPickPdf = () => fileInputRef.current?.click();
  const importar = async (file: File | undefined) => {
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
      setTab(meuPapel);
      load();
    } finally {
      setUploading(false);
    }
  };
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reescolher o mesmo arquivo depois
    importar(file);
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
    // A linha cai primeiro. Na ordem antiga o PDF saia do storage ANTES do
    // DELETE — e se a RLS recusasse a linha, o arquivo ja tinha sumido do
    // bucket e sobrava um registro apontando para o vazio. O bucket nao
    // cascateia do banco, entao a remocao continua manual.
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

  // Ver o material da turma e a premissa do modulo (migr. 253). MEXER nele
  // e outra coisa: CEO e conselheiro sao alunos, e apagar o trabalho de um
  // colega nao e papel de colega. A migr. 567 recorta a policy em
  // role='admin'; aqui o botao segue a mesma regua, para nao existir botao
  // que so serve para dar erro.
  const podeGerirDeOutros = profile?.role === 'admin';

  const nomeAutor = useCallback((s: Show) => autores[s.user_id] ?? s.user_id.slice(0, 8), [autores]);

  const ativos = useMemo(() => shows.filter(s => !s.deleted_at), [shows]);
  const lixeira = useMemo(() => shows.filter(s => s.deleted_at), [shows]);
  const papelDoShow = useCallback((s: Show): Papel =>
    s.user_id === profile?.id ? meuPapel : papelDe(papeis[s.user_id]), [papeis, profile?.id, meuPapel]);
  const daAba = useMemo(() => tab === 'lixeira' ? lixeira : ativos.filter(s => papelDoShow(s) === tab),
    [tab, ativos, lixeira, papelDoShow]);
  const termo = normalizar(busca.trim());
  const filtrados = useMemo(() => !termo ? daAba : daAba.filter(s =>
    normalizar(`${s.titulo ?? ''} ${s.arquivo_nome ?? ''} ${s.user_id !== profile?.id ? nomeAutor(s) : ''}`).includes(termo)
  ), [daAba, termo, profile?.id, nomeAutor]);
  const meus = filtrados.filter(s => s.user_id === profile?.id);
  const outros = filtrados.filter(s => s.user_id !== profile?.id);

  const meusAtivos = ativos.filter(s => s.user_id === profile?.id);
  // Soma o que a pessoa enxerga, não só o dela: com "Minhas apresentações" ao
  // lado, o card antigo (só o próprio) fazia o admin ler 74 KB com um PDF de
  // 6,7 MB do gerente na lista. Lixeira fora — ela tem contador próprio.
  const espacoUsado = ativos.reduce((t, s) => t + (s.arquivo_tamanho ?? 0), 0);
  const rotuloEspaco = abasVisiveis.length === 1 ? 'Espaço usado' : ehDocente ? 'Espaço da turma' : 'Espaço da equipe';

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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="p-3 sm:p-6 max-w-6xl mx-auto flex flex-col gap-5"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false); }}
      onDrop={e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setArrastando(false); importar(e.dataTransfer.files[0]); }}>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2 min-w-0">
          <Presentation size={26} className="shrink-0" /> Max Show
        </h2>
        <button onClick={onPickPdf} disabled={uploading}
          className="btn-ferramenta btn-solido btn-solido--laranja self-start sm:self-auto disabled:opacity-60">
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {uploading ? 'Enviando…' : 'Importar PDF'}
        </button>
        <input ref={fileInputRef} type="file" accept="application/pdf" onChange={onFileChosen} className="hidden" />
      </div>

      <div className={`grid gap-3 ${abasVisiveis.length > 1 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
        <CardContador label="Minhas apresentações" value={meusAtivos.length} tom="azul" />
        <CardContador label={rotuloEspaco} value={espacoUsado ? fmtBytes(espacoUsado) : '0'} tom="neutro" />
        {abasVisiveis.length > 1 && <CardContador label={ehDocente ? 'Da turma' : 'Da equipe'} value={ativos.length - meusAtivos.length} tom="roxo" />}
        <CardContador label="Na lixeira" value={lixeira.length} tom="vermelho" />
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3" role="tablist">
          {ABAS_AUTOR.filter(a => abasVisiveis.includes(a.key)).map(a => (
            <AbaComContador key={a.key} label={a.label} icon={a.icon} cor={a.cor}
              n={ativos.filter(s => papelDoShow(s) === a.key).length}
              ativa={tab === a.key} onClick={() => setTab(a.key)} />
          ))}
          <AbaComContador label="Lixeira" icon={Inbox} cor="vermelho" n={lixeira.length}
            ativa={tab === 'lixeira'} onClick={() => setTab('lixeira')} />
        </div>
        <div className="relative md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…"
            className="neu-input w-full py-2 pl-9 pr-3 rounded-xl text-sm" />
        </div>
      </div>

      {arrastando && (
        <div className="rounded-2xl border-2 border-dashed border-accent bg-accent/5 py-8 text-center text-sm font-bold text-accent">
          Solte o PDF para importar
        </div>
      )}

      {loading ? <LoadingSpinner /> : tab !== 'lixeira' ? (
        <>
          {tab === meuPapel && (
          <SecaoFormulario titulo="Minhas apresentações" icon={Presentation} cor="azul" extra={contagem(meus.length)}>
            {meus.length === 0 ? (
              termo ? <Vazio>Nada encontrado para “{busca}”.</Vazio> : (
                <button type="button" onClick={onPickPdf} disabled={uploading}
                  className="w-full rounded-xl border-2 border-dashed border-white/10 hover:border-accent/60 py-10 flex flex-col items-center gap-2 text-gray-400 hover:text-accent transition-colors">
                  <FileUp size={28} />
                  <span className="text-sm font-semibold">Você ainda não importou nenhum PDF</span>
                  <span className="text-[11px] text-gray-500">Clique aqui ou arraste o arquivo para a tela · até {MAX_PDF_BYTES / 1024 / 1024} MB</span>
                </button>
              )
            ) : (
              <TabelaAtivos shows={meus} onAbrir={abrir} onDelete={excluir} />
            )}
          </SecaoFormulario>
          )}
          {(tab !== meuPapel || outros.length > 0) && (
            <SecaoFormulario titulo={tituloOutros(tab, meuPapel, !!ehDocente)} icon={Users} cor="roxo" extra={contagem(outros.length)}>
              {outros.length === 0
                ? <Vazio>{termo ? `Nada encontrado para “${busca}”.` : 'Nenhuma apresentação por aqui ainda.'}</Vazio>
                : <TabelaAtivos shows={outros} autor={nomeAutor} onAbrir={abrir}
                    onDelete={podeGerirDeOutros ? excluir : undefined} />}
            </SecaoFormulario>
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] text-gray-500 -mt-1">
            Itens na lixeira são apagados permanentemente após {PURGE_DAYS} dias.
          </p>
          <SecaoFormulario titulo="Minhas excluídas" icon={Trash2} cor="vermelho" extra={contagem(meus.length)}>
            {meus.length === 0
              ? <Vazio>{termo ? `Nada encontrado para “${busca}”.` : 'Sua lixeira está vazia.'}</Vazio>
              : <TabelaLixeira shows={meus} onRestore={restaurar} onDeleteForever={excluirDefinitivo} />}
          </SecaoFormulario>
          {ehDocente && outros.length > 0 && (
            <SecaoFormulario titulo="Excluídas da turma · visão docente" icon={Users} cor="roxo" extra={contagem(outros.length)}>
              <TabelaLixeira shows={outros} autor={nomeAutor}
                onRestore={podeGerirDeOutros ? restaurar : undefined}
                onDeleteForever={podeGerirDeOutros ? excluirDefinitivo : undefined} />
            </SecaoFormulario>
          )}
        </>
      )}
    </motion.div>
  );
};

const ABAS_AUTOR: { key: Papel; label: string; cor: CorAba; icon: any }[] = [
  { key: 'admin',       label: 'Admin Master', cor: 'amareloEscuro',  icon: ShieldCheck },
  { key: 'gerente',     label: 'Gerente',      cor: 'verdeEscuro', icon: Users },
  { key: 'colaborador', label: 'Colaborador',  cor: 'azul',           icon: User },
];

// Na aba do próprio papel a seção de baixo é "os outros do mesmo papel"; nas
// demais, é a aba inteira. O gerente só enxerga colaboradores da unidade dele.
const tituloOutros = (tab: Papel, meu: Papel, docente: boolean): string => {
  if (tab === 'admin') return 'Do Admin Master';
  if (tab === 'gerente') return tab === meu ? 'Outros gerentes' : 'Dos gerentes';
  if (!docente && meu === 'gerente') return 'Colaboradores da unidade';
  return tab === meu ? 'Outros colaboradores' : 'Dos colaboradores';
};

const contagem = (n: number) => `${n} apresentaç${n === 1 ? 'ão' : 'ões'}`;

const Vazio = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-gray-500 text-center py-6">{children}</p>
);

const CelulaTitulo = ({ s, riscado, onAbrir }: { s: Show; riscado?: boolean; onAbrir?: () => void }) => {
  const conteudo = (
    <span className="flex items-center gap-3 min-w-[11rem]">
      <span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${riscado ? 'bg-white/5 text-gray-500' : 'bg-red-600 text-white'}`}>
        <FileText size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold leading-snug truncate ${riscado ? 'text-gray-400 line-through' : 'text-gray-100 group-hover/titulo:text-accent'}`}
          title={s.titulo || 'Sem título'}>
          {s.titulo || 'Sem título'}
        </span>
        {s.arquivo_nome && s.arquivo_nome.replace(/\.pdf$/i, '') !== s.titulo && <span className="block text-[10px] text-gray-500 truncate">{s.arquivo_nome}</span>}
      </span>
    </span>
  );
  return (
    // w-full + max-w-0: o título truncado ocupa o que sobra em vez de empurrar
    // Ações para fora da tela; o min-w do miolo segura um mínimo legível.
    <td className="py-2.5 px-3 w-full max-w-0">
      {onAbrir ? (
        <button type="button" onClick={onAbrir} title="Abrir o PDF" className="w-full text-left group/titulo">
          {conteudo}
        </button>
      ) : conteudo}
    </td>
  );
};

const TabelaAtivos = ({ shows, autor, onAbrir, onDelete }: {
  shows: Show[];
  /** Presente = coluna de autor (visão docente). */
  autor?: (s: Show) => string;
  onAbrir: (id: string, mode: 'view' | 'edit') => void;
  /** Ausente = só leitura (docente sem permissão de mexer no de outro). */
  onDelete?: (id: string) => void;
}) => (
  <div className="overflow-x-auto main-scrollbar">
    <table className="tabela w-full text-left border-collapse">
      <thead>
        <tr className={CABECALHO_TABELA}>
          <th className="text-center">Apresentação</th>
          {autor && <th className="text-center w-48">Autor</th>}
          <th className="text-center w-24 hidden lg:table-cell">Tamanho</th>
          <th className="text-center w-36">Enviado em</th>
          <th className="text-center w-px">Ações</th>
        </tr>
      </thead>
      <tbody>
        {shows.map(s => (
          <tr key={s.id} className="border-b border-accent/10 align-middle hover:bg-accent/[0.04] transition-colors">
            <CelulaTitulo s={s} onAbrir={() => onAbrir(s.id, 'view')} />
            {autor && <td className="py-2.5 px-3 text-center text-xs text-gray-300">{autor(s)}</td>}
            <td className="py-2.5 px-3 text-center text-xs text-gray-400 font-mono tabular-nums whitespace-nowrap hidden lg:table-cell">{fmtBytes(s.arquivo_tamanho)}</td>
            <td className="py-2.5 px-3 text-center text-xs text-gray-400 font-mono tabular-nums whitespace-nowrap">{fmt(s.updated_at)}</td>
            <td className="py-2.5 px-3">
              <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                <button onClick={() => onAbrir(s.id, 'view')} title="Abrir o PDF" aria-label="Abrir o PDF" className="action-btn-vermelho">
                  <Eye size={14} />
                </button>
                {onDelete && (
                  <MenuMais>
                    {fechar => (
                      <ItemMenu onClick={() => { fechar(); onDelete(s.id); }}
                        cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                        Mover para a lixeira
                      </ItemMenu>
                    )}
                  </MenuMais>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TabelaLixeira = ({ shows, autor, onRestore, onDeleteForever }: {
  shows: Show[];
  autor?: (s: Show) => string;
  /** Ausentes = só leitura. Ver `podeGerirDeOutros`. */
  onRestore?: (id: string) => void;
  onDeleteForever?: (id: string) => void;
}) => (
  <div className="overflow-x-auto main-scrollbar">
    <table className="tabela w-full text-left border-collapse">
      <thead>
        <tr className={CABECALHO_TABELA}>
          <th className="text-center">Apresentação</th>
          {autor && <th className="text-center w-48">Autor</th>}
          <th className="text-center w-36">Excluída em</th>
          <th className="text-center w-24">Some em</th>
          <th className="text-center w-px">Ações</th>
        </tr>
      </thead>
      <tbody>
        {shows.map(s => {
          const dias = s.deleted_at ? diasAtras(s.deleted_at) : 0;
          const restam = Math.max(0, PURGE_DAYS - dias);
          const cor: CorAba = restam <= 3 ? 'vermelho' : restam <= 10 ? 'laranja' : 'cinza';
          return (
            <tr key={s.id} className="border-b border-accent/10 align-middle">
              <CelulaTitulo s={s} riscado />
              {autor && <td className="py-2.5 px-3 text-center text-xs text-gray-300">{autor(s)}</td>}
              <td className="py-2.5 px-3 text-center text-xs text-gray-400 font-mono tabular-nums whitespace-nowrap">
                {s.deleted_at ? fmt(s.deleted_at) : '—'}
              </td>
              <td className="py-2.5 px-3 text-center whitespace-nowrap">
                <span className={`btn-solido ${COR_ABA[cor].botao} !py-1 !px-2.5 !text-[10px] pointer-events-none`}>
                  {restam} dia{restam !== 1 ? 's' : ''}
                </span>
              </td>
              <td className="py-2.5 px-3">
                <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                  {onRestore && (
                    <button onClick={() => onRestore(s.id)} title="Restaurar" aria-label="Restaurar" className="action-btn-verde">
                      <RotateCcw size={14} />
                    </button>
                  )}
                  {onDeleteForever && (
                    <MenuMais>
                      {fechar => (
                        <ItemMenu onClick={() => { fechar(); onDeleteForever(s.id); }}
                          cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                          Excluir permanentemente
                        </ItemMenu>
                      )}
                    </MenuMais>
                  )}
                  {!onRestore && !onDeleteForever && <span className="text-xs text-gray-600">—</span>}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
