import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, TrendingUp, Package, Clock, ClipboardCheck } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

type TabId = 'movimentacoes' | 'saldos' | 'vencimentos' | 'inventarios';

export const RelatoriosEstoqueView = ({ showToast: _showToast }: any) => {
  const [activeTab, setActiveTab] = useState<TabId>('movimentacoes');
  const [search, setSearch] = useState('');

  const { data: movimentacoes, isLoading: loadingMov } = useFetchData<any>('/api/movimentacoesestoqueview');
  const { data: saldos, isLoading: loadingSal } = useFetchData<any>('/api/saldosestoqueview');
  const { data: vencimentos, isLoading: loadingVen } = useFetchData<any>('/api/vencimentosestoqueview');
  const { data: inventarios, isLoading: loadingInv } = useFetchData<any>('/api/inventariosestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');

  const enrich = (list: any[]) => list.map((i: any) => ({ ...i, prod: produtos.find((p: any) => p.id === i.produto_id) }));
  const movEnriched = enrich(movimentacoes);
  const venEnriched = enrich(vencimentos);
  const invEnriched = enrich(inventarios);

  const totalMov = movimentacoes.length;
  const entradas = movimentacoes.filter((m: any) => m.tipo === 'Entrada').length;
  const saidas = movimentacoes.filter((m: any) => m.tipo === 'Saída').length;
  const vencimentosCriticos = vencimentos.filter((v: any) => v.status === 'Vencido' || v.status === 'Próximo').length;

  const s = search.toLowerCase();
  const filteredMov = movEnriched.filter((m: any) => [m.prod?.nome, m.tipo, m.origem, m.destino].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredSal = saldos.filter((p: any) => [p.codigo, p.nome, p.status].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredVen = venEnriched.filter((v: any) => [v.prod?.nome, v.lote, v.status].some((x: any) => x?.toLowerCase().includes(s)));
  const filteredInv = invEnriched.filter((i: any) => [i.prod?.nome, i.status].some((v: any) => v?.toLowerCase().includes(s)));

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'movimentacoes', label: 'Movimentações', icon: TrendingUp },
    { id: 'saldos', label: 'Saldos', icon: Package },
    { id: 'vencimentos', label: 'Vencimentos', icon: Clock },
    { id: 'inventarios', label: 'Inventários', icon: ClipboardCheck },
  ];

  const isLoading = activeTab === 'movimentacoes' ? loadingMov
    : activeTab === 'saldos' ? loadingSal
    : activeTab === 'vencimentos' ? loadingVen : loadingInv;

  const activeData = activeTab === 'movimentacoes' ? filteredMov
    : activeTab === 'saldos' ? filteredSal
    : activeTab === 'vencimentos' ? filteredVen : filteredInv;

  const tipoColor = (tipo: string) =>
    tipo === 'Entrada' ? 'bg-green-900/30 text-green-400'
    : tipo === 'Saída' ? 'bg-red-950/50 text-red-500'
    : 'bg-blue-900/30 text-blue-400';

  const statusVencColor = (st: string) =>
    st === 'Vencido' ? 'bg-red-950/50 text-red-500'
    : st === 'Próximo' ? 'bg-yellow-900/30 text-yellow-400'
    : 'bg-green-900/30 text-green-400';

  const handleExportPDF = () => {
    if (activeTab === 'movimentacoes') {
      exportToPDF('Relatório de Movimentações', ['Produto', 'Tipo', 'Qtd', 'Origem', 'Destino', 'Data'],
        filteredMov.map((m: any) => [m.prod?.nome ?? '—', m.tipo ?? '', String(m.qtd ?? ''), m.origem ?? '', m.destino ?? '', m.data ?? '']),
        'logmax-movimentacoes');
    } else if (activeTab === 'saldos') {
      exportToPDF('Relatório de Saldos em Estoque', ['Código', 'Produto', 'Estoque', 'Unidade', 'Preço', 'Status'],
        filteredSal.map((p: any) => [p.codigo ?? '', p.nome ?? '', String(p.estoque ?? 0), p.unidade ?? '', `R$ ${Number(p.preco || 0).toFixed(2)}`, p.status ?? '']),
        'logmax-saldos');
    } else if (activeTab === 'vencimentos') {
      exportToPDF('Relatório de Vencimentos', ['Produto', 'Lote', 'Qtd', 'Vencimento', 'Status'],
        filteredVen.map((v: any) => [v.prod?.nome ?? '—', v.lote ?? '', String(v.qtd ?? ''), v.vencimento ?? '', v.status ?? '']),
        'logmax-vencimentos');
    } else {
      exportToPDF('Relatório de Inventários', ['Produto', 'Qtd Sistema', 'Qtd Contada', 'Diferença', 'Status', 'Data'],
        filteredInv.map((i: any) => {
          const dif = Number(i.diferenca ?? (i.qtd_contada - i.qtd_sistema) ?? 0);
          return [i.prod?.nome ?? '—', String(i.qtd_sistema ?? ''), String(i.qtd_contada ?? ''), String(dif), i.status ?? '', i.data ?? ''];
        }),
        'logmax-inventarios');
    }
  };

  const handleExportExcel = () => {
    if (activeTab === 'movimentacoes') {
      exportToExcel('Movimentações', ['Produto', 'Tipo', 'Qtd', 'Origem', 'Destino', 'Data'],
        filteredMov.map((m: any) => [m.prod?.nome ?? '—', m.tipo ?? '', Number(m.qtd ?? 0), m.origem ?? '', m.destino ?? '', m.data ?? '']),
        'logmax-movimentacoes');
    } else if (activeTab === 'saldos') {
      exportToExcel('Saldos', ['Código', 'Produto', 'Estoque', 'Unidade', 'Preço', 'Status'],
        filteredSal.map((p: any) => [p.codigo ?? '', p.nome ?? '', Number(p.estoque ?? 0), p.unidade ?? '', Number(p.preco || 0), p.status ?? '']),
        'logmax-saldos');
    } else if (activeTab === 'vencimentos') {
      exportToExcel('Vencimentos', ['Produto', 'Lote', 'Qtd', 'Vencimento', 'Status'],
        filteredVen.map((v: any) => [v.prod?.nome ?? '—', v.lote ?? '', Number(v.qtd ?? 0), v.vencimento ?? '', v.status ?? '']),
        'logmax-vencimentos');
    } else {
      exportToExcel('Inventários', ['Produto', 'Qtd Sistema', 'Qtd Contada', 'Diferença', 'Status', 'Data'],
        filteredInv.map((i: any) => {
          const dif = Number(i.diferenca ?? (i.qtd_contada - i.qtd_sistema) ?? 0);
          return [i.prod?.nome ?? '—', Number(i.qtd_sistema ?? 0), Number(i.qtd_contada ?? 0), dif, i.status ?? '', i.data ?? ''];
        }),
        'logmax-inventarios');
    }
  };

  const kpis = [
    { label: 'Total Movimentações', value: totalMov, sub: 'registradas', warn: false },
    { label: 'Entradas', value: entradas, sub: 'no histórico', warn: false },
    { label: 'Saídas', value: saidas, sub: 'no histórico', warn: false },
    { label: 'Vencimentos Críticos', value: vencimentosCriticos, sub: 'próximos ou vencidos', warn: vencimentosCriticos > 0 },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatórios de Estoque</h2>
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de movimentações, saldos, vencimentos e inventários.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-red-500' : 'text-gray-100'}`}>{k.value}</p>
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

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
        <div className="overflow-x-auto overflow-y-auto h-full main-scrollbar">
          {isLoading ? <LoadingSpinner /> : activeData.length === 0 ? <EmptyState /> : (
            <table className="w-full text-left border-collapse">
              {activeTab === 'movimentacoes' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-center">Tipo</th>
                    <th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Origem</th>
                    <th className="pb-4 font-bold px-4">Destino</th><th className="pb-4 font-bold px-4">Data</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredMov.map((m: any) => (
                      <motion.tr key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{m.prod?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${tipoColor(m.tipo)}`}>{m.tipo}</span></td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{m.qtd ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{m.origem || '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{m.destino || '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{m.data ?? '—'}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'saldos' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Código</th><th className="pb-4 font-bold px-4">Produto</th>
                    <th className="pb-4 font-bold px-4 text-right">Estoque</th><th className="pb-4 font-bold px-4">Unidade</th>
                    <th className="pb-4 font-bold px-4 text-right">Preço Unit.</th><th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredSal.map((p: any) => (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${p.estoque === 0 ? 'opacity-60' : ''}`}>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.codigo ?? '—'}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.nome ?? '—'}</td>
                        <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${p.estoque === 0 ? 'text-red-500' : 'text-gray-200'}`}>{p.estoque ?? 0}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{p.unidade ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(p.preco || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'vencimentos' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4">Lote</th>
                    <th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Vencimento</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredVen.map((v: any) => (
                      <motion.tr key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{v.prod?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{v.lote || '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{v.qtd ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{v.vencimento ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusVencColor(v.status)}`}>{v.status}</span></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'inventarios' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd Sistema</th>
                    <th className="pb-4 font-bold px-4 text-right">Qtd Contada</th><th className="pb-4 font-bold px-4 text-right">Diferença</th>
                    <th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredInv.map((i: any) => {
                      const dif = Number(i.diferenca ?? (i.qtd_contada - i.qtd_sistema) ?? 0);
                      return (
                        <motion.tr key={i.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{i.prod?.nome ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{i.qtd_sistema ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">{i.qtd_contada ?? '—'}</td>
                          <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${dif < 0 ? 'text-red-500' : dif > 0 ? 'text-green-400' : 'text-gray-400'}`}>{dif > 0 ? `+${dif}` : dif}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{i.data ?? '—'}</td>
                          <td className="py-3 px-4 text-center"><StatusBadge status={i.status} /></td>
                        </motion.tr>
                      );
                    })}
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
