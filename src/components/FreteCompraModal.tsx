import { useEffect, useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayBR } from '../lib/dates';
import { formatBRL, handleMoneyKeyDown, parseBRL } from '../lib/viewUtils';
import { gruposDeCadastro } from '../lib/cadastrosSelect';
import { SelectBusca } from './SelectBusca';
import { FormField, ModalFormulario, NeuButtonAccent, LoadingSpinner } from './ui';

// Frete de transportadora — CT-e (migr. 657).
//
// O frete FOB não vem na nota do fornecedor: chega num documento próprio, com
// cobrança própria, e muitas vezes cobre a carga de vários pedidos. Aqui o
// Financeiro lança o CT-e, marca os pedidos que vieram naquela carga, e o
// banco rateia pelo valor de cada um e leva a parte de cada pedido ao custo
// do produto (a régua da migr. 645). A prévia do rateio abaixo faz a mesma
// conta que `lancar_frete_compra`, para ninguém confirmar às cegas.

type PedidoFrete = {
  id: string; numero: string; item_descricao: string | null; fornecedor: string | null;
  recebido_em: string | null; qtd_recebida: number; valor_base: number;
  nota_conferida: boolean; frete_ja: number;
};

const brl = (v: number) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** O mesmo rateio do banco: pelo valor, em ordem de id, o último leva o arredondamento. */
const ratear = (valor: number, pedidos: PedidoFrete[]): Record<string, number> => {
  const ordem = [...pedidos].sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = ordem.reduce((s, p) => s + Number(p.valor_base), 0);
  const out: Record<string, number> = {};
  let acum = 0;
  ordem.forEach((p, i) => {
    const parte = i < ordem.length - 1 ? Math.round((valor * Number(p.valor_base) / total) * 100) / 100 : Math.round((valor - acum) * 100) / 100;
    acum += parte;
    out[p.id] = parte;
  });
  return out;
};

