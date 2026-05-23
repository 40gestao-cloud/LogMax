import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, X, Eye, EyeOff, Shield, User, Trash2, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FilialBadge } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { FILIAIS_HOLDING, FILIAL_DEFAULT } from '../lib/filiais';

const SETOR_LABEL: Record<string, string> = {
  all:        'Global',
  logistica:  'Logística',
  vendas:     'Vendas',
  financeiro: 'Financeiro',
  rh:         'RH',
  marketing:  'Marketing',
  ti:         'TI',
};

const ROLE_LABEL: Record<string, string> = {
  admin:       'Administrador',
  ceo:         'CEO',
  gerente:     'Gerente',
  colaborador: 'Colaborador',
};

const roleCls = (r: string) =>
  r === 'admin' ? 'bg-purple-900/30 text-purple-400'
  : r === 'ceo' ? 'bg-amber-900/30 text-amber-400'
  : r === 'gerente' ? 'bg-yellow-900/30 text-yellow-400'
  : 'bg-blue-900/30 text-blue-400';

const setorCls = (s: string) =>
  s === 'logistica'  ? 'bg-green-900/30 text-green-400'
  : s === 'vendas'   ? 'bg-orange-900/30 text-orange-400'
  : s === 'financeiro' ? 'bg-cyan-900/30 text-cyan-400'
  : s === 'rh'       ? 'bg-rose-900/30 text-rose-400'
  : s === 'marketing' ? 'bg-fuchsia-900/30 text-fuchsia-400'
  : s === 'ti'        ? 'bg-sky-900/30 text-sky-400'
  : 'bg-gray-800/50 text-gray-400';

// Filiais que gerentes podem atribuir — Matriz é exclusiva de admin/CEO.
const FILIAIS_GERENTE = FILIAIS_HOLDING.filter(f => f !== 'Matriz');

