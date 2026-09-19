import React, { useEffect, useRef, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { IMAGEM_ACCEPT, IMAGEM_MAX_BYTES, validarImagem, corDoNome, iniciaisDoNome } from '../lib/imagemCadastro';
import { resizeImage } from '../lib/imageResize';
import { ColarImagem } from './ColarImagem';

// Peças de imagem compartilhadas pelos cadastros (categoria, fornecedor,
// serviço). Vivia dentro do CategoriasProdutoView; saiu de lá quando fornecedor
// e serviço passaram a ter imagem também.

/**
 * Campo de upload com prévia. Não sobe nada sozinho: entrega o File ao pai via
 * `onPreview`, e o pai decide quando chamar `uploadImagem` — assim o arquivo só
 * vai para o storage no momento do save, e não a cada troca de ideia.
 */
export function ImagemUploader({
  imagemUrl, onPreview, onClear, disabled, rotulo = 'imagem', formato = 'rounded-xl',
}: {
  imagemUrl: string;
  onPreview: (file: File, previewUrl: string) => void;
  onClear: () => void;
  disabled?: boolean;
  /** Aparece nos botões: "Enviar logo", "Trocar foto"… */
  rotulo?: string;
  formato?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Erro inline em vez do `alert()` do navegador que estava aqui. Além de sair
  // do tema, o alert tirava a mensagem do lado do campo que a causou.
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  // Upload e Ctrl+V caem aqui. Acima de 1 MB a imagem é reduzida antes de
  // validar: o navegador entrega a imagem copiada do Google como PNG, que
  // passa de 1 MB com facilidade mesmo sendo uma foto comum — e recusar o
  // colar por isso seria recusar justamente o caso para o qual ele existe.
  const receber = async (original: File) => {
    let file = original;
    if (file.size > IMAGEM_MAX_BYTES) {
      setProcessando(true);
      try {
        file = await resizeImage(file, { maxWidth: 1024, maxHeight: 1024, maxBytes: IMAGEM_MAX_BYTES });
      } catch (err: any) {
        setErro(err?.message || 'Não foi possível reduzir a imagem.');
        return;
      } finally {
        setProcessando(false);
      }
    }
    const v = validarImagem(file);
    if (!v.ok) { setErro(v.motivo || 'Imagem inválida.'); return; }
    setErro(null);
    onPreview(file, URL.createObjectURL(file));
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) receber(file);
  };

  return (
    <div className="flex items-center gap-3">
      {imagemUrl ? (
        <div className="relative w-14 h-14 shrink-0">
          <img src={imagemUrl} alt="" className={`w-14 h-14 ${formato} object-cover border border-white/10`} />
          {!disabled && (
            <button type="button" onClick={onClear} title={`Remover ${rotulo}`}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-400">
              <X size={9} />
            </button>
          )}
        </div>
      ) : (
        <div className={`w-14 h-14 ${formato} border border-dashed border-white/20 flex items-center justify-center text-gray-600 shrink-0`}>
          <ImageIcon size={20} />
        </div>
      )}
      {!disabled && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => ref.current?.click()} disabled={processando}
              className="neu-button text-xs px-3 py-1.5 rounded-lg text-gray-300 hover:text-accent flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait">
              <ImageIcon size={11} />{processando ? 'Reduzindo…' : imagemUrl ? `Trocar ${rotulo}` : `Enviar ${rotulo}`}
            </button>
            <ColarImagem onImagem={receber} disabled={processando} />
          </div>
          <p className={`text-[10px] mt-1 ${erro ? 'text-red-400' : 'text-gray-600'}`}>
            {erro ?? 'JPG, PNG ou WEBP — acima de 1 MB o sistema reduz sozinho'}
          </p>
          <input ref={ref} type="file" accept={IMAGEM_ACCEPT} className="hidden" onChange={handleFile} />
        </div>
      )}
    </div>
  );
}

/**
 * Bloco de identidade de um cadastro: a imagem, se houver; senão as iniciais do
 * nome sobre a cor derivada dele. Nunca cai num quadrado cinza igual ao vizinho.
 */
export function LogoCadastro({ imagemUrl, nome, size = 40, formato, ajuste = 'contain' }: {
  imagemUrl?: string | null; nome?: string | null; size?: number;
  formato?: 'quadrado' | 'circulo';
  /** `contain` para logo (cortada no meio deixa de ser logo); `cover` para foto. */
  ajuste?: 'contain' | 'cover';
}) {
  const raio = formato === 'circulo' ? '50%' : Math.round(size * 0.28);
  const base: React.CSSProperties = { width: size, height: size, borderRadius: raio };

  // O arquivo pode sumir do bucket sem que a URL saia da linha (exclusão manual
  // no Dashboard, bucket recriado). Sem isto o card ficava com o ícone de imagem
  // quebrada do navegador, que é pior do que não ter imagem nenhuma.
  const [quebrou, setQuebrou] = useState(false);
  useEffect(() => { setQuebrou(false); }, [imagemUrl]);

  if (imagemUrl && !quebrou) {
    return (
      <div style={{ ...base, border: '1px solid rgba(255,255,255,0.10)' }}
        className="overflow-hidden shrink-0 bg-white/5">
        <img src={imagemUrl} alt="" onError={() => setQuebrou(true)}
          className={`w-full h-full ${ajuste === 'cover' ? 'object-cover' : 'object-contain'}`} />
      </div>
    );
  }

  const cor = corDoNome(nome);
  return (
    <div
      style={{
        ...base, background: `${cor}22`, border: `1px solid ${cor}55`, color: cor,
        fontSize: Math.round(size * 0.36),
      }}
      className="flex items-center justify-center shrink-0 font-black tracking-tight select-none"
      title={nome ?? undefined}
    >
      {iniciaisDoNome(nome)}
    </div>
  );
}