export function FreteCompraModal({ aberto, filial, fornecedores, onFechar, onLancado, showToast }: {
  aberto: boolean; filial: string; fornecedores: any[];
  onFechar: () => void; onLancado: () => void; showToast: any;
}) {
  const [pedidos, setPedidos] = useState<PedidoFrete[] | null>(null);
  const [transp, setTransp] = useState('');
  const [cte, setCte] = useState('');
  const [emissao, setEmissao] = useState(todayBR());
  const [vencimento, setVencimento] = useState('');
  const [valor, setValor] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto || !supabase) return;
    setTransp(''); setCte(''); setEmissao(todayBR()); setVencimento(''); setValor(''); setMarcados(new Set());
    setPedidos(null);
    supabase.rpc('pedidos_para_frete', { p_filial: filial }).then(({ data, error }) => {
      if (error) { showToast(error.message, 'error'); setPedidos([]); return; }
      setPedidos((data ?? []) as PedidoFrete[]);
    });
  }, [aberto, filial]);

  const escolhidos = useMemo(() => (pedidos ?? []).filter(p => marcados.has(p.id)), [pedidos, marcados]);
  const v = parseBRL(valor);
  const rateio = useMemo(() => (v > 0 && escolhidos.length ? ratear(v, escolhidos) : {}), [v, escolhidos]);
  const baseTotal = escolhidos.reduce((s, p) => s + Number(p.valor_base), 0);

  const alternar = (id: string) => setMarcados(m => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const lancar = async () => {
    if (!supabase) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('lancar_frete_compra', {
      p_filial: filial, p_transportadora_id: transp || null, p_cte_numero: cte,
      p_emissao: emissao || null, p_vencimento: vencimento || null, p_valor: v,
      p_pedidos: [...marcados],
    });
    setSalvando(false);
    if (error) { showToast(error.message, 'error', true); return; }
    const n = (data as any)?.rateio?.length ?? escolhidos.length;
    showToast(`Frete de ${brl(v)} rateado em ${n} pedido${n > 1 ? 's' : ''} e levado ao custo. A conta da transportadora está em Contas a pagar.`, 'success', true);
    onLancado();
    onFechar();
  };

  const pronto = !!transp && cte.trim() !== '' && !!emissao && v > 0 && marcados.size > 0;

  return (
    <ModalFormulario
      aberto={aberto}
      titulo={<span className="flex items-center gap-2"><Truck size={16} /> Frete de transportadora (CT-e)</span>}
      subtitulo="O valor é rateado entre os pedidos da carga pelo valor de cada um e entra no custo do produto."
      onCancelar={onFechar}
      cancelarDesabilitado={salvando}
      acoes={<NeuButtonAccent onClick={lancar} isLoading={salvando} disabled={!pronto}><Truck size={14} /> Lançar frete</NeuButtonAccent>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="sm:col-span-2">
          <FormField label="Transportadora *">
            <SelectBusca value={transp} onChange={setTransp} placeholder="Escolha em Fornecedores"
              grupos={gruposDeCadastro(fornecedores)} />
          </FormField>
        </div>
        <FormField label="Nº do CT-e *">
          <input className="neu-input py-2 px-3 rounded-xl text-sm" value={cte} onChange={e => setCte(e.target.value)} placeholder="Ex.: 000123" />
        </FormField>
        <FormField label="Emissão *">
          <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm" value={emissao} max={todayBR()} onChange={e => setEmissao(e.target.value)} />
        </FormField>
        <FormField label="Valor do frete (R$) *">
          <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums text-right font-bold"
            value={valor} onChange={e => setValor(formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
        </FormField>
        <FormField label="Vencimento">
          <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm" value={vencimento} min={emissao} onChange={e => setVencimento(e.target.value)} />
          <span className="text-[10px] text-gray-500">Vazio = 30 dias da emissão.</span>
        </FormField>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Pedidos que vieram nesta carga *</p>
        {pedidos === null ? <LoadingSpinner /> : pedidos.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum pedido de mercadoria com carga conferida nos últimos 120 dias.</p>
        ) : (
          <div className="overflow-x-auto max-h-[45vh] main-scrollbar">
            <table className="tabela w-full text-left border-collapse text-xs">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th className="hidden md:table-cell">Fornecedor</th>
                  <th>Valor</th>
                  <th>Frete</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map(p => {
                  const on = marcados.has(p.id);
                  return (
                    <tr key={p.id} onClick={() => alternar(p.id)} className={`cursor-pointer ${on ? 'bg-accent/5' : ''}`}>
                      <td className="py-2">
                        <label className="flex items-start gap-2 cursor-pointer" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" className="mt-0.5 accent-amber-500" checked={on} onChange={() => alternar(p.id)} />
                          <span className="min-w-0">
                            <span className="font-mono text-gray-200">{p.numero}</span>
                            <span className="block text-[10px] text-gray-500 truncate max-w-[16rem]">
                              {p.item_descricao ?? '—'} · {Number(p.qtd_recebida).toLocaleString('pt-BR')} un
                              {p.recebido_em ? ` · chegou ${p.recebido_em.split('-').reverse().join('/')}` : ''}
                            </span>
                          </span>
                        </label>
                      </td>
                      <td className="hidden md:table-cell text-gray-400">{p.fornecedor ?? '—'}</td>
                      <td className="tabular-nums whitespace-nowrap">
                        <span className="text-gray-200">{brl(p.valor_base)}</span>
                        <span className="block text-[10px] text-gray-500">{p.nota_conferida ? 'pela nota' : 'pelo pedido'}</span>
                      </td>
                      <td className="tabular-nums whitespace-nowrap">
                        {on && rateio[p.id] != null ? <span className="text-accent font-bold">{brl(rateio[p.id])}</span> : ''}
                        {Number(p.frete_ja) > 0 && (
                          <span className="block text-[10px] text-gray-500">já tem {brl(p.frete_ja)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {escolhidos.length > 0 && (
          <p className="text-[11px] text-gray-400">
            {escolhidos.length} pedido{escolhidos.length > 1 ? 's' : ''} · carga de {brl(baseTotal)}
            {v > 0 && baseTotal > 0 && <> · frete = <strong className="text-gray-200">{((v / baseTotal) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong> do valor da carga</>}
          </p>
        )}
      </div>
    </ModalFormulario>
  );
}
