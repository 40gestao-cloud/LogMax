import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Upload, X, Lock, Unlock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, BancoThumb } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import {
  BANCO_LOGO_ACCEPT,
  BANCO_LOGO_MAX_LABEL,
  removerLogoAntiga,
  uploadLogoBanco,
  validarLogoBanco,
} from '../lib/bancoLogo';
import { useConfirm } from '../contexts/ConfirmContext';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import type { UserProfile } from '../hooks/useUserProfile';

const ENDPOINT = '/api/caixabancosview';
const TIPOS = ['Conta Corrente', 'Conta Poupança', 'Caixa', 'Investimento'];
const STATUS_OPCOES = ['Ativo', 'Inativo'];
const FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

interface FormState {
  conta: string;
  banco: string;
  agencia: string;
  saldo: string;
  tipo: string;
  status: string;
  filial: string;
}

const EMPTY_FORM: FormState = {
  conta: '',
  banco: '',
  agencia: '',
  saldo: '',
  tipo: TIPOS[0],
  status: STATUS_OPCOES[0],
  filial: '',
};

type FilialCaixaConfig = {
  filial: string;
  bloqueado: boolean;
  updated_by_nome: string | null;
  updated_at: string;
};

function podeGerenciar(profile: UserProfile | null) {
  return profile?.role === 'admin' || profile?.role === 'ceo';
}

