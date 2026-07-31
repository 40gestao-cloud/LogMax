import React, { useState, useRef } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, CheckCircle, Clock, DollarSign, X, Edit2, Trash2, Lock, Calculator, Wallet, ArrowDownLeft, ArrowUpRight, RefreshCw, FileText } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbInsert, dbUpdate, dbDelete, dbSetStatus } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { supabase } from '../lib/supabase';
import { hasSetor } from '../lib/rbac';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { PONTO_HORARIOS } from '../lib/pontoHorarios';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';
import type { FolhaPagamento, Funcionario } from '../types/domain';

type RecalcBreakdown = {
  valor_hora: number;
  /** Jornada da turma, derivada de saída − entrada (migr. 290). */
  jornada_diaria: number;
  horas_mes: number;
  horas_atraso: number;
  horas_falta: number;
  /**
   * Horas de ausência que a Matriz perdoou (migr. 292). Ficam FORA de
   * horas_falta e de descontos — só aparecem para mostrar quanto a aprovação
   * poupou. Justificado sem afastamento aprovado entra em horas_falta.
   */
  horas_perdoadas: number;
  horas_extras: number;
  descontos: number;
  bonus_extra: number;
  salario_base: number;
  salario_bruto: number;
  salario_liquido: number;
  /**
   * Encargos (migr. 319). A folha era `bruto − faltas`, sem INSS, IRRF nem
   * FGTS — menos realista que a própria rescisão. Opcionais no tipo porque a
   * RPC antiga não devolvia estes campos: enquanto a migration não roda na
   * turma, a tela some com as linhas em vez de mostrar NaN.
   */
  desconto_faltas?: number;
  base_inss?: number;
  desconto_inss?: number;
  desconto_irrf?: number;
  /** Depósito do empregador: fora do líquido, base do FGTS real na fase 3. */
  fgts_deposito?: number;
  dependentes?: number;
  competencia?: string;
  vigencia_tabela?: string;
};

/** Linha do holerite (migr. 320). `informativa` não entra em nenhum total. */
type Rubrica = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: 'provento' | 'desconto' | 'informativa';
  referencia: string | null;
  valor: number;
  ordem: number;
};

const statusCls = (s: string) =>
  s === 'Paga' ? 'text-green-400' : s === 'Processada' ? 'text-blue-400' : 'text-yellow-400';

// Segregação de funções (migr. 282): o RH fecha a folha, o Financeiro paga.
//
// Esta tela vai até 'Processada' — e para. O pagamento acontece em Contas a
// Pagar, na conta que o `processar_folha` acabou de gerar: o trigger
// `conta_pagar_avancar_folha_e_creditar` leva a folha a 'Paga' e credita o
// MaxBank na mesma transação. Ter os dois botões era duas respostas para
// "quem paga a folha?", que é a forma da aprovação redundante já cortada em
// Compras. `pagar_folha` continua existindo como via de exceção — o botão ↺
// da linha, para quando o crédito no MaxBank falhou e alguém precisa destravar.
const statusNext = (s: string): string | null =>
  s === 'Pendente' ? 'Processada' : null;

const statusNextLabel = (s: string): string | null =>
  s === 'Pendente' ? 'Processar' : null;

const statusNextTitle = (s: string): string =>
  s === 'Pendente'
    ? 'Clique para processar a folha (gera Conta a Pagar do líquido).'
    : s === 'Processada'
    ? 'Aguardando o Financeiro pagar em Contas a Pagar — ali a folha vira Paga e o MaxBank é creditado.'
    : 'Folha já paga.';

const EMPTY: any = { funcionario_id: '', mes_ref: '', salario_base: '', descontos: '', valor_beneficios: '', status: 'Pendente' };

