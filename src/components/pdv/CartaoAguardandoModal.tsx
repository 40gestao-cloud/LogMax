import { QRCodeSVG } from 'qrcode.react';
import { codigoCobranca } from '../../lib/cobranca';
import { buildCartaoQrValue } from '../../lib/pixQr';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY, RED } from './coresMaxPos';

// Maquininha aguardando no PDV SuperMax (MaxPay/MaxBank autoriza). A espera é
// da view, via usePagamentoPendente. Esc pede confirmação antes de cancelar.
// `linha`: cartão parcial do misto — autorizado, vira linha; não fecha a venda.
export function CartaoAguardandoModal({ cobranca, linha = false, confirmando, onConfirmando, onCancelar }: {
  cobranca: { id: string; valor: number; metodo: 'debito' | 'credito'; parcelas: number };
  linha?: boolean;
  confirmando: boolean;
  onConfirmando: (v: boolean) => void;
  onCancelar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      tabIndex={-1}
      ref={(el) => { if (el && !confirmando && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !confirmando) {
          e.preventDefault(); e.stopPropagation();
          onConfirmando(true);
          return;
        }
        if (/^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Aguardando maquininha</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">
            Cartão {cobranca.metodo === 'debito' ? 'Débito' : 'Crédito'}
            {cobranca.parcelas > 1 && ` ${cobranca.parcelas}x`}
          </div>
        </div>
        <div className="p-6 space-y-4 text-center">
          <div className="flex justify-center">
            <div className="p-3 bg-white border-4" style={{ borderColor: NAVY_DARK }}>
              <QRCodeSVG
                value={buildCartaoQrValue(cobranca.id)}
                size={220}
                level="M"
              />
            </div>
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-gray-600 mb-1">Valor</div>
            <div className="text-4xl font-black tabular-nums" style={{ color: MONEY }}>
              R$ {formatBRL(cobranca.valor)}
            </div>
            <div className="text-xs font-black uppercase tracking-widest text-gray-600 mt-2">
              Cobrança nº <span className="font-mono tracking-normal" style={{ color: NAVY_DARK }}>{codigoCobranca(cobranca.id)}</span>
            </div>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            Operador digita o valor na <b>MaxPay</b> e o cliente aproxima o cartão (lendo o QR no <b>MaxBank</b>). {linha
              ? 'Autorizado, o valor entra na lista e você volta pra lançar o resto.'
              : 'A venda fecha sozinha quando for autorizado.'}{' '}
            Se a maquininha perguntar qual cobrança é, informe o <b>nº acima</b>.
          </p>
          <button
            onClick={() => onConfirmando(true)}
            className="w-full px-4 py-3 border-2 text-gray-700 font-bold uppercase text-sm tracking-wide"
            style={{ borderColor: '#9ca3af' }}
          >
            Cancelar Cartão
          </button>
        </div>
      </div>

      {confirmando && (
        <div
          className="fixed inset-0 z-[215] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          tabIndex={-1}
          ref={(el) => { if (el) el.focus(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onConfirmando(false); return; }
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onCancelar(); return; }
            if (/^F\d+$/.test(e.key)) e.stopPropagation();
          }}
        >
          <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: RED }}>
            <div className="px-5 py-4 text-white" style={{ background: RED }}>
              <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Confirmar</div>
              <div className="text-2xl font-black tracking-wide mt-0.5">Cancelar Cartão?</div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Se o cliente já autorizou no MaxBank, este cancelamento <b>não estorna</b> o valor — é só do nosso lado.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onConfirmando(false)}
                  autoFocus
                  className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
                  style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                >
                  Voltar (Esc)
                </button>
                <button
                  onClick={() => onCancelar()}
                  className="flex-1 px-4 py-3 text-white font-black uppercase tracking-wide text-sm"
                  style={{ background: RED }}
                >
                  Cancelar (Enter)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
