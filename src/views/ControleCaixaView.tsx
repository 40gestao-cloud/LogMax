import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LockOpen, Lock, DollarSign, User, Trash2, RotateCcw, ArrowDownToLine, ArrowUpFromLine, X, Calculator, Landmark, TrendingDown, Wallet, History } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useCaixasDoDia, FILIAIS_OPERACIONAIS, type FilialOperacional } from '../hooks/useCaixaAberto';
import { useFetchData, dbDelete } from '../hooks/useSupabaseData';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { LoadingSpinner, NeuButtonAccent, FilialBadge, SecaoFormulario, ModalFormulario, FormField, StatusBadge, Pagination } from '../components/ui';
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

// Número grande com rótulo — a mesma caixa para os valores do caixa e para a
// saúde financeira da unidade, para as duas colunas lerem igual.
const Kpi = ({ rotulo, valor, cor = 'text-gray-100', icon: Icon, sub }: {
  rotulo: string; valor: React.ReactNode; cor?: string; icon?: any; sub?: React.ReactNode;
}) => (
  <div className="neu-pressed rounded-xl p-3 border border-white/5 flex flex-col gap-1 min-w-0">
    <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
      {Icon && <Icon size={12} className="shrink-0" />} {rotulo}
    </span>
    <span className={`text-lg font-black tabular-nums truncate ${cor}`}>{valor}</span>
    {sub && <span className="text-[10px] text-gray-500 truncate">{sub}</span>}
  </div>
);

const rotuloDiferenca = (tipo: string, dif: number) =>
  tipo === 'exato' ? 'Exato' : `${tipo === 'sobra' ? 'Sobra' : 'Falta'} de ${fmtBRL(Math.abs(dif))}`;
const corDiferenca = (tipo: string) =>
  tipo === 'exato' ? 'text-gray-100' : tipo === 'sobra' ? 'text-emerald-400' : 'text-red-400';

