// Documentos — mão única da Matriz para as unidades (migr. 476).
//
// O professor (role='admin') publica um arquivo PDF ou Word; todo mundo baixa.
// Aluno não sobe nada, e isso não depende desta tela: a RLS e as policies do
// bucket recusam INSERT de quem não é admin. O que muda aqui é só o que
// aparece — esconder botão que o banco já barra evita erro de permissão na
// cara do aluno, não é a trava.
//
// Um arquivo por documento, no formato que o professor escolher. Não há
// conversão de docx para PDF nem o contrário: prometer isso seria mentir, e o
// aluno aprenderia errado o que é "o documento oficial".

import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Upload, Download, Trash2, X, Building2, Loader2, Check, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDataHoraBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FilialBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { useDocumentos, urlAssinadaDocumento, type Documento } from '../hooks/useDocumentos';
import type { UserProfile } from '../hooks/useUserProfile';

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

const MIMES_ACEITOS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];
const TETO_BYTES = 10 * 1024 * 1024;

function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf('.');
  return i > 0 ? nome.slice(i + 1).toUpperCase() : 'ARQUIVO';
}

function tamanhoLegivel(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Nome de arquivo dentro do bucket: sem acento, sem espaço, com carimbo de
// tempo. O nome bonito que o aluno vê no download vem de `arquivo_nome`.
function pathSeguro(nome: string): string {
  // O `[^a-zA-Z0-9._-]` sozinho já derruba acento, espaço e cedilha — o NFD
  // antes dele preserva a letra base ("relatório" vira "relatorio", não
  // "relat-rio"), que é o que faz o caminho continuar legível no bucket.
  const limpo = nome
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
  return `${Date.now()}-${limpo}`;
}

// ── Modal: publicar ────────────────────────────────────────────────────────
function ModalPublicar({
  profile, onClose, onSaved, showToast,
}: {
  profile: UserProfile | null; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [filialAlvo, setFilialAlvo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const escolher = (f: File | null) => {
    if (!f) { setArquivo(null); return; }
    if (!MIMES_ACEITOS.includes(f.type)) {
      showToast('Formato não aceito. Envie PDF ou Word (.docx / .doc).', 'error');
      return;
    }
    if (f.size > TETO_BYTES) {
      showToast(`Arquivo de ${tamanhoLegivel(f.size)} — o teto é 10 MB.`, 'error');
      return;
    }
    setArquivo(f);
    if (!titulo.trim()) setTitulo(f.name.replace(/\.[^.]+$/, ''));
  };

  const publicar = async () => {
    if (!supabase) return;
    if (!titulo.trim()) { showToast('Dê um título ao documento.', 'error'); return; }
    if (!arquivo) { showToast('Escolha o arquivo.', 'error'); return; }

    setSalvando(true);
    const path = pathSeguro(arquivo.name);
    try {
      const { error: upErro } = await supabase.storage
        .from('documentos')
        .upload(path, arquivo, { contentType: arquivo.type, upsert: false });
      if (upErro) throw upErro;

      const { error } = await supabase.from('documentos').insert({
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        arquivo_path: path,
        arquivo_nome: arquivo.name,
        arquivo_mime: arquivo.type,
        arquivo_tamanho: arquivo.size,
        filial_alvo: filialAlvo || null,
        publicado_por: profile?.id ?? null,
        publicado_por_nome: profile?.nome ?? null,
      });
      // Linha recusada com arquivo já no bucket deixaria lixo que ninguém
      // alcança (a policy de leitura resolve pela linha). Limpa antes de sair.
      if (error) {
        await supabase.storage.from('documentos').remove([path]);
        throw error;
      }

      showToast('Documento publicado.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao publicar.', 'error');
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-100">Publicar Documento</h2>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Título *</label>
          <input
            type="text" value={titulo} onChange={e => setTitulo(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            placeholder="Ex.: Regulamento interno 2026"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Descrição</label>
          <textarea
            value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="O que é e o que a equipe deve fazer com ele."
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Quem recebe</label>
          <select
            value={filialAlvo} onChange={e => setFilialAlvo(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
          >
            <option value="">Todas as unidades</option>
            {FILIAIS.map(f => <option key={f} value={f}>Somente {f}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Arquivo * (PDF ou Word, até 10 MB)</label>
          <input
            ref={inputRef} type="file" className="hidden"
            accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            onChange={e => escolher(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="neu-pressed rounded-xl px-3 py-3 text-sm text-gray-300 flex items-center gap-2 hover:text-gray-100"
          >
            <Upload size={14} className="text-accent shrink-0" />
            <span className="truncate">
              {arquivo ? `${arquivo.name} · ${tamanhoLegivel(arquivo.size)}` : 'Escolher arquivo…'}
            </span>
          </button>
        </div>

        <NeuButtonAccent onClick={publicar} isLoading={salvando}>Publicar</NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── View ───────────────────────────────────────────────────────────────────
export const DocumentosView = ({ showToast, profile }: { showToast: any; profile: UserProfile | null }) => {
  const { documentos, naoLidos, loading, marcarLido, recarregar } = useDocumentos(profile);
  const [modal, setModal] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const confirm = useConfirm();

  // Publicar é ato do professor. CEO e conselheiro são alunos — o banco já
  // recusa, aqui só não se oferece o botão (vide comentário no topo).
  const podePublicar = profile?.role === 'admin';
  const idsNaoLidos = useMemo(() => new Set(naoLidos.map(d => d.id)), [naoLidos]);

  const baixar = async (doc: Documento) => {
    setBaixando(doc.id);
    const { url, error } = await urlAssinadaDocumento(doc.arquivo_path);
    setBaixando(null);
    if (error || !url) { showToast(error ?? 'Não foi possível abrir o arquivo.', 'error'); return; }
    window.open(url, '_blank', 'noopener');
    if (idsNaoLidos.has(doc.id)) marcarLido(doc.id);
  };

  const excluir = async (doc: Documento) => {
    const ok = await confirm({
      message: `Excluir "${doc.titulo}"? O arquivo sai do sistema e ninguém mais consegue baixar.`,
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('documentos').delete().eq('id', doc.id);
    if (error) { showToast(error.message, 'error'); return; }
    await supabase.storage.from('documentos').remove([doc.arquivo_path]);
    showToast('Documento excluído.', 'success');
    recarregar();
  };

  if (loading) return <LoadingSpinner />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 pb-16"
    >
      <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText size={14} className="text-accent" />
            <h1 className="text-sm font-black uppercase tracking-widest text-gray-100">Documentos</h1>
          </div>
          <p className="text-xs text-gray-500">
            {podePublicar
              ? 'Publicado aqui, chega em todas as unidades — e o sistema registra quem leu.'
              : 'Documentos enviados pela Matriz. Baixe e confirme a leitura.'}
          </p>
        </div>
        {podePublicar && (
          <button
            onClick={() => setModal(true)}
            className="neu-button rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest text-accent flex items-center gap-2"
          >
            <Upload size={14} /> Publicar
          </button>
        )}
      </div>

      {!podePublicar && naoLidos.length > 0 && (
        <div className="neu-flat rounded-2xl p-4 border border-amber-400/25 flex items-start gap-2 text-xs text-amber-200">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            {naoLidos.length === 1
              ? 'Há 1 documento novo que você ainda não confirmou.'
              : `Há ${naoLidos.length} documentos novos que você ainda não confirmou.`}
          </span>
        </div>
      )}

      {documentos.length === 0 ? (
        <EmptyState message="Nenhum documento publicado ainda." />
      ) : (
        <div className="flex flex-col gap-2">
          {documentos.map(doc => {
            const novo = idsNaoLidos.has(doc.id);
            return (
              <div
                key={doc.id}
                className={`neu-flat rounded-2xl p-4 border flex items-start gap-3 ${novo ? 'border-amber-400/30' : 'border-white/5'}`}
              >
                <div className="w-11 h-11 rounded-2xl neu-pressed flex flex-col items-center justify-center shrink-0">
                  <FileText size={15} className="text-accent" />
                  <span className="text-[8px] font-black text-gray-500 mt-0.5">{extensaoDe(doc.arquivo_nome)}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-gray-100 truncate">{doc.titulo}</h3>
                    {novo && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                        Novo
                      </span>
                    )}
                    {doc.filial_alvo ? <FilialBadge filial={doc.filial_alvo} /> : (
                      <span className="text-[10px] text-gray-500 flex items-center gap-1">
                        <Building2 size={10} /> Todas as unidades
                      </span>
                    )}
                  </div>
                  {doc.descricao && (
                    <p className="text-[11px] text-gray-400 mt-1 whitespace-pre-wrap">{doc.descricao}</p>
                  )}
                  <div className="text-[10px] text-gray-500 mt-1">
                    {formatDataHoraBR(doc.created_at)}
                    {doc.publicado_por_nome && ` · ${doc.publicado_por_nome}`}
                    {doc.arquivo_tamanho ? ` · ${tamanhoLegivel(doc.arquivo_tamanho)}` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => baixar(doc)}
                    disabled={baixando === doc.id}
                    title={`Baixar ${extensaoDe(doc.arquivo_nome)}`}
                    className="neu-button rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {baixando === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    Baixar
                  </button>
                  {novo && (
                    <button
                      onClick={() => marcarLido(doc.id)}
                      title="Confirmar leitura"
                      className="neu-button rounded-xl p-2 text-emerald-300"
                    >
                      <Check size={13} />
                    </button>
                  )}
                  {podePublicar && (
                    <button onClick={() => excluir(doc)} className="action-btn-delete">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modal && (
          <ModalPublicar
            profile={profile}
            onClose={() => setModal(false)}
            onSaved={recarregar}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
