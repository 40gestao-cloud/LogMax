import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';


export const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
export type FilialOp = typeof FILIAIS[number];

export type FilialSelectorValue = FilialOp | 'Matriz';

const FILIAL_META: Record<FilialOp, {
  logo: string;
  segmento: string;
  corTexto: string;
  glowHover: string;
  borderIdle: string;
  borderHover: string;
  /** Pico do shimmer da borda — a mesma cor da unidade, em opacidade cheia. */
  peak: string;
  /** Cor da placa do logo. Espelha o fundo QUE JÁ VEM QUEIMADO NO PNG: o
   *  SuperMax é arte transparente que só fecha sobre claro, o TechMax vem com
   *  branco chapado e o MaxLook com preto chapado. Enquanto os três não vierem
   *  com fundo transparente, a placa não tem como ser a mesma cor — o que da
   *  pra unificar (e está unificado abaixo) é a moldura: mesmo tamanho, mesmo
   *  raio, mesmo anel, mesmo respiro interno, sem sombra interna própria. */
  plate: string;
}> = {
  SuperMax: {
    logo:        '/icon-supermax-view.png',
    segmento:    'Supermercado',
    corTexto:    'rgb(130,165,255)',
    glowHover:   'rgba(29,78,216,0.28)',
    borderIdle:  'rgba(70,115,240,0.58)',
    borderHover: 'rgba(29,78,216,0.70)',
    peak:        'rgba(96,140,255,0.95)',
    plate:       '#ffffff',
  },
  MaxLook: {
    logo:        '/icon-maxlook.png',
    segmento:    'Moda',
    corTexto:    'rgb(222,195,160)',
    glowHover:   'rgba(201,168,130,0.28)',
    borderIdle:  'rgba(201,168,130,0.55)',
    borderHover: 'rgba(201,168,130,0.70)',
    peak:        'rgba(232,205,168,0.95)',
    plate:       '#000000',
  },
  TechMax: {
    logo:        '/icon-techmax.png',
    segmento:    'Tecnologia',
    corTexto:    'rgb(255,160,90)',
    glowHover:   'rgba(249,115,22,0.20)',
    borderIdle:  'rgba(249,115,22,0.55)',
    borderHover: 'rgba(249,115,22,0.60)',
    peak:        'rgba(255,150,70,0.95)',
    plate:       '#ffffff',
  },
};

// Hover e foco de teclado no MESMO lugar. Antes o hover era pintado por
// onMouseEnter/onMouseLeave em style inline, e mouse é o único jeito de
// disparar isso: quem navegava por Tab não via onde estava. Em classe, o
// `focus-visible` recebe o mesmo tratamento do hover de graça, e ainda ganha
// um anel próprio pra não depender só da borda.
const CARD_BASE =
  'fs-card-shimmer transition-all duration-250 outline-none ' +
  'border border-[var(--fs-bd)] hover:border-[var(--fs-bd-hv)] focus-visible:border-[var(--fs-bd-hv)] ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ' +
  'hover:shadow-[0_0_20px_var(--fs-glow),inset_0_1px_0_rgba(255,255,255,0.08)] ' +
  'focus-visible:shadow-[0_0_20px_var(--fs-glow),inset_0_1px_0_rgba(255,255,255,0.08)] ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--fs-bd-hv)] focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[var(--color-bg-base)]';

interface Props {
  onSelect: (filial: FilialSelectorValue) => void;
  onVoltar?: () => void;
}

