import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LockOpen, Lock, Clock, DollarSign, User, ChevronDown, Trash2, RotateCcw, ArrowDownToLine, ArrowUpFromLine, X, Calculator, Landmark } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useCaixasDoDia, FILIAIS_OPERACIONAIS, type FilialOperacional } from '../hooks/useCaixaAberto';
import { useFetchData, dbDelete } from '../hooks/useSupabaseData';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { LoadingSpinner, NeuButtonAccent, FilialBadge } from '../components/ui';
import type { UserProfile } from '../hooks/useUserProfile';
import { hasAnySetor, isConselheiro } from '../lib/rbac';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFilial } from '../contexts/FilialContext';

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtHora = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
};

const fmtData = (str: string) => {
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
};

// Quem opera caixa de QUALQUER filial: só admin, CEO e Conselheiro (modo Matriz).
// Gerente e colaborador ficam travados na própria filial — gerente não cobre
// outras unidades (regra de negócio).
const podeOperarTodasFiliais = (profile: UserProfile | null | undefined): boolean =>
  profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);

// Cada filial tem seu próprio card de status + abertura/fechamento.
// Extraído porque o ControleCaixaView pode renderizar 1, 2 ou 3 deles dependendo
// do role/filial do operador.
const CaixaCard = ({ filial, caixa, showToast, profile, onChanged }: any) => {
  const { user } = useAuth();
  const [valorAbertura, setValorAbertura] = useState('');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);
  // Painel ativo dentro do card aberto: sangria, suprimento, fechar ou nenhum.
  const [painel, setPainel] = useState<'none' | 'sangria' | 'suprimento' | 'fechar'>('none');
  const [movValor, setMovValor] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [valorContado, setValorContado] = useState('');
  const [obsFechamento, setObsFechamento] = useState('');
  const [movs, setMovs] = useState<any[]>([]);
  const today = todayBR();

  // Lista de movimentações do caixa aberto (sangria/suprimento).
  useEffect(() => {
    if (!caixa?.id || !supabase) { setMovs([]); return; }
    let cancelled = false;
    supabase.from('movimentacoes_caixa')
      .select('id, tipo, valor, motivo, criado_por_nome, created_at')
      .eq('controle_caixa_id', caixa.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setMovs(data ?? []);
      });
    return () => { cancelled = true; };
  }, [caixa?.id]);

  const totalSangria    = movs.filter(m => m.tipo === 'sangria').reduce((s, m) => s + Number(m.valor || 0), 0);
  const totalSuprimento = movs.filter(m => m.tipo === 'suprimento').reduce((s, m) => s + Number(m.valor || 0), 0);

  const resetPainel = () => {
    setPainel('none');
    setMovValor(''); setMovMotivo('');
    setValorContado(''); setObsFechamento('');
  };

  const handleMovimentacao = async (tipo: 'sangria' | 'suprimento') => {
    const valor = parseBRL(movValor);
    if (!valor || valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.rpc('registrar_movimentacao_caixa', {
      p_controle_id: caixa.id,
      p_tipo:        tipo,
      p_valor:       valor,
      p_motivo:      movMotivo.trim() || null,
    });
    setSaving(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    // Refetch movimentações
    if (supabase) {
      const { data: novas } = await supabase.from('movimentacoes_caixa')
        .select('id, tipo, valor, motivo, criado_por_nome, created_at')
        .eq('controle_caixa_id', caixa.id)
        .order('created_at', { ascending: false });
      setMovs(novas ?? []);
    }
    showToast(`${tipo === 'sangria' ? 'Sangria' : 'Suprimento'} de ${fmtBRL(valor)} registrado.`, 'success');
    resetPainel();
  };

  const handleFecharConferido = async () => {
    const valor = parseBRL(valorContado);
    if (valor === undefined || valor === null || Number.isNaN(valor) || valor < 0) {
      showToast('Informe o valor contado em dinheiro.', 'error');
      return;
    }
    if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.rpc('fechar_caixa_conferido', {
      p_controle_id:   caixa.id,
      p_valor_contado: valor,
      p_observacao:    obsFechamento.trim() || null,
      p_origem:        'financeiro',
    });
    setSaving(false);
    if (error) { showToast(`Erro ao fechar: ${error.message}`, 'error'); return; }
    const res = data as any;
    const tipo = res?.tipo as string;
    const dif = Number(res?.diferenca ?? 0);
    const msg = tipo === 'exato'
      ? 'Caixa fechado — valor exato.'
      : tipo === 'sobra'
        ? `Caixa fechado com SOBRA de ${fmtBRL(dif)}.`
        : `Caixa fechado com FALTA de ${fmtBRL(Math.abs(dif))}.`;
    showToast(msg, tipo === 'exato' ? 'success' : 'info');
    resetPainel();
    onChanged();
  };

  const handleAbrir = async () => {
    const valor = parseBRL(valorAbertura);
    if (!valor || valor <= 0) { showToast('Informe um valor de abertura válido.', 'error'); return; }
    if (!supabase) { showToast('Supabase não configurado.', 'error'); return; }

    setSaving(true);
    try {
      const { error } = await supabase.from('controle_caixa').insert({
        data:             today,
        filial,
        valor_abertura:   valor,
        status:           'Aberto',
        aberto_por:       user?.id ?? null,
        aberto_por_nome:  profile?.nome ?? user?.email ?? 'Usuário',
        aberto_em:        new Date().toISOString(),
        observacao:       observacao || null,
      });
      if (error) {
        if (error.code === '23505') showToast(`Já existe sessão aberta hoje para ${filial}.`, 'error');
        else throw error;
        return;
      }
      setValorAbertura('');
      setObservacao('');
      onChanged();
      showToast(`Caixa ${filial} aberto!`, 'success');
    } catch {
      showToast('Erro ao abrir o caixa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return caixa ? (
    /* ── CAIXA ABERTO ── */
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="neu-flat rounded-3xl p-6 border border-emerald-500/20 flex flex-col gap-4"
      style={{ background: 'color-mix(in srgb, #10B981 6%, var(--color-bg-base))' }}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #10B981 15%, var(--color-bg-base))' }}>
          <LockOpen size={22} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <FilialBadge filial={filial} />
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Aberto</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="text-xl font-black text-gray-100 tabular-nums">{fmtBRL(caixa.valor_abertura)}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><User size={9} />{caixa.aberto_por_nome ?? '—'}</span>
            <span className="flex items-center gap-1"><Clock size={9} />{fmtHora(caixa.aberto_em)}</span>
          </div>
        </div>
      </div>

      {/* Totais de sangria/suprimento do dia, se houver movimentações */}
      {(totalSangria > 0 || totalSuprimento > 0) && (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="neu-pressed rounded-lg px-2 py-1.5">
            <div className="text-gray-500 uppercase font-bold tracking-widest">Suprimentos</div>
            <div className="text-emerald-300 font-bold tabular-nums">+ {fmtBRL(totalSuprimento)}</div>
          </div>
          <div className="neu-pressed rounded-lg px-2 py-1.5">
            <div className="text-gray-500 uppercase font-bold tracking-widest">Sangrias</div>
            <div className="text-red-300 font-bold tabular-nums">− {fmtBRL(totalSangria)}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={() => setPainel(painel === 'suprimento' ? 'none' : 'suprimento')}
          className="neu-button px-3 py-1.5 rounded-xl text-[11px] font-bold text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5">
          <ArrowDownToLine size={11} /> Suprimento
        </button>
        <button onClick={() => setPainel(painel === 'sangria' ? 'none' : 'sangria')}
          className="neu-button px-3 py-1.5 rounded-xl text-[11px] font-bold text-orange-300 hover:text-orange-200 flex items-center gap-1.5">
          <ArrowUpFromLine size={11} /> Sangria
        </button>
        <button onClick={() => setPainel(painel === 'fechar' ? 'none' : 'fechar')}
          className="neu-button px-3 py-1.5 rounded-xl text-[11px] font-bold text-gray-400 hover:text-red-400 flex items-center gap-1.5">
          <Lock size={11} /> Fechar
        </button>
      </div>

      <AnimatePresence>
        {(painel === 'sangria' || painel === 'suprimento') && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="neu-pressed rounded-2xl p-4 flex flex-col gap-3 overflow-hidden">
            <div className="text-xs font-bold text-gray-300 uppercase tracking-widest">
              {painel === 'sangria' ? 'Sangria (retirada de caixa)' : 'Suprimento (entrada de troco/reforço)'}
            </div>
            <input type="text" inputMode="numeric" placeholder="Valor (R$)"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={movValor}
              onChange={e => setMovValor(formatBRL(e.target.value))}
              onKeyDown={handleMoneyKeyDown} />
            <input type="text" placeholder={painel === 'sangria' ? 'Motivo: ex. depósito banco' : 'Motivo: ex. troco inicial'}
              className="neu-input py-2 px-3 rounded-xl text-sm"
              value={movMotivo}
              onChange={e => setMovMotivo(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={resetPainel} className="neu-button px-3 py-1.5 rounded-lg text-xs text-gray-400 flex items-center gap-1"><X size={11} /> Cancelar</button>
              <NeuButtonAccent onClick={() => handleMovimentacao(painel as 'sangria' | 'suprimento')} isLoading={saving}>Confirmar</NeuButtonAccent>
            </div>
          </motion.div>
        )}

        {painel === 'fechar' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="neu-pressed rounded-2xl p-4 flex flex-col gap-3 overflow-hidden">
            <div className="text-xs font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2">
              <Calculator size={12} /> Fechamento conferido
            </div>
            <p className="text-[11px] text-gray-500">
              Informe o valor em <b>dinheiro</b> contado fisicamente. O sistema calcula o esperado (abertura + vendas em dinheiro + suprimentos − sangrias) e mostra a diferença.
            </p>
            <input type="text" inputMode="numeric" placeholder="Valor contado em dinheiro"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={valorContado}
              onChange={e => setValorContado(formatBRL(e.target.value))}
              onKeyDown={handleMoneyKeyDown} />
            <input type="text" placeholder="Observação (opcional)"
              className="neu-input py-2 px-3 rounded-xl text-sm"
              value={obsFechamento}
              onChange={e => setObsFechamento(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={resetPainel} className="neu-button px-3 py-1.5 rounded-lg text-xs text-gray-400 flex items-center gap-1"><X size={11} /> Cancelar</button>
              <button onClick={handleFecharConferido} disabled={saving}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-300 bg-red-900/30 border border-red-500/20 hover:bg-red-900/50 disabled:opacity-50">
                {saving ? '...' : 'Fechar caixa'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Histórico curto de movimentações do dia */}
      {movs.length > 0 && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-gray-500 uppercase font-bold tracking-widest hover:text-gray-300">
            Movimentações do dia ({movs.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto main-scrollbar pr-1">
            {movs.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-black/20">
                <span className={`font-bold uppercase ${m.tipo === 'sangria' ? 'text-orange-300' : 'text-emerald-300'}`}>
                  {m.tipo === 'sangria' ? '−' : '+'} {fmtBRL(Number(m.valor))}
                </span>
                <span className="text-gray-500 truncate flex-1">{m.motivo || '—'}</span>
                <span className="text-gray-600">{fmtHora(m.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  ) : (
    /* ── CAIXA FECHADO ── */
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl neu-pressed flex items-center justify-center shrink-0">
          <Lock size={22} className="text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <FilialBadge filial={filial} />
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Fechado</span>
          </div>
          <p className="text-xs text-gray-400">Informe o valor para abrir.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="relative">
          <DollarSign size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" inputMode="numeric"
            className="neu-input py-2.5 pl-8 pr-3 rounded-xl text-sm w-full"
            placeholder="Valor de abertura"
            value={valorAbertura}
            onChange={e => setValorAbertura(formatBRL(e.target.value))}
            onKeyDown={e => {
              handleMoneyKeyDown(e);
              if (e.key === 'Enter') handleAbrir();
            }}
          />
        </div>
        <input className="neu-input py-2.5 px-3 rounded-xl text-xs"
          placeholder="Observação (opcional)"
          value={observacao}
          onChange={e => setObservacao(e.target.value)} />
      </div>

      <div className="flex justify-end">
        <NeuButtonAccent onClick={handleAbrir} isLoading={saving}>
          <LockOpen size={14} /> Abrir Caixa
        </NeuButtonAccent>
      </div>
    </motion.div>
  );
};

export const ControleCaixaView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  // Guard: caixa é financeiro+vendas, ou gerente (cobre a própria filial
  // mesmo fora desses setores — RLS acompanha em auth_in_setor(...)).
  const confirm = useConfirm();
  if (!hasAnySetor(profile, 'financeiro', 'vendas') && profile?.role !== 'gerente') {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center">
        <Lock size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400">Apenas Financeiro, Vendas, Gerente, admin ou CEO podem acessar o Caixa.</p>
      </div>
    );
  }
  const { caixas, isLoading: caixaLoading, refresh } = useCaixasDoDia();
  const { data: capitalRows = [] } = useFetchData<any>('capital_filial');
  const { filialAtiva } = useFilial();

  const today = todayBR();

  const cross = podeOperarTodasFiliais(profile);
  // Regras de visibilidade:
  //  - Admin/CEO/Conselheiro em modo Matriz (filialAtiva=null) → vê as 3.
  //  - Admin/CEO/Conselheiro com filial ativa → só essa (respeita o topbar).
  //  - Gerente/colaborador → só a lotada (sem alternar).
  //  - Sem filial operacional definida (ex: 'Matriz' no perfil de colaborador)
  //    → array vazio (mostra mensagem "não opera PDV").
  const filialAtivaOperacional: FilialOperacional | null =
    (FILIAIS_OPERACIONAIS as readonly string[]).includes(filialAtiva ?? '')
      ? (filialAtiva as FilialOperacional)
      : null;
  const filiaisVisiveis: readonly FilialOperacional[] = cross
    ? (filialAtivaOperacional ? [filialAtivaOperacional] : FILIAIS_OPERACIONAIS)
    : (FILIAIS_OPERACIONAIS as readonly string[]).includes(profile?.filial)
      ? [profile.filial as FilialOperacional]
      : [];

  // Histórico também trava por filial pra colaborador/gerente — sem isso a
  // tabela mostrava sessões de outras unidades e o botão "Reabrir" permitia
  // reabrir (na prática, "abrir") caixa de filial alheia.
  const { data: historico, isLoading: histLoading, reload } = useFetchData<any>(
    '/api/controlecaixaview',
    cross ? undefined : (filiaisVisiveis[0] ? { filial: filiaisVisiveis[0] } : { filial: '__none__' }),
  );

  const handleReabrir = async (h: any) => {
    if (!supabase) return;
    if (!await confirm(`Reabrir esta sessão de ${h.filial}? O fechamento anterior será descartado.`)) return;
    try {
      const { error } = await supabase
        .from('controle_caixa')
        .update({
          status: 'Aberto',
          fechado_por: null,
          fechado_por_nome: null,
          fechado_em: null,
          origem_fechamento: null,
        })
        .eq('id', h.id);
      if (error) throw error;
      await refresh();
      await reload();
      showToast('Caixa reaberto.', 'success');
    } catch (err: any) {
      showToast(`Erro ao reabrir: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const handleDeleteSessao = async (id: string) => {
    if (!await confirm('Inativar esta sessão de caixa? O histórico será preservado mas não aparecerá mais na listagem.')) return;
    try {
      await dbDelete('/api/controlecaixaview', id);
      await reload();
      showToast('Sessão inativada.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[ControleCaixa] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error');
    }
  };

  if (caixaLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      {/* Título */}
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Caixa</h2>
        <p className="text-sm text-gray-400 mt-1">
          {cross && !filialAtivaOperacional
            ? 'Abertura e fechamento por unidade. O PDV de cada empresa só opera com o respectivo caixa aberto.'
            : `Abertura e fechamento do caixa da unidade ${filiaisVisiveis[0] ?? profile?.filial ?? '—'}.`}
        </p>
      </div>

      {/* Capital por filial — leitura; só aparece se há dados e usuário tem acesso (RLS) */}
      {capitalRows.length > 0 && (() => {
        // Pega o registro mais recente por filial (hook já ordena DESC)
        const capitalMap: Record<string, number> = {};
        for (const r of capitalRows) {
          if (!(r.filial in capitalMap)) capitalMap[r.filial] = r.valor;
        }
        const filiaisComCapital = filiaisVisiveis.filter(f => f in capitalMap);
        if (filiaisComCapital.length === 0) return null;
        return (
          <div className={`shrink-0 grid gap-3 ${filiaisComCapital.length === 1 ? 'grid-cols-1 max-w-xs' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {filiaisComCapital.map(f => (
              <div key={f} className="neu-flat rounded-2xl p-4 border border-accent/10 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <Landmark size={15} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">{f} — Capital</div>
                  <div className="text-base font-black text-accent tabular-nums truncate">{fmtBRL(capitalMap[f])}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Cards por filial */}
      {filiaisVisiveis.length === 0 ? (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 text-center">
          <p className="text-sm text-gray-400">
            Sua filial atual (<span className="font-bold">{profile?.filial ?? '—'}</span>) não opera PDV. Peça ao admin para te associar a SuperMax, MaxLook ou TechMax.
          </p>
        </div>
      ) : (
        <div className={`shrink-0 grid gap-4 ${filiaisVisiveis.length === 1 ? 'grid-cols-1 max-w-md' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
          {filiaisVisiveis.map(f => (
            <CaixaCard
              key={f}
              filial={f}
              caixa={caixas[f]}
              showToast={showToast}
              profile={profile}
              onChanged={() => { refresh(); reload(); }}
            />
          ))}
        </div>
      )}

      {/* Histórico */}
      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        <h3 className="text-sm font-bold text-gray-300 mb-5 flex items-center gap-2">
          <ChevronDown size={14} className="text-gray-500" /> Histórico de Sessões
        </h3>

        {histLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : historico.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-6">Nenhuma sessão registrada.</p>
        ) : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[920px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-3 font-bold px-4">Data</th>
                  <th className="pb-3 font-bold px-4">Filial</th>
                  <th className="pb-3 font-bold px-4 text-right">Abertura</th>
                  <th className="pb-3 font-bold px-4">Aberto por</th>
                  <th className="pb-3 font-bold px-4 text-center">Hora Abert.</th>
                  <th className="pb-3 font-bold px-4 text-center">Hora Fech.</th>
                  <th className="pb-3 font-bold px-4">Fechado por</th>
                  <th className="pb-3 font-bold px-4 text-center">Status</th>
                  <th className="pb-3 font-bold px-4 text-center">Origem</th>
                  <th className="pb-3 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h: any) => {
                  const podeReabrir = (h.status === 'Fechado' || h.status === 'Suspenso') && h.data === today
                    && (FILIAIS_OPERACIONAIS as readonly string[]).includes(h.filial)
                    && !caixas[h.filial as FilialOperacional];
                  return (
                    <tr key={h.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">{fmtData(h.data)}</td>
                      <td className="py-3 px-4"><FilialBadge filial={h.filial} /></td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right font-bold">{fmtBRL(Number(h.valor_abertura))}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{h.aberto_por_nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-center text-gray-500">{fmtHora(h.aberto_em)}</td>
                      <td className="py-3 px-4 text-xs font-mono text-center text-gray-500">{fmtHora(h.fechado_em)}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{h.fechado_por_nome ?? '—'}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${h.status === 'Aberto' ? 'bg-emerald-500/15 text-emerald-500' : h.status === 'Suspenso' ? 'bg-yellow-500/15 text-yellow-500' : 'text-gray-500'}`}
                          style={h.status !== 'Aberto' && h.status !== 'Suspenso' ? { background: 'var(--color-badge-neutral-bg)' } : {}}
                        >{h.status}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {h.origem_fechamento ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${h.origem_fechamento === 'operador' ? 'bg-blue-500/15 text-blue-400' : 'text-gray-500'}`}
                            style={h.origem_fechamento !== 'operador' ? { background: 'var(--color-badge-neutral-bg)' } : {}}>
                            {h.origem_fechamento === 'operador' ? 'PDV' : 'Financeiro'}
                          </span>
                        ) : <span className="text-gray-600 text-[10px]">—</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <AuditoriaInspect criadoPor={h.criado_por} criadoEm={h.created_at} atualizadoPor={h.atualizado_por} atualizadoEm={h.updated_at} />
                          {podeReabrir && (
                            <button onClick={() => handleReabrir(h)} title="Reabrir caixa" className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-emerald-500"><RotateCcw size={12} /></button>
                          )}
                          <button onClick={() => handleDeleteSessao(h.id)} title="Inativar sessão" className="action-btn-delete"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
