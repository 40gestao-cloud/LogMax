import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Plus, X, Upload, Loader2, ChevronDown, ChevronUp,
  Image as ImageIcon, FileIcon, Clock, CheckCircle2, XCircle, Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFilial } from '../contexts/FilialContext';

// ── Tipos ──────────────────────────────────────────────────────────────────
type StatusReq = 'Pendente' | 'Em Análise' | 'Aprovado' | 'Negado';

type Requerimento = {
  id: string;
  titulo: string;
  descricao: string | null;
  arquivo_url: string | null;
  arquivo_tipo: 'imagem' | 'pdf' | null;
  status: StatusReq;
  criado_por: string | null;
  criado_por_nome: string | null;
  filial: string | null;
  resposta: string | null;
  respondido_por_nome: string | null;
  respondido_em: string | null;
  created_at: string;
};

// ── Constantes ─────────────────────────────────────────────────────────────
const BUCKET = 'requerimentos-arquivos';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,application/pdf';

const STATUS_CFG: Record<StatusReq, { label: string; color: string; icon: any }> = {
  'Pendente':    { label: 'Pendente',    color: 'text-gray-400 bg-gray-500/15 border-gray-500/30',     icon: Clock },
  'Em Análise':  { label: 'Em Análise',  color: 'text-blue-300 bg-blue-500/15 border-blue-500/30',     icon: FileText },
  'Aprovado':    { label: 'Aprovado',    color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 },
  'Negado':      { label: 'Negado',      color: 'text-red-300 bg-red-500/15 border-red-500/30',         icon: XCircle },
};

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });

async function uploadArquivo(file: File): Promise<{ url: string; tipo: 'imagem' | 'pdf' }> {
  if (!supabase) throw new Error('Supabase não configurado.');
  if (file.size > MAX_BYTES) throw new Error('Arquivo muito grande (máx 5 MB).');
  const isPdf = file.type === 'application/pdf';
  const ext = isPdf ? 'pdf' : (file.name.split('.').pop()?.toLowerCase() ?? 'jpg');
  const path = `${crypto.randomUUID()}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`Falha ao enviar arquivo: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('URL pública não gerada.');
  return { url: data.publicUrl, tipo: isPdf ? 'pdf' : 'imagem' };
}

// ── Badge de status ────────────────────────────────────────────────────────
function StatusBadgeReq({ status }: { status: StatusReq }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

// ── Prévia do arquivo ──────────────────────────────────────────────────────
function ArquivoPreview({ url, tipo }: { url: string; tipo: 'imagem' | 'pdf' }) {
  if (tipo === 'imagem') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-2">
        <img src={url} alt="anexo" className="max-h-48 rounded-xl object-cover border border-white/10 hover:opacity-90 transition-opacity" />
      </a>
    );
  }
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl neu-pressed text-xs text-accent hover:text-accent/80 transition-colors w-fit"
    >
      <FileIcon size={14} /> Abrir PDF
    </a>
  );
}

