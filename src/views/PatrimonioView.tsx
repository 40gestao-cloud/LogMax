import React, { useMemo, useState, useEffect } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileDown, Sheet, Package, MapPin, User as UserIcon, Tag } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, ExportButton, FilialBadge, StatusBadge, Pagination, ProdutoThumb, FormField, NeuButtonAccent } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { exportToPDF, exportToExcel, formatBRL, handleMoneyKeyDown, parseBRL } from '../lib/viewUtils';

const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

const fmtData = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco' });
};

const parseNum = (v: string | number | undefined | null): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;

// Migr. 511 — mesma fórmula linear sem residual do gerar_dre, calculada "até
// hoje" (não até o fim de um período de DRE). Só pra mostrar na tela; quem
// decide de verdade pro DRE é o SQL.
const valorContabilAtual = (p: any): number | null => {
  const vidaMeses = Number(p.patrimonio_vida_util_meses);
  if (!vidaMeses || vidaMeses <= 0) return null;
  // `preco_custo` já é o VALOR TOTAL de aquisição (mesma convenção do form
  // de ProdutosView, "Valor de Aquisição") — não multiplica por `estoque`.
  const aquisicao = parseNum(p.preco_custo);
  const dataAquisicao = p.created_at ? new Date(p.created_at) : null;
  if (!dataAquisicao) return null;
  const fim = p.patrimonio_baixado_em ? new Date(p.patrimonio_baixado_em) : new Date();
  const dias = Math.max(0, (fim.getTime() - dataAquisicao.getTime()) / 86400000);
  const fracaoRestante = Math.max(0, 1 - dias / (vidaMeses * 30));
  return Math.round(aquisicao * fracaoRestante * 100) / 100;
};

