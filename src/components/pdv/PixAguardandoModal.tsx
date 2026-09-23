import { QRCodeSVG } from 'qrcode.react';
import { trapTab } from '../../lib/focoPdv';
import { codigoCobranca } from '../../lib/cobranca';
import { buildPixQrValue } from '../../lib/pixQr';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK, MONEY, RED } from './coresMaxPos';

// PIX aguardando no PDV SuperMax. A espera (realtime + polling) é da view,
// via usePagamentoPendente; aqui é a tela. Esc não cancela direto: pede
// confirmação, porque encostar no Esc cancelava um PIX a um segundo de ser pago.
// Com `erro`, o PIX já foi pago e a venda não gravou: a tela troca o texto
// pelo aviso e pelo "Tentar Novamente".
// `linha`: PIX parcial do misto — confirmado, o valor entra na lista e o
// operador volta ao pagamento; não fecha a venda.
export function PixAguardandoModal({
  cobranca, linha = false, erro, processando, onTentarDeNovo, confirmando, onConfirmando, onCancelar,
}: {
  cobranca: { id: string; valor: number };
  linha?: boolean;
  erro: string | null;
  processando: boolean;
  onTentarDeNovo: () => void;
  confirmando: boolean;
  onConfirmando: (v: boolean) => void;
  onCancelar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      tabIndex={-1}
      // contains(activeElement): a callback ref roda a cada render (nova
      // identidade sempre); sem a guarda o foco era arrancado de volta pro
      // overlay a cada refetch/tick enquanto o cliente pagava.
      ref={(el) => { if (el && !confirmando && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
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
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Aguardando pagamento</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">PIX</div>
        </div>
        <div className="p-6 space-y-4 text-center">
          {/* QR didático — payload tem id+valor; o MaxBank lê e marca
              como 'pago', daí o realtime fecha a venda. Não é PIX real
              (BR Code do BACEN), só simulação pedagógica. */}
          <div className="flex justify-center">
            <div className="p-3 bg-white border-4" style={{ borderColor: NAVY_DARK }}>
              <QRCodeSVG
                value={buildPixQrValue(cobranca.id)}
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
            {/* O mesmo número que a MaxPay mostra no desempate. */}
            <div className="text-xs font-black uppercase tracking-widest text-gray-600 mt-2">
              Cobrança nº <span className="font-mono tracking-normal" style={{ color: NAVY_DARK }}>{codigoCobranca(cobranca.id)}</span>
            </div>
          </div>
          {erro ? (
            <div className="border-2 p-4 space-y-3 text-left" style={{ borderColor: RED }}>
              <div className="text-xs font-black uppercase tracking-widest" style={{ color: RED }}>
                ⚠ PIX recebido — falha ao {linha ? 'lançar no pagamento' : 'registrar venda'}
              </div>
              <div className="text-sm text-gray-900 font-mono whitespace-pre-wrap break-words bg-gray-50 p-2 border" style={{ borderColor: '#d1d5db' }}>
                {erro}
              </div>
              <div className="text-xs text-gray-700 leading-relaxed">
                O cliente já pagou no MaxBank. <b>NÃO cancele</b> — corrija o problema acima e clique em Tentar Novamente.
              </div>
              <button
                onClick={() => onTentarDeNovo()}
                disabled={processando}
                className="w-full px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-50"
                style={{ background: NAVY_DARK }}
              >
                {processando ? 'Tentando...' : 'Tentar Novamente'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed">
              Cliente lê o QR no <b>MaxBank</b>. {linha
                ? 'Confirmado o pagamento, o valor entra na lista e você volta pra lançar o resto.'
                : 'A venda fecha sozinha quando o pagamento for confirmado.'}
              {/* A MaxPay acha a cobrança pelo VALOR (janela de 5 min), não pelo
                  QR: sem dizer isso, o operador digita um valor arredondado,
                  a maquininha não casa nada e fica em "aguardando" para sempre. */}
              <br /><span className="text-gray-600">Pela <b>MaxPay</b>, cobre <b>este mesmo valor</b> — é assim que ela acha a cobrança.
              Havendo outra do mesmo valor, ela pergunta qual: informe o <b>nº acima</b>.</span>
            </p>
          )}
          <button
            onClick={() => onConfirmando(true)}
            className="w-full px-4 py-3 border-2 text-gray-700 font-bold uppercase text-sm tracking-wide"
            style={{ borderColor: '#9ca3af' }}
          >
            {erro ? 'Descartar (PIX já pago — vai perder o registro)' : 'Cancelar PIX'}
          </button>
        </div>
      </div>

      {/* Sub-modal: confirma cancelamento — protege contra Esc por engano */}
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
              <div className="text-2xl font-black tracking-wide mt-0.5">Cancelar PIX?</div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Se o cliente já confirmou o pagamento no MaxBank, este cancelamento <b>não estorna</b> o valor — é só do nosso lado. Continue só se o cliente desistiu.
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
                  Cancelar PIX (Enter)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
