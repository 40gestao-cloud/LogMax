// Minha frequência — o aluno vê o próprio ponto, no Meu Crachá (só leitura).
//
// Os números vêm da RPC `minha_frequencia` (migr. 648), que usa AS MESMAS
// peças do placar (_frequencia_competicao): dias letivos até hoje, dia de aula
// sem registro é ausência, atraso vale meio dia, justificada sai da conta, e o
// que foi lançado antes do calendário da turma — ou em dia sem aula — aparece
// mas não entra. A tela não refaz regra nenhuma: só conta e pinta o que a RPC
// devolveu. É isso que garante que o aluno veja o mesmo que o placar.

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarCheck, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { CardContador, LoadingSpinner, EmptyState } from './ui';

type Situacao = 'Presente' | 'Atraso' | 'Falta' | 'Sem registro' | 'Justificada';
type Dia = {
  dia: string; conta: boolean; status: string | null; entrada: string | null; saida: string | null;
  situacao: Situacao; credito: number | null; motivo: string | null;
};

// Cor por situação — a mesma leitura em todo lugar da seção (calendário, lista).
const TOM: Record<Situacao, { fundo: string; texto: string; borda: string }> = {
  'Presente':     { fundo: 'bg-emerald-500/20', texto: 'text-emerald-300', borda: 'border-emerald-500/50' },
  'Atraso':       { fundo: 'bg-amber-500/20',   texto: 'text-amber-300',   borda: 'border-amber-500/50' },
  'Falta':        { fundo: 'bg-red-500/20',     texto: 'text-red-300',     borda: 'border-red-500/50' },
  'Sem registro': { fundo: 'bg-rose-500/10',    texto: 'text-rose-300',    borda: 'border-rose-500/40' },
  'Justificada':  { fundo: 'bg-sky-500/20',     texto: 'text-sky-300',     borda: 'border-sky-500/50' },
};

const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** 'YYYY-MM' → primeiro e último dia, em texto (sem Date local: fuso do Acre). */
const limitesDoMes = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { inicio: `${ym}-01`, fim: `${ym}-${String(ultimo).padStart(2, '0')}`, ultimo };
};
const somarMeses = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const nomeDoMes = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const dataBR = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

