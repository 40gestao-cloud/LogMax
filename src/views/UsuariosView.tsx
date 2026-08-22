import React, { useState, useEffect, useMemo, useRef } from 'react';
import { todayBR } from '../lib/dates';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, X, Eye, EyeOff, Shield, User, Trash2, Pencil, FileDown, FileSpreadsheet, AlertTriangle, Camera, KeyRound, Copy, Building2 } from 'lucide-react';
import { uploadFotoPerfil, validarFotoPerfil, PERFIL_FOTO_ACCEPT } from '../lib/perfilFoto';
import { supabase } from '../lib/supabase';
import { freshToken } from '../lib/authFetch';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FilialBadge } from '../components/ui';
import { useFetchData } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';
import { FILIAIS_HOLDING } from '../lib/filiais';
import { exportToExcel } from '../lib/viewUtils';
import { useFilial } from '../contexts/FilialContext';

const SETOR_LABEL: Record<string, string> = {
  all:        'Global',
  logistica:  'Logística',
  vendas:     'Vendas',
  financeiro: 'Financeiro',
  rh:         'RH',
  marketing:  'Marketing',
  ti:         'TI',
  gerencia:   'Gerência',
};

// Setores que o select oferece a todo mundo. 'all' fica de fora: é escopo de
// cargo global (admin/CEO/conselheiro), não um setor que se escolhe.
const SETORES_SELECIONAVEIS = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'gerencia'];

const roleEscopoGlobal = (role: string) => role === 'ceo' || role === 'conselheiro';

/**
 * Setor coerente com o cargo.
 *
 * Existe pelo mesmo motivo da correção de filial logo abaixo, e o bug era o
 * mesmo: ao rebaixar um CEO, a `<option value="all">` some do select, o
 * navegador passa a exibir a primeira opção ("Logística") e o estado React
 * continua 'all' — remover uma option não dispara `onChange`. A tela dizia
 * Logística e o payload mandava 'all'; o usuário virava colaborador com
 * escopo global, que foi o que aconteceu com três alunos em 2026-08-07.
 */
const setorParaRole = (role: string, setor: string): string => {
  if (roleEscopoGlobal(role)) return 'all';
  return setor === 'all' ? SETORES_SELECIONAVEIS[0] : setor;
};

const ROLE_LABEL: Record<string, string> = {
  admin:       'Administrador',
  ceo:         'CEO',
  gerente:     'Gerente',
  colaborador: 'Colaborador',
  conselheiro: 'Conselheiro',
};

// Classes CSS dedicadas (.role-badge--* / .setor-badge--* em index.css).
// Antes Tailwind bg-X-900/30 + text-X-400 — mesmo hue no bg e no texto
// ("marketing rosa com rosa", eye blend). Agora texto bem mais claro
// (-200/-300) em dark, e tom escuro saturado em fundo claro pra modo claro.
const roleCls = (r: string) => {
  const known = ['admin', 'ceo', 'gerente', 'colaborador', 'conselheiro'];
  return `role-badge--${known.includes(r) ? r : 'colaborador'}`;
};

