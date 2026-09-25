import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Barcode, FileDown, X as XIcon } from 'lucide-react';
import { NeuButtonAccent } from '../ui';
import { normalizeEan13, drawEan13ToCanvas } from '../../lib/barcode';
import { rotuloVariante } from '../../lib/atributosProduto';
import { parseNum, fmtBRL } from './produtoFormComum';

// Pré-visualização da etiqueta EAN-13 (adesivo 80×50 mm).
//
// O botão da linha baixava o PDF direto. Em aula isso é atrito: mostrar a
// etiqueta de um produto virava um download por demonstração, e a pasta de
// Downloads do professor enchia de PDF que ninguém ia abrir. Agora o clique
// abre o adesivo em tamanho de leitura e o download fica sendo uma escolha.
//
// O desenho segue o mesmo layout do PDF (`downloadEan13LabelPdf`): nome em
// cima, linha de variante · código · preço, barras, dígitos. Não é o mesmo
// código — o PDF é vetorial em milímetros e este é canvas em pixels — mas o
// que o aluno vê na tela tem de ser o que sai no papel.
export const EtiquetaPreviewModal = ({ item, onBaixar, onClose }: {
  item: { ean?: string; nome?: string; codigo?: string; preco?: any; atributos?: any };
  onBaixar: () => void | Promise<void>;
  onClose: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [baixando, setBaixando] = useState(false);
  const norm = normalizeEan13(item.ean);
  const variante = rotuloVariante(item);
  const preco = item.preco != null ? parseNum(item.preco) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !norm.valid) return;
    // Resolução alta de propósito (módulo de 3px, barra de 96px): o canvas é
    // depois esticado por CSS para caber na largura do telemóvel, e partir de
    // um desenho pequeno deixaria as barras serrilhadas justamente onde o
    // aluno aponta a câmera para testar a leitura.
    drawEan13ToCanvas(canvas, norm.value, { moduleWidth: 3, barHeight: 96 });
    // O helper crava largura/altura em px (bom para o preview do formulário,
    // que é fixo). Aqui a etiqueta é fluida: a largura manda, a altura segue.
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
  }, [norm.valid, norm.value]);

  // Esc fecha — o modal abre por clique num ícone pequeno e quem está
  // demonstrando não quer procurar o X.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  const baixar = async () => {
    setBaixando(true);
    try { await onBaixar(); } finally { setBaixando(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="neu-flat rounded-3xl p-5 sm:p-6 border border-white/10 w-full max-w-md flex flex-col gap-4 max-h-[90vh] overflow-y-auto main-scrollbar"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
              <Barcode size={14} className="text-accent shrink-0" /> Etiqueta EAN-13
            </h3>
            <p className="text-[11px] text-gray-500 mt-1 truncate">{item.nome}</p>
          </div>
          <button type="button" onClick={onClose} title="Fechar"
            className="action-btn-neutral shrink-0"><XIcon size={14} /></button>
        </div>

        {/* O adesivo. Fundo branco sempre — etiqueta é papel, não tem tema. */}
        <div className="bg-white rounded-xl p-4 sm:p-5 flex flex-col items-center gap-2 select-none">
          <p className="text-[13px] sm:text-sm font-bold text-black text-center leading-tight break-words w-full">
            {item.nome}
          </p>
          {(variante || item.codigo || preco != null) && (
            <p className="text-[10px] sm:text-[11px] text-neutral-600 text-center">
              {[variante, item.codigo, preco != null && !Number.isNaN(preco) ? fmtBRL(preco) : null]
                .filter(Boolean).join('   ·   ')}
            </p>
          )}
          {norm.valid ? (
            <canvas ref={canvasRef} className="mt-1 max-w-full" />
          ) : (
            <p className="text-[11px] text-neutral-500 py-6 text-center">
              EAN-13 inválido — a etiqueta não pode ser gerada.
            </p>
          )}
        </div>

        {norm.valid && (
          <p className="text-[10px] text-gray-500 leading-snug text-center">
            Adesivo de 80 × 50 mm. É este desenho que sai no PDF — dá para conferir a leitura
            apontando o scanner do PDV para a tela.
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onClose}
            className="btn-solido btn-solido--vermelho">
            Fechar
          </button>
          {norm.valid && (
            <NeuButtonAccent onClick={baixar} isLoading={baixando}>
              <FileDown size={14} /> Baixar PDF
            </NeuButtonAccent>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
