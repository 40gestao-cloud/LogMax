import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, Ban, RotateCcw } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, FilialBadge, ModalFormulario } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFilial } from '../contexts/FilialContext';
import { calcularCondicao, type FormaPagamento } from '../lib/condicaoPagamento';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';

// Empresa → Formas de Pagamento.
//
// Era um GenericCRUDView com dez campos soltos, e o aluno preenchia "parcelas
// sem juros" no Pix. Aqui o Tipo vem primeiro e decide o que se pergunta: cada
// tipo só mostra o que existe nele, e o que some grava neutro (sem desconto,
// sem taxa, 1 parcela). O cálculo não mudou — quem manda no preço continua
// sendo o gatilho da migr. 568; a prévia ao lado é o `calcularCondicao` de
// sempre, com uma venda de exemplo.
//
// "Crediário da loja?" deixou de ser pergunta: `exige_limite_credito` sai do
// Tipo. Eram duas respostas para a mesma coisa, e nada impedia que brigassem.
//
// O endpoint vai literal em cada chamada: é assim que o `npm run mapa` enxerga
// quem grava formas_pagamento.

const TIPOS = [
  'Dinheiro', 'PIX', 'Cartão de débito', 'Cartão de crédito à vista', 'Cartão de crédito parcelado',
  'Vale / voucher', 'Crediário da loja', 'Boleto', 'Transferência', 'Outro',
] as const;

// O que cada nicho NÃO oferece. Vale-alimentação/refeição só passa em quem
// vende comida — loja de roupa (MaxLook) e de eletrônico (TechMax) não
// aceitam, e o aluno não deveria nem ver a opção. A lista fechada do banco
// (migr. 657) continua a mesma; isto só enxuga o que a unidade enxerga.
const FORA_DO_NICHO: Record<string, readonly string[]> = {
  MaxLook: ['Vale / voucher'],
  TechMax: ['Vale / voucher'],
};

/** Tipos da unidade. O tipo já gravado fica na lista, para a edição não apagá-lo em silêncio. */
const tiposDaUnidade = (filial: string | null, atual: string): string[] =>
  TIPOS.filter(t => t === atual || !(FORA_DO_NICHO[filial ?? ''] ?? []).includes(t));

const TIPO_AJUDA: Record<string, string> = {
  'Dinheiro': 'Na hora, sem taxa. Pode ter desconto à vista.',
  'PIX': 'Cai na hora. Pode ter desconto e, às vezes, uma taxa do banco.',
  'Cartão de débito': 'A maquininha cobra uma taxa e repassa em poucos dias.',
  'Cartão de crédito à vista': 'Uma parcela só. A maquininha cobra taxa e repassa depois.',
  'Cartão de crédito parcelado': 'O cliente divide; a maquininha cobra taxa e repassa parcela a parcela.',
  'Vale / voucher': 'Vale-alimentação e afins: a operadora cobra taxa e repassa depois.',
  'Crediário da loja': 'A própria loja financia: exige limite de crédito do cliente e não tem maquininha.',
  'Boleto': 'Pode ser à vista ou parcelado; o banco cobra uma tarifa.',
  'Transferência': 'TED/DOC direto na conta. Pode ter desconto à vista.',
  'Outro': 'Qualquer outra forma. Todos os campos ficam abertos.',
};

type Campo = 'desconto_percentual' | 'taxa' | 'prazo' | 'parcelas_max' | 'parcelas_sem_juros' | 'juros_mensal' | 'intervalo_dias';
const TODOS: Campo[] = ['desconto_percentual', 'parcelas_max', 'parcelas_sem_juros', 'juros_mensal', 'taxa', 'prazo', 'intervalo_dias'];
const PARCELADO: Campo[] = ['parcelas_max', 'parcelas_sem_juros', 'juros_mensal', 'intervalo_dias'];

