import React, { useEffect, useRef, useState } from 'react';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Landmark, Package as PackageIcon, Paperclip, FileText, X, ExternalLink } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { useConfirm } from '../contexts/ConfirmContext';
import { supabase } from '../lib/supabase';
import {
  NOTA_ANEXO_ACCEPT, NOTA_ANEXO_MAX_LABEL,
  uploadAnexoNota, removerAnexoNota, validarAnexoNota, formatarTamanhoAnexo,
} from '../lib/notaAnexo';

const CATEGORIAS_GASTO = ['Produto', 'Equipamento', 'Mobiliário', 'Aluguel', 'Serviço', 'Outro'] as const;

// Nichos direcionam a categoria default (TechMax presta serviço → Serviço;
// MaxLook/SuperMax compram produto → Produto). Só sugestão; user pode trocar.
const CATEGORIA_DEFAULT_POR_FILIAL: Record<string, typeof CATEGORIAS_GASTO[number]> = {
  SuperMax: 'Produto',
  MaxLook:  'Produto',
  TechMax:  'Serviço',
};

const NotasRecebidasViewInner = ({ showToast, filial }: any) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/notasrecebidasview', { filial });
  const confirm = useConfirm();
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', { filial });
  const { data: contasPagar } = useFetchData<any>('/api/contaspagarview', { filial });
  // Contas a pagar que já têm nota amarrada. `data` é paginada, então esta
  // consulta é a única forma de saber o que já foi usado fora da página 1.
  const [contasComNota, setContasComNota] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('notas_recebidas')
      .select('conta_pagar_id')
      .eq('ativo', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        setContasComNota(new Set(
          (rows ?? []).map((n: any) => n.conta_pagar_id).filter(Boolean) as string[]));
      });
    return () => { cancelled = true; };
  }, [data]);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ numero_nf: '' });
  const [extras, setExtras] = useState({
    fornecedor_id: '',
    valor_total: '',
    data_emissao: '',
    status: 'Não Vinculada',
    categoria_gasto: CATEGORIA_DEFAULT_POR_FILIAL[filial] ?? 'Produto',
    descricao: '',
    conta_pagar_id: '',
    capital_origem: false,
  });
  const [anexo, setAnexo] = useState<{ url: string; nome: string; tamanho: number } | null>(null);
  const [anexoAnterior, setAnexoAnterior] = useState<string | null>(null);
  const [anexoUploading, setAnexoUploading] = useState(false);
  const anexoInputRef = useRef<HTMLInputElement>(null);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((n: any) => ({ ...n, forn: fornecedores.find((f: any) => f.id === n.fornecedor_id) }));
  const filtered = enriched.filter((n: any) => [n.numero_nf, n.status, n.forn?.nome, n.categoria_gasto, n.descricao]
    .some((v: any) => v?.toLowerCase().includes(search.toLowerCase())));

  const resetExtras = () => setExtras({
    fornecedor_id: '',
    valor_total: '',
    data_emissao: '',
    status: 'Não Vinculada',
    categoria_gasto: CATEGORIA_DEFAULT_POR_FILIAL[filial] ?? 'Produto',
    descricao: '',
    conta_pagar_id: '',
    capital_origem: false,
  });

  const closeForm = (opts?: { skipOrphanCleanup?: boolean }) => {
    // Se subiu anexo mas cancelou sem salvar, remove o órfão do bucket.
    if (!opts?.skipOrphanCleanup && anexo && anexo.url !== anexoAnterior) {
      removerAnexoNota(anexo.url).catch(() => {});
    }
    setShowForm(false);
    setEditItem(null);
    setForm({ numero_nf: '' });
    resetExtras();
    setAnexo(null);
    setAnexoAnterior(null);
    setErrors({});
    if (anexoInputRef.current) anexoInputRef.current.value = '';
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ numero_nf: item.numero_nf ?? '' });
    setExtras({
      fornecedor_id: item.fornecedor_id ?? '',
      valor_total: item.valor_total != null && item.valor_total !== '' ? formatBRL(Number(item.valor_total)) : '',
      data_emissao: item.data_emissao ?? '',
      status: item.status ?? 'Não Vinculada',
      categoria_gasto: item.categoria_gasto ?? (CATEGORIA_DEFAULT_POR_FILIAL[filial] ?? 'Produto'),
      descricao: item.descricao ?? '',
      conta_pagar_id: item.conta_pagar_id ?? '',
      capital_origem: !!item.capital_origem,
    });
    if (item.anexo_url) {
      setAnexo({ url: item.anexo_url, nome: item.anexo_nome ?? 'Anexo', tamanho: item.anexo_tamanho ?? 0 });
      setAnexoAnterior(item.anexo_url);
    } else {
      setAnexo(null);
      setAnexoAnterior(null);
    }
    setErrors({});
    setShowForm(false);
  };

  const handleAnexoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const v = validarAnexoNota(file);
    if (!v.ok) { showToast(v.motivo, 'error', true); e.target.value = ''; return; }
    setAnexoUploading(true);
    try {
      const anterior = anexo?.url;
      const novo = await uploadAnexoNota(file, filial, editItem?.id);
      // Se substituiu, apaga o órfão intermediário (o anterior salvo em
      // banco só deve ser apagado APÓS o save bem-sucedido).
      if (anterior && anterior !== anexoAnterior) removerAnexoNota(anterior).catch(() => {});
      setAnexo(novo);
      showToast('Anexo enviado!', 'success', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao enviar anexo.', 'error', true);
    } finally {
      setAnexoUploading(false);
      e.target.value = '';
    }
  };

  const removerAnexoLocal = async () => {
    if (!anexo) return;
    // Só apaga do bucket se for anexo novo (ainda não persistido). Se for
    // o anexo já salvo em banco, marcamos como null e o handleSave apaga.
    if (anexo.url !== anexoAnterior) {
      removerAnexoNota(anexo.url).catch(() => {});
    }
    setAnexo(null);
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true); showToast("Salvando...", 'info', false);
    try {
      const payload = {
        ...form,
        fornecedor_id: extras.fornecedor_id || null,
        valor_total: parseBRL(extras.valor_total),
        data_emissao: extras.data_emissao || null,
        status: extras.status,
        categoria_gasto: extras.categoria_gasto,
        descricao: extras.descricao || null,
        conta_pagar_id: extras.conta_pagar_id || null,
        capital_origem: extras.capital_origem,
        anexo_url: anexo?.url ?? null,
        anexo_nome: anexo?.nome ?? null,
        anexo_tamanho: anexo?.tamanho ?? null,
        filial,
      };
      if (editItem) {
        const u = await dbUpdate('/api/notasrecebidasview', editItem.id, payload);
        setData((p: any[]) => p.map(d => d.id === editItem.id ? (u ?? { ...d, ...payload }) : d));
        // Se o anexo antigo foi substituído/removido, apaga do bucket.
        if (anexoAnterior && anexoAnterior !== anexo?.url) {
          removerAnexoNota(anexoAnterior).catch(() => {});
        }
        showToast("Nota atualizada!", 'success', true);
      } else {
        const s = await dbInsert('/api/notasrecebidasview', payload);
        setData([s ?? { id: Date.now(), ...payload }, ...data]);
        showToast("Nota adicionada!", 'success', true);
      }
      closeForm({ skipOrphanCleanup: true });
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[NotasRecebidas] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Excluir?')) return;
    try {
      const alvo = data.find((d: any) => d.id === id);
      await dbDelete('/api/notasrecebidasview', id);
      setData((p: any[]) => p.filter(d => d.id !== id));
      // Soft-delete: preservamos o anexo no bucket, senão perderíamos o
      // documento se a nota for reativada. Só o hard-delete apaga o arquivo.
      showToast("Excluído.", 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[NotasRecebidas] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Notas Recebidas</h2>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova NF</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar NF' : 'Nova NF'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Número NF *" error={errors.numero_nf}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.numero_nf ? 'border border-red-500/40' : ''}`}
                    value={form.numero_nf}
                    onChange={e => { setForm(f => ({ ...f, numero_nf: e.target.value })); clearError('numero_nf'); }}
                    placeholder="Ex: NF-001234" />
                </FormField>
                <FormField label="Categoria *">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.categoria_gasto}
                    onChange={e => setExtras(x => ({ ...x, categoria_gasto: e.target.value as any }))}>
                    {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormField>
                <FormField label="Fornecedor">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.fornecedor_id}
                    onChange={e => setExtras(x => ({ ...x, fornecedor_id: e.target.value }))}>
                    <option value="">Nenhum</option>
                    {groupCadastrosParaSelect(fornecedores).map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </FormField>

                <FormField label="Valor Total (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.valor_total}
                    onChange={e => setExtras(x => ({ ...x, valor_total: formatBRL(e.target.value) }))}
                    onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                </FormField>
                <FormField label="Data Emissão">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.data_emissao}
                    onChange={e => setExtras(x => ({ ...x, data_emissao: e.target.value }))} />
                </FormField>
                <FormField label="Status">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.status}
                    onChange={e => setExtras(x => ({ ...x, status: e.target.value }))}>
                    {['Não Vinculada', 'Vinculada', 'Cancelada'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FormField>

                <FormField label="Descrição do gasto">
                  <textarea rows={2}
                    className="neu-input py-2 px-3 rounded-xl text-sm resize-none"
                    value={extras.descricao}
                    onChange={e => setExtras(x => ({ ...x, descricao: e.target.value }))}
                    placeholder="Ex: 2 arcondicionados split 12000 BTU + instalação" />
                </FormField>
                <FormField label="Conta a Pagar (opcional)">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.conta_pagar_id}
                    onChange={e => setExtras(x => ({ ...x, conta_pagar_id: e.target.value }))}>
                    <option value="">Não amarrar</option>
                    {/* A conta que já tem nota amarrada continuava na lista sem
                        nenhum sinal — dava para amarrar a mesma despesa duas
                        vezes e ninguém percebia. Vai para o 2º grupo,
                        desabilitada, exceto a da própria nota em edição. */}
                    {(() => {
                      const livres = contasPagar.filter((c: any) => !contasComNota.has(c.id) || c.id === extras.conta_pagar_id);
                      const usadas = contasPagar.filter((c: any) => contasComNota.has(c.id) && c.id !== extras.conta_pagar_id);
                      const rotulo = (c: any) => `${(c.descricao ?? '—').slice(0, 60)} · R$ ${formatBRL(Number(c.valor ?? 0))}`;
                      return (
                        <>
                          {livres.length > 0 && (
                            <optgroup label={`Sem nota vinculada (${livres.length})`}>
                              {livres.slice(0, 200).map((c: any) => (
                                <option key={c.id} value={c.id}>{rotulo(c)}</option>
                              ))}
                            </optgroup>
                          )}
                          {usadas.length > 0 && (
                            <optgroup label={`Já vinculadas a outra nota (${usadas.length})`}>
                              {usadas.slice(0, 200).map((c: any) => (
                                <option key={c.id} value={c.id} disabled>{rotulo(c)}</option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                </FormField>
                <FormField label="Origem do valor">
                  <label className="flex items-center gap-2 h-full pt-1 cursor-pointer">
                    <input type="checkbox"
                      checked={extras.capital_origem}
                      onChange={e => setExtras(x => ({ ...x, capital_origem: e.target.checked }))}
                      className="w-4 h-4 accent-accent" />
                    <span className="text-xs text-gray-300 flex items-center gap-1.5">
                      <Landmark size={12} className="text-accent" /> Saiu do Capital Inicial
                    </span>
                  </label>
                </FormField>
              </div>

              {/* Anexo: PDF ou imagem da nota original — comprova a prestação de contas */}
              <div className="border-t border-white/5 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-300 flex items-center gap-2">
                    <Paperclip size={12} className="text-accent" />
                    Anexar documento da nota
                    <span className="text-[10px] text-gray-500 font-normal">(PDF, JPG, PNG · máx. {NOTA_ANEXO_MAX_LABEL})</span>
                  </label>
                </div>
                {anexo ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-accent/5 border border-accent/20">
                    <FileText size={18} className="text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-200 truncate">{anexo.nome}</div>
                      <div className="text-[10px] text-gray-500">
                        {formatarTamanhoAnexo(anexo.tamanho)}
                        {anexo.url && (
                          <>
                            {' · '}
                            <a href={anexo.url} target="_blank" rel="noopener noreferrer"
                              className="text-accent hover:underline inline-flex items-center gap-0.5">
                              Visualizar <ExternalLink size={9} />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={removerAnexoLocal}
                      className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 shrink-0">
                      <X size={12} /> Remover
                    </button>
                  </div>
                ) : (
                  <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-white/10 hover:border-accent/40 hover:bg-white/5 transition-colors cursor-pointer ${anexoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input ref={anexoInputRef}
                      type="file" className="hidden"
                      accept={NOTA_ANEXO_ACCEPT}
                      onChange={handleAnexoChange}
                      disabled={anexoUploading} />
                    <Paperclip size={16} className="text-gray-500" />
                    <span className="text-xs text-gray-400">
                      {anexoUploading ? 'Enviando...' : 'Escolher arquivo (PDF ou imagem)'}
                    </span>
                  </label>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => closeForm()} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Número NF</th>
                <th className="pb-4 font-bold px-4">Categoria</th>
                <th className="pb-4 font-bold px-4">Fornecedor / Descrição</th>
                <th className="pb-4 font-bold px-4 text-right">Valor</th>
                <th className="pb-4 font-bold px-4">Emissão</th>
                <th className="pb-4 font-bold px-4 text-center">Capital?</th>
                <th className="pb-4 font-bold px-4 text-center">Anexo</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={9}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={9}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.numero_nf}</td>
                      <td className="py-3 px-4">
                        {item.categoria_gasto ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/10 text-accent border border-accent/20">
                            <PackageIcon size={10} /> {item.categoria_gasto}
                          </span>
                        ) : <span className="text-[10px] text-gray-500">—</span>}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400">
                        <div className="font-semibold text-gray-300">{item.forn?.nome ?? '—'}</div>
                        {item.descricao && <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{item.descricao}</div>}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">R$ {formatBRL(Number(item.valor_total ?? 0))}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data_emissao || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        {item.capital_origem ? (
                          <span title="Saiu do Capital Inicial" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent/15 text-accent">
                            <Landmark size={12} />
                          </span>
                        ) : <span className="text-[10px] text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {item.anexo_url ? (
                          <a href={item.anexo_url} target="_blank" rel="noopener noreferrer"
                            title={`${item.anexo_nome ?? 'Ver anexo'} · ${formatarTamanhoAnexo(item.anexo_tamanho)}`}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                            <FileText size={11} /> Ver
                          </a>
                        ) : <span className="text-[10px] text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <HistoricoOperacoes entidade="notas_recebidas" entidadeId={item.id} titulo={`Nota ${item.numero ?? String(item.id).slice(-6).toUpperCase()}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                          <button onClick={() => openEdit(item)} className="action-btn-edit"><Edit2 size={12} /></button>
                          <button onClick={() => handleDelete(item.id)} className="action-btn-delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};


export const NotasRecebidasView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <NotasRecebidasViewInner showToast={showToast} filial={filialAtiva} />;
};
