import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Edit2, Trash2, Check, ChevronRight } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent } from '../components/ui';
import { hasSetor } from '../lib/rbac';

const COR_PRESETS = [
  '#D4AF37','#22c55e','#3b82f6','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#ec4899','#f97316','#6b7280',
];

const EMPTY = { nome: '', cor: '#D4AF37', icone: '📦' };

// ── Picker de cor reutilizável ────────────────────────────────────────────────
function CorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COR_PRESETS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full transition-all ${value === c ? 'ring-2 ring-offset-1 ring-offset-black ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
          style={{ background: c }} />
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="w-6 h-6 rounded-full cursor-pointer border-0 bg-transparent" title="Cor livre" />
    </div>
  );
}

// ── Mini-form inline ──────────────────────────────────────────────────────────
function InlineForm({ initial, onSave, onCancel, saving }: {
  initial: typeof EMPTY; onSave: (v: typeof EMPTY) => void;
  onCancel: () => void; saving: boolean;
}) {
  const [f, setF] = useState(initial);
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="neu-flat border border-accent/20 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <FormField label="Nome *">
            <input className="neu-input w-full text-sm" value={f.nome}
              onChange={e => setF(p => ({ ...p, nome: e.target.value }))}
              placeholder="Ex: Alimentos, Smartphones…" autoFocus />
          </FormField>
        </div>
        <FormField label="Ícone">
          <input className="neu-input w-full text-xl text-center" value={f.icone}
            onChange={e => setF(p => ({ ...p, icone: e.target.value }))} maxLength={4} />
        </FormField>
      </div>
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Cor</p>
        <CorPicker value={f.cor} onChange={c => setF(p => ({ ...p, cor: c }))} />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="neu-button px-3 py-1.5 text-sm rounded-lg text-gray-400">Cancelar</button>
        <NeuButtonAccent onClick={() => onSave(f)} disabled={saving || !f.nome.trim()} className="flex items-center gap-1.5 text-sm">
          {saving ? '…' : <><Save size={13} /> Salvar</>}
        </NeuButtonAccent>
      </div>
    </motion.div>
  );
}

