import { useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { dentroDaValidade, jaExecutado, type ComandoTurma } from '../lib/comandosTurma';

// Escuta o comando de recarga do professor (migr. 564).
//
// Vive no `App.tsx`, acima dos early returns, pelo mesmo motivo do alarme da
// aula: precisa valer em QUALQUER tela. Dentro de uma view morreria na primeira
// troca de menu — e o comando existe justamente para alcançar quem está no meio
// de outra coisa.
//
// Duas portas, porque uma só não cobre a sala:
//   • realtime  → quem está com o app aberto recebe na hora;
//   • consulta no boot → quem estava fechado obedece ao abrir, se o comando
//     ainda estiver dentro da validade.

export function useComandoRecarga(enabled: boolean): ComandoTurma | null {
  const [comando, setComando] = useState<ComandoTurma | null>(null);
  // Evita reabrir o modal para o mesmo comando quando realtime e consulta
  // inicial chegam quase juntos.
  const vistoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) return;
    const sb = supabase;
    let vivo = true;

    const considerar = (c: ComandoTurma | null) => {
      if (!vivo || !c) return;
      if (vistoRef.current === c.id) return;
      if (jaExecutado(c.id) || !dentroDaValidade(c)) return;
      vistoRef.current = c.id;
      setComando(c);
    };

    // Porta 1: o que já estava lá quando este cliente abriu.
    sb.from('comandos_turma')
      .select('id, tipo, motivo, emitido_por_nome, created_at')
      .eq('tipo', 'recarregar')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => considerar(data as ComandoTurma | null));

    // Porta 2: o que chegar daqui para a frente. Nome de canal único por
    // instância — canal com nome fixo montado duas vezes derruba a si mesmo.
    const sufixo = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = sb
      .channel(`comandos-turma-${sufixo}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comandos_turma' },
        payload => considerar(payload.new as ComandoTurma))
      .subscribe();

    return () => { vivo = false; sb.removeChannel(ch); };
  }, [enabled]);

  return comando;
}