/** O que cada tipo pergunta. Tipo fora da lista (ou nenhum) pergunta tudo. */
const CAMPOS_DO_TIPO: Record<string, Campo[]> = {
  'Dinheiro': ['desconto_percentual'],
  'PIX': ['desconto_percentual', 'taxa'],
  'Transferência': ['desconto_percentual'],
  'Cartão de débito': ['taxa', 'prazo'],
  'Cartão de crédito à vista': ['taxa', 'prazo'],
  'Vale / voucher': ['taxa', 'prazo'],
  'Cartão de crédito parcelado': ['taxa', 'prazo', ...PARCELADO],
  'Crediário da loja': ['prazo', ...PARCELADO],
  'Boleto': ['desconto_percentual', 'taxa', 'prazo', ...PARCELADO],
};

/** Valor que o campo grava quando o tipo não o pergunta — igual ao normalizador do banco. */
const NEUTRO: Record<Campo, number> = {
  desconto_percentual: 0, taxa: 0, prazo: 0, parcelas_max: 1, parcelas_sem_juros: 1, juros_mensal: 0, intervalo_dias: 30,
};

/** PIX e boleto não têm maquininha: o nome da cobrança é outro, a lógica é a mesma. */
const nomeTaxa = (tipo: string) => (tipo === 'PIX' || tipo === 'Boleto' ? 'Tarifa do banco' : 'Taxa da maquininha');

// Juros e taxa são os dois percentuais que o aluno mais confunde: os dois
// "aparecem no cartão parcelado", mas um é do CLIENTE (sobe o preço) e o
// outro é da LOJA (sai do repasse, o cliente nem vê). Por isso cada um mora
// no seu bloco, com quem paga escrito no título.
const CAMPO_INFO: Record<Campo, { label: string | ((tipo: string) => string); sufixo: string; ajuda: (tipo: string) => string }> = {
  desconto_percentual: { label: 'Desconto à vista', sufixo: '%', ajuda: () => 'Abatido do preço quando o cliente paga desta forma.' },
  parcelas_max: { label: 'Parcelas (máximo)', sufixo: 'x', ajuda: () => 'Em quantas vezes o cliente pode dividir. 1 = só à vista.' },
  parcelas_sem_juros: { label: 'Sem juros até', sufixo: 'x', ajuda: () => 'Até aqui o preço não muda. Acima disso entram os juros.' },
  juros_mensal: { label: 'Juros do parcelamento', sufixo: '% a.m.', ajuda: () => 'Acrescentado às parcelas acima do "sem juros" (Tabela Price). O cliente paga a mais, e esse acréscimo entra para a loja.' },
  taxa: { label: nomeTaxa, sufixo: '%', ajuda: t => t === 'Boleto' || t === 'PIX'
    ? 'O banco desconta de cada recebimento. O cliente não vê, e o preço não muda.'
    : 'A operadora do cartão desconta do repasse. O cliente não vê, e o preço não muda. Entra no custo da Precificação.' },
  prazo: { label: 'Primeiro recebimento', sufixo: 'dias', ajuda: t => t === 'Crediário da loja' || t === 'Boleto'
    ? 'Dias até vencer a 1ª parcela.'
    : 'Dias até o dinheiro cair na conta. 0 = na hora.' },
  intervalo_dias: { label: 'Entre parcelas', sufixo: 'dias', ajuda: () => 'Dias entre um vencimento e o próximo.' },
};

// Classe inteira por tom — o Tailwind não enxerga classe montada em runtime.
const TOM = {
  cliente: 'border-l-2 border-amber-400/60 pl-4',
  loja: 'border-l-2 border-red-400/60 pl-4',
} as const;

const BLOCOS: { titulo: string | ((tipo: string) => string); sub?: string; tom?: keyof typeof TOM; campos: Campo[] }[] = [
  { titulo: 'Desconto e parcelas', campos: ['desconto_percentual', 'parcelas_max', 'parcelas_sem_juros'] },
  { titulo: 'Juros · quem paga é o cliente', sub: 'Sobe o preço da venda parcelada.', tom: 'cliente', campos: ['juros_mensal'] },
  { titulo: t => `${nomeTaxa(t)} · quem paga é a loja`, sub: 'Não mexe no preço. Sai do que a loja recebe.', tom: 'loja', campos: ['taxa'] },
  { titulo: 'Quando o dinheiro entra', campos: ['prazo', 'intervalo_dias'] },
];

