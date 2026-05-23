import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Pencil, Trash2, Search, FileDown, Sheet, X } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, NeuButtonAccent, ExportButton } from '../components/ui';
import { exportToPDF, exportToExcel, formatCPF, formatPhone, formatBRL, parseBRL } from '../lib/viewUtils';

const MASK_FOR: Record<string, (v: string) => string> = {
  cpf:      formatCPF,
  telefone: formatPhone,
  salario:  formatBRL,
};

const EMPTY: any = { nome: '', cpf: '', email: '', telefone: '', cargo: '', departamento: '', data_admissao: '', data_nascimento: '', salario: '', status: 'Ativo' };

export const FuncionariosView = ({ showToast }: any) => {
  const { data: funcionarios, setData, isLoading } = useFetchData<any>('/api/funcionariosview');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const anoMes = new Date().toISOString().slice(0, 7);
  const ativos = funcionarios.filter((f: any) => f.status === 'Ativo').length;
  const afastados = funcionarios.filter((f: any) => f.status === 'Afastado').length;
  const desligados = funcionarios.filter((f: any) => f.status === 'Desligado').length;
  const admissoesMes = funcionarios.filter((f: any) => f.data_admissao?.startsWith(anoMes)).length;

  const kpis = [
    { label: 'Funcionários Ativos', value: ativos, warn: false },
    { label: 'Afastados', value: afastados, warn: afastados > 0 },
    { label: 'Desligados', value: desligados, warn: false },
    { label: 'Admissões no Mês', value: admissoesMes, warn: false },
  ];

  const filtered = funcionarios.filter((f: any) =>
    [f.nome, f.cargo, f.departamento, f.cpf, f.email].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const openNew = () => { setForm(EMPTY); setEditing(null); setShowForm(true); };
  const openEdit = (f: any) => {
    setForm({
      ...f,
      cpf:      f.cpf      ? formatCPF(f.cpf)        : '',
      telefone: f.telefone ? formatPhone(f.telefone) : '',
      salario:  f.salario  != null ? formatBRL(Number(f.salario)) : '',
    });
    setEditing(f);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditing(null); setForm(EMPTY); };

  const handleSave = async () => {
    if (!form.nome) { showToast('Nome é obrigatório.', 'error'); return; }
    setSaving(true);
    try {
      const payload = { ...form, salario: parseBRL(form.salario) };
      if (editing) {
        const updated = await dbUpdate('/api/funcionariosview', editing.id, payload);
        setData((prev: any[]) => prev.map((f: any) => f.id === editing.id ? { ...f, ...updated } : f));
        showToast('Funcionário atualizado.', 'success');
      } else {
        const created = await dbInsert('/api/funcionariosview', payload);
        setData((prev: any[]) => [created, ...prev]);
        showToast('Funcionário cadastrado.', 'success');
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Funcionarios] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await dbDelete('/api/funcionariosview', id);
      setData((prev: any[]) => prev.filter((f: any) => f.id !== id));
      showToast('Removido.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Funcionarios] erro ao remover:', err);
      showToast(`Erro ao remover: ${msg}`, 'error');
    }
  };

  const exportCols = ['Nome', 'CPF', 'Cargo', 'Departamento', 'Admissão', 'Salário', 'Status'];
  const exportRows = () => filtered.map((f: any) => [
    f.nome ?? '', f.cpf ?? '', f.cargo ?? '', f.departamento ?? '',
    f.data_admissao ?? '', `R$ ${Number(f.salario || 0).toFixed(2)}`, f.status ?? '',
  ]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Funcionários</h2>
        <p className="text-sm text-gray-400 mt-1">Gerencie o quadro de funcionários da empresa.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex gap-3 items-center">
          {filtered.length > 0 && (
            <>
              <ExportButton label="PDF" onClick={() => exportToPDF('Funcionários', exportCols, exportRows(), 'logmax-funcionarios')} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('Funcionários', exportCols, exportRows(), 'logmax-funcionarios')} icon={Sheet} />
            </>
          )}
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar funcionário..." value={search} onChange={e => setSearch(e.target.value)}
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" />
          </div>
          <NeuButtonAccent variant="" onClick={openNew}><Plus size={14} />Novo Funcionário</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editing ? 'Editar Funcionário' : 'Novo Funcionário'}</h3>
              <button onClick={closeForm} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Nome *', k: 'nome', type: 'text' },
                { label: 'CPF', k: 'cpf', type: 'text' },
                { label: 'E-mail', k: 'email', type: 'text' },
                { label: 'Telefone', k: 'telefone', type: 'text' },
                { label: 'Cargo', k: 'cargo', type: 'text' },
                { label: 'Departamento', k: 'departamento', type: 'text' },
                { label: 'Data de Admissão', k: 'data_admissao', type: 'date' },
                { label: 'Data de Nascimento', k: 'data_nascimento', type: 'date' },
                { label: 'Salário (R$)', k: 'salario', type: 'text' },
              ].map(({ label, k, type }) => {
                const mask = MASK_FOR[k];
                const isNumericMask = !!mask;
                return (
                  <div key={k} className="flex flex-col gap-1.5">
                    <label htmlFor={`func-${k}`} className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                    <input
                      id={`func-${k}`}
                      type={type}
                      inputMode={isNumericMask ? 'numeric' : undefined}
                      value={form[k]}
                      onChange={e => {
                        const raw = e.target.value;
                        const next = mask ? mask(raw) : raw;
                        setForm((p: any) => ({ ...p, [k]: next }));
                      }}
                      className={`neu-input rounded-xl px-3 py-2.5 text-sm ${isNumericMask ? 'font-mono tabular-nums' : ''}`}
                    />
                  </div>
                );
              })}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="func-status" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                <select id="func-status" value={form.status} onChange={e => setForm((p: any) => ({ ...p, status: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {['Ativo', 'Inativo', 'Afastado', 'Desligado'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar Alterações' : 'Cadastrar'}</NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Nome</th>
                <th className="pb-4 font-bold px-4">CPF</th>
                <th className="pb-4 font-bold px-4">Cargo</th>
                <th className="pb-4 font-bold px-4">Departamento</th>
                <th className="pb-4 font-bold px-4">Admissão</th>
                <th className="pb-4 font-bold px-4 text-right">Salário</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4" />
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((f: any) => (
                    <motion.tr key={f.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.cpf ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{f.cargo ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{f.departamento ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{f.data_admissao ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right tabular-nums">R$ {formatBRL(Number(f.salario || 0))}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={f.status} /></td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => openEdit(f)} className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-accent transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => handleDelete(f.id)} className="w-7 h-7 flex items-center justify-center rounded-lg neu-button text-gray-600 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
