import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarDays, Clock, CalendarX2, Settings2, X, Check, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SecaoFormulario } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { useJornadaTurma, EVENTO_JORNADA_ATUALIZADA, type JornadaTurma } from '../hooks/useJornadaTurma';

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
const TOLERANCIAS = [0, 1, 2, 3, 5, 10, 15];

type Excecao = { data: string; tipo: 'sem_aula' | 'aula_extra'; motivo: string | null };

const hhmm = (v: string) => /^\d{1,2}:\d{2}$/.test(v);
const fmtData = (d: string) => d.split('-').reverse().join('/');

/** Faixa com a jornada vigente + botão de configurar (admin/CEO da Matriz). */
export function JornadaTurmaFaixa({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const jornada = useJornadaTurma();
  const [aberto, setAberto] = useState(false);
  const podeConfigurar = (profile?.role === 'admin' || profile?.role === 'ceo') && profile?.filial === 'Matriz';
  const semDias = jornada.dias_semana.length === 0;

  return (
    <>
      <div className="neu-pressed rounded-2xl border border-white/5 px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap shrink-0">
        <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Jornada da turma</span>
        <span className="flex items-center gap-1.5 text-xs font-bold">
          <CalendarDays size={13} className={semDias ? 'text-amber-400' : 'text-emerald-400'} />
          {semDias
            ? <span className="text-amber-300">Dias de aula não definidos</span>
            : <span className="text-gray-200">{jornada.dias_semana.map(d => DIAS_CURTO[d]).join(' · ')}</span>}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-gray-200 tabular-nums">
          <Clock size={13} className={jornada.configurado ? 'text-blue-400' : 'text-amber-400'} />
          {jornada.entrada} <span className="text-gray-500 font-normal">entrada</span>
          · {jornada.retorno} <span className="text-gray-500 font-normal">retorno</span>
          · {jornada.saida} <span className="text-gray-500 font-normal">saída</span>
        </span>
        {!jornada.configurado && (
          <span className="text-[10px] text-amber-300/90 font-bold">horário padrão do site, ainda não confirmado</span>
        )}
        {podeConfigurar && (
          <button onClick={() => setAberto(true)}
            className="ml-auto flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40">
            <Settings2 size={12} /> Configurar dias e horários
          </button>
        )}
      </div>
      <AnimatePresence>
        {aberto && (
          <JornadaTurmaModal jornada={jornada} showToast={showToast} onClose={() => setAberto(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

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

  const salvar = async () => {
    if (![entrada, retorno, saida].every(hhmm)) return showToast('Preencha entrada, retorno e saída.', 'error');
    if (!(entrada < retorno && retorno < saida)) {
      return showToast('Os horários precisam seguir a ordem: entrada, retorno, saída.', 'error');
    }
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

  const campoHora = (label: string, valor: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{label}</span>
      <input type="time" value={valor} onChange={e => set(e.target.value)}
        className="neu-input py-2 px-3 text-sm font-mono rounded-xl text-gray-100" />
    </label>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="neu-flat rounded-3xl p-6 border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-y-auto main-scrollbar flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-accent">Dias e horários da turma</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Vale para esta turma inteira: frequência, atraso e jornada da folha.
            </p>
          </div>
          <button onClick={onClose} className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <SecaoFormulario titulo="Dias com aula" icon={CalendarDays} cor="verde">
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((label, d) => (
              <button key={d} type="button" onClick={() => toggle(d)} aria-pressed={dias.includes(d)}
                className={`text-xs font-bold px-3 py-2 rounded-xl transition-colors ${
                  dias.includes(d)
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'neu-button text-gray-500 hover:text-gray-300 border border-transparent'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 leading-snug mt-2">
            Com dias marcados, dia de aula sem ponto lançado conta como falta. Nenhum dia marcado = vale só o que foi lançado.
          </p>
          {ligandoCalendario && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-300/90 leading-snug mt-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              A cobrança de falta passa a valer a partir de hoje — dias anteriores não viram falta retroativa.
            </p>
          )}
          {desligandoCalendario && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-300/90 leading-snug mt-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              Sem dias marcados, quem não lançar ponto deixa de contar falta.
            </p>
          )}
        </SecaoFormulario>

        <SecaoFormulario titulo="Horários" icon={Clock} cor="azul">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {campoHora('Entrada', entrada, setEntrada)}
            {campoHora('Retorno do intervalo', retorno, setRetorno)}
            {campoHora('Saída', saida, setSaida)}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Tolerância</span>
              <select value={tolerancia} onChange={e => setTolerancia(Number(e.target.value))}
                className="neu-input py-2 px-3 text-sm rounded-xl text-gray-100">
                {[...new Set([...TOLERANCIAS, tolerancia])].sort((a, b) => a - b).map(t => <option key={t} value={t}>{t} min</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-gray-500 leading-snug mt-2">
            Chegar depois da entrada + tolerância conta como atraso. A saída também marca o fim do turno nas máquinas do laboratório.
          </p>
        </SecaoFormulario>

        <SecaoFormulario titulo="Feriados e reposições" icon={CalendarX2} cor="laranja"
          extra="gravado na hora">
          <div className="flex items-center gap-1.5 flex-wrap">
            <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)}
              className="neu-input py-2 px-3 text-xs rounded-xl text-gray-100" />
            <select value={novoTipo} onChange={e => setNovoTipo(e.target.value as 'sem_aula' | 'aula_extra')}
              className="neu-input py-2 px-3 text-xs rounded-xl text-gray-100">
              <option value="sem_aula">Sem aula</option>
              <option value="aula_extra">Aula extra</option>
            </select>
            <input type="text" value={novoMotivo} onChange={e => setNovoMotivo(e.target.value)}
              placeholder="Motivo (opcional)" data-trava-atualizacao="nao"
              className="neu-input py-2 px-3 text-xs rounded-xl text-gray-100 flex-1 min-w-[140px]" />
            <button onClick={addExcecao} disabled={gravandoExc}
              className="text-[11px] font-bold px-3 py-2 rounded-xl neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-50">
              Adicionar
            </button>
          </div>
          {excecoes.length > 0 ? (
            <div className="flex flex-col gap-1 pt-3">
              {excecoes.map(e => (
                <div key={e.data} className="flex items-center gap-2 text-xs">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                    e.tipo === 'sem_aula' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
                  }`}>
                    {e.tipo === 'sem_aula' ? 'sem aula' : 'aula extra'}
                  </span>
                  <span className="text-gray-300 tabular-nums">{fmtData(e.data)}</span>
                  <span className="text-gray-500 truncate flex-1">{e.motivo ?? '—'}</span>
                  <button onClick={() => removerExcecao(e.data)} title="Remover data" className="action-btn-delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500 pt-2">Nenhuma data cadastrada.</p>
          )}
        </SecaoFormulario>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold neu-button text-gray-400 hover:text-gray-200">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-50">
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar jornada
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