// Percentual digita como dinheiro: só dígitos, vírgula automática ("199" → "1,99").
// Parcelas e dias continuam inteiros.
const PERCENTUAIS = new Set<Campo>(['desconto_percentual', 'taxa', 'juros_mensal']);

const EXEMPLO = 100;

const num = (v: unknown, d = 0) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : d; };
/** Campo vazio grava o neutro; percentual vem mascarado ("1,99"), o resto é inteiro. */
const valorDoCampo = (c: Campo, raw: string) =>
  !String(raw ?? '').trim() ? NEUTRO[c] : PERCENTUAIS.has(c) ? parseBRL(raw) : num(raw, NEUTRO[c]);
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

type Form = { descricao: string; tipo: string; status: string } & Record<Campo, string>;
const formVazio = (): Form => ({
  descricao: '', tipo: '', status: 'Ativo',
  desconto_percentual: '', taxa: '', prazo: '', parcelas_max: '', parcelas_sem_juros: '', juros_mensal: '', intervalo_dias: '',
});

/** Quais campos aparecem agora — depende do Tipo e do próprio parcelamento digitado. */
function camposVisiveis(f: Pick<Form, 'tipo' | 'parcelas_max' | 'parcelas_sem_juros'>): Set<Campo> {
  const base = new Set<Campo>(CAMPOS_DO_TIPO[f.tipo] ?? TODOS);
  const maxP = num(f.parcelas_max, 1);
  if (base.has('parcelas_max') && maxP <= 1) {
    base.delete('parcelas_sem_juros'); base.delete('juros_mensal'); base.delete('intervalo_dias');
  }
  if (base.has('juros_mensal') && maxP <= num(f.parcelas_sem_juros, 1)) base.delete('juros_mensal');
  return base;
}

/** Linha da tabela: "até 6x · 3x s/ juros · taxa 3,2% · D+30". */
function resumo(item: any): string {
  const vis = camposVisiveis({ tipo: item.tipo ?? '', parcelas_max: String(item.parcelas_max ?? 1), parcelas_sem_juros: String(item.parcelas_sem_juros ?? 1) });
  const partes: string[] = [];
  const maxP = num(item.parcelas_max, 1);
  if (num(item.desconto_percentual) > 0) partes.push(`${pct(num(item.desconto_percentual))} de desconto`);
  if (vis.has('parcelas_max')) partes.push(maxP > 1 ? `até ${maxP}x` : 'à vista');
  if (vis.has('parcelas_sem_juros') && maxP > 1) {
    const sj = num(item.parcelas_sem_juros, 1);
    partes.push(vis.has('juros_mensal') && num(item.juros_mensal) > 0
      ? `${sj}x s/ juros, depois juros de ${pct(num(item.juros_mensal))} a.m. (cliente)` : 'sem juros');
  }
  if (num(item.taxa) > 0) partes.push(`${nomeTaxa(item.tipo ?? '').toLowerCase()} ${pct(num(item.taxa))} (loja)`);
  if (vis.has('prazo')) partes.push(num(item.prazo) === 0 ? 'na hora' : `D+${num(item.prazo)}`);
  return partes.join(' · ') || '—';
}

