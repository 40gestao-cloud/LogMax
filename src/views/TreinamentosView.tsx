import React, { useEffect, useMemo, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, BookOpen, X, Edit2, Trash2, Users, Search, Check } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete, dbSetStatus } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { notificarSetor } from '../lib/notificar';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { TreinamentoInscricoesModal } from '../components/TreinamentoInscricoesModal';
import { useConfirm } from '../contexts/ConfirmContext';
import { fmtInstrutores } from '../lib/viewUtils';

type Funcionario = { id: string; nome: string; cargo?: string | null; status?: string | null };

const statusCls = (s: string) => {
  if (s === 'Concluído') return 'bg-green-900/30 text-green-400';
  if (s === 'Em Andamento') return 'bg-blue-900/30 text-blue-400';
  if (s === 'Cancelado') return 'bg-red-950/50 text-red-500';
  return 'bg-yellow-900/30 text-yellow-400';
};

const statusNext = (s: string) =>
  s === 'Agendado' ? 'Em Andamento' : s === 'Em Andamento' ? 'Concluído' : s;

type FormState = {
  nome: string;
  descricao: string;
  data_inicio: string;
  data_fim: string;
  hora_inicio: string;
  hora_fim: string;
  instrutores: string[]; // funcionario IDs
  inscritos:   string[]; // funcionario IDs
  status: string;
};

const EMPTY: FormState = {
  nome: '', descricao: '', data_inicio: '', data_fim: '',
  hora_inicio: '', hora_fim: '',
  instrutores: [], inscritos: [],
  status: 'Agendado',
};

const toggle = (arr: string[], v: string) =>
  arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

