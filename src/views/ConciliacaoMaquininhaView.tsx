import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CreditCard, Check, X, Loader2, Wand2, Undo2, Eye, Landmark } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData } from '../hooks/useSupabaseData';
import { useTravaAtualizacao } from '../hooks/useTravaAtualizacao';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { formatBRL } from '../lib/viewUtils';
import { supabase } from '../lib/supabase';
import { hasSetor } from '../lib/rbac';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';
import type { FilialOp } from '../components/FilialSelector';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFilial } from '../contexts/FilialContext';

// Títulos que ainda cabem num repasse. Mesma régua da tela de Contas a Receber.
const RECEBIVEL = ['Aberto', 'Atrasado', 'Parcial'];

const saldoEmAberto = (c: any): number =>
  c?.status === 'Parcial'
    ? Math.max(Number(c.valor ?? 0) - Number(c.valor_pago ?? 0), 0)
    : Number(c?.valor ?? 0);

/**
 * Conciliação da Maquininha (migr. 570).
 *
 * A adquirente não deposita o valor da venda: deposita a venda MENOS o MDR, na
 * data de repasse, num lote que junta vários títulos. Aqui o Financeiro monta
 * esse lote, e o banco faz os dois lançamentos que a contabilidade exige —
 * receita pelo bruto, taxa como despesa.
 *
 * A seleção é manual de propósito: conciliar é casar o extrato do banco com o
 * sistema, e é isso que se pede ao aluno. O botão "Sugerir" adianta o trabalho
 * óbvio (título de cartão vencido até a data do repasse) sem tomar a decisão.
 */
