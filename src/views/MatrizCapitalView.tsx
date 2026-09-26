import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { todayBR, dataSimplesBR } from '../lib/dates';
import { motion, AnimatePresence } from 'motion/react';
import {
  Landmark, Plus, X, Clock, Trash2, Pencil, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle,
  Settings, BarChart3, CreditCard, ShieldAlert, Info, PiggyBank, CalendarClock, Calculator,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { tabelaPrice } from '../lib/mutuo';
import { LoadingSpinner, NeuButtonAccent, FormField, CardContador } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import { PeriodoCapitalAviso } from '../components/PeriodoCapitalAviso';
import { AplicacoesPanel } from '../components/AplicacoesPanel';
import EmprestimoMemoria from '../components/EmprestimoMemoria';
import type { BancoInvestimento } from '../components/AplicacoesPanel';
import type { UserProfile } from '../hooks/useUserProfile';
import { bancoDaUnidade } from '../lib/filiais';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatBRL, parseBRL, qtdBR } from '../lib/viewUtils';
import { SelectBusca } from '../components/SelectBusca';
import { opcaoBanco } from '../lib/opcoesSelect';

// ── Tipos ──────────────────────────────────────────────────────────────────
type CapitalRow = {
  id: string;
  filial: string;
  valor: number;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  observacao: string | null;
  created_at: string;
  banco_origem_id: string | null;
  banco_destino_id: string | null;
};

type CapitalConfig = {
  id: string;
  data_inicio: string;
  data_fim: string | null;
  reserva_min_pct: number;
  taxa_juros_padrao: number;
  // Migr. 604 — teto de parcelas do crédito da holding (1..60).
  max_parcelas: number;
  criado_por_nome: string | null;
  created_at: string;
};

type SaldoFilial = {
  capital_total: number;
  despesas_pagas: number;
  receitas_pagas: number;
  // Declarados a partir da migr. 474: viraram o teto da distribuição de lucro.
  // A RPC sempre devolveu os três; o tipo é que só listava o que a tela usava.
  despesas_financeiras: number;
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
  banco_id: string | null;
  banco_nome: string | null;
  status: 'Pendente' | 'Aprovado' | 'Negado';
  solicitado_por_nome: string | null;
  aprovado_por_nome: string | null;
  justificativa_resposta: string | null;
  created_at: string;
  // Migr. 572 — carimbado pelos dois resets nos contratos que eles preservam.
  // Preenchido = histórico fechado: não conta capital, não aceita UPDATE, e é
  // o único que o professor pode apagar.
  arquivado_em: string | null;
  // Migr. 573 — a conta da Matriz debitada na aprovação, o par de `banco_id`.
  // NULL nos empréstimos anteriores: nesses, o estorno pergunta.
  banco_origem_id: string | null;
};

type Banco = { id: string; banco: string; conta: string; tipo: string; filial: string | null; saldo: number | null };

// Migr. 474 — o retorno do aporte. Aporte não rende juros; o que ele devolve é
// resultado, quando existe resultado.
type Distribuicao = {
  id: string;
  filial: string;
  valor: number;
  base_lucro: number | null;
  decidido_por_nome: string | null;
  observacao: string | null;
  created_at: string;
};

const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type Filial = typeof FILIAIS[number];

// A holding entrou no mapa de capital em 2026-08-01 (migr. 323). Ela NÃO é a
// quarta filial: continua fora de `FILIAIS`, e por isso fora do consolidado,
// do ranking e da competição. O que ela ganhou foi capital próprio — de onde
// saem a folha da diretoria e o custo corporativo antes do rateio.
const UNIDADES = [...FILIAIS, 'Matriz'] as const;
type UnidadeCapital = typeof UNIDADES[number];

const FILIAL_COLOR: Record<UnidadeCapital, { accent: string; ring: string; bg: string; bar: string }> = {
  SuperMax: { accent: 'text-sky-400',    ring: 'ring-sky-500/30',    bg: 'bg-sky-500/10',    bar: 'bg-sky-500' },
  MaxLook:  { accent: 'text-amber-300',  ring: 'ring-amber-400/30',  bg: 'bg-amber-400/10',  bar: 'bg-amber-400' },
  TechMax:  { accent: 'text-orange-400', ring: 'ring-orange-500/30', bg: 'bg-orange-500/10', bar: 'bg-orange-500' },
  Matriz:   { accent: 'text-yellow-400', ring: 'ring-yellow-500/30', bg: 'bg-yellow-500/10', bar: 'bg-yellow-500' },
};

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Rio_Branco' });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Rio_Branco',
  });

// Conselheiro saiu das duas funções em 2026-08-01 (migr. 326). Registrar
// aporte e aprovar empréstimo deixaram de ser "gravar um número" e passaram a
// TRANSFERIR dinheiro entre contas — ato executivo, não de conselho.
//
// No caso de `podeAprovar` isso conserta um botão que já estava morto: o
// `_assert_capital_holding` do banco sempre exigiu admin/CEO, então o
// conselheiro via "Analisar", clicava e tomava erro de permissão.
function podeCriar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}
function podeExcluir(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}
// Migr. 572 — a válvula do professor. `role === 'admin'` LITERAL, do mesmo
// jeito que a RPC: `podeExcluir` acima inclui o CEO, que é aluno.
function podeApagarEmprestimo(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin';
}
// Migr. 606 — corrigir a própria aprovação é a mesma válvula do professor, e
// pela mesma razão: refaz o contrato e mexe nas duas contas. A RPC cobra
// `role = 'admin'` literal; aqui só se esconde o botão.
function podeEditarEmprestimo(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin';
}
function podeAprovar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}
function podeConfigurar(p: UserProfile | null) {
  if (!p) return false;
  return p.role === 'admin' || p.role === 'ceo';
}

// ── Barra de saúde financeira ──────────────────────────────────────────────
function HealthBar({ saldo, total }: { saldo: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (saldo / total) * 100)) : 0;
  const color = pct > 40 ? 'bg-green-500' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mt-2">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Modal: Novo aporte ─────────────────────────────────────────────────────