const FuncPicker: React.FC<{
  label: string;
  funcionarios: Funcionario[];
  selected: string[];
  onChange: (next: string[]) => void;
}> = ({ label, funcionarios, selected, onChange }) => {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return funcionarios;
    return funcionarios.filter(f =>
      f.nome.toLowerCase().includes(q) || (f.cargo ?? '').toLowerCase().includes(q),
    );
  }, [filter, funcionarios]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
        <span className="text-[10px] text-accent font-bold">{selected.length} selecionado(s)</span>
      </div>
      <div className="neu-pressed rounded-xl p-2 flex flex-col gap-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filtrar por nome ou cargo..."
            className="neu-input w-full rounded-lg pl-7 pr-2 py-1.5 text-xs"
          />
        </div>
        <div className="max-h-44 overflow-y-auto main-scrollbar flex flex-col gap-1">
          {filtered.length === 0 ? (
            <p className="text-[10px] text-gray-500 text-center py-3">Nenhum funcionário encontrado.</p>
          ) : filtered.map(f => {
            const active = selected.includes(f.id);
            return (
              <button key={f.id} type="button"
                onClick={() => onChange(toggle(selected, f.id))}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors ${active ? 'bg-accent/15 text-accent' : 'hover:bg-white/5 text-gray-300'}`}>
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-accent border-accent' : 'border-gray-600'}`}>
                  {active && <Check size={9} className="text-black" />}
                </span>
                <span className="flex-1 truncate">
                  {f.nome}
                  {f.cargo && <span className="text-gray-500"> · {f.cargo}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const TreinamentosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const { data: treinamentos, setData, isLoading } = useFetchData<any>('/api/treinamentosview', { filial });
  const confirm = useConfirm();
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [inscricoesAbertas, setInscricoesAbertas] = useState<any | null>(null);
  // Inscritos originais (no edit) — pra diff de quem adicionar/remover.
  const [inscritosOriginais, setInscritosOriginais] = useState<{ id: string; funcionario_id: string }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from('funcionarios').select('id, nome, cargo, status').eq('filial', filial).order('nome')
      .then(({ data }) => setFuncionarios((data ?? []).filter(f => (f.status ?? 'Ativo') === 'Ativo')));
  }, []);

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const agendados = treinamentos.filter((t: any) => t.status === 'Agendado').length;
  const emAndamento = treinamentos.filter((t: any) => t.status === 'Em Andamento').length;
  const totalInscritos = treinamentos
    .filter((t: any) => t.status === 'Agendado' || t.status === 'Em Andamento')
    .reduce((acc: number, t: any) => acc + Number(t.inscritos || 0), 0);
  const concluidos = treinamentos.filter((t: any) => t.status === 'Concluído').length;

  const filtered = treinamentos.filter((t: any) =>
    [t.nome, ...(t.instrutores ?? []), t.instrutor, t.status]
      .some((v: any) => v?.toLowerCase?.().includes(search.toLowerCase())),
  );

  const idsToNomes = (ids: string[]) =>
    ids.map(id => funcionarios.find(f => f.id === id)?.nome).filter(Boolean) as string[];

  // Dispara notificação por setor pros gerentes/colegas saberem que há
  // colaboradores do setor convocados pra esse treinamento. Setores são
  // resolvidos via user_profiles.funcionario_id; quem não tem perfil é
  // ignorado (silenciosamente).
  const notificarGerentes = async (funcIds: string[], treinamento: { id: string; nome: string }) => {
    if (!supabase || funcIds.length === 0) return;
    try {
      const { data: perfis } = await supabase
        .from('user_profiles')
        .select('setor, nome, funcionario_id')
        .in('funcionario_id', funcIds);
      const porSetor = new Map<string, string[]>();
      (perfis ?? []).forEach(p => {
        if (!p.setor || p.setor === 'all') return;
        const arr = porSetor.get(p.setor) ?? [];
        arr.push(p.nome ?? '—');
        porSetor.set(p.setor, arr);
      });
      await Promise.all(Array.from(porSetor.entries()).map(([setor, nomes]) =>
        notificarSetor({
          setor,
          tipo:      'treinamento_atribuido',
          titulo:    `Treinamento: ${treinamento.nome}`,
          mensagem:  `Colaborador(es) do seu setor inscrito(s): ${nomes.join(', ')}. Avise sua equipe.`,
          link_view: 'rh-treinamentos',
          ref_id:    treinamento.id,
          filial,
        }),
      ));
    } catch (err) {
      console.warn('[Treinamentos] falha ao notificar gerentes:', err);
    }
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { showToast('Nome do treinamento é obrigatório.', 'error'); return; }
    const payload = {
      nome:        form.nome.trim(),
      descricao:   form.descricao.trim() || null,
      data_inicio: form.data_inicio || null,
      data_fim:    form.data_fim    || null,
      hora_inicio: form.hora_inicio || null,
      hora_fim:    form.hora_fim    || null,
      instrutores: idsToNomes(form.instrutores),
      // `instrutor` (legado) recebe o primeiro nome só pra compat de UIs antigas.
      instrutor:   idsToNomes(form.instrutores)[0] ?? null,
      inscritos:   form.inscritos.length,
      status:      form.status,
      filial,
    };
    setSaving(true);
    try {
      let treinId: string;
      let treinNome = payload.nome;
      let novosInscritos: string[] = [];
      let removidosInscritos: string[] = [];

      if (editId) {
        const updated = await dbUpdate('/api/treinamentosview', editId, payload);
        setData((prev: any[]) => prev.map((t: any) => t.id === editId ? { ...t, ...(updated ?? payload) } : t));
        treinId = editId;
        const atuaisIds = new Set(inscritosOriginais.map(i => i.funcionario_id));
        novosInscritos    = form.inscritos.filter(id => !atuaisIds.has(id));
        removidosInscritos = inscritosOriginais.filter(i => !form.inscritos.includes(i.funcionario_id)).map(i => i.id);
      } else {
        const rec = await dbInsert<any>('/api/treinamentosview', payload);
        setData((prev: any[]) => [rec, ...prev]);
        treinId = rec?.id;
        novosInscritos = form.inscritos;
      }

      // Insere inscrições novas.
      if (supabase && treinId && novosInscritos.length > 0) {
        const rows = novosInscritos.map(fid => {
          const f = funcionarios.find(x => x.id === fid);
          return {
            treinamento_id:   treinId,
            funcionario_id:   fid,
            nome_funcionario: f?.nome ?? null,
            status:           'Inscrito',
          };
        });
        const { error } = await supabase.from('treinamento_inscricoes').insert(rows);
        if (error && !/23505|duplicate/i.test(error.message)) {
          console.warn('[Treinamentos] erro inserindo inscrições:', error.message);
        }
      }

      // Soft-delete inscrições removidas (libera UNIQUE parcial).
      if (supabase && removidosInscritos.length > 0) {
        await supabase.from('treinamento_inscricoes')
          .update({ ativo: false })
          .in('id', removidosInscritos);
      }

      // Notifica gerentes dos setores afetados pelos NOVOS inscritos.
      await notificarGerentes(novosInscritos, { id: treinId, nome: treinNome });

      showToast(editId ? 'Treinamento atualizado.' : 'Treinamento criado.', 'success');
      setForm(EMPTY);
      setInscritosOriginais([]);
      setShowForm(false);
      setEditId(null);
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Treinamentos] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error');
    }
    setSaving(false);
  };

  const openEdit = async (t: any) => {
    setEditId(t.id);
    // Carrega inscritos vigentes do treinamento.
    let inscritosIds: string[] = [];
    let originais: { id: string; funcionario_id: string }[] = [];
    if (supabase) {
      const { data } = await supabase.from('treinamento_inscricoes')
        .select('id, funcionario_id')
        .eq('treinamento_id', t.id)
        .eq('ativo', true);
      originais = data ?? [];
      inscritosIds = originais.map(i => i.funcionario_id);
    }
    setInscritosOriginais(originais);

    // Reconstrói IDs de instrutores a partir dos nomes salvos (snapshot).
    const nomesInstr: string[] = Array.isArray(t.instrutores) && t.instrutores.length > 0
      ? t.instrutores
      : (t.instrutor ? [t.instrutor] : []);
    const instrutoresIds = nomesInstr
      .map(n => funcionarios.find(f => f.nome === n)?.id)
      .filter(Boolean) as string[];

    setForm({
      nome:        t.nome        ?? '',
      descricao:   t.descricao   ?? '',
      data_inicio: t.data_inicio ?? '',
      data_fim:    t.data_fim    ?? '',
      hora_inicio: t.hora_inicio ?? '',
      hora_fim:    t.hora_fim    ?? '',
      instrutores: instrutoresIds,
      inscritos:   inscritosIds,
      status:      t.status      ?? 'Agendado',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar este treinamento?')) return;
    try {
      await dbDelete('/api/treinamentosview', id);
      setData((prev: any[]) => prev.filter((t: any) => t.id !== id));
      showToast('Treinamento inativado.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Treinamentos] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error');
    }
  };

  const closeForm = () => {
    setShowForm(false); setEditId(null); setForm(EMPTY); setInscritosOriginais([]);
  };

  const handleStatusAdvance = async (t: any) => {
    if (t.status === 'Concluído' || t.status === 'Cancelado') return;
    const next = statusNext(t.status);
    try {
      await dbSetStatus('/api/treinamentosview', t.id, next);
      setData((prev: any[]) => prev.map((x: any) => x.id === t.id ? { ...x, status: next } : x));
    } catch { showToast('Erro ao avançar status.', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Treinamentos — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie treinamentos internos e externos.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Agendados', value: agendados },
          { label: 'Em Andamento', value: emAndamento },
          { label: 'Inscritos (ativos)', value: totalInscritos },
          { label: 'Concluídos', value: concluidos },
        ].map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className="text-2xl font-black text-gray-100">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="relative">
          <BookOpen size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Buscar treinamento..." value={search} onChange={e => setSearch(e.target.value)}
            className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-52" />
        </div>
        <NeuButtonAccent variant="" onClick={() => { if (showForm) closeForm(); else setShowForm(true); }}><Plus size={14} />{showForm ? 'Cancelar' : 'Novo Treinamento'}</NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editId ? 'Editar Treinamento' : 'Novo Treinamento'}</h3>
              <button onClick={closeForm} className="modal-close-btn"><X size={16} /></button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="treino-nome" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome *</label>
                <input id="treino-nome" type="text" value={form.nome}
                  onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>

              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="treino-descricao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição do Treinamento</label>
                <textarea id="treino-descricao" rows={3} value={form.descricao}
                  onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Contexto, pauta, objetivos, materiais..."
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-y" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="treino-di" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data Início</label>
                <input id="treino-di" type="date" value={form.data_inicio}
                  onChange={e => setForm(p => ({ ...p, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="treino-df" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Data Fim</label>
                <input id="treino-df" type="date" value={form.data_fim}
                  onChange={e => setForm(p => ({ ...p, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="treino-status" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                <select id="treino-status" value={form.status}
                  onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {['Agendado', 'Em Andamento', 'Concluído', 'Cancelado'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="treino-hi" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Hora Início</label>
                <input id="treino-hi" type="time" value={form.hora_inicio}
                  onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="treino-hf" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Hora Encerramento</label>
                <input id="treino-hf" type="time" value={form.hora_fim}
                  onChange={e => setForm(p => ({ ...p, hora_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="hidden lg:block" />

              <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FuncPicker
                  label="Instrutor(es)"
                  funcionarios={funcionarios}
                  selected={form.instrutores}
                  onChange={(next) => setForm(p => ({ ...p, instrutores: next }))}
                />
                <FuncPicker
                  label="Inscritos"
                  funcionarios={funcionarios}
                  selected={form.inscritos}
                  onChange={(next) => setForm(p => ({ ...p, inscritos: next }))}
                />
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : (editId ? 'Salvar Alterações' : 'Criar')}</NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {inscricoesAbertas && (
          <TreinamentoInscricoesModal
            treinamento={inscricoesAbertas}
            onClose={() => setInscricoesAbertas(null)}
            showToast={showToast}
          />
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Treinamento</th>
                <th className="pb-4 font-bold px-4">Instrutor(es)</th>
                <th className="pb-4 font-bold px-4">Início</th>
                <th className="pb-4 font-bold px-4">Fim</th>
                <th className="pb-4 font-bold px-4">Horário</th>
                <th className="pb-4 font-bold px-4 text-center">Inscritos</th>
                <th className="pb-4 font-bold px-4 text-center">Status</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr></thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((t: any) => (
                    <motion.tr key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{t.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 max-w-[220px] truncate" title={fmtInstrutores(t)}>{fmtInstrutores(t)}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{t.data_inicio ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{t.data_fim ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">
                        {t.hora_inicio || t.hora_fim
                          ? `${(t.hora_inicio ?? '').slice(0,5) || '--:--'} – ${(t.hora_fim ?? '').slice(0,5) || '--:--'}`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{t.inscritos ?? 0}</td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => handleStatusAdvance(t)}
                          disabled={t.status === 'Concluído' || t.status === 'Cancelado'}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-opacity ${statusCls(t.status)} ${!(t.status === 'Concluído' || t.status === 'Cancelado') ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}>
                          {t.status}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setInscricoesAbertas(t)} title="Gerenciar inscrições e certificados"
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-2 py-1 hover:bg-accent/10 transition-colors">
                            <Users size={10} />Inscrições
                          </button>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(t)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(t.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
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

export const TreinamentosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <TreinamentosViewInner showToast={showToast} filial={filialAtiva} />;
};
