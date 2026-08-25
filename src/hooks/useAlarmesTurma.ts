import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  ACRE_HHMM, ALARME_AUDIO_URL,
  type AlarmeTipo, type AlarmeTurma,
} from '../lib/alarmes';

// =================================================================
// Alarmes da aula (migr. 529)
// =================================================================
// Dois hooks sobre a MESMA tabela, porque são dois papéis diferentes:
//
//   • `useAlarmesTurma`  — a Central de Tempo: lista e escreve.
//   • `useAlarmeGlobal`  — a shell do App: só escuta o relógio e faz
//     tocar. Fica no App.tsx justamente para sobreviver à troca de
//     view; era essa a falha do desenho antigo (o intervalo morria
//     junto com o card).
//
// O card NÃO toca nada: se os dois disparassem, quem estivesse na
// Central de Tempo ouviria dois áudios sobrepostos.
// =================================================================

async function carregar(): Promise<AlarmeTurma[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('alarmes_turma')
    .select('*')
    .order('hora', { ascending: true })
    .order('minuto', { ascending: true });
  if (error || !data) return [];
  return data as AlarmeTurma[];
}

// Assinatura realtime com nome de canal único por instância: dois hooks
// vivos ao mesmo tempo (shell + Central de Tempo aberta) com o mesmo nome
// derrubariam um ao outro.
function useRealtimeAlarmes(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    const sufixo = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const ch = sb
      .channel(`alarmes-turma-${sufixo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alarmes_turma' },
        () => onChangeRef.current())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);
}

/** Lista + escrita. Usado pela Central de Tempo. A RLS é quem barra o aluno. */
export function useAlarmesTurma() {
  const [alarmes, setAlarmes] = useState<AlarmeTurma[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setAlarmes(await carregar());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeAlarmes(load);

  const criar = useCallback(async (
    hora: number, minuto: number, tipo: AlarmeTipo, mensagem: string | null,
  ): Promise<string | null> => {
    if (!supabase) return 'Supabase não configurado.';
    const { error } = await supabase.from('alarmes_turma').insert({
      hora, minuto, tipo,
      mensagem: tipo === 'aviso' ? (mensagem ?? '').trim() : null,
      ativo: true,
    });
    if (error) {
      // O índice único de horário é o erro esperado aqui; traduzir para o
      // aluno/professor em vez de despejar o texto do Postgres.
      if (error.code === '23505') return 'Já existe um alarme nesse horário.';
      return error.message;
    }
    await load();
    return null;
  }, [load]);

  const alternar = useCallback(async (id: string, ativo: boolean) => {
    if (!supabase) return;
    await supabase.from('alarmes_turma').update({ ativo }).eq('id', id);
    await load();
  }, [load]);

  const remover = useCallback(async (id: string) => {
    if (!supabase) return;
    await supabase.from('alarmes_turma').delete().eq('id', id);
    await load();
  }, [load]);

  return { alarmes, isLoading, criar, alternar, remover, recarregar: load };
}

/**
 * Disparo global. Compara o relógio do Acre com a lista a cada segundo e só
 * age na VIRADA do minuto — senão o mesmo alarme dispararia 60x.
 *
 * O áudio é `loop` e só para no botão do modal: alarme que se cala sozinho
 * depois de 3 segundos não interrompe ninguém, que é o ponto da coisa.
 */
export function useAlarmeGlobal(enabled: boolean) {
  const [alarmes, setAlarmes] = useState<AlarmeTurma[]>([]);
  const [disparo, setDisparo] = useState<AlarmeTurma | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setAlarmes(await carregar());
  }, [enabled]);

  useEffect(() => { load(); }, [load]);
  useRealtimeAlarmes(load);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const alarmesRef = useRef(alarmes);
  useEffect(() => { alarmesRef.current = alarmes; }, [alarmes]);
  const disparoRef = useRef(disparo);
  useEffect(() => { disparoRef.current = disparo; }, [disparo]);

  const silenciar = useCallback(() => {
    setDisparo(null);
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Guarda o minuto em que o hook montou SEM disparar: quem abre o app
    // 09:30:40 não deve levar o alarme das 09:30 na cara.
    let ultimoMinuto = ACRE_HHMM.format(new Date());
    const tick = () => {
      const hhmm = ACRE_HHMM.format(new Date());
      if (hhmm === ultimoMinuto) return;
      ultimoMinuto = hhmm;
      if (disparoRef.current) return; // um modal por vez
      const [h, m] = hhmm.split(':').map(n => Number.parseInt(n, 10));
      const hit = alarmesRef.current.find(a => a.ativo && a.hora === h && a.minuto === m);
      if (!hit) return;
      setDisparo(hit);
      try {
        if (!audioRef.current) {
          audioRef.current = new Audio(ALARME_AUDIO_URL);
          audioRef.current.loop = true;
          audioRef.current.volume = 0.7;
        }
        audioRef.current.currentTime = 0;
        const p = audioRef.current.play();
        // Autoplay bloqueado (aba sem interação): o modal continua na tela,
        // que é a parte que não pode falhar.
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {}
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  // Ao desmontar (logout), nada de som órfão tocando na tela de login.
  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { try { a.pause(); } catch {} }
    audioRef.current = null;
  }, []);

  return { disparo, silenciar };
}
