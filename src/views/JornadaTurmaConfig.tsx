import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarDays, Clock, CalendarX2, Settings2, X, Check, Loader2, AlertTriangle, Trash2, Plus, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SecaoFormulario } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import {
  useJornadaTurma, horasDaJornada, EVENTO_JORNADA_ATUALIZADA, type JornadaTurma,
} from '../hooks/useJornadaTurma';

// Jornada da turma no Registro de Ponto.
//
// Cada turma é um projeto (banco próprio), então a linha única de
// `ponto_jornada` já é "a turma": uma tem aula segunda e terça de manhã, outra
// só quarta à tarde. Até aqui os dias moravam escondidos no card de frequência
// da competição e os horários só existiam em env da Vercel — trocar exigia
// redeploy. Agora ficam onde o ponto é lançado.
//
// Quem grava é admin/CEO da Matriz (`_assert_matriz_admin` no RPC). A
// frequência do placar, o atraso e a jornada em horas da folha leem daqui.

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
// Segunda primeiro: é como a turma lê a semana de aula.
const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0];
const TOLERANCIAS = [0, 1, 2, 3, 5, 10, 15];

type Excecao = { data: string; tipo: 'sem_aula' | 'aula_extra'; motivo: string | null };

const hhmm = (v: string) => /^\d{1,2}:\d{2}$/.test(v);
const fmtData = (d: string) => d.split('-').reverse().join('/');

/** 3.67 → "3h40" */
const fmtDuracao = (horas: number) => {
  const total = Math.round(horas * 60);
  const m = total % 60;
  return `${Math.floor(total / 60)}h${m ? String(m).padStart(2, '0') : ''}`;
};

/** [1,2] → "Segunda e Terça" */
const listaDias = (dias: number[]) => {
  const nomes = ORDEM_SEMANA.filter(d => dias.includes(d)).map(d => DIAS[d]);
  return nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
};

// ─── Faixa no topo do Registro de Ponto ──────────────────────────────────────

