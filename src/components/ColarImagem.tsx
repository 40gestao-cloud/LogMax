import React, { useEffect, useRef } from 'react';
import { ClipboardPaste } from 'lucide-react';

// Colar imagem em vez de escolher arquivo.
//
// O caminho comum do aluno é achar a foto no Google, "Copiar imagem" e colar —
// salvar no disco só para depois ir buscar o arquivo no seletor era uma volta.
// Dois gestos entram aqui:
//
// - Ctrl+V em qualquer ponto da tela enquanto o campo está montado. Só age
//   quando a área de transferência traz uma IMAGEM; colar texto num input
//   segue normal.
// - Botão direito → Colar na área tracejada. O navegador só oferece "Colar"
//   no menu de contexto sobre algo editável, por isso ela é contentEditable —
//   mas recusa qualquer digitação, só aceita a imagem.
//
// O arquivo colado vai para o mesmo handler do upload, então passa pela mesma
// validação e compressão.

/** Primeira imagem da área de transferência (ou de um drop), se houver. */
function imagemDe(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return Array.from(dt.files ?? []).find(f => f.type.startsWith('image/')) ?? null;
}

// Se dois campos estiverem ativos ao mesmo tempo, o Ctrl+V vai só para o
// mais recente — o que acabou de abrir é o que o aluno está olhando. Inativo
// não conta: o do produto fica montado com o formulário fechado.
const pilha: { id: number; ativo: () => boolean }[] = [];
let proximoId = 0;

/**
 * Ctrl+V com imagem em qualquer ponto da tela, enquanto `ativo`. Separado do
 * componente para quem tem vários campos de imagem (o produto tem três) poder
 * decidir sozinho para qual deles a imagem vai.
 */
export function useColarImagemGlobal(onImagem: (file: File) => void, ativo = true) {
  const onImagemRef = useRef(onImagem);
  const ativoRef = useRef(ativo);
  onImagemRef.current = onImagem;
  ativoRef.current = ativo;

  useEffect(() => {
    const id = ++proximoId;
    pilha.push({ id, ativo: () => ativoRef.current });
    const aoColar = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const dono = [...pilha].reverse().find(p => p.ativo());
      if (dono?.id !== id) return;
      const file = imagemDe(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      onImagemRef.current(file);
    };
    window.addEventListener('paste', aoColar);
    return () => {
      window.removeEventListener('paste', aoColar);
      pilha.splice(pilha.findIndex(p => p.id === id), 1);
    };
  }, []);
}

export function ColarImagem({
  onImagem, disabled = false, global = true, className = '',
}: {
  onImagem: (file: File) => void;
  disabled?: boolean;
  /** `false` quando o pai já trata o Ctrl+V global com `useColarImagemGlobal`. */
  global?: boolean;
  className?: string;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  useColarImagemGlobal(onImagem, global && !disabled);

  // `beforeinput` nativo, e não o onBeforeInput do React (que é emulado e não
  // enxerga Cortar/Excluir do menu de contexto): nada edita a área.
  useEffect(() => {
    const area = areaRef.current;
    const bloquear = (e: Event) => e.preventDefault();
    area?.addEventListener('beforeinput', bloquear);
    return () => area?.removeEventListener('beforeinput', bloquear);
  }, []);

  const receber = (e: React.ClipboardEvent | React.DragEvent, dt: DataTransfer) => {
    // Sempre bloqueia: texto colado ou arrastado viraria conteúdo da área.
    e.preventDefault();
    if (disabled) return;
    const file = imagemDe(dt);
    if (file) onImagem(file);
  };

  return (
    <div
      ref={areaRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Colar imagem"
      title="Copie uma imagem (no Google: botão direito → Copiar imagem) e cole aqui com Ctrl+V ou botão direito → Colar. Também aceita arrastar o arquivo."
      spellCheck={false}
      onPaste={e => receber(e, e.clipboardData)}
      onDrop={e => receber(e, e.dataTransfer)}
      onDragOver={e => e.preventDefault()}
      onCut={e => e.preventDefault()}
      onKeyDown={e => {
        // Deixa passar Ctrl+V e navegação; o resto não tem o que editar aqui.
        if (e.ctrlKey || e.metaKey || e.key === 'Tab' || e.key === 'Escape') return;
        e.preventDefault();
      }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-white/20 rounded-lg text-[11px] text-gray-500 cursor-text select-none outline-none focus:border-accent/60 focus:text-gray-300 caret-transparent ${disabled ? 'opacity-60 cursor-wait' : ''} ${className}`}
    >
      <ClipboardPaste size={12} className="shrink-0 pointer-events-none" />
      <span className="pointer-events-none">Colar · Ctrl+V</span>
    </div>
  );
}
