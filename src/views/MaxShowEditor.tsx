import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, Minimize2, Presentation, FileText, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';

// =================================================================
// Max Show — viewer/apresentador de PDF importado
// =================================================================
// LogMax não edita slides. O aluno monta a apresentação em qualquer
// ferramenta (PowerPoint/Canva/Slides), exporta como PDF, importa no
// Max Show e apresenta aqui em fullscreen com o viewer nativo do
// browser (setas / next / prev / zoom vêm de graça).
// =================================================================

type Props = {
  showId: string;
  mode?: 'view' | 'edit';
  onClose: () => void;
  showToast?: (msg: string, type?: string) => void;
  profile?: any;
};

export const MaxShowEditor = ({ showId, onClose, showToast }: Props) => {
  const [titulo, setTitulo] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfNome, setPdfNome] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      if (!supabase) return;
      const { data, error } = await supabase.from('max_shows')
        .select('titulo,arquivo_url,arquivo_nome').eq('id', showId).maybeSingle();
      if (error || !data || !data.arquivo_url) {
        showToast?.('Não foi possível abrir a apresentação.', 'error');
        onClose();
        return;
      }
      if (disposed) return;
      setTitulo(data.titulo || '');
      setPdfUrl(data.arquivo_url);
      setPdfNome(data.arquivo_nome ?? null);
      setReady(true);
    })();
    return () => { disposed = true; };
  }, [showId, onClose, showToast]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.().catch(() => showToast?.('Tela cheia não disponível.', 'error'));
  };

  return (
    <div ref={rootRef} className="max-doc-scope max-doc-light flex flex-col h-full">
      <div className="md-header flex items-center gap-2 px-4 py-3 shrink-0">
        <button onClick={onClose} className="md-headerbtn p-2 rounded-lg" title="Voltar">
          <ArrowLeft size={16} />
        </button>
        <Presentation size={16} className="opacity-70" />
        <div className="flex-1 text-lg font-bold px-2 truncate flex items-center gap-2 min-w-0">
          <span className="truncate">{titulo || pdfNome || 'Apresentação'}</span>
          <span className="text-xs font-normal opacity-70 shrink-0 hidden sm:inline">PDF importado</span>
        </div>
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1" title="Abrir em nova aba">
            <ExternalLink size={13} /> <span className="hidden sm:inline">Nova aba</span>
          </a>
        )}
        <button onClick={toggleFullscreen} className="md-headerbtn px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1" title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Apresentar (tela cheia)'}>
          {isFullscreen ? <Minimize2 size={13} /> : <Play size={13} />} {isFullscreen ? 'Sair' : 'Apresentar'}
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-black">
        {ready && pdfUrl ? (
          <iframe src={`${pdfUrl}#toolbar=1&view=FitH`} title={titulo || 'PDF'} className="w-full h-full border-0" />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            <FileText size={20} className="mr-2" /> Carregando…
          </div>
        )}
      </div>
    </div>
  );
};
