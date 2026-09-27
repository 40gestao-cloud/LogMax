import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock, AlarmClock, Timer as TimerIcon, Hourglass,
  Play, Pause, RotateCcw, Flag, Plus, Trash2, Pencil, Check, X,
} from 'lucide-react';
import { useUserProfile } from '../hooks/useUserProfile';
import { useAlarmesTurma } from '../hooks/useAlarmesTurma';
import {
  ALARME_TIPOS, ALARME_TITULO, textoDoAlarme, ACRE_HHMM, pad2,
  DIAS_SEMANA, DIAS_UTEIS, TODOS_OS_DIAS, diasDoAlarme, diaSemanaAcre, rotuloDias,
  type AlarmeTipo, type AlarmeTurma,
} from '../lib/alarmes';
import { COR_ABA, type CorAba } from '../components/ui';
import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import { useVoltarInterno } from '../hooks/useVoltarInterno';
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

// ─────────────────────────────────────────────────────────────────
// 1. RELÓGIO DIGITAL — Acre (America/Rio_Branco)
// ─────────────────────────────────────────────────────────────────
// O tick vive na VIEW, não no painel: o painel só existe enquanto o modal
// está aberto, e o botão da grade precisa da hora o tempo todo.
function useRelogioAcre() {
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

  return { hora: ACRE_FORMATTER.format(now), dataStr: ACRE_DATE.format(now) };
}

// ─────────────────────────────────────────────────────────────────
// Cores de cada ferramenta — a mesma na grade, na faixa do modal e nos
// botões, para a ferramenta ser achada de relance.
// ─────────────────────────────────────────────────────────────────
type Ferramenta = 'relogio' | 'alarmes' | 'cronometro' | 'timer';
const COR: Record<Ferramenta, CorAba> = {
  relogio: 'dourado', alarmes: 'vermelho', cronometro: 'azul', timer: 'roxo',
};

const BTN = '!py-3 !px-4 !text-sm justify-center';

// O próximo alarme de hoje responde a pergunta que traz a pessoa até o
// relógio quase sempre: "quanto falta para o intervalo?".
const proximoAlarmeHoje = (alarmes: AlarmeTurma[], agoraHHMM: string) => {
  const hoje = diaSemanaAcre();
  return alarmes
    .filter(a => a.ativo && diasDoAlarme(a).includes(hoje) && `${pad2(a.hora)}:${pad2(a.minuto)}` > agoraHHMM)
    .sort((a, b) => a.hora * 60 + a.minuto - (b.hora * 60 + b.minuto))[0];
};

