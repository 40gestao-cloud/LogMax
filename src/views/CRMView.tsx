import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Mail, Phone as PhoneIcon, Building, Package, Plus, Save, FileDown, Sheet, MapPin, CreditCard } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, FilialBadge, Pagination } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, exportToPDF, exportToExcel, formatPhone, formatCPF, formatCNPJ } from '../lib/viewUtils';
import { FILIAIS_HOLDING, FILIAL_DEFAULT } from '../lib/filiais';

type PessoaTipo = 'Empresa' | 'Pessoa Física';

const EMPTY_EXTRAS = {
  pessoa_tipo: 'Empresa' as PessoaTipo,
  telefone: '',
  email: '',
  endereco: '',
  cpf_cnpj: '',
  categoria: '',
  filial: FILIAL_DEFAULT as string,
};

export const CRMView = ({ type, showToast }: { type: 'clientes' | 'fornecedores'; showToast: any }) => {
  const isClientes = type === 'clientes';
  const endpoint = isClientes ? '/api/crmview' : '/api/crmview-fornecedores';
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filialFiltro, setFilialFiltro] = useState<string>('todas');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, filialFiltro]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    endpoint,
    filialFiltro === 'todas' ? undefined : { filial: filialFiltro },
    false,
    { page, searchTerm: debouncedSearch, searchColumns: ['nome', 'email', 'telefone', 'cpf_cnpj', 'pessoa_tipo'] }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState({ nome: '' });
  const [extras, setExtras] = useState(EMPTY_EXTRAS);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const title = isClientes ? 'Gestão de Clientes' : 'Gestão de Fornecedores';
  const desc  = isClientes ? 'Visualize e gerencie a carteira de clientes ativos.' : 'Controle seus parceiros comerciais e rede de suprimentos.';

  // Pesquisa agora é server-side.
  const filtered = data;

  const exportCols = isClientes
    ? ['Nome', 'Tipo', 'Telefone', 'E-mail', 'CPF/CNPJ', 'Status']
    : ['Nome', 'Categoria', 'Telefone', 'E-mail', 'CPF/CNPJ', 'Status'];
  const exportRows = () => isClientes
    ? filtered.map((d: any) => [d.nome ?? '', d.pessoa_tipo ?? d.tipo ?? '', d.telefone ?? '', d.email ?? '', d.cpf_cnpj ?? '', d.status ?? ''])
    : filtered.map((d: any) => [d.nome ?? '', d.categoria ?? '', d.telefone ?? '', d.email ?? '', d.cpf_cnpj ?? '', d.status ?? '']);
  const exportFilename = isClientes ? 'logmax-clientes' : 'logmax-fornecedores';
  const handleExportPDF   = () => exportToPDF(title, exportCols, exportRows(), exportFilename);
  const handleExportExcel = () => exportToExcel(isClientes ? 'Clientes' : 'Fornecedores', exportCols, exportRows(), exportFilename);

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ nome: item.nome ?? '' });
    setExtras({
      pessoa_tipo: item.pessoa_tipo ?? 'Empresa',
      telefone:    item.telefone   ?? '',
      email:       item.email      ?? '',
      endereco:    item.endereco   ?? '',
      cpf_cnpj:    item.cpf_cnpj   ?? '',
      categoria:   item.categoria  ?? '',
      filial:      item.filial     ?? FILIAL_DEFAULT,
    });
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ nome: '' });
    setExtras(EMPTY_EXTRAS);
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast('Salvando...', 'info', false);
    try {
      const base = {
        nome:        form.nome,
        pessoa_tipo: extras.pessoa_tipo,
        telefone:    extras.telefone,
        email:       extras.email,
        endereco:    extras.endereco,
        cpf_cnpj:    extras.cpf_cnpj,
        filial:      extras.filial || FILIAL_DEFAULT,
      };
      if (editItem) {
        const payload = isClientes ? base : { ...base, categoria: extras.categoria };
        const updated = await dbUpdate(endpoint, editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Registro atualizado!', 'success', true);
      } else {
        // ultima_compra é coluna date no schema — preenchida pelo trigger de venda PDV,
        // não pelo cadastro inicial. Omitir aqui (NULL até primeira compra).
        const payload = isClientes
          ? { ...base, status: 'Ativo' }
          : { ...base, categoria: extras.categoria, status: 'Homologado' };
        const saved = await dbInsert(endpoint, payload);
        setData([saved ?? { id: Date.now(), ...payload }, ...data]);
        showToast('Registro criado com sucesso!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[CRM] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const label = isClientes ? 'cliente' : 'fornecedor';
    if (!confirm(`Excluir este ${label}?`)) return;
    try {
      await dbDelete(endpoint, id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Registro excluído.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[CRM] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">{title}</h2>
          <p className="text-sm text-gray-400 mt-1">{desc}</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          {data.length > 0 && (
            <>
              <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder={`Buscar ${isClientes ? 'cliente' : 'fornecedor'}...`}
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por filial">
            <option value="todas">Todas filiais</option>
            {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-5">
              <h3 className="text-sm font-bold text-gray-200">
                {editItem ? (isClientes ? 'Editar Cliente' : 'Editar Fornecedor') : (isClientes ? 'Novo Cliente' : 'Novo Fornecedor')}
              </h3>

              {/* Toggle Empresa / Pessoa Física */}
              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-2" id="crm-tipo-pessoa-label">Tipo de pessoa</span>
                <div className="flex gap-1 neu-pressed rounded-xl p-1 w-fit border border-white/5" role="radiogroup" aria-labelledby="crm-tipo-pessoa-label">
                  {(['Empresa', 'Pessoa Física'] as PessoaTipo[]).map(tipo => (
                    <button key={tipo} type="button"
                      onClick={() => setExtras(x => ({ ...x, pessoa_tipo: tipo, cpf_cnpj: '' }))}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                        extras.pessoa_tipo === tipo
                          ? 'neu-flat text-gray-200 border border-white/10'
                          : 'text-gray-600 hover:text-gray-400'
                      }`}>
                      {tipo}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField label="Nome *" error={errors.nome}>
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                    value={form.nome}
                    onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
                    placeholder={extras.pessoa_tipo === 'Empresa' ? 'Razão social ou nome fantasia' : 'Nome completo'} />
                </FormField>

                <FormField label="Telefone / Celular">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.telefone}
                    onChange={e => setExtras(x => ({ ...x, telefone: formatPhone(e.target.value) }))}
                    placeholder="(11) 99999-9999" />
                </FormField>

                <FormField label="E-mail">
                  <input type="email" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.email}
                    onChange={e => setExtras(x => ({ ...x, email: e.target.value }))}
                    placeholder="email@exemplo.com" />
                </FormField>

                <FormField label="Endereço">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.endereco}
                    onChange={e => setExtras(x => ({ ...x, endereco: e.target.value }))}
                    placeholder="Rua, número, bairro, cidade" />
                </FormField>

                <FormField label={extras.pessoa_tipo === 'Empresa' ? 'CNPJ' : 'CPF'}>
                  <input className="neu-input py-2 px-3 rounded-xl text-sm font-mono"
                    value={extras.cpf_cnpj}
                    onChange={e => setExtras(x => ({ ...x, cpf_cnpj: extras.pessoa_tipo === 'Empresa' ? formatCNPJ(e.target.value) : formatCPF(e.target.value) }))}
                    placeholder={extras.pessoa_tipo === 'Empresa' ? '00.000.000/0001-00' : '000.000.000-00'} />
                </FormField>

                {!isClientes && (
                  <FormField label="Categoria">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.categoria}
                      onChange={e => setExtras(x => ({ ...x, categoria: e.target.value }))}
                      placeholder="Ex: Materiais, Serviços" />
                  </FormField>
                )}

                <FormField label="Filial / Unidade *">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.filial}
                    onChange={e => setExtras(x => ({ ...x, filial: e.target.value }))}>
                    {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </FormField>
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cards */}
      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState /> : (
        <div className="flex flex-col gap-4 overflow-y-auto main-scrollbar pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pr-2">
          {filtered.map((item: any, i: number) => {
            const pessoaTipo: string = item.pessoa_tipo ?? (isClientes ? item.tipo : item.categoria) ?? '—';
            const docLabel = item.pessoa_tipo === 'Pessoa Física' ? 'CPF' : 'CNPJ';
            return (
              <motion.div key={item.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="neu-flat p-6 rounded-3xl flex flex-col border border-white/5 gap-4 group">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-sm font-bold text-gray-200 mb-2 tracking-wide">{item.nome}</h3>
                    <div className="flex gap-2 items-center flex-wrap">
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded text-gray-400 tracking-widest neu-pressed" style={{ background: 'var(--color-badge-neutral-bg)' }}>{pessoaTipo}</span>
                      <FilialBadge filial={item.filial} />
                      <span className="w-1 h-1 rounded-full bg-accent"></span>
                      <span className="text-xs text-accent font-medium">{item.status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(item)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-accent"><Edit2 size={12} /></button>
                      <button onClick={() => handleDelete(item.id)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>
                    <div className="w-10 h-10 neu-circle flex items-center justify-center bg-accent/5 shrink-0">
                      {isClientes ? <Building size={16} className="text-accent" /> : <Package size={16} className="text-accent" />}
                    </div>
                  </div>
                </div>

                <div className="neu-pressed p-4 rounded-2xl flex flex-col gap-2.5 border border-white/5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold border-b border-white/5 pb-2">Contato</span>
                  {item.email ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-300">
                      <Mail size={11} className="text-gray-500 shrink-0" />{item.email}
                    </div>
                  ) : null}
                  {item.telefone ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-300">
                      <PhoneIcon size={11} className="text-gray-500 shrink-0" />{item.telefone}
                    </div>
                  ) : null}
                  {item.cpf_cnpj ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-300">
                      <CreditCard size={11} className="text-gray-500 shrink-0" />
                      <span className="font-mono">{docLabel}: {item.cpf_cnpj}</span>
                    </div>
                  ) : null}
                  {item.endereco ? (
                    <div className="flex items-center gap-2.5 text-xs text-gray-400">
                      <MapPin size={11} className="text-gray-500 shrink-0" />{item.endereco}
                    </div>
                  ) : null}
                  {!item.email && !item.telefone && !item.cpf_cnpj && !item.endereco && (
                    <span className="text-xs text-gray-600">Sem informações de contato</span>
                  )}
                </div>

                {isClientes && (
                  <div className="text-[11px] text-gray-500 border-t border-white/5 pt-3 mt-auto flex justify-between">
                    <span>Última compra:</span>
                    <strong className="text-gray-200">{item.ultima_compra ?? '—'}</strong>
                  </div>
                )}
              </motion.div>
            );
          })}
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
