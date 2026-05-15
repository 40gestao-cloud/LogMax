import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

const TABS = ['Funcionários', 'Folha de Pagamento', 'Férias', 'Treinamentos'];

const statusCls = (s: string) => {
  if (!s) return 'text-gray-500';
  const lower = s.toLowerCase();
  if (lower.includes('ativo') || lower.includes('paga') || lower.includes('aprovada') || lower.includes('concluí')) return 'bg-green-900/30 text-green-400';
  if (lower.includes('pendente') || lower.includes('solicitada') || lower.includes('agendado')) return 'bg-yellow-900/30 text-yellow-400';
  if (lower.includes('negada') || lower.includes('cancelado') || lower.includes('desligado')) return 'bg-red-900/30 text-red-400';
  return 'bg-gray-700/40 text-gray-400';
};

export const RelatoriosRHView = ({ showToast: _st }: any) => {
  const { data: funcionarios, isLoading: lFun } = useFetchData<any>('/api/funcionariosview');
  const { data: folhas, isLoading: lFol } = useFetchData<any>('/api/folhapagamentoview');
  const { data: ferias, isLoading: lFer } = useFetchData<any>('/api/feriasview');
  const { data: treinamentos, isLoading: lTre } = useFetchData<any>('/api/treinamentosview');
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [mesFiltro, setMesFiltro] = useState('');

  const isLoading = lFun || lFol || lFer || lTre;
  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  // Folhas enriquecidas
  const folhasEnriched = folhas.map((f: any) => ({
    ...f,
    func: funcionarios.find((fn: any) => fn.id === f.funcionario_id),
  }));
  const feriasEnriched = ferias.map((f: any) => ({
    ...f,
    func: funcionarios.find((fn: any) => fn.id === f.funcionario_id),
  }));

  // Filtros por aba
  const filteredFun = funcionarios.filter((f: any) =>
    [f.nome, f.cargo, f.departamento, f.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );
  const filteredFol = folhasEnriched
    .filter((f: any) => !mesFiltro || f.mes_ref === mesFiltro)
    .filter((f: any) => [f.func?.nome, f.mes_ref, f.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));
  const filteredFer = feriasEnriched.filter((f: any) =>
    [f.func?.nome, f.status, f.data_inicio].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );
  const filteredTre = treinamentos.filter((t: any) =>
    [t.nome, t.instrutor, t.status].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  // Totais da folha
  const totalBruto = filteredFol.reduce((acc: number, f: any) => acc + Number(f.salario_bruto || 0), 0);
  const totalLiq = filteredFol.reduce((acc: number, f: any) => acc + Number(f.salario_liquido || 0), 0);

  const exportConfigs: Record<number, { cols: string[], rows: () => string[][] }> = {
    0: {
      cols: ['Nome', 'CPF', 'Cargo', 'Departamento', 'Admissão', 'Salário', 'Status'],
      rows: () => filteredFun.map((f: any) => [f.nome ?? '', f.cpf ?? '', f.cargo ?? '', f.departamento ?? '', f.data_admissao ?? '', `R$ ${Number(f.salario || 0).toFixed(2)}`, f.status ?? '']),
    },
    1: {
      cols: ['Funcionário', 'Mês Ref.', 'Bruto', 'Descontos', 'Líquido', 'Status'],
      rows: () => filteredFol.map((f: any) => [f.func?.nome ?? '—', f.mes_ref ?? '', `R$ ${Number(f.salario_bruto || 0).toFixed(2)}`, `R$ ${Number(f.descontos || 0).toFixed(2)}`, `R$ ${Number(f.salario_liquido || 0).toFixed(2)}`, f.status ?? '']),
    },
    2: {
      cols: ['Funcionário', 'Início', 'Fim', 'Dias', 'Status'],
      rows: () => filteredFer.map((f: any) => [f.func?.nome ?? '—', f.data_inicio ?? '', f.data_fim ?? '', String(f.dias ?? 0), f.status ?? '']),
    },
    3: {
      cols: ['Treinamento', 'Instrutor', 'Início', 'Fim', 'Vagas', 'Inscritos', 'Status'],
      rows: () => filteredTre.map((t: any) => [t.nome ?? '', t.instrutor ?? '', t.data_inicio ?? '', t.data_fim ?? '', String(t.vagas ?? 0), String(t.inscritos ?? 0), t.status ?? '']),
    },
  };

  const currentConfig = exportConfigs[tab];
  const filenameMap = ['logmax-rh-funcionarios', 'logmax-rh-folha', 'logmax-rh-ferias', 'logmax-rh-treinamentos'];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Relatórios — RH</h2>
        <p className="text-sm text-gray-400 mt-1">Consulte e exporte relatórios do módulo de Recursos Humanos.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 shrink-0 flex-wrap">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { setTab(i); setSearch(''); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${tab === i ? 'neu-pressed text-yellow-400' : 'neu-button text-gray-400 hover:text-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex gap-3 items-center flex-wrap">
          <ExportButton label="PDF" onClick={() => exportToPDF(TABS[tab], currentConfig.cols, currentConfig.rows(), filenameMap[tab])} icon={FileDown} />
          <ExportButton label="Excel" onClick={() => exportToExcel(TABS[tab], currentConfig.cols, currentConfig.rows(), filenameMap[tab])} icon={Sheet} />
          {tab === 1 && (
            <input type="month" value={mesFiltro} onChange={e => setMesFiltro(e.target.value)}
              className="neu-input rounded-xl px-3 py-2 text-sm" placeholder="Filtrar mês" />
          )}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)}
            className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52" />
        </div>
      </div>

      {/* Table */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden flex-1">
        <AnimatePresence mode="wait">
          {tab === 0 && (
            <motion.div key="fun" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {filteredFun.length === 0 ? <EmptyState /> : (
                <div className="overflow-x-auto main-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      {['Nome', 'CPF', 'Cargo', 'Departamento', 'Admissão', 'Salário', 'Status'].map(h => <th key={h} className="pb-4 font-bold px-4">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {filteredFun.map((f: any) => (
                        <tr key={f.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.nome ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.cpf ?? '—'}</td>
                          <td className="py-3 px-4 text-xs text-gray-400">{f.cargo ?? '—'}</td>
                          <td className="py-3 px-4 text-xs text-gray-400">{f.departamento ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.data_admissao ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-right text-gray-200">R$ {Number(f.salario || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-center"><StatusBadge status={f.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {tab === 1 && (
            <motion.div key="fol" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {filteredFol.length === 0 ? <EmptyState /> : (
                <div className="overflow-x-auto main-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      {['Funcionário', 'Mês Ref.', 'Bruto', 'Descontos', 'Líquido', 'Status'].map(h => <th key={h} className="pb-4 font-bold px-4">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {filteredFol.map((f: any) => (
                        <tr key={f.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.func?.nome ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.mes_ref ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-right text-gray-300">R$ {Number(f.salario_bruto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-xs font-mono text-right text-red-400">-R$ {Number(f.descontos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-xs font-mono font-bold text-right text-green-400">R$ {Number(f.salario_liquido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(f.status)}`}>{f.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td colSpan={2} className="py-3 px-4 text-xs font-bold text-gray-500 uppercase">Totais</td>
                        <td className="py-3 px-4 text-xs font-mono font-bold text-right text-gray-300">R$ {totalBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td />
                        <td className="py-3 px-4 text-xs font-mono font-bold text-right text-green-400">R$ {totalLiq.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {tab === 2 && (
            <motion.div key="fer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {filteredFer.length === 0 ? <EmptyState /> : (
                <div className="overflow-x-auto main-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      {['Funcionário', 'Início', 'Fim', 'Dias', 'Status'].map(h => <th key={h} className="pb-4 font-bold px-4">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {filteredFer.map((f: any) => (
                        <tr key={f.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.func?.nome ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.data_inicio ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.data_fim ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{f.dias ?? 0}</td>
                          <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(f.status)}`}>{f.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {tab === 3 && (
            <motion.div key="tre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {filteredTre.length === 0 ? <EmptyState /> : (
                <div className="overflow-x-auto main-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      {['Treinamento', 'Instrutor', 'Início', 'Fim', 'Vagas', 'Inscritos', 'Status'].map(h => <th key={h} className="pb-4 font-bold px-4">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {filteredTre.map((t: any) => (
                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{t.nome ?? '—'}</td>
                          <td className="py-3 px-4 text-xs text-gray-400">{t.instrutor ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{t.data_inicio ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{t.data_fim ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{t.vagas ?? 0}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{t.inscritos ?? 0}</td>
                          <td className="py-3 px-4"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(t.status)}`}>{t.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
