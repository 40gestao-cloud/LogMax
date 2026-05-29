import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, Loader2, UserCircle2, ShieldCheck, FileText, MessageSquare, ArrowLeft } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent, FormField } from '../components/ui';
import { formatBRL } from '../lib/viewUtils';
import { supabase } from '../lib/supabase';
import type { UserProfile } from '../hooks/useUserProfile';

// View admin/CEO-only: simula o cliente decidindo sobre o orçamento.
// Lista propostas com status='Enviado ao Cliente' (cliente ainda não decidiu),
// permite aceitar/recusar em nome do cliente. Marca decidido_cliente_simulado=true
// pra distinguir de uma decisão real, caso depois exista um portal externo.
async function notificarSetor(args: {
  setor: 'vendas';
  tipo: 'aprovado' | 'reprovado';
  titulo: string;
  mensagem: string;
  link_view?: string;
  ref_id?: string;
  motivo?: string;
}) {
  if (!supabase) return;
  try {
    await supabase.rpc('notificar_setor', {
      p_setor:     args.setor,
      p_tipo:      args.tipo,
      p_titulo:    args.titulo,
      p_mensagem:  args.mensagem,
      p_link_view: args.link_view ?? null,
      p_urgencia:  args.tipo === 'aprovado' ? 'Média' : 'Alta',
      p_ref_id:    args.ref_id ?? null,
      p_motivo:    args.motivo ?? null,
    });
  } catch { /* best-effort */ }
}

export const ClienteEspecialView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const isAdminOuCeo = profile.role === 'admin' || profile.role === 'ceo';

  // Realtime: quando o vendedor envia uma nova proposta ao cliente, ela aparece
  // aqui sem precisar de F5. Idem decisão registrada em outra aba/setor.
  const { data, setData, isLoading } = useFetchData<any>('/api/orcamentosview', undefined, true);
  const { data: clientes } = useFetchData<any>('/api/crmview');

  const [selecionado, setSelecionado] = useState<any | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [tipoDecisao, setTipoDecisao] = useState<'aprovar' | 'reprovar' | null>(null);
  const [salvando, setSalvando] = useState(false);

  const aguardandoCliente = useMemo(
    () => data
      .filter((o: any) => o.status === 'Enviado ao Cliente')
      .map((o: any) => ({ ...o, cliente: clientes.find((c: any) => c.id === o.cliente_id) })),
    [data, clientes]
  );

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
        ref_id:    selecionado.id,
        motivo:    tipoDecisao === 'reprovar' ? feedback : undefined,
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

        {isLoading ? <LoadingSpinner /> : aguardandoCliente.length === 0 ? (
          <EmptyState message="Nenhuma proposta aguardando o cliente no momento." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {aguardandoCliente.map((o: any) => (
              <motion.button
                key={o.id}
                onClick={() => setSelecionado(o)}
                whileTap={{ scale: 0.98 }}
                className="neu-flat rounded-2xl p-5 border border-white/5 hover:border-accent/30 transition-colors text-left flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Proposta</span>
                  <span className="text-[10px] font-mono text-gray-500">#{o.id.slice(-6).toUpperCase()}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-200 leading-tight">{o.cliente?.nome ?? '—'}</h3>
                <p className="text-xs text-gray-500">{(o.itens?.length ?? 0)} item(s) • Validade {o.validade_dias}d</p>
                <div className="flex items-end justify-between pt-2 border-t border-white/5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest">Total</span>
                  <span className="text-xl font-black text-accent tabular-nums">R$ {formatBRL(Number(o.valor_total ?? 0))}</span>
                </div>
              </motion.button>
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
            {selecionado.observacoes && (
              <span className="text-xs text-gray-400 italic max-w-md">"{selecionado.observacoes}"</span>
            )}
          </div>
          <div className="text-right">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block">Total</span>
            <span className="text-3xl font-black text-accent tabular-nums">R$ {formatBRL(Number(selecionado.valor_total ?? 0))}</span>
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
