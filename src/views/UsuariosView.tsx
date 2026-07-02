import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, X, Eye, EyeOff, Shield, User, Trash2, Pencil, FileDown, AlertTriangle, Camera } from 'lucide-react';
import { uploadFotoPerfil, validarFotoPerfil, PERFIL_FOTO_ACCEPT } from '../lib/perfilFoto';
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

// Classes CSS dedicadas (.role-badge--* / .setor-badge--* em index.css).
// Antes Tailwind bg-X-900/30 + text-X-400 — mesmo hue no bg e no texto
// ("marketing rosa com rosa", eye blend). Agora texto bem mais claro
// (-200/-300) em dark, e tom escuro saturado em fundo claro pra modo claro.
const roleCls = (r: string) => {
  const known = ['admin', 'ceo', 'gerente', 'colaborador'];
  return `role-badge--${known.includes(r) ? r : 'colaborador'}`;
};

const setorCls = (s: string) => {
  const known = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'compras'];
  return `setor-badge--${known.includes(s) ? s : 'default'}`;
};

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
    setores_extras: [] as string[],
    filial: isGerente ? FILIAIS_GERENTE[0] : (FILIAL_DEFAULT as string),
  }), [isGerente, callerProfile.setor]);

  // Setores válidos para extras (mesma lista do backend; sem 'all').
  const SETORES_EXTRAS_DISPONIVEIS: string[] = [
    'logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti',
  ];

  const [form, setForm] = useState<any>(emptyForm);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filialFiltro, setFilialFiltro] = useState<string>('todas');
  const [setorFiltro, setSetorFiltro] = useState<string>('todos');
  const [photoUploadId, setPhotoUploadId] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [formPhotoFile, setFormPhotoFile] = useState<File | null>(null);
  const [formPhotoPreview, setFormPhotoPreview] = useState<string | null>(null);
  const formPhotoInputRef = useRef<HTMLInputElement>(null);

  // Export PDF — admin only.
  const [exportingPdf, setExportingPdf] = useState(false);
  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;

      doc.setFillColor(10, 10, 10);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setTextColor(16, 185, 129);
      doc.setFontSize(16); doc.setFont('helvetica', 'bold');
      doc.text('LogMax — Usuários', margin, 13);
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      doc.setTextColor(180, 180, 180);
      doc.text(`Total: ${filteredUsers.length}`, margin, 20);
      doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text(
        `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })}`,
        pageWidth - margin, 20, { align: 'right' }
      );

      const rows = filteredUsers.map(u => {
        const extras = (u.setores_extras ?? []).map(s => SETOR_LABEL[s] ?? s).join(', ');
        return [
          u.nome ?? '—',
          u.email ?? '—',
          ROLE_LABEL[u.role] ?? u.role,
          (SETOR_LABEL[u.setor] ?? u.setor) + (extras ? ` (+${extras})` : ''),
          u.filial ?? FILIAL_DEFAULT,
          u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—',
        ];
      });

      autoTable(doc, {
        startY: 34,
        head: [['Nome', 'E-mail', 'Cargo', 'Setor (+extras)', 'Filial', 'Criado em']],
        body: rows,
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { textColor: [50, 50, 50], fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 245] },
        margin: { left: margin, right: margin },
      });

      doc.save(`logmax-usuarios-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err: any) {
      showToast(`Erro ao gerar PDF: ${err?.message ?? '—'}`, 'error');
    } finally {
      setExportingPdf(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !photoUploadId || !supabase) return;
    const val = validarFotoPerfil(file);
    if (!val.ok) { showToast(val.motivo, 'error'); return; }
    setPhotoUploading(true);
    try {
      const url = await uploadFotoPerfil(file, photoUploadId);
      const { error } = await supabase.rpc('atualizar_foto_usuario', { p_user_id: photoUploadId, p_foto_url: url });
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === photoUploadId ? { ...u, foto_url: url } : u));
      showToast('Foto atualizada.', 'success');
    } catch (err: any) {
      showToast(`Erro ao enviar foto: ${err.message ?? err}`, 'error');
    }
    setPhotoUploading(false);
    setPhotoUploadId(null);
  };

  // Reset operacional — admin only. Modal com type-to-confirm pra evitar
  // disparo acidental (operação irreversível em transação atômica).
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetRunning, setResetRunning] = useState(false);
  const TEXTO_CONFIRMACAO = 'APAGAR TUDO';
  const handleReset = async () => {
    if (!supabase) return;
    if (resetConfirm !== TEXTO_CONFIRMACAO) return;
    setResetRunning(true);
    try {
      const { data, error } = await supabase.rpc('resetar_dados_operacionais');
      if (error) throw error;
      const preservados = (data as any)?.usuarios_preservados ?? users.length;
      showToast(`Reset concluído. ${preservados} usuário(s) preservado(s).`, 'success');
      setResetOpen(false);
      setResetConfirm('');
      // Reload imediato pra UI refletir o estado zerado.
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      showToast(`Erro no reset: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setResetRunning(false);
    }
  };

  // Edição
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editShowPass, setEditShowPass] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setIsLoading(false); return; }
    (async () => {
      try {
        const { data, error } = await supabase!.from('user_profiles').select('*').order('nome', { ascending: true });
        if (error) showToast('Erro ao carregar usuários.', 'error');
        setUsers(data ?? []);
      } catch {
        showToast('Erro de conexão ao carregar usuários.', 'error');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtragem por filial e setor (lista do banco já filtrada por setor para gerente).
  // Setor casa primário OU extras — `all` (CEO/admin) sempre passa em qualquer filtro.
  const filteredUsers = users.filter(u => {
    if (filialFiltro !== 'todas' && (u.filial ?? FILIAL_DEFAULT) !== filialFiltro) return false;
    if (setorFiltro !== 'todos') {
      const setores = [u.setor, ...(u.setores_extras ?? [])];
      if (u.setor !== 'all' && !setores.includes(setorFiltro as any)) return false;
    }
    return true;
  });

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
      // Gerente não envia setores_extras (backend bloqueia).
      const cleanExtras = (form.setores_extras ?? []).filter((s: string) => s !== form.setor);
      const basePayload = isGlobal ? { ...form, setores_extras: cleanExtras } : form;
      const payload = basePayload.role === 'ceo'
        ? { ...basePayload, setor: 'all', setores_extras: [] }
        : basePayload;
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao criar usuário.', 'error'); return; }

      // Upload de foto, se selecionada
      const newUserId: string = json.userId;
      if (formPhotoFile && supabase) {
        try {
          const url = await uploadFotoPerfil(formPhotoFile, newUserId);
          await supabase.rpc('atualizar_foto_usuario', { p_user_id: newUserId, p_foto_url: url });
        } catch { /* não bloqueia o fluxo */ }
      }

      // Recarregar lista
      if (supabase) {
        const { data } = await supabase.from('user_profiles').select('*').order('nome', { ascending: true });
        setUsers(data ?? []);
      }
      setForm(emptyForm);
      setFormPhotoFile(null);
      setFormPhotoPreview(null);
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
    if (isGerente) return u.role === 'colaborador';
    return isGlobal; // admin/CEO
  };

  const openEdit = (u: UserProfile) => {
    setEditingUser(u);
    setEditForm({
      nome: u.nome ?? '',
      email: u.email ?? '',
      role: u.role,
      setor: u.setor,
      setores_extras: (u.setores_extras ?? []) as string[],
      filial: u.filial ?? FILIAL_DEFAULT,
      password: '',
      // Default true preserva comportamento atual quando coluna ainda é nula em registros antigos.
      pode_acessar_usuarios: u.pode_acessar_usuarios !== false,
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
        // CEO já é global; extras zeradas.
        payload.setores_extras = editForm.role === 'ceo'
          ? []
          : (editForm.setores_extras ?? []).filter((s: string) => s !== payload.setor);
        payload.filial = editForm.filial;
        // Toggle de acesso ao módulo Usuários — só faz sentido em gerentes.
        if (editForm.role === 'gerente') {
          payload.pode_acessar_usuarios = !!editForm.pode_acessar_usuarios;
        }
      } else if (isGerente) {
        // Gerente: nome/email/senha + setor + filial (sem Matriz). Não toca em role.
        payload.setor = editForm.setor;
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
          setores_extras: payload.setores_extras ?? u.setores_extras,
          filial: payload.filial ?? u.filial,
          pode_acessar_usuarios: payload.pode_acessar_usuarios ?? u.pode_acessar_usuarios,
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

  const setorOptions = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'];

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
        <p className="text-sm text-gray-400 mt-1">Gerencie todos os usuários do sistema.</p>
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
        <div className="flex flex-wrap gap-2">
          <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por filial">
            <option value="todas">Todas filiais</option>
            {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={setorFiltro} onChange={e => setSetorFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por setor">
            <option value="todos">Todos setores</option>
            {['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'].map(s => (
              <option key={s} value={s}>{SETOR_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <button onClick={handleExportPdf} disabled={exportingPdf || filteredUsers.length === 0}
              className="neu-button px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-300 hover:text-accent flex items-center gap-2 disabled:opacity-40"
              title="Baixar lista em PDF">
              <FileDown size={14} />{exportingPdf ? 'Gerando...' : 'PDF'}
            </button>
          )}
          <NeuButtonAccent onClick={() => setShowForm(v => !v)}>
            <Plus size={14} />{showForm ? 'Cancelar' : 'Novo Usuário'}
          </NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Novo Usuário</h3>
              <button onClick={() => { setShowForm(false); setFormPhotoFile(null); setFormPhotoPreview(null); }} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            {/* Foto */}
            <div className="flex items-center gap-4 mb-5">
              <button type="button" onClick={() => formPhotoInputRef.current?.click()}
                className="relative w-16 h-16 rounded-full neu-button overflow-hidden flex items-center justify-center text-gray-500 hover:text-accent transition-colors shrink-0"
                title="Adicionar foto (opcional)">
                {formPhotoPreview
                  ? <img src={formPhotoPreview} alt="preview" className="w-full h-full object-cover" />
                  : <Camera size={22} />}
              </button>
              <div>
                <p className="text-xs text-gray-300 font-semibold">Foto do usuário <span className="text-gray-600 font-normal">(opcional)</span></p>
                <p className="text-[10px] text-gray-600 mt-0.5">JPG, PNG ou WEBP · máx 150 KB</p>
                {formPhotoPreview && (
                  <button type="button" onClick={() => { setFormPhotoFile(null); setFormPhotoPreview(null); }}
                    className="text-[10px] text-red-500 hover:text-red-400 mt-1">Remover</button>
                )}
              </div>
              <input ref={formPhotoInputRef} type="file" accept={PERFIL_FOTO_ACCEPT} className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]; e.target.value = '';
                  if (!f) return;
                  const val = validarFotoPerfil(f);
                  if (!val.ok) { showToast(val.motivo, 'error'); return; }
                  setFormPhotoFile(f);
                  setFormPhotoPreview(URL.createObjectURL(f));
                }} />
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
                  className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
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

            {/* Setores extras — só admin/CEO, escondido para CEO target (global). */}
            {isGlobal && form.role !== 'ceo' && (
              <div className="mt-4 flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  Setores Extras <span className="text-gray-600 normal-case tracking-normal font-normal">(acesso adicional, mantém o cargo)</span>
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {SETORES_EXTRAS_DISPONIVEIS
                    .filter(s => s !== form.setor)
                    .map(s => {
                      const active = (form.setores_extras ?? []).includes(s);
                      return (
                        <button key={s} type="button"
                          onClick={() => setForm((p: any) => ({
                            ...p,
                            setores_extras: active
                              ? p.setores_extras.filter((x: string) => x !== s)
                              : [...(p.setores_extras ?? []), s],
                          }))}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${active ? `${setorCls(s)} border-current/30` : 'neu-button border-white/5 text-gray-600 hover:text-gray-300'}`}>
                          {SETOR_LABEL[s]}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex justify-end mt-5">
              <NeuButtonAccent onClick={handleSave} disabled={saving}>
                {saving ? 'Criando...' : 'Criar Usuário'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {filteredUsers.length === 0 ? <EmptyState message={
          filialFiltro === 'todas' && setorFiltro === 'todos'
            ? 'Nenhum usuário cadastrado.'
            : `Nenhum usuário com os filtros aplicados.`
        } /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-2 w-10"></th>
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4">E-mail</th>
                  <th className="pb-4 font-bold px-4 text-center">Setor</th>
                  <th className="pb-4 font-bold px-4 text-center">Cargo</th>
                  <th className="pb-4 font-bold px-4 text-center">Filial</th>
                  <th className="pb-4 font-bold px-4">Vínculo RH</th>
                  <th className="pb-4 font-bold px-4 text-center">Criado em</th>
                  <th className="pb-4 px-4"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredUsers.map(u => (
                    <motion.tr key={u.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group/row">
                      <td className="py-3 px-2 w-10">
                        <div className="relative w-8 h-8 shrink-0">
                          {u.foto_url
                            ? <img src={u.foto_url} alt={u.nome ?? ''} className="w-8 h-8 rounded-full object-cover" />
                            : <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">{(u.nome?.[0] ?? '?').toUpperCase()}</div>
                          }
                          <button
                            onClick={() => { setPhotoUploadId(u.id); setTimeout(() => photoInputRef.current?.click(), 0); }}
                            disabled={photoUploading}
                            title="Alterar foto"
                            className="absolute inset-0 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity disabled:cursor-wait">
                            <Camera size={12} className="text-white" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{u.nome}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 font-mono">{u.email}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-wrap gap-1 justify-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${u.setor === 'all' ? 'setor-badge--global' : `border-current/25 ${setorCls(u.setor)}`}`}>
                            {SETOR_LABEL[u.setor] ?? u.setor}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-current/25 ${roleCls(u.role)}`}>
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
                                className="action-btn-edit">
                                <Pencil size={13} />
                              </button>
                            )}
                            {u.id !== callerProfile.id && u.role !== 'admin' && !(u.role === 'ceo' && !isAdmin) && (
                              <button onClick={() => setConfirmDelete(u.id)}
                                title="Excluir"
                                className="action-btn-delete">
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

      {/* Zona de Perigo — admin e CEO. Reset operacional preservando os usuários. */}
      {isGlobal && (
        <div className="neu-flat rounded-3xl p-6 border border-red-500/30 shrink-0"
             style={{ background: 'color-mix(in srgb, rgb(239 68 68) 4%, transparent)' }}>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 neu-pressed rounded-xl flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest">Zona de Perigo</h3>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Apaga <strong className="text-gray-200">TODOS os dados e cadastros</strong> (vendas, estoque, financeiro,
                folha, ponto, avaliações, marketing, histórico MaxBank, produtos, clientes, fornecedores etc.).
                Preserva os <strong className="text-gray-200">usuários</strong> (login + perfil + setor + filial)
                e as <strong className="text-gray-200">carteiras MaxBank</strong> (saldos atuais).
                Use ao trocar a turma de setor pra começar do zero.
                Operação irreversível.
              </p>
            </div>
          </div>
          <button onClick={() => { setResetConfirm(''); setResetOpen(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest
                       bg-red-500/10 text-red-400 border border-red-500/30
                       hover:bg-red-500/20 hover:text-red-300 transition-colors">
            <Trash2 size={13} /> Apagar tudo (manter usuários)
          </button>
        </div>
      )}

      {/* Modal de confirmação do reset */}
      <AnimatePresence>
        {resetOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !resetRunning && setResetOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-red-500/30 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle size={20} className="text-red-500" />
                <h3 className="text-base font-bold text-red-400">Apagar TODOS os dados?</h3>
              </div>
              <div className="text-sm text-gray-300 space-y-2 mb-4">
                <p>Esta operação vai <strong className="text-red-400">apagar permanentemente</strong>:</p>
                <ul className="text-xs text-gray-400 space-y-1 pl-4 list-disc">
                  <li>Vendas, estoque, recebimentos, expedição</li>
                  <li>Financeiro: contas a pagar/receber, caixa, conciliações</li>
                  <li>RH: ponto, folha, férias, afastamentos, treinamentos</li>
                  <li>Avaliações, pesquisas, feedbacks, PDIs</li>
                  <li>Marketing: campanhas, promoções, cupons, calendário</li>
                  <li>MaxBank: transações, transferências, metas, folgas, créditos de folha (carteiras preservadas)</li>
                  <li>Cadastros: produtos, serviços, clientes, fornecedores, funcionários</li>
                  <li>Filiais, configurações, formas de pagamento</li>
                </ul>
                <p className="text-emerald-400 text-xs pt-2">
                  ✓ <strong>Preserva:</strong> todos os usuários (login + setor + filial) e as carteiras MaxBank
                  (saldo de salário, benefícios e bonificações).
                </p>
              </div>
              <div className="flex flex-col gap-2 mb-4">
                <label htmlFor="reset-confirm" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  Digite <span className="text-red-400">{TEXTO_CONFIRMACAO}</span> para liberar o botão
                </label>
                <input id="reset-confirm" type="text" value={resetConfirm} autoFocus
                  onChange={e => setResetConfirm(e.target.value)}
                  disabled={resetRunning}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono"
                  placeholder={TEXTO_CONFIRMACAO} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setResetOpen(false)} disabled={resetRunning}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={handleReset}
                  disabled={resetRunning || resetConfirm !== TEXTO_CONFIRMACAO}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest
                             bg-red-500 text-white hover:bg-red-600 transition-colors
                             disabled:opacity-30 disabled:cursor-not-allowed">
                  {resetRunning ? 'Apagando...' : 'Confirmar e apagar tudo'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={photoInputRef} type="file" accept={PERFIL_FOTO_ACCEPT} className="hidden" onChange={handlePhotoUpload} />

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

                {/* Setor — admin/CEO/gerente podem alterar (gerente só em colaboradores) */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-setor" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                  <select id="user-edit-setor" value={editForm.setor}
                    onChange={e => setEditForm((p: any) => ({ ...p, setor: e.target.value }))}
                    disabled={editForm.role === 'ceo'}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                    {['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti'].map(s => (
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

              {/* Toggle de acesso ao módulo Usuários — só admin/CEO, só em gerentes. */}
              {isGlobal && editForm.role === 'gerente' && (
                <div className="mt-4 neu-flat rounded-2xl p-4 border border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">
                        Acesso ao módulo Usuários
                      </p>
                      <p className="text-xs text-gray-400">
                        Quando desativado, este gerente perde o item "Usuários" na sidebar e não pode criar, editar ou excluir colaboradores.
                      </p>
                    </div>
                    <button type="button"
                      onClick={() => setEditForm((p: any) => ({ ...p, pode_acessar_usuarios: !p.pode_acessar_usuarios }))}
                      className={`relative shrink-0 w-12 h-6 rounded-full transition-colors ${editForm.pode_acessar_usuarios ? 'bg-accent' : 'bg-gray-700'}`}
                      title={editForm.pode_acessar_usuarios ? 'Acesso habilitado' : 'Acesso desabilitado'}
                      aria-pressed={editForm.pode_acessar_usuarios}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${editForm.pode_acessar_usuarios ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* Setores extras — admin/CEO, exceto quando target é CEO (global). */}
              {isGlobal && editForm.role !== 'ceo' && (
                <div className="mt-4 flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                    Setores Extras <span className="text-gray-600 normal-case tracking-normal font-normal">(acesso adicional, mantém o cargo)</span>
                  </label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {SETORES_EXTRAS_DISPONIVEIS
                      .filter(s => s !== editForm.setor)
                      .map(s => {
                        const active = (editForm.setores_extras ?? []).includes(s);
                        return (
                          <button key={s} type="button"
                            onClick={() => setEditForm((p: any) => ({
                              ...p,
                              setores_extras: active
                                ? p.setores_extras.filter((x: string) => x !== s)
                                : [...(p.setores_extras ?? []), s],
                            }))}
                            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${active ? `${setorCls(s)} border-current/30` : 'neu-button border-white/5 text-gray-600 hover:text-gray-300'}`}>
                            {SETOR_LABEL[s]}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

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
