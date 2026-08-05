import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Tag } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { MatrizConsolidado } from '../components/MatrizConsolidado';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';

type AtributoDef = {
  key: string;
  label: string;
  placeholder?: string;
  req?: boolean;
  type?: 'text' | 'number' | 'select' | 'bool';
  options?: readonly string[];
  wide?: boolean;
};

// Atributos JSONB por nicho — dirige o form de serviços.
// MaxLook (moda): ajustes e customização de peças.
// TechMax (eletrônico): assistência técnica é metade do negócio, então tem
// mais campos (categoria da OS, tempo, marca, garantia).
// SuperMax: mantém genérico — supermercado presta pouco serviço.
const ATRIBUTOS_SERVICO: Record<string, AtributoDef[]> = {
  MaxLook: [
    { key: 'categoria_svc', label: 'Categoria *', type: 'select', req: true,
      options: ['Ajuste de barra', 'Bainha', 'Costura', 'Personalização', 'Lavagem', 'Outro'] as const },
    { key: 'tempo_estimado_min', label: 'Tempo estimado (min)', type: 'number', placeholder: 'Ex: 30' },
    { key: 'garantia_dias', label: 'Garantia (dias)', type: 'number', placeholder: 'Ex: 30' },
  ],
  TechMax: [
    { key: 'categoria_svc', label: 'Categoria *', type: 'select', req: true,
      options: ['Troca de tela', 'Troca de bateria', 'Formatação', 'Reparo de placa', 'Software', 'Instalação', 'Diagnóstico', 'Outro'] as const },
    { key: 'tempo_estimado_min', label: 'Tempo estimado (min)', type: 'number', placeholder: 'Ex: 120' },
    { key: 'marcas_atendidas', label: 'Marcas atendidas', placeholder: 'Ex: Apple, Samsung, Motorola' },
    { key: 'garantia_dias', label: 'Garantia do serviço (dias) *', type: 'number', placeholder: 'Ex: 90', req: true },
    { key: 'requer_peca', label: 'Serviço requer peça de reposição', type: 'bool', wide: true },
  ],
  // SuperMax presta pouco serviço, mas o que presta (entrega, corte no açougue,
  // montagem de cesta) tem duração — e sem campo de tempo o serviço só cabia na
  // descrição, onde nenhuma tela consegue ler.
  SuperMax: [
    { key: 'tempo_estimado_min', label: 'Tempo estimado (min)', type: 'number', placeholder: 'Ex: 15' },
  ],
};

const EMPTY_FORM = {
  codigo: '',
  nome: '',
  tipo: '',
  valor: '',
  status: 'Ativo',
  atributos: {} as Record<string, any>,
};