// ─────────────────────────────────────────────────────────────────
// 1. RELÓGIO DIGITAL — Acre (America/Rio_Branco)
// ─────────────────────────────────────────────────────────────────
function RelogioPainel({ hora, dataStr, alarmes }: ReturnType<typeof useRelogioAcre> & { alarmes: AlarmeTurma[] }) {
  const [hh, mm, ss] = hora.split(':');
  const hoje = diaSemanaAcre();
  const proximo = proximoAlarmeHoje(alarmes, hora.slice(0, 5));
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-white/10 bg-black/20 py-10 sm:py-14 px-4 flex flex-col items-center gap-4">
        <div className="font-mono tabular-nums font-black text-accent tracking-tight leading-none flex items-baseline">
          <span className="text-6xl sm:text-8xl">{hh}:{mm}</span>
          <span className="text-3xl sm:text-5xl text-accent/60 ml-1">:{ss}</span>
        </div>
        <p className="text-sm sm:text-base uppercase tracking-widest text-gray-300 font-bold text-center">{dataStr}</p>
      </div>

      {/* A semana com o dia de hoje marcado — os alarmes agora têm dias. */}
      <div className="grid grid-cols-7 gap-1.5">
        {DIAS_SEMANA.map(d => (
          <span key={d.valor}
            className={`py-2 rounded-lg text-center text-[11px] font-black uppercase tracking-widest ${
              d.valor === hoje ? 'btn-solido--dourado' : 'bg-white/[0.03] text-gray-500 border border-white/10'}`}>
            {d.curto}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Próximo alarme hoje</p>
          <p className="text-sm font-bold text-gray-100 mt-1">
            {proximo
              ? <><span className="font-mono tabular-nums text-accent">{pad2(proximo.hora)}:{pad2(proximo.minuto)}</span> · {ALARME_TITULO[proximo.tipo]}</>
              : <span className="text-gray-500">Nenhum até o fim do dia</span>}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Fuso</p>
          <p className="text-sm font-bold text-gray-100 mt-1">Acre · UTC−5, sem horário de verão</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 2. GERENCIADOR DE ALARMES — banco + realtime (migr. 529, dias na 637)
// ─────────────────────────────────────────────────────────────────
// Este painel só cadastra e lista — QUEM TOCA é a shell do App
// (useAlarmeGlobal), que não desmonta. Tocar aqui também daria dois áudios.
// A lista vem da VIEW (um `useAlarmesTurma` só): o botão da grade conta os
// ativos com o modal fechado, e duas instâncias dobrariam fetch e realtime.
const TIPO_COR: Record<AlarmeTipo, string> = {
  aviso:     'bg-amber-500 text-black',
  intervalo: 'bg-blue-600 text-white',
  saida:     'bg-purple-600 text-white',
};

function AlarmesPainel({ alarmesApi }: { alarmesApi: ReturnType<typeof useAlarmesTurma> }) {
  const { profile } = useUserProfile();
  const { alarmes, isLoading, criar, editar, alternar, remover } = alarmesApi;
  // Escrita é só do professor (`role = 'admin'` literal, igual à RLS da
  // migr. 529): alarme interrompe a tela de 45 pessoas.
  const podeGerenciar = profile?.role === 'admin';

  const [horario, setHorario]   = useState('07:00');
  const [dias, setDias]         = useState<number[]>(DIAS_UTEIS);
  const [tipo, setTipo]         = useState<AlarmeTipo>('aviso');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro]         = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O MESMO formulário cadastra e edita: com `editandoId` preenchido ele
  // salva por cima do alarme escolhido em vez de criar outro.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  // Que minuto é agora no Acre — para marcar o alarme que está TOCANDO e
  // oferecer o botão que o cala em todas as telas.
  const [agora, setAgora] = useState(() => ACRE_HHMM.format(new Date()));
  useEffect(() => {
    const id = setInterval(() => setAgora(ACRE_HHMM.format(new Date())), 10_000);
    return () => clearInterval(id);
  }, []);
  const tocandoAgora = (a: AlarmeTurma) =>
    a.ativo && `${pad2(a.hora)}:${pad2(a.minuto)}` === agora && diasDoAlarme(a).includes(diaSemanaAcre());

  // O alarme em edição pode sumir debaixo do formulário (outra máquina do
  // professor apaga e o realtime tira a linha da lista).
  useEffect(() => {
    if (editandoId && !alarmes.some(a => a.id === editandoId)) {
      setEditandoId(null);
      setErro(null);
    }
  }, [alarmes, editandoId]);

  const emEdicao = editandoId ? alarmes.find(a => a.id === editandoId) ?? null : null;

  const abrirEdicao = (a: AlarmeTurma) => {
    setEditandoId(a.id);
    setHorario(`${pad2(a.hora)}:${pad2(a.minuto)}`);
    setDias([...diasDoAlarme(a)]);
    setTipo(a.tipo);
    setMensagem(a.mensagem ?? '');
    setErro(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setMensagem('');
    setErro(null);
  };

  const alternarDia = (d: number) => {
    setErro(null);
    setDias(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  };

  const salvarAlarme = async () => {
    const [h, m] = horario.split(':').map(n => Number.parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) { setErro('Escolha o horário.'); return; }
    if (dias.length === 0) { setErro('Marque pelo menos um dia.'); return; }
    if (tipo === 'aviso' && !mensagem.trim()) { setErro('Escreva a mensagem do aviso.'); return; }
    setSalvando(true);
    const falha = editandoId
      ? await editar(editandoId, h, m, tipo, mensagem, dias)
      : await criar(h, m, tipo, mensagem, dias);
    setSalvando(false);
    setErro(falha);
    if (!falha) {
      setMensagem('');
      setEditandoId(null);
    }
  };

  const atalhos: { rotulo: string; dias: number[] }[] = [
    { rotulo: 'Seg a Sex', dias: DIAS_UTEIS },
    { rotulo: 'Todos', dias: TODOS_OS_DIAS },
    { rotulo: 'Fim de semana', dias: [6, 0] },
  ];

  const lista = (
    <div className="flex flex-col gap-2">
      {isLoading ? (
        <p className="text-xs text-gray-500 text-center py-8">Carregando…</p>
      ) : alarmes.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-white/10 py-10 text-center">
          <AlarmClock size={26} className="mx-auto text-gray-600 mb-2" />
          <p className="text-xs text-gray-500">Nenhum alarme cadastrado.</p>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {alarmes.map(a => {
            const tocando = tocandoAgora(a);
            return (
              <motion.div key={a.id}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`rounded-xl border p-3 flex items-center gap-3 transition-colors ${
                  tocando ? 'border-red-500 bg-red-500/10'
                    : a.id === editandoId ? 'border-accent/60 bg-accent/5'
                    : 'border-white/10 bg-white/[0.02]'} ${a.ativo ? '' : 'opacity-55'}`}>
                <div className="shrink-0 text-center w-16">
                  <span className={`block font-mono tabular-nums text-xl font-black leading-none ${a.ativo ? 'text-accent' : 'text-gray-500'}`}>
                    {pad2(a.hora)}:{pad2(a.minuto)}
                  </span>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-gray-500 mt-1 leading-tight">
                    {rotuloDias(diasDoAlarme(a))}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${TIPO_COR[a.tipo]}`}>
                      {ALARME_TITULO[a.tipo]}
                    </span>
                    {tocando && <span className="text-[10px] font-black uppercase tracking-widest text-red-400 animate-pulse">tocando agora</span>}
                  </span>
                  <span className="block text-[11px] text-gray-400 mt-1 line-clamp-2" title={textoDoAlarme(a.tipo, a.mensagem)}>
                    {textoDoAlarme(a.tipo, a.mensagem)}
                  </span>
                </div>
                {podeGerenciar && tocando && (
                  // Desligar aqui cala o alarme em TODAS as telas da turma
                  // (o desligamento chega por realtime).
                  <button onClick={() => alternar(a.id, false)}
                    className="btn-solido btn-solido--vermelho !py-1.5 !px-2.5 shrink-0"
                    title="Desliga este alarme e silencia todas as telas. Ele fica desligado até você ligar de novo.">
                    Silenciar todos
                  </button>
                )}
                {podeGerenciar && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => alternar(a.id, !a.ativo)}
                      role="switch" aria-checked={a.ativo}
                      title={a.ativo ? 'Ligado — clique para desligar' : 'Desligado — clique para ligar'}
                      aria-label={`${a.ativo ? 'Desativar' : 'Ativar'} alarme ${pad2(a.hora)}:${pad2(a.minuto)}`}
                      className={`w-11 h-6 rounded-full relative transition-colors border ${a.ativo ? 'bg-green-600 border-green-700' : 'bg-zinc-700 border-zinc-600'}`}>
                      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                        style={{ left: a.ativo ? 'calc(100% - 1.375rem)' : '0.125rem' }} />
                    </button>
                    <button onClick={() => abrirEdicao(a)} className="action-btn-edit"
                      title="Editar" aria-label={`Editar alarme ${pad2(a.hora)}:${pad2(a.minuto)}`}>
                      <Pencil size={12} />
                    </button>
                    <MenuMais>
                      {fechar => (
                        <ItemMenu onClick={() => { fechar(); remover(a.id); }}
                          cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                          Excluir alarme
                        </ItemMenu>
                      )}
                    </MenuMais>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );

  if (!podeGerenciar) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-400 leading-relaxed rounded-xl border border-white/10 px-4 py-3">
          Os alarmes são definidos pelo professor. Quando o horário chegar, o
          aviso aparece na sua tela — esteja você em qualquer módulo.
        </p>
        {lista}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-5 items-start">
      <div ref={formRef} className="flex flex-col gap-4 rounded-2xl border border-white/10 p-4">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">
          {emEdicao
            // O horário mostrado é o do BANCO, não o dos campos.
            ? <>Editando o alarme das <span className="text-accent">{pad2(emEdicao.hora)}:{pad2(emEdicao.minuto)}</span></>
            : 'Novo alarme'}
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="alarme-horario" className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Horário</label>
          <input id="alarme-horario" type="time" value={horario}
            onChange={e => { setHorario(e.target.value); setErro(null); }}
            className="neu-input py-3 px-3 rounded-xl text-2xl font-mono font-black tabular-nums text-center text-accent w-full" />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Dias em que toca</span>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Dias da semana">
            {DIAS_SEMANA.map(d => {
              const marcado = dias.includes(d.valor);
              return (
                <button key={d.valor} type="button" onClick={() => alternarDia(d.valor)}
                  aria-pressed={marcado} title={d.nome}
                  className={`py-2 rounded-lg text-[11px] font-black uppercase transition-colors border ${
                    marcado ? 'bg-red-600 border-red-700 text-white' : 'border-white/10 text-gray-500 hover:text-gray-300'}`}>
                  {d.curto}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {atalhos.map(at => {
              const igual = at.dias.length === dias.length && at.dias.every(d => dias.includes(d));
              return (
                <button key={at.rotulo} type="button" onClick={() => { setDias([...at.dias].sort()); setErro(null); }}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                    igual ? 'border-red-500 text-red-400' : 'border-white/10 text-gray-500 hover:text-gray-300'}`}>
                  {at.rotulo}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Tipo</span>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Tipo do alarme">
            {ALARME_TIPOS.map(t => (
              <button key={t.valor} type="button" role="radio" aria-checked={tipo === t.valor}
                onClick={() => { setTipo(t.valor); setErro(null); }}
                className={`py-2 px-1 rounded-lg text-[11px] font-bold leading-tight transition-all border ${
                  tipo === t.valor ? `${TIPO_COR[t.valor]} border-transparent` : 'border-white/10 text-gray-400 hover:text-gray-200'}`}>
                {t.rotulo}
              </button>
            ))}
          </div>
        </div>

        {/* Intervalo e Fim de Expediente têm texto fixo (src/lib/alarmes.ts):
            mostrar o texto em vez de um campo evita a impressão de que dá
            para reescrever procedimento da operação por alarme. */}
        {tipo === 'aviso' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="alarme-msg" className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Mensagem do aviso</label>
            <textarea id="alarme-msg" rows={3} value={mensagem} maxLength={300}
              onChange={e => { setMensagem(e.target.value); setErro(null); }}
              placeholder="O que a turma precisa ler quando o alarme tocar"
              className="neu-input py-2 px-3 rounded-xl text-sm w-full resize-none" />
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 leading-relaxed rounded-xl border border-white/10 bg-white/[0.02] p-3">
            {textoDoAlarme(tipo)}
          </p>
        )}

        {erro && <p className="text-[11px] font-bold text-red-400">{erro}</p>}

        <div className="flex items-center gap-2">
          <button onClick={salvarAlarme} disabled={salvando}
            className={`btn-solido btn-solido--vermelho flex-1 ${BTN}`}>
            {editandoId ? <Check size={15} /> : <Plus size={15} />}
            {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Adicionar alarme'}
          </button>
          {editandoId && (
            <button onClick={cancelarEdicao} disabled={salvando}
              className={`btn-solido btn-solido--preto ${BTN}`}>
              <X size={15} /> Cancelar
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-500 leading-relaxed">
          Toca na tela de todo mundo até cada pessoa apertar “Entendi”. Para calar a
          turma inteira de uma vez, desligue o alarme na lista enquanto ele toca.
        </p>
      </div>

      <div className="flex flex-col gap-2 min-w-0">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">
          Alarmes cadastrados · {alarmes.length}
        </p>
        {lista}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 3. CRONÔMETRO — minutos, segundos, ms + voltas
// ─────────────────────────────────────────────────────────────────
// Estado do cronômetro na VIEW: fechar o modal não pode zerar uma medição
// em andamento — é justamente o caso de uso (dispara, fecha, trabalha).
function useCronometro() {
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
    // Guard por REF em vez de state: clique duplo rápido passaria pelos dois
    // `if (running) return` antes do re-render e criaria dois setInterval.
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

  // Formata MM:SS.mmm independente de horas (se passar de 1h, MM mostra > 60).
  const fmt = (ms: number) => {
    const totalMs = Math.max(0, Math.floor(ms));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis  = totalMs % 1000;
    return `${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
  };

  // Versão sem milissegundos, para o botão da grade: ali o dígito de ms
  // pisca 32 vezes por segundo sem ninguém conseguir ler.
  const fmtCurto = (ms: number) => {
    const totalMs = Math.max(0, Math.floor(ms));
    return `${pad2(Math.floor(totalMs / 60000))}:${pad2(Math.floor((totalMs % 60000) / 1000))}`;
  };

  return { running, elapsed, laps, start, pause, reset, lap, fmt, fmtCurto };
}

function CronometroPainel({ running, elapsed, laps, start, pause, reset, lap, fmt }: ReturnType<typeof useCronometro>) {
  // Cada volta guarda o TOTAL; a parcial é a diferença para a anterior. Com
  // duas ou mais, a mais rápida e a mais lenta ganham cor — é o que se
  // procura numa lista de voltas.
  const parciais = laps.map((t, i) => t - (laps[i + 1] ?? 0));
  const menor = laps.length > 1 ? Math.min(...parciais) : null;
  const maior = laps.length > 1 ? Math.max(...parciais) : null;
  const [mmss, ms] = fmt(elapsed).split('.');
  return (
    <div className="flex flex-col gap-5">
      <div className={`rounded-2xl border bg-black/20 py-10 sm:py-12 px-4 flex flex-col items-center gap-2 ${running ? 'border-blue-500/60' : 'border-white/10'}`}>
        <div className="font-mono tabular-nums font-black text-accent tracking-tight leading-none flex items-baseline">
          <span className="text-6xl sm:text-8xl">{mmss}</span>
          <span className="text-3xl sm:text-5xl text-accent/60">.{ms}</span>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${running ? 'text-blue-400' : 'text-gray-500'}`}>
          {running ? 'Contando' : elapsed > 0 ? 'Pausado' : 'Parado'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {!running ? (
          <button onClick={start} className={`btn-solido btn-solido--verde ${BTN}`}>
            <Play size={15} /> {elapsed > 0 ? 'Continuar' : 'Iniciar'}
          </button>
        ) : (
          <button onClick={pause} className={`btn-solido btn-solido--amarelo ${BTN}`}>
            <Pause size={15} /> Pausar
          </button>
        )}
        <button onClick={lap} disabled={!running && elapsed === 0} className={`btn-solido btn-solido--azul ${BTN}`}>
          <Flag size={15} /> Volta
        </button>
        <button onClick={reset} disabled={elapsed === 0 && laps.length === 0} className={`btn-solido btn-solido--preto ${BTN}`}>
          <RotateCcw size={15} /> Zerar
        </button>
      </div>

      {laps.length > 0 && (
        <div className="overflow-x-auto max-h-56 overflow-y-auto main-scrollbar">
          <table className="tabela tabela--azul w-full text-left border-collapse">
            <thead>
              <tr className={CABECALHO_TABELA}>
                <th className="text-center w-20">Volta</th>
                <th className="text-center">Parcial</th>
                <th className="text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {laps.map((total, idx) => {
                const p = parciais[idx];
                const cor = p === menor ? 'text-green-400' : p === maior ? 'text-red-400' : 'text-gray-200';
                return (
                  <tr key={`lap-${laps.length - idx}`} className="border-b border-accent/10">
                    <td className="py-1.5 px-3 text-center text-xs font-bold text-gray-400">{laps.length - idx}</td>
                    <td className={`py-1.5 px-3 text-center font-mono tabular-nums text-sm font-bold ${cor}`}>
                      {fmt(p)}
                      {p === menor && <span className="ml-1.5 text-[9px] font-black uppercase">mais rápida</span>}
                      {p === maior && <span className="ml-1.5 text-[9px] font-black uppercase">mais lenta</span>}
                    </td>
                    <td className="py-1.5 px-3 text-center font-mono tabular-nums text-xs text-gray-400">{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 4. TIMER REGRESSIVO
// ─────────────────────────────────────────────────────────────────
// Mesmo motivo do cronômetro, e mais um: o timer TOCA no fim. Se o estado
// morresse com o modal, fechar a janela cancelaria o alarme silenciosamente.
function useTimerRegressivo() {
  const [hours,   setHours]   = useState(0);
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);

  const [running,   setRunning]   = useState(false);
  const [remaining, setRemaining] = useState(0); // ms restantes
  const [finished,  setFinished]  = useState(false);
  // Duração da contagem em curso — a base da barra de progresso.
  const [duracao,   setDuracao]   = useState(0);

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
    // Guard por REF (mesmo motivo do Cronômetro).
    if (intervalRef.current !== null) return;
    // Se ainda não foi iniciado, parte do total configurado;
    // se foi pausado, retoma do que sobrou.
    const novo = remaining <= 0;
    const ms = novo ? totalSetMs() : remaining;
    if (ms <= 0) return;
    if (novo) setDuracao(ms);
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
    setDuracao(0);
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
  };

  // Display: enquanto running/pausado mostra remaining; senão mostra
  // o valor configurado (HH:MM:SS preview).
  const displayMs = running || remaining > 0
    ? remaining
    : totalSetMs();
  const displaySec = Math.ceil(displayMs / 1000);
  const dH = Math.floor(displaySec / 3600);
  const dM = Math.floor((displaySec % 3600) / 60);
  const dS = displaySec % 60;

  const configurable = !running && remaining === 0;

  // Tempo pronto: um toque em vez de três selects.
  const definir = (totalSeg: number) => {
    if (!configurable) return;
    setHours(Math.floor(totalSeg / 3600));
    setMinutes(Math.floor((totalSeg % 3600) / 60));
    setSeconds(totalSeg % 60);
    if (finished) setFinished(false);
  };

  return {
    hours, setHours, minutes, setMinutes, seconds, setSeconds,
    running, remaining, finished, setFinished, duracao,
    start, pause, clear, totalSetMs, definir,
    dH, dM, dS, configurable,
  };
}

const TEMPOS_PRONTOS = [
  { rotulo: '1 min', seg: 60 }, { rotulo: '5 min', seg: 300 }, { rotulo: '10 min', seg: 600 },
  { rotulo: '15 min', seg: 900 }, { rotulo: '30 min', seg: 1800 }, { rotulo: '1 h', seg: 3600 },
];

function TimerPainel({
  hours, setHours, minutes, setMinutes, seconds, setSeconds,
  running, remaining, finished, setFinished, duracao,
  start, pause, clear, totalSetMs, definir, dH, dM, dS, configurable,
}: ReturnType<typeof useTimerRegressivo>) {
  const progresso = duracao > 0 && (running || remaining > 0) ? Math.max(0, Math.min(1, remaining / duracao)) : finished ? 0 : 1;
  const totalConfig = hours * 3600 + minutes * 60 + seconds;
  return (
    <div className="flex flex-col gap-5">
      <div className={`rounded-2xl border bg-black/20 pt-10 sm:pt-12 pb-6 px-5 flex flex-col items-center gap-5 ${
        finished ? 'border-red-500' : running ? 'border-purple-500/60' : 'border-white/10'}`}>
        <div className={`font-mono tabular-nums text-6xl sm:text-8xl font-black tracking-tight leading-none transition-colors ${
          finished ? 'text-red-500 animate-pulse' : 'text-accent'}`}>
          {pad2(dH)}:{pad2(dM)}:{pad2(dS)}
        </div>
        {/* Quanto do tempo já foi — de relance, sem fazer conta. */}
        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
          <div className={`h-full rounded-full transition-[width] duration-100 ${finished ? 'bg-red-500' : 'bg-purple-500'}`}
            style={{ width: `${progresso * 100}%` }} />
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${
          finished ? 'text-red-400' : running ? 'text-purple-300' : 'text-gray-500'}`}>
          {finished ? 'Tempo esgotado' : running ? 'Contando' : remaining > 0 ? 'Pausado' : 'Pronto para iniciar'}
        </span>
      </div>

      {configurable && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Tempos prontos</span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {TEMPOS_PRONTOS.map(t => (
                <button key={t.seg} type="button" onClick={() => definir(t.seg)}
                  className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                    totalConfig === t.seg ? 'bg-purple-600 border-purple-700 text-white' : 'border-white/10 text-gray-400 hover:text-gray-200'}`}>
                  {t.rotulo}
                </button>
              ))}
            </div>
          </div>

          {/* Mudar qualquer select limpa o `finished`: a pessoa está claramente
              reconfigurando para o próximo ciclo. */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Horas',    value: hours,   set: setHours,   max: 23 },
              { label: 'Minutos',  value: minutes, set: setMinutes, max: 59 },
              { label: 'Segundos', value: seconds, set: setSeconds, max: 59 },
            ].map(({ label, value, set, max }) => {
              const id = `timer-${label.toLowerCase()}`;
              return (
                <div key={label} className="flex flex-col gap-1">
                  <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 text-center">{label}</label>
                  <select id={id} value={value}
                    onChange={e => {
                      set(Number.parseInt(e.target.value, 10));
                      if (finished) setFinished(false);
                    }}
                    className="neu-input py-2 px-2 rounded-xl text-base font-mono font-bold tabular-nums w-full text-center">
                    {Array.from({ length: max + 1 }, (_, i) => (
                      <option key={i} value={i}>{pad2(i)}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        {!running ? (
          <button onClick={start} disabled={totalSetMs() === 0 && remaining === 0}
            className={`btn-solido btn-solido--verde ${BTN}`}>
            <Play size={15} /> {remaining > 0 ? 'Continuar' : 'Iniciar'}
          </button>
        ) : (
          <button onClick={pause} className={`btn-solido btn-solido--amarelo ${BTN}`}>
            <Pause size={15} /> Pausar
          </button>
        )}
        <button onClick={clear} disabled={remaining === 0 && !finished}
          className={`btn-solido btn-solido--preto ${BTN}`}>
          <RotateCcw size={15} /> Limpar
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// BOTÃO DA GRADE — a ferramenta fechada
// ─────────────────────────────────────────────────────────────────
// Fechado, o botão ainda mostra o que interessa de relance (`resumo`) — o
// estado dos relógios vive na view, então continua correndo com o modal
// fechado.
// É um bloco grande e não uma linha: com os quatro em linha fina, a tela
// ficava com dois terços vazios. O visor ocupa o meio, e o rodapé diz o que
// importa de cada um sem abrir o modal.
function BotaoFerramenta({
  icon: Icon, title, subtitle, resumo, rodape, ativo, cor, onClick,
}: {
  icon: any; title: string; subtitle: string;
  resumo: React.ReactNode; rodape?: React.ReactNode;
  ativo?: boolean; cor: CorAba; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`neu-flat rounded-2xl border text-left flex flex-col w-full h-full min-h-[13rem] overflow-hidden transition-all hover:-translate-y-0.5 hover:border-accent/50 ${
        ativo ? 'border-accent/60' : 'border-white/10'}`}>
      <div className={`${COR_ABA[cor].botao} flex items-center gap-3 px-5 py-3 shrink-0`}>
        <Icon size={20} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black uppercase tracking-widest truncate">{title}</h3>
          <span className="text-[10px] font-bold opacity-85 block truncate">{subtitle}</span>
        </div>
        {ativo && <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shrink-0" title="Em andamento" />}
      </div>
      <div className="flex-1 flex items-center justify-center px-5 py-6">
        <span className="font-mono tabular-nums text-5xl sm:text-6xl font-black text-accent tracking-tight leading-none text-center">
          {resumo}
        </span>
      </div>
      {rodape && (
        <div className="border-t border-white/10 px-5 py-3 text-xs text-gray-400 shrink-0">{rodape}</div>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// MODAL DA FERRAMENTA
// ─────────────────────────────────────────────────────────────────
function ModalFerramenta({
  icon: Icon, title, subtitle, cor, largo, onClose, children, fecharNoFundo = true,
}: {
  icon: any; title: string; subtitle: string; cor: CorAba;
  /** Alarmes: formulário e lista lado a lado precisam de largura. */
  largo?: boolean;
  onClose: () => void; children: React.ReactNode;
  /** Clique no fundo escuro fecha. Desligado onde há formulário: o clique
   *  fora é acidental e levaria embora o que a pessoa acabou de digitar. */
  fecharNoFundo?: boolean;
}) {
  // Esc fecha. O modal não guarda estado nenhum — quem guarda é a view —,
  // então fechar por engano não custa uma medição.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // O gesto de voltar do celular fecha a ferramenta, não a Central de Tempo.
  useVoltarInterno(true, onClose);

  return (
    // Sem `exit` e sem AnimatePresence de propósito: com animação de saída o
    // overlay `fixed inset-0` fica no DOM durante o fade-out e engole o clique
    // de quem fecha uma ferramenta e vai direto abrir a outra.
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={fecharNoFundo ? onClose : undefined}
    >
      <motion.div
        initial={{ scale: 0.97, y: 10 }} animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        role="dialog" aria-modal="true" aria-label={title}
        className={`neu-flat rounded-3xl w-full ${largo ? 'max-w-5xl' : 'max-w-2xl'} max-h-[92vh] flex flex-col overflow-hidden border border-white/10`}
        onClick={e => e.stopPropagation()}
      >
        <header className={`${COR_ABA[cor].botao} flex items-center justify-between gap-3 px-5 py-3 shrink-0`}>
          <div className="flex items-center gap-3 min-w-0">
            <Icon size={20} className="shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black uppercase tracking-widest truncate">{title}</h3>
              <span className="text-[10px] font-bold opacity-85 block truncate">{subtitle}</span>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn shrink-0" aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className="p-4 sm:p-6 overflow-y-auto main-scrollbar">{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────
// VIEW PRINCIPAL — grid 2x2 desktop, coluna única mobile
// ─────────────────────────────────────────────────────────────────
export const CentralTempoView = () => {
  const [aberta, setAberta] = useState<Ferramenta | null>(null);

  // Os quatro estados moram AQUI, não nos painéis: o modal monta e desmonta,
  // a view não. Cronômetro disparado e timer contando sobrevivem ao fechar.
  const relogio = useRelogioAcre();
  const cron    = useCronometro();
  const timer   = useTimerRegressivo();
  const alarmesApi = useAlarmesTurma();

  const ativos = alarmesApi.alarmes.filter(a => a.ativo).length;
  const proximo = proximoAlarmeHoje(alarmesApi.alarmes, relogio.hora.slice(0, 5));

  const fechar = useCallback(() => setAberta(null), []);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2 shrink-0">
        <Clock size={26} /> Central de Tempo
      </h2>

      {/* Os quatro blocos dividem a altura da tela em vez de ficarem em duas
          linhas finas no topo. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:auto-rows-fr gap-4 sm:gap-5 flex-1 min-h-0">
        <BotaoFerramenta icon={Clock} title="Relógio Digital" cor={COR.relogio}
          subtitle="Acre · America/Rio_Branco"
          resumo={relogio.hora}
          rodape={<span className="inline-block first-letter:uppercase">{relogio.dataStr}</span>}
          onClick={() => setAberta('relogio')} />

        <BotaoFerramenta icon={AlarmClock} title="Alarmes" cor={COR.alarmes}
          subtitle="Toca para a turma · em qualquer tela"
          resumo={alarmesApi.isLoading ? '—' : proximo ? `${pad2(proximo.hora)}:${pad2(proximo.minuto)}` : '--:--'}
          rodape={alarmesApi.isLoading ? 'Carregando…' : (
            <span className="flex items-center justify-between gap-3">
              <span className="truncate">
                {proximo ? <>Próximo hoje: <b className="text-gray-200">{ALARME_TITULO[proximo.tipo]}</b></> : 'Nenhum alarme até o fim do dia'}
              </span>
              <span className="shrink-0 font-bold text-gray-300">{ativos} ativo{ativos === 1 ? '' : 's'}</span>
            </span>
          )}
          ativo={ativos > 0}
          onClick={() => setAberta('alarmes')} />

        <BotaoFerramenta icon={TimerIcon} title="Cronômetro" cor={COR.cronometro}
          subtitle="Operação · com voltas"
          resumo={cron.fmtCurto(cron.elapsed)} ativo={cron.running}
          rodape={
            <span className="flex items-center justify-between gap-3">
              <span className={cron.running ? 'text-blue-400 font-bold' : ''}>
                {cron.running ? 'Contando' : cron.elapsed > 0 ? 'Pausado' : 'Parado'}
              </span>
              <span className="font-bold text-gray-300">{cron.laps.length} volta{cron.laps.length === 1 ? '' : 's'}</span>
            </span>
          }
          onClick={() => setAberta('cronometro')} />

        <BotaoFerramenta icon={Hourglass} title="Timer Regressivo" cor={COR.timer}
          subtitle="Contagem para zero"
          resumo={<span className={timer.finished ? 'text-red-500 animate-pulse' : ''}>{pad2(timer.dH)}:{pad2(timer.dM)}:{pad2(timer.dS)}</span>}
          ativo={timer.running || timer.finished}
          rodape={
            <span className="flex items-center gap-3">
              <span className={`shrink-0 ${timer.finished ? 'text-red-400 font-bold' : timer.running ? 'text-purple-300 font-bold' : ''}`}>
                {timer.finished ? 'Tempo esgotado' : timer.running ? 'Contando' : timer.remaining > 0 ? 'Pausado' : 'Pronto'}
              </span>
              <span className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <span className={`block h-full rounded-full ${timer.finished ? 'bg-red-500' : 'bg-purple-500'}`}
                  style={{ width: `${timer.duracao > 0 && (timer.running || timer.remaining > 0) ? Math.min(100, (timer.remaining / timer.duracao) * 100) : timer.finished ? 0 : 100}%` }} />
              </span>
            </span>
          }
          onClick={() => setAberta('timer')} />
      </div>

      {aberta === 'relogio' && (
        <ModalFerramenta icon={Clock} title="Relógio Digital" cor={COR.relogio}
          subtitle="Acre · America/Rio_Branco" onClose={fechar}>
          <RelogioPainel {...relogio} alarmes={alarmesApi.alarmes} />
        </ModalFerramenta>
      )}
      {aberta === 'alarmes' && (
        <ModalFerramenta icon={AlarmClock} title="Alarmes" cor={COR.alarmes} largo
          subtitle="Toca para a turma · em qualquer tela" onClose={fechar}
          fecharNoFundo={false}>
          <AlarmesPainel alarmesApi={alarmesApi} />
        </ModalFerramenta>
      )}
      {aberta === 'cronometro' && (
        <ModalFerramenta icon={TimerIcon} title="Cronômetro" cor={COR.cronometro}
          subtitle="Operação · com voltas" onClose={fechar}>
          <CronometroPainel {...cron} />
        </ModalFerramenta>
      )}
      {aberta === 'timer' && (
        <ModalFerramenta icon={Hourglass} title="Timer Regressivo" cor={COR.timer}
          subtitle="Contagem para zero" onClose={fechar}>
          <TimerPainel {...timer} />
        </ModalFerramenta>
      )}
    </motion.div>
  );
};
