import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, X, Eye, EyeOff, Shield, User, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';

const SETOR_LABEL: Record<string, string> = {
  all:        'Admin',
  logistica:  'Logística',
  vendas:     'Vendas',
  financeiro: 'Financeiro',
  rh:         'RH',
};

const ROLE_LABEL: Record<string, string> = {
  admin:       'Administrador',
  gerente:     'Gerente',
  colaborador: 'Colaborador',
};

const roleCls = (r: string) =>
  r === 'admin' ? 'bg-purple-900/30 text-purple-400'
  : r === 'gerente' ? 'bg-yellow-900/30 text-yellow-400'
  : 'bg-blue-900/30 text-blue-400';

const setorCls = (s: string) =>
  s === 'logistica'  ? 'bg-green-900/30 text-green-400'
  : s === 'vendas'   ? 'bg-orange-900/30 text-orange-400'
  : s === 'financeiro' ? 'bg-cyan-900/30 text-cyan-400'
  : s === 'rh'       ? 'bg-rose-900/30 text-rose-400'
  : 'bg-gray-800/50 text-gray-400';

const EMPTY_FORM = { nome: '', email: '', password: '', role: 'colaborador', setor: 'logistica' };

export const UsuariosView = ({ showToast, profile: callerProfile }: { showToast: any; profile: UserProfile }) => {
  const { session } = useAuth();
  const { data: funcionarios } = useFetchData<any>('/api/funcionariosview');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = callerProfile.role === 'admin';
  const isGerente = callerProfile.role === 'gerente';

  useEffect(() => {
    if (!supabase) { setIsLoading(false); return; }
    let q = supabase.from('user_profiles').select('*').order('created_at', { ascending: false });
    if (isGerente) q = q.eq('setor', callerProfile.setor);
    q.then(({ data }) => { setUsers(data ?? []); setIsLoading(false); });
  }, []);

  // KPIs
  const totalGerentes     = users.filter(u => u.role === 'gerente').length;
  const totalColaboradores = users.filter(u => u.role === 'colaborador').length;

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
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(form),
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
      setForm(EMPTY_FORM);
      setShowForm(false);
      showToast('Usuário criado com sucesso.', 'success');
    } catch {
      showToast('Erro de conexão. Tente novamente.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const setorOptions = isAdmin
    ? ['logistica', 'vendas', 'financeiro', 'rh']
    : [callerProfile.setor];

  const roleOptions = isAdmin
    ? ['gerente', 'colaborador']
    : ['colaborador'];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 tracking-tight">Usuários</h2>
        <p className="text-sm text-gray-400 mt-1">
          {isAdmin ? 'Gerencie todos os usuários do sistema.' : `Gerencie os colaboradores de ${SETOR_LABEL[callerProfile.setor]}.`}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 shrink-0">
        {[
          { label: 'Total',        value: users.length,       icon: Users },
          { label: 'Gerentes',     value: totalGerentes,      icon: Shield },
          { label: 'Colaboradores',value: totalColaboradores,  icon: User },
        ].map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{k.label}</p>
            <p className="text-2xl font-black text-gray-100">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end shrink-0">
        <NeuButtonAccent variant="yellow" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} />{showForm ? 'Cancelar' : 'Novo Usuário'}
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 overflow-hidden">
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
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                  <input type={type} value={form[k]} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              ))}

              {/* Senha com olho */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Senha *</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password}
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
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                <select value={form.setor} onChange={e => setForm((p: any) => ({ ...p, setor: e.target.value }))}
                  disabled={!isAdmin} className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                  {setorOptions.map(s => <option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
                </select>
              </div>

              {/* Cargo */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cargo</label>
                <select value={form.role} onChange={e => setForm((p: any) => ({ ...p, role: e.target.value }))}
                  disabled={!isAdmin} className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                  {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="yellow" onClick={handleSave} disabled={saving}>
                {saving ? 'Criando...' : 'Criar Usuário'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 overflow-hidden shrink-0">
        {users.length === 0 ? <EmptyState message="Nenhum usuário cadastrado neste setor." /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4">E-mail</th>
                  <th className="pb-4 font-bold px-4 text-center">Setor</th>
                  <th className="pb-4 font-bold px-4 text-center">Cargo</th>
                  <th className="pb-4 font-bold px-4">Funcionário (Ponto QR)</th>
                  <th className="pb-4 font-bold px-4 text-center">Criado em</th>
                  <th className="pb-4 px-4"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {users.map(u => (
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
                        {u.id !== callerProfile.id && u.role !== 'admin' && (
                          confirmDelete === u.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => handleDelete(u.id)} disabled={deleting}
                                className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase tracking-widest transition-colors disabled:opacity-50">
                                {deleting ? '...' : 'Confirmar'}
                              </button>
                              <button onClick={() => setConfirmDelete(null)}
                                className="text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase tracking-widest transition-colors">
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(u.id)}
                              className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors ml-auto">
                              <Trash2 size={13} />
                            </button>
                          )
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
    </motion.div>
  );
};
