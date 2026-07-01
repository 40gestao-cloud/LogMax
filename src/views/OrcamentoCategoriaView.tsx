import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Save, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

const FILIAL_OPCOES = ['Todas', ...FILIAIS_HOLDING];

export const OrcamentoCategoriaView = ({ showToast, profile }: { showToast: any; profile: any }) => {
  const now = new Date();
  const [mes, setMes]       = useState(now.getMonth() + 1);
  const [ano, setAno]       = useState(now.getFullYear());
  const [filial, setFilial] = useState('Todas');
  const [catFiltro, setCatFiltro] = useState('');
  const [isSaving, setIsSaving]   = useState(false);

  const canEdit = ['admin','ceo','gerente'].includes(profile?.role);

  const { data: categorias, isLoading: loadingCats } = useFetchData<any>('categorias_produto');
  const { data: subcategorias }                       = useFetchData<any>('subcategorias_produto');

  // linhas: chave = categoria_id, valor = { percentual, valor_limite }
  const [linhas, setLinhas] = useState<Record<string, { percentual: string; valor_limite: string }>>({});

  const fetchOrcamento = useCallback(async () => {
    if (!categorias.length || !supabase) return;
    const { data } = await supabase
      .from('orcamento_mensal_categoria')
      .select('*')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('filial', filial);

    const mapa: Record<string, { percentual: string; valor_limite: string }> = {};
    categorias.forEach((c: any) => {
      const found = (data ?? []).find((r: any) => r.categoria_id === c.id);
      mapa[c.id] = {
        percentual:   found?.percentual   != null ? String(found.percentual)            : '',
        valor_limite: found?.valor_limite != null ? formatBRL(Number(found.valor_limite)) : '',
      };
    });
    setLinhas(mapa);
  }, [categorias, mes, ano, filial]);

  useEffect(() => { fetchOrcamento(); }, [fetchOrcamento]);

  const setLinha = (catId: string, field: 'percentual' | 'valor_limite', value: string) =>
    setLinhas(prev => ({ ...prev, [catId]: { ...prev[catId], [field]: value } }));

  const totalPercentual = Object.values(linhas)
    .reduce((acc, l) => acc + (parseFloat(l.percentual) || 0), 0);

  const handleSave = async () => {
    if (!supabase) { showToast('Supabase não configurado.', 'error', true); return; }
    setIsSaving(true);
    try {
      const rows = ativas.map((c: any) => ({
        categoria_id: c.id,
        filial,
        mes,
        ano,
        percentual:   linhas[c.id]?.percentual   ? parseFloat(linhas[c.id].percentual)  : null,
        valor_limite: linhas[c.id]?.valor_limite  ? parseBRL(linhas[c.id].valor_limite)  : null,
      }));
      const { error } = await supabase
        .from('orcamento_mensal_categoria')
        .upsert(rows, { onConflict: 'categoria_id,filial,mes,ano' });
      if (error) throw error;
      showToast('Orçamento salvo!', 'success', true);
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error', true);
    } finally { setIsSaving(false); }
  };

  if (loadingCats) return <LoadingSpinner />;

  // Subcategorias da categoria selecionada no filtro
  const subsDaCat = catFiltro
    ? subcategorias.filter((s: any) => s.categoria_id === catFiltro && s.ativo)
    : [];

  // Categorias ativas; se filtro de categoria selecionado, mostra só ela
  const ativas = categorias.filter((c: any) => c.ativo && (!catFiltro || c.id === catFiltro));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-gray-100">Orçamento por Categoria</h1>
        <p className="text-sm text-gray-500 mt-1">
          Defina limites e percentuais de gasto mensais por categoria.
          Categorias são gerenciadas em <span className="text-accent font-medium">Empresa → Categorias</span>.
        </p>
      </div>

      {/* Filtros */}
      <div className="neu-flat border border-white/5 rounded-xl p-4">
        <div className="flex gap-3 flex-wrap items-end">
          {/* Mês */}
          <div className="flex-1 min-w-[180px]">
            <p className="text-xs text-gray-400 mb-1.5">Mês</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setMes(m => m === 1 ? 12 : m - 1)}
                className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronLeft size={14} />
              </button>
              <select className="neu-input flex-1 text-center text-sm font-semibold"
                value={mes} onChange={e => setMes(Number(e.target.value))}>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <button onClick={() => setMes(m => m === 12 ? 1 : m + 1)}
                className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Ano */}
          <div className="w-28">
            <p className="text-xs text-gray-400 mb-1.5">Ano</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setAno(a => a - 1)}
                className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronLeft size={14} />
              </button>
              <span className="flex-1 text-center text-sm font-bold text-gray-200">{ano}</span>
              <button onClick={() => setAno(a => a + 1)}
                className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Filial */}
          <div className="flex-1 min-w-[140px]">
            <p className="text-xs text-gray-400 mb-1.5">Filial</p>
            <select className="neu-input w-full text-sm" value={filial} onChange={e => setFilial(e.target.value)}>
              {FILIAL_OPCOES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Categoria (filtro) */}
          <div className="flex-1 min-w-[160px]">
            <p className="text-xs text-gray-400 mb-1.5">Categoria</p>
            <select className="neu-input w-full text-sm" value={catFiltro} onChange={e => setCatFiltro(e.target.value)}>
              <option value="">Todas as categorias</option>
              {categorias.filter((c: any) => c.ativo).map((c: any) => (
                <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Subcategorias da categoria filtrada (informativo) */}
        {subsDaCat.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5 flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Subcategorias:</span>
            {subsDaCat.map((s: any) => (
              <span key={s.id} className="text-xs px-2 py-0.5 rounded-full border"
                style={{ background: s.cor + '18', borderColor: s.cor + '44', color: s.cor }}>
                {s.icone} {s.nome}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tabela */}
      {ativas.length === 0 ? (
        <EmptyState message="Nenhuma categoria ativa. Crie categorias em Empresa → Categorias." />
      ) : (
        <>
          <div className="neu-flat border border-white/5 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-white/5 bg-white/3">
              <div className="col-span-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Categoria</div>
              <div className="col-span-3 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">% do Orçamento</div>
              <div className="col-span-5 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Valor Limite (R$)</div>
            </div>

            {/* Linhas */}
            <div className="divide-y divide-white/5">
              {ativas.map((cat: any) => {
                // subcategorias desta categoria (informativo na linha)
                const subs = subcategorias.filter((s: any) => s.categoria_id === cat.id && s.ativo);
                return (
                  <div key={cat.id} className="hover:bg-white/2 transition-colors">
                    <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center">
                      <div className="col-span-4 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                          style={{ background: cat.cor + '22', border: `1px solid ${cat.cor}44` }}>
                          {cat.icone}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-200 truncate">{cat.nome}</p>
                          {subs.length > 0 && (
                            <p className="text-[10px] text-gray-600 truncate">
                              {subs.slice(0, 3).map((s: any) => s.nome).join(' · ')}
                              {subs.length > 3 ? ` +${subs.length - 3}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="col-span-3 flex items-center gap-1.5 justify-center">
                        <input type="number" min="0" max="100" step="0.5"
                          className="neu-input w-20 text-center text-sm font-bold"
                          style={{ color: cat.cor }}
                          value={linhas[cat.id]?.percentual ?? ''}
                          onChange={e => setLinha(cat.id, 'percentual', e.target.value)}
                          disabled={!canEdit} placeholder="0" />
                        <span className="text-gray-500 text-sm">%</span>
                      </div>
                      <div className="col-span-5 flex items-center gap-1.5 justify-center">
                        <span className="text-gray-500 text-sm">R$</span>
                        <input type="text" inputMode="numeric"
                          className="neu-input flex-1 max-w-[180px] text-sm text-right"
                          value={linhas[cat.id]?.valor_limite ?? ''}
                          onChange={e => setLinha(cat.id, 'valor_limite', formatBRL(parseBRL(e.target.value)))}
                          onKeyDown={handleMoneyKeyDown}
                          disabled={!canEdit} placeholder="0,00" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-white/10 bg-white/3">
              <div className="col-span-4 text-sm font-bold text-gray-300">Total</div>
              <div className="col-span-3 text-center">
                <span className={`text-sm font-black tabular-nums ${
                  Math.abs(totalPercentual - 100) < 0.01 ? 'text-green-400'
                  : totalPercentual > 100 ? 'text-red-400' : 'text-yellow-400'
                }`}>{totalPercentual.toFixed(1)}%</span>
              </div>
              <div className="col-span-5 text-center text-xs text-gray-500">
                {Math.abs(totalPercentual - 100) < 0.01
                  ? '✓ 100% distribuído'
                  : totalPercentual > 100
                  ? `⚠ ${(totalPercentual - 100).toFixed(1)}% acima de 100%`
                  : `${(100 - totalPercentual).toFixed(1)}% sem categoria`}
              </div>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <NeuButtonAccent onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 text-sm">
                {isSaving ? '…' : <><Save size={14} /> Salvar Orçamento</>}
              </NeuButtonAccent>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
};
