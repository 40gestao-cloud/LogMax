import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import type { UserProfile } from '../hooks/useUserProfile';

// O disparo da recarga remota (migr. 564), num componente só porque tem dois
// lugares legítimos de onde apertar:
//
//   • Modo Aula        — onde o professor conduz a turma;
//   • TI & Suporte     — onde ele VÊ as máquinas, e portanto onde percebe que
//                        alguma está com versão velha ou relógio fora de hora.
//
// Duplicar o insert e o texto de confirmação nos dois seria a receita para os
// dois divergirem no primeiro ajuste.

export function BotaoRecarregarTurma({
  profile, showToast, className,
}: {
  profile: UserProfile | null;
  showToast?: (msg: string, tipo?: string, autoHide?: boolean) => void;
  className?: string;
}) {
  const confirmar = useConfirm();
  const [enviando, setEnviando] = useState(false);

  // `role = 'admin'` literal: a RLS recusa CEO e conselheiro, que aqui são
  // alunos — botão que só dá erro é pior que botão nenhum.
  if (profile?.role !== 'admin') return null;

  const disparar = async () => {
    if (!supabase) { showToast?.('Supabase não configurado', 'error'); return; }
    if (!await confirmar(
      'Recarregar a tela de todas as máquinas?\n\n'
      + 'Cada aluno vê um aviso e a tela recarrega em 10 segundos, com o cache limpo — '
      + 'é o Ctrl+Shift+R aplicado à turma inteira, e alcança também a SUA máquina.')) return;

    setEnviando(true);
    try {
      const { error } = await supabase.from('comandos_turma').insert({
        tipo:             'recarregar',
        emitido_por:      profile?.id ?? null,
        emitido_por_nome: profile?.nome ?? null,
      });
      if (error) throw error;
      showToast?.('Comando enviado — as máquinas conectadas recarregam em 10 s.', 'success', true);
    } catch (err: any) {
      showToast?.(err?.message ?? 'Falha ao enviar o comando.', 'error', true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={disparar}
      disabled={enviando}
      className={className ?? 'px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 transition-colors disabled:opacity-50 shrink-0'}
    >
      {enviando ? '…' : 'Recarregar turma'}
    </button>
  );
}