function ModalCapital({
  filial, bancos, onClose, onSaved, showToast,
}: {
  filial: UnidadeCapital; bancos: Banco[]; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void; profile: UserProfile | null;
}) {
  const [valorStr, setValorStr] = useState('');
  const [observacao, setObservacao] = useState('');
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [saving, setSaving] = useState(false);
  const cor = FILIAL_COLOR[filial];

  // Capital próprio da holding é dinheiro dos SÓCIOS entrando: não sai de
  // conta nenhuma do grupo, só escolhe onde entra. Aporte pra unidade é
  // transferência — sai de uma conta da Matriz e entra numa da filial.
  const isCapitalProprio = filial === 'Matriz';
  const contasMatriz = bancos.filter(b => b.filial === 'Matriz');
  const contasDestino = bancos.filter(b => bancoDaUnidade(b, filial));
  const saldoOrigem = Number(contasMatriz.find(b => b.id === origemId)?.saldo ?? 0);
  const valorNum = parseBRL(valorStr);
  const semSaldo = !isCapitalProprio && !!origemId && valorNum > saldoOrigem;

  const handleSalvar = async () => {
    if (!supabase) return;
    const valor = parseBRL(valorStr);
    if (valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
    if (!destinoId) { showToast('Escolha a conta de destino.', 'error'); return; }
    if (!isCapitalProprio && !origemId) { showToast('Escolha a conta da Matriz de origem.', 'error'); return; }
    setSaving(true);
    try {
      // RPC, não INSERT: é ela que debita a origem, credita o destino e grava
      // o capital na mesma transação (migr. 326). A policy de INSERT direto
      // em `capital_filial` foi removida justamente pra não haver atalho.
      const { error } = await supabase.rpc('registrar_aporte_capital', {
        p_filial: filial,
        p_valor: valor,
        p_banco_destino_id: destinoId,
        p_banco_origem_id: isCapitalProprio ? null : origemId,
        p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      showToast(
        isCapitalProprio
          ? 'Capital próprio da holding registrado.'
          : `Aporte de ${BRL(valor)} transferido para ${filial}.`,
        'success',
      );
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
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
            <h2 className="text-base font-bold text-gray-100">
              {filial === 'Matriz' ? 'Capital Próprio da Holding' : 'Novo Aporte de Capital'}
            </h2>
            <span className={`text-xs font-bold ${cor.accent}`}>{filial}</span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor (R$) *</label>
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
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Observação</label>
          <textarea
            value={observacao} onChange={e => setObservacao(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder={filial === 'Matriz'
              ? 'Ex.: Capital social dos sócios, reserva de lucros retida...'
              : 'Ex.: Capital social inicial, reinvestimento...'}
          />
        </div>

        {/* Origem — só no aporte pra unidade. O capital próprio entra de fora
            do grupo, então não tem conta de origem interna. */}
        {!isCapitalProprio && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sai da conta (Matriz) *</label>
            <SelectBusca
              value={origemId}
              onChange={setOrigemId}
              placeholder="Escolha a conta"
              opcoes={contasMatriz.map(b => opcaoBanco(b, { saldo: true }))}
            />
            {contasMatriz.length === 0 && (
              <span className="text-[10px] text-yellow-400">
                A Matriz não tem caixa/banco ativo. Cadastre um em Caixa / Bancos e registre o capital próprio antes de aportar.
              </span>
            )}
            {semSaldo && (
              <span className="text-[10px] text-red-400">
                Saldo insuficiente: a conta tem {BRL(saldoOrigem)}.
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Entra na conta ({filial}) *
          </label>
          <SelectBusca
              value={destinoId}
              onChange={setDestinoId}
              placeholder="Escolha a conta"
              opcoes={contasDestino.map(b => opcaoBanco(b, { saldo: false }))}
            />
          {contasDestino.length === 0 && (
            <span className="text-[10px] text-yellow-400">
              {filial} não tem caixa/banco ativo. Cadastre um em Caixa / Bancos antes.
            </span>
          )}
        </div>

        <NeuButtonAccent onClick={handleSalvar} isLoading={saving} disabled={semSaldo}>
          {isCapitalProprio ? 'Registrar Capital' : 'Transferir Aporte'}
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Modal: Aprovar/Negar empréstimo ───────────────────────────────────────
function ModalAprovarEmprestimo({
  emp, bancos, taxaPadrao, onClose, onSaved, showToast,
}: {
  emp: Emprestimo; bancos: Banco[]; taxaPadrao: number;
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [bancoId, setBancoId] = useState('');
  const [origemId, setOrigemId] = useState('');
  const [taxa, setTaxa] = useState(String(taxaPadrao));
  const [parcelas, setParcelas] = useState(String(emp.num_parcelas));
  const [justResp, setJustResp] = useState('');
  const [saving, setSaving] = useState(false);

  // Espelho da conta que a RPC faz no banco (migr. 473): Price, taxa AO MÊS.
  // A versão anterior era `valor * (1 + taxa/100)` dividido pelas parcelas —
  // cobrava a taxa uma vez sobre o contrato inteiro, então "2,3" em 12x saía
  // por R$ 1.150 de juros em vez de R$ 7.786.
  const mutuo = tabelaPrice(emp.valor, parseFloat(taxa) || 0, parseInt(parcelas) || 1);
  // `aprovar_emprestimo` CREDITA o banco escolhido: é a conta onde o dinheiro
  // do empréstimo cai, ou seja, uma conta da filial que pediu — não da Matriz.
  // Desde que a holding passou a ter caixa próprio (migr. 325) essa lista
  // precisava filtrar, senão dava pra aprovar um empréstimo pra SuperMax e
  // creditar o caixa da Matriz.
  const bancosDaFilial = bancos.filter(b => bancoDaUnidade(b, emp.filial));
  const bancoCont = bancosDaFilial.find(b => b.id === bancoId);
  // O principal sai do caixa da holding (migr. 326) — antes era creditado na
  // filial sem sair de lugar nenhum.
  const contasMatriz = bancos.filter(b => b.filial === 'Matriz');
  const saldoOrigem = Number(contasMatriz.find(b => b.id === origemId)?.saldo ?? 0);
  const semSaldo = !!origemId && emp.valor > saldoOrigem;

  const aprovar = async () => {
    if (!supabase) return;
    if (!bancoId) { showToast('Selecione a conta de destino.', 'error'); return; }
    if (!origemId) { showToast('Selecione a conta da Matriz de onde sai o valor.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('aprovar_emprestimo', {
        p_emprestimo_id: emp.id,
        p_banco_id: bancoId,
        p_banco_nome: bancoCont ? `${bancoCont.banco} — ${bancoCont.conta}` : '',
        p_taxa_juros: parseFloat(taxa) || 0,
        p_num_parcelas: parseInt(parcelas) || 1,
        p_justificativa_resp: justResp.trim() || null,
        p_banco_origem_id: origemId,
      });
      if (error) throw error;
      showToast('Empréstimo aprovado. Valor transferido e parcelas geradas.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
  };

  const negar = async () => {
    if (!supabase) return;
    if (!justResp.trim()) { showToast('Informe a justificativa para negar.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('negar_emprestimo', {
        p_emprestimo_id: emp.id,
        p_justificativa_resp: justResp.trim(),
      });
      if (error) throw error;
      showToast('Empréstimo negado.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
  };

  const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Analisar Empréstimo</h2>
            <span className={`text-xs font-bold ${cor.accent}`}>{emp.filial}</span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        {/* Resumo da solicitação */}
        <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Valor solicitado</span>
            <span className="font-bold text-gray-100 tabular-nums">{BRL(emp.valor)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Solicitante</span>
            <span className="text-gray-300">{emp.solicitado_por_nome ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Parcelas solicitadas</span>
            <span className="text-gray-300">{emp.num_parcelas}x</span>
          </div>
          <div className="text-xs text-gray-400 mt-1 italic border-t border-white/5 pt-2">
            "{emp.justificativa}"
          </div>
        </div>

        {/* Configurar aprovação */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sai da conta (Matriz) *</label>
            <SelectBusca
              value={origemId}
              onChange={setOrigemId}
              placeholder="Escolha a conta"
              opcoes={contasMatriz.map(b => opcaoBanco(b, { saldo: true }))}
            />
            {contasMatriz.length === 0 && (
              <span className="text-[10px] text-yellow-400">
                A Matriz não tem caixa/banco ativo. Cadastre um em Caixa / Bancos antes de aprovar.
              </span>
            )}
            {semSaldo && (
              <span className="text-[10px] text-red-400">
                Saldo insuficiente: a conta tem {BRL(saldoOrigem)} e o empréstimo é de {BRL(emp.valor)}.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Entra na conta * <span className="text-gray-600 normal-case tracking-normal">— conta de {emp.filial} que recebe o valor</span>
            </label>
            <SelectBusca
              value={bancoId}
              onChange={setBancoId}
              placeholder="Escolha a conta"
              opcoes={bancosDaFilial.map(b => opcaoBanco(b, { saldo: false }))}
            />
            {bancosDaFilial.length === 0 && (
              <span className="text-[10px] text-yellow-400">
                {emp.filial} não tem caixa/banco ativo. Cadastre um em Caixa / Bancos antes de aprovar.
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Taxa de juros (% ao mês)
              </label>
              <input
                type="number" min="0" step="0.001" value={taxa}
                onChange={e => setTaxa(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nº de parcelas</label>
              <input
                type="number" min="1" max="60" value={parcelas}
                onChange={e => setParcelas(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
          </div>

          {/* Preview — o custo do dinheiro tem que aparecer ANTES de aprovar.
              É a diferença entre "emprestei 50 mil" e "emprestei 50 mil que
              voltam 57.786,23". */}
          <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Parcela fixa ({parcelas || 1}x)</span>
              <strong className="text-gray-200 tabular-nums">{BRL(mutuo.valorParcela)}</strong>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>Total que a filial devolve</span>
              <strong className="text-gray-200 tabular-nums">{BRL(mutuo.totalPago)}</strong>
            </div>
            <div className="flex justify-between text-xs text-gray-400 border-t border-white/5 pt-1.5">
              <span>Juros — o que a Matriz ganha</span>
              <strong className="text-accent tabular-nums">{BRL(mutuo.totalJuros)}</strong>
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Tabela Price: a parcela é fixa, mas dentro dela o juro cai e a devolução do
              principal sobe. Só o juro é despesa da filial — devolver o principal não é custo.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Justificativa / Comentário</label>
            <textarea
              value={justResp} onChange={e => setJustResp(e.target.value)} rows={2}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
              placeholder="Obrigatório para negar; opcional para aprovar."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={negar} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            <XCircle size={15} /> Negar
          </button>
          <NeuButtonAccent onClick={aprovar} isLoading={saving} disabled={semSaldo} className="flex-1">
            <CheckCircle size={15} /> Aprovar
          </NeuButtonAccent>
        </div>
      </motion.div>
    </div>
  );
}

// ── Modal: Configuração de período ────────────────────────────────────────
function ModalConfig({
  config, onClose, onSaved, showToast, profile,
}: {
  config: CapitalConfig | null; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void; profile: UserProfile | null;
}) {
  const hoje = todayBR();
  const [dataInicio, setDataInicio] = useState(config?.data_inicio ?? hoje);
  const [dataFim, setDataFim] = useState(config?.data_fim ?? '');
  const [reservaPct, setReservaPct] = useState(String(config?.reserva_min_pct ?? 0));
  const [taxaPadrao, setTaxaPadrao] = useState(String(config?.taxa_juros_padrao ?? 0));
  // Migr. 604 — política de crédito da holding. 12 é o padrão da coluna; o
  // teto duro é 60 (5 anos), e vale lembrar que contrato de 60x não se encerra
  // dentro de uma turma.
  const [maxParcelas, setMaxParcelas] = useState(String(config?.max_parcelas ?? 12));
  const [saving, setSaving] = useState(false);

  const handleSalvar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const payload = {
        data_inicio: dataInicio,
        data_fim: dataFim || null,
        reserva_min_pct: parseFloat(reservaPct) || 0,
        taxa_juros_padrao: parseFloat(taxaPadrao) || 0,
        max_parcelas: Math.min(60, Math.max(1, parseInt(maxParcelas) || 12)),
        criado_por: profile?.id ?? null,
        criado_por_nome: profile?.nome ?? null,
      };
      const { error } = await supabase.from('capital_config').insert(payload);
      if (error) throw error;
      showToast('Configuração salva.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
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
          <h2 className="text-base font-bold text-gray-100">Configuração de Período</h2>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>
        {config && (
          <div className="text-xs text-gray-500 neu-pressed rounded-xl p-3">
            Ativo desde {dataSimplesBR(config.data_inicio)}
            {config.data_fim ? ` até ${dataSimplesBR(config.data_fim)}` : ' (sem prazo)'}
            {' · '}Reserva {qtdBR(config.reserva_min_pct)}% · Juros padrão {qtdBR(config.taxa_juros_padrao)}% a.m.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Início *</label>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Fim (opcional)</label>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Reserva mínima (%)</label>
            <input type="number" min="0" max="99" step="1" value={reservaPct}
              onChange={e => setReservaPct(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Taxa juros padrão (% a.m.)</label>
            <input type="number" min="0" step="0.001" value={taxaPadrao}
              onChange={e => setTaxaPadrao(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Parcelamento máximo (1 a 60)
          </label>
          <input type="number" min="1" max="60" step="1" value={maxParcelas}
            onChange={e => setMaxParcelas(e.target.value)}
            className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none" />
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Teto de parcelas que a filial pode pedir e a Matriz aprovar. Prazo longo
            deixa a parcela leve e o juro total pesado — em 60x o contrato atravessa
            a turma inteira sem quitar.
          </p>
        </div>
        <NeuButtonAccent onClick={handleSalvar} isLoading={saving}>Salvar Nova Configuração</NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Modal: Estornar aporte ────────────────────────────────────────────────
// Aporte não é lançamento contábil solto: ele DEBITOU uma conta da Matriz e
// CREDITOU uma da unidade. Por isso apagar a linha nunca foi opção (migr. 326)
// — e por isso, até a 475, também não havia saída nenhuma. O estorno desfaz o
// caminho inteiro na mesma transação.
//
// A tela mostra as duas contas e o saldo atual da que recebeu, porque é esse
// número que decide se o estorno passa: se a unidade já gastou parte, o banco
// recusa. Melhor o usuário ver isso antes de clicar do que depois do erro.
function ModalEstornoAporte({
  registro, bancos, onClose, onSaved, showToast,
}: {
  registro: CapitalRow; bancos: Banco[]; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const contaDe = (id: string | null) => bancos.find(b => b.id === id) ?? null;
  const destino = contaDe(registro.banco_destino_id);
  const origem = contaDe(registro.banco_origem_id);
  const saldoDestino = Number(destino?.saldo ?? 0);
  const semCaixa = !!destino && saldoDestino < Number(registro.valor);

  const handleEstornar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('estornar_aporte_capital', {
        p_aporte_id: registro.id,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      showToast(`Aporte de ${BRL(registro.valor)} estornado.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao estornar.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-sm border border-red-500/30 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Estornar Aporte</h2>
            <span className="text-xs font-bold text-red-400">
              {BRL(registro.valor)} · {registro.filial}
            </span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1.5 text-[11px] text-gray-400">
          <div className="flex justify-between gap-3">
            <span>Registrado em</span>
            <span className="text-gray-300">{fmtDateTime(registro.created_at)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Saiu de</span>
            <span className="text-gray-300 text-right">
              {origem ? `${origem.banco} — ${origem.conta}` : 'Capital próprio (sem conta)'}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Entrou em</span>
            <span className="text-gray-300 text-right">
              {/* A lista de contas vem filtrada por status Ativo. Conta
                  desativada depois do aporte some daqui, mas o estorno segue
                  possível — quem confere o saldo dela é o banco. */}
              {destino ? `${destino.banco} — ${destino.conta}` : 'conta inativa ou removida'}
            </span>
          </div>
          {destino && (
            <div className="flex justify-between gap-3">
              <span>Saldo atual dessa conta</span>
              <span className={`tabular-nums ${semCaixa ? 'text-red-400' : 'text-gray-300'}`}>
                {BRL(saldoDestino)}
              </span>
            </div>
          )}
        </div>

        {semCaixa ? (
          <div className="flex items-start gap-2 text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              A conta que recebeu tem menos do que o aporte — a unidade já usou parte do dinheiro.
              Estornar deixaria o saldo negativo. Para trazer capital de volta depois de usado,
              o caminho é <b>Distribuição de Lucro</b>.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-[11px] text-gray-400 bg-white/[0.03] border border-white/5 rounded-xl p-3">
            <Info size={13} className="shrink-0 mt-0.5 text-accent" />
            <span>
              {BRL(registro.valor)} sai da conta de {registro.filial}
              {origem ? ` e volta para ${origem.banco}` : ' e sai do grupo'}. O registro de capital
              é apagado, mas fica no histórico de operações.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Motivo do estorno</label>
          <textarea
            value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Ex.: aporte lançado na unidade errada"
          />
        </div>

        <NeuButtonAccent onClick={handleEstornar} isLoading={saving} disabled={semCaixa}>
          Estornar Aporte
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Modal: Apagar empréstimo vivo (com estorno) ────────────────────────────
// A 572 preservou o empréstimo no reset e deu a lixeira ao professor, mas
// recusava o aprovado ainda VIVO — o dinheiro está em caixa e apagar a linha
// não devolveria nada. A 573 faz a devolução acontecer, e este modal é onde
// ela é confirmada.
//
// O que a tela precisa mostrar, e por quê:
//   · o saldo da conta que devolve, porque é ele que decide se o estorno passa
//     (unidade que já gastou o dinheiro não tem como devolver);
//   · a conta da Matriz que recebe, obrigatória para empréstimo anterior à 573
//     — o banco não sabe de onde saiu e chutar seria devolver no lugar errado.
//
// As parcelas já pagas não aparecem aqui de propósito: elas se revertem
// sozinhas quando os títulos são apagados (`trg_sync_saldo_*`), cada uma na
// conta que de fato pagou. O que se confirma aqui é só o principal.
function ModalApagarEmprestimo({
  emp, bancos, onClose, onSaved, showToast,
}: {
  emp: Emprestimo; bancos: Banco[]; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const bancosMatriz = useMemo(() => bancos.filter(b => b.filial === 'Matriz'), [bancos]);
  const [origemId, setOrigemId] = useState<string>(
    emp.banco_origem_id ?? (bancosMatriz.length === 1 ? bancosMatriz[0].id : ''),
  );
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const destino = bancos.find(b => b.id === emp.banco_id) ?? null;
  const origem = bancosMatriz.find(b => b.id === origemId) ?? null;
  const saldoDestino = Number(destino?.saldo ?? 0);
  const semCaixa = !!destino && saldoDestino < Number(emp.valor);

  const handleApagar = async () => {
    if (!supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('apagar_emprestimo', {
        p_emprestimo_id: emp.id,
        p_estornar: true,
        p_banco_origem_id: origemId || null,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      showToast(`Empréstimo de ${BRL(emp.valor)} apagado e principal devolvido.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao apagar.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-sm border border-red-500/30 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Apagar Empréstimo</h2>
            <span className="text-xs font-bold text-red-400">
              {BRL(emp.valor)} · {emp.filial}
            </span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1.5 text-[11px] text-gray-400">
          <div className="flex justify-between gap-3">
            <span>Aprovado em</span>
            <span className="text-gray-300">{fmtDateTime(emp.created_at)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Devolve da conta</span>
            <span className="text-gray-300 text-right">
              {destino ? `${destino.banco} — ${destino.conta}` : 'conta inativa ou removida'}
            </span>
          </div>
          {destino && (
            <div className="flex justify-between gap-3">
              <span>Saldo atual dessa conta</span>
              <span className={`tabular-nums ${semCaixa ? 'text-red-400' : 'text-gray-300'}`}>
                {BRL(saldoDestino)}
              </span>
            </div>
          )}
        </div>

        {/* Empréstimo anterior à 573 não registrou a origem. Perguntar é a
            única saída honesta: devolver ao caixa errado seria dinheiro criado
            num lugar e sumido noutro. */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Conta da Matriz que recebe de volta
          </label>
          <SelectBusca
              value={origemId}
              onChange={setOrigemId}
              placeholder="Escolha a conta"
              opcoes={bancosMatriz.map(b => opcaoBanco(b, { saldo: true }))}
            />
          {!emp.banco_origem_id && (
            <span className="text-[10px] text-gray-500">
              Este empréstimo é anterior ao registro da conta de origem, então ela precisa ser informada.
            </span>
          )}
        </div>

        {semCaixa ? (
          <div className="flex items-start gap-2 text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              A conta de {emp.filial} tem menos do que o empréstimo — a unidade já usou o dinheiro.
              Devolver deixaria o saldo negativo, então o banco vai recusar. O caminho é a unidade
              pagar as parcelas, ou esperar um reset arquivar o contrato.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-[11px] text-gray-400 bg-white/[0.03] border border-white/5 rounded-xl p-3">
            <Info size={13} className="shrink-0 mt-0.5 text-accent" />
            <span>
              {BRL(emp.valor)} sai da conta de {emp.filial}
              {origem ? ` e volta para ${origem.banco}` : ''}. As parcelas e os títulos dos dois lados
              são apagados — o que já tiver sido pago volta sozinho para a conta que pagou. Fica no
              histórico de operações.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Motivo</label>
          <textarea
            value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
            className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
            placeholder="Ex.: empréstimo aprovado na unidade errada"
          />
        </div>

        <NeuButtonAccent onClick={handleApagar} isLoading={saving} disabled={semCaixa || !origemId}>
          Apagar e devolver {BRL(emp.valor)}
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Modal: Editar empréstimo aprovado ─────────────────────────────────────
//
// Migr. 606. O meio-termo entre deixar como está e apagar: o contrato está
// certo em existir e errado no número — taxa digitada como 23 em vez de 2,3,
// 12x onde era 6x, um zero a mais no valor. Aqui se corrige sem jogar fora a
// solicitação do aluno.
//
// A tela diz o que a RPC faz, porque não é um UPDATE inocente: o cronograma
// inteiro é refeito e o principal antigo volta antes do novo sair. O que a
// unidade já pagou volta sozinho para a conta que pagou (`trg_sync_saldo_*`),
// e os vencimentos recomeçam a 30 dias de hoje.
function ModalEditarEmprestimo({
  emp, bancos, onClose, onSaved, showToast,
}: {
  emp: Emprestimo; bancos: Banco[]; onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [valor, setValor] = useState(formatBRL(Number(emp.valor)));
  const [taxa, setTaxa] = useState(String(emp.taxa_juros ?? 0));
  const [parcelas, setParcelas] = useState(String(emp.num_parcelas));
  const [destinoId, setDestinoId] = useState(emp.banco_id ?? '');
  const [origemId, setOrigemId] = useState(emp.banco_origem_id ?? '');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const valorNum = parseBRL(valor);
  const contasMatriz = useMemo(() => bancos.filter(b => b.filial === 'Matriz'), [bancos]);
  const contasFilial = useMemo(() => bancos.filter(b => bancoDaUnidade(b, emp.filial)), [bancos, emp.filial]);

  // A conta da unidade precisa ter o principal ANTIGO para devolver antes que
  // o novo saia — é a mesma recusa da 573, antecipada na tela.
  const destinoAtual = bancos.find(b => b.id === emp.banco_id) ?? null;
  const saldoDestinoAtual = Number(destinoAtual?.saldo ?? 0);
  const semDevolucao = !!destinoAtual && saldoDestinoAtual < Number(emp.valor);

  // O caixa da Matriz confere o valor NOVO já com o antigo de volta: trocar
  // 10.000 por 10.500 não pode ser recusado por saldo que a própria edição
  // devolve.
  const origem = contasMatriz.find(b => b.id === origemId) ?? null;
  const saldoOrigem = Number(origem?.saldo ?? 0)
    + (origemId === emp.banco_origem_id ? Number(emp.valor) : 0);
  const semSaldo = !!origemId && valorNum > saldoOrigem;

  const mutuo = tabelaPrice(valorNum, parseFloat(taxa) || 0, parseInt(parcelas) || 1);
  const mudou =
    valorNum !== Number(emp.valor)
    || (parseFloat(taxa) || 0) !== Number(emp.taxa_juros ?? 0)
    || (parseInt(parcelas) || 0) !== emp.num_parcelas
    || destinoId !== (emp.banco_id ?? '')
    || origemId !== (emp.banco_origem_id ?? '');

  const salvar = async () => {
    if (!supabase) return;
    if (valorNum <= 0) { showToast('Informe o valor do empréstimo.', 'error'); return; }
    if (!destinoId) { showToast(`Selecione a conta de ${emp.filial} que recebe.`, 'error'); return; }
    if (!origemId) { showToast('Selecione a conta da Matriz de onde sai o valor.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('editar_emprestimo', {
        p_emprestimo_id: emp.id,
        p_valor: valorNum,
        p_taxa_juros: parseFloat(taxa) || 0,
        p_num_parcelas: parseInt(parcelas) || 1,
        p_banco_id: destinoId,
        p_banco_origem_id: origemId,
        p_justificativa_resp: null,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      showToast('Empréstimo corrigido. Parcelas e títulos foram refeitos.', 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao editar.', 'error');
    } finally { setSaving(false); }
  };

  const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Corrigir Empréstimo</h2>
            <span className={`text-xs font-bold ${cor.accent}`}>
              {emp.filial} · aprovado em {fmtDate(emp.created_at)}
            </span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="neu-pressed rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Como está hoje</span>
            <span className="font-bold text-gray-100 tabular-nums">
              {BRL(emp.valor)} · {emp.num_parcelas}x · {qtdBR(emp.taxa_juros ?? 0)}% a.m.
            </span>
          </div>
          <div className="text-xs text-gray-400 italic border-t border-white/5 pt-2">
            "{emp.justificativa}"
          </div>
        </div>

        {semDevolucao ? (
          <div className="flex items-start gap-2 text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              Refazer o contrato exige devolver os {BRL(emp.valor)} originais antes de aplicar o
              valor novo, e a conta de {emp.filial} tem {BRL(saldoDestinoAtual)}. A unidade já usou
              o dinheiro — o caminho é ela pagar as parcelas primeiro.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-[11px] text-gray-400 bg-white/[0.03] border border-white/5 rounded-xl p-3">
            <Info size={13} className="shrink-0 mt-0.5 text-accent" />
            <span>
              As {emp.num_parcelas} parcelas e os títulos dos dois lados são apagados e refeitos
              com as condições novas — o que a unidade já pagou volta sozinho para a conta que
              pagou. Os vencimentos recomeçam: a primeira parcela cai em 30 dias. A unidade do
              contrato não muda.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor *</label>
            <input
              type="text" inputMode="numeric" value={valor}
              onChange={e => setValor(formatBRL(e.target.value))}
              placeholder="0,00"
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Taxa de juros (% ao mês)
              </label>
              <input
                type="number" min="0" step="0.001" value={taxa}
                onChange={e => setTaxa(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nº de parcelas</label>
              <input
                type="number" min="1" max="60" value={parcelas}
                onChange={e => setParcelas(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sai da conta (Matriz) *</label>
            <SelectBusca
              value={origemId}
              onChange={setOrigemId}
              placeholder="Escolha a conta"
              opcoes={contasMatriz.map(b => opcaoBanco(b, { saldo: true }))}
            />
            {!emp.banco_origem_id && (
              <span className="text-[10px] text-gray-500">
                Este empréstimo é anterior ao registro da conta de origem, então ela precisa ser informada.
              </span>
            )}
            {semSaldo && (
              <span className="text-[10px] text-red-400">
                Saldo insuficiente: a conta fica com {BRL(saldoOrigem)} depois da devolução e o
                empréstimo corrigido é de {BRL(valorNum)}.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Entra na conta * <span className="text-gray-600 normal-case tracking-normal">— conta de {emp.filial}</span>
            </label>
            <SelectBusca
              value={destinoId}
              onChange={setDestinoId}
              placeholder="Escolha a conta"
              opcoes={contasFilial.map(b => opcaoBanco(b, { saldo: false }))}
            />
          </div>

          {valorNum > 0 && (
            <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Parcela fixa ({parcelas || 1}x)</span>
                <strong className="text-gray-200 tabular-nums">{BRL(mutuo.valorParcela)}</strong>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Total que {emp.filial} devolve</span>
                <strong className="text-gray-200 tabular-nums">{BRL(mutuo.totalPago)}</strong>
              </div>
              <div className="flex justify-between text-xs text-gray-400 border-t border-white/5 pt-1.5">
                <span>Juros — o que a Matriz ganha</span>
                <strong className="text-accent tabular-nums">{BRL(mutuo.totalJuros)}</strong>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Motivo da correção</label>
            <textarea
              value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
              placeholder="Fica no histórico de operações. Ex.: taxa digitada errada na aprovação."
            />
          </div>
        </div>

        <NeuButtonAccent
          onClick={salvar} isLoading={saving}
          disabled={semDevolucao || semSaldo || !mudou || valorNum <= 0}
        >
          <Pencil size={15} /> {mudou ? 'Salvar correção' : 'Nada mudou'}
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Card por filial (Aportes) ──────────────────────────────────────────────
function FilialCapitalCard({
  filial, registros, saldo, profile, onNovo, onExcluir, posicao,
}: {
  filial: UnidadeCapital; registros: CapitalRow[]; saldo: SaldoFilial | null;
  profile: UserProfile | null; onNovo: (f: UnidadeCapital) => void; onExcluir: (r: CapitalRow) => void;
  /** Posição no ranking de saúde (só as operacionais). */
  posicao?: number;
}) {
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const cor = FILIAL_COLOR[filial];
  const ultimo = registros[0] ?? null;
  const bloqueado = saldo?.bloqueado ?? false;
  const emReserva = saldo?.em_reserva ?? false;
  const pctGasto = saldo && saldo.capital_total > 0
    ? Math.min(100, (saldo.despesas_pagas / saldo.capital_total) * 100)
    : 0;
  const pctLivre = saldo && saldo.capital_total > 0
    ? Math.max(0, Math.min(100, (saldo.saldo_livre / saldo.capital_total) * 100))
    : 0;

  return (
    <div className={`neu-flat rounded-2xl border overflow-hidden flex flex-col ${bloqueado ? 'border-red-500/50' : 'border-white/5'}`}>
      <div className={`h-1 ${cor.bar}`} />
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          {posicao != null && (
            <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-xs font-black text-gray-400 shrink-0"
              title="Posição no ranking de saúde financeira">
              {posicao}º
            </span>
          )}
          <h3 className={`flex-1 min-w-0 text-sm font-black uppercase tracking-widest truncate ${cor.accent}`}>{filial}</h3>
          {podeCriar(profile) && (
            <button onClick={() => onNovo(filial)}
              className="btn-solido btn-solido--cinza !py-1.5 !px-3 !text-[11px] shrink-0">
              <Plus size={13} /> Aporte
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Capital total</p>
            <p className="text-2xl font-black tabular-nums text-gray-100 mt-0.5">
              {saldo ? BRL(saldo.capital_total) : ultimo ? BRL(ultimo.valor) : '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Saldo livre</p>
            <p className={`text-2xl font-black tabular-nums mt-0.5 ${bloqueado ? 'text-red-400' : 'text-green-400'}`}>
              {saldo ? BRL(saldo.saldo_livre) : '—'}
            </p>
          </div>
        </div>

        {saldo && (
          <div className="flex flex-col gap-1.5">
            <HealthBar saldo={saldo.saldo_real} total={saldo.capital_total} />
            <div className="flex justify-between text-[11px] text-gray-500">
              <span>{pctLivre.toFixed(0)}% livre · gasto {BRL(saldo.despesas_pagas)} ({pctGasto.toFixed(0)}%)</span>
              {saldo.reserva_pct > 0 && <span>reserva {BRL(saldo.reserva_valor)}</span>}
            </div>
            {/* Receita só para leitura: capital é aporte − despesa, a receita vai para a DRE. */}
            <p className="text-[11px] text-gray-500"
              title="O capital é aporte − despesas. A receita entra no caixa da filial e aparece na DRE, mas não aumenta o capital.">
              Receita no período <span className="text-green-400 font-bold tabular-nums">{BRL(saldo.receitas_pagas)}</span>
              <span className="text-gray-600"> · fora do saldo</span>
            </p>
          </div>
        )}

        {(bloqueado || emReserva) && (
          <div className="flex flex-wrap gap-1.5">
            {bloqueado && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-red-600 text-white">
                <ShieldAlert size={12} /> Capital estourado · lançamentos bloqueados
              </span>
            )}
            {emReserva && !bloqueado && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-amber-500 text-black">
                <AlertTriangle size={12} /> Abaixo da reserva mínima
              </span>
            )}
          </div>
        )}
      </div>

      {registros.length > 0 && (
        <div className="mt-auto border-t border-white/5">
          <button onClick={() => setHistoricoAberto(v => !v)}
            className="w-full flex items-center gap-2 px-5 py-3 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/[0.03] transition-colors text-left">
            <span className="flex-1">
              {registros.length} aporte(s)
              {ultimo && <span className="text-gray-600"> · último {BRL(ultimo.valor)} em {fmtDateTime(ultimo.created_at).slice(0, 10)}</span>}
            </span>
            {historicoAberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {/* Sem animação de altura: a lista abre e fecha seca. */}
          {historicoAberto && (
            <div className="px-3 pb-3 flex flex-col gap-1">
              {registros.map(r => (
                <div key={r.id} className="flex items-start gap-2 px-3 py-2 rounded-xl hover:bg-white/[0.03] group">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold tabular-nums text-gray-100">{BRL(r.valor)}</span>
                    <div className="text-[11px] text-gray-500">
                      {fmtDateTime(r.created_at)}{r.registrado_por_nome && ` · ${r.registrado_por_nome}`}
                    </div>
                    {r.observacao && <p className="text-[11px] text-gray-400 italic">"{r.observacao}"</p>}
                  </div>
                  {podeExcluir(profile) && (
                    <button onClick={() => onExcluir(r)}
                      title="Estornar aporte — devolve o dinheiro para a conta da Matriz"
                      className="action-btn-delete opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: DRE ──────────────────────────────────────────────────────────────
function TabDRE({ saldos, semConfig }: { saldos: Record<UnidadeCapital, SaldoFilial | null>; semConfig: boolean }) {
  const linhas = UNIDADES.map(f => {
    const s = saldos[f];
    return { f, s, receita: s?.receitas_pagas ?? 0, despesa: s?.despesas_pagas ?? 0 };
  });
  const ops = linhas.filter(l => l.f !== 'Matriz');
  const tot = { receita: ops.reduce((a, l) => a + l.receita, 0), despesa: ops.reduce((a, l) => a + l.despesa, 0) };
  const cor = (v: number) => (v >= 0 ? 'text-green-400' : 'text-red-400');
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardContador label="Receita das unidades" value={BRL(tot.receita)} tom="verde" />
        <CardContador label="Despesa das unidades" value={BRL(tot.despesa)} tom="vermelho" />
        <CardContador label="Resultado" value={BRL(tot.receita - tot.despesa)} tom={tot.receita - tot.despesa >= 0 ? 'azul' : 'vermelho'}
          sub={semConfig ? 'Todo o histórico' : 'No período configurado'} />
      </div>
      {semConfig && (
        <p className="text-xs text-amber-300">Sem período configurado: a DRE soma todo o histórico.</p>
      )}
      {/* Receita = contas a receber quitadas; despesa = contas pagas. A Matriz entra à parte:
          a DRE dela é o custo corporativo contra o que o rateio recupera. */}
      <div className="neu-flat rounded-2xl border border-white/5 p-4 overflow-x-auto main-scrollbar">
        <table className="tabela w-full text-left min-w-[560px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest">
              <th className="py-2.5 px-3 font-bold">Unidade</th>
              <th className="py-2.5 px-3 font-bold text-center">Receita</th>
              <th className="py-2.5 px-3 font-bold text-center">Despesa</th>
              <th className="py-2.5 px-3 font-bold text-center">Resultado</th>
              <th className="py-2.5 px-3 font-bold text-center">Período</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {linhas.map(({ f, s, receita, despesa }) => (
              <tr key={f}>
                <td className={`py-3 px-3 font-bold ${FILIAL_COLOR[f].accent}`}>{f}{f === 'Matriz' && <span className="text-gray-500 font-normal text-xs"> · holding</span>}</td>
                <td className="py-3 px-3 tabular-nums text-green-400">{s ? BRL(receita) : '—'}</td>
                <td className="py-3 px-3 tabular-nums text-red-400">{s ? BRL(despesa) : '—'}</td>
                <td className={`py-3 px-3 tabular-nums font-bold ${cor(receita - despesa)}`}>{s ? BRL(receita - despesa) : '—'}</td>
                <td className="py-3 px-3 text-xs text-gray-500 whitespace-nowrap">
                  {/* Sem config a RPC não filtra nada: não imprimir uma data que não foi aplicada. */}
                  {semConfig ? 'todo o histórico' : s?.data_inicio ? `${fmtDate(s.data_inicio)} a ${s.data_fim ? fmtDate(s.data_fim) : 'hoje'}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Empréstimos ──────────────────────────────────────────────────────
function TabEmprestimos({
  emprestimos, bancos, taxaPadrao, profile, onReload, showToast,
}: {
  emprestimos: Emprestimo[]; bancos: Banco[]; taxaPadrao: number;
  profile: UserProfile | null; onReload: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [modalEmp, setModalEmp] = useState<Emprestimo | null>(null);
  const [modalApagar, setModalApagar] = useState<Emprestimo | null>(null);
  const [modalEditar, setModalEditar] = useState<Emprestimo | null>(null);
  const [modalAplicar, setModalAplicar] = useState(false);
  const confirm = useConfirm();
  // Migr. 572 — arquivado é histórico fechado: o gatilho recusa aprovar e
  // negar, então ele sai da fila de análise mesmo continuando 'Pendente'.
  const [modalMemoria, setModalMemoria] = useState<Emprestimo | null>(null);
  const pendentes = emprestimos.filter(e => e.status === 'Pendente' && !e.arquivado_em);
  const historico = emprestimos.filter(e => e.status !== 'Pendente' || !!e.arquivado_em);

  const statusIcon = (s: string) => {
    if (s === 'Aprovado') return <CheckCircle size={13} className="text-green-400" />;
    if (s === 'Negado') return <XCircle size={13} className="text-red-400" />;
    return <Clock size={13} className="text-yellow-400" />;
  };

  // Duas portas, porque são dois atos diferentes. Contrato vivo mexe em caixa:
  // vai para o modal, que mostra os saldos e pede a conta que recebe de volta
  // (573). Arquivado, Pendente e Negado não têm principal em lugar nenhum —
  // basta o confirm.
  const handleApagar = async (emp: Emprestimo) => {
    if (emp.status === 'Aprovado' && !emp.arquivado_em) { setModalApagar(emp); return; }
    const ok = await confirm({
      message: `Apagar de vez este empréstimo de ${emp.filial} (${BRL(emp.valor)})? As parcelas e os títulos que restarem vão junto. Esta ação não pode ser desfeita.`,
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.rpc('apagar_emprestimo', { p_emprestimo_id: emp.id });
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Empréstimo apagado.', 'success');
    onReload();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* A holding também origina (migr. 474). Antes ela só respondia a pedido
          da filial, e o único movimento que ela começava era o aporte — que
          não rende. */}
      {podeAprovar(profile) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">Empréstimo com juros e parcelas: diferente do aporte, este dinheiro volta.</p>
          <NeuButtonAccent onClick={() => setModalAplicar(true)}>
            <Plus size={14} /> Aplicar capital numa unidade
          </NeuButtonAccent>
        </div>
      )}

      {pendentes.length === 0 && (
        <div className="neu-flat rounded-2xl border border-white/5 py-8 text-center text-sm text-gray-500">Nenhum empréstimo aguardando análise.</div>
      )}

      {pendentes.length > 0 && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-1">
            Aguardando análise ({pendentes.length})
          </span>
          {pendentes.map(emp => {
            const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;
            return (
              <div key={emp.id} className="neu-flat rounded-2xl p-4 border border-amber-500/40 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={`text-xs font-bold ${cor.accent}`}>{emp.filial}</span>
                    <div className="text-xl font-black text-gray-100 tabular-nums">{BRL(emp.valor)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {emp.num_parcelas}x · por {emp.solicitado_por_nome ?? '—'} · {fmtDate(emp.created_at)}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-black bg-amber-500 px-2 py-1 rounded-md shrink-0">
                    <Clock size={11} /> Pendente
                  </span>
                </div>
                <p className="text-xs text-gray-400 italic border-t border-white/5 pt-2">"{emp.justificativa}"</p>
                {podeAprovar(profile) && (
                  <div className="self-end">
                    <NeuButtonAccent onClick={() => setModalEmp(emp)}>Analisar</NeuButtonAccent>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {historico.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-1 mt-2">
            Histórico
          </span>
          {historico.map(emp => {
            const cor = FILIAL_COLOR[emp.filial as Filial] ?? FILIAL_COLOR.SuperMax;
            return (
              <div key={emp.id} className="neu-flat rounded-2xl p-3 border border-white/5 flex items-center gap-3">
                {statusIcon(emp.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${cor.accent}`}>{emp.filial}</span>
                    <span className="text-sm font-bold text-gray-200 tabular-nums">{BRL(emp.valor)}</span>
                    <span className="text-xs text-gray-500">{emp.num_parcelas}x</span>
                    {emp.banco_nome && <span className="text-xs text-gray-500 truncate">{emp.banco_nome}</span>}
                  </div>
                  {emp.justificativa_resposta && (
                    <p className="text-[11px] text-gray-500 mt-0.5 italic truncate">"{emp.justificativa_resposta}"</p>
                  )}
                </div>
                {/* Migr. 572 — o contrato atravessou um reset. Fica para
                    consulta, sem aprovar/negar e fora da conta de capital. */}
                {emp.arquivado_em && (
                  <span
                    title={`Preservado no reset de ${fmtDate(emp.arquivado_em)}. Só consulta.`}
                    className="text-[10px] font-bold text-gray-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full shrink-0"
                  >
                    Turma anterior
                  </span>
                )}
                <span className="text-[10px] text-gray-500">{fmtDate(emp.created_at)}</span>
                {/* A conta aberta, para a Matriz responder a pergunta do aluno
                    com a mesma tela que ele tem. */}
                {emp.status === 'Aprovado' && (
                  <button
                    onClick={() => setModalMemoria(emp)}
                    title="Memória de cálculo"
                    className="action-btn-blue shrink-0"
                  >
                    <Calculator size={12} />
                  </button>
                )}
                {/* Migr. 606 — só o contrato VIVO se corrige: negado não tem
                    contrato, e arquivado é histórico fechado. */}
                {podeEditarEmprestimo(profile) && emp.status === 'Aprovado' && !emp.arquivado_em && (
                  <button
                    onClick={() => setModalEditar(emp)}
                    title="Corrigir empréstimo"
                    className="action-btn-edit shrink-0"
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {podeApagarEmprestimo(profile) && (
                  <button
                    onClick={() => handleApagar(emp)}
                    title="Apagar empréstimo"
                    className="action-btn-delete shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modalMemoria && (
          <EmprestimoMemoria emprestimo={modalMemoria} onClose={() => setModalMemoria(null)} />
        )}
        {modalEmp && (
          <ModalAprovarEmprestimo
            emp={modalEmp} bancos={bancos} taxaPadrao={taxaPadrao}
            onClose={() => setModalEmp(null)}
            onSaved={onReload}
            showToast={showToast}
          />
        )}
        {modalApagar && (
          <ModalApagarEmprestimo
            emp={modalApagar} bancos={bancos}
            onClose={() => setModalApagar(null)}
            onSaved={onReload}
            showToast={showToast}
          />
        )}
        {modalEditar && (
          <ModalEditarEmprestimo
            emp={modalEditar} bancos={bancos}
            onClose={() => setModalEditar(null)}
            onSaved={onReload}
            showToast={showToast}
          />
        )}
        {modalAplicar && (
          <ModalAplicarCapital
            bancos={bancos} taxaPadrao={taxaPadrao}
            onClose={() => setModalAplicar(false)}
            onSaved={onReload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Modal: a Matriz aplica capital numa filial ────────────────────────────
//
// O caminho inverso do empréstimo comum: aqui não houve pedido da filial, a
// holding decidiu aplicar. Chama `conceder_mutuo_capital` (migr. 474), que
// cria o contrato já decidido e delega a Price à mesma `aprovar_emprestimo`.
function ModalAplicarCapital({
  bancos, taxaPadrao, onClose, onSaved, showToast,
}: {
  bancos: Banco[]; taxaPadrao: number;
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [filial, setFilial] = useState<Filial>('SuperMax');
  const [valor, setValor] = useState('');
  const [taxa, setTaxa] = useState(String(taxaPadrao));
  const [parcelas, setParcelas] = useState('12');
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  const valorNum = parseBRL(valor);
  const contasMatriz = bancos.filter(b => b.filial === 'Matriz');
  const contasFilial = bancos.filter(b => bancoDaUnidade(b, filial));
  const saldoOrigem = Number(contasMatriz.find(b => b.id === origemId)?.saldo ?? 0);
  const semSaldo = !!origemId && valorNum > saldoOrigem;

  const mutuo = tabelaPrice(valorNum, parseFloat(taxa) || 0, parseInt(parcelas) || 1);

  const aplicar = async () => {
    if (!supabase) return;
    if (valorNum <= 0) { showToast('Informe o valor a aplicar.', 'error'); return; }
    if (!origemId) { showToast('Selecione a conta da Matriz de onde sai o valor.', 'error'); return; }
    if (!destinoId) { showToast(`Selecione a conta de ${filial} que recebe.`, 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('conceder_mutuo_capital', {
        p_filial: filial,
        p_valor: valorNum,
        p_taxa_juros: parseFloat(taxa) || 0,
        p_num_parcelas: parseInt(parcelas) || 1,
        p_banco_origem_id: origemId,
        p_banco_destino_id: destinoId,
        p_observacao: obs.trim() || null,
      });
      if (error) throw error;
      showToast(`Capital aplicado em ${filial}. As parcelas já estão em Contas a Pagar da unidade.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Aplicar capital numa unidade</h2>
            <span className="text-[11px] text-gray-500">
              Empréstimo com juros, não aporte — o dinheiro volta.
            </span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Unidade *</label>
            <select
              value={filial}
              onChange={e => { setFilial(e.target.value as Filial); setDestinoId(''); }}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            >
              {FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor *</label>
            <input
              type="text" inputMode="numeric" value={valor}
              onChange={e => setValor(formatBRL(e.target.value))}
              placeholder="0,00"
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Taxa de juros (% ao mês)
              </label>
              <input
                type="number" min="0" step="0.001" value={taxa}
                onChange={e => setTaxa(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Nº de parcelas</label>
              <input
                type="number" min="1" max="60" value={parcelas}
                onChange={e => setParcelas(e.target.value)}
                className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sai da conta (Matriz) *</label>
            <SelectBusca
              value={origemId}
              onChange={setOrigemId}
              placeholder="Escolha a conta"
              opcoes={contasMatriz.map(b => opcaoBanco(b, { saldo: true }))}
            />
            {contasMatriz.length === 0 && (
              <span className="text-[10px] text-yellow-400">
                A Matriz não tem caixa/banco ativo. Cadastre um em Caixa / Bancos antes de aplicar.
              </span>
            )}
            {semSaldo && (
              <span className="text-[10px] text-red-400">
                Saldo insuficiente: a conta tem {BRL(saldoOrigem)} e a aplicação é de {BRL(valorNum)}.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Entra na conta * <span className="text-gray-600 normal-case tracking-normal">— conta de {filial}</span>
            </label>
            <SelectBusca
              value={destinoId}
              onChange={setDestinoId}
              placeholder="Escolha a conta"
              opcoes={contasFilial.map(b => opcaoBanco(b, { saldo: false }))}
            />
            {contasFilial.length === 0 && (
              <span className="text-[10px] text-yellow-400">
                {filial} não tem caixa/banco ativo. Cadastre um em Caixa / Bancos antes de aplicar.
              </span>
            )}
          </div>

          {valorNum > 0 && (
            <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Parcela fixa ({parcelas || 1}x)</span>
                <strong className="text-gray-200 tabular-nums">{BRL(mutuo.valorParcela)}</strong>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Total que {filial} devolve</span>
                <strong className="text-gray-200 tabular-nums">{BRL(mutuo.totalPago)}</strong>
              </div>
              <div className="flex justify-between text-xs text-gray-400 border-t border-white/5 pt-1.5">
                <span>Juros — o que a Matriz ganha</span>
                <strong className="text-accent tabular-nums">{BRL(mutuo.totalJuros)}</strong>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Por que está aplicando</label>
            <textarea
              value={obs} onChange={e => setObs(e.target.value)} rows={2}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
              placeholder="Fica no histórico da unidade. Ex.: reforço de estoque para a alta temporada."
            />
          </div>
        </div>

        <p className="text-[10px] text-gray-500 leading-relaxed">
          A unidade não pediu este dinheiro — ela será notificada. A primeira parcela vence
          em 30 dias e aparece em Contas a Pagar dela, com ou sem lucro no mês.
        </p>

        <NeuButtonAccent onClick={aplicar} isLoading={saving} disabled={semSaldo}>
          <Landmark size={15} /> Aplicar capital
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Tab: Distribuição de Lucro ────────────────────────────────────────────
//
// O outro lado da moeda do empréstimo. O aporte não rende juros de propósito —
// é dinheiro de sócio, e o retorno do sócio é o lucro que a operação gerou.
// Sem esta tela o aluno aprendia só metade: que dívida custa, mas não que
// capital cobra.
function TabLucro({
  saldos, distribuicoes, bancos, profile, onReload, showToast,
}: {
  saldos: Record<UnidadeCapital, SaldoFilial | null>;
  distribuicoes: Distribuicao[];
  bancos: Banco[];
  profile: UserProfile | null;
  onReload: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [modalFilial, setModalFilial] = useState<Filial | null>(null);

  // Espelha o teto que a RPC aplica: lucro líquido apurado menos o que já
  // saiu. Calcular aqui é só para a tela não oferecer um botão que o banco vai
  // recusar — a decisão continua sendo do banco.
  const disponivelPor = (f: Filial) => {
    const lucro = saldos[f]?.lucro_liquido ?? 0;
    const ja = distribuicoes
      .filter(d => d.filial === f)
      .reduce((acc, d) => acc + Number(d.valor ?? 0), 0);
    return Math.round((lucro - ja) * 100) / 100;
  };

  const totalDistribuido = distribuicoes.reduce((acc, d) => acc + Number(d.valor ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Aporte não cobra juros: o retorno do sócio é o lucro, e só se distribui o que houve. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardContador label="Retorno do capital" value={BRL(totalDistribuido)} tom="dourado" sub="Total já distribuído" />
        <CardContador label="Distribuições" value={distribuicoes.length} />
        <CardContador label="Disponível a distribuir" value={BRL(FILIAIS.reduce((a, f) => a + Math.max(0, disponivelPor(f)), 0))} tom="verde" />
        <CardContador label="Unidades com lucro" value={FILIAIS.filter(f => disponivelPor(f) > 0).length} tom="azul" sub="de 3" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FILIAIS.map(f => {
          const disponivel = disponivelPor(f);
          const cor = FILIAL_COLOR[f];
          const jaDist = distribuicoes.filter(d => d.filial === f);
          return (
            <div key={f} className="neu-flat rounded-2xl border border-white/5 overflow-hidden flex flex-col">
              <div className={`h-1 ${cor.bar}`} />
              <div className="p-5 flex flex-col gap-3 flex-1">
              <span className={`text-sm font-black uppercase tracking-widest ${cor.accent}`}>{f}</span>
              <div>
                <span className="text-[10px] uppercase tracking-widest text-gray-500 block">
                  Lucro disponível a distribuir
                </span>
                <span className={`text-2xl font-black tabular-nums ${disponivel > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                  {BRL(disponivel)}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                Já distribuído: {BRL(jaDist.reduce((a, d) => a + Number(d.valor ?? 0), 0))}
              </div>
              {podeAprovar(profile) && (
                <div className="mt-auto">
                  <NeuButtonAccent onClick={() => setModalFilial(f)} disabled={disponivel <= 0}>Distribuir lucro</NeuButtonAccent>
                </div>
              )}
              {disponivel <= 0 && (
                <span className="text-[11px] text-gray-500">Sem lucro no período.</span>
              )}
              </div>
            </div>
          );
        })}
      </div>

      {distribuicoes.length > 0 && (
        <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-2">
          <h3 className="text-sm font-bold text-gray-200 mb-1">Histórico</h3>
          {distribuicoes.map(d => (
            <div key={d.id} className="flex items-center gap-3 text-sm border-b border-white/5 last:border-0 py-2">
              <span className={`text-xs font-bold ${(FILIAL_COLOR[d.filial as Filial] ?? FILIAL_COLOR.SuperMax).accent}`}>
                {d.filial}
              </span>
              <span className="font-bold text-gray-200 tabular-nums">{BRL(Number(d.valor))}</span>
              {d.base_lucro !== null && (
                <span className="text-[10px] text-gray-600">de {BRL(Number(d.base_lucro))} disponíveis</span>
              )}
              <span className="flex-1 text-[11px] text-gray-500 truncate italic">
                {d.observacao ?? ''}
              </span>
              <span className="text-[10px] text-gray-500">{fmtDate(d.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {modalFilial && (
          <ModalDistribuirLucro
            filial={modalFilial}
            disponivel={disponivelPor(modalFilial)}
            bancos={bancos}
            onClose={() => setModalFilial(null)}
            onSaved={onReload}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ModalDistribuirLucro({
  filial, disponivel, bancos, onClose, onSaved, showToast,
}: {
  filial: Filial; disponivel: number; bancos: Banco[];
  onClose: () => void; onSaved: () => void;
  showToast: (msg: string, t?: string) => void;
}) {
  const [valor, setValor] = useState('');
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  const valorNum = parseBRL(valor);
  const contasFilial = bancos.filter(b => bancoDaUnidade(b, filial));
  const contasMatriz = bancos.filter(b => b.filial === 'Matriz');
  const saldoOrigem = Number(contasFilial.find(b => b.id === origemId)?.saldo ?? 0);
  // Lucro é resultado; caixa é dinheiro. Dá para ter um e não ter o outro, e a
  // tela precisa dizer qual dos dois está faltando.
  const semCaixa = !!origemId && valorNum > saldoOrigem;
  const acimaDoLucro = valorNum > disponivel;

  const distribuir = async () => {
    if (!supabase) return;
    if (valorNum <= 0) { showToast('Informe o valor a distribuir.', 'error'); return; }
    if (!origemId) { showToast(`Selecione a conta de ${filial} de onde sai o dinheiro.`, 'error'); return; }
    if (!destinoId) { showToast('Selecione a conta da Matriz que recebe.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('distribuir_lucro_filial', {
        p_filial: filial,
        p_valor: valorNum,
        p_banco_origem_id: origemId,
        p_banco_destino_id: destinoId,
        p_observacao: obs.trim() || null,
      });
      if (error) throw error;
      showToast(`Lucro de ${filial} distribuído para a Matriz.`, 'success');
      onSaved(); onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="neu-flat rounded-3xl p-6 w-full max-w-md border border-accent/20 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-100">Distribuir lucro</h2>
            <span className={`text-xs font-bold ${FILIAL_COLOR[filial].accent}`}>{filial}</span>
          </div>
          <button onClick={onClose} className="modal-close-btn"><X size={16} /></button>
        </div>

        <div className="neu-pressed rounded-2xl p-4 flex justify-between items-baseline">
          <span className="text-xs text-gray-500">Disponível a distribuir</span>
          <span className="text-xl font-black text-green-400 tabular-nums">{BRL(disponivel)}</span>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Valor *</label>
            <input
              type="text" inputMode="numeric" value={valor}
              onChange={e => setValor(formatBRL(e.target.value))}
              placeholder="0,00"
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none"
            />
            {acimaDoLucro && (
              <span className="text-[10px] text-red-400">
                Acima do lucro apurado. Distribuir mais que o resultado é devolver capital, não lucro.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Sai da conta ({filial}) *
            </label>
            <SelectBusca
              value={origemId}
              onChange={setOrigemId}
              placeholder="Escolha a conta"
              opcoes={contasFilial.map(b => opcaoBanco(b, { saldo: true }))}
            />
            {semCaixa && (
              <span className="text-[10px] text-red-400">
                A conta tem {BRL(saldoOrigem)}. O lucro existe no resultado, mas o dinheiro não está aqui.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Entra na conta (Matriz) *</label>
            <SelectBusca
              value={destinoId}
              onChange={setDestinoId}
              placeholder="Escolha a conta"
              opcoes={contasMatriz.map(b => opcaoBanco(b, { saldo: false }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Observação</label>
            <textarea
              value={obs} onChange={e => setObs(e.target.value)} rows={2}
              className="neu-pressed rounded-xl px-3 py-2 text-sm text-gray-100 bg-transparent outline-none resize-none"
              placeholder="Ex.: distribuição do resultado do 1º ciclo."
            />
          </div>
        </div>

        <p className="text-[10px] text-gray-500 leading-relaxed">
          Distribuir lucro não é despesa da unidade: o resultado dela continua o mesmo,
          o que muda é o caixa. Para a Matriz é receita — o retorno de ter aportado.
        </p>

        <NeuButtonAccent onClick={distribuir} isLoading={saving} disabled={semCaixa || acimaDoLucro}>
          <CheckCircle size={15} /> Distribuir
        </NeuButtonAccent>
      </motion.div>
    </div>
  );
}

// ── Tab: Prestação de Contas (aplicação do Capital por Filial × Categoria) ─
function TabPrestacaoContas({
  notas, saldos,
}: {
  notas: NotaRecebida[];
  saldos: Record<UnidadeCapital, SaldoFilial | null>;
}) {
  // Agrupa notas por filial × categoria. Só entram capital_origem=true e ativas
  // (o useFetchData já filtra ativo; o filtro capital_origem foi passado no
  // extraFilter da chamada). Reservado defensivo caso o filtro server-side
  // devolva algo fora — .filter aqui protege.
  const matriz = useMemo(() => {
    const map: Record<Filial, Record<CategoriaGasto, { total: number; count: number }>> = {
      SuperMax: {} as any, MaxLook: {} as any, TechMax: {} as any,
    };
    for (const f of FILIAIS) {
      for (const c of CATEGORIAS_GASTO_CAPITAL) {
        map[f][c] = { total: 0, count: 0 };
      }
    }
    for (const n of notas) {
      if (!n.capital_origem || !n.ativo) continue;
      if (!(n.filial in map)) continue;
      const cat = (n.categoria_gasto ?? 'Outro') as CategoriaGasto;
      if (!CATEGORIAS_GASTO_CAPITAL.includes(cat)) continue;
      map[n.filial as Filial][cat].total += Number(n.valor_total ?? 0);
      map[n.filial as Filial][cat].count += 1;
    }
    return map;
  }, [notas]);

  const totaisPorFilial = useMemo(() => {
    const t: Record<Filial, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const f of FILIAIS) {
      t[f] = CATEGORIAS_GASTO_CAPITAL.reduce((acc, c) => acc + (matriz[f][c]?.total ?? 0), 0);
    }
    return t;
  }, [matriz]);

  const totaisPorCategoria = useMemo(() => {
    const t: Record<CategoriaGasto, number> = {} as any;
    for (const c of CATEGORIAS_GASTO_CAPITAL) {
      t[c] = FILIAIS.reduce((acc, f) => acc + (matriz[f][c]?.total ?? 0), 0);
    }
    return t;
  }, [matriz]);

  const totalGeral = FILIAIS.reduce((acc, f) => acc + totaisPorFilial[f], 0);
  const totalCapitalAportado = FILIAIS.reduce((acc, f) => acc + (saldos[f]?.capital_total ?? 0), 0);
  const pctAplicado = totalCapitalAportado > 0 ? (totalGeral / totalCapitalAportado) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Notas marcadas em Compras › Notas Recebidas como "Saiu do Capital Inicial". */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardContador label="Capital aplicado" value={BRL(totalGeral)} tom="dourado"
          sub={`${notas.filter(n => n.capital_origem && n.ativo).length} nota(s) do capital inicial`} />
        <CardContador label="Do capital aportado" value={`${pctAplicado.toFixed(1)}%`} tom="azul" />
        <CardContador label="Capital aportado" value={BRL(totalCapitalAportado)} />
      </div>

      {/* Matriz Filial × Categoria */}
      <div className="neu-flat rounded-2xl p-5 border border-white/5 overflow-x-auto main-scrollbar">
        <table className="tabela w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="pb-4 pt-1 pl-2 font-bold">Filial</th>
              {CATEGORIAS_GASTO_CAPITAL.map(c => (
                <th key={c} className="pb-4 pt-1 px-3 font-bold text-right">{c}</th>
              ))}
              <th className="pb-4 pt-1 px-3 font-bold text-right text-accent">Total</th>
              <th className="pb-4 pt-1 px-3 font-bold text-right">% do Capital</th>
            </tr>
          </thead>
          <tbody>
            {FILIAIS.map(f => {
              const capitalF = saldos[f]?.capital_total ?? 0;
              const totalF = totaisPorFilial[f];
              const pctF = capitalF > 0 ? (totalF / capitalF) * 100 : 0;
              const c = FILIAL_COLOR[f];
              return (
                <tr key={f} className="border-b border-white/5">
                  <td className="py-3 pl-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold ${c.bg} ${c.accent}`}>
                      {f}
                    </span>
                  </td>
                  {CATEGORIAS_GASTO_CAPITAL.map(cat => {
                    const cell = matriz[f][cat];
                    return (
                      <td key={cat} className="py-3 px-3 text-right">
                        <div className="text-xs font-mono text-gray-200">
                          {cell.total > 0 ? BRL(cell.total) : <span className="text-gray-600">—</span>}
                        </div>
                        {cell.count > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{cell.count} NF</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 px-3 text-right">
                    <div className="text-sm font-bold font-mono text-accent">{BRL(totalF)}</div>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className={`text-xs font-mono font-bold ${pctF > 100 ? 'text-red-400' : pctF > 80 ? 'text-amber-400' : 'text-green-400'}`}>
                      {pctF.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">de {BRL(capitalF)}</div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-accent/20 bg-accent/5">
              <td className="py-3 pl-2 text-xs font-black text-accent uppercase tracking-widest">Total</td>
              {CATEGORIAS_GASTO_CAPITAL.map(cat => (
                <td key={cat} className="py-3 px-3 text-right text-xs font-mono font-bold text-gray-100">
                  {totaisPorCategoria[cat] > 0 ? BRL(totaisPorCategoria[cat]) : <span className="text-gray-600">—</span>}
                </td>
              ))}
              <td className="py-3 px-3 text-right text-sm font-black font-mono text-accent">{BRL(totalGeral)}</td>
              <td className="py-3 px-3 text-right text-xs font-mono font-bold text-gray-300">{pctAplicado.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Lista detalhada */}
      <div className="neu-flat rounded-2xl p-5 border border-white/5">
        <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
          <Landmark size={14} className="text-accent" />
          Últimas notas aplicadas ao Capital
        </h3>
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-3 pl-2 font-bold">Data</th>
                <th className="pb-3 px-3 font-bold">Filial</th>
                <th className="pb-3 px-3 font-bold">Categoria</th>
                <th className="pb-3 px-3 font-bold">NF · Descrição</th>
                <th className="pb-3 px-3 font-bold text-center">Doc</th>
                <th className="pb-3 px-3 font-bold text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {notas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-500">
                    Nenhuma nota marcada como aplicação do Capital ainda.
                  </td>
                </tr>
              ) : (
                notas.slice(0, 30).map(n => {
                  const c = n.filial in FILIAL_COLOR ? FILIAL_COLOR[n.filial as Filial] : FILIAL_COLOR.SuperMax;
                  return (
                    <tr key={n.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pl-2 text-[10px] font-mono text-gray-400">
                        {n.data_emissao ?? fmtDate(n.created_at)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${c.bg} ${c.accent}`}>
                          {n.filial}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-bold">
                          {n.categoria_gasto ?? 'Outro'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        <div className="font-semibold text-gray-200">{n.numero_nf}</div>
                        {n.descricao && (
                          <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{n.descricao}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {n.anexo_url ? (
                          <a href={n.anexo_url} target="_blank" rel="noopener noreferrer"
                            title={n.anexo_nome ?? 'Ver documento'}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                            Ver
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-600">sem doc</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono text-gray-200 text-right">
                        {BRL(Number(n.valor_total ?? 0))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Faturamento (notas_emitidas por filial × tipo) ────────────────────
function TabFaturamento({ notas }: { notas: NotaEmitidaMatriz[] }) {
  // Filtro de período (default: últimos 30 dias).
  const hoje = new Date();
  const dias30 = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [dtIni, setDtIni] = useState(dias30.toISOString().slice(0, 10));
  const [dtFim, setDtFim] = useState(hoje.toISOString().slice(0, 10));

  const filtradas = useMemo(() => {
    return notas.filter(n => {
      if (!n.ativo) return false;
      if (n.data_emissao < dtIni) return false;
      if (n.data_emissao > dtFim) return false;
      return true;
    });
  }, [notas, dtIni, dtFim]);

  const matriz = useMemo(() => {
    const map: Record<Filial, Record<typeof TIPOS_EMITIDAS[number], { total: number; count: number }>> = {
      SuperMax: {} as any, MaxLook: {} as any, TechMax: {} as any,
    };
    for (const f of FILIAIS) {
      for (const t of TIPOS_EMITIDAS) map[f][t] = { total: 0, count: 0 };
    }
    for (const n of filtradas) {
      if (!(n.filial in map)) continue;
      if (!TIPOS_EMITIDAS.includes(n.tipo)) continue;
      map[n.filial as Filial][n.tipo].total += Number(n.valor_total ?? 0);
      map[n.filial as Filial][n.tipo].count += 1;
    }
    return map;
  }, [filtradas]);

  const totaisFilial: Record<Filial, number> = FILIAIS.reduce((acc, f) => {
    acc[f] = TIPOS_EMITIDAS.reduce((s, t) => s + matriz[f][t].total, 0);
    return acc;
  }, {} as Record<Filial, number>);

  const totaisTipo: Record<typeof TIPOS_EMITIDAS[number], number> = TIPOS_EMITIDAS.reduce((acc, t) => {
    acc[t] = FILIAIS.reduce((s, f) => s + matriz[f][t].total, 0);
    return acc;
  }, {} as any);

  const totalGeral = FILIAIS.reduce((s, f) => s + totaisFilial[f], 0);
  const totalNotas = filtradas.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header + filtros */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-4 items-stretch">
          <CardContador label="Faturamento no período" value={BRL(totalGeral)} tom="dourado" />
          <CardContador label="Notas emitidas" value={totalNotas} tom="azul" />
          <div className="neu-flat rounded-2xl border border-white/5 px-4 py-3 flex gap-3 items-end">
            <FormField label="De">
              <input type="date" className="neu-input py-1.5 px-3 rounded-xl text-xs"
                value={dtIni} onChange={e => setDtIni(e.target.value)} />
            </FormField>
            <FormField label="Até">
              <input type="date" className="neu-input py-1.5 px-3 rounded-xl text-xs"
                value={dtFim} onChange={e => setDtFim(e.target.value)} />
            </FormField>
          </div>
      </div>

      {/* Matriz Filial × Tipo */}
      <div className="neu-flat rounded-2xl p-5 border border-white/5 overflow-x-auto main-scrollbar">
        <table className="tabela w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
              <th className="pb-4 pt-1 pl-2 font-bold">Filial</th>
              {TIPOS_EMITIDAS.map(t => (
                <th key={t} className="pb-4 pt-1 px-3 font-bold text-right">{t}</th>
              ))}
              <th className="pb-4 pt-1 px-3 font-bold text-right text-accent">Total</th>
            </tr>
          </thead>
          <tbody>
            {FILIAIS.map(f => {
              const c = FILIAL_COLOR[f];
              return (
                <tr key={f} className="border-b border-white/5">
                  <td className="py-3 pl-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold ${c.bg} ${c.accent}`}>
                      {f}
                    </span>
                  </td>
                  {TIPOS_EMITIDAS.map(t => {
                    const cell = matriz[f][t];
                    return (
                      <td key={t} className="py-3 px-3 text-right">
                        <div className="text-xs font-mono text-gray-200">
                          {cell.total > 0 ? BRL(cell.total) : <span className="text-gray-600">—</span>}
                        </div>
                        {cell.count > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{cell.count} nota{cell.count !== 1 && 's'}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 px-3 text-right">
                    <div className="text-sm font-bold font-mono text-accent">{BRL(totaisFilial[f])}</div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-accent/20 bg-accent/5">
              <td className="py-3 pl-2 text-xs font-black text-accent uppercase tracking-widest">Total</td>
              {TIPOS_EMITIDAS.map(t => (
                <td key={t} className="py-3 px-3 text-right text-xs font-mono font-bold text-gray-100">
                  {totaisTipo[t] > 0 ? BRL(totaisTipo[t]) : <span className="text-gray-600">—</span>}
                </td>
              ))}
              <td className="py-3 px-3 text-right text-sm font-black font-mono text-accent">{BRL(totalGeral)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Últimas notas emitidas */}
      <div className="neu-flat rounded-2xl p-5 border border-white/5">
        <h3 className="text-sm font-bold text-gray-200 mb-4 flex items-center gap-2">
          <BarChart3 size={14} className="text-accent" /> Últimas notas emitidas no período
        </h3>
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-3 pl-2 font-bold">Data</th>
                <th className="pb-3 px-3 font-bold">Filial</th>
                <th className="pb-3 px-3 font-bold">Nº</th>
                <th className="pb-3 px-3 font-bold">Tipo</th>
                <th className="pb-3 px-3 font-bold">Cliente / Descrição</th>
                <th className="pb-3 px-3 font-bold text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-500">
                    Nenhuma nota emitida no período.
                  </td>
                </tr>
              ) : (
                filtradas.slice(0, 30).map(n => {
                  const c = n.filial in FILIAL_COLOR ? FILIAL_COLOR[n.filial as Filial] : FILIAL_COLOR.SuperMax;
                  return (
                    <tr key={n.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2.5 pl-2 text-[10px] font-mono text-gray-400">{n.data_emissao}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${c.bg} ${c.accent}`}>
                          {n.filial}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[10px] font-mono text-gray-300">
                        {String(n.numero).padStart(6, '0')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-bold">
                          {n.tipo}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        <div className="font-semibold text-gray-200">{n.cliente_nome ?? 'Consumidor'}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{n.descricao}</div>
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono text-gray-200 text-right">{BRL(Number(n.valor_total ?? 0))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── View principal ─────────────────────────────────────────────────────────
// ── Tab: Aplicações (migr. 604) ───────────────────────────────────────────
// A holding aplica o capital próprio do mesmo jeito que a loja aplica o caixa,
// então a tela é o painel compartilhado com um seletor de unidade por cima.
//
// O botão de fechar o mês vive AQUI e em lugar nenhum: é o relógio da turma,
// vale para as 4 unidades de uma vez, e quem clica é o professor. A RPC cobra
// `role='admin'` literal — o botão só esconde o que o banco já recusa.
function TabAplicacoes({
  profile, showToast, onMovimentou,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
  onMovimentou: () => void;
}) {
  const [unidade, setUnidade] = useState<UnidadeCapital>('Matriz');
  const [fechando, setFechando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const confirm = useConfirm();

  const ehProfessor = profile?.role === 'admin';

  const fecharMes = async () => {
    if (!supabase) return;
    const ok = await confirm({
      message: 'Fechar o mês capitaliza o rendimento de TODAS as aplicações das 4 unidades, de uma vez. É o relógio da turma e não tem desfazer. Confirma?',
    });
    if (!ok) return;
    setFechando(true);
    try {
      const { data, error } = await supabase.rpc('fechar_mes_aplicacoes');
      if (error) throw error;
      const qtd = (data as any)?.aplicacoes ?? 0;
      const total = Number((data as any)?.rendimento ?? 0);
      showToast(
        qtd === 0
          ? 'Mês fechado — nenhuma unidade tem aplicação viva.'
          : `Mês fechado: ${qtd} aplicação(ões) renderam ${BRL(total)}.`,
        'success',
      );
      setRecarga(n => n + 1);
      onMovimentou();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao fechar o mês.', 'error');
    } finally { setFechando(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      {ehProfessor && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">Aplicação só rende quando o mês fecha: um clique fecha o mês de todas as unidades.</p>
          <NeuButtonAccent onClick={fecharMes} isLoading={fechando}>
            <CalendarClock size={14} /> Fechar mês
          </NeuButtonAccent>
        </div>
      )}

      <div className="flex gap-1 p-1 neu-pressed rounded-xl border border-white/5 self-start" role="tablist">
        {UNIDADES.map(u => (
          <button
            key={u} onClick={() => setUnidade(u)} role="tab" aria-selected={unidade === u}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              unidade === u ? 'bg-accent text-[var(--color-accent-text)]' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {u}
          </button>
        ))}
      </div>

      <AplicacoesPanel
        key={`${unidade}-${recarga}`}
        filial={unidade} profile={profile} showToast={showToast}
        onMovimentou={onMovimentou}
      />
    </div>
  );
}

// ── Editor da praça: os bancos onde se aplica (migr. 604) ─────────────────
// Cadastro curto e fechado (5 linhas na semente), então não virou view nova:
// mora dentro de Config, que é onde a direção já define reserva e juros.
function EditorBancosInvestimento({
  profile, showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const { data: bancosRaw = [], reload } =
    useFetchData<BancoInvestimento>('bancos_investimento', undefined, false);
  // Mesma razão do painel: a semente grava os 5 no mesmo instante, então
  // created_at não ordena nada. `ordem` é quem manda.
  const bancos = useMemo(
    () => [...bancosRaw].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
    [bancosRaw],
  );
  const [salvando, setSalvando] = useState<string | null>(null);
  const podeEditar = podeConfigurar(profile);

  const salvar = async (b: BancoInvestimento, campos: Partial<BancoInvestimento>) => {
    if (!supabase) return;
    setSalvando(b.id);
    try {
      const { error } = await supabase
        .from('bancos_investimento')
        .update({ ...campos, atualizado_por: profile?.id ?? null, updated_at: new Date().toISOString() })
        .eq('id', b.id);
      if (error) throw error;
      showToast(`${b.nome} atualizado.`, 'success');
      reload();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error');
    } finally { setSalvando(null); }
  };

  // Texto, não type=number: o teclado pt-BR digita "0,86" e o number recusava a vírgula.
  const numero = (v: string) => parseFloat(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
  const campo = 'w-24 mx-auto neu-input rounded-lg px-2 py-1.5 text-sm text-center tabular-nums disabled:opacity-60';

  return (
    <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
          <PiggyBank size={15} className="text-accent" /> Praça financeira
        </h3>
        <span className="text-[11px] text-gray-500">Onde as unidades aplicam · salva ao sair do campo</span>
      </div>

      {bancos.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhum banco cadastrado — a semente da migração 604 não foi aplicada nesta turma.</p>
      ) : (
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left min-w-[560px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest">
                <th className="py-2.5 px-3 font-bold">Banco</th>
                <th className="py-2.5 px-3 font-bold text-center">Taxa (% a.m.)</th>
                <th className="py-2.5 px-3 font-bold text-center">Carência (meses)</th>
                <th className="py-2.5 px-3 font-bold text-center">IR</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {bancos.map(b => (
                <tr key={b.id}>
                  <td className="py-2.5 px-3">
                    <p className="font-semibold text-gray-100">{b.nome}</p>
                    <p className="text-[11px] text-gray-500">{b.produto}{b.pct_cdi != null && ` · ${Number(b.pct_cdi).toFixed(0)}% do CDI`}</p>
                  </td>
                  <td className="py-2.5 px-3">
                    <input type="text" inputMode="decimal" className={campo}
                      defaultValue={Number(b.taxa_mensal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      disabled={!podeEditar || salvando === b.id}
                      onBlur={e => {
                        const v = numero(e.target.value);
                        if (!isNaN(v) && v >= 0 && v !== Number(b.taxa_mensal)) salvar(b, { taxa_mensal: v });
                      }} />
                  </td>
                  <td className="py-2.5 px-3">
                    <input type="text" inputMode="numeric" className={campo}
                      defaultValue={b.carencia_meses}
                      disabled={!podeEditar || salvando === b.id}
                      onBlur={e => {
                        const v = parseInt(e.target.value.replace(/\D/g, ''));
                        if (!isNaN(v) && v !== b.carencia_meses) salvar(b, { carencia_meses: v });
                      }} />
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                      b.isento_ir ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300'}`}>
                      {b.isento_ir ? 'Isento' : 'Tributado'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Tab = 'geral' | 'dre' | 'prestacao' | 'faturamento' | 'emprestimos' | 'lucro' | 'aplicacoes' | 'config';

type NotaEmitidaMatriz = {
  id: string;
  filial: string;
  tipo: 'NF Produto' | 'NFS-e Serviço' | 'Recibo Simples';
  origem: 'pdv' | 'servico_manual' | 'avulso';
  valor_total: number;
  data_emissao: string;
  descricao: string;
  cliente_nome: string | null;
  ativo: boolean;
  numero: number;
  serie: string;
};

const TIPOS_EMITIDAS = ['NF Produto', 'NFS-e Serviço', 'Recibo Simples'] as const;

// Categorias de gasto que a filial reporta em notas_recebidas quando o
// pagamento sai do Capital Inicial. Fonte: mig. 220 (chk_notas_recebidas_categoria).
const CATEGORIAS_GASTO_CAPITAL = ['Produto', 'Equipamento', 'Mobiliário', 'Aluguel', 'Serviço', 'Outro'] as const;
type CategoriaGasto = typeof CATEGORIAS_GASTO_CAPITAL[number];

type NotaRecebida = {
  id: string;
  filial: string;
  numero_nf: string;
  categoria_gasto: CategoriaGasto | null;
  descricao: string | null;
  valor_total: number | null;
  data_emissao: string | null;
  capital_origem: boolean;
  anexo_url: string | null;
  anexo_nome: string | null;
  anexo_tamanho: number | null;
  criado_por: string | null;
  created_at: string;
  ativo: boolean;
};

export function MatrizCapitalView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('geral');
  const [modalFilial, setModalFilial] = useState<UnidadeCapital | null>(null);
  const [estornoAlvo, setEstornoAlvo] = useState<CapitalRow | null>(null);
  const [modalConfig, setModalConfig] = useState(false);
  const [saldos, setSaldos] = useState<Record<UnidadeCapital, SaldoFilial | null>>({
    SuperMax: null, MaxLook: null, TechMax: null, Matriz: null,
  });
  const confirm = useConfirm();

  const { data: registros = [], isLoading, reload } = useFetchData<CapitalRow>('capital_filial', undefined, false);
  const { data: emprestimos = [], reload: reloadEmp } = useFetchData<Emprestimo>('emprestimos_filial', undefined, false);
  // `reloadConfigs` existe desde 21/09: salvar período novo chamava o `reload`
  // de `capital_filial` (a lista de aportes) e nunca recarregava esta lista, e
  // a tela seguia mostrando a configuração anterior até um F5 — inclusive o
  // período, a reserva e o teto de parcelas.
  const { data: configs = [], reload: reloadConfigs } =
    useFetchData<CapitalConfig>('capital_config', undefined, false);
  // `reload` importa desde a migr. 326: aporte e empréstimo mexem no saldo das
  // contas, e o select de origem mostra esse saldo. Sem recarregar, o segundo
  // aporte da sessão seria decidido olhando o saldo de antes do primeiro.
  const { data: bancos = [], reload: reloadBancos } = useFetchData<Banco>('caixa_bancos', { status: 'Ativo' }, false);
  const { data: notasRecebidas = [] } = useFetchData<NotaRecebida>('/api/notasrecebidasview', { capital_origem: true }, false);
  const { data: notasEmitidas = [] } = useFetchData<NotaEmitidaMatriz>('/api/notasemitidasview', undefined, false);
  const { data: distribuicoes = [], reload: reloadDist } = useFetchData<Distribuicao>('distribuicoes_lucro', undefined, false);

  const configAtiva = configs[0] ?? null;
  const taxaPadrao = configAtiva?.taxa_juros_padrao ?? 0;

  const porFilial = useMemo(() => {
    const map: Record<UnidadeCapital, CapitalRow[]> = { SuperMax: [], MaxLook: [], TechMax: [], Matriz: [] };
    for (const r of registros) {
      if (r.filial in map) map[r.filial as UnidadeCapital].push(r);
    }
    return map;
  }, [registros]);

  const carregarSaldos = useCallback(async () => {
    if (!supabase) return;
    const results: Record<UnidadeCapital, SaldoFilial | null> = { SuperMax: null, MaxLook: null, TechMax: null, Matriz: null };
    await Promise.all(UNIDADES.map(async f => {
      const { data, error } = await supabase.rpc('calcular_saldo_capital', { p_filial: f });
      if (!error && data?.[0]) results[f] = data[0];
    }));
    setSaldos(results);
  }, []);

  useEffect(() => { carregarSaldos(); }, [carregarSaldos, registros, emprestimos, distribuicoes]);

  const totalCapital = FILIAIS.reduce((acc, f) => acc + (saldos[f]?.capital_total ?? 0), 0);
  const totalSaldo = FILIAIS.reduce((acc, f) => acc + (saldos[f]?.saldo_livre ?? 0), 0);
  const pendentesCount = emprestimos.filter(e => e.status === 'Pendente').length;
  const bloqueadasCount = FILIAIS.filter(f => saldos[f]?.bloqueado).length;
  const ranking = [...FILIAIS].sort((a, b) => (saldos[b]?.saldo_livre ?? 0) - (saldos[a]?.saldo_livre ?? 0));

  // Aporte antigo (anterior à migr. 326) não tem conta nenhuma: nunca moveu
  // dinheiro, então apagar a linha basta. Do 326 em diante o aporte é uma
  // transferência, e desfazer exige a RPC de estorno — daí o modal.
  const handleExcluir = async (r: CapitalRow) => {
    if (r.banco_origem_id || r.banco_destino_id) { setEstornoAlvo(r); return; }
    const ok = await confirm({
      message: `Excluir este registro de capital de ${r.filial}? Esta ação não pode ser desfeita.`,
      danger: true,
    });
    if (!ok || !supabase) return;
    const { error } = await supabase.from('capital_filial').delete().eq('id', r.id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Registro excluído.', 'success');
    reload();
  };

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'geral', label: 'Visão Geral' },
    { id: 'dre', label: 'DRE' },
    { id: 'prestacao', label: 'Prestação de contas' },
    { id: 'faturamento', label: 'Faturamento' },
    { id: 'emprestimos', label: 'Empréstimos', badge: pendentesCount > 0 ? pendentesCount : undefined },
    { id: 'lucro', label: 'Distribuição de lucro' },
    { id: 'aplicacoes', label: 'Aplicações' },
    { id: 'config', label: 'Configurações' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6 pb-16"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <Landmark size={26} /> Capital
        </h2>
        {configAtiva && (
          <span className="text-xs text-gray-400 px-3 py-1.5 rounded-lg bg-white/5">
            Período {dataSimplesBR(configAtiva.data_inicio)}
            {configAtiva.data_fim ? ` a ${dataSimplesBR(configAtiva.data_fim)}` : ', sem prazo'}
            {configAtiva.reserva_min_pct > 0 && ` · reserva ${configAtiva.reserva_min_pct}%`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardContador label="Capital consolidado" value={BRL(totalCapital)} tom="dourado" sub="3 unidades operacionais" />
        <CardContador label="Saldo livre total" value={BRL(totalSaldo)} tom={totalSaldo < 0 ? 'vermelho' : 'verde'} />
        <CardContador label="Empréstimos pendentes" value={pendentesCount} tom="amarelo"
          onClick={pendentesCount > 0 ? () => setTab('emprestimos') : undefined} />
        <CardContador label="Unidades bloqueadas" value={bloqueadasCount} tom="vermelho"
          sub={bloqueadasCount > 0 ? 'Capital estourado' : 'Nenhuma'} />
      </div>

      <PeriodoCapitalAviso
        dataInicio={configAtiva?.data_inicio}
        dataFim={configAtiva?.data_fim}
        podeConfigurar={podeConfigurar(profile)}
      />

      {/* Abas numa linha só; rolam de lado em tela estreita em vez de quebrar o rótulo. */}
      <div className="flex gap-1 p-1 neu-pressed rounded-xl border border-white/5 overflow-x-auto main-scrollbar-h self-start max-w-full" role="tablist">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              tab === t.id ? 'bg-accent text-[var(--color-accent-text)]' : 'text-gray-400 hover:text-gray-200'}`}>
            {t.label}
            {t.badge && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Conteúdo das tabs */}
      {tab === 'geral' && (
        isLoading ? <LoadingSpinner /> : (
        <div className="flex flex-col gap-4">
          {/* Operações em ordem de saúde (saldo livre); a holding vem à parte,
              porque somá-la ao consolidado contaria o rateio duas vezes. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
            {ranking.map((f, i) => (
              <FilialCapitalCard
                key={f} filial={f} registros={porFilial[f]} posicao={i + 1}
                saldo={saldos[f]} profile={profile}
                onNovo={setModalFilial} onExcluir={handleExcluir}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Holding</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>
          <FilialCapitalCard
            filial="Matriz" registros={porFilial.Matriz}
            saldo={saldos.Matriz} profile={profile}
            onNovo={setModalFilial} onExcluir={handleExcluir}
          />
        </div>
        )
      )}

      {tab === 'dre' && <TabDRE saldos={saldos} semConfig={!configAtiva} />}

      {tab === 'prestacao' && <TabPrestacaoContas notas={notasRecebidas} saldos={saldos} />}

      {tab === 'faturamento' && <TabFaturamento notas={notasEmitidas} />}

      {tab === 'emprestimos' && (
        <TabEmprestimos
          emprestimos={emprestimos} bancos={bancos} taxaPadrao={taxaPadrao}
          profile={profile}
          onReload={() => { reloadEmp(); carregarSaldos(); reloadBancos(); }}
          showToast={showToast}
        />
      )}

      {tab === 'lucro' && (
        <TabLucro
          saldos={saldos} distribuicoes={distribuicoes} bancos={bancos} profile={profile}
          onReload={() => { reloadDist(); carregarSaldos(); reloadBancos(); }}
          showToast={showToast}
        />
      )}

      {tab === 'aplicacoes' && (
        <TabAplicacoes
          profile={profile} showToast={showToast}
          onMovimentou={() => { carregarSaldos(); reloadBancos(); }}
        />
      )}

      {tab === 'config' && (
        <div className="flex flex-col gap-5">
          <section className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                <Settings size={15} className="text-accent" /> Período ativo
              </h3>
              {podeConfigurar(profile) && (
                <NeuButtonAccent onClick={() => setModalConfig(true)}>
                  <Plus size={14} /> Novo período
                </NeuButtonAccent>
              )}
            </div>
            {configAtiva ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { rotulo: 'Início', valor: dataSimplesBR(configAtiva.data_inicio) },
                  { rotulo: 'Fim', valor: configAtiva.data_fim ? dataSimplesBR(configAtiva.data_fim) : 'Sem prazo' },
                  { rotulo: 'Reserva mínima', valor: `${configAtiva.reserva_min_pct}%` },
                  { rotulo: 'Juros padrão', valor: `${qtdBR(configAtiva.taxa_juros_padrao)}% a.m.` },
                  { rotulo: 'Parcelamento máximo', valor: `${configAtiva.max_parcelas ?? 12}x` },
                ].map(c => (
                  <div key={c.rotulo} className="rounded-xl bg-white/[0.04] border border-white/5 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{c.rotulo}</p>
                    <p className="text-lg font-black text-gray-100 tabular-nums mt-0.5">{c.valor}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-amber-300">Nenhum período definido: o saldo usa todos os aportes, sem janela.</p>
            )}
          </section>

          <EditorBancosInvestimento profile={profile} showToast={showToast} />
        </div>
      )}

      <AnimatePresence>
        {modalFilial && (
          <ModalCapital
            filial={modalFilial} bancos={bancos} profile={profile}
            onClose={() => setModalFilial(null)}
            onSaved={() => { reload(); carregarSaldos(); reloadBancos(); }}
            showToast={showToast}
          />
        )}
        {estornoAlvo && (
          <ModalEstornoAporte
            registro={estornoAlvo} bancos={bancos}
            onClose={() => setEstornoAlvo(null)}
            onSaved={() => { reload(); carregarSaldos(); reloadBancos(); }}
            showToast={showToast}
          />
        )}
        {modalConfig && (
          <ModalConfig
            config={configAtiva} profile={profile}
            onClose={() => setModalConfig(false)}
            // Período novo muda a janela de TODO o cálculo: recarrega a
            // configuração, os aportes e os saldos das 4 unidades.
            onSaved={() => { reloadConfigs(); reload(); carregarSaldos(); }}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
