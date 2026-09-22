import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Landmark, Plus, X, AlertTriangle, ShieldAlert, CheckCircle,
  XCircle, Clock, CreditCard, Info, Calculator,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import { PeriodoCapitalAviso } from '../components/PeriodoCapitalAviso';
import { AplicacoesPanel } from '../components/AplicacoesPanel';
import EmprestimoMemoria from '../components/EmprestimoMemoria';
import { formatBRL, parseBRL, qtdBR } from '../lib/viewUtils';
import type { UserProfile } from '../hooks/useUserProfile';
import { useFilial } from '../contexts/FilialContext';
import { dataSimplesBR } from '../lib/dates';

// ── Tipos ──────────────────────────────────────────────────────────
type SaldoFilial = {
  capital_total: number;
  despesas_pagas: number;
  despesas_operacionais: number;
  despesas_financeiras: number;
  receitas_pagas: number;
  lucro_operacional: number;
  lucro_liquido: number;
  reserva_valor: number;
  reserva_pct: number;
  saldo_livre: number;
  saldo_real: number;
  bloqueado: boolean;
  em_reserva: boolean;
  data_inicio: string;
  data_fim: string | null;
};

type Emprestimo = {
  id: string;
  filial: string;
  valor: number;
  num_parcelas: number;
  taxa_juros: number;
  justificativa: string;
  banco_nome: string | null;
  status: 'Pendente' | 'Aprovado' | 'Negado';
  aprovado_por_nome: string | null;
  justificativa_resposta: string | null;
  created_at: string;
  // Migr. 572 — o contrato atravessa o reset; `arquivado_em` marca o que virou
  // histórico fechado (não conta capital, não se reescreve).
  arquivado_em: string | null;
};

type Distribuicao = {
  id: string;
  filial: string;
  valor: number;
  base_lucro: number | null;
  decidido_por_nome: string | null;
  observacao: string | null;
  created_at: string;
};

type Parcela = {
  id: string;
  emprestimo_id: string;
  num_parcela: number;
  valor_parcela: number;
  data_vencimento: string;
  status: 'Pendente' | 'Paga';
  // Migr. 473. NULL em parcela anterior à separação — nesse caso a tela não
  // mostra a decomposição em vez de mostrar zero, que seria mentira.
  juros: number | null;
  amortizacao: number | null;
  saldo_devedor: number | null;
};

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' });

function podesolicitarEmprestimo(p: UserProfile | null, filial: string) {
  if (!p) return false;
  return (p.role === 'gerente' || p.role === 'admin' || p.role === 'ceo')
    && (p.filial === filial || p.role === 'admin' || p.role === 'ceo');
}

// ── Barra de saúde ─────────────────────────────────────────────────
function HealthBar({ saldo, total }: { saldo: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (saldo / total) * 100)) : 0;
  const color = pct > 40 ? 'bg-green-500' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Modal: Solicitar empréstimo ────────────────────────────────────