export const CaixaBancosView = ({
  showToast,
  profile,
}: {
  showToast: any;
  profile: UserProfile | null;
}) => {
  const { filialAtiva } = useFilial();
  const matrizMode = !filialAtiva;
  const confirm = useConfirm();

  // Em modo filial filtramos pelo filial do usuário
  const filialFiltro = filialAtiva ?? undefined;
  const extraFilter = filialFiltro ? { filial: filialFiltro } : undefined;

  const { data: dataAll, setData, isLoading } = useFetchData<any>(ENDPOINT, extraFilter);
  const { data: configs = [], reload: reloadConfigs } = useFetchData<FilialCaixaConfig>(
    'filial_caixa_config', undefined, false,
  );

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [imagemUrl, setImagemUrl] = useState<string>('');
  const [imagemUrlAnterior, setImagemUrlAnterior] = useState<string>('');
  const [imagemUploading, setImagemUploading] = useState(false);
  const [togglingFilial, setTogglingFilial] = useState<string | null>(null);
  const imagemInputRef = useRef<HTMLInputElement | null>(null);

  // Config de bloqueio da filial ativa (modo filial)
  const configFilialAtiva = filialAtiva
    ? configs.find(c => c.filial === filialAtiva)
    : null;
  const bloqueado = configFilialAtiva?.bloqueado ?? false;

  // Em modo filial, filtramos no frontend também (RLS já filtra, mas garante)
  const data = matrizMode
    ? dataAll
    : dataAll.filter((i: any) => i.filial === filialAtiva || i.filial == null);

  const filtered = data.filter((item: any) =>
    [item.conta, item.banco, item.agencia, item.tipo, item.filial].some(v =>
      String(v ?? '').toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ ...EMPTY_FORM });
    setErrors({});
    setImagemUrl('');
    setImagemUrlAnterior('');
    if (imagemInputRef.current) imagemInputRef.current.value = '';
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({
      conta: String(item.conta ?? ''),
      banco: String(item.banco ?? ''),
      agencia: String(item.agencia ?? ''),
      saldo: item.saldo != null && item.saldo !== '' ? formatBRL(Number(item.saldo)) : '',
      tipo: item.tipo ?? TIPOS[0],
      status: item.status ?? STATUS_OPCOES[0],
      filial: item.filial ?? '',
    });
    setImagemUrl(item.imagem_url ?? '');
    setImagemUrlAnterior(item.imagem_url ?? '');
    setErrors({});
    setShowForm(false);
  };

  const handleImagemChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validacao = validarLogoBanco(file);
    if (!validacao.ok) {
      showToast(validacao.motivo, 'error', true);
      e.target.value = '';
      return;
    }
    setImagemUploading(true);
    try {
      const url = await uploadLogoBanco(file, editItem?.id);
      setImagemUrl(url);
      showToast('Logo carregada!', 'success', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Falha ao enviar logo.', 'error', true);
    } finally {
      setImagemUploading(false);
      e.target.value = '';
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.conta.trim()) e.conta = 'Obrigatório';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);

    // Filial do registro: em modo filial usa a filial ativa; em modo Matriz usa o campo do form
    const filialRegistro = matrizMode ? (form.filial || null) : filialAtiva;

    const payload: Record<string, any> = {
      conta: form.conta,
      banco: form.banco || null,
      agencia: form.agencia || null,
      saldo: form.saldo !== '' ? parseBRL(form.saldo) : 0,
      tipo: form.tipo || null,
      status: form.status || 'Ativo',
      imagem_url: imagemUrl || null,
      filial: filialRegistro,
    };
    try {
      if (editItem) {
        const updated = await dbUpdate(ENDPOINT, editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        if (imagemUrlAnterior && imagemUrlAnterior !== imagemUrl) removerLogoAntiga(imagemUrlAnterior);
        showToast('Conta atualizada!', 'success', true);
      } else {
        const saved = await dbInsert(ENDPOINT, payload);
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload }, ...prev]);
        showToast('Conta criada!', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: any) => {
    if (!await confirm('Excluir esta conta bancária?')) return;
    try {
      await dbDelete(ENDPOINT, item.id);
      setData((prev: any[]) => prev.filter(d => d.id !== item.id));
      if (item.imagem_url) removerLogoAntiga(item.imagem_url);
      showToast('Conta excluída.', 'success', true);
    } catch (err: any) {
      showToast(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleToggleBloqueio = async (filial: string, atual: boolean) => {
    if (!supabase) return;
    setTogglingFilial(filial);
    const { error } = await supabase.from('filial_caixa_config').update({
      bloqueado: !atual,
      updated_by: profile?.id ?? null,
      updated_by_nome: profile?.nome ?? null,
      updated_at: new Date().toISOString(),
    }).eq('filial', filial);
    if (error) showToast(error.message, 'error');
    else showToast(`${filial} ${!atual ? 'bloqueada' : 'desbloqueada'}.`, 'success');
    reloadConfigs();
    setTogglingFilial(null);
  };

  const canEdit = podeGerenciar(profile) || !bloqueado;
  const isFormOpen = showForm || !!editItem;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">

      {/* Banner de bloqueio (modo filial, não-admin) */}
      {!matrizMode && bloqueado && !podeGerenciar(profile) && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
          <ShieldAlert size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-300">Caixa/Bancos bloqueado pela Matriz</p>
            <p className="text-xs text-red-400/70 mt-0.5">
              Apenas visualização. Para adicionar ou editar, solicite desbloqueio ao administrador.
            </p>
          </div>
        </div>
      )}

      {/* Painéis de bloqueio por filial (modo Matriz, admin/CEO) */}
      {matrizMode && podeGerenciar(profile) && (
        <div className="neu-flat rounded-2xl p-4 border border-accent/10 flex flex-col gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bloqueio por Filial</span>
          <div className="grid grid-cols-3 gap-3">
            {FILIAIS.map(f => {
              const cfg = configs.find(c => c.filial === f);
              const est = cfg?.bloqueado ?? false;
              return (
                <button
                  key={f}
                  onClick={() => handleToggleBloqueio(f, est)}
                  disabled={togglingFilial === f}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors text-xs font-bold
                    ${est
                      ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      : 'border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                    } disabled:opacity-50`}
                >
                  <span>{f}</span>
                  {est ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600">Bloqueado = filial só visualiza. Desbloqueado = filial pode adicionar/editar.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Caixa / Bancos</h2>
          <p className="text-sm text-gray-400 mt-1">
            {matrizMode ? 'Gerencie contas de todas as filiais.' : `Contas de ${filialAtiva}.`}
          </p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {canEdit && (
            <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
              <Plus size={16} /> Nova
            </NeuButtonAccent>
          )}
        </div>
      </div>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && canEdit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Conta' : 'Nova Conta'}</h3>

              <div className="flex items-start gap-4 flex-wrap">
                <BancoThumb url={imagemUrl} size="lg" alt={form.banco || 'Banco'} />
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Logo do banco</label>
                  <div className="flex gap-2 items-center">
                    <input
                      ref={imagemInputRef}
                      type="file"
                      accept={BANCO_LOGO_ACCEPT}
                      onChange={handleImagemChange}
                      className="hidden"
                      id="logo-input"
                    />
                    <label htmlFor="logo-input" className="neu-button py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer hover:text-accent transition-colors">
                      <Upload size={12} /> {imagemUploading ? 'Enviando...' : 'Escolher logo'}
                    </label>
                    {imagemUrl && (
                      <button onClick={() => setImagemUrl('')} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center gap-1 hover:text-red-400 transition-colors">
                        <X size={11} /> Remover
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600">JPG, PNG, WEBP ou SVG · até {BANCO_LOGO_MAX_LABEL} · comprime auto para WebP 512 px (SVG sobe inalterado)</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Conta *" error={errors.conta}>
                  <input type="text" className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.conta ? 'border border-red-500/40' : ''}`}
                    value={form.conta}
                    onChange={e => { setForm(s => ({ ...s, conta: e.target.value })); setErrors(ev => { const n = { ...ev }; delete n.conta; return n; }); }}
                    placeholder="Ex: 12345-6" />
                </FormField>
                <FormField label="Banco">
                  <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.banco} onChange={e => setForm(s => ({ ...s, banco: e.target.value }))} placeholder="Ex: Banco do Brasil" />
                </FormField>
                <FormField label="Agência">
                  <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.agencia} onChange={e => setForm(s => ({ ...s, agencia: e.target.value }))} placeholder="Ex: 0001" />
                </FormField>
                <FormField label="Saldo (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                    value={form.saldo}
                    onChange={e => setForm(s => ({ ...s, saldo: formatBRL(e.target.value) }))}
                    onKeyDown={handleMoneyKeyDown}
                    placeholder="0,00" />
                </FormField>
                <FormField label="Tipo">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.tipo} onChange={e => setForm(s => ({ ...s, tipo: e.target.value }))}>
                    {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>
                <FormField label="Status">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={form.status} onChange={e => setForm(s => ({ ...s, status: e.target.value }))}>
                    {STATUS_OPCOES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FormField>
                {/* Selector de filial: só aparece em modo Matriz */}
                {matrizMode && (
                  <FormField label="Filial (deixe vazio para Matriz/global)">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={form.filial} onChange={e => setForm(s => ({ ...s, filial: e.target.value }))}>
                      <option value="">— Matriz (visível a todos) —</option>
                      {FILIAIS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </FormField>
                )}
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabela */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Logo</th>
                <th className="pb-4 font-bold px-4">Banco</th>
                <th className="pb-4 font-bold px-4">Conta</th>
                <th className="pb-4 font-bold px-4">Agência</th>
                <th className="pb-4 font-bold px-4">Tipo</th>
                {matrizMode && <th className="pb-4 font-bold px-4">Filial</th>}
                <th className="pb-4 font-bold px-4 text-right">Saldo</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <tr><td colSpan={matrizMode ? 9 : 8}><LoadingSpinner /></td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={matrizMode ? 9 : 8}><EmptyState message="Nenhuma conta bancária cadastrada" /></td></tr>
                  : (
                    <AnimatePresence>
                      {filtered.map((item: any) => {
                        const itemBloqueado = item.filial
                          ? (configs.find(c => c.filial === item.filial)?.bloqueado ?? false)
                          : false;
                        const podeEditar = podeGerenciar(profile) || !itemBloqueado;
                        return (
                          <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                            className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                            <td className="py-3 px-4">
                              <BancoThumb url={item.imagem_url} size="xs" alt={item.banco ?? item.conta ?? 'Banco'} />
                            </td>
                            <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.banco ?? '—'}</td>
                            <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.conta ?? '—'}</td>
                            <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.agencia ?? '—'}</td>
                            <td className="py-3 px-4 text-xs text-gray-400">{item.tipo ?? '—'}</td>
                            {matrizMode && (
                              <td className="py-3 px-4">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  item.filial
                                    ? 'bg-accent/10 text-accent'
                                    : 'bg-white/5 text-gray-500'
                                }`}>
                                  {item.filial ?? 'Matriz'}
                                  {item.filial && itemBloqueado && (
                                    <Lock size={9} className="inline ml-1 text-red-400" />
                                  )}
                                </span>
                              </td>
                            )}
                            <td className={`py-3 px-4 text-xs font-mono text-right tabular-nums ${Number(item.saldo) < 0 ? 'text-red-500' : 'text-gray-200'}`}>
                              R$ {Number(item.saldo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                                {podeEditar && (
                                  <>
                                    <button onClick={() => openEdit(item)} className="action-btn-edit"><Edit2 size={12} /></button>
                                    <button onClick={() => handleDelete(item)} className="action-btn-delete"><Trash2 size={12} /></button>
                                  </>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};
