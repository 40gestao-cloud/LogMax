import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, ClipboardList, ShoppingCart, Package, FileText } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, StatusBadge, UrgenciaBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

type TabId = 'requisicoes' | 'pedidos' | 'recebimentos' | 'notas';

export const RelatoriosComprasView = ({ showToast: _showToast }: any) => {
  const [activeTab, setActiveTab] = useState<TabId>('requisicoes');
  const [search, setSearch] = useState('');

  const { data: requisicoes, isLoading: loadingReq } = useFetchData<any>('/api/requisicoesview');
  const { data: pedidos, isLoading: loadingPed } = useFetchData<any>('/api/pedidosview');
  const { data: recebimentos, isLoading: loadingRec } = useFetchData<any>('/api/recebimentosview');
  const { data: notas, isLoading: loadingNot } = useFetchData<any>('/api/notasrecebidasview');
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores');

  const pedidosEnriched = pedidos.map((p: any) => ({ ...p, forn: fornecedores.find((f: any) => f.id === p.fornecedor_id) }));
  const notasEnriched = notas.map((n: any) => ({ ...n, forn: fornecedores.find((f: any) => f.id === n.fornecedor_id) }));

  const totalReq = requisicoes.length;
  const pendentesReq = requisicoes.filter((r: any) => r.status === 'Pendente').length;
  const pedidosAbertos = pedidos.filter((p: any) => !['Recebido', 'Cancelado'].includes(p.status)).length;
  const valorTotalPedidos = pedidos.reduce((acc: number, p: any) => acc + (Number(p.valor_total) || 0), 0);

  const s = search.toLowerCase();
  const filteredReq = requisicoes.filter((r: any) => [r.item, r.solicitante, r.status, r.urgencia].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredPed = pedidosEnriched.filter((p: any) => [p.forn?.nome, p.status].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredRec = recebimentos.filter((r: any) => [r.status, r.observacao].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredNot = notasEnriched.filter((n: any) => [n.numero_nf, n.forn?.nome, n.status].some((v: any) => v?.toLowerCase().includes(s)));

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'requisicoes', label: 'Requisições', icon: ClipboardList },
    { id: 'pedidos', label: 'Pedidos', icon: ShoppingCart },
    { id: 'recebimentos', label: 'Recebimentos', icon: Package },
    { id: 'notas', label: 'Notas Fiscais', icon: FileText },
  ];

  const isLoading = activeTab === 'requisicoes' ? loadingReq
    : activeTab === 'pedidos' ? loadingPed
    : activeTab === 'recebimentos' ? loadingRec : loadingNot;

  const activeData = activeTab === 'requisicoes' ? filteredReq
    : activeTab === 'pedidos' ? filteredPed
    : activeTab === 'recebimentos' ? filteredRec : filteredNot;

  const handleExportPDF = () => {
    if (activeTab === 'requisicoes') {
      exportToPDF('Relatório de Requisições', ['Item', 'Qtd', 'Solicitante', 'Urgência', 'Centro Custo', 'Status', 'Data'],
        filteredReq.map((r: any) => [r.item ?? '', String(r.qtd ?? ''), r.solicitante ?? '', r.urgencia ?? '', r.centro_custo ?? '', r.status ?? '', r.data ?? '']),
        'logmax-requisicoes');
    } else if (activeTab === 'pedidos') {
      exportToPDF('Relatório de Pedidos', ['Fornecedor', 'Valor Total', 'Prazo Entrega', 'Cond. Pgto', 'Status'],
        filteredPed.map((p: any) => [p.forn?.nome ?? '—', `R$ ${Number(p.valor_total || 0).toFixed(2)}`, p.prazo_entrega ?? '', p.condicao_pgto ?? '', p.status ?? '']),
        'logmax-pedidos');
    } else if (activeTab === 'recebimentos') {
      exportToPDF('Relatório de Recebimentos', ['Data', 'Pedido', 'Qtd Recebida', 'Observação', 'Status'],
        filteredRec.map((r: any) => [r.data ?? '', `#${String(r.pedido_id ?? '').slice(0, 8)}`, String(r.qtd_recebida ?? ''), r.observacao ?? '', r.status ?? '']),
        'logmax-recebimentos');
    } else {
      exportToPDF('Relatório de Notas Fiscais', ['Número NF', 'Fornecedor', 'Valor Total', 'Emissão', 'Status'],
        filteredNot.map((n: any) => [n.numero_nf ?? '', n.forn?.nome ?? '—', `R$ ${Number(n.valor_total || 0).toFixed(2)}`, n.data_emissao ?? '', n.status ?? '']),
        'logmax-notas');
    }
  };

  const handleExportExcel = () => {
    if (activeTab === 'requisicoes') {
      exportToExcel('Requisições', ['Item', 'Qtd', 'Solicitante', 'Urgência', 'Centro Custo', 'Status', 'Data'],
        filteredReq.map((r: any) => [r.item ?? '', Number(r.qtd ?? 0), r.solicitante ?? '', r.urgencia ?? '', r.centro_custo ?? '', r.status ?? '', r.data ?? '']),
        'logmax-requisicoes');
    } else if (activeTab === 'pedidos') {
      exportToExcel('Pedidos', ['Fornecedor', 'Valor Total', 'Prazo Entrega', 'Cond. Pgto', 'Status'],
        filteredPed.map((p: any) => [p.forn?.nome ?? '—', Number(p.valor_total || 0), p.prazo_entrega ?? '', p.condicao_pgto ?? '', p.status ?? '']),
        'logmax-pedidos');
    } else if (activeTab === 'recebimentos') {
      exportToExcel('Recebimentos', ['Data', 'Pedido', 'Qtd Recebida', 'Observação', 'Status'],
        filteredRec.map((r: any) => [r.data ?? '', `#${String(r.pedido_id ?? '').slice(0, 8)}`, Number(r.qtd_recebida ?? 0), r.observacao ?? '', r.status ?? '']),
        'logmax-recebimentos');
    } else {
      exportToExcel('Notas Fiscais', ['Número NF', 'Fornecedor', 'Valor Total', 'Emissão', 'Status'],
        filteredNot.map((n: any) => [n.numero_nf ?? '', n.forn?.nome ?? '—', Number(n.valor_total || 0), n.data_emissao ?? '', n.status ?? '']),
        'logmax-notas');
    }
  };

  const kpis = [
    { label: 'Total Requisições', value: totalReq, sub: 'registradas', warn: false },
    { label: 'Pendentes de Aprovação', value: pendentesReq, sub: 'aguardando', warn: pendentesReq > 0 },
    { label: 'Pedidos em Aberto', value: pedidosAbertos, sub: 'em andamento', warn: false },
    { label: 'Valor Total em Pedidos', value: `R$ ${valorTotalPedidos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'acumulado', warn: false },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Relatórios de Compras</h2>
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de requisições, pedidos, recebimentos e notas fiscais.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex gap-2 flex-wrap">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearch(''); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === t.id ? 'neu-pressed text-accent' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
                <Icon size={14} />{t.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 items-center">
          {activeData.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={handleExportPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex flex-col mb-6 flex-1 min-h-0">
        <div className="overflow-x-auto overflow-y-auto h-full main-scrollbar">
          {isLoading ? <LoadingSpinner /> : activeData.length === 0 ? <EmptyState /> : (
            <table className="w-full text-left border-collapse">
              {activeTab === 'requisicoes' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Item</th><th className="pb-4 font-bold px-4 text-right">Qtd</th>
                    <th className="pb-4 font-bold px-4">Solicitante</th><th className="pb-4 font-bold px-4">Centro Custo</th>
                    <th className="pb-4 font-bold px-4 text-center">Urgência</th><th className="pb-4 font-bold px-4 text-center">Status</th>
                    <th className="pb-4 font-bold px-4">Data</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredReq.map((r: any) => (
                      <motion.tr key={r.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{r.item ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{r.qtd ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{r.solicitante ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{r.centro_custo ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><UrgenciaBadge urgencia={r.urgencia} /></td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={r.status} /></td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{r.data ?? '—'}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'pedidos' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Fornecedor</th><th className="pb-4 font-bold px-4 text-right">Valor Total</th>
                    <th className="pb-4 font-bold px-4">Prazo Entrega</th><th className="pb-4 font-bold px-4">Cond. Pgto</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredPed.map((p: any) => (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(p.valor_total || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.prazo_entrega ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{p.condicao_pgto ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'recebimentos' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4">Pedido</th>
                    <th className="pb-4 font-bold px-4 text-right">Qtd Recebida</th><th className="pb-4 font-bold px-4">Observação</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredRec.map((r: any) => (
                      <motion.tr key={r.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{r.data ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-300">#{String(r.pedido_id ?? '').slice(0, 8)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{r.qtd_recebida ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{r.observacao || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={r.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'notas' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Número NF</th><th className="pb-4 font-bold px-4">Fornecedor</th>
                    <th className="pb-4 font-bold px-4 text-right">Valor Total</th><th className="pb-4 font-bold px-4">Emissão</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredNot.map((n: any) => (
                      <motion.tr key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-xs font-mono text-gray-300">{n.numero_nf ?? '—'}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{n.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(n.valor_total || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{n.data_emissao ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={n.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
            </table>
          )}
        </div>
      </div>
    </motion.div>
  );
};
