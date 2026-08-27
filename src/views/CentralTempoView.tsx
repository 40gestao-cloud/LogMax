import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock, AlarmClock, Timer as TimerIcon, Hourglass,
  Play, Pause, RotateCcw, Flag, Plus, Trash2,
} from 'lucide-react';
import { useUserProfile } from '../hooks/useUserProfile';
import { useAlarmesTurma } from '../hooks/useAlarmesTurma';
import {
  ALARME_TIPOS, ALARME_TITULO, textoDoAlarme, ACRE_HHMM, pad2,
  type AlarmeTipo, type AlarmeTurma,
} from '../lib/alarmes';
// `pad2` vem de lib/alarmes — a cópia local que existia aqui era idêntica.

// =================================================================
// LogMax — Central de Tempo
// =================================================================
// Quatro ferramentas operacionais: relógio (Acre), alarmes, cronômetro
// com voltas e timer regressivo. Relógio, cronômetro e timer são 100%
// client-side; os alarmes passaram a viver no banco na migr. 529, porque
// alarme que só existe no navegador de quem cadastrou não avisa a turma.
//
// Áudio: arquivos esperados em public/sounds/. Se ausentes, o som
// falha em silêncio (catch no play) — mesma política do PDV.
// =================================================================

const TIMER_AUDIO_URL = '/sounds/timer-end.mp3';

// Fuso obrigatório do Acre. `Intl.DateTimeFormat` resolve UTC ↔ local
// sem depender da máquina do usuário (turma pode estar em qualquer
// fuso e o LogMax precisa alinhar com a operação Acre).
const ACRE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  hour:   '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ACRE_DATE = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  weekday: 'long',
  day:     '2-digit',
  month:   'long',
  year:    'numeric',
});

const pad3 = (n: number) => String(n).padStart(3, '0');

// Cabeçalho neumórfico reutilizado pelos 4 cards.
function CardHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-11 h-11 neu-circle flex items-center justify-center text-accent shrink-0">
        <Icon size={18} />
      </div>
      <div>
        <h3 className="text-sm font-bold text-gray-200">{title}</h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{subtitle}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 1. RELÓGIO DIGITAL — Acre (America/Rio_Branco)
