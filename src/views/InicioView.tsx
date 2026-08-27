import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ClipboardList, Target, Trophy } from 'lucide-react';
import type { UserProfile } from '../hooks/useUserProfile';
import { allSetores } from '../lib/rbac';
import { dataExtensoBR, saudacaoBR } from '../lib/dates';
import { useFetchData } from '../hooks/useSupabaseData';
import { contarAvaliacoesPendentesMatriz, type ResumoAvaliacaoMatriz } from '../lib/matrizAvaliacaoPendentes';
import { useFilial } from '../contexts/FilialContext';
import { useTheme } from '../contexts/ThemeContext';
import { LoadingSpinner, FilialBadge } from '../components/ui';
import { PainelGovernanca } from './PainelGovernanca';

const PESQUISA_LS_PREFIX = 'logmax:pesquisa-respondida:';

export const InicioView = ({
  onNavigate, profile, badges, matrizMode,
}: {
  onNavigate?: (view: string) => void;
  profile?: UserProfile;
  badges?: Record<string, number>;
  matrizMode?: boolean;
}) => {
  // Escopo por filial ativa: se colaborador/gerente está numa unidade, KPIs
  // do início refletem só a filial dele. Admin/CEO/Matriz (filialAtiva=null)
  // seguem vendo o consolidado das 3 unidades.
  const { filialAtiva } = useFilial();
  const { theme, accentColor } = useTheme();

  // Cores do gráfico lidas dos tokens de tema (dark/light/premium + accent),
  // recomputadas quando tema/accent muda. Recharts recebe hex concreto porque
  // `var(--...)` não resolve em atributos SVG de presentação.
  const chartColors = React.useMemo(() => {
    const fallback = {
      grid: '#1a1a1a', axis: '#6b7280', accent: '#F0B429',
      bar: 'rgba(240,180,41,0.12)', barStroke: 'rgba(240,180,41,0.35)',
      tooltipBg: '#0d0d0d', tooltipBorder: 'rgba(255,255,255,0.08)', legend: '#9ca3af',
    };
    if (typeof window === 'undefined') return fallback;
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    return {
      grid:          v('--color-border', fallback.grid),
      axis:          v('--color-text-dim', fallback.axis),
      accent:        v('--color-accent', fallback.accent),
      bar:           v('--color-surface-md', fallback.bar),
      barStroke:     v('--color-border-md', fallback.barStroke),
      tooltipBg:     v('--color-card-bg', fallback.tooltipBg),
      tooltipBorder: v('--color-card-border', fallback.tooltipBorder),
      legend:        v('--color-text-muted', fallback.legend),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, accentColor]);
  const relogioIcon = theme === 'light'
    ? '/icon-relogio-central-modoclaro.png'
    : '/icon-relogio-central.png';
  const filialFilter = filialAtiva ? { filial: filialAtiva } : undefined;
  const { data: contasReceber, isLoading: loadingCR } = useFetchData<any>('/api/contasreceberview', filialFilter);
  const { data: contasPagar, isLoading: loadingCP } = useFetchData<any>('/api/contaspagarview', filialFilter);

  // Modo Matriz: a entidade Matriz não tem contas a pagar/receber próprias
  // (isso vive nas filiais) — os 2 cards de Resumo Diário viram Avaliações
  // em Aberto + atalho pra Competição.
  const [resumoAvaliacao, setResumoAvaliacao] = React.useState<ResumoAvaliacaoMatriz | null>(null);
  const [loadingAvaliacao, setLoadingAvaliacao] = React.useState(matrizMode);
  React.useEffect(() => {
    if (!matrizMode || !profile?.id) { setLoadingAvaliacao(false); return; }
    let cancelado = false;
    setLoadingAvaliacao(true);
    contarAvaliacoesPendentesMatriz(profile.id)
      .then(r => { if (!cancelado) setResumoAvaliacao(r); })
      .finally(() => { if (!cancelado) setLoadingAvaliacao(false); });
    return () => { cancelado = true; };
  }, [matrizMode, profile?.id]);

  const isLoading = matrizMode ? loadingAvaliacao : (loadingCR || loadingCP);

  // Pesquisas pendentes para o usuário logado (qualquer role/setor).
  // Mesma semântica de elegibilidade que MinhasPesquisasView e a RPC.
  const ativasFilter = React.useMemo(() => ({ status: 'Ativa' }), []);
  const { data: pesquisasAtivas } = useFetchData<any>('/api/pesquisasview', ativasFilter);
  const minhasRespFilter = React.useMemo(
    () => (profile?.id ? { respondente_id: profile.id } : undefined),
    [profile?.id],
  );
  const { data: minhasRespostas } = useFetchData<any>('/api/pesquisarespostasview', minhasRespFilter);

  const pesquisasPendentesCount = React.useMemo(() => {
    if (!profile) return 0;
    const respondidasIds = new Set((minhasRespostas ?? []).map((r: any) => r.pesquisa_id));
    return (pesquisasAtivas ?? []).filter((p: any) => {
      if (respondidasIds.has(p.id)) return false;
      if (p.anonima && typeof window !== 'undefined' && localStorage.getItem(`${PESQUISA_LS_PREFIX}${p.id}`)) return false;
      const roles = p.alvo_roles as string[] | null;
      const setores = p.alvo_setores as string[] | null;
      if (roles && roles.length > 0 && !roles.includes(profile.role)) return false;
      if (setores && setores.length > 0 && profile.setor !== 'all') {
        if (!allSetores(profile).some(s => setores.includes(s))) return false;
      }
      return true;
    }).length;
  }, [pesquisasAtivas, minhasRespostas, profile]);

  const contasAberto = contasReceber.filter((c: any) => c.status !== 'Pago');
  const contasPagas  = contasReceber.filter((c: any) => c.status === 'Pago');
  const contasReceberCount = contasAberto.length;
  const contasReceberValor = contasAberto
    .reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Donut de progresso (pago / total). Fração calculada por VALOR — melhor
  // que por quantidade porque uma conta grande sozinha pesa diferente de 10
  // pequenas. Estático (sem animate-spin) — leitura calma, não "carregando".
  const totalRecebido = contasPagas.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const totalTitulos  = totalRecebido + contasAberto.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const pctPago = totalTitulos > 0 ? Math.round((totalRecebido / totalTitulos) * 100) : 0;

  // Contas a Pagar: mesmo cálculo do card de Contas a Receber, espelhado.
  const contasPagarAberto = contasPagar.filter((c: any) => c.status !== 'Pago');
  const contasPagarPagas  = contasPagar.filter((c: any) => c.status === 'Pago');
  const contasPagarCount = contasPagarAberto.length;
  const contasPagarValor = contasPagarAberto
    .reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const totalPagoCP = contasPagarPagas.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const totalTitulosCP = totalPagoCP + contasPagarAberto.reduce((s: number, c: any) => s + (parseFloat(c.valor) || 0), 0);
  const pctPagoCP = totalTitulosCP > 0 ? Math.round((totalPagoCP / totalTitulosCP) * 100) : 0;

  // Modo Matriz: % já avaliado (inverso do pendente) pro donut.
  const avaliacaoTotal = resumoAvaliacao?.total ?? 0;
  const avaliacaoPendentes = resumoAvaliacao?.pendentes ?? 0;
  const pctAvaliado = avaliacaoTotal > 0 ? Math.round(100 * (avaliacaoTotal - avaliacaoPendentes) / avaliacaoTotal) : 0;

  // Saudação + data local do Acre — só recalcula ao montar a view.
  const primeiroNome = (profile?.nome ?? profile?.email?.split('@')[0] ?? '').split(' ')[0];
  const saudacaoTxt  = React.useMemo(() => saudacaoBR(), []);
  const dataExtenso  = React.useMemo(() => dataExtensoBR(), []);
  const isAdmin = profile?.role === 'admin';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8 pb-8">
      {/* PontoFAB (scanner do totem) removido em 2026-07-29 junto com a aba
          Totem: era a porta do colaborador para marcar o próprio ponto, e sem
          o totem ela abria um scanner que não leva a lugar nenhum. O
          componente segue no repositório para a volta ser só remontá-lo. */}

      {/* Header — saudação + data + badge da filial ativa. Substitui a
          entrada "fria" nos cards e dá contexto imediato de quem/quando/onde. */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-100 tracking-tight truncate">
            {saudacaoTxt}{primeiroNome ? `, ${primeiroNome}` : ''}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 first-letter:uppercase">{dataExtenso}</p>
        </div>
        <FilialBadge filial={filialAtiva ?? 'Matriz'} />
      </div>

      {/* Governança: "o que é seu" por papel (migr. 386/387). Vem antes dos
          KPIs porque é obrigação com prazo, e KPI é informação. Some inteiro
          quando não há pendência — painel de zeros ensina a ignorar a tela. */}
      <PainelGovernanca profile={profile} onNavigate={onNavigate} matrizMode={matrizMode} />

      {pesquisasPendentesCount > 0 && (
        <button onClick={() => onNavigate?.('minhas-pesquisas')}
          className="neu-flat rounded-3xl p-5 sm:p-6 border border-accent/20 hover:border-accent/40 transition-colors flex items-center gap-4 text-left shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
            <ClipboardList size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-200">
              Você tem {pesquisasPendentesCount} {pesquisasPendentesCount === 1 ? 'pesquisa pendente' : 'pesquisas pendentes'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Sua opinião é importante. Clique para responder.</p>
          </div>
          <ArrowRight size={16} className="text-accent shrink-0" />
        </button>
      )}

      {isLoading ? <LoadingSpinner /> : (
        <div className="flex flex-col gap-6 shrink-0">
          <h3 className="text-xl font-bold text-gray-200 pl-3 border-l-4 border-accent tracking-wide">Resumo Diário</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
            {matrizMode ? (
              <>
                <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative border border-accent/20">
                  <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Avaliações em Aberto</h4>
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 mb-6 sm:mb-8">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.grid} strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.accent} strokeWidth="3"
                        strokeDasharray={`${pctAvaliado} ${100 - pctAvaliado}`} strokeDashoffset="0" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl sm:text-3xl font-black text-accent leading-none">{avaliacaoPendentes}</span>
                      <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">em aberto</span>
                    </div>
                  </div>
                  <div className="text-center mt-auto">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                      {pctAvaliado}% avaliado
                    </span>
                    <span className="text-base sm:text-lg font-bold text-gray-100 block truncate max-w-[200px]" title={resumoAvaliacao?.competicaoNome ?? undefined}>
                      {resumoAvaliacao?.competicaoNome ?? 'Sem competição ativa'}
                    </span>
                  </div>
                </div>
                <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center relative border border-accent/20">
                  <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Competição</h4>
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mb-4">
                    <Trophy size={28} />
                  </div>
                  <span className="text-sm font-bold text-gray-200 mb-1">Competição entre filiais</span>
                  <span className="text-xs text-gray-500 leading-snug mb-6 max-w-[220px]">
                    Ranking, fases e resultado das 3 unidades.
                  </span>
                  <button
                    onClick={() => onNavigate?.('matriz-competicao')}
                    className="btn-shimmer w-full py-3 px-6 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all mt-auto"
                    style={{
                      background: 'var(--color-accent)',
                      color:      'var(--color-accent-text)',
                      border:     'none',
                      boxShadow:  '0 1px 2px rgba(0, 0, 0, 0.35)',
                    }}>
                    Ver Competição <ArrowRight size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative border border-accent/20">
                  <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Contas a Receber</h4>
                  {/* Donut estático: fração paga vs. total, calculado por VALOR.
                      Substitui o anel animate-spin que lia como "carregando". */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 mb-6 sm:mb-8">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.grid} strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.accent} strokeWidth="3"
                        strokeDasharray={`${pctPago} ${100 - pctPago}`} strokeDashoffset="0" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl sm:text-3xl font-black text-accent leading-none">{contasReceberCount}</span>
                      <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">em aberto</span>
                    </div>
                  </div>
                  <div className="text-center mt-auto">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                      {pctPago}% recebido do total
                    </span>
                    <span className="text-2xl sm:text-3xl font-bold text-gray-100">{contasReceberValor}</span>
                  </div>
                </div>
                <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative border border-accent/20">
                  <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Contas a Pagar</h4>
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 mb-6 sm:mb-8">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.grid} strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9155" fill="none" stroke={chartColors.accent} strokeWidth="3"
                        strokeDasharray={`${pctPagoCP} ${100 - pctPagoCP}`} strokeDashoffset="0" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl sm:text-3xl font-black text-accent leading-none">{contasPagarCount}</span>
                      <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">em aberto</span>
                    </div>
                  </div>
                  <div className="text-center mt-auto">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">
                      {pctPagoCP}% pago do total
                    </span>
                    <span className="text-2xl sm:text-3xl font-bold text-gray-100">{contasPagarValor}</span>
                  </div>
                </div>
              </>
            )}
            <div className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center relative border border-accent/20">
              <h4 className="text-xs font-bold text-gray-400 mb-6 sm:mb-8 self-start uppercase tracking-widest">Metas</h4>
              <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mb-4">
                <Target size={28} />
              </div>
              <span className="text-sm font-bold text-gray-200 mb-1">Suas metas em andamento</span>
              <span className="text-xs text-gray-500 leading-snug mb-6 max-w-[220px]">
                Acompanhe metas ativas, progresso e histórico.
              </span>
              <button
                onClick={() => onNavigate?.('metas')}
                className="btn-shimmer w-full py-3 px-6 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all mt-auto"
                style={{
                  background: 'var(--color-accent)',
                  color:      'var(--color-accent-text)',
                  border:     'none',
                  boxShadow:  '0 1px 2px rgba(0, 0, 0, 0.35)',
                }}>
                Ver Metas <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0">
        <div
          className="neu-flat rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center relative overflow-hidden border border-accent/20"
        >
          <div className="flex flex-col items-center justify-center text-center w-full py-2">
            <img src={relogioIcon} alt="Relógio" className="w-24 h-24 object-contain mb-3" />
            <h3 className="text-xl font-bold text-accent mb-2">Central de Tempo</h3>
            <p className="text-xs text-gray-500 leading-snug mb-5">
              Relógio, alarmes, cronômetro e timer
            </p>
            <button
              onClick={() => onNavigate?.('central-tempo')}
              className="btn-shimmer py-3 px-6 rounded-2xl text-sm font-bold flex items-center gap-2 transition-all"
              style={{
                background:  'var(--color-accent)',
                color:       'var(--color-accent-text)',
                border:      'none',
                boxShadow:   '0 1px 2px rgba(0, 0, 0, 0.35)',
              }}>
              Abrir <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
