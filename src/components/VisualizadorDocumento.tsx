// Ver o documento sem baixar (migr. 476 — a tela é a de Documentos).
//
// Até aqui o único jeito de ler o que a Matriz publicou era salvar o arquivo e
// abrir fora do sistema. Para um comunicado de meia página isso é uma volta
// grande: o aluno sai do ERP, procura a pasta de downloads, e a pasta acumula
// sete cópias do mesmo PDF ao longo da semana.
//
// O que abre aqui é o que o navegador desenha sozinho — PDF e imagem. Word
// continua sendo download, e de propósito: renderizar .docx pediria conversão
// no servidor ou um visualizador de terceiros, e o documento da Matriz não sai
// do bucket privado. Prometer "ver" e entregar uma página quebrada ensinaria o
// aluno a desconfiar do botão; o botão só aparece quando funciona.
//
// A URL é assinada na abertura e vive 5 minutos (vide `urlDeVisualizacao`).
// Ela não é guardada em lugar nenhum: fechar e reabrir assina de novo.

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Download, ExternalLink, Loader2, FileWarning } from 'lucide-react';
import { urlDeVisualizacao, baixarDocumento, type Documento } from '../hooks/useDocumentos';

const EH_IMAGEM = (doc: Documento) =>
  String(doc.arquivo_mime ?? '').startsWith('image/') ||
  /\.(png|jpe?g|webp|gif)$/i.test(doc.arquivo_nome);

export function VisualizadorDocumento({ doc, onClose, showToast, onSumiu }: {
  doc: Documento;
  onClose: () => void;
  showToast?: (msg: string, t?: string) => void;
  /** O arquivo não está mais no bucket: quem abriu precisa reler a lista. */
  onSumiu?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { url: u, error, sumiu } = await urlDeVisualizacao(doc);
      if (!vivo) return;
      if (error) { setErro(error); if (sumiu) onSumiu?.(); return; }
      setUrl(u!);
    })();
    // Componente montado por documento (`key` no chamador), então a assinatura
    // é pedida uma vez. `vivo` cobre o fechamento antes da resposta chegar.
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // O visor abre POR CIMA do modal "Novo Documento Disponível", que também
      // escuta Escape na window. Sem parar a propagação aqui, um toque no
      // Escape fecharia os dois de uma vez e a pessoa perderia a fila de
      // leitura por ter fechado o arquivo.
      e.stopPropagation();
      onClose();
    };
    // Captura: o listener do modal de baixo está na fase de bolha, então este
    // roda primeiro e o `stopPropagation` chega a tempo.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const baixar = async () => {
    setBaixando(true);
    const { error, sumiu } = await baixarDocumento(doc);
    setBaixando(false);
    if (error) { showToast?.(error, 'error'); if (sumiu) { onSumiu?.(); onClose(); } }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}
        className="neu-flat rounded-3xl border border-accent/20 w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-white/5 shrink-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-gray-100 truncate">{doc.titulo}</h3>
            <p className="text-[10px] text-gray-500 truncate">{doc.arquivo_nome}</p>
          </div>
          {/* "Abrir em nova aba" é a saída do celular: no iOS o PDF dentro de
              iframe mostra só a primeira página, e o visor nativo do sistema
              resolve. A URL já está em mãos, então o window.open acontece
              dentro do gesto e não apanha do bloqueador de pop-up. */}
          {url && (
            <button
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              title="Abrir em nova aba"
              className="neu-button rounded-xl p-2 text-gray-400 hover:text-accent shrink-0"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={baixar}
            disabled={baixando}
            title="Baixar"
            className="neu-button rounded-xl p-2 text-accent disabled:opacity-50 shrink-0"
          >
            {baixando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
          <button onClick={onClose} aria-label="Fechar" className="neu-button rounded-xl p-2 text-gray-400 hover:text-gray-200 shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-black/20">
          {erro ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
              <FileWarning size={28} className="text-amber-300" />
              <p className="text-sm text-gray-300 max-w-sm">{erro}</p>
            </div>
          ) : !url ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={22} className="animate-spin text-accent" />
            </div>
          ) : EH_IMAGEM(doc) ? (
            // `overflow-auto` + `min-w-full`: cartaz em pé maior que a tela rola
            // dentro do visor em vez de encolher até virar tarja ilegível.
            <div className="h-full overflow-auto flex items-center justify-center p-4">
              <img src={url} alt={doc.titulo} className="max-w-full object-contain" />
            </div>
          ) : (
            <iframe src={url} title={doc.titulo} className="w-full h-full border-0" />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
