import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock, AlarmClock, Timer as TimerIcon, Hourglass,
  Play, Pause, RotateCcw, Flag, Plus, Trash2, VolumeX,
} from 'lucide-react';

// =================================================================
// LogMax — Central de Tempo
// =================================================================
// Quatro ferramentas operacionais 100% client-side: relógio (Acre),
// alarmes (LocalStorage), cronômetro com voltas e timer regressivo.
// Sem chamadas a servidor — custo zero de operação. Sem assets remotos
// além dos dois MP3 locais (alarme + fim de timer).
//
// Áudio: arquivos esperados em public/sounds/. Se ausentes, o som
// falha em silêncio (catch no play) — mesma política do PDV.
// =================================================================

const ALARM_AUDIO_URL = '/sounds/alarm.mp3';
const TIMER_AUDIO_URL = '/sounds/timer-end.mp3';
const ALARMS_LS_KEY = 'logmax_timer_alarms';

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

const ACRE_HHMM = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  hour:   '2-digit',
  minute: '2-digit',
  hour12: false,
});

const ACRE_DATE = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Rio_Branco',
  weekday: 'long',
  day:     '2-digit',
  month:   'long',
  year:    'numeric',
});

type Alarm = {
  id: string;
  hour:   number; // 0–23
  minute: number; // 0–59
  enabled: boolean;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad3 = (n: number) => String(n).padStart(3, '0');

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Lê alarmes do LocalStorage com fallback seguro — qualquer JSON
// corrompido devolve lista vazia em vez de explodir o componente.
function loadAlarms(): Alarm[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ALARMS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(a => a && typeof a.hour === 'number' && typeof a.minute === 'number')
      .map(a => ({
        id:      String(a.id ?? newId()),
        hour:    Math.min(23, Math.max(0, Math.floor(a.hour))),
        minute:  Math.min(59, Math.max(0, Math.floor(a.minute))),
        enabled: !!a.enabled,
      }));
  } catch {
    return [];
  }
}

