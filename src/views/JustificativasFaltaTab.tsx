// RH › Registro de Ponto › Justificativas (migr. 650).
//
// O aluno envia pelo Meu Crachá; aqui o gerente da unidade dá o parecer e o
// Admin decide. Parecer não muda o ponto — só a decisão do Admin, e só quando
// aceita, vira o dia em 'Justificado' (fora da conta do placar e da folha).
// O Admin pode mudar a decisão depois (migr. 651); negar um aceite devolve o
// ponto ao que era antes.
//
// Os botões seguem as RPCs, que são quem decide de verdade:
//   parecer_justificativa_falta — role 'gerente', mesma unidade, não a própria;
//   decidir_justificativa_falta — role 'admin' literal.
// RH, CEO e conselheiro leem (justfalta_select) e não agem.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X, UserCheck, Gavel, Send, CalendarX2, Quote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDataHoraBR, dataSimplesBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, FilialBadge, AbaComContador } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { usePontoCorteTurma } from '../hooks/useJornadaTurma';

type Just = {
  id: string; funcionario_id: string; nome_funcionario: string; data: string; motivo: string;
  created_at: string; filial: string | null; status: 'Pendente' | 'Aceita' | 'Negada';
  parecer_gerente: 'Aceita' | 'Negada' | null; parecer_gerente_obs: string | null;
  parecer_gerente_nome: string | null; parecer_gerente_em: string | null;
  decisao_obs: string | null; decidido_por_nome: string | null; decidido_em: string | null;
};

const PILL = 'inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border';
const TOM_STATUS: Record<string, string> = {
  Pendente: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  Aceita:   'bg-sky-500/15 text-sky-300 border-sky-500/40',
  Negada:   'bg-red-500/15 text-red-300 border-red-500/40',
};
// Faixa lateral do card: a cor do status lida de relance na lista.
const FAIXA: Record<string, string> = { Pendente: 'bg-amber-500', Aceita: 'bg-sky-500', Negada: 'bg-red-500' };
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** Dia da semana de uma coluna `date`, sem passar pelo fuso do navegador. */
const diaDaSemana = (d: string) => SEMANA[new Date(`${d.slice(0, 10)}T12:00:00Z`).getUTCDay()];
const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');

export function JustificativasFaltaTab({ profile, filial, showToast }: {
  profile: UserProfile; filial: string | null; showToast: any;
}) {
  const [lista, setLista] = useState<Just[] | null>(null);
  const [aba, setAba] = useState<'pendentes' | 'decididas'>('pendentes');
  const [obs, setObs] = useState<Record<string, string>>({});
  const [gravando, setGravando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    let q = supabase.from('justificativas_falta').select('*').eq('ativo', true)
      .order('created_at', { ascending: false }).limit(300);
    if (filial) q = q.eq('filial', filial);
    const { data, error } = await q;
    if (error) { showToast(`Erro ao ler justificativas: ${error.message}`, 'error'); setLista([]); return; }
    setLista((data ?? []) as Just[]);
  }, [filial, showToast]);

  useEffect(() => { setLista(null); carregar(); }, [carregar]);

  // A tabela atravessa o APAGAR TUDO (504). Pendente de antes do corte não tem
  // mais decisão possível (o ponto da turma passada não se reescreve) e só
  // entupiria a fila da turma nova.
  const corte = usePontoCorteTurma();
  const pendentes = useMemo(
    () => (lista ?? []).filter(j => j.status === 'Pendente' && (!corte || j.data >= corte)),
    [lista, corte]);
  const decididas = useMemo(() => (lista ?? []).filter(j => j.status !== 'Pendente'), [lista]);

  const ehAdmin = profile?.role === 'admin';
  const podeParecer = (j: Just) =>
    profile?.role === 'gerente' && profile.filial === j.filial && j.funcionario_id !== profile.id;

  const agir = async (j: Just, rpc: 'parecer_justificativa_falta' | 'decidir_justificativa_falta', aceita: boolean) => {
    if (!supabase) return;
    const texto = (obs[j.id] ?? '').trim();
    if (!aceita && !texto) { showToast('Para negar, diga o porquê no campo de observação.', 'error'); return; }
    setGravando(j.id);
    // Nomes por extenso (e não `rpc(rpc, …)`): o mapa de dependências só
    // enxerga chamada com o nome literal.
    const args = { p_id: j.id, p_aceita: aceita, p_obs: texto || null };
    const { error } = rpc === 'decidir_justificativa_falta'
      ? await supabase.rpc('decidir_justificativa_falta', args)
      : await supabase.rpc('parecer_justificativa_falta', args);
    setGravando(null);
    if (error) { showToast(error.message, 'error'); return; }
    showToast(rpc === 'decidir_justificativa_falta'
      ? (aceita ? 'Aceita — o dia virou Justificado no ponto.' : 'Negada — o dia continua falta.')
      : 'Parecer registrado. A decisão final é do Admin.', 'success');
    setObs(o => { const n = { ...o }; delete n[j.id]; return n; });
    carregar();
  };

  if (lista === null) return <LoadingSpinner />;
  const mostradas = aba === 'pendentes' ? pendentes : decididas;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex flex-wrap gap-2 p-1 pb-2.5">
        <AbaComContador label="Pendentes" n={pendentes.length} cor="amarelo" ativa={aba === 'pendentes'} onClick={() => setAba('pendentes')} />
        <AbaComContador label="Decididas" n={decididas.length} cor="cinza" ativa={aba === 'decididas'} onClick={() => setAba('decididas')} />
      </div>

      {mostradas.length === 0 ? (
        <EmptyState message={aba === 'pendentes' ? 'Nenhuma justificativa esperando decisão.' : 'Nenhuma justificativa decidida ainda.'} />
      ) : (
        <div className="grid gap-4">
          {mostradas.map(j => (
            <CardJustificativa key={j.id} j={j} mostrarFilial={!filial}
              gerente={j.status === 'Pendente' && podeParecer(j)} admin={ehAdmin}
              obs={obs[j.id] ?? ''} onObs={v => setObs(o => ({ ...o, [j.id]: v }))}
              gravando={gravando === j.id} agir={agir} />
          ))}
        </div>
      )}
    </div>
  );
}

