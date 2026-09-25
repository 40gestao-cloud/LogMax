import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LockOpen, Lock, Clock, DollarSign, User, ChevronDown, Trash2, RotateCcw, ArrowDownToLine, ArrowUpFromLine, X, Calculator, Landmark, TrendingDown, Wallet, Info } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
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
/**
 * Modal de reabertura de caixa.
 *
 * Reabrir descarta o fechamento — inclusive uma falta de caixa. O ponto deste
 * modal é o usuário VER o que está apagando antes de apagar: os valores
 * descartados ficam na tela enquanto ele escreve o motivo. A RPC
 * `reabrir_caixa` (migr. 267) copia tudo para `controle_caixa_reaberturas`
 * antes de limpar e recusa motivo com menos de 5 caracteres — a validação
 * daqui é só para o usuário não descobrir isso via mensagem de erro.
 */
const MOTIVO_MIN = 5;

const ReaberturaModal = ({ caixa, saving, onClose, onConfirm }: {
  caixa: any;
  saving: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
}) => {
  const [motivo, setMotivo] = useState('');
  const motivoOk = motivo.trim().length >= MOTIVO_MIN;

  const diferenca = Number(caixa?.diferenca ?? 0);
  const tipoDif   = caixa?.tipo_diferenca ?? 'exato';
  const temDif    = tipoDif === 'sobra' || tipoDif === 'falta';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={() => !saving && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={e => e.stopPropagation()}
        className="neu-flat rounded-3xl p-6 border border-orange-500/30 w-full max-w-md flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-orange-500/15">
              <RotateCcw size={18} className="text-orange-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-200">Reabrir caixa</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {caixa?.filial ?? '—'} · {caixa?.data ? fmtData(caixa.data) : '—'}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving}
            className="shrink-0 modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl px-3 py-2.5 border border-orange-500/20 bg-orange-500/[0.06]">
          <p className="text-[11px] text-orange-200/90 leading-relaxed">
            O fechamento abaixo será <b>descartado</b> e o operador poderá voltar a vender.
            O registro fica salvo na auditoria com seu nome.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="neu-pressed rounded-lg px-2.5 py-2">
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px]">Esperado</div>
            <div className="text-gray-100 font-black tabular-nums">{fmtBRL(Number(caixa?.valor_esperado ?? 0))}</div>
          </div>
          <div className="neu-pressed rounded-lg px-2.5 py-2">
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px]">Contado</div>
            <div className="text-gray-100 font-black tabular-nums">{fmtBRL(Number(caixa?.valor_fechamento ?? 0))}</div>
          </div>
          <div className={`neu-pressed rounded-lg px-2.5 py-2 col-span-2 ${temDif ? 'border border-red-500/20' : ''}`}>
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px]">Diferença que será apagada</div>
            <div className={`font-black tabular-nums ${tipoDif === 'exato' ? 'text-gray-200' : tipoDif === 'sobra' ? 'text-emerald-400' : 'text-red-400'}`}>
              {tipoDif === 'exato' ? 'Exato' : `${tipoDif === 'sobra' ? 'Sobra' : 'Falta'} de ${fmtBRL(Math.abs(diferenca))}`}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reab-motivo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
            Motivo da reabertura *
          </label>
          <textarea
            id="reab-motivo" rows={3} autoFocus
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ex.: operador contou errado, refazer conferência com o gerente presente."
            className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
          />
          <span className={`text-[10px] ${motivoOk ? 'text-gray-600' : 'text-orange-300/80'}`}>
            {motivoOk ? 'Ficará registrado na auditoria.' : `Mínimo de ${MOTIVO_MIN} caracteres.`}
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(motivo.trim())}
            disabled={saving || !motivoOk}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-orange-200 bg-orange-900/40 border border-orange-500/30 hover:bg-orange-900/60 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
            <RotateCcw size={12} /> {saving ? 'Reabrindo…' : 'Reabrir caixa'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

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
  const [reabrindo, setReabrindo] = useState(false);
  const today = todayBR();

  const handleReabrirCaixa = async (motivo: string) => {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.rpc('reabrir_caixa', {
      p_caixa_id: caixa.id,
      p_motivo:   motivo,
    });
    setSaving(false);
    if (error) { showToast(`Erro ao reabrir: ${error.message}`, 'error'); return; }
    setReabrindo(false);
    showToast(`Caixa de ${filial} reaberto — registrado na auditoria.`, 'info');
    onChanged();
  };

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

  // Confirma fechamento solicitado pelo operador. Aceita observação extra
  // do Financeiro e um valor reconferido (se Financeiro reconferiu e divergiu
  // do que o operador lançou).
  const [obsExtra, setObsExtra] = useState('');
  const [valorReconf, setValorReconf] = useState('');
  const handleConfirmarFechamento = async () => {
    if (!supabase || !caixa) return;
    setSaving(true);
    const p_valor_reconferido = valorReconf.trim() ? parseBRL(valorReconf) : null;
    const { data, error } = await supabase.rpc('confirmar_fechamento_caixa', {
      p_controle_id:       caixa.id,
      p_observacao_extra:  obsExtra.trim() || null,
      p_valor_reconferido: p_valor_reconferido,
    });
    setSaving(false);
    if (error) { showToast(`Erro ao confirmar: ${error.message}`, 'error'); return; }
    const res = data as any;
    const tipo = res?.tipo as string;
    const dif = Number(res?.diferenca ?? 0);
    const msg = tipo === 'exato'
      ? 'Fechamento confirmado — valor exato.'
      : tipo === 'sobra'
        ? `Fechamento confirmado com SOBRA de ${fmtBRL(dif)}.`
        : `Fechamento confirmado com FALTA de ${fmtBRL(Math.abs(dif))}.`;
    showToast(msg, tipo === 'exato' ? 'success' : 'info');
    setObsExtra(''); setValorReconf('');
    onChanged();
  };

  // A abertura saiu daqui: quem abre o caixa e o operador, na tela do PDV.
  // O Financeiro acompanha, confere e fecha, e recebe o aviso de abertura e
  // de fechamento pelo sino (migr. 581). Deixar o insert morto aqui era
  // convite para religarem a porta que acabou de ser fechada.

  // ── CAIXA AGUARDANDO CONFIRMAÇÃO (operador do PDV solicitou fechamento) ──
  if (caixa && caixa.status === 'Aguardando Confirmação') {
    const esperado = Number(caixa.valor_esperado ?? 0);
    const contadoOperador = Number(caixa.valor_fechamento ?? 0);
    const diferenca = Number(caixa.diferenca ?? 0);
    const tipoDif = caixa.tipo_diferenca ?? 'exato';
    const valorFinal = valorReconf.trim() ? (parseBRL(valorReconf) ?? contadoOperador) : contadoOperador;
    const difFinal = valorFinal - esperado;
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        className="neu-flat rounded-3xl p-6 border border-yellow-500/30 flex flex-col gap-4"
        style={{ background: 'color-mix(in srgb, #EAB308 6%, var(--color-bg-base))' }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #EAB308 15%, var(--color-bg-base))' }}>
            <Calculator size={22} className="text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <FilialBadge filial={filial} />
              <span className="text-[10px] font-black uppercase tracking-widest text-yellow-400">Aguardando Confirmação</span>
              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-blue-500/15 text-blue-400">PDV</span>
            </div>
            <p className="text-xs text-gray-400">
              Encerrado por <span className="text-gray-200 font-bold">{caixa.fechado_por_nome ?? '—'}</span> às {fmtHora(caixa.fechado_em ?? null)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="neu-pressed rounded-lg px-2.5 py-2">
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px]">Esperado</div>
            <div className="text-gray-100 font-black tabular-nums">{fmtBRL(esperado)}</div>
          </div>
          <div className="neu-pressed rounded-lg px-2.5 py-2">
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px]">Contado (operador)</div>
            <div className="text-gray-100 font-black tabular-nums">{fmtBRL(contadoOperador)}</div>
          </div>
          <div className="neu-pressed rounded-lg px-2.5 py-2 col-span-2">
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px]">Diferença apurada</div>
            <div className={`font-black tabular-nums ${tipoDif === 'exato' ? 'text-gray-200' : tipoDif === 'sobra' ? 'text-emerald-400' : 'text-red-400'}`}>
              {tipoDif === 'exato' ? 'Exato' : `${tipoDif === 'sobra' ? 'Sobra' : 'Falta'} de ${fmtBRL(Math.abs(diferenca))}`}
            </div>
          </div>
        </div>

        {caixa.observacao && (
          <div className="neu-pressed rounded-lg px-3 py-2 text-[11px]">
            <div className="text-gray-500 uppercase font-bold tracking-widest text-[9px] mb-1">Observação do operador</div>
            <div className="text-gray-300 whitespace-pre-line">{caixa.observacao}</div>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
          <input type="text" inputMode="numeric" placeholder={`Reconferir valor (opcional — atual: ${fmtBRL(contadoOperador)})`}
            className="neu-input py-2 px-3 rounded-xl text-xs tabular-nums"
            value={valorReconf}
            onChange={e => setValorReconf(formatBRL(e.target.value))}
            onKeyDown={handleMoneyKeyDown} />
          {valorReconf.trim() && (
            <p className={`text-[10px] font-bold ${Math.abs(difFinal) < 0.005 ? 'text-gray-400' : difFinal > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Reconferido: {Math.abs(difFinal) < 0.005 ? 'Exato' : `${difFinal > 0 ? 'Sobra' : 'Falta'} de ${fmtBRL(Math.abs(difFinal))}`}
            </p>
          )}
          <input type="text" placeholder="Observação do Financeiro (opcional)"
            className="neu-input py-2 px-3 rounded-xl text-xs"
            value={obsExtra}
            onChange={e => setObsExtra(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            onClick={() => setReabrindo(true)}
            disabled={saving}
            className="neu-button px-3 py-1.5 rounded-xl text-[11px] font-bold text-orange-300 hover:text-orange-200 flex items-center gap-1.5 disabled:opacity-50">
            <RotateCcw size={11} /> Reabrir
          </button>
          <button
            onClick={handleConfirmarFechamento}
            disabled={saving}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-emerald-300 bg-emerald-900/30 border border-emerald-500/30 hover:bg-emerald-900/50 flex items-center gap-1.5 disabled:opacity-50">
            <Lock size={11} /> {saving ? '…' : 'Confirmar fechamento'}
          </button>
        </div>

        <AnimatePresence>
          {reabrindo && (
            <ReaberturaModal
              caixa={caixa}
              saving={saving}
              onClose={() => setReabrindo(false)}
              onConfirm={handleReabrirCaixa}
            />
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

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
          <p className="text-xs text-gray-400">Aguardando a abertura do turno.</p>
        </div>
      </div>

      {/* Quem abre o caixa é o OPERADOR, na tela do PDV: é ele que conta o
          fundo de troco e assume a gaveta. O Financeiro acompanha, confere e
          responde pela diferença — como na frente de loja de verdade, onde o
          supervisor não abre o caixa de ninguém. O aviso de abertura e de
          fechamento chega aqui pelo sino (migr. 581). */}
      <div className="neu-pressed rounded-2xl p-4 flex items-start gap-3">
        <Info size={15} className="text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400 leading-relaxed">
          A abertura é do <span className="text-gray-200 font-bold">operador</span>, na tela do
          <span className="text-gray-200 font-bold"> PDV</span> — é ele que conta o fundo de troco e
          assume a gaveta. Aqui o Financeiro acompanha, confere e fecha.
          <br />
          Você recebe um aviso quando o caixa abrir e outro quando fechar, com a diferença apurada.
        </p>
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
  const { filialAtiva } = useFilial();
  // Saldo consolidado (capital + gastos + saldo livre) por filial visível.
  // Vem da RPC calcular_saldo_capital — mesma fonte usada em FilialCapitalView
  // pra evitar divergência entre as duas telas.
  const [saldosMap, setSaldosMap] = useState<Record<string, { capital_total: number; despesas_pagas: number; saldo_livre: number; bloqueado: boolean }>>({});

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

  // Histórico sempre trava por filial pra bater com os cards visíveis. Admin/CEO
  // em modo Matriz vê as 3 operacionais; com filial escolhida no topbar, só
  // essa. Colaborador/gerente, só a própria. Sem esse filtro, admin/CEO que
  // escolhia uma filial no topbar via histórico de todas as unidades.
  const { data: historico, isLoading: histLoading, reload } = useFetchData<any>(
    '/api/controlecaixaview',
    filiaisVisiveis.length > 0 ? { filial: [...filiaisVisiveis] } : { filial: '__none__' },
    // Realtime: quem abre o caixa quase nunca é quem opera o PDV. Sem isto o
    // operador ficava recarregando a tela à espera de um caixa que já estava
    // aberto — e o inverso, vendendo contra um caixa que alguém acabou de
    // fechar.
    true,
  );

  // Chama a RPC calcular_saldo_capital pra cada filial visível em paralelo.
  // Se qualquer chamada falhar (RLS, RPC ausente na turma), a filial simplesmente
  // some do bloco de cards — não vale bloquear o resto da tela.
  useEffect(() => {
    if (!supabase || filiaisVisiveis.length === 0) { setSaldosMap({}); return; }
    let cancelado = false;
    (async () => {
      const entries = await Promise.all(filiaisVisiveis.map(async (f) => {
        const { data, error } = await supabase!.rpc('calcular_saldo_capital', { p_filial: f });
        if (error || !data?.[0]) return null;
        const r = data[0];
        return [f, {
          capital_total:  Number(r.capital_total  ?? 0),
          despesas_pagas: Number(r.despesas_pagas ?? 0),
          saldo_livre:    Number(r.saldo_livre    ?? 0),
          bloqueado:      !!r.bloqueado,
        }] as const;
      }));
      if (cancelado) return;
      const map: Record<string, { capital_total: number; despesas_pagas: number; saldo_livre: number; bloqueado: boolean }> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setSaldosMap(map);
    })();
    return () => { cancelado = true; };
  }, [filiaisVisiveis.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mesma RPC e mesmo modal do card. Esta versão era ainda pior que a de lá:
  // mantinha `valor_fechamento`/`diferenca` preenchidos num caixa 'Aberto',
  // estado que nenhuma outra parte do código espera.
  const [reabrirAlvo, setReabrirAlvo] = useState<any | null>(null);
  const [reabrindoHist, setReabrindoHist] = useState(false);

  const handleReabrir = async (motivo: string) => {
    if (!supabase || !reabrirAlvo) return;
    setReabrindoHist(true);
    try {
      const { error } = await supabase.rpc('reabrir_caixa', {
        p_caixa_id: reabrirAlvo.id,
        p_motivo:   motivo,
      });
      if (error) throw error;
      setReabrirAlvo(null);
      await refresh();
      await reload();
      showToast('Caixa reaberto — registrado na auditoria.', 'success');
    } catch (err: any) {
      showToast(`Erro ao reabrir: ${err?.message ?? 'verifique o console'}`, 'error');
    } finally {
      setReabrindoHist(false);
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
      </div>

      {/* Saúde financeira por filial — 3 mini-cards (Capital / Gastos / Saldo
          Livre) espelhando o cabeçalho de Financeiro → Capital, pra o operador
          do caixa saber quanto ainda tem antes de aprovar despesas. */}
      {(() => {
        const filiaisComSaldo = filiaisVisiveis.filter(f => f in saldosMap);
        if (filiaisComSaldo.length === 0) return null;
        return (
          <div className={`shrink-0 grid gap-4 ${filiaisComSaldo.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'}`}>
            {filiaisComSaldo.map(f => {
              const s = saldosMap[f];
              return (
                <div key={f} className="neu-flat rounded-2xl p-4 border border-accent/10 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <FilialBadge filial={f} />
                    {s.bloqueado && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                        Bloqueado
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="neu-pressed rounded-xl p-2.5 flex flex-col gap-1 border border-white/5">
                      <div className="flex items-center gap-1.5">
                        <Landmark size={11} className="text-accent" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Capital</span>
                      </div>
                      <span className="text-sm font-black text-accent tabular-nums truncate">{fmtBRL(s.capital_total)}</span>
                    </div>
                    <div className="neu-pressed rounded-xl p-2.5 flex flex-col gap-1 border border-white/5">
                      <div className="flex items-center gap-1.5">
                        <TrendingDown size={11} className="text-red-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Gastos</span>
                      </div>
                      <span className="text-sm font-black text-red-400 tabular-nums truncate">{fmtBRL(s.despesas_pagas)}</span>
                    </div>
                    <div className="neu-pressed rounded-xl p-2.5 flex flex-col gap-1 border border-white/5">
                      <div className="flex items-center gap-1.5">
                        <Wallet size={11} className={s.bloqueado ? 'text-red-400' : 'text-green-400'} />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Saldo Livre</span>
                      </div>
                      <span className={`text-sm font-black tabular-nums truncate ${s.bloqueado ? 'text-red-400' : 'text-green-400'}`}>
                        {fmtBRL(s.saldo_livre)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
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
            <table className="tabela w-full text-left border-collapse min-w-[920px]">
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
                        <div className="flex justify-center items-center gap-1.5">
                          {podeReabrir && (
                            <button onClick={() => setReabrirAlvo(h)} title="Reabrir caixa" className="action-btn-warning"><RotateCcw size={12} /></button>
                          )}
                          <MenuMais>
                            {fechar => (
                              <>
                                <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="controle_caixa" entidadeId={h.id} titulo={`Caixa ${h.data ?? ''} · ${h.filial ?? ''}`} criadoEm={h.created_at} atualizadoEm={h.updated_at} />
                                <ItemMenu onClick={() => { fechar(); handleDeleteSessao(h.id); }}
                                  cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                  Inativar sessão
                                </ItemMenu>
                              </>
                            )}
                          </MenuMais>
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

      <AnimatePresence>
        {reabrirAlvo && (
          <ReaberturaModal
            caixa={reabrirAlvo}
            saving={reabrindoHist}
            onClose={() => setReabrirAlvo(null)}
            onConfirm={handleReabrir}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
