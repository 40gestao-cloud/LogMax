import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';


export const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
export type FilialOp = typeof FILIAIS[number];

export type FilialSelectorValue = FilialOp | 'Matriz';

const FILIAL_META: Record<FilialOp, {
  logo: string;
  glowHover: string;
  borderIdle: string;
  borderHover: string;
  bgCls: string;
  shimmer: string;
}> = {
  SuperMax: {
    logo:        '/icon-supermax-view.png',
    glowHover:   'rgba(29,78,216,0.28)',
    borderIdle:  'rgba(29,78,216,0.22)',
    borderHover: 'rgba(29,78,216,0.70)',
    bgCls:       'bg-white',
    shimmer:     'inset 0 0 22px 10px rgba(0,0,0,0.65)',
  },
  MaxLook: {
    logo:        '/icon-maxlook.png',
    glowHover:   'rgba(201,168,130,0.28)',
    borderIdle:  'rgba(201,168,130,0.22)',
    borderHover: 'rgba(201,168,130,0.70)',
    bgCls:       'bg-white/5',
    shimmer:     'inset 0 0 22px 10px rgba(210,185,150,0.55)',
  },
  TechMax: {
    logo:        '/icon-techmax.png',
    glowHover:   'rgba(249,115,22,0.20)',
    borderIdle:  'rgba(249,115,22,0.18)',
    borderHover: 'rgba(249,115,22,0.60)',
    bgCls:       'bg-white/5',
    shimmer:     'inset 0 0 22px 10px rgba(0,0,0,0.65)',
  },
};

interface Props {
  onSelect: (filial: FilialSelectorValue) => void;
  onVoltar?: () => void;
}

// Só admin/CEO/conselheiro chegam aqui — App.tsx trava colaborador/gerente
// na profile.filial antes de montar este componente.
export function FilialSelector({ onSelect, onVoltar }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col items-center justify-center gap-8 py-16 px-4 relative overflow-hidden"
    >
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
        className="relative flex flex-col items-center rounded-3xl py-10 px-20 text-center transition-all duration-250 overflow-hidden z-10"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(212,175,55,0.25)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.border = '1px solid rgba(212,175,55,0.70)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(212,175,55,0.25), inset 0 1px 0 rgba(255,255,255,0.08)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.border = '1px solid rgba(212,175,55,0.25)';
          (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.05)';
        }}
      >
        <img src="/icon.matriz.png" alt="Matriz" className="w-72 h-44 object-contain" />
      </motion.button>

      {/* Cards das 3 unidades */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-4xl z-10">
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
              className="group relative flex flex-col items-center gap-6 rounded-3xl p-10 text-center transition-all duration-250 overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${m.borderIdle}`,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.border = `1px solid ${m.borderHover}`;
                (e.currentTarget as HTMLElement).style.boxShadow =
                  `0 0 20px ${m.glowHover}, inset 0 1px 0 rgba(255,255,255,0.08)`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.border = `1px solid ${m.borderIdle}`;
                (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.05)';
              }}
            >
              {/* Logo com shimmer nas bordas */}
              <div
                className={`w-44 h-44 rounded-2xl flex items-center justify-center overflow-hidden ring-1 ring-white/8 ${m.bgCls}`}
                style={{ boxShadow: m.shimmer }}
              >
                <img src={m.logo} alt={f} className="w-full h-full object-contain" />
              </div>
            </motion.button>
          );
        })}
      </div>

    </motion.div>
  );
}
