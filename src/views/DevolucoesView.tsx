import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, RotateCcw, Save, X, AlertTriangle, Loader2 } from 'lucide-react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { formatBRL } from '../lib/viewUtils';
import type { UserProfile } from '../hooks/useUserProfile';

// Devolução parcial de venda PDV (1 passo, autorizada por gerente+).
// Motor no DB: RPC criar_devolucao_venda (migração 203) — valida saldo,
// devolve estoque e trata estorno financeiro (cancela contas_receber
// pendentes OU cria contas_pagar de saída de caixa).

type SaldoItem = {
  item_venda_id: string;
  produto_id: string | null;
  nome_produto: string;
  qtd_vendida: number;
  qtd_devolvida: number;
  qtd_saldo: number;
  preco_unitario: number;
};

type FormaEstorno = 'cancela_pendencias' | 'devolve_caixa';

const DevolucoesViewInner = ({ showToast, profile, filial }: { showToast: any; profile: UserProfile; filial: FilialOp }) => {
  // Gate RBAC — colaborador não devolve. Régua canônica: admin/CEO ou gerente.
  const podeDevolver = profile.role === 'admin' || profile.role === 'ceo' || profile.role === 'gerente';

  // Busca de venda (últimos 6 chars do UUID, como aparece em Histórico).
  const [vendaBusca, setVendaBusca] = useState('');
  const [venda, setVenda] = useState<any | null>(null);
  const [saldos, setSaldos] = useState<SaldoItem[]>([]);
  const [carregandoVenda, setCarregandoVenda] = useState(false);
  const [qtdEditada, setQtdEditada] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [formaEstorno, setFormaEstorno] = useState<FormaEstorno>('cancela_pendencias');
  const [executando, setExecutando] = useState(false);

  // Histórico (últimas devoluções da filial)
  const [historico, setHistorico] = useState<any[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  const carregarHistorico = useCallback(async () => {
    if (!supabase) return;
    setCarregandoHistorico(true);
    const { data: rows } = await supabase
      .from('devolucoes')
      .select('id, venda_id, motivo, tipo, valor_devolvido, forma_estorno, status, created_at, updated_at')
      .eq('filial', filial)
      .eq('ativo', true)
      .order('created_at', { ascending: false })
      .limit(30);
    setHistorico(rows ?? []);
    setCarregandoHistorico(false);
  }, [filial]);
  useEffect(() => { carregarHistorico(); }, [carregarHistorico]);

  const limparBusca = () => {
    setVenda(null);
    setSaldos([]);
    setQtdEditada({});
    setMotivo('');
    setFormaEstorno('cancela_pendencias');
  };

  const buscarVenda = async () => {
    if (!supabase) return;
    const termo = vendaBusca.trim();
    if (termo.length < 6) {
      showToast('Digite os últimos 6 caracteres do ID da venda.', 'error', true);
      return;
    }
    limparBusca();
    setCarregandoVenda(true);
    try {
      // Match por sufixo UUID; filial na policy protege cross-filial.
      const { data: rows, error } = await supabase
        .from('vendas')
        .select('id, cliente_id, total, desconto, total_final, forma_pagamento, status, created_at, filial')
        .eq('ativo', true)
        .eq('filial', filial)
        .ilike('id', `%${termo.toLowerCase()}`)
        .limit(2);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) {
        showToast('Venda não encontrada nesta filial.', 'error', true);
        return;
      }
      if (rows.length > 1) {
        showToast('Múltiplas vendas com esse sufixo — use ID mais específico.', 'error', true);
        return;
      }
      const v = rows[0];
      // Saldo devolvível por item
      const { data: saldoRows, error: sErr } = await supabase
        .from('v_venda_saldo_devolucao')
        .select('item_venda_id, produto_id, nome_produto, qtd_vendida, qtd_devolvida, qtd_saldo, preco_unitario')
        .eq('venda_id', v.id);
      if (sErr) throw new Error(sErr.message);
      const itens: SaldoItem[] = (saldoRows ?? []).map((r: any) => ({
        item_venda_id: r.item_venda_id,
        produto_id: r.produto_id,
        nome_produto: r.nome_produto,
        qtd_vendida: Number(r.qtd_vendida ?? 0),
        qtd_devolvida: Number(r.qtd_devolvida ?? 0),
        qtd_saldo: Number(r.qtd_saldo ?? 0),
        preco_unitario: Number(r.preco_unitario ?? 0),
      }));
      setVenda(v);
      setSaldos(itens);
      // Pré-preenche 0 em cada linha (operador digita o que devolver)
      const inicial: Record<string, string> = {};
      itens.forEach(it => { inicial[it.item_venda_id] = '0'; });
      setQtdEditada(inicial);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setCarregandoVenda(false);
    }
  };

  const totalPreview = useMemo(() => {
    return saldos.reduce((acc, it) => {
      const q = Number(qtdEditada[it.item_venda_id] ?? '0') || 0;
      return acc + q * it.preco_unitario;
    }, 0);
  }, [saldos, qtdEditada]);

  const executar = async () => {
    if (!supabase || !venda) return;
    if (!motivo.trim()) { showToast('Informe o motivo da devolução.', 'error', true); return; }
    // Monta itens > 0 respeitando saldo
    const itensPayload = saldos.flatMap((it) => {
      const q = Number(qtdEditada[it.item_venda_id] ?? '0') || 0;
      if (q <= 0) return [];
      if (q > it.qtd_saldo) throw new Error(`"${it.nome_produto}" excede o saldo (${it.qtd_saldo}).`);
      return [{
        produto_id: it.produto_id,
        nome_produto: it.nome_produto,
        qtd: q,
        preco_unitario: it.preco_unitario,
      }];
    });
    if (itensPayload.length === 0) {
      showToast('Marque ao menos 1 item para devolução.', 'error', true);
      return;
    }
    setExecutando(true);
    try {
      const { data: devId, error } = await supabase.rpc('criar_devolucao_venda', {
        p_venda_id:      venda.id,
        p_itens:         itensPayload,
        p_motivo:        motivo.trim(),
        p_forma_estorno: formaEstorno,
        p_filial:        filial,
      });
      if (error) throw new Error(error.message);
      showToast(`Devolução #${String(devId ?? '').slice(-6).toUpperCase()} registrada.`, 'success', true);
      limparBusca();
      setVendaBusca('');
      carregarHistorico();
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setExecutando(false);
    }
  };

  if (!podeDevolver) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-center">
        <AlertTriangle size={40} className="text-yellow-400/70" />
        <h2 className="text-lg font-bold text-gray-200">Sem permissão</h2>
        <p className="text-sm text-gray-500 max-w-md">
          Devoluções são autorizadas apenas por gerente da filial, admin ou CEO.
        </p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Devoluções — {filial}</h2>
      </div>

      {/* Busca de venda */}
      <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
        <label htmlFor="dev-busca" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
          Localizar venda por ID (6 últimos dígitos)
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              id="dev-busca"
              type="text"
              placeholder="Ex.: A3F71C"
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full font-mono uppercase"
              value={vendaBusca}
              onChange={e => setVendaBusca(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscarVenda(); }}
            />
          </div>
          <NeuButtonAccent onClick={buscarVenda} isLoading={carregandoVenda}>Buscar</NeuButtonAccent>
          {venda && (
            <button onClick={() => { limparBusca(); setVendaBusca(''); }} className="neu-button px-3 rounded-xl text-sm text-gray-400">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Formulário de devolução */}
      {venda && (
        <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-5">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-400">
            <span>Venda: <span className="font-mono text-gray-200">#{String(venda.id).slice(-6).toUpperCase()}</span></span>
            <span>Forma pagamento: <span className="text-gray-200">{venda.forma_pagamento}</span></span>
            <span>Total: <span className="font-mono text-gray-200">R$ {formatBRL(Number(venda.total_final ?? 0))}</span></span>
            <span>Data: <span className="text-gray-200">{String(venda.created_at ?? '').slice(0, 10)}</span></span>
          </div>

          {saldos.length === 0 ? (
            <EmptyState message="Sem itens nesta venda" />
          ) : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-3 font-bold px-3">Produto</th>
                    <th className="pb-3 font-bold px-3 text-right">Vendido</th>
                    <th className="pb-3 font-bold px-3 text-right">Já devolvido</th>
                    <th className="pb-3 font-bold px-3 text-right">Devolvível</th>
                    <th className="pb-3 font-bold px-3 text-right">Devolver</th>
                    <th className="pb-3 font-bold px-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {saldos.map(it => {
                    const q = Number(qtdEditada[it.item_venda_id] ?? '0') || 0;
                    const excede = q > it.qtd_saldo;
                    const esgotado = it.qtd_saldo <= 0;
                    return (
                      <tr key={it.item_venda_id} className={`border-b border-white/5 ${esgotado ? 'opacity-40' : ''}`}>
                        <td className="py-2.5 px-3 text-xs text-gray-200">{it.nome_produto}</td>
                        <td className="py-2.5 px-3 text-xs font-mono text-gray-300 text-right tabular-nums">{it.qtd_vendida}</td>
                        <td className="py-2.5 px-3 text-xs font-mono text-gray-500 text-right tabular-nums">{it.qtd_devolvida}</td>
                        <td className="py-2.5 px-3 text-xs font-mono text-amber-300 text-right tabular-nums font-bold">{it.qtd_saldo}</td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number" min="0" step="0.001"
                            disabled={esgotado}
                            className={`neu-input py-1.5 px-2 rounded-lg text-xs font-mono w-24 text-right ${excede ? 'border border-red-500/40' : ''}`}
                            value={qtdEditada[it.item_venda_id] ?? '0'}
                            onChange={e => setQtdEditada(prev => ({ ...prev, [it.item_venda_id]: e.target.value }))}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-xs font-mono text-gray-300 text-right tabular-nums">
                          R$ {formatBRL(q * it.preco_unitario)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="pt-3 px-3 text-right text-xs font-bold text-gray-500 uppercase tracking-widest">Total a devolver</td>
                    <td className="pt-3 px-3 text-right text-sm font-mono font-bold text-accent tabular-nums">R$ {formatBRL(totalPreview)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Motivo *">
              <textarea rows={2}
                className="neu-input py-2 px-3 rounded-xl text-sm resize-none"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ex.: produto com defeito, cliente desistiu, cor errada..."
              />
            </FormField>
            <FormField label="Forma de estorno">
              <select
                className="neu-input py-2 px-3 rounded-xl text-sm"
                value={formaEstorno}
                onChange={e => setFormaEstorno(e.target.value as FormaEstorno)}
              >
                <option value="cancela_pendencias">Cancelar pendências (fiado, cartão a prazo)</option>
                <option value="devolve_caixa">Devolver no caixa (dinheiro / à vista)</option>
              </select>
              <p className="text-[10px] text-gray-500 mt-1">
                {formaEstorno === 'cancela_pendencias'
                  ? 'Reduz/cancela contas a receber abertas desta venda. Se sobrar valor, gera saída em contas a pagar.'
                  : 'Registra a saída em contas a pagar (já paga). Use quando entregar o valor no ato ao cliente.'}
              </p>
            </FormField>
          </div>

          <div className="flex gap-3 justify-end">
            <button onClick={() => { limparBusca(); setVendaBusca(''); }} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">
              Cancelar
            </button>
            <NeuButtonAccent onClick={executar} isLoading={executando}>
              <Save size={14} /> Autorizar devolução
            </NeuButtonAccent>
          </div>
        </div>
      )}

      {/* Histórico */}
      <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2"><RotateCcw size={14} /> Últimas devoluções</h3>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">{historico.length} registro(s)</span>
        </div>
        {carregandoHistorico ? <LoadingSpinner /> : historico.length === 0 ? <EmptyState message="Nenhuma devolução registrada." /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-2 font-bold px-3">Data</th>
                  <th className="pb-2 font-bold px-3">Venda</th>
                  <th className="pb-2 font-bold px-3 text-right">Valor</th>
                  <th className="pb-2 font-bold px-3 text-center">Tipo</th>
                  <th className="pb-2 font-bold px-3">Estorno</th>
                  <th className="pb-2 font-bold px-3">Motivo</th>
                  <th className="pb-2 font-bold px-3 text-center">Status</th>
                  <th className="pb-2 font-bold px-3 text-right">Histórico</th>
                </tr>
              </thead>
              <tbody>
                {historico.map(d => (
                  <tr key={d.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-3 text-xs font-mono text-gray-400">{String(d.created_at ?? '').slice(0, 10)}</td>
                    <td className="py-2 px-3 text-xs font-mono text-gray-300">#{String(d.venda_id ?? '').slice(-6).toUpperCase()}</td>
                    <td className="py-2 px-3 text-xs font-mono text-gray-200 text-right">R$ {formatBRL(Number(d.valor_devolvido ?? 0))}</td>
                    <td className="py-2 px-3 text-xs text-gray-400 text-center">{d.tipo}</td>
                    <td className="py-2 px-3 text-[11px] text-gray-500">
                      {d.forma_estorno === 'cancela_pendencias' ? 'Cancela pendências' : 'Saída de caixa'}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400 max-w-xs">
                      <span className="line-clamp-1" title={d.motivo}>{d.motivo}</span>
                    </td>
                    <td className="py-2 px-3 text-center"><StatusBadge status={d.status} /></td>
                    <td className="py-2 px-3 text-right">
                      <HistoricoOperacoes entidade="devolucoes" entidadeId={d.id}
                        titulo={`Devolução ${String(d.id).slice(-6).toUpperCase()}`}
                        criadoEm={d.created_at} atualizadoEm={d.updated_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const DevolucoesView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <DevolucoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
