import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Calendar, CheckCircle2, ExternalLink, FileText, AlertTriangle } from 'lucide-react';
import { useFetchData, dbInsert, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { hasSetor } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';

const TIPOS = [
  'Atestado médico',
  'Licença maternidade',
  'Licença paternidade',
  'Férias gozadas',
  'Falta justificada',
  'Luto',
  'Casamento',
  'Doação de sangue',
  'Outros',
] as const;

type Tipo = typeof TIPOS[number];

const TIPO_BADGE: Record<string, string> = {
  'Atestado médico':       'bg-red-500/10    text-red-400    border-red-500/20',
  'Licença maternidade':   'bg-pink-500/10   text-pink-400   border-pink-500/20',
  'Licença paternidade':   'bg-blue-500/10   text-blue-400   border-blue-500/20',
  'Férias gozadas':        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Falta justificada':     'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Luto':                  'bg-gray-500/10   text-gray-400   border-gray-500/20',
  'Casamento':             'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Doação de sangue':      'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Outros':                'bg-gray-500/10   text-gray-400   border-gray-500/20',
};

type Afastamento = {
  id: string;
  funcionario_id: string;
  nome_funcionario: string | null;
  tipo: Tipo;
  data_inicio: string;
  data_fim: string;
  descricao: string | null;
  link_documento: string | null;
  aplicado_no_ponto: boolean;
  aplicado_em: string | null;
  nome_criador: string | null;
  created_at: string;
};

type Funcionario = { id: string; nome: string; status: string | null };

const EMPTY_FORM = {
  funcionario_id: '',
  tipo: 'Atestado médico' as Tipo,
  data_inicio: '',
  data_fim: '',
  descricao: '',
  link_documento: '',
};

// Conta dias inclusivos no período (5/jun → 7/jun = 3 dias).
const diasNoPeriodo = (ini: string, fim: string): number => {
  if (!ini || !fim) return 0;
  const a = new Date(ini), b = new Date(fim);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
};

export const AfastamentosView = ({ showToast, profile }: any) => {
  const { data: afastamentos, setData, isLoading, reload } = useFetchData<Afastamento>('/api/afastamentosview');
  const confirm = useConfirm();
  const { data: funcionarios } = useFetchData<Funcionario>('/api/funcionariosview');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);

  const canCRUD = hasSetor(profile, 'rh');
  const funcionariosAtivos = useMemo(
    () => (funcionarios ?? []).filter((f: any) => (f.status ?? 'Ativo') === 'Ativo')
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [funcionarios],
  );

  const resetForm = () => { setForm(EMPTY_FORM); setShowForm(false); };

  const handleSave = async () => {
    if (!form.funcionario_id) { showToast('Selecione o colaborador.', 'error'); return; }
    if (!form.data_inicio || !form.data_fim) { showToast('Informe o período completo.', 'error'); return; }
    if (form.data_fim < form.data_inicio) { showToast('Fim não pode ser antes do início.', 'error'); return; }

    setSaving(true);
    try {
      const func = funcionariosAtivos.find((f: any) => f.id === form.funcionario_id);
      const payload: any = {
        funcionario_id:   form.funcionario_id,
        nome_funcionario: func?.nome ?? null,
        tipo:             form.tipo,
        data_inicio:      form.data_inicio,
        data_fim:         form.data_fim,
        descricao:        form.descricao.trim() || null,
        link_documento:   form.link_documento.trim() || null,
        nome_criador:     profile?.nome ?? '',
        criado_por:       profile?.id ?? null,
      };
      const created = await dbInsert('/api/afastamentosview', payload);
      setData((prev: any[]) => [created, ...prev]);
      // Aplica no ponto imediatamente — fluxo natural do RH.
      await aplicarNoPonto(created.id, { silencioso: true });
      showToast('Afastamento registrado e aplicado no ponto.', 'success');
      resetForm();
    } catch (err: any) {
      console.error('[Afastamentos] salvar:', err);
      showToast(`Erro: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const aplicarNoPonto = async (id: string, opts?: { silencioso?: boolean }) => {
    if (!supabase) return;
    setAplicandoId(id);
    try {
      const { data, error } = await supabase.rpc('aplicar_afastamento_no_ponto', { p_afastamento_id: id });
      if (error) throw error;
      const aplicados = Number(data?.aplicados ?? 0);
      const pulados   = Number(data?.pulados   ?? 0);
      // O reload é leve aqui — recarrega os flags aplicado_no_ponto/aplicado_em.
      await reload();
      if (!opts?.silencioso) {
        if (pulados > 0) {
          showToast?.(`Aplicado em ${aplicados} dia(s). ${pulados} dia(s) já tinham outro afastamento e foram preservados.`, 'success');
        } else {
          showToast?.(`Ponto atualizado em ${aplicados} dia(s) como Justificado.`, 'success');
        }
      }
    } catch (err: any) {
      showToast?.(`Erro ao aplicar no ponto: ${err?.message ?? 'verifique o console'}`, 'error');
    }
    setAplicandoId(null);
  };

  const handleDelete = async (a: Afastamento) => {
    if (!await confirm(`Inativar o afastamento "${a.tipo}" de ${a.nome_funcionario ?? '—'}?\n\nObs.: o ponto eletrônico dos dias afetados continua marcado como Justificado — ajuste manualmente se for o caso.`)) return;
    try {
      await dbDelete('/api/afastamentosview', a.id);
      setData((prev: any[]) => prev.filter((x: any) => x.id !== a.id));
      showToast('Afastamento inativado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? '—'}`, 'error');
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const hoje = new Date().toISOString().slice(0, 10);
  const ativosHoje = afastamentos.filter((a: any) => a.data_inicio <= hoje && a.data_fim >= hoje).length;
  const pendentesAplicar = afastamentos.filter((a: any) => !a.aplicado_no_ponto).length;
  const totalDiasMes = afastamentos
    .filter((a: any) => a.data_inicio.slice(0, 7) === hoje.slice(0, 7))
    .reduce((s: number, a: any) => s + diasNoPeriodo(a.data_inicio, a.data_fim), 0);

  const kpis = [
    { label: 'Total',                value: afastamentos.length, warn: false },
    { label: 'Vigentes hoje',        value: ativosHoje,          warn: false },
    { label: 'Dias afastados (mês)', value: totalDiasMes,        warn: false },
    { label: 'Pendentes aplicar',    value: pendentesAplicar,    warn: pendentesAplicar > 0 },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Afastamentos</h2>
        <p className="text-sm text-gray-400 mt-1">
          Registre atestados, licenças e faltas justificadas. O ponto eletrônico recebe automaticamente o status <strong className="text-gray-300">Justificado</strong> nos dias do período.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'} tabular-nums`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end shrink-0">
        {canCRUD && (
          <NeuButtonAccent variant="" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={14} />Novo Afastamento
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Novo Afastamento</h3>
              <button onClick={resetForm} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <label htmlFor="afast-func" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Colaborador *</label>
                <select id="afast-func" value={form.funcionario_id}
                  onChange={e => setForm(f => ({ ...f, funcionario_id: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Selecione...</option>
                  {funcionariosAtivos.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="afast-tipo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Tipo *</label>
                <select id="afast-tipo" value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as Tipo }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="afast-ini" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início *</label>
                <input id="afast-ini" type="date" value={form.data_inicio}
                  onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="afast-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim *</label>
                <input id="afast-fim" type="date" value={form.data_fim}
                  onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Período</label>
                <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-300 tabular-nums">
                  {diasNoPeriodo(form.data_inicio, form.data_fim)} dia(s)
                </div>
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="afast-descricao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Motivo / Observação</label>
                <input id="afast-descricao" type="text" value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm"
                  placeholder="Ex.: CID Z76 (consulta de rotina); receita anexa" />
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="afast-link" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Link do documento (Drive, foto do atestado)</label>
                <input id="afast-link" type="url" value={form.link_documento}
                  onChange={e => setForm(f => ({ ...f, link_documento: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="https://..." />
              </div>
            </div>
            <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
              <AlertTriangle size={10} className="inline mr-1 text-yellow-400" />
              Ao salvar, o ponto eletrônico dos dias do período será marcado como <strong className="text-gray-300">Justificado</strong> automaticamente. Dias que já têm outro afastamento ativo são preservados.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetForm} className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                Cancelar
              </button>
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar e aplicar no ponto'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {afastamentos.length === 0 ? <EmptyState message="Nenhum afastamento registrado." /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Colaborador</th>
                  <th className="pb-4 font-bold px-4">Tipo</th>
                  <th className="pb-4 font-bold px-4">Período</th>
                  <th className="pb-4 font-bold px-4 text-right">Dias</th>
                  <th className="pb-4 font-bold px-4">Motivo</th>
                  <th className="pb-4 font-bold px-4 text-center">Status no ponto</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {afastamentos.map((a: any) => {
                    const dias = diasNoPeriodo(a.data_inicio, a.data_fim);
                    const vigente = a.data_inicio <= hoje && a.data_fim >= hoje;
                    return (
                      <motion.tr key={a.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200 max-w-[200px] truncate">
                          {a.nome_funcionario ?? '—'}
                          {vigente && <span className="ml-1.5 text-[9px] font-bold text-accent uppercase">vigente</span>}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${TIPO_BADGE[a.tipo] ?? TIPO_BADGE['Outros']}`}>
                            {a.tipo}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap font-mono">
                          <Calendar size={9} className="inline mr-1" />
                          {a.data_inicio} → {a.data_fim}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right tabular-nums">{dias}</td>
                        <td className="py-3 px-4 text-xs text-gray-400 max-w-[200px] truncate" title={a.descricao ?? ''}>
                          {a.descricao ?? '—'}
                          {a.link_documento && (
                            <a href={a.link_documento} target="_blank" rel="noopener noreferrer"
                              className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                              <ExternalLink size={9} />doc
                            </a>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {a.aplicado_no_ponto ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-accent">
                              <CheckCircle2 size={11} />Aplicado
                            </span>
                          ) : (
                            <button onClick={() => aplicarNoPonto(a.id)} disabled={aplicandoId === a.id || !canCRUD}
                              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-yellow-400 border border-yellow-400/30 rounded-md px-2 py-1 hover:bg-yellow-400/10 disabled:opacity-40">
                              <FileText size={9} />{aplicandoId === a.id ? 'aplicando…' : 'Aplicar'}
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canCRUD && (
                              <button onClick={() => handleDelete(a)} title="Inativar" className="action-btn-delete">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="neu-flat rounded-2xl p-4 border border-white/5 shrink-0">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">
          Como integra com a folha
        </p>
        <p className="text-xs text-gray-400 leading-relaxed">
          O RPC <strong className="text-gray-300">recalcular_folha_do_ponto</strong> trata dias com status <strong className="text-gray-300">Justificado</strong> como zero desconto — então afastamentos preservam o salário do colaborador sem cálculo manual. Faltas comuns (não justificadas) continuam descontando 8h por dia.
        </p>
      </div>
    </motion.div>
  );
};
