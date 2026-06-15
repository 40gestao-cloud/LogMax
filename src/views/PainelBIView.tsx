import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, FileDown, Sheet, FileText, Loader2, Calendar, TrendingUp, TrendingDown, History, Clock, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { exportBIToPDF, exportBIToExcel, exportBIToWord, type BIDados } from '../lib/biExports';

const todayISO = () => {
  // Fuso local do operador — coerente com createdAt::date no Postgres.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const isoOffsetDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const firstOfMonthISO = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

const firstOfQuarterISO = (): string => {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(q + 1)}-01`;
};

type Preset = 'mes' | '30dias' | 'trimestre' | 'custom';

const PRESETS: { id: Preset; label: string; getRange: () => { inicio: string; fim: string } }[] = [
  { id: 'mes',       label: 'Mês atual',       getRange: () => ({ inicio: firstOfMonthISO(),    fim: todayISO() }) },
  { id: '30dias',    label: 'Últimos 30 dias', getRange: () => ({ inicio: isoOffsetDays(30),    fim: todayISO() }) },
  { id: 'trimestre', label: 'Trimestre atual', getRange: () => ({ inicio: firstOfQuarterISO(), fim: todayISO() }) },
  { id: 'custom',    label: 'Personalizado',   getRange: () => ({ inicio: isoOffsetDays(30),   fim: todayISO() }) },
];

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtPct = (n: number | null) =>
  n == null ? null : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`;

const fmtDataBR = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

type Relatorio = {
  id: string;
  markdown: string;
  dados: BIDados;
  gerado_em: string;
  modelo?: string;
  from_cache?: boolean;
};

type HistoricoRow = {
  id: string;
  periodo_inicio: string;
  periodo_fim: string;
  created_at: string;
  nome_gerador: string | null;
};

export const PainelBIView = ({ showToast, profile }: any) => {
  const { session } = useAuth();
  const podeAcessar = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente';

  const [preset, setPreset]   = useState<Preset>('mes');
  const [inicio, setInicio]   = useState<string>(firstOfMonthISO());
  const [fim, setFim]         = useState<string>(todayISO());

  const [loading, setLoading]       = useState(false);
  const [relatorio, setRelatorio]   = useState<Relatorio | null>(null);
  const [erro, setErro]             = useState<string | null>(null);

  // Histórico (gate de admin/CEO via RLS já filtra; gerente vê só os próprios)
  const [historico, setHistorico]   = useState<HistoricoRow[]>([]);
  const [showHistorico, setShowHistorico] = useState(false);

  const handlePreset = (id: Preset) => {
    setPreset(id);
    if (id !== 'custom') {
      const range = PRESETS.find(p => p.id === id)!.getRange();
      setInicio(range.inicio);
      setFim(range.fim);
    }
  };

  const carregarHistorico = async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('relatorios_bi')
      .select('id, periodo_inicio, periodo_fim, created_at, nome_gerador')
      .eq('ativo', true)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistorico(data ?? []);
  };

  useEffect(() => { if (podeAcessar) carregarHistorico(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [podeAcessar]);

  const gerarRelatorio = async () => {
    if (!session?.access_token) { setErro('Sessão expirada — faça login novamente.'); return; }
    if (!inicio || !fim || fim < inicio) { setErro('Período inválido.'); return; }
    setLoading(true);
    setErro(null);
    try {
      const resp = await fetch('/api/ai-bi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ inicio, fim }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = data?.finish ? ` (motivo: ${data.finish})` : '';
        setErro((data?.error ?? 'Falha na IA.') + detail);
        setLoading(false);
        return;
      }
      setRelatorio({
        id:         data.id,
        markdown:   data.markdown,
        dados:      data.dados,
        gerado_em:  data.gerado_em,
        modelo:     data.modelo,
        from_cache: data.from_cache,
      });
      if (data.from_cache) {
        showToast?.('Relatório recuperado do cache (gerado há menos de 1h).', 'success');
      } else {
        showToast?.('Relatório gerado com sucesso.', 'success');
        carregarHistorico();
      }
    } catch (err: any) {
      setErro(err?.message ?? 'Erro de rede.');
    }
    setLoading(false);
  };

  const carregarRelatorioAntigo = async (id: string) => {
    if (!supabase) return;
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await supabase
        .from('relatorios_bi')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      setRelatorio({
        id:         data.id,
        markdown:   data.markdown,
        dados:      data.dados_json,
        gerado_em:  data.created_at,
        modelo:     data.modelo_ia,
        from_cache: false,
      });
      setInicio(data.periodo_inicio);
      setFim(data.periodo_fim);
      setShowHistorico(false);
    } catch (err: any) {
      setErro(`Erro ao recuperar relatório: ${err?.message ?? '—'}`);
    }
    setLoading(false);
  };

  const baseFilename = useMemo(
    () => `logmax-bi-${inicio}-a-${fim}`,
    [inicio, fim],
  );

  const handleExport = async (formato: 'pdf' | 'excel' | 'word') => {
    if (!relatorio) return;
    try {
      if (formato === 'pdf')   await exportBIToPDF(relatorio.dados, relatorio.markdown, baseFilename);
      if (formato === 'excel') await exportBIToExcel(relatorio.dados, baseFilename);
      if (formato === 'word')  await exportBIToWord(relatorio.dados, relatorio.markdown, baseFilename);
      showToast?.(`Download ${formato.toUpperCase()} iniciado.`, 'success');
    } catch (err: any) {
      showToast?.(`Erro ao exportar: ${err?.message ?? '—'}`, 'error');
    }
  };

  if (!podeAcessar) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="neu-flat rounded-3xl p-8 border border-white/5 max-w-md text-center">
          <Lock size={28} className="text-gray-500 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-gray-300 mb-2">Acesso restrito</h3>
          <p className="text-xs text-gray-500 leading-relaxed">
            O Painel de Inteligência Estratégica é exclusivo para perfis <strong className="text-gray-300">Admin, CEO e Gerentes</strong>.
          </p>
        </div>
      </div>
    );
  }

  // KPIs derivados do relatório atual.
  const kpis = relatorio ? [
    {
      label: 'Faturamento',
      value: fmtBRL(relatorio.dados.vendas?.total_faturamento ?? 0),
      delta: fmtPct(relatorio.dados.vendas?.variacao_faturamento_pct ?? null),
      deltaIsPositive: (relatorio.dados.vendas?.variacao_faturamento_pct ?? 0) >= 0,
    },
    {
      label: 'Saldo financeiro',
      value: fmtBRL(relatorio.dados.financeiro?.saldo ?? 0),
      delta: fmtPct(relatorio.dados.financeiro?.variacao_saldo_pct ?? null),
      deltaIsPositive: (relatorio.dados.financeiro?.saldo ?? 0) >= 0,
    },
    {
      label: 'Folha do período',
      value: fmtBRL(relatorio.dados.rh?.folha_total ?? 0),
      delta: relatorio.dados.rh?.faltas_dias != null ? `${relatorio.dados.rh.faltas_dias} faltas` : null,
      deltaIsPositive: (relatorio.dados.rh?.faltas_dias ?? 0) === 0,
    },
    {
      label: 'ROI marketing',
      value: relatorio.dados.marketing?.gasto_real_campanhas > 0
        ? fmtBRL(relatorio.dados.marketing?.gasto_real_campanhas)
        : '—',
      delta: relatorio.dados.marketing?.cupons_usados != null ? `${relatorio.dados.marketing.cupons_usados} cupons usados` : null,
      deltaIsPositive: true,
    },
  ] : [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Painel de BI</h2>
        <p className="text-sm text-gray-400 mt-1">
          Consolidação de Vendas, Financeiro, RH, Estoque e Marketing — análise executiva gerada por IA com base em dados reais do período.
        </p>
      </div>

      {/* Filtros de período */}
      <div className="neu-flat rounded-3xl p-5 border border-white/5 shrink-0 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar size={14} className="text-gray-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Período</span>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => handlePreset(p.id)}
              className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg transition-colors ${
                preset === p.id
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'neu-button text-gray-400 hover:text-white'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label htmlFor="bi-inicio" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início</label>
            <input id="bi-inicio" type="date" value={inicio}
              onChange={e => { setInicio(e.target.value); setPreset('custom'); }}
              className="neu-input rounded-lg px-3 py-2 text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bi-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim</label>
            <input id="bi-fim" type="date" value={fim}
              onChange={e => { setFim(e.target.value); setPreset('custom'); }}
              className="neu-input rounded-lg px-3 py-2 text-xs" />
          </div>
          <div className="flex-1" />
          <NeuButtonAccent variant="" onClick={gerarRelatorio} disabled={loading}>
            {loading ? <><Loader2 size={14} className="animate-spin" />Analisando…</> : <><Sparkles size={14} />Gerar Relatório com IA</>}
          </NeuButtonAccent>
        </div>
      </div>

      {/* KPIs */}
      {relatorio && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
          {kpis.map(k => (
            <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">{k.label}</p>
              <p className="text-xl font-black text-gray-100 tabular-nums">{k.value}</p>
              {k.delta && (
                <p className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${
                  k.deltaIsPositive ? 'text-accent' : 'text-red-400'
                }`}>
                  {k.deltaIsPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {k.delta}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div className="neu-pressed rounded-2xl p-4 border border-red-500/30 shrink-0">
          <p className="text-xs text-red-400">{erro}</p>
        </div>
      )}

      {/* Botões de exportação + histórico */}
      {relatorio && (
        <div className="flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={() => handleExport('pdf')}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest border border-white/10 hover:border-accent/40 rounded-lg px-3 py-2 text-gray-300 hover:text-accent transition-colors">
              <FileDown size={12} />PDF
            </button>
            <button onClick={() => handleExport('excel')}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest border border-white/10 hover:border-accent/40 rounded-lg px-3 py-2 text-gray-300 hover:text-accent transition-colors">
              <Sheet size={12} />Excel
            </button>
            <button onClick={() => handleExport('word')}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest border border-white/10 hover:border-accent/40 rounded-lg px-3 py-2 text-gray-300 hover:text-accent transition-colors">
              <FileText size={12} />Word
            </button>
          </div>
          <button onClick={() => setShowHistorico(s => !s)}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors">
            <History size={11} />Histórico ({historico.length})
          </button>
        </div>
      )}

      {/* Histórico expansível */}
      <AnimatePresence>
        {showHistorico && historico.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden shrink-0">
            <div className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Relatórios recentes</p>
              {historico.map(h => (
                <button key={h.id} onClick={() => carregarRelatorioAntigo(h.id)}
                  className="text-left flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock size={11} className="text-gray-500 shrink-0" />
                    <span className="text-xs text-gray-300 truncate">{fmtDataBR(h.periodo_inicio)} → {fmtDataBR(h.periodo_fim)}</span>
                    {h.nome_gerador && <span className="text-[10px] text-gray-500">· {h.nome_gerador}</span>}
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Relatório renderizado */}
      {relatorio ? (
        <div className="neu-flat rounded-3xl p-6 sm:p-8 border border-white/5 shrink-0">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Análise Executiva</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {fmtDataBR(relatorio.dados.periodo.inicio)} → {fmtDataBR(relatorio.dados.periodo.fim)} ({relatorio.dados.periodo.dias} dias)
                {relatorio.from_cache && <span className="ml-2 text-yellow-400">· cache</span>}
              </p>
            </div>
            <p className="text-[10px] text-gray-500 text-right">
              Gerado em {new Date(relatorio.gerado_em).toLocaleString('pt-BR')}<br />
              <span className="text-gray-600">via {relatorio.modelo ?? 'IA'}</span>
            </p>
          </div>
          <div className="bi-markdown text-sm text-gray-200 leading-relaxed">
            <ReactMarkdown>{relatorio.markdown}</ReactMarkdown>
          </div>
          <p className="text-[10px] text-gray-600 mt-6 pt-4 border-t border-white/5 leading-relaxed">
            Análise gerada por IA com base em dados agregados do período. Revise as recomendações antes de tomar decisões operacionais.
          </p>
        </div>
      ) : !loading && (
        <div className="neu-flat rounded-3xl p-12 border border-white/5 shrink-0">
          <EmptyState message="Selecione um período e clique em &quot;Gerar Relatório com IA&quot; pra obter a análise consolidada." />
        </div>
      )}
    </motion.div>
  );
};
