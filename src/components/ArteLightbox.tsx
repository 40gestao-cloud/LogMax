// Visor de artes promocionais — ampliar sem sair da tela.
//
// A arte que o aluno envia só era vista pequena: no carrossel da tela de login
// (card de 460 px) e no card da lista de Artes Promocionais, onde o único jeito
// de ver grande era abrir noutra aba. Para APRESENTAR a peça em aula isso não
// serve: o professor perde a tela, mostra uma URL de storage no projetor e
// depois tem de voltar.
//
// Aqui a arte abre por cima, no tamanho que a tela permitir, com legenda,
// navegação entre as peças e botão de tela cheia de verdade (Fullscreen API,
// para o projetor). Componente puro de apresentação: não fala com o Supabase,
// não sabe de RBAC — por isso pode ser usado na tela de LOGIN, que roda sem
// sessão, e na view interna com o mesmo código.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2, ImageOff } from 'lucide-react';

export type ArteLightboxItem = {
  src: string;
  titulo: string;
  descricao?: string | null;
  /** Já formatado (ex.: "R$ 12,90") — o visor não sabe formatar moeda. */
  preco?: string | null;
  /** Já formatado (ex.: "01/09 → 15/09"). */
  periodo?: string | null;
  /** Linha discreta no rodapé: quem publicou, quando. */
  rodape?: string | null;
};

/** `2026-08-25` → `25/08/2026`. Recorte de texto, não `new Date()`: são colunas
 *  `date`, e passar por Date no fuso do Acre devolve o dia anterior. */
const diaBR = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
};

/** Período da promoção pronto para a legenda do visor. */
export function periodoArte(inicio: string | null | undefined, fim: string | null | undefined): string | null {
  const a = diaBR(inicio);
  if (!a) return null;
  const b = diaBR(fim);
  return b ? `${a} → ${b}` : `a partir de ${a}`;
}

