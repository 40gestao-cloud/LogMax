import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Trash2, Check, X, ShoppingBag, MessageSquare, Send, Loader2, Search, GitCompare, Award } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { supabase } from '../lib/supabase';
import { hasAnySetor, hasSetor, isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';

// Status considerados "propostas vivas" para contagem de concorrentes.
// Cancelado/Negado são histórico — aparecem na comparação mas não contam.
const STATUS_VIVOS = new Set(['Aguardando Financeiro', 'Aprovado']);

// notificar_setor: RPC já existente em 022_20260520_ti_e_notificacoes.sql.
async function notificarSetor(args: {
  setor: 'compras' | 'financeiro';
  tipo: 'aprovacao_pendente' | 'aprovado' | 'reprovado';
  titulo: string;
  mensagem?: string;
  link_view?: string;
  urgencia?: 'Baixa' | 'Média' | 'Alta';
  ref_id?: string;
  motivo?: string;
}) {
  if (!supabase) return;
  try {
    await supabase.rpc('notificar_setor', {
      p_setor:     args.setor,
      p_tipo:      args.tipo,
      p_titulo:    args.titulo,
      p_mensagem:  args.mensagem ?? null,
      p_link_view: args.link_view ?? null,
      p_urgencia:  args.urgencia ?? 'Média',
      p_ref_id:    args.ref_id ?? null,
      p_motivo:    args.motivo ?? null,
    });
  } catch {
    // Notificação é best-effort — não bloqueia o fluxo principal.
  }
}

// `mode` existe pelo mesmo motivo que existe em OrcamentosView: a tela é
// alcançável por duas portas de menu — Compras → Cotações e Financeiro →
// Aprovações de Cotação — e sem o modo as duas abriam exatamente a mesma
// coisa. Para colaborador passava despercebido (cada setor só enxerga a sua
// porta), mas admin, CEO e gerente veem as duas entradas e caíam no mesmo
// lugar, com o menu prometendo ferramentas diferentes.
//
// 'financeiro' é a fila de decisão: só o que está aguardando o Financeiro, sem
// o formulário de coleta. 'compras' (default) é a bancada de trabalho inteira.
const CotacoesViewInner = ({ showToast, profile, filial, mode }: { showToast: any; profile: UserProfile; filial: FilialOp; mode?: 'compras' | 'financeiro' }) => {
  const modoFinanceiro = mode === 'financeiro';
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);
  // Busca é feita client-side em `enriched` (nome do produto vem de requisicoes.item,
  // que é tabela diferente). useFetchData só sabe fazer ilike em colunas da própria
  // tabela, então qualquer searchColumns aqui filtra a coisa errada.
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/cotacoesview', { filial }, false,
    { page }
  );
  const { data: requisicoes, setData: setRequisicoes } = useFetchData<any>('/api/requisicoesview', { filial });
  const { data: fornecedores } = useFetchData<any>('/api/crmview-fornecedores', { filial });
  // Lista SEM paginação, só para agrupar propostas concorrentes por requisição.
  // `data` traz 50 linhas; usá-la para isso fazia o contador de propostas, o
  // modal de comparação e o cancelamento automático ignorarem toda proposta
  // que tivesse caído na página seguinte.
  const { data: todasCotacoes } = useFetchData<any>('/api/cotacoesview', { filial });
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  // form.fornecedor_tipo permite os 2 selects (PF/PJ) compartilharem fornecedor_id
  // mantendo apenas um ativo de cada vez. Valores espelham pessoa_tipo do CRM.
  const [form, setForm] = useState({ requisicao_id: '', fornecedor_id: '', fornecedor_tipo: '' as '' | 'Empresa' | 'Pessoa Física' });
  const [extras, setExtras] = useState({ valor_total: '', prazo_entrega: '', validade: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Decisão Financeiro: modal de aprovar/reprovar.
  const [decisao, setDecisao] = useState<{ cot: any; tipo: 'aprovar' | 'reprovar' } | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [decidindo, setDecidindo] = useState(false);

  // RBAC: Compras (e Logística, que opera junto no módulo de Compras — igual
  // recebimentos/movimentações) cria/envia/gera pedido; Financeiro / gerente
  // da filial / admin/CEO aprova.
  // Gerente vê/faz tudo da própria filial — inclui aprovar cotação —, e o
  // RLS já libera via auth_gerente_da (migr. 20260713i). Antes o frontend
  // exigia gerente COM setor financeiro pra decidir, o que travava gerentes
  // "puros" que a régua canônica manda liberar.
  const isCompras    = hasAnySetor(profile, 'compras', 'logistica') || profile.role === 'gerente';
  const isFinanceiro = hasSetor(profile, 'financeiro');
  const podeDecidir  =
    profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile) ||
    profile.role === 'gerente' || isFinanceiro;

  // Alçada de aprovação por valor (migr. 204). Buscada 1x por filial.
  // Regra: valor <= limite → Financeiro decide; valor > limite → Gerente
  // da filial decide. Admin/CEO sempre podem (override total).
  const [alcadaLimite, setAlcadaLimite] = useState<number | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('alcadas_compra')
      .select('valor_limite_financeiro')
      .eq('filial', filial)
      .eq('ativo', true)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (cancelled) return;
        if (error) {
          // Migração 204 pendente → degrada pro fluxo antigo (todos podem).
          console.warn('[Cotacoes] alçada indisponível:', error.message);
          setAlcadaLimite(null);
          return;
        }
        setAlcadaLimite(row ? Number(row.valor_limite_financeiro ?? 0) : null);
      });
    return () => { cancelled = true; };
  }, [filial]);

  // Quem decide esta cotação. REGRA ÚNICA: o valor manda.
  //
  // Antes havia dois sistemas em paralelo — a alçada por valor e uma régua por
  // role — com um terceiro caminho de fallback quando `alcadas_compra` não
  // respondia (`return podeDecidir`, que liberava praticamente todo mundo).
  // Três respostas possíveis para "quem aprova isto?" é o que faz um controle
  // deixar de ser controle. Agora: alçada não configurada = limite infinito =
  // Financeiro decide. Um caminho só.
  const limiteEfetivo = alcadaLimite ?? Number.POSITIVE_INFINITY;

  const podeDecidirCotacao = (cot: any): boolean => {
    // Admin/CEO/conselheiro: override total. É a saída quando não há outro
    // aprovador possível na filial.
    if (profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile)) return true;
    // Segregação de funções: quem cadastrou a proposta não a aprova.
    if (cot.criado_por && cot.criado_por === profile.id) return false;
    return Number(cot.valor_total ?? 0) <= limiteEfetivo
      ? isFinanceiro               // dentro da alçada → Financeiro
      : profile.role === 'gerente'; // acima da alçada → Gerente da filial
  };

  const alcadaLabel = (cot: any): { label: string; color: string } => (
    Number(cot.valor_total ?? 0) <= limiteEfetivo
      ? { label: 'Financeiro',  color: 'text-cyan-300 border-cyan-400/20' }
      : { label: 'Gerente/CEO', color: 'text-amber-300 border-amber-400/20' }
  );

  // IDs de cotações que já têm pedido gerado.
  const [cotacoesComPedido, setCotacoesComPedido] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('pedidos').select('cotacao_id').eq('ativo', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const ids = new Set<string>(
          (rows ?? [])
            .map((p: any) => p.cotacao_id)
            .filter((id: any): id is string => Boolean(id))
        );
        setCotacoesComPedido(ids);
      });
    return () => { cancelled = true; };
  }, [data]);

  const requisicoesAprovadas = requisicoes.filter((r: any) => r.status === 'Aprovado');

  // Requisições aprovadas da filial selecionada, ordenadas por item.
  const requisicoesAprovadaOrdenadas = useMemo(() =>
    [...requisicoesAprovadas].sort((a, b) => String(a.item ?? '').localeCompare(String(b.item ?? ''), 'pt-BR', { sensitivity: 'base' })),
    [requisicoesAprovadas]
  );

  // Fornecedores divididos em PJ / PF, cada lista agrupada por filial.
  // CRMView grava pessoa_tipo como 'Empresa' / 'Pessoa Física' (não 'PJ'/'PF') —
  // filtramos pelos valores reais do banco e tratamos NULL como Empresa.
  const agruparFornecedoresPorFilial = (tipo: 'Empresa' | 'Pessoa Física') => {
    const filtrados = fornecedores.filter((f: any) => (f.pessoa_tipo ?? 'Empresa') === tipo);
    return groupCadastrosParaSelect(filtrados).map(g => ({
      // groupCadastrosParaSelect retorna label "Empresa — TechMax". Aqui só queremos
      // a filial (pessoa_tipo já está separada na nossa caixa).
      label: g.label.replace(/^(Empresa|Pessoa Física)\s*—\s*/, ''),
      items: g.items,
    }));
  };
  const fornecedoresPJ = useMemo(() => agruparFornecedoresPorFilial('Empresa'), [fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps
  const fornecedoresPF = useMemo(() => agruparFornecedoresPorFilial('Pessoa Física'), [fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps

  const enriched = data.map((c: any) => ({
    ...c,
    req: requisicoes.find((r: any) => r.id === c.requisicao_id),
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
  }));

  // Agrupa cotações por requisição para mostrar propostas concorrentes.
  // Boa prática de compras: coletar >=3 propostas por requisição antes de
  // aprovar. Trata Cancelado/Negado como propostas históricas — aparecem
  // no modal de comparação, mas não contam pro aviso soft.
  const propostasPorRequisicao = useMemo(() => {
    const map = new Map<string, any[]>();
    todasCotacoes.forEach((c: any) => {
      if (!c.requisicao_id) return;
      const arr = map.get(c.requisicao_id) ?? [];
      arr.push({
        ...c,
        req: requisicoes.find((r: any) => r.id === c.requisicao_id),
        forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
      });
      map.set(c.requisicao_id, arr);
    });
    return map;
  }, [todasCotacoes, requisicoes, fornecedores]);
  const contarVivos = (reqId: string) =>
    (propostasPorRequisicao.get(reqId) ?? []).filter((c: any) => STATUS_VIVOS.has(c.status)).length;

  // Modal de comparação — chave = requisicao_id.
  const [comparando, setComparando] = useState<string | null>(null);
  const propostasDoModal = useMemo(() => {
    if (!comparando) return [];
    const lista = propostasPorRequisicao.get(comparando) ?? [];
    // Menor preço primeiro (proposta candidata a vencedora).
    return [...lista].sort((a, b) => Number(a.valor_total ?? 0) - Number(b.valor_total ?? 0));
  }, [comparando, propostasPorRequisicao]);
  const menorPrecoDoModal = useMemo(() => {
    const vivos = propostasDoModal.filter((c: any) => STATUS_VIVOS.has(c.status));
    if (vivos.length === 0) return null;
    return Math.min(...vivos.map((c: any) => Number(c.valor_total ?? 0)));
  }, [propostasDoModal]);

  const enrichedFiltered = useMemo(() => {
    // Na porta do Financeiro a tela é caixa de entrada, não catálogo: mostra
    // só o que espera decisão dele — o mesmo status que alimenta o badge.
    const base = modoFinanceiro
      ? enriched.filter((c: any) => c.status === 'Aguardando Financeiro')
      : enriched;
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c: any) => {
      const item = String(c.req?.item ?? '').toLowerCase();
      const forn = String(c.forn?.nome ?? '').toLowerCase();
      const status = String(c.status ?? '').toLowerCase();
      const obs = String(c.observacao ?? '').toLowerCase();
      return item.includes(q) || forn.includes(q) || status.includes(q) || obs.includes(q);
    });
  }, [enriched, debouncedSearch, modoFinanceiro]);

  const closeForm = () => {
    setShowForm(false);
    setForm({ requisicao_id: '', fornecedor_id: '', fornecedor_tipo: '' });
    setExtras({ valor_total: '', prazo_entrega: '', validade: '' });
    setErrors({});
  };

  // Compras cria a cotação → vai direto para 'Aguardando Financeiro' e notifica.
  const handleSave = async () => {
    if (!validate()) return;
    // Aviso soft: recomendado ter >=3 propostas por requisição antes do envio.
    // Bloqueio hard atrapalharia compra urgente; então só confirma.
    const vivosAtuais = contarVivos(form.requisicao_id);
    if (vivosAtuais < 2) {
      const ordinal = vivosAtuais === 0 ? '1ª' : '2ª';
      const ok = await confirm(
        `Esta será a ${ordinal} proposta para esta requisição. Boa prática de compras é coletar pelo menos 3 propostas antes de enviar ao Financeiro. Deseja enviar assim mesmo?`
      );
      if (!ok) return;
    }
    setIsSaving(true);
    showToast('Enviando cotação ao Financeiro...', 'info', false);
    try {
      const fornNome = fornecedores.find((f: any) => f.id === form.fornecedor_id)?.nome ?? 'fornecedor';
      const reqItem  = requisicoes.find((r: any) => r.id === form.requisicao_id)?.item ?? 'item';
      const valorNum = parseBRL(extras.valor_total);
      const saved = await dbInsert('/api/cotacoesview', {
        requisicao_id: form.requisicao_id,
        fornecedor_id: form.fornecedor_id,
        valor_total: valorNum,
        prazo_entrega: extras.prazo_entrega,
        validade: extras.validade || null,
        status: 'Aguardando Financeiro',
        filial,
      });
      setData((prev: any[]) => [saved ?? { id: Date.now(), ...form, ...extras, status: 'Aguardando Financeiro' }, ...prev]);
      closeForm();
      showToast('Cotação enviada ao Financeiro!', 'success', true);

      // Notifica setor financeiro.
      await notificarSetor({
        setor:     'financeiro',
        tipo:      'aprovacao_pendente',
        titulo:    'Nova cotação aguardando aprovação',
        mensagem:  `${reqItem} — ${fornNome} (R$ ${formatBRL(valorNum)})`,
        // Destino do FINANCEIRO. Apontava para 'compras-cotações', módulo que
        // SETOR_MODULES.financeiro não inclui — o clique no sino não abria nada.
        link_view: 'financeiro-aprovaçõesdecotação',
        urgencia:  'Média',
        ref_id:    (saved as any)?.id,
      });
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Cotacoes] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Financeiro decide (aprovar OU reprovar com feedback).
  const handleConfirmDecisao = async () => {
    if (!decisao) return;
    const { cot, tipo } = decisao;
    const feedback = feedbackInput.trim();

    if (tipo === 'reprovar' && !feedback) {
      showToast('Feedback é obrigatório para reprovar.', 'error', true);
      return;
    }

    setDecidindo(true);
    try {
      const novoStatus = tipo === 'aprovar' ? 'Aprovado' : 'Negado';
      const updates: any = {
        status:       novoStatus,
        feedback:     feedback || null,
        aprovado_por: profile.id,
        aprovado_em:  new Date().toISOString(),
      };
      await dbUpdate('/api/cotacoesview', cot.id, updates);
      setData((prev: any[]) => prev.map(c => c.id === cot.id ? { ...c, ...updates } : c));

      // Aprovou → cancela as demais 'Aguardando Financeiro' da mesma requisição.
      // Varre `todasCotacoes` (sem paginação) e não `data`: concorrente que
      // caísse na página 2 ficava viva e podia ser aprovada depois.
      if (tipo === 'aprovar' && cot.requisicao_id) {
        const concorrentes = todasCotacoes.filter((c: any) =>
          c.id !== cot.id &&
          c.requisicao_id === cot.requisicao_id &&
          c.status === 'Aguardando Financeiro'
        );
        for (const c of concorrentes) {
          try { await dbUpdate('/api/cotacoesview', c.id, { status: 'Cancelado' }); } catch { /* noop */ }
        }
        if (concorrentes.length > 0) {
          setData((prev: any[]) => prev.map(c =>
            concorrentes.some((cc: any) => cc.id === c.id) ? { ...c, status: 'Cancelado' } : c
          ));
        }
      }

      // Notifica Compras.
      const reqItem = cot.req?.item ?? requisicoes.find((r: any) => r.id === cot.requisicao_id)?.item ?? 'cotação';
      const fornNome = cot.forn?.nome ?? fornecedores.find((f: any) => f.id === cot.fornecedor_id)?.nome ?? 'fornecedor';
      await notificarSetor({
        setor:     'compras',
        tipo:      tipo === 'aprovar' ? 'aprovado' : 'reprovado',
        titulo:    tipo === 'aprovar'
                     ? 'Cotação aprovada pelo Financeiro'
                     : 'Cotação reprovada pelo Financeiro',
        mensagem:  `${reqItem} — ${fornNome}`,
        link_view: 'compras-cotações',
        urgencia:  tipo === 'aprovar' ? 'Média' : 'Alta',
        ref_id:    cot.id,
        motivo:    tipo === 'reprovar' ? feedback : undefined,
      });

      showToast(tipo === 'aprovar' ? 'Cotação aprovada.' : 'Cotação reprovada.', 'success', true);
      setDecisao(null);
      setFeedbackInput('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setDecidindo(false);
    }
  };

  // Compras: cria o pedido depois que o Financeiro aprovou.
  //
  // Tudo acontece dentro da RPC `gerar_pedido_de_cotacao` (migr. 266): ela checa
  // duplicidade por cotação E por requisição, insere o pedido e baixa a
  // requisição para 'Atendida' no mesmo COMMIT. Antes isso era insert solto no
  // cliente com guard só por cotação — foi assim que uma requisição de 24
  // unidades virou 2 pedidos e 2 contas a pagar em produção.
  const handleGerarPedido = async (cotacao: any) => {
    if (!supabase) return;
    setGenerating(cotacao.id);
    try {
      const { data: pedido, error } = await supabase.rpc('gerar_pedido_de_cotacao', {
        p_cotacao_id: cotacao.id,
      });
      if (error) throw new Error(error.message);
      setCotacoesComPedido(prev => new Set(prev).add(cotacao.id));
      // A requisição saiu de 'Aprovado' — tira do dropdown de Nova Cotação sem
      // esperar o próximo fetch.
      if (cotacao.requisicao_id) {
        setRequisicoes((prev: any[]) =>
          prev.map(r => r.id === cotacao.requisicao_id ? { ...r, status: 'Atendida' } : r));
      }
      const novo: any = Array.isArray(pedido) ? pedido[0] : pedido;
      showToast(`Pedido #${novo?.id?.slice(-6).toUpperCase() ?? 'NOVO'} gerado.`, 'success', true);
    } catch (err: any) {
      showToast(`Falha ao gerar pedido: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setGenerating(null);
    }
  };

  const handleCancelar = async (id: string) => {
    if (!await confirm('Cancelar esta cotação?')) return;
    try {
      const updated = await dbUpdate('/api/cotacoesview', id, { status: 'Cancelado' });
      setData((prev: any[]) => prev.map(c => c.id === id ? (updated ?? { ...c, status: 'Cancelado' }) : c));
      showToast('Cotação cancelada.', 'info', true);
    } catch (err: any) {
      showToast(`Erro ao cancelar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar esta cotação?')) return;
    try {
      await dbDelete('/api/cotacoesview', id);
      setData((prev: any[]) => prev.filter(c => c.id !== id));
      showToast('Cotação inativada.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Cotacoes] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            {modoFinanceiro ? 'Aprovações de Cotação' : 'Cotações'} — {filial}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {modoFinanceiro
              ? 'Cotações que o setor de Compras enviou e aguardam a sua decisão.'
              : 'Colete propostas de fornecedores; após aprovação do Financeiro, gere o pedido.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar..."
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {isCompras && !modoFinanceiro && (
            <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}>
              <Plus size={16} /> Nova Cotação
            </NeuButtonAccent>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showForm && isCompras && !modoFinanceiro && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Cotação</h3>
              <p className="text-[11px] text-gray-500 -mt-2">
                Ao salvar, a cotação será enviada ao <span className="text-cyan-400 font-bold">Financeiro</span> para aprovação.
              </p>
              {requisicoesAprovadaOrdenadas.length === 0 ? (
                <p className="text-sm text-yellow-400/80 text-center py-4">Nenhuma requisição aprovada disponível. Aprove uma requisição primeiro.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField label="Requisição *" error={errors.requisicao_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.requisicao_id ? 'border border-red-500/40' : ''}`}
                        value={form.requisicao_id} onChange={e => { setForm(f => ({ ...f, requisicao_id: e.target.value })); clearError('requisicao_id'); }}>
                        <option value="">Selecione...</option>
                        {requisicoesAprovadaOrdenadas.map((r: any) => (
                          <option key={r.id} value={r.id}>{r.item} (Qtd: {r.qtd})</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor PJ" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        value={form.fornecedor_tipo === 'Empresa' ? form.fornecedor_id : ''}
                        onChange={e => { setForm(f => ({ ...f, fornecedor_id: e.target.value, fornecedor_tipo: e.target.value ? 'Empresa' : '' })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione um fornecedor PJ...</option>
                        {fornecedoresPJ.map(g => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((f: any) => (
                              <option key={f.id} value={f.id}>{f.nome}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor PF" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        value={form.fornecedor_tipo === 'Pessoa Física' ? form.fornecedor_id : ''}
                        onChange={e => { setForm(f => ({ ...f, fornecedor_id: e.target.value, fornecedor_tipo: e.target.value ? 'Pessoa Física' : '' })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione um fornecedor PF...</option>
                        {fornecedoresPF.map(g => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((f: any) => (
                              <option key={f.id} value={f.id}>{f.nome}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Valor Total (R$)">
                      <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.valor_total}
                        onChange={e => setExtras(x => ({ ...x, valor_total: formatBRL(e.target.value) }))}
                        onKeyDown={handleMoneyKeyDown}
                        placeholder="0,00" />
                    </FormField>
                    <FormField label="Prazo de Entrega">
                      <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.prazo_entrega} onChange={e => setExtras(x => ({ ...x, prazo_entrega: e.target.value }))} />
                    </FormField>
                    <FormField label="Validade da Proposta">
                      <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.validade} onChange={e => setExtras(x => ({ ...x, validade: e.target.value }))} />
                    </FormField>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                      <Send size={14} /> Enviar ao Financeiro
                    </NeuButtonAccent>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? <LoadingSpinner /> : enrichedFiltered.length === 0 ? <EmptyState message="Nenhuma cotação encontrada" /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6 flex-1 min-h-0">
          <div className="overflow-auto main-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Requisição</th>
                  <th className="pb-4 font-bold px-4 text-center">Qtd</th>
                  <th className="pb-4 font-bold px-4">Fornecedor</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor Total</th>
                  <th className="pb-4 font-bold px-4">Prazo Entrega</th>
                  <th className="pb-4 font-bold px-4">Validade</th>
                  <th className="pb-4 font-bold px-4 text-center">Status</th>
                  <th className="pb-4 font-bold px-4">Feedback</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enrichedFiltered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{item.req?.item ?? '—'}</span>
                          {item.requisicao_id && (propostasPorRequisicao.get(item.requisicao_id) ?? []).length > 1 && (
                            <button
                              onClick={() => setComparando(item.requisicao_id)}
                              title="Comparar propostas concorrentes"
                              className="neu-button px-2 py-0.5 rounded-full text-[10px] font-bold text-cyan-300 hover:bg-cyan-400/10 border border-cyan-400/20 flex items-center gap-1"
                            >
                              <GitCompare size={10} />
                              {(propostasPorRequisicao.get(item.requisicao_id) ?? []).length} propostas
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-300 text-center tabular-nums">{item.req?.qtd ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.forn?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span>R$ {formatBRL(Number(item.valor_total ?? 0))}</span>
                          {item.status === 'Aguardando Financeiro' && (() => {
                            const a = alcadaLabel(item);
                            return (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[9px] font-bold uppercase tracking-widest border ${a.color}`}
                                title={alcadaLimite !== null ? `Alçada: limite Financeiro R$ ${formatBRL(alcadaLimite)}` : 'Alçada não configurada'}>
                                {a.label}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.prazo_entrega || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 font-mono">{item.validade || '—'}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-xs max-w-xs">
                        {item.feedback
                          ? <span className="text-gray-400 italic line-clamp-2" title={item.feedback}>“{item.feedback}”</span>
                          : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                          {/* Aguardando Financeiro: gerente do Financeiro decide */}
                          {item.status === 'Aguardando Financeiro' && podeDecidirCotacao(item) && (
                            <>
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'aprovar' }); setFeedbackInput(''); }}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors flex items-center gap-1">
                                <Check size={11} /> Aprovar
                              </button>
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'reprovar' }); setFeedbackInput(''); }}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-400 hover:bg-red-400/10 transition-colors flex items-center gap-1">
                                <X size={11} /> Reprovar
                              </button>
                            </>
                          )}
                          {/* Compras: cancelar se ainda aguardando */}
                          {item.status === 'Aguardando Financeiro' && isCompras && (
                            <button onClick={() => handleCancelar(item.id)} title="Cancelar envio"
                              className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-yellow-400">
                              <Trash2 size={12} />
                            </button>
                          )}
                          {/* Aprovado e ainda sem pedido → Compras gera */}
                          {item.status === 'Aprovado' && !cotacoesComPedido.has(item.id) && isCompras && (
                            <button onClick={() => handleGerarPedido(item)} disabled={generating === item.id}
                              className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-yellow-400 hover:bg-yellow-400/10 border border-yellow-400/15 transition-colors flex items-center gap-1 disabled:opacity-50">
                              {generating === item.id ? <Loader2 size={11} className="animate-spin" /> : <ShoppingBag size={11} />}
                              Gerar Pedido
                            </button>
                          )}
                          {/* Negado com feedback longo: botão pra ver o motivo completo */}
                          {item.status === 'Negado' && item.feedback && (
                            <button onClick={() => alert(`Feedback do Financeiro:\n\n${item.feedback}`)}
                              title="Ver feedback completo"
                              className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-cyan-400">
                              <MessageSquare size={12} />
                            </button>
                          )}
                          {/* Inativar — Compras (ou admin/CEO) */}
                          {isCompras && (
                            <button onClick={() => handleDelete(item.id)} title="Inativar"
                              className="action-btn-delete">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
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

      {/* Modal de comparação de propostas concorrentes (mesma requisição) */}
      <AnimatePresence>
        {comparando && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setComparando(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-gray-300">
                    Comparar propostas
                    <span className="text-accent ml-2">
                      — {requisicoes.find((r: any) => r.id === comparando)?.item ?? 'requisição'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {propostasDoModal.length} proposta(s) registrada(s). A menor entre as vivas está destacada.
                  </p>
                </div>
                <button onClick={() => setComparando(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>

              <div className="overflow-auto main-scrollbar flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                      <th className="pb-3 font-bold px-3">Fornecedor</th>
                      <th className="pb-3 font-bold px-3 text-right">Valor</th>
                      <th className="pb-3 font-bold px-3">Prazo</th>
                      <th className="pb-3 font-bold px-3">Validade</th>
                      <th className="pb-3 font-bold px-3 text-center">Status</th>
                      {podeDecidir && <th className="pb-3 font-bold px-3 text-right">Ação</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {propostasDoModal.map((c: any) => {
                      const isVivo = STATUS_VIVOS.has(c.status);
                      const isMenor = isVivo && menorPrecoDoModal !== null && Number(c.valor_total ?? 0) === menorPrecoDoModal;
                      return (
                        <tr key={c.id}
                          className={`border-b border-white/5 ${isMenor ? 'bg-emerald-400/5' : ''} ${!isVivo ? 'opacity-50' : ''}`}>
                          <td className="py-2.5 px-3 text-xs text-gray-200">
                            <div className="flex items-center gap-1.5">
                              {isMenor && <span title="Menor preço"><Award size={12} className="text-emerald-400 shrink-0" /></span>}
                              {c.forn?.nome ?? '—'}
                            </div>
                          </td>
                          <td className={`py-2.5 px-3 text-xs font-mono text-right tabular-nums ${isMenor ? 'text-emerald-300 font-bold' : 'text-gray-200'}`}>
                            R$ {formatBRL(Number(c.valor_total ?? 0))}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-400">{c.prazo_entrega || '—'}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-500 font-mono">{c.validade || '—'}</td>
                          <td className="py-2.5 px-3 text-center"><StatusBadge status={c.status} /></td>
                          {podeDecidir && (
                            <td className="py-2.5 px-3 text-right">
                              {c.status === 'Aguardando Financeiro' && podeDecidirCotacao(c) && (
                                <button
                                  onClick={() => {
                                    setComparando(null);
                                    setDecisao({ cot: c, tipo: 'aprovar' });
                                    setFeedbackInput('');
                                  }}
                                  className="neu-button py-1 px-2.5 rounded-lg text-[11px] font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors inline-flex items-center gap-1"
                                >
                                  <Check size={10} /> Aprovar
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end mt-4 shrink-0">
                <button onClick={() => setComparando(null)}
                  className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">
                  Fechar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de decisão do Financeiro */}
      <AnimatePresence>
        {decisao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !decidindo && setDecisao(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  {decisao.tipo === 'aprovar' ? 'Aprovar cotação' : 'Reprovar cotação'}
                  <span className="text-accent ml-2">— {decisao.cot.forn?.nome ?? 'fornecedor'}</span>
                </h3>
                <button onClick={() => !decidindo && setDecisao(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                {decisao.tipo === 'aprovar'
                  ? 'Aprovar enviará a cotação para o setor de Compras para gerar o pedido. Cotações concorrentes da mesma requisição serão automaticamente canceladas.'
                  : 'Informe o motivo da reprovação. O setor de Compras será notificado para ajustar e criar uma nova cotação.'}
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cot-feedback" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {decisao.tipo === 'reprovar' ? 'Motivo da reprovação *' : 'Observação (opcional)'}
                </label>
                <textarea id="cot-feedback" rows={3}
                  value={feedbackInput} onChange={e => setFeedbackInput(e.target.value)}
                  placeholder={decisao.tipo === 'reprovar'
                    ? 'Ex.: valor acima do orçamento previsto para este trimestre.'
                    : 'Ex.: prazo conforme combinado, fornecedor confiável.'}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setDecisao(null)} disabled={decidindo}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleConfirmDecisao} disabled={decidindo}>
                  {decidindo
                    ? 'Salvando...'
                    : decisao.tipo === 'aprovar' ? 'Confirmar aprovação' : 'Confirmar reprovação'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const CotacoesView = ({ showToast, profile, mode }: { showToast: any; profile: UserProfile; mode?: 'compras' | 'financeiro' }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <CotacoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} mode={mode} />;
};