export const UsuariosView = ({ showToast, profile: callerProfile }: { showToast: any; profile: UserProfile }) => {
  const { session } = useAuth();
  const { data: funcionarios } = useFetchData<any>('/api/funcionariosview');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const isAdmin = callerProfile.role === 'admin';
  const isCEO = callerProfile.role === 'ceo';
  const isGerente = callerProfile.role === 'gerente';
  // Admin e CEO têm visão/escopo global; CEO não pode promover admin/CEO.
  const isGlobal = isAdmin || isCEO;

  // Form vazio depende do papel: gerente herda seu próprio setor (não pode trocar)
  // e tem default de filial fora da Matriz.
  const emptyForm = useMemo(() => ({
    nome: '',
    email: '',
    password: '',
    role: 'colaborador',
    setor: isGerente ? callerProfile.setor : 'logistica',
    filial: isGerente ? FILIAIS_GERENTE[0] : (FILIAL_DEFAULT as string),
  }), [isGerente, callerProfile.setor]);

  const [form, setForm] = useState<any>(emptyForm);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filialFiltro, setFilialFiltro] = useState<string>('todas');

  // Edição
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editShowPass, setEditShowPass] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setIsLoading(false); return; }
    (async () => {
      try {
        let q = supabase!.from('user_profiles').select('*').order('created_at', { ascending: false });
        if (isGerente) q = q.eq('setor', callerProfile.setor);
        const { data, error } = await q;
        if (error) showToast('Erro ao carregar usuários.', 'error');
        setUsers(data ?? []);
      } catch {
        showToast('Erro de conexão ao carregar usuários.', 'error');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isGerente, callerProfile.setor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtragem por filial (lista do banco já filtrada por setor para gerente)
  const filteredUsers = filialFiltro === 'todas'
    ? users
    : users.filter(u => (u.filial ?? FILIAL_DEFAULT) === filialFiltro);

  // KPIs
  const totalGerentes     = filteredUsers.filter(u => u.role === 'gerente').length;
  const totalColaboradores = filteredUsers.filter(u => u.role === 'colaborador').length;

  const handleLinkFuncionario = async (userId: string, funcionarioId: string) => {
    if (!supabase) return;
    try {
      await supabase.from('user_profiles').update({ funcionario_id: funcionarioId || null }).eq('id', userId);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, funcionario_id: funcionarioId || null } : u));
      showToast(funcionarioId ? 'Funcionário vinculado!' : 'Vínculo removido.', 'success');
    } catch {
      showToast('Erro ao vincular funcionário.', 'error');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!session?.access_token) { showToast('Sessão expirada.', 'error'); return; }
    setDeleting(true);
    try {
      const res = await fetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao excluir.', 'error'); return; }
      setUsers(prev => prev.filter(u => u.id !== userId));
      showToast('Usuário excluído.', 'success');
    } catch {
      showToast('Erro de conexão.', 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const handleSave = async () => {
    if (!form.nome || !form.email || !form.password) {
      showToast('Nome, e-mail e senha são obrigatórios.', 'error'); return;
    }
    if (!session?.access_token) { showToast('Sessão expirada. Faça login novamente.', 'error'); return; }

    setSaving(true);
    try {
      // CEO é global por definição — força setor='all' antes de enviar.
      const payload = form.role === 'ceo' ? { ...form, setor: 'all' } : form;
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao criar usuário.', 'error'); return; }

      // Recarregar lista
      if (supabase) {
        let q = supabase.from('user_profiles').select('*').order('created_at', { ascending: false });
        if (isGerente) q = q.eq('setor', callerProfile.setor);
        const { data } = await q;
        setUsers(data ?? []);
      }
      setForm(emptyForm);
      setShowForm(false);
      showToast('Usuário criado com sucesso.', 'success');
    } catch {
      showToast('Erro de conexão. Tente novamente.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---- Editar usuário ----

  // Quem pode editar este usuário?
  const canEdit = (u: UserProfile) => {
    if (u.id === callerProfile.id) return true; // self
    if (u.role === 'admin') return false;       // ninguém edita admin
    if (u.role === 'ceo' && !isAdmin) return false;
    if (isGerente) return u.role === 'colaborador' && u.setor === callerProfile.setor;
    return isGlobal; // admin/CEO
  };

  const openEdit = (u: UserProfile) => {
    setEditingUser(u);
    setEditForm({
      nome: u.nome ?? '',
      email: u.email ?? '',
      role: u.role,
      setor: u.setor,
      filial: u.filial ?? FILIAL_DEFAULT,
      password: '',
    });
    setEditShowPass(false);
  };

  const closeEdit = () => {
    setEditingUser(null);
    setEditForm(null);
    setEditShowPass(false);
  };

  const handleSaveEdit = async () => {
    if (!editingUser || !editForm) return;
    if (!editForm.nome || !editForm.email) {
      showToast('Nome e e-mail são obrigatórios.', 'error'); return;
    }
    if (editForm.password && editForm.password.length < 6) {
      showToast('Senha deve ter ao menos 6 caracteres.', 'error'); return;
    }
    if (!session?.access_token) { showToast('Sessão expirada.', 'error'); return; }

    setEditSaving(true);
    try {
      // Payload — gerente não envia role/setor/filial.
      const payload: any = {
        userId: editingUser.id,
        nome: editForm.nome,
        email: editForm.email,
      };
      if (editForm.password) payload.password = editForm.password;
      if (isGlobal) {
        payload.role = editForm.role;
        // CEO sempre setor 'all' — servidor força, mas mandamos coerente.
        payload.setor = editForm.role === 'ceo' ? 'all' : editForm.setor;
        payload.filial = editForm.filial;
      } else if (isGerente) {
        // Gerente: só nome/email/senha + filial (sem Matriz).
        if (editForm.filial && editForm.filial !== 'Matriz') payload.filial = editForm.filial;
      }

      const res = await fetch('/api/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao atualizar.', 'error'); return; }

      // Atualiza estado local
      setUsers(prev => prev.map(u => {
        if (u.id !== editingUser.id) return u;
        return {
          ...u,
          nome: payload.nome ?? u.nome,
          email: payload.email ?? u.email,
          role: payload.role ?? u.role,
          setor: payload.setor ?? u.setor,
          filial: payload.filial ?? u.filial,
        };
      }));
      closeEdit();
      showToast('Usuário atualizado.', 'success');
    } catch {
      showToast('Erro de conexão. Tente novamente.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const setorOptions = isGlobal
    ? ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti']
    : [callerProfile.setor];

  // Admin pode criar CEO/gerente/colaborador. CEO pode criar gerente/colaborador.
  // Gerente só cria colaborador.
  const roleOptions = isAdmin
    ? ['ceo', 'gerente', 'colaborador']
    : isCEO
      ? ['gerente', 'colaborador']
      : ['colaborador'];

  const isCeoRole = form.role === 'ceo';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Usuários</h2>
        <p className="text-sm text-gray-400 mt-1">
          {isGlobal ? 'Gerencie todos os usuários do sistema.' : `Gerencie os colaboradores de ${SETOR_LABEL[callerProfile.setor]}.`}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 shrink-0">
        {[
          { label: 'Total',        value: filteredUsers.length, icon: Users },
          { label: 'Gerentes',     value: totalGerentes,        icon: Shield },
          { label: 'Colaboradores',value: totalColaboradores,    icon: User },
        ].map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-3 sm:p-5 border border-white/5 min-w-0">
            <p className="text-[9px] sm:text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2 truncate">{k.label}</p>
            <p className="text-xl sm:text-2xl font-black text-gray-100">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
          className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por filial">
          <option value="todas">Todas filiais</option>
          {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <NeuButtonAccent onClick={() => setShowForm(v => !v)}>
          <Plus size={14} />{showForm ? 'Cancelar' : 'Novo Usuário'}
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Novo Usuário</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Nome *', k: 'nome', type: 'text' },
                { label: 'E-mail *', k: 'email', type: 'email' },
              ].map(({ label, k, type }) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label htmlFor={`user-${k}`} className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                  <input id={`user-${k}`} type={type} value={form[k]} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              ))}

              {/* Senha com olho */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="user-password" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Senha *</label>
                <div className="relative">
                  <input id="user-password" type={showPass ? 'text' : 'password'} value={form.password}
                    onChange={e => setForm((p: any) => ({ ...p, password: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 pr-10 text-sm w-full" />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Setor */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="user-setor" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                <select id="user-setor" value={form.setor} onChange={e => setForm((p: any) => ({ ...p, setor: e.target.value }))}
                  disabled={!isGlobal} className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                  {setorOptions.map(s => <option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
                </select>
              </div>

              {/* Cargo */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="user-role" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cargo</label>
                <select id="user-role" value={form.role} onChange={e => setForm((p: any) => ({ ...p, role: e.target.value }))}
                  disabled={!isGlobal} className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                  {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>

              {/* Filial / Unidade — gerentes não podem atribuir Matriz */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="user-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filial / Unidade</label>
                <select id="user-filial" value={form.filial} onChange={e => setForm((p: any) => ({ ...p, filial: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {(isGerente ? FILIAIS_GERENTE : FILIAIS_HOLDING).map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent onClick={handleSave} disabled={saving}>
                {saving ? 'Criando...' : 'Criar Usuário'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {filteredUsers.length === 0 ? <EmptyState message={filialFiltro === 'todas' ? 'Nenhum usuário cadastrado neste setor.' : `Nenhum usuário na filial ${filialFiltro}.`} /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4">E-mail</th>
                  <th className="pb-4 font-bold px-4 text-center">Setor</th>
                  <th className="pb-4 font-bold px-4 text-center">Cargo</th>
                  <th className="pb-4 font-bold px-4 text-center">Filial</th>
                  <th className="pb-4 font-bold px-4">Funcionário (Ponto QR)</th>
                  <th className="pb-4 font-bold px-4 text-center">Criado em</th>
                  <th className="pb-4 px-4"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredUsers.map(u => (
                    <motion.tr key={u.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{u.nome}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 font-mono">{u.email}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${setorCls(u.setor)}`}>
                          {SETOR_LABEL[u.setor] ?? u.setor}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${roleCls(u.role)}`}>
                          {ROLE_LABEL[u.role] ?? u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center"><FilialBadge filial={u.filial} /></td>
                      <td className="py-3 px-4">
                        <select
                          value={u.funcionario_id ?? ''}
                          onChange={e => handleLinkFuncionario(u.id, e.target.value)}
                          className="neu-input rounded-lg px-2 py-1.5 text-xs w-full max-w-[160px]"
                        >
                          <option value="">Sem vínculo</option>
                          {funcionarios.map((f: any) => (
                            <option key={f.id} value={f.id}>{f.nome}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-center text-gray-500">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {confirmDelete === u.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleDelete(u.id)} disabled={deleting}
                              className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase tracking-widest transition-colors disabled:opacity-50">
                              {deleting ? '...' : 'Confirmar'}
                            </button>
                            <button onClick={() => setConfirmDelete(null)}
                              className="text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase tracking-widest transition-colors">
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            {canEdit(u) && (
                              <button onClick={() => openEdit(u)}
                                title="Editar"
                                className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-600 hover:text-accent transition-colors">
                                <Pencil size={13} />
                              </button>
                            )}
                            {u.id !== callerProfile.id && u.role !== 'admin' && !(u.role === 'ceo' && !isAdmin) && (
                              <button onClick={() => setConfirmDelete(u.id)}
                                title="Excluir"
                                className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de edição */}
      <AnimatePresence>
        {editingUser && editForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={closeEdit}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto main-scrollbar">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  Editar Usuário <span className="text-accent">— {editingUser.nome}</span>
                </h3>
                <button onClick={closeEdit}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-nome" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome *</label>
                  <input id="user-edit-nome" type="text" value={editForm.nome}
                    onChange={e => setEditForm((p: any) => ({ ...p, nome: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-email" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">E-mail *</label>
                  <input id="user-edit-email" type="email" value={editForm.email}
                    onChange={e => setEditForm((p: any) => ({ ...p, email: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>

                {/* Nova senha (opcional) */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-password" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nova Senha (opcional)</label>
                  <div className="relative">
                    <input id="user-edit-password" type={editShowPass ? 'text' : 'password'} value={editForm.password}
                      placeholder="Deixe em branco para manter"
                      onChange={e => setEditForm((p: any) => ({ ...p, password: e.target.value }))}
                      className="neu-input rounded-xl px-3 py-2.5 pr-10 text-sm w-full" />
                    <button type="button" onClick={() => setEditShowPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {editShowPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Setor — só admin/CEO podem alterar */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-setor" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                  <select id="user-edit-setor" value={editForm.setor}
                    onChange={e => setEditForm((p: any) => ({ ...p, setor: e.target.value }))}
                    disabled={!isGlobal || editForm.role === 'ceo'}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                    {(isGlobal ? ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'] : [callerProfile.setor]).map(s => (
                      <option key={s} value={s}>{SETOR_LABEL[s]}</option>
                    ))}
                    {editForm.role === 'ceo' && <option value="all">{SETOR_LABEL.all}</option>}
                  </select>
                </div>

                {/* Cargo — só admin/CEO podem alterar; CEO não pode promover a admin/CEO */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-role" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cargo</label>
                  <select id="user-edit-role" value={editForm.role}
                    onChange={e => setEditForm((p: any) => ({ ...p, role: e.target.value }))}
                    disabled={!isGlobal}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                    {(isAdmin
                      ? ['ceo', 'gerente', 'colaborador']
                      : isCEO
                        ? ['gerente', 'colaborador']
                        : ['colaborador']
                    ).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    {/* Se o cargo atual não estiver no conjunto editável, mantém visível como leitura */}
                    {!(isAdmin
                      ? ['ceo', 'gerente', 'colaborador']
                      : isCEO
                        ? ['gerente', 'colaborador']
                        : ['colaborador']
                    ).includes(editForm.role) && (
                      <option value={editForm.role}>{ROLE_LABEL[editForm.role] ?? editForm.role}</option>
                    )}
                  </select>
                </div>

                {/* Filial — gerente não pode atribuir Matriz */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filial / Unidade</label>
                  <select id="user-edit-filial" value={editForm.filial}
                    onChange={e => setEditForm((p: any) => ({ ...p, filial: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm">
                    {(isGerente ? FILIAIS_GERENTE : FILIAIS_HOLDING).map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={closeEdit}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleSaveEdit} disabled={editSaving}>
                  {editSaving ? 'Salvando...' : 'Salvar Alterações'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
