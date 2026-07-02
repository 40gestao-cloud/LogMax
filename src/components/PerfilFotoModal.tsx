import { useRef, useState, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Upload, Trash2, Loader2 } from 'lucide-react';
import { NeuButtonAccent } from './ui';
import { supabase } from '../lib/supabase';
import {
  PERFIL_FOTO_ACCEPT,
  PERFIL_FOTO_MAX_LABEL,
  uploadFotoPerfil,
  validarFotoPerfil,
  removerFotoPerfilAntiga,
} from '../lib/perfilFoto';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';

type Props = {
  open: boolean;
  profile: UserProfile;
  onClose: () => void;
  onUpdated: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
};

export function PerfilFotoModal({ open, profile, onClose, onUpdated, showToast }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  const confirm = useConfirm();
  const fotoAtual = profile.foto_url;

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const v = validarFotoPerfil(f);
    if (!v.ok) {
      showToast(v.motivo, 'error');
      e.target.value = '';
      return;
    }
    setArquivo(f);
    setPreview(URL.createObjectURL(f));
  };

  const limparEscolha = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setArquivo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fechar = () => {
    limparEscolha();
    onClose();
  };

  const salvar = async () => {
    if (!arquivo || !supabase) return;
    setSalvando(true);
    try {
      const novaUrl = await uploadFotoPerfil(arquivo, profile.id);
      const { error: updErr } = await supabase
        .from('user_profiles')
        .update({ foto_url: novaUrl })
        .eq('id', profile.id);
      if (updErr) throw updErr;
      // Remove foto anterior (best-effort, sem bloquear UI).
      removerFotoPerfilAntiga(fotoAtual).catch(() => {});
      showToast('Foto de perfil atualizada.', 'success');
      onUpdated();
      fechar();
    } catch (err: any) {
      console.error('[PerfilFoto] erro:', err);
      showToast(`Erro ao atualizar foto: ${err?.message ?? err}`, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (!fotoAtual || !supabase) return;
    if (!await confirm('Remover sua foto de perfil?')) return;
    setSalvando(true);
    try {
      const { error: updErr } = await supabase
        .from('user_profiles')
        .update({ foto_url: null })
        .eq('id', profile.id);
      if (updErr) throw updErr;
      removerFotoPerfilAntiga(fotoAtual).catch(() => {});
      showToast('Foto removida.', 'success');
      onUpdated();
      fechar();
    } catch (err: any) {
      console.error('[PerfilFoto] erro:', err);
      showToast(`Erro ao remover foto: ${err?.message ?? err}`, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const imgVisivel = preview ?? fotoAtual;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={fechar}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/10 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-accent">Foto de perfil</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">{profile.nome}</p>
              </div>
              <button onClick={fechar} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>

            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-32 h-32 rounded-full neu-pressed border-2 border-accent/30 overflow-hidden flex items-center justify-center"
                style={{ background: 'var(--color-avatar-bg)' }}>
                {imgVisivel ? (
                  <img src={imgVisivel} alt="Foto de perfil" className="w-full h-full object-cover" />
                ) : (
                  <User size={48} className="text-accent/60" />
                )}
              </div>

              <p className="text-[10px] text-gray-500 text-center leading-relaxed px-4">
                JPG, PNG ou WEBP — máximo {PERFIL_FOTO_MAX_LABEL}.<br />
                Comprima imagens grandes antes de enviar.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept={PERFIL_FOTO_ACCEPT}
                onChange={onFileChange}
                className="hidden"
              />
            </div>

            <div className="flex flex-col gap-3 mt-2">
              {arquivo ? (
                <>
                  <NeuButtonAccent variant="yellow" onClick={salvar} isLoading={salvando}>
                    {salvando ? null : <Upload size={14} />}
                    Salvar nova foto
                  </NeuButtonAccent>
                  <button
                    type="button"
                    onClick={limparEscolha}
                    disabled={salvando}
                    className="text-[11px] text-gray-400 hover:text-accent uppercase tracking-wider font-bold py-2 disabled:opacity-50"
                  >
                    Trocar arquivo
                  </button>
                </>
              ) : (
                <>
                  <NeuButtonAccent variant="" onClick={onPickFile} disabled={salvando}>
                    <Upload size={14} />
                    Escolher imagem
                  </NeuButtonAccent>
                  {fotoAtual && (
                    <button
                      type="button"
                      onClick={remover}
                      disabled={salvando}
                      className="flex items-center justify-center gap-2 text-[11px] text-red-500 hover:text-red-400 uppercase tracking-wider font-bold py-2 disabled:opacity-50"
                    >
                      {salvando ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Remover foto atual
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
