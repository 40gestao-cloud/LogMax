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

      {/* Faixa do logo, de ponta a ponta. Full-bleed de propósito: a placa que a
          arte exige (os PNGs vieram com fundo queimado, cada um pedindo um
          fundo) virava uma caixa branca flutuando no meio do escuro. Como faixa
          inteira, lê como decisão de design em vez de remendo. */}
      <div
        className="shrink-0 h-16 flex items-center justify-center px-4"
        style={{
          background: id.plate ?? 'transparent',
          borderTop: `1px solid ${id.cor}22`,
          borderBottom: `1px solid ${id.cor}33`,
        }}
      >
        <img src={id.logo} alt={pessoa.filial ?? 'LogMax'} className="max-h-11 w-auto max-w-[75%] object-contain" />
      </div>

      {/* Miolo: foto e nome. `flex-1 min-h-0` para o conteúdo ceder à proporção
          do cartão, e não o contrário. */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-4 py-3">
        {/* 3:4, como foto de documento — quadrado com canto arredondado lia
            como avatar de aplicativo. */}
        <div
          className="w-[38%] rounded-xl overflow-hidden bg-black/40 flex items-center justify-center shrink-0"
          style={{ aspectRatio: '3 / 4', border: `2px solid ${id.cor}99` }}
        >
          {pessoa.foto_url
            ? <img src={pessoa.foto_url} alt={pessoa.nome} className="w-full h-full object-cover" />
            : <User size={40} style={{ color: `${id.cor}77` }} />}
        </div>

        <div className="text-center min-w-0 w-full">
          {/* O nome é o elemento principal de um crachá — antes empatava com o
              cargo e perdia para o QR. */}
          <p className="text-xl font-black text-white leading-[1.15] break-words line-clamp-3 tracking-tight">
            {pessoa.nome}
          </p>
          {pessoa.cargo && (
            <p className="text-[11px] uppercase tracking-widest text-gray-400 mt-1.5 line-clamp-1">
              {pessoa.cargo}
            </p>
          )}
        </div>
      </div>

      {/* Faixa inferior na cor da unidade: fecha o cartão e dá ao QR um lugar,
          em vez de deixá-lo ocupando metade do desenho. */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-3"
        style={{ background: `${id.cor}1F`, borderTop: `1px solid ${id.cor}44` }}
      >
        {semQr ? (
          <p className="text-[10px] text-gray-400 leading-snug">
            Crachá de identificação — <span className="text-gray-500">sem registro de ponto associado.</span>
          </p>
        ) : (
          <>
            {/* Fundo branco no QR sempre, em qualquer unidade e nos dois temas:
                leitor de câmera erra em código claro sobre escuro. Aqui a
                identidade da filial fica de fora — legibilidade primeiro. */}
            <div className="bg-white p-1.5 rounded-lg shrink-0">
              <QRCodeSVG
                value={montarCracha(pessoa.id)}
                size={64}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
              />
            </div>
            <div className="min-w-0 flex-1">
              {pessoa.filial && (
                <p className="text-[10px] font-black uppercase tracking-[0.2em] truncate"
                  style={{ color: id.cor }}>
                  {pessoa.filial}
                </p>
              )}
              {/* Rotulado: antes eram seis caracteres soltos e ninguém sabia o
                  que eram. */}
              <p className="text-[8px] uppercase tracking-[0.2em] text-gray-500 mt-1.5">Matrícula</p>
              <p className="text-[11px] font-mono tracking-[0.2em] text-gray-300">{codigoCracha(pessoa.id)}</p>
            </div>
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
