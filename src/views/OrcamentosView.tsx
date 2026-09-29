import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Trash2, Check, X, Send, MessageSquare, Loader2, ShoppingBag, Clock, FileText, FileDown, Sheet, Eye, AlertTriangle, User, ShoppingCart, CreditCard, MessageSquareText, Calculator } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { numeroOrcamento } from '../lib/documentos';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { useTravaAtualizacao } from '../hooks/useTravaAtualizacao';
import { ehVendavel } from '../lib/tipoProduto';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination, ExportButton, TextoModal, SecaoFormulario, ModalFormulario, CardContador, type TomContador } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, exportToPDFAgrupado, exportToExcelAgrupado, handleMoneyKeyDown } from '../lib/viewUtils';
import {
  calcularCondicao, parcelasMaximas, rotuloCondicao, vencimentosPrevistos,
  type FormaPagamento,
} from '../lib/condicaoPagamento';
import { supabase } from '../lib/supabase';
import { hasSetor, isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { notificarSetor } from '../lib/notificar';
import { SelectBusca } from '../components/SelectBusca';
import { gruposDeCadastro } from '../lib/cadastrosSelect';
import { opcaoProduto } from '../lib/opcoesSelect';
import { ehPrestado } from '../lib/naturezaServico';


interface ItemOrcamento {
  produto_id: string;
  /** Migr. 660: serviço prestado (mão de obra, instalação). `produto_id` fica vazio. */
  servico_id?: string | null;
  nome: string;
  qtd: number;
  preco_unitario: number;
  subtotal: number;
}

// Lista canônica dos status do documento. Não é usada em runtime desde que
// as abas passaram a agrupar por fase — quem a consome é
// tests/orcamentoFases.test.ts, que falha se algum status ficar sem aba.
// Status novo entra AQUI e em FASES, nessa ordem.
const STATUS_LIST = [
  'Rascunho',
  'Aguardando Financeiro',
  'Aprovado Financeiro',
  'Reprovado Financeiro',
  'Enviado ao Cliente',
  'Aprovado Cliente',
  'Reprovado Cliente',
  'Convertido em Pedido',
  'Expirado',
  'Cancelado',
] as const;

// Os dez status enfileirados numa régua só não diziam nada sobre o
// documento: 'Aguardando Financeiro' e 'Cancelado' apareciam com o mesmo
// peso, lado a lado, e achar "o que está comigo agora" exigia ler os dez.
// Agrupados por FASE do ciclo, a pergunta que a tela responde vira "de quem
// é a bola" — que é a pergunta que o vendedor faz.
//
// A ordem é a do fluxo: nasce em elaboração, passa pelo Financeiro, vai ao
// cliente, e termina ganho ou encerrado.
const FASES = [
  { id: 'elaboracao', label: 'Em elaboração',    dica: 'Rascunho ainda com Vendas',            status: ['Rascunho'] },
  { id: 'financeiro', label: 'Com o Financeiro', dica: 'Esperando aprovação interna',          status: ['Aguardando Financeiro'] },
  { id: 'cliente',    label: 'Com o cliente',    dica: 'Liberado ou já enviado ao cliente',    status: ['Aprovado Financeiro', 'Enviado ao Cliente'] },
  { id: 'ganhos',     label: 'Ganhos',           dica: 'Cliente aceitou',                      status: ['Aprovado Cliente', 'Convertido em Pedido'] },
  { id: 'encerrados', label: 'Encerrados',       dica: 'Sem seguimento: reprovado, expirado ou cancelado',
    status: ['Reprovado Financeiro', 'Reprovado Cliente', 'Expirado', 'Cancelado'] },
] as const;

type FaseId = typeof FASES[number]['id'] | 'todos';

const TOM_FASE: Record<typeof FASES[number]['id'], TomContador> = {
  elaboracao: 'azul', financeiro: 'amarelo', cliente: 'roxo', ganhos: 'verde', encerrados: 'vermelho',
};

const OrcamentosViewInner = ({
  showToast, profile, mode, filial,
}: {
  showToast: any;
  profile: UserProfile;
  mode?: 'vendas' | 'financeiro';
  filial: FilialOp;
}) => {
  const confirm = useConfirm();
  const [page, setPage] = useState(0);
  // Fase do ciclo (a aba) e, dentro dela, o status exato (o refino). Separar
  // os dois é o que permite a régua curta em cima sem perder o filtro fino
  // que a tela tinha: quem quer só 'Cancelado' continua chegando lá, em dois
  // cliques em vez de garimpar entre dez botões iguais.
  const [fase, setFase] = useState<FaseId>(mode === 'financeiro' ? 'financeiro' : 'todos');
  const [statusFino, setStatusFino] = useState<string | null>(null);
  useEffect(() => { setPage(0); }, [fase, statusFino]);

  const faseAtual = FASES.find(f => f.id === fase) ?? null;
  // O filtro vai para o SERVIDOR. Antes ele recortava o array já paginado:
  // com 50 por página, filtrar por 'Cancelado' mostrava só os cancelados que
  // por acaso caíssem na página aberta — a tela dizia "nenhum orçamento"
  // havendo dezenas, e o rodapé seguia contando o total sem filtro.
  const statusFiltrados: string[] | null =
    statusFino ? [statusFino] : faseAtual ? [...faseAtual.status] : null;
  const filtroLista = useMemo(
    () => (statusFiltrados ? { filial, status: statusFiltrados } : { filial }),
    [filial, statusFiltrados?.join('|')], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/orcamentosview', filtroLista, true,
    { page }
  );
  const { data: clientes } = useFetchData<any>('/api/crmview', { filial });
  // Formas de pagamento da unidade (Empresa → Formas de Pagamento). É este
  // cadastro que define desconto à vista, juros, teto de parcelas e taxa —
  // migr. 568.
  const { data: formasPagamento } = useFetchData<any>('/api/formaspagamentoview', { filial });
  // View mascarada: usa custo para margem do orçamento (migr. 262).
  const { data: produtos } = useFetchData<any>('/api/produtoscomcustoview', { filial });
  // Migr. 660: serviços PRESTADOS da unidade entram no orçamento como item. Na
  // conversão viram venda no Anexo III e NFS-e; a separação os pula.
  const { data: servicosCad } = useFetchData<any>('/api/servicosview', { filial });
  const servicosAtivos = useMemo(() => (servicosCad ?? [])
    .filter((s: any) => ehPrestado(s.natureza) && s.ativo !== false && !s.excluido_em
      && (s.status ?? 'Ativo') === 'Ativo' && Number(s.valor ?? 0) > 0)
    .sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')), [servicosCad]);

  // Ofertas valendo hoje (MIGR 578). O orçamento é uma proposta de venda: tem
  // de sair pelo preço que o caixa vai cobrar. Com a promoção virando regra de
  // preço, `produtos.preco` é o de tabela — orçar por ele prometeria ao cliente
  // um preço acima do que a loja está anunciando.
  const [ofertas, setOfertas] = useState<Map<string, { de: number; por: number }>>(new Map());
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('v_promocao_vigente')
        .select('produto_id, preco_de, preco_por')
        .eq('filial', filial);
      if (!vivo || error) return;
      const mapa = new Map<string, { de: number; por: number }>();
      for (const o of data ?? []) {
        mapa.set(String(o.produto_id), { de: Number(o.preco_de ?? 0), por: Number(o.preco_por ?? 0) });
      }
      setOfertas(mapa);
    })();
    return () => { vivo = false; };
  }, [filial]);

  /** Preço de venda de hoje: oferta vigente, se houver; senão o de tabela. */
  const precoDeVenda = (p: any): number =>
    ofertas.get(String(p?.id))?.por ?? (Number(p?.preco) || 0);

  const isVendas       = hasSetor(profile, 'vendas');
  const isFinanceiro   = hasSetor(profile, 'financeiro');
  const isAdminOuCeo   = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const isGerente      = profile.role === 'gerente';
  const podeDecidirFin = isFinanceiro || isAdminOuCeo || isGerente;
  const podeCriarVenda = isVendas || isAdminOuCeo || isGerente;

  // Modo financeiro = aba "Aprovações de Orçamento" no Financeiro;
  // foca em decisões e oculta o botão de criar.
  const modoFinanceiro = mode === 'financeiro';

  const [isSaving, setIsSaving] = useState(false);
  // Ver nota igual à de CotacoesView: o feedback é longo e precisa ficar na
  // tela até o aluno terminar de ler.
  const [feedbackAberto, setFeedbackAberto] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [convertendo, setConvertendo] = useState<string | null>(null);
  const [enviandoCliente, setEnviandoCliente] = useState<string | null>(null);

  // Form
  const [form, setForm] = useState({ cliente_id: '', validade_dias: '3' });
  const [itens, setItens] = useState<ItemOrcamento[]>([]);
  // Item já adicionado não tem campo na tela — é linha numa lista em memória, e
  // por isso a rede genérica de "campo preenchido" não o vê. Uma proposta com
  // seis produtos escolhidos some inteira se a PWA recarregar por baixo.
  useTravaAtualizacao(itens.length > 0, 'orcamento-em-montagem',
    'há um orçamento em montagem, ainda sem enviar');
  const [extras, setExtras] = useState({ desconto: '', observacoes: '' });
  // Condição de pagamento: qual forma e em quantas vezes. O preço sai daqui.
  const [condicao, setCondicao] = useState({ forma_pagamento_id: '', parcelas: '1' });
  const [produtoBusca, setProdutoBusca] = useState('');
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Modal de decisão Financeiro
  const [decisao, setDecisao] = useState<{ orc: any; tipo: 'aprovar' | 'reprovar' } | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [decidindo, setDecidindo] = useState(false);
  // Modal read-only de detalhes da proposta (qualquer setor com acesso à view).
  const [detalhes, setDetalhes] = useState<any | null>(null);

  const produtosAtivos = useMemo(
    () => produtos.filter((p: any) => (p.status ?? 'Ativo') !== 'Inativo' && ehVendavel(p.tipo)),
    [produtos]
  );

  // Produtos da filial, ordenados alfabeticamente.
  const produtosOrdenados = useMemo(() =>
    [...produtosAtivos].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR', { sensitivity: 'base' })),
    [produtosAtivos]
  );

  // Filtro de busca sobre produtosOrdenados.
  const produtosFiltrados = useMemo(() => {
    const termo = produtoBusca.trim().toLowerCase();
    if (!termo) return produtosOrdenados;
    return produtosOrdenados.filter((p: any) =>
      (p.nome ?? '').toLowerCase().includes(termo) ||
      (p.codigo ?? '').toLowerCase().includes(termo)
    );
  }, [produtosOrdenados, produtoBusca]);

  const exportarProdutosPDF = async () => {
    await exportToPDFAgrupado(
      `Catálogo de Produtos — ${filial}`,
      ['Código', 'Nome', 'Preço (R$)'],
      [{ titulo: filial, rows: produtosOrdenados.map((p: any) => [p.codigo ?? '—', p.nome ?? '', Number(p.preco || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })]) }],
      'logmax-catalogo-produtos',
    );
  };

  const exportarProdutosExcel = async () => {
    await exportToExcelAgrupado(
      ['Código', 'Nome', 'Preço'],
      [{ titulo: filial, rows: produtosOrdenados.map((p: any) => [p.codigo ?? '', p.nome ?? '', Number(p.preco || 0)]) }],
      'logmax-catalogo-produtos',
    );
  };

  const subtotal = useMemo(
    () => itens.reduce((s, it) => s + it.subtotal, 0),
    [itens]
  );
  const descontoNum = parseBRL(extras.desconto);

  // Só as formas ativas da unidade entram no select — cadastro inativo o banco
  // recusa, e oferecer o que vai ser recusado é a armadilha da lista suspensa.
  const formasAtivas: FormaPagamento[] = useMemo(
    () => (formasPagamento as FormaPagamento[])
      .filter(f => (f.status ?? 'Ativo') === 'Ativo')
      .sort((a, b) => (a.descricao ?? '').localeCompare(b.descricao ?? '', 'pt-BR', { sensitivity: 'base' })),
    [formasPagamento]
  );

  const formaEscolhida = useMemo(
    () => formasAtivas.find(f => f.id === condicao.forma_pagamento_id) ?? null,
    [formasAtivas, condicao.forma_pagamento_id]
  );

  const parcelasNum = Math.max(1, parseInt(condicao.parcelas) || 1);
  const maxParcelas = parcelasMaximas(formaEscolhida);

  // PRÉVIA. O número que fica gravado é o que o gatilho do banco recalcula no
  // INSERT/UPDATE (migr. 568) — aqui é só para o vendedor ver a conta antes de
  // salvar. As duas contas são a mesma; ver src/lib/condicaoPagamento.ts.
  const resumo = useMemo(
    () => calcularCondicao(subtotal, descontoNum, formaEscolhida, parcelasNum),
    [subtotal, descontoNum, formaEscolhida, parcelasNum]
  );
  const valorTotal = resumo.valorTotal;

  const vencimentos = useMemo(
    () => vencimentosPrevistos(formaEscolhida, resumo.parcelas, new Date()),
    [formaEscolhida, resumo.parcelas]
  );

  // Crediário é crédito da própria loja: o teto é o do cliente. A conversão em
  // pedido TRAVA (migr. 569); aqui é só o aviso, porque no momento da proposta
  // a compra ainda não aconteceu e o cliente pode acertar antes de aprovar.
  const ehCrediario = !!formaEscolhida?.exige_limite_credito;
  const [credito, setCredito] = useState<{ saldo: number; vencidos: number } | null>(null);
  useEffect(() => {
    let cancelado = false;
    if (!ehCrediario || !form.cliente_id || !supabase) { setCredito(null); return; }
    (async () => {
      try {
        const [s, v] = await Promise.all([
          supabase.rpc('cliente_saldo_devedor',   { p_cliente_id: form.cliente_id }),
          supabase.rpc('cliente_titulos_vencidos', { p_cliente_id: form.cliente_id }),
        ]);
        if (!cancelado) setCredito({ saldo: Number(s.data ?? 0), vencidos: Number(v.data ?? 0) });
      } catch {
        if (!cancelado) setCredito(null);
      }
    })();
    return () => { cancelado = true; };
  }, [ehCrediario, form.cliente_id]);

  const limiteCliente = useMemo(() => {
    const c = clientes.find((x: any) => x.id === form.cliente_id);
    const v = c?.limite_credito;
    return v == null || v === '' ? null : Number(v);
  }, [clientes, form.cliente_id]);

  const estouraLimite = ehCrediario && credito != null && limiteCliente != null
    && credito.saldo + valorTotal > limiteCliente;

  const enriched = data.map((o: any) => ({
    ...o,
    cliente: clientes.find((c: any) => c.id === o.cliente_id),
  }));

  // Sem recorte aqui: `filtroLista` já pediu ao banco só o que a aba mostra.
  const filtrados = enriched;

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ cliente_id: '', validade_dias: '3' });
    setItens([]);
    setExtras({ desconto: '', observacoes: '' });
    setCondicao({ forma_pagamento_id: '', parcelas: '1' });
    setProdutoBusca('');
    setErrors({});
  };

  const openEdit = (orc: any) => {
    setEditItem(orc);
    setForm({
      cliente_id: orc.cliente_id ?? '',
      validade_dias: String(orc.validade_dias ?? 3),
    });
    setItens(Array.isArray(orc.itens) ? orc.itens : []);
    setExtras({
      desconto: orc.desconto ? formatBRL(Number(orc.desconto)) : '',
      observacoes: orc.observacoes ?? '',
    });
    setCondicao({
      forma_pagamento_id: orc.forma_pagamento_id ?? '',
      parcelas: String(orc.parcelas ?? 1),
    });
    setErrors({});
    setShowForm(false);
  };

  // Itens helpers ─────────────────────────────────────────────────────────
  const addItem = () => {
    setItens(prev => [...prev, { produto_id: '', nome: '', qtd: 1, preco_unitario: 0, subtotal: 0 }]);
  };
  const removeItem = (idx: number) => {
    setItens(prev => prev.filter((_, i) => i !== idx));
  };
  const updateItem = (idx: number, patch: Partial<ItemOrcamento>) => {
    setItens(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      next.subtotal = Math.round((Number(next.qtd) || 0) * (Number(next.preco_unitario) || 0) * 100) / 100;
      return next;
    }));
  };
  const escolherProduto = (idx: number, produtoId: string) => {
    if (produtoId.startsWith('srv:')) {
      const s = servicosAtivos.find((x: any) => x.id === produtoId.slice(4));
      updateItem(idx, s
        ? { produto_id: '', servico_id: s.id, nome: s.nome, preco_unitario: Number(s.valor) }
        : { produto_id: '', servico_id: null, nome: '', preco_unitario: 0 });
      return;
    }
    const p = produtosAtivos.find((pr: any) => pr.id === produtoId);
    if (!p) {
      updateItem(idx, { produto_id: '', servico_id: null, nome: '', preco_unitario: 0 });
      return;
    }
    updateItem(idx, {
      servico_id: null,
      produto_id: p.id,
      nome: p.nome,
      preco_unitario: precoDeVenda(p),
    });
  };

  // SAVE (rascunho ou edição de rascunho) ──────────────────────────────────
  const handleSave = async (enviarAoFinanceiro: boolean) => {
    if (!validate()) return;
    if (itens.length === 0) {
      showToast('Adicione pelo menos um item.', 'error', true);
      return;
    }
    if (itens.some(it => (!it.produto_id && !it.servico_id) || it.qtd <= 0)) {
      showToast('Cada item precisa de produto ou serviço e quantidade > 0.', 'error', true);
      return;
    }

    setIsSaving(true);
    try {
      const payload: any = {
        cliente_id:    form.cliente_id || null,
        vendedor_id:   editItem ? editItem.vendedor_id : profile.id,
        vendedor_nome: editItem ? editItem.vendedor_nome : profile.nome,
        validade_dias: Math.max(1, parseInt(form.validade_dias) || 3),
        // Serviço vai com produto_id nulo: é o que a conversão (migr. 660) lê.
        itens: itens.map(it => it.servico_id ? { ...it, produto_id: null } : { ...it, servico_id: null }),
        subtotal,
        desconto:      descontoNum,
        // `valor_total` e os derivados vão junto para a tela não piscar com o
        // valor antigo até o retorno, mas quem manda é o gatilho da migr. 568:
        // ele recalcula tudo no INSERT/UPDATE e devolve o número oficial.
        valor_total:   valorTotal,
        forma_pagamento_id: condicao.forma_pagamento_id || null,
        parcelas:      resumo.parcelas,
        observacoes:   extras.observacoes || null,
        status:        enviarAoFinanceiro ? 'Aguardando Financeiro' : 'Rascunho',
        filial,
      };

      let saved: any;
      if (editItem) {
        saved = await dbUpdate('/api/orcamentosview', editItem.id, payload);
        setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (saved ?? { ...d, ...payload }) : d));
      } else {
        saved = await dbInsert('/api/orcamentosview', payload);
        if (saved) setData((prev: any[]) => [saved, ...prev]);
      }

      if (enviarAoFinanceiro && saved) {
        const cli = clientes.find((c: any) => c.id === form.cliente_id);
        await notificarSetor({
          setor:     'financeiro',
          tipo:      'aprovacao_pendente',
          titulo:    'Nova proposta comercial aguardando aprovação',
          mensagem:  `${cli?.nome ?? 'Cliente'} — R$ ${formatBRL(valorTotal)}`,
          link_view: 'financeiro-aprovaçõesdeorçamento',
          urgencia:  'Média',
          ref_id:    saved.id,
          filial,
        });
        showToast('Proposta enviada ao Financeiro.', 'success', true);
      } else {
        showToast(editItem ? 'Rascunho atualizado.' : 'Rascunho salvo.', 'success', true);
      }
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Financeiro decide ──────────────────────────────────────────────────────
  const handleConfirmDecisao = async () => {
    if (!decisao) return;
    const { orc, tipo } = decisao;
    const feedback = feedbackInput.trim();
    if (tipo === 'reprovar' && !feedback) {
      showToast('Feedback é obrigatório para reprovar.', 'error', true);
      return;
    }

    setDecidindo(true);
    try {
      const novoStatus = tipo === 'aprovar' ? 'Aprovado Financeiro' : 'Reprovado Financeiro';
      const updates: any = {
        status: novoStatus,
        feedback_financeiro:     feedback || null,
        decidido_financeiro_em:  new Date().toISOString(),
        decidido_financeiro_por: profile.id,
      };
      await dbUpdate('/api/orcamentosview', orc.id, updates);
      setData((prev: any[]) => prev.map(o => o.id === orc.id ? { ...o, ...updates } : o));

      const cli = orc.cliente?.nome ?? clientes.find((c: any) => c.id === orc.cliente_id)?.nome ?? 'Cliente';
      await notificarSetor({
        setor:     'vendas',
        tipo:      tipo === 'aprovar' ? 'aprovado' : 'reprovado',
        titulo:    tipo === 'aprovar'
                     ? 'Proposta aprovada pelo Financeiro'
                     : 'Proposta reprovada pelo Financeiro',
        mensagem:  `${cli} — R$ ${formatBRL(Number(orc.valor_total ?? 0))}`,
        link_view: 'vendas-orçamentos',
        urgencia:  tipo === 'aprovar' ? 'Média' : 'Alta',
        ref_id:    orc.id,
        motivo:    tipo === 'reprovar' ? feedback : undefined,
        filial:    orc.filial ?? filial,
      });

      showToast(tipo === 'aprovar' ? 'Proposta aprovada.' : 'Proposta reprovada.', 'success', true);
      setDecisao(null);
      setFeedbackInput('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setDecidindo(false);
    }
  };

  // Vendas → enviar ao cliente (registra a saída; cliente decide via ClienteEspecialView no MVP)
  const handleEnviarCliente = async (orc: any) => {
    setEnviandoCliente(orc.id);
    try {
      const updates = {
        status: 'Enviado ao Cliente',
        enviado_cliente_em: new Date().toISOString(),
      };
      await dbUpdate('/api/orcamentosview', orc.id, updates);
      setData((prev: any[]) => prev.map(o => o.id === orc.id ? { ...o, ...updates } : o));
      showToast('Proposta enviada ao cliente. Aguardando decisão.', 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setEnviandoCliente(null);
    }
  };

  // Vendas → converter em pedido (chama RPC)
  const handleConverter = async (orc: any) => {
    if (!supabase) return;
    setConvertendo(orc.id);
    try {
      const { data: pedidoId, error } = await supabase.rpc('converter_orcamento_em_pedido', {
        p_orcamento_id: orc.id,
      });
      if (error) throw error;
      setData((prev: any[]) => prev.map(o => o.id === orc.id
        ? { ...o, status: 'Convertido em Pedido', pedido_venda_id: pedidoId }
        : o
      ));
      // O número real do pedido nasce no trigger (migr. 338); a RPC devolve só
      // o id. Buscar aqui evita mostrar um identificador que não existe em
      // nenhuma outra tela.
      let rotulo = `#${String(pedidoId).slice(-6).toUpperCase()}`;
      try {
        const { data: pv } = await supabase
          .from('pedidos_venda').select('numero').eq('id', pedidoId).maybeSingle();
        if (pv?.numero) rotulo = pv.numero;
      } catch { /* rótulo do id serve */ }
      showToast(`${numeroOrcamento(orc)} virou o pedido de venda ${rotulo}.`, 'success', true);
    } catch (err: any) {
      showToast(`Falha ao converter: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setConvertendo(null);
    }
  };

  const handleCancelar = async (id: string) => {
    if (!await confirm('Cancelar este orçamento?')) return;
    try {
      const updated = await dbUpdate('/api/orcamentosview', id, { status: 'Cancelado' });
      setData((prev: any[]) => prev.map(o => o.id === id ? (updated ?? { ...o, status: 'Cancelado' }) : o));
      showToast('Orçamento cancelado.', 'info', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  // `handleDelete` saiu daqui (migr. 552). Ele perguntava "Inativar este
  // orçamento?" e gravava `ativo = false` — inclusive num orçamento já
  // convertido, deixando `pedidos_venda.orcamento_id` apontando para documento
  // morto. Orçamento entrou na mesma régua de requisição, cotação e pedido:
  // documento é rastro, cancela-se. O banco agora recusa a inativação.

  // Contagem por status para os números das abas. Precisa ser consulta
  // própria: `data` é uma página de 50 e `totalCount` só conhece o filtro
  // corrente, então nenhum dos dois sabe quantos existem nas OUTRAS abas.
  //
  // `head: true` + `count: 'exact'`, um por status: só o número trafega, e
  // o número é do banco. Trazer as linhas e contar no cliente parece mais
  // simples, mas o PostgREST tem teto de linhas por resposta — passando
  // dele a contagem sairia CALADAMENTE menor do que a realidade, que é a
  // pior falha possível num contador (ninguém desconfia de um número).
  const [contagemStatus, setContagemStatus] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    let vivo = true;
    (async () => {
      const pares = await Promise.all(STATUS_LIST.map(async st => {
        const { count, error } = await sb
          .from('orcamentos')
          .select('id', { count: 'exact', head: true })
          .eq('filial', filial)
          .eq('ativo', true)
          .eq('status', st);
        return [st, error ? 0 : (count ?? 0)] as const;
      }));
      if (!vivo) return;
      setContagemStatus(Object.fromEntries(pares));
    })();
    return () => { vivo = false; };
    // `data` na dependência mantém os números em dia quando a lista muda
    // (criou, aprovou, converteu) — inclusive pelo realtime da própria tela.
  }, [filial, data]);

  const contarStatus = (lista: readonly string[]) =>
    lista.reduce((n, st) => n + (contagemStatus[st] ?? 0), 0);
  const totalGeral = Object.values(contagemStatus).reduce((a, b) => a + b, 0);

  // Expirado helper (visual): considera expirado se passa data_emissao + validade_dias
  // e ainda está em status que esperam ação. Não muda no banco aqui (cliente_especial
  // ou um cron futuro fariam o flip oficial); só destaca em vermelho.
  // `data_emissao` chega como 'AAAA-MM-DD'; a conta é feita em UTC puro para
  // o fuso do navegador não puxar a data um dia para trás.
  const dataCurta = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null);
  const validadeAte = (orc: any) => {
    if (!orc.data_emissao) return null;
    const [y, m, d] = String(orc.data_emissao).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    const fim = new Date(Date.UTC(y, m - 1, d + Number(orc.validade_dias ?? 3)));
    return `${String(fim.getUTCDate()).padStart(2, '0')}/${String(fim.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  const isExpirado = (orc: any) => {
    if (!orc.data_emissao) return false;
    const emissao = new Date(orc.data_emissao);
    const limite = new Date(emissao.getTime() + Number(orc.validade_dias ?? 3) * 86400000);
    const ativos = ['Rascunho', 'Aguardando Financeiro', 'Aprovado Financeiro', 'Enviado ao Cliente'];
    return ativos.includes(orc.status) && new Date() > limite;
  };


  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            {modoFinanceiro ? `Aprovações de Orçamento — ${filial}` : `Orçamentos & Propostas — ${filial}`}
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!modoFinanceiro && podeCriarVenda && (
            <>
              <ExportButton label="PDF" onClick={exportarProdutosPDF} icon={FileDown} />
              <ExportButton label="Excel" onClick={exportarProdutosExcel} icon={Sheet} />
              <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
                <Plus size={16} /> Nova Proposta
              </NeuButtonAccent>
            </>
          )}
        </div>
      </div>

      {/* Filtro em duas camadas: a fase do ciclo (sempre visível) e, dentro
          dela, o status exato (só quando a fase reúne mais de um). */}
      <div className="flex flex-col gap-2 shrink-0">
        {/* Uma fase por card: o número é o contador e o clique filtra. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {FASES.map(f => (
            <CardContador key={f.id} label={f.label} value={contarStatus(f.status)} tom={TOM_FASE[f.id]}
              ativo={fase === f.id} corFixa
              onClick={() => { setFase(fase === f.id ? 'todos' : f.id); setStatusFino(null); }} />
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => { setFase('todos'); setStatusFino(null); }}
            className={`py-1.5 px-3 rounded-lg text-[11px] font-bold uppercase tracking-widest border transition-all ${
              fase === 'todos' ? 'bg-accent border-accent text-black' : 'border-white/10 text-gray-400 hover:text-gray-200'
            }`}
          >
            Todos ({totalGeral})
          </button>
          {faseAtual && <span className="text-xs text-gray-500">Filtrando: <b className="text-gray-300">{faseAtual.label}</b></span>}
        </div>

        {/* Refino: os status de dentro da fase. Fase de um status só não
            ganha esta linha — repetir o nome da aba logo abaixo dela não
            acrescenta nada e é o tipo de ruído que fez a régua antiga
            crescer até dez botões. */}
        {faseAtual && faseAtual.status.length > 1 && (
          <div className="flex gap-2 flex-wrap items-center pl-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 font-bold">Situação:</span>
            <button
              type="button"
              onClick={() => setStatusFino(null)}
              className={`py-1 px-2.5 rounded-lg text-[10px] font-bold transition-all ${
                statusFino === null ? 'text-accent bg-accent/10' : 'text-gray-500 hover:text-gray-300'
              }`}
            >Todas ({contarStatus(faseAtual.status)})</button>
            {faseAtual.status.map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFino(st)}
                className={`py-1 px-2.5 rounded-lg text-[10px] font-bold transition-all ${
                  statusFino === st ? 'text-accent bg-accent/10' : 'text-gray-500 hover:text-gray-300'
                }`}
              >{st} ({contagemStatus[st] ?? 0})</button>
            ))}
          </div>
        )}
      </div>

      {/* Form de criação/edição */}
      <AnimatePresence>
        <ModalFormulario
          aberto={!!((showForm || editItem) && !modoFinanceiro)}
          largura="xl"
          titulo={editItem ? 'Editar Proposta' : 'Nova Proposta'}
          onCancelar={closeForm}
          acoes={<>
            <button
              onClick={() => handleSave(false)}
              disabled={isSaving}
              className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-gray-300 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save size={14} /> Salvar Rascunho
            </button>
            <NeuButtonAccent onClick={() => handleSave(true)} isLoading={isSaving}>
              <Send size={14} /> Enviar ao Financeiro
            </NeuButtonAccent>
          </>}
        >
          {/* Seções em pares, como em Requisição e Cotação: empilhadas na
              largura toda, o vendedor descia a tela inteira para montar a proposta. */}
          <div className="grid grid-cols-1 @5xl:grid-cols-2 gap-5">
          <SecaoFormulario titulo="Cliente" icon={User} cor="amarelo">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
            <FormField label="Cliente *" error={errors.cliente_id} className="sm:col-span-2">
              <SelectBusca
                value={form.cliente_id}
                onChange={v => { setForm(f => ({ ...f, cliente_id: v })); clearError('cliente_id'); }}
                placeholder="Escolha o cliente"
                grupos={gruposDeCadastro(clientes)}
              />
            </FormField>
            <FormField label="Validade (dias) *">
              <input
                type="number"
                min="1"
                className="neu-input py-2 px-3 rounded-xl text-sm"
                value={form.validade_dias}
                onChange={e => setForm(f => ({ ...f, validade_dias: e.target.value }))}
              />
            </FormField>
          </div>
          </SecaoFormulario>

          <SecaoFormulario titulo="Pagamento" icon={CreditCard} cor="azul">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
            <FormField label="Desconto (R$)">
              <input
                type="text"
                inputMode="numeric"
                className="neu-input py-2 px-3 rounded-xl text-sm"
                value={extras.desconto}
                onChange={e => setExtras(x => ({ ...x, desconto: formatBRL(e.target.value) }))}
                onKeyDown={handleMoneyKeyDown}
                placeholder="0,00"
              />
            </FormField>
            <FormField label="Forma de pagamento">
              <select
                className="neu-input py-2 px-3 rounded-xl text-sm"
                value={condicao.forma_pagamento_id}
                onChange={e => {
                  const id = e.target.value;
                  const f = formasAtivas.find(x => x.id === id) ?? null;
                  // Trocar de forma pode baixar o teto de parcelas: 6x no
                  // cartão não sobrevive à mudança para Pix.
                  const teto = parcelasMaximas(f);
                  setCondicao(c => ({
                    forma_pagamento_id: id,
                    parcelas: String(Math.min(Math.max(1, parseInt(c.parcelas) || 1), teto)),
                  }));
                }}
              >
                <option value="">A combinar</option>
                {formasAtivas.map(f => (
                  <option key={f.id} value={f.id}>{f.descricao}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Parcelas">
              <select
                className="neu-input py-2 px-3 rounded-xl text-sm disabled:opacity-40"
                value={String(Math.min(parcelasNum, maxParcelas))}
                disabled={!formaEscolhida || maxParcelas <= 1}
                onChange={e => setCondicao(c => ({ ...c, parcelas: e.target.value }))}
              >
                {Array.from({ length: maxParcelas }, (_, i) => i + 1).map(n => (
                  <option key={n} value={String(n)}>
                    {n === 1 ? 'À vista' : `${n}x`}
                    {formaEscolhida && n > Math.max(1, Number(formaEscolhida.parcelas_sem_juros ?? 1)) && Number(formaEscolhida.juros_mensal ?? 0) > 0
                      ? ' (com juros)' : ''}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {/* Crediário: o dinheiro é da própria loja. Aviso agora, trava na
              conversão em pedido (migr. 569). */}
          {ehCrediario && (
            <div className={`mt-4 rounded-xl p-3 text-xs flex items-start gap-2 border ${
              (credito?.vencidos ?? 0) > 0 || estouraLimite
                ? 'border-red-500/30 bg-red-500/5 text-red-300'
                : 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300'}`}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">Crediário — crédito da própria loja</span>
                {!form.cliente_id ? (
                  <span>Selecione o cliente para consultar o limite.</span>
                ) : credito == null ? (
                  <span>Consultando o crédito do cliente…</span>
                ) : (
                  <>
                    <span>
                      Limite: {limiteCliente == null ? 'não cadastrado' : `R$ ${formatBRL(limiteCliente)}`}
                      {' · '}Já em aberto: R$ {formatBRL(credito.saldo)}
                      {' · '}Esta proposta: R$ {formatBRL(valorTotal)}
                    </span>
                    {credito.vencidos > 0 && (
                      <span className="font-bold">
                        {credito.vencidos} título(s) vencido(s) — a conversão em pedido será recusada até a baixa em Financeiro → Contas a Receber.
                      </span>
                    )}
                    {estouraLimite && (
                      <span className="font-bold">Passa do limite do cliente — a conversão em pedido será recusada.</span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          </SecaoFormulario>

          <SecaoFormulario titulo="Itens da proposta" icon={ShoppingCart} cor="vermelho"
            extra={`${itens.length} ite${itens.length === 1 ? 'm' : 'ns'}`}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={produtoBusca}
                  onChange={e => setProdutoBusca(e.target.value)}
                  placeholder="Buscar produto por nome ou código..."
                  className="neu-input py-1.5 px-3 rounded-lg text-xs flex-1"
                />
                <button onClick={addItem} className="btn-solido btn-solido--amarelo !py-1.5 !px-3 !text-[11px] shrink-0">
                  <Plus size={11} /> Adicionar item
                </button>
              </div>
            </div>
            {itens.length === 0 ? (
              <p className="text-xs text-gray-600 py-3 text-center">Nenhum item ainda — adicione produtos do catálogo.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {itens.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center neu-pressed rounded-xl p-3">
                    <SelectBusca
                      compacto
                      className="col-span-5"
                      value={it.servico_id ? `srv:${it.servico_id}` : it.produto_id}
                      onChange={v => escolherProduto(idx, v)}
                      placeholder="Produto ou serviço"
                      grupos={[
                        { label: 'Produtos', opcoes: produtosFiltrados.map((p: any) => ({
                          ...opcaoProduto(p, { saldo: true }),
                          tag: p.preco != null ? { texto: `R$ ${formatBRL(Number(p.preco))}`, tom: 'cinza' as const } : null,
                        })) },
                        ...(servicosAtivos.length ? [{ label: 'Serviços', opcoes: servicosAtivos.map((s: any) => ({
                          value: `srv:${s.id}`, label: s.nome, sub: s.codigo ? `Serviço · ${s.codigo}` : 'Serviço',
                          tag: { texto: `R$ ${formatBRL(Number(s.valor))}`, tom: 'verde' as const },
                        })) }] : []),
                      ]}
                    />
                    <div className="col-span-2">
                      <input
                        type="number"
                        min="1"
                        className="neu-input py-1.5 px-2 rounded-lg text-xs w-full text-right"
                        value={it.qtd}
                        onChange={e => updateItem(idx, { qtd: Math.max(0, Number(e.target.value) || 0) })}
                        placeholder="Qtd"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="neu-input py-1.5 px-2 rounded-lg text-xs w-full text-right"
                        value={it.preco_unitario ? formatBRL(it.preco_unitario) : ''}
                        onChange={e => updateItem(idx, { preco_unitario: parseBRL(formatBRL(e.target.value)) })}
                        onKeyDown={handleMoneyKeyDown}
                        placeholder="Preço"
                      />
                    </div>
                    <span className="col-span-2 text-xs font-mono text-accent text-right tabular-nums">
                      R$ {formatBRL(it.subtotal)}
                    </span>
                    <button onClick={() => removeItem(idx)} className="col-span-1 mx-auto action-btn-delete">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </SecaoFormulario>

          {/* Totais — a conta inteira, linha a linha. O aluno tem de ver
              de onde saiu cada número: mercadoria, o que ele negociou, o
              que a condição abateu, o que o parcelamento acrescentou, e o
              que a maquininha vai comer do que a loja recebe. */}
          <SecaoFormulario titulo="Resumo" icon={Calculator} cor="verde">
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-400">Mercadoria</span>
              <span className="font-mono tabular-nums text-gray-200">R$ {formatBRL(subtotal)}</span>
            </div>
            {descontoNum > 0 && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">(−) Desconto comercial</span>
                <span className="font-mono tabular-nums text-gray-200">- R$ {formatBRL(descontoNum)}</span>
              </div>
            )}
            {resumo.descontoCondicao > 0 && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">(−) Desconto à vista</span>
                <span className="font-mono tabular-nums text-emerald-400">- R$ {formatBRL(resumo.descontoCondicao)}</span>
              </div>
            )}
            {resumo.acrescimoJuros > 0 && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">(+) Juros ({formatBRL(Number(formaEscolhida?.juros_mensal ?? 0))}% a.m.)</span>
                <span className="font-mono tabular-nums text-yellow-400">+ R$ {formatBRL(resumo.acrescimoJuros)}</span>
              </div>
            )}
            <div className="rounded-xl bg-green-600 text-white px-3 py-2.5 my-1.5 flex items-center justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-widest">Total ao cliente</span>
              <span className="text-right">
                <span className="block text-lg font-black tabular-nums">R$ {formatBRL(valorTotal)}</span>
                {resumo.parcelas > 1 && (
                  <span className="block text-[11px] font-bold tabular-nums opacity-90">{resumo.parcelas}x de R$ {formatBRL(resumo.valorParcela)}</span>
                )}
              </span>
            </div>
            {formaEscolhida && (
              <>
                {resumo.taxaAdquirente > 0 && (
                  <div className="flex justify-between gap-3 text-xs" title="Custo da loja, não do cliente">
                    <span className="text-gray-500">Taxa da maquininha ({formatBRL(Number(formaEscolhida.taxa ?? 0))}%)</span>
                    <span className="font-mono tabular-nums text-red-400">- R$ {formatBRL(resumo.taxaAdquirente)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3 text-xs">
                  <span className="text-gray-500">A loja recebe</span>
                  <span className="font-mono tabular-nums text-gray-200">R$ {formatBRL(resumo.valorLiquido)}</span>
                </div>
                <div className="flex justify-between gap-3 text-xs">
                  <span className="text-gray-500">Vencimentos</span>
                  <span className="font-mono text-gray-300">
                    {vencimentos[0]?.toLocaleDateString('pt-BR')}
                    {vencimentos.length > 1 && ` a ${vencimentos[vencimentos.length - 1].toLocaleDateString('pt-BR')}`}
                  </span>
                </div>
              </>
            )}
          </div>
          </SecaoFormulario>

          <div className="@5xl:col-span-2 @5xl:justify-self-center @5xl:w-[calc(50%-0.625rem)]">
          <SecaoFormulario titulo="Observações" icon={MessageSquareText} cor="laranja">
            <textarea
              className="neu-input py-2 px-3 rounded-xl text-sm w-full resize-none campo-cresce"
              value={extras.observacoes}
              onChange={e => setExtras(x => ({ ...x, observacoes: e.target.value }))}
              placeholder="Condições, prazo de entrega, etc."
            />
          </SecaoFormulario>
          </div>
          </div>
        </ModalFormulario>
      </AnimatePresence>

      {/* Lista — mesma régua das outras tabelas: cliente é o texto principal,
          emissão e validade dividem a célula de prazos, e o feedback saiu da
          coluna própria (quase sempre vazia) para o "⋯". */}
      {isLoading ? <LoadingSpinner /> : filtrados.length === 0 ? (
        <EmptyState message={modoFinanceiro && fase === 'financeiro'
          ? 'Nenhum orçamento esperando a decisão do Financeiro.'
          : 'Nenhum orçamento encontrado com este filtro.'} />
      ) : (
        <div className="neu-flat rounded-3xl p-4 sm:p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Cliente</th>
                  <th className="text-center w-44 hidden md:table-cell">Vendedor</th>
                  <th className="text-center w-36">Prazos</th>
                  <th className="text-center w-40">Total</th>
                  <th className="text-center w-40">Situação</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtrados.map((o: any) => {
                    const expirado = isExpirado(o);
                    const podeEditar = isVendas && o.status === 'Rascunho';
                    const podeEnviarCliente = isVendas && o.status === 'Aprovado Financeiro';
                    const podeConverter = isVendas && o.status === 'Aprovado Cliente';
                    const podeDecidirAgora = podeDecidirFin && o.status === 'Aguardando Financeiro';
                    const podeCancelar = o.status !== 'Convertido em Pedido' && o.status !== 'Cancelado' && (isVendas || isAdminOuCeo);
                    const valeAte = validadeAte(o);
                    return (
                      <motion.tr key={o.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                        <td className="py-3 px-3 min-w-[13rem]">
                          {/* O orçamento vai ao cliente: é por este número que
                              ele volta perguntando. */}
                          <span className="block font-credencial text-[10px] text-accent/70 tracking-wider">{numeroOrcamento(o)}</span>
                          <button type="button" onClick={() => setDetalhes(o)} title="Ver detalhes da proposta"
                            className="block text-left text-sm font-semibold text-gray-100 leading-snug mt-0.5 line-clamp-2 break-words hover:text-accent">
                            {o.cliente?.nome ?? '—'}
                          </button>
                          <span className="md:hidden block text-[10px] text-gray-500 mt-0.5">{o.vendedor_nome ?? '—'}</span>
                        </td>
                        <td className="py-3 px-3 text-center text-xs text-gray-300 hidden md:table-cell">{o.vendedor_nome ?? '—'}</td>
                        <td className="py-3 px-3 text-center whitespace-nowrap text-[11px] leading-relaxed">
                          <span className="block">
                            <span className="text-gray-500">Emitido </span>
                            <span className="font-mono text-gray-300">{dataCurta(o.data_emissao) ?? '—'}</span>
                          </span>
                          <span className="block" title={`Validade de ${o.validade_dias ?? 3} dia(s)`}>
                            <span className="text-gray-500">{expirado ? 'Venceu ' : 'Vale até '}</span>
                            <span className={`font-mono ${expirado ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                              {expirado && <Clock size={10} className="inline -mt-0.5 mr-0.5" />}
                              {valeAte ?? `${o.validade_dias}d`}
                            </span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className="block text-sm font-semibold text-gray-100 tabular-nums">R$ {formatBRL(Number(o.valor_total ?? 0))}</span>
                          {o.forma_pagamento && (
                            <span className="block text-[10px] text-gray-500">
                              {rotuloCondicao(o.forma_pagamento, o.parcelas, o.valor_parcela)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <StatusBadge status={o.status} solido />
                          {(o.feedback_financeiro || o.feedback_cliente) && (
                            <span className="flex justify-center items-center gap-1 mt-1 text-[10px] text-gray-500"
                              title={[o.feedback_financeiro, o.feedback_cliente].filter(Boolean).join(' • ')}>
                              <MessageSquare size={10} /> com feedback
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                            {podeDecidirAgora && (
                              <>
                                <button onClick={() => { setDecisao({ orc: o, tipo: 'aprovar' }); setFeedbackInput(''); }}
                                  title="Aprovar a proposta" aria-label="Aprovar a proposta" className="action-btn-verde">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => { setDecisao({ orc: o, tipo: 'reprovar' }); setFeedbackInput(''); }}
                                  title="Reprovar a proposta" aria-label="Reprovar a proposta" className="action-btn-vermelho">
                                  <X size={14} />
                                </button>
                              </>
                            )}
                            {podeEnviarCliente && (
                              <button onClick={() => handleEnviarCliente(o)} disabled={enviandoCliente === o.id}
                                title="Enviar ao cliente" aria-label="Enviar ao cliente" className="action-btn-blue disabled:opacity-50">
                                {enviandoCliente === o.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                              </button>
                            )}
                            {podeConverter && (
                              <button onClick={() => handleConverter(o)} disabled={convertendo === o.id}
                                title="Gerar o pedido de venda" aria-label="Gerar pedido" className="action-btn-accent disabled:opacity-50">
                                {convertendo === o.id ? <Loader2 size={13} className="animate-spin" /> : <ShoppingBag size={13} />}
                              </button>
                            )}
                            {podeEditar && (
                              <button onClick={() => openEdit(o)} title="Editar rascunho" aria-label="Editar rascunho"
                                className="action-btn-edit">
                                <FileText size={13} />
                              </button>
                            )}
                            {/* Cancelar cobre todo orçamento que ainda não virou
                                pedido — decisão registrada, diferente de inativar.
                                Convertido não se cancela por aqui; cancela-se o
                                pedido de venda (migr. 551), e ele solta o orçamento. */}
                            <MenuMais>
                              {fechar => (
                                <>
                                  <ItemMenu onClick={() => { fechar(); setDetalhes(o); }}
                                    cor="text-gray-200 hover:bg-white/5" icon={Eye}>
                                    Ver detalhes
                                  </ItemMenu>
                                  {o.feedback_financeiro && (
                                    <ItemMenu onClick={() => { fechar(); setFeedbackAberto(o.feedback_financeiro); }}
                                      cor="text-gray-200 hover:bg-white/5" icon={MessageSquare}>
                                      Ver feedback do Financeiro
                                    </ItemMenu>
                                  )}
                                  {o.feedback_cliente && (
                                    <ItemMenu onClick={() => { fechar(); setFeedbackAberto(o.feedback_cliente); }}
                                      cor="text-gray-200 hover:bg-white/5" icon={MessageSquare}>
                                      Ver retorno do cliente
                                    </ItemMenu>
                                  )}
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="orcamentos" entidadeId={o.id} titulo={`${numeroOrcamento(o)} · ${o.cliente?.nome ?? 'Orçamento'}`} criadoEm={o.created_at} atualizadoEm={o.updated_at} />
                                  {podeCancelar && (
                                    <ItemMenu onClick={() => { fechar(); handleCancelar(o.id); }}
                                      cor="text-amber-400 hover:bg-amber-500/10" icon={X}>
                                      Cancelar orçamento
                                    </ItemMenu>
                                  )}
                                </>
                              )}
                            </MenuMais>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reload}
          />
        </div>
      )}

      {/* Modal de decisão Financeiro */}
      <AnimatePresence>
        {decisao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
            onClick={() => { if (!decidindo) { setDecisao(null); setFeedbackInput(''); } }}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              className="neu-flat rounded-3xl w-full max-w-md p-6 flex flex-col gap-4 border border-white/5"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-gray-200">
                {decisao.tipo === 'aprovar' ? 'Aprovar proposta?' : 'Reprovar proposta?'}
              </h3>
              <p className="text-xs text-gray-500">
                {decisao.orc.cliente?.nome ?? '—'} • R$ {formatBRL(Number(decisao.orc.valor_total ?? 0))}
              </p>
              <FormField label={decisao.tipo === 'reprovar' ? 'Feedback (obrigatório) *' : 'Comentário (opcional)'}>
                <textarea
                  className="neu-input py-2 px-3 rounded-xl text-sm min-h-[80px]"
                  value={feedbackInput}
                  onChange={e => setFeedbackInput(e.target.value)}
                  placeholder={decisao.tipo === 'reprovar' ? 'Explique o motivo da reprovação.' : 'Observações para Vendas (opcional).'}
                />
              </FormField>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDecisao(null)} disabled={decidindo}
                  className="neu-button py-2 px-4 rounded-xl text-sm text-gray-400 disabled:opacity-50">Cancelar</button>
                {decisao.tipo === 'reprovar' ? (
                  <button onClick={handleConfirmDecisao} disabled={decidindo}
                    className="btn-solido btn-solido--vermelho disabled:opacity-50">
                    {decidindo ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    Reprovar
                  </button>
                ) : (
                  <button onClick={handleConfirmDecisao} disabled={decidindo}
                    className="btn-solido btn-solido--verde-escuro disabled:opacity-50">
                    {decidindo ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Aprovar
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal read-only: detalhes da proposta para Financeiro/Admin/CEO visualizarem itens e observações antes de decidir. */}
      <AnimatePresence>
        {detalhes && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
            onClick={() => setDetalhes(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }}
              className="neu-flat rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4 border border-white/5"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-200">Detalhes da Proposta</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {detalhes.cliente?.nome ?? clientes.find((c: any) => c.id === detalhes.cliente_id)?.nome ?? '—'}
                    {detalhes.vendedor_nome ? ` • Vendedor: ${detalhes.vendedor_nome}` : ''}
                  </p>
                </div>
                <button onClick={() => setDetalhes(null)} className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="neu-pressed rounded-xl p-3">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Emitido</p>
                  <p className="text-gray-200 font-mono mt-1">{detalhes.data_emissao ?? '—'}</p>
                </div>
                <div className="neu-pressed rounded-xl p-3">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Validade</p>
                  <p className="text-gray-200 font-mono mt-1">{detalhes.validade_dias ?? '—'}d</p>
                </div>
                <div className="neu-pressed rounded-xl p-3">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Status</p>
                  <div className="mt-1"><StatusBadge status={detalhes.status} /></div>
                </div>
                <div className="neu-pressed rounded-xl p-3">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">Valor Total</p>
                  <p className="text-accent font-mono font-bold mt-1">R$ {formatBRL(Number(detalhes.valor_total ?? 0))}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Itens</span>
                {Array.isArray(detalhes.itens) && detalhes.itens.length > 0 ? (
                  <div className="neu-pressed rounded-xl overflow-x-auto">
                    <table className="tabela w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 border-b border-white/5">
                          <th className="py-2 px-3 font-bold">Produto</th>
                          <th className="py-2 px-3 font-bold text-right">Qtd</th>
                          {(isFinanceiro || isAdminOuCeo) && (
                            <th className="py-2 px-3 font-bold text-right">Custo Unit.</th>
                          )}
                          <th className="py-2 px-3 font-bold text-right">Unit.</th>
                          <th className="py-2 px-3 font-bold text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalhes.itens.map((it: any, idx: number) => {
                          const prod = produtos.find((p: any) => p.id === it.produto_id);
                          const custoRaw = prod?.custo ?? prod?.preco_custo;
                          const custo = custoRaw != null && custoRaw !== '' ? Number(custoRaw) : null;
                          return (
                            <tr key={idx} className="border-b border-white/5 last:border-b-0">
                              <td className="py-2 px-3 text-gray-200">
                                {it.nome ?? '—'}
                                {it.servico_id && <span className="ml-2 text-[9px] font-black uppercase tracking-wider text-teal-400">Serviço</span>}
                              </td>
                              <td className="py-2 px-3 font-mono text-gray-300 text-right">{it.qtd ?? '—'}</td>
                              {(isFinanceiro || isAdminOuCeo) && (
                                <td className="py-2 px-3 font-mono text-gray-400 text-right">
                                  {custo != null ? `R$ ${formatBRL(custo)}` : '—'}
                                </td>
                              )}
                              <td className="py-2 px-3 font-mono text-gray-300 text-right">R$ {formatBRL(Number(it.preco_unitario ?? 0))}</td>
                              <td className="py-2 px-3 font-mono text-gray-200 text-right">R$ {formatBRL(Number(it.subtotal ?? 0))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 py-2">Sem itens.</p>
                )}
              </div>

              {/* A conta da proposta, na ordem em que ela acontece. Quem aprova
                  precisa ver o que é negociação do vendedor, o que é condição
                  de pagamento e o que é custo da maquininha — as três coisas
                  entravam num número só antes da migr. 568. */}
              <div className="flex flex-col gap-1 text-xs neu-pressed rounded-xl p-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Mercadoria</span>
                  <span className="font-mono text-gray-300 tabular-nums">R$ {formatBRL(Number(detalhes.subtotal ?? 0))}</span>
                </div>
                {Number(detalhes.desconto ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Desconto comercial</span>
                    <span className="font-mono text-yellow-400 tabular-nums">- R$ {formatBRL(Number(detalhes.desconto ?? 0))}</span>
                  </div>
                )}
                {Number(detalhes.desconto_condicao ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Desconto à vista ({detalhes.forma_pagamento})</span>
                    <span className="font-mono text-emerald-400 tabular-nums">- R$ {formatBRL(Number(detalhes.desconto_condicao))}</span>
                  </div>
                )}
                {Number(detalhes.acrescimo_juros ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Juros do parcelamento</span>
                    <span className="font-mono text-yellow-400 tabular-nums">+ R$ {formatBRL(Number(detalhes.acrescimo_juros))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-white/5 pt-1 mt-1">
                  <span className="text-gray-400 font-bold">
                    Total ao cliente
                    {detalhes.forma_pagamento && (
                      <span className="block text-[10px] text-gray-600 font-normal">
                        {rotuloCondicao(detalhes.forma_pagamento, detalhes.parcelas, detalhes.valor_parcela)}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-accent font-bold tabular-nums">R$ {formatBRL(Number(detalhes.valor_total ?? 0))}</span>
                </div>
                {Number(detalhes.taxa_adquirente ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Taxa da maquininha <span className="text-gray-600">(custo da loja)</span></span>
                      <span className="font-mono text-red-400 tabular-nums">- R$ {formatBRL(Number(detalhes.taxa_adquirente))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400 font-bold">A loja recebe</span>
                      <span className="font-mono text-gray-200 font-bold tabular-nums">R$ {formatBRL(Number(detalhes.valor_liquido ?? 0))}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Observações</span>
                <div className="neu-pressed rounded-xl p-3 text-xs text-gray-300 whitespace-pre-wrap min-h-[60px]">
                  {detalhes.observacoes?.trim() ? detalhes.observacoes : <span className="text-gray-600 italic">Sem observações.</span>}
                </div>
              </div>

              {detalhes.feedback_financeiro && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Feedback do Financeiro</span>
                  <div className="neu-pressed rounded-xl p-3 text-xs text-gray-300 whitespace-pre-wrap">
                    {detalhes.feedback_financeiro}
                  </div>
                </div>
              )}

              {detalhes.feedback_cliente && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Feedback do Cliente</span>
                  <div className="neu-pressed rounded-xl p-3 text-xs text-gray-300 whitespace-pre-wrap">
                    {detalhes.feedback_cliente}
                  </div>
                </div>
              )}

              <div className="flex justify-end mt-2">
                <button onClick={() => setDetalhes(null)} className="neu-button py-2 px-4 rounded-xl text-sm text-gray-400">Fechar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {feedbackAberto && (
        <TextoModal titulo="Feedback do Financeiro" texto={feedbackAberto}
          onClose={() => setFeedbackAberto(null)} />
      )}
    </motion.div>
  );
};

export const OrcamentosView = ({
  showToast, profile, mode,
}: {
  showToast: any;
  profile: UserProfile;
  mode?: 'vendas' | 'financeiro';
}) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <OrcamentosViewInner showToast={showToast} profile={profile} mode={mode} filial={filialAtiva} />;
};

