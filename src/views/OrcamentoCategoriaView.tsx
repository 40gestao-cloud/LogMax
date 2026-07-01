import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Edit2, Trash2, Tag, DollarSign, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

const FILIAL_OPCOES = ['Todas', ...FILIAIS_HOLDING];

const COR_PRESETS = [
  '#D4AF37','#22c55e','#3b82f6','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#ec4899','#f97316','#6b7280',
];

const EMPTY_CAT = { nome: '', cor: '#D4AF37', icone: '📦' };

// ── Aba Categorias ────────────────────────────────────────────────────────────
function AbaCategorias({ showToast, canEdit }: { showToast: any; canEdit: boolean }) {
  const { data, isLoading, reload } = useFetchData<any>('categorias_produto');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_CAT });
  const [isSaving, setIsSaving] = useState(false);

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ ...EMPTY_CAT });
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ nome: item.nome, cor: item.cor, icone: item.icone });
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { showToast('Nome é obrigatório.', 'error', true); return; }
    setIsSaving(true);
    try {
      if (editItem) {
        await dbUpdate('categorias_produto', editItem.id, { nome: form.nome.trim(), cor: form.cor, icone: form.icone });
      } else {
        await dbInsert('categorias_produto', { nome: form.nome.trim(), cor: form.cor, icone: form.icone });
      }
      showToast(editItem ? 'Categoria atualizada!' : 'Categoria criada!', 'success', true);
      closeForm();
      reload();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar.', 'error', true);
    } finally { setIsSaving(false); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`Excluir categoria "${item.nome}"? Produtos vinculados perdem a categoria.`)) return;
    try {
      await dbDelete('categorias_produto', item.id);
      showToast('Categoria excluída.', 'success', true);
      reload();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao excluir.', 'error', true);
    }
  };

  const toggleAtivo = async (item: any) => {
    try {
      await dbUpdate('categorias_produto', item.id, { ativo: !item.ativo });
      reload();
    } catch {}
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center gap-2 text-sm">
            <Plus size={16} /> Nova Categoria
          </NeuButtonAccent>
        </div>
      )}

      <AnimatePresence>
        {(showForm || editItem) && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="neu-flat border border-accent/20 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Categoria' : 'Nova Categoria'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <FormField label="Nome da Categoria *">
                  <input className="neu-input w-full"
                    value={form.nome}
                    onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                    placeholder="Ex: Alimentos, Higiene, Limpeza…" />
                </FormField>
              </div>
              <div>
                <FormField label="Ícone (emoji)">
                  <input className="neu-input w-full text-2xl"
                    value={form.icone}
                    onChange={e => setForm(p => ({ ...p, icone: e.target.value }))}
                    maxLength={4} />
                </FormField>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Cor</p>
              <div className="flex gap-2 flex-wrap">
                {COR_PRESETS.map(c => (
                  <button key={c} onClick={() => setForm(p => ({ ...p, cor: c }))}
                    className={`w-7 h-7 rounded-full transition-all ${form.cor === c ? 'ring-2 ring-offset-2 ring-offset-black ring-white scale-110' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: c }} />
                ))}
                <input type="color" value={form.cor}
                  onChange={e => setForm(p => ({ ...p, cor: e.target.value }))}
                  className="w-7 h-7 rounded-full cursor-pointer border-0 bg-transparent"
                  title="Cor personalizada" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={closeForm} className="neu-button px-4 py-2 text-sm rounded-lg text-gray-300">Cancelar</button>
              <NeuButtonAccent onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 text-sm">
                {isSaving ? '…' : <><Save size={14} /> Salvar</>}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {data.length === 0 ? (
        <EmptyState message="Nenhuma categoria cadastrada." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((cat: any) => (
            <motion.div key={cat.id} layout
              className={`neu-flat border rounded-xl p-4 flex items-center gap-3 ${!cat.ativo ? 'opacity-50' : ''}`}
              style={{ borderColor: cat.cor + '44' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: cat.cor + '22', border: `1px solid ${cat.cor}44` }}>
                {cat.icone}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-200 truncate">{cat.nome}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.cor }} />
                  <span className="text-xs text-gray-500 font-mono">{cat.cor}</span>
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button onClick={() => toggleAtivo(cat)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors ${cat.ativo ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-600 hover:bg-white/5'}`}
                    title={cat.ativo ? 'Desativar' : 'Ativar'}>
                    <Check size={13} />
                  </button>
                  <button onClick={() => openEdit(cat)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent hover:bg-accent/10 transition-colors">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => handleDelete(cat)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Aba Orçamento Mensal ──────────────────────────────────────────────────────
function AbaOrcamento({ showToast, canEdit }: { showToast: any; canEdit: boolean }) {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [filial, setFilial] = useState('Todas');
  const [isSaving, setIsSaving] = useState(false);

  // linhas editáveis: { categoria_id, percentual, valor_limite }
  const [linhas, setLinhas] = useState<Record<string, { percentual: string; valor_limite: string }>>({});

  const { data: categorias, isLoading: loadingCats } = useFetchData<any>('categorias_produto');

  const fetchOrcamento = useCallback(async () => {
    if (!categorias.length) return;
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
        percentual:   found?.percentual   != null ? String(found.percentual)   : '',
        valor_limite: found?.valor_limite != null ? formatBRL(Number(found.valor_limite)) : '',
      };
    });
    setLinhas(mapa);
  }, [categorias, mes, ano, filial]);

  useEffect(() => { fetchOrcamento(); }, [fetchOrcamento]);

  const setLinha = (catId: string, field: 'percentual' | 'valor_limite', value: string) => {
    setLinhas(prev => ({ ...prev, [catId]: { ...prev[catId], [field]: value } }));
  };

  const totalPercentual = Object.values(linhas).reduce((acc, l) => acc + (parseFloat(l.percentual) || 0), 0);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const rows = categorias
        .filter((c: any) => c.ativo)
        .map((c: any) => ({
          categoria_id: c.id,
          filial,
          mes,
          ano,
          percentual:   linhas[c.id]?.percentual   ? parseFloat(linhas[c.id].percentual)   : null,
          valor_limite: linhas[c.id]?.valor_limite  ? parseBRL(linhas[c.id].valor_limite)    : null,
        }));

      const { error } = await supabase
        .from('orcamento_mensal_categoria')
        .upsert(rows, { onConflict: 'categoria_id,filial,mes,ano' });

      if (error) throw error;
      showToast('Orçamento salvo!', 'success', true);
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao salvar orçamento.', 'error', true);
    } finally { setIsSaving(false); }
  };

  if (loadingCats) return <LoadingSpinner />;

  const ativas = categorias.filter((c: any) => c.ativo);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="neu-flat border border-white/5 rounded-xl p-4">
        <div className="flex gap-3 flex-wrap items-end">
          {/* Mês */}
          <div className="flex-1 min-w-[180px]">
            <p className="text-xs text-gray-400 mb-1.5">Mês</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setMes(m => m === 1 ? 12 : m - 1)} className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronLeft size={14} />
              </button>
              <select className="neu-input flex-1 text-center text-sm font-semibold"
                value={mes} onChange={e => setMes(Number(e.target.value))}>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <button onClick={() => setMes(m => m === 12 ? 1 : m + 1)} className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {/* Ano */}
          <div className="w-28">
            <p className="text-xs text-gray-400 mb-1.5">Ano</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setAno(a => a - 1)} className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronLeft size={14} />
              </button>
              <span className="flex-1 text-center text-sm font-bold text-gray-200">{ano}</span>
              <button onClick={() => setAno(a => a + 1)} className="neu-button w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-accent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {/* Filial */}
          <div className="flex-1 min-w-[160px]">
            <p className="text-xs text-gray-400 mb-1.5">Filial</p>
            <select className="neu-input w-full text-sm"
              value={filial} onChange={e => setFilial(e.target.value)}>
              {FILIAL_OPCOES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      {ativas.length === 0 ? (
        <EmptyState message="Crie categorias na aba Categorias antes de definir o orçamento." />
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
              {ativas.map((cat: any) => (
                <div key={cat.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-white/2 transition-colors">
                  {/* Categoria */}
                  <div className="col-span-4 flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                      style={{ background: cat.cor + '22', border: `1px solid ${cat.cor}44` }}>
                      {cat.icone}
                    </div>
                    <span className="text-sm font-semibold text-gray-200 truncate">{cat.nome}</span>
                  </div>
                  {/* Percentual */}
                  <div className="col-span-3 flex items-center gap-1.5 justify-center">
                    <input
                      type="number" min="0" max="100" step="0.5"
                      className="neu-input w-20 text-center text-sm font-bold"
                      style={{ color: cat.cor }}
                      value={linhas[cat.id]?.percentual ?? ''}
                      onChange={e => setLinha(cat.id, 'percentual', e.target.value)}
                      disabled={!canEdit}
                      placeholder="0"
                    />
                    <span className="text-gray-500 text-sm">%</span>
                  </div>
                  {/* Valor Limite */}
                  <div className="col-span-5 flex items-center gap-1.5 justify-center">
                    <span className="text-gray-500 text-sm">R$</span>
                    <input
                      type="text" inputMode="numeric"
                      className="neu-input flex-1 max-w-[180px] text-sm text-right"
                      value={linhas[cat.id]?.valor_limite ?? ''}
                      onChange={e => setLinha(cat.id, 'valor_limite', formatBRL(parseBRL(e.target.value)))}
                      onKeyDown={handleMoneyKeyDown}
                      disabled={!canEdit}
                      placeholder="0,00"
                    />
                  </div>
                </div>
              ))}
            </div>
            {/* Total */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-white/10 bg-white/3">
              <div className="col-span-4 text-sm font-bold text-gray-300">Total</div>
              <div className="col-span-3 text-center">
                <span className={`text-sm font-black tabular-nums ${
                  Math.abs(totalPercentual - 100) < 0.01 ? 'text-green-400' :
                  totalPercentual > 100 ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  {totalPercentual.toFixed(1)}%
                </span>
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
    </div>
  );
}

// ── View principal ────────────────────────────────────────────────────────────
export const OrcamentoCategoriaView = ({ showToast, profile }: { showToast: any; profile: any }) => {
  const [aba, setAba] = useState<'categorias' | 'orcamento'>('categorias');
  const canEdit = ['admin', 'ceo', 'gerente'].includes(profile?.role);

  const tabs = [
    { id: 'categorias' as const, label: 'Categorias', icon: <Tag size={15} /> },
    { id: 'orcamento'  as const, label: 'Orçamento Mensal', icon: <DollarSign size={15} /> },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-gray-100">Orçamento por Categoria</h1>
        <p className="text-sm text-gray-500 mt-1">Organize produtos em categorias e defina limites de gasto mensais.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 neu-flat border border-white/5 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setAba(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              aba === t.id ? 'neu-pressed text-accent' : 'text-gray-400 hover:text-gray-200'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={aba} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
          {aba === 'categorias'
            ? <AbaCategorias showToast={showToast} canEdit={canEdit} />
            : <AbaOrcamento  showToast={showToast} canEdit={canEdit} />
          }
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
};
