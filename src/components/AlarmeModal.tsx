import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Coffee, LogOut } from 'lucide-react';
import { ALARME_TITULO, textoDoAlarme, pad2, type AlarmeTurma } from '../lib/alarmes';

interface Props {
  alarme: AlarmeTurma;
  onFechar: () => void;
}

// Cada tipo com ícone e cor próprios: no meio da tela, quem olha de longe
// reconhece "intervalo" pela cor antes de ler a frase.
const ESTILO: Record<AlarmeTurma['tipo'], { icone: any; cor: string; fundo: string; borda: string; halo: string }> = {
  aviso:     { icone: AlertTriangle, cor: '#D4AF37', fundo: 'rgba(212,175,55,0.14)', borda: 'rgba(212,175,55,0.45)', halo: 'rgba(212,175,55,0.55)' },
  intervalo: { icone: Coffee,        cor: '#4ade80', fundo: 'rgba(74,222,128,0.14)', borda: 'rgba(74,222,128,0.45)', halo: 'rgba(74,222,128,0.55)' },
  saida:     { icone: LogOut,        cor: '#60a5fa', fundo: 'rgba(96,165,250,0.14)', borda: 'rgba(96,165,250,0.45)', halo: 'rgba(96,165,250,0.55)' },
};

/**
 * Modal central do alarme (migr. 529). Renderizado na shell do App, por isso
 * aparece em qualquer tela.
 *
 * Não fecha no backdrop nem no Esc de propósito — o alarme existe para
 * interromper, e o áudio só para no botão. Mesma decisão do
 * `SessaoExpirandoModal`.
 *
 * O dimensionamento é deliberadamente maior que o dos outros modais: o aviso
 * é lido pela turma inteira, às vezes do fundo da sala e de relance. Título,
 * recado e botão sobem de escala junto com a largura do card, e a cor do tipo
 * pulsa no halo para o aluno perceber a interrupção sem estar olhando a tela.
 */
export function AlarmeModal({ alarme, onFechar }: Props) {
  const [visivel, setVisivel] = useState(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const { icone: Icone, cor, fundo, borda, halo } = ESTILO[alarme.tipo];
  const texto = textoDoAlarme(alarme.tipo, alarme.mensagem);

  useEffect(() => {
    requestAnimationFrame(() => setVisivel(true));
    botaoRef.current?.focus();
  }, [alarme.id]);

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-3 sm:p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alarme-titulo"
      style={{ transition: 'opacity 180ms', opacity: visivel ? 1 : 0 }}
    >
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-2xl"
        style={{
          transition: 'transform 180ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms',
          transform: visivel ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(10px)',
          opacity: visivel ? 1 : 0,
        }}
      >
        <div
          className="alarme-card p-6 sm:p-10"
          style={{
            ['--alarme-borda' as any]: borda,
            ['--alarme-halo' as any]: halo,
            maxHeight: '90vh',
            overflowY: 'auto',
            background: 'rgba(10,10,10,0.94)',
            borderRadius: '1.25rem',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          <div className="flex flex-col items-center text-center gap-4 sm:gap-5">
            <div
              className="alarme-icone rounded-2xl flex items-center justify-center shrink-0 w-20 h-20 sm:w-24 sm:h-24"
              style={{ background: fundo, border: `2px solid ${borda}` }}
            >
              <Icone className="w-10 h-10 sm:w-12 sm:h-12" style={{ color: cor }} />
            </div>

            <div>
              <h2
                id="alarme-titulo"
                className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight"
                style={{ color: cor }}
              >
                {ALARME_TITULO[alarme.tipo]}
              </h2>
              <p className="mt-1.5 text-sm sm:text-base text-gray-400 font-mono tabular-nums">
                {pad2(alarme.hora)}:{pad2(alarme.minuto)} · horário do Acre
              </p>
            </div>
          </div>

          {/* Rola em vez de esticar: aviso longo em tela de celular empurraria o
              botão para fora da viewport, e sem o botão não há como calar o
              áudio — o alarme viraria armadilha. */}
          <p className="mt-6 sm:mt-8 text-center text-xl sm:text-3xl font-semibold text-gray-100 leading-snug whitespace-pre-line max-h-[42vh] overflow-y-auto main-scrollbar">
            {texto}
          </p>

          <button
            ref={botaoRef}
            onClick={onFechar}
            className="btn-shimmer mt-8 sm:mt-10 w-full py-4 sm:py-5 rounded-xl text-lg sm:text-xl font-bold text-white transition-colors"
            style={{
              background: 'linear-gradient(135deg, #ca9a00 0%, #D4AF37 60%, #e8c84a 100%)',
              border: '1px solid rgba(212,175,55,0.4)',
            }}
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
