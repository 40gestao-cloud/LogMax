import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, ExportButton, StatusBadge } from '../components/ui';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

export const PlanejamentoOrcamentarioView = ({ showToast: _showToast }: any) => {
  const { data: centros, isLoading: loadingCC } = useFetchData<any>('/api/centroscustoview');
  const { data: requisicoes, isLoading: loadingReq } = useFetchData<any>('/api/requisicoesview');
  const { data: contasPagar, isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview');
  const [search, setSearch] = useState('');

  const isLoading = loadingCC || loadingReq || loadingCP;

  // Para cada centro de custo, conta as requisições abertas cujo campo centro_custo
  // contém o código ou nome do centro (matching flexível)
  const centrosEnriched = centros
    .filter((cc: any) => cc.status === 'Ativo')
    .map((cc: any) => {
      const reqAbertas = requisicoes.filter((r: any) =>
        r.status === 'Pendente' &&
        (r.centro_custo?.toLowerCase().includes(cc.codigo?.toLowerCase()) ||
         r.centro_custo?.toLowerCase().includes(cc.nome?.toLowerCase()))
      );
      const reqTotal = requisicoes.filter((r: any) =>
        r.centro_custo?.toLowerCase().includes(cc.codigo?.toLowerCase()) ||
        r.centro_custo?.toLowerCase().includes(cc.nome?.toLowerCase())
      );
      const orcamento = Number(cc.orcamento || 0);
      // Percentual estimado: cada requisição aberta representa 1% do orçamento como proxy
      const pctUtilizado = orcamento > 0 ? Math.min((reqTotal.length * 500) / orcamento * 100, 100) : 0;
      return { ...cc, reqAbertas: reqAbertas.length, reqTotal: reqTotal.length, pctUtilizado };
    });

  const filtered = centrosEnriched.filter((cc: any) =>
    [cc.codigo, cc.nome, cc.responsavel].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  // KPIs
  const orcamentoTotal = centros.filter((cc: any) => cc.status === 'Ativo').reduce((acc: number, cc: any) => acc + Number(cc.orcamento || 0), 0);
  const comprometido = contasPagar.filter((cp: any) => cp.status !== 'Pago').reduce((acc: number, cp: any) => acc + Number(cp.valor || 0), 0);
  const saldo = orcamentoTotal - comprometido;
  const centrosComReqAberta = centrosEnriched.filter((cc: any) => cc.reqAbertas > 0).length;

  const barColor = (pct: number) =>
    pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500';

  const kpis = [
    { label: 'Orçamento Total', value: `R$ ${orcamentoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'centros ativos', warn: false },
    { label: 'Total Comprometido', value: `R$ ${comprometido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'contas a pagar abertas', warn: comprometido > orcamentoTotal * 0.8 },
    { label: 'Saldo Disponível', value: `R$ ${Math.max(saldo, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, sub: 'estimado', warn: saldo < 0 },
    { label: 'Centros com Req. Abertas', value: centrosComReqAberta, sub: 'aguardando aprovação', warn: centrosComReqAberta > 0 },
  ];

  const exportCols = ['Código', 'Centro de Custo', 'Responsável', 'Orçamento', 'Req. Abertas', 'Req. Total'];
  const exportRows = () => filtered.map((cc: any) => [
    cc.codigo ?? '', cc.nome ?? '', cc.responsavel ?? '',
    `R$ ${Number(cc.orcamento || 0).toFixed(2)}`,
    String(cc.reqAbertas), String(cc.reqTotal),
  ]);

  // Últimos comprometimentos pendentes
  const proximosVencimentos = [...contasPagar]
    .filter((cp: any) => cp.status === 'Pendente' && cp.vencimento)
    .sort((a: any, b: any) => a.vencimento.localeCompare(b.vencimento))
    .slice(0, 5);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Planejamento Orçamentário</h2>
        <p className="text-sm text-gray-400 mt-1">Acompanhe o orçamento por centro de custo e os comprometimentos financeiros.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-xl font-black leading-tight ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
            <p className="text-xs text-gray-600 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Centros de Custo</h3>
        <div className="flex gap-3 items-center">
          {filtered.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={() => exportToPDF('Planejamento Orçamentário', exportCols, exportRows(), 'logmax-orcamento')} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('Orçamento', exportCols, exportRows(), 'logmax-orcamento')} icon={Sheet} />
            </>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar centro..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Tabela de centros */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Código</th>
                <th className="pb-4 font-bold px-4">Centro de Custo</th>
                <th className="pb-4 font-bold px-4">Responsável</th>
                <th className="pb-4 font-bold px-4 text-right">Orçamento</th>
                <th className="pb-4 font-bold px-4 text-right">Req. Abertas</th>
                <th className="pb-4 font-bold px-4">Utilização Est.</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((cc: any) => (
                    <motion.tr key={cc.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{cc.codigo ?? '—'}</td>
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{cc.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{cc.responsavel ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {Number(cc.orcamento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className={`py-3 px-4 text-xs font-mono font-bold text-right ${cc.reqAbertas > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>{cc.reqAbertas}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor(cc.pctUtilizado)}`} style={{ width: `${cc.pctUtilizado}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-gray-500 w-8">{Math.round(cc.pctUtilizado)}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={cc.status} /></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Comprometimentos próximos */}
      {proximosVencimentos.length > 0 && (
        <div className="shrink-0 mb-6">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Próximos Vencimentos — Contas a Pagar</h3>
          <div className="neu-flat rounded-2xl p-5 border border-white/5">
            <div className="flex flex-col gap-3">
              {proximosVencimentos.map((cp: any) => (
                <div key={cp.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold text-gray-200">{cp.descricao ?? '—'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Vence em <span className="font-mono text-gray-400">{cp.vencimento}</span></p>
                  </div>
                  <p className="text-sm font-bold text-gray-200 font-mono">R$ {Number(cp.valor || 0).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
