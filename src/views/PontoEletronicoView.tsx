import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Clock, X, QrCode, CheckCircle, AlertCircle, Camera, RefreshCw, Wifi, History, Calendar, KeyRound, Trash2, FileDown, Sheet } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useFetchData, dbInsert } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent, ExportButton } from '../components/ui';
import { QRScanner } from '../components/QRScanner';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import type { UserProfile } from '../hooks/useUserProfile';
import { hasSetor } from '../lib/rbac';
import { exportToPDF, exportToExcel } from '../lib/viewUtils';

const statusCls = (s: string) => {
  if (s === 'Falta') return 'bg-red-950/50 text-red-500';
  if (s === 'Hora Extra') return 'bg-blue-900/30 text-blue-400';
  if (s === 'Justificado') return 'bg-yellow-900/30 text-yellow-400';
  return 'bg-green-900/30 text-green-400';
};

const tipoCls = (t: string) => {
  if (t === 'entrada') return 'bg-emerald-900/30 text-emerald-400';
  if (t === 'retorno') return 'bg-yellow-900/30 text-yellow-400';
  if (t === 'saida')   return 'bg-blue-900/30 text-blue-400';
  return 'bg-gray-800 text-gray-400';
};

const EMPTY: any = { funcionario_id: '', data: '', entrada: '', saida: '', horas_trabalhadas: '', status: 'Normal' };

const CHECKPOINT_OPTIONS = [
  { key: 'entrada', label: 'Entrada',  time: '07:40', color: 'text-emerald-400', activeCls: 'neu-pressed border-emerald-500/30 text-emerald-300' },
  { key: 'retorno', label: 'Retorno',  time: '09:20', color: 'text-yellow-400',  activeCls: 'neu-pressed border-yellow-500/30 text-yellow-300'  },
  { key: 'saida',   label: 'Saída',    time: '11:20', color: 'text-blue-400',    activeCls: 'neu-pressed border-blue-500/30 text-blue-300'    },
];

