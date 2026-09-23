import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Trash2, Check, X, Send, MessageSquare, Loader2, ShoppingBag, Clock, FileText, FileDown, Sheet, Eye, AlertTriangle } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { numeroOrcamento } from '../lib/documentos';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { useTravaAtualizacao } from '../hooks/useTravaAtualizacao';
import { ehVendavel } from '../lib/tipoProduto';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination, ExportButton, TextoModal } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, exportToPDFAgrupado, exportToExcelAgrupado, handleMoneyKeyDown } from '../lib/viewUtils';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
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


interface ItemOrcamento {
  produto_id: string;
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
    const p = produtosAtivos.find((pr: any) => pr.id === produtoId);
    if (!p) {
      updateItem(idx, { produto_id: '', nome: '', preco_unitario: 0 });
      return;
    }
    updateItem(idx, {
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
    if (itens.some(it => !it.produto_id || it.qtd <= 0)) {
      showToast('Cada item precisa de produto e quantidade > 0.', 'error', true);
      return;
    }

    setIsSaving(true);
    try {
      const payload: any = {
        cliente_id:    form.cliente_id || null,
        vendedor_id:   editItem ? editItem.vendedor_id : profile.id,
        vendedor_nome: editItem ? editItem.vendedor_nome : profile.nome,
        validade_dias: Math.max(1, parseInt(form.validade_dias) || 3),
        itens,
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
          <p className="text-sm text-gray-400 mt-1">
            {modoFinanceiro
              ? 'Aprove ou reprove propostas comerciais enviadas pela equipe de Vendas.'
              : 'Crie propostas com validade, descontos e acompanhe a aprovação até virar pedido.'}
          </p>
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
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => { setFase('todos'); setStatusFino(null); }}
            className={`py-2 px-3.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all flex items-center gap-2 ${
              fase === 'todos' ? 'border-accent text-accent' : 'border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/15'
            }`}
          >
            Todos
            <span className="font-mono tabular-nums text-gray-500">{totalGeral}</span>
          </button>
          {FASES.map(f => {
            const n = contarStatus(f.status);
            const ativa = fase === f.id;
            return (
              <button
                key={f.id}
                type="button"
                title={f.dica}
                onClick={() => { setFase(f.id); setStatusFino(null); }}
                className={`py-2 px-3.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all flex items-center gap-2 ${
                  ativa ? 'border-accent text-accent' : 'border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/15'
                } ${!ativa && n === 0 ? 'opacity-50' : ''}`}
              >
                {f.label}
                <span className="font-mono tabular-nums text-gray-500">{n}</span>
              </button>
            );
          })}
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
        {(showForm || editItem) && !modoFinanceiro && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Proposta' : 'Nova Proposta'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Cliente *" error={errors.cliente_id}>
                  <select
                    className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.cliente_id ? 'border border-red-500/40' : ''}`}
                    value={form.cliente_id}
                    onChange={e => { setForm(f => ({ ...f, cliente_id: e.target.value })); clearError('cliente_id'); }}
                  >
                    <option value="">Selecione...</option>
                    {groupCadastrosParaSelect(clientes).map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </optgroup>
                    ))}
                  </select>
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
                <FormField label="Desconto comercial (R$)">
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
                <div className={`rounded-xl p-3 text-xs flex items-start gap-2 border ${
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

              {/* Itens da proposta */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Itens da Proposta</span>
                  <div className="flex items-center gap-2 flex-1 sm:flex-none sm:min-w-[260px]">
                    <input
                      type="text"
                      value={produtoBusca}
                      onChange={e => setProdutoBusca(e.target.value)}
                      placeholder="Buscar produto por nome ou código..."
                      className="neu-input py-1.5 px-3 rounded-lg text-xs flex-1"
                    />
                    <button onClick={addItem} className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-accent flex items-center gap-1 shrink-0">
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
                        <select
                          className="neu-input py-1.5 px-2 rounded-lg text-xs col-span-5"
                          value={it.produto_id}
                          onChange={e => escolherProduto(idx, e.target.value)}
                        >
                          <option value="">Produto...</option>
                          {produtosFiltrados.map((p: any) => (
                            <option key={p.id} value={p.id}>{p.nome}{p.codigo ? ` (${p.codigo})` : ''}</option>
                          ))}
                        </select>
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

              <FormField label="Observações">
                <textarea
                  className="neu-input py-2 px-3 rounded-xl text-sm min-h-[60px]"
                  value={extras.observacoes}
                  onChange={e => setExtras(x => ({ ...x, observacoes: e.target.value }))}
                  placeholder="Condições, prazo de entrega, etc."
                />
              </FormField>

              {/* Totais — a conta inteira, linha a linha. O aluno tem de ver
                  de onde saiu cada número: mercadoria, o que ele negociou, o
                  que a condição abateu, o que o parcelamento acrescentou, e o
                  que a maquininha vai comer do que a loja recebe. */}
              <div className="flex flex-col gap-3 border-t border-white/5 pt-3">
                <div className="flex justify-end gap-6 text-xs flex-wrap">
                  <div className="flex flex-col items-end">
                    <span className="text-gray-500 uppercase tracking-widest text-[10px]">Mercadoria</span>
                    <span className="font-mono text-gray-300 tabular-nums">R$ {formatBRL(subtotal)}</span>
                  </div>
                  {descontoNum > 0 && (
                    <div className="flex flex-col items-end">
                      <span className="text-gray-500 uppercase tracking-widest text-[10px]">Desc. comercial</span>
                      <span className="font-mono text-gray-300 tabular-nums">- R$ {formatBRL(descontoNum)}</span>
                    </div>
                  )}
                  {resumo.descontoCondicao > 0 && (
                    <div className="flex flex-col items-end">
                      <span className="text-gray-500 uppercase tracking-widest text-[10px]">Desc. à vista</span>
                      <span className="font-mono text-emerald-400 tabular-nums">- R$ {formatBRL(resumo.descontoCondicao)}</span>
                    </div>
                  )}
                  {resumo.acrescimoJuros > 0 && (
                    <div className="flex flex-col items-end">
                      <span className="text-gray-500 uppercase tracking-widest text-[10px]">Juros ({formatBRL(Number(formaEscolhida?.juros_mensal ?? 0))}% a.m.)</span>
                      <span className="font-mono text-yellow-400 tabular-nums">+ R$ {formatBRL(resumo.acrescimoJuros)}</span>
                    </div>
                  )}
                  <div className="flex flex-col items-end">
                    <span className="text-gray-500 uppercase tracking-widest text-[10px]">Total ao cliente</span>
                    <span className="font-mono text-lg font-black text-accent tabular-nums">R$ {formatBRL(valorTotal)}</span>
                    {resumo.parcelas > 1 && (
                      <span className="font-mono text-[11px] text-gray-400 tabular-nums">
                        {resumo.parcelas}x de R$ {formatBRL(resumo.valorParcela)}
                      </span>
                    )}
                  </div>
                </div>

                {formaEscolhida && (
                  <div className="flex justify-end gap-6 text-[11px] flex-wrap text-gray-500">
                    {resumo.taxaAdquirente > 0 && (
                      <span>
                        Taxa da maquininha ({formatBRL(Number(formaEscolhida.taxa ?? 0))}%):
                        {' '}<span className="font-mono text-red-400 tabular-nums">- R$ {formatBRL(resumo.taxaAdquirente)}</span>
                        {' '}<span className="text-gray-600">— custo da loja, não do cliente</span>
                      </span>
                    )}
                    <span>
                      A loja recebe:
                      {' '}<span className="font-mono text-gray-300 tabular-nums">R$ {formatBRL(resumo.valorLiquido)}</span>
                    </span>
                    <span>
                      1º vencimento:
                      {' '}<span className="font-mono text-gray-300">
                        {vencimentos[0]?.toLocaleDateString('pt-BR')}
                      </span>
                      {vencimentos.length > 1 && (
                        <span className="text-gray-600"> · último em {vencimentos[vencimentos.length - 1].toLocaleDateString('pt-BR')}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-end flex-wrap">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
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
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lista */}
      {isLoading ? <LoadingSpinner /> : filtrados.length === 0 ? (
        <EmptyState message="Nenhum orçamento encontrado com este filtro." />
      ) : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Cliente</th>
                  <th className="pb-4 font-bold px-4">Vendedor</th>
                  <th className="pb-4 font-bold px-4 text-center">Emitido</th>
                  <th className="pb-4 font-bold px-4 text-center">Validade</th>
                  <th className="pb-4 font-bold px-4 text-right">Total</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4">Feedback</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
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
                    return (
                      <motion.tr key={o.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                          {/* O orçamento vai ao cliente: é por este número que
                              ele volta perguntando. */}
                          <span className="block font-credencial text-[10px] text-gray-500 tracking-wider">{numeroOrcamento(o)}</span>
                          {o.cliente?.nome ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400">{o.vendedor_nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-500 text-center">{o.data_emissao ?? '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-center">
                          <span className={expirado ? 'text-red-500 font-bold flex items-center gap-1 justify-center' : 'text-gray-500'}>
                            {expirado && <Clock size={11} />}
                            {o.validade_dias}d
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                          R$ {formatBRL(Number(o.valor_total ?? 0))}
                          {o.forma_pagamento && (
                            <span className="block text-[10px] text-gray-500 font-sans">
                              {rotuloCondicao(o.forma_pagamento, o.parcelas, o.valor_parcela)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={o.status} /></td>
                        <td className="py-3 px-4 text-xs max-w-xs">
                          {o.feedback_financeiro || o.feedback_cliente ? (
                            <span className="text-gray-400 italic line-clamp-2" title={[o.feedback_financeiro, o.feedback_cliente].filter(Boolean).join(' • ')}>
                              "{o.feedback_financeiro ?? o.feedback_cliente}"
                            </span>
                          ) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <HistoricoOperacoes entidade="orcamentos" entidadeId={o.id} titulo={`${numeroOrcamento(o)} · ${o.cliente?.nome ?? 'Orçamento'}`} criadoEm={o.created_at} atualizadoEm={o.updated_at} />
                            <button onClick={() => setDetalhes(o)} title="Ver detalhes da proposta"
                              className="action-btn-neutral">
                              <Eye size={12} />
                            </button>
                            {podeDecidirAgora && (
                              <>
                                <button onClick={() => { setDecisao({ orc: o, tipo: 'aprovar' }); setFeedbackInput(''); }}
                                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 flex items-center gap-1">
                                  <Check size={11} /> Aprovar
                                </button>
                                <button onClick={() => { setDecisao({ orc: o, tipo: 'reprovar' }); setFeedbackInput(''); }}
                                  className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-400 hover:bg-red-400/10 flex items-center gap-1">
                                  <X size={11} /> Reprovar
                                </button>
                              </>
                            )}
                            {podeEnviarCliente && (
                              <button onClick={() => handleEnviarCliente(o)} disabled={enviandoCliente === o.id}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-cyan-400 hover:bg-cyan-400/10 flex items-center gap-1 disabled:opacity-50">
                                {enviandoCliente === o.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                                Enviar ao cliente
                              </button>
                            )}
                            {podeConverter && (
                              <button onClick={() => handleConverter(o)} disabled={convertendo === o.id}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-yellow-400 hover:bg-yellow-400/10 border border-yellow-400/15 flex items-center gap-1 disabled:opacity-50">
                                {convertendo === o.id ? <Loader2 size={11} className="animate-spin" /> : <ShoppingBag size={11} />}
                                Gerar Pedido
                              </button>
                            )}
                            {podeEditar && (
                              <button onClick={() => openEdit(o)} title="Editar rascunho"
                                className="action-btn-edit">
                                <FileText size={12} />
                              </button>
                            )}
                            {/* Cancelar cobre todo orçamento que ainda não virou
                                pedido. Antes só aparecia em Rascunho e
                                Aguardando Financeiro, e para o resto sobrava o
                                botão de inativar — que não é a mesma coisa:
                                cancelar é decisão registrada, inativar sumia
                                com o documento. Convertido não se cancela por
                                aqui; cancela-se o pedido de venda (migr. 551),
                                e ele solta o orçamento de volta. */}
                            {o.status !== 'Convertido em Pedido' && o.status !== 'Cancelado'
                              && (isVendas || isAdminOuCeo) && (
                              <button onClick={() => handleCancelar(o.id)} title="Cancelar"
                                className="action-btn-warning">
                                <X size={12} />
                              </button>
                            )}
                            {o.feedback_financeiro && (
                              <button onClick={() => setFeedbackAberto(o.feedback_financeiro)} title="Ver feedback"
                                className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-cyan-400">
                                <MessageSquare size={12} />
                              </button>
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
                    className="py-2 px-5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
                    {decidindo ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    Reprovar
                  </button>
                ) : (
                  <NeuButtonAccent onClick={handleConfirmDecisao} isLoading={decidindo}>
                    <Check size={14} /> Aprovar
                  </NeuButtonAccent>
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
                    <table className="w-full text-xs">
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
                              <td className="py-2 px-3 text-gray-200">{it.nome ?? '—'}</td>
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

