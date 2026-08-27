// O cartão do crachá virtual e o modal que o exibe.
//
// Dois consumidores: cada pessoa, que abre o próprio em Meu Crachá, e o
// professor, que abre o de qualquer um em Crachá Virtual. O mesmo cartão serve
// aos dois — o que muda é quem o abre.
//
// Proporção ISO 7810 ID-1 em pé (54 × 85,6 mm), CRAVADA em `aspectRatio`. Antes
// o comentário prometia isso e o CSS não entregava: a altura era o que o
// conteúdo empilhasse, e dois crachás lado a lado saíam com alturas diferentes
// conforme o tamanho do nome. Agora o cartão tem forma própria e o conteúdo se
// acomoda dentro dela.
//
// A identidade é da UNIDADE, não do LogMax: quem trabalha na TechMax carrega o
// crachá da TechMax. Logo, cor da moldura, anel da foto e faixa saem de
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
export const CrachaVirtual = ({ pessoa, semQr = false }: {
  pessoa: CrachaPessoa;
  semQr?: boolean;
}) => {
  const id = identidadeDaFilial(pessoa.filial);

  return (
    <div
      className="cracha-cartao rounded-3xl overflow-hidden flex flex-col relative"
      style={{
        aspectRatio: '54 / 85.6',
        border: `1px solid ${id.cor}55`,
        boxShadow: `0 24px 50px -24px ${id.cor}77, 0 0 0 1px rgba(255,255,255,0.03) inset`,
        background: `linear-gradient(165deg, ${id.cor}1A 0%, #0c0c0c 45%, #070707 100%)`,
      }}
    >
      {/* Recorte do cordão. É o detalhe que faz um retângulo escuro ser lido
          como crachá antes de alguém ler uma palavra dele. */}
      <div className="pt-3 pb-1 flex justify-center shrink-0">
        <div
          className="h-1.5 w-14 rounded-full"
          style={{ background: 'rgba(0,0,0,0.55)', boxShadow: `inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 0 ${id.cor}22` }}
        />
      </div>

      {/* Faixa do logo, de ponta a ponta e alta. Full-bleed de propósito: a
          placa que a arte exige (os PNGs vieram com fundo queimado, cada um
          pedindo um fundo) virava uma caixa branca flutuando no meio do escuro.
          Como faixa inteira, lê como decisão de design em vez de remendo. */}
      <div
        className="shrink-0 h-24 flex items-center justify-center px-4"
        style={{
          background: id.plate ?? 'transparent',
          borderTop: `1px solid ${id.cor}22`,
          borderBottom: `1px solid ${id.cor}33`,
        }}
      >
        <img src={id.logo} alt={pessoa.filial ?? 'LogMax'} className="max-h-16 w-auto max-w-[82%] object-contain" />
      </div>

      {/* Linha de identificação: foto pequena ao lado do nome. A foto encolheu
          e saiu do centro de propósito — ela serve para conferir quem está na
          frente, não para ser o assunto do cartão. O assunto é o QR. */}
      <div className="shrink-0 flex items-center gap-3 px-4 pt-3 pb-1">
        <div
          className="w-12 h-12 rounded-lg overflow-hidden bg-black/40 flex items-center justify-center shrink-0"
          style={{ border: `1.5px solid ${id.cor}99` }}
        >
          {pessoa.foto_url
            ? <img src={pessoa.foto_url} alt={pessoa.nome} className="w-full h-full object-cover" />
            : <User size={22} style={{ color: `${id.cor}77` }} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-white leading-[1.15] break-words line-clamp-2 tracking-tight">
            {pessoa.nome}
          </p>
          {pessoa.cargo && (
            <p className="text-[10px] uppercase tracking-widest text-gray-400 mt-0.5 line-clamp-1">
              {pessoa.cargo}
            </p>
          )}
        </div>
      </div>

      {/* O QR no meio e grande — é o que se aponta a câmera para ler, e era o
          que estava espremido num canto da faixa de baixo.
          Fundo branco sempre, em qualquer unidade e nos dois temas: leitor de
          câmera erra em código claro sobre escuro. A identidade da filial fica
          de fora daqui — legibilidade primeiro. */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-3">
        {semQr ? (
          <p className="text-[11px] text-gray-500 text-center leading-relaxed px-4">
            Crachá de identificação.<br />Sem registro de ponto associado.
          </p>
        ) : (
          <div className="bg-white p-2.5 rounded-xl">
            <QRCodeSVG
              value={montarCracha(pessoa.id)}
              size={148}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
            />
          </div>
        )}
      </div>

      {/* Faixa inferior na cor da unidade: fecha o cartão e carrega o que é
          texto de conferência, não de leitura óptica. */}
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5"
        style={{ background: `${id.cor}1F`, borderTop: `1px solid ${id.cor}44` }}
      >
        {pessoa.filial && (
          <p className="text-[10px] font-black uppercase tracking-[0.2em] truncate"
            style={{ color: id.cor }}>
            {pessoa.filial}
          </p>
        )}
        {/* Rotulado: antes eram seis caracteres soltos e ninguém sabia o que
            eram. */}
        <p className="text-[10px] font-mono tracking-[0.18em] text-gray-400 shrink-0">
          <span className="text-[8px] uppercase tracking-[0.2em] text-gray-600 mr-1.5">Matrícula</span>
          {codigoCracha(pessoa.id)}
        </p>
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
        // Teto por ALTURA também: com a proporção cravada, um cartão de 320px
        // de largura pede ~507px de altura, e em notebook de tela baixa ele
        // passava do rodapé.
        className="w-full max-w-[300px]"
        style={{ maxHeight: '78vh' }}
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
