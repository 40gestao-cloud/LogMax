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
};

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
            {jornada.jornada_tolerancia ? ` (+${jornada.jornada_tolerancia} min)` : ''}
          </span>
        )}
      </div>

      <p className="text-[11px] text-gray-500 leading-snug">
        Sai do ponto eletrônico no período da competição — ninguém dá nota aqui. Presença pontual vale o
        dia inteiro, <b className="text-gray-400">presença com atraso vale meio</b>, falta zera, e
        justificado fica fora da conta: afastamento deferido pelo RH não é desempenho do aluno.
      </p>

      {!loading && !erro && linhas.length > 0 && !atrasoConta && (
        <JornadaNaoConfigurada profile={profile} showToast={showToast} onSalvo={carregar} />
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
            const esperado = l.dias_distintos * l.funcionarios_ativos;
            const subnotificado = !semRegistro && esperado > 0
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
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <Numero label="Presenças" valor={l.presencas - l.atrasos} tom="text-emerald-300" />
                      <Numero label="Faltas"    valor={l.faltas}   tom="text-red-300" />
                      <Numero label="Atrasos"   valor={l.atrasos}  tom="text-amber-300" />
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500 pt-1 border-t border-white/5">
                      <Clock size={11} className="shrink-0 text-amber-400/70" />
                      <span>
                        {atrasoConta
                          ? 'Cada atraso vale meio dia na taxa.'
                          : 'Atraso ainda fora da conta — falta confirmar o horário.'}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500 tabular-nums">
                      {l.registros} registro{l.registros === 1 ? '' : 's'} · {l.dias_distintos} dia{l.dias_distintos === 1 ? '' : 's'} · {l.funcionarios_ativos} funcionário{l.funcionarios_ativos === 1 ? '' : 's'}
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

      <p className="text-[10px] text-gray-500 leading-snug">
        O denominador é o que tem registro, nunca "dias do período": dia sem lançamento não é presença
        nem falta, é buraco de dado — e por isso a contagem de dias e de funcionários fica à vista.
        Presenças conta quem chegou no horário; quem chegou depois está em Atrasos.
      </p>
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

function Numero({ label, valor, tom }: { label: string; valor: number; tom: string }) {
  return (
    <div className="flex flex-col">
      <span className={`text-base font-mono font-black tabular-nums ${tom}`}>{valor}</span>
      <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">{label}</span>
    </div>
  );
}
