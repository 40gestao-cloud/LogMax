// Minha frequência — o aluno vê o próprio ponto, no Meu Crachá.
//
// Os números vêm da RPC `minha_frequencia` (migr. 648), que usa AS MESMAS
// peças do placar (_frequencia_competicao): dias letivos até hoje, dia de aula
// sem registro é ausência, atraso vale meio dia, justificada sai da conta, e o
// que foi lançado antes do calendário da turma — ou em dia sem aula — aparece
// mas não entra. A tela não refaz regra nenhuma: só conta e pinta o que a RPC
// devolveu. É isso que garante que o aluno veja o mesmo que o placar.
//
// A única escrita daqui é a justificativa de falta (migr. 650): o aluno envia,
// o gerente dá o parecer e o Admin decide. Só a decisão do Admin muda o ponto —
// até lá o dia continua falta, e a tela diz que está em análise.

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarCheck, Info, FileText, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { CardContador, LoadingSpinner, EmptyState, ModalFormulario, FormField, NeuButtonAccent } from './ui';

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

type Justificativa = {
  id: string; data: string; motivo: string; status: 'Pendente' | 'Aceita' | 'Negada';
  parecer_gerente: 'Aceita' | 'Negada' | null; parecer_gerente_obs: string | null; decisao_obs: string | null;
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

export function MinhaFrequencia({ showToast }: { showToast?: (msg: string, tipo?: string) => void }) {
  const hoje = todayBR();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [justs, setJusts] = useState<Justificativa[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [justificando, setJustificando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

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
    // Só as minhas: a policy também deixa gerente/RH lerem as da unidade.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelado || !session) return;
      supabase!.from('justificativas_falta')
        .select('id, data, motivo, status, parecer_gerente, parecer_gerente_obs, decisao_obs')
        .eq('funcionario_id', session.user.id).eq('ativo', true)
        .gte('data', inicio).lte('data', fim)
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (!cancelado) setJusts((data ?? []) as Justificativa[]); });
    });
    return () => { cancelado = true; };
  }, [mes, recarga]);

  // A mais recente de cada dia (uma negada pode ter sido reenviada).
  const justPorDia = useMemo(() => {
    const m = new Map<string, Justificativa>();
    for (const j of justs) if (!m.has(j.data)) m.set(j.data, j);
    return m;
  }, [justs]);

  const enviar = async () => {
    if (!supabase || !justificando) return;
    if (motivo.trim().length < 10) { showToast?.('Escreva o motivo com pelo menos 10 caracteres.', 'error'); return; }
    setEnviando(true);
    const { error } = await supabase.rpc('enviar_justificativa_falta', { p_data: justificando, p_motivo: motivo.trim() });
    setEnviando(false);
    if (error) { showToast?.(error.message, 'error'); return; }
    showToast?.('Justificativa enviada. O gerente dá o parecer e o Admin decide.', 'success');
    setJustificando(null);
    setMotivo('');
    setRecarga(n => n + 1);
  };

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
                    <th>Dia</th><th>Entrada</th><th>Saída</th><th>Situação</th><th>Observação</th><th>Justificativa</th>
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
                        {[d.situacao === 'Justificada' ? d.motivo : null, d.conta ? null : 'fora da conta do placar'].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-2 px-3 text-center text-xs">
                        <CelulaJustificativa dia={d} j={justPorDia.get(d.dia)}
                          onJustificar={() => { setMotivo(''); setJustificando(d.dia); }} />
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
              {' '}Falta pode ser justificada: o gerente dá o parecer e a decisão final é do Admin — só depois
              dela o dia sai da conta.
            </span>
          </p>
        </>
      )}

      <ModalFormulario aberto={!!justificando} largura="md"
        titulo="Justificar falta" subtitulo={justificando ? dataBR(justificando) : undefined}
        onCancelar={() => setJustificando(null)} cancelarDesabilitado={enviando}
        acoes={<NeuButtonAccent onClick={enviar} isLoading={enviando}><Send size={14} /> Enviar</NeuButtonAccent>}>
        <FormField label="Motivo">
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500}
            placeholder="Ex.: consulta médica — levo o atestado na próxima aula."
            className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-28" />
        </FormField>
        <p className="text-xs text-gray-500">
          O gerente da sua unidade dá o parecer e o Admin decide. Se for aceita, o dia vira
          "Justificada" e sai da conta do placar; se for negada, continua falta e você pode enviar de novo.
        </p>
      </ModalFormulario>
    </section>
  );
}

/** Coluna "Justificativa" da lista: o botão para a falta, ou onde a justificativa está. */
function CelulaJustificativa({ dia, j, onJustificar }: { dia: Dia; j?: Justificativa; onJustificar: () => void }) {
  const ehFalta = dia.conta && (dia.situacao === 'Falta' || dia.situacao === 'Sem registro');
  if (j && j.status === 'Pendente') {
    const parecer = j.parecer_gerente
      ? `Gerente ${j.parecer_gerente === 'Aceita' ? 'aceitou' : 'negou'}${j.parecer_gerente_obs ? `: ${j.parecer_gerente_obs}` : ''}`
      : 'Aguardando o gerente';
    return (
      <span title={`${j.motivo} — ${parecer}`}
        className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-md border bg-amber-500/15 text-amber-300 border-amber-500/40">
        Em análise{j.parecer_gerente ? ' · falta o Admin' : ''}
      </span>
    );
  }
  if (j && j.status === 'Aceita') {
    return (
      <span title={j.motivo}
        className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-md border bg-sky-500/15 text-sky-300 border-sky-500/40">Aceita</span>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      {j?.status === 'Negada' && (
        <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-md border bg-red-500/15 text-red-300 border-red-500/40">
          Negada{j.decisao_obs ? `: ${j.decisao_obs}` : ''}
        </span>
      )}
      {ehFalta && (
        <button type="button" onClick={onJustificar}
          className="neu-button inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-accent">
          <FileText size={12} /> {j?.status === 'Negada' ? 'Enviar de novo' : 'Justificar'}
        </button>
      )}
      {!ehFalta && !j && <span className="text-gray-600">—</span>}
    </div>
  );
}
