import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Scale, Info, AlertTriangle, Calculator, Send, RotateCcw, Lock, Building2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import { useConfirm } from '../contexts/ConfirmContext';
import { todayBR } from '../lib/dates';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

// ── Tipos ───────────────────────────────────────────────────────────────────
type Criterio = 'receita' | 'headcount' | 'igual';

type ApuracaoItem = {
  filial: string;
  base_direcionador: number;
  percentual: number;
  valor: number;
};

type Apuracao = {
  competencia: string;
  criterio: Criterio;
  criterio_efetivo: Criterio;
  base_total: number;
  ja_aplicado: boolean;
  itens: ApuracaoItem[];
};

type Rateio = {
  id: string;
  competencia: string;
  criterio: Criterio;
  criterio_efetivo: Criterio;
  base_total: number;
  observacao: string | null;
  criado_por_nome: string | null;
  created_at: string;
};

type RateioItem = {
  id: string;
  rateio_id: string;
  filial: string;
  base_direcionador: number;
  percentual: number;
  valor: number;
};

const BRL = (v: number) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });

// Os três direcionadores que o mercado usa em contrato de compartilhamento de
// custos. O texto explica o efeito, não a fórmula — quem opera a tela precisa
// escolher pela consequência, e a fórmula está na migr. 323.
const CRITERIOS: { id: Criterio; label: string; desc: string }[] = [
  { id: 'receita',   label: 'Receita',   desc: 'Quem fatura mais absorve mais custo. É o critério mais usado, e o que a auditoria menos questiona.' },
  { id: 'headcount', label: 'Headcount', desc: 'Proporcional ao número de funcionários ativos. Faz sentido quando o corporativo é majoritariamente RH.' },
  { id: 'igual',     label: 'Partes iguais', desc: 'Um terço para cada unidade. Simples, mas cobra o mesmo de quem fatura pouco.' },
];

const CRITERIO_LABEL: Record<Criterio, string> = {
  receita: 'Receita', headcount: 'Headcount', igual: 'Partes iguais',
};

// Direcionador de receita é dinheiro; o de headcount é gente. Formatar os dois
// como R$ fazia "3 funcionários" virar "R$ 3,00" na coluna de base.
const fmtDirecionador = (criterio: Criterio, v: number) =>
  criterio === 'headcount'
    ? `${Number(v || 0)} pessoa${Number(v || 0) === 1 ? '' : 's'}`
    : criterio === 'igual' ? '—' : BRL(v);

/** Competência default: o mês passado. Rateio se fecha sobre mês encerrado —
 *  apurar o mês corrente distribuiria uma base ainda incompleta. */
function competenciaAnterior(): string {
  const [ano, mes] = todayBR().slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function podeFechar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo' || isConselheiro(p);
}

