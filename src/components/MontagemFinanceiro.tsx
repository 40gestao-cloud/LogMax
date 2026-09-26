// Os dois gestos que ligam a montagem da filial ao Financeiro (migr. 634):
//  - lançar um item de investimento em Contas a Pagar, à vista ou parcelado;
//  - vender um bem de patrimônio, gerando Contas a Receber, à vista ou parcelado.
// A condição de pagamento e a prévia das parcelas são as mesmas nos dois.

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Wallet, HandCoins, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { todayBR, dataSimplesBR } from '../lib/dates';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { planoDeParcelas } from '../lib/parcelamento';

const brl = (v: number) => `R$ ${formatBRL(v)}`;
const rotulo = 'text-[10px] uppercase tracking-widest font-bold text-gray-500';
const campo = 'neu-input py-2 px-3 rounded-xl text-sm w-full';

type Condicao = { parcelado: boolean; parcelas: number; primeiro: string; intervalo: number };

function CondicaoPagamento({ total, cond, setCond, repete }: {
  total: number; cond: Condicao; setCond: (c: Condicao) => void;
  // Aluguel: cada parcela é o valor inteiro, mês a mês.
  repete?: boolean;
}) {
  const plano = useMemo(
    () => planoDeParcelas(total, cond.parcelado ? cond.parcelas : 1, cond.primeiro,
      { intervaloDias: cond.intervalo, repete }),
    [total, cond, repete]);
  const soma = plano.reduce((s, p) => s + p.valor, 0);

  return (
    <div className="flex flex-col gap-3">
      {!repete && (
        <div className="grid grid-cols-2 gap-1 neu-pressed rounded-xl p-1">
          {[false, true].map(p => (
            <button key={String(p)} type="button" onClick={() => setCond({ ...cond, parcelado: p, parcelas: p ? Math.max(2, cond.parcelas) : 1 })}
              className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                cond.parcelado === p ? 'btn-solido--dourado' : 'text-gray-500 hover:text-gray-200'}`}>
              {p ? 'Parcelado' : 'À vista'}
            </button>
          ))}
        </div>
      )}
      <div className={`grid gap-3 ${cond.parcelado || repete ? 'grid-cols-3' : 'grid-cols-1'}`}>
        {(cond.parcelado || repete) && (
          <label className="flex flex-col gap-1">
            <span className={rotulo}>{repete ? 'Meses' : 'Parcelas'}</span>
            <input type="number" min={repete ? 1 : 2} max={60} className={campo} value={cond.parcelas}
              onChange={e => setCond({ ...cond, parcelas: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={rotulo}>{cond.parcelado || repete ? '1º vencimento' : 'Vencimento'}</span>
          <input type="date" className={campo} value={cond.primeiro} onChange={e => setCond({ ...cond, primeiro: e.target.value })} />
        </label>
        {cond.parcelado && !repete && (
          <label className="flex flex-col gap-1">
            <span className={rotulo}>A cada</span>
            <select className={campo} value={cond.intervalo} onChange={e => setCond({ ...cond, intervalo: Number(e.target.value) })}>
              <option value={30}>30 dias</option>
              <option value={15}>15 dias</option>
              <option value={7}>7 dias</option>
            </select>
          </label>
        )}
      </div>

      {plano.length > 0 && (
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <div className="max-h-44 overflow-y-auto main-scrollbar divide-y divide-white/5">
            {plano.map(p => (
              <div key={p.numero} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-gray-500 tabular-nums">{plano.length > 1 ? `${p.numero}/${plano.length}` : 'Única'}</span>
                <span className="text-gray-400 tabular-nums">{dataSimplesBR(p.vencimento)}</span>
                <span className="font-bold text-gray-100 tabular-nums">{brl(p.valor)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-white/[0.03] text-xs">
            <span className="text-gray-500">Total</span>
            <span className="font-black text-accent tabular-nums">{brl(soma)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Moldura({ titulo, subtitulo, icone, onClose, children }: {
  titulo: string; subtitulo?: string; icone: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}>
      <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-3xl border border-white/10 w-full max-w-md my-6 flex flex-col overflow-hidden"
        style={{ background: 'var(--color-bg-base)' }}
        onClick={e => e.stopPropagation()}>
        <div className="p-5 flex items-center gap-3 border-b border-white/5">
          <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center btn-solido--dourado">{icone}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black text-gray-100 leading-tight">{titulo}</h3>
            {subtitulo && <p className="text-xs text-gray-500 truncate">{subtitulo}</p>}
          </div>
          <button onClick={onClose} className="modal-close-btn shrink-0" aria-label="Fechar"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ── Lançar um item de investimento em Contas a Pagar ────────────────────
export function ModalLancarInvestimento({ item, onClose, onLancado, showToast }: {
  item: { id: string; rotulo: string; categoria: string; quantidade: number; valor_total: number };
  onClose: () => void; onLancado: () => void; showToast: any;
}) {
  const aluguel = item.categoria === 'aluguel';
  const [cond, setCond] = useState<Condicao>({ parcelado: aluguel, parcelas: aluguel ? 12 : 1, primeiro: todayBR(), intervalo: 30 });
  const [natureza, setNatureza] = useState('despesa');
  const [salvando, setSalvando] = useState(false);
  const total = Number(item.valor_total ?? 0);

  const lancar = async () => {
    if (!supabase || !cond.primeiro) return;
    setSalvando(true);
    const { error } = await supabase.rpc('lancar_investimento_filial', {
      p_item_id: item.id,
      p_primeiro_vencimento: cond.primeiro,
      p_parcelas: aluguel || cond.parcelado ? cond.parcelas : 1,
      p_intervalo_dias: cond.intervalo,
      p_natureza_outro: natureza,
    });
    setSalvando(false);
    if (error) { showToast(error.message, 'error', true); return; }
    showToast(`${item.rotulo} lançado em Contas a Pagar.`, 'success', true);
    onLancado();
    onClose();
  };

  return (
    <Moldura titulo="Lançar no Financeiro" icone={<Wallet size={20} />} onClose={onClose}
      subtitulo={`${item.rotulo}${aluguel ? ' · valor mensal' : ` · ${item.quantidade} un.`}`}>
      <div className="flex items-baseline justify-between">
        <span className={rotulo}>{aluguel ? 'Aluguel por mês' : 'Valor do item'}</span>
        <span className="text-2xl font-black text-gray-100 tabular-nums">{brl(total)}</span>
      </div>
      {item.categoria === 'outro' && (
        <label className="flex flex-col gap-1">
          <span className={rotulo}>O que é</span>
          <select className={campo} value={natureza} onChange={e => setNatureza(e.target.value)}>
            <option value="despesa">Despesa</option>
            <option value="imobilizado">Bem (imobilizado)</option>
            <option value="estoque">Estoque</option>
          </select>
        </label>
      )}
      <CondicaoPagamento total={total} cond={cond} setCond={setCond} repete={aluguel} />
      {item.categoria === 'equipamento' && (
        <p className="text-[11px] text-gray-500">Vira bem em Patrimônio pelo valor total.</p>
      )}
      <div className="flex justify-end">
        <button onClick={lancar} disabled={salvando || !cond.primeiro || total <= 0} className="btn-solido btn-solido--dourado">
          {salvando ? <Loader2 size={13} className="animate-spin" /> : <Wallet size={13} />} Lançar em Contas a Pagar
        </button>
      </div>
    </Moldura>
  );
}

// ── Vender um bem: baixa + Contas a Receber ─────────────────────────────
export function ModalVenderBem({ bem, onClose, onVendido, showToast }: {
  bem: { id: string; nome: string; filial?: string | null; custo?: number | null };
  onClose: () => void; onVendido: () => void; showToast: any;
}) {
  const [valor, setValor] = useState('');
  const [cond, setCond] = useState<Condicao>({ parcelado: false, parcelas: 1, primeiro: todayBR(), intervalo: 30 });
  const [clienteId, setClienteId] = useState('');
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const total = valor ? parseBRL(valor) : 0;

  useEffect(() => {
    if (!supabase) return;
    let q = supabase.from('clientes').select('id,nome').eq('ativo', true).order('nome').limit(500);
    if (bem.filial) q = q.eq('filial', bem.filial);
    q.then(({ data }) => setClientes((data ?? []) as any));
  }, [bem.filial]);

  const vender = async () => {
    if (!supabase || total <= 0 || !cond.primeiro) return;
    setSalvando(true);
    const { error } = await supabase.rpc('vender_patrimonio', {
      p_produto_id: bem.id,
      p_valor: total,
      p_primeiro_vencimento: cond.primeiro,
      p_parcelas: cond.parcelado ? cond.parcelas : 1,
      p_intervalo_dias: cond.intervalo,
      p_cliente_id: clienteId || null,
      p_motivo: null,
    });
    setSalvando(false);
    if (error) { showToast(error.message, 'error', true); return; }
    showToast(`${bem.nome} vendido — lançado em Contas a Receber.`, 'success', true);
    onVendido();
    onClose();
  };

  return (
    <Moldura titulo="Vender bem" subtitulo={bem.nome} icone={<HandCoins size={20} />} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={rotulo}>Valor da venda</span>
          <input className={`${campo} text-base font-black`} inputMode="numeric" placeholder="R$ 0,00" value={valor}
            onChange={e => setValor(formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} autoFocus />
        </label>
        <div className="flex flex-col gap-1">
          <span className={rotulo}>Custo de aquisição</span>
          <span className="py-2 text-sm font-bold text-gray-400 tabular-nums">{bem.custo != null ? brl(Number(bem.custo)) : '—'}</span>
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className={rotulo}>Comprador</span>
        <select className={campo} value={clienteId} onChange={e => setClienteId(e.target.value)}>
          <option value="">Não informado</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      {total > 0 && <CondicaoPagamento total={total} cond={cond} setCond={setCond} />}
      <p className="text-[11px] text-gray-500">O bem sai do Patrimônio; o ganho ou a perda entra no DRE do mês.</p>
      <div className="flex justify-end">
        <button onClick={vender} disabled={salvando || total <= 0 || !cond.primeiro} className="btn-solido btn-solido--roxo">
          {salvando ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={13} />} Vender e lançar em Contas a Receber
        </button>
      </div>
    </Moldura>
  );
}
