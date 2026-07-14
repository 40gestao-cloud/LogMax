import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Loader2, ClipboardCheck, ArrowDownToLine, ArrowUpFromLine, DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { todayBR } from '../lib/dates';

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Props = {
  caixa: { id: string; valor_abertura: number; filial: string; data: string };
  showToast: (msg: string, type?: string, persist?: boolean) => void;
  onFechamentoSolicitado: () => void;
  className?: string;
};

// Botão "Fechar meu caixa" + modal para operador do PDV.
//
// Mostra o relatório do turno (vendas em dinheiro, sangria, suprimento, saldo
// esperado), pede o valor efetivamente contado + observação e chama a RPC
// `solicitar_fechamento_caixa`. O caixa vai pra status 'Aguardando Confirmação'
// e o Financeiro conclui em ControleCaixaView.
export function PDVFecharCaixa({ caixa, showToast, onFechamentoSolicitado, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [valorContado, setValorContado] = useState('');
  const [observacao, setObservacao] = useState('');
  const [vendasDinheiro, setVendasDinheiro] = useState(0);
  const [sangrias, setSangrias] = useState(0);
  const [suprimentos, setSuprimentos] = useState(0);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Ao abrir o modal, recalcula o resumo do turno em tempo real. A RPC final
  // também recalcula — este preview é só orientação pro operador contar o
  // dinheiro. Se divergir na hora do envio, quem manda é o servidor.
  useEffect(() => {
    if (!open || !supabase) return;
    let cancelled = false;
    setLoadingSummary(true);
    (async () => {
      const today = todayBR();
      const [vRes, mRes] = await Promise.all([
        supabase.from('vendas')
          .select('total_final')
          .eq('filial', caixa.filial)
          .ilike('forma_pagamento', 'dinheiro%')
          .eq('ativo', true)
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`),
        supabase.from('movimentacoes_caixa')
          .select('tipo, valor')
          .eq('controle_caixa_id', caixa.id),
      ]);
      if (cancelled) return;
      const vend = (vRes.data ?? []).reduce((s: number, r: any) => s + Number(r.total_final || 0), 0);
      const sang = (mRes.data ?? []).filter((m: any) => m.tipo === 'sangria').reduce((s: number, m: any) => s + Number(m.valor || 0), 0);
      const supr = (mRes.data ?? []).filter((m: any) => m.tipo === 'suprimento').reduce((s: number, m: any) => s + Number(m.valor || 0), 0);
      setVendasDinheiro(vend);
      setSangrias(sang);
      setSuprimentos(supr);
      setLoadingSummary(false);
    })();
    return () => { cancelled = true; };
  }, [open, caixa.id, caixa.filial]);

  const esperado = useMemo(
    () => Number(caixa.valor_abertura || 0) + vendasDinheiro + suprimentos - sangrias,
    [caixa.valor_abertura, vendasDinheiro, suprimentos, sangrias]
  );
  const contado = parseBRL(valorContado) ?? 0;
  const diferenca = contado - esperado;
  const tipoDif = Math.abs(diferenca) < 0.005 ? 'exato' : diferenca > 0 ? 'sobra' : 'falta';

  const handleSolicitar = async () => {
    if (!supabase) return;
    const valor = parseBRL(valorContado);
    if (valor === null || valor === undefined || Number.isNaN(valor) || valor < 0) {
      showToast('Informe o valor contado em dinheiro.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('solicitar_fechamento_caixa', {
      p_controle_id:   caixa.id,
      p_valor_contado: valor,
      p_observacao:    observacao.trim() || null,
    });
    setSaving(false);
    if (error) { showToast(`Erro ao fechar: ${error.message}`, 'error'); return; }
    showToast('Caixa enviado ao Financeiro para confirmação.', 'success', true);
    setOpen(false);
    setValorContado(''); setObservacao('');
    onFechamentoSolicitado();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Fechar meu caixa e enviar ao Financeiro"
        className={`neu-button flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-300 hover:text-accent transition-colors ${className}`}
      >
        <Lock size={14} /> Fechar meu caixa
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
            onClick={() => !saving && setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg neu-flat border border-white/10 rounded-2xl bg-[var(--color-bg-base)] max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={16} className="text-accent" />
                  <h3 className="text-sm font-bold text-gray-100">Encerrar caixa — {caixa.filial}</h3>
                </div>
                <button onClick={() => setOpen(false)} disabled={saving} className="text-gray-500 hover:text-gray-300 disabled:opacity-50">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {loadingSummary ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="text-accent animate-spin" />
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 neu-flat rounded-xl p-4 border border-white/5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Resumo do turno</p>
                      <Linha icon={DollarSign} label="Valor de abertura" value={fmtBRL(Number(caixa.valor_abertura || 0))} />
                      <Linha icon={TrendingUp} label="Vendas em dinheiro" value={fmtBRL(vendasDinheiro)} valueClass="text-green-400" />
                      <Linha icon={ArrowDownToLine} label="Suprimentos" value={fmtBRL(suprimentos)} valueClass="text-green-400" />
                      <Linha icon={ArrowUpFromLine} label="Sangrias" value={`− ${fmtBRL(sangrias)}`} valueClass="text-red-400" />
                      <div className="border-t border-white/5 pt-2 mt-1">
                        <Linha icon={ClipboardCheck} label="Esperado em caixa" value={fmtBRL(esperado)} valueClass="text-accent font-black" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Valor contado (dinheiro) *</label>
                      <input
                        className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={valorContado}
                        onKeyDown={handleMoneyKeyDown}
                        onChange={e => setValorContado(formatBRL(parseBRL(e.target.value) ?? 0))}
                        placeholder="R$ 0,00"
                        inputMode="numeric"
                      />
                      {contado > 0 && (
                        <p className={`text-xs font-bold ${tipoDif === 'exato' ? 'text-gray-400' : tipoDif === 'sobra' ? 'text-green-400' : 'text-red-400'}`}>
                          {tipoDif === 'exato'
                            ? 'Fechamento exato.'
                            : `${tipoDif === 'sobra' ? 'Sobra' : 'Falta'} de ${fmtBRL(Math.abs(diferenca))}`}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Observação (opcional)</label>
                      <textarea
                        className="neu-input py-2 px-3 rounded-xl text-sm min-h-[70px] resize-none"
                        value={observacao}
                        onChange={e => setObservacao(e.target.value)}
                        placeholder="Ex: sobra por troco não devolvido, cliente pagou a mais, etc."
                        maxLength={500}
                      />
                    </div>

                    <div className="flex items-start gap-2 text-[10px] text-gray-400 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-3 py-2">
                      <ClipboardCheck size={12} className="text-yellow-400 shrink-0 mt-0.5" />
                      <span>Ao confirmar, o caixa vai pra <span className="font-bold text-yellow-400">Aguardando Confirmação</span>. Você não conseguirá mais registrar vendas hoje. Financeiro revisa e finaliza em Controle de Caixa.</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-2 p-4 border-t border-white/5 justify-end">
                <button onClick={() => setOpen(false)} disabled={saving}
                  className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={handleSolicitar} disabled={saving || loadingSummary || !valorContado.trim()}
                  className="neu-button px-4 py-2 rounded-xl text-xs font-bold text-accent border border-accent/30 hover:bg-accent/10 disabled:opacity-50 flex items-center gap-2">
                  {saving ? <><Loader2 size={12} className="animate-spin" /> Enviando…</> : <><Lock size={12} /> Enviar ao Financeiro</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Linha({ icon: Icon, label, value, valueClass = 'text-gray-200' }: any) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5 text-gray-400">
        <Icon size={12} />
        <span>{label}</span>
      </div>
      <span className={`font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}