function ModalSolicitar({
  filial, profile, onClose, onSaved, showToast,
}: {
  filial: string; profile: UserProfile | null;
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [valorStr, setValorStr] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [justificativa, setJustificativa] = useState('');
  const [saving, setSaving] = useState(false);

  // Migr. 604 — o teto é da Matriz, não do input. O banco recusa de qualquer
  // jeito; ler aqui serve para o aluno ver o limite antes de digitar 48.
  const { data: configs = [] } =
    useFetchData<{ id: string; max_parcelas: number }>('capital_config', undefined, false);
  // `null` enquanto a config não chegou: mostrar o fallback de 60 durante o
  // carregamento faria o rótulo piscar "até 60x" e depois "até 12x" — o aluno
  // leria o número errado justamente no instante em que vai digitar.
  const maxParcelas: number | null = configs[0]?.max_parcelas ?? null;
  const teto = maxParcelas ?? 60;

  const handleSalvar = async () => {
    if (!supabase) return;
    const valor = parseBRL(valorStr);
    if (valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
    if (!justificativa.trim()) { showToast('Justificativa obrigatória.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('emprestimos_filial').insert({
        filial,
        valor,
        num_parcelas: parseInt(parcelas) || 1,
        taxa_juros: 0,
        justificativa: justificativa.trim(),
        solicitado_por: profile?.id ?? null,
        solicitado_por_nome: profile?.nome ?? null,
      });
      if (error) throw error;
      showToast('Solicitação enviada para análise da Matriz.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao solicitar.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-sm border border-accent/20 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Solicitar Empréstimo</h2>
            <span className="text-xs text-gray-500">Será analisado pela Matriz</span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="neu-pressed rounded-xl p-3 flex items-start gap-2 text-xs text-gray-400">
          <Info size={12} className="shrink-0 text-accent mt-0.5" />
          Admin, CEO ou Conselheiros analisarão o pedido e definirão banco e juros.
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor solicitado (R$) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">R$</span>
            <input
              type="text" inputMode="numeric" value={valorStr}
              onChange={e => setValorStr(formatBRL(e.target.value))}
              className="neu-pressed rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none w-full tabular-nums"
              placeholder="0,00"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Nº de parcelas desejadas{maxParcelas ? ` (até ${maxParcelas}x)` : ''}
          </label>
          <input
            type="number" min="1" max={teto} value={parcelas}
            onChange={e => setParcelas(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
          />
          {maxParcelas != null && (parseInt(parcelas) || 1) > maxParcelas && (
            <p className="text-[11px] text-red-400 mt-1">
              A Matriz parcela em até {maxParcelas}x. Acima disso o pedido é recusado.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Justificativa / Finalidade *</label>
          <textarea
            value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={3}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Descreva a necessidade e como será utilizado o recurso..."
          />
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>Enviar Solicitação</NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── View principal ─────────────────────────────────────────────────
export function FilialCapitalView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  // Unidade ativa no topbar tem prioridade sobre a filial lotada do perfil —
  // um admin com profile.filial=Matriz vendo dados da SuperMax no topbar
  // deve puxar Capital da SuperMax, não da Matriz.
  const { filialAtiva } = useFilial();
  const filial = filialAtiva ?? profile?.filial ?? '';
  const [saldo, setSaldo] = useState<SaldoFilial | null>(null);
  const [saldoErr, setSaldoErr] = useState<string | null>(null);
  const [loadingSaldo, setLoadingSaldo] = useState(true);
  const [modalSolicitar, setModalSolicitar] = useState(false);
  const [modalMemoria, setModalMemoria] = useState<Emprestimo | null>(null);

  const { data: emprestimos = [], isLoading: loadingEmp, reload: reloadEmp } =
    useFetchData<Emprestimo>('emprestimos_filial', { filial }, false);

  const { data: parcelas = [], reload: reloadParcelas } =
    useFetchData<Parcela>('parcelas_emprestimo', undefined, false);

  // Migr. 474 — o lucro que a unidade mandou para a Matriz. Aparece aqui
  // porque o dinheiro saiu do caixa dela e ninguem deveria descobrir isso por
  // um saldo que encolheu sem explicacao.
  const { data: distribuicoes = [] } =
    useFetchData<Distribuicao>('distribuicoes_lucro', { filial }, false);

  const carregarSaldo = useCallback(async () => {
    if (!supabase || !filial) { setLoadingSaldo(false); return; }
    setLoadingSaldo(true);
    setSaldoErr(null);
    const { data, error } = await supabase.rpc('calcular_saldo_capital', { p_filial: filial });
    if (error) {
      // Diagnóstico: erro real da RPC (RPC ausente, RLS, etc.) fica visível
      // na UI + no console, sem obrigar o usuário a abrir DevTools.
      console.error('[Capital] calcular_saldo_capital falhou:', error);
      setSaldo(null);
      setSaldoErr(error.message ?? String(error));
    } else if (data?.[0]) {
      setSaldo(data[0]);
    } else {
      setSaldo(null);
      setSaldoErr('RPC executou mas não devolveu linha nenhuma.');
    }
    setLoadingSaldo(false);
  }, [filial]);

  useEffect(() => { carregarSaldo(); }, [carregarSaldo]);

  // Migr. 572 — o contrato preservado pelo reset perdeu os títulos, mas as
  // parcelas ficaram (com status congelado). Sem este filtro, a turma nova
  // abriria a tela com parcelas "em aberto" que não têm conta a pagar nenhuma.
  const empAprovados = emprestimos.filter(e => e.status === 'Aprovado' && !e.arquivado_em);
  const empPendentes = emprestimos.filter(e => e.status === 'Pendente');
  const empNegados   = emprestimos.filter(e => e.status === 'Negado');

  const parcelasDoFilial = parcelas.filter(p =>
    empAprovados.some(e => e.id === p.emprestimo_id),
  );
  const parcelasPendentes = parcelasDoFilial.filter(p => p.status === 'Pendente');

  const statusIcon = (s: string) => {
    if (s === 'Aprovado') return <CheckCircle size={13} className="text-green-400" />;
    if (s === 'Negado')   return <XCircle size={13} className="text-red-400" />;
    return <Clock size={13} className="text-yellow-400" />;
  };

  if (!filial) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-gray-500">
        Filial não configurada no perfil.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5 pb-16"
    >
      {/* Diagnóstico visível quando a RPC falhou — evita "traços silenciosos". */}
      {!loadingSaldo && !saldo && saldoErr && (
        <div className="neu-flat rounded-2xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-300">Não consegui calcular o Capital de {filial}.</p>
            <p className="text-[11px] text-red-400/80 mt-1 font-mono break-words">{saldoErr}</p>
            <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
              Causas comuns: (a) a migração <span className="font-mono text-gray-400">177_20260710c_capital_efetivo.sql</span> ainda não foi aplicada no Supabase;
              (b) o SQL Editor está apontando pra outro projeto; (c) a RLS de <span className="font-mono text-gray-400">capital_filial</span> não deixou a RPC ler o aporte.
            </p>
          </div>
        </div>
      )}

      {saldo && (
        <PeriodoCapitalAviso
          dataInicio={saldo.data_inicio}
          dataFim={saldo.data_fim}
          podeConfigurar={false}
        />
      )}

      {/* Card principal de saldo */}
      {loadingSaldo ? (
        <LoadingSpinner />
      ) : (
        <div className={`neu-flat rounded-3xl border ${saldo?.bloqueado ? 'border-red-500/30' : 'border-accent/20'} overflow-hidden`}>
          <div className={`p-5 ${saldo?.bloqueado ? 'bg-red-500/10' : 'bg-accent/5'} border-b border-white/5`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Landmark size={15} className={saldo?.bloqueado ? 'text-red-400' : 'text-accent'} />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Capital — {filial}</span>
              </div>
              {saldo?.bloqueado && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-1 rounded-full">
                  <ShieldAlert size={10} /> BLOQUEADO
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Capital Total</span>
                <p className="text-2xl font-black text-accent tabular-nums mt-0.5">
                  {saldo ? BRL(saldo.capital_total) : '—'}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Saldo Livre</span>
                <p className={`text-2xl font-black tabular-nums mt-0.5 ${saldo?.bloqueado ? 'text-red-400' : 'text-green-400'}`}>
                  {saldo ? BRL(saldo.saldo_livre) : '—'}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Gasto (despesas pagas)</span>
                <p className="text-sm font-bold text-gray-300 tabular-nums mt-0.5">
                  {saldo ? BRL(saldo.despesas_pagas) : '—'}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Receita recebida</span>
                <p className="text-sm font-bold text-green-300 tabular-nums mt-0.5">
                  {saldo ? BRL(saldo.receitas_pagas) : '—'}
                </p>
              </div>
            </div>

            {saldo && (
              <>
                <HealthBar saldo={saldo.saldo_livre} total={saldo.capital_total} />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>
                    {saldo.capital_total > 0
                      ? `${Math.max(0, (saldo.saldo_livre / saldo.capital_total * 100)).toFixed(0)}% disponível`
                      : 'Sem capital'}
                  </span>
                  {saldo.reserva_pct > 0 && (
                    <span>Reserva obrigatória: {BRL(saldo.reserva_valor)} ({saldo.reserva_pct}%)</span>
                  )}
                </div>
                {saldo.data_inicio && (
                  <p className="text-[10px] text-gray-600 mt-2">
                    Período: {dataSimplesBR(saldo.data_inicio)}
                    {saldo.data_fim ? ` → ${dataSimplesBR(saldo.data_fim)}` : ' → sem prazo'}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Alertas */}
          {saldo?.bloqueado && (
            <div className="px-5 py-3 flex items-start gap-2 bg-red-500/5">
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">
                Capital estourado. Novos lançamentos de despesas estão bloqueados. Solicite um empréstimo ou aguarde aporte da Matriz.
              </p>
            </div>
          )}
          {saldo?.em_reserva && (
            <div className="px-5 py-3 flex items-start gap-2 bg-yellow-500/5">
              <AlertTriangle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-300">
                Você invadiu a reserva mínima ({BRL(saldo.reserva_valor)}). Lançamentos ainda são permitidos, mas monitore o caixa.
              </p>
            </div>
          )}
        </div>
      )}

      {/* DRE contábil — leitura vertical de cima pra baixo:
          Receita Bruta → (-) Despesas Operacionais = LUCRO OPERACIONAL,
          depois (-) Despesas Financeiras e (-) Reserva = LUCRO LÍQUIDO.
          Duas linhas de fecho ficam destacadas com fundo pra distinguir. */}
      {saldo && (
        <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">DRE do Período</span>
          </div>

          {/* Acima da linha operacional */}
          <div className="flex justify-between items-baseline py-2">
            <span className="text-xs text-gray-300">Receita Bruta</span>
            <span className="text-sm font-bold text-green-400 tabular-nums">{BRL(saldo.receitas_pagas)}</span>
          </div>
          <div className="flex justify-between items-baseline py-2 border-b border-white/5">
            <span className="text-xs text-gray-300">(−) Despesas Operacionais</span>
            <span className="text-sm font-bold text-red-400 tabular-nums">{BRL(saldo.despesas_operacionais)}</span>
          </div>

          {/* Lucro Operacional — subtotal em destaque */}
          <div className={`flex justify-between items-baseline py-2.5 px-3 my-1 rounded-xl ${
            saldo.lucro_operacional >= 0 ? 'bg-accent/5' : 'bg-orange-500/10'
          }`}>
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
              {saldo.lucro_operacional >= 0 ? 'Lucro Operacional' : 'Prejuízo Operacional'}
            </span>
            <span className={`text-base font-black tabular-nums ${
              saldo.lucro_operacional >= 0 ? 'text-accent' : 'text-orange-400'
            }`}>
              {BRL(saldo.lucro_operacional)}
            </span>
          </div>

          {/* Abaixo da linha operacional */}
          <div className="flex justify-between items-baseline py-2">
            <span className="text-xs text-gray-300">(−) Despesas Financeiras <span className="text-gray-500">(juros do empréstimo)</span></span>
            <span className="text-sm font-bold text-red-400 tabular-nums">{BRL(saldo.despesas_financeiras)}</span>
          </div>
          <div className="flex justify-between items-baseline py-2 border-b border-white/5">
            <span className="text-xs text-gray-300">
              (−) Reserva Obrigatória <span className="text-gray-500">({saldo.reserva_pct}%)</span>
            </span>
            <span className="text-sm font-bold text-yellow-300 tabular-nums">{BRL(saldo.reserva_valor)}</span>
          </div>

          {/* Lucro Líquido — total em destaque forte */}
          <div className={`flex justify-between items-baseline py-3 px-3 mt-1 rounded-xl border ${
            saldo.lucro_liquido >= 0
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            <span className={`text-sm font-black uppercase tracking-widest ${
              saldo.lucro_liquido >= 0 ? 'text-green-300' : 'text-red-300'
            }`}>
              {saldo.lucro_liquido >= 0 ? 'Lucro Líquido' : 'Prejuízo Líquido'}
            </span>
            <span className={`text-xl font-black tabular-nums ${
              saldo.lucro_liquido >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {BRL(saldo.lucro_liquido)}
            </span>
          </div>

          <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
            Lucro Operacional mede o resultado da operação em si.
            Lucro Líquido desconta ainda o custo do capital emprestado e a reserva obrigatória —
            é o que sobra de fato pra distribuir ou reinvestir.
          </p>
        </div>
      )}

      {/* Aplicações (migr. 604) — antes dos empréstimos de propósito: a
          pergunta "tenho sobra parada?" vem antes de "preciso pegar dinheiro?". */}
      {filial && (
        <AplicacoesPanel
          filial={filial} profile={profile} showToast={showToast}
          onMovimentou={carregarSaldo}
        />
      )}

      {/* Empréstimos */}
      <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard size={14} className="text-accent" />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Empréstimos Bancários</span>
          </div>
          {podesolicitarEmprestimo(profile, filial) && (
            <button
              onClick={() => setModalSolicitar(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
            >
              <Plus size={12} /> Solicitar
            </button>
          )}
        </div>

        {loadingEmp ? (
          <LoadingSpinner />
        ) : emprestimos.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">Nenhum empréstimo registrado.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {emprestimos.map(emp => (
              <div key={emp.id} className="neu-pressed rounded-2xl p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  {statusIcon(emp.status)}
                  <span className="text-sm font-bold text-gray-100 tabular-nums">{BRL(emp.valor)}</span>
                  <span className="text-xs text-gray-500">{emp.num_parcelas}x</span>
                  {emp.taxa_juros > 0 && (
                    <span className="text-xs text-gray-500">{qtdBR(emp.taxa_juros)}% a.m.</span>
                  )}
                  {emp.banco_nome && (
                    <span className="text-xs text-gray-500 truncate ml-auto">{emp.banco_nome}</span>
                  )}
                  {emp.arquivado_em && (
                    <span
                      title={`Preservado no reset de ${fmtDate(emp.arquivado_em)}. Fica para consulta: as parcelas e os títulos daquela turma já não existem.`}
                      className={`text-[10px] font-bold text-gray-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full shrink-0 ${emp.banco_nome ? '' : 'ml-auto'}`}
                    >
                      Turma anterior
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 italic">"{emp.justificativa}"</p>
                {emp.justificativa_resposta && (
                  <p className="text-[11px] text-gray-500 border-t border-white/5 pt-1.5">
                    Matriz: "{emp.justificativa_resposta}"
                  </p>
                )}
                <div className="flex justify-between items-center gap-2 text-[10px] text-gray-600">
                  <span>{fmtDate(emp.created_at)}</span>
                  {emp.aprovado_por_nome && <span className="truncate">Analisado por: {emp.aprovado_por_nome}</span>}
                  {/* A conta aberta: o aluno tem de conseguir refazer a parcela,
                      não só ler o valor dela. */}
                  {emp.status === 'Aprovado' && (
                    <button
                      onClick={() => setModalMemoria(emp)}
                      className="ml-auto flex items-center gap-1 text-[10px] font-bold text-accent hover:underline shrink-0"
                    >
                      <Calculator size={11} /> Memória de cálculo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Parcelas em aberto */}
      {parcelasPendentes.length > 0 && (
        <div className="neu-flat rounded-3xl p-5 border border-orange-500/20 flex flex-col gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-orange-400">
            Parcelas em Aberto ({parcelasPendentes.length})
          </span>
          {parcelasPendentes.map(p => {
            const vencido = new Date(p.data_vencimento) < new Date();
            return (
              <div key={p.id} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Parcela {p.num_parcela}</span>
                  <span className={`font-bold tabular-nums ${vencido ? 'text-red-400' : 'text-gray-200'}`}>
                    {BRL(p.valor_parcela)}
                  </span>
                  <span className={`text-xs ${vencido ? 'text-red-400' : 'text-gray-500'}`}>
                    {fmtDate(p.data_vencimento)}{vencido ? ' — VENCIDA' : ''}
                  </span>
                </div>
                {/* Onde a aula acontece: da parcela, só o juro é custo. O
                    resto é o próprio dinheiro voltando pra Matriz. */}
                {p.juros !== null && (
                  <span className="text-[10px] text-gray-600 tabular-nums">
                    juros {BRL(p.juros)} · amortização {BRL(p.amortizacao ?? 0)}
                    {p.saldo_devedor !== null && ` · resta ${BRL(p.saldo_devedor)}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lucro que foi para a Matriz. Não é despesa — o resultado da unidade
          continua o mesmo; o que mudou foi o caixa. */}
      {distribuicoes.length > 0 && (
        <div className="neu-flat rounded-3xl p-5 border border-accent/20 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-accent">
              Lucro distribuído à Matriz
            </span>
            <span className="text-sm font-black text-gray-200 tabular-nums">
              {BRL(distribuicoes.reduce((a, d) => a + Number(d.valor ?? 0), 0))}
            </span>
          </div>
          {distribuicoes.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-400 truncate flex-1 italic text-xs">
                {d.observacao ?? 'Distribuição de resultado'}
              </span>
              <span className="font-bold text-gray-200 tabular-nums">{BRL(Number(d.valor))}</span>
              <span className="text-xs text-gray-500">{fmtDate(d.created_at)}</span>
            </div>
          ))}
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Isto não é despesa: é o retorno de quem aportou o capital da unidade. O lucro
            do período não muda — o caixa, sim.
          </p>
        </div>
      )}

      <AnimatePresence>
        {modalMemoria && (
          <EmprestimoMemoria emprestimo={modalMemoria} onClose={() => setModalMemoria(null)} />
        )}
        {modalSolicitar && (
          <ModalSolicitar
            filial={filial} profile={profile}
            onClose={() => setModalSolicitar(false)}
            onSaved={() => { reloadEmp(); carregarSaldo(); }}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
