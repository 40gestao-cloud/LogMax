import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2, AlertTriangle, Clock, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState } from '../components/ui';
import { PONTO_HORARIOS } from '../lib/pontoHorarios';
import type { UserProfile } from '../hooks/useUserProfile';

// Frequência de Trabalho — medida, não votada (migr. 349/350).
//
// Era um eixo 0-10 que cada conselheiro dava no olho, sendo que
// `ponto_eletronico` já sabe quem esteve presente em cada dia do período da
// competição. Aqui a régua fica inteira na tela: presenças, faltas,
// justificados e atrasos crus ao lado da taxa que entra no placar — o aluno
// consegue conferir o próprio número em vez de receber uma nota fechada.
type LinhaFreq = {
  filial: string;
  registros: number;
  presencas: number;
  faltas: number;
  justificados: number;
  atrasos: number;
  dias_distintos: number;
  funcionarios_ativos: number;
  taxa_presenca: number | null;
  jornada_entrada: string | null;
  jornada_tolerancia: number | null;
  atraso_conta: boolean;
  // Migr. 376: com calendário da turma configurado, dia letivo sem lançamento
  // vira falta. Sem calendário, a conta continua sendo só o que foi lançado.
  // Opcionais: a RPC só devolve os três a partir da 376. Enquanto o banco de
  // alguma turma estiver atrás do deploy, a tela cai no comportamento antigo
  // em vez de renderizar "24/undefined".
  ausencias?: number;
  esperado?: number;
  tem_calendario?: boolean;
};

const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Ordem canônica das unidades no projeto inteiro. A RPC devolve alfabético
// (MaxLook viria primeiro), então a ordenação é aqui.
const ORDEM = ['SuperMax', 'MaxLook', 'TechMax'];

const TONE: Record<string, string> = {
  SuperMax: 'bg-sky-500/20 text-sky-300',
  MaxLook:  'bg-amber-400/20 text-amber-200',
  TechMax:  'bg-orange-500/20 text-orange-300',
};

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.0', '')}%`;

