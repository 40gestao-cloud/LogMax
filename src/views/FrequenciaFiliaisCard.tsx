import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState } from '../components/ui';
import { PONTO_HORARIOS } from '../lib/pontoHorarios';

// Frequência de Trabalho — medida, não votada (migr. 349).
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
};

const TONE: Record<string, string> = {
  SuperMax: 'bg-sky-500/20 text-sky-300',
  MaxLook:  'bg-amber-400/20 text-amber-200',
  TechMax:  'bg-orange-500/20 text-orange-300',
};

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.0', '')}%`;

export function FrequenciaFiliaisCard({ competicaoId }: { competicaoId: string }) {
  const [linhas, setLinhas] = useState<LinhaFreq[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('frequencia_filiais_competicao', {
      p_competicao_id: competicaoId,
      // Alvo de entrada da turma. Só serve pra CONTAR atrasos na exibição —
      // atraso ainda não entra na taxa nem no placar (etapa 2, quando a
      // jornada da turma deixar de viver só no env do cliente).
      p_target_entrada: PONTO_HORARIOS.entrada,
    });
    if (error) setErro(error.message);
    else { setErro(null); setLinhas((data ?? []) as LinhaFreq[]); }
    setLoading(false);
  }, [competicaoId]);

  useEffect(() => { setLoading(true); carregar(); }, [carregar]);

  // Ponto lançado durante a competição muda a nota; a tela acompanha.
  useEffect(() => {
    const canal = supabase
      .channel(`freq-filiais-${competicaoId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ponto_eletronico' }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [competicaoId, carregar]);

  return (
    <div className="neu-flat rounded-2xl border border-white/5 p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarCheck size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-gray-200">Frequência de Trabalho</h3>
        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Medida, não votada
        </span>
        <span className="text-[10px] text-gray-500 font-bold">vale 20% do placar</span>
      </div>

      <p className="text-[11px] text-gray-500 leading-snug">
        Sai do ponto eletrônico no período da competição — ninguém dá nota aqui. Falta zera o dia,
        presença vale o dia inteiro e <b className="text-gray-400">justificado fica fora da conta</b>:
        afastamento deferido pelo RH não é desempenho do aluno.
      </p>

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
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <Numero label="Presenças" valor={l.presencas} tom="text-emerald-300" />
                      <Numero label="Faltas"    valor={l.faltas}    tom="text-red-300" />
                      <Numero label="Justif."   valor={l.justificados} tom="text-gray-400" />
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500 pt-1 border-t border-white/5">
                      <Clock size={11} className="shrink-0 text-amber-400/70" />
                      <span className="tabular-nums text-amber-300/90 font-bold">{l.atrasos}</span>
                      <span>atraso{l.atrasos === 1 ? '' : 's'} (entrada após {PONTO_HORARIOS.entrada}) — ainda não desconta</span>
                    </div>
                    <span className="text-[10px] text-gray-500 tabular-nums">
                      {l.registros} registro{l.registros === 1 ? '' : 's'} · {l.dias_distintos} dia{l.dias_distintos === 1 ? '' : 's'} · {l.funcionarios_ativos} funcionário{l.funcionarios_ativos === 1 ? '' : 's'}
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
        Atraso entra na conta valendo meio dia na próxima etapa, quando o horário da turma deixar de
        viver só na configuração do site.
      </p>
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