const ConciliacaoMaquininhaViewInner = ({
  showToast, profile, filial,
}: { showToast: any; profile: UserProfile; filial: FilialOp }) => {
  const confirm = useConfirm();

  const { data: titulos, isLoading, reload: reloadTitulos } = useFetchData<any>(
    '/api/contasreceberview',
    { filial, status: RECEBIVEL },
    true,
    { orderBy: 'vencimento', ascending: true },
  );
  const { data: formas }  = useFetchData<any>('/api/formaspagamentoview', { filial });
  const { data: bancos }  = useFetchData<any>('/api/caixabancosview', { filial });
  const { data: lotes, reload: reloadLotes } = useFetchData<any>(
    '/api/conciliacoesmaquininhaview', { filial }, true,
  );

  const podeConciliar = hasSetor(profile, 'financeiro')
    || profile.role === 'admin' || profile.role === 'ceo' || profile.role === 'gerente';

  const [formaId, setFormaId]   = useState('');
  const [bancoId, setBancoId]   = useState('');
  const [dataRep, setDataRep]   = useState(() => todayBR());
  const [obs, setObs]           = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [detalhe, setDetalhe]   = useState<any | null>(null);
  const [itens, setItens]       = useState<any[] | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);

  // Lote em montagem não tem campo na tela — é um conjunto em memória. Sem a
  // trava, a PWA recarregando por baixo apaga a conferência inteira.
  useTravaAtualizacao(marcados.size > 0, 'conciliacao-em-montagem',
    'há um repasse de maquininha em conferência, ainda sem fechar');

  const formasAtivas = useMemo(
    () => formas.filter((f: any) => (f.status ?? 'Ativo') === 'Ativo')
      .sort((a: any, b: any) => (a.descricao ?? '').localeCompare(b.descricao ?? '', 'pt-BR', { sensitivity: 'base' })),
    [formas]
  );
  const forma = formasAtivas.find((f: any) => f.id === formaId) ?? null;
  const taxaPct = Number(forma?.taxa ?? 0);

  const bancosAtivos = useMemo(
    () => bancos.filter((b: any) => (b.status ?? 'Ativo') !== 'Inativo'),
    [bancos]
  );

  // Um título só entra num lote; se já foi conciliado está Pago e nem aparece.
  const selecionaveis = useMemo(
    () => titulos.filter((t: any) => saldoEmAberto(t) > 0),
    [titulos]
  );

  const bruto = useMemo(
    () => selecionaveis
      .filter((t: any) => marcados.has(t.id))
      .reduce((s: number, t: any) => s + saldoEmAberto(t), 0),
    [selecionaveis, marcados]
  );
  const taxa    = Math.round(bruto * taxaPct) / 100;
  const liquido = Math.round((bruto - taxa) * 100) / 100;

  // Trocar de forma esvazia a seleção: os títulos marcados eram os daquela
  // adquirente, e misturar bandeiras num lote é o erro que a tela existe para
  // evitar.
  useEffect(() => { setMarcados(new Set()); }, [formaId]);

  const alterna = (id: string) => setMarcados(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // "Sugerir" marca o que a adquirente já deveria ter repassado: título
  // carimbado com ESTA forma (vem da conversão de orçamento) e vencido até a
  // data do repasse. O que veio do PDV não tem carimbo e continua na mão.
  const sugerir = () => {
    if (!forma) { showToast('Escolha a forma de pagamento primeiro.', 'error', true); return; }
    const sugeridos = selecionaveis.filter((t: any) =>
      t.forma_pagamento_id === forma.id && (!t.vencimento || t.vencimento <= dataRep));
    if (sugeridos.length === 0) {
      showToast('Nenhum título desta forma vencido até a data — marque manualmente o que o extrato mostra.', 'info', true);
      return;
    }
    setMarcados(new Set(sugeridos.map((t: any) => t.id)));
    showToast(`${sugeridos.length} título(s) sugerido(s). Confira com o extrato antes de fechar.`, 'success', true);
  };

  const conciliar = async () => {
    if (!supabase) return;
    if (!formaId) { showToast('Escolha a forma de pagamento do repasse.', 'error', true); return; }
    if (!bancoId) { showToast('Escolha a conta em que o repasse caiu.', 'error', true); return; }
    if (marcados.size === 0) { showToast('Marque os títulos do repasse.', 'error', true); return; }
    if (!await confirm(
      `Fechar o repasse: ${marcados.size} título(s), R$ ${formatBRL(bruto)} bruto, taxa de R$ ${formatBRL(taxa)}, líquido de R$ ${formatBRL(liquido)}?`
    )) return;

    setSalvando(true);
    try {
      const { data, error } = await supabase.rpc('conciliar_maquininha', {
        p_forma_pagamento_id: formaId,
        p_banco_id:           bancoId,
        p_contas:             Array.from(marcados),
        p_data_repasse:       dataRep,
        p_observacoes:        obs || null,
      });
      if (error) throw error;
      showToast(
        `Repasse conciliado: R$ ${formatBRL(Number((data as any)?.valor_liquido ?? liquido))} na conta, R$ ${formatBRL(Number((data as any)?.valor_taxa ?? taxa))} de taxa lançados como despesa.`,
        'success', true
      );
      setMarcados(new Set());
      setObs('');
      reloadTitulos();
      reloadLotes();
    } catch (err: any) {
      showToast(`Falha ao conciliar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSalvando(false);
    }
  };

  const cancelar = async (lote: any) => {
    if (!supabase) return;
    if (!await confirm(
      `Cancelar este repasse? Os ${lote.qtd_titulos} título(s) voltam a ficar em aberto e R$ ${formatBRL(Number(lote.valor_liquido ?? 0))} saem da conta.`
    )) return;
    setCancelando(lote.id);
    try {
      const { data, error } = await supabase.rpc('cancelar_conciliacao_maquininha', {
        p_id: lote.id, p_motivo: null,
      });
      if (error) throw error;
      showToast(`Repasse cancelado — ${(data as any)?.titulos_reabertos ?? 0} título(s) reabertos.`, 'info', true);
      reloadTitulos();
      reloadLotes();
    } catch (err: any) {
      showToast(`Falha ao cancelar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setCancelando(null);
    }
  };

  const abrirDetalhe = async (lote: any) => {
    setDetalhe(lote);
    setItens(null);
    if (!supabase) return;
    const { data } = await supabase
      .from('conciliacao_maquininha_itens')
      .select('*')
      .eq('conciliacao_id', lote.id);
    setItens(data ?? []);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
          Conciliação da Maquininha — {filial}
        </h2>
      </div>

      {podeConciliar && (
        <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4 shrink-0">
          <h3 className="text-sm font-bold text-gray-200">Novo repasse</h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <FormField label="Forma de pagamento *">
              <select className="neu-input py-2 px-3 rounded-xl text-sm"
                value={formaId} onChange={e => setFormaId(e.target.value)}>
                <option value="">Selecione...</option>
                {formasAtivas.map((f: any) => (
                  <option key={f.id} value={f.id}>
                    {f.descricao}{Number(f.taxa ?? 0) > 0 ? ` — ${formatBRL(Number(f.taxa))}%` : ''}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Caiu na conta *">
              <select className="neu-input py-2 px-3 rounded-xl text-sm"
                value={bancoId} onChange={e => setBancoId(e.target.value)}>
                <option value="">Selecione...</option>
                {bancosAtivos.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.banco} — {b.conta}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Data do repasse *">
              <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                value={dataRep} onChange={e => setDataRep(e.target.value)} />
            </FormField>
            <FormField label="Observações">
              <input type="text" className="neu-input py-2 px-3 rounded-xl text-sm"
                value={obs} onChange={e => setObs(e.target.value)}
                placeholder="Nº do extrato, lote da adquirente..." />
            </FormField>
          </div>

          {/* Títulos em aberto */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Títulos em aberto — marque o que o extrato mostra
              </span>
              <button onClick={sugerir}
                className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-accent flex items-center gap-1">
                <Wand2 size={11} /> Sugerir
              </button>
            </div>

            {isLoading ? <LoadingSpinner /> : selecionaveis.length === 0 ? (
              <p className="text-xs text-gray-600 py-3 text-center">Nenhum título em aberto nesta unidade.</p>
            ) : (
              <div className="neu-pressed rounded-xl max-h-72 overflow-y-auto main-scrollbar">
                <table className="tabela col-guia w-full text-xs">
                  <thead className="sticky top-0" style={{ background: 'var(--color-bg-base)' }}>
                    <tr className="text-left text-gray-500 border-b border-white/5">
                      <th className="py-2 px-3 font-bold w-10"></th>
                      <th className="py-2 px-3 font-bold">Título</th>
                      <th className="py-2 px-3 font-bold">Vencimento</th>
                      <th className="py-2 px-3 font-bold text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selecionaveis.map((t: any) => {
                      const daForma = !!forma && t.forma_pagamento_id === forma.id;
                      return (
                        <tr key={t.id}
                          onClick={() => alterna(t.id)}
                          className={`border-b border-white/5 last:border-b-0 cursor-pointer transition-colors ${
                            marcados.has(t.id) ? 'bg-accent/10' : 'hover:bg-white/5'}`}>
                          <td className="py-2 px-3">
                            <input type="checkbox" readOnly checked={marcados.has(t.id)}
                              className="pointer-events-none accent-current" />
                          </td>
                          <td className="py-2 px-3 text-gray-200">
                            {t.descricao ?? '—'}
                            {daForma ? (
                              <span className="ml-2 text-[10px] text-cyan-400">• desta forma</span>
                            ) : t.exige_conciliacao ? (
                              // Título de cartão de OUTRA forma: cabe no lote se o
                              // extrato mostrar, mas o operador tem de ver que não
                              // é o que o "Sugerir" escolheria.
                              <span className="ml-2 text-[10px] text-gray-500">• cartão</span>
                            ) : (
                              // Não é de maquininha: entra só se o operador insistir.
                              <span className="ml-2 text-[10px] text-yellow-500/70">• não é de cartão</span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono text-gray-400">{t.vencimento ?? '—'}</td>
                          <td className="py-2 px-3 font-mono text-gray-200 text-right tabular-nums">
                            R$ {formatBRL(saldoEmAberto(t))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* O fechamento do lote, linha a linha */}
          <div className="flex justify-end gap-6 text-xs border-t border-white/5 pt-3 flex-wrap">
            <div className="flex flex-col items-end">
              <span className="text-gray-500 uppercase tracking-widest text-[10px]">Bruto ({marcados.size})</span>
              <span className="font-mono text-gray-300 tabular-nums">R$ {formatBRL(bruto)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-gray-500 uppercase tracking-widest text-[10px]">
                Taxa {taxaPct > 0 ? `(${formatBRL(taxaPct)}%)` : ''}
              </span>
              <span className="font-mono text-red-400 tabular-nums">- R$ {formatBRL(taxa)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-gray-500 uppercase tracking-widest text-[10px]">Cai na conta</span>
              <span className="font-mono text-lg font-black text-accent tabular-nums">R$ {formatBRL(liquido)}</span>
            </div>
          </div>

          <div className="flex justify-end">
            <NeuButtonAccent onClick={conciliar} isLoading={salvando}>
              <Check size={14} /> Conciliar repasse
            </NeuButtonAccent>
          </div>
        </div>
      )}

      {/* Repasses já fechados */}
      {lotes.length === 0 ? (
        <EmptyState message="Nenhum repasse conciliado nesta unidade." />
      ) : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Repasse</th>
                  <th className="pb-4 font-bold px-4 text-center">Data</th>
                  <th className="pb-4 font-bold px-4 text-center">Títulos</th>
                  <th className="pb-4 font-bold px-4 text-right">Bruto</th>
                  <th className="pb-4 font-bold px-4 text-right">Taxa</th>
                  <th className="pb-4 font-bold px-4 text-right">Líquido</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {lotes.map((l: any) => (
                    <motion.tr key={l.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                        <span className="flex items-center gap-2">
                          <CreditCard size={12} className="text-gray-500" />
                          {l.forma_pagamento}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-500 text-center">{l.data_repasse}</td>
                      <td className="py-3 px-4 text-xs text-gray-400 text-center">{l.qtd_titulos}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right tabular-nums">R$ {formatBRL(Number(l.valor_bruto ?? 0))}</td>
                      <td className="py-3 px-4 text-xs font-mono text-red-400 text-right tabular-nums">- R$ {formatBRL(Number(l.valor_taxa ?? 0))}</td>
                      <td className="py-3 px-4 text-xs font-mono text-accent font-bold text-right tabular-nums">R$ {formatBRL(Number(l.valor_liquido ?? 0))}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={l.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-center items-center gap-1.5">
                          <button onClick={() => abrirDetalhe(l)} title="Ver títulos do repasse"
                            className="action-btn-neutral"><Eye size={12} /></button>
                          {podeConciliar && l.status === 'Conciliado' && (
                            <button onClick={() => cancelar(l)} disabled={cancelando === l.id}
                              title="Desfazer este repasse"
                              className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-400 hover:bg-red-400/10 flex items-center gap-1 disabled:opacity-50">
                              {cancelando === l.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                              Cancelar
                            </button>
                          )}
                          <MenuMais>
                            {fechar => (
                              <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="conciliacoes_maquininha" entidadeId={l.id}
                                titulo={`${l.forma_pagamento} · ${l.data_repasse}`}
                                criadoEm={l.created_at} atualizadoEm={l.updated_at} />
                            )}
                          </MenuMais>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detalhe do lote */}
      <AnimatePresence>
        {detalhe && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
            onClick={() => setDetalhe(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              className="neu-flat rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4 border border-white/5"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-200">Repasse — {detalhe.forma_pagamento}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {detalhe.data_repasse} • taxa de {formatBRL(Number(detalhe.taxa_percentual ?? 0))}%
                    {detalhe.observacoes ? ` • ${detalhe.observacoes}` : ''}
                  </p>
                </div>
                <button onClick={() => setDetalhe(null)}
                  className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>

              <div className="flex flex-col gap-1 text-xs neu-pressed rounded-xl p-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Receita (bruto dos títulos)</span>
                  <span className="font-mono text-gray-300 tabular-nums">R$ {formatBRL(Number(detalhe.valor_bruto ?? 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Taxa da adquirente <span className="text-gray-600">(despesa)</span></span>
                  <span className="font-mono text-red-400 tabular-nums">- R$ {formatBRL(Number(detalhe.valor_taxa ?? 0))}</span>
                </div>
                <div className="flex justify-between border-t border-white/5 pt-1 mt-1">
                  <span className="text-gray-400 font-bold flex items-center gap-1.5"><Landmark size={11} /> Depositado</span>
                  <span className="font-mono text-accent font-bold tabular-nums">R$ {formatBRL(Number(detalhe.valor_liquido ?? 0))}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Títulos do lote</span>
                {itens === null ? <LoadingSpinner /> : itens.length === 0 ? (
                  <p className="text-xs text-gray-600 py-2">Sem títulos.</p>
                ) : (
                  <div className="neu-pressed rounded-xl overflow-x-auto">
                    <table className="tabela w-full text-xs">
                      <tbody>
                        {itens.map((it: any) => (
                          <tr key={it.id} className="border-b border-white/5 last:border-b-0">
                            <td className="py-2 px-3 text-gray-200">{it.descricao ?? '—'}</td>
                            <td className="py-2 px-3 font-mono text-gray-300 text-right tabular-nums">
                              R$ {formatBRL(Number(it.valor_bruto ?? 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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

export const ConciliacaoMaquininhaView = ({
  showToast, profile,
}: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  // Em modo Matriz (consolidado) não há de que unidade conciliar: o repasse
  // cai na conta de uma filial, e a taxa é despesa dela.
  if (!filialAtiva) return null;
  return <ConciliacaoMaquininhaViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};

export default ConciliacaoMaquininhaView;