const PatrimonioViewInner = ({ filial, showToast }: { filial: FilialOp; showToast: (msg: string, type?: string, persist?: boolean) => void }) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const baseFilter = useMemo(() => ({ tipo: 'patrimonio', filial }), [filial]);

  const { data, isLoading, totalCount, reload, error } = useFetchData<any>(
    '/api/patrimonioview',
    baseFilter,
    false,
    {
      page,
      searchTerm: debouncedSearch,
      searchColumns: ['nome', 'codigo', 'patrimonio_numero', 'patrimonio_responsavel', 'patrimonio_localizacao'],
    }
  );

  const totalValor = useMemo(
    () => data.reduce((s, p: any) => s + parseNum(p.preco_custo), 0),
    [data]
  );

  const exportCols = ['Tag', 'Código', 'Nome', 'Responsável', 'Localização', 'Filial', 'Valor', 'Aquisição', 'Status'];
  const exportRows = () => data.map((p: any) => [
    p.patrimonio_numero ?? '—',
    p.codigo ?? '',
    p.nome ?? '',
    p.patrimonio_responsavel ?? '—',
    p.patrimonio_localizacao ?? '—',
    p.filial ?? '—',
    p.preco_custo != null ? fmtBRL(parseNum(p.preco_custo)) : '—',
    fmtData(p.created_at),
    p.status ?? 'Ativo',
  ]);
  const handleExportPDF = () => exportToPDF('Controle de Patrimônio', exportCols, exportRows(), 'logmax-patrimonio');
  const handleExportExcel = () => exportToExcel('Patrimônio', exportCols, exportRows(), 'logmax-patrimonio');

  // Migr. 511 — baixa (venda/descarte) de bem. Não apaga a linha; o RPC
  // cancela contabilmente e o resultado (ganho/perda) aparece no DRE do mês.
  const [baixaItem, setBaixaItem]           = useState<any | null>(null);
  const [baixaMotivo, setBaixaMotivo]       = useState('');
  const [baixaValorVenda, setBaixaValorVenda] = useState('');
  const [baixando, setBaixando]             = useState(false);

  const abrirBaixa = (p: any) => { setBaixaItem(p); setBaixaMotivo(''); setBaixaValorVenda(''); };
  const fecharBaixa = () => { setBaixaItem(null); setBaixaMotivo(''); setBaixaValorVenda(''); };

  const confirmarBaixa = async () => {
    if (!baixaItem || !supabase) return;
    if (!baixaMotivo.trim()) { showToast('Informe o motivo da baixa.', 'error', true); return; }
    setBaixando(true);
    try {
      const { error } = await supabase.rpc('dar_baixa_patrimonio', {
        p_produto_id:  baixaItem.id,
        p_motivo:      baixaMotivo.trim(),
        p_valor_venda: baixaValorVenda ? parseBRL(baixaValorVenda) : null,
      });
      if (error) throw new Error(error.message);
      showToast('Bem baixado.', 'success', true);
      fecharBaixa();
      reload();
    } catch (err: any) {
      showToast(`Erro ao baixar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setBaixando(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Patrimônio — {filial}</h2>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          {data.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={handleExportPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar tag, nome, responsável..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-64"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1.5">
            <Package size={11} /> Itens
          </p>
          <p className="text-2xl font-black text-gray-100">{totalCount ?? data.length}</p>
        </div>
        <div className="neu-flat rounded-2xl p-5 border border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1.5">
            <Tag size={11} /> Valor de Aquisição (página)
          </p>
          <p className="text-2xl font-black text-accent">{fmtBRL(totalValor)}</p>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : (error || data.length === 0) ? <EmptyState error={error} message="Nenhum item de patrimônio cadastrado." /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse md:min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4 w-14">Foto</th>
                  <th className="pb-4 font-bold px-4">Tag</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Código</th>
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4 hidden md:table-cell">Responsável</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Localização</th>
                  <th className="pb-4 font-bold px-4 text-center hidden md:table-cell">Filial</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4 text-right hidden xl:table-cell" title="Migr. 511 — linear, sem residual, calculado até hoje">Vlr. Contábil</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Aquisição</th>
                  <th className="pb-4 font-bold px-4 text-center hidden sm:table-cell">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {data.map((p: any) => {
                    const vc = valorContabilAtual(p);
                    const baixado = p.status === 'Baixado';
                    return (
                    <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4">
                        <ProdutoThumb url={p.imagem_url} size="xs" alt={p.nome} />
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-accent font-bold">{p.patrimonio_numero ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400 hidden sm:table-cell">{p.codigo}</td>
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.nome}</td>
                      <td className="py-3 px-4 text-xs text-gray-300 hidden md:table-cell">
                        {p.patrimonio_responsavel
                          ? <span className="flex items-center gap-1.5"><UserIcon size={11} className="text-gray-500" />{p.patrimonio_responsavel}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-300 hidden lg:table-cell">
                        {p.patrimonio_localizacao
                          ? <span className="flex items-center gap-1.5"><MapPin size={11} className="text-gray-500" />{p.patrimonio_localizacao}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center hidden md:table-cell"><FilialBadge filial={p.filial} /></td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right tabular-nums">
                        {p.preco_custo != null ? fmtBRL(parseNum(p.preco_custo)) : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-right tabular-nums hidden xl:table-cell">
                        {vc != null ? <span className={vc <= 0 ? 'text-gray-600' : 'text-gray-300'}>{fmtBRL(vc)}</span> : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 hidden lg:table-cell">{fmtData(p.created_at)}</td>
                      <td className="py-3 px-4 text-center hidden sm:table-cell"><StatusBadge status={p.status ?? 'Ativo'} /></td>
                      <td className="py-3 px-4 text-right">
                        {!baixado && (
                          <button onClick={() => abrirBaixa(p)} className="neu-button py-1.5 px-3 rounded-lg text-[11px] text-gray-400 hover:text-red-400">
                            Baixar
                          </button>
                        )}
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

      <AnimatePresence>
        {baixaItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={fecharBaixa}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="neu-flat rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 border border-white/10"
              onClick={e => e.stopPropagation()}>
              <div>
                <h3 className="text-lg font-bold text-gray-100">Baixar bem</h3>
                <p className="text-xs text-gray-500 mt-1">{baixaItem.nome} — não apaga a linha, cancela contabilmente. O resultado (ganho ou perda) entra no DRE do mês.</p>
              </div>
              <FormField label="Motivo *">
                <input className="neu-input py-2 px-3 rounded-xl text-sm" value={baixaMotivo}
                  onChange={e => setBaixaMotivo(e.target.value)} placeholder="Ex: vendido, quebrou, obsoleto..." />
              </FormField>
              <FormField label="Valor de venda (opcional)">
                <input className="neu-input py-2 px-3 rounded-xl text-sm" type="text" inputMode="numeric" value={baixaValorVenda}
                  onChange={e => setBaixaValorVenda(formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown}
                  placeholder="R$ 0,00 — vazio = descarte sem venda" />
              </FormField>
              <div className="flex gap-3 justify-end mt-2">
                <button onClick={fecharBaixa} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={confirmarBaixa} isLoading={baixando}>Confirmar baixa</NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const PatrimonioView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <PatrimonioViewInner filial={filialAtiva} showToast={showToast} />;
};