const FolhaPagamentoViewInner = ({ showToast, profile, filial }: { showToast: any; profile: UserProfile; filial: FilialOp }) => {
  const { data: folhas, setData, isLoading: loadingF } = useFetchData<FolhaPagamento>('/api/folhapagamentoview', { filial });
  const { data: funcionarios, isLoading: loadingFn } = useFetchData<Funcionario>('/api/funcionariosview', { filial });

  const hoje = todayBR().slice(0, 7);
  const [mesFiltro, setMesFiltro] = useState(hoje);
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [recalcBreakdown, setRecalcBreakdown] = useState<{ folhaNome: string; data: RecalcBreakdown } | null>(null);
  // Holerite montado a partir de `folha_rubricas` (migr. 320). As rubricas são
  // a fonte: os totais de `folha_pagamento` são derivados delas no recálculo.
  const [holeriteLoading, setHoleriteLoading] = useState<string | null>(null);
  const [holerite, setHolerite] = useState<{ titulo: string; folha: any; rubricas: Rubrica[] } | null>(null);
  const [recalcLoading, setRecalcLoading] = useState<string | null>(null);
  const [recreditandoId, setRecreditandoId] = useState<string | null>(null);
  const confirm = useConfirm();

  // Quem destrava um crédito que falhou (botão ↺). O pagamento normal não
  // acontece aqui — acontece em Contas a Pagar. Mesma régua do `pagar_folha`
  // no banco (migr. 282): financeiro, gerente ou Matriz.
  const podeDestravarCredito = hasSetor(profile, 'financeiro')
    || profile.role === 'gerente' || profile.role === 'admin' || profile.role === 'ceo';

  // Modal admin: carteira MaxBank do colaborador (saldos + extrato + excluir).
  // Aberto a partir de cada linha de folha — admin/CEO/RH usa pra limpar
  // créditos de teste sem precisar abrir o app MaxBank.
  const [carteiraModal, setCarteiraModal] = useState<{
    funcionarioNome: string;
    contaId: string;
    saldos: { salario: number; beneficios: number; bonificacoes: number };
    transacoes: any[];
  } | null>(null);
  const [carteiraLoading, setCarteiraLoading] = useState<boolean>(false);
  const [excluindoTxId, setExcluindoTxId] = useState<string | null>(null);

  if (loadingF || loadingFn) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const folhasFiltradas = folhas.filter(f => f.mes_ref === mesFiltro);
  const enriched = folhasFiltradas.map(f => ({
    ...f,
    func: funcionarios.find(fn => fn.id === f.funcionario_id),
  }));

  const totalBruto = folhasFiltradas.reduce((acc, f) => acc + Number(f.salario_bruto || 0), 0);
  const totalDesc = folhasFiltradas.reduce((acc, f) => acc + Number(f.descontos || 0), 0);
  const totalLiq = folhasFiltradas.reduce((acc, f) => acc + Number(f.salario_liquido || 0), 0);
  const pendentes = folhasFiltradas.filter(f => f.status === 'Pendente').length;
  const funcsAtivos = funcionarios.filter(fn => fn.status === 'Ativo').length;
  const funcsComFolha = new Set(folhasFiltradas.map(f => f.funcionario_id)).size;

  const parseCreditError = (msg: string): string => {
    if (msg.includes('sem conta de colaborador') || msg.includes('user_profile_id')) {
      return 'Funcionário sem vínculo no MaxBank. Verifique se o e-mail cadastrado em RH é idêntico ao do usuário no sistema.';
    }
    if (msg.includes('líquido inválido') || msg.includes('salario_liquido')) {
      return 'Salário líquido zerado ou inválido. Edite a folha e confira os valores.';
    }
    return msg;
  };

  const handleRecreditar = async (f: any) => {
    if (!supabase) return;
    setRecreditandoId(f.id);
    try {
      // Mesma RPC da transição: credita, avança o status se ainda estiver em
      // Processada e fecha a falha registrada em folha_credito_falhas.
      const { data, error } = await supabase.rpc('pagar_folha', { p_folha_id: f.id });
      const res = data as any;
      if (error) {
        showToast(`Falha ao re-creditar: ${parseCreditError(error.message)}`, 'error');
      } else if (!res?.ok) {
        showToast(`Falha ao re-creditar: ${parseCreditError(res?.erro ?? 'erro desconhecido')}`, 'error');
      } else {
        const benef = Number(res?.valor_beneficios ?? f.valor_beneficios ?? 0);
        setData(prev => prev.map(x => x.id === f.id ? { ...x, status: 'Paga' } : x));
        showToast(
          benef > 0
            ? `Salário e R$ ${benef.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em benefícios creditados no MaxBank.`
            : 'Saldo já estava creditado (nenhuma alteração) ou foi creditado agora com sucesso.',
          'success',
        );
      }
    } catch (err: any) {
      showToast(`Erro ao re-creditar: ${err?.message ?? err}`, 'error');
    } finally {
      setRecreditandoId(null);
    }
  };

  // Benefícios vêm do que a pessoa realmente tem atribuído (migr. 288), não de
  // memória de quem digita. O valor é PROPOSTO, não imposto: o campo segue
  // editável porque o que for gravado na folha é o que credita o MaxBank
  // daquele mês, e mexer no catálogo depois não pode reescrever o passado.
  const carregarBeneficios = async (funcionarioId: string) => {
    if (!supabase || !funcionarioId) return;
    const { data, error } = await supabase.rpc('beneficios_do_funcionario', { p_funcionario_id: funcionarioId });
    if (error) { console.warn('[FolhaPagamento] benefícios:', error.message); return; }
    setForm((p: any) => ({ ...p, valor_beneficios: formatBRL(Number(data ?? 0)) }));
  };

  const handleFuncionarioChange = (funcionarioId: string) => {
    setForm((p: any) => ({ ...p, funcionario_id: funcionarioId }));
    // Só propõe na criação. Em edição o valor já foi decidido para aquele mês.
    if (!editId && funcionarioId) carregarBeneficios(funcionarioId);
  };

  const handleSave = async () => {
    if (!form.funcionario_id || !form.mes_ref) { showToast('Funcionário e mês são obrigatórios.', 'error'); return; }
    if (!editId) {
      const dup = folhas.some(x => x.funcionario_id === form.funcionario_id && x.mes_ref === form.mes_ref);
      if (dup) { showToast('Já existe folha para este funcionário neste mês. Edite o registro existente.', 'error'); return; }
    }
    const base = parseBRL(form.salario_base);
    const desc = parseBRL(form.descontos);
    const benef = parseBRL(form.valor_beneficios);
    // salario_bruto inicial = base; recalc do ponto pode aumentar via hora extra.
    // valor_beneficios é separado — não entra em descontos nem no líquido.
    const payload = { ...form, salario_base: base, salario_bruto: base, descontos: desc, valor_beneficios: benef, salario_liquido: base - desc, filial };
    setSaving(true);
    try {
      if (editId) {
        const updated = await dbUpdate('/api/folhapagamentoview', editId, payload);
        setData(prev => prev.map(f => f.id === editId ? { ...f, ...(updated ?? payload) } : f));
        showToast('Folha atualizada.', 'success');
      } else {
        const rec = await dbInsert('/api/folhapagamentoview', payload);
          setData(prev => [rec as FolhaPagamento, ...prev]);
        showToast('Folha registrada.', 'success');
      }
      setForm(EMPTY);
      setShowForm(false);
      setEditId(null);
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[FolhaPagamento] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error');
    }
    setSaving(false);
  };

  const openEdit = (f: any) => {
    setEditId(f.id);
    const base = f.salario_base ?? f.salario_bruto;
    setForm({
      funcionario_id:   f.funcionario_id ?? '',
      mes_ref:          f.mes_ref        ?? '',
      salario_base:     base != null ? formatBRL(Number(base)) : '',
      descontos:        f.descontos        != null ? formatBRL(Number(f.descontos))        : '',
      valor_beneficios: f.valor_beneficios != null ? formatBRL(Number(f.valor_beneficios)) : '',
      status:           f.status        ?? 'Pendente',
    });
    setShowForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleDelete = async (folha: any) => {
    const ehPaga = folha.status === 'Paga';
    const ehProcessada = folha.status === 'Processada';
    const aviso = ehPaga
      ? 'Inativar este lançamento de folha?\n\nEla está PAGA — vou estornar o crédito da carteira MaxBank do colaborador (salário e benefícios) e inativar a Conta a Pagar gerada.'
      : ehProcessada
      ? 'Inativar este lançamento de folha?\n\nEla está PROCESSADA — vou inativar também a Conta a Pagar gerada.'
      : 'Inativar este lançamento de folha?';
    if (!await confirm(aviso)) return;
    try {
      // Estorno admin: reverte crédito MaxBank (se houver) e inativa
      // a conta_pagar derivada. RPC é idempotente — chamar mesmo em
      // folhas Pendentes é no-op.
      if (supabase && (ehPaga || ehProcessada)) {
        const { data: res, error: revErr } = await supabase.rpc('reverter_folha_maxbank', { p_folha_id: folha.id });
        if (revErr) {
          console.error('[FolhaPagamento] erro ao reverter MaxBank:', revErr);
          showToast(`Erro ao reverter MaxBank: ${revErr.message}`, 'error');
          return;
        }
        const r = res as any;
        const perda = Number(r?.perda_total_por_saldo_insuficiente ?? 0);
        if (perda > 0) {
          showToast(`Estorno parcial: colaborador já tinha gasto R$ ${perda.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — saldo zerou onde não dava pra devolver.`, 'error');
        }
      }
      await dbDelete('/api/folhapagamentoview', folha.id);
      setData(prev => prev.filter(f => f.id !== folha.id));
      showToast('Folha inativada e MaxBank revertido.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[FolhaPagamento] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error');
    }
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY); };

  // Bridge funcionario → user_profile → maxbank_contas. Carrega saldos + extrato
  // recente. Admin/CEO/RH consegue ler todos via RLS.
  const abrirCarteira = async (f: any) => {
    if (!supabase) return;
    const func = funcionarios.find(fn => fn.id === f.funcionario_id);
    const nome = func?.nome ?? 'Colaborador';
    setCarteiraLoading(true);
    try {
      const { data: funcRow, error: fnErr } = await supabase
        .from('funcionarios')
        .select('user_profile_id')
        .eq('id', f.funcionario_id)
        .maybeSingle();
      if (fnErr) throw fnErr;
      if (!funcRow?.user_profile_id) {
        showToast(`${nome} não tem user_profile vinculado — sem carteira MaxBank.`, 'error');
        return;
      }
      const { data: conta, error: cErr } = await supabase
        .from('maxbank_contas')
        .select('id, saldo_salario, saldo_beneficios, saldo_bonificacoes')
        .eq('colaborador_id', funcRow.user_profile_id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!conta) {
        showToast(`Conta MaxBank de ${nome} ainda não existe.`, 'error');
        return;
      }
      const { data: txs, error: tErr } = await supabase
        .from('maxbank_transacoes')
        .select('id, tipo, carteira, valor, descricao, origem, created_at')
        .eq('conta_id', conta.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (tErr) throw tErr;
      setCarteiraModal({
        funcionarioNome: nome,
        contaId: conta.id,
        saldos: {
          salario:      Number(conta.saldo_salario),
          beneficios:   Number(conta.saldo_beneficios),
          bonificacoes: Number(conta.saldo_bonificacoes),
        },
        transacoes: txs ?? [],
      });
    } catch (err: any) {
      console.error('[FolhaPagamento] erro ao abrir carteira:', err);
      showToast(`Erro ao abrir carteira: ${err?.message ?? err}`, 'error');
    } finally {
      setCarteiraLoading(false);
    }
  };

  const recarregarCarteira = async () => {
    if (!carteiraModal || !supabase) return;
    const { data: conta } = await supabase
      .from('maxbank_contas')
      .select('saldo_salario, saldo_beneficios, saldo_bonificacoes')
      .eq('id', carteiraModal.contaId)
      .maybeSingle();
    const { data: txs } = await supabase
      .from('maxbank_transacoes')
      .select('id, tipo, carteira, valor, descricao, origem, created_at')
      .eq('conta_id', carteiraModal.contaId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!conta) return;
    setCarteiraModal({
      ...carteiraModal,
      saldos: {
        salario:      Number(conta.saldo_salario),
        beneficios:   Number(conta.saldo_beneficios),
        bonificacoes: Number(conta.saldo_bonificacoes),
      },
      transacoes: txs ?? [],
    });
  };

  const recomputarSaldos = async () => {
    if (!carteiraModal || !supabase) return;
    // O texto antigo prometia "zerar drift" e fazia o contrário: reescreve o
    // saldo com a soma do extrato. Antes da migr. 271 isso zerava carteiras
    // inteiras, porque o histórico anterior ao reset da 096 não existia mais.
    if (!await confirm('Recalcular os 3 saldos desta carteira a partir do extrato?\n\nO saldo passa a ser exatamente a soma dos lançamentos listados. Se algum lançamento foi excluído, o saldo cai junto.')) return;
    try {
      const { error } = await supabase.rpc('recompute_saldos_maxbank', { p_conta_id: carteiraModal.contaId });
      if (error) throw error;
      showToast('Saldos recalculados.', 'success');
      await recarregarCarteira();
    } catch (err: any) {
      console.error('[FolhaPagamento] erro ao recomputar saldos:', err);
      showToast(`Erro ao recomputar: ${err?.message ?? err}`, 'error');
    }
  };

  const excluirTransacao = async (tx: any) => {
    if (!supabase) return;
    if (!await confirm(`Excluir o lançamento "${tx.descricao}" (R$ ${Number(tx.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})?\n\nO saldo da carteira será ajustado.`)) return;
    setExcluindoTxId(tx.id);
    try {
      const { error } = await supabase.rpc('excluir_transacao_maxbank', { p_transacao_id: tx.id });
      if (error) throw error;
      showToast('Lançamento excluído e saldo ajustado.', 'success');
      await recarregarCarteira();
    } catch (err: any) {
      console.error('[FolhaPagamento] erro ao excluir lançamento:', err);
      showToast(`Erro ao excluir: ${err?.message ?? err}`, 'error');
    } finally {
      setExcluindoTxId(null);
    }
  };

  // Fase 3: chama RPC recalcular_folha_do_ponto. Frontend passa horários
  // da turma vindos de PONTO_HORARIOS (env por instância).
  const handleRecalcular = async (f: any) => {
    if (!supabase) return;
    if (f.status !== 'Pendente') {
      showToast('Recálculo só é permitido em folhas Pendente.', 'error');
      return;
    }
    setRecalcLoading(f.id);
    try {
      const { data: result, error } = await supabase.rpc('recalcular_folha_do_ponto', {
        p_folha_id:       f.id,
        p_target_entrada: PONTO_HORARIOS.entrada,
        p_target_retorno: PONTO_HORARIOS.retorno,
        p_target_saida:   PONTO_HORARIOS.saida,
      });
      if (error) throw error;
      const breakdown = result as RecalcBreakdown;
      // Atualiza tabela local com os novos valores.
      setData(prev => prev.map(x => x.id === f.id ? {
        ...x,
        salario_base:    breakdown.salario_base,
        salario_bruto:   breakdown.salario_bruto,
        descontos:       breakdown.descontos,
        salario_liquido: breakdown.salario_liquido,
        horas_atraso:    breakdown.horas_atraso,
        horas_falta:     breakdown.horas_falta,
        horas_extras:    breakdown.horas_extras,
        desconto_faltas: breakdown.desconto_faltas,
        base_inss:       breakdown.base_inss,
        desconto_inss:   breakdown.desconto_inss,
        desconto_irrf:   breakdown.desconto_irrf,
        fgts_deposito:   breakdown.fgts_deposito,
      } : x));
      const func = funcionarios.find(fn => fn.id === f.funcionario_id);
      setRecalcBreakdown({ folhaNome: `${func?.nome ?? 'Funcionário'} — ${f.mes_ref}`, data: breakdown });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error('[FolhaPagamento] erro ao recalcular:', err);
      showToast(`Erro ao recalcular: ${msg}`, 'error');
    } finally {
      setRecalcLoading(null);
    }
  };

  const abrirHolerite = async (f: any) => {
    if (!supabase) return;
    setHoleriteLoading(f.id);
    try {
      const { data, error } = await supabase
        .from('folha_rubricas')
        .select('id,codigo,descricao,tipo,referencia,valor,ordem')
        .eq('folha_id', f.id)
        .order('ordem', { ascending: true });
      if (error) throw error;
      const func = funcionarios.find(fn => fn.id === f.funcionario_id);
      setHolerite({
        titulo: `${func?.nome ?? 'Funcionário'} — ${f.mes_ref}`,
        folha: f,
        rubricas: (data ?? []) as Rubrica[],
      });
    } catch (err: any) {
      // Turma sem a migr. 320 não tem a tabela: avisa em vez de abrir vazio.
      const msg = err?.message ?? String(err);
      console.error('[FolhaPagamento] erro ao abrir holerite:', err);
      showToast(
        /folha_rubricas/i.test(msg)
          ? 'Holerite indisponível: a migração 320 ainda não foi aplicada nesta turma.'
          : `Erro ao abrir holerite: ${msg}`,
        'error',
      );
    } finally {
      setHoleriteLoading(null);
    }
  };

  const handleStatusCycle = async (f: any) => {
    const next = statusNext(f.status);
    if (!next) return; // 'Paga' é estado terminal — sem reversão
    try {
      // Processada → Paga não existe mais aqui (migr. 282): quem paga é o
      // Financeiro, em Contas a Pagar. `statusNext` já para em 'Processada' —
      // o ciclo desta tela vai só até fechar a folha e gerar a despesa.

      // Pendente → Processada: a conta a pagar nasce junto, na mesma transação
      // (migr. 272). Antes eram duas escritas soltas — e quando a RLS de
      // contas_pagar negava o insert (tela apontada para outra filial), a folha
      // avançava mesmo assim e a despesa nunca chegava ao Financeiro.
      if (next === 'Processada') {
        if (!supabase) return;
        const { data, error } = await supabase.rpc('processar_folha', { p_folha_id: f.id });
        if (error) {
          showToast(`Não foi possível processar a folha: ${error.message}`, 'error');
          return;
        }
        const res = data as any;
        setData(prev => prev.map(x => x.id === f.id ? { ...x, status: 'Processada' } : x));
        showToast(`Folha processada — Conta a Pagar de R$ ${Number(res?.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} gerada em ${res?.filial ?? f.filial}.`, 'success');
        return;
      }

      await dbSetStatus('/api/folhapagamentoview', f.id, next);
      setData(prev => prev.map(x => x.id === f.id ? { ...x, status: next } : x));
    } catch { showToast('Erro ao atualizar status.', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Folha de Pagamento — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie a folha mensal dos funcionários.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 shrink-0">
        {[
          { label: 'Total Bruto', value: `R$ ${totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, warn: false },
          { label: 'Total Descontos', value: `R$ ${totalDesc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, warn: false },
          { label: 'Total Líquido', value: `R$ ${totalLiq.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, warn: false },
          { label: 'Folhas Pendentes', value: pendentes, warn: pendentes > 0 },
          { label: 'Func. com folha', value: `${funcsComFolha} / ${funcsAtivos}`, warn: funcsComFolha < funcsAtivos },
        ].map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-xl font-black leading-tight ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <label htmlFor="folha-mes-filtro" className="text-xs text-gray-500 font-bold uppercase tracking-widest">Mês de Referência</label>
          <input id="folha-mes-filtro" type="month" value={mesFiltro} onChange={e => setMesFiltro(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm" />
        </div>
        <NeuButtonAccent variant="" onClick={() => { if (showForm) closeForm(); else setShowForm(true); }}><Plus size={14} />{showForm ? 'Cancelar' : 'Nova Folha'}</NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div ref={formRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 scroll-mt-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editId ? 'Editar Folha' : 'Registrar Folha'}</h3>
              <button onClick={closeForm} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="folha-funcionario" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Funcionário *</label>
                <select id="folha-funcionario" value={form.funcionario_id} onChange={e => handleFuncionarioChange(e.target.value)} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {funcionarios.filter((f: any) => f.status === 'Ativo').map((f: any) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </div>
              {/* Campos de R$ usam text + formatBRL/parseBRL, não type="number" —
                  é o padrão de moeda desta base, e o número cru aceitava ponto
                  decimal onde o operador digita vírgula. */}
              {[
                { label: 'Mês Ref. *', k: 'mes_ref', type: 'month', money: false },
                { label: 'Salário Base (R$)', k: 'salario_base', type: 'text', money: true },
                { label: 'Descontos (R$)', k: 'descontos', type: 'text', money: true },
                { label: 'Benefícios (R$)', k: 'valor_beneficios', type: 'text', money: true },
              ].map(({ label, k, type, money }) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label htmlFor={`folha-${k}`} className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                  <input id={`folha-${k}`} type={type} value={form[k]}
                    inputMode={money ? 'numeric' : undefined}
                    onChange={e => {
                      const v = money ? formatBRL(e.target.value) : e.target.value;
                      setForm((p: any) => ({ ...p, [k]: v }));
                    }}
                    className={`neu-input rounded-xl px-3 py-2.5 text-sm ${money ? 'font-mono tabular-nums' : ''}`} />
                  {k === 'valor_beneficios' && !editId && form.funcionario_id && (
                    <p className="text-[10px] text-gray-500">Somado dos benefícios atribuídos em Funcionários.</p>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                {/* O "Líquido Estimado" é texto somente-leitura, sem input — usamos span por isso */}
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Líquido Estimado</span>
                <p className="neu-input rounded-xl px-3 py-2.5 text-sm text-green-400 font-mono font-bold">
                  R$ {(parseBRL(form.salario_base) - parseBRL(form.descontos)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (editId ? 'Salvar Alterações' : 'Registrar')}</NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {enriched.length === 0 ? <EmptyState message={`Nenhuma folha para ${mesFiltro}.`} /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Funcionário</th>
                <th className="pb-4 font-bold px-4">Mês Ref.</th>
                <th className="pb-4 font-bold px-4 text-right">Bruto</th>
                <th className="pb-4 font-bold px-4 text-right">Descontos</th>
                <th className="pb-4 font-bold px-4 text-right">Benefícios</th>
                <th className="pb-4 font-bold px-4 text-right">Líquido</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {enriched.map((f: any) => (
                    <motion.tr key={f.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.func?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.mes_ref ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right">R$ {Number(f.salario_bruto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs font-mono text-red-500 text-right">- R$ {Number(f.descontos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs font-mono text-blue-400 text-right">+ R$ {Number(f.valor_beneficios || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-green-400 text-right">R$ {Number(f.salario_liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleStatusCycle(f)}
                          disabled={!statusNext(f.status)}
                          title={statusNextTitle(f.status)}
                          className={`flex items-center gap-1.5 mx-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase hover:opacity-80 disabled:cursor-default ${statusCls(f.status)}`}
                        >
                          {f.status === 'Paga' ? <CheckCircle size={11} /> : f.status === 'Processada' ? <DollarSign size={11} /> : <Clock size={11} />}
                          {f.status}
                          {statusNextLabel(f.status) && (
                            <span className="text-gray-500 font-semibold normal-case">→ {statusNextLabel(f.status)}</span>
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <AuditoriaInspect criadoPor={f.criado_por} criadoEm={f.created_at} atualizadoPor={f.atualizado_por} atualizadoEm={f.updated_at} />
                          <button
                            onClick={() => abrirHolerite(f)}
                            disabled={holeriteLoading === f.id}
                            title="Ver holerite (rubricas)"
                            className="action-btn-edit disabled:opacity-50"
                          >
                            <FileText size={12} />
                          </button>
                          {f.status === 'Pendente' && (
                            <button
                              onClick={() => handleRecalcular(f)}
                              disabled={recalcLoading === f.id}
                              title="Recalcular do Ponto"
                              className="action-btn-purple disabled:opacity-50"
                            >
                              <Calculator size={12} />
                            </button>
                          )}
                          {(f.status === 'Paga' || f.status === 'Processada') && podeDestravarCredito && (
                            <button
                              onClick={() => handleRecreditar(f)}
                              disabled={recreditandoId === f.id}
                              title="Creditar MaxBank / tentar de novo (seguro repetir — idempotente)"
                              className="action-btn-edit disabled:opacity-50"
                            >
                              <RefreshCw size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => abrirCarteira(f)}
                            disabled={carteiraLoading}
                            title="Ver carteira MaxBank do colaborador"
                            className="action-btn-success disabled:opacity-50"
                          >
                            <Wallet size={12} />
                          </button>
                          <button onClick={() => openEdit(f)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                          <button onClick={() => handleDelete(f)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {recalcBreakdown && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setRecalcBreakdown(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-accent">Recálculo do Ponto</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{recalcBreakdown.folhaNome}</p>
                </div>
                <button onClick={() => setRecalcBreakdown(null)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
              </div>

              <div className="space-y-2.5 text-xs">
                {/* O rótulo trazia "÷ 220" fixo, que era a jornada CLT. A base
                    mensal agora vem da jornada real da turma (migr. 290). */}
                <Row label={`Jornada diária (turma)`} value={`${(recalcBreakdown.data.jornada_diaria ?? 0).toFixed(2)} h`} muted />
                <Row label={`Valor/hora (base ÷ ${(recalcBreakdown.data.horas_mes ?? 0).toFixed(2)})`} value={`R$ ${recalcBreakdown.data.valor_hora.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
                <div className="border-t border-white/5 my-3" />
                <Row label="Horas de atraso" value={`${recalcBreakdown.data.horas_atraso.toFixed(2)} h`} muted />
                <Row label="Horas de falta" value={`${recalcBreakdown.data.horas_falta.toFixed(2)} h`} muted />
                {/* Separado das faltas de propósito: é o que a aprovação da
                    Matriz poupou. Sem essa linha, um afastamento aprovado e um
                    negado dariam telas idênticas (migr. 292). */}
                <Row label="Horas perdoadas (afastamento aprovado)" value={`${(recalcBreakdown.data.horas_perdoadas ?? 0).toFixed(2)} h`} colorClass="text-emerald-400" />
                <div className="border-t border-white/5 my-3" />
                <Row label="Horas extras" value={`${recalcBreakdown.data.horas_extras.toFixed(2)} h`} muted />
                <Row label="Bônus hora extra (×1,5)" value={`+ R$ ${recalcBreakdown.data.bonus_extra.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-blue-400" />
                <div className="border-t border-white/5 my-3" />
                <Row label="Salário base" value={`R$ ${recalcBreakdown.data.salario_base.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} muted />
                <Row label="Bruto efetivo (base + extra)" value={`R$ ${recalcBreakdown.data.salario_bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />

                {/* Encargos (migr. 319). Só aparecem quando a RPC já devolve os
                    campos — turma sem a migration aplicada segue vendo a tela
                    antiga, sem linha vazia nem NaN. */}
                {recalcBreakdown.data.desconto_inss !== undefined && (
                  <>
                    <div className="border-t border-white/5 my-3" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600">Descontos</p>
                    <Row label="Faltas e atrasos" value={`- R$ ${(recalcBreakdown.data.desconto_faltas ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-red-400" />
                    {/* Base própria: falta reduz a remuneração do mês, e é sobre
                        a remuneração efetiva que INSS e FGTS incidem. */}
                    <Row label="Base de INSS (bruto − faltas)" value={`R$ ${(recalcBreakdown.data.base_inss ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} muted />
                    <Row label="INSS" value={`- R$ ${(recalcBreakdown.data.desconto_inss ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-red-400" />
                    <Row
                      label={`IRRF${(recalcBreakdown.data.dependentes ?? 0) > 0 ? ` (${recalcBreakdown.data.dependentes} dependente${recalcBreakdown.data.dependentes === 1 ? '' : 's'})` : ''}`}
                      value={`- R$ ${(recalcBreakdown.data.desconto_irrf ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                      colorClass="text-red-400"
                    />
                  </>
                )}

                <Row label="Descontos totais" value={`- R$ ${recalcBreakdown.data.descontos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-red-400" bold />
                <Row label="Líquido final" value={`R$ ${recalcBreakdown.data.salario_liquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-green-400" bold />

                {recalcBreakdown.data.fgts_deposito !== undefined && (
                  <>
                    <div className="border-t border-white/5 my-3" />
                    {/* FGTS não entra no líquido: é depósito do empregador, não
                        desconto do trabalhador — mesmo tratamento da rescisão. */}
                    <Row label="FGTS depositado (empregador)" value={`R$ ${(recalcBreakdown.data.fgts_deposito ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-blue-400" />
                    <p className="text-[10px] text-gray-600 leading-relaxed pt-1">
                      Fora do líquido — quem deposita é a empresa. Tabelas de INSS e IRRF da vigência{' '}
                      {recalcBreakdown.data.vigencia_tabela ?? '—'}, escolhida pela competência da folha.
                    </p>
                  </>
                )}
              </div>

              <div className="flex justify-end mt-6">
                <NeuButtonAccent variant="" onClick={() => setRecalcBreakdown(null)}>Fechar</NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Holerite ─────────────────────────────────────────────────────
          Documento em vez de três números. As rubricas vêm da tabela, não de
          um cálculo paralelo do frontend — se o holerite não fechar com o
          líquido, o erro está no recálculo e aparece aqui. */}
      <AnimatePresence>
        {holerite && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
            onClick={() => setHolerite(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-lg w-full my-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-accent">Holerite</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{holerite.titulo}</p>
                </div>
                <button onClick={() => setHolerite(null)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
              </div>

              {holerite.rubricas.length === 0 ? (
                <EmptyState message="Sem rubricas. Recalcule a folha do ponto para gerá-las." />
              ) : (
                <>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-[9px] text-gray-500 uppercase tracking-widest">
                        <th className="pb-2 font-bold pr-2">Cód.</th>
                        <th className="pb-2 font-bold pr-2">Descrição</th>
                        <th className="pb-2 font-bold pr-2 text-right">Ref.</th>
                        <th className="pb-2 font-bold text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holerite.rubricas.map(r => (
                        <tr key={r.id} className="border-b border-white/5">
                          <td className="py-1.5 pr-2 text-[10px] font-mono text-gray-600">{r.codigo}</td>
                          <td className="py-1.5 pr-2 text-xs text-gray-300">
                            {r.descricao}
                            {r.tipo === 'informativa' && (
                              <span className="ml-1.5 text-[9px] uppercase tracking-widest text-gray-600">informativa</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-[10px] font-mono text-gray-500 text-right">{r.referencia ?? '—'}</td>
                          <td className={`py-1.5 text-xs font-mono tabular-nums text-right ${
                            r.tipo === 'provento' ? 'text-gray-200'
                              : r.tipo === 'desconto' ? 'text-red-400'
                              : 'text-blue-400'
                          }`}>
                            {r.tipo === 'desconto' ? '- ' : ''}
                            R$ {Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="space-y-2 text-xs mt-4 pt-3 border-t border-white/10">
                    <Row label="Total de proventos" value={`R$ ${holerite.rubricas.filter(r => r.tipo === 'provento').reduce((s, r) => s + Number(r.valor), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
                    <Row label="Total de descontos" value={`- R$ ${holerite.rubricas.filter(r => r.tipo === 'desconto').reduce((s, r) => s + Number(r.valor), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-red-400" />
                    <Row label="Líquido" value={`R$ ${Number(holerite.folha.salario_liquido ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} colorClass="text-green-400" bold />
                  </div>

                  <p className="text-[10px] text-gray-600 leading-relaxed pt-3">
                    Rubricas marcadas como informativas ficam fora dos dois totais — o FGTS é depósito da
                    empresa, não desconto do trabalhador. Benefícios são pagos à parte e não entram aqui.
                  </p>
                </>
              )}

              <div className="flex justify-end mt-5">
                <NeuButtonAccent variant="" onClick={() => setHolerite(null)}>Fechar</NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {carteiraModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setCarteiraModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-lg w-full max-h-[85vh] overflow-y-auto main-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-accent">Carteira MaxBank</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{carteiraModal.funcionarioNome}</p>
                </div>
                <button onClick={() => setCarteiraModal(null)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className="neu-flat rounded-xl p-3 border border-white/5">
                  <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Salário</p>
                  <p className="text-sm font-black text-green-400 mt-1">R$ {carteiraModal.saldos.salario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="neu-flat rounded-xl p-3 border border-white/5">
                  <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Benefícios</p>
                  <p className="text-sm font-black text-blue-400 mt-1">R$ {carteiraModal.saldos.beneficios.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="neu-flat rounded-xl p-3 border border-white/5">
                  <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Bonific.</p>
                  <p className="text-sm font-black text-yellow-400 mt-1">R$ {carteiraModal.saldos.bonificacoes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2">Extrato (50 últimos)</p>
              {carteiraModal.transacoes.length === 0 ? (
                <p className="text-xs text-gray-500 italic py-4 text-center">Nenhum lançamento.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {carteiraModal.transacoes.map((tx: any) => {
                    const ehCredito = tx.tipo === 'credito';
                    const cor = ehCredito ? 'text-green-400' : 'text-red-400';
                    const sinal = ehCredito ? '+' : '−';
                    const Icone = ehCredito ? ArrowDownLeft : ArrowUpRight;
                    return (
                      <li key={tx.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5">
                        <div className={`w-7 h-7 neu-flat rounded-full flex items-center justify-center flex-shrink-0 ${cor}`}>
                          <Icone size={12} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-gray-200 truncate">{tx.descricao}</p>
                          <p className="text-[9px] text-gray-500 font-medium uppercase tracking-wider">
                            {tx.carteira} • {new Date(tx.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <p className={`text-xs font-mono font-black ${cor} flex-shrink-0`}>
                          {sinal} R$ {Number(tx.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                        <button
                          onClick={() => excluirTransacao(tx)}
                          disabled={excluindoTxId === tx.id}
                          title="Excluir lançamento e ajustar saldo"
                          className="action-btn-delete disabled:opacity-50"
                        >
                          <Trash2 size={11} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="flex justify-between items-center gap-3 mt-6">
                <NeuButtonAccent variant="yellow" onClick={recomputarSaldos}>
                  <Calculator size={14} />
                  Recalcular saldos
                </NeuButtonAccent>
                <NeuButtonAccent variant="" onClick={() => setCarteiraModal(null)}>Fechar</NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const FolhaPagamentoView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!hasSetor(profile, 'rh')) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <Lock size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas RH, admin ou CEO podem acessar a Folha de Pagamento.</p>
      </div>
    );
  }
  if (!filialAtiva) return null;
  return <FolhaPagamentoViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};

function Row({ label, value, colorClass, muted, bold }: {
  label: string; value: string; colorClass?: string; muted?: boolean; bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className={muted ? 'text-gray-500' : 'text-gray-400'}>{label}</span>
      <span className={`font-mono ${bold ? 'font-black' : 'font-bold'} ${colorClass ?? 'text-gray-200'}`}>{value}</span>
    </div>
  );
}
