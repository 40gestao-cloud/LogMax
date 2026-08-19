import React, { useState, useEffect, useRef } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Pencil, Trash2, Search, FileDown, Sheet, X, Camera, Gift } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { FuncionarioBeneficiosModal } from '../components/FuncionarioBeneficiosModal';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, StatusBadge, NeuButtonAccent, ExportButton } from '../components/ui';
import { exportToPDF, exportToExcel, formatCPF, formatPhone, formatBRL, parseBRL } from '../lib/viewUtils';
import { uploadFotoPerfil, validarFotoPerfil, PERFIL_FOTO_ACCEPT } from '../lib/perfilFoto';

const MASK_FOR: Record<string, (v: string) => string> = {
  cpf:      formatCPF,
  telefone: formatPhone,
  salario:  formatBRL,
};

// Sentinel de "Outro (digitar)", mesmo idioma de RequisicoesView. Cargo e
// departamento continuam colunas `text` em funcionarios — o select escolhe do
// catálogo, mas quem já estava gravado como texto livre continua válido e
// reaparece aqui como "Outro". Por isso ligar os catálogos não exigiu migração.
const OUTRO = '__outro__';

const makeEmpty = (filial: string) => ({ nome: '', cpf: '', email: '', telefone: '', cargo: '', departamento: '', data_admissao: '', data_nascimento: '', salario: '', dependentes: 0, status: 'Ativo', foto_url: '', filial });