export function ArteLightbox({ itens, indice, onIndice, onClose }: {
  itens: ArteLightboxItem[];
  indice: number;
  onIndice: (i: number) => void;
  onClose: () => void;
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [emTelaCheia, setEmTelaCheia] = useState(false);
  const [erroImagem, setErroImagem] = useState(false);
  const total = itens.length;
  const item = itens[indice];

  const irPara = useCallback((delta: number) => {
    if (total <= 1) return;
    onIndice((indice + delta + total) % total);
  }, [indice, total, onIndice]);

  // Troca de peça = imagem nova: o estado de erro da anterior não pode
  // sobreviver e mostrar "não carregou" em cima de uma arte que carrega.
  useEffect(() => { setErroImagem(false); }, [item?.src]);

  // A Fullscreen API não existe em todo lugar (iOS Safari não deixa um <div>
  // entrar em tela cheia). Onde não existe, o botão nem aparece — o visor já
  // ocupa a janela inteira de qualquer forma.
  const temTelaCheia = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  const alternarTelaCheia = useCallback(() => {
    const el = caixaRef.current;
    if (!el || !temTelaCheia) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => { /* recusado pelo browser */ });
  }, [temTelaCheia]);

  // O Esc do browser sai da tela cheia sem passar pelo nosso handler, e o
  // botão ficaria mentindo o ícone. Escuta o evento em vez de confiar no clique.
  useEffect(() => {
    const aoMudar = () => setEmTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', aoMudar);
    return () => {
      document.removeEventListener('fullscreenchange', aoMudar);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Em tela cheia o Esc é do browser (sai da tela cheia); fechar o visor
        // junto tiraria a arte da frente de quem só queria voltar à janela.
        if (!document.fullscreenElement) onClose();
        return;
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); irPara(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); irPara(-1); }
      if (e.key === 'f' || e.key === 'F') alternarTelaCheia();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose, irPara, alternarTelaCheia]);

  // Trava a rolagem do fundo: sem isto, rolar no telemóvel move a página
  // atrás do visor e a arte "escorrega" ao soltar.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = anterior; };
  }, []);

  // Arrastar para o lado troca de peça no telemóvel, onde não há seta de
  // teclado e os botões laterais ficam pequenos perto do polegar.
  const toqueX = useRef<number | null>(null);
  const aoTocar = (e: React.TouchEvent) => { toqueX.current = e.touches[0]?.clientX ?? null; };
  const aoSoltar = (e: React.TouchEvent) => {
    const inicio = toqueX.current;
    toqueX.current = null;
    if (inicio == null) return;
    const delta = (e.changedTouches[0]?.clientX ?? inicio) - inicio;
    if (Math.abs(delta) > 60) irPara(delta < 0 ? 1 : -1);
  };

  if (!item) return null;

  return (
    <motion.div
      ref={caixaRef}
      // Sem `exit`: o AnimatePresence deste projeto já tem histórico de travar
      // a saída (vide o comentário do VitrineCarousel), e aqui o preço era
      // caro — o overlay ficava no DOM em opacity 0, invisível, comendo os
      // cliques da tela e com `body.overflow: hidden` preso. Fecha
      // desmontando; a entrada continua com fade.
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      onTouchStart={aoTocar}
      onTouchEnd={aoSoltar}
      role="dialog"
      aria-modal="true"
      aria-label={`Arte: ${item.titulo}`}
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col"
    >
      {/* Barra de controle. `stopPropagation` em cada botão porque o fundo
          inteiro fecha ao clique — sem isso, entrar em tela cheia fecharia
          o visor no mesmo gesto. */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {total > 1 ? `${indice + 1} / ${total}` : 'Arte'}
        </span>
        <div className="flex items-center gap-2">
          {temTelaCheia && (
            <button type="button"
              onClick={e => { e.stopPropagation(); alternarTelaCheia(); }}
              title={emTelaCheia ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
              {emTelaCheia ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
          <button type="button"
            onClick={e => { e.stopPropagation(); onClose(); }}
            title="Fechar (Esc)"
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center gap-2 sm:gap-4 px-2 sm:px-4">
        {total > 1 && (
          <button type="button"
            onClick={e => { e.stopPropagation(); irPara(-1); }}
            title="Anterior (←)"
            className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/5 hover:bg-white/15 transition-colors">
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Clicar na arte NÃO fecha: é o alvo maior da tela e fechar sem querer
            no meio da apresentação é o erro caro aqui. Fecha pelo fundo, pelo
            X ou pelo Esc. */}
        <div onClick={e => e.stopPropagation()} className="min-w-0 flex-1 h-full flex items-center justify-center">
          {erroImagem ? (
            <div className="flex flex-col items-center gap-3 text-white/40">
              <ImageOff size={40} />
              <p className="text-xs">A imagem desta arte não pôde ser carregada.</p>
            </div>
          ) : (
            <motion.img
              key={item.src}
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              src={item.src}
              alt={item.titulo}
              draggable={false}
              onError={() => setErroImagem(true)}
              className="max-h-full max-w-full object-contain rounded-lg select-none"
            />
          )}
        </div>

        {total > 1 && (
          <button type="button"
            onClick={e => { e.stopPropagation(); irPara(1); }}
            title="Próxima (→)"
            className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/5 hover:bg-white/15 transition-colors">
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Legenda. Fica FORA da imagem (e não sobreposta) de propósito: arte
          promocional já tem texto próprio, e uma tarja por cima esconderia
          justamente o preço que o aluno desenhou. */}
      <div onClick={e => e.stopPropagation()}
        className="shrink-0 px-4 sm:px-6 py-4 flex flex-col items-center gap-1 text-center">
        <p className="text-sm sm:text-base font-bold text-white">{item.titulo}</p>
        {(item.preco || item.periodo) && (
          <p className="text-xs text-white/60 flex flex-wrap items-center justify-center gap-2">
            {item.preco && <span className="font-mono text-accent font-bold">{item.preco}</span>}
            {item.periodo && <span>{item.periodo}</span>}
          </p>
        )}
        {item.descricao && (
          <p className="text-xs text-white/50 max-w-2xl line-clamp-2">{item.descricao}</p>
        )}
        {item.rodape && (
          <p className="text-[10px] text-white/30 mt-1">{item.rodape}</p>
        )}
        {total > 1 && (
          <p className="text-[10px] text-white/25 mt-1 uppercase tracking-widest hidden sm:block">
            ← → troca de arte · F tela cheia · Esc fecha
          </p>
        )}
      </div>
    </motion.div>
  );
}
