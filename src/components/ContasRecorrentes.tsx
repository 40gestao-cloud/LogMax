import React, { useState } from 'react';
import { Repeat, Plus, Save, Pencil, Power, Loader2, Receipt, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { FormField, ModalFormulario, NeuButtonAccent } from './ui';
import { SelectBusca } from './SelectBusca';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { ATALHOS_CONSUMO, centroPorNome, gruposFornecedorPorTipo } from '../lib/contasConsumo';
import { todayBR } from '../lib/dates';

// Contas recorrentes (migr. 679) — o "contrato" de luz, água, internet,
// aluguel. Padrão de mercado: valor FIXO gera a conta pronta; VARIÁVEL gera a
// PREVISÃO do mês (média das últimas 3 faturas) e só paga depois de informada
// a fatura. O gerador roda ao abrir o Contas a Pagar e ao salvar aqui.

const mesAtual = () => todayBR().slice(0, 7);
const VAZIO = {
  descricao: '', fornecedor_id: '', centro_custo_id: '', tipo_valor: 'variavel' as 'fixo' | 'variavel',
  valor: '', dia_vencimento: '10', inicio: mesAtual(), fim: '',
};

type ResultadoGeracao = { geradas: number; avisos: string[]; erro?: string };
export const gerarRecorrentes = async (filial: string): Promise<ResultadoGeracao | null> => {
  if (!supabase || !filial) return null;
  const { data, error } = await supabase.rpc('gerar_contas_recorrentes', { p_filial: filial });
  if (error) return { geradas: 0, avisos: [], erro: error.message };
  return data as ResultadoGeracao;
};

export function PainelContasRecorrentes({ aberto, onFechar, filial, fornecedores, centros, showToast, onGerou }: {
  aberto: boolean; onFechar: () => void; filial: string;
  fornecedores: any[]; centros: any[]; showToast: any; onGerou: () => void;
}) {
  const { data: contratos, reload } = useFetchData<any>('/api/despesasrecorrentesview', { filial }, false,
    { orderBy: 'descricao', ascending: true });
  const [form, setForm] = useState(VAZIO);
  const [editId, setEditId] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const nomeForn = (id?: string) => fornecedores.find((f: any) => f.id === id)?.nome;
  const nomeCentro = (id?: string) => centros.find((c: any) => c.id === id)?.nome;

  const novo = () => { setForm(VAZIO); setEditId(null); setEditando(true); };
  const editar = (c: any) => {
    setForm({
      descricao: c.descricao ?? '', fornecedor_id: c.fornecedor_id ?? '', centro_custo_id: c.centro_custo_id ?? '',
      tipo_valor: c.tipo_valor ?? 'fixo', valor: formatBRL(Number(c.valor ?? 0)),
      dia_vencimento: String(c.dia_vencimento ?? 10), inicio: String(c.inicio ?? '').slice(0, 7), fim: c.fim ? String(c.fim).slice(0, 7) : '',
    });
    setEditId(c.id); setEditando(true);
  };
  const atalho = (a: typeof ATALHOS_CONSUMO[number]) => setForm(f => ({
    ...f, descricao: f.descricao || a.descricao, tipo_valor: a.variavel ? 'variavel' : 'fixo',
    centro_custo_id: centroPorNome(centros, a.centro) || f.centro_custo_id,
  }));

  const salvar = async () => {
    const valor = parseBRL(form.valor);
    const dia = parseInt(form.dia_vencimento, 10);
    if (!form.descricao.trim()) { showToast('Informe a descrição.', 'error', true); return; }
    if (!(valor > 0)) { showToast(form.tipo_valor === 'variavel' ? 'Informe a estimativa mensal.' : 'Informe o valor mensal.', 'error', true); return; }
    if (!(dia >= 1 && dia <= 31)) { showToast('Dia de vencimento: de 1 a 31.', 'error', true); return; }
    if (!form.inicio) { showToast('Informe o mês de início.', 'error', true); return; }
    if (form.fim && form.fim < form.inicio) { showToast('O fim não pode ser antes do início.', 'error', true); return; }
    setSalvando(true);
    const payload = {
      filial, descricao: form.descricao.trim(), fornecedor_id: form.fornecedor_id || null,
      centro_custo_id: form.centro_custo_id || null, tipo_valor: form.tipo_valor, valor,
      dia_vencimento: dia, inicio: `${form.inicio}-01`, fim: form.fim ? `${form.fim}-01` : null,
    };
    try {
      if (editId) await dbUpdate('/api/despesasrecorrentesview', editId, payload);
      else await dbInsert('/api/despesasrecorrentesview', payload);
      const r = await gerarRecorrentes(filial);
      if (r?.erro) showToast(`Contrato salvo, mas a geração falhou: ${r.erro}`, 'error', true);
      else if (r) {
        showToast(r.geradas > 0 ? `Contrato salvo — ${r.geradas} conta(s) gerada(s) em Contas a Pagar.` : 'Contrato salvo.', 'success', true);
        r.avisos?.forEach(a => showToast(a, 'error', true));
      }
      setEditando(false); setEditId(null); reload(); onGerou();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSalvando(false);
    }
  };

  const alternarAtivo = async (c: any) => {
    try {
      await dbUpdate('/api/despesasrecorrentesview', c.id, { ativo: !c.ativo });
      showToast(c.ativo ? 'Recorrência encerrada — as contas já geradas continuam.' : 'Recorrência reativada.', 'success', true);
      reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao atualizar.', 'error', true);
    }
  };

  return (
    <ModalFormulario aberto={aberto} largura="xl" titulo="Contas recorrentes"
      subtitulo={`Energia, água, internet, aluguel — ${filial}`}
      onCancelar={() => { setEditando(false); onFechar(); }}
      acoes={editando
        ? <NeuButtonAccent onClick={salvar} isLoading={salvando}><Save size={14} /> {editId ? 'Atualizar' : 'Salvar contrato'}</NeuButtonAccent>
        : <NeuButtonAccent onClick={novo}><Plus size={14} /> Nova recorrência</NeuButtonAccent>}>
      {editando ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {ATALHOS_CONSUMO.map(a => (
              <button key={a.rotulo} type="button" onClick={() => atalho(a)}
                className="neu-button py-1.5 px-3 rounded-lg text-[11px] text-gray-400 hover:text-accent">{a.rotulo}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormField label="Descrição *">
              <input className="neu-input py-2 px-3 rounded-xl text-sm" value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder="Ex: Energia elétrica" />
            </FormField>
            <FormField label="Fornecedor">
              <SelectBusca value={form.fornecedor_id} onChange={v => setForm(f => ({ ...f, fornecedor_id: v }))}
                placeholder="Nenhum" permitirVazio="Nenhum" grupos={gruposFornecedorPorTipo(fornecedores)} />
            </FormField>
            <FormField label="Centro de custo">
              <select className="neu-input py-2 px-3 rounded-xl text-sm" value={form.centro_custo_id}
                onChange={e => setForm(f => ({ ...f, centro_custo_id: e.target.value }))}>
                <option value="">Não classificado</option>
                {centros.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </FormField>
            <FormField label="Valor">
              <div className="flex gap-1 p-1 neu-pressed rounded-xl">
                {(['variavel', 'fixo'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, tipo_valor: t }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${form.tipo_valor === t ? 'bg-accent/20 text-accent' : 'text-gray-500'}`}>
                    {t === 'variavel' ? 'Variável (fatura)' : 'Fixo'}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label={form.tipo_valor === 'variavel' ? 'Estimativa mensal (R$) *' : 'Valor mensal (R$) *'}>
              <input className="neu-input py-2 px-3 rounded-xl text-sm text-right tabular-nums" inputMode="numeric"
                value={form.valor} onChange={e => setForm(f => ({ ...f, valor: formatBRL(e.target.value) }))}
                onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
            </FormField>
            <FormField label="Dia do vencimento *">
              <input className="neu-input py-2 px-3 rounded-xl text-sm" inputMode="numeric" value={form.dia_vencimento}
                onChange={e => setForm(f => ({ ...f, dia_vencimento: e.target.value.replace(/\D/g, '').slice(0, 2) }))} placeholder="10" />
            </FormField>
            <FormField label="A partir de *">
              <input type="month" className="neu-input py-2 px-3 rounded-xl text-sm" value={form.inicio}
                onChange={e => setForm(f => ({ ...f, inicio: e.target.value }))} />
            </FormField>
            <FormField label="Até (opcional)">
              <input type="month" className="neu-input py-2 px-3 rounded-xl text-sm" value={form.fim}
                onChange={e => setForm(f => ({ ...f, fim: e.target.value }))} />
            </FormField>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            {form.tipo_valor === 'variavel'
              ? 'Variável: a cada mês nasce uma PREVISÃO (média das últimas 3 faturas; no começo, a estimativa acima). Quando a fatura chegar, use "Informar fatura" na conta — só então ela pode ser paga.'
              : 'Fixo: a cada mês nasce a conta pronta para pagar, com este valor.'}
            {' '}As contas são geradas até o mês seguinte ao atual. Vencimento em dia que o mês não tem (31 em setembro) cai no último dia.
          </p>
          <button type="button" onClick={() => setEditando(false)} className="self-start text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
            <X size={12} /> Voltar à lista
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(contratos ?? []).length === 0 && (
            <p className="text-sm text-gray-500 py-4">Nenhuma conta recorrente ainda. Cadastre luz, água, internet e aluguel para que as contas do mês apareçam sozinhas.</p>
          )}
          {(contratos ?? []).map((c: any) => (
            <div key={c.id} className={`neu-pressed rounded-xl p-3 flex items-center gap-3 flex-wrap sm:flex-nowrap ${c.ativo ? '' : 'opacity-50'}`}>
              <Repeat size={14} className="text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-200 font-semibold truncate">{c.descricao}</div>
                <div className="text-[11px] text-gray-500 truncate">
                  {[nomeForn(c.fornecedor_id), nomeCentro(c.centro_custo_id) ?? 'Não classificado', `todo dia ${c.dia_vencimento}`,
                    c.ultima_competencia ? `gerada até ${c.ultima_competencia.split('-').reverse().join('/')}` : null,
                    c.ativo ? null : 'encerrada'].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-black text-gray-100 tabular-nums">R$ {formatBRL(Number(c.valor))}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{c.tipo_valor === 'variavel' ? 'estimativa · variável' : 'fixo'}</div>
              </div>
              <button type="button" onClick={() => editar(c)} title="Editar" className="action-btn-edit"><Pencil size={12} /></button>
              <button type="button" onClick={() => alternarAtivo(c)} title={c.ativo ? 'Encerrar recorrência' : 'Reativar'}
                className="action-btn-neutral"><Power size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </ModalFormulario>
  );
}

// "Informar fatura": troca a previsão pelo valor que veio na conta. O banco
// guarda a previsão em `valor_previsto` e libera o pagamento.
export function ModalInformarFatura({ conta, onClose, onSalvo, showToast }: {
  conta: any; onClose: () => void; onSalvo: (valor: number) => void; showToast: any;
}) {
  const [valor, setValor] = useState(formatBRL(Number(conta.valor ?? 0)));
  const [salvando, setSalvando] = useState(false);
  const v = parseBRL(valor);
  const prev = Number(conta.valor_previsto ?? conta.valor ?? 0);
  const dif = prev > 0 ? (v - prev) / prev : 0;

  const salvar = async () => {
    if (!(v > 0)) return;
    setSalvando(true);
    try {
      await dbUpdate('/api/contaspagarview', conta.id, { valor: v, valor_estimado: false });
      showToast('Fatura informada — a conta já pode ser paga.', 'success', true);
      onSalvo(v);
      onClose();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao informar a fatura.', 'error', true);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
        className="neu-flat rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 border border-white/10">
        <div className="flex items-center gap-3">
          <Receipt size={20} className="text-accent" />
          <div className="min-w-0">
            <h3 className="text-base font-black text-gray-100">Informar fatura</h3>
            <p className="text-xs text-gray-500 truncate">{conta.descricao}</p>
          </div>
        </div>
        <div className="flex items-baseline justify-between text-xs text-gray-500">
          <span>Previsão do mês</span><span className="tabular-nums">R$ {formatBRL(prev)}</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Valor da fatura *</span>
          <input autoFocus className="neu-input py-2 px-3 rounded-xl text-base font-black text-right tabular-nums" inputMode="numeric"
            value={valor} onChange={e => setValor(formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} />
        </label>
        {v > 0 && Math.abs(dif) >= 0.2 && (
          <p className="text-[11px] text-amber-300">
            {dif > 0 ? `${Math.round(dif * 100)}% acima` : `${Math.round(-dif * 100)}% abaixo`} da previsão — confira a leitura antes de confirmar.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="neu-button py-2 px-4 rounded-xl text-xs text-gray-400">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !(v > 0)} className="btn-solido btn-solido--dourado">
            {salvando ? <Loader2 size={13} className="animate-spin" /> : <Receipt size={13} />} Confirmar fatura
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
