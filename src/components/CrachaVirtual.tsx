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

  // Tamanhos em % da largura do cartão (container query): o mesmo desenho
  // serve ao modal, à tela do aluno e à impressão em 54 mm sem reescalar à mão.
  return (
    <div
      className="cracha-cartao @container rounded-3xl overflow-hidden flex flex-col relative"
      style={{
        aspectRatio: '54 / 85.6',
        // Claro sempre: crachá segue a impressora, não o tema do app.
        background: '#F7F8FA',
        border: `1px solid ${id.cor}33`,
        boxShadow: '0 24px 50px -26px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      {/* Faixa da unidade com a fenda do cordão e o logo na placa que a arte pede
          (os PNGs vieram com fundo queimado: SuperMax/TechMax sobre claro, MaxLook sobre preto). */}
      <div className="shrink-0 relative flex flex-col items-center pt-[5cqw] pb-[16cqw]"
        style={{ background: id.escuro }}>
        <span className="block w-[18cqw] h-[2.4cqw] rounded-full mb-[4cqw]"
          style={{ background: 'rgba(255,255,255,0.35)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)' }} />
        <div className="w-[26cqw] h-[26cqw] rounded-[4cqw] overflow-hidden flex items-center justify-center"
          style={{ background: id.plate ?? 'transparent', boxShadow: id.plate ? '0 2px 8px rgba(0,0,0,0.25)' : undefined }}>
          <img src={id.logo} alt={pessoa.filial ?? 'LogMax'} className="w-full h-full object-contain" />
        </div>
      </div>

      {/* Foto grande, sobreposta à faixa: é o que o professor confere. */}
      <div className="shrink-0 relative z-10 flex justify-center -mt-[14cqw]">
        <div className="w-[34cqw] h-[34cqw] rounded-[6cqw] overflow-hidden flex items-center justify-center bg-neutral-200"
          style={{ border: '1.2cqw solid #F7F8FA', boxShadow: `0 0 0 0.6cqw ${id.cor}` }}>
          {pessoa.foto_url
            ? <img src={pessoa.foto_url} alt={pessoa.nome} className="w-full h-full object-cover" />
            : <User className="w-[45%] h-[45%]" style={{ color: id.cor }} />}
        </div>
      </div>

      <div className="shrink-0 px-[7cqw] pt-[3cqw] text-center flex flex-col items-center gap-[2cqw]">
        <p className="text-[6.4cqw] font-black leading-[1.12] line-clamp-2 break-words tracking-tight text-neutral-900">
          {pessoa.nome}
        </p>
        {pessoa.cargo && (
          <span className="max-w-full truncate rounded-full px-[3.5cqw] py-[1.2cqw] text-[3.4cqw] font-bold uppercase tracking-[0.14em]"
            style={{ background: id.escuro, color: id.destaqueNaFaixa }}>
            {pessoa.cargo}
          </span>
        )}
      </div>

      {/* QR preto sobre branco em qualquer unidade: câmera erra em código claro sobre escuro. */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-[1.5cqw] px-[7cqw]">
        {semQr ? (
          <p className="text-[3.6cqw] text-neutral-500 text-center leading-snug">
            Crachá de identificação<br />sem registro de ponto
          </p>
        ) : (
          <div className="bg-white p-[2cqw] rounded-[3cqw]" style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.10)' }}>
            <QRCodeSVG value={montarCracha(pessoa.id)} size={256} bgColor="#ffffff" fgColor="#000000" level="M"
              style={{ width: '36cqw', height: '36cqw', display: 'block' }} />
          </div>
        )}
        <p className="text-[3.2cqw] text-neutral-500 tracking-[0.12em] uppercase">
          Matrícula <span className="font-mono font-bold text-neutral-800 tracking-[0.18em]">{codigoCracha(pessoa.id)}</span>
        </p>
      </div>

      <div className="shrink-0 flex items-center justify-center px-[5cqw] py-[3cqw]" style={{ background: id.escuro }}>
        <p className="text-[3.8cqw] font-black uppercase tracking-[0.24em] truncate leading-none"
          style={{ color: id.destaqueNaFaixa }}>
          {pessoa.filial ?? 'LogMax'}
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
          className="btn-solido btn-solido--cinza"
        >
          <Printer size={15} /> Imprimir
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
