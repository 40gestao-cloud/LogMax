import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Landmark, Plus, X, AlertTriangle, ShieldAlert,
  CreditCard, Info, Calculator, Check, TrendingDown,
  BarChart3, PiggyBank, HandCoins, CalendarClock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, NeuButtonAccent, EmptyState, CardContador, AbaComContador, type CorAba, SecaoFormulario, ModalFormulario, FormField, StatusBadge } from '../components/ui';
import { CABECALHO_TABELA } from '../components/MenuMais';
import { useFetchData } from '../hooks/useSupabaseData';
import { PeriodoCapitalAviso } from '../components/PeriodoCapitalAviso';
import { AplicacoesPanel } from '../components/AplicacoesPanel';
import EmprestimoMemoria from '../components/EmprestimoMemoria';
import { formatBRL, parseBRL, qtdBR } from '../lib/viewUtils';
import type { UserProfile } from '../hooks/useUserProfile';
import { useFilial } from '../contexts/FilialContext';
import { dataSimplesBR, todayBR } from '../lib/dates';
import { bancoDaUnidade } from '../lib/filiais';
import { hasSetor } from '../lib/rbac';
import { SelectBusca } from '../components/SelectBusca';
import { opcaoBanco } from '../lib/opcoesSelect';

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
// Coluna `date` ('YYYY-MM-DD'): sem `new Date()`, que traria o fuso de volta.
const fmtData = (d: string) => d.split('-').reverse().join('/');

type AbaCapital = 'resultado' | 'aplicacoes' | 'emprestimos' | 'parcelas' | 'lucro';

function podesolicitarEmprestimo(p: UserProfile | null, filial: string) {
  if (!p) return false;
  return (p.role === 'gerente' || p.role === 'admin' || p.role === 'ceo')
    && (p.filial === filial || p.role === 'admin' || p.role === 'ceo');
}

// Espelha a trava da RPC `antecipar_parcela_emprestimo` (616) — só pra não
// oferecer botão que o banco vai recusar. A régua de verdade é lá.
function podeAntecipar(p: UserProfile | null, filial: string) {
  if (!p) return false;
  return hasSetor(p, 'financeiro')
    || ((p.role === 'gerente' || p.role === 'admin' || p.role === 'ceo') && p.filial === filial)
    || p.role === 'admin' || p.role === 'ceo';
}

