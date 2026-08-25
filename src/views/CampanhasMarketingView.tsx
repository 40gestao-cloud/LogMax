import React, { useMemo, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Edit3, TrendingUp, TrendingDown, Target, Calendar, DollarSign, Package, Send, CheckCircle, XCircle, Search } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { hasSetor } from '../lib/rbac';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';

const STATUS_STYLE: Record<string, string> = {
  'Rascunho':                 'bg-gray-500/10  text-gray-400  border-gray-500/20',
  'Aguardando Financeiro':    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  'Aprovado':                 'bg-green-500/10 text-green-400 border-green-500/20',
  'Parcialmente Aprovado':    'bg-blue-400/10  text-blue-300  border-blue-400/20',
  'Reprovado':                'bg-red-500/10   text-red-400   border-red-500/20',
  'Ativa':                    'bg-accent/10    text-accent    border-accent/20',
  'Concluída':                'bg-blue-500/10  text-blue-400  border-blue-500/20',
  'Cancelada':                'bg-red-500/10   text-red-500   border-red-500/20',
};

// 'Ativa' não é mais escolha livre no formulário — só chega lá vindo de
// 'Aprovado'/'Parcialmente Aprovado' (aprovação do Financeiro via "Enviar
// para Financeiro" no modal de produtos). Sem isso, Marketing pulava a
// aprovação selecionando 'Ativa' direto na criação/edição.
const STATUS_OPTIONS = ['Rascunho', 'Concluída', 'Cancelada'] as const;

function opcoesStatus(statusAtual: string): string[] {
  const extras: string[] = [];
  if (statusAtual === 'Aprovado' || statusAtual === 'Parcialmente Aprovado' || statusAtual === 'Ativa') extras.push('Ativa');
  if (!(STATUS_OPTIONS as readonly string[]).includes(statusAtual) && !extras.includes(statusAtual)) extras.push(statusAtual);
  return [...STATUS_OPTIONS, ...extras];
}

const makeEmptyForm = (filial: string) => ({
  nome: '', descricao: '', objetivo: '', filial,
  data_inicio: '', data_fim: '', orcamento: '',
  status: 'Rascunho' as string,
});

type Campanha = {
  id: string; nome: string; descricao: string | null; objetivo: string | null;
  filial: string | null; data_inicio: string; data_fim: string;
  orcamento: number; gasto_real: number; status: string;
  nome_criador: string | null; created_at: string;
};
type RoiRow = { id: string; receita: number; vendas_count: number; ticket_medio: number; orcamento: number; gasto_real: number; roi_percent: number | null; };