export function JornadaTurmaFaixa({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const jornada = useJornadaTurma();
  const [aberto, setAberto] = useState(false);
  const podeConfigurar = (profile?.role === 'admin' || profile?.role === 'ceo') && profile?.filial === 'Matriz';
  const semDias = jornada.dias_semana.length === 0;
  const pendente = semDias || !jornada.configurado;

  return (
    <>
      <div className="neu-flat rounded-3xl border border-accent/30 p-4 flex flex-col gap-3 shrink-0">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Jornada da turma</h3>
          </div>
          {pendente ? (
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-[#ca8a04] bg-[#eab308] text-[#0a0a0a]">
              <AlertTriangle size={10} /> Configuração pendente
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-[#15803d] bg-[#16a34a] text-white">
              <CheckCircle2 size={10} /> Configurada
            </span>
          )}
          {podeConfigurar && (
            <button onClick={() => setAberto(true)}
              className="ml-auto btn-solido btn-solido--dourado !py-2 !text-xs">
              <Settings2 size={13} /> Configurar
            </button>
          )}
        </div>

        {/* Corpo: dias à esquerda, horários à direita */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="neu-pressed rounded-2xl p-3 flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Dias de aula</span>
            <div className="grid grid-cols-7 gap-1">
              {ORDEM_SEMANA.map(d => {
                const tem = jornada.dias_semana.includes(d);
                return (
                  <div key={d}
                    className={`text-center text-[11px] font-bold py-1.5 rounded-lg border ${
                      tem
                        ? 'bg-[#16a34a] text-white border-[#15803d]'
                        : 'border-white/15 text-gray-500'
                    }`}>
                    {DIAS_CURTO[d]}
                  </div>
                );
              })}
            </div>
            <span className={`text-[11px] ${semDias ? 'text-amber-300/90' : 'text-gray-400'}`}>
              {semDias
                ? 'Nenhum dia definido — falta não está sendo cobrada.'
                : `${jornada.dias_semana.length} dia${jornada.dias_semana.length === 1 ? '' : 's'} por semana`}
            </span>
          </div>

          <div className="neu-pressed rounded-2xl p-3 flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Horários</span>
            <div className="grid grid-cols-3 gap-2">
              {([
                // Mesmas cores sólidas do design system (.btn-solido--verde/amarelo/vermelho).
                ['Entrada', jornada.entrada, 'bg-[#16a34a] border-[#15803d]', 'text-white'],
                ['Retorno', jornada.retorno, 'bg-[#eab308] border-[#ca8a04]', 'text-[#0a0a0a]'],
                ['Saída',   jornada.saida,   'bg-[#dc2626] border-[#b91c1c]', 'text-white'],
              ] as const).map(([rotulo, valor, caixa, texto]) => (
                <div key={rotulo} className={`rounded-lg border py-1 flex flex-col items-center ${caixa}`}>
                  <span className={`text-base font-black font-mono tabular-nums leading-tight ${texto}`}>{valor}</span>
                  <span className={`text-[9px] uppercase tracking-widest font-bold ${texto} opacity-80`}>{rotulo}</span>
                </div>
              ))}
            </div>
            <span className={`text-[11px] ${jornada.configurado ? 'text-gray-400' : 'text-amber-300/90'}`}>
              {jornada.configurado
                ? `Jornada de ${fmtDuracao(horasDaJornada(jornada))} · tolerância de ${jornada.tolerancia_min} min`
                : 'Horário padrão, não confirmado — atraso não está sendo contado.'}
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {aberto && (
          <JornadaTurmaModal jornada={jornada} showToast={showToast} onClose={() => setAberto(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Modal de configuração ───────────────────────────────────────────────────

function JornadaTurmaModal({ jornada, showToast, onClose }: {
  jornada: JornadaTurma; showToast: any; onClose: () => void;
}) {
  const [dias, setDias] = useState<number[]>(jornada.dias_semana);
  const [entrada, setEntrada] = useState(jornada.entrada);
  const [retorno, setRetorno] = useState(jornada.retorno);
  const [saida, setSaida] = useState(jornada.saida);
  const [tolerancia, setTolerancia] = useState(jornada.tolerancia_min);
  const [salvando, setSalvando] = useState(false);

  const [excecoes, setExcecoes] = useState<Excecao[]>([]);
  const [novaData, setNovaData] = useState('');
  const [novoTipo, setNovoTipo] = useState<'sem_aula' | 'aula_extra'>('sem_aula');
  const [novoMotivo, setNovoMotivo] = useState('');
  const [gravandoExc, setGravandoExc] = useState(false);

  const carregarExcecoes = useCallback(async () => {
    const { data } = await supabase!.from('ponto_calendario_excecoes').select('data, tipo, motivo').order('data');
    setExcecoes((data ?? []) as Excecao[]);
  }, []);
  useEffect(() => { carregarExcecoes(); }, [carregarExcecoes]);

  const toggle = (d: number) =>
    setDias(atual => atual.includes(d) ? atual.filter(x => x !== d) : [...atual, d].sort());

  // Ligar o calendário vale a partir de hoje (migr. 636): o passado não vira
  // falta retroativa. Vale avisar antes de gravar, não depois.
  const ligandoCalendario = jornada.dias_semana.length === 0 && dias.length > 0;
  const desligandoCalendario = jornada.dias_semana.length > 0 && dias.length === 0;

  const horariosOk = [entrada, retorno, saida].every(hhmm) && entrada < retorno && retorno < saida;

  const salvar = async () => {
    if (![entrada, retorno, saida].every(hhmm)) return showToast('Preencha entrada, retorno e saída.', 'error');
    if (!horariosOk) return showToast('Os horários precisam seguir a ordem: entrada, retorno, saída.', 'error');
    setSalvando(true);
    const { error } = await supabase!.rpc('definir_ponto_jornada', {
      p_entrada: entrada,
      p_retorno: retorno,
      p_saida: saida,
      p_tolerancia_min: tolerancia,
      p_dias_semana: dias,
    });
    setSalvando(false);
    if (error) return showToast(error.message || 'Erro ao salvar a jornada.', 'error');
    window.dispatchEvent(new Event(EVENTO_JORNADA_ATUALIZADA));
    showToast('Jornada da turma salva.', 'success');
    onClose();
  };

  const addExcecao = async () => {
    if (!novaData) return showToast('Escolha a data.', 'error');
    setGravandoExc(true);
    const { error } = await supabase!.rpc('definir_excecao_calendario', {
      p_data: novaData, p_tipo: novoTipo, p_motivo: novoMotivo.trim() || null,
    });
    setGravandoExc(false);
    if (error) return showToast(error.message || 'Erro ao salvar a data.', 'error');
    setNovaData(''); setNovoMotivo('');
    carregarExcecoes();
    window.dispatchEvent(new Event(EVENTO_JORNADA_ATUALIZADA));
  };

  const removerExcecao = async (data: string) => {
    const { error } = await supabase!.rpc('remover_excecao_calendario', { p_data: data });
    if (error) return showToast(error.message || 'Erro ao remover.', 'error');
    carregarExcecoes();
    window.dispatchEvent(new Event(EVENTO_JORNADA_ATUALIZADA));
  };

  const rotulo = 'text-[10px] uppercase tracking-widest font-bold text-gray-500';
  const campoHora = (label: string, valor: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className={rotulo}>{label}</span>
      <input type="time" value={valor} onChange={e => set(e.target.value)}
        className="neu-input w-full py-2.5 px-3 text-base font-mono rounded-xl text-gray-100" />
    </label>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 sm:p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        className="neu-flat rounded-3xl border border-white/10 bg-base w-full max-w-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 p-5 sm:p-6 pb-4 border-b border-white/5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-accent">Dias e horários da turma</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Vale para a turma inteira: frequência, atraso e jornada da folha.
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 sm:p-6 flex flex-col gap-5">
          {/* 1. Dias */}
          <SecaoFormulario titulo="1 · Dias com aula" icon={CalendarDays} cor="verde"
            extra={dias.length ? `${dias.length} por semana` : 'nenhum marcado'}>
            <div className="grid grid-cols-7 gap-1.5">
              {ORDEM_SEMANA.map(d => {
                const marcado = dias.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggle(d)} aria-pressed={marcado} title={DIAS[d]}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-bold transition-colors ${
                      marcado
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                        : 'border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'
                    }`}>
                    {DIAS_CURTO[d]}
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center ${
                      marcado ? 'bg-emerald-500 text-black' : 'border border-white/15'
                    }`}>
                      {marcado && <Check size={10} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              {dias.length
                ? <>Aula às <b className="text-gray-200">{listaDias(dias)}</b>. Dia de aula sem ponto lançado conta como falta.</>
                : 'Sem dias marcados, a frequência considera só o que foi lançado.'}
            </p>
            {(ligandoCalendario || desligandoCalendario) && (
              <p className="flex items-start gap-1.5 text-xs text-amber-300/90 mt-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {ligandoCalendario
                  ? 'A cobrança de falta começa hoje — dias anteriores não viram falta retroativa.'
                  : 'Ao salvar, quem não lançar ponto deixa de contar falta.'}
              </p>
            )}
          </SecaoFormulario>

          {/* 2. Horários */}
          <SecaoFormulario titulo="2 · Horários" icon={Clock} cor="azul"
            extra={horariosOk ? `jornada de ${fmtDuracao(horasDaJornada({ entrada, saida }))}` : undefined}>
            <div className="grid grid-cols-3 gap-3">
              {campoHora('Entrada', entrada, setEntrada)}
              {campoHora('Retorno', retorno, setRetorno)}
              {campoHora('Saída', saida, setSaida)}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-4 pt-4 border-t border-white/5">
              <label className="flex items-center gap-2">
                <span className={rotulo}>Tolerância de atraso</span>
                <select value={tolerancia} onChange={e => setTolerancia(Number(e.target.value))}
                  className="neu-input py-1.5 px-3 text-sm rounded-xl text-gray-100">
                  {[...new Set([...TOLERANCIAS, tolerancia])].sort((a, b) => a - b).map(t =>
                    <option key={t} value={t}>{t} min</option>)}
                </select>
              </label>
              {!horariosOk && (
                <span className="flex items-center gap-1.5 text-xs text-red-300">
                  <AlertTriangle size={12} /> Entrada, retorno e saída precisam estar em ordem.
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Retorno = volta do intervalo. A saída também marca o fim do turno nas máquinas do laboratório.
            </p>
          </SecaoFormulario>

          {/* 3. Exceções */}
          <SecaoFormulario titulo="3 · Feriados e reposições" icon={CalendarX2} cor="laranja"
            extra="salvo ao adicionar">
            <div className="grid grid-cols-1 sm:grid-cols-[auto_auto_1fr_auto] gap-2">
              <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)}
                className="neu-input py-2 px-3 text-sm rounded-xl text-gray-100" />
              <select value={novoTipo} onChange={e => setNovoTipo(e.target.value as 'sem_aula' | 'aula_extra')}
                className="neu-input py-2 px-3 text-sm rounded-xl text-gray-100">
                <option value="sem_aula">Sem aula</option>
                <option value="aula_extra">Aula extra</option>
              </select>
              <input type="text" value={novoMotivo} onChange={e => setNovoMotivo(e.target.value)}
                placeholder="Motivo (opcional)" data-trava-atualizacao="nao"
                className="neu-input py-2 px-3 text-sm rounded-xl text-gray-100 min-w-0" />
              <button onClick={addExcecao} disabled={gravandoExc || !novaData}
                className="flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-40">
                {gravandoExc ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Adicionar
              </button>
            </div>

            {excecoes.length > 0 ? (
              <div className="flex flex-col mt-4 rounded-xl border border-white/5 divide-y divide-white/5">
                {excecoes.map(e => (
                  <div key={e.data} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-gray-200 font-mono tabular-nums">{fmtData(e.data)}</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                      e.tipo === 'sem_aula'
                        ? 'border-red-500/40 bg-red-500/10 text-red-300'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    }`}>
                      {e.tipo === 'sem_aula' ? 'Sem aula' : 'Aula extra'}
                    </span>
                    <span className="text-gray-500 truncate flex-1">{e.motivo ?? ''}</span>
                    <button onClick={() => removerExcecao(e.data)} title="Remover data" className="action-btn-delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 mt-3">
                Nenhuma data cadastrada. Use “Sem aula” para feriado ou recesso e “Aula extra” para reposição.
              </p>
            )}
          </SecaoFormulario>
        </div>

        {/* Rodapé */}
        <div className="flex justify-end gap-2 px-5 sm:px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold neu-button text-gray-400 hover:text-gray-200">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando || !horariosOk}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-50">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar jornada
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
