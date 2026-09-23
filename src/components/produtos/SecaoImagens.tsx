import type React from 'react';
import { AlertTriangle, ImagePlus, Loader2, X as XIcon } from 'lucide-react';
import { ColarImagem } from '../ColarImagem';
import { ProdutoThumb } from '../ui';
import { PRODUTO_IMAGEM_ACCEPT, PRODUTO_IMAGEM_MAX_SLOTS, PRODUTO_IMAGEM_OUTPUT_MAX_LABEL, PRODUTO_IMAGEM_RES_IDEAL } from '../../lib/produtoImagem';
import { type FormProduto } from './produtoFormComum';

// Imagens do produto: capa obrigatória e até duas extras, com colar (Ctrl+V).
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoImagens({
  enviarImagemSlot, extrasErrors, form, handleImagemChange, handleRemoverImagem, imagemInputRefs, imagemUploading, imagens, imagensAviso,
}: {
  enviarImagemSlot: (slotIdx: number, file: File) => void | Promise<void>;
  extrasErrors: Record<string, string>;
  form: FormProduto;
  handleImagemChange: (slotIdx: number, e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoverImagem: (slotIdx: number) => void;
  imagemInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  imagemUploading: number | null;
  imagens: string[];
  imagensAviso: (string | null)[];
}) {
  return (
    <>
      {/* Imagens do produto — capa + até 2 extras */}
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
          <ImagePlus size={12} /> Imagens do produto (até {PRODUTO_IMAGEM_MAX_SLOTS}) — capa obrigatória *
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {imagens.map((url, slotIdx) => (
            <div key={slotIdx}
              className={`neu-pressed rounded-2xl p-3 border flex flex-col items-center gap-2 ${
                slotIdx === 0 && extrasErrors.imagens ? 'border-red-500/40' : 'border-white/5'
              }`}>
              <ProdutoThumb url={url} size="lg" alt={slotIdx === 0 ? (form.nome || 'Produto') : `${form.nome || 'Produto'} — foto ${slotIdx + 1}`} />
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                {slotIdx === 0 ? 'Capa' : `Extra ${slotIdx}`}
              </span>
              <input
                ref={el => { imagemInputRefs.current[slotIdx] = el; }}
                type="file"
                accept={PRODUTO_IMAGEM_ACCEPT}
                onChange={e => handleImagemChange(slotIdx, e)}
                className="hidden"
              />
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => imagemInputRefs.current[slotIdx]?.click()}
                  disabled={imagemUploading === slotIdx}
                  className="neu-button py-1.5 px-3 rounded-xl text-[11px] font-bold text-gray-300 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {imagemUploading === slotIdx
                    ? <><Loader2 size={11} className="animate-spin" /> Enviando...</>
                    : <><ImagePlus size={11} /> {url ? 'Trocar' : 'Selecionar'}</>}
                </button>
                {url && imagemUploading !== slotIdx && (
                  <button
                    type="button"
                    onClick={() => handleRemoverImagem(slotIdx)}
                    className="neu-button py-1.5 px-2 rounded-xl text-[11px] font-bold text-gray-500 hover:text-red-500 transition-colors flex items-center gap-1"
                  >
                    <XIcon size={10} /> Remover
                  </button>
                )}
              </div>
              <ColarImagem global={false} disabled={imagemUploading !== null}
                onImagem={file => enviarImagemSlot(slotIdx, file)} />
              {imagensAviso[slotIdx] && (
                <p className="text-[10px] text-amber-400/90 leading-snug text-center flex items-start gap-1">
                  <AlertTriangle size={11} className="shrink-0 mt-px" />
                  <span>{imagensAviso[slotIdx]}</span>
                </p>
              )}
            </div>
          ))}
        </div>
        {extrasErrors.imagens && (
          <p className="text-[11px] text-red-400 mt-2 flex items-start gap-1">
            <AlertTriangle size={12} className="shrink-0 mt-px" />
            <span>{extrasErrors.imagens}</span>
          </p>
        )}
        <p className="text-[11px] text-gray-500 leading-snug mt-2">
          Aceita <span className="font-bold text-gray-300">JPG, PNG ou WEBP</span> — cada foto é comprimida
          automaticamente para WebP até <span className="font-bold text-gray-300">{PRODUTO_IMAGEM_OUTPUT_MAX_LABEL}</span>,
          então pode enviar direto da câmera. Use imagens de pelo menos{' '}
          <span className="font-bold text-gray-300">{PRODUTO_IMAGEM_RES_IDEAL} px</span> no menor lado: miniatura
          baixada da web fica borrada, porque o sistema reduz mas nunca amplia. Também dá para colar: no Google, abra
          a imagem, botão direito → <span className="font-bold text-gray-300">Copiar imagem</span> e Ctrl+V aqui
          (vai para o primeiro slot vazio). A capa é a que aparece no PDV, Catálogo e vitrine — e por isso é obrigatória; as duas extras são opcionais.
        </p>
      </div>
    </>
  );
}
