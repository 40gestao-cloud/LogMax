import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Trash2, Check, X, Send, MessageSquare, Loader2, ShoppingBag, Clock, FileText } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL } from '../lib/viewUtils';
import { supabase } from '../lib/supabase';
import { hasSetor } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

// notificar_setor existe em 20260520_ti_e_notificacoes.sql; usado em CotacoesView também.
async function notificarSetor(args: {
  setor: 'vendas' | 'financeiro';
  tipo: 'aprovacao_pendente' | 'aprovado' | 'reprovado';
  titulo: string;
  mensagem?: string;
  link_view?: string;
  urgencia?: 'Baixa' | 'Média' | 'Alta';
  ref_id?: string;
  motivo?: string;
}) {
  if (!supabase) return;
  try {
    await supabase.rpc('notificar_setor', {
      p_setor:     args.setor,
      p_tipo:      args.tipo,
      p_titulo:    args.titulo,
      p_mensagem:  args.mensagem ?? null,
      p_link_view: args.link_view ?? null,
      p_urgencia:  args.urgencia ?? 'Média',
      p_ref_id:    args.ref_id ?? null,
      p_motivo:    args.motivo ?? null,
    });
  } catch {
    // Best-effort; não bloqueia fluxo.
  }
}

interface ItemOrcamento {
  produto_id: string;
  nome: string;
  qtd: number;
  preco_unitario: number;
  subtotal: number;
}

const STATUS_LIST = [
  'Rascunho',
  'Aguardando Financeiro',
  'Aprovado Financeiro',
  'Reprovado Financeiro',
  'Enviado ao Cliente',
  'Aprovado Cliente',
  'Reprovado Cliente',
  'Convertido em Pedido',
  'Expirado',
  'Cancelado',
] as const;

