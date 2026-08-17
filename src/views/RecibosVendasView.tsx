import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Search, FileDown, Sheet, Lock, Receipt } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, Pagination, ExportButton } from '../components/ui';
import { exportToExcel, gerarReciboVendaPDF } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { supabase } from '../lib/supabase';
import { hasSetor } from '../lib/rbac';
import { garantiaAte } from '../lib/atributosProduto';
import type { UserProfile } from '../hooks/useUserProfile';

export const RecibosVendasView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  if (!hasSetor(profile, 'financeiro') && profile?.role !== 'gerente') {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <Lock size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas Financeiro, gerente da filial, admin ou CEO podem acessar esta visão.</p>
      </div>
    );
  }

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data: vendas, isLoading: loadingV, totalCount, reload } = useFetchData<any>(
    '/api/vendasview', undefined, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['forma_pagamento', 'status'] }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview');

  const [itens, setItens] = useState<any[]>([]);
  const [loadingI, setLoadingI] = useState(false);
  // Ficha dos produtos vendidos, só para a garantia (TechMax). Vem em consulta
  // própria porque `itens_venda` guarda nome e preço, não a ficha do produto —
  // e a ficha muda depois da venda sem reescrever a linha vendida.
  const [fichas, setFichas] = useState<Record<string, any>>({});
  const [unidades, setUnidades] = useState<any[]>([]);
  const vendaIdsKey = vendas.map((v: any) => v.id).join(',');
  useEffect(() => {
    if (!supabase || vendas.length === 0) { setItens([]); setFichas({}); setUnidades([]); return; }
    let cancelled = false;
    setLoadingI(true);
    const ids = vendas.map((v: any) => v.id);
    supabase.from('itens_venda').select('*').in('venda_id', ids).then(async ({ data }) => {
      if (cancelled) return;
      const linhas = data ?? [];
      setItens(linhas);
      const produtoIds = [...new Set(linhas.map((i: any) => i.produto_id).filter(Boolean))];
      if (produtoIds.length && supabase) {
        const { data: prods } = await supabase
          .from('produtos').select('id, atributos').in('id', produtoIds);
        if (!cancelled) {
          setFichas(Object.fromEntries((prods ?? []).map((p: any) => [p.id, p.atributos])));
        }
      } else if (!cancelled) {
        setFichas({});
      }
      // Aparelhos com número de série que saíram nestas vendas (migr. 444).
      // Tabela nova: turma com a migração pendente devolve erro, e aí o recibo
      // sai sem o bloco em vez de não sair.
      if (supabase) {
        const { data: uns, error: unsErr } = await supabase
          .from('produto_unidades')
          .select('venda_id, imei, produto_id')
          .in('venda_id', ids);
        if (!cancelled) setUnidades(unsErr ? [] : (uns ?? []));
      }
      if (!cancelled) setLoadingI(false);
    });
    return () => { cancelled = true; };
  }, [vendaIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = loadingV || loadingI;

  const enriched = useMemo(() => vendas
    .filter((v: any) => v.status !== 'Cancelada')
    .map((v: any) => ({
      ...v,
      cliente: clientes.find((c: any) => c.id === v.cliente_id) ?? null,
      itens: itens.filter((i: any) => i.venda_id === v.id),
    })),
  [vendas, clientes, itens]);

  const totalPeriodo = enriched.reduce((s: number, v: any) => s + Number(v.total_final ?? 0), 0);

  const baixarRecibo = (v: any) => {
    if (!v.itens?.length) {
      showToast?.('Recibo sem itens registrados.', 'error', true);
      return;
    }
    const created = v.created_at ? new Date(v.created_at) : new Date();
    return gerarReciboVendaPDF({
      id: v.id,
      shortId: v.id.slice(-6).toUpperCase(),
      data: created.toLocaleDateString('pt-BR'),
      hora: created.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      filial: v.filial ?? null,
      cliente: v.cliente?.nome ?? null,
      itens: v.itens.map((i: any) => ({
        nome_produto: i.nome_produto ?? '—',
        qtd: Number(i.qtd ?? 0),
        preco_unitario: Number(i.preco_unitario ?? 0),
        subtotal: Number(i.subtotal ?? 0),
      })),
      subtotal: Number(v.total ?? 0),
      desconto: Number(v.desconto ?? 0),
      total: Number(v.total_final ?? 0),
      formaPagamento: v.forma_pagamento ?? '—',
      // Garantia (dias) da ficha do produto vira data no papel que o cliente
      // leva. Item sem garantia cadastrada simplesmente não aparece aqui.
      garantias: v.itens
        .map((i: any) => {
          const ate = garantiaAte(fichas[i.produto_id], created);
          return ate ? { nome: i.nome_produto ?? '—', ate } : null;
        })
        .filter(Boolean) as { nome: string; ate: string }[],
      series: unidades
        .filter((u: any) => u.venda_id === v.id)
        .map((u: any) => ({
          nome: v.itens.find((i: any) => i.produto_id === u.produto_id)?.nome_produto ?? '—',
          imei: u.imei,
        })),
    });
  };

  const exportCols = ['Data', 'Recibo', 'Cliente', 'Filial', 'Forma Pgto', 'Itens', 'Desconto', 'Total'];
  const exportRows = () => enriched.map((v: any) => [
    (v.created_at ?? '').slice(0, 10),
    `#${v.id.slice(-6).toUpperCase()}`,
    v.cliente?.nome ?? 'Balcão',
    v.filial ?? '—',
    v.forma_pagamento ?? '—',
    String(v.itens?.length ?? 0),
    `R$ ${Number(v.desconto ?? 0).toFixed(2)}`,
    `R$ ${Number(v.total_final ?? 0).toFixed(2)}`,
  ]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex justify-between items-start shrink-0 flex-wrap gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Recibos de Vendas</h2>
          <p className="text-sm text-gray-400 mt-1">
            Baixe recibos individuais em PDF ou exporte a listagem em Excel —
            Total: <span className="text-accent font-bold">{totalPeriodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
          </p>
        </div>
        <div className="flex gap-3 items-center flex-wrap w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar (forma, status)..." value={search} onChange={e => setSearch(e.target.value)}
              className="neu-input py-2 pl-9 pr-4 rounded-xl text-xs w-full sm:w-52" />
          </div>
          <ExportButton label="Excel" onClick={() => exportToExcel('Recibos', exportCols, exportRows(), 'logmax-recibos')} icon={Sheet} />
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : enriched.length === 0 ? <EmptyState message="Nenhuma venda concluída." /> : (
        <div className="neu-flat rounded-3xl p-3 sm:p-6 border border-white/5 flex flex-col">
          <div className="overflow-x-auto main-scrollbar">
            {/* Mobile: cards */}
            <div className="sm:hidden flex flex-col gap-3">
              {enriched.map((v: any) => (
                <div key={v.id} className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-100 truncate">#{v.id.slice(-6).toUpperCase()}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{(v.created_at ?? '').slice(0, 16).replace('T', ' ')}</p>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                  <div className="text-xs text-gray-400">
                    {v.cliente?.nome ?? 'Balcão'} · {v.forma_pagamento}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-black text-accent font-mono">
                      {Number(v.total_final ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                    <button onClick={() => baixarRecibo(v)}
                      className="neu-button py-2 px-3 rounded-lg text-xs font-bold text-accent flex items-center gap-1.5 border border-accent/20">
                      <Receipt size={12} /> Recibo PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <table className="hidden sm:table w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Data</th>
                <th className="pb-4 font-bold px-4">Recibo</th>
                <th className="pb-4 font-bold px-4">Cliente</th>
                <th className="pb-4 font-bold px-4">Filial</th>
                <th className="pb-4 font-bold px-4">Forma</th>
                <th className="pb-4 font-bold px-4 text-right">Itens</th>
                <th className="pb-4 font-bold px-4 text-right">Total</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4 text-right">Recibo</th>
              </tr></thead>
              <tbody>
                {enriched.map((v: any) => (
                  <tr key={v.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">{(v.created_at ?? '').slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-300">#{v.id.slice(-6).toUpperCase()}</td>
                    <td className="py-3 px-4 text-sm font-semibold text-gray-200">{v.cliente?.nome ?? 'Balcão'}</td>
                    <td className="py-3 px-4 text-xs text-gray-400">{v.filial ?? '—'}</td>
                    <td className="py-3 px-4 text-xs text-gray-400">{v.forma_pagamento ?? '—'}</td>
                    <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{v.itens?.length ?? 0}</td>
                    <td className="py-3 px-4 text-sm font-mono font-bold text-accent text-right tabular-nums">
                      {Number(v.total_final ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="py-3 px-4 text-center"><StatusBadge status={v.status} /></td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => baixarRecibo(v)}
                        className="ml-auto neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent flex items-center gap-1.5 border border-transparent hover:border-accent/20">
                        <FileDown size={12} /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
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
    </motion.div>
  );
};
