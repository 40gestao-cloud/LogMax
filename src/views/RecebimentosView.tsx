import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, CheckCircle2, ChevronDown, Trash2, PackagePlus, X, Lock, PackageX } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { numeroPedido } from '../lib/documentos';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination, SelecioneUnidade, FilaDeTrabalho } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';

// Saldo por pedido vem da view v_pedido_saldo (migr. 202) — soma qtd_recebida
// de recebimentos ativos e devolve quanto ainda cabe. Bloqueia recebimento
// que ultrapasse o pedido (defesa em INSERT + Confirmar).
type SaldoPedido = { qtd_pedida: number; qtd_recebida_total: number; qtd_saldo: number };

// Sentinel do <select> de produto. Compra de item novo é a regra, não a
// exceção: o pedido nasce da requisição com `item_descricao` em texto livre e
// nunca aponta pra `produtos`. Antes disto, chegar com item fora do catálogo
// deixava o recebimento impossível de confirmar — sem produto pra selecionar,
// não havia como dar entrada no estoque. Padrão "select + Outro" do projeto.
const PRODUTO_NOVO = '__novo__';

// Motivos de devolução ao fornecedor (migr. 423). Lista fechada de propósito:
// texto livre aqui viraria "problema" em 90% das linhas, e o que Compras
// precisa levar para o fornecedor é a categoria.
const MOTIVOS_DEVOLUCAO = ['Avaria', 'Item errado', 'Quantidade a maior', 'Fora da validade', 'Outro'] as const;

const RecebimentosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/recebimentosview', { filial }, true,
    { page, searchTerm: debouncedSearch, searchColumns: ['status', 'observacao', 'pedido_id'] }
  );
  // pedidos filtrados pela filial; produtos da mesma filial para atualizar estoque.
  // Realtime nos dois: quem avisa que a carga está a caminho é Compras, marcando
  // o pedido "Em entrega" noutra tela. Sem realtime o almoxarifado recarregava a
  // página no escuro, à espera de um pedido que já estava lá.
  const { data: pedidos } = useFetchData<any>('/api/pedidosview', { filial }, true);
  const { data: produtos, setData: setProdutos } = useFetchData<any>('/api/produtosview', { filial });
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ pedido_id: '' });
  // `produto_id` saiu daqui: a coluna não existe em `recebimentos`, então o
  // campo "Produto recebido" deste form era descartado no INSERT — o usuário
  // escolhia o produto e tinha de escolher de novo no Confirmar. A escolha
  // agora vive só onde de fato move estoque (o painel Confirmar).
  const [extras, setExtras] = useState({ qtd_recebida: '', observacao: '' });
  // Cadastro rápido de produto disparado pelo sentinel PRODUTO_NOVO.
  const [novoProdutoNome, setNovoProdutoNome] = useState<string | null>(null);
  const { errors, validate, clearError, setErrors } = useFormValidation(form);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [confirmProduto, setConfirmProduto] = useState('');
  const [confirmStatus, setConfirmStatus] = useState('Concluído');
  const [confirmSaving, setConfirmSaving] = useState(false);
  // Guard sincrônico — `disabled={confirmSaving}` depende de state React
  // (assíncrono); um double-click rápido entra em handleConfirmar 2× antes
  // do re-render. Este ref tranca o item já em processo imediatamente.
  const confirmingRef = useRef<string | null>(null);

  const pedidosAtivos = pedidos.filter((p: any) => !['Cancelado', 'Recebido'].includes(p.status));

  // Lista sem paginação só para os contadores: a tabela mostra 50 por vez e um
  // "nada a fazer" calculado sobre a página 1 é pior que contador nenhum.
  const { data: todosRecebimentos } = useFetchData<any>('/api/recebimentosview', { filial }, true);
  const pedidosSemRecebimento = pedidos.filter(
    (p: any) => p.status === 'Em Entrega' &&
      !todosRecebimentos.some((r: any) => r.pedido_id === p.id)).length;
  const aguardandoConfirmacao = todosRecebimentos.filter((r: any) => r.status === 'Pendente').length;

  // Devoluções ao fornecedor por recebimento (migr. 423). Guarda quanto já
  // saiu de volta, para o teto do formulário e para o selo na linha.
  const [devolvido, setDevolvido] = useState<Record<string, number>>({});
  const [devolvendo, setDevolvendo] = useState<any | null>(null);
  // Turma com a migr. 423 pendente: o botão some em vez de abrir um modal que
  // termina em erro de PostgREST. O deploy do front chega antes do SQL.
  const [devolucaoDisponivel, setDevolucaoDisponivel] = useState(true);
  const reloadDevolucoes = useCallback(async () => {
    if (!supabase) return;
    const { data: rows, error } = await supabase
      .from('devolucoes_fornecedor')
      .select('recebimento_id, qtd')
      .eq('filial', filial)
      .eq('ativo', true);
    if (error) {
      // Migração pendente nesta turma: o botão some e o resto da tela segue.
      console.warn('[Recebimentos] devoluções indisponíveis:', error.message);
      setDevolvido({});
      setDevolucaoDisponivel(false);
      return;
    }
    setDevolucaoDisponivel(true);
    const map: Record<string, number> = {};
    (rows ?? []).forEach((d: any) => {
      map[d.recebimento_id] = (map[d.recebimento_id] ?? 0) + Number(d.qtd ?? 0);
    });
    setDevolvido(map);
  }, [filial]);
  useEffect(() => { reloadDevolucoes(); }, [reloadDevolucoes, data.length]);

  // Cache de saldo por pedido — recarrega quando a lista de pedidos ou de
  // recebimentos muda (usuário registra/inativa/confirma → saldo mexe).
  const [saldos, setSaldos] = useState<Record<string, SaldoPedido>>({});
  const reloadSaldos = useCallback(async () => {
    if (!supabase) return;
    const { data: rows, error } = await supabase
      .from('v_pedido_saldo')
      .select('pedido_id, qtd_pedida, qtd_recebida_total, qtd_saldo')
      .eq('filial', filial);
    if (error) {
      // View pode não existir ainda (migração 202 pendente) — degrada
      // silenciosamente para o comportamento antigo (sem validação).
      console.warn('[Recebimentos] saldo indisponível:', error.message);
      return;
    }
    const map: Record<string, SaldoPedido> = {};
    (rows ?? []).forEach((r: any) => {
      map[r.pedido_id] = {
        qtd_pedida: Number(r.qtd_pedida ?? 0),
        qtd_recebida_total: Number(r.qtd_recebida_total ?? 0),
        qtd_saldo: Number(r.qtd_saldo ?? 0),
      };
    });
    setSaldos(map);
  }, [filial]);
  useEffect(() => { reloadSaldos(); }, [reloadSaldos, pedidos.length, data.length]);

  // Retorna quanto o item atual pode chegar a receber, sem estourar o pedido.
  // saldo já EXCLUI o próprio recebimento (a view soma todos ativos, então
  // subtraímos o que já está lá pra devolvê-lo ao teto).
  const maxPermitido = (pedidoId: string, qtdAtualDoItem = 0): number => {
    const s = saldos[pedidoId];
    // Falha FECHADA. Era `return Infinity` — se a view v_pedido_saldo não
    // respondesse, o teto sumia e dava para receber qualquer quantidade contra
    // o pedido. Um erro de rede não pode virar permissão.
    if (!s) return NaN;
    return s.qtd_saldo + qtdAtualDoItem;
  };
  const semSaldoConhecido = (max: number) => Number.isNaN(max);
  const produtosOrdenados = useMemo(() => {
    // Normaliza nome: remove diacríticos, faz trim e baixa caixa.
    // Sem normalizar, `localeCompare` deixa itens com leading whitespace
    // (ou caracteres invisíveis tipo BOM) num bloco antes do A.
    const chave = (p: any) =>
      String(p.nome ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
    return [...produtos].sort((a: any, b: any) => chave(a).localeCompare(chave(b), 'pt-BR'));
  }, [produtos]);
  // Search agora é server-side; o enriched é só para juntar dados do pedido.
  const enriched = data.map((r: any) => ({ ...r, ped: pedidos.find((p: any) => p.id === r.pedido_id) }));

  const closeForm = () => { setShowForm(false); setForm({ pedido_id: '' }); setExtras({ qtd_recebida: '', observacao: '' }); setErrors({}); };

  // Produto recém-criado entra na lista local e já fica selecionado — sem
  // isso o usuário voltaria pro select e não encontraria o que acabou de
  // cadastrar (useFetchData só recarrega no mount).
  const handleProdutoCriado = (produto: any) => {
    setProdutos((prev: any[]) => [produto, ...prev]);
    setConfirmProduto(produto.id);
    setNovoProdutoNome(null);
  };

  // Descrição do item do pedido — pré-preenche o nome no cadastro rápido.
  const descricaoDoPedido = (pedidoId: string): string => {
    const p = pedidos.find((x: any) => x.id === pedidoId);
    return p?.item_descricao ?? p?.req?.item ?? '';
  };

  // Produto que o pedido comprou (migr. 396). Vem da requisição de Reposição,
  // que nasce do catálogo — a compra Eventual não tem, e continua deixando o
  // almoxarife escolher. Enquanto o pedido não carregava isso, o select de
  // "Produto recebido" listava o catálogo inteiro e dava pra receber o pedido
  // de arroz dando entrada em notebook: a quantidade era criticada contra o
  // saldo, o produto contra nada.
  const produtoDoPedido = (pedidoId: string): string | null =>
    pedidos.find((x: any) => x.id === pedidoId)?.produto_id ?? null;

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      const today = todayBR();
      const qtd = Number(extras.qtd_recebida) || 0;
      if (qtd <= 0) { showToast('Informe uma quantidade válida.', 'error', true); return; }
      const maxAceito = maxPermitido(form.pedido_id, 0);
      if (semSaldoConhecido(maxAceito)) {
        showToast('Não foi possível ler o saldo do pedido. Recarregue a tela antes de registrar.', 'error', true);
        return;
      }
      if (qtd > maxAceito) {
        showToast(`Excede o saldo do pedido — máximo ${maxAceito} unidades.`, 'error', true);
        return;
      }
      // `filial` é obrigatório: a coluna é NOT NULL DEFAULT 'SuperMax', então
      // sem isto todo recebimento da TechMax/MaxLook era gravado como SuperMax.
      const payload = { pedido_id: form.pedido_id, qtd_recebida: qtd, observacao: extras.observacao, status: 'Pendente', data: today, filial };
      const s = await dbInsert('/api/recebimentosview', payload);
      setData([s ?? { id: Date.now(), ...payload }, ...data]);
      await reloadSaldos();
      showToast("Recebimento registrado — o estoque ainda NÃO mudou. Clique em Confirmar na linha para dar entrada e liberar o pagamento.", 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao salvar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Inativar este recebimento? Ele sairá da lista mas o histórico fica preservado.')) return;
    try {
      await dbDelete('/api/recebimentosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      await reloadSaldos();
      showToast('Recebimento inativado.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Recebimentos] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  const handleConfirmar = async (item: any) => {
    if (!confirmProduto) { showToast('Selecione o produto recebido.', 'error', true); return; }
    const qtdItem = Number(item.qtd_recebida) || 0;
    if (!(qtdItem > 0)) { showToast('Quantidade inválida no recebimento.', 'error', true); return; }
    // Defesa em profundidade — bloqueia se o pedido foi editado depois do
    // registro e agora o total ficou acima do pedido.
    const maxAceito = maxPermitido(item.pedido_id, qtdItem);
    if (semSaldoConhecido(maxAceito)) {
      showToast('Não foi possível ler o saldo do pedido. Recarregue a tela antes de confirmar.', 'error', true);
      return;
    }
    if (qtdItem > maxAceito) {
      showToast(`Recebimento excede o saldo do pedido — máximo ${maxAceito} unidades. Ajuste antes de confirmar.`, 'error', true);
      return;
    }
    // Guard sincrônico contra double-click (vide ref acima).
    if (confirmingRef.current === item.id) return;
    confirmingRef.current = item.id;
    setConfirmSaving(true);
    try {
      const today = todayBR();
      // Movimentação PRIMEIRO — se falhar, status fica Pendente e o botão "Confirmar" reaparesce para retry.
      // Só atualiza o status após a movimentação estar salva no banco.
      if (confirmStatus === 'Concluído' || confirmStatus === 'Parcial') {
        try {
          await dbInsert('/api/movimentacoesestoqueview', {
            produto_id:     confirmProduto,
            tipo:           'Entrada',
            qtd:            Number(item.qtd_recebida) || 0,
            origem:         numeroPedido(item.ped ?? { id: item.pedido_id }),
            destino:        'Almoxarifado',
            data:           today,
            recebimento_id: item.id,
            filial,
          });
        } catch (movErr: any) {
          // 23505 = violação de UNIQUE: este recebimento já gerou movimento
          // (race em outra aba/clique). Idempotência: tratamos como sucesso.
          const msg = String(movErr?.message ?? '');
          const isDuplicate = msg.includes('uq_mov_estoque_por_recebimento')
                            || msg.includes('23505')
                            || /duplicate key value/i.test(msg);
          if (!isDuplicate) throw movErr;
        }
      }
      await dbUpdate('/api/recebimentosview', item.id, { status: confirmStatus });
      setData((prev: any[]) => prev.map(r => r.id === item.id ? { ...r, status: confirmStatus } : r));
      await reloadSaldos();

      // Sincronia: recebimento "Concluído" fecha o pedido relacionado.
      // "Parcial" deixa o pedido em "Em Entrega" para permitir entregas adicionais.
      if (confirmStatus === 'Concluído' && item.pedido_id) {
        const ped = pedidos.find((p: any) => p.id === item.pedido_id);
        if (ped && ped.status !== 'Recebido' && ped.status !== 'Cancelado') {
          try { await dbUpdate('/api/pedidosview', item.pedido_id, { status: 'Recebido' }); }
          catch { /* não bloqueia o fluxo — relatórios mostrarão divergência */ }
        }
      }

      setConfirmando(null);
      setConfirmProduto('');
      setConfirmStatus('Concluído');
      showToast(
        confirmStatus === 'Concluído'
          ? 'Recebimento confirmado, estoque atualizado e pedido encerrado. A conta do fornecedor está liberada para pagamento em Financeiro → Contas a pagar.'
          : 'Recebimento parcial confirmado e estoque atualizado. O pedido segue em entrega, esperando o restante da carga.',
        'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setConfirmSaving(false);
      confirmingRef.current = null;
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Recebimentos — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Registre o que chegou e confirme a entrada. É a confirmação que move o estoque
            e libera o pagamento do fornecedor.
          </p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Registrar</NeuButtonAccent>
        </div>
      </div>

      <FilaDeTrabalho itens={[
        { label: 'pedido(s) em entrega sem recebimento', count: pedidosSemRecebimento, hint: 'clique em "Registrar" quando a carga chegar' },
        { label: 'recebimento(s) aguardando confirmação', count: aguardandoConfirmacao, hint: 'até confirmar, o estoque não mudou' },
      ]} />

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Novo Recebimento</h3>
              <p className="text-[11px] text-gray-500 -mt-2">
                O produto que entra no estoque é escolhido na hora de confirmar — inclusive se for item novo, que dá pra cadastrar ali mesmo.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Pedido *" error={errors.pedido_id}><select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.pedido_id ? 'border border-red-500/40' : ''}`} value={form.pedido_id} onChange={e => { setForm(f => ({ ...f, pedido_id: e.target.value })); clearError('pedido_id'); }}><option value="">Selecione...</option>{pedidosAtivos.map((p: any) => {
                  const desc = p.item_descricao ?? p.req?.item ?? '';
                  const s = saldos[p.id];
                  const sufSaldo = s ? ` — falta ${s.qtd_saldo}/${s.qtd_pedida}` : '';
                  const esgotado = s && s.qtd_saldo <= 0;
                  return <option key={p.id} value={p.id} disabled={esgotado}>{numeroPedido(p)}{desc ? ` — ${desc}` : ''}{sufSaldo}{esgotado ? ' (recebido totalmente)' : ''}</option>;
                })}</select></FormField>
                <FormField label="Qtd Recebida"><input type="number" min="1" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd_recebida} onChange={e => setExtras(x => ({ ...x, qtd_recebida: e.target.value }))} placeholder="0" /></FormField>
                <FormField label="Observação"><input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.observacao} onChange={e => setExtras(x => ({ ...x, observacao: e.target.value }))} placeholder="Opcional..." /></FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Registrar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Data</th><th className="pb-4 font-bold px-4">Pedido</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Observação</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : enriched.length === 0 ? (<tr><td colSpan={6}><EmptyState /></td></tr>) : (
                <AnimatePresence>
                  {enriched.map((item: any) => (
                    <React.Fragment key={item.id}>
                      <motion.tr initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-300">{numeroPedido(item.ped ?? { id: item.pedido_id })}</td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">
                          {item.qtd_recebida ?? '—'}
                          {(devolvido[item.id] ?? 0) > 0 && (
                            <div className="text-[10px] text-amber-400 mt-0.5" title="Devolvido ao fornecedor por divergência.">
                              − {devolvido[item.id]} devolvido
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.observacao || '—'}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                          <HistoricoOperacoes entidade="recebimentos" entidadeId={item.id} titulo={`Recebimento ${String(item.id).slice(-6).toUpperCase()}`} />
                            {devolucaoDisponivel
                              && (item.status === 'Concluído' || item.status === 'Parcial')
                              && (Number(item.qtd_recebida ?? 0) - (devolvido[item.id] ?? 0)) > 0 && (
                              <button
                                onClick={() => setDevolvendo(item)}
                                title="Chegou avariado, errado ou a mais? Devolva ao fornecedor."
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-amber-400 hover:bg-amber-400/10 transition-colors flex items-center gap-1"
                              >
                                <PackageX size={11} /> Divergência
                              </button>
                            )}
                            {item.status === 'Pendente' && (
                              <button
                                onClick={() => {
                                  setConfirmando(confirmando === item.id ? null : item.id);
                                  // Pedido com produto declarado já abre resolvido: não há
                                  // escolha a fazer, e deixar o campo vazio faria o almoxarife
                                  // procurar no catálogo o que o pedido já diz.
                                  setConfirmProduto(produtoDoPedido(item.pedido_id) ?? '');
                                  // Auto-status: soma dos recebimentos ativos (incluindo esse) atinge
                                  // o pedido → sugere Concluído (fecha pedido). Senão Parcial.
                                  const s = saldos[item.pedido_id];
                                  const fecha = s ? s.qtd_recebida_total >= s.qtd_pedida : true;
                                  setConfirmStatus(fecha ? 'Concluído' : 'Parcial');
                                }}
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 transition-colors flex items-center gap-1"
                              >
                                <CheckCircle2 size={11} /> Confirmar <ChevronDown size={10} className={`transition-transform ${confirmando === item.id ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
                      <AnimatePresence>
                        {confirmando === item.id && (
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <td colSpan={6} className="pb-3 px-4">
                              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 p-4 rounded-2xl" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.12)' }}>
                                {saldos[item.pedido_id] && (
                                  <div className="basis-full flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400 -mt-1 mb-1">
                                    <span>Pedido: <strong className="text-gray-200">{saldos[item.pedido_id].qtd_pedida}</strong></span>
                                    <span>Já recebido: <strong className="text-gray-200">{saldos[item.pedido_id].qtd_recebida_total}</strong></span>
                                    <span>Saldo restante: <strong className={saldos[item.pedido_id].qtd_saldo > 0 ? 'text-amber-300' : 'text-emerald-300'}>{saldos[item.pedido_id].qtd_saldo}</strong></span>
                                  </div>
                                )}
                                {/* Pedido de Reposição já sabe o produto: o campo vira leitura.
                                    A trava de verdade está na trigger da migr. 396 — esta tela
                                    só evita que o almoxarife tenha de adivinhar (e o F12 não
                                    passa pelo <select> mesmo). */}
                                {produtoDoPedido(item.pedido_id) ? (
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Produto recebido</span>
                                  <div className="neu-pressed py-2 px-3 rounded-xl text-xs text-gray-200 flex items-center gap-1.5">
                                    <Lock size={11} className="text-gray-500 shrink-0" />
                                    {produtos.find((p: any) => p.id === produtoDoPedido(item.pedido_id))?.nome
                                      ?? descricaoDoPedido(item.pedido_id) ?? '—'}
                                  </div>
                                  <p className="text-[10px] text-gray-500">
                                    Definido no pedido, herdado da requisição. Chegou outra coisa? Não confirme —
                                    registre a divergência com Compras.
                                  </p>
                                </div>
                                ) : (
                                <div className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
                                  <label htmlFor={`receb-produto-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Produto recebido *</label>
                                  <select
                                    id={`receb-produto-${item.id}`}
                                    className="neu-input py-2 px-3 rounded-xl text-xs w-full"
                                    value={confirmProduto}
                                    onChange={e => {
                                      if (e.target.value === PRODUTO_NOVO) {
                                        setNovoProdutoNome(descricaoDoPedido(item.pedido_id));
                                        return;  // não fixa o sentinel como valor
                                      }
                                      setConfirmProduto(e.target.value);
                                    }}
                                  >
                                    <option value="">Selecione o produto...</option>
                                    {produtosOrdenados.map((p: any) => <option key={p.id} value={p.id}>{p.nome} (saldo: {p.estoque ?? 0})</option>)}
                                    <option value={PRODUTO_NOVO}>➕ Produto novo — cadastrar agora…</option>
                                  </select>
                                  <p className="text-[10px] text-gray-500">
                                    Compra eventual não vem do catálogo, então o produto é escolhido aqui.
                                    Não está cadastrado? Use “Produto novo” — o cadastro mínimo abre aqui e o item já entra selecionado.
                                  </p>
                                </div>
                                )}
                                <div className="flex flex-col gap-1">
                                  <label htmlFor={`receb-status-${item.id}`} className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Status final</label>
                                  <select id={`receb-status-${item.id}`} className="neu-input py-2 px-3 rounded-xl text-xs w-full" value={confirmStatus} onChange={e => setConfirmStatus(e.target.value)}>
                                    {['Concluído', 'Parcial'].map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div className="flex gap-2 sm:contents">
                                  <button onClick={() => handleConfirmar(item)} disabled={confirmSaving}
                                    className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none">
                                    {confirmSaving ? 'Salvando...' : <><Save size={12} /> Confirmar e atualizar estoque</>}
                                  </button>
                                  <button onClick={() => setConfirmando(null)} className="neu-button py-2 px-3 rounded-xl text-xs text-gray-500 flex items-center justify-center">Cancelar</button>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))}
                </AnimatePresence>
              )}
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

      <AnimatePresence>
        {devolvendo && (
          <ModalDevolucao
            item={devolvendo}
            disponivel={Number(devolvendo.qtd_recebida ?? 0) - (devolvido[devolvendo.id] ?? 0)}
            produtoNome={produtos.find((p: any) => p.id === produtoDoPedido(devolvendo.pedido_id))?.nome
              ?? descricaoDoPedido(devolvendo.pedido_id)}
            showToast={showToast}
            onClose={() => setDevolvendo(null)}
            onFeito={async () => {
              setDevolvendo(null);
              await Promise.all([reload(), reloadDevolucoes(), reloadSaldos()]);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {novoProdutoNome !== null && (
          <ModalProdutoRapido
            nomeInicial={novoProdutoNome}
            filial={filial}
            produtos={produtos}
            showToast={showToast}
            onClose={() => setNovoProdutoNome(null)}
            onCriado={handleProdutoCriado}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Devolução ao fornecedor ─────────────────────────────────────────
// A conferência que dá consequência a "chegou errado" (migr. 423). Toda a
// regra — teto pela quantidade recebida, baixa de estoque, abatimento da conta
// a pagar e encerramento do pedido — vive na RPC; aqui é só a conversa.
const ModalDevolucao = ({ item, disponivel, produtoNome, showToast, onClose, onFeito }: {
  item: any;
  disponivel: number;
  produtoNome?: string;
  showToast: any;
  onClose: () => void;
  onFeito: () => void | Promise<void>;
}) => {
  const [qtd, setQtd] = useState(String(disponivel));
  const [motivo, setMotivo] = useState<string>(MOTIVOS_DEVOLUCAO[0]);
  const [reenvio, setReenvio] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  const qtdNum = Number(qtd);
  const qtdValida = Number.isFinite(qtdNum) && qtdNum > 0 && qtdNum <= disponivel;

  const enviar = async () => {
    if (!supabase) return;
    if (!qtdValida) { showToast(`Informe uma quantidade entre 1 e ${disponivel}.`, 'error', true); return; }
    setSaving(true);
    try {
      const { data: res, error } = await supabase.rpc('registrar_devolucao_fornecedor', {
        p_recebimento_id:   item.id,
        p_qtd:              Math.trunc(qtdNum),
        p_motivo:           motivo,
        p_reenvio_esperado: reenvio,
        p_observacao:       observacao || null,
      });
      if (error) throw new Error(error.message);

      const r = (res ?? {}) as any;
      // Cada efeito vira uma frase: o aluno precisa ver que devolver mexe em
      // estoque, financeiro e no pedido ao mesmo tempo.
      const partes = [
        `${r.qtd} unidade(s) devolvida(s) ao fornecedor.`,
        r.estoque_baixado ? 'Estoque baixado.' : 'Sem baixa de estoque (o recebimento não tinha produto vinculado).',
        r.conta_efeito === 'abatida'   ? `Conta a pagar abatida em R$ ${Number(r.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
        : r.conta_efeito === 'cancelada' ? 'A conta a pagar do pedido foi cancelada — nada mais a pagar.'
        : r.conta_efeito === 'ja_paga'   ? 'ATENÇÃO: a conta deste pedido já foi paga. O crédito precisa ser negociado com o fornecedor.'
        : null,
        r.pedido_fechado ? 'Pedido encerrado.'
          : reenvio ? `Saldo do pedido voltou para ${r.saldo_pedido} unidade(s) — aguardando reposição.` : null,
      ].filter(Boolean);

      showToast(partes.join(' '), r.conta_efeito === 'ja_paga' ? 'info' : 'success', true);
      await onFeito();
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao registrar a devolução.', 'error', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-amber-400/20 p-5 sm:p-6 w-full max-w-lg my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-400/15 flex items-center justify-center ring-1 ring-amber-400/25 shrink-0">
              <PackageX size={16} className="text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-gray-100">Devolver ao fornecedor</h3>
              <p className="text-[11px] text-gray-500 truncate">
                {produtoNome || 'Item do pedido'} · recebido {item.qtd_recebida} · disponível {disponivel}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Quantidade * (máx. ${disponivel})`}>
            <input type="number" min={1} max={disponivel}
              className="neu-input py-2 px-3 rounded-xl text-sm"
              value={qtd} onChange={e => setQtd(e.target.value)} />
          </FormField>
          <FormField label="Motivo *">
            <select className="neu-input py-2 px-3 rounded-xl text-sm" value={motivo} onChange={e => setMotivo(e.target.value)}>
              {MOTIVOS_DEVOLUCAO.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </FormField>
        </div>

        <FormField label="Observação">
          <input className="neu-input py-2 px-3 rounded-xl text-sm" value={observacao}
            onChange={e => setObservacao(e.target.value)}
            placeholder="O que aconteceu, para Compras cobrar o fornecedor" />
        </FormField>

        {/* A pergunta que decide o destino do pedido. */}
        <div className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={reenvio} onChange={e => setReenvio(e.target.checked)} />
            <span className="text-xs text-gray-300">
              O fornecedor vai repor esta quantidade
              <span className="block text-[10px] text-gray-500 mt-0.5">
                {reenvio
                  ? 'O saldo do pedido reabre e o Estoque volta a esperar a carga.'
                  : 'O pedido encerra com o que chegou — não haverá reposição.'}
              </span>
            </span>
          </label>
        </div>

        <p className="text-[10px] text-gray-500 leading-snug">
          Ao confirmar: sai do estoque, a conta a pagar do pedido é abatida pelo valor devolvido
          (se ainda estiver pendente) e o pedido é encerrado ou reaberto conforme a escolha acima.
        </p>

        <div className="flex gap-3 justify-end pt-1 border-t border-white/5">
          <button onClick={onClose} disabled={saving} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
          <NeuButtonAccent onClick={enviar} isLoading={saving} disabled={!qtdValida}>
            <PackageX size={14} /> Registrar devolução
          </NeuButtonAccent>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─── Cadastro rápido de produto ──────────────────────────────────────
// Mínimo que o banco exige (codigo + nome) mais o que o estoque precisa pra
// não nascer mentindo (unidade e preço). O restante — categoria, marca,
// fornecedor, custo — fica pro Cadastros > Produtos completar depois: travar
// o recebimento até o cadastro completo é o que causava o impasse.
const ModalProdutoRapido = ({ nomeInicial, filial, produtos, showToast, onClose, onCriado }: {
  nomeInicial: string;
  filial: FilialOp;
  produtos: any[];
  showToast: any;
  onClose: () => void;
  onCriado: (produto: any) => void;
}) => {
  // Sugere o próximo código numérico livre da filial. Códigos são únicos por
  // filial e a base tem formatos mistos (ML-004 convive com 31) — por isso só
  // olhamos a parte numérica.
  const sugestao = useMemo(() => {
    const maior = produtos.reduce((max: number, p: any) => {
      const n = parseInt(String(p.codigo ?? '').replace(/\D/g, ''), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return String(maior + 1).padStart(3, '0');
  }, [produtos]);

  const [codigo, setCodigo] = useState(sugestao);
  const [nome, setNome] = useState(nomeInicial);
  const [unidade, setUnidade] = useState('UN');
  const [preco, setPreco] = useState('');
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    if (!codigo.trim()) return showToast('Informe o código do produto.', 'error', true);
    if (!nome.trim()) return showToast('Informe o nome do produto.', 'error', true);
    const duplicado = produtos.some((p: any) =>
      String(p.codigo ?? '').trim().toLowerCase() === codigo.trim().toLowerCase());
    if (duplicado) return showToast(`Código ${codigo} já existe nesta filial.`, 'error', true);

    setSaving(true);
    try {
      // estoque começa em 0 de propósito: quem move o saldo é a movimentação
      // gerada pelo Confirmar, logo em seguida. Semear a quantidade aqui
      // contaria a entrada duas vezes.
      const criado = await dbInsert('/api/produtosview', {
        codigo:   codigo.trim(),
        nome:     nome.trim(),
        unidade:  unidade || 'UN',
        preco:    preco ? parseBRL(preco) : 0,
        estoque:  0,
        filial,
        status:   'Ativo',
      });
      showToast('Produto cadastrado e selecionado. Complete o cadastro depois em Cadastros > Produtos.', 'success', true);
      onCriado(criado);
    } catch (err: any) {
      showToast(`Erro ao cadastrar produto: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="neu-flat rounded-2xl border border-accent/20 p-5 sm:p-6 w-full max-w-lg my-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center ring-1 ring-accent/25 shrink-0">
              <PackagePlus size={16} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-gray-100">Cadastro rápido de produto</h3>
              <p className="text-[11px] text-gray-500">Entra no catálogo da {filial} com saldo zero.</p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 neu-button rounded-lg p-1.5 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Código *">
            <input className="neu-input py-2 px-3 rounded-xl text-sm" value={codigo}
              onChange={e => setCodigo(e.target.value)} placeholder="Ex: 001" />
          </FormField>
          <FormField label="Unidade">
            <select className="neu-input py-2 px-3 rounded-xl text-sm" value={unidade} onChange={e => setUnidade(e.target.value)}>
              {['UN', 'CX', 'KG', 'L', 'M', 'PC'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </FormField>
        </div>

        <FormField label="Nome do produto *">
          <input className="neu-input py-2 px-3 rounded-xl text-sm" value={nome}
            onChange={e => setNome(e.target.value)} placeholder="Ex: Parafuso M6" />
        </FormField>

        <FormField label="Preço de venda">
          <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
            value={preco} onChange={e => setPreco(formatBRL(e.target.value))} placeholder="0,00" />
        </FormField>

        <p className="text-[10px] text-gray-500 leading-snug">
          Categoria, marca, fornecedor e preço de custo ficam pendentes — complete em
          <span className="text-gray-300 font-semibold"> Cadastros &gt; Produtos</span> quando der.
        </p>

        <div className="flex gap-3 justify-end pt-1 border-t border-white/5">
          <button onClick={onClose} disabled={saving} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
          <NeuButtonAccent onClick={salvar} isLoading={saving}><Save size={14} /> Cadastrar e selecionar</NeuButtonAccent>
        </div>
      </motion.div>
    </motion.div>
  );
};

export const RecebimentosView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="O recebimento de mercadoria" />;
  return <RecebimentosViewInner showToast={showToast} filial={filialAtiva} />;
};
