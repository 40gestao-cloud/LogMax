import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Clock, CheckCircle2, XCircle, FileDown, Sheet } from 'lucide-react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent, ExportButton } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

const STATUS_STYLE: Record<string, { badge: string; icon: React.ReactNode }> = {
  'Aguardando Aprovação': {
    badge: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    icon: <Clock size={10} />,
  },
  'Aprovado': {
    badge: 'bg-accent/10 text-accent border-accent/20',
    icon: <CheckCircle2 size={10} />,
  },
  'Reprovado': {
    badge: 'bg-red-500/10 text-red-500 border-red-500/20',
    icon: <XCircle size={10} />,
  },
};

const EMPTY_FORM = {
  produto_id: '',
  preco_atual: '',
  preco_custo: '',
  preco_promocional: '',
  data_inicio: '',
  data_fim: '',
  descricao: '',
};

export const PromocoesMarketingView = ({ showToast, profile }: any) => {
  const { data: promocoes, setData, isLoading } = useFetchData<any>('/api/marketingpromocoesview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const aguardando = promocoes.filter((p: any) => p.status === 'Aguardando Aprovação').length;
  const aprovadas  = promocoes.filter((p: any) => p.status === 'Aprovado').length;
  const reprovadas = promocoes.filter((p: any) => p.status === 'Reprovado').length;

  const kpis = [
    { label: 'Total de Campanhas',     value: promocoes.length, warn: false },
    { label: 'Aguardando Aprovação',   value: aguardando,       warn: aguardando > 0 },
    { label: 'Aprovadas',              value: aprovadas,        warn: false },
    { label: 'Reprovadas',             value: reprovadas,       warn: false },
  ];

  const produtosAtivos = produtos.filter((p: any) => p.status === 'Ativo' || !p.status);

  const handleProductChange = (prodId: string) => {
    const prod = produtos.find((p: any) => p.id === prodId);
    setForm((f: any) => ({
      ...f,
      produto_id: prodId,
      preco_atual: prod?.preco ?? '',
      preco_custo: prod?.custo ?? prod?.preco_custo ?? '',
    }));
  };

  const handleSave = async () => {
    if (!form.produto_id) { showToast('Selecione um produto.', 'error'); return; }
    if (!form.preco_promocional) { showToast('Informe o preço promocional.', 'error'); return; }
    setSaving(true);
    try {
      const prod = produtos.find((p: any) => p.id === form.produto_id);
      const payload = {
        produto_id:        form.produto_id,
        nome_produto:      prod?.nome ?? '',
        preco_atual:       Number(form.preco_atual || 0),
        preco_custo:       Number(form.preco_custo || 0),
        preco_promocional: Number(form.preco_promocional),
        data_inicio:       form.data_inicio  || null,
        data_fim:          form.data_fim     || null,
        descricao:         form.descricao    || null,
        status:            'Aguardando Aprovação',
        nome_criador:      profile?.nome ?? '',
      };
      const created = await dbInsert('/api/marketingpromocoesview', payload);
      setData((prev: any[]) => [created, ...prev]);
      showToast('Proposta enviada ao Financeiro para aprovação!', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch {
      showToast('Erro ao enviar proposta.', 'error');
    }
    setSaving(false);
  };

  const exportCols = ['Produto', 'Preço Atual', 'Preço Promo', 'Início', 'Fim', 'Status'];
  const exportRows = () => promocoes.map((p: any) => [
    p.nome_produto ?? '',
    `R$ ${Number(p.preco_atual || 0).toFixed(2)}`,
    `R$ ${Number(p.preco_promocional || 0).toFixed(2)}`,
    p.data_inicio ?? '—',
    p.data_fim    ?? '—',
    p.status,
  ]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Promoções</h2>
        <p className="text-sm text-gray-400 mt-1">Proponha preços promocionais e acompanhe a aprovação pelo Financeiro.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex gap-3">
          {promocoes.length > 0 && (
            <>
              <ExportButton label="PDF"   onClick={() => exportToPDF('Promoções', exportCols, exportRows(), 'logmax-promocoes')} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('Promoções', exportCols, exportRows(), 'logmax-promocoes')} icon={Sheet} />
            </>
          )}
        </div>
        <NeuButtonAccent variant="" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} />Nova Proposta
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 overflow-hidden">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Nova Proposta de Promoção</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Produto *</label>
                <select value={form.produto_id} onChange={e => handleProductChange(e.target.value)} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecione um produto...</option>
                  {produtosAtivos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Preço de Venda Atual</label>
                <input type="number" value={form.preco_atual} readOnly
                  className="neu-input rounded-xl px-3 py-2.5 text-sm opacity-50 cursor-not-allowed" placeholder="Auto" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Preço Promocional (R$) *</label>
                <input type="number" value={form.preco_promocional} onChange={e => setForm((f: any) => ({ ...f, preco_promocional: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="0,00" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início da Campanha</label>
                <input type="date" value={form.data_inicio} onChange={e => setForm((f: any) => ({ ...f, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim da Campanha</label>
                <input type="date" value={form.data_fim} onChange={e => setForm((f: any) => ({ ...f, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição da Campanha</label>
                <input type="text" value={form.descricao} onChange={e => setForm((f: any) => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Promoção de verão" />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Enviando...' : 'Enviar para Aprovação'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden shrink-0">
        {promocoes.length === 0 ? <EmptyState message="Nenhuma proposta criada ainda" /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Produto</th>
                  <th className="pb-4 font-bold px-4 text-right">Preço Atual</th>
                  <th className="pb-4 font-bold px-4 text-right">Preço Promo</th>
                  <th className="pb-4 font-bold px-4">Período</th>
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4">Observação</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {promocoes.map((p: any) => {
                    const style = STATUS_STYLE[p.status];
                    return (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.nome_produto ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">
                          R$ {Number(p.preco_atual || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-accent font-bold text-right">
                          R$ {Number(p.preco_promocional || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">
                          {p.data_inicio ?? '—'}{p.data_fim ? ` → ${p.data_fim}` : ''}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 max-w-[150px] truncate">{p.descricao ?? '—'}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${style?.badge ?? ''}`}>
                            {style?.icon}{p.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500 max-w-[140px] truncate">{p.observacao ?? '—'}</td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