// ── Painel de Categorias ──────────────────────────────────────────────────────
function PainelCategorias({ canEdit, selectedId, onSelect }: {
  canEdit: boolean; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const { data, isLoading, reload } = useFetchData<any>('categorias_produto');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (f: typeof EMPTY) => {
    setSaving(true);
    try {
      if (editItem) await dbUpdate('categorias_produto', editItem.id, f);
      else          await dbInsert('categorias_produto', f);
      reload(); setEditItem(null); setShowForm(false);
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`Excluir categoria "${item.nome}"? Subcategorias e vínculos serão removidos.`)) return;
    await dbDelete('categorias_produto', item.id);
    reload();
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Categorias</p>
        {canEdit && (
          <NeuButtonAccent onClick={() => { setEditItem(null); setShowForm(true); }} className="text-xs flex items-center gap-1 px-2 py-1">
            <Plus size={12} /> Nova
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {(showForm && !editItem) && (
          <InlineForm initial={{ ...EMPTY }} onSave={handleSave} onCancel={() => setShowForm(false)} saving={saving} />
        )}
      </AnimatePresence>

      {data.length === 0 ? (
        <EmptyState message="Nenhuma categoria ainda." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.map((cat: any) => (
            <div key={cat.id}>
              <AnimatePresence>
                {editItem?.id === cat.id && (
                  <InlineForm initial={{ nome: cat.nome, cor: cat.cor, icone: cat.icone }}
                    onSave={async f => { await handleSave({ ...f }); }}
                    onCancel={() => setEditItem(null)} saving={saving} />
                )}
              </AnimatePresence>
              {editItem?.id !== cat.id && (
                <button onClick={() => onSelect(cat.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all text-left
                    ${selectedId === cat.id ? 'neu-pressed border border-accent/30' : 'neu-flat border border-white/5 hover:border-accent/20'}
                    ${!cat.ativo ? 'opacity-40' : ''}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: cat.cor + '22', border: `1px solid ${cat.cor}44` }}>
                    {cat.icone}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-200 truncate">{cat.nome}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: cat.cor }} />
                      <span className="text-[10px] text-gray-500 font-mono">{cat.cor}</span>
                    </div>
                  </div>
                  {selectedId === cat.id && <ChevronRight size={14} className="text-accent flex-shrink-0" />}
                  {canEdit && selectedId !== cat.id && (
                    <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditItem(cat); setShowForm(false); }}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent transition-colors">
                        <Edit2 size={11} />
                      </button>
                      <button onClick={() => handleDelete(cat)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Painel de Subcategorias ───────────────────────────────────────────────────
function PainelSubcategorias({ categoriaId, categoriaNome, canEdit }: {
  categoriaId: string; categoriaNome: string; canEdit: boolean;
}) {
  const { data, isLoading, reload } = useFetchData<any>(
    'subcategorias_produto', { categoria_id: categoriaId }
  );
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (f: typeof EMPTY) => {
    setSaving(true);
    try {
      if (editItem) await dbUpdate('subcategorias_produto', editItem.id, { nome: f.nome, cor: f.cor, icone: f.icone });
      else          await dbInsert('subcategorias_produto', { ...f, categoria_id: categoriaId });
      reload(); setEditItem(null); setShowForm(false);
    } finally { setSaving(false); }
  };

  const handleToggle = async (item: any) => {
    await dbUpdate('subcategorias_produto', item.id, { ativo: !item.ativo });
    reload();
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`Excluir subcategoria "${item.nome}"?`)) return;
    await dbDelete('subcategorias_produto', item.id);
    reload();
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Subcategorias</p>
          <p className="text-xs text-accent mt-0.5">{categoriaNome}</p>
        </div>
        {canEdit && (
          <NeuButtonAccent onClick={() => { setEditItem(null); setShowForm(true); }} className="text-xs flex items-center gap-1 px-2 py-1">
            <Plus size={12} /> Nova
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {(showForm && !editItem) && (
          <InlineForm initial={{ ...EMPTY }} onSave={handleSave} onCancel={() => setShowForm(false)} saving={saving} />
        )}
      </AnimatePresence>

      {data.length === 0 ? (
        <EmptyState message="Nenhuma subcategoria nesta categoria." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.map((sub: any) => (
            <div key={sub.id}>
              <AnimatePresence>
                {editItem?.id === sub.id && (
                  <InlineForm initial={{ nome: sub.nome, cor: sub.cor, icone: sub.icone }}
                    onSave={handleSave} onCancel={() => setEditItem(null)} saving={saving} />
                )}
              </AnimatePresence>
              {editItem?.id !== sub.id && (
                <div className={`flex items-center gap-2.5 px-3 py-2.5 neu-flat border border-white/5 rounded-xl ${!sub.ativo ? 'opacity-40' : ''}`}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: sub.cor + '22', border: `1px solid ${sub.cor}44` }}>
                    {sub.icone}
                  </div>
                  <p className="flex-1 text-sm font-medium text-gray-200 truncate">{sub.nome}</p>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button onClick={() => handleToggle(sub)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${sub.ativo ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-600 hover:bg-white/5'}`}>
                        <Check size={11} />
                      </button>
                      <button onClick={() => { setEditItem(sub); setShowForm(false); }}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent transition-colors">
                        <Edit2 size={11} />
                      </button>
                      <button onClick={() => handleDelete(sub)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── View principal ────────────────────────────────────────────────────────────
export const CategoriasProdutoView = ({ profile, showToast }: { profile: any; showToast: any }) => {
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [selectedCatNome, setSelectedCatNome] = useState('');

  const canEdit = profile?.role === 'admin' || profile?.role === 'ceo' || hasSetor(profile, 'logistica');

  const handleSelect = (id: string) => {
    if (selectedCatId === id) { setSelectedCatId(null); setSelectedCatNome(''); return; }
    setSelectedCatId(id);
    // busca nome da categoria pelo id — o PainelCategorias já tem os dados mas
    // não os expõe; usamos o botão que chama este handler com o item
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-gray-100">Categorias e Subcategorias</h1>
        <p className="text-sm text-gray-500 mt-1">
          Estrutura de categorias usada em Produtos, Orçamento e Marketing.
          {canEdit ? ' Restrito a Logística / Admin / CEO.' : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Categorias */}
        <div className="neu-flat border border-white/5 rounded-xl p-4">
          <_PainelCategoriasWrapper canEdit={canEdit} selectedId={selectedCatId}
            onSelect={(id, nome) => { setSelectedCatId(id); setSelectedCatNome(nome); }} />
        </div>

        {/* Subcategorias */}
        <div className="neu-flat border border-white/5 rounded-xl p-4">
          {selectedCatId ? (
            <PainelSubcategorias categoriaId={selectedCatId} categoriaNome={selectedCatNome} canEdit={canEdit} />
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <ChevronRight size={28} className="text-gray-700" />
              <p className="text-sm text-gray-500">Selecione uma categoria para gerenciar suas subcategorias</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// Wrapper que intercepta onSelect para capturar também o nome
function _PainelCategoriasWrapper({ canEdit, selectedId, onSelect }: {
  canEdit: boolean; selectedId: string | null;
  onSelect: (id: string, nome: string) => void;
}) {
  const { data, isLoading, reload } = useFetchData<any>('categorias_produto');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (f: typeof EMPTY) => {
    setSaving(true);
    try {
      if (editItem) await dbUpdate('categorias_produto', editItem.id, f);
      else          await dbInsert('categorias_produto', f);
      reload(); setEditItem(null); setShowForm(false);
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`Excluir categoria "${item.nome}"? Subcategorias e vínculos serão removidos.`)) return;
    await dbDelete('categorias_produto', item.id);
    reload();
  };

  const handleToggle = async (item: any) => {
    await dbUpdate('categorias_produto', item.id, { ativo: !item.ativo });
    reload();
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Categorias</p>
        {canEdit && (
          <NeuButtonAccent onClick={() => { setEditItem(null); setShowForm(true); }} className="text-xs flex items-center gap-1 px-2 py-1">
            <Plus size={12} /> Nova
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {showForm && !editItem && (
          <InlineForm initial={{ ...EMPTY }} onSave={handleSave} onCancel={() => setShowForm(false)} saving={saving} />
        )}
      </AnimatePresence>

      {data.length === 0 ? (
        <EmptyState message="Nenhuma categoria ainda." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.map((cat: any) => (
            <div key={cat.id}>
              <AnimatePresence>
                {editItem?.id === cat.id && (
                  <InlineForm initial={{ nome: cat.nome, cor: cat.cor, icone: cat.icone }}
                    onSave={handleSave} onCancel={() => setEditItem(null)} saving={saving} />
                )}
              </AnimatePresence>
              {editItem?.id !== cat.id && (
                <button onClick={() => onSelect(cat.id, cat.nome)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all text-left
                    ${selectedId === cat.id ? 'neu-pressed border border-accent/30' : 'neu-flat border border-white/5 hover:border-accent/20'}
                    ${!cat.ativo ? 'opacity-40' : ''}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: cat.cor + '22', border: `1px solid ${cat.cor}44` }}>
                    {cat.icone}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-200 truncate">{cat.nome}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: cat.cor }} />
                      <span className="text-[10px] text-gray-500 font-mono">{cat.cor}</span>
                    </div>
                  </div>
                  {selectedId === cat.id
                    ? <ChevronRight size={14} className="text-accent flex-shrink-0" />
                    : canEdit && (
                      <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleToggle(cat)}
                          className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${cat.ativo ? 'text-green-400 hover:bg-green-400/10' : 'text-gray-600 hover:bg-white/5'}`}>
                          <Check size={11} />
                        </button>
                        <button onClick={() => { setEditItem(cat); setShowForm(false); }}
                          className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent transition-colors">
                          <Edit2 size={11} />
                        </button>
                        <button onClick={() => handleDelete(cat)}
                          className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  }
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
