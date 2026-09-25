import type React from 'react';
import { AlertCircle, Barcode, Check, FileDown } from 'lucide-react';
import { NeuButtonAccent } from '../ui';
import { parseBRL } from '../../lib/viewUtils';
import type { normalizeEan13 } from '../../lib/barcode';
import { type FormProduto, type ExtrasProduto } from './produtoFormComum';

// Etiqueta EAN-13: prévia do código de barras e o PDF 80×50 mm.
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoEtiqueta({
  downloadLabelFor, eanNorm, eanPreviewRef, extras, form,
}: {
  downloadLabelFor: (item: { ean?: string; nome?: string; codigo?: string; preco?: any; atributos?: any }) => void | Promise<void>;
  eanNorm: ReturnType<typeof normalizeEan13>;
  eanPreviewRef: React.MutableRefObject<HTMLCanvasElement | null>;
  extras: ExtrasProduto;
  form: FormProduto;
}) {
  return (
    <>
      {/* Etiqueta EAN-13 */}
      {extras.ean.replace(/\D/g, '').length > 0 && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
            <Barcode size={12} /> Etiqueta EAN-13
          </p>
          <div className="neu-pressed rounded-2xl p-4 border border-white/5 flex flex-col sm:flex-row items-center gap-4">
            <div className="bg-white p-3 rounded-lg flex items-center justify-center min-h-[88px]">
              {eanNorm.valid ? (
                <canvas ref={eanPreviewRef} />
              ) : (
                <span className="text-[11px] text-gray-500 font-mono px-6 text-center">
                  Informe 12 ou 13 dígitos para visualizar
                </span>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2 w-full">
              {eanNorm.valid ? (
                <div className="flex items-center gap-2 text-emerald-400 text-xs">
                  <Check size={14} />
                  <span className="font-bold">EAN-13 válido:</span>
                  <span className="font-mono">{eanNorm.value}</span>
                  {eanNorm.autoCompleted && (
                    <span className="text-[10px] text-gray-500">(dígito verificador calculado)</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-yellow-400 text-xs">
                  <AlertCircle size={14} />
                  <span>
                    {eanNorm.digits.length === 13
                      ? 'Dígito verificador inválido — confira os números.'
                      : `Faltam ${Math.max(0, 12 - eanNorm.digits.length)} dígito(s) para validar.`}
                  </span>
                </div>
              )}
              <div className="flex justify-start">
                <NeuButtonAccent
                  onClick={() => downloadLabelFor({ ean: extras.ean, nome: form.nome, codigo: form.codigo, preco: parseBRL(form.preco) })}
                  disabled={!eanNorm.valid || !form.nome.trim()}
                >
                  <FileDown size={14} /> Baixar etiqueta PDF
                </NeuButtonAccent>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