const fmtBRL = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Modal de Produtos da Campanha ────────────────────────────────────────────
function ModalProdutos({ campanha, onClose, showToast, profile }: {
  campanha: Campanha; onClose: () => void; showToast: any; profile: any;
}) {
  // `confirm` é escopo léxico: sem o hook aqui, cai no window.confirm e o
  // navegador desenha o diálogo no lugar do modal do app.
  const confirm = useConfirm();
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroSubcat,    setFiltroSubcat]    = useState('');
  const [search,          setSearch]          = useState('');
  const [salvando,        setSalvando]        = useState(false);
  const [enviando,        setEnviando]        = useState(false);

  // Escopo de unidade: a RLS deixa admin, CEO e conselheiro passarem em
  // todas as filiais (`auth_pode_filial`), então quem opera dentro de uma
  // unidade via dado de outra. Em Matriz o filtro não existe, que é o ponto.
  const escopo = campanha?.filial ? { filial: campanha.filial } : undefined;
  const { data: produtos }     = useFetchData<any>('/api/produtosview', escopo);
  const { data: categorias }   = useFetchData<any>('categorias_produto', escopo);
  const { data: subcategorias} = useFetchData<any>('subcategorias_produto');
  const { data: itensSaved, setData: setItensSaved, reload: reloadItens } = useFetchData<any>('itens_campanha');

  // Filtra apenas itens desta campanha
  const itensCampanha = useMemo(() => itensSaved.filter((i: any) => i.campanha_id === campanha.id), [itensSaved, campanha.id]);
  const produtosNaCampanha = useMemo(() => new Set(itensCampanha.map((i: any) => i.produto_id)), [itensCampanha]);

  // Subcategorias da categoria filtrada
  const subsDaCategoria = useMemo(() =>
    filtroCategoria ? subcategorias.filter((s: any) => s.categoria_id === filtroCategoria && s.ativo) : [],
    [subcategorias, filtroCategoria]
  );

  // Produtos filtrados — já restritos à filial da campanha
  const produtosFiltrados = useMemo(() => {
    return produtos.filter((p: any) => {
      if (campanha.filial && p.filial !== campanha.filial) return false;
      if (filtroCategoria && p.categoria_id !== filtroCategoria) return false;
      if (filtroSubcat && p.subcategoria_id !== filtroSubcat) return false;
      if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [produtos, campanha.filial, filtroCategoria, filtroSubcat, search]);

  // Preços editáveis por produto
  const [precos, setPrecos] = useState<Record<string, { preco_atual: string; preco_promocional: string }>>({});

  const getPreco = (prodId: string) => precos[prodId] ?? { preco_atual: '', preco_promocional: '' };
  const setPreco = (prodId: string, field: 'preco_atual' | 'preco_promocional', val: string) =>
    setPrecos(prev => ({ ...prev, [prodId]: { ...getPreco(prodId), [field]: val } }));

  const isAdicionado = (prodId: string) => produtosNaCampanha.has(prodId);

  const toggleProduto = async (prod: any) => {
    if (!supabase) return;
    if (isAdicionado(prod.id)) {
      // remover — só permite se item ainda está Pendente
      const item = itensCampanha.find((i: any) => i.produto_id === prod.id);
      if (!item) return;
      if (item.status !== 'Pendente') {
        showToast(`Não é possível remover: item já está "${item.status}".`, 'error');
        return;
      }
      const { error } = await supabase.from('itens_campanha').delete().eq('id', item.id);
      if (error) { showToast(error.message, 'error'); return; }
      setItensSaved((prev: any[]) => prev.filter((i: any) => i.id !== item.id));
    } else {
      // adicionar
      const p = getPreco(prod.id);
      const preco_atual        = p.preco_atual       ? parseBRL(p.preco_atual)       : Number(prod.preco) || null;
      const preco_promocional  = p.preco_promocional ? parseBRL(p.preco_promocional) : null;
      const percentual_desconto = (preco_atual && preco_promocional)
        ? Math.round(((preco_atual - preco_promocional) / preco_atual) * 100 * 100) / 100
        : null;

      setSalvando(true);
      const { data, error } = await supabase.from('itens_campanha')
        .insert({ campanha_id: campanha.id, produto_id: prod.id, preco_atual, preco_promocional, percentual_desconto, status: 'Pendente' })
        .select().single();
      setSalvando(false);
      if (error) { showToast(error.message, 'error'); return; }
      setItensSaved((prev: any[]) => [data, ...prev]);
    }
  };

  const handleEnviarFinanceiro = async () => {
    if (itensCampanha.length === 0) { showToast('Adicione pelo menos 1 produto antes de enviar.', 'error'); return; }
    if (!await confirm('Enviar campanha para aprovação do Financeiro?')) return;
    setEnviando(true);
    try {
      const updated = await dbUpdate('/api/marketingcampanhasview', campanha.id, { status: 'Aguardando Financeiro' } as any);
      showToast('Enviado para o Financeiro!', 'success');
      onClose();
    } catch (err: any) {
      showToast(err.message ?? 'Erro ao enviar.', 'error');
    } finally { setEnviando(false); }
  };

  const canEnviar = (hasSetor(profile, 'marketing') || profile?.role === 'gerente') && campanha.status === 'Rascunho';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="neu-flat rounded-3xl border border-white/5 w-full max-w-4xl my-6">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
              <Package size={16} className="text-accent" /> Produtos — {campanha.nome}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{itensCampanha.length} produto(s) adicionado(s)</p>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Filtros */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Buscar</p>
              <input className="neu-input text-sm px-3 py-2 rounded-xl w-full" placeholder="Nome do produto…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Categoria</p>
              <select className="neu-input text-sm px-3 py-2 rounded-xl w-full"
                value={filtroCategoria} onChange={e => { setFiltroCategoria(e.target.value); setFiltroSubcat(''); }}>
                <option value="">Todas</option>
                {categorias.filter((c: any) => c.ativo).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Subcategoria</p>
              <select className="neu-input text-sm px-3 py-2 rounded-xl w-full"
                value={filtroSubcat} onChange={e => setFiltroSubcat(e.target.value)}
                disabled={subsDaCategoria.length === 0}>
                <option value="">Todas</option>
                {subsDaCategoria.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.icone} {s.nome}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Lista de produtos */}
          <div className="max-h-96 overflow-y-auto main-scrollbar space-y-1.5 pr-1">
            {produtosFiltrados.length === 0 ? (
              <EmptyState message="Nenhum produto encontrado com esses filtros." />
            ) : produtosFiltrados.map((prod: any) => {
              const adicionado = isAdicionado(prod.id);
              const itemSalvo  = itensCampanha.find((i: any) => i.produto_id === prod.id);
              return (
                <div key={prod.id} className={`rounded-xl border p-3 flex gap-3 items-center transition-colors ${
                  adicionado ? 'border-accent/30 bg-accent/5' : 'border-white/5 bg-white/2'
                }`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-200 truncate">{prod.nome}</p>
                    <p className="text-[10px] text-gray-500">{prod.filial ?? 'Sem loja'} · {prod.codigo ?? '—'}</p>
                    {adicionado && itemSalvo?.status && (
                      <span className={`inline-flex text-[10px] px-1.5 py-0.5 rounded-full border mt-0.5 ${STATUS_STYLE[itemSalvo.status] ?? ''}`}>
                        {itemSalvo.status}
                        {itemSalvo.motivo_reprovacao ? ` — ${itemSalvo.motivo_reprovacao}` : ''}
                      </span>
                    )}
                  </div>
                  {!adicionado && (
                    <div className="flex gap-2 items-center shrink-0">
                      <div className="flex flex-col gap-0.5 items-end">
                        <p className="text-[9px] text-gray-600">Preço atual</p>
                        <input type="text" inputMode="numeric" placeholder={prod.preco ? formatBRL(Number(prod.preco)) : '0,00'}
                          className="neu-input text-xs text-right w-24 px-2 py-1 rounded-lg"
                          value={getPreco(prod.id).preco_atual}
                          onChange={e => setPreco(prod.id, 'preco_atual', formatBRL(parseBRL(e.target.value)))}
                          onKeyDown={handleMoneyKeyDown} />
                      </div>
                      <div className="flex flex-col gap-0.5 items-end">
                        <p className="text-[9px] text-gray-600">Preço promo</p>
                        <input type="text" inputMode="numeric" placeholder="0,00"
                          className="neu-input text-xs text-right w-24 px-2 py-1 rounded-lg"
                          value={getPreco(prod.id).preco_promocional}
                          onChange={e => setPreco(prod.id, 'preco_promocional', formatBRL(parseBRL(e.target.value)))}
                          onKeyDown={handleMoneyKeyDown} />
                      </div>
                    </div>
                  )}
                  {adicionado && itemSalvo?.preco_atual != null && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-gray-500">R$ {formatBRL(Number(itemSalvo.preco_atual))}</p>
                      {itemSalvo.preco_promocional != null && (
                        <p className="text-[10px] text-accent font-bold">→ R$ {formatBRL(Number(itemSalvo.preco_promocional))}</p>
                      )}
                    </div>
                  )}
                  <button onClick={() => toggleProduto(prod)} disabled={salvando}
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      adicionado ? 'text-red-400 hover:bg-red-500/10' : 'text-accent hover:bg-accent/10'
                    }`}>
                    {adicionado ? <XCircle size={16} /> : <CheckCircle size={16} />}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {canEnviar && (
            <div className="pt-3 border-t border-white/5 flex justify-end">
              <NeuButtonAccent onClick={handleEnviarFinanceiro} disabled={enviando}
                className="flex items-center gap-2 text-sm">
                <Send size={13} />{enviando ? 'Enviando…' : 'Enviar para Financeiro'}
              </NeuButtonAccent>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── View Principal ────────────────────────────────────────────────────────────
const CampanhasMarketingViewInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
  const { data: campanhas, setData, isLoading } = useFetchData<Campanha>('/api/marketingcampanhasview', { filial }, true);
  const confirm = useConfirm();
  const prompt = usePrompt();
  // `orderBy`/`ascending` são o QUARTO argumento (options); estavam no segundo,
  // que é o filtro — viravam `.eq('orderBy', ...)`, PostgREST devolvia 400 e o
  // painel de ROI ficava vazio em silêncio. Aproveitando, o escopo de unidade.
  const { data: roi } = useFetchData<RoiRow>('/api/campanharoiview', { filial }, false,
    { orderBy: 'data_inicio', ascending: false });

  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState<Campanha | null>(null);
  const [form,      setForm]      = useState(makeEmptyForm(filial));
  const [saving,    setSaving]    = useState(false);
  const [modalCamp, setModalCamp] = useState<Campanha | null>(null);
  const [searchCamp, setSearchCamp] = useState('');

  const canCRUD        = hasSetor(profile, 'marketing') || profile?.role === 'gerente';
  const canEditarGasto = canCRUD || hasSetor(profile, 'financeiro');

  const roiMap = useMemo(() => {
    const m: Record<string, RoiRow> = {};
    for (const r of roi ?? []) m[r.id] = r;
    return m;
  }, [roi]);
  const campanhasFiltradas = searchCamp
    ? (campanhas ?? []).filter((c: any) =>
        (c.nome ?? '').toLowerCase().includes(searchCamp.toLowerCase()) ||
        (c.objetivo ?? '').toLowerCase().includes(searchCamp.toLowerCase()))
    : (campanhas ?? []);

  const resetForm = () => { setForm(makeEmptyForm(filial)); setEditing(null); setShowForm(false); };

  const openEdit = (c: Campanha) => {
    setEditing(c);
    setForm({
      nome: c.nome, descricao: c.descricao ?? '', objetivo: c.objetivo ?? '', filial: c.filial ?? filial,
      data_inicio: c.data_inicio, data_fim: c.data_fim,
      orcamento: c.orcamento ? formatBRL(c.orcamento) : '', status: c.status,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nome.trim())                     { showToast('Informe o nome da campanha.', 'error'); return; }
    if (!form.data_inicio)                     { showToast('Informe o início.', 'error'); return; }
    if (!form.data_fim)                        { showToast('Informe o fim.', 'error'); return; }
    if (form.data_fim < form.data_inicio)      { showToast('Fim não pode ser anterior ao início.', 'error'); return; }

    setSaving(true);
    try {
      const payload: any = {
        nome: form.nome.trim(), descricao: form.descricao.trim() || null,
        objetivo: form.objetivo.trim() || null, filial: form.filial || null,
        data_inicio: form.data_inicio, data_fim: form.data_fim,
        orcamento: parseBRL(form.orcamento || '0'), status: form.status,
      };
      if (editing) {
        const updated = await dbUpdate('/api/marketingcampanhasview', editing.id, payload);
        setData((prev: any[]) => prev.map((c: any) => c.id === editing!.id ? { ...c, ...updated } : c));
        showToast('Campanha atualizada.', 'success');
      } else {
        payload.nome_criador = profile?.nome ?? '';
        payload.criado_por   = profile?.id ?? null;
        const created = await dbInsert('/api/marketingcampanhasview', payload);
        setData((prev: any[]) => [created, ...prev]);
        showToast('Campanha criada.', 'success');
      }
      resetForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const handleAjustarGasto = async (c: Campanha) => {
    const atual = formatBRL(c.gasto_real);
    const novo = await prompt({
      message: `Gasto real da campanha "${c.nome}"`,
      defaultValue: atual,
      placeholder: 'Ex.: 1.250,00',
      confirmLabel: 'Atualizar gasto',
      maxLength: 20,
    });
    if (novo == null) return;
    const valor = parseBRL(novo);
    if (Number.isNaN(valor) || valor < 0) { showToast('Valor inválido.', 'error'); return; }
    try {
      const updated = await dbUpdate('/api/marketingcampanhasview', c.id, { gasto_real: valor } as any);
      setData((prev: any[]) => prev.map((x: any) => x.id === c.id ? { ...x, ...updated } : x));
      showToast('Gasto atualizado.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message}`, 'error'); }
  };

  const handleDelete = async (c: Campanha) => {
    if (!await confirm(`Inativar a campanha "${c.nome}"?`)) return;
    try {
      await dbDelete('/api/marketingcampanhasview', c.id);
      setData((prev: any[]) => prev.filter((x: any) => x.id !== c.id));
      showToast('Campanha inativada.', 'success');
    } catch (err: any) { showToast(`Erro: ${err?.message}`, 'error'); }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const ativas         = campanhas.filter((c: any) => c.status === 'Ativa').length;
  const orcamentoTotal = campanhas.reduce((s: number, c: any) => s + Number(c.orcamento || 0), 0);
  const gastoTotal     = campanhas.reduce((s: number, c: any) => s + Number(c.gasto_real  || 0), 0);
  const receitaTotal   = (roi ?? []).reduce((s: number, r: RoiRow) => s + Number(r.receita || 0), 0);

  const kpis = [
    { label: 'Total de Campanhas',  value: String(campanhas.length) },
    { label: 'Ativas',              value: String(ativas) },
    { label: 'Orçamento × Gasto',   value: `${fmtBRL(gastoTotal)} / ${fmtBRL(orcamentoTotal)}` },
    { label: 'Receita Atribuída',   value: fmtBRL(receitaTotal) },
  ];

  return (
    <>
      {modalCamp && (
        <ModalProdutos campanha={modalCamp} onClose={() => setModalCamp(null)}
          showToast={showToast} profile={profile} />
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
        <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Campanhas — {filial}</h2>
            <p className="text-sm text-gray-400 mt-1">
              Planeje campanhas com orçamento e período, acompanhe ROI cruzando vendas no período e cupons usados.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
          {kpis.map(k => (
            <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
              <p className="text-lg sm:text-xl font-black text-gray-100 tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={searchCamp}
              onChange={e => setSearchCamp(e.target.value)}
              placeholder="Buscar campanha…"
              className="neu-input rounded-xl pl-8 pr-3 py-2 text-sm w-[200px]"
            />
          </div>
          {canCRUD && (
            <NeuButtonAccent variant="" onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus size={14} />Nova Campanha
            </NeuButtonAccent>
          )}
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">{editing ? 'Editar Campanha' : 'Nova Campanha'}</h3>
                <button onClick={resetForm} className="modal-close-btn"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5 lg:col-span-2">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Nome *</label>
                  <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Verão 2026" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm">
                    {opcoesStatus(form.status).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início *</label>
                  <input type="date" value={form.data_inicio} onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim *</label>
                  <input type="date" value={form.data_fim} onChange={e => setForm(f => ({ ...f, data_fim: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Unidade</label>
                  <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-accent font-semibold border border-white/5">{filial}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Orçamento (R$)</label>
                  <input type="text" inputMode="numeric" value={form.orcamento}
                    onChange={e => setForm(f => ({ ...f, orcamento: formatBRL(e.target.value) }))}
                    onKeyDown={handleMoneyKeyDown}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="0,00" />
                </div>
                <div className="flex flex-col gap-1.5 lg:col-span-3">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Objetivo</label>
                  <input type="text" value={form.objetivo} onChange={e => setForm(f => ({ ...f, objetivo: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: aumentar ticket médio em 15%" />
                </div>
                <div className="flex flex-col gap-1.5 lg:col-span-3">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                  <textarea value={form.descricao} rows={2} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none"
                    placeholder="Detalhes pra equipe (canais, peças, calendário, etc.)" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={resetForm} className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">Cancelar</button>
                <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                  {saving ? 'Salvando...' : (editing ? 'Salvar' : 'Criar Campanha')}
                </NeuButtonAccent>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
          {campanhas.length === 0 ? <EmptyState message="Nenhuma campanha criada ainda" /> : (
            <div className="overflow-x-auto main-scrollbar">
              <table className="w-full text-left border-collapse min-w-[1100px]">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                    <th className="pb-4 font-bold px-4">Nome</th>
                    <th className="pb-4 font-bold px-4">Período</th>
                    <th className="pb-4 font-bold px-4 text-right">Orçamento</th>
                    <th className="pb-4 font-bold px-4 text-right">Gasto Real</th>
                    <th className="pb-4 font-bold px-4 text-right">Receita</th>
                    <th className="pb-4 font-bold px-4 text-right">Vendas</th>
                    <th className="pb-4 font-bold px-4 text-right">ROI</th>
                    <th className="pb-4 font-bold px-4 text-center">Status</th>
                    <th className="pb-4 font-bold px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {campanhasFiltradas.length === 0
                      ? <tr><td colSpan={9} className="py-8 text-center text-sm text-gray-600 italic">Nenhuma campanha encontrada para "{searchCamp}"</td></tr>
                      : campanhasFiltradas.map((c: any) => {
                      const r = roiMap[c.id];
                      const receita = Number(r?.receita ?? 0);
                      const vendas  = Number(r?.vendas_count ?? 0);
                      const roiPct  = r?.roi_percent ?? null;
                      const roiPos  = roiPct != null && roiPct > 0;
                      const roiNeg  = roiPct != null && roiPct < 0;
                      return (
                        <motion.tr key={c.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                          <td className="py-3 px-4">
                            <p className="text-sm font-semibold text-gray-200 max-w-[220px] truncate" title={c.nome}>{c.nome}</p>
                            {c.objetivo && <p className="text-[10px] text-gray-500 max-w-[220px] truncate"><Target size={9} className="inline mr-1" />{c.objetivo}</p>}
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">
                            <Calendar size={9} className="inline mr-1" />{c.data_inicio} → {c.data_fim}
                          </td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right tabular-nums">{fmtBRL(c.orcamento)}</td>
                          <td className="py-3 px-4 text-xs font-mono text-right tabular-nums">
                            <button disabled={!canEditarGasto} onClick={() => canEditarGasto && handleAjustarGasto(c)}
                              className={canEditarGasto ? 'text-gray-100 hover:text-accent transition-colors' : 'text-gray-300 cursor-default'}
                              title={canEditarGasto ? 'Clique pra ajustar' : 'Apenas marketing/financeiro'}>
                              {fmtBRL(c.gasto_real)}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-xs font-mono text-accent text-right font-bold tabular-nums">{fmtBRL(receita)}</td>
                          <td className="py-3 px-4 text-xs font-mono text-gray-300 text-right tabular-nums">{vendas}</td>
                          <td className="py-3 px-4 text-xs font-mono text-right tabular-nums">
                            {roiPct == null ? <span className="text-gray-600">—</span> : (
                              <span className={`inline-flex items-center gap-1 font-bold ${roiPos ? 'text-accent' : roiNeg ? 'text-red-400' : 'text-gray-300'}`}>
                                {roiPos && <TrendingUp size={11} />}
                                {roiNeg && <TrendingDown size={11} />}
                                {roiPct > 0 ? '+' : ''}{roiPct.toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_STYLE[c.status] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity items-center">
                              <button onClick={() => setModalCamp(c)} title="Produtos da campanha"
                                className="action-btn-neutral">
                                <Package size={12} />
                              </button>
                              {canCRUD && (
                                <>
                                  <button onClick={() => openEdit(c)} title="Editar" className="action-btn-edit"><Edit3 size={12} /></button>
                                  <button onClick={() => handleDelete(c)} title="Inativar" className="action-btn-delete"><Trash2 size={12} /></button>
                                </>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="neu-flat rounded-2xl p-4 border border-white/5 shrink-0">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2 flex items-center gap-2">
            <DollarSign size={11} />Como o ROI é calculado
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong className="text-gray-300">Receita</strong> soma todas as vendas concluídas que tocam a campanha — vendas no período + filial-alvo (Holding agrega todas) <strong>ou</strong> qualquer venda com cupom vinculado.
            {' '}<strong className="text-gray-300">ROI %</strong> = (Receita − Gasto Real) ÷ Gasto Real × 100.
          </p>
        </div>
      </motion.div>
    </>
  );
};

export const CampanhasMarketingView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <CampanhasMarketingViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
