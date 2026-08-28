import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { AVISO_S, executarRecarga, marcarExecutado, type ComandoTurma } from '../lib/comandosTurma';

// Aviso da recarga remota (migr. 564).
//
// Dez segundos de contagem, e não recarga imediata: quem está com carrinho no
// PDV, contagem de inventário ou formulário preenchido precisa de um instante
// para gravar. É a mesma preocupação da régua de `naoInterromper.ts` — a
// diferença é que aqui quem decide o momento é o professor, e a régua não pode
// adiar indefinidamente uma ordem dele. Então o aviso é curto, explícito e
// sempre igual.

export function RecargaRemotaModal({ comando }: { comando: ComandoTurma }) {
  const [restante, setRestante] = useState(AVISO_S);

  useEffect(() => {
    // Marca ANTES de qualquer coisa: se o aluno recarregar na mão no meio da
    // contagem, o comando não pode ressuscitar depois do boot e recarregar de
    // novo — ficaria em laço.
    marcarExecutado(comando.id);

    const id = window.setInterval(() => {
      setRestante(s => {
        if (s <= 1) {
          window.clearInterval(id);
          void executarRecarga();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [comando.id]);

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        className="neu-card rounded-3xl p-6 max-w-md w-full text-center flex flex-col items-center gap-3"
        role="alertdialog"
        aria-live="assertive"
      >
        <div className="w-12 h-12 rounded-2xl neu-pressed flex items-center justify-center">
          <RefreshCw size={20} className="text-accent animate-spin" />
        </div>
        <h2 className="text-base font-bold text-gray-100">Atualização do sistema</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          {comando.motivo?.trim()
            ? comando.motivo
            : 'O professor está aplicando uma atualização em todas as máquinas.'}
        </p>
        {/* Sem "grave o que estiver aberto": o modal cobre a tela, então pedir
            isso aqui é mandar fazer o que não dá para fazer. O aviso diz o que
            vai acontecer e quando — e é só. */}
        <p className="text-sm text-gray-300">
          A tela vai recarregar em <span className="font-black text-accent tabular-nums">{restante}s</span>.
        </p>
        <button
          onClick={() => void executarRecarga()}
          className="neu-button px-5 py-2.5 rounded-xl text-xs font-bold text-gray-300 hover:text-accent transition-colors mt-1"
        >
          Recarregar agora
        </button>
        {comando.emitido_por_nome && (
          <p className="text-[10px] text-gray-600">Pedido por {comando.emitido_por_nome}</p>
        )}
      </motion.div>
    </div>
  );
}