// Meses cheios entre hoje e o vencimento — mesma truncagem do `age()` no
// banco (616): dia fracionado não conta, e nunca é negativo.
function mesesCheiosAte(vencimentoISO: string, hojeISO: string): number {
  const v = new Date(vencimentoISO + 'T00:00:00');
  const h = new Date(hojeISO + 'T00:00:00');
  let meses = (v.getFullYear() - h.getFullYear()) * 12 + (v.getMonth() - h.getMonth());
  if (v.getDate() < h.getDate()) meses -= 1;
  return Math.max(meses, 0);
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
  const [antecipandoId, setAntecipandoId] = useState<string | null>(null);
  const [antecipaBankId, setAntecipaBankId] = useState('');
  const [antecipaSaving, setAntecipaSaving] = useState(false);
  const [aba, setAba] = useState<AbaCapital>('resultado');

  const { data: emprestimos = [], isLoading: loadingEmp, reload: reloadEmp } =
    useFetchData<Emprestimo>('emprestimos_filial', { filial }, false);

  const { data: parcelas = [], reload: reloadParcelas } =
    useFetchData<Parcela>('parcelas_emprestimo', undefined, false);

  // Mesma conta bancária que a baixa em Contas a Pagar usa: caixa da própria
  // unidade, nunca o de outra filial (325).
  const { data: bancos = [] } =
    useFetchData<any>('/api/caixabancosview', filial ? { filial } : undefined);
  const bancosAtivos = bancos.filter(
    (b: any) => (b.status === 'Ativo' || !b.status) && bancoDaUnidade(b, filial),
  );

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

  // Fuso do Acre, como a RPC (`acre_today`): das 19h à meia-noite o corte de
  // UTC já é o dia seguinte, e a prévia do desconto contaria um mês a menos.
  const hoje = todayBR();

  const openAntecipar = (p: Parcela) => {
    setAntecipandoId(p.id);
    setAntecipaBankId('');
  };
  const closeAntecipar = () => {
    setAntecipandoId(null);
    setAntecipaBankId('');
  };

  const handleConfirmarAntecipacao = async (p: Parcela) => {
    if (!antecipaBankId) { showToast('Selecione a conta bancária de débito.', 'error'); return; }
    if (!supabase) return;
    setAntecipaSaving(true);
    try {
      const { data, error } = await supabase.rpc('antecipar_parcela_emprestimo', {
        p_parcela_id: p.id,
        p_banco_id: antecipaBankId,
      });
      if (error) throw new Error(error.message);
      const r = data as any;
      showToast(
        `Parcela ${r.parcela} antecipada em ${r.meses} mês(es): pagou ${BRL(r.valor_pago)}, `
        + `desconto de ${BRL(r.desconto)} sobre ${BRL(r.valor_original)} (juro que deixou de correr).`,
        'success',
      );
      closeAntecipar();
      reloadParcelas();
      carregarSaldo();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao antecipar parcela.', 'error');
    } finally {
      setAntecipaSaving(false);
    }
  };

  if (!filial) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-gray-500">
        Filial não configurada no perfil.
      </div>
    );
  }

  const parcelaAntecipando = parcelasPendentes.find(p => p.id === antecipandoId) ?? null;
  const empAntecipando = parcelaAntecipando ? empAprovados.find(e => e.id === parcelaAntecipando.emprestimo_id) : undefined;
  const taxaAntecipando = Number(empAntecipando?.taxa_juros ?? 0) / 100;
  const mesesAntecipando = parcelaAntecipando ? mesesCheiosAte(parcelaAntecipando.data_vencimento, hoje) : 0;
  const pvAntecipando = parcelaAntecipando && taxaAntecipando > 0
    ? Math.round((parcelaAntecipando.valor_parcela / Math.pow(1 + taxaAntecipando, mesesAntecipando)) * 100) / 100
    : null;
  const descontoAntecipando = parcelaAntecipando && pvAntecipando !== null
    ? Math.round((parcelaAntecipando.valor_parcela - pvAntecipando) * 100) / 100
    : null;

  const temVencida = parcelasPendentes.some(p => p.data_vencimento < hoje);
  const totalDistribuido = distribuicoes.reduce((a, d) => a + Number(d.valor ?? 0), 0);
  const pctLivre = saldo && saldo.capital_total > 0 ? Math.max(0, saldo.saldo_livre / saldo.capital_total * 100) : 0;

  // Na ordem da pergunta: como vou (resultado), tenho sobra parada
  // (aplicações), preciso de dinheiro (empréstimos), o que devo (parcelas), o
  // que já mandei para a Matriz (lucro).
  const ABAS: { id: AbaCapital; label: string; cor: CorAba; n?: number; alerta?: boolean; icon: any }[] = [
    { id: 'resultado',   label: 'Resultado',   cor: 'azul',    icon: BarChart3 },
    { id: 'aplicacoes',  label: 'Aplicações',  cor: 'roxo',    icon: PiggyBank },
    { id: 'emprestimos', label: 'Empréstimos', cor: 'amarelo', icon: CreditCard, n: emprestimos.length, alerta: empPendentes.length > 0 },
    { id: 'parcelas',    label: 'Parcelas',    cor: 'laranja', icon: CalendarClock, n: parcelasPendentes.length, alerta: temVencida },
    { id: 'lucro',       label: 'Lucro distribuído', cor: 'verde', icon: HandCoins, n: distribuicoes.length },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6 pb-16"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <Landmark size={26} /> Capital — {filial}
        </h2>
        {saldo?.data_inicio && (
          <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-white/5">
            Período {dataSimplesBR(saldo.data_inicio)}
            {saldo.data_fim ? ` a ${dataSimplesBR(saldo.data_fim)}` : ', sem prazo'}
          </span>
        )}
      </div>

      {/* Diagnóstico visível quando a RPC falhou — evita "traços silenciosos". */}
      {!loadingSaldo && !saldo && saldoErr && (
        <div className="neu-flat rounded-2xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-300">Não consegui calcular o Capital de {filial}.</p>
            <p className="text-[11px] text-red-400/80 mt-1 font-mono break-words">{saldoErr}</p>
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

      {/* O que se veio ver, sempre à vista; o resto vai para as abas. */}
      {loadingSaldo ? <LoadingSpinner /> : saldo && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <CardContador label="Capital total" value={BRL(saldo.capital_total)} tom="azul" />
            <CardContador label="Saldo livre" value={BRL(saldo.saldo_livre)} tom={saldo.bloqueado ? 'vermelho' : 'verde'}
              sub={saldo.capital_total > 0 ? `${pctLivre.toFixed(0)}% do capital` : 'Sem capital'} />
            <CardContador label="Gastos pagos" value={BRL(saldo.despesas_pagas)} tom="laranja" />
            <CardContador label="Receita recebida" value={BRL(saldo.receitas_pagas)} tom="verde" />
          </div>
          <div className="flex flex-col gap-1">
            <HealthBar saldo={saldo.saldo_livre} total={saldo.capital_total} />
            {saldo.reserva_pct > 0 && (
              <span className="text-[10px] text-gray-500 self-end">
                Reserva obrigatória: {BRL(saldo.reserva_valor)} ({saldo.reserva_pct}%)
              </span>
            )}
          </div>
          {saldo.bloqueado && (
            <div className="rounded-xl px-4 py-2.5 flex items-center gap-2 bg-red-600 text-white">
              <ShieldAlert size={15} className="shrink-0" />
              <p className="text-xs font-bold">Capital estourado: despesas novas estão bloqueadas. Peça empréstimo ou aguarde aporte da Matriz.</p>
            </div>
          )}
          {!saldo.bloqueado && saldo.em_reserva && (
            <div className="rounded-xl px-4 py-2.5 flex items-center gap-2 bg-yellow-500 text-black">
              <AlertTriangle size={15} className="shrink-0" />
              <p className="text-xs font-bold">Dentro da reserva mínima ({BRL(saldo.reserva_valor)}): ainda dá para lançar, mas acompanhe o caixa.</p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 flex-wrap" role="tablist">
        {ABAS.map(a => (
          <AbaComContador key={a.id} label={a.label} n={a.n} cor={a.cor} icon={a.icon}
            alerta={a.alerta} ativa={aba === a.id} onClick={() => setAba(a.id)} />
        ))}
      </div>

      {aba === 'resultado' && (
        saldo ? (
          <SecaoFormulario titulo="DRE do período" icon={BarChart3} cor="azul">
            {/* Leitura de cima para baixo: receita, (−) operação = lucro
                operacional; (−) juros e reserva = lucro líquido. */}
            <div className="flex flex-col gap-1 max-w-3xl w-full mx-auto">
              <div className="flex justify-between items-baseline py-2">
                <span className="text-sm text-gray-300">Receita bruta</span>
                <span className="text-sm font-bold text-green-400 tabular-nums">{BRL(saldo.receitas_pagas)}</span>
              </div>
              <div className="flex justify-between items-baseline py-2 border-b border-white/5">
                <span className="text-sm text-gray-300">(−) Despesas operacionais</span>
                <span className="text-sm font-bold text-red-400 tabular-nums">{BRL(saldo.despesas_operacionais)}</span>
              </div>
              <div className={`flex justify-between items-baseline py-2.5 px-3 my-1 rounded-xl ${saldo.lucro_operacional >= 0 ? 'bg-accent/10' : 'bg-orange-500/10'}`}>
                <span className="text-xs font-black uppercase tracking-widest text-gray-300">
                  {saldo.lucro_operacional >= 0 ? 'Lucro operacional' : 'Prejuízo operacional'}
                </span>
                <span className={`text-base font-black tabular-nums ${saldo.lucro_operacional >= 0 ? 'text-accent' : 'text-orange-400'}`}>
                  {BRL(saldo.lucro_operacional)}
                </span>
              </div>
              <div className="flex justify-between items-baseline py-2">
                <span className="text-sm text-gray-300">(−) Despesas financeiras <span className="text-gray-500">(juros do empréstimo)</span></span>
                <span className="text-sm font-bold text-red-400 tabular-nums">{BRL(saldo.despesas_financeiras)}</span>
              </div>
              <div className="flex justify-between items-baseline py-2 border-b border-white/5">
                <span className="text-sm text-gray-300">(−) Reserva obrigatória <span className="text-gray-500">({saldo.reserva_pct}%)</span></span>
                <span className="text-sm font-bold text-yellow-300 tabular-nums">{BRL(saldo.reserva_valor)}</span>
              </div>
              <div className={`flex justify-between items-baseline py-3 px-3 mt-1 rounded-xl ${saldo.lucro_liquido >= 0 ? 'bg-green-600' : 'bg-red-600'} text-white`}>
                <span className="text-sm font-black uppercase tracking-widest">
                  {saldo.lucro_liquido >= 0 ? 'Lucro líquido' : 'Prejuízo líquido'}
                </span>
                <span className="text-xl font-black tabular-nums">{BRL(saldo.lucro_liquido)}</span>
              </div>
            </div>
          </SecaoFormulario>
        ) : !loadingSaldo && <EmptyState message="Sem resultado para mostrar enquanto o capital não é calculado." />
      )}

      {/* Aplicações (migr. 604). */}
      {aba === 'aplicacoes' && (
        <AplicacoesPanel
          filial={filial} profile={profile} showToast={showToast}
          onMovimentou={carregarSaldo}
        />
      )}

      {aba === 'emprestimos' && (
        <SecaoFormulario titulo="Empréstimos bancários" icon={CreditCard} cor="amarelo"
          extra={`${empAprovados.length} ativo${empAprovados.length === 1 ? '' : 's'} · ${empPendentes.length} em análise · ${empNegados.length} negado${empNegados.length === 1 ? '' : 's'}`}>
          <div className="flex flex-col gap-4">
            {podesolicitarEmprestimo(profile, filial) && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setModalSolicitar(true)} className="btn-solido btn-solido--vermelho">
                  <Plus size={14} /> Solicitar empréstimo
                </button>
              </div>
            )}
            {loadingEmp ? <LoadingSpinner /> : emprestimos.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">Nenhum empréstimo registrado.</p>
            ) : (
              <div className="overflow-x-auto main-scrollbar">
                <table className="tabela tabela--azul w-full text-left border-collapse min-w-[860px]">
                  <thead>
                    <tr className={CABECALHO_TABELA}>
                      <th className="text-center">Finalidade</th>
                      <th className="text-center w-36">Valor</th>
                      <th className="text-center w-32">Condição</th>
                      <th className="text-center w-40">Banco</th>
                      <th className="text-center w-32">Situação</th>
                      <th className="text-center w-28">Pedido em</th>
                      <th className="text-center w-px">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emprestimos.map(emp => (
                      <tr key={emp.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                        <td className="py-3 px-3 min-w-[22rem]">
                          <span className="text-sm text-gray-100 line-clamp-2" title={emp.justificativa}>{emp.justificativa}</span>
                          {emp.justificativa_resposta && (
                            <span className="text-[11px] text-gray-500 mt-0.5 line-clamp-1" title={emp.justificativa_resposta}>
                              Matriz{emp.aprovado_por_nome ? ` (${emp.aprovado_por_nome})` : ''}: {emp.justificativa_resposta}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center text-sm font-bold text-gray-100 tabular-nums">{BRL(emp.valor)}</td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300 whitespace-nowrap">
                          {emp.num_parcelas}x{emp.taxa_juros > 0 ? ` · ${qtdBR(emp.taxa_juros)}% a.m.` : ''}
                        </td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300 whitespace-nowrap">{emp.banco_nome ?? '—'}</td>
                        <td className="py-3 px-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <StatusBadge status={emp.status === 'Pendente' ? 'Em Análise' : emp.status} />
                            {emp.arquivado_em && (
                              <span title={`Preservado no reset de ${fmtDate(emp.arquivado_em)}. As parcelas e os títulos daquela turma já não existem.`}
                                className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                                Turma anterior
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center text-xs text-gray-400 font-mono">{fmtDate(emp.created_at)}</td>
                        <td className="py-3 px-3">
                          <div className="flex justify-center items-center gap-1.5">
                            {/* A conta aberta: o aluno tem de conseguir refazer a
                                parcela, não só ler o valor dela. */}
                            {emp.status === 'Aprovado' ? (
                              <button onClick={() => setModalMemoria(emp)} title="Memória de cálculo" aria-label="Memória de cálculo"
                                className="action-btn-neutral">
                                <Calculator size={13} />
                              </button>
                            ) : <span className="text-xs text-gray-600">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SecaoFormulario>
      )}

      {aba === 'parcelas' && (
        <SecaoFormulario titulo="Parcelas em aberto" icon={CalendarClock} cor="laranja"
          extra={parcelasPendentes.length > 0
            ? `${BRL(parcelasPendentes.reduce((a, p) => a + Number(p.valor_parcela ?? 0), 0))} a pagar`
            : undefined}>
          {parcelasPendentes.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">Nenhuma parcela em aberto.</p>
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="tabela w-full text-left border-collapse min-w-[760px]">
                <thead>
                  <tr className={CABECALHO_TABELA}>
                    <th className="text-center">Parcela</th>
                    <th className="text-center w-32">Vencimento</th>
                    <th className="text-center w-36">Valor</th>
                    <th className="text-center">Composição</th>
                    <th className="text-center w-32">Situação</th>
                    <th className="text-center w-px">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelasPendentes.map(p => {
                    const vencido = p.data_vencimento < hoje;
                    const emp = empAprovados.find(e => e.id === p.emprestimo_id);
                    const i = Number(emp?.taxa_juros ?? 0) / 100;
                    const elegivel = !vencido && i > 0 && mesesCheiosAte(p.data_vencimento, hoje) >= 1 && podeAntecipar(profile, filial);
                    return (
                      <tr key={p.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                        <td className="py-3 px-3">
                          <span className="block text-sm font-semibold text-gray-100">Parcela {p.num_parcela}{emp ? ` de ${emp.num_parcelas}` : ''}</span>
                          {emp && <span className="block text-[11px] text-gray-500">empréstimo de {BRL(emp.valor)}</span>}
                        </td>
                        <td className={`py-3 px-3 text-center text-xs font-mono ${vencido ? 'text-red-400 font-bold' : 'text-gray-300'}`}>{fmtData(p.data_vencimento)}</td>
                        <td className={`py-3 px-3 text-center text-sm font-bold tabular-nums ${vencido ? 'text-red-400' : 'text-gray-100'}`}>{BRL(p.valor_parcela)}</td>
                        {/* Da parcela, só o juro é custo; o resto é o próprio
                            dinheiro voltando para a Matriz. */}
                        <td className="py-3 px-3 text-center text-[11px] text-gray-400 tabular-nums">
                          {p.juros !== null ? (
                            <>
                              <span className="block">juros {BRL(p.juros)} · amortização {BRL(p.amortizacao ?? 0)}</span>
                              {p.saldo_devedor !== null && <span className="block text-gray-500">resta {BRL(p.saldo_devedor)}</span>}
                            </>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-3 text-center"><StatusBadge status={vencido ? 'Vencido' : 'Pendente'} /></td>
                        <td className="py-3 px-3">
                          <div className="flex justify-center items-center gap-1.5">
                            {elegivel ? (
                              <button onClick={() => openAntecipar(p)}
                                title="Antecipar: pagar hoje, com desconto do juro que ainda não correu" aria-label="Antecipar parcela"
                                className="action-btn-verde">
                                <TrendingDown size={13} />
                              </button>
                            ) : <span className="text-xs text-gray-600">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SecaoFormulario>
      )}

      {/* Lucro que foi para a Matriz. Não é despesa — o resultado da unidade
          continua o mesmo; o que mudou foi o caixa. */}
      {aba === 'lucro' && (
        <SecaoFormulario titulo="Lucro distribuído à Matriz" icon={HandCoins} cor="verde"
          extra={distribuicoes.length > 0 ? `${BRL(totalDistribuido)} no total` : undefined}>
          {distribuicoes.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">Nenhuma distribuição de lucro ainda.</p>
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="tabela w-full text-left border-collapse min-w-[620px]">
                <thead>
                  <tr className={CABECALHO_TABELA}>
                    <th className="text-center">Observação</th>
                    <th className="text-center w-40">Decidido por</th>
                    <th className="text-center w-36">Valor</th>
                    <th className="text-center w-28">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {distribuicoes.map(d => (
                    <tr key={d.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                      <td className="py-3 px-3 text-sm text-gray-200">{d.observacao ?? 'Distribuição de resultado'}</td>
                      <td className="py-3 px-3 text-center text-xs text-gray-300">{d.decidido_por_nome ?? '—'}</td>
                      <td className="py-3 px-3 text-center text-sm font-bold text-gray-100 tabular-nums">{BRL(Number(d.valor))}</td>
                      <td className="py-3 px-3 text-center text-xs text-gray-400 font-mono">{fmtDate(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SecaoFormulario>
      )}

      <ModalFormulario
        aberto={!!parcelaAntecipando}
        largura="md"
        titulo={parcelaAntecipando ? `Antecipar parcela ${parcelaAntecipando.num_parcela}` : 'Antecipar parcela'}
        subtitulo={parcelaAntecipando ? `vence em ${fmtData(parcelaAntecipando.data_vencimento)}` : undefined}
        onCancelar={closeAntecipar}
        cancelarDesabilitado={antecipaSaving}
        acoes={parcelaAntecipando && (
          <NeuButtonAccent onClick={() => handleConfirmarAntecipacao(parcelaAntecipando)} isLoading={antecipaSaving}
            disabled={!antecipaBankId}>
            <Check size={14} /> Confirmar
          </NeuButtonAccent>
        )}
      >
        {parcelaAntecipando && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <CardContador label="Valor da parcela" value={BRL(parcelaAntecipando.valor_parcela)} tom="azul" />
              <CardContador label="Paga hoje" value={pvAntecipando !== null ? BRL(pvAntecipando) : '—'} tom="amarelo"
                sub={`${mesesAntecipando} ${mesesAntecipando === 1 ? 'mês' : 'meses'} antes`} />
              <CardContador label="Desconto" value={descontoAntecipando !== null ? BRL(descontoAntecipando) : '—'} tom="verde"
                sub={`juro de ${qtdBR(Number(empAntecipando?.taxa_juros ?? 0))}% a.m.`} />
            </div>
            <FormField label="Conta bancária de débito *">
              <SelectBusca
                value={antecipaBankId}
                onChange={setAntecipaBankId}
                placeholder="Escolha a conta"
                opcoes={bancosAtivos.map((b: any) => opcaoBanco(b, { saldo: true }))}
              />
              {bancosAtivos.length === 0 && (
                <span className="text-[11px] text-yellow-400 mt-1">Nenhum caixa/banco ativo em {filial}.</span>
              )}
            </FormField>
            <p className="text-xs text-gray-500">O cronograma das outras parcelas não muda.</p>
          </>
        )}
      </ModalFormulario>

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