// ─── Gerador de QR Code (admin) ──────────────────────────────────────────────
const QRGenerator = () => {
  const { theme } = useTheme();
  const { session } = useAuth();
  const qrFgColor = theme === 'light' ? '#111111' : '#e5e7eb';
  const [selected, setSelected] = useState('entrada');
  const [tokenData, setTokenData] = useState<any>(null);
  const [countdown, setCountdown] = useState(120);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchToken = useCallback(async (type?: string) => {
    // Aguarda session carregar — sem isso o primeiro fetch dispara sem token,
    // recebe 401 e pinta o erro (e a corrida com o fetch autenticado faz o
    // erro persistir mesmo quando o segundo fetch sucede).
    if (!session?.access_token) return;
    setRefreshing(true);
    setError(null);
    try {
      const cp = type ?? selected;
      const res = await fetch(`/api/qr-token?checkpoint=${cp}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        // Preserva o motivo real (403/500/payload do servidor) para diagnóstico.
        let detail = '';
        try {
          const body = await res.json();
          detail = body?.error ?? '';
        } catch {
          try { detail = await res.text(); } catch { /* noop */ }
        }
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      setTokenData(await res.json());
      setCountdown(120);
    } catch (err: any) {
      setError(err?.message ?? 'Erro desconhecido');
    } finally {
      setRefreshing(false);
    }
  }, [selected, session]);

  useEffect(() => {
    fetchToken();
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchToken(); return 120; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchToken]);

  const handleSelect = (key: string) => {
    setSelected(key);
    fetchToken(key);
  };

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex gap-2">
        {CHECKPOINT_OPTIONS.map(cp => (
          <button key={cp.key} onClick={() => handleSelect(cp.key)}
            className={`flex flex-col items-center px-4 py-2.5 rounded-xl border transition-all text-center ${selected === cp.key ? cp.activeCls : 'neu-button border-white/5 text-gray-500 hover:text-gray-300'}`}>
            <span className="text-[9px] uppercase tracking-widest font-bold">{cp.label}</span>
            <span className={`text-sm font-black tabular-nums ${selected === cp.key ? '' : 'text-gray-600'}`}>{cp.time}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-3 py-4 max-w-md text-center">
          <p className="text-sm text-red-500 font-bold">Erro ao gerar QR Code</p>
          <p className="text-xs text-gray-500 font-mono break-all">{error}</p>
          <button onClick={() => fetchToken()} className="neu-button px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-2">
            <RefreshCw size={12} /> Tentar novamente
          </button>
        </div>
      ) : !tokenData ? (
        <div className="flex justify-center py-6"><LoadingSpinner /></div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={tokenData.token} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3">
            <div className="p-4 neu-pressed rounded-2xl border border-white/5">
              <QRCodeSVG value={tokenData.token} size={200} bgColor="transparent" fgColor={qrFgColor} level="M" />
            </div>
            {tokenData.codigo && (
              <div className="flex flex-col items-center gap-1">
                <p className="text-[9px] text-gray-600 uppercase tracking-widest font-bold">Código alternativo</p>
                <p className="text-3xl font-black text-accent tabular-nums tracking-[0.3em] pl-[0.3em]">
                  {tokenData.codigo}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Wifi size={11} />
          <span>Expira em <span className="tabular-nums text-gray-400 font-bold">{countdown}s</span></span>
        </div>
        <NeuButtonAccent variant="" onClick={() => fetchToken()} disabled={refreshing}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Gerando...' : 'Gerar QR Code'}
        </NeuButtonAccent>
      </div>
    </div>
  );
};

// ─── Histórico de Ponto QR ────────────────────────────────────────────────────
const HistoricoPonto = ({ profile, showToast }: { profile: UserProfile; showToast: any }) => {
  const { user } = useAuth();
  const canSeeAll = profile.role === 'admin' || (profile.role === 'gerente' && hasSetor(profile, 'rh'));
  // Hard-delete autorizado pra admin/CEO (RH também tem via RLS, mas a UI
  // intencional aqui é "correção administrativa", então restringimos).
  const canDelete = profile.role === 'admin' || profile.role === 'ceo';

  const [registros, setRegistros] = useState<any[]>([]);
  const [userMap, setUserMap] = useState<Record<string, { nome: string; email: string }>>({});
  const [loading, setLoading] = useState(true);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [filtroMes, setFiltroMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const handleExcluir = async (id: string) => {
    if (!supabase) return;
    setExcluindo(id);
    try {
      // Hard-delete (sem coluna `ativo`). O trigger trg_recompute_ponto
      // (migração 20260525k) recalcula ponto_eletronico do dia.
      // `.select()` força PostgREST a devolver as linhas afetadas — assim
      // detectamos RLS silent-fail (devolve [] em vez de erro).
      const { data, error } = await supabase
        .from('ponto_qr_registros')
        .delete()
        .eq('id', id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Nenhum registro removido (RLS pode ter bloqueado).');
      }
      setRegistros(prev => prev.filter(r => r.id !== id));
      showToast?.('Registro de ponto removido.', 'success');
    } catch (err: any) {
      showToast?.(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setExcluindo(null);
      setConfirmandoId(null);
    }
  };

  useEffect(() => {
    if (!supabase || !user) return;

    const loadData = async () => {
      setLoading(true);

      const [yearStr, monthStr] = filtroMes.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const start = new Date(year, month - 1, 1).toISOString();
      const end = new Date(year, month, 0, 23, 59, 59, 999).toISOString();

      let q = supabase!
        .from('ponto_qr_registros')
        .select('*')
        .gte('registrado_em', start)
        .lte('registrado_em', end)
        .order('registrado_em', { ascending: false });

      if (!canSeeAll) q = q.eq('user_id', user.id);

      const { data } = await q;
      const rows = data ?? [];
      setRegistros(rows);

      if (canSeeAll && rows.length > 0) {
        const ids = [...new Set(rows.map((r: any) => r.user_id as string))];
        const { data: profs } = await supabase!
          .from('user_profiles')
          .select('id, nome, email')
          .in('id', ids);
        const map: Record<string, any> = {};
        (profs ?? []).forEach((p: any) => { map[p.id] = p; });
        setUserMap(map);
      }

      setLoading(false);
    };

    loadData();
  }, [filtroMes, canSeeAll, user?.id]);

  const noHorario = registros.filter(r => r.status === 'No Horário').length;
  const atrasados  = registros.filter(r => r.status === 'Atrasado').length;

  // ─── Export PDF / Excel ─────────────────────────────────────────────────
  // Exporta o que está visível (mês filtrado + escopo de visibilidade do user).
  const tipoLabel = (t: string) => t === 'entrada' ? 'Entrada' : t === 'retorno' ? 'Retorno' : 'Saída';
  const buildRows = (forExcel: boolean) =>
    registros.map((r: any) => {
      const dt = new Date(r.registrado_em);
      const data = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco' });
      const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
      const prof = userMap[r.user_id];
      const base = canSeeAll
        ? [prof?.nome ?? '—', prof?.email ?? r.user_id.slice(0, 8), data, hora, tipoLabel(r.tipo), r.status]
        : [data, hora, tipoLabel(r.tipo), r.status];
      // forExcel reservado caso futuramente queiramos tipos numéricos diferenciados (atualmente todas as colunas são texto)
      void forExcel;
      return base;
    });

  const colunas = canSeeAll
    ? ['Colaborador', 'E-mail', 'Data', 'Horário', 'Tipo', 'Status']
    : ['Data', 'Horário', 'Tipo', 'Status'];

  const filename = `logmax-ponto-${filtroMes}`;
  const titulo = `Histórico de Ponto — ${filtroMes}`;

  const handleExportPDF = () => exportToPDF(titulo, colunas, buildRows(false), filename);
  const handleExportExcel = () => exportToExcel('Ponto', colunas, buildRows(true), filename);

  return (
    <div className="flex flex-col gap-5">
      {/* Mini KPIs */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        {[
          { label: 'Total',       value: registros.length, cls: 'text-gray-100' },
          { label: 'No Horário',  value: noHorario,        cls: 'text-emerald-400' },
          { label: 'Atrasados',   value: atrasados,        cls: atrasados > 0 ? 'text-red-500' : 'text-gray-400' },
        ].map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-4 border border-white/5 text-center">
            <p className="text-[9px] text-gray-600 uppercase tracking-widest font-bold mb-1.5">{k.label}</p>
            <p className={`text-xl font-black ${k.cls}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtro de mês + export */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <Calendar size={14} className="text-yellow-400" />
          <label htmlFor="ponto-mes-filtro" className="text-xs text-gray-500 font-bold uppercase tracking-widest">Mês de Referência</label>
          <input id="ponto-mes-filtro" type="month" value={filtroMes}
            onChange={e => setFiltroMes(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm" />
        </div>
        {registros.length > 0 && (
          <div className="flex items-center gap-2">
            <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
            <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {loading ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : registros.length === 0 ? (
          <EmptyState message="Nenhum registro de ponto no período selecionado." />
        ) : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  {canSeeAll && <th className="pb-4 font-bold px-4">Colaborador</th>}
                  <th className="pb-4 font-bold px-4">Data</th>
                  <th className="pb-4 font-bold px-4 text-center">Horário</th>
                  <th className="pb-4 font-bold px-4 text-center">Tipo</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  {canDelete && <th className="pb-4 font-bold px-4 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {registros.map((r: any, i: number) => {
                    const dt = new Date(r.registrado_em);
                    const dataFmt = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco' });
                    const horaFmt = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
                    const prof = userMap[r.user_id];
                    return (
                      <motion.tr key={r.id ?? i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        {canSeeAll && (
                          <td className="py-3 px-4">
                            <p className="text-sm font-semibold text-gray-200">{prof?.nome ?? '—'}</p>
                            <p className="text-[10px] text-gray-600">{prof?.email ?? `${r.user_id.slice(0, 8)}…`}</p>
                          </td>
                        )}
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{dataFmt}</td>
                        <td className="py-3 px-4 text-xs font-mono text-center text-gray-300 tabular-nums">{horaFmt}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${tipoCls(r.tipo)}`}>
                            {r.tipo === 'entrada' ? 'Entrada' : r.tipo === 'retorno' ? 'Retorno' : 'Saída'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${r.status === 'Atrasado' ? 'bg-red-950/50 text-red-500' : 'bg-emerald-900/30 text-emerald-400'}`}>
                            {r.status}
                          </span>
                        </td>
                        {canDelete && (
                          <td className="py-3 px-4 text-right">
                            {confirmandoId === r.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <button onClick={() => handleExcluir(r.id)} disabled={excluindo === r.id}
                                  className="text-[10px] text-red-500 hover:text-red-300 font-bold uppercase tracking-widest transition-colors disabled:opacity-50">
                                  {excluindo === r.id ? '...' : 'Confirmar'}
                                </button>
                                <button onClick={() => setConfirmandoId(null)} disabled={excluindo === r.id}
                                  className="text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase tracking-widest transition-colors">
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmandoId(r.id)}
                                title="Excluir registro"
                                className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors ml-auto">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </td>
                        )}
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── View principal ───────────────────────────────────────────────────────────
type ScanResult = { ok: true; label: string; hora: string; status: string } | { ok: false; msg: string } | null;

export const PontoEletronicoView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { session } = useAuth();
  const { data: ponto, setData, isLoading: loadingP } = useFetchData<any>('/api/pontoeletronicoview');
  const { data: funcionarios, isLoading: loadingFn } = useFetchData<any>('/api/funcionariosview');
  const [filtroData, setFiltroData] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'ponto' | 'historico'>('ponto');

  const isAdmin = profile?.role === 'admin';

  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult>(null);
  const [qrRegistros, setQrRegistros] = useState<any[]>([]);
  const [showCodigo, setShowCodigo] = useState(false);
  const [codigoInput, setCodigoInput] = useState('');
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);

  const handleCodigoSubmit = async () => {
    const codigo = codigoInput.trim();
    if (!/^\d{6}$/.test(codigo)) {
      setScanResult({ ok: false, msg: 'Código deve ter 6 dígitos.' });
      return;
    }
    setEnviandoCodigo(true);
    setScanResult(null);
    try {
      const res = await fetch('/api/register-ponto-codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ codigo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScanResult({ ok: false, msg: json.error ?? 'Erro ao registrar ponto.' });
      } else {
        setScanResult({ ok: true, label: json.label, hora: json.hora, status: json.status });
        setQrRegistros(prev => [{ tipo: json.tipo, label: json.label, hora: json.hora }, ...prev]);
        setCodigoInput('');
        setShowCodigo(false);
      }
    } catch {
      setScanResult({ ok: false, msg: 'Erro de conexão.' });
    } finally {
      setEnviandoCodigo(false);
    }
  };

  const handleQRResult = useCallback(async (token: string) => {
    if (scanning) return;
    setScanning(true);
    setShowScanner(false);
    setScanResult(null);
    try {
      const res = await fetch('/api/register-ponto-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScanResult({ ok: false, msg: json.error ?? 'Erro ao registrar ponto.' });
      } else {
        setScanResult({ ok: true, label: json.label, hora: json.hora, status: json.status });
        setQrRegistros(prev => [{ tipo: json.tipo, label: json.label, hora: json.hora }, ...prev]);
      }
    } catch {
      setScanResult({ ok: false, msg: 'Erro de conexão.' });
    } finally {
      setScanning(false);
    }
  }, [scanning, session]);

  if (loadingP || loadingFn) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const pontoFiltrado = filtroData ? ponto.filter((p: any) => p.data === filtroData) : ponto;
  const enriched = pontoFiltrado.map((p: any) => ({
    ...p,
    func: funcionarios.find((f: any) => f.id === p.funcionario_id),
  }));

  const faltas       = ponto.filter((p: any) => p.status === 'Falta').length;
  const extras       = ponto.filter((p: any) => p.status === 'Hora Extra').length;
  const justificados = ponto.filter((p: any) => p.status === 'Justificado').length;

  const handleSave = async () => {
    if (!form.funcionario_id || !form.data) { showToast('Funcionário e data são obrigatórios.', 'error'); return; }
    setSaving(true);
    try {
      const rec = await dbInsert('/api/pontoeletronicoview', { ...form, horas_trabalhadas: Number(form.horas_trabalhadas || 0) });
      setData((prev: any[]) => [rec, ...prev]);
      setForm(EMPTY);
      setShowForm(false);
      showToast('Ponto registrado.', 'success');
    } catch { showToast('Erro ao registrar.', 'error'); }
    setSaving(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      {/* Título */}
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Ponto Eletrônico</h2>
        <p className="text-sm text-gray-400 mt-1">Registro e acompanhamento de ponto dos funcionários.</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 neu-pressed rounded-2xl p-1 w-fit border border-white/5 shrink-0">
        {([
          { key: 'ponto',     label: 'Ponto',     Icon: QrCode  },
          { key: 'historico', label: 'Histórico',  Icon: History },
        ] as const).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${tab === key ? 'neu-flat text-gray-200 border border-white/10' : 'text-gray-600 hover:text-gray-400'}`}>
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      {/* ── Aba Ponto ── */}
      {tab === 'ponto' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
            {[
              { label: 'Total de Registros', value: ponto.length, warn: false },
              { label: 'Faltas',             value: faltas,       warn: faltas > 0 },
              { label: 'Horas Extras',       value: extras,       warn: false },
              { label: 'Justificados',       value: justificados, warn: false },
            ].map((k) => (
              <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
                <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
                <p className={`text-2xl font-black ${k.warn ? 'text-red-500' : 'text-gray-100'}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Seção QR */}
          <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="mb-5">
              <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                <QrCode size={14} className="text-yellow-400" />
                {isAdmin ? 'QR Code Ativo — Apresente aos colaboradores' : 'Registrar Ponto com QR Code'}
              </h3>
              <p className="text-[11px] text-gray-600 mt-0.5">
                {isAdmin
                  ? 'Exiba este QR Code para que gerentes e colaboradores registrem o ponto.'
                  : 'Aponte a câmera para o QR Code exibido pelo administrador.'}
              </p>
            </div>

            {isAdmin ? (
              <QRGenerator />
            ) : (
              <div className="flex flex-col gap-4">
                <AnimatePresence mode="wait">
                  {showScanner && (
                    <motion.div key="scanner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="flex justify-center py-4">
                        <QRScanner onResult={handleQRResult} onClose={() => setShowScanner(false)} />
                      </div>
                    </motion.div>
                  )}
                  {scanning && (
                    <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-center py-6">
                      <LoadingSpinner />
                    </motion.div>
                  )}
                  {scanResult && (
                    <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className={`flex items-center gap-4 rounded-2xl p-4 border ${scanResult.ok ? 'bg-emerald-900/20 border-emerald-500/20' : 'bg-red-900/20 border-red-500/20'}`}>
                      {scanResult.ok ? (
                        <>
                          <CheckCircle size={24} className="text-emerald-400 shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-emerald-300">Ponto registrado com sucesso!</p>
                            <p className="text-xs text-emerald-500">
                              {scanResult.label} às {scanResult.hora}
                              {scanResult.status && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${scanResult.status === 'Atrasado' ? 'bg-red-950/60 text-red-500' : 'bg-emerald-900/40 text-emerald-400'}`}>
                                  {scanResult.status}
                                </span>
                              )}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={24} className="text-red-500 shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-red-300">Falha no registro</p>
                            <p className="text-xs text-red-500">{scanResult.msg}</p>
                          </div>
                        </>
                      )}
                      <button onClick={() => setScanResult(null)} className="ml-auto text-gray-600 hover:text-gray-300 transition-colors"><X size={14} /></button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {showCodigo && !scanning && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-3 py-2">
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">Digite o código de 6 dígitos</p>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      autoFocus
                      value={codigoInput}
                      onChange={e => setCodigoInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onKeyDown={e => { if (e.key === 'Enter' && codigoInput.length === 6) handleCodigoSubmit(); }}
                      placeholder="000000"
                      className="neu-input rounded-2xl px-5 py-3 text-3xl font-black tabular-nums tracking-[0.5em] pl-[0.5em] text-center w-56" />
                    <div className="flex gap-2">
                      <button onClick={() => { setShowCodigo(false); setCodigoInput(''); setScanResult(null); }}
                        disabled={enviandoCodigo}
                        className="neu-button py-2 px-4 rounded-xl text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50">
                        Cancelar
                      </button>
                      <NeuButtonAccent variant="" onClick={handleCodigoSubmit}
                        disabled={enviandoCodigo || codigoInput.length !== 6}>
                        {enviandoCodigo ? 'Validando...' : 'Bater Ponto'}
                      </NeuButtonAccent>
                    </div>
                  </motion.div>
                )}

                {!showScanner && !showCodigo && !scanning && (
                  <div className="flex justify-center gap-2">
                    <NeuButtonAccent variant="" onClick={() => { setScanResult(null); setShowScanner(true); }}>
                      <Camera size={14} />Abrir Câmera
                    </NeuButtonAccent>
                    <NeuButtonAccent variant="" onClick={() => { setScanResult(null); setCodigoInput(''); setShowCodigo(true); }}>
                      <KeyRound size={14} />Digitar Código
                    </NeuButtonAccent>
                  </div>
                )}

                {qrRegistros.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <p className="w-full text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-1">Registros de hoje</p>
                    {qrRegistros.map((r, i) => (
                      <span key={i} className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${tipoCls(r.tipo)}`}>
                        {r.label} {r.hora}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controles manuais */}
          <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <Clock size={14} className="text-yellow-400" />
              <label htmlFor="ponto-data-filtro" className="text-xs text-gray-500 font-bold uppercase tracking-widest">Filtrar por Data</label>
              <input id="ponto-data-filtro" type="date" value={filtroData} onChange={e => setFiltroData(e.target.value)} className="neu-input rounded-xl px-3 py-2 text-sm" />
              {filtroData && <button onClick={() => setFiltroData('')} className="text-xs text-gray-500 hover:text-white transition-colors">Limpar</button>}
            </div>
            <NeuButtonAccent variant="" onClick={() => setShowForm(v => !v)}>
              <Plus size={14} />{showForm ? 'Cancelar' : 'Registro Manual'}
            </NeuButtonAccent>
          </div>

          <AnimatePresence>
            {showForm && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold text-gray-300">Registro Manual de Ponto</h3>
                  <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="ponto-funcionario" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Funcionário *</label>
                    <select id="ponto-funcionario" value={form.funcionario_id} onChange={e => setForm((p: any) => ({ ...p, funcionario_id: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                      <option value="">Selecionar...</option>
                      {funcionarios.filter((f: any) => f.status === 'Ativo').map((f: any) => (
                        <option key={f.id} value={f.id}>{f.nome}</option>
                      ))}
                    </select>
                  </div>
                  {[
                    { label: 'Data *',            k: 'data',             type: 'date' },
                    { label: 'Entrada',           k: 'entrada',          type: 'text', placeholder: '08:00' },
                    { label: 'Saída',             k: 'saida',            type: 'text', placeholder: '17:00' },
                    { label: 'Horas Trabalhadas', k: 'horas_trabalhadas', type: 'number' },
                  ].map(({ label, k, type, placeholder }: any) => (
                    <div key={k} className="flex flex-col gap-1.5">
                      <label htmlFor={`ponto-${k}`} className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{label}</label>
                      <input id={`ponto-${k}`} type={type} value={form[k]} placeholder={placeholder} onChange={e => setForm((p: any) => ({ ...p, [k]: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                    </div>
                  ))}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="ponto-status" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                    <select id="ponto-status" value={form.status} onChange={e => setForm((p: any) => ({ ...p, status: e.target.value }))} className="neu-input rounded-xl px-3 py-2.5 text-sm">
                      {['Normal', 'Falta', 'Justificado', 'Hora Extra'].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end mt-5">
                  <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Registrar'}</NeuButtonAccent>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tabela de registros manuais */}
          <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            {enriched.length === 0 ? <EmptyState message={filtroData ? `Nenhum registro para ${filtroData}.` : 'Nenhum registro de ponto.'} /> : (
              <div className="overflow-x-auto main-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Funcionário</th>
                    <th className="pb-4 font-bold px-4">Data</th>
                    <th className="pb-4 font-bold px-4 text-center">Entrada</th>
                    <th className="pb-4 font-bold px-4 text-center">Saída</th>
                    <th className="pb-4 font-bold px-4 text-center">Horas</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                  </tr></thead>
                  <tbody>
                    <AnimatePresence>
                      {enriched.map((p: any) => (
                        <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 text-sm font-semibold text-gray-200">{p.func?.nome ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-400">{p.data ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{p.entrada ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{p.saida ?? '—'}</td>
                          <td className="py-3 px-4 text-xs font-mono text-center text-gray-300">{Number(p.horas_trabalhadas || 0).toFixed(1)}h</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusCls(p.status)}`}>{p.status}</span>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Aba Histórico ── */}
      {tab === 'historico' && <HistoricoPonto profile={profile} showToast={showToast} />}
    </motion.div>
  );
};
