import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Coffee, LogOut } from 'lucide-react';
import { ALARME_TITULO, textoDoAlarme, pad2, type AlarmeTurma } from '../lib/alarmes';

interface Props {
  alarme: AlarmeTurma;
  onFechar: () => void;
}

// Cada tipo com ícone e cor próprios: no meio da tela, quem olha de longe
// reconhece "intervalo" pela cor antes de ler a frase.
const ESTILO: Record<AlarmeTurma['tipo'], { icone: any; cor: string; fundo: string; borda: string }> = {
  aviso:     { icone: AlertTriangle, cor: '#D4AF37', fundo: 'rgba(212,175,55,0.12)', borda: 'rgba(212,175,55,0.30)' },
  intervalo: { icone: Coffee,        cor: '#4ade80', fundo: 'rgba(74,222,128,0.12)', borda: 'rgba(74,222,128,0.30)' },
  saida:     { icone: LogOut,        cor: '#60a5fa', fundo: 'rgba(96,165,250,0.12)', borda: 'rgba(96,165,250,0.30)' },
};

/**
 * Modal central do alarme (migr. 529). Renderizado na shell do App, por isso
 * aparece em qualquer tela.
 *
 * Não fecha no backdrop nem no Esc de propósito — o alarme existe para
 * interromper, e o áudio só para no botão. Mesma decisão do
 * `SessaoExpirandoModal`.
 */
export function AlarmeModal({ alarme, onFechar }: Props) {
  const [visivel, setVisivel] = useState(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const { icone: Icone, cor, fundo, borda } = ESTILO[alarme.tipo];
  const texto = textoDoAlarme(alarme.tipo, alarme.mensagem);

  useEffect(() => {
    requestAnimationFrame(() => setVisivel(true));
    botaoRef.current?.focus();
  }, [alarme.id]);

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alarme-titulo"
      style={{ transition: 'opacity 180ms', opacity: visivel ? 1 : 0 }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-md"
        style={{
          transition: 'transform 180ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms',
          transform: visivel ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(10px)',
          opacity: visivel ? 1 : 0,
        }}
      >
        <div
          style={{
            background: 'rgba(10,10,10,0.90)',
            border: `1px solid ${borda}`,
            borderRadius: '1rem',
            padding: '1.5rem',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.06) inset',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 animate-pulse"
              style={{ background: fundo, border: `1px solid ${borda}` }}
            >
              <Icone size={22} style={{ color: cor }} />
            </div>
            <div>
              <h2 id="alarme-titulo" className="text-base font-bold text-gray-100">
                {ALARME_TITULO[alarme.tipo]}
              </h2>
              <p className="text-xs text-gray-500 font-mono tabular-nums">
                {pad2(alarme.hora)}:{pad2(alarme.minuto)} · horário do Acre
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-200 leading-relaxed mb-6 whitespace-pre-line">
            {texto}
          </p>

          <div className="flex justify-end">
            <button
              ref={botaoRef}
              onClick={onFechar}
              className="btn-shimmer px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
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
    </div>
  );
}
