import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
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
function useRealtimeAlarmes(onChange: () => void, enabled = true) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    return assinarRealtime({
      nome: 'alarmes-turma',
      alvos: ['alarmes_turma'],
      aoMudar: () => onChangeRef.current(),
    });
  }, [enabled]);
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

  // Editar em vez de apagar-e-recriar: mudar o horário de um alarme que a
  // turma inteira já enxerga era, até aqui, excluir e cadastrar de novo — e
  // no meio do caminho o alarme sumia da tela de todo mundo.
  const editar = useCallback(async (
    id: string, hora: number, minuto: number, tipo: AlarmeTipo, mensagem: string | null,
  ): Promise<string | null> => {
    if (!supabase) return 'Supabase não configurado.';
    const { error } = await supabase.from('alarmes_turma').update({
      hora, minuto, tipo,
      // Trocar `aviso` por um tipo de texto fixo tem de LIMPAR a mensagem:
      // deixá-la ali guardaria um texto que ninguém mais vê e que voltaria
      // sozinho se o tipo fosse revertido.
      mensagem: tipo === 'aviso' ? (mensagem ?? '').trim() : null,
    }).eq('id', id);
    if (error) {
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

  return { alarmes, isLoading, criar, editar, alternar, remover, recarregar: load };
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
  useRealtimeAlarmes(load, enabled);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const alarmesRef = useRef(alarmes);
  useEffect(() => { alarmesRef.current = alarmes; }, [alarmes]);
  const disparoRef = useRef(disparo);
  useEffect(() => { disparoRef.current = disparo; }, [disparo]);

  // Silenciar de verdade é mais que `pause()`. Quando o `play()` anterior ainda
  // está pendente, o pause chega antes de a promessa resolver e o navegador
  // retoma a reprodução ao resolvê-la — é isso que produz o "apertei Entendi e
  // não parou". Então: para, volta ao início, MUDA e desliga o loop. Se algo
  // retomar, retoma calado e não repete.
  const pararAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.loop = false;
      a.muted = true;
      a.pause();
      a.currentTime = 0;
    } catch {}
  }, []);

  const silenciar = useCallback(() => {
    setDisparo(null);
    pararAudio();
  }, [pararAudio]);

  // O navegador só deixa tocar áudio depois de algum gesto do usuário, e em
  // parte deles a permissão fica no ELEMENTO, não na página. Por isso o
  // elemento é criado e "abençoado" no primeiro clique/tecla — mudo, para
  // não soltar nenhum bip — em vez de ser criado no instante do disparo,
  // que pode acontecer horas depois do último gesto.
  useEffect(() => {
    if (!enabled) return;
    const preparar = () => {
      if (audioRef.current) return;
      try {
        const a = new Audio(ALARME_AUDIO_URL);
        a.loop = true;
        a.volume = 0.7;
        a.muted = true;
        const p = a.play();
        const encerrar = () => { try { a.pause(); a.currentTime = 0; a.muted = false; } catch {} };
        if (p && typeof p.then === 'function') p.then(encerrar).catch(encerrar);
        else encerrar();
        audioRef.current = a;
      } catch {}
    };
    window.addEventListener('pointerdown', preparar, { once: true });
    window.addEventListener('keydown', preparar, { once: true });
    return () => {
      window.removeEventListener('pointerdown', preparar);
      window.removeEventListener('keydown', preparar);
    };
  }, [enabled]);

  useEffect(() => {
    // Saiu a sessão (logout, expiração por inatividade): cala o som e some
    // com o modal. Sem isto o áudio ficaria em loop na tela de login, sem
    // botão nenhum para pará-lo, e o modal velho reapareceria no próximo
    // login como se o alarme tivesse acabado de tocar.
    if (enabled) return;
    setDisparo(null);
    pararAudio();
  }, [enabled, pararAudio]);

  // Desligar (ou apagar) o alarme na Central de Tempo cala TODAS as telas.
  // Era o furo relatado pelo professor: o alarme começava a tocar em 45
  // máquinas e não havia nada que o parasse de fora — cada pessoa tinha de
  // apertar "Entendi" na sua. A lista já chega por realtime; o que faltava era
  // reagir a ela quando o alarme que está tocando sai do ar.
  useEffect(() => {
    if (!disparo) return;
    const aindaValendo = alarmes.some(a => a.id === disparo.id && a.ativo);
    if (aindaValendo) return;
    setDisparo(null);
    pararAudio();
  }, [alarmes, disparo, pararAudio]);

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
          audioRef.current.volume = 0.7;
        }
        // `loop` e `muted` são religados AQUI porque `pararAudio` os desliga
        // — é o que garante que um play() pendente não volte a tocar sozinho.
        audioRef.current.loop = true;
        audioRef.current.muted = false;
        audioRef.current.currentTime = 0;
        const p = audioRef.current.play();
        // Autoplay bloqueado (aba que nunca recebeu um clique): o modal
        // continua na tela, que é a parte que não pode falhar.
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {}
    };
    // 1s de intervalo com aba em segundo plano vira ~1x por minuto (o
    // navegador estrangula timers de aba oculta). A comparação é por minuto
    // do relógio, e não por contagem de ticks, justamente para o alarme
    // sobreviver a isso — no pior caso ele atrasa alguns segundos.
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  // Ao desmontar, nada de som órfão.
  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { try { a.pause(); } catch {} }
    audioRef.current = null;
  }, []);

  return { disparo, silenciar };
}
