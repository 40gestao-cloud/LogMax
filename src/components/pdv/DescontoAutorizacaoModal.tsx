import { Loader2 } from 'lucide-react';
import { trapTab } from '../../lib/focoPdv';
import { formatBRL } from '../../lib/viewUtils';
import { NAVY_DARK } from './coresMaxPos';

// Autorização do gerente para o desconto (o "desconto supervisionado" dos PDVs
// de supermercado: o operador pede, o gerente libera). Os campos ficam na view,
// que confere a senha em `confirmarAutorizacaoDesconto`.
export function DescontoAutorizacaoModal({
  valor, filial, motivo, onMotivo, obs, onObs, email, onEmail, senha, onSenha, carregando, onAutorizar, onCancelar,
}: {
  valor: number;
  filial: string;
  motivo: string;
  onMotivo: (v: string) => void;
  obs: string;
  onObs: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  senha: string;
  onSenha: (v: string) => void;
  carregando: boolean;
  onAutorizar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[205] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      tabIndex={-1}
      ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { trapTab(e, e.currentTarget as HTMLElement); return; }
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          onCancelar();
          return;
        }
        if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
          e.preventDefault(); e.stopPropagation();
          if (!carregando) onAutorizar();
          return;
        }
        if (e.key.length === 1 || /^F\d+$/.test(e.key)) e.stopPropagation();
      }}
    >
      <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ borderColor: NAVY_DARK }}>
        <div className="px-5 py-4 text-white" style={{ background: NAVY_DARK }}>
          <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Autorização do gerente</div>
          <div className="text-2xl font-black tracking-wide mt-0.5">Desconto de R$ {formatBRL(valor)}</div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-600 leading-relaxed">
            No caixa, desconto sai com o gerente de <b>{filial}</b> — é para divergência de etiqueta
            e avaria, não para negociação. Promoção já vem no preço. O motivo fica gravado na venda.
          </p>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Motivo</label>
            <select
              value={motivo}
              onChange={(e) => onMotivo(e.target.value)}
              className="w-full bg-white border-2 text-sm font-bold px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            >
              <option>Divergência de preço na gôndola</option>
              <option>Produto avariado</option>
              <option>Produto perto do vencimento</option>
              <option value="Outro">Outro (descrever)</option>
            </select>
          </div>
          {motivo === 'Outro' && (
            <input
              type="text"
              maxLength={120}
              value={obs}
              onChange={(e) => onObs(e.target.value)}
              placeholder="Descreva o motivo"
              className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af' }}
            />
          )}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">E-mail do gerente</label>
            <input
              autoFocus
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
              placeholder="gerente@empresa.com"
              className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af' }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">Senha</label>
            <input
              type="password"
              autoComplete="new-password"
              value={senha}
              onChange={(e) => onSenha(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white border-2 text-sm px-3 py-2 outline-none focus:border-blue-700"
              style={{ borderColor: '#9ca3af' }}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onCancelar()}
              className="flex-1 px-4 py-3 border-2 font-black uppercase tracking-wide text-sm"
              style={{ borderColor: '#9ca3af', color: NAVY_DARK }}
            >
              Cancelar
            </button>
            <button
              onClick={() => onAutorizar()}
              disabled={carregando}
              className="flex-[2] px-4 py-3 text-white font-black uppercase tracking-wide text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: NAVY_DARK }}
            >
              {carregando ? <><Loader2 size={16} className="animate-spin" /> Conferindo…</> : 'Autorizar (Enter)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