export function MinhaFrequencia() {
  const hoje = todayBR();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelado = false;
    setDias(null);
    setErro(null);
    const { inicio, fim } = limitesDoMes(mes);
    supabase.rpc('minha_frequencia', { p_inicio: inicio, p_fim: fim }).then(({ data, error }) => {
      if (cancelado) return;
      if (error) { setErro(error.message); setDias([]); return; }
      setDias(((data ?? []) as any[]).map(d => ({ ...d, credito: d.credito == null ? null : Number(d.credito) })));
    });
    return () => { cancelado = true; };
  }, [mes]);

  const resumo = useMemo(() => {
    const r = { presentes: 0, atrasos: 0, faltas: 0, semRegistro: 0, justificadas: 0, creditos: 0, denominador: 0, foraDaConta: 0 };
    for (const d of dias ?? []) {
      if (d.situacao === 'Presente') r.presentes++;
      else if (d.situacao === 'Atraso') r.atrasos++;
      else if (d.situacao === 'Falta') r.faltas++;
      else if (d.situacao === 'Sem registro') r.semRegistro++;
      else if (d.situacao === 'Justificada') r.justificadas++;
      if (!d.conta) { r.foraDaConta++; continue; }
      // Mesma conta do placar: soma dos créditos ÷ dias que entram (justificada fica fora).
      if (d.credito != null) { r.creditos += d.credito; r.denominador++; }
    }
    return r;
  }, [dias]);

  const porDia = useMemo(() => new Map((dias ?? []).map(d => [d.dia, d])), [dias]);
  const { ultimo } = limitesDoMes(mes);
  const primeiroDow = diaDaSemana(`${mes}-01`);
  const noFuturo = mes > hoje.slice(0, 7);
  const taxa = resumo.denominador ? Math.round((resumo.creditos / resumo.denominador) * 1000) / 10 : null;

  return (
    <section className="cracha-controles w-full max-w-4xl mx-auto flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
          <CalendarCheck size={20} className="text-accent" /> Minha frequência
        </h3>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setMes(m => somarMeses(m, -1))} title="Mês anterior"
            className="neu-button p-2 rounded-lg text-gray-300"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-gray-200 min-w-[10rem] text-center">{nomeDoMes(mes)}</span>
          <button type="button" onClick={() => setMes(m => somarMeses(m, 1))} title="Próximo mês"
            disabled={noFuturo || mes === hoje.slice(0, 7)}
            className="neu-button p-2 rounded-lg text-gray-300 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      {dias === null ? <LoadingSpinner /> : erro ? (
        <EmptyState error={erro} message="Não foi possível ler sua frequência." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <CardContador label="Presenças" value={resumo.presentes} tom="verde" corFixa />
            <CardContador label="Atrasos" value={resumo.atrasos} tom="amarelo" sub="valem meio dia" />
            <CardContador label="Faltas" value={resumo.faltas + resumo.semRegistro} tom="vermelho"
              sub={resumo.semRegistro ? `${resumo.semRegistro} sem registro` : undefined} />
            <CardContador label="Justificadas" value={resumo.justificadas} tom="azul" sub="fora da conta" />
            <CardContador label="No placar" value={taxa == null ? '—' : `${String(taxa).replace('.', ',')}%`} tom="dourado"
              sub={taxa == null ? 'nenhum dia conta ainda' : 'frequência que conta'} />
          </div>

          {/* Calendário do mês: dia de aula pintado pela situação. */}
          <div className="neu-flat rounded-2xl border border-white/5 p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center">
              {SEMANA.map(s => (
                <div key={s} className="text-[10px] font-bold uppercase tracking-widest text-gray-500 pb-1">{s}</div>
              ))}
              {Array.from({ length: primeiroDow }).map((_, i) => <div key={`v${i}`} />)}
              {Array.from({ length: ultimo }).map((_, i) => {
                const iso = `${mes}-${String(i + 1).padStart(2, '0')}`;
                const d = porDia.get(iso);
                const tom = d ? TOM[d.situacao] : null;
                return (
                  <div key={iso}
                    title={d ? `${d.situacao}${d.conta ? '' : ' — fora da conta do placar'}${d.motivo ? ` · ${d.motivo}` : ''}` : undefined}
                    className={`aspect-square sm:aspect-auto sm:h-12 rounded-lg flex flex-col items-center justify-center text-xs tabular-nums border
                      ${tom ? `${tom.fundo} ${tom.texto} ${tom.borda}` : 'border-transparent text-gray-600'}
                      ${d && !d.conta ? 'border-dashed opacity-60' : ''}
                      ${iso === hoje ? 'ring-2 ring-accent/70' : ''}`}>
                    <span className="font-semibold">{i + 1}</span>
                    {d && <span className="hidden sm:block text-[9px] leading-none mt-0.5">{d.situacao === 'Sem registro' ? 'sem reg.' : d.situacao}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {dias.length === 0 ? (
            <EmptyState message={noFuturo ? 'Mês que ainda não chegou.' : 'Nenhum dia de aula nem registro de ponto neste mês.'} />
          ) : (
            <div className="neu-flat rounded-2xl border border-white/5 p-3 sm:p-4 overflow-x-auto main-scrollbar">
              <table className="tabela w-full border-collapse text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest whitespace-nowrap [&>th]:py-3 [&>th]:px-3 [&>th]:font-bold [&>th+th]:border-l [&>th:first-child]:rounded-l-xl [&>th:last-child]:rounded-r-xl">
                    <th>Dia</th><th>Entrada</th><th>Saída</th><th>Situação</th><th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map(d => (
                    <tr key={d.dia} className={`border-b border-white/5 ${d.conta ? '' : 'opacity-60'}`}>
                      <td className="py-2 px-3 text-center font-mono tabular-nums whitespace-nowrap">
                        {dataBR(d.dia)} <span className="text-gray-500 font-sans">{SEMANA[diaDaSemana(d.dia)]}</span>
                      </td>
                      <td className="py-2 px-3 text-center font-mono tabular-nums">{d.entrada ?? '—'}</td>
                      <td className="py-2 px-3 text-center font-mono tabular-nums">{d.saida ?? '—'}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md border ${TOM[d.situacao].fundo} ${TOM[d.situacao].texto} ${TOM[d.situacao].borda}`}>
                          {d.situacao === 'Sem registro' && d.dia === hoje ? 'Hoje, ainda sem registro' : d.situacao}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-left text-xs text-gray-400">
                        {[d.motivo, d.conta ? null : 'fora da conta do placar'].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-gray-500 flex items-start gap-1.5 leading-snug">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>
              É a mesma conta do placar da competição: dia de aula sem ponto conta como falta, atraso vale meio dia e
              justificada não entra na conta. Dias antes do calendário da turma começar, ou sem aula, aparecem
              tracejados — ficam registrados, mas não contam.
              {resumo.foraDaConta > 0 && ` Neste mês, ${resumo.foraDaConta} dia(s) estão fora da conta.`}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