// Remove diacríticos e converte para minúsculas para sort consistente
const normSort = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// `filial` é string, não `FilialOp`: além das 3 unidades operacionais a tela
// também abre o quadro da 'Matriz', que não é uma filial de operação.
const FuncionariosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp | 'Matriz' }) => {
  const { data: funcionarios, setData, isLoading } = useFetchData<any>('/api/funcionariosview', { filial }, false, { orderBy: 'nome', ascending: true });
  const { data: cargos }        = useFetchData<any>('/api/cargosview', { filial });
  const { data: departamentos } = useFetchData<any>('/api/departamentosview', { filial });
  const { data: beneficios }    = useFetchData<any>('/api/beneficiosview', { filial });
  const [beneficiosDe, setBeneficiosDe] = useState<{ id: string; nome: string } | null>(null);
  // Só cargo/departamento ativos entram no select; inativo que já esteja
  // gravado num funcionário continua aparecendo via fallback "Outro".
  const cargosAtivos = (cargos ?? []).filter((c: any) => (c.status ?? 'Ativo') === 'Ativo');
  const deptosAtivos = (departamentos ?? []).filter((d: any) => (d.status ?? 'Ativo') === 'Ativo');
  const [cargoSel, setCargoSel] = useState('');
  const [deptoSel, setDeptoSel] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(makeEmpty(filial));
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const [photoUploadId, setPhotoUploadId] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [formPhotoFile, setFormPhotoFile] = useState<File | null>(null);
  const [formPhotoPreview, setFormPhotoPreview] = useState<string | null>(null);
  const formPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showForm) {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        formRef.current?.querySelector<HTMLInputElement>('input, select')?.focus();
      });
    }
  }, [showForm, editing?.id]);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const anoMes = todayBR().slice(0, 7);
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

  const filtered = funcionarios
    .filter((f: any) =>
      [f.nome, f.cargo, f.departamento, f.cpf, f.email].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a: any, b: any) => {
      const an = normSort(a.nome ?? '');
      const bn = normSort(b.nome ?? '');
      return an < bn ? -1 : an > bn ? 1 : 0;
    });

  const openNew = () => { setForm(makeEmpty(filial)); setCargoSel(''); setDeptoSel(''); setEditing(null); setShowForm(true); };
  const openEdit = (f: any) => {
    setForm({
      ...f,
      cpf:      f.cpf      ? formatCPF(f.cpf)        : '',
      telefone: f.telefone ? formatPhone(f.telefone) : '',
      salario:  f.salario  != null ? formatBRL(Number(f.salario)) : '',
      dependentes: f.dependentes ?? 0,
    });
    // Casa o texto gravado com o catálogo; sem match, cai em "Outro" e o valor
    // histórico segue no input livre em vez de sumir na abertura do form.
    const cargoMatch = cargosAtivos.find((c: any) => c.nome === f.cargo);
    const deptoMatch = deptosAtivos.find((d: any) => d.nome === f.departamento);
    setCargoSel(cargoMatch ? cargoMatch.id : (f.cargo ? OUTRO : ''));
    setDeptoSel(deptoMatch ? deptoMatch.id : (f.departamento ? OUTRO : ''));
    setEditing(f);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditing(null); setForm(makeEmpty(filial)); setCargoSel(''); setDeptoSel(''); setFormPhotoFile(null); if (formPhotoPreview) URL.revokeObjectURL(formPhotoPreview); setFormPhotoPreview(null); };

  // Cargo traz o salário base junto — mas só preenche campo vazio ou zerado.
  // Sobrescrever um salário já digitado transformaria "escolhi o cargo errado
  // e voltei" em perda silenciosa de um valor negociado caso a caso.
  const handleCargoChange = (value: string) => {
    setCargoSel(value);
    if (value === OUTRO || value === '') { setForm((p: any) => ({ ...p, cargo: '' })); return; }
    const c = cargosAtivos.find((x: any) => x.id === value);
    setForm((p: any) => {
      const salarioAtual = parseBRL(p.salario);
      const base = Number(c?.salario_base ?? 0);
      return {
        ...p,
        cargo: c?.nome ?? '',
        salario: (salarioAtual === 0 && base > 0) ? formatBRL(base) : p.salario,
      };
    });
  };

  const handleDeptoChange = (value: string) => {
    setDeptoSel(value);
    if (value === OUTRO || value === '') { setForm((p: any) => ({ ...p, departamento: '' })); return; }
    const d = deptosAtivos.find((x: any) => x.id === value);
    setForm((p: any) => ({ ...p, departamento: d?.nome ?? '' }));
  };

  const cargoEscolhido = cargosAtivos.find((c: any) => c.id === cargoSel);

  // A coluna `dependentes` chega com a migr. 319. Enquanto a turma não aplicou,
  // esconder o campo é mais seguro que mostrá-lo: mandar coluna inexistente no
  // payload faz o PostgREST recusar o INSERT inteiro (PGRST204) e o cadastro de
  // funcionário pararia de funcionar por causa de um campo acessório.
  const temDependentes = funcionarios.some((f: any) => 'dependentes' in f);

  const handleSave = async () => {
    if (!form.nome) { showToast('Nome é obrigatório.', 'error'); return; }
    setSaving(true);
    try {
      const payload: any = { ...form, salario: parseBRL(form.salario) };
      if (temDependentes) {
        payload.dependentes = Math.max(parseInt(String(form.dependentes ?? 0), 10) || 0, 0);
      } else {
        delete payload.dependentes;
      }
      if (editing) {
        const updated = await dbUpdate('/api/funcionariosview', editing.id, payload);
        setData((prev: any[]) => prev.map((f: any) => f.id === editing.id ? { ...f, ...updated } : f));
        showToast('Funcionário atualizado.', 'success');
      } else {
        const created = await dbInsert('/api/funcionariosview', payload);
        // Upload de foto, se selecionada
        if (formPhotoFile && created?.id) {
          try {
            const url = await uploadFotoPerfil(formPhotoFile, `func-${created.id}`);
            await dbUpdate('/api/funcionariosview', created.id, { foto_url: url });
            created.foto_url = url;
          } catch { /* não bloqueia */ }
        }
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

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !photoUploadId) return;
    const val = validarFotoPerfil(file);
    if (!val.ok) { showToast(val.motivo, 'error'); return; }
    setPhotoUploading(true);
    try {
      const url = await uploadFotoPerfil(file, `func-${photoUploadId}`);
      await dbUpdate('/api/funcionariosview', photoUploadId, { foto_url: url });
      setData((prev: any[]) => prev.map((f: any) => f.id === photoUploadId ? { ...f, foto_url: url } : f));
      showToast('Foto atualizada.', 'success');
    } catch (err: any) {
      showToast(`Erro ao enviar foto: ${err.message ?? err}`, 'error');
    }
    setPhotoUploading(false);
    setPhotoUploadId(null);
  };

  const exportCols = ['Nome', 'CPF', 'Cargo', 'Departamento', 'Admissão', 'Salário', 'Status'];
  const exportRows = () => filtered.map((f: any) => [
    f.nome ?? '', f.cpf ?? '', f.cargo ?? '', f.departamento ?? '',
    f.data_admissao ?? '', `R$ ${Number(f.salario || 0).toFixed(2)}`, f.status ?? '',
  ]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Funcionários — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie o quadro de funcionários da unidade.</p>
        </div>
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
          <motion.div ref={formRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0 scroll-mt-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editing ? 'Editar Funcionário' : 'Novo Funcionário'}</h3>
              <button onClick={closeForm} className="modal-close-btn"><X size={16} /></button>
            </div>

            {/* Foto */}
            <div className="flex items-center gap-4 mb-5">
              <button type="button" onClick={() => formPhotoInputRef.current?.click()}
                className="relative w-16 h-16 rounded-full neu-button overflow-hidden flex items-center justify-center text-gray-500 hover:text-accent transition-colors shrink-0"
                title="Adicionar foto (opcional)">
                {formPhotoPreview || form.foto_url
                  ? <img src={formPhotoPreview ?? form.foto_url} alt="preview" className="w-full h-full object-cover" />
                  : <Camera size={22} />}
              </button>
              <div>
                <p className="text-xs text-gray-300 font-semibold">Foto do funcionário <span className="text-gray-600 font-normal">(opcional)</span></p>
                <p className="text-[10px] text-gray-600 mt-0.5">JPG, PNG ou WEBP · máx 150 KB</p>
                {(formPhotoPreview || (!editing && form.foto_url)) && (
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
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Unidade</label>
                <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-accent font-semibold border border-white/5">{filial}</div>
              </div>
              {[
                { label: 'Nome *', k: 'nome', type: 'text' },
                { label: 'CPF', k: 'cpf', type: 'text' },
                { label: 'E-mail', k: 'email', type: 'text' },
                { label: 'Telefone', k: 'telefone', type: 'text' },
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

              {/* Cargo — vem do catálogo de Cargos da unidade. */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="func-cargo-sel" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Cargo</label>
                <select id="func-cargo-sel" value={cargoSel} onChange={e => handleCargoChange(e.target.value)}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {cargosAtivos.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.nome}{c.nivel ? ` · ${c.nivel}` : ''}</option>
                  ))}
                  <option value={OUTRO}>Outro (digitar)</option>
                </select>
                {cargoSel === OUTRO && (
                  <input id="func-cargo" type="text" value={form.cargo} placeholder="Cargo fora do catálogo"
                    onChange={e => setForm((p: any) => ({ ...p, cargo: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                )}
                {cargoEscolhido && Number(cargoEscolhido.salario_base) > 0 && (
                  <p className="text-[10px] text-gray-500">
                    Base do cargo: <span className="font-mono text-gray-400">R$ {formatBRL(Number(cargoEscolhido.salario_base))}</span>
                  </p>
                )}
              </div>

              {/* Departamento — catálogo de Departamentos da unidade. */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="func-depto-sel" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Departamento</label>
                <select id="func-depto-sel" value={deptoSel} onChange={e => handleDeptoChange(e.target.value)}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecionar...</option>
                  {deptosAtivos.map((d: any) => <option key={d.id} value={d.id}>{d.nome}</option>)}
                  <option value={OUTRO}>Outro (digitar)</option>
                </select>
                {deptoSel === OUTRO && (
                  <input id="func-departamento" type="text" value={form.departamento} placeholder="Departamento fora do catálogo"
                    onChange={e => setForm((p: any) => ({ ...p, departamento: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                )}
              </div>

              {[
                { label: 'Data de Admissão', k: 'data_admissao', type: 'date' },
                { label: 'Data de Nascimento', k: 'data_nascimento', type: 'date' },
                { label: 'Salário (R$)', k: 'salario', type: 'text' },
                // Dedução do IRRF na folha e na rescisão (migr. 319). Só produz
                // efeito quando a vigência cadastrada em `rh_parametros` tiver
                // `deducao_dependente` preenchida — a vigência-piso vem zerada
                // de propósito, para a migration não mudar número nenhum.
                ...(temDependentes
                  ? [{ label: 'Dependentes (IRRF)', k: 'dependentes', type: 'number' }]
                  : []),
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
                <th className="pb-4 font-bold px-2 w-10"></th>
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
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group/row">
                      <td className="py-3 px-2 w-10">
                        <div className="relative w-8 h-8 shrink-0">
                          {f.foto_url
                            ? <img src={f.foto_url} alt={f.nome ?? ''} className="w-8 h-8 rounded-full object-cover" />
                            : <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">{(f.nome?.[0] ?? '?').toUpperCase()}</div>
                          }
                          <button
                            onClick={() => { setPhotoUploadId(f.id); setTimeout(() => photoInputRef.current?.click(), 0); }}
                            disabled={photoUploading}
                            title="Alterar foto"
                            className="absolute inset-0 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity disabled:cursor-wait">
                            <Camera size={12} className="text-white" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{f.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{f.cpf ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{f.cargo ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{f.departamento ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{f.data_admissao ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right tabular-nums">R$ {formatBRL(Number(f.salario || 0))}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={f.status} /></td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1.5 justify-end">
                          <HistoricoOperacoes entidade="funcionarios" entidadeId={f.id} titulo={f.nome ?? 'Funcionário'} criadoEm={f.created_at} atualizadoEm={f.updated_at} />
                          <button onClick={() => setBeneficiosDe({ id: f.id, nome: f.nome ?? '—' })}
                            title="Benefícios do funcionário"
                            className="action-btn-blue">
                            <Gift size={12} />
                          </button>
                          <button onClick={() => openEdit(f)} className="action-btn-edit"><Pencil size={12} /></button>
                          <button onClick={() => handleDelete(f.id)} className="action-btn-delete"><Trash2 size={12} /></button>
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

      <input ref={photoInputRef} type="file" accept={PERFIL_FOTO_ACCEPT} className="hidden" onChange={handlePhotoUpload} />

      <AnimatePresence>
        {beneficiosDe && (
          <FuncionarioBeneficiosModal
            funcionario={beneficiosDe}
            beneficios={beneficios ?? []}
            showToast={showToast}
            onClose={() => setBeneficiosDe(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const FuncionariosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  // Em modo Matriz (`filialAtiva === null`) a tela abre o quadro da própria
  // holding. Os cargos de CEO e Conselheiro são lotados lá desde sempre — o que
  // faltava era não esconder essas linhas de quem opera a Matriz (migr. 315).
  return <FuncionariosViewInner showToast={showToast} filial={filialAtiva ?? 'Matriz'} />;
};
