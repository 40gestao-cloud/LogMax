import { isConselheiro } from '../lib/rbac';
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, Loader2, UserCircle2, ShieldCheck, FileText, MessageSquare, ArrowLeft } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FormField, FilialBadge, IdadeBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatBRL } from '../lib/viewUtils';
import { rotuloCondicao } from '../lib/condicaoPagamento';
import { supabase } from '../lib/supabase';
import { notificarSetor } from '../lib/notificar';
import type { UserProfile } from '../hooks/useUserProfile';

// View admin/CEO-only: simula o cliente decidindo sobre o orçamento.
// Lista propostas com status='Enviado ao Cliente' (cliente ainda não decidiu),
// permite aceitar/recusar em nome do cliente. Marca decidido_cliente_simulado=true
// pra distinguir de uma decisão real, caso depois exista um portal externo.

export const ClienteEspecialView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const isAdminOuCeo = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);

  // Realtime: quando o vendedor envia uma nova proposta ao cliente, ela aparece
  // aqui sem precisar de F5. Idem decisão registrada em outra aba/setor.
  const { data, setData, isLoading } = useFetchData<any>('/api/orcamentosview', undefined, true);
  const { data: clientes } = useFetchData<any>('/api/crmview');

  const [selecionado, setSelecionado] = useState<any | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [tipoDecisao, setTipoDecisao] = useState<'aprovar' | 'reprovar' | null>(null);
  const [salvando, setSalvando] = useState(false);
  // A fila cruza as três unidades — e o card não dizia de qual era. Com 28
  // propostas na mesa, "de quem é esta?" virava a primeira pergunta de cada
  // clique.
  const [filtroFilial, setFiltroFilial] = useState<string>('todas');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aprovandoLote, setAprovandoLote] = useState(false);
  const confirm = useConfirm();

  const aguardandoCliente = useMemo(
    () => data
      .filter((o: any) => o.status === 'Enviado ao Cliente')
      .map((o: any) => ({ ...o, cliente: clientes.find((c: any) => c.id === o.cliente_id) }))
      // Mais ANTIGA primeiro: esta é uma fila de espera, e quem está esperando
      // há mais tempo é quem trava a aula. A ordem padrão do hook (created_at
      // desc) punha exatamente o contrário no topo.
      .sort((a: any, b: any) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))),
    [data, clientes]
  );

  const unidades = useMemo(
    () => [...new Set(aguardandoCliente.map((o: any) => String(o.filial ?? '')).filter(Boolean))].sort(),
    [aguardandoCliente],
  );

  const visiveis = useMemo(
    () => filtroFilial === 'todas'
      ? aguardandoCliente
      : aguardandoCliente.filter((o: any) => o.filial === filtroFilial),
    [aguardandoCliente, filtroFilial],
  );

  const totalNaFila = visiveis.reduce((acc: number, o: any) => acc + Number(o.valor_total ?? 0), 0);
  const selecionados = visiveis.filter((o: any) => marcados.has(o.id));
  const totalMarcado = selecionados.reduce((acc: number, o: any) => acc + Number(o.valor_total ?? 0), 0);

  const alternarMarca = (id: string) => setMarcados(m => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /**
   * Aprovar em lote — e só aprovar.
   *
   * Reprovar continua sendo um de cada vez, de propósito: a reprovação exige
   * motivo escrito, e um motivo genérico repetido em vinte propostas é pior
   * que nenhum — é o mesmo defeito que a migr. 358 encontrou na justificativa
   * de requisição ("nao temos ou acabou" copiado do hint da tela). Aprovar não
   * tem esse problema: o cliente aceitou, e o que Vendas precisa saber é isso.
   *
   * Uma notificação para o lote inteiro, não uma por proposta: vinte avisos
   * seguidos no sino não informam, escondem.
   */
  const aprovarLote = async () => {
    if (selecionados.length === 0) return;
    const ok = await confirm(
      `Aprovar ${selecionados.length} proposta(s) em nome do cliente, somando `
      + `R$ ${formatBRL(totalMarcado)}?

`
      + 'Vendas é notificada e passa a poder gerar o pedido de cada uma. '
      + 'Para reprovar, abra uma a uma — a reprovação precisa de motivo.');
    if (!ok) return;

    setAprovandoLote(true);
    try {
      const carimbo = {
        status: 'Aprovado Cliente',
        feedback_cliente: null,
        decidido_cliente_em: new Date().toISOString(),
        decidido_cliente_por: profile.id,
        decidido_cliente_simulado: true,
      };
      const falhas: string[] = [];
      const aprovadas: any[] = [];
      // Em série: são poucas dezenas, e uma rajada de UPDATEs simultâneos pela
      // mesma sessão só rende erro de concorrência para economizar segundos.
      for (const o of selecionados) {
        try {
          await dbUpdate('/api/orcamentosview', o.id, carimbo);
          aprovadas.push(o);
        } catch {
          falhas.push(o.cliente?.nome ?? o.id.slice(-6));
        }
      }
      const idsOk = new Set(aprovadas.map((o: any) => o.id));
      setData((prev: any[]) => prev.map(o => idsOk.has(o.id) ? { ...o, ...carimbo } : o));

      // Um aviso por unidade: a lista mistura filiais, e o Vendas de cada uma
      // só deve ver as propostas dela (migr. 619).
      const porFilial = new Map<string | null, any[]>();
      for (const o of aprovadas) {
        const k = o.filial ?? null;
        porFilial.set(k, [...(porFilial.get(k) ?? []), o]);
      }
      for (const [filialDoc, lista] of porFilial) {
        const total = lista.reduce((s, o) => s + Number(o.valor_total ?? 0), 0);
        await notificarSetor({
          setor: 'vendas',
          tipo: 'aprovado',
          titulo: `Cliente aprovou ${lista.length} proposta(s) (simulado por ${profile.nome ?? 'admin/CEO'})`,
          mensagem: `Total R$ ${formatBRL(total)} — gere os pedidos em Vendas > Orçamentos.`,
          link_view: 'vendas-orçamentos',
          filial: filialDoc,
        });
      }

      setMarcados(new Set());
      showToast(
        falhas.length === 0
          ? `${selecionados.length} proposta(s) aprovada(s). Vendas já pode gerar os pedidos.`
          : `${selecionados.length - falhas.length} aprovada(s); ${falhas.length} falharam (${falhas.slice(0, 3).join(', ')}).`,
        falhas.length === 0 ? 'success' : 'error', true);
    } finally {
      setAprovandoLote(false);
    }
  };

  if (!isAdminOuCeo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
        <ShieldCheck size={36} className="text-gray-600" />
        <p className="text-sm text-gray-400 max-w-md">
          O <span className="text-accent font-bold">Cliente Especial</span> é restrito a admin/CEO —
          serve para simular a decisão do cliente sobre uma proposta enviada.
        </p>
      </div>
    );
  }

  const confirmarDecisao = async () => {
    if (!selecionado || !tipoDecisao) return;
    const feedback = feedbackInput.trim();
    if (tipoDecisao === 'reprovar' && !feedback) {
      showToast('Feedback é obrigatório para reprovar.', 'error', true);
      return;
    }
    setSalvando(true);
    try {
      const novoStatus = tipoDecisao === 'aprovar' ? 'Aprovado Cliente' : 'Reprovado Cliente';
      const updates: any = {
        status: novoStatus,
        feedback_cliente:           feedback || null,
        decidido_cliente_em:        new Date().toISOString(),
        decidido_cliente_por:       profile.id,
        decidido_cliente_simulado:  true,
      };
      await dbUpdate('/api/orcamentosview', selecionado.id, updates);
      setData((prev: any[]) => prev.map(o => o.id === selecionado.id ? { ...o, ...updates } : o));

      const cli = selecionado.cliente?.nome ?? 'Cliente';
      await notificarSetor({
        setor:     'vendas',
        tipo:      tipoDecisao === 'aprovar' ? 'aprovado' : 'reprovado',
        titulo:    tipoDecisao === 'aprovar'
                     ? `Cliente aprovou a proposta (simulado por ${profile.nome ?? 'admin/CEO'})`
                     : `Cliente reprovou a proposta (simulado por ${profile.nome ?? 'admin/CEO'})`,
        mensagem:  `${cli} — R$ ${formatBRL(Number(selecionado.valor_total ?? 0))}`,
        link_view: 'vendas-orçamentos',
        urgencia:  tipoDecisao === 'aprovar' ? 'Média' : 'Alta',
        ref_id:    selecionado.id,
        motivo:    tipoDecisao === 'reprovar' ? feedback : undefined,
        filial:    selecionado.filial ?? null,
      });

      showToast(
        tipoDecisao === 'aprovar'
          ? 'Proposta aprovada. Vendas pode gerar o pedido.'
          : 'Proposta reprovada. Vendas notificada.',
        'success', true,
      );
      setSelecionado(null);
      setTipoDecisao(null);
      setFeedbackInput('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSalvando(false);
    }
  };

  // Lista de propostas pendentes
  if (!selecionado) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <UserCircle2 size={22} className="text-accent" />
            <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Cliente Especial</h2>
          </div>
          <p className="text-sm text-gray-400">
            Acesso restrito (admin/CEO). Aja como o cliente para aprovar ou reprovar propostas em
            <span className="text-cyan-400 font-bold"> Enviado ao Cliente</span>.
          </p>
        </div>

        {/* A FILA PASSA A TER TAMANHO.
            Ela é de Matriz, e a sidebar da Matriz não lista módulo operacional
            — então não há badge no menu que a anuncie. Sem número em lugar
            nenhum, 28 propostas podiam ficar semanas paradas esperando uma
            decisão que ninguém sabia que era sua. */}
        {!isLoading && aguardandoCliente.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="neu-pressed rounded-2xl px-4 py-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-accent tabular-nums">{visiveis.length}</span>
              <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                proposta(s) esperando você
              </span>
            </div>
            <div className="neu-pressed rounded-2xl px-4 py-3 flex items-baseline gap-2">
              <span className="text-lg font-bold text-gray-200 tabular-nums">R$ {formatBRL(totalNaFila)}</span>
              <span className="text-[10px] text-gray-500 uppercase tracking-widest">em jogo</span>
            </div>
            {unidades.length > 1 && (
              <select
                className="neu-input py-2 px-3 rounded-xl text-xs"
                value={filtroFilial}
                onChange={e => { setFiltroFilial(e.target.value); setMarcados(new Set()); }}
                title="A fila cruza as unidades — filtre para decidir uma de cada vez">
                <option value="todas">Todas as unidades ({aguardandoCliente.length})</option>
                {unidades.map(f => (
                  <option key={f} value={f}>
                    {f} ({aguardandoCliente.filter((o: any) => o.filial === f).length})
                  </option>
                ))}
              </select>
            )}
            {selecionados.length > 0 && (
              <NeuButtonAccent onClick={aprovarLote} isLoading={aprovandoLote}>
                <Check size={14} />
                Aprovar {selecionados.length} — R$ {formatBRL(totalMarcado)}
              </NeuButtonAccent>
            )}
          </div>
        )}

        {isLoading ? <LoadingSpinner /> : visiveis.length === 0 ? (
          <EmptyState message={aguardandoCliente.length === 0
            ? 'Nenhuma proposta aguardando o cliente no momento.'
            : `Nenhuma proposta de ${filtroFilial} na fila — troque a unidade no filtro acima.`} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visiveis.map((o: any) => (
              <motion.div
                key={o.id}
                className={`neu-flat rounded-2xl p-5 border transition-colors text-left flex flex-col gap-3 ${
                  marcados.has(o.id) ? 'border-accent/50 bg-accent/5' : 'border-white/5 hover:border-accent/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  {/* Marcar não abre a proposta: são duas intenções diferentes
                      no mesmo cartão, e juntá-las faria o lote abrir 28 telas. */}
                  <button
                    onClick={() => alternarMarca(o.id)}
                    title={marcados.has(o.id) ? 'Tirar do lote' : 'Marcar para aprovar em lote'}
                    className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                      marcados.has(o.id) ? 'bg-accent border-accent' : 'border-white/20 hover:border-white/40'
                    }`}>
                    {marcados.has(o.id) && <Check size={11} className="text-black" />}
                  </button>
                  <FilialBadge filial={o.filial} />
                  <IdadeBadge iso={o.created_at} />
                  <span className="text-[10px] font-mono text-gray-500 ml-auto">#{o.id.slice(-6).toUpperCase()}</span>
                </div>
                <button onClick={() => setSelecionado(o)} className="text-left flex flex-col gap-3">
                <h3 className="text-lg font-bold text-gray-200 leading-tight">{o.cliente?.nome ?? '—'}</h3>
                <p className="text-xs text-gray-500">{(o.itens?.length ?? 0)} item(s) • Validade {o.validade_dias}d</p>
                <div className="flex items-end justify-between pt-2 border-t border-white/5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest">Total</span>
                  <div className="text-right">
                    <span className="text-xl font-black text-accent tabular-nums block">R$ {formatBRL(Number(o.valor_total ?? 0))}</span>
                    {o.forma_pagamento && (
                      <span className="text-[10px] text-gray-500">
                        {rotuloCondicao(o.forma_pagamento, o.parcelas, o.valor_parcela)}
                      </span>
                    )}
                  </div>
                </div>
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  // Detalhe da proposta — modo simulado
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6">
      <button
        onClick={() => { setSelecionado(null); setTipoDecisao(null); setFeedbackInput(''); }}
        className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 self-start"
      >
        <ArrowLeft size={12} /> Voltar à lista
      </button>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-accent" />
          <h3 className="text-sm font-bold text-gray-200">Proposta Comercial</h3>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-yellow-500/10 text-yellow-500">
            Modo Cliente (simulado)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Cliente</span>
            <span className="font-bold text-gray-200">{selecionado.cliente?.nome ?? '—'}</span>
          </div>
          <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Vendedor</span>
            <span className="font-bold text-gray-200">{selecionado.vendedor_nome ?? '—'}</span>
          </div>
          <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Validade</span>
            <span className="font-bold text-gray-200">{selecionado.validade_dias} dias</span>
          </div>
        </div>

        {/* Itens */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Itens</span>
          <div className="flex flex-col gap-1.5">
            {(selecionado.itens ?? []).map((it: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-3 neu-pressed rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-200 truncate">{it.nome}</p>
                  <p className="text-[10px] text-gray-500 font-mono">
                    {it.qtd}× R$ {formatBRL(Number(it.preco_unitario ?? 0))}
                  </p>
                </div>
                <span className="text-sm font-bold text-accent tabular-nums">
                  R$ {formatBRL(Number(it.subtotal ?? 0))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Totais */}
        <div className="flex justify-between border-t border-white/5 pt-3">
          <div className="flex flex-col gap-1">
            {selecionado.desconto > 0 && (
              <span className="text-xs text-gray-500">Desconto aplicado: R$ {formatBRL(Number(selecionado.desconto ?? 0))}</span>
            )}
            {/* O cliente decide sobre PREÇO + CONDIÇÃO, não sobre um número
                solto: aprovar 12x com juros sem ver os juros não é decisão.
                A taxa da maquininha não aparece aqui de propósito — é custo da
                loja, e o cliente não tem nada com ela. */}
            {Number(selecionado.desconto_condicao ?? 0) > 0 && (
              <span className="text-xs text-emerald-400">
                Desconto à vista ({selecionado.forma_pagamento}): R$ {formatBRL(Number(selecionado.desconto_condicao))}
              </span>
            )}
            {Number(selecionado.acrescimo_juros ?? 0) > 0 && (
              <span className="text-xs text-yellow-400">
                Juros do parcelamento: R$ {formatBRL(Number(selecionado.acrescimo_juros))}
              </span>
            )}
            {selecionado.observacoes && (
              <span className="text-xs text-gray-400 italic max-w-md">"{selecionado.observacoes}"</span>
            )}
          </div>
          <div className="text-right">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block">Total</span>
            <span className="text-3xl font-black text-accent tabular-nums">R$ {formatBRL(Number(selecionado.valor_total ?? 0))}</span>
            {selecionado.forma_pagamento && (
              <span className="text-xs text-gray-400 block mt-0.5">
                {rotuloCondicao(selecionado.forma_pagamento, selecionado.parcelas, selecionado.valor_parcela)}
              </span>
            )}
          </div>
        </div>

        {/* Decisão */}
        {!tipoDecisao ? (
          <div className="flex gap-3 justify-end pt-2 border-t border-white/5">
            <button
              onClick={() => { setTipoDecisao('reprovar'); setFeedbackInput(''); }}
              className="py-2.5 px-5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#f87171' }}
            >
              <X size={14} /> Recusar proposta
            </button>
            <NeuButtonAccent onClick={() => { setTipoDecisao('aprovar'); setFeedbackInput(''); }}>
              <Check size={14} /> Aceitar proposta
            </NeuButtonAccent>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2 border-t border-white/5">
            <FormField label={tipoDecisao === 'reprovar' ? 'Motivo da recusa (obrigatório) *' : 'Comentário do cliente (opcional)'}>
              <textarea
                className="neu-input py-2 px-3 rounded-xl text-sm min-h-[80px]"
                value={feedbackInput}
                onChange={e => setFeedbackInput(e.target.value)}
                placeholder={tipoDecisao === 'reprovar' ? 'Ex: Preço acima do orçado, prazo curto, etc.' : 'Comentário pra Vendas (opcional).'}
              />
            </FormField>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setTipoDecisao(null); setFeedbackInput(''); }}
                disabled={salvando}
                className="neu-button py-2 px-4 rounded-xl text-sm text-gray-400 disabled:opacity-50"
              >
                Voltar
              </button>
              {tipoDecisao === 'reprovar' ? (
                <button onClick={confirmarDecisao} disabled={salvando}
                  className="py-2 px-5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
                  {salvando ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Confirmar recusa
                </button>
              ) : (
                <NeuButtonAccent onClick={confirmarDecisao} isLoading={salvando}>
                  <Check size={14} /> Confirmar aceitação
                </NeuButtonAccent>
              )}
            </div>
            <p className="text-[10px] text-gray-600 text-center flex items-center justify-center gap-1">
              <MessageSquare size={10} />
              Decisão registrada como simulada por <span className="text-gray-400 font-bold">{profile.nome ?? 'admin/CEO'}</span>.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
};