function saveAlarms(alarms: Alarm[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(ALARMS_LS_KEY, JSON.stringify(alarms)); } catch {}
}

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
// 2. GERENCIADOR DE ALARMES — LocalStorage + Audio loop
// ─────────────────────────────────────────────────────────────────
function AlarmesCard() {
  const [alarms, setAlarms]   = useState<Alarm[]>(() => loadAlarms());
  const [hourIn, setHourIn]   = useState('07');
  const [minIn, setMinIn]     = useState('00');
  const [ringingId, setRinging] = useState<string | null>(null);

  // Persiste qualquer alteração no LocalStorage. Custom event 'storage'
  // não é necessário porque a app inteira opera numa única aba.
  useEffect(() => { saveAlarms(alarms); }, [alarms]);

  // Áudio em loop pro alarme; lazy-instanciado pra respeitar autoplay policy.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastMinuteCheckedRef = useRef<string>('');

  const stopRinging = useCallback(() => {
    setRinging(null);
    const a = audioRef.current;
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch {}
    }
  }, []);

  const startRinging = useCallback((alarmId: string) => {
    setRinging(alarmId);
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(ALARM_AUDIO_URL);
        audioRef.current.loop = true;
        audioRef.current.volume = 0.7;
      }
      audioRef.current.currentTime = 0;
      const p = audioRef.current.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Áudio bloqueado: o estado visual de "tocando" ainda guia o usuário.
    }
  }, []);

  // Tick de checagem: a cada segundo lê hora atual em Acre, normaliza
  // pra "HH:MM" e dispara o alarme só na VIRADA do minuto (evita disparar
  // 60x dentro do mesmo minuto).
  const checkRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmsRef = useRef(alarms);
  useEffect(() => { alarmsRef.current = alarms; }, [alarms]);
  const ringingRef = useRef(ringingId);
  useEffect(() => { ringingRef.current = ringingId; }, [ringingId]);

  useEffect(() => {
    const tick = () => {
      const hhmm = ACRE_HHMM.format(new Date());
      if (hhmm === lastMinuteCheckedRef.current) return;
      lastMinuteCheckedRef.current = hhmm;
      // Já está tocando algum alarme — não dispara outro por cima.
      if (ringingRef.current) return;
      const [h, m] = hhmm.split(':').map(n => Number.parseInt(n, 10));
      const hit = alarmsRef.current.find(a => a.enabled && a.hour === h && a.minute === m);
      if (hit) startRinging(hit.id);
    };
    tick(); // inicializa a referência de minuto sem disparar
    checkRef.current = setInterval(tick, 1000);
    return () => {
      if (checkRef.current !== null) clearInterval(checkRef.current);
      checkRef.current = null;
    };
  }, [startRinging]);

  // Limpa o áudio ao desmontar o componente — evita som tocando depois
  // do usuário sair da view.
  useEffect(() => () => {
    const a = audioRef.current;
    if (a) {
      try { a.pause(); } catch {}
      audioRef.current = null;
    }
  }, []);

  const addAlarm = () => {
    const h = Number.parseInt(hourIn, 10);
    const m = Number.parseInt(minIn, 10);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return;
    // Duplicado (mesmo h:m): só ativa o existente em vez de criar par.
    const dup = alarms.find(a => a.hour === h && a.minute === m);
    if (dup) {
      setAlarms(prev => prev.map(a => a.id === dup.id ? { ...a, enabled: true } : a));
      return;
    }
    setAlarms(prev => [...prev, { id: newId(), hour: h, minute: m, enabled: true }]);
  };

  const removeAlarm = (id: string) => {
    if (ringingId === id) stopRinging();
    setAlarms(prev => prev.filter(a => a.id !== id));
  };

  const toggleAlarm = (id: string) => {
    setAlarms(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  };

  // Ordena cronologicamente pra UX previsível.
  const sortedAlarms = useMemo(
    () => [...alarms].sort((a, b) => (a.hour - b.hour) || (a.minute - b.minute)),
    [alarms],
  );

  return (
    <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col">
      <CardHeader icon={AlarmClock} title="Alarmes" subtitle="Salvos no navegador" />

      {ringingId && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 rounded-2xl flex items-center justify-between gap-3"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-red-400">Alarme tocando</span>
          </div>
          <button onClick={stopRinging}
            className="neu-button rounded-lg px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-300 hover:text-white">
            <VolumeX size={12} /> Silenciar
          </button>
        </motion.div>
      )}

      <div className="flex items-end gap-2 mb-4">
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
        <button onClick={addAlarm}
          className="neu-button rounded-xl px-4 py-2 flex items-center gap-1.5 text-xs font-bold text-accent hover:bg-accent/5 transition-colors h-[38px]">
          <Plus size={14} /> Adicionar
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-h-[120px]">
        {sortedAlarms.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center py-6">
            <p className="text-xs text-gray-600">Nenhum alarme cadastrado.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {sortedAlarms.map(a => (
              <motion.div key={a.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                className={`neu-pressed rounded-xl p-3 flex items-center gap-3 border ${
                  ringingId === a.id ? 'border-red-500/40' : 'border-white/5'
                }`}>
                <span className={`font-mono tabular-nums text-lg font-black ${a.enabled ? 'text-accent' : 'text-gray-600'}`}>
                  {pad2(a.hour)}:{pad2(a.minute)}
                </span>
                <span className="flex-1" />
                {/* Toggle neumórfico (track + bolinha) */}
                <button onClick={() => toggleAlarm(a.id)}
                  role="switch" aria-checked={a.enabled}
                  aria-label={`${a.enabled ? 'Desativar' : 'Ativar'} alarme ${pad2(a.hour)}:${pad2(a.minute)}`}
                  className="neu-pressed w-11 h-6 rounded-full relative transition-colors border border-white/5"
                  style={{ background: a.enabled ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : undefined }}>
                  <span className="absolute top-0.5 w-5 h-5 rounded-full neu-flat transition-all"
                    style={{
                      left: a.enabled ? 'calc(100% - 1.375rem)' : '0.125rem',
                      background: a.enabled ? 'var(--color-accent)' : 'var(--color-bg-base)',
                    }} />
                </button>
                <button onClick={() => removeAlarm(a.id)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors"
                  aria-label="Excluir alarme">
                  <Trash2 size={12} />
                </button>
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
    if (running) return;
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
    if (a) { try { a.pause(); } catch {} }
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
    if (running) return;
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

      {/* Setters HH/MM/SS — desabilitados durante contagem */}
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
                onChange={e => set(Number.parseInt(e.target.value, 10))}
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
