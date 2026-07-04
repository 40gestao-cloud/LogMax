import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useUserProfile } from '../hooks/useUserProfile';


const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
export type FilialOp = typeof FILIAIS[number];

const FILIAL_META: Record<FilialOp, {
  logo: string;
  desc: string;
  glowHover: string;
  borderIdle: string;
  borderHover: string;
  textCls: string;
}> = {
  SuperMax: {
    logo:        '/icon-supermax.png',
    desc:        'Supermercado',
    glowHover:   'rgba(34,197,94,0.22)',
    borderIdle:  'rgba(34,197,94,0.18)',
    borderHover: 'rgba(34,197,94,0.60)',
    textCls:     'text-emerald-400',
  },
  MaxLook: {
    logo:        '/icon-maxlook.png',
    desc:        'Roupas, Calçados e Acessórios',
    glowHover:   'rgba(217,70,239,0.20)',
    borderIdle:  'rgba(217,70,239,0.18)',
    borderHover: 'rgba(217,70,239,0.60)',
    textCls:     'text-fuchsia-400',
  },
  TechMax: {
    logo:        '/icon-techmax.png',
    desc:        'Eletrônicos e Assistência Técnica',
    glowHover:   'rgba(249,115,22,0.20)',
    borderIdle:  'rgba(249,115,22,0.18)',
    borderHover: 'rgba(249,115,22,0.60)',
    textCls:     'text-orange-400',
  },
};

const isFilialOp = (v: string | null | undefined): v is FilialOp =>
  v === 'SuperMax' || v === 'MaxLook' || v === 'TechMax';

interface Props {
  title: string;
  subtitle?: string;
  onSelect: (filial: FilialOp) => void;
  onVoltar?: () => void;
}

export function FilialSelector({ title, subtitle, onSelect, onVoltar }: Props) {
  const { profile } = useUserProfile();

  const isColaborador = profile?.role === 'colaborador';
  const filialTravada = isColaborador && isFilialOp(profile?.filial) ? profile.filial : null;

  useEffect(() => {
    if (filialTravada) onSelect(filialTravada);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filialTravada]);

  if (!profile || filialTravada) return null;

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

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-4xl z-10">
        {FILIAIS.map((f, i) => {
          const m = FILIAL_META[f];
          return (
            <motion.button
              key={f}
              onClick={() => onSelect(f)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.07, type: 'spring', stiffness: 280, damping: 24 }}
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
              {/* Logo */}
              <div className={`w-32 h-32 rounded-2xl flex items-center justify-center overflow-hidden ring-1 ring-white/8 ${f === 'SuperMax' ? 'bg-white' : 'bg-white/5'}`}>
                <img src={m.logo} alt={f} className="w-[120px] h-[120px] object-contain" />
              </div>

              {/* Nome + descrição simples */}
              <div className="flex flex-col items-center gap-1.5">
                <p className={`text-2xl font-black tracking-tight ${m.textCls}`}>{f}</p>
                <p className="text-[11px] text-gray-500 leading-snug">{m.desc}</p>
              </div>

              {/* Seta no hover */}
              <div className={`flex items-center gap-1 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${m.textCls}`}>
                Entrar <ChevronRight size={12} />
              </div>
            </motion.button>
          );
        })}
      </div>

    </motion.div>
  );
}
