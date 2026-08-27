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
// crachá da TechMax. Logo, tom vivo e tom escuro saem de `identidadeDaFilial`.
//
// Cartão CLARO, sempre, nos dois temas do app: crachá é cartão, não
// interface. É o mesmo desenho que sai na impressora, e o QR — que é preto
// sobre branco por obrigação óptica — deixa de ser um bloco gritante no meio
// de um retângulo preto para virar o centro natural do cartão.

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
        // Cartão CLARO, e sempre — crachá é cartão, não interface: não segue o
        // tema do app, segue o que sai na impressora. O escuro anterior fazia o
        // QR (que é preto sobre branco por obrigação óptica) virar um bloco
        // gritante no meio de um retângulo preto.
        background: '#F7F8FA',
        border: `1px solid ${id.cor}33`,
        boxShadow: '0 24px 50px -26px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      {/* Faixa do logo, de ponta a ponta. A cor da faixa é a `plate` da unidade
          — e isso não é escolha estética, é a arte que manda: os PNGs vieram
          com fundo queimado e cada um só fecha sobre um fundo (SuperMax e
          TechMax sobre claro, MaxLook sobre preto). Como faixa inteira, aquilo
          que seria uma caixa branca flutuando vira decisão de design. */}
      <div
        className="shrink-0 h-24 flex items-center justify-center px-4"
        style={{
          background: id.plate ?? id.escuro,
          borderBottom: `3px solid ${id.cor}`,
        }}
      >
        <img src={id.logo} alt={pessoa.filial ?? 'LogMax'} className="max-h-16 w-auto max-w-[82%] object-contain" />
      </div>

      {/* Linha de identificação: foto pequena ao lado do nome. A foto serve
          para conferir quem está na frente, não para ser o assunto do cartão —
          o assunto é o QR. */}
      <div className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-1">
        <div
          className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
          style={{ background: id.escuro, border: `1.5px solid ${id.cor}66` }}
        >
          {pessoa.foto_url
            ? <img src={pessoa.foto_url} alt={pessoa.nome} className="w-full h-full object-cover" />
            : <User size={22} style={{ color: id.claro }} />}
        </div>
        <div className="min-w-0 flex-1">
          {/* Nome em neutro escuro, e não no tom da unidade: o tom escuro da
              TechMax é laranja queimado e o nome saía cor de terra. A identidade
              já está na faixa do logo, no rodapé e nos detalhes — o nome só
              precisa ser legível. */}
          <p className="text-base font-black leading-[1.15] break-words line-clamp-2 tracking-tight text-neutral-900">
            {pessoa.nome}
          </p>
          {pessoa.cargo && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 mt-0.5 line-clamp-1">
              {pessoa.cargo}
            </p>
          )}
        </div>
      </div>

      {/* O QR no meio e grande — é o que se aponta a câmera para ler. Preto
          sobre branco em qualquer unidade: leitor de câmera erra em código
          claro sobre escuro, e a identidade da filial não entra aqui. Num
          cartão claro ele finalmente deixa de ser um bloco estranho e passa a
          ser o centro natural do desenho. */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-3">
        {semQr ? (
          <p className="text-[11px] text-neutral-500 text-center leading-relaxed px-4">
            Crachá de identificação.<br />Sem registro de ponto associado.
          </p>
        ) : (
          <div
            className="bg-white p-2.5 rounded-2xl"
            style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.10)' }}
          >
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

      {/* Rodapé no tom escuro da marca: fecha o cartão e carrega o que é texto
          de conferência, não de leitura óptica. */}
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
        style={{ background: id.escuro }}
      >
        {pessoa.filial && (
          // BRANCO, e não o tom da marca: a faixa já é a cor da unidade, e azul
          // sobre azul-marinho (SuperMax) ficava ilegível. Cor sobre cor da
          // mesma família é sempre aposta de contraste — o branco fecha nas
          // três unidades sem depender de calibragem.
          <p className="text-[11px] font-black uppercase tracking-[0.2em] truncate text-white">
            {pessoa.filial}
          </p>
        )}
        {/* Rotulado: antes eram seis caracteres soltos e ninguém sabia o que
            eram. */}
        <p className="text-[10px] font-mono tracking-[0.18em] shrink-0" style={{ color: 'rgba(255,255,255,0.80)' }}>
          <span className="text-[8px] uppercase tracking-[0.2em] mr-1.5" style={{ color: 'rgba(255,255,255,0.50)' }}>Matrícula</span>
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
