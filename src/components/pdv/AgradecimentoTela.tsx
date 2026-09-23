import { YELLOW, YELLOW_DARK, NAVY_DARK } from './coresMaxPos';

// Tela final de agradecimento do PDV SuperMax. Só o Enter fecha — as outras
// teclas param aqui, para o próximo cliente não disparar atalho do caixa.
export function AgradecimentoTela({ onContinuar }: { onContinuar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[320] flex items-center justify-center"
      style={{ background: 'rgba(255,255,255,0.98)' }}
      tabIndex={-1}
      ref={(el) => { if (el) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          onContinuar();
        } else {
          e.stopPropagation();
        }
      }}
    >
      <div className="flex flex-col items-center justify-center text-center px-8 py-6 max-h-screen w-full">
        <img
          src="/icon-supermax.png"
          alt="SuperMax"
          className="object-contain drop-shadow-2xl"
          style={{ maxHeight: '60vh', maxWidth: '70vw', width: 'auto', height: 'auto' }}
          draggable={false}
        />
        <div className="mt-4 text-3xl md:text-4xl lg:text-5xl font-black tracking-wide shrink-0" style={{ color: NAVY_DARK }}>
          Agradecemos a sua preferência
        </div>
        <div
          className="mt-5 px-6 py-3 rounded-full text-sm md:text-base font-black uppercase tracking-[0.3em] animate-pulse shrink-0"
          style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
        >
          Pressione ENTER para continuar
        </div>
      </div>
    </div>
  );
}
