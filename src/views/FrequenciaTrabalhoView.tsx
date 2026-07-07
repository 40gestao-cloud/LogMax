import React, { useMemo, useState, useCallback } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, Clock, X, User, Search, Save, Loader2, MessageSquarePlus,
} from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { hasSetor, isConselheiro } from '../lib/rbac';

type StatusFreq = 'Presente' | 'Falta' | 'Presente com Atraso';

const STATUS_CONFIG: Record<StatusFreq, { icon: any; color: string; bg: string; border: string }> = {
  'Presente':           { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'Falta':              { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  'Presente com Atraso': { icon: Clock,        color: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20' },
};

const STATUSES: StatusFreq[] = ['Presente', 'Falta', 'Presente com Atraso'];

type Frequencia = {
  id: string;
  funcionario_id: string;
  nome_funcionario: string | null;
  data: string;
  status: StatusFreq;
  justificativa: string | null;
  registrado_por_nome: string | null;
  created_at: string;
};

type Funcionario = { id: string; nome: string; status: string | null; cargo: string | null; departamento: string | null; filial: string | null };

type FilterPeriod = 'dia' | 'semana' | 'mes';

const fmtData = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const fmtHorario = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });

const fmtDiaSemana = (s: string) => {
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Rio_Branco' });
};

const startOfWeek = (dateStr: string): string => {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
};

const endOfWeek = (dateStr: string): string => {
  const s = startOfWeek(dateStr);
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
};

const startOfMonth = (dateStr: string): string => dateStr.slice(0, 7) + '-01';

const endOfMonth = (dateStr: string): string => {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

const getDaysInRange = (start: string, end: string): string[] => {
  const days: string[] = [];
  const d = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  while (d <= e) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
};

const FILIAIS_OP = ['SuperMax', 'MaxLook', 'TechMax'] as const;

const FrequenciaTrabalhoViewInner = ({ showToast, profile, filial, onTrocarFilial }: any) => {
  const { user } = useAuth();
  // frequencia_trabalho e justificativas_falta não têm coluna `filial` (o
  // escopo por filial vem do funcionário via join client-side). Passar
  // { filial } aqui gerava 400 silencioso do PostgREST.
  const { data: frequencias, isLoading, reload } = useFetchData<Frequencia>('/api/frequenciatrabalhoview');
  // No modo Matriz (filial===null) carrega todos sem filtro
  const { data: funcionarios, isLoading: loadingFunc } = useFetchData<Funcionario>(
    '/api/funcionariosview',
    filial ? { filial } : undefined,
  );
  const { data: justificativas } = useFetchData<any>('/api/justificativasfaltaview');

  // Filtro de filial dentro do modo Matriz (null = todas)
  const [filialFiltro, setFilialFiltro] = useState<string | null>(null);

  const today = todayBR();
  const [dataSelecionada, setDataSelecionada] = useState(today);
  const [filtro, setFiltro] = useState<FilterPeriod>('dia');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Edições locais antes de salvar
  const [edits, setEdits] = useState<Record<string, { status: StatusFreq; justificativa: string }>>({});

  // Modal de histórico
  const [modalFunc, setModalFunc] = useState<Funcionario | null>(null);

  const canEdit = hasSetor(profile, 'rh') || profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

  // No modo filial: filtra pela filial ativa.
  // No modo Matriz (filial===null): filtra pelo filialFiltro local (null = todas).
  const filialEfetiva = filial ?? filialFiltro;

  const funcionariosAtivos = useMemo(
    () => (funcionarios ?? [])
      .filter((f: any) => (f.status ?? 'Ativo') === 'Ativo')
      .filter((f: any) => filialEfetiva === null || (f.filial ?? null) === filialEfetiva)
      .sort((a: any, b: any) =>
        (a.nome ?? '').trim().localeCompare((b.nome ?? '').trim(), 'pt-BR', { sensitivity: 'base' })
      ),
    [funcionarios, filialEfetiva],
  );

  const funcIdsFilial = useMemo(
    () => new Set(
      (funcionarios ?? [])
        .filter((f: any) => filialEfetiva === null || (f.filial ?? null) === filialEfetiva)
        .map((f: any) => f.id)
    ),
    [funcionarios, filialEfetiva],
  );

  const filteredFuncs = useMemo(() => {
    if (!search.trim()) return funcionariosAtivos;
    const s = search.toLowerCase();
    return funcionariosAtivos.filter((f: any) => (f.nome ?? '').toLowerCase().includes(s));
  }, [funcionariosAtivos, search]);

  const freqMap = useMemo(() => {
    const m = new Map<string, Frequencia>();
    (frequencias ?? [])
      .filter(f => funcIdsFilial.has(f.funcionario_id))
      .forEach(f => m.set(`${f.funcionario_id}|${f.data}`, f));
    return m;
  }, [frequencias, funcIdsFilial]);

  const getFreq = (funcId: string, data: string) => freqMap.get(`${funcId}|${data}`);

  const getEdit = (funcId: string) => edits[funcId];

  const setEdit = (funcId: string, partial: Partial<{ status: StatusFreq; justificativa: string }>) => {
    setEdits(prev => ({
      ...prev,
      [funcId]: { status: 'Presente', justificativa: '', ...prev[funcId], ...partial },
    }));
  };

  const handleSave = useCallback(async (func: Funcionario) => {
    if (!supabase || !canEdit) return;
    const edit = edits[func.id];
    if (!edit) return;

    const existing = getFreq(func.id, dataSelecionada);
    const key = func.id;
    setSaving(prev => ({ ...prev, [key]: true }));

    try {
      if (existing) {
        await dbUpdate('/api/frequenciatrabalhoview', existing.id, {
          status: edit.status,
          justificativa: edit.justificativa.trim() || null,
          registrado_por: user?.id,
          registrado_por_nome: profile?.nome ?? user?.email ?? 'Usuário',
        });
      } else {
        await dbInsert('/api/frequenciatrabalhoview', {
          funcionario_id: func.id,
          nome_funcionario: func.nome,
          data: dataSelecionada,
          status: edit.status,
          justificativa: edit.justificativa.trim() || null,
          registrado_por: user?.id,
          registrado_por_nome: profile?.nome ?? user?.email ?? 'Usuário',
        });
      }
      setEdits(prev => { const n = { ...prev }; delete n[func.id]; return n; });
      await reload();
      showToast(`Frequência de ${func.nome} salva.`, 'success');
    } catch (err: any) {
      if (err?.message?.includes('23505')) {
        showToast('Já existe registro para este funcionário nesta data.', 'error');
      } else {
        showToast(`Erro: ${err?.message ?? '—'}`, 'error');
      }
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  }, [edits, dataSelecionada, canEdit, user, profile, reload, showToast, freqMap]);

  // Stats do dia
  const statsForDate = useMemo(() => {
    const total = funcionariosAtivos.length;
    let presentes = 0, faltas = 0, atrasos = 0, semRegistro = 0;
    funcionariosAtivos.forEach((f: any) => {
      const freq = getFreq(f.id, dataSelecionada);
      if (!freq) { semRegistro++; return; }
      if (freq.status === 'Presente') presentes++;
      else if (freq.status === 'Falta') faltas++;
      else if (freq.status === 'Presente com Atraso') atrasos++;
    });
    return { total, presentes, faltas, atrasos, semRegistro };
  }, [funcionariosAtivos, freqMap, dataSelecionada]);

  // Histórico do funcionário selecionado (modal)
  const historicoFunc = useMemo(() => {
    if (!modalFunc) return [];
    return (frequencias ?? [])
      .filter(f => f.funcionario_id === modalFunc.id)
      .sort((a, b) => b.data.localeCompare(a.data));
  }, [modalFunc, frequencias]);

  // Período label
  const periodoLabel = useMemo(() => {
    if (filtro === 'dia') return fmtData(dataSelecionada);
    if (filtro === 'semana') return `${fmtData(startOfWeek(dataSelecionada))} — ${fmtData(endOfWeek(dataSelecionada))}`;
    return `${fmtData(startOfMonth(dataSelecionada))} — ${fmtData(endOfMonth(dataSelecionada))}`;
  }, [filtro, dataSelecionada]);

  // Dias no período para a visão semanal/mensal
  const diasPeriodo = useMemo(() => {
    if (filtro === 'dia') return [dataSelecionada];
    if (filtro === 'semana') return getDaysInRange(startOfWeek(dataSelecionada), endOfWeek(dataSelecionada));
    return getDaysInRange(startOfMonth(dataSelecionada), endOfMonth(dataSelecionada));
  }, [filtro, dataSelecionada]);

  if (!canEdit) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <User size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas Admin, CEO ou Gerente de RH podem registrar frequência.</p>
      </div>
    );
  }

  if (isLoading || loadingFunc) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-5 overflow-y-auto main-scrollbar pb-6">

      {/* Título + filtros */}
      <div className="shrink-0 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Frequência de Trabalho</h2>
          <p className="text-sm text-gray-400 mt-1">Registre presença, falta ou atraso dos funcionários. Período: {periodoLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro de filial — só no modo Matriz */}
          {filial === null && (
            <div className="flex items-center gap-1 rounded-xl border border-white/10 p-1 neu-flat">
              {([null, ...FILIAIS_OP] as (string | null)[]).map(f => (
                <button
                  key={f ?? 'todas'}
                  onClick={() => setFilialFiltro(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${filialFiltro === f ? 'bg-accent/20 text-accent border border-accent/30' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {f ?? 'Todas'}
                </button>
              ))}
            </div>
          )}
          {/* Filtro período */}
          {(['dia', 'semana', 'mes'] as FilterPeriod[]).map(p => (
            <button
              key={p}
              onClick={() => setFiltro(p)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-widest border transition ${filtro === p ? 'bg-accent/15 text-accent border-accent/30' : 'neu-button text-gray-400 border-white/5 hover:text-gray-200'}`}
            >
              {p === 'dia' ? 'Dia' : p === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}

          {/* Navegador contextual por modo */}
          {filtro === 'dia' && (
            <input
              type="date"
              value={dataSelecionada}
              onChange={e => setDataSelecionada(e.target.value || today)}
              className="neu-input px-3 py-1.5 rounded-xl text-xs tabular-nums"
            />
          )}
          {filtro === 'semana' && (
            <div className="flex items-center gap-1 neu-flat rounded-xl border border-white/10 px-1 py-1">
              <button
                onClick={() => {
                  const d = new Date(dataSelecionada + 'T12:00:00');
                  d.setDate(d.getDate() - 7);
                  setDataSelecionada(d.toISOString().slice(0, 10));
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >‹</button>
              <span className="text-xs tabular-nums text-gray-300 px-1 select-none min-w-[130px] text-center">
                {fmtData(startOfWeek(dataSelecionada))} – {fmtData(endOfWeek(dataSelecionada))}
              </span>
              <button
                onClick={() => {
                  const d = new Date(dataSelecionada + 'T12:00:00');
                  d.setDate(d.getDate() + 7);
                  setDataSelecionada(d.toISOString().slice(0, 10));
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >›</button>
            </div>
          )}
          {filtro === 'mes' && (
            <div className="flex items-center gap-1 neu-flat rounded-xl border border-white/10 px-1 py-1">
              <button
                onClick={() => {
                  const [y, m] = dataSelecionada.split('-').map(Number);
                  const d = new Date(y, m - 2, 1);
                  setDataSelecionada(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >‹</button>
              <span className="text-xs text-gray-300 px-1 select-none min-w-[100px] text-center capitalize">
                {new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Rio_Branco' })}
              </span>
              <button
                onClick={() => {
                  const [y, m] = dataSelecionada.split('-').map(Number);
                  const d = new Date(y, m, 1);
                  setDataSelecionada(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition text-sm"
              >›</button>
            </div>
          )}
        </div>
      </div>

      {/* Resumo cards */}
      {filtro === 'dia' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="neu-flat rounded-2xl p-4 border border-emerald-500/10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Presentes</div>
            <div className="text-2xl font-bold text-emerald-400 tabular-nums">{statsForDate.presentes}</div>
          </div>
          <div className="neu-flat rounded-2xl p-4 border border-red-500/10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Faltas</div>
            <div className="text-2xl font-bold text-red-400 tabular-nums">{statsForDate.faltas}</div>
          </div>
          <div className="neu-flat rounded-2xl p-4 border border-yellow-500/10">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Atrasos</div>
            <div className="text-2xl font-bold text-yellow-400 tabular-nums">{statsForDate.atrasos}</div>
          </div>
          <div className="neu-flat rounded-2xl p-4 border border-white/5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Sem registro</div>
            <div className="text-2xl font-bold text-gray-400 tabular-nums">{statsForDate.semRegistro}</div>
          </div>
        </div>
      )}

      {/* Busca */}
      <div className="relative shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar funcionário..."
          className="neu-input w-full pl-9 pr-3 py-2 rounded-xl text-sm"
        />
      </div>

      {/* Visão DIA — tabela editável */}
      {filtro === 'dia' && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          {filteredFuncs.length === 0 ? (
            <EmptyState message="Nenhum funcionário ativo encontrado." />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-3">Funcionário</th>
                    {filial === null && <th className="pb-3 font-bold px-3">Filial</th>}
                    <th className="pb-3 font-bold px-3">Cargo</th>
                    <th className="pb-3 font-bold px-3 text-center">Status</th>
                    <th className="pb-3 font-bold px-3 text-center">Registro</th>
                    <th className="pb-3 font-bold px-3">Justificativa</th>
                    <th className="pb-3 font-bold px-3 text-center w-20">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFuncs.map((func: Funcionario) => {
                    const freq = getFreq(func.id, dataSelecionada);
                    const edit = getEdit(func.id);
                    const currentStatus: StatusFreq = edit?.status ?? freq?.status ?? 'Presente';
                    const currentJust = edit?.justificativa ?? freq?.justificativa ?? '';
                    const isDirty = !!edit;
                    const isSaving = saving[func.id] ?? false;
                    const cfg = STATUS_CONFIG[currentStatus];

                    return (
                      <tr key={func.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3">
                          <button
                            onClick={() => setModalFunc(func)}
                            className="text-sm font-semibold text-gray-200 hover:text-accent transition-colors text-left"
                          >
                            {func.nome}
                          </button>
                        </td>
                        {filial === null && (
                          <td className="py-3 px-3 text-xs text-gray-400">{func.filial ?? '—'}</td>
                        )}
                        <td className="py-3 px-3 text-xs text-gray-500">{func.cargo ?? '—'}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center gap-1">
                            {STATUSES.map(s => {
                              const sc = STATUS_CONFIG[s];
                              const Ic = sc.icon;
                              const active = currentStatus === s;
                              const colorCls = s === 'Presente' ? 'freq-status-btn--presente' : s === 'Falta' ? 'freq-status-btn--falta' : 'freq-status-btn--atraso';
                              return (
                                <button
                                  key={s}
                                  onClick={() => setEdit(func.id, { status: s, justificativa: currentJust })}
                                  title={s}
                                  className={`freq-status-btn ${colorCls}${active ? ' freq-status-btn--active' : ''}`}
                                >
                                  <Ic size={14} />
                                  <span className="hidden sm:inline">{s === 'Presente com Atraso' ? 'Atraso' : s}</span>
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {freq ? (() => {
                            const cfg = STATUS_CONFIG[freq.status];
                            const Ic = cfg.icon;
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className={`flex items-center gap-1 ${cfg.color}`}>
                                  <Ic size={13} />
                                  <span className="text-[11px] font-semibold">{freq.status === 'Presente com Atraso' ? 'Atraso' : freq.status}</span>
                                </div>
                                <span className="text-[10px] font-mono text-gray-500 tabular-nums">{fmtHorario(freq.created_at)}</span>
                              </div>
                            );
                          })() : <span className="text-gray-700 text-xs">—</span>}
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="text"
                            value={currentJust}
                            onChange={e => setEdit(func.id, { status: currentStatus, justificativa: e.target.value })}
                            placeholder="Justificativa (opcional)"
                            className="neu-input w-full px-2 py-1.5 rounded-lg text-xs"
                          />
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => handleSave(func)}
                            disabled={!isDirty || isSaving}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition mx-auto ${isDirty ? 'bg-accent/15 border-accent/30 text-accent hover:bg-accent/25' : 'border-white/5 text-gray-700'}`}
                            title="Salvar"
                          >
                            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Visão SEMANA / MÊS — grade com dias nas colunas */}
      {filtro !== 'dia' && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          {filteredFuncs.length === 0 ? (
            <EmptyState message="Nenhum funcionário ativo encontrado." />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-3 sticky left-0 bg-[var(--color-bg-base)] z-10 min-w-[160px]">Funcionário</th>
                    {diasPeriodo.map(d => (
                      <th key={d} className="pb-3 font-bold px-1 text-center min-w-[40px]">
                        <div>{d.slice(8)}</div>
                        <div className="text-[8px] text-gray-600 normal-case">{fmtDiaSemana(d)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFuncs.map((func: Funcionario) => (
                    <tr key={func.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2 px-3 sticky left-0 bg-[var(--color-bg-base)] z-10">
                        <button
                          onClick={() => setModalFunc(func)}
                          className="text-xs font-semibold text-gray-200 hover:text-accent transition-colors text-left truncate max-w-[150px] block"
                        >
                          {func.nome}
                        </button>
                      </td>
                      {diasPeriodo.map(d => {
                        const freq = getFreq(func.id, d);
                        if (!freq) return (
                          <td key={d} className="py-2 px-1 text-center">
                            <span className="text-gray-700 text-[10px]">—</span>
                          </td>
                        );
                        const cfg = STATUS_CONFIG[freq.status];
                        const Ic = cfg.icon;
                        return (
                          <td key={d} className="py-2 px-1 text-center" title={`${freq.status}${freq.justificativa ? ` — ${freq.justificativa}` : ''}`}>
                            <Ic size={14} className={cfg.color} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Justificativas de falta recebidas */}
      {(justificativas ?? []).filter((j: any) => funcIdsFilial.has(j.funcionario_id)).length > 0 && (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquarePlus size={14} className="text-yellow-400" />
            <h3 className="text-sm font-bold text-gray-300">Justificativas de Falta Recebidas</h3>
            <span className="ml-auto text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
              {(justificativas ?? []).filter((j: any) => funcIdsFilial.has(j.funcionario_id)).length}
            </span>
          </div>
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-3">Funcionário</th>
                  <th className="pb-3 font-bold px-3">Data</th>
                  <th className="pb-3 font-bold px-3">Motivo</th>
                  <th className="pb-3 font-bold px-3">Enviado por</th>
                  <th className="pb-3 font-bold px-3">Cargo</th>
                </tr>
              </thead>
              <tbody>
                {(justificativas ?? []).filter((j: any) => funcIdsFilial.has(j.funcionario_id)).map((j: any) => (
                  <tr key={j.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2.5 px-3 text-sm font-semibold text-gray-200">{j.nome_funcionario ?? '—'}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-400">{j.data ? fmtData(j.data) : '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-300 max-w-[300px]">{j.motivo ?? '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{j.nome_criador ?? '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20">
                        {j.role_criador ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal histórico do funcionário */}
      <AnimatePresence>
        {modalFunc && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setModalFunc(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/10 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-accent">{modalFunc.nome}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[modalFunc.cargo, modalFunc.departamento, modalFunc.filial].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <button onClick={() => setModalFunc(null)} className="neu-button w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-200">
                  <X size={16} />
                </button>
              </div>

              {/* Resumo rápido */}
              <div className="grid grid-cols-3 gap-3 mb-4 shrink-0">
                {(['Presente', 'Falta', 'Presente com Atraso'] as StatusFreq[]).map(s => {
                  const count = historicoFunc.filter(f => f.status === s).length;
                  const cfg = STATUS_CONFIG[s];
                  const Ic = cfg.icon;
                  return (
                    <div key={s} className={`rounded-xl p-3 border ${cfg.bg} ${cfg.border}`}>
                      <div className="flex items-center gap-2">
                        <Ic size={14} className={cfg.color} />
                        <span className={`text-xs font-bold ${cfg.color}`}>{s}</span>
                      </div>
                      <div className={`text-xl font-bold tabular-nums mt-1 ${cfg.color}`}>{count}</div>
                    </div>
                  );
                })}
              </div>

              {/* Lista de registros */}
              <div className="flex-1 overflow-y-auto main-scrollbar">
                {historicoFunc.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">Nenhum registro de frequência.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {historicoFunc.map(f => {
                      const cfg = STATUS_CONFIG[f.status];
                      const Ic = cfg.icon;
                      return (
                        <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors">
                          <Ic size={14} className={cfg.color} />
                          <span className="text-xs font-mono text-gray-400 tabular-nums w-20 shrink-0">{fmtData(f.data)}</span>
                          <span className={`text-xs font-bold ${cfg.color} w-36 shrink-0`}>{f.status}</span>
                          <span className="text-xs text-gray-500 truncate flex-1">{f.justificativa || '—'}</span>
                          <span className="text-[10px] text-gray-600 shrink-0">{f.registrado_por_nome ?? ''}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
};


export const FrequenciaTrabalhoView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  // filialAtiva===null = modo Matriz → passa null para mostrar todas as filiais
  return <FrequenciaTrabalhoViewInner showToast={showToast} profile={profile} filial={filialAtiva} onTrocarFilial={() => {}} />;
};