const setorCls = (s: string) => {
  const known = ['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'compras', 'gerencia'];
  return `setor-badge--${known.includes(s) ? s : 'default'}`;
};

// Filiais que gerentes podem atribuir — Matriz é exclusiva de admin/CEO.
const FILIAIS_GERENTE = FILIAIS_HOLDING.filter(f => f !== 'Matriz');

// Conta criada e ainda não alocada (migr. 411): `filial IS NULL`. No form e no
// filtro isso é a string vazia, porque `<option>` não carrega null.
//
// Não é a Matriz. Matriz é escopo de cargo global; isto é ausência de decisão,
// e existe porque montar turma são dezenas de contas numa sentada e a alocação
// se resolve depois, com todo mundo na frente. Enquanto está assim, o aluno
// esbarra em "Filial não configurada" ao entrar — que é a sala de espera dele.
const SEM_ALOCACAO = '';
const filialLabel = (f?: string | null) => f || 'Sem alocação';

// Só admin/CEO/conselheiro podem ficar em Matriz. Colaborador e gerente
// precisam de unidade operacional, senão travam no gate "Filial não
// configurada" (FilialContext rejeita Matriz como filialAtiva).
const filiaisParaRole = (role: string): readonly string[] =>
  role === 'colaborador' || role === 'gerente' ? FILIAIS_GERENTE : (FILIAIS_HOLDING as readonly string[]);

export const UsuariosView = ({ showToast, profile: callerProfile }: { showToast: any; profile: UserProfile }) => {
  // Modo filial (filialAtiva setado — inclui gerente/colaborador, sempre
  // travados na própria unidade) só mostra Admin/CEO/Conselheiro (globais)
  // + gerente/colaborador da filial ativa. Modo Matriz (filialAtiva null,
  // só admin/CEO/Conselheiro chegam lá) mostra todos.
  const { filialAtiva } = useFilial();
  // Em modo filial (filialAtiva setado) só busca funcionários da unidade
  // ativa — vale pra gerente/colaborador (sempre travados) e também pra
  // admin/CEO/Conselheiro operando dentro de uma filial específica. Só em
  // modo Matriz (filialAtiva null, exclusivo dos globais) busca todos.
  const isGlobalCaller = callerProfile.role === 'admin' || callerProfile.role === 'ceo' || callerProfile.role === 'conselheiro' || (callerProfile.role === 'gerente' && callerProfile.is_conselheiro === true);
  const funcionariosFilter = filialAtiva ? { filial: filialAtiva } : (isGlobalCaller ? undefined : { filial: callerProfile.filial });
  const { data: funcionarios } = useFetchData<any>('/api/funcionariosview', funcionariosFilter);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const isAdmin = callerProfile.role === 'admin';
  const isCEO = callerProfile.role === 'ceo';
  const isGerente = callerProfile.role === 'gerente';
  // Admin e CEO têm visão/escopo global; CEO não pode promover admin/CEO.
  const isConselheiroCaller = callerProfile.role === 'conselheiro' || (callerProfile.role === 'gerente' && callerProfile.is_conselheiro === true);
  const isGlobal = isAdmin || isCEO || isConselheiroCaller;

  // Form vazio depende do papel: gerente herda seu próprio setor (não pode trocar)
  // e tem default de filial fora da Matriz.
  // Colaborador (role default) SEMPRE começa em unidade operacional — nunca
  // Matriz, senão o FilialContext trava o login com "Filial não configurada".
  const emptyForm = useMemo(() => ({
    nome: '',
    email: '',
    password: '',
    role: 'colaborador',
    setor: isGerente ? callerProfile.setor : 'logistica',
    setores_extras: [] as string[],
    // Gerente não-global só cria colaborador da própria filial — trava aqui
    // em vez de deixar SuperMax como default e depender do select.
    //
    // Para quem organiza a turma, o default é SEM alocação: criar as contas é
    // uma sentada só, distribuir nas unidades é outra. Escolher unidade na
    // criação obrigava a decidir cedo e reorganizar depois.
    filial: (isGerente && !isGlobal ? callerProfile.filial : SEM_ALOCACAO) as string,
  }), [isGerente, isGlobal, callerProfile.setor, callerProfile.filial]);

  // Setores válidos para extras (mesma lista do backend; sem 'all').
  const SETORES_EXTRAS_DISPONIVEIS: string[] = [
    'logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'gerencia',
  ];

  const [form, setForm] = useState<any>(emptyForm);
  // Corrige filial quando role muda para não-global: Matriz deixa de ser
  // válida e o select some com a opção, mas o value permaneceria 'Matriz'
  // e travaria o novo usuário no gate de login.
  useEffect(() => {
    if ((form.role === 'colaborador' || form.role === 'gerente') && form.filial === 'Matriz') {
      setForm((p: any) => ({ ...p, filial: FILIAIS_GERENTE[0] }));
    }
    const setorOk = setorParaRole(form.role, form.setor);
    if (setorOk !== form.setor) setForm((p: any) => ({ ...p, setor: setorOk }));
  }, [form.role, form.filial, form.setor]);
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

  // Export PDF/Excel — admin only.
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const usuariosExportColumns = ['Nome', 'E-mail', 'Cargo', 'Setor (+extras)', 'Filial', 'Criado em'];
  const buildUsuariosExportRows = () => filteredUsers.map(u => {
    const extras = (u.setores_extras ?? []).map(s => SETOR_LABEL[s] ?? s).join(', ');
    return [
      u.nome ?? '—',
      u.email ?? '—',
      ROLE_LABEL[u.role] ?? u.role,
      (SETOR_LABEL[u.setor] ?? u.setor) + (extras ? ` (+${extras})` : ''),
      filialLabel(u.filial),
      u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—',
    ];
  });
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

      const rows = buildUsuariosExportRows();

      autoTable(doc, {
        startY: 34,
        head: [usuariosExportColumns],
        body: rows,
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { textColor: [50, 50, 50], fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 245] },
        margin: { left: margin, right: margin },
      });

      doc.save(`logmax-usuarios-${todayBR()}.pdf`);
    } catch (err: any) {
      showToast(`Erro ao gerar PDF: ${err?.message ?? '—'}`, 'error');
    } finally {
      setExportingPdf(false);
    }
  };
  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      await exportToExcel('Usuários', usuariosExportColumns, buildUsuariosExportRows(), `logmax-usuarios-${todayBR()}`);
    } catch (err: any) {
      showToast(`Erro ao gerar Excel: ${err?.message ?? '—'}`, 'error');
    } finally {
      setExportingExcel(false);
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
      // `_admin` e não a original: a migr. 412 tirou o grant da original para
      // `authenticated` e pôs esta porta na frente, que exige role = 'admin'
      // literal. A original continua intocada — é a lista de TRUNCATE, e
      // reescrevê-la só para trocar um guard reverteria o que as migrs. 377 e
      // 395 mandaram preservar.
      const { data, error } = await supabase.rpc('resetar_dados_operacionais_admin');
      if (error) throw error;
      const d = data as any;
      const partes = [
        `${d?.usuarios_preservados ?? users.length} usuário(s)`,
        d?.funcionarios_preservados != null ? `${d.funcionarios_preservados} funcionário(s)` : null,
        d?.filiais_preservadas      != null ? `${d.filiais_preservadas} filial(is)`         : null,
        // (504) O ponto passou a atravessar o reset. Aparece cedo na lista de
        // propósito: é o número que o professor confere primeiro quando o que
        // ele teme perder é a frequência da turma.
        d?.ponto_preservado         != null ? `${d.ponto_preservado} registro(s) de ponto` : null,
        // (504) Documentos da Matriz: sempre atravessaram o reset, mas isso só
        // aparecia por ausência. Agora aparece por número.
        d?.documentos_preservados   != null ? `${d.documentos_preservados} documento(s)` : null,
        // Blocos que a migração 377 tirou do TRUNCATE — mostrar aqui é o que
        // dá ao professor a confirmação de que a competição das filiais
        // atravessou o reset.
        d?.competicoes_preservadas  != null ? `${d.competicoes_preservadas} competição(ões)`  : null,
        d?.notas_placar_preservadas != null ? `${d.notas_placar_preservadas} nota(s) do placar` : null,
        d?.avaliacoes_matriz_preservadas != null ? `${d.avaliacoes_matriz_preservadas} avaliação(ões) da Matriz` : null,
        d?.tarefas_matriz_preservadas != null ? `${d.tarefas_matriz_preservadas} tarefa(s) da Matriz` : null,
        // (482) Fundo de cadastro que passou a atravessar o reset.
        d?.fornecedores_preservados != null ? `${d.fornecedores_preservados} fornecedor(es)` : null,
        d?.categorias_preservadas   != null ? `${d.categorias_preservadas} categoria(s)`     : null,
      ].filter(Boolean).join(', ');
      showToast(`Reset concluído. Preservados: ${partes}.`, 'success');
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

  // ── Reset de UMA unidade (migr. 484) ────────────────────────────────────
  // O fluxo tem duas etapas de propósito, e a primeira é obrigatória: escolher
  // a unidade não apaga nada, só chama a RPC em modo ensaio e mostra o que
  // sairia, tabela por tabela. Só depois de ver a conta é que o campo de
  // confirmação aparece. Reset global se digita "APAGAR TUDO" no escuro porque
  // o escopo é óbvio; aqui não é — 130 linhas ou 4 muda tudo, e o professor
  // precisa reconhecer a unidade pelos números antes de confirmar.
  const [filialResetOpen, setFilialResetOpen] = useState(false);
  const [filialAlvo, setFilialAlvo]           = useState<string>('');
  const [ensaio, setEnsaio]                   = useState<any | null>(null);
  const [ensaioRunning, setEnsaioRunning]     = useState(false);
  const [filialConfirm, setFilialConfirm]     = useState('');
  const [filialRunning, setFilialRunning]     = useState(false);

  const abrirResetFilial = () => {
    setFilialAlvo(''); setEnsaio(null); setFilialConfirm('');
    setFilialResetOpen(true);
  };

  // Ensaio: `p_dry_run` fica no default (true). Nada é apagado.
  const carregarEnsaio = async (filial: string) => {
    setFilialAlvo(filial);
    setEnsaio(null);
    setFilialConfirm('');
    if (!supabase || !filial) return;
    setEnsaioRunning(true);
    try {
      const { data, error } = await supabase.rpc('resetar_dados_da_filial', { p_filial: filial });
      if (error) throw error;
      setEnsaio(data);
    } catch (err: any) {
      showToast(`Não foi possível medir: ${err?.message ?? err}`, 'error');
    } finally {
      setEnsaioRunning(false);
    }
  };

  const executarResetFilial = async () => {
    if (!supabase || filialConfirm !== filialAlvo) return;
    setFilialRunning(true);
    try {
      const { data, error } = await supabase.rpc('resetar_dados_da_filial', {
        p_filial: filialAlvo, p_dry_run: false,
      });
      if (error) throw error;
      const d = data as any;
      showToast(
        `${filialAlvo} zerada: ${d?.linhas ?? 0} registro(s) apagado(s)`
        + (Number(d?.estorno_total) > 0
            ? `, R$ ${Number(d.estorno_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} devolvidos à Matriz.`
            : '.'),
        'success');
      setFilialResetOpen(false);
      setTimeout(() => window.location.reload(), 900);
    } catch (err: any) {
      // A função aborta a transação inteira quando sobra linha presa por FK —
      // a mensagem dela diz qual tabela, e é o que o professor precisa mandar
      // para quem mexe no banco.
      showToast(`Reset abortado: ${err?.message ?? 'verifique o console'}`, 'error');
      console.error('[Usuarios] reset por filial:', err);
    } finally {
      setFilialRunning(false);
    }
  };

  // Edição
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [editShowPass, setEditShowPass] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  // Mesma correção do form de criar: se troca de role global para colaborador/gerente
  // com filial Matriz, força unidade operacional (senão o usuário editado não
  // consegue mais entrar no app).
  useEffect(() => {
    if (!editForm) return;
    if ((editForm.role === 'colaborador' || editForm.role === 'gerente') && editForm.filial === 'Matriz') {
      setEditForm((p: any) => (p ? { ...p, filial: FILIAIS_GERENTE[0] } : p));
    }
    const setorOk = setorParaRole(editForm.role, editForm.setor);
    if (setorOk !== editForm.setor) {
      setEditForm((p: any) => (p ? { ...p, setor: setorOk } : p));
    }
  }, [editForm?.role, editForm?.filial, editForm?.setor]);

  // ---- Cofre de senhas (migr. 409) ----
  // O Auth guarda só o hash, que é irreversível: o que aparece aqui é a senha
  // anotada no momento em que o painel a definiu. Quem foi criado antes da
  // migração não tem registro, e só passa a ter depois de um reset.
  // A RLS já restringe a leitura a role='admin'; o `isAdmin` abaixo evita o
  // request inútil de quem sabidamente receberia lista vazia.
  const [senhas, setSenhas] = useState<Record<string, string>>({});
  const [senhaVisivel, setSenhaVisivel] = useState<Record<string, boolean>>({});
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [resetandoId, setResetandoId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!supabase || !isAdmin) return;
    (async () => {
      const { data } = await supabase!.from('senhas_visiveis').select('user_id, senha');
      if (!data) return;
      setSenhas(Object.fromEntries(data.map((r: any) => [r.user_id, r.senha])));
    })();
  }, [isAdmin]);

  const copiarSenha = async (senha: string) => {
    try {
      await navigator.clipboard.writeText(senha);
      showToast('Senha copiada.', 'success');
    } catch {
      showToast('Não foi possível copiar. Selecione e copie à mão.', 'error');
    }
  };

  const handleResetSenha = async (userId: string) => {
    const token = await freshToken();
    if (!token) { showToast('Sessão expirada. Faça login novamente.', 'error'); return; }
    setResetandoId(userId);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'reset-password', userId }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao redefinir senha.', 'error'); return; }
      setSenhas(prev => ({ ...prev, [userId]: json.password }));
      // Revela sozinha: o professor acabou de pedir essa senha pra ditar.
      setSenhaVisivel(prev => ({ ...prev, [userId]: true }));
      showToast(`Nova senha: ${json.password}`, 'success');
    } catch {
      showToast('Erro de conexão.', 'error');
    } finally {
      setResetandoId(null);
      setConfirmReset(null);
    }
  };

  const isGlobalRole = (u: UserProfile) =>
    u.role === 'admin' || u.role === 'ceo' || u.role === 'conselheiro' || (u.role === 'gerente' && u.is_conselheiro === true);

  // Filtragem por filial e setor (lista do banco já filtrada por setor para gerente).
  // Setor casa primário OU extras — `all` (CEO/admin) sempre passa em qualquer filtro.
  const filteredUsers = users.filter(u => {
    // Modo filial: só globais (admin/CEO/conselheiro) + gerente/colaborador
    // da própria filial ativa — nada de outra unidade aparece.
    if (filialAtiva && !isGlobalRole(u) && (u.filial ?? SEM_ALOCACAO) !== filialAtiva) return false;
    if (filialFiltro !== 'todas' && (u.filial ?? SEM_ALOCACAO) !== filialFiltro) return false;
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
    const token = await freshToken();
    if (!token) { showToast('Sessão expirada. Faça login novamente.', 'error'); return; }
    setDeleting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', userId }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao excluir.', 'error'); return; }
      setUsers(prev => prev.filter(u => u.id !== userId));
      // O cofre cascateia no banco (FK ON DELETE CASCADE); aqui é só o espelho.
      setSenhas(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== userId)));
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
    const token = await freshToken();
    if (!token) { showToast('Sessão expirada. Faça login novamente.', 'error'); return; }

    setSaving(true);
    try {
      // CEO é global por definição — força setor='all' antes de enviar.
      // Gerente não envia setores_extras (backend bloqueia).
      const cleanExtras = (form.setores_extras ?? []).filter((s: string) => s !== form.setor);
      const basePayload = isGlobal ? { ...form, setores_extras: cleanExtras } : form;
      const payload = (basePayload.role === 'ceo' || basePayload.role === 'conselheiro')
        ? { ...basePayload, setor: 'all', setores_extras: [] }
        : basePayload;
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'create', ...payload }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao criar usuário.', 'error'); return; }

      // Upload de foto, se selecionada
      const newUserId: string = json.userId;
      setSenhas(prev => ({ ...prev, [newUserId]: form.password }));
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
      if (formPhotoPreview) URL.revokeObjectURL(formPhotoPreview);
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
  //
  // Só o professor. CEO, conselheiro e gerente são alunos, e a tela virou
  // leitura para eles — quem edita usuário manda no acesso de um colega. O
  // `/api/users` recusa igual (portão único no topo do handler); isto aqui só
  // evita botão que existe pra dar 403.
  const canEdit = (u: UserProfile) => {
    if (!isAdmin) return false;
    if (u.id === callerProfile.id) return true;  // self
    return u.role !== 'admin';                   // um admin não edita o outro
  };

  const openEdit = (u: UserProfile) => {
    setEditingUser(u);
    setEditForm({
      nome: u.nome ?? '',
      email: u.email ?? '',
      role: u.role,
      setor: u.setor,
      setores_extras: (u.setores_extras ?? []) as string[],
      filial: u.filial ?? SEM_ALOCACAO,
      password: '',
      // Default true preserva comportamento atual quando coluna ainda é nula em registros antigos.
      pode_acessar_usuarios: u.pode_acessar_usuarios !== false,
      is_conselheiro: u.is_conselheiro === true,
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
    const token = await freshToken();
    if (!token) { showToast('Sessão expirada. Faça login novamente.', 'error'); return; }

    setEditSaving(true);
    try {
      // Payload — gerente não envia role/setor/filial.
      const payload: any = {
        userId: editingUser.id,
        nome: editForm.nome,
        email: editForm.email,
      };
      if (editForm.password && (isAdmin || editingUser.id === callerProfile.id)) {
        payload.password = editForm.password;
      }
      if (isGlobal) {
        payload.role = editForm.role;
        // Nunca envia `editForm.setor` cru: se o cargo mudou para não-global,
        // 'all' ainda pode estar no estado (a option some sem disparar
        // onChange). `setorParaRole` é a mesma régua do efeito acima.
        payload.setor = setorParaRole(editForm.role, editForm.setor);
        // CEO já é global; extras zeradas.
        payload.setores_extras = editForm.role === 'ceo'
          ? []
          : (editForm.setores_extras ?? []).filter((s: string) => s !== payload.setor);
        payload.filial = editForm.filial;
        // Toggle de acesso ao módulo Usuários — só faz sentido em gerentes.
        if (editForm.role === 'gerente') {
          payload.pode_acessar_usuarios = !!editForm.pode_acessar_usuarios;
          payload.is_conselheiro = !!editForm.is_conselheiro;
        }
      } else if (isGerente) {
        // Gerente: nome/email/senha + setor + filial (sem Matriz). Não toca em role.
        payload.setor = editForm.setor;
        if (editForm.filial && editForm.filial !== 'Matriz') payload.filial = editForm.filial;
      }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'update', ...payload }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? 'Erro ao atualizar.', 'error'); return; }

      if (payload.password) {
        setSenhas(prev => ({ ...prev, [editingUser.id]: payload.password }));
      }

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
          is_conselheiro: payload.is_conselheiro ?? u.is_conselheiro,
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

  const setorOptions = SETORES_SELECIONAVEIS;

  // Admin pode criar CEO/gerente/colaborador. CEO pode criar gerente/colaborador.
  // Gerente só cria colaborador.
  const roleOptions = isAdmin
    ? ['ceo', 'conselheiro', 'gerente', 'colaborador']
    : isCEO
      ? ['conselheiro', 'gerente', 'colaborador']
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
          {/* Em modo filial o escopo já é travado pela unidade ativa — o
              seletor manual só faz sentido em modo Matriz (consolidado). */}
          {filialAtiva ? (
            <div className="neu-pressed py-2.5 px-3 rounded-xl text-sm text-gray-400 flex items-center gap-1.5" title="Filial ativa">
              <FilialBadge filial={filialAtiva} />
            </div>
          ) : (
            <select value={filialFiltro} onChange={e => setFilialFiltro(e.target.value)}
              className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por filial">
              <option value="todas">Todas filiais</option>
              {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
              {/* A fila de alocação: quem foi criado e ainda não tem unidade. */}
              <option value={SEM_ALOCACAO}>Sem alocação</option>
            </select>
          )}
          <select value={setorFiltro} onChange={e => setSetorFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm" title="Filtrar por setor">
            <option value="todos">Todos setores</option>
            {['logistica', 'vendas', 'financeiro', 'rh', 'marketing', 'ti', 'gerencia'].map(s => (
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
          {isAdmin && (
            <button onClick={handleExportExcel} disabled={exportingExcel || filteredUsers.length === 0}
              className="neu-button px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-300 hover:text-accent flex items-center gap-2 disabled:opacity-40"
              title="Baixar lista em Excel">
              <FileSpreadsheet size={14} />{exportingExcel ? 'Gerando...' : 'Excel'}
            </button>
          )}
          {isAdmin && (
            <NeuButtonAccent onClick={() => setShowForm(v => !v)}>
              <Plus size={14} />{showForm ? 'Cancelar' : 'Novo Usuário'}
            </NeuButtonAccent>
          )}
        </div>
      </div>

      {/* Aviso de leitura — sem ele, quem não é admin acha que a tela quebrou
          ao não encontrar botão nenhum. */}
      {!isAdmin && (
        <div className="neu-flat rounded-2xl px-4 py-3 border border-white/5 shrink-0 flex items-center gap-2.5">
          <Eye size={14} className="text-gray-500 shrink-0" />
          <p className="text-xs text-gray-400">
            Consulta apenas. Criar usuário, trocar senha, mudar cargo ou excluir conta é do administrador.
          </p>
        </div>
      )}

      <AnimatePresence>
        {showForm && isAdmin && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Novo Usuário</h3>
              <button onClick={() => { setShowForm(false); setFormPhotoFile(null); if (formPhotoPreview) URL.revokeObjectURL(formPhotoPreview); setFormPhotoPreview(null); }} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
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
                  <button type="button" onClick={() => { setFormPhotoFile(null); if (formPhotoPreview) URL.revokeObjectURL(formPhotoPreview); setFormPhotoPreview(null); }}
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
                  if (formPhotoPreview) URL.revokeObjectURL(formPhotoPreview);
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

              {/* Filial / Unidade — colaborador/gerente não podem atribuir Matriz
                  (FilialContext bloqueia login com Matriz para não-globais).
                  Gerente não-global fica travado na própria filial — não cobre
                  outras unidades (regra de negócio). */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="user-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filial / Unidade</label>
                <select id="user-filial" value={form.filial} onChange={e => setForm((p: any) => ({ ...p, filial: e.target.value }))}
                  disabled={isGerente && !isGlobal}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                  {/* Gerente não deixa conta em aberto — o backend recusa. */}
                  {isGlobal && <option value={SEM_ALOCACAO}>Sem alocação (definir depois)</option>}
                  {(isGerente && !isGlobal ? [callerProfile.filial] : filiaisParaRole(form.role)).map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                {form.filial === SEM_ALOCACAO && (
                  <p className="text-[10px] text-gray-600 leading-relaxed">
                    A conta é criada e fica aguardando: até você escolher a unidade, o aluno vê
                    "Filial não configurada" ao entrar.
                  </p>
                )}
              </div>
            </div>

            {/* Setores extras — só admin/CEO, escondido para CEO target (global). */}
            {isGlobal && form.role !== 'ceo' && form.role !== 'conselheiro' && (
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
                  {isAdmin && <th className="pb-4 font-bold px-4">Senha</th>}
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
                          {isAdmin && (
                            <button
                              onClick={() => { setPhotoUploadId(u.id); setTimeout(() => photoInputRef.current?.click(), 0); }}
                              disabled={photoUploading}
                              title="Alterar foto"
                              className="absolute inset-0 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity disabled:cursor-wait">
                              <Camera size={12} className="text-white" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{u.nome}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 font-mono">{u.email}</td>
                      {isAdmin && (
                        <td className="py-3 px-4">
                          {senhas[u.id] ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono text-gray-300 select-all min-w-[5.5rem]">
                                {senhaVisivel[u.id] ? senhas[u.id] : '••••••••'}
                              </span>
                              <button
                                onClick={() => setSenhaVisivel(p => ({ ...p, [u.id]: !p[u.id] }))}
                                title={senhaVisivel[u.id] ? 'Ocultar senha' : 'Mostrar senha'}
                                className="text-gray-500 hover:text-gray-200 transition-colors">
                                {senhaVisivel[u.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                              {senhaVisivel[u.id] && (
                                <button onClick={() => copiarSenha(senhas[u.id])} title="Copiar senha"
                                  className="text-gray-500 hover:text-accent transition-colors">
                                  <Copy size={12} />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-600" title="Senha definida antes do cofre existir — o hash do Auth não pode ser lido de volta. Use Redefinir senha.">
                              não registrada
                            </span>
                          )}
                        </td>
                      )}
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
                      <td className="py-3 px-4 text-center">
                        {u.filial
                          ? <FilialBadge filial={u.filial} />
                          : (
                            /* Âmbar e não cinza: isto é pendência sua, não um
                               dado ausente. O FilialBadge devolveria só "—". */
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-amber-500/25 bg-amber-500/10 text-amber-400">
                              Sem alocação
                            </span>
                          )}
                      </td>
                      <td className="py-3 px-4">
                        {isAdmin ? (
                          <select
                            value={u.funcionario_id ?? ''}
                            onChange={e => handleLinkFuncionario(u.id, e.target.value)}
                            className="neu-input rounded-lg px-2 py-1.5 text-xs w-full max-w-[160px]"
                          >
                            <option value="">Sem vínculo</option>
                            {funcionarios.filter((f: any) => f.filial === u.filial).map((f: any) => (
                              <option key={f.id} value={f.id}>{f.nome}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {funcionarios.find((f: any) => f.id === u.funcionario_id)?.nome ?? 'Sem vínculo'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-center text-gray-500">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {confirmReset === u.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest">Nova senha?</span>
                            <button onClick={() => handleResetSenha(u.id)} disabled={resetandoId === u.id}
                              className="text-[10px] text-accent hover:brightness-125 font-bold uppercase tracking-widest transition-all disabled:opacity-50">
                              {resetandoId === u.id ? '...' : 'Gerar'}
                            </button>
                            <button onClick={() => setConfirmReset(null)}
                              className="text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase tracking-widest transition-colors">
                              Cancelar
                            </button>
                          </div>
                        ) : confirmDelete === u.id ? (
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
                            {/* Só admin: a resposta traz a senha em texto, então
                                quem reseta entra na conta do alvo. CEO,
                                conselheiro e gerente são alunos. */}
                            {isAdmin && (u.role !== 'admin' || u.id === callerProfile.id) && (
                              <button onClick={() => setConfirmReset(u.id)}
                                title="Redefinir senha (gera uma nova e mostra na coluna Senha)"
                                className="action-btn-edit">
                                <KeyRound size={13} />
                              </button>
                            )}
                            {isAdmin && u.id !== callerProfile.id && u.role !== 'admin' && (
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

      {/* Zona de Perigo — só o professor. Era `isGlobal`, o que colocava o
          botão mais destrutivo do app na mão de CEO e conselheiro, que são
          alunos. Esconder aqui não fechava o F12: a migr. 412 é que fecha,
          tirando o grant da RPC original e pondo `_admin` na frente. */}
      {isAdmin && (
        <div className="neu-flat rounded-3xl p-6 border border-red-500/30 shrink-0"
             style={{ background: 'color-mix(in srgb, rgb(239 68 68) 4%, transparent)' }}>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 neu-pressed rounded-xl flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-red-400 uppercase tracking-widest">Zona de Perigo</h3>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Apaga <strong className="text-gray-200">TODOS os dados operacionais</strong> (vendas, estoque, financeiro,
                folha, avaliações, marketing, histórico MaxBank, produtos, serviços e clientes).
                Preserva os <strong className="text-gray-200">usuários</strong> (login + perfil + setor + filial),
                os <strong className="text-gray-200">funcionários</strong>, o <strong className="text-gray-200">Registro de Ponto</strong>{' '}
                (frequência lançada, afastamentos e justificativas — migr. 504),
                as <strong className="text-gray-200">carteiras MaxBank</strong> (saldos atuais), as <strong className="text-gray-200">filiais</strong>
                e — desde a migr. 482 — os <strong className="text-gray-200">fornecedores</strong> e as{' '}
                <strong className="text-gray-200">categorias de produto</strong>.
                Use ao trocar a turma de setor pra começar do zero.
                Operação irreversível.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setResetConfirm(''); setResetOpen(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest
                         bg-red-500/10 text-red-400 border border-red-500/30
                         hover:bg-red-500/20 hover:text-red-300 transition-colors">
              <Trash2 size={13} /> Apagar tudo (manter usuários)
            </button>
            {/* Âmbar, não vermelho: apagar uma unidade é menor que apagar a
                holding, e dar a mesma cor às duas faria a diferença sumir
                justamente onde ela importa. */}
            <button onClick={abrirResetFilial}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest
                         bg-amber-500/10 text-amber-400 border border-amber-500/30
                         hover:bg-amber-500/20 hover:text-amber-300 transition-colors">
              <Building2 size={13} /> Zerar uma unidade
            </button>
          </div>
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
                  {/* (504) "ponto" e "afastamentos" saíram desta linha: estão
                      do lado de preservar. A linha dizia como perda o que a
                      régua agora mantém — e o Registro de Ponto era justamente
                      o que não podia sumir. */}
                  <li>RH: folha de pagamento, férias, inscrições em treinamento</li>
                  <li>Avaliações, pesquisas, feedbacks, PDIs</li>
                  <li>Marketing: campanhas, promoções, cupons, calendário</li>
                  <li>MaxBank: transações, transferências, metas, folgas (carteiras preservadas)</li>
                  <li>Cadastros: produtos, serviços e clientes</li>
                  {/* Dizia "configurações, formas de pagamento e categorias de
                      produto", e as três estão do lado de preservar: as duas
                      primeiras desde a migr. 377, a categoria desde a 482. A
                      linha listava como perda o que o reset nunca apagou. */}
                  <li>Projetos, orçamento por categoria e governança (mandatos, riscos, prestações de contas)</li>
                </ul>
                <p className="text-emerald-400 text-xs pt-2">
                  ✓ <strong>Preserva:</strong> todos os usuários (login + setor + filial),
                  os <strong>funcionários</strong> e o <strong>histórico de frequência</strong>,
                  as carteiras MaxBank (saldo de salário, benefícios e bonificações)
                  e as <strong>filiais</strong> (com CNPJ e demais cadastros).
                </p>
                {/* Migr. 504: o ponto era truncado enquanto esta mesma tela
                    prometia "histórico de frequência". Parágrafo próprio pelo
                    mesmo motivo do de fornecedor — é a mudança de lado que o
                    professor precisa ver antes de digitar APAGAR TUDO. */}
                <p className="text-emerald-400 text-xs">
                  ✓ Também preserva o <strong>Registro de Ponto</strong>: a frequência lançada, os{' '}
                  <strong>afastamentos</strong> e as <strong>justificativas de falta</strong>. São histórico da
                  pessoa, não exercício da turma — e é deles que o eixo de frequência do placar é calculado.
                </p>
                <p className="text-emerald-400 text-xs">
                  ✓ E os <strong>Documentos</strong> publicados pela Matriz, com os arquivos no bucket. Sempre
                  foi assim; a régua só não dizia. O material do professor não se refaz a cada turma.
                </p>
                {/* Migr. 482: fornecedor e categoria mudaram de lado. Ganham
                    parágrafo próprio porque é a novidade que o professor
                    precisa ver antes de digitar APAGAR TUDO — se ele espera
                    banco limpo e encontra 27 fornecedores, a régua é que
                    parece quebrada. */}
                <p className="text-emerald-400 text-xs">
                  ✓ Também preserva os <strong>fornecedores</strong> (CNPJ, prazo, condição de pagamento e logo)
                  e as <strong>categorias de produto</strong> com suas subcategorias — é a categoria que carrega
                  o markup-alvo usado para sugerir preço de venda. Montar o <strong>catálogo de produtos</strong> segue
                  sendo exercício da turma.
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

      {/* Modal do reset por unidade (migr. 484) */}
      <AnimatePresence>
        {filialResetOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !filialRunning && setFilialResetOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-amber-500/30 w-full max-w-lg max-h-[90vh] overflow-y-auto main-scrollbar">
              <div className="flex items-center gap-3 mb-4">
                <Building2 size={20} className="text-amber-400" />
                <h3 className="text-base font-bold text-amber-400">Zerar uma unidade</h3>
              </div>

              <p className="text-sm text-gray-300 mb-4 leading-relaxed">
                Recomeca <strong>uma</strong> unidade sem tocar nas outras. Mesma regua do Apagar tudo:
                o que ele preserva, este preserva &mdash; usuarios, funcionarios, filiais, carteiras,
                frequencia, Registro de Ponto (migr. 504), placar da competicao, fornecedores e categorias.
              </p>

              <div className="flex flex-col gap-2 mb-4">
                <label htmlFor="filial-alvo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  Unidade
                </label>
                <select id="filial-alvo" value={filialAlvo} disabled={filialRunning}
                  onChange={e => carregarEnsaio(e.target.value)}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">&mdash; Selecione &mdash;</option>
                  {FILIAIS_GERENTE.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <p className="text-[10px] text-gray-500 leading-snug">
                  A Matriz nao entra aqui: ela e a contraparte de todas as unidades &mdash; zera-la sozinha
                  deixaria aporte e mutuo das outras apontando para o vazio. Para ela, use o Apagar tudo.
                </p>
              </div>

              {ensaioRunning && (
                <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
                  <LoadingSpinner /> Medindo o que seria apagado...
                </div>
              )}

              {/* O ensaio e leitura pura: a RPC roda com p_dry_run no default. */}
              {ensaio && !ensaioRunning && (
                <div className="neu-pressed rounded-2xl p-4 border border-white/5 mb-4 flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-amber-400 tabular-nums">{ensaio.linhas ?? 0}</span>
                    <span className="text-xs text-gray-400">registro(s) seriam apagados</span>
                  </div>

                  {Number(ensaio.linhas ?? 0) === 0 ? (
                    <p className="text-xs text-gray-500">
                      Esta unidade ja esta zerada &mdash; nao ha o que apagar.
                    </p>
                  ) : (
                    <div className="max-h-52 overflow-y-auto main-scrollbar">
                      <table className="w-full text-xs">
                        <tbody>
                          {Object.entries(ensaio.por_tabela ?? {})
                            .sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
                            .map(([tabela, qtd]: any) => (
                              <tr key={tabela} className="border-b border-white/5 last:border-0">
                                <td className="py-1.5 pr-2 font-mono text-gray-400">{tabela}</td>
                                <td className="py-1.5 text-right tabular-nums text-gray-200 font-bold">{qtd}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {Number(ensaio.contas_zeradas ?? 0) > 0 && (
                    <p className="text-[11px] text-gray-400">
                      <strong className="text-gray-200">{ensaio.contas_zeradas}</strong> conta(s) bancaria(s) da unidade
                      voltam a saldo zero. A conta em si fica cadastrada.
                    </p>
                  )}

                  {/* O estorno e a parte que ninguem adivinha olhando a tela:
                      o dinheiro que a Matriz aplicou volta para ela. */}
                  {Array.isArray(ensaio.estorno_matriz) && ensaio.estorno_matriz.length > 0 && (
                    <div className="border-t border-white/5 pt-2.5">
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5">
                        Devolvido a Matriz
                      </p>
                      {ensaio.estorno_matriz.map((e: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11px] text-gray-300">
                          <span>{e.banco}</span>
                          <span className="tabular-nums font-bold text-emerald-400">
                            R$ {Number(e.devolvido).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                      <p className="text-[10px] text-gray-500 mt-1.5 leading-snug">
                        Aporte e mutuo sairam do caixa da Matriz. Apagar o registro sem devolver o valor
                        deixaria a Matriz pobre por causa de um lancamento que nao existe mais.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Confirmacao so aparece depois do ensaio: ninguem digita o nome
                  de uma unidade sem antes ver o tamanho do estrago. */}
              {ensaio && !ensaioRunning && Number(ensaio.linhas ?? 0) > 0 && (
                <div className="flex flex-col gap-2 mb-4">
                  <label htmlFor="filial-confirm" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                    Digite <span className="text-amber-400">{filialAlvo}</span> para liberar o botao
                  </label>
                  <input id="filial-confirm" type="text" value={filialConfirm} autoFocus
                    onChange={e => setFilialConfirm(e.target.value)}
                    disabled={filialRunning}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono"
                    placeholder={filialAlvo} />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={() => setFilialResetOpen(false)} disabled={filialRunning}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={executarResetFilial}
                  disabled={filialRunning || !ensaio || filialConfirm !== filialAlvo || Number(ensaio?.linhas ?? 0) === 0}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest
                             bg-amber-500 text-black hover:bg-amber-400 transition-colors
                             disabled:opacity-30 disabled:cursor-not-allowed">
                  {filialRunning ? "Apagando..." : `Zerar ${filialAlvo || "unidade"}`}
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
                  className="modal-close-btn">
                  <X size={16} />
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

                {/* Nova senha (opcional) — trocar a de OUTRA pessoa é só do
                    admin; a própria, qualquer um. Gerente e CEO são alunos, e
                    definir a senha de um colega é entrar na conta dele. O
                    backend recusa igual, este `&&` só evita o campo morto. */}
                {(isAdmin || editingUser.id === callerProfile.id) && (
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
                )}

                {/* Setor — admin/CEO/gerente podem alterar (gerente só em colaboradores) */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-setor" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Setor</label>
                  <select id="user-edit-setor" value={editForm.setor}
                    onChange={e => setEditForm((p: any) => ({ ...p, setor: e.target.value }))}
                    disabled={roleEscopoGlobal(editForm.role)}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                    {SETORES_SELECIONAVEIS.map(s => (
                      <option key={s} value={s}>{SETOR_LABEL[s]}</option>
                    ))}
                    {roleEscopoGlobal(editForm.role) && <option value="all">{SETOR_LABEL.all}</option>}
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
                      ? ['ceo', 'conselheiro', 'gerente', 'colaborador']
                      : isCEO
                        ? ['conselheiro', 'gerente', 'colaborador']
                        : ['colaborador']
                    ).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    {/* Se o cargo atual não estiver no conjunto editável, mantém visível como leitura */}
                    {!(isAdmin
                      ? ['ceo', 'conselheiro', 'gerente', 'colaborador']
                      : isCEO
                        ? ['conselheiro', 'gerente', 'colaborador']
                        : ['colaborador']
                    ).includes(editForm.role) && (
                      <option value={editForm.role}>{ROLE_LABEL[editForm.role] ?? editForm.role}</option>
                    )}
                  </select>
                </div>

                {/* Filial — colaborador/gerente não podem ser Matriz
                    (FilialContext bloqueia login com Matriz para não-globais).
                    Gerente não-global só edita/mantém a própria filial. */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="user-edit-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filial / Unidade</label>
                  <select id="user-edit-filial" value={editForm.filial}
                    onChange={e => setEditForm((p: any) => ({ ...p, filial: e.target.value }))}
                    disabled={isGerente && !isGlobal}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-50">
                    {isGlobal && <option value={SEM_ALOCACAO}>Sem alocação (definir depois)</option>}
                    {(isGerente && !isGlobal ? [callerProfile.filial] : filiaisParaRole(editForm.role)).map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toggle Conselheiro — acesso global para gerentes. Só admin/CEO podem alterar. */}
              {isGlobal && editForm.role === 'gerente' && (
                <div className="mt-4 neu-flat rounded-2xl p-4 border border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">
                        Acesso de Conselheiro
                      </p>
                      <p className="text-xs text-gray-400">
                        Quando ativado, este gerente tem visão global (igual a Admin/CEO) sem mudar de cargo.
                      </p>
                    </div>
                    <button type="button"
                      onClick={() => setEditForm((p: any) => ({ ...p, is_conselheiro: !p.is_conselheiro }))}
                      className={`relative shrink-0 w-12 h-6 rounded-full transition-colors ${editForm.is_conselheiro ? 'bg-accent' : 'bg-gray-700'}`}
                      title={editForm.is_conselheiro ? 'Conselheiro ativado' : 'Conselheiro desativado'}
                      aria-pressed={editForm.is_conselheiro}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${editForm.is_conselheiro ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>
              )}
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
              {isGlobal && editForm.role !== 'ceo' && editForm.role !== 'conselheiro' && (
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
