import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Check, X, Loader2, Tag, TrendingDown, Megaphone, Package, Landmark, UserCog, Radio, Power, BadgePercent, ChevronDown } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { useFilial } from '../contexts/FilialContext';
import { usePrompt } from '../contexts/PromptContext';
import { EmptyState, LoadingSpinner, SecaoFormulario, CardContador, AbaComContador, StatusBadge } from '../components/ui';
import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import { playPlim } from '../utils/audioUtils';

const brl = (v: any) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Coluna `date` vem como 'AAAA-MM-DD': formata no texto, sem passar por Date
// (que a leria em UTC e voltaria um dia no fuso do Acre).
const dataCurta = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null);

// ── Aba Promoções ────────────────────────────────────────────────────────────
function AbaPromocoes({ showToast, filial }: any) {
  const prompt = usePrompt();
  // MIGR 576: a fila tem DOIS passos. 'Aguardando Aprovação' espera o parecer
  // do Financeiro; 'Em Análise' já tem parecer e espera o gerente liberar. Por
  // isso a busca não filtra mais por um status só.
  const { data: promocoes, setData } = useFetchData<any>('/api/marketingpromocoesview', { filial }, true);
  const [obs,       setObs]       = useState<Record<string, string>>({});
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
    const resposta = await prompt({
      message: `Tirar "${promo.nome_produto ?? 'a oferta'}" do ar agora? O preço de tabela volta a valer no caixa.`,
      placeholder: 'Por quê? (ruptura de estoque, preço errado, campanha cancelada…)',
      confirmLabel: 'Encerrar oferta', maxLength: 300,
    });
    if (resposta === null) return;
    const motivo = resposta.trim();
    if (motivo.length < 5) {
      showToast('Diga por que a oferta está saindo do ar — o cliente vai perguntar.', 'error', true);
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
    } catch (err: any) {
      showToast(`Não foi possível encerrar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally { setProcessing(null); }
  };

  // Só o que está em curso aparece: aprovada já virou preço, reprovada morreu.
  const passo1 = (promocoes ?? []).filter((p: any) => p.status === 'Aguardando Aprovação');
  const passo2 = (promocoes ?? []).filter((p: any) => p.status === 'Em Análise');
  // O que está no ar agora. Fica nesta tela porque é aqui que mora a autoridade
  // sobre o preço — quem libera é quem tira do ar.
  const vigentes = (promocoes ?? []).filter((p: any) => p.status === 'Aprovado');
  const semPrazo = vigentes.filter((p: any) => !p.data_fim).length;

  const calcDesconto = (promo: any) => {
    const atual = Number(promo.preco_atual || 0);
    const p     = Number(promo.preco_promocional || 0);
    if (!atual || p >= atual) return null;
    return ((atual - p) / atual * 100).toFixed(1);
  };

  const cartao = (promo: any) => {
    const desc = calcDesconto(promo);
    const emAnalise = promo.status === 'Em Análise';
    const ocupado = processing === promo.id;
    const margem = promo.margem_pct != null ? Number(promo.margem_pct) : null;
    const periodo = [dataCurta(promo.data_inicio), dataCurta(promo.data_fim)];
    return (
      <motion.div key={promo.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-100 flex items-center gap-2 min-w-0">
              <Tag size={14} className="text-accent shrink-0" />
              <span className="truncate" title={promo.nome_produto ?? ''}>{promo.nome_produto ?? 'Produto'}</span>
            </p>
            {promo.descricao && <p className="text-xs text-gray-500 mt-1 line-clamp-2" title={promo.descricao}>{promo.descricao}</p>}
            <p className="text-[10px] text-gray-500 mt-1">
              {(periodo[0] || periodo[1]) && (
                <span className="font-mono">{periodo[0] ?? '?'} → {periodo[1] ?? 'sem prazo'}</span>
              )}
              {promo.nome_criador && <span>{periodo[0] || periodo[1] ? ' · ' : ''}proposto por {promo.nome_criador}</span>}
            </p>
          </div>
          {desc && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-black bg-accent text-black shrink-0">
              <TrendingDown size={11} />-{desc}%
            </span>
          )}
        </div>

        {/* Custo → preço de hoje → preço da oferta: a conta que o parecer faz. */}
        <div className="grid grid-cols-3 rounded-xl overflow-hidden border border-white/10 text-center">
          <div className="py-2 px-2 bg-white/[0.02]">
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Custo</p>
            <p className="text-xs font-mono font-bold text-gray-400 tabular-nums mt-0.5">{promo.preco_custo > 0 ? brl(promo.preco_custo) : '—'}</p>
          </div>
          <div className="py-2 px-2 border-x border-white/10">
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Preço atual</p>
            <p className="text-xs font-mono font-bold text-gray-200 tabular-nums mt-0.5">{brl(promo.preco_atual)}</p>
          </div>
          <div className="py-2 px-2 bg-accent/10">
            <p className="text-[9px] font-bold text-accent uppercase tracking-widest">Oferta</p>
            <p className="text-xs font-mono font-black text-accent tabular-nums mt-0.5">{brl(promo.preco_promocional)}</p>
          </div>
        </div>

        {emAnalise && (
          <div className={`rounded-xl border p-3 ${margem != null && margem < 0 ? 'border-red-500/40 bg-red-500/5' : 'border-white/10'}`}>
            <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Parecer do Financeiro{promo.analisado_por_nome ? ` · ${promo.analisado_por_nome}` : ''}</span>
              {margem != null && (
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${margem < 0 ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
                  margem {margem.toFixed(1)}%
                </span>
              )}
            </p>
            <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">{promo.parecer_financeiro || '—'}</p>
            {margem != null && margem < 0 && (
              <p className="text-[11px] font-bold text-red-400 mt-1.5">
                Vende abaixo do custo. Só libere se a oferta for assumida como custo de marketing.
              </p>
            )}
          </div>
        )}

        <textarea className="neu-input py-2 px-3 rounded-xl text-xs resize-none h-14"
          placeholder={emAnalise
            ? 'Observação da liberação (obrigatória para reprovar)…'
            : 'Parecer do Financeiro (obrigatório) — a margem e a decisão…'}
          value={obs[promo.id] ?? ''} onChange={e => setObs(o => ({ ...o, [promo.id]: e.target.value }))} />

        <div className="flex gap-2 justify-end items-center">
          <button onClick={() => handleReprovar(promo)} disabled={!!processing}
            className="btn-solido btn-solido--vermelho !py-1.5 !px-3 !text-xs disabled:opacity-50">
            <X size={13} /> Reprovar
          </button>
          {emAnalise ? (
            <button onClick={() => handleAprovar(promo)} disabled={!!processing}
              title="Libera a oferta: o preço muda no PDV agora"
              className="btn-solido btn-solido--verde-escuro !py-1.5 !px-3 !text-xs disabled:opacity-50">
              {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Liberar oferta
            </button>
          ) : (
            <button onClick={() => handleParecer(promo)} disabled={!!processing}
              title="Envia o parecer de viabilidade ao gerente da filial"
              className="btn-solido btn-solido--amarelo !py-1.5 !px-3 !text-xs disabled:opacity-50">
              {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Enviar parecer
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <>
      {/* O caminho da oferta em selos, no lugar do parágrafo explicativo: é a
          liberação do gerente que troca o preço no PDV, e ao fim da campanha
          o preço de tabela volta sozinho. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 mr-1">Caminho da oferta</span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-black">
          <Landmark size={13} /> 1 · Financeiro dá o parecer
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white">
          <UserCog size={13} /> 2 · Gerente libera
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white">
          <Radio size={13} /> No ar · preço muda no PDV
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CardContador label="Esperando parecer" value={passo1.length} tom="amarelo" />
        <CardContador label="Esperando o gerente" value={passo2.length} tom="roxo" />
        <CardContador label="No ar agora" value={vigentes.length} tom="verde" />
        <CardContador label="No ar sem prazo" value={semPrazo} tom="laranja"
          sub={semPrazo > 0 ? 'o preço não volta sozinho' : undefined} />
      </div>

      {passo1.length === 0 && passo2.length === 0 ? (
        <EmptyState message="Nenhuma oferta na fila — nem para parecer do Financeiro, nem para liberação do gerente" />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          <SecaoFormulario titulo="Passo 1 · Parecer do Financeiro" icon={Landmark} cor="amarelo"
            extra={`${passo1.length} oferta${passo1.length === 1 ? '' : 's'}`}>
            {passo1.length === 0
              ? <p className="text-xs text-gray-500 text-center py-6">Nenhuma oferta esperando parecer.</p>
              : <div className="flex flex-col gap-3">{passo1.map(cartao)}</div>}
          </SecaoFormulario>
          <SecaoFormulario titulo="Passo 2 · Liberação do gerente" icon={UserCog} cor="roxo"
            extra={`${passo2.length} oferta${passo2.length === 1 ? '' : 's'}`}>
            {passo2.length === 0
              ? <p className="text-xs text-gray-500 text-center py-6">Nenhuma oferta esperando o gerente.</p>
              : <div className="flex flex-col gap-3">{passo2.map(cartao)}</div>}
          </SecaoFormulario>
        </div>
      )}

      {/* Ofertas no ar — e o botão para tirá-las. */}
      {vigentes.length > 0 && (
        <SecaoFormulario titulo="No ar agora" icon={Radio} cor="verdeEscuro"
          extra={`${vigentes.length} oferta${vigentes.length === 1 ? '' : 's'}`}>
          <div className="overflow-x-auto main-scrollbar">
            <table className="tabela tabela--verde w-full text-left border-collapse">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Produto</th>
                  <th className="text-center w-32">Preço atual</th>
                  <th className="text-center w-32">Oferta</th>
                  <th className="text-center w-24">Desconto</th>
                  <th className="text-center w-32">Até</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                {vigentes.map((promo: any) => {
                  const desc = calcDesconto(promo);
                  return (
                    <tr key={promo.id} className="border-b border-accent/10 align-middle">
                      <td className="py-3 px-3 min-w-[12rem]">
                        <span className="block text-sm font-semibold text-gray-100 truncate" title={promo.nome_produto ?? ''}>{promo.nome_produto ?? 'Produto'}</span>
                        {promo.descricao && <span className="block text-[10px] text-gray-500 truncate">{promo.descricao}</span>}
                      </td>
                      <td className="py-3 px-3 text-center text-xs font-mono text-gray-400 tabular-nums whitespace-nowrap">{brl(promo.preco_atual)}</td>
                      <td className="py-3 px-3 text-center text-sm font-mono font-bold text-accent tabular-nums whitespace-nowrap">{brl(promo.preco_promocional)}</td>
                      <td className="py-3 px-3 text-center text-xs font-bold text-gray-300 tabular-nums">{desc ? `-${desc}%` : '—'}</td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {promo.data_fim
                          ? <span className="text-xs font-mono text-gray-300">{dataCurta(promo.data_fim)}</span>
                          : <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest bg-orange-500 text-black"
                              title="Sem data de fim, o preço não volta sozinho">Sem prazo</span>}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center items-center">
                          <MenuMais>
                            {fechar => (
                              <ItemMenu onClick={() => { fechar(); handleEncerrar(promo); }} disabled={!!processing}
                                cor="text-orange-400 hover:bg-orange-500/10" icon={Power}>
                                Encerrar antes do prazo
                              </ItemMenu>
                            )}
                          </MenuMais>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SecaoFormulario>
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
    <div className="flex flex-col gap-4">
      {campanhas.map((camp: any) => {
        const itens  = itensDaCamp(camp.id);
        const aberta = campAberta === camp.id;
        const nAprov = itens.filter((i: any) => i.status === 'Aprovado').length;
        const nReprov = itens.filter((i: any) => i.status === 'Reprovado').length;
        const nPend = itens.length - nAprov - nReprov;
        return (
          <section key={camp.id} className="rounded-2xl border border-white/10 overflow-hidden">
            {/* Faixa da campanha: abre e fecha a revisão dos itens. */}
            <button onClick={() => setCampAberta(aberta ? null : camp.id)} aria-expanded={aberta}
              className="w-full btn-solido--roxo flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left">
              <span className="flex items-center gap-2 min-w-0">
                <Megaphone size={15} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-black truncate">{camp.nome}</span>
                  <span className="block text-[10px] font-bold opacity-90 font-mono">
                    {dataCurta(camp.data_inicio) ?? '?'} → {dataCurta(camp.data_fim) ?? '?'}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                <span className="px-2 py-1 rounded-md bg-black/25">{itens.length} produto{itens.length === 1 ? '' : 's'}</span>
                {nPend > 0 && <span className="px-2 py-1 rounded-md bg-amber-500 text-black">{nPend} pendente{nPend === 1 ? '' : 's'}</span>}
                {nAprov > 0 && <span className="px-2 py-1 rounded-md bg-green-600 text-white">{nAprov} ok</span>}
                {nReprov > 0 && <span className="px-2 py-1 rounded-md bg-red-600 text-white">{nReprov} não</span>}
                <ChevronDown size={16} className={`transition-transform ${aberta ? 'rotate-180' : ''}`} />
              </span>
            </button>

            {aberta && (
              <div className="p-4 flex flex-col gap-4">
                {itens.length === 0 ? (
                  <EmptyState message="Nenhum produto nesta campanha." />
                ) : (
                  <div className="overflow-x-auto main-scrollbar">
                    <table className="tabela w-full text-left border-collapse">
                      <thead>
                        <tr className={CABECALHO_TABELA}>
                          <th className="text-center">Produto</th>
                          <th className="text-center w-28">Atual</th>
                          <th className="text-center w-28">Promo</th>
                          <th className="text-center w-32">Situação</th>
                          <th className="text-center w-72">Decisão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((item: any) => {
                          const prod = prodMap[item.produto_id];
                          const isProc = processing === item.id;
                          return (
                            <tr key={item.id} className="border-b border-accent/10 align-middle">
                              <td className="py-2.5 px-3 min-w-[12rem]">
                                <span className="flex items-center gap-2 text-sm font-semibold text-gray-100 min-w-0">
                                  <Package size={13} className="text-gray-500 shrink-0" />
                                  <span className="truncate">{prod?.nome ?? item.produto_id}</span>
                                </span>
                                {item.motivo_reprovacao && (
                                  <span className="block text-[10px] text-red-400 mt-0.5 line-clamp-2">Motivo: {item.motivo_reprovacao}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center text-xs font-mono text-gray-400 tabular-nums whitespace-nowrap">
                                {item.preco_atual != null ? brl(item.preco_atual) : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-center text-xs font-mono font-bold text-accent tabular-nums whitespace-nowrap">
                                {item.preco_promocional != null ? brl(item.preco_promocional) : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-center"><StatusBadge status={item.status} /></td>
                              <td className="py-2.5 px-3">
                                {item.status === 'Pendente' ? (
                                  <div className="flex items-center gap-1.5">
                                    <input className="neu-input flex-1 min-w-[8rem] text-xs px-2 py-1.5 rounded-lg"
                                      placeholder="Motivo p/ reprovar"
                                      value={motivos[item.id] ?? ''}
                                      onChange={e => setMotivos(m => ({ ...m, [item.id]: e.target.value }))} />
                                    <button onClick={() => handleItemAprovar(item)} disabled={isProc}
                                      title="Aprovar o item" aria-label="Aprovar o item" className="action-btn-verde">
                                      {isProc ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                                    </button>
                                    <button onClick={() => handleItemReprovar(item)} disabled={isProc}
                                      title="Reprovar — escreva o motivo ao lado" aria-label="Reprovar o item" className="action-btn-vermelho">
                                      <X size={14} />
                                    </button>
                                  </div>
                                ) : <span className="block text-center text-xs text-gray-600">decidido</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Em lote + fechar a avaliação da campanha. */}
                {itens.length > 0 && (
                  <div className="flex flex-col lg:flex-row lg:items-center gap-2 pt-3 border-t border-white/10">
                    <input className="neu-input flex-1 text-xs px-3 py-2 rounded-lg"
                      placeholder="Motivo para reprovar todos os pendentes…"
                      value={motivos[`bulk-${camp.id}`] ?? ''}
                      onChange={e => setMotivos(m => ({ ...m, [`bulk-${camp.id}`]: e.target.value }))} />
                    <div className="flex flex-wrap gap-2 justify-end">
                      <button onClick={() => handleReprovarTudo(camp)} disabled={!!processing}
                        className="btn-solido btn-solido--vermelho !py-1.5 !px-3 !text-xs disabled:opacity-50">
                        <X size={13} /> Reprovar pendentes
                      </button>
                      <button onClick={() => handleAprovarTudo(camp)} disabled={!!processing}
                        className="btn-solido btn-solido--verde !py-1.5 !px-3 !text-xs disabled:opacity-50">
                        {processing === `bulk-${camp.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Aprovar pendentes
                      </button>
                      <button onClick={() => handleFinalizar(camp)} disabled={!!processing}
                        title="Fecha a avaliação e devolve a campanha ao Marketing"
                        className="btn-solido btn-solido--preto-ouro !py-1.5 !px-3 !text-xs disabled:opacity-50">
                        Finalizar avaliação
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
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

  return (
    // A tela rola inteira, no <main> do app — sem `h-full` e sem rolagem
    // própria no conteúdo das abas, que espremia a lista abaixo do cabeçalho.
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-6">
      <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
        <BadgePercent size={26} /> Aprovações de Promoções — {filialAtiva}
      </h2>

      <div className="flex gap-3 flex-wrap" role="tablist">
        <AbaComContador label="Promoções" icon={Tag} cor="amarelo"
          ativa={aba === 'promocoes'} onClick={() => setAba('promocoes')} />
        <AbaComContador label="Campanhas" icon={Megaphone} cor="roxo"
          ativa={aba === 'campanhas'} onClick={() => setAba('campanhas')} />
      </div>

      {aba === 'promocoes' ? <AbaPromocoes showToast={showToast} filial={filialAtiva} /> : <AbaCampanhas showToast={showToast} filial={filialAtiva} />}
    </motion.div>
  );
};
