import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useUserProfile } from '../hooks/useUserProfile';

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
export type FilialOp = typeof FILIAIS[number];

const FILIAL_META: Record<FilialOp, {
  logo: string;
  desc: string;
  color: string;        // cor principal hex
  glow: string;         // rgba para box-shadow
  glowHover: string;
  borderIdle: string;
  borderHover: string;
  textCls: string;
  bgLogoCls: string;    // fundo do logo
  badgeCls: string;     // pill da categoria
}> = {
  SuperMax: {
    logo:        '/icon-supermax.png',
    desc:        'Supermercado',
    color:       '#22c55e',
    glow:        'rgba(34,197,94,0.15)',
    glowHover:   'rgba(34,197,94,0.35)',
    borderIdle:  'rgba(34,197,94,0.20)',
    borderHover: 'rgba(34,197,94,0.70)',
    textCls:     'text-emerald-400',
    bgLogoCls:   'bg-emerald-500/10',
    badgeCls:    'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
  },
  MaxLook: {
    logo:        '/icon-maxlook.png',
    desc:        'Roupas, Calçados e Acessórios',
    color:       '#d946ef',
    glow:        'rgba(217,70,239,0.12)',
    glowHover:   'rgba(217,70,239,0.30)',
    borderIdle:  'rgba(217,70,239,0.20)',
    borderHover: 'rgba(217,70,239,0.70)',
    textCls:     'text-fuchsia-400',
    bgLogoCls:   'bg-fuchsia-500/10',
    badgeCls:    'bg-fuchsia-500/10 border-fuchsia-500/25 text-fuchsia-400',
  },
  TechMax: {
    logo:        '/icon-techmax.png',
    desc:        'Eletrônicos e Assistência Técnica',
    color:       '#f97316',
    glow:        'rgba(249,115,22,0.12)',
    glowHover:   'rgba(249,115,22,0.30)',
    borderIdle:  'rgba(249,115,22,0.20)',
    borderHover: 'rgba(249,115,22,0.70)',
    textCls:     'text-orange-400',
    bgLogoCls:   'bg-orange-500/10',
    badgeCls:    'bg-orange-500/10 border-orange-500/25 text-orange-400',
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
      className="flex-1 flex flex-col items-center justify-center gap-10 py-16 px-4 relative overflow-hidden"
    >
      {/* Fundo — grade sutil + gradiente radial central */}
      <div className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 70% 50% at 50% 40%, rgba(255,255,255,0.03) 0%, transparent 100%),' +
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: 'auto, 48px 48px, 48px 48px',
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

      {/* Cabeçalho */}
      <motion.div
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="text-center z-10"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-600 mb-3">
          Holding LogMax
        </p>
        <h2 className="text-3xl sm:text-4xl font-black tracking-tight"
          style={{ background: 'linear-gradient(135deg, #f5f5f5 30%, #a0a0a0 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          {title}
        </h2>
        <p className="text-sm text-gray-500 mt-3">
          {subtitle ?? 'Escolha a filial que deseja gerenciar nesta sessão.'}
        </p>
      </motion.div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full max-w-3xl z-10">
        {FILIAIS.map((f, i) => {
          const m = FILIAL_META[f];
          return (
            <motion.button
              key={f}
              onClick={() => onSelect(f)}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.08, type: 'spring', stiffness: 260, damping: 22 }}
              whileHover={{ scale: 1.04, y: -4 }}
              whileTap={{ scale: 0.97 }}
              className="group relative flex flex-col items-center gap-5 rounded-3xl p-7 text-center transition-all duration-300 overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${m.borderIdle}`,
                boxShadow: `0 0 0 0 ${m.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                backdropFilter: 'blur(12px)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.border = `1px solid ${m.borderHover}`;
                (e.currentTarget as HTMLElement).style.boxShadow =
                  `0 0 32px ${m.glowHover}, 0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.10)`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.border = `1px solid ${m.borderIdle}`;
                (e.currentTarget as HTMLElement).style.boxShadow =
                  `0 0 0 0 ${m.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`;
              }}
            >
              {/* Halo de fundo colorido */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-3xl"
                style={{ background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${m.glow} 0%, transparent 70%)` }}
              />

              {/* Logo */}
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-2xl blur-xl opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: m.color, transform: 'scale(0.7) translateY(8px)' }}
                />
                <div className={`relative w-24 h-24 rounded-2xl flex items-center justify-center overflow-hidden ${m.bgLogoCls} ring-1 ring-white/10`}>
                  <img src={m.logo} alt={f} className="w-[88px] h-[88px] object-contain" />
                </div>
              </div>

              {/* Nome + categoria */}
              <div className="flex flex-col items-center gap-2">
                <p className={`text-xl font-black tracking-tight ${m.textCls}`}>{f}</p>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${m.badgeCls}`}>
                  {m.desc}
                </span>
              </div>

              {/* Seta */}
              <div className={`flex items-center gap-1 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-all duration-200 -mb-1 ${m.textCls}`}>
                Entrar <ChevronRight size={12} />
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Rodapé */}
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="text-[10px] text-gray-700 uppercase tracking-widest font-bold z-10"
      >
        LogMax ERP · Holding
      </motion.p>
    </motion.div>
  );
}
