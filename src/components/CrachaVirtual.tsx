// O cartão do crachá virtual e o modal que o exibe.
//
// Dois consumidores: cada pessoa, que abre o próprio em Meu Crachá, e o
// professor, que abre o de qualquer um em Crachá Virtual. O mesmo cartão serve
// aos dois — o que muda é quem o abre.
//
// Cartão em proporção de crachá de verdade (ISO 7810 ID-1, 85,6 × 54 mm, mas
// em pé): a ideia é que imprimir e plastificar seja opção, não gambiarra.
//
// A identidade é da UNIDADE, não do LogMax: quem trabalha na TechMax carrega o
// crachá da TechMax. Logo, cor da moldura, anel da foto e selo saem de
// `identidadeDaFilial` — o mesmo par logo/cor do seletor de unidade.

import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { X, User, Printer } from 'lucide-react';
import { montarCracha, codigoCracha } from '../lib/cracha';
import { identidadeDaFilial } from '../lib/filiais';

export type CrachaPessoa = {
  id: string;
  nome: string;
  cargo?: string | null;
  filial?: string | null;
  foto_url?: string | null;
};

/**
 * `semQr` existe para o crachá de quem ainda não tem cadastro de funcionário
 * ligado à conta. Um QR ali seria um código que a leitura recusaria ("não achei
 * essa pessoa") — melhor não desenhar do que desenhar o que não funciona.
 */
export const CrachaVirtual = ({ pessoa, compacto = false, semQr = false }: {
  pessoa: CrachaPessoa;
  compacto?: boolean;
  semQr?: boolean;
}) => {
  const id = identidadeDaFilial(pessoa.filial);

  return (
    <div
      className="cracha-cartao rounded-3xl overflow-hidden flex flex-col"
      style={{
        // Cor da unidade em tudo o que emoldura: borda, brilho de fora e o
        // fundo, que recebe um véu do tom em vez de ser preto puro.
        border: `1px solid ${id.cor}55`,
        boxShadow: `0 20px 45px -22px ${id.cor}66, 0 0 0 1px rgba(255,255,255,0.03) inset`,
        background: `linear-gradient(160deg, ${id.cor}1F 0%, #0c0c0c 55%, #080808 100%)`,
      }}
    >
      {/* Faixa superior: o logo da unidade é a primeira coisa que se vê. */}
      <div
        className="px-5 pt-4 pb-3 flex items-center justify-between gap-3"
        style={{ borderBottom: `1px solid ${id.cor}33` }}
      >
        <div
          className="h-11 px-2.5 rounded-xl flex items-center justify-center shrink-0"
          style={id.plate ? { background: id.plate } : undefined}
        >
          <img src={id.logo} alt={pessoa.filial ?? 'LogMax'} className="h-8 w-auto max-w-[104px] object-contain" />
        </div>
        <span
          className="text-[9px] font-black uppercase tracking-[0.25em] shrink-0"
          style={{ color: `${id.cor}CC` }}
        >
          Crachá
        </span>
      </div>

      <div className="px-5 py-4 flex flex-col items-center gap-3">
        <div
          className="w-24 h-24 rounded-2xl overflow-hidden bg-black/40 flex items-center justify-center shrink-0"
          style={{ border: `2px solid ${id.cor}88` }}
        >
          {pessoa.foto_url
            ? <img src={pessoa.foto_url} alt={pessoa.nome} className="w-full h-full object-cover" />
            : <User size={34} style={{ color: `${id.cor}88` }} />}
        </div>

        <div className="text-center min-w-0 w-full">
          <p className="text-base font-bold text-gray-100 leading-tight break-words">{pessoa.nome}</p>
          {pessoa.cargo && (
            <p className="text-[11px] text-gray-400 mt-0.5">{pessoa.cargo}</p>
          )}
          {pessoa.filial && (
            <span
              className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
              style={{ background: `${id.cor}1A`, color: id.cor, border: `1px solid ${id.cor}4D` }}
            >
              {pessoa.filial}
            </span>
          )}
        </div>
      </div>

      {/* Fundo branco no QR sempre, nos dois temas e em qualquer unidade: leitor
          de câmera erra em código claro sobre escuro, e o crachá tem de
          funcionar impresso. A identidade da filial fica de fora daqui de
          propósito — legibilidade primeiro. */}
      <div className="mt-auto px-5 pb-5 flex flex-col items-center gap-2">
        {semQr ? (
          <p className="text-[10px] text-gray-600 text-center leading-relaxed py-6 px-2">
            Crachá de identificação.<br />Sem registro de ponto associado.
          </p>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
};

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