export const OrcamentosView = ({
  showToast, profile, mode,
}: {
  showToast: any;
  profile: UserProfile;
  /** 'vendas' (criar/gerenciar) | 'financeiro' (aprovar) | undefined (auto). */
  mode?: 'vendas' | 'financeiro';
}) => {
  const [page, setPage] = useState(0);
  const [statusFiltro, setStatusFiltro] = useState<string>('todos');
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/orcamentosview', undefined, false,
    { page, searchColumns: ['status'] }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');

  const isVendas       = hasSetor(profile, 'vendas');
  const isFinanceiro   = hasSetor(profile, 'financeiro');
  const isAdminOuCeo   = profile.role === 'admin' || profile.role === 'ceo';
  const podeDecidirFin = isFinanceiro || isAdminOuCeo;
  const podeCriarVenda = isVendas || isAdminOuCeo;

  // Modo financeiro = aba "Aprovações de Orçamento" no Financeiro;
  // foca em decisões e oculta o botão de criar.
  const modoFinanceiro = mode === 'financeiro';

  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [convertendo, setConvertendo] = useState<string | null>(null);
  const [enviandoCliente, setEnviandoCliente] = useState<string | null>(null);

  // Form
  const [form, setForm] = useState({ cliente_id: '', validade_dias: '3' });
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  const [extras, setExtras] = useState({ desconto: '', observacoes: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Modal de decisão Financeiro
  const [decisao, setDecisao] = useState<{ orc: any; tipo: 'aprovar' | 'reprovar' } | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [decidindo, setDecidindo] = useState(false);

  const produtosAtivos = useMemo(
    () => produtos.filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo' && p.tipo !== 'patrimonio'),
    [produtos]
  );

  const subtotal = useMemo(
    () => itens.reduce((s, it) => s + it.subtotal, 0),
    [itens]
  );
  const descontoNum = parseBRL(extras.desconto);
  const valorTotal  = Math.max(0, subtotal - descontoNum);

  const enriched = data.map((o: any) => ({
    ...o,
    cliente: clientes.find((c: any) => c.id === o.cliente_id),
  }));

  const filtrados = statusFiltro === 'todos'
    ? enriched
    : enriched.filter((o: any) => o.status === statusFiltro);

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ cliente_id: '', validade_dias: '3' });
    setItens([]);
    setExtras({ desconto: '', observacoes: '' });
    setErrors({});
  };

  const openEdit = (orc: any) => {
    setEditItem(orc);
    setForm({
      cliente_id: orc.cliente_id ?? '',
      validade_dias: String(orc.validade_dias ?? 3),
    });
    setItens(Array.isArray(orc.itens) ? orc.itens : []);
    setExtras({
      desconto: orc.desconto ? formatBRL(Number(orc.desconto)) : '',
      observacoes: orc.observacoes ?? '',
    });
    setErrors({});
    setShowForm(false);
  };

  // Itens helpers ─────────────────────────────────────────────────────────
  const addItem = () => {
    setItens(prev => [...prev, { produto_id: '', nome: '', qtd: 1, preco_unitario: 0, subtotal: 0 }]);
  };
  const removeItem = (idx: number) => {
    setItens(prev => prev.filter((_, i) => i !== idx));
  };
  const updateItem = (idx: number, patch: Partial<ItemOrcamento>) => {
    setItens(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      next.subtotal = Math.round((Number(next.qtd) || 0) * (Number(next.preco_unitario) || 0) * 100) / 100;
      return next;
    }));
  };
  const escolherProduto = (idx: number, produtoId: string) => {
    const p = produtosAtivos.find((pr: any) => pr.id === produtoId);
    if (!p) {
      updateItem(idx, { produto_id: '', nome: '', preco_unitario: 0 });
      return;
    }
    updateItem(idx, {
      produto_id: p.id,
      nome: p.nome,
      preco_unitario: Number(p.preco) || 0,
    });
  };

  // SAVE (rascunho ou edição de rascunho) ──────────────────────────────────
  const handleSave = async (enviarAoFinanceiro: boolean) => {
    if (!validate()) return;
    if (itens.length === 0) {
      showToast('Adicione pelo menos um item.', 'error', true);
      return;
    }
    if (itens.some(it => !it.produto_id || it.qtd <= 0)) {
      showToast('Cada item precisa de produto e quantidade > 0.', 'error', true);
      return;
    }

    setIsSaving(true);
    try {
      const payload: any = {
        cliente_id:    form.cliente_id || null,
        vendedor_id:   profile.id,
        vendedor_nome: profile.nome,
        validade_dias: Math.max(1, parseInt(form.validade_dias) || 3),
        itens,
        subtotal,
        desconto:      descontoNum,
        valor_total:   valorTotal,
        observacoes:   extras.observacoes || null,
        status:        enviarAoFinanceiro ? 'Aguardando Financeiro' : 'Rascunho',
      };

      let saved: any;
      if (editItem) {
        saved = await dbUpdate('/api/orcamentosview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (saved ?? { ...d, ...payload }) : d));
      } else {
        saved = await dbInsert('/api/orcamentosview', payload);
        if (saved) setData((prev: any[]) => [saved, ...prev]);
      }

      if (enviarAoFinanceiro && saved) {
        const cli = clientes.find((c: any) => c.id === form.cliente_id);
        await notificarSetor({
          setor:     'financeiro',
          tipo:      'aprovacao_pendente',
          titulo:    'Nova proposta comercial aguardando aprovação',
          mensagem:  `${cli?.nome ?? 'Cliente'} — R$ ${formatBRL(valorTotal)}`,
          link_view: 'financeiro-aprovaçõesdeorçamento',
          urgencia:  'Média',
          ref_id:    saved.id,
        });
        showToast('Proposta enviada ao Financeiro.', 'success', true);
      } else {
        showToast(editItem ? 'Rascunho atualizado.' : 'Rascunho salvo.', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Financeiro decide ──────────────────────────────────────────────────────
  const handleConfirmDecisao = async () => {
    if (!decisao) return;
    const { orc, tipo } = decisao;
    const feedback = feedbackInput.trim();
    if (tipo === 'reprovar' && !feedback) {
      showToast('Feedback é obrigatório para reprovar.', 'error', true);
      return;
    }

    setDecidindo(true);
    try {
      const novoStatus = tipo === 'aprovar' ? 'Aprovado Financeiro' : 'Reprovado Financeiro';
      const updates: any = {
        status: novoStatus,
        feedback_financeiro:     feedback || null,
        decidido_financeiro_em:  new Date().toISOString(),
        decidido_financeiro_por: profile.id,
      };
      await dbUpdate('/api/orcamentosview', orc.id, updates);
      setData((prev: any[]) => prev.map(o => o.id === orc.id ? { ...o, ...updates } : o));

      const cli = orc.cliente?.nome ?? clientes.find((c: any) => c.id === orc.cliente_id)?.nome ?? 'Cliente';
      await notificarSetor({
        setor:     'vendas',
        tipo:      tipo === 'aprovar' ? 'aprovado' : 'reprovado',
        titulo:    tipo === 'aprovar'
                     ? 'Proposta aprovada pelo Financeiro'
                     : 'Proposta reprovada pelo Financeiro',
        mensagem:  `${cli} — R$ ${formatBRL(Number(orc.valor_total ?? 0))}`,
        link_view: 'vendas-orçamentos',
        urgencia:  tipo === 'aprovar' ? 'Média' : 'Alta',
        ref_id:    orc.id,
        motivo:    tipo === 'reprovar' ? feedback : undefined,
      });

      showToast(tipo === 'aprovar' ? 'Proposta aprovada.' : 'Proposta reprovada.', 'success', true);
      setDecisao(null);
      setFeedbackInput('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setDecidindo(false);
    }
  };

  // Vendas → enviar ao cliente (registra a saída; cliente decide via ClienteEspecialView no MVP)
  const handleEnviarCliente = async (orc: any) => {
    setEnviandoCliente(orc.id);
    try {
      const updates = {
        status: 'Enviado ao Cliente',
        enviado_cliente_em: new Date().toISOString(),
      };
      await dbUpdate('/api/orcamentosview', orc.id, updates);
      setData((prev: any[]) => prev.map(o => o.id === orc.id ? { ...o, ...updates } : o));
      showToast('Proposta enviada ao cliente. Aguardando decisão.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setEnviandoCliente(null);
    }
  };

  // Vendas → converter em pedido (chama RPC)
  const handleConverter = async (orc: any) => {
    if (!supabase) return;
    setConvertendo(orc.id);
    try {
      const { data: pedidoId, error } = await supabase.rpc('converter_orcamento_em_pedido', {
        p_orcamento_id: orc.id,
      });
      if (error) throw error;
      setData((prev: any[]) => prev.map(o => o.id === orc.id
        ? { ...o, status: 'Convertido em Pedido', pedido_venda_id: pedidoId }
        : o
      ));
      showToast(`Pedido de venda #${String(pedidoId).slice(0, 8).toUpperCase()} criado.`, 'success', true);
    } catch (err: any) {
      showToast(`Falha ao converter: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setConvertendo(null);
    }
  };

  const handleCancelar = async (id: string) => {
    if (!confirm('Cancelar este orçamento?')) return;
    try {
      const updated = await dbUpdate('/api/orcamentosview', id, { status: 'Cancelado' });
      setData((prev: any[]) => prev.map(o => o.id === id ? (updated ?? { ...o, status: 'Cancelado' }) : o));
      showToast('Orçamento cancelado.', 'info', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Inativar este orçamento?')) return;
    try {
      await dbDelete('/api/orcamentosview', id);
      setData((prev: any[]) => prev.filter(o => o.id !== id));
      showToast('Orçamento inativado.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  // Expirado helper (visual): considera expirado se passa data_emissao + validade_dias
  // e ainda está em status que esperam ação. Não muda no banco aqui (cliente_especial
  // ou um cron futuro fariam o flip oficial); só destaca em vermelho.
  const isExpirado = (orc: any) => {
    if (!orc.data_emissao) return false;
    const emissao = new Date(orc.data_emissao);
    const limite = new Date(emissao.getTime() + Number(orc.validade_dias ?? 3) * 86400000);
    const ativos = ['Rascunho', 'Aguardando Financeiro', 'Aprovado Financeiro', 'Enviado ao Cliente'];
    return ativos.includes(orc.status) && new Date() > limite;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            {modoFinanceiro ? 'Aprovações de Orçamento' : 'Orçamentos & Propostas'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {modoFinanceiro
              ? 'Aprove ou reprove propostas comerciais enviadas pela equipe de Vendas.'
              : 'Crie propostas com validade, descontos e acompanhe a aprovação até virar pedido.'}
          </p>
        </div>
        {!modoFinanceiro && podeCriarVenda && (
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
            <Plus size={16} /> Nova Proposta
          </NeuButtonAccent>
        )}
      </div>

      {/* Filtro de status */}
      <div className="flex gap-2 flex-wrap shrink-0">
        <button
          onClick={() => setStatusFiltro('todos')}
          className={`py-1.5 px-3 rounded-lg text-[11px] font-bold uppercase tracking-widest border transition-all ${statusFiltro === 'todos' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
        >Todos</button>
        {STATUS_LIST.map(s => (
          <button
            key={s}
            onClick={() => setStatusFiltro(s)}
            className={`py-1.5 px-3 rounded-lg text-[11px] font-bold uppercase tracking-widest border transition-all ${statusFiltro === s ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >{s}</button>
        ))}
      </div>

      {/* Form de criação/edição */}
      <AnimatePresence>
        {(showForm || editItem) && !modoFinanceiro && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Proposta' : 'Nova Proposta'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Cliente *" error={errors.cliente_id}>
                  <select
                    className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.cliente_id ? 'border border-red-500/40' : ''}`}
                    value={form.cliente_id}
                    onChange={e => { setForm(f => ({ ...f, cliente_id: e.target.value })); clearError('cliente_id'); }}
                  >
                    <option value="">Selecione...</option>
                    {clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </FormField>
                <FormField label="Validade (dias) *">
                  <input
                    type="number"
                    min="1"
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.validade_dias}
                    onChange={e => setForm(f => ({ ...f, validade_dias: e.target.value }))}
                  />
                </FormField>
                <FormField label="Desconto (R$)">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.desconto}
                    onChange={e => setExtras(x => ({ ...x, desconto: formatBRL(e.target.value) }))}
                    placeholder="0,00"
                  />
                </FormField>
              </div>

              {/* Itens da proposta */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Itens da Proposta</span>
                  <button onClick={addItem} className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-accent flex items-center gap-1">
                    <Plus size={11} /> Adicionar item
                  </button>
                </div>
                {itens.length === 0 ? (
                  <p className="text-xs text-gray-600 py-3 text-center">Nenhum item ainda — adicione produtos do catálogo.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {itens.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center neu-pressed rounded-xl p-3">
                        <select
                          className="neu-input py-1.5 px-2 rounded-lg text-xs col-span-5"
                          value={it.produto_id}
                          onChange={e => escolherProduto(idx, e.target.value)}
                        >
                          <option value="">Produto...</option>
                          {produtosAtivos.map((p: any) => (
                            <option key={p.id} value={p.id}>{p.nome}{p.codigo ? ` (${p.codigo})` : ''}</option>
                          ))}
                        </select>
                        <div className="col-span-2">
                          <input
                            type="number"
                            min="1"
                            className="neu-input py-1.5 px-2 rounded-lg text-xs w-full text-right"
                            value={it.qtd}
                            onChange={e => updateItem(idx, { qtd: Math.max(0, Number(e.target.value) || 0) })}
                            placeholder="Qtd"
                          />
                        </div>
                        <div className="col-span-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            className="neu-input py-1.5 px-2 rounded-lg text-xs w-full text-right"
                            value={it.preco_unitario ? formatBRL(it.preco_unitario) : ''}
                            onChange={e => updateItem(idx, { preco_unitario: parseBRL(formatBRL(e.target.value)) })}
                            placeholder="Preço"
                          />
                        </div>
                        <span className="col-span-2 text-xs font-mono text-accent text-right tabular-nums">
                          R$ {formatBRL(it.subtotal)}
                        </span>
                        <button onClick={() => removeItem(idx)} className="col-span-1 w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-red-500 mx-auto">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <FormField label="Observações">
                <textarea
                  className="neu-input py-2 px-3 rounded-xl text-sm min-h-[60px]"
                  value={extras.observacoes}
                  onChange={e => setExtras(x => ({ ...x, observacoes: e.target.value }))}
                  placeholder="Condições, prazo de entrega, etc."
                />
              </FormField>

              {/* Totais */}
              <div className="flex justify-end gap-6 text-xs border-t border-white/5 pt-3">
                <div className="flex flex-col items-end">
                  <span className="text-gray-500 uppercase tracking-widest text-[10px]">Subtotal</span>
                  <span className="font-mono text-gray-300">R$ {formatBRL(subtotal)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-gray-500 uppercase tracking-widest text-[10px]">Desconto</span>
                  <span className="font-mono text-gray-300">- R$ {formatBRL(descontoNum)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-gray-500 uppercase tracking-widest text-[10px]">Total</span>
                  <span className="font-mono text-lg font-black text-accent tabular-nums">R$ {formatBRL(valorTotal)}</span>
                </div>
              </div>

              <div className="flex gap-3 justify-end flex-wrap">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <button
                  onClick={() => handleSave(false)}
                  disabled={isSaving}
                  className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-gray-300 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save size={14} /> Salvar Rascunho
                </button>
                <NeuButtonAccent onClick={() => handleSave(true)} isLoading={isSaving}>
                  <Send size={14} /> Enviar ao Financeiro
                </NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lista */}
      {isLoading ? <LoadingSpinner /> : filtrados.length === 0 ? (
        <EmptyState message="Nenhum orçamento encontrado com este filtro." />
      ) : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Cliente</th>
                  <th className="pb-4 font-bold px-4">Vendedor</th>
                  <th className="pb-4 font-bold px-4 text-center">Emitido</th>
                  <th className="pb-4 font-bold px-4 text-center">Validade</th>
                  <th className="pb-4 font-bold px-4 text-right">Total</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4">Feedback</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtrados.map((o: any) => {
                    const expirado = isExpirado(o);
                    const podeEditar = isVendas && o.status === 'Rascunho';
                    const podeEnviarCliente = isVendas && o.status === 'Aprovado Financeiro';
                    const podeConverter = isVendas && o.status === 'Aprovado Cliente';
                    const podeDecidirAgora = podeDecidirFin && o.status === 'Aguardando Financeiro';
                    return (
                      <motion.tr key={o.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{o.cliente?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{o.vendedor_nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-500 text-center">{o.data_emissao ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-center">
                          <span className={expirado ? 'text-red-500 font-bold flex items-center gap-1 justify-center' : 'text-gray-500'}>
                            {expirado && <Clock size={11} />}
                            {o.validade_dias}d
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {formatBRL(Number(o.valor_total ?? 0))}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={o.status} /></td>
                        <td className="py-3 px-4 text-xs max-w-xs">
                          {o.feedback_financeiro || o.feedback_cliente ? (
                            <span className="text-gray-400 italic line-clamp-2" title={[o.feedback_financeiro, o.feedback_cliente].filter(Boolean).join(' • ')}>
                              "{o.feedback_financeiro ?? o.feedback_cliente}"
                            </span>
                          ) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {podeDecidirAgora && (
                              <>
                                <button onClick={() => { setDecisao({ orc: o, tipo: 'aprovar' }); setFeedbackInput(''); }}
                                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 flex items-center gap-1">
                                  <Check size={11} /> Aprovar
                                </button>
                                <button onClick={() => { setDecisao({ orc: o, tipo: 'reprovar' }); setFeedbackInput(''); }}
                                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-400 hover:bg-red-400/10 flex items-center gap-1">
                                  <X size={11} /> Reprovar
                                </button>
                              </>
                            )}
                            {podeEnviarCliente && (
                              <button onClick={() => handleEnviarCliente(o)} disabled={enviandoCliente === o.id}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-cyan-400 hover:bg-cyan-400/10 flex items-center gap-1 disabled:opacity-50">
                                {enviandoCliente === o.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                                Enviar ao cliente
                              </button>
                            )}
                            {podeConverter && (
                              <button onClick={() => handleConverter(o)} disabled={convertendo === o.id}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-yellow-400 hover:bg-yellow-400/10 border border-yellow-400/15 flex items-center gap-1 disabled:opacity-50">
                                {convertendo === o.id ? <Loader2 size={11} className="animate-spin" /> : <ShoppingBag size={11} />}
                                Gerar Pedido
                              </button>
                            )}
                            {podeEditar && (
                              <button onClick={() => openEdit(o)} title="Editar rascunho"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                                <FileText size={12} />
                              </button>
                            )}
                            {(o.status === 'Rascunho' || o.status === 'Aguardando Financeiro') && isVendas && (
                              <button onClick={() => handleCancelar(o.id)} title="Cancelar"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-yellow-400">
                                <X size={12} />
                              </button>
                            )}
                            {o.feedback_financeiro && (
                              <button onClick={() => alert(`Feedback do Financeiro:\n\n${o.feedback_financeiro}`)} title="Ver feedback"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-cyan-400">
                                <MessageSquare size={12} />
                              </button>
                            )}
                            {(isVendas || isAdminOuCeo) && (
                              <button onClick={() => handleDelete(o.id)} title="Inativar"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reload}
          />
        </div>
      )}

      {/* Modal de decisão Financeiro */}
      <AnimatePresence>
        {decisao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
            onClick={() => !decidindo && setDecisao(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              className="neu-flat rounded-3xl w-full max-w-md p-6 flex flex-col gap-4 border border-white/5"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-gray-200">
                {decisao.tipo === 'aprovar' ? 'Aprovar proposta?' : 'Reprovar proposta?'}
              </h3>
              <p className="text-xs text-gray-500">
                {decisao.orc.cliente?.nome ?? '—'} • R$ {formatBRL(Number(decisao.orc.valor_total ?? 0))}
              </p>
              <FormField label={decisao.tipo === 'reprovar' ? 'Feedback (obrigatório) *' : 'Comentário (opcional)'}>
                <textarea
                  className="neu-input py-2 px-3 rounded-xl text-sm min-h-[80px]"
                  value={feedbackInput}
                  onChange={e => setFeedbackInput(e.target.value)}
                  placeholder={decisao.tipo === 'reprovar' ? 'Explique o motivo da reprovação.' : 'Observações para Vendas (opcional).'}
                />
              </FormField>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDecisao(null)} disabled={decidindo}
                  className="neu-button py-2 px-4 rounded-xl text-sm text-gray-400 disabled:opacity-50">Cancelar</button>
                {decisao.tipo === 'reprovar' ? (
                  <button onClick={handleConfirmDecisao} disabled={decidindo}
                    className="py-2 px-5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
                    {decidindo ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    Reprovar
                  </button>
                ) : (
                  <NeuButtonAccent onClick={handleConfirmDecisao} isLoading={decidindo}>
                    <Check size={14} /> Aprovar
                  </NeuButtonAccent>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

