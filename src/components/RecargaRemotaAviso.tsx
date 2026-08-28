import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { AVISO_S, executarRecarga, marcarExecutado, type ComandoTurma } from '../lib/comandosTurma';

// Aviso da recarga remota (migr. 564).
//
// Nasceu como MODAL, com fundo escuro cobrindo a tela, e era uma contradição:
// o texto mandava gravar o que estivesse aberto e o próprio aviso tapava o
// botão de gravar. Dez segundos de instrução impossível de cumprir.
//
// Virou tarja no topo, sem backdrop e sem prender o foco: durante a contagem o
// aluno continua clicando em Salvar, fechando a venda, terminando a linha da
// requisição. É o mesmo desenho do banner de atualização da PWA, e pelo mesmo
// motivo — quem está a trabalhar precisa continuar a trabalhar enquanto lê.

export function RecargaRemotaAviso({ comando }: { comando: ComandoTurma }) {
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
    <motion.div
      initial={{ y: -72, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10001,
        background: 'linear-gradient(135deg, #0369A1, #075985)',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      {/* Medido no navegador: com o texto todo numa coluna estreita a tarja
          passava de 200 px de altura e engolia a topbar do telemóvel. O
          essencial — o que é e quantos segundos faltam — fica sempre; o resto
          só aparece quando há largura para ele. */}
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-4">
        <RefreshCw size={15} className="shrink-0 animate-spin" />
        <div className="min-w-0 flex-1 text-[0.72rem] leading-snug sm:text-[0.78rem]">
          <span className="font-extrabold">
            {comando.motivo?.trim() || 'Atualização do sistema'}
          </span>
          {/* Sem "grave o que estiver aberto": pedir isso e não dar como fazer
              é pior que não pedir nada. Quem precisa gravar continua com a tela
              livre — a tarja não prende o foco —, e quem não precisa não leva
              um susto de dez segundos. A tarja diz o que vai acontecer e
              quando; o resto é decisão de quem está na frente dela. */}
          <span className="font-semibold opacity-95"> — recarrega em {restante}s.</span>
          {comando.emitido_por_nome && (
            <span className="hidden font-semibold opacity-70 md:inline"> · pedido por {comando.emitido_por_nome}</span>
          )}
        </div>
        <span className="shrink-0 text-base font-black tabular-nums sm:text-lg">{restante}s</span>
        <button
          type="button"
          onClick={() => void executarRecarga()}
          className="shrink-0 rounded-lg border border-white/45 px-3 py-1.5 text-[0.65rem] font-extrabold uppercase tracking-wider hover:bg-white/10"
        >
          Recarregar agora
        </button>
      </div>
    </motion.div>
  );
}