export const ServicosView = ({ showToast }: { showToast: any }) => {
  const { filialAtiva } = useFilial();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const { data: rawData, setData, isLoading } = useFetchData<any>('/api/servicosview');

  const filial = filialAtiva ?? '';
  const atrDefs = useMemo(() => ATRIBUTOS_SERVICO[filial] ?? [], [filial]);

  const data = useMemo(
    () => rawData.filter((s: any) => s.filial === filial || (!s.filial && !filial)),
    [rawData, filial]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((s: any) =>
      [s.nome, s.codigo, s.tipo, s.atributos?.categoria_svc].some((v: any) =>
        String(v ?? '').toLowerCase().includes(q)
      )
    );
  }, [data, search]);

  if (!filialAtiva) {
    return (
      <MatrizConsolidado
        titulo="Serviços"
        descricao="Visão consolidada dos serviços nas 3 filiais."
        endpoint="/api/servicosview"
        colunas={[
          { key: 'codigo', label: 'Código', render: r => <span className="font-mono text-xs text-accent">{r.codigo ?? '—'}</span> },
          { key: 'nome', label: 'Nome', render: r => <span className="font-semibold text-gray-100">{r.nome ?? '—'}</span> },
          { key: 'tipo', label: 'Tipo' },
          { key: 'valor', label: 'Valor', render: r => r.valor != null ? `R$ ${Number(r.valor).toFixed(2).replace('.', ',')}` : '—' },
          { key: 'status', label: 'Status' },
        ]}
        ordenarPor={(a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''))}
      />
    );
  }
  if (isLoading) return <LoadingSpinner />;

  const openNew = () => {
    setEditItem(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    // A TechMax cadastrava em horas, o que não escreve "troca de bateria: 40
    // min". Agora é minuto em todas as unidades; o serviço antigo entra
    // convertido, porque salvar só grava os campos declarados — sem isto o
    // tempo desapareceria na primeira edição.
    const atrs: Record<string, any> =
      (item.atributos && typeof item.atributos === 'object') ? { ...item.atributos } : {};
    if (atrs.tempo_estimado_min == null && atrs.tempo_estimado_horas != null) {
      const h = Number(atrs.tempo_estimado_horas);
      if (Number.isFinite(h) && h > 0) atrs.tempo_estimado_min = Math.round(h * 60);
    }
    setForm({
      codigo: item.codigo ?? '',
      nome:   item.nome   ?? '',
      tipo:   item.tipo   ?? '',
      valor:  item.valor != null ? formatBRL(Number(item.valor)) : '',
      status: item.status ?? 'Ativo',
      atributos: atrs,
    });
    setErrors({});
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.codigo.trim()) e.codigo = 'Obrigatório';
    if (!form.nome.trim())   e.nome   = 'Obrigatório';
    if (!form.valor.trim())  e.valor  = 'Obrigatório';
    for (const d of atrDefs) {
      if (!d.req) continue;
      const v = form.atributos?.[d.key];
      if (v === undefined || v === null || String(v).trim() === '') {
        e[`atr_${d.key}`] = 'Obrigatório';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      showToast('Preencha todos os campos obrigatórios.', 'error', true);
      return;
    }
    setIsSaving(true);
    try {
      // Filtra atributos apenas com campos declarados na filial atual —
      // evita salvar lixo se filial mudou no meio do fluxo.
      const atributos: Record<string, any> = {};
      for (const d of atrDefs) {
        const v = form.atributos?.[d.key];
        if (v === undefined || v === null || v === '') continue;
        atributos[d.key] = d.type === 'bool' ? !!v : d.type === 'number' ? Number(v) : v;
      }
      const payload: any = {
        codigo: form.codigo,
        nome:   form.nome,
        tipo:   form.tipo || null,
        valor:  parseBRL(form.valor),
        status: form.status,
        filial,
        atributos,
      };
      if (editItem) {
        const updated = await dbUpdate('/api/servicosview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Serviço atualizado!', 'success', true);
      } else {
        const saved = await dbInsert<any>('/api/servicosview', payload);
        if (saved) setData((prev: any[]) => [saved, ...prev]);
        showToast('Serviço cadastrado!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao salvar.', 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, nome: string) => {
    const ok = await confirm({
      message: `Excluir o serviço "${nome}"? Essa ação é permanente.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await dbDelete('/api/servicosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Serviço excluído.', 'success', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao excluir.', 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-accent tracking-tight">Serviços — {filial}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {filial === 'MaxLook' && 'Ajustes, customizações e cuidados de peças.'}
            {filial === 'TechMax' && 'Assistência técnica: reparos, trocas e diagnósticos.'}
            {filial === 'SuperMax' && 'Serviços do supermercado.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <BotaoModeloPlanilha entidade="servicos" filial={filial} showToast={showToast} />
          <NeuButtonAccent onClick={openNew}><Plus size={14} /> Novo serviço</NeuButtonAccent>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input className="neu-input py-2 pl-9 pr-3 rounded-xl text-sm w-full"
          placeholder="Buscar por nome, código, categoria..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={`Nenhum serviço cadastrado para ${filial}. Clique em "Novo serviço" para começar.`} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s: any) => (
            <motion.div key={s.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono font-bold text-gray-500 uppercase tracking-widest">{s.codigo}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-sm font-bold text-gray-100 mt-1 leading-tight">{s.nome}</p>
                  {s.atributos?.categoria_svc && (
                    <p className="text-[11px] text-accent font-bold mt-1 uppercase tracking-wider">
                      {s.atributos.categoria_svc}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(s)} className="neu-button p-1.5 rounded-lg text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                  <button onClick={() => handleDelete(s.id, s.nome)} className="neu-button p-1.5 rounded-lg text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                {s.atributos?.tempo_estimado_min && <span>⏱ {s.atributos.tempo_estimado_min} min</span>}
                {s.atributos?.tempo_estimado_horas && <span>⏱ {s.atributos.tempo_estimado_horas} h</span>}
                {s.atributos?.marcas_atendidas && <span>🏷 {s.atributos.marcas_atendidas}</span>}
                {s.atributos?.garantia_dias && <span>🛡 {s.atributos.garantia_dias} dias</span>}
                {s.atributos?.requer_peca && <span>🔩 requer peça</span>}
              </div>
              <div className="flex items-end justify-between mt-1 pt-2 border-t border-white/5">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Valor</span>
                <span className="text-lg font-black text-accent tabular-nums">
                  {Number(s.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}>
            <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              className="neu-flat rounded-3xl w-full max-w-2xl p-6 flex flex-col gap-4 border border-white/5 max-h-[90vh] overflow-y-auto"
              style={{ background: 'var(--color-bg-base)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-accent">{editItem ? 'Editar serviço' : 'Novo serviço'} — {filial}</h3>
                <button onClick={closeForm} className="text-xs text-gray-500 hover:text-white">Fechar</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Código *" error={errors.codigo}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.codigo ? 'border border-red-500/40' : ''}`}
                    value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                    placeholder={filial === 'TechMax' ? 'Ex: SRV-TL-001' : filial === 'MaxLook' ? 'Ex: SRV-AJ-001' : 'Ex: SRV-001'} />
                </FormField>
                <FormField label="Nome do serviço *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                    value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder={filial === 'TechMax' ? 'Ex: Troca de tela iPhone 12' : filial === 'MaxLook' ? 'Ex: Ajuste de bainha calça jeans' : 'Ex: Instalação'} />
                </FormField>
                <FormField label="Valor (R$) *" error={errors.valor}>
                  <input type="text" inputMode="numeric" onKeyDown={handleMoneyKeyDown}
                    className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${errors.valor ? 'border border-red-500/40' : ''}`}
                    value={form.valor} onChange={e => setForm(f => ({ ...f, valor: formatBRL(parseBRL(e.target.value)) }))}
                    placeholder="0,00" />
                </FormField>
                <FormField label="Status">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="Ativo">Ativo</option>
                    <option value="Inativo">Inativo</option>
                  </select>
                </FormField>
              </div>

              {/* Atributos nicho — MaxLook e TechMax. SuperMax fica sem seção extra. */}
              {atrDefs.length > 0 && (
                <div className="mt-2 pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag size={12} className="text-accent" />
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      {filial === 'MaxLook' ? 'Detalhes do serviço (Ateliê)'
                        : filial === 'TechMax' ? 'Detalhes da OS (Assistência)'
                        : 'Detalhes do serviço'}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {atrDefs.map(d => {
                      const errKey = `atr_${d.key}`;
                      const err = errors[errKey];
                      const val = form.atributos?.[d.key] ?? '';
                      const setAtr = (v: any) => {
                        setForm(f => ({ ...f, atributos: { ...(f.atributos ?? {}), [d.key]: v } }));
                        setErrors(ev => ({ ...ev, [errKey]: '' }));
                      };
                      if (d.type === 'bool') {
                        return (
                          <label key={d.key}
                            className={`flex items-center gap-3 cursor-pointer neu-flat rounded-xl px-4 py-3 border border-white/5 ${d.wide ? 'sm:col-span-2' : ''}`}>
                            <input type="checkbox" checked={!!val}
                              onChange={e => setAtr(e.target.checked)}
                              className="accent-accent w-4 h-4" />
                            <span className="text-xs font-bold text-gray-200">{d.label}</span>
                          </label>
                        );
                      }
                      if (d.type === 'select' && d.options) {
                        return (
                          <FormField key={d.key} label={d.label} error={err}>
                            <select className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
                              value={String(val)} onChange={e => setAtr(e.target.value)}>
                              <option value="">— Selecione —</option>
                              {d.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </FormField>
                        );
                      }
                      return (
                        <FormField key={d.key} label={d.label} error={err}>
                          <input className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
                            type={d.type === 'number' ? 'number' : 'text'}
                            inputMode={d.type === 'number' ? 'numeric' : undefined}
                            value={String(val)} onChange={e => setAtr(e.target.value)}
                            placeholder={d.placeholder} />
                        </FormField>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button onClick={closeForm} className="neu-button py-2 px-4 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                  <Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
