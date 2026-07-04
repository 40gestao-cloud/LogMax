import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { FILIAL_COLOR } from '../lib/filiais';
import { useUserProfile } from '../hooks/useUserProfile';

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
export type FilialOp = typeof FILIAIS[number];

const FILIAL_META: Record<FilialOp, { logo: string; desc: string; logoBg?: string }> = {
  SuperMax: { logo: '/icon-supermax.png', desc: 'Supermercado',                                          logoBg: '#ffffff' },
  MaxLook:  { logo: '/icon-maxlook.png',  desc: 'Roupas, Calçados e Acessórios' },
  TechMax:  { logo: '/icon-techmax.png',  desc: 'Eletrônicos e Assistência Técnica' },
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

  // Colaboradores são travados na filial do próprio perfil — nunca veem o seletor.
  const isColaborador = profile?.role === 'colaborador';
  const filialTravada = isColaborador && isFilialOp(profile?.filial) ? profile.filial : null;

  useEffect(() => {
    if (filialTravada) onSelect(filialTravada);
  // onSelect é estável (setState), filialTravada muda no máx. uma vez
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filialTravada]);

  // Enquanto profile carrega ou após auto-seleção, não renderiza nada.
  if (!profile || filialTravada) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex-1 flex flex-col items-center justify-center gap-8 py-12 px-4">
      {onVoltar && (
        <button onClick={onVoltar}
          className="self-start flex items-center gap-1.5 text-sm text-gray-500 hover:text-accent transition-colors">
          <ArrowLeft size={14} /> Voltar
        </button>
      )}
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-black text-accent tracking-tight">{title}</h2>
        <p className="text-sm text-gray-400 mt-2">{subtitle ?? 'Selecione a unidade que deseja gerenciar.'}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {FILIAIS.map(f => {
          const cor  = FILIAL_COLOR[f];
          const meta = FILIAL_META[f];
          return (
            <motion.button key={f} onClick={() => onSelect(f)}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className={`neu-button rounded-2xl p-6 flex flex-col items-center gap-4 text-center transition-all border-2 ${cor.border} hover:border-accent`}>
              <div className="w-24 h-24 rounded-2xl flex items-center justify-center overflow-hidden"
                style={meta.logoBg ? { background: meta.logoBg } : undefined}>
                <img src={meta.logo} alt={f}
                  className={meta.logoBg ? 'w-[88px] h-[88px] object-contain' : 'w-20 h-20 object-contain rounded-2xl'} />
              </div>
              <div>
                <p className={`text-lg font-black ${cor.text}`}>{f}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{meta.desc}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
