// RH › Registro de Ponto › Justificativas (migr. 650).
//
// O aluno envia pelo Meu Crachá; aqui o gerente da unidade dá o parecer e o
// Admin decide. Parecer não muda o ponto — só a decisão do Admin, e só quando
// aceita, vira o dia em 'Justificado' (fora da conta do placar e da folha).
//
// Os botões seguem as RPCs, que são quem decide de verdade:
//   parecer_justificativa_falta — role 'gerente', mesma unidade, não a própria;
//   decidir_justificativa_falta — role 'admin' literal.
// RH, CEO e conselheiro leem (justfalta_select) e não agem.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X, UserCheck, Gavel } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDataHoraBR, dataBR } from '../lib/dates';
import { LoadingSpinner, EmptyState, FilialBadge, AbaComContador } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';

type Just = {
  id: string; funcionario_id: string; nome_funcionario: string; data: string; motivo: string;
  created_at: string; filial: string | null; status: 'Pendente' | 'Aceita' | 'Negada';
  parecer_gerente: 'Aceita' | 'Negada' | null; parecer_gerente_obs: string | null;
  parecer_gerente_nome: string | null; parecer_gerente_em: string | null;
  decisao_obs: string | null; decidido_por_nome: string | null; decidido_em: string | null;
};

const PILL = 'inline-block text-[11px] font-bold px-2 py-0.5 rounded-md border';
const TOM_STATUS: Record<string, string> = {
  Pendente: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  Aceita:   'bg-sky-500/15 text-sky-300 border-sky-500/40',
  Negada:   'bg-red-500/15 text-red-300 border-red-500/40',
};

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

  const pendentes = useMemo(() => (lista ?? []).filter(j => j.status === 'Pendente'), [lista]);
  const decididas = useMemo(() => (lista ?? []).filter(j => j.status !== 'Pendente'), [lista]);

  const ehAdmin = profile?.role === 'admin';
  const podeParecer = (j: Just) =>
    profile?.role === 'gerente' && profile.filial === j.filial && j.funcionario_id !== profile.id;

  const agir = async (j: Just, rpc: 'parecer_justificativa_falta' | 'decidir_justificativa_falta', aceita: boolean) => {
    if (!supabase) return;
    const texto = (obs[j.id] ?? '').trim();
    if (!aceita && !texto) { showToast('Para negar, diga o porquê no campo de observação.', 'error'); return; }
    setGravando(j.id);
    const { error } = await supabase.rpc(rpc, { p_id: j.id, p_aceita: aceita, p_obs: texto || null });
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
        <div className="grid gap-3">
          {mostradas.map(j => {
            const gerente = j.status === 'Pendente' && podeParecer(j);
            const admin = j.status === 'Pendente' && ehAdmin;
            return (
              <article key={j.id} className="neu-flat rounded-2xl border border-white/5 p-4 flex flex-col gap-3">
                <header className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-100">{j.nome_funcionario}</span>
                  {!filial && j.filial && <FilialBadge filial={j.filial} />}
                  <span className="text-sm text-gray-400">falta de <b className="text-gray-200 font-mono">{dataBR(j.data)}</b></span>
                  <span className={`${PILL} ${TOM_STATUS[j.status]} ml-auto`}>{j.status}</span>
                </header>

                <p className="text-sm text-gray-300 whitespace-pre-wrap">{j.motivo}</p>
                <p className="text-[11px] text-gray-500">Enviada em {formatDataHoraBR(j.created_at)}</p>

                <div className="grid sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="flex items-center gap-1.5 font-bold text-gray-400 uppercase tracking-widest text-[10px] mb-1">
                      <UserCheck size={12} /> Parecer do gerente
                    </div>
                    {j.parecer_gerente ? (
                      <>
                        <span className={`${PILL} ${TOM_STATUS[j.parecer_gerente]}`}>{j.parecer_gerente}</span>
                        <span className="text-gray-500 ml-2">{j.parecer_gerente_nome} · {formatDataHoraBR(j.parecer_gerente_em)}</span>
                        {j.parecer_gerente_obs && <p className="text-gray-300 mt-1">{j.parecer_gerente_obs}</p>}
                      </>
                    ) : <span className="text-gray-500">{j.status === 'Pendente' ? 'Ainda não deu.' : 'Não deu.'}</span>}
                  </div>
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="flex items-center gap-1.5 font-bold text-gray-400 uppercase tracking-widest text-[10px] mb-1">
                      <Gavel size={12} /> Decisão do Admin
                    </div>
                    {j.status !== 'Pendente' ? (
                      <>
                        <span className={`${PILL} ${TOM_STATUS[j.status]}`}>{j.status}</span>
                        <span className="text-gray-500 ml-2">{j.decidido_por_nome} · {formatDataHoraBR(j.decidido_em)}</span>
                        {j.decisao_obs && <p className="text-gray-300 mt-1">{j.decisao_obs}</p>}
                      </>
                    ) : <span className="text-gray-500">Aguardando — é ela que vale.</span>}
                  </div>
                </div>

                {(gerente || admin) && (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <textarea value={obs[j.id] ?? ''} onChange={e => setObs(o => ({ ...o, [j.id]: e.target.value }))}
                      maxLength={500} placeholder={admin ? 'Observação da decisão (obrigatória para negar)' : 'Observação do parecer (obrigatória para negar)'}
                      className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16 flex-1" />
                    <div className="flex gap-2 shrink-0">
                      <button type="button" disabled={gravando === j.id}
                        onClick={() => agir(j, admin ? 'decidir_justificativa_falta' : 'parecer_justificativa_falta', true)}
                        className="btn-solido btn-solido--verde !py-2 !text-xs inline-flex items-center gap-1 disabled:opacity-50">
                        <Check size={14} /> {admin ? 'Aceitar' : j.parecer_gerente ? 'Mudar p/ aceita' : 'Parecer: aceitar'}
                      </button>
                      <button type="button" disabled={gravando === j.id}
                        onClick={() => agir(j, admin ? 'decidir_justificativa_falta' : 'parecer_justificativa_falta', false)}
                        className="btn-solido btn-solido--vermelho !py-2 !text-xs inline-flex items-center gap-1 disabled:opacity-50">
                        <X size={14} /> {admin ? 'Negar' : j.parecer_gerente ? 'Mudar p/ negada' : 'Parecer: negar'}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
