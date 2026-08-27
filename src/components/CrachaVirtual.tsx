// O cartão do crachá virtual e o modal que o exibe.
//
// Dois consumidores: o aluno, que abre o próprio pelo topo da tela, e o
// professor, que abre o de qualquer um pela aba Crachás do Ponto Eletrônico.
// O mesmo cartão serve aos dois — o que muda é quem o abre.
//
// Cartão em proporção de crachá de verdade (ISO 7810 ID-1, 85,6 × 54 mm, mas
// em pé): a ideia é que imprimir e plastificar seja opção, não gambiarra.

import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { X, User, Printer } from 'lucide-react';
import { montarCracha, codigoCracha } from '../lib/cracha';

export type CrachaPessoa = {
  id: string;
  nome: string;
  cargo?: string | null;
  filial?: string | null;
  foto_url?: string | null;
};

export const CrachaVirtual = ({ pessoa, compacto = false }: { pessoa: CrachaPessoa; compacto?: boolean }) => (
  <div
    className="cracha-cartao rounded-3xl border border-accent/30 overflow-hidden flex flex-col"
    style={{ background: 'linear-gradient(160deg, #141414 0%, #0a0a0a 60%, #100d04 100%)' }}
  >
    <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-white/5">
      <img src="/icon-logmax.png" alt="" className="w-8 h-8 rounded-lg object-cover" />
      <span className="text-[9px] font-black uppercase tracking-[0.25em] text-accent/70">
        Crachá
      </span>
    </div>

    <div className="px-5 py-4 flex flex-col items-center gap-3">
      <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-accent/40 bg-black/40 flex items-center justify-center shrink-0">
        {pessoa.foto_url
          ? <img src={pessoa.foto_url} alt={pessoa.nome} className="w-full h-full object-cover" />
          : <User size={34} className="text-accent/50" />}
      </div>

      <div className="text-center min-w-0 w-full">
        <p className="text-base font-bold text-gray-100 leading-tight break-words">{pessoa.nome}</p>
        {pessoa.cargo && (
          <p className="text-[11px] text-gray-400 mt-0.5">{pessoa.cargo}</p>
        )}
        {pessoa.filial && (
          <span className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
            {pessoa.filial}
          </span>
        )}
      </div>
    </div>

    {/* Fundo branco no QR sempre, nos dois temas: leitor de câmera erra em
        código claro sobre escuro, e o crachá tem de funcionar impresso. */}
    <div className="mt-auto px-5 pb-5 flex flex-col items-center gap-2">
      <div className="bg-white p-2.5 rounded-xl">
        <QRCodeSVG
          value={montarCracha(pessoa.id)}
          size={compacto ? 96 : 132}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
        />
      </div>
      <p className="text-[10px] font-mono tracking-[0.3em] text-gray-500">{codigoCracha(pessoa.id)}</p>
    </div>
  </div>
);

export const CrachaModal = ({ pessoa, onClose }: { pessoa: CrachaPessoa; onClose: () => void }) => {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Crachá de ${pessoa.nome}`}
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 gap-4"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[320px]"
      >
        <CrachaVirtual pessoa={pessoa} />
      </motion.div>

      {/* Fora do cartão para não sair na impressão. */}
      <div className="flex items-center gap-2 cracha-controles" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => window.print()}
          title="Imprimir este crachá"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/15 text-gray-300 hover:text-accent hover:border-accent/40 transition-colors"
        >
          <Printer size={12} /> Imprimir
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Fechar (Esc)"
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={20} />
        </button>
      </div>
    </motion.div>
  );
};