// ── Modal de criação ───────────────────────────────────────────────────────
function ModalNovoRequerimento({
  profile, onClose, onSaved, showToast,
}: {
  profile: UserProfile | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  // Filial ativa no topbar dita o "de onde" do requerimento — admin/CEO
  // trabalhando em SuperMax registra na SuperMax, não na Matriz do perfil.
  const { filialAtiva } = useFilial();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [arquivo, setArquivo] = useState<{ url: string; tipo: 'imagem' | 'pdf' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadArquivo(file);
      setArquivo(result);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSalvar = async () => {
    if (!supabase) return;
    if (!titulo.trim()) { showToast('Informe o título.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('requerimentos').insert({
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        arquivo_url: arquivo?.url ?? null,
        arquivo_tipo: arquivo?.tipo ?? null,
        criado_por: profile?.id ?? null,
        criado_por_nome: profile?.nome ?? null,
        filial: filialAtiva ?? profile?.filial ?? null,
      });
      if (error) throw error;
      showToast('Requerimento enviado.', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto main-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">Novo Requerimento</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Título *</label>
          <input
            value={titulo} onChange={e => setTitulo(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none"
            placeholder="Ex.: Solicitação de equipamento"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Descrição</label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)}
            rows={4}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Descreva o requerimento em detalhes..."
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Anexo (imagem ou PDF, máx 5 MB)</label>
          {arquivo ? (
            <div className="relative">
              <ArquivoPreview url={arquivo.url} tipo={arquivo.tipo} />
              <button
                onClick={() => setArquivo(null)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-red-500/80 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <label className="neu-pressed rounded-xl flex items-center justify-center gap-2 h-20 cursor-pointer text-gray-500 hover:text-gray-300 transition-colors border border-dashed border-gray-600">
              {uploading
                ? <Loader2 size={16} className="animate-spin" />
                : <><Upload size={15} /><span className="text-xs">Carregar imagem ou PDF</span></>}
              <input type="file" accept={ACCEPT} className="hidden" onChange={handleArquivo} disabled={uploading} />
            </label>
          )}
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>
          Enviar Requerimento
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Card de requerimento ───────────────────────────────────────────────────
function RequerimentoCard({ r, podeExcluir, onExcluir }: {
  r: Requerimento;
  podeExcluir: boolean;
  onExcluir: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadgeReq status={r.status} />
            {r.arquivo_tipo === 'imagem' && <ImageIcon size={12} className="text-gray-500" />}
            {r.arquivo_tipo === 'pdf' && <FileIcon size={12} className="text-gray-500" />}
          </div>
          <p className="text-sm font-semibold text-gray-100 mt-1 truncate">{r.titulo}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{fmtDateTime(r.created_at)}</p>
        </div>
        {aberto ? <ChevronUp size={14} className="text-gray-500 shrink-0" /> : <ChevronDown size={14} className="text-gray-500 shrink-0" />}
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/5 pt-3">
              {r.descricao && <p className="text-sm text-gray-300 whitespace-pre-wrap">{r.descricao}</p>}
              {r.arquivo_url && r.arquivo_tipo && (
                <ArquivoPreview url={r.arquivo_url} tipo={r.arquivo_tipo} />
              )}
              {r.resposta && (
                <div className="neu-pressed rounded-xl p-3 border border-accent/10">
                  <span className="text-[10px] font-black uppercase tracking-widest text-accent">Resposta da Matriz</span>
                  <p className="text-sm text-gray-200 mt-1">{r.resposta}</p>
                  {r.respondido_por_nome && (
                    <p className="text-[10px] text-gray-500 mt-1">
                      {r.respondido_por_nome} · {r.respondido_em ? fmtDateTime(r.respondido_em) : ''}
                    </p>
                  )}
                </div>
              )}
              {podeExcluir && (
                <button
                  onClick={() => onExcluir(r.id)}
                  className="self-start flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  <XCircle size={12} /> Excluir
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── View da filial ─────────────────────────────────────────────────────────
export function RequerimentosView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const [modalAberto, setModalAberto] = useState(false);
  const [search, setSearch] = useState('');
  const confirm = useConfirm();

  const isGerente = profile?.role === 'gerente' || profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

  const { data: requerimentos = [], isLoading, reload } = useFetchData<Requerimento>('requerimentos');

  // Gerente vê todos da filial (RLS já filtra); colaborador vê só os próprios
  const visiveis = useMemo(() => {
    let list = requerimentos;
    if (!isGerente) list = list.filter(r => r.criado_por === profile?.id);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(r => r.titulo.toLowerCase().includes(s) || (r.descricao ?? '').toLowerCase().includes(s));
    }
    return list;
  }, [requerimentos, isGerente, profile?.id, search]);

  const handleExcluir = async (id: string) => {
    const ok = await confirm({ message: 'Excluir este requerimento? Esta ação não pode ser desfeita.', danger: true });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('requerimentos').delete().eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Requerimento excluído.', 'success');
    reload();
  };

  const pendentes = visiveis.filter(r => r.status === 'Pendente' || r.status === 'Em Análise');
  const finalizados = visiveis.filter(r => r.status === 'Aprovado' || r.status === 'Negado');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5 h-full overflow-y-auto main-scrollbar pb-6"
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requerimentos</h2>
          <p className="text-sm text-gray-400 mt-1">
            {isGerente ? 'Requerimentos da filial' : 'Seus requerimentos enviados à Matriz'}
          </p>
        </div>
        <button
          onClick={() => setModalAberto(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors text-sm font-bold"
        >
          <Plus size={15} /> Novo
        </button>
      </div>

      {/* Busca */}
      <div className="relative shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar requerimento..."
          className="neu-input w-full pl-9 pr-3 py-2 rounded-xl text-sm"
        />
      </div>

      {isLoading ? <LoadingSpinner /> : visiveis.length === 0 ? (
        <EmptyState message="Nenhum requerimento encontrado." />
      ) : (
        <div className="flex flex-col gap-5">
          {pendentes.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Em aberto ({pendentes.length})</span>
              {pendentes.map(r => (
                <RequerimentoCard key={r.id} r={r}
                  podeExcluir={profile?.role === 'admin' || profile?.role === 'ceo'}
                  onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}
          {finalizados.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Finalizados ({finalizados.length})</span>
              {finalizados.map(r => (
                <RequerimentoCard key={r.id} r={r}
                  podeExcluir={profile?.role === 'admin' || profile?.role === 'ceo'}
                  onExcluir={handleExcluir}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {modalAberto && (
          <ModalNovoRequerimento
            profile={profile}
            onClose={() => setModalAberto(false)}
            onSaved={reload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
