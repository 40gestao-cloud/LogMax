import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, TrendingUp, TrendingDown, Landmark } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';
import { useFilial } from '../contexts/FilialContext';

type TabId = 'receber' | 'pagar' | 'caixa';

const FILIAIS_REL = ['SuperMax', 'MaxLook', 'TechMax'] as const;

export const RelatoriosFinanceirosView = ({ showToast: _showToast }: any) => {
  const [activeTab, setActiveTab] = useState<TabId>('receber');
  const [search, setSearch] = useState('');
  const [filialFiltro, setFilialFiltro] = useState('');

  // Estar numa filial é o filtro — não uma sugestão que um segundo seletor
  // pode ignorar. Esta tela buscava tudo e oferecia um dropdown próprio com
  // "Todas as filiais" como default; para admin/CEO/gerente, que a RLS não
  // escopa, o resultado era ver as 3 unidades somadas com SuperMax
  // selecionado no topo. As quatro tabelas abaixo têm coluna `filial`
  // (migr. 053, 157, 017), então o recorte vai na query.
  //
  // O dropdown sobrevive só em Matriz (filialAtiva === null), onde consolidar
  // é justamente o ponto e não há filial ativa para herdar.
  const { filialAtiva } = useFilial();
  const ff = filialAtiva ? { filial: filialAtiva } : undefined;

  const { data: receber,    isLoading: loadingRec } = useFetchData<any>('/api/contasreceberview', ff);
  const { data: pagar,      isLoading: loadingPag } = useFetchData<any>('/api/contaspagarview', ff);
  const { data: caixa,      isLoading: loadingCx } = useFetchData<any>('/api/caixabancosview', ff);
  const { data: clientes }    = useFetchData<any>('/api/crmview', ff);
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', ff);

  // Em filial a query já recortou; o dropdown nem aparece. Em Matriz ele
  // vale, e linhas sem filial (legado) seguem passando para não sumirem do
  // consolidado.
  const byFilial = (x: any) => !!filialAtiva || !filialFiltro || !x.filial || x.filial === filialFiltro;

  const receberF    = receber.filter(byFilial);
  const pagarF      = pagar.filter(byFilial);
  const caixaF      = caixa.filter(byFilial);

  const receberEnriched = receberF.map((r: any) => ({ ...r, cli: clientes.find((c: any) => c.id === r.cliente_id) }));
  const pagarEnriched   = pagarF.map((p: any) => ({ ...p, forn: fornecedores.find((f: any) => f.id === p.fornecedor_id) }));

  const totalReceber  = receberF.filter((r: any) => r.status !== 'Pago').reduce((a: number, r: any) => a + Number(r.valor || 0), 0);
  const totalPagar    = pagarF.filter((p: any) => p.status !== 'Pago').reduce((a: number, p: any) => a + Number(p.valor || 0), 0);
  const saldoBancos   = caixaF.filter((c: any) => c.status === 'Ativo').reduce((a: number, c: any) => a + Number(c.saldo || 0), 0);
  const resultado     = totalReceber - totalPagar;

  const kpis = [
    { label: 'A Receber',      value: `R$ ${totalReceber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,  sub: 'contas abertas',      warn: false },
    { label: 'A Pagar',        value: `R$ ${totalPagar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,    sub: 'contas pendentes',    warn: totalPagar > totalReceber },
    { label: 'Saldo em Bancos',value: `R$ ${saldoBancos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,   sub: 'contas ativas',       warn: false },
    { label: 'Resultado Líq.', value: `R$ ${Math.abs(resultado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: resultado >= 0 ? 'superávit' : 'déficit', warn: resultado < 0 },
  ];

  const s = search.toLowerCase();
  const filteredRec  = receberEnriched.filter((r: any) => [r.descricao, r.cli?.nome, r.status].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredPag  = pagarEnriched.filter((p: any) => [p.descricao, p.forn?.nome, p.status].some((v: any) => v?.toLowerCase().includes(s)));
  const filteredCx   = caixaF.filter((c: any) => [c.conta, c.banco, c.tipo].some((v: any) => v?.toLowerCase().includes(s)));

  const isLoading = activeTab === 'receber' ? loadingRec : activeTab === 'pagar' ? loadingPag
    : loadingCx;

  const activeData = activeTab === 'receber' ? filteredRec : activeTab === 'pagar' ? filteredPag
    : filteredCx;

  const tabs = [
    { id: 'receber' as TabId,    label: 'A Receber',  icon: TrendingUp },
    { id: 'pagar' as TabId,      label: 'A Pagar',    icon: TrendingDown },
    { id: 'caixa' as TabId,      label: 'Caixa/Bancos', icon: Landmark },
  ];

  const handleExportPDF = () => {
    if (activeTab === 'receber') {
      exportToPDF('Contas a Receber', ['Cliente', 'Descrição', 'Valor', 'Vencimento', 'Status'],
        filteredRec.map((r: any) => [r.cli?.nome ?? '—', r.descricao ?? '', `R$ ${Number(r.valor || 0).toFixed(2)}`, r.vencimento ?? '', r.status ?? '']),
        'logmax-contas-receber');
    } else if (activeTab === 'pagar') {
      exportToPDF('Contas a Pagar', ['Fornecedor', 'Descrição', 'Valor', 'Vencimento', 'Status'],
        filteredPag.map((p: any) => [p.forn?.nome ?? '—', p.descricao ?? '', `R$ ${Number(p.valor || 0).toFixed(2)}`, p.vencimento ?? '', p.status ?? '']),
        'logmax-contas-pagar');
    } else {
      exportToPDF('Caixa e Bancos', ['Conta', 'Banco', 'Agência', 'Saldo', 'Tipo', 'Status'],
        filteredCx.map((c: any) => [c.conta ?? '', c.banco ?? '', c.agencia ?? '', `R$ ${Number(c.saldo || 0).toFixed(2)}`, c.tipo ?? '', c.status ?? '']),
        'logmax-caixa-bancos');
    }
  };

  const handleExportExcel = () => {
    if (activeTab === 'receber') {
      exportToExcel('A Receber', ['Cliente', 'Descrição', 'Valor', 'Vencimento', 'Status'],
        filteredRec.map((r: any) => [r.cli?.nome ?? '—', r.descricao ?? '', Number(r.valor || 0), r.vencimento ?? '', r.status ?? '']),
        'logmax-contas-receber');
    } else if (activeTab === 'pagar') {
      exportToExcel('A Pagar', ['Fornecedor', 'Descrição', 'Valor', 'Vencimento', 'Status'],
        filteredPag.map((p: any) => [p.forn?.nome ?? '—', p.descricao ?? '', Number(p.valor || 0), p.vencimento ?? '', p.status ?? '']),
        'logmax-contas-pagar');
    } else {
      exportToExcel('Caixa e Bancos', ['Conta', 'Banco', 'Agência', 'Saldo', 'Tipo', 'Status'],
        filteredCx.map((c: any) => [c.conta ?? '', c.banco ?? '', c.agencia ?? '', Number(c.saldo || 0), c.tipo ?? '', c.status ?? '']),
        'logmax-caixa-bancos');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Relatórios Financeiros</h2>
        <p className="text-sm text-gray-400 mt-1">Visão consolidada de contas e posição de caixa.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-xl font-black leading-tight ${k.warn ? 'text-red-500' : 'text-gray-100'}`}>{k.value}</p>
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
        <div className="flex gap-3 items-center flex-wrap">
          {!filialAtiva && (
            <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
              className="neu-input rounded-xl px-3 py-2 text-sm">
              <option value="">Todas as filiais</option>
              {FILIAIS_REL.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {activeData.length > 0 && (
            <>
              <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
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
              {activeTab === 'receber' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Cliente</th><th className="pb-4 font-bold px-4">Descrição</th>
                    <th className="pb-4 font-bold px-4 text-right">Valor</th><th className="pb-4 font-bold px-4">Vencimento</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredRec.map((r: any) => (
                      <motion.tr key={r.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{r.cli?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{r.descricao ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-green-400 font-bold text-right">R$ {Number(r.valor || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{r.vencimento ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={r.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'pagar' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Fornecedor</th><th className="pb-4 font-bold px-4">Descrição</th>
                    <th className="pb-4 font-bold px-4 text-right">Valor</th><th className="pb-4 font-bold px-4">Vencimento</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredPag.map((p: any) => (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.forn?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{p.descricao ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-red-500 font-bold text-right">R$ {Number(p.valor || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.vencimento ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence></tbody>
                </>
              )}
              {activeTab === 'caixa' && (
                <>
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Conta</th><th className="pb-4 font-bold px-4">Banco</th>
                    <th className="pb-4 font-bold px-4">Agência</th><th className="pb-4 font-bold px-4 text-right">Saldo</th>
                    <th className="pb-4 font-bold px-4">Tipo</th><th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody><AnimatePresence>
                    {filteredCx.map((c: any) => (
                      <motion.tr key={c.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-4 text-xs font-mono text-gray-300">{c.conta ?? '—'}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{c.banco ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{c.agencia || '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-green-400 font-bold text-right">R$ {Number(c.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{c.tipo ?? '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={c.status} /></td>
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