// ─────────────────────────────────────────────────────────────────
function RelogioCard() {
  // Estado guarda só o snapshot atual; setInterval é a fonte de verdade
  // do tick. useRef garante limpeza correta mesmo se o componente
  // remontar várias vezes (StrictMode em dev).
  const [now, setNow] = useState<Date>(new Date());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setNow(new Date());
    tickRef.current = setInterval(() => setNow(new Date()), 1000);
    return () => {
      if (tickRef.current !== null) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, []);

  const hora    = ACRE_FORMATTER.format(now);
  const dataStr = ACRE_DATE.format(now);

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col">
      <CardHeader icon={Clock} title="Relógio Digital" subtitle="Acre · America/Rio_Branco" />
      <div className="neu-pressed rounded-2xl py-8 px-4 flex flex-col items-center justify-center gap-2 border border-white/5">
        <div className="font-mono tabular-nums text-5xl sm:text-6xl font-black text-accent tracking-tight">
          {hora}
        </div>
        <p className="text-[11px] uppercase tracking-widest text-gray-500 font-bold text-center">
          {dataStr}
        </p>
      </div>
      <p className="text-[10px] text-gray-600 mt-4 text-center leading-relaxed">
        Fuso travado independente do horário do dispositivo.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 2. GERENCIADOR DE ALARMES — banco + realtime (migr. 529)
// ─────────────────────────────────────────────────────────────────
// Antes: LocalStorage e som tocando aqui dentro. O alarme morria ao
// trocar de view e só existia no navegador de quem cadastrou.
// Agora: a lista vive no banco, chega em realtime na turma inteira e
// QUEM TOCA é a shell do App (useAlarmeGlobal), que não desmonta.
// Este card só cadastra e lista — nada de áudio aqui, senão quem
// estivesse nesta tela ouviria dois alarmes sobrepostos.
function AlarmesCard() {
  const { profile } = useUserProfile();
  const { alarmes, isLoading, criar, alternar, remover } = useAlarmesTurma();
  // Escrita é só do professor (`role = 'admin'` literal, igual à RLS da
  // migr. 529): alarme interrompe a tela de 45 pessoas.
  const podeGerenciar = profile?.role === 'admin';

  const [hourIn, setHourIn]     = useState('07');
  const [minIn, setMinIn]       = useState('00');
  const [tipo, setTipo]         = useState<AlarmeTipo>('aviso');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro]         = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Que minuto é agora no Acre — para marcar o alarme que está TOCANDO e
  // oferecer o botão que o cala em todas as telas. 10s é folga suficiente:
  // o que se quer é o minuto, não o segundo.
  const [agora, setAgora] = useState(() => ACRE_HHMM.format(new Date()));
  useEffect(() => {
    const id = setInterval(() => setAgora(ACRE_HHMM.format(new Date())), 10_000);
    return () => clearInterval(id);
  }, []);
  const tocandoAgora = (a: AlarmeTurma) => a.ativo && `${pad2(a.hora)}:${pad2(a.minuto)}` === agora;

  const addAlarm = async () => {
    const h = Number.parseInt(hourIn, 10);
    const m = Number.parseInt(minIn, 10);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return;
    if (tipo === 'aviso' && !mensagem.trim()) {
      setErro('Escreva a mensagem do aviso.');
      return;
    }
    setSalvando(true);
    const falha = await criar(h, m, tipo, mensagem);
    setSalvando(false);
    setErro(falha);
    if (!falha) setMensagem('');
  };

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col">
      <CardHeader icon={AlarmClock} title="Alarmes" subtitle="Toca para a turma · em qualquer tela" />

      {podeGerenciar ? (
        <>
          <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
            O alarme toca na tela de todo mundo até cada pessoa apertar “Entendi”.
            Para calar a turma inteira de uma vez, desligue o alarme aqui enquanto
            ele estiver tocando.
          </p>
          <div className="flex items-end gap-2 mb-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <label htmlFor="alarme-hora" className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Hora</label>
              <input id="alarme-hora" type="number" min={0} max={23} value={hourIn}
                onChange={e => setHourIn(e.target.value)}
                onBlur={e => setHourIn(pad2(Math.min(23, Math.max(0, Number.parseInt(e.target.value, 10) || 0))))}
                className="neu-input py-2 px-3 rounded-xl text-sm font-mono tabular-nums w-full text-center" />
            </div>
            <span className="text-2xl font-black text-gray-600 pb-1">:</span>
            <div className="flex flex-col gap-1.5 flex-1">
              <label htmlFor="alarme-min" className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Minuto</label>
              <input id="alarme-min" type="number" min={0} max={59} value={minIn}
                onChange={e => setMinIn(e.target.value)}
                onBlur={e => setMinIn(pad2(Math.min(59, Math.max(0, Number.parseInt(e.target.value, 10) || 0))))}
                className="neu-input py-2 px-3 rounded-xl text-sm font-mono tabular-nums w-full text-center" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 mb-3">
            <label htmlFor="alarme-tipo" className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Tipo</label>
            <select id="alarme-tipo" value={tipo}
              onChange={e => { setTipo(e.target.value as AlarmeTipo); setErro(null); }}
              className="neu-input py-2 px-3 rounded-xl text-sm w-full">
              {ALARME_TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
            </select>
          </div>

          {/* Intervalo e Fim de Expediente têm texto fixo (src/lib/alarmes.ts):
              mostrar o texto em vez de um campo evita a impressão de que dá
              para reescrever procedimento da operação por alarme. */}
          {tipo === 'aviso' ? (
            <div className="flex flex-col gap-1.5 mb-3">
              <label htmlFor="alarme-msg" className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Mensagem do aviso</label>
              <textarea id="alarme-msg" rows={2} value={mensagem} maxLength={300}
                onChange={e => { setMensagem(e.target.value); setErro(null); }}
                placeholder="O que a turma precisa ler quando o alarme tocar"
                className="neu-input py-2 px-3 rounded-xl text-sm w-full resize-none" />
            </div>
          ) : (
            <p className="text-[11px] text-gray-500 leading-relaxed mb-3 neu-pressed rounded-xl p-3 border border-white/5">
              {textoDoAlarme(tipo)}
            </p>
          )}

          {erro && <p className="text-[11px] text-red-400 mb-2">{erro}</p>}

          <button onClick={addAlarm} disabled={salvando}
            className="neu-button rounded-xl px-4 py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-accent hover:bg-accent/5 transition-colors mb-4 disabled:opacity-40">
            <Plus size={14} /> {salvando ? 'Salvando…' : 'Adicionar alarme'}
          </button>
        </>
      ) : (
        <p className="text-[11px] text-gray-500 leading-relaxed mb-4">
          Os alarmes são definidos pelo professor. Quando o horário chegar, o
          aviso aparece na sua tela — esteja você em qualquer módulo.
        </p>
      )}

      <div className="flex flex-col gap-2 flex-1 min-h-[120px]">
        {isLoading ? (
          <p className="text-xs text-gray-600 text-center py-6">Carregando…</p>
        ) : alarmes.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center py-6">
            <p className="text-xs text-gray-600">Nenhum alarme cadastrado.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {alarmes.map(a => (
              <motion.div key={a.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                className="neu-pressed rounded-xl p-3 flex items-center gap-3 border"
                style={{ borderColor: tocandoAgora(a) ? 'rgba(212,175,55,0.45)' : 'rgba(255,255,255,0.05)' }}>
                <span className={`font-mono tabular-nums text-lg font-black shrink-0 ${a.ativo ? 'text-accent' : 'text-gray-600'}`}>
                  {pad2(a.hora)}:{pad2(a.minuto)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    {ALARME_TITULO[a.tipo]}
                    {tocandoAgora(a) && (
                      <span className="ml-2 text-accent animate-pulse">· tocando agora</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-gray-400 truncate">
                    {textoDoAlarme(a.tipo, a.mensagem)}
                  </span>
                </span>
                {podeGerenciar && tocandoAgora(a) && (
                  // O botão que faltava: durante o toque, desligar aqui cala o
                  // alarme em TODAS as telas da turma (o desligamento chega por
                  // realtime). Sem ele, parar era tarefa de 45 pessoas
                  // apertando "Entendi" cada uma na sua máquina.
                  <button onClick={() => alternar(a.id, false)}
                    className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-accent shrink-0"
                    title="Desliga este alarme e silencia todas as telas. Ele fica desligado até você ligar de novo.">
                    Silenciar todos
                  </button>
                )}
                {podeGerenciar && (
                  <>
                    {/* Toggle neumórfico (track + bolinha) */}
                    <button onClick={() => alternar(a.id, !a.ativo)}
                      role="switch" aria-checked={a.ativo}
                      aria-label={`${a.ativo ? 'Desativar' : 'Ativar'} alarme ${pad2(a.hora)}:${pad2(a.minuto)}`}
                      className="neu-pressed w-11 h-6 rounded-full relative transition-colors border border-white/5 shrink-0"
                      style={{ background: a.ativo ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : undefined }}>
                      <span className="absolute top-0.5 w-5 h-5 rounded-full neu-flat transition-all"
                        style={{
                          left: a.ativo ? 'calc(100% - 1.375rem)' : '0.125rem',
                          background: a.ativo ? 'var(--color-accent)' : 'var(--color-bg-base)',
                        }} />
                    </button>
                    <button onClick={() => remover(a.id)}
                      className="action-btn-delete shrink-0"
                      aria-label="Excluir alarme">
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 3. CRONÔMETRO — minutos, segundos, ms + voltas
// ─────────────────────────────────────────────────────────────────
function CronometroCard() {
  // Modelo "performance.now() + accumulated": ao iniciar guardamos
  // o momento de início; o elapsed atual = (now - start) + acumulado
  // de pausas anteriores. Evita drift do setInterval e cobre janelas
  // em segundo plano (que podem suspender o timer).
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // ms
  const [laps, setLaps]       = useState<number[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
  }, []);

  const start = () => {
    // Guard por REF em vez de state: `running` vem do closure e
    // setRunning(true) é assíncrono, então clique duplo rápido passaria
    // pelos dois `if (running) return` antes do re-render e criaria dois
    // setInterval — o primeiro vira ghost. intervalRef é mutado síncrono.
    if (intervalRef.current !== null) return;
    setRunning(true);
    startedAtRef.current = performance.now();
    intervalRef.current = setInterval(() => {
      if (startedAtRef.current === null) return;
      setElapsed(accumulatedRef.current + (performance.now() - startedAtRef.current));
    }, 31); // ~32fps — bom pra ver milissegundos sem custo de render
  };

  const pause = () => {
    if (!running) return;
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (startedAtRef.current !== null) {
      accumulatedRef.current += performance.now() - startedAtRef.current;
    }
    startedAtRef.current = null;
    setRunning(false);
    setElapsed(accumulatedRef.current);
  };

  const reset = () => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    intervalRef.current = null;
    startedAtRef.current = null;
    accumulatedRef.current = 0;
    setElapsed(0);
    setLaps([]);
    setRunning(false);
  };

  const lap = () => {
    if (!running && elapsed === 0) return;
    setLaps(prev => [elapsed, ...prev]);
  };

  // Formata MM:SS.mmm independente de horas (tarefas operacionais raramente
  // passam de 1h — se passar, MM mostra > 60 normalmente).
  const fmt = (ms: number) => {
    const totalMs = Math.max(0, Math.floor(ms));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis  = totalMs % 1000;
    return `${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
  };

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col">
      <CardHeader icon={TimerIcon} title="Cronômetro" subtitle="Operação · com voltas" />

      <div className="neu-pressed rounded-2xl py-6 px-4 flex items-center justify-center mb-4 border border-white/5">
        <div className="font-mono tabular-nums text-4xl sm:text-5xl font-black text-accent tracking-tight">
          {fmt(elapsed)}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        {!running ? (
          <button onClick={start}
            className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-accent hover:bg-accent/5 transition-colors">
            <Play size={13} /> Iniciar
          </button>
        ) : (
          <button onClick={pause}
            className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-yellow-400 hover:bg-yellow-400/5 transition-colors">
            <Pause size={13} /> Pausar
          </button>
        )}
        <button onClick={lap} disabled={!running && elapsed === 0}
          className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-gray-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Flag size={13} /> Volta
        </button>
        <button onClick={reset} disabled={elapsed === 0 && laps.length === 0}
          className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-gray-500 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed col-span-2">
          <RotateCcw size={13} /> Zerar
        </button>
      </div>

      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto main-scrollbar pr-1">
        {laps.length === 0 ? (
          <p className="text-[10px] text-gray-600 text-center py-3">Nenhuma volta registrada.</p>
        ) : (
          laps.map((lapMs, idx) => (
            <div key={`lap-${laps.length - idx}`}
              className="flex items-center justify-between px-3 py-1.5 rounded-lg neu-pressed border border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Volta {laps.length - idx}
              </span>
              <span className="font-mono tabular-nums text-xs text-gray-300">{fmt(lapMs)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 4. TIMER REGRESSIVO
// ─────────────────────────────────────────────────────────────────
function TimerCard() {
  const [hours,   setHours]   = useState(0);
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);

  const [running,   setRunning]   = useState(false);
  const [remaining, setRemaining] = useState(0); // ms restantes
  const [finished,  setFinished]  = useState(false);

  const targetRef = useRef<number | null>(null); // performance.now() do fim
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    const a = audioRef.current;
    if (a) {
      try { a.pause(); } catch {}
      audioRef.current = null;
    }
  }, []);

  const totalSetMs = () =>
    (hours * 3600 + minutes * 60 + seconds) * 1000;

  const playTimerEnd = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(TIMER_AUDIO_URL);
        audioRef.current.volume = 0.75;
      }
      audioRef.current.currentTime = 0;
      const p = audioRef.current.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  };

  const start = () => {
    // Guard por REF (mesmo motivo do Cronômetro): clique duplo rápido
    // antes do re-render passaria pelo `if (running) return` duas vezes
    // e abriria dois setInterval; o primeiro vira ghost no clearInterval.
    if (intervalRef.current !== null) return;
    // Se ainda não foi iniciado, parte do total configurado;
    // se foi pausado, retoma do que sobrou.
    const ms = remaining > 0 ? remaining : totalSetMs();
    if (ms <= 0) return;
    setRemaining(ms);
    setFinished(false);
    targetRef.current = performance.now() + ms;
    setRunning(true);
    intervalRef.current = setInterval(() => {
      if (targetRef.current === null) return;
      const left = targetRef.current - performance.now();
      if (left <= 0) {
        if (intervalRef.current !== null) clearInterval(intervalRef.current);
        intervalRef.current = null;
        targetRef.current = null;
        setRemaining(0);
        setRunning(false);
        setFinished(true);
        playTimerEnd();
      } else {
        setRemaining(left);
      }
    }, 100); // 10fps — suficiente, evita render desnecessário
  };

  const pause = () => {
    if (!running) return;
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (targetRef.current !== null) {
      setRemaining(Math.max(0, targetRef.current - performance.now()));
    }
    targetRef.current = null;
    setRunning(false);
  };

  const clear = () => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    intervalRef.current = null;
    targetRef.current = null;
    setRunning(false);
    setRemaining(0);
    setFinished(false);
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
  };

  // Display: enquanto running/pausado mostra remaining; senão mostra
  // o valor configurado pelos selects (HH:MM:SS preview).
  const displayMs = running || remaining > 0
    ? remaining
    : totalSetMs();
  const displaySec = Math.ceil(displayMs / 1000);
  const dH = Math.floor(displaySec / 3600);
  const dM = Math.floor((displaySec % 3600) / 60);
  const dS = displaySec % 60;

  const configurable = !running && remaining === 0;

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col">
      <CardHeader icon={Hourglass} title="Timer Regressivo" subtitle="Contagem para zero" />

      <div className={`neu-pressed rounded-2xl py-6 px-4 flex items-center justify-center mb-4 border ${
        finished ? 'border-red-500/40' : 'border-white/5'
      }`}>
        <div className={`font-mono tabular-nums text-4xl sm:text-5xl font-black tracking-tight transition-colors ${
          finished ? 'text-red-500 animate-pulse' : 'text-accent'
        }`}>
          {pad2(dH)}:{pad2(dM)}:{pad2(dS)}
        </div>
      </div>

      {/* Setters HH/MM/SS — desabilitados durante contagem. Mudar qualquer
          select limpa o estado `finished` para que o visor pare de piscar
          em vermelho e o texto "Tempo esgotado" suma — o usuário está
          claramente reconfigurando para um próximo ciclo. */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Horas',   value: hours,   set: setHours,   max: 23 },
          { label: 'Minutos', value: minutes, set: setMinutes, max: 59 },
          { label: 'Segundos', value: seconds, set: setSeconds, max: 59 },
        ].map(({ label, value, set, max }) => {
          const id = `timer-${label.toLowerCase()}`;
          return (
            <div key={label} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 text-center">{label}</label>
              <select id={id} value={value} disabled={!configurable}
                onChange={e => {
                  set(Number.parseInt(e.target.value, 10));
                  if (finished) setFinished(false);
                }}
                className="neu-input py-2 px-2 rounded-xl text-sm font-mono tabular-nums w-full text-center disabled:opacity-50 disabled:cursor-not-allowed">
                {Array.from({ length: max + 1 }, (_, i) => (
                  <option key={i} value={i}>{pad2(i)}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {!running ? (
          <button onClick={start} disabled={!running && totalSetMs() === 0 && remaining === 0}
            className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-accent hover:bg-accent/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Play size={13} /> Iniciar
          </button>
        ) : (
          <button onClick={pause}
            className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-yellow-400 hover:bg-yellow-400/5 transition-colors">
            <Pause size={13} /> Pausar
          </button>
        )}
        <button onClick={clear} disabled={remaining === 0 && !finished}
          className="neu-button rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-xs font-bold text-gray-500 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed col-span-2">
          <RotateCcw size={13} /> Limpar
        </button>
      </div>

      {finished && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-xs font-bold text-red-400 text-center mt-3">
          ⏰ Tempo esgotado!
        </motion.p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// VIEW PRINCIPAL — grid 2x2 desktop, coluna única mobile
// ─────────────────────────────────────────────────────────────────
export const CentralTempoView = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
    className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
    <div className="shrink-0">
      <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Tempo</h2>
      <p className="text-sm text-gray-400 mt-1">
        Quatro ferramentas operacionais num só lugar: relógio do Acre,
        alarmes, cronômetro e timer.
      </p>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <RelogioCard />
      <AlarmesCard />
      <CronometroCard />
      <TimerCard />
    </div>
  </motion.div>
);