type Acao = 'parecer_justificativa_falta' | 'decidir_justificativa_falta';

// Duas colunas, como nas Aprovações: à esquerda quem, quando e por quê; à
// direita o caminho da decisão (aluno → gerente → Admin) com os botões embaixo.
// No celular a coluna da decisão desce para depois do motivo.
function CardJustificativa({ j, mostrarFilial, gerente, admin, obs, onObs, gravando, agir }: {
  j: Just; mostrarFilial: boolean; gerente: boolean; admin: boolean;
  obs: string; onObs: (v: string) => void; gravando: boolean;
  agir: (j: Just, rpc: Acao, aceita: boolean) => void;
}) {
  const mudando = admin && j.status !== 'Pendente';
  const rpc: Acao = admin ? 'decidir_justificativa_falta' : 'parecer_justificativa_falta';
  return (
    <article className="neu-flat rounded-2xl border border-white/5 overflow-hidden flex">
      <div aria-hidden className={`w-1.5 shrink-0 ${FAIXA[j.status]}`} />
      <div className="flex-1 min-w-0 grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="p-5 flex flex-col gap-4 min-w-0">
          <header className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-accent/10 border border-accent/30 text-accent font-black text-sm flex items-center justify-center shrink-0">
              {iniciais(j.nome_funcionario)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-gray-100 truncate">{j.nome_funcionario}</span>
                {mostrarFilial && j.filial && <FilialBadge filial={j.filial} />}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">Enviada em {formatDataHoraBR(j.created_at)}</p>
            </div>
            <span className={`${PILL} ${TOM_STATUS[j.status]} shrink-0`}>{j.status}</span>
          </header>

          <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5 w-fit">
            <CalendarX2 size={18} className="text-red-300 shrink-0" />
            <div className="leading-tight">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-300/80">Falta de {diaDaSemana(j.data)}</p>
              <p className="text-base font-black text-gray-100 tabular-nums">{dataSimplesBR(j.data)}</p>
            </div>
          </div>

          <blockquote className="relative rounded-xl bg-white/[0.03] border border-white/5 pl-10 pr-4 py-3">
            <Quote size={16} className="absolute left-3.5 top-3.5 text-accent/60" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Motivo do aluno</p>
            <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{j.motivo}</p>
          </blockquote>
        </div>

        <aside className="p-5 flex flex-col gap-4 border-t lg:border-t-0 lg:border-l border-white/5 bg-white/[0.015]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Caminho da decisão</p>
          <ol className="flex flex-col">
            <Etapa icone={Send} tom="ok" titulo="Aluno enviou" detalhe={formatDataHoraBR(j.created_at)} />
            <Etapa icone={UserCheck} titulo="Parecer do gerente"
              tom={j.parecer_gerente === 'Aceita' ? 'aceita' : j.parecer_gerente === 'Negada' ? 'negada' : 'espera'}
              resultado={j.parecer_gerente}
              detalhe={j.parecer_gerente
                ? `${j.parecer_gerente_nome ?? ''} · ${formatDataHoraBR(j.parecer_gerente_em)}`
                : j.status === 'Pendente' ? 'Aguardando o gerente' : 'Não deu parecer'}
              obs={j.parecer_gerente_obs} />
            <Etapa icone={Gavel} titulo="Decisão do Admin" ultima
              tom={j.status === 'Aceita' ? 'aceita' : j.status === 'Negada' ? 'negada' : 'espera'}
              resultado={j.status === 'Pendente' ? null : j.status}
              detalhe={j.status === 'Pendente' ? 'Aguardando — é ela que vale' : `${j.decidido_por_nome ?? ''} · ${formatDataHoraBR(j.decidido_em)}`}
              obs={j.decisao_obs} />
          </ol>

          {(gerente || admin) && (
            <div className="flex flex-col gap-2 pt-3 border-t border-white/5">
              <textarea value={obs} onChange={e => onObs(e.target.value)} maxLength={500}
                placeholder={mudando ? 'Por que a decisão mudou (obrigatório para negar)'
                  : admin ? 'Observação da decisão (obrigatória para negar)' : 'Observação do parecer (obrigatória para negar)'}
                className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16 w-full" />
              <div className="flex gap-2">
                {j.status !== 'Aceita' && (
                  <button type="button" disabled={gravando} onClick={() => agir(j, rpc, true)}
                    className="btn-solido btn-solido--verde flex-1 justify-center !py-2 !text-xs inline-flex items-center gap-1 disabled:opacity-50">
                    <Check size={14} /> {mudando ? 'Mudar p/ aceita' : admin ? 'Aceitar' : j.parecer_gerente ? 'Mudar p/ aceita' : 'Parecer: aceitar'}
                  </button>
                )}
                {j.status !== 'Negada' && (
                  <button type="button" disabled={gravando} onClick={() => agir(j, rpc, false)}
                    className="btn-solido btn-solido--vermelho flex-1 justify-center !py-2 !text-xs inline-flex items-center gap-1 disabled:opacity-50">
                    <X size={14} /> {mudando ? 'Mudar p/ negada' : admin ? 'Negar' : j.parecer_gerente ? 'Mudar p/ negada' : 'Parecer: negar'}
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </article>
  );
}

const TOM_ETAPA = {
  ok:     'bg-emerald-500/15 border-emerald-500/50 text-emerald-300',
  aceita: 'bg-sky-500/15 border-sky-500/50 text-sky-300',
  negada: 'bg-red-500/15 border-red-500/50 text-red-300',
  espera: 'bg-transparent border-dashed border-gray-600 text-gray-500',
} as const;

function Etapa({ icone: Icone, titulo, tom, resultado, detalhe, obs, ultima }: {
  icone: any; titulo: string; tom: keyof typeof TOM_ETAPA; resultado?: string | null;
  detalhe: string; obs?: string | null; ultima?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${TOM_ETAPA[tom]}`}>
          <Icone size={13} />
        </span>
        {!ultima && <span aria-hidden className="w-px flex-1 bg-white/10 my-1" />}
      </div>
      <div className={`min-w-0 flex-1 ${ultima ? '' : 'pb-4'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-200">{titulo}</span>
          {resultado && <span className={`${PILL} ${TOM_STATUS[resultado]}`}>{resultado}</span>}
        </div>
        <p className="text-[11px] text-gray-500 mt-0.5">{detalhe}</p>
        {obs && <p className="text-xs text-gray-300 mt-1.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5">{obs}</p>}
      </div>
    </li>
  );
}
