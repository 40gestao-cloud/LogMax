import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, Tag, TrendingDown, Info, Megaphone, Package } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { EmptyState, LoadingSpinner } from '../components/ui';
import { playPlim } from '../utils/audioUtils';

// ── Aba Promoções (código original) ──────────────────────────────────────────
function AbaPromocoes({ showToast, filial }: any) {
  // MIGR 576: a fila tem DOIS passos. 'Aguardando Aprovação' espera o parecer
  // do Financeiro; 'Em Análise' já tem parecer e espera o gerente liberar. Por
  // isso a busca não filtra mais por um status só.
  const { data: promocoes, setData } = useFetchData<any>('/api/marketingpromocoesview', { filial }, true);
  const [obs,       setObs]       = useState<Record<string, string>>({});
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [processing,setProcessing]= useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc('reverter_promocoes_expiradas').then(({ error }) => {
      if (error) console.warn('[reverter_promocoes_expiradas]', error.message);
    });
  }, []);

  // Status da promoção e preço do produto eram dois `dbUpdate` soltos, sem
  // transação e sem rollback: falhando o segundo, a promoção ficava APROVADA
  // com o preço velho. E como a linha só saía da fila no caminho feliz, a tela
  // seguia mostrando "aguardando" enquanto o banco já dizia "Aprovado" — no
  // primeiro F5 sumia da fila e ninguém voltava a olhar. A migr. 402 juntou as
  // duas escritas numa RPC e pôs a régua no banco.
  const handleAprovar = async (promo: any) => {
    if (processing || !supabase) return;
    setProcessing(promo.id);
    try {
      const { data: res, error } = await supabase.rpc('aprovar_promocao', {
        p_promocao_id: promo.id,
        p_observacao:  obs[promo.id] ?? '',
      });
      if (error) throw new Error(error.message);
      setData((prev: any[]) => prev.map(p => p.id === promo.id ? { ...p, status: 'Aprovado' } : p));
      playPlim();
      // Só anuncia o preço quando ele mudou de fato: promoção de serviço não
      // tem produto, e dizer "preço atualizado no PDV" ali era falso.
      const semPrazo = (res as any)?.sem_prazo
        ? ' Atenção: sem data de fim, o preço não volta sozinho.'
        : '';
      showToast(
        ((res as any)?.preco_alterado
          ? 'Promoção aprovada! Preço atualizado no PDV.'
          : 'Promoção aprovada.') + semPrazo,
        'success', true);
    } catch (err: any) {
      showToast(`Não foi possível aprovar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setProcessing(null); }
  };

  // Passo 1 — o Financeiro confere a margem e manda para o gerente. O texto é
  // obrigatório: é o que o gerente lê antes de liberar o preço.
  const handleParecer = async (promo: any) => {
    if (processing || !supabase) return;
    const parecer = (obs[promo.id] ?? '').trim();
    if (parecer.length < 5) {
      setExpanded(promo.id);
      showToast('Escreva o parecer — é o que o gerente lê antes de liberar o preço.', 'error', true);
      return;
    }
    setProcessing(promo.id);
    try {
      const { data: res, error } = await supabase.rpc('analisar_promocao_financeiro', {
        p_promocao_id: promo.id,
        p_parecer:     parecer,
      });
      if (error) throw new Error(error.message);
      const margem = (res as any)?.margem_pct;
      setData((prev: any[]) => prev.map(p => p.id === promo.id
        ? { ...p, status: 'Em Análise', parecer_financeiro: parecer, margem_pct: margem }
        : p));
      setObs(o => ({ ...o, [promo.id]: '' }));
      showToast(
        margem != null
          ? `Parecer enviado ao gerente. Margem no preço promocional: ${Number(margem).toFixed(1)}%.`
          : 'Parecer enviado ao gerente.',
        'success', true);
    } catch (err: any) {
      showToast(`Não foi possível enviar o parecer: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setProcessing(null); }
  };

  const handleReprovar = async (promo: any) => {
    if (processing || !supabase) return;
    if (!obs[promo.id]?.trim()) { showToast('Informe uma observação para reprovar.', 'error', true); return; }
    setProcessing(promo.id);
    try {
      const { error } = await supabase.rpc('reprovar_promocao', {
        p_promocao_id: promo.id,
        p_observacao:  obs[promo.id],
      });
      if (error) throw new Error(error.message);
      setData((prev: any[]) => prev.map(p => p.id === promo.id ? { ...p, status: 'Reprovado' } : p));
      showToast('Promoção reprovada.', 'info', true);
    } catch (err: any) {
      showToast(`Não foi possível reprovar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setProcessing(null); }
  };

  // MIGR 579: puxar a oferta do ar antes do prazo é rotina de loja — rompeu o
  // estoque, o preço saiu errado, a campanha caiu. Depois da 578 encerrar a
  // REGRA basta: o preço de tabela nunca saiu do cadastro, então o caixa volta
  // a cobrá-lo sozinho. Não há preço para restaurar.
  const handleEncerrar = async (promo: any) => {
    if (processing || !supabase) return;
    const motivo = (obs[promo.id] ?? '').trim();
    if (motivo.length < 5) {
      showToast('Diga por que a oferta está saindo do ar — o cliente vai perguntar.', 'error', true);
      setExpanded(promo.id);
      return;
    }
    setProcessing(promo.id);
    try {
      const { error } = await supabase.rpc('encerrar_promocao', {
        p_promocao_id: promo.id,
        p_motivo:      motivo,
      });
      if (error) throw new Error(error.message);
      setData((prev: any[]) => prev.map(p => p.id === promo.id ? { ...p, status: 'Encerrada' } : p));
      showToast('Oferta encerrada. O preço de tabela volta a valer no caixa.', 'success', true);
      setExpanded(null);
    } catch (err: any) {
      showToast(`Não foi possível encerrar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setProcessing(null); }
  };

  // Só o que está em curso aparece: aprovada já virou preço, reprovada morreu.
  const naFila = (promocoes ?? []).filter(
    (p: any) => p.status === 'Aguardando Aprovação' || p.status === 'Em Análise');
  // O que está no ar agora. Fica nesta tela porque é aqui que mora a autoridade
  // sobre o preço — quem libera é quem tira do ar.
  const vigentes = (promocoes ?? []).filter((p: any) => p.status === 'Aprovado');

  const calcDesconto = (promo: any) => {
    const atual = Number(promo.preco_atual || 0);
    const p     = Number(promo.preco_promocional || 0);
    if (!atual || p >= atual) return null;
    return ((atual - p) / atual * 100).toFixed(1);
  };

  return (
    <>
      <div className="flex items-start gap-3 p-4 rounded-2xl border border-accent/20"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' }}>
        <Info size={16} className="text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400 leading-relaxed">
          A oferta anda em dois passos, como na loja: o <span className="text-accent font-bold">Financeiro</span> confere
          o custo e dá o parecer de viabilidade; depois o <span className="text-accent font-bold">gerente da filial</span> revisa
          e libera. É a liberação do gerente que troca o preço no PDV — e ao fim da campanha o preço original volta sozinho.
        </p>
      </div>

      {naFila.length === 0 ? (
        <EmptyState message="Nenhuma oferta na fila — nem para parecer do Financeiro, nem para liberação do gerente" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {naFila.map((promo: any) => {
            const desc = calcDesconto(promo);
            return (
              <motion.div key={promo.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Tag size={14} className="text-accent shrink-0" />
                      <p className="text-sm font-bold text-gray-200 truncate">{promo.nome_produto ?? 'Produto'}</p>
                    </div>
                    {promo.descricao && <p className="text-xs text-gray-500 mt-1 truncate">{promo.descricao}</p>}
                    {(promo.data_inicio || promo.data_fim) && (
                      <p className="text-[10px] font-mono text-gray-600 mt-1">Período: {promo.data_inicio ?? '?'} → {promo.data_fim ?? '?'}</p>
                    )}
                    {promo.nome_criador && <p className="text-[10px] text-gray-600 mt-0.5">Proposto por: {promo.nome_criador}</p>}
                    <p className="text-[10px] font-bold uppercase tracking-widest mt-1"
                      style={{ color: promo.status === 'Em Análise' ? 'var(--color-accent)' : '#9ca3af' }}>
                      {promo.status === 'Em Análise'
                        ? 'Passo 2 · com o gerente da filial'
                        : 'Passo 1 · com o Financeiro'}
                    </p>
                  </div>
                  {desc && (
                    <div className="flex items-center gap-1 text-[10px] font-black text-accent shrink-0 px-2 py-1 rounded-full border border-accent/20"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                      <TrendingDown size={10} />-{desc}%
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="neu-pressed rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Custo</p>
                    <p className="text-xs font-mono font-bold text-gray-500">
                      {promo.preco_custo > 0 ? `R$ ${Number(promo.preco_custo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                    </p>
                  </div>
                  <div className="neu-pressed rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">Preço Atual</p>
                    <p className="text-xs font-mono font-bold text-gray-200">
                      R$ {Number(promo.preco_atual || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="neu-pressed rounded-xl p-3 border border-accent/25">
                    <p className="text-[9px] font-bold text-accent uppercase tracking-widest mb-1.5">Sugestão</p>
                    <p className="text-xs font-mono font-black text-accent">
                      R$ {Number(promo.preco_promocional || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                {promo.status === 'Em Análise' && (
                  <div className="neu-pressed rounded-xl p-3">
                    <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                      Parecer do Financeiro
                      {promo.analisado_por_nome ? ` · ${promo.analisado_por_nome}` : ''}
                      {promo.margem_pct != null ? ` · margem ${Number(promo.margem_pct).toFixed(1)}%` : ''}
                    </p>
                    <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                      {promo.parecer_financeiro || '—'}
                    </p>
                    {promo.margem_pct != null && Number(promo.margem_pct) < 0 && (
                      <p className="text-[11px] font-bold text-red-500 mt-1.5">
                        Margem negativa: este preço vende abaixo do custo. Só libere se a oferta for assumida como custo de marketing.
                      </p>
                    )}
                  </div>
                )}
                {expanded === promo.id && (
                  <textarea className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16"
                    placeholder={promo.status === 'Em Análise'
                      ? 'Observação da liberação (obrigatória para reprovar)...'
                      : 'Parecer do Financeiro (obrigatório) — a margem e a decisão...'}
                    value={obs[promo.id] ?? ''} onChange={e => setObs(o => ({ ...o, [promo.id]: e.target.value }))} />
                )}
                <div className="flex gap-2 justify-end items-center">
                  {expanded !== promo.id && (
                    <button onClick={() => setExpanded(promo.id)} disabled={!!processing}
                      className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400 disabled:opacity-40">
                      {promo.status === 'Em Análise' ? 'Adicionar obs.' : 'Escrever parecer'}
                    </button>
                  )}
                  <button onClick={() => handleReprovar(promo)} disabled={processing === promo.id}
                    className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-500 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                    {processing === promo.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Reprovar
                  </button>
                  {promo.status === 'Em Análise' ? (
                    <button onClick={() => handleAprovar(promo)} disabled={processing === promo.id}
                      title="Libera a oferta: o preço muda no PDV agora"
                      className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                      {processing === promo.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Liberar (gerente)
                    </button>
                  ) : (
                    <button onClick={() => handleParecer(promo)} disabled={processing === promo.id}
                      title="Envia o parecer de viabilidade ao gerente da filial"
                      className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                      {processing === promo.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Enviar parecer
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Ofertas no ar — e o botão para tirá-las. */}
      {vigentes.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
            No ar agora · {vigentes.length}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {vigentes.map((promo: any) => (
              <div key={promo.id} className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-200 truncate">{promo.nome_produto ?? 'Produto'}</p>
                    <p className="text-[10px] font-mono text-gray-600 mt-0.5">
                      até {promo.data_fim ?? 'sem prazo'}
                    </p>
                  </div>
                  <p className="text-xs font-mono font-black text-accent shrink-0">
                    R$ {Number(promo.preco_promocional || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                {expanded === promo.id && (
                  <textarea className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16"
                    placeholder="Por que está saindo do ar? (ruptura de estoque, preço errado, campanha cancelada…)"
                    value={obs[promo.id] ?? ''} onChange={e => setObs(o => ({ ...o, [promo.id]: e.target.value }))} />
                )}
                <div className="flex gap-2 justify-end">
                  {expanded !== promo.id ? (
                    <button onClick={() => setExpanded(promo.id)} disabled={!!processing}
                      className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400 disabled:opacity-40">
                      Encerrar antes do prazo
                    </button>
                  ) : (
                    <button onClick={() => handleEncerrar(promo)} disabled={processing === promo.id}
                      title="Tira a oferta do ar agora. O preço de tabela volta a valer sozinho — não há preço a restaurar."
                      className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-orange-400 hover:bg-orange-900/20 border border-orange-500/20 disabled:opacity-40 flex items-center gap-1">
                      {processing === promo.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Confirmar encerramento
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Aba Campanhas ─────────────────────────────────────────────────────────────
function AbaCampanhas({ showToast, filial }: any) {
  const { data: campanhas, setData: setCampanhas, isLoading: loadingCamp } =
    useFetchData<any>('/api/marketingcampanhasview', { status: 'Aguardando Financeiro', filial }, true);
  // itens_campanha não tem coluna filial própria — escopo é derivado
  // via campanha_id (só carregamos itens das campanhas já filtradas).
  const { data: todosItens, setData: setItens } = useFetchData<any>('itens_campanha');
  // View mascarada: Financeiro aprova promoção olhando a margem (migr. 262).
  const { data: produtos } = useFetchData<any>('/api/produtoscomcustoview', { filial });

  const [motivos,    setMotivos]    = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [campAberta, setCampAberta] = useState<string | null>(null);

  const prodMap: Record<string, any> = {};
  for (const p of produtos) prodMap[p.id] = p;

  const itensDaCamp = (campId: string) => todosItens.filter((i: any) => i.campanha_id === campId);

  const atualizaItem = async (itemId: string, status: string, motivo?: string) => {
    if (!supabase) return;
    const payload: any = { status };
    if (motivo !== undefined) payload.motivo_reprovacao = motivo || null;
    const { data, error } = await supabase.from('itens_campanha').update(payload).eq('id', itemId).select().single();
    if (error) throw error;
    setItens((prev: any[]) => prev.map((i: any) => i.id === itemId ? { ...i, ...data } : i));
  };

  const calcNovoStatusCampanha = (itens: any[]) => {
    const total    = itens.length;
    const aprovs   = itens.filter((i: any) => i.status === 'Aprovado').length;
    const reprovs  = itens.filter((i: any) => i.status === 'Reprovado').length;
    if (aprovs === total) return 'Aprovado';
    if (reprovs === total) return 'Reprovado';
    if (aprovs > 0 || reprovs > 0) return 'Parcialmente Aprovado';
    return null;
  };

  const finalizarCampanha = async (camp: any, itens: any[]) => {
    const novoStatus = calcNovoStatusCampanha(itens);
    if (!novoStatus) { showToast('Avalie todos os itens antes de finalizar.', 'error', true); return; }
    const updated = await dbUpdate('/api/marketingcampanhasview', camp.id, { status: novoStatus } as any);
    setCampanhas((prev: any[]) => prev.filter((c: any) => c.id !== camp.id));
    playPlim();
    showToast(`Campanha "${camp.nome}" marcada como ${novoStatus}.`, 'success', true);
  };

  const handleItemAprovar = async (item: any) => {
    setProcessing(item.id);
    try { await atualizaItem(item.id, 'Aprovado'); }
    catch (err: any) { showToast(err.message, 'error', true); }
    finally { setProcessing(null); }
  };

  const handleItemReprovar = async (item: any) => {
    const motivo = motivos[item.id]?.trim();
    if (!motivo) { showToast('Informe o motivo da reprovação.', 'error', true); return; }
    setProcessing(item.id);
    try { await atualizaItem(item.id, 'Reprovado', motivo); }
    catch (err: any) { showToast(err.message, 'error', true); }
    finally { setProcessing(null); }
  };

  const handleAprovarTudo = async (camp: any) => {
    const itens = itensDaCamp(camp.id).filter((i: any) => i.status === 'Pendente');
    if (itens.length === 0) { showToast('Nenhum item Pendente para aprovar.', 'error', true); return; }
    setProcessing(`bulk-${camp.id}`);
    try {
      for (const item of itens) {
        await atualizaItem(item.id, 'Aprovado');
      }
      // re-lê estado dos itens após loop para calcular status correto
      const todosItensAtuais = itensDaCamp(camp.id).map((i: any) =>
        itens.find((x: any) => x.id === i.id) ? { ...i, status: 'Aprovado' } : i
      );
      await finalizarCampanha(camp, todosItensAtuais);
    } catch (err: any) {
      showToast(`Erro ao aprovar: ${err.message ?? 'verifique o console'}. Alguns itens podem não ter sido atualizados.`, 'error', true);
    } finally { setProcessing(null); }
  };

  const handleReprovarTudo = async (camp: any) => {
    const motivo = motivos[`bulk-${camp.id}`]?.trim();
    if (!motivo) { showToast('Informe o motivo para reprovar tudo.', 'error', true); return; }
    const itens = itensDaCamp(camp.id).filter((i: any) => i.status === 'Pendente');
    if (itens.length === 0) { showToast('Nenhum item Pendente para reprovar.', 'error', true); return; }
    setProcessing(`bulk-${camp.id}`);
    try {
      for (const item of itens) {
        await atualizaItem(item.id, 'Reprovado', motivo);
      }
      const todosItensAtuais = itensDaCamp(camp.id).map((i: any) =>
        itens.find((x: any) => x.id === i.id) ? { ...i, status: 'Reprovado' } : i
      );
      await finalizarCampanha(camp, todosItensAtuais);
    } catch (err: any) {
      showToast(`Erro ao reprovar: ${err.message ?? 'verifique o console'}. Alguns itens podem não ter sido atualizados.`, 'error', true);
    } finally { setProcessing(null); }
  };

  const handleFinalizar = async (camp: any) => {
    const itens = itensDaCamp(camp.id);
    try { await finalizarCampanha(camp, itens); }
    catch (err: any) { showToast(err.message, 'error', true); }
  };

  if (loadingCamp) return <LoadingSpinner />;

  if (campanhas.length === 0) return <EmptyState message="Nenhuma campanha aguardando aprovação do Financeiro." />;

  return (
    <div className="space-y-4">
      {campanhas.map((camp: any) => {
        const itens  = itensDaCamp(camp.id);
        const aberta = campAberta === camp.id;
        return (
          <div key={camp.id} className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
            {/* Header da campanha */}
            <button onClick={() => setCampAberta(aberta ? null : camp.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/3 transition-colors">
              <div className="flex items-center gap-3">
                <Megaphone size={16} className="text-accent shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-200">{camp.nome}</p>
                  <p className="text-[10px] text-gray-500">{camp.data_inicio} → {camp.data_fim} · {itens.length} produto(s)</p>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                aberta ? 'border-accent/30 text-accent' : 'border-gray-700 text-gray-500'
              }`}>{aberta ? 'Fechar' : 'Revisar'}</span>
            </button>

            {aberta && (
              <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                {/* Itens */}
                {itens.length === 0 ? (
                  <EmptyState message="Nenhum produto nesta campanha." />
                ) : itens.map((item: any) => {
                  const prod = prodMap[item.produto_id];
                  const isProc = processing === item.id;
                  const statusCls =
                    item.status === 'Aprovado'  ? 'border-green-500/20 bg-green-500/5' :
                    item.status === 'Reprovado' ? 'border-red-500/20  bg-red-500/5'   :
                    'border-white/5 bg-white/2';
                  return (
                    <div key={item.id} className={`rounded-xl border p-3 space-y-2 transition-colors ${statusCls}`}>
                      <div className="flex items-center gap-2">
                        <Package size={13} className="text-gray-500 shrink-0" />
                        <p className="text-sm font-semibold text-gray-200 flex-1 truncate">{prod?.nome ?? item.produto_id}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                          item.status === 'Aprovado'  ? 'border-green-500/30 text-green-400' :
                          item.status === 'Reprovado' ? 'border-red-500/30  text-red-400'   :
                          'border-gray-600 text-gray-500'
                        }`}>{item.status}</span>
                      </div>
                      {(item.preco_atual || item.preco_promocional) && (
                        <div className="flex gap-3 text-xs text-gray-500">
                          {item.preco_atual     != null && <span>Atual: <strong className="text-gray-300">R$ {Number(item.preco_atual).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>}
                          {item.preco_promocional != null && <span>Promo: <strong className="text-accent">R$ {Number(item.preco_promocional).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span>}
                        </div>
                      )}
                      {item.motivo_reprovacao && (
                        <p className="text-[10px] text-red-400 italic">Motivo: {item.motivo_reprovacao}</p>
                      )}

                      {item.status === 'Pendente' && (
                        <div className="flex gap-2 items-center pt-1">
                          <input className="neu-input flex-1 text-xs px-2 py-1 rounded-lg"
                            placeholder="Motivo (obrigatório para reprovar)…"
                            value={motivos[item.id] ?? ''}
                            onChange={e => setMotivos(m => ({ ...m, [item.id]: e.target.value }))} />
                          <button onClick={() => handleItemReprovar(item)} disabled={isProc}
                            className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-red-400 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                            {isProc ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}Reprovar
                          </button>
                          <button onClick={() => handleItemAprovar(item)} disabled={isProc}
                            className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                            {isProc ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}Aprovar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Ações bulk + finalizar */}
                {itens.length > 0 && (
                  <div className="pt-3 border-t border-white/5 space-y-2">
                    <div className="flex gap-2 items-center">
                      <input className="neu-input flex-1 text-xs px-2 py-1.5 rounded-lg"
                        placeholder="Motivo para reprovar tudo…"
                        value={motivos[`bulk-${camp.id}`] ?? ''}
                        onChange={e => setMotivos(m => ({ ...m, [`bulk-${camp.id}`]: e.target.value }))} />
                      <button onClick={() => handleReprovarTudo(camp)} disabled={!!processing}
                        className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-red-400 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
                        <X size={10} />Reprovar Tudo
                      </button>
                      <button onClick={() => handleAprovarTudo(camp)} disabled={!!processing}
                        className="neu-button px-3 py-1.5 rounded-lg text-xs font-bold text-green-400 hover:bg-green-900/20 border border-green-500/10 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
                        <Check size={10} />Aprovar Tudo
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => handleFinalizar(camp)} disabled={!!processing}
                        className="neu-button px-4 py-1.5 rounded-lg text-xs font-bold text-gray-200 hover:text-accent border border-white/10 disabled:opacity-40">
                        Finalizar avaliação
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── View Principal ────────────────────────────────────────────────────────────
export const AprovacoesPromocaoFinanceiroView = ({ showToast }: any) => {
  const { filialAtiva } = useFilial();
  const [aba, setAba] = useState<'promocoes' | 'campanhas'>('promocoes');
  if (!filialAtiva) return null;

  const tabs = [
    { id: 'promocoes' as const, label: 'Promoções', icon: Tag },
    { id: 'campanhas' as const, label: 'Campanhas', icon: Megaphone },
  ];

  return (
    // A tela rola inteira, no <main> do app — sem `h-full` e sem rolagem
    // própria no conteúdo das abas, que espremia a lista abaixo do cabeçalho.
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações — Marketing</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setAba(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
              aba === t.id
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'neu-button border-white/5 text-gray-400 hover:text-gray-200'
            }`}>
            <t.icon size={13} />{t.label}
          </button>
        ))}
      </div>

      <div className="pb-6 space-y-4">
        {aba === 'promocoes' ? <AbaPromocoes showToast={showToast} filial={filialAtiva} /> : <AbaCampanhas showToast={showToast} filial={filialAtiva} />}
      </div>
    </motion.div>
  );
};