// Só admin/CEO/conselheiro chegam aqui — App.tsx trava colaborador/gerente
// na profile.filial antes de montar este componente.
export function FilialSelector({ onSelect, onVoltar }: Props) {
  return (
    // No celular só apareciam a Matriz e a SuperMax.
    //
    // Não era corte: medido em 375x812 com o layout antigo, a página rolava e
    // as quatro estavam no DOM — a MaxLook começava em y=769 e a TechMax em
    // y=1050. Estavam ABAIXO DA DOBRA, alcançáveis por um gesto que nada na
    // tela pedia. O conteúdo centralizado e sem corte visível é exatamente o
    // que faz uma tela parecer inteira quando não está, e um seletor que
    // esconde metade das opções não é um seletor.
    //
    // Por isso a correção não é "deixar rolar": é CABER. Três colunas e
    // tamanhos menores põem as quatro opções na primeira tela até em 360x640.
    // O container que rola fica como rede — telefone baixo com fonte grande,
    // barra do navegador ocupando mais altura — e aí `min-h-full` no miolo
    // mantém a centralização de antes sem tornar o topo inalcançável, que é o
    // que `justify-center` sozinho faria num container rolável.
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 overflow-y-auto"
    >
    <div className="min-h-full flex flex-col items-center justify-center gap-3 sm:gap-5 pt-4 pb-8 sm:pt-6 sm:pb-12 px-4 relative">
      {/* O fundo era preto chapado e os cards flutuavam nele sem nenhum
          plano por trás. Dois radiais MUITO fracos (o dourado da holding em
          cima, um frio embaixo, atrás da fileira) dão profundidade sem sombra
          e sem sair do flat — nada aqui desenha borda ou brilho de objeto. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(60% 38% at 50% 26%, rgba(212,175,55,0.07) 0%, transparent 70%),' +
            'radial-gradient(70% 40% at 50% 82%, rgba(120,140,190,0.05) 0%, transparent 72%)',
        }}
      />

      {/* Botão Voltar */}
      {onVoltar && (
        <motion.button
          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
          onClick={onVoltar}
          className="self-start flex items-center gap-1.5 text-sm text-gray-500 hover:text-accent transition-colors z-10"
        >
          <ArrowLeft size={14} /> Voltar
        </motion.button>
      )}

      {/* Matriz — card igual aos demais */}
      <motion.button
        onClick={() => onSelect('Matriz')}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 280, damping: 24 }}
        whileHover={{ scale: 1.03, y: -3 }}
        whileTap={{ scale: 0.97 }}
        // px-20 fixo pedia 448px (288 da imagem + 160 de padding) num telefone
        // de 375px: o card nascia mais largo que a tela e era ele quem
        // empurrava a altura de todo o resto para baixo da dobra.
        className={`relative flex flex-col items-center rounded-3xl py-3 px-6 sm:py-5 sm:px-20 text-center overflow-hidden z-10 max-w-full bg-white/3 ${CARD_BASE}`}
        style={{
          '--fs-bd': 'rgba(212,175,55,0.55)',
          '--fs-bd-hv': 'rgba(212,175,55,0.70)',
          '--fs-glow': 'rgba(212,175,55,0.25)',
        } as React.CSSProperties}
      >
        <img src="/icon.matriz.png" alt="Matriz" className="w-56 h-32 sm:w-[22rem] sm:h-52 object-contain" />
        <span className="mt-1 sm:mt-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgb(226,194,98)' }}>
          Holding · visão consolidada
        </span>
      </motion.button>

      {/* Cards das 3 unidades */}
      {/* Três colunas também no celular. Empilhado, o seletor pedia rolagem
          para uma escolha de três opções que são só logos — e a rolagem, aqui,
          esconde justamente as opções que existem. Lado a lado, a tela inteira
          cabe de uma vez, que é o que um seletor precisa. */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-6 w-full max-w-5xl z-10">
        {FILIAIS.map((f, i) => {
          const m = FILIAL_META[f];
          return (
            <motion.button
              key={f}
              onClick={() => onSelect(f)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.07, type: 'spring', stiffness: 280, damping: 24 }}
              whileHover={{ scale: 1.03, y: -3 }}
              whileTap={{ scale: 0.97 }}
              className={`group relative flex flex-col items-center rounded-2xl sm:rounded-3xl p-2.5 sm:p-7 text-center overflow-hidden bg-white/3 ${CARD_BASE}`}
              style={{
                '--fs-bd': m.borderIdle,
                '--fs-bd-hv': m.borderHover,
                '--fs-peak': m.peak,
                '--fs-glow': m.glowHover,
              } as React.CSSProperties}
            >
              {/* Moldura idêntica nas três — a placa muda de cor porque o fundo
                  vem queimado no PNG (ver comentário em FILIAL_META). */}
              <div
                className="w-full aspect-square sm:h-auto sm:max-w-56 rounded-xl sm:rounded-2xl flex items-center justify-center overflow-hidden ring-1 ring-white/10"
                style={{ background: m.plate }}
              >
                {/* A arte é quadrada e preenche a moldura inteira. Escalar
                    pra "equilibrar" o MaxLook com as outras só empurrava a
                    marca contra o overflow-hidden e comia a borda dela. */}
                <img src={m.logo} alt={f} className="w-full h-full object-contain" />
              </div>
              <span className="mt-2 sm:mt-4 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.04em] sm:tracking-[0.2em]" style={{ color: m.corTexto }}>
                {m.segmento}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
    </motion.div>
  );
}