export function FrequenciaFiliaisCard({ competicaoId, profile, showToast }: {
  competicaoId: string;
  profile: UserProfile;
  showToast?: any;
}) {
  const [linhas, setLinhas] = useState<LinhaFreq[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('frequencia_filiais_competicao', {
      p_competicao_id: competicaoId,
    });
    if (error) setErro(error.message);
    else {
      setErro(null);
      setLinhas([...((data ?? []) as LinhaFreq[])].sort(
        (a, b) => ORDEM.indexOf(a.filial) - ORDEM.indexOf(b.filial),
      ));
    }
    setLoading(false);
  }, [competicaoId]);

  useEffect(() => { setLoading(true); carregar(); }, [carregar]);

  // Ponto lançado durante a competição muda a nota; a tela acompanha.
  useEffect(() => {
    const canal = supabase
      .channel(`freq-filiais-${competicaoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ponto_eletronico' }, () => carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ponto_jornada' }, () => carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ponto_calendario_excecoes' }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [competicaoId, carregar]);

  // A jornada é a mesma em todas as linhas (uma por projeto).
  const jornada = linhas[0] ?? null;
  const atrasoConta = !!jornada?.atraso_conta;

  return (
    <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarCheck size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-gray-200">Frequência de Trabalho</h3>
        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Medida, não votada
        </span>
        <span className="text-[10px] text-gray-500 font-bold">vale 20% do placar</span>
        {atrasoConta && jornada?.jornada_entrada && (
          <span className="text-[10px] text-gray-500 font-bold flex items-center gap-1">
            <Clock size={10} /> entrada {jornada.jornada_entrada}
            {jornada.jornada_tolerancia ? ` (+${jornada.jornada_tolerancia} min)` : ''} · atraso vale meio dia
          </span>
        )}
      </div>

      {!loading && !erro && linhas.length > 0 && !atrasoConta && (
        <JornadaNaoConfigurada profile={profile} showToast={showToast} onSalvo={carregar} />
      )}

      {!loading && !erro && linhas.length > 0 && (
        <CalendarioTurma
          profile={profile}
          showToast={showToast}
          onSalvo={carregar}
          configurado={!!jornada?.tem_calendario}
          entradaAtual={jornada?.jornada_entrada ?? null}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-accent" /></div>
      ) : erro ? (
        <EmptyState message={`Não foi possível calcular a frequência: ${erro}`} />
      ) : linhas.length === 0 ? (
        <EmptyState message="Sem dado de ponto no período desta competição." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {linhas.map(l => {
            const semRegistro = l.registros === 0;
            // Um lançamento por funcionário por dia é o esperado. Muito abaixo
            // disso, a taxa é alta porque faltou lançar, não porque a turma
            // compareceu — e é justamente assim que o eixo seria burlado.
            // Com calendário configurado, faltar de lançar JÁ pune (a ausência
            // entra como falta), então o alerta perde a função. Sem calendário
            // ele continua sendo a única defesa contra taxa inflada.
            const esperado = l.esperado ?? (l.dias_distintos * l.funcionarios_ativos);
            const subnotificado = !semRegistro && !l.tem_calendario && esperado > 0
              && (l.registros + l.justificados) < esperado * 0.8;
            return (
              <div key={l.filial} className="neu-pressed rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${TONE[l.filial] ?? 'bg-gray-500/20 text-gray-300'}`}>
                    {l.filial}
                  </span>
                  <span className={`text-2xl font-mono font-black tabular-nums ${
                    l.taxa_presenca == null ? 'text-gray-600'
                      : l.taxa_presenca >= 0.9 ? 'text-emerald-300'
                      : l.taxa_presenca >= 0.75 ? 'text-amber-300'
                      : 'text-red-300'
                  }`}>
                    {l.taxa_presenca == null ? '—' : pct(l.taxa_presenca)}
                  </span>
                </div>

                {semRegistro ? (
                  <p className="text-[11px] text-gray-500 italic">
                    Nenhum ponto lançado no período — a frequência não entra no placar desta filial.
                  </p>
                ) : (
                  <>
                    {/* Presenças aqui é a presença PONTUAL: quem chegou atrasado
                        aparece na própria coluna, senão o mesmo dia seria contado
                        duas vezes na leitura. Justificado saiu do card — está
                        fora da conta por definição e só polui a comparação. */}
                    <div className={`grid ${l.tem_calendario ? 'grid-cols-4' : 'grid-cols-3'} gap-1 text-center`}>
                      <Numero label="Presenças" valor={l.presencas - l.atrasos} tom="text-emerald-300" />
                      <Numero label="Faltas"    valor={l.faltas}   tom="text-red-300" />
                      <Numero label="Atrasos"   valor={l.atrasos}  tom="text-amber-300" />
                      {/* Sem calendário, ausência não é medível: o dia sem
                          lançamento não existe pra conta (migr. 376). */}
                      {l.tem_calendario && (
                        <Numero label="Sem registro" valor={l.ausencias ?? 0} tom="text-red-300" />
                      )}
                    </div>
                    <span className="text-[10px] text-gray-500 tabular-nums pt-1 border-t border-white/5">
                      {l.registros}/{esperado} lançado{esperado === 1 ? '' : 's'} · {l.dias_distintos} dia{l.dias_distintos === 1 ? '' : 's'} {l.tem_calendario ? 'letivo' : 'com ponto'}{l.dias_distintos === 1 ? '' : 's'} · {l.funcionarios_ativos} funcionário{l.funcionarios_ativos === 1 ? '' : 's'}
                      {l.justificados > 0 && ` · ${l.justificados} justificado${l.justificados === 1 ? '' : 's'} fora da conta`}
                    </span>
                    {subnotificado && (
                      <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 leading-snug">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        Faltou lançar ponto em boa parte dos dias — taxa alta aqui pode ser ausência de
                        registro, não presença.
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Enquanto ninguém confirma o horário da turma, o atraso fica fora da conta
// (migr. 350). O default do banco é o horário da manhã: aplicar isso numa turma
// da tarde marcaria TODO mundo como atrasado e derrubaria as 3 filiais por erro
// de configuração. Então o cálculo espera a confirmação — e o caminho mais curto
// pra ela é este formulário, já preenchido com o horário deste site.
function JornadaNaoConfigurada({ profile, showToast, onSalvo }: {
  profile: UserProfile;
  showToast?: any;
  onSalvo: () => void;
}) {
  const podeConfigurar = profile.role === 'admin' || profile.role === 'ceo';
  const [entrada, setEntrada] = useState(PONTO_HORARIOS.entrada);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!/^\d{1,2}:\d{2}$/.test(entrada)) return showToast?.('Horário inválido — use HH:MM', 'error');
    setSalvando(true);
    const { error } = await supabase.rpc('definir_ponto_jornada', {
      p_entrada:        entrada,
      p_retorno:        PONTO_HORARIOS.retorno,
      p_saida:          PONTO_HORARIOS.saida,
      p_tolerancia_min: 1,
    });
    setSalvando(false);
    if (error) return showToast?.(error.message || 'Erro ao salvar jornada', 'error');
    showToast?.('Horário da turma confirmado — atraso passa a valer meio dia', 'success');
    onSalvo();
  };

  return (
    <div className="neu-pressed rounded-xl border border-amber-500/30 p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-300 leading-snug">
          <b className="text-amber-300">Atraso ainda não está sendo contado.</b> O horário de entrada
          desta turma nunca foi confirmado no banco, e o cálculo não chuta: aplicar o horário errado
          marcaria a turma inteira como atrasada. {podeConfigurar
            ? 'Confirme abaixo — o valor já vem do horário configurado neste site.'
            : 'Admin ou CEO precisa confirmar o horário para o atraso entrar na conta.'}
        </p>
      </div>
      {podeConfigurar && (
        <div className="flex items-center gap-2 flex-wrap pl-6">
          <label className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Entrada</label>
          <input
            type="time"
            value={entrada}
            onChange={e => setEntrada(e.target.value)}
            className="neu-input py-1.5 px-2 text-sm font-mono rounded-lg text-gray-100"
          />
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-50"
          >
            {salvando ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Confirmar horário da turma
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendário da turma (migr. 376).
//
// Sem ele, o denominador da frequência é "o que foi lançado" — e aí não faltar
// e não registrar dão o mesmo número. Com ele, cada pessoa ativa responde por
// cada dia letivo: ausência sem lançamento vira falta.
//
// Mora aqui, e não no código, porque cada turma tem um calendário: hoje ERP,
// contabilidade e aprendiz têm 2 dias por semana e adm tem 1 — e a próxima
// turma pode ter 5.
// ─────────────────────────────────────────────────────────────────────────────
type Excecao = { data: string; tipo: 'sem_aula' | 'aula_extra'; motivo: string | null };

function CalendarioTurma({ profile, showToast, onSalvo, configurado, entradaAtual }: {
  profile: UserProfile;
  showToast?: any;
  onSalvo: () => void;
  configurado: boolean;
  entradaAtual: string | null;
}) {
  const podeConfigurar = profile.role === 'admin' || profile.role === 'ceo';
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState<number[]>([]);
  const [excecoes, setExcecoes] = useState<Excecao[]>([]);
  const [novaData, setNovaData] = useState('');
  const [novoTipo, setNovoTipo] = useState<'sem_aula' | 'aula_extra'>('sem_aula');
  const [novoMotivo, setNovoMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregarConfig = useCallback(async () => {
    const [{ data: j }, { data: ex }] = await Promise.all([
      supabase.from('ponto_jornada').select('dias_semana').eq('id', true).maybeSingle(),
      supabase.from('ponto_calendario_excecoes').select('data, tipo, motivo').order('data'),
    ]);
    setDias((((j as any)?.dias_semana ?? []) as number[]));
    setExcecoes((ex ?? []) as Excecao[]);
  }, []);

  useEffect(() => { if (aberto) carregarConfig(); }, [aberto, carregarConfig]);

  const salvarDias = async () => {
    setSalvando(true);
    const { error } = await supabase.rpc('definir_ponto_jornada', {
      p_entrada: entradaAtual ?? PONTO_HORARIOS.entrada,
      p_dias_semana: dias,
    });
    setSalvando(false);
    if (error) return showToast?.(error.message || 'Erro ao salvar calendário', 'error');
    showToast?.(dias.length === 0
      ? 'Calendário limpo — a frequência volta a medir só o que for lançado.'
      : 'Calendário salvo — dia letivo sem lançamento passa a contar como falta.', 'success');
    onSalvo();
  };

  const addExcecao = async () => {
    if (!novaData) return showToast?.('Escolha a data.', 'error');
    setSalvando(true);
    const { error } = await supabase.rpc('definir_excecao_calendario', {
      p_data: novaData, p_tipo: novoTipo, p_motivo: novoMotivo.trim() || null,
    });
    setSalvando(false);
    if (error) return showToast?.(error.message || 'Erro ao salvar exceção', 'error');
    setNovaData(''); setNovoMotivo('');
    await carregarConfig();
    onSalvo();
  };

  const removerExcecao = async (data: string) => {
    const { error } = await supabase.rpc('remover_excecao_calendario', { p_data: data });
    if (error) return showToast?.(error.message || 'Erro ao remover', 'error');
    await carregarConfig();
    onSalvo();
  };

  const editor = (
    <EditorCalendario
      dias={dias} setDias={setDias} salvarDias={salvarDias} salvando={salvando}
      excecoes={excecoes} novaData={novaData} setNovaData={setNovaData}
      novoTipo={novoTipo} setNovoTipo={setNovoTipo} novoMotivo={novoMotivo}
      setNovoMotivo={setNovoMotivo} addExcecao={addExcecao} removerExcecao={removerExcecao}
    />
  );

  if (!configurado) {
    return (
      <div className="neu-pressed rounded-xl border border-amber-500/30 p-3 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-300 leading-snug">
            <b className="text-amber-300">Faltar ainda não está descontando.</b> Sem os dias de aula desta
            turma, o cálculo só divide pelo que foi lançado — quem não registra ponto não aparece na conta.
            {podeConfigurar
              ? ' Marque abaixo os dias em que esta turma tem aula.'
              : ' Admin ou CEO precisa configurar os dias de aula da turma.'}
          </p>
        </div>
        {podeConfigurar && (
          <button onClick={() => setAberto(a => !a)}
            className="self-start flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 ml-6">
            <CalendarCheck size={11} /> Configurar calendário da turma
          </button>
        )}
        {aberto && podeConfigurar && editor}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500 font-bold">
        <CalendarCheck size={11} className="text-emerald-400" />
        <span className="text-emerald-300">Calendário da turma ativo</span>
        <span>· dia letivo sem lançamento conta como falta</span>
        {podeConfigurar && (
          <button onClick={() => setAberto(a => !a)} className="text-accent underline underline-offset-2">
            {aberto ? 'fechar' : 'editar'}
          </button>
        )}
      </div>
      {aberto && podeConfigurar && editor}
    </div>
  );
}

function EditorCalendario({ dias, setDias, salvarDias, salvando, excecoes, novaData, setNovaData,
  novoTipo, setNovoTipo, novoMotivo, setNovoMotivo, addExcecao, removerExcecao }: {
  dias: number[];
  setDias: React.Dispatch<React.SetStateAction<number[]>>;
  salvarDias: () => void;
  salvando: boolean;
  excecoes: Excecao[];
  novaData: string;
  setNovaData: (v: string) => void;
  novoTipo: 'sem_aula' | 'aula_extra';
  setNovoTipo: (v: 'sem_aula' | 'aula_extra') => void;
  novoMotivo: string;
  setNovoMotivo: (v: string) => void;
  addExcecao: () => void;
  removerExcecao: (data: string) => void;
}) {
  const toggle = (d: number) =>
    setDias(atual => atual.includes(d) ? atual.filter(x => x !== d) : [...atual, d].sort());

  return (
    <div className="neu-pressed rounded-xl p-3 flex flex-col gap-3 mt-1">
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] uppercase tracking-widest font-bold text-gray-500">
          Dias com aula
        </label>
        <div className="flex items-center gap-1.5 flex-wrap">
          {DIAS_LABEL.map((label, d) => (
            <button key={d} onClick={() => toggle(d)}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                dias.includes(d)
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'neu-button text-gray-500 hover:text-gray-300'
              }`}>
              {label}
            </button>
          ))}
          <button onClick={salvarDias} disabled={salvando}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-50">
            {salvando ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Salvar
          </button>
        </div>
        <p className="text-[10px] text-gray-500 leading-snug">
          Nenhum dia marcado = calendário desligado: volta a valer só o que foi lançado. Lançamento em dia
          sem aula é ignorado, e quem foi admitido no meio do período só responde a partir da admissão.
        </p>
      </div>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
        <label className="text-[10px] uppercase tracking-widest font-bold text-gray-500">
          Feriado, recesso ou reposição
        </label>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)}
            className="neu-input py-1.5 px-2 text-xs rounded-lg text-gray-100" />
          <select value={novoTipo} onChange={e => setNovoTipo(e.target.value as 'sem_aula' | 'aula_extra')}
            className="neu-input py-1.5 px-2 text-xs rounded-lg text-gray-100">
            <option value="sem_aula">Sem aula</option>
            <option value="aula_extra">Aula extra</option>
          </select>
          <input type="text" value={novoMotivo} onChange={e => setNovoMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="neu-input py-1.5 px-2 text-xs rounded-lg text-gray-100 flex-1 min-w-[140px]" />
          <button onClick={addExcecao} disabled={salvando}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg neu-button text-accent hover:ring-1 hover:ring-accent/40 disabled:opacity-50">
            Adicionar
          </button>
        </div>
        {excecoes.length > 0 && (
          <div className="flex flex-col gap-1 pt-1">
            {excecoes.map(e => (
              <div key={e.data} className="flex items-center gap-2 text-[11px]">
                <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  e.tipo === 'sem_aula' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
                }`}>
                  {e.tipo === 'sem_aula' ? 'sem aula' : 'aula extra'}
                </span>
                <span className="text-gray-300 tabular-nums">{e.data.split('-').reverse().join('/')}</span>
                <span className="text-gray-500 truncate flex-1">{e.motivo ?? '—'}</span>
                <button onClick={() => removerExcecao(e.data)} className="text-gray-500 hover:text-red-300">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Numero({ label, valor, tom }: { label: string; valor: number; tom: string }) {
  return (
    <div className="flex flex-col">
      <span className={`text-base font-mono font-black tabular-nums ${tom}`}>{valor}</span>
      <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">{label}</span>
    </div>
  );
}