// Cada filial tem seu próprio card de status + abertura/fechamento.
// Extraído porque o ControleCaixaView pode renderizar 1, 2 ou 3 deles dependendo
// do role/filial do operador.
const CaixaCard = ({ filial, caixa, showToast, profile, onChanged }: any) => {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  // Modal aberto: sangria, suprimento, fechar ou nenhum.
  const [painel, setPainel] = useState<'none' | 'sangria' | 'suprimento' | 'fechar'>('none');
  const [movValor, setMovValor] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [valorContado, setValorContado] = useState('');
  const [obsFechamento, setObsFechamento] = useState('');
  const [movs, setMovs] = useState<any[]>([]);
  const [reabrindo, setReabrindo] = useState(false);

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
    const tipoFinal = Math.abs(difFinal) < 0.005 ? 'exato' : difFinal > 0 ? 'sobra' : 'falta';
    return (
      <SecaoFormulario titulo={`Aguardando confirmação — ${filial}`} icon={Calculator} cor="amarelo"
        extra="Fechado pelo PDV">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi rotulo="Esperado" valor={fmtBRL(esperado)} icon={Calculator} />
            <Kpi rotulo="Contado (operador)" valor={fmtBRL(contadoOperador)} icon={User}
              sub={`${caixa.fechado_por_nome ?? '—'} às ${fmtHora(caixa.fechado_em ?? null)}`} />
            <Kpi rotulo="Diferença" valor={rotuloDiferenca(tipoDif, diferenca)} cor={corDiferenca(tipoDif)} />
          </div>

          {caixa.observacao && (
            <div className="neu-pressed rounded-xl px-3 py-2.5 border border-white/5">
              <span className="block text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Observação do operador</span>
              <span className="text-xs text-gray-200 whitespace-pre-line">{caixa.observacao}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Reconferir valor (opcional)">
              <input type="text" inputMode="numeric" placeholder={`Atual: ${fmtBRL(contadoOperador)}`}
                className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
                value={valorReconf}
                onChange={e => setValorReconf(formatBRL(e.target.value))}
                onKeyDown={handleMoneyKeyDown} />
              {valorReconf.trim() && (
                <span className={`text-[11px] font-bold mt-1 ${corDiferenca(tipoFinal)}`}>
                  Reconferido: {rotuloDiferenca(tipoFinal, difFinal)}
                </span>
              )}
            </FormField>
            <FormField label="Observação do Financeiro (opcional)">
              <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                value={obsExtra}
                onChange={e => setObsExtra(e.target.value)} />
            </FormField>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={() => setReabrindo(true)} disabled={saving} className="btn-solido btn-solido--laranja">
              <RotateCcw size={13} /> Reabrir
            </button>
            <button onClick={handleConfirmarFechamento} disabled={saving} className="btn-solido btn-solido--verde">
              <Lock size={13} /> {saving ? 'Confirmando…' : 'Confirmar fechamento'}
            </button>
          </div>
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
      </SecaoFormulario>
    );
  }

  if (!caixa) {
    /* ── CAIXA FECHADO ── */
    // Quem abre o caixa é o OPERADOR, na tela do PDV: é ele que conta o fundo
    // de troco e assume a gaveta. O aviso de abertura e de fechamento chega
    // aqui pelo sino (migr. 581).
    return (
      <SecaoFormulario titulo={`Caixa fechado — ${filial}`} icon={Lock} cor="cinza">
        <div className="flex-1 flex items-center gap-4 py-2">
          <div className="w-12 h-12 rounded-2xl neu-pressed flex items-center justify-center shrink-0">
            <Lock size={20} className="text-gray-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-200">Aguardando a abertura do turno.</p>
            <p className="text-xs text-gray-500 mt-0.5">Abre pelo PDV, na mão do operador — o aviso chega pelo sino.</p>
          </div>
        </div>
      </SecaoFormulario>
    );
  }

  /* ── CAIXA ABERTO ── */
  const movAberto = painel === 'sangria' || painel === 'suprimento';
  return (
    <SecaoFormulario titulo={`Caixa aberto — ${filial}`} icon={LockOpen} cor="verde"
      extra={<span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> em operação</span>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi rotulo="Abertura" valor={fmtBRL(Number(caixa.valor_abertura ?? 0))} icon={DollarSign}
            sub={`${caixa.aberto_por_nome ?? '—'} às ${fmtHora(caixa.aberto_em)}`} />
          <Kpi rotulo="Suprimentos" valor={`+ ${fmtBRL(totalSuprimento)}`} cor="text-emerald-400" icon={ArrowDownToLine} />
          <Kpi rotulo="Sangrias" valor={`− ${fmtBRL(totalSangria)}`} cor="text-orange-400" icon={ArrowUpFromLine} />
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button onClick={() => setPainel('suprimento')} className="btn-solido btn-solido--verde">
            <ArrowDownToLine size={13} /> Suprimento
          </button>
          <button onClick={() => setPainel('sangria')} className="btn-solido btn-solido--laranja">
            <ArrowUpFromLine size={13} /> Sangria
          </button>
          <button onClick={() => setPainel('fechar')} className="btn-solido btn-solido--vermelho">
            <Lock size={13} /> Fechar caixa
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Movimentações do dia{movs.length > 0 ? ` (${movs.length})` : ''}
          </span>
          {movs.length === 0 ? (
            <p className="text-xs text-gray-600">Nenhuma sangria ou suprimento neste turno.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {movs.map(m => {
                const sangria = m.tipo === 'sangria';
                return (
                  <div key={m.id} className="neu-pressed rounded-xl px-3 py-2 border border-white/5 flex items-center gap-3">
                    <span className={`shrink-0 w-24 text-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest text-white ${sangria ? 'bg-orange-600' : 'bg-green-600'}`}>
                      {sangria ? 'Sangria' : 'Suprimento'}
                    </span>
                    <span className={`shrink-0 text-sm font-black tabular-nums ${sangria ? 'text-orange-400' : 'text-emerald-400'}`}>
                      {sangria ? '−' : '+'} {fmtBRL(Number(m.valor))}
                    </span>
                    <span className="flex-1 min-w-0 text-xs text-gray-400 truncate" title={m.motivo ?? ''}>{m.motivo || '—'}</span>
                    <span className="shrink-0 text-[11px] text-gray-500 hidden sm:inline">{m.criado_por_nome ?? '—'}</span>
                    <span className="shrink-0 text-[11px] text-gray-500 font-mono">{fmtHora(m.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ModalFormulario
        aberto={movAberto}
        largura="md"
        titulo={painel === 'sangria' ? `Sangria — ${filial}` : `Suprimento — ${filial}`}
        subtitulo={painel === 'sangria' ? 'retirada de dinheiro da gaveta' : 'entrada de troco ou reforço'}
        onCancelar={resetPainel}
        cancelarDesabilitado={saving}
        acoes={
          <NeuButtonAccent onClick={() => handleMovimentacao(painel as 'sangria' | 'suprimento')} isLoading={saving}>
            Confirmar
          </NeuButtonAccent>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Valor (R$) *">
            <input type="text" inputMode="numeric" placeholder="0,00"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={movValor}
              onChange={e => setMovValor(formatBRL(e.target.value))}
              onKeyDown={handleMoneyKeyDown} />
          </FormField>
          <FormField label="Motivo">
            <input type="text" placeholder={painel === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: troco inicial'}
              className="neu-input py-2 px-3 rounded-xl text-sm"
              value={movMotivo}
              onChange={e => setMovMotivo(e.target.value)} />
          </FormField>
        </div>
      </ModalFormulario>

      <ModalFormulario
        aberto={painel === 'fechar'}
        largura="md"
        titulo={`Fechar caixa — ${filial}`}
        subtitulo="fechamento conferido"
        onCancelar={resetPainel}
        cancelarDesabilitado={saving}
        acoes={
          <button onClick={handleFecharConferido} disabled={saving} className="btn-solido btn-solido--vermelho">
            <Lock size={13} /> {saving ? 'Fechando…' : 'Fechar caixa'}
          </button>
        }
      >
        <p className="text-xs text-gray-400">
          Conte só o <b className="text-gray-200">dinheiro</b> da gaveta. O esperado é abertura + vendas em dinheiro + suprimentos − sangrias.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Valor contado em dinheiro *">
            <input type="text" inputMode="numeric" placeholder="0,00"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={valorContado}
              onChange={e => setValorContado(formatBRL(e.target.value))}
              onKeyDown={handleMoneyKeyDown} />
          </FormField>
          <FormField label="Observação">
            <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
              value={obsFechamento}
              onChange={e => setObsFechamento(e.target.value)} />
          </FormField>
        </div>
      </ModalFormulario>
    </SecaoFormulario>
  );
};

type SaldoFilial = { capital_total: number; despesas_pagas: number; saldo_livre: number; bloqueado: boolean };

// Capital / Gastos / Saldo livre — espelha o cabeçalho de Financeiro → Capital,
// para quem cuida do caixa saber quanto ainda tem antes de aprovar despesas.
const SaudeCard = ({ saldo }: { saldo: SaldoFilial }) => (
  <SecaoFormulario titulo="Saúde financeira" icon={Landmark} cor="dourado"
    extra={saldo.bloqueado ? <span className="px-2 py-0.5 rounded bg-red-600 text-white">Bloqueado</span> : undefined}>
    <div className="flex flex-col gap-3">
      <Kpi rotulo="Capital" valor={fmtBRL(saldo.capital_total)} cor="text-accent" icon={Landmark} />
      <Kpi rotulo="Gastos" valor={fmtBRL(saldo.despesas_pagas)} cor="text-red-400" icon={TrendingDown} />
      <Kpi rotulo="Saldo livre" valor={fmtBRL(saldo.saldo_livre)} cor={saldo.bloqueado ? 'text-red-400' : 'text-green-400'} icon={Wallet} />
    </div>
  </SecaoFormulario>
);

const POR_PAGINA_HIST = 20;

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
  const [saldosMap, setSaldosMap] = useState<Record<string, SaldoFilial>>({});
  const [paginaHist, setPaginaHist] = useState(0);

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
  // fica sem a coluna de saúde — não vale bloquear o resto da tela.
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
      const map: Record<string, SaldoFilial> = {};
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

  const paginaHistOk = Math.min(paginaHist, Math.max(0, Math.ceil(historico.length / POR_PAGINA_HIST) - 1));
  const paginaVista = historico.slice(paginaHistOk * POR_PAGINA_HIST, (paginaHistOk + 1) * POR_PAGINA_HIST);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Controle de Caixa</h2>
      </div>

      {/* Um bloco por unidade: o caixa do dia à esquerda, a saúde financeira
          à direita. Separados, a saúde ocupava a largura toda e o caixa ficava
          preso numa coluna estreita embaixo, com a tela vazia ao lado. */}
      {filiaisVisiveis.length === 0 ? (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 text-center">
          <p className="text-sm text-gray-400">
            Sua filial atual (<span className="font-bold">{profile?.filial ?? '—'}</span>) não opera PDV. Peça ao admin para te associar a SuperMax, MaxLook ou TechMax.
          </p>
        </div>
      ) : filiaisVisiveis.map(f => {
        const saldo = saldosMap[f];
        return (
          <div key={f} className={`shrink-0 grid grid-cols-1 gap-4 ${saldo ? 'lg:grid-cols-[minmax(0,1fr)_19rem]' : ''}`}>
            <CaixaCard
              filial={f}
              caixa={caixas[f]}
              showToast={showToast}
              profile={profile}
              onChanged={() => { refresh(); reload(); }}
            />
            {saldo && <SaudeCard saldo={saldo} />}
          </div>
        );
      })}

      <div className="shrink-0">
      <SecaoFormulario titulo="Histórico de sessões" icon={History} cor="azul"
        extra={historico.length > 0 ? `${historico.length} sess${historico.length === 1 ? 'ão' : 'ões'}` : undefined}>
        {histLoading ? (
          <div className="flex justify-center py-6"><LoadingSpinner /></div>
        ) : historico.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-6">Nenhuma sessão registrada.</p>
        ) : (
          <>
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[860px]">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center w-28">Data</th>
                  <th className="text-center w-32">Unidade</th>
                  <th className="text-center w-32">Abertura</th>
                  <th className="text-center w-36">Turno</th>
                  <th className="text-center">Responsáveis</th>
                  <th className="text-center w-40">Status</th>
                  <th className="text-center w-28">Origem</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginaVista.map((h: any) => {
                  const podeReabrir = (h.status === 'Fechado' || h.status === 'Suspenso') && h.data === today
                    && (FILIAIS_OPERACIONAIS as readonly string[]).includes(h.filial)
                    && !caixas[h.filial as FilialOperacional];
                  return (
                    <tr key={h.id} className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                      <td className="py-3 px-3 text-sm font-semibold text-gray-100 font-mono whitespace-nowrap">{h.data ? fmtData(h.data) : '—'}</td>
                      <td className="py-3 px-3 text-center"><FilialBadge filial={h.filial} /></td>
                      <td className="py-3 px-3 text-center text-sm font-bold text-gray-100 tabular-nums">{fmtBRL(Number(h.valor_abertura ?? 0))}</td>
                      <td className="py-3 px-3 text-center text-xs text-gray-300 font-mono whitespace-nowrap">
                        {fmtHora(h.aberto_em)} <span className="text-gray-600">–</span> {fmtHora(h.fechado_em)}
                      </td>
                      <td className="py-3 px-3 text-center text-[11px] leading-relaxed">
                        <span className="block"><span className="text-gray-500">abriu </span><span className="text-gray-200">{h.aberto_por_nome ?? '—'}</span></span>
                        <span className="block"><span className="text-gray-500">fechou </span><span className="text-gray-200">{h.fechado_por_nome ?? '—'}</span></span>
                      </td>
                      <td className="py-3 px-3 text-center"><StatusBadge status={h.status} /></td>
                      <td className="py-3 px-3 text-center">
                        {h.origem_fechamento ? (
                          <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest text-white ${h.origem_fechamento === 'operador' ? 'bg-blue-600' : 'bg-zinc-600'}`}>
                            {h.origem_fechamento === 'operador' ? 'PDV' : 'Financeiro'}
                          </span>
                        ) : <span className="text-gray-600 text-xs">—</span>}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                          {podeReabrir && (
                            <button onClick={() => setReabrirAlvo(h)} title="Reabrir caixa" aria-label="Reabrir caixa" className="action-btn-laranja">
                              <RotateCcw size={13} />
                            </button>
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
          <Pagination page={paginaHistOk} totalCount={historico.length} pageSize={POR_PAGINA_HIST}
            onPrev={() => setPaginaHist(Math.max(0, paginaHistOk - 1))} onNext={() => setPaginaHist(paginaHistOk + 1)} />
          </>
        )}
      </SecaoFormulario>
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
