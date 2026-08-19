import React, { useState, useEffect, useMemo } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Clock, CheckCircle2, XCircle, Archive, FileDown, Sheet, Trash2, MessageSquare, ImagePlus, ExternalLink, Star, Send, Edit3, Sparkles, Copy, Loader2, Search } from 'lucide-react';
import { useFetchData, dbInsert, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { freshToken } from '../lib/authFetch';
import { LoadingSpinner, EmptyState, NeuButtonAccent, ExportButton } from '../components/ui';
import { exportToPDF, exportToExcel, formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { hasSetor } from '../lib/rbac';
import { useConfirm } from '../contexts/ConfirmContext';

const SETOR_LABEL: Record<string, string> = {
  all:        'CEO/Admin',
  logistica:  'Logística',
  vendas:     'Vendas',
  financeiro: 'Financeiro',
  rh:         'RH',
  marketing:  'Marketing',
  ti:         'TI',
  compras:    'Compras',
  estoque:    'Estoque',
};

// Quando Marketing publica uma arte, uma única notificação com setor='all'
// faz o broadcast: a RLS de notificacoes inclui `setor = 'all'` no SELECT,
// então todos os usuários autenticados a veem (admin/CEO via auth_is_admin,
// demais via OR explícito). Mandar pra 'all' + cada setor criaria duplicata
// na badge dos não-admin.

const STATUS_STYLE: Record<string, { badge: string; icon: React.ReactNode }> = {
  'Aguardando Aprovação': {
    badge: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    icon: <Clock size={10} />,
  },
  'Aprovado': {
    badge: 'bg-accent/10 text-accent border-accent/20',
    icon: <CheckCircle2 size={10} />,
  },
  'Reprovado': {
    badge: 'bg-red-500/10 text-red-500 border-red-500/20',
    icon: <XCircle size={10} />,
  },
  'Encerrada': {
    badge: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    icon: <Archive size={10} />,
  },
};

const EMPTY_FORM = {
  produto_id: '',
  tipo_origem: 'produto' as 'produto' | 'servico',
  preco_atual: '',
  preco_custo: '',
  preco_promocional: '',
  data_inicio: '',
  data_fim: '',
  descricao: '',
  campanha_id: '',
};

function SearchableSelect({ value, onChange, items, placeholder }: {
  value: string;
  onChange: (id: string) => void;
  items: { id: string; nome: string; filial: string }[];
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = items.find(i => i.id === value);
  const filtered = q
    ? items.filter(i =>
        i.nome.toLowerCase().includes(q.toLowerCase()) ||
        i.filial.toLowerCase().includes(q.toLowerCase()))
    : items;
  return (
    <div className="relative">
      <input
        type="text"
        value={open ? q : (selected?.nome ?? '')}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { setOpen(true); setQ(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="neu-input rounded-xl px-3 py-2.5 text-sm w-full"
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-[var(--color-bg,#0f0f0f)] rounded-xl border border-white/10 max-h-52 overflow-y-auto main-scrollbar shadow-2xl">
          <button type="button" onMouseDown={() => { onChange(''); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-white/5 border-b border-white/5">
            Nenhum
          </button>
          {filtered.length === 0
            ? <p className="px-3 py-2 text-xs text-gray-600 italic">Nenhum resultado</p>
            : filtered.map(i => (
              <button key={i.id} type="button"
                onMouseDown={() => { onChange(i.id); setQ(''); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-white/5 ${value === i.id ? 'text-accent' : 'text-gray-300'}`}>
                <span className="truncate">{i.nome}</span>
                <span className="text-[10px] text-gray-600 shrink-0">{i.filial}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}

const PromocoesMarketingViewInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
  const { data: promocoesAll, setData, isLoading, reload } = useFetchData<any>('/api/marketingpromocoesview', { filial }, true);
  const confirm = useConfirm();
  // View mascarada: precisa do custo para calcular margem da promoção (migr. 262).
  const { data: produtos } = useFetchData<any>('/api/produtoscomcustoview', { filial });
  const { data: servicos } = useFetchData<any>('/api/servicosview', { filial });
  const { data: campanhas } = useFetchData<any>('/api/marketingcampanhasview', { filial });
  const { data: artes, setData: setArtes } = useFetchData<any>('/api/marketingartesview', { filial }, true);
  // marketing_arte_feedback é escopado via arte_id ∈ artes da filial (join
  // client-side). A tabela não tem coluna filial própria.
  const { data: feedbacks } = useFetchData<any>('/api/marketingartefeedbackview', undefined, true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [obsAberta, setObsAberta] = useState<any | null>(null);
  const [searchPromo, setSearchPromo] = useState('');

  // Modais de arte
  const [arteModal, setArteModal] = useState<{ promocao: any; arte: any | null } | null>(null);
  const [arteUrl, setArteUrl] = useState('');
  const [savingArte, setSavingArte] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{ arte: any } | null>(null);

  // Modal de geração de legenda via Gemini (endpoint /api/ai-legenda).
  // Aberto pelo botão na tabela (uma promoção) ou no form (sugestão pra
  // descrição antes de submeter). `payload` é o snapshot que vai pro
  // endpoint; `legendas` chega como [{ tom, texto }]. Loading=true durante
  // a chamada; erro string vai pra UI.
  const [legendaModal, setLegendaModal] = useState<null | {
    payload: any;
    legendas: { tom: string; texto: string }[] | null;
    loading: boolean;
    erro: string | null;
    aplicarNaDescricao: boolean; // true quando vem do form (botão "usar" preenche `form.descricao`)
  }>(null);
  const [legendaCopiada, setLegendaCopiada] = useState<number | null>(null);

  // Publicar/editar arte é privilégio de Marketing (gerente/colaborador) e
  // admin/CEO. Financeiro consegue ler `marketing_promocoes` (e abrir esta
  // view) mas a RLS de `marketing_artes_insert/update` recusa — escondemos
  // o botão pra não mostrar uma ação que falha.
  const canPublicarArte = hasSetor(profile, 'marketing') || profile?.role === 'gerente';

  // Mapa rápido promocao_id → arte (1 por promoção, garantido pelo UNIQUE).
  const arteByPromocao = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of artes ?? []) m[a.promocao_id] = a;
    return m;
  }, [artes]);

  // Feedbacks agrupados por arte_id pra mostrar contagem no botão.
  const feedbacksByArte = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const f of feedbacks ?? []) {
      (m[f.arte_id] ??= []).push(f);
    }
    return m;
  }, [feedbacks]);

  // Sincronização best-effort ao montar: reverte promoções expiradas e
  // recarrega a lista. O cron diário (vercel.json) é a defesa primária.
  useEffect(() => {
    if (!supabase) return;
    supabase.rpc('reverter_promocoes_expiradas').then(({ data, error }) => {
      if (error) { console.warn('[reverter_promocoes_expiradas]', error.message); return; }
      if (typeof data === 'number' && data > 0) reload();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promocoes = useMemo(() => promocoesAll.filter((p: any) => p.filial === filial), [promocoesAll, filial]);

  // Unifica produtos + serviços marcando cada um com o tipo de origem.
  // Filtrado pela filial selecionada.
  type ItemPromo = { id: string; nome: string; preco: number; custo: number | null; filial: string; tipo_origem: 'produto' | 'servico' };
  const itens = useMemo<ItemPromo[]>(() => {
    const produtosAtivos = produtos.filter((p: any) => (p.status === 'Ativo' || !p.status) && p.filial === filial);
    const servicosAtivos = servicos.filter((s: any) => (s.status === 'Ativo' || !s.status) && s.filial === filial);
    const normalizar = (raw: any, tipo: 'produto' | 'servico'): ItemPromo => {
      const precoRaw = tipo === 'produto' ? raw.preco : raw.valor;
      const custoRaw = raw.custo ?? raw.preco_custo;
      return {
        id:          raw.id,
        nome:        raw.nome ?? '',
        preco:       Number(precoRaw ?? 0),
        custo:       custoRaw != null && custoRaw !== '' ? Number(custoRaw) : null,
        filial:      raw.filial || 'Sem empresa',
        tipo_origem: tipo,
      };
    };
    return [
      ...produtosAtivos.map((p: any) => normalizar(p, 'produto')),
      ...servicosAtivos.map((s: any) => normalizar(s, 'servico')),
    ];
  }, [produtos, servicos]);

  // Agrupa itens por filial filtrando por tipo de origem. Usado para gerar
  // dois selects independentes (Produto / Serviço), cada um com seus próprios
  // <optgroup> por empresa.
  const agruparPorFilial = (todos: ItemPromo[], tipo: 'produto' | 'servico') => {
    const buckets = new Map<string, ItemPromo[]>();
    for (const it of todos) {
      if (it.tipo_origem !== tipo) continue;
      (buckets.get(it.filial) ?? buckets.set(it.filial, []).get(it.filial)!).push(it);
    }
    for (const [, arr] of buckets) arr.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
    const filialOrder = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz', 'Sem empresa'];
    return Array.from(buckets.entries())
      .map(([filial, items]) => ({ filial, items }))
      .sort((a, b) => filialOrder.indexOf(a.filial) - filialOrder.indexOf(b.filial));
  };
  const produtosAgrupados = useMemo(() => agruparPorFilial(itens, 'produto'), [itens]);
  const servicosAgrupados = useMemo(() => agruparPorFilial(itens, 'servico'), [itens]);
  const itensProduto = useMemo(() =>
    itens.filter(i => i.tipo_origem === 'produto').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
    [itens]);
  const itensServico = useMemo(() =>
    itens.filter(i => i.tipo_origem === 'servico').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
    [itens]);
  const promocoesFiltradas = searchPromo
    ? promocoes.filter((p: any) => (p.nome_produto ?? '').toLowerCase().includes(searchPromo.toLowerCase()))
    : promocoes;

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const aguardando = promocoes.filter((p: any) => p.status === 'Aguardando Aprovação').length;
  const aprovadas  = promocoes.filter((p: any) => p.status === 'Aprovado' || p.status === 'Ativa').length;
  const encerradas = promocoes.filter((p: any) => p.status === 'Encerrada').length;

  const kpis = [
    { label: 'Total de Campanhas',     value: promocoes.length, warn: false },
    { label: 'Aguardando Aprovação',   value: aguardando,       warn: aguardando > 0 },
    { label: 'Em Vigor',               value: aprovadas,        warn: false },
    { label: 'Encerradas',             value: encerradas,       warn: false },
  ];

  const handleProductChange = (id: string) => {
    const item = itens.find(i => i.id === id);
    if (!item) {
      setForm((f: any) => ({ ...f, produto_id: '', tipo_origem: 'produto', preco_atual: '', preco_custo: '' }));
      return;
    }
    setForm((f: any) => ({
      ...f,
      produto_id:  item.id,
      tipo_origem: item.tipo_origem,
      preco_atual: item.preco ? formatBRL(item.preco) : '',
      preco_custo: item.custo != null ? formatBRL(item.custo) : '',
    }));
  };

  const handleSave = async () => {
    if (!form.produto_id) { showToast('Selecione um produto ou serviço.', 'error'); return; }
    if (!form.preco_promocional) { showToast('Informe o preço promocional.', 'error'); return; }
    // Data de fim deixou de ser opcional: o cron `reverter_promocoes_expiradas`
    // exige `data_fim IS NOT NULL`, então promoção sem prazo NUNCA volta — o
    // preço promocional vira o preço da casa e ninguém percebe. Prazo é o que
    // separa promoção de remarcação.
    if (!form.data_fim) {
      showToast('Informe a data de fim: sem prazo o preço promocional não volta sozinho.', 'error');
      return;
    }
    setSaving(true);
    try {
      const item = itens.find(i => i.id === form.produto_id);
      const payload = {
        produto_id:        form.produto_id,
        tipo_origem:       form.tipo_origem,
        nome_produto:      item?.nome ?? '',
        preco_atual:       parseBRL(form.preco_atual),
        preco_custo:       parseBRL(form.preco_custo || '0'),
        preco_promocional: parseBRL(form.preco_promocional),
        data_inicio:       form.data_inicio  || null,
        data_fim:          form.data_fim     || null,
        descricao:         form.descricao    || null,
        campanha_id:       form.campanha_id  || null,
        filial,
        status:            'Aguardando Aprovação',
        nome_criador:      profile?.nome ?? '',
      };
      const created = await dbInsert('/api/marketingpromocoesview', payload);
      setData((prev: any[]) => [created, ...prev]);
      showToast('Proposta enviada ao Financeiro para aprovação!', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch {
      showToast('Erro ao enviar proposta.', 'error');
    }
    setSaving(false);
  };

  const openArteModal = (promocao: any) => {
    const existing = arteByPromocao[promocao.id] ?? null;
    setArteModal({ promocao, arte: existing });
    setArteUrl(existing?.arte_url ?? '');
  };

  const closeArteModal = () => {
    setArteModal(null);
    setArteUrl('');
  };

  const handleSaveArte = async () => {
    if (!arteModal) return;
    const url = arteUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      showToast('Cole um link válido começando com http(s)://', 'error');
      return;
    }
    setSavingArte(true);
    try {
      const { promocao, arte } = arteModal;
      const payload: any = {
        promocao_id:        promocao.id,
        nome_produto:       promocao.nome_produto ?? '',
        descricao_promocao: promocao.descricao ?? null,
        preco_promocional:  promocao.preco_promocional ?? null,
        data_inicio:        promocao.data_inicio ?? null,
        data_fim:           promocao.data_fim ?? null,
        arte_url:           url,
        publicada_por:      profile?.id ?? null,
        nome_publicador:    profile?.nome ?? '',
      };

      let saved;
      if (arte) {
        // Edição: substitui o link existente.
        const { data, error } = await supabase!
          .from('marketing_artes')
          .update({ arte_url: url, nome_publicador: profile?.nome ?? '' })
          .eq('id', arte.id)
          .select()
          .single();
        if (error) throw error;
        saved = data;
        setArtes((prev: any[]) => prev.map(a => a.id === saved.id ? saved : a));
        showToast('Arte atualizada.', 'success');
      } else {
        saved = await dbInsert('/api/marketingartesview', payload);
        setArtes((prev: any[]) => [saved, ...prev]);

        // Broadcast único: setor='all' é visível por todos via RLS.
        // Falha silenciosa — a arte já foi publicada com sucesso.
        const titulo = `Nova arte: ${promocao.nome_produto ?? 'campanha'}`;
        const msg = `Marketing publicou a arte da promoção. Clique pra visualizar e dar feedback.`;
        const { error: notifErr } = await supabase!.rpc('notificar_setor', {
          p_setor:     'all',
          p_tipo:      'info',
          p_titulo:    titulo,
          p_mensagem:  msg,
          p_link_view: 'artes-promocionais',
          p_urgencia:  'Média',
          p_ref_id:    saved.id,
        });
        if (notifErr) console.warn('[notificar_setor]', notifErr.message);
        showToast('Arte publicada e setores notificados!', 'success');
      }
      closeArteModal();
    } catch (err: any) {
      console.error('[publicar arte]', err);
      showToast(`Erro ao publicar: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSavingArte(false);
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar esta promoção?')) return;
    try {
      await dbDelete('/api/marketingpromocoesview', id);
      setData((prev: any[]) => prev.filter((p: any) => p.id !== id));
      showToast('Promoção inativada.', 'success');
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Promocoes] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error');
    }
  };

  // Abre o modal e dispara a chamada. `aplicarNaDescricao` controla se o
  // botão "Usar" preenche `form.descricao` (fluxo do form) ou só copia.
  const gerarLegenda = async (origem: { promocao?: any; doForm?: boolean }) => {
    let payload: any;
    if (origem.promocao) {
      const p = origem.promocao;
      payload = {
        produto:           p.nome_produto,
        tipo:              p.tipo_origem,
        preco_atual:       Number(p.preco_atual),
        preco_promocional: Number(p.preco_promocional),
        preco_custo:       Number(p.preco_custo),
        data_inicio:       p.data_inicio,
        data_fim:          p.data_fim,
        descricao:         p.descricao ?? '',
      };
    } else {
      // Origem = form aberto. Precisa de produto + preço promo no mínimo.
      const item = itens.find(i => i.id === form.produto_id);
      if (!item) { showToast('Selecione o produto/serviço antes.', 'error'); return; }
      if (!form.preco_promocional) { showToast('Informe o preço promocional.', 'error'); return; }
      payload = {
        produto:           item.nome,
        tipo:              form.tipo_origem,
        preco_atual:       parseBRL(form.preco_atual),
        preco_promocional: parseBRL(form.preco_promocional),
        preco_custo:       parseBRL(form.preco_custo || '0'),
        data_inicio:       form.data_inicio || null,
        data_fim:          form.data_fim || null,
        descricao:         form.descricao,
      };
    }

    setLegendaModal({ payload, legendas: null, loading: true, erro: null, aplicarNaDescricao: !!origem.doForm });

    try {
      const jwt = await freshToken();
      const resp = await fetch('/api/ai-legenda', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        // Adiciona detalhe técnico (finishReason) quando vier do servidor —
        // facilita pra você reportar pra mim sem precisar olhar log do Vercel.
        const detail = data?.finish ? ` (motivo: ${data.finish})` : '';
        setLegendaModal(m => m ? { ...m, loading: false, erro: (data?.error ?? 'Falha na IA.') + detail } : null);
        return;
      }
      setLegendaModal(m => m ? { ...m, loading: false, legendas: data.legendas ?? [] } : null);
    } catch (err: any) {
      setLegendaModal(m => m ? { ...m, loading: false, erro: err?.message ?? 'Erro de rede.' } : null);
    }
  };

  const copiarLegenda = async (texto: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(texto);
      setLegendaCopiada(idx);
      setTimeout(() => setLegendaCopiada(c => c === idx ? null : c), 1500);
    } catch {
      showToast('Não consegui copiar — copie manualmente.', 'error');
    }
  };

  const usarLegendaNaDescricao = (texto: string) => {
    setForm((f: any) => ({ ...f, descricao: texto }));
    setLegendaModal(null);
    showToast('Legenda aplicada como descrição da promoção.', 'success');
  };

  const exportCols = ['Produto', 'Preço Atual', 'Preço Promo', 'Início', 'Fim', 'Status'];
  const exportRows = () => promocoes.map((p: any) => [
    p.nome_produto ?? '',
    `R$ ${Number(p.preco_atual || 0).toFixed(2)}`,
    `R$ ${Number(p.preco_promocional || 0).toFixed(2)}`,
    p.data_inicio ?? '—',
    p.data_fim    ?? '—',
    p.status,
  ]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Promoções — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Proponha preços promocionais e acompanhe a aprovação pelo Financeiro.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {promocoes.length > 0 && (
            <>
              <ExportButton label="PDF"   onClick={() => exportToPDF('Promoções', exportCols, exportRows(), 'logmax-promocoes')} icon={FileDown} />
              <ExportButton label="Excel" onClick={() => exportToExcel('Promoções', exportCols, exportRows(), 'logmax-promocoes')} icon={Sheet} />
            </>
          )}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={searchPromo}
              onChange={e => setSearchPromo(e.target.value)}
              placeholder="Buscar promoção…"
              className="neu-input rounded-xl pl-8 pr-3 py-2 text-sm w-[200px]"
            />
          </div>
        </div>
        <NeuButtonAccent variant="" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} />Nova Proposta
        </NeuButtonAccent>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">Nova Proposta de Promoção</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Produto</label>
                <SearchableSelect
                  value={form.tipo_origem === 'produto' ? form.produto_id : ''}
                  onChange={handleProductChange}
                  items={itensProduto}
                  placeholder="Digite para buscar produto…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Serviço</label>
                <SearchableSelect
                  value={form.tipo_origem === 'servico' ? form.produto_id : ''}
                  onChange={handleProductChange}
                  items={itensServico}
                  placeholder="Digite para buscar serviço…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-preco-atual" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Preço de Venda Atual</label>
                <input id="promo-preco-atual" type="text" value={form.preco_atual} readOnly
                  className="neu-input rounded-xl px-3 py-2.5 text-sm opacity-50 cursor-not-allowed" placeholder="Auto" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-preco-custo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Preço de Custo (referência)</label>
                <input id="promo-preco-custo" type="text" value={form.preco_custo} readOnly
                  className="neu-input rounded-xl px-3 py-2.5 text-sm opacity-50 cursor-not-allowed" placeholder="Auto" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-preco-promocional" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Preço Promocional (R$) *</label>
                <input id="promo-preco-promocional" type="text" inputMode="numeric" value={form.preco_promocional}
                  onChange={e => setForm((f: any) => ({ ...f, preco_promocional: formatBRL(e.target.value) }))}
                  onKeyDown={handleMoneyKeyDown}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="0,00" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-data-inicio" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Início da Campanha</label>
                <input id="promo-data-inicio" type="date" value={form.data_inicio} onChange={e => setForm((f: any) => ({ ...f, data_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-data-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fim da Campanha *</label>
                <input id="promo-data-fim" type="date" value={form.data_fim} onChange={e => setForm((f: any) => ({ ...f, data_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                <span className="text-[10px] text-gray-500">É o prazo que devolve o preço: sem ele a promoção nunca encerra.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-descricao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição da Promoção</label>
                <input id="promo-descricao" type="text" value={form.descricao} onChange={e => setForm((f: any) => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex: Black Friday" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-campanha" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Campanha (opcional)</label>
                <select id="promo-campanha" value={form.campanha_id}
                  onChange={e => setForm((f: any) => ({ ...f, campanha_id: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Sem campanha</option>
                  {(campanhas ?? [])
                    .filter((c: any) => c.status !== 'Cancelada')
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>{c.nome} · {c.status}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex justify-between items-center mt-5 gap-2">
              <button
                type="button"
                onClick={() => gerarLegenda({ doForm: true })}
                disabled={!form.produto_id || !form.preco_promocional}
                title={!form.produto_id || !form.preco_promocional ? 'Preencha produto e preço promocional primeiro' : 'IA gera 3 variações de legenda'}
                className="inline-flex items-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={12} />Gerar legenda com IA
              </button>
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Enviando...' : 'Enviar para Aprovação'}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {promocoes.length === 0 ? <EmptyState message="Nenhuma proposta criada ainda" /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Produto</th>
                  <th className="pb-4 font-bold px-4 text-right">Preço Atual</th>
                  <th className="pb-4 font-bold px-4 text-right">Preço Promo</th>
                  <th className="pb-4 font-bold px-4">Período</th>
                  <th className="pb-4 font-bold px-4">Descrição</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4">Observação</th>
                  <th className="pb-4 font-bold px-4 text-center">Arte</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {promocoesFiltradas.length === 0
                    ? <tr><td colSpan={9} className="py-8 text-center text-sm text-gray-600 italic">Nenhuma promoção encontrada para "{searchPromo}"</td></tr>
                    : promocoesFiltradas.map((p: any) => {
                    const style = STATUS_STYLE[p.status];
                    return (
                      <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200 max-w-[200px] truncate" title={p.nome_produto ?? ''}>{p.nome_produto ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right">
                          R$ {Number(p.preco_atual || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-accent font-bold text-right">
                          R$ {Number(p.preco_promocional || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">
                          {p.data_inicio ?? '—'}{p.data_fim ? ` → ${p.data_fim}` : ''}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 max-w-[7rem] sm:max-w-[150px] truncate">{p.descricao ?? '—'}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${style?.badge ?? ''}`}>
                            {style?.icon}{p.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500 max-w-[6rem] sm:max-w-[180px] truncate">
                          {p.observacao ? (
                            <button
                              type="button"
                              onClick={() => setObsAberta(p)}
                              title="Ver observação completa"
                              className="inline-flex items-center gap-1.5 text-left text-gray-300 hover:text-accent transition-colors max-w-full"
                            >
                              <MessageSquare size={12} className="shrink-0 opacity-70" />
                              <span className="truncate">{p.observacao}</span>
                            </button>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {p.status === 'Aprovado' ? (() => {
                            const arte = arteByPromocao[p.id];
                            const fbList = arte ? (feedbacksByArte[arte.id] ?? []) : [];
                            const avg = fbList.length
                              ? (fbList.reduce((s, f) => s + (f.estrelas ?? 0), 0) / fbList.length).toFixed(1)
                              : null;

                            // Sem arte e sem permissão → célula vazia limpa.
                            if (!arte && !canPublicarArte) {
                              return <span className="text-[10px] text-gray-600">—</span>;
                            }
                            return (
                              <div className="flex flex-col items-center gap-1.5">
                                {canPublicarArte && (
                                  <button
                                    onClick={() => openArteModal(p)}
                                    title={arte ? 'Editar link da arte' : 'Publicar arte e notificar setores'}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                                      arte
                                        ? 'text-accent border-accent/40 bg-accent/10 hover:bg-accent/15'
                                        : 'text-gray-300 border-white/15 hover:text-accent hover:border-accent/40'
                                    }`}
                                  >
                                    {arte ? <><Edit3 size={10} /> Editar</> : <><ImagePlus size={10} /> Publicar</>}
                                  </button>
                                )}
                                {arte && (
                                  <button
                                    onClick={() => setFeedbackModal({ arte })}
                                    title="Ver feedback dos setores"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest text-gray-400 hover:text-yellow-400 border border-white/10 hover:border-yellow-400/40"
                                  >
                                    <Star size={9} className={avg ? 'fill-yellow-400 text-yellow-400' : ''} />
                                    {avg ? `${avg} · ${fbList.length}` : 'sem feedback'}
                                  </button>
                                )}
                              </div>
                            );
                          })() : <span className="text-[10px] text-gray-600">—</span>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canPublicarArte && (
                              <button onClick={() => gerarLegenda({ promocao: p })} title="Gerar legenda com IA"
                                className="action-btn-accent">
                                <Sparkles size={12} />
                              </button>
                            )}
                            <button onClick={() => handleDelete(p.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
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

      {/* Modal — Publicar/editar arte */}
      <AnimatePresence>
        {arteModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={closeArteModal}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ImagePlus size={16} className="text-accent" />
                  <h3 className="text-sm font-bold text-gray-200">
                    {arteModal.arte ? 'Editar arte' : 'Publicar arte da promoção'}
                  </h3>
                </div>
                <button onClick={closeArteModal}
                  className="modal-close-btn">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                <span className="font-bold text-gray-300">{arteModal.promocao.nome_produto}</span>
                {arteModal.promocao.descricao && <> · <span className="text-gray-400">{arteModal.promocao.descricao}</span></>}
              </p>
              <label htmlFor="promo-arte-url" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Link da arte *</label>
              <input
                id="promo-arte-url"
                type="url"
                value={arteUrl}
                onChange={e => setArteUrl(e.target.value)}
                placeholder="https://canva.com/... ou https://drive.google.com/..."
                className="neu-input rounded-xl px-3 py-2.5 text-sm w-full mt-1.5"
                autoFocus
              />
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                {arteModal.arte
                  ? 'O novo link substituirá o atual. O feedback já recebido continua válido.'
                  : 'Ao publicar, todos os setores receberão uma notificação com link direto pra arte.'}
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={closeArteModal} className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                  Cancelar
                </button>
                <NeuButtonAccent variant="" onClick={handleSaveArte} disabled={savingArte || !arteUrl.trim()}>
                  {savingArte
                    ? (arteModal.arte ? 'Salvando…' : 'Publicando…')
                    : (<><Send size={12} /> {arteModal.arte ? 'Salvar' : 'Publicar e Notificar'}</>)}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal — Feedback recebido (Marketing) */}
      <AnimatePresence>
        {feedbackModal && (() => {
          const fbList = feedbacksByArte[feedbackModal.arte.id] ?? [];
          const avg = fbList.length
            ? (fbList.reduce((s, f) => s + (f.estrelas ?? 0), 0) / fbList.length)
            : 0;
          return (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
              onClick={() => setFeedbackModal(null)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                onClick={e => e.stopPropagation()}
                className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <Star size={16} className="text-yellow-400 fill-yellow-400" />
                    <h3 className="text-sm font-bold text-gray-200">Feedback recebido</h3>
                  </div>
                  <button onClick={() => setFeedbackModal(null)}
                    className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                    <X size={14} />
                  </button>
                </div>

                <div className="neu-pressed rounded-2xl p-4 mb-4 shrink-0">
                  <p className="text-xs text-gray-400 mb-1">{feedbackModal.arte.nome_produto}</p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-black text-yellow-400">{fbList.length ? avg.toFixed(1) : '—'}</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(n => (
                        <Star key={n} size={14}
                          className={n <= Math.round(avg) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'} />
                      ))}
                    </div>
                    <span className="text-xs text-gray-500">· {fbList.length} {fbList.length === 1 ? 'avaliação' : 'avaliações'}</span>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto main-scrollbar pr-1 flex flex-col gap-2">
                  {fbList.length === 0 && (
                    <EmptyState message="Ainda sem feedback dos setores." />
                  )}
                  {fbList.map((f: any) => (
                    <div key={f.id} className="neu-flat rounded-xl p-3 border border-white/5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
                            {SETOR_LABEL[f.setor] ?? f.setor}
                          </span>
                          <span className="text-[10px] text-gray-500 truncate">{f.nome_user ?? '—'} · {f.role}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {[1, 2, 3, 4, 5].map(n => (
                            <Star key={n} size={11}
                              className={n <= (f.estrelas ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'} />
                          ))}
                        </div>
                      </div>
                      {f.comentario && (
                        <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{f.comentario}</p>
                      )}
                    </div>
                  ))}
                </div>

                <a
                  href={feedbackModal.arte.arte_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 shrink-0 inline-flex items-center justify-center gap-2 neu-button rounded-xl px-3 py-2 text-xs text-gray-300 hover:text-accent border border-white/10 hover:border-accent/40"
                >
                  <ExternalLink size={12} /> Abrir arte publicada
                </a>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Modal — Legendas geradas pela IA (Gemini via /api/ai-legenda) */}
      <AnimatePresence>
        {legendaModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setLegendaModal(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-accent" />
                  <h3 className="text-sm font-bold text-gray-200">Legendas geradas pela IA</h3>
                </div>
                <button onClick={() => setLegendaModal(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4 shrink-0">
                <span className="font-bold text-gray-300">{legendaModal.payload?.produto}</span>
                {' · '}
                <span className="text-accent">
                  R$ {Number(legendaModal.payload?.preco_promocional ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                {legendaModal.payload?.data_fim && <> · até <span className="text-gray-400">{legendaModal.payload.data_fim}</span></>}
              </p>

              {legendaModal.loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 size={28} className="text-accent animate-spin" />
                  <p className="text-xs text-gray-500">Gerando 3 variações...</p>
                </div>
              )}

              {legendaModal.erro && !legendaModal.loading && (
                <div className="neu-pressed rounded-xl p-4 text-xs text-red-400 leading-relaxed">
                  {legendaModal.erro}
                </div>
              )}

              {legendaModal.legendas && legendaModal.legendas.length > 0 && (
                <div className="flex-1 overflow-y-auto main-scrollbar pr-1 flex flex-col gap-3">
                  {legendaModal.legendas.map((l, idx) => (
                    <div key={idx} className="neu-flat rounded-xl p-4 border border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-accent">
                          Tom {l.tom}
                        </span>
                        <span className="text-[10px] text-gray-500 tabular-nums">{l.texto.length} chars</span>
                      </div>
                      <p className="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">{l.texto}</p>
                      <div className="flex justify-end gap-2 mt-3">
                        {legendaModal.aplicarNaDescricao && (
                          <button onClick={() => usarLegendaNaDescricao(l.texto)}
                            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors">
                            Usar
                          </button>
                        )}
                        <button onClick={() => copiarLegenda(l.texto, idx)}
                          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 border border-white/10 rounded-lg px-3 py-1.5 hover:text-accent hover:border-accent/30 transition-colors">
                          {legendaCopiada === idx ? <CheckCircle2 size={10} /> : <Copy size={10} />}
                          {legendaCopiada === idx ? 'copiado' : 'copiar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-gray-600 mt-3 shrink-0 leading-relaxed">
                As sugestões são geradas por IA — revise antes de publicar.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal — observação completa (ex: motivo da reprovação pelo Financeiro) */}
      <AnimatePresence>
        {obsAberta && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setObsAberta(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-accent" />
                  <h3 className="text-sm font-bold text-gray-200">Observação do Financeiro</h3>
                </div>
                <button onClick={() => setObsAberta(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                <span className="font-bold text-gray-300">{obsAberta.nome_produto ?? 'Promoção'}</span>
                {' · '}
                <span className={STATUS_STYLE[obsAberta.status]?.badge ? `${STATUS_STYLE[obsAberta.status].badge} px-2 py-0.5 rounded-full border text-[10px] font-bold` : ''}>
                  {obsAberta.status}
                </span>
              </p>
              <div className="neu-pressed rounded-xl p-4 text-sm text-gray-200 whitespace-pre-wrap break-words">
                {obsAberta.observacao}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const PromocoesMarketingView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <PromocoesMarketingViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