// ── View ────────────────────────────────────────────────────────────────────
export function RateioAdministrativoView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const confirm = useConfirm();
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [criterio, setCriterio] = useState<Criterio>('receita');
  const [apuracao, setApuracao] = useState<Apuracao | null>(null);
  const [apurando, setApurando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [revertendoId, setRevertendoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const { data: rateios = [], isLoading, reload } =
    useFetchData<Rateio>('rateio_administrativo', undefined, false);
  const { data: itens = [], reload: reloadItens } =
    useFetchData<RateioItem>('rateio_administrativo_itens', undefined, false);

  const itensPorRateio = useMemo(() => {
    const map: Record<string, RateioItem[]> = {};
    for (const i of itens) (map[i.rateio_id] ??= []).push(i);
    return map;
  }, [itens]);

  const apurar = useCallback(async () => {
    if (!supabase) return;
    setApurando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('apurar_rateio_administrativo', {
      p_competencia: competencia,
      p_criterio: criterio,
    });
    if (error) {
      console.error('[Rateio] apurar falhou:', error);
      setApuracao(null);
      setErro(error.message ?? String(error));
    } else {
      setApuracao(data as Apuracao);
    }
    setApurando(false);
  }, [competencia, criterio]);

  // Apura sozinho ao trocar mês ou critério: a tela não serve para nada sem o
  // número, e obrigar a clicar "Apurar" a cada troca só escondia o resultado.
  useEffect(() => { apurar(); }, [apurar]);

  const aplicar = async () => {
    if (!supabase || !apuracao) return;
    const ok = await confirm({
      message:
        `Fechar o rateio de ${competencia}?\n\n` +
        `${BRL(apuracao.base_total)} de custo corporativo serão distribuídos por ` +
        `${CRITERIO_LABEL[apuracao.criterio_efetivo].toLowerCase()}.\n\n` +
        `Cada unidade recebe uma conta a pagar e a Matriz, uma conta a receber. ` +
        `Dá para reverter enquanto nenhuma delas for quitada.`,
    });
    if (!ok) return;
    setAplicando(true);
    const { data, error } = await supabase.rpc('aplicar_rateio_administrativo', {
      p_competencia: competencia,
      p_criterio: criterio,
    });
    if (error) {
      showToast(error.message ?? 'Erro ao aplicar rateio.', 'error');
    } else {
      const res = data as any;
      showToast(`Rateio de ${res?.competencia} fechado — ${BRL(res?.base_total)} distribuídos.`, 'success');
      reload(); reloadItens(); apurar();
    }
    setAplicando(false);
  };

  const reverter = async (r: Rateio) => {
    if (!supabase) return;
    const ok = await confirm({
      message:
        `Reverter o rateio de ${r.competencia}?\n\n` +
        `As contas a pagar das filiais e as contas a receber da Matriz geradas ` +
        `por ele serão inativadas. Lançamento já quitado impede a reversão.`,
      danger: true,
    });
    if (!ok) return;
    setRevertendoId(r.id);
    const { error } = await supabase.rpc('reverter_rateio_administrativo', { p_rateio_id: r.id });
    if (error) showToast(error.message ?? 'Erro ao reverter.', 'error');
    else {
      showToast(`Rateio de ${r.competencia} revertido.`, 'success');
      reload(); reloadItens(); apurar();
    }
    setRevertendoId(null);
  };

  if (!podeFechar(profile)) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <Lock size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400 max-w-sm">
          Só admin, CEO ou conselheiro fecham o rateio administrativo — é quanto cada
          unidade absorve do custo da holding.
        </p>
      </div>
    );
  }

  const criterioDivergiu = !!apuracao && apuracao.criterio !== apuracao.criterio_efetivo;
  const semBase = !!apuracao && apuracao.base_total <= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 pb-16"
    >
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Rateio Administrativo</h2>
        <p className="text-sm text-gray-400 mt-1">
          Distribui o custo da holding entre as unidades que o consomem.
        </p>
      </div>

      {/* O "por quê" da tela. Sem isso ela vira um botão que cria dívida sem
          explicar de onde. */}
      <div className="neu-flat rounded-2xl p-4 border border-accent/10 flex items-start gap-2 text-xs text-gray-400 leading-relaxed">
        <Info size={13} className="shrink-0 text-accent mt-0.5" />
        <span>
          Diretoria, conselho e estrutura corporativa são pagos pela Matriz, mas quem
          se beneficia deles são as três operações. Fechada a competência, o que a
          holding gastou é distribuído por um critério objetivo: cada filial recebe uma{' '}
          <b className="text-gray-300">conta a pagar</b> e a Matriz, uma{' '}
          <b className="text-gray-300">conta a receber</b> — o mesmo arranjo de um centro
          de serviços compartilhados. A base é o custo <b className="text-gray-300">lançado</b> no
          mês, pago ou não: rateia-se custo incorrido, não caixa.
        </span>
      </div>

      {/* Parâmetros */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Scale size={14} className="text-accent" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Apuração</span>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="rateio-competencia" className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Competência
            </label>
            <input
              id="rateio-competencia" type="month" value={competencia}
              onChange={e => setCompetencia(e.target.value)}
              className="neu-input rounded-xl px-3 py-2.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Direcionador</span>
            <div className="flex gap-1 p-1 neu-flat rounded-2xl border border-white/5">
              {CRITERIOS.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCriterio(c.id)}
                  title={c.desc}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                    criterio === c.id ? 'bg-accent text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={apurar}
            disabled={apurando}
            className="flex items-center gap-1.5 text-xs px-3 py-2.5 rounded-xl bg-white/10 text-gray-300 border border-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            <Calculator size={13} /> {apurando ? 'Apurando...' : 'Recalcular'}
          </button>
        </div>

        <p className="text-[11px] text-gray-500">{CRITERIOS.find(c => c.id === criterio)?.desc}</p>
      </div>

      {/* Resultado da apuração */}
      {erro && (
        <div className="neu-flat rounded-2xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-300">Não consegui apurar {competencia}.</p>
            <p className="text-[11px] text-red-400/80 mt-1 font-mono break-words">{erro}</p>
            <p className="text-[11px] text-gray-500 mt-2">
              Se a mensagem citar a função, a migração{' '}
              <span className="font-mono text-gray-400">323_20260801_matriz_capital_e_rateio_administrativo.sql</span>{' '}
              ainda não foi aplicada neste projeto.
            </p>
          </div>
        </div>
      )}

      {apurando && !apuracao && <LoadingSpinner />}

      {apuracao && !erro && (
        <div className="neu-flat rounded-3xl border border-accent/20 overflow-hidden">
          <div className="p-5 bg-accent/5 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Custo corporativo — {apuracao.competencia}
              </span>
              <p className="text-3xl font-black text-accent tabular-nums mt-0.5">{BRL(apuracao.base_total)}</p>
            </div>
            {apuracao.ja_aplicado ? (
              <span className="text-[11px] font-bold text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
                Competência já fechada
              </span>
            ) : (
              <NeuButtonAccent onClick={aplicar} isLoading={aplicando} disabled={semBase}>
                <Send size={14} /> Fechar e gerar as contas
              </NeuButtonAccent>
            )}
          </div>

          {semBase ? (
            <div className="p-5">
              <EmptyState message={`A Matriz não tem despesa lançada em ${apuracao.competencia}. Registre a folha da diretoria e os custos corporativos antes de ratear.`} />
            </div>
          ) : (
            <>
              {criterioDivergiu && (
                <div className="px-5 py-3 bg-yellow-500/5 flex items-start gap-2">
                  <AlertTriangle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-yellow-300">
                    O direcionador <b>{CRITERIO_LABEL[apuracao.criterio]}</b> não tinha o que medir
                    neste mês — a apuração caiu em <b>partes iguais</b>. O custo existiu e precisa
                    ir para algum lugar.
                  </p>
                </div>
              )}
              <div className="p-5 overflow-x-auto main-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      <th className="pb-3 font-bold pr-4">Unidade</th>
                      <th className="pb-3 font-bold pr-4 text-right">Base do direcionador</th>
                      <th className="pb-3 font-bold pr-4 text-right">%</th>
                      <th className="pb-3 font-bold text-right">Absorve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apuracao.itens.map(i => (
                      <tr key={i.filial} className="border-b border-white/5">
                        <td className="py-2.5 pr-4 text-sm font-bold text-gray-200">{i.filial}</td>
                        <td className="py-2.5 pr-4 text-xs font-mono text-gray-400 text-right tabular-nums">
                          {fmtDirecionador(apuracao.criterio_efetivo, i.base_direcionador)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs font-mono text-gray-300 text-right tabular-nums">
                          {Number(i.percentual).toFixed(2)}%
                        </td>
                        <td className="py-2.5 text-sm font-mono font-black text-accent text-right tabular-nums">
                          {BRL(i.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-600 mt-3 leading-relaxed">
                  Vencimento das contas: dia 10 do mês seguinte à competência — depois do dia 5 da
                  folha, para nenhuma unidade fechar o mês devendo à Matriz antes de pagar quem trabalha.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Histórico */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-accent" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Competências fechadas
          </span>
        </div>

        {isLoading ? <LoadingSpinner /> : rateios.length === 0 ? (
          <div className="neu-flat rounded-3xl p-5 border border-white/5">
            <EmptyState message="Nenhum rateio fechado ainda." />
          </div>
        ) : (
          <AnimatePresence>
            {rateios.map(r => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="neu-flat rounded-3xl p-5 border border-accent/20 flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-black text-gray-100">{r.competencia}</span>
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      {CRITERIO_LABEL[r.criterio_efetivo]}
                    </span>
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {fmtDateTime(r.created_at)}{r.criado_por_nome ? ` · ${r.criado_por_nome}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-accent tabular-nums">{BRL(r.base_total)}</span>
                    <button
                      onClick={() => reverter(r)}
                      disabled={revertendoId === r.id}
                      title="Reverter — inativa as contas geradas dos dois lados"
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/5 text-gray-400 border border-white/10 hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> Reverter
                    </button>
                  </div>
                </div>

                {r.observacao && (
                  <p className="text-[11px] text-yellow-400/90 italic">{r.observacao}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {(itensPorRateio[r.id] ?? []).map(i => (
                    <div key={i.id} className="neu-pressed rounded-xl px-3 py-2 flex-1 min-w-[150px]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{i.filial}</span>
                      <p className="text-sm font-black text-gray-200 tabular-nums mt-0.5">{BRL(i.valor)}</p>
                      <span className="text-[10px] text-gray-600">{Number(i.percentual).toFixed(2)}% do custo</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}