export const FormasPagamentoView = ({ showToast, podeEditar = true }: { showToast: any; podeEditar?: boolean }) => {
  const confirm = useConfirm();
  const { filialAtiva } = useFilial();
  // Mesma régua do GenericCRUDView filialScoped: cada unidade edita as suas,
  // Matriz vê o consolidado só leitura.
  const escopo = filialAtiva ?? null;
  const canWrite = podeEditar && !!escopo;
  const { data, setData, isLoading } = useFetchData<any>('/api/formaspagamentoview', escopo ? { filial: escopo } : undefined);

  const [aberto, setAberto] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState<Form>(formVazio());
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [search, setSearch] = useState('');

  const visiveis = useMemo(() => camposVisiveis(form), [form]);

  const set = (k: keyof Form, v: string) => {
    setForm(s => ({ ...s, [k]: v }));
    setErros(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const abrirNovo = () => { setEditItem(null); setForm(formVazio()); setErros({}); setAberto(true); };
  const abrirEdicao = (item: any) => {
    setEditItem(item);
    const f = formVazio();
    f.descricao = item.descricao ?? '';
    f.tipo = item.tipo ?? '';
    f.status = item.status ?? 'Ativo';
    for (const c of TODOS) {
      const v = item[c] != null && Number(item[c]) !== NEUTRO[c] ? Number(item[c]) : null;
      f[c] = v == null ? '' : PERCENTUAIS.has(c) ? formatBRL(v) : String(v);
    }
    setForm(f); setErros({}); setAberto(true);
  };
  const fechar = () => { setAberto(false); setEditItem(null); setForm(formVazio()); setErros({}); };

  const payloadDoForm = () => {
    const out: Record<string, unknown> = {
      descricao: form.descricao.trim(),
      tipo: form.tipo,
      status: form.status || 'Ativo',
      exige_limite_credito: form.tipo === 'Crediário da loja',
    };
    for (const c of TODOS) out[c] = visiveis.has(c) ? valorDoCampo(c, form[c]) : NEUTRO[c];
    return out;
  };

  const validar = () => {
    const e: Record<string, string> = {};
    if (!form.descricao.trim()) e.descricao = 'Obrigatório';
    if (!form.tipo) e.tipo = 'Escolha o tipo';
    for (const c of ['desconto_percentual', 'taxa', 'juros_mensal'] as Campo[]) {
      if (visiveis.has(c) && valorDoCampo(c, form[c]) > 100) e[c] = 'Entre 0 e 100';
    }
    if (visiveis.has('parcelas_max') && (num(form.parcelas_max, 1) < 1 || num(form.parcelas_max, 1) > 36)) e.parcelas_max = 'Entre 1 e 36';
    if (visiveis.has('parcelas_sem_juros') && num(form.parcelas_sem_juros, 1) > num(form.parcelas_max, 1)) e.parcelas_sem_juros = 'Não passa do máximo';
    if (visiveis.has('prazo') && num(form.prazo) < 0) e.prazo = 'Não pode ser negativo';
    if (visiveis.has('intervalo_dias') && num(form.intervalo_dias, 30) < 1) e.intervalo_dias = 'Mínimo 1 dia';
    setErros(e);
    return Object.keys(e).length === 0;
  };

  const salvar = async () => {
    if (!canWrite || !validar()) return;
    setSalvando(true);
    try {
      const payload = payloadDoForm();
      if (editItem) {
        const updated = await dbUpdate('/api/formaspagamentoview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
        showToast('Forma de pagamento atualizada!', 'success', true);
      } else {
        const saved = await dbInsert('/api/formaspagamentoview', { ...payload, filial: escopo });
        setData((prev: any[]) => [saved ?? { id: Date.now(), ...payload }, ...prev]);
        showToast('Forma de pagamento criada!', 'success', true);
      }
      fechar();
    } catch (err: any) {
      console.error('[FormasPagamento] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${err?.message ?? String(err)}`, 'error', true);
    } finally { setSalvando(false); }
  };

  const alternarStatus = async (item: any) => {
    const novo = (item.status ?? 'Ativo') === 'Ativo' ? 'Inativo' : 'Ativo';
    try {
      const updated = await dbUpdate('/api/formaspagamentoview', item.id, { status: novo });
      setData((prev: any[]) => prev.map(d => d.id === item.id ? (updated ?? { ...d, status: novo }) : d));
      showToast(novo === 'Ativo' ? 'Reativada.' : 'Inativada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'não foi possível mudar o status'}`, 'error', true);
    }
  };

  const excluir = async (id: string) => {
    if (!canWrite || !await confirm('Excluir esta forma de pagamento?')) return;
    try {
      await dbDelete('/api/formaspagamentoview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Excluída.', 'success', true);
    } catch (err: any) {
      console.error('[FormasPagamento] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const filtrados = data.filter((item: any) => {
    const q = search.toLowerCase();
    return !q || [item.descricao, item.tipo, resumo(item)].some(s => String(s ?? '').toLowerCase().includes(q));
  });

  const previa = form.tipo ? <Previa form={form} payload={payloadDoForm()} /> : null;
  const colSpan = escopo ? 4 : 5;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-4 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Formas de Pagamento{escopo ? ` — ${escopo}` : ' — Consolidado'}</h2>
          {!escopo && <p className="text-sm text-gray-400 mt-1">Visão consolidada de todas as unidades — somente leitura em Matriz.</p>}
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto flex-wrap">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {canWrite && <NeuButtonAccent onClick={abrirNovo}><Plus size={16} /> Nova forma</NeuButtonAccent>}
        </div>
      </div>

      <ModalFormulario
        aberto={aberto}
        titulo={`${editItem ? 'Editar' : 'Nova'} forma de pagamento`}
        onCancelar={fechar}
        cancelarDesabilitado={salvando}
        lateral={previa}
        acoes={<NeuButtonAccent onClick={salvar} isLoading={salvando}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>}
      >
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Como o cliente paga? *" error={erros.tipo}>
              <select className={`neu-input py-2 px-3 rounded-xl text-sm ${erros.tipo ? 'border border-red-500/40' : ''}`}
                value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="">Selecione...</option>
                {tiposDaUnidade(escopo, editItem?.tipo ?? '').map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Nome que aparece na venda *" error={erros.descricao}>
              <input type="text" className={`neu-input py-2 px-3 rounded-xl text-sm ${erros.descricao ? 'border border-red-500/40' : ''}`}
                value={form.descricao} onChange={e => set('descricao', e.target.value)}
                placeholder={form.tipo ? `Ex: ${form.tipo === 'Cartão de crédito parcelado' ? 'Cartão Visa até 6x' : form.tipo}` : 'Ex: Cartão Visa até 6x'} />
            </FormField>
          </div>

          {form.tipo ? (
            <>
              <p className="text-xs text-gray-400 -mt-2">{TIPO_AJUDA[form.tipo]}</p>
              {BLOCOS.map(b => {
                const campos = b.campos.filter(c => visiveis.has(c));
                if (campos.length === 0) return null;
                return (
                  <section key={campos[0]} className={`flex flex-col gap-3 ${b.tom ? TOM[b.tom] : ''}`}>
                    <div>
                      <h3 className={`text-[11px] font-bold uppercase tracking-widest ${b.tom === 'cliente' ? 'text-amber-400' : b.tom === 'loja' ? 'text-red-400' : 'text-accent'}`}>
                        {typeof b.titulo === 'function' ? b.titulo(form.tipo) : b.titulo}
                      </h3>
                      {b.sub && <p className="text-[11px] text-gray-500 mt-0.5">{b.sub}</p>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {campos.map(c => {
                        const info = CAMPO_INFO[c];
                        return (
                          <FormField key={c} label={typeof info.label === 'function' ? info.label(form.tipo) : info.label} error={erros[c]}>
                            <div className="relative">
                              {PERCENTUAIS.has(c) ? (
                                <input type="text" inputMode="numeric"
                                  className={`neu-input py-2 pl-3 pr-16 rounded-xl text-sm w-full tabular-nums ${erros[c] ? 'border border-red-500/40' : ''}`}
                                  value={form[c]} onChange={e => set(c, formatBRL(e.target.value))} onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                              ) : (
                                <input type="number" inputMode="numeric" min={0} step={1}
                                  className={`neu-input py-2 pl-3 pr-16 rounded-xl text-sm w-full tabular-nums ${erros[c] ? 'border border-red-500/40' : ''}`}
                                  value={form[c]} onChange={e => set(c, e.target.value.replace(/\D/g, ''))} placeholder={String(NEUTRO[c])} />
                              )}
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">{info.sufixo}</span>
                            </div>
                            <span className="text-[11px] text-gray-500 leading-snug">{info.ajuda(form.tipo)}</span>
                          </FormField>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {form.tipo === 'Crediário da loja' && (
                <p className="text-xs text-amber-400/90">Crediário cobra limite de crédito e adimplência do cliente quando o orçamento vira pedido.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">Escolha o tipo: só aparecem os campos que existem nele.</p>
          )}

          {editItem && (
            <FormField label="Situação">
              <select className="neu-input py-2 px-3 rounded-xl text-sm w-full md:w-1/2" value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
              </select>
            </FormField>
          )}
        </div>
      </ModalFormulario>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Nome</th>
                <th className="pb-4 font-bold px-4">Tipo</th>
                <th className="pb-4 font-bold px-4">Condições</th>
                {!escopo && <th className="pb-4 font-bold px-4">Filial</th>}
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={colSpan}><LoadingSpinner /></td></tr>)
                : filtrados.length === 0 ? (<tr><td colSpan={colSpan}><EmptyState /></td></tr>)
                : (
                  <AnimatePresence>
                    {filtrados.map((item: any) => (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className={`border-b border-white/5 hover:bg-white/5 transition-colors ${item.status === 'Inativo' ? 'opacity-55' : ''}`}>
                        <td className="py-4 px-4 text-sm font-semibold text-gray-200">
                          {item.descricao}
                          {item.status === 'Inativo' && (
                            <span className="ml-2 align-middle px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-zinc-600 text-white">Inativo</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-xs text-gray-400">
                          {item.tipo ?? <span className="text-amber-400">Sem tipo — edite e classifique</span>}
                        </td>
                        <td className="py-4 px-4 text-xs text-gray-400">{resumo(item)}</td>
                        {!escopo && <td className="py-4 px-4"><FilialBadge filial={item.filial} /></td>}
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-center items-center gap-1.5">
                            {canWrite && (
                              <button onClick={() => abrirEdicao(item)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                            )}
                            <MenuMais>
                              {fecharMenu => (
                                <>
                                  <p className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                                    Situação: <span className={item.status === 'Inativo' ? 'text-gray-300' : 'text-green-400'}>{item.status ?? 'Ativo'}</span>
                                  </p>
                                  {canWrite && (
                                    <ItemMenu onClick={() => { fecharMenu(); alternarStatus(item); }}
                                      cor={item.status === 'Inativo' ? 'text-green-400 hover:bg-green-500/10' : 'text-gray-300 hover:bg-white/5'}
                                      icon={item.status === 'Inativo' ? RotateCcw : Ban}>
                                      {item.status === 'Inativo' ? 'Reativar' : 'Inativar'}
                                    </ItemMenu>
                                  )}
                                  <HistoricoOperacoes variante="menu" onAbrir={fecharMenu}
                                    entidade="formas_pagamento" entidadeId={item.id} titulo={item.descricao ?? 'Forma de pagamento'}
                                    criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                  {canWrite && (
                                    <ItemMenu onClick={() => { fecharMenu(); excluir(item.id); }} cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                      Excluir
                                    </ItemMenu>
                                  )}
                                </>
                              )}
                            </MenuMais>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

/** Uma venda de R$ 100 nesta forma, com o parcelamento máximo — a conta que o orçamento vai fazer. */
const Previa = ({ form, payload }: { form: Form; payload: Record<string, unknown> }) => {
  const forma = { id: 'previa', descricao: form.descricao, ...payload } as FormaPagamento;
  const n = Math.max(1, num(payload.parcelas_max, 1));
  const r = calcularCondicao(EXEMPLO, 0, forma, n);
  const prazo = num(payload.prazo);
  const intervalo = Math.max(1, num(payload.intervalo_dias, 30));
  const datas = Array.from({ length: Math.min(r.parcelas, 4) }, (_, k) => `D+${prazo + k * intervalo}`);
  if (r.parcelas > 4) datas.push('…');

  const Linha = ({ rotulo, valor, destaque, cor }: { rotulo: string; valor: string; destaque?: boolean; cor?: string }) => (
    <div className={`flex justify-between gap-3 ${destaque ? 'text-sm font-bold text-gray-100' : 'text-xs text-gray-400'}`}>
      <span>{rotulo}</span><span className={`tabular-nums ${cor ?? ''}`}>{valor}</span>
    </div>
  );

  // A frase que amarra os dois lados — é aqui que juros e taxa deixam de
  // parecer a mesma coisa.
  const taxaNome = nomeTaxa(form.tipo).toLowerCase();
  const saldo = Math.round((r.valorLiquido - EXEMPLO) * 100) / 100;
  const moral =
    r.acrescimoJuros > 0 && r.taxaAdquirente > 0
      ? `O cliente paga ${reais(r.acrescimoJuros)} de juros a mais; a ${taxaNome} leva ${reais(r.taxaAdquirente)}. São cobranças de lados diferentes: no fim, a loja fica com ${reais(Math.abs(saldo))} ${saldo >= 0 ? 'a mais' : 'a menos'} que o preço.`
    : r.taxaAdquirente > 0 && r.parcelas > 1
      ? `Parcelado sem juros: o cliente não paga nada a mais, e a ${taxaNome} (${reais(r.taxaAdquirente)}) sai toda do bolso da loja.`
    : r.taxaAdquirente > 0
      ? `O cliente paga o preço cheio. A ${taxaNome} (${reais(r.taxaAdquirente)}) é custo da loja, que recebe menos.`
    : r.acrescimoJuros > 0
      ? `Sem taxa: os ${reais(r.acrescimoJuros)} de juros que o cliente paga a mais ficam todos com a loja.`
    : null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-accent">Na prática</h3>
      <p className="text-xs text-gray-400 leading-snug">
        Uma venda de <strong className="text-gray-200">{reais(EXEMPLO)}</strong>
        {r.parcelas > 1 ? ` dividida no máximo (${r.parcelas}x)` : ' à vista'}:
      </p>
      <div className={`neu-flat rounded-2xl p-4 flex flex-col gap-2 border border-white/5 ${TOM.cliente}`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Lado do cliente</p>
        <Linha rotulo="Preço" valor={reais(EXEMPLO)} />
        {r.descontoCondicao > 0 && <Linha rotulo="Desconto à vista" valor={`− ${reais(r.descontoCondicao)}`} cor="text-green-400" />}
        {r.acrescimoJuros > 0 && <Linha rotulo="Juros (paga a mais)" valor={`+ ${reais(r.acrescimoJuros)}`} cor="text-amber-400" />}
        <Linha rotulo="Cliente paga" valor={r.parcelas > 1 ? `${r.parcelas} × ${reais(r.valorParcela)}` : reais(r.valorTotal)} destaque />
        {r.parcelas > 1 && <Linha rotulo="Total" valor={reais(r.valorTotal)} />}
      </div>
      <div className={`neu-flat rounded-2xl p-4 flex flex-col gap-2 border border-white/5 ${TOM.loja}`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">Lado da loja</p>
        <Linha rotulo="Recebe do cliente" valor={reais(r.valorTotal)} />
        {r.taxaAdquirente > 0 && <Linha rotulo={`${nomeTaxa(form.tipo)} (fica com a operadora)`} valor={`− ${reais(r.taxaAdquirente)}`} cor="text-red-400" />}
        <Linha rotulo="Loja fica com" valor={reais(r.valorLiquido)} destaque />
        <Linha rotulo="Quando" valor={prazo === 0 && r.parcelas === 1 ? 'na hora' : datas.join(', ')} />
      </div>
      {moral && <p className="text-[11px] text-gray-400 leading-snug">{moral}</p>}
    </div>
  );
};
