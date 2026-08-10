import React, { useState, useRef } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion } from 'motion/react';
import { X, Check, Loader2 } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { EmptyState, StatusBadge, SelecioneUnidade } from '../components/ui';
import type { AprovacaoEstoque, RequisicaoEstoque, Produto } from '../types/domain';

type EnrichedAp = AprovacaoEstoque & {
  req: RequisicaoEstoque | undefined;
  prod: Produto | undefined;
};

const AprovacoesEstoqueViewInner = ({ showToast, filial }: { showToast: (msg: string, type: string, persist?: boolean) => void; filial: FilialOp }) => {
  const { data: aprovacoes, setData: setAprovacoes } = useFetchData<AprovacaoEstoque>('/api/minhasaprovacoesestoqueview', { status: 'Pendente', filial }, true);
  const { data: requisicoes } = useFetchData<RequisicaoEstoque>('/api/requisicoesestoqueview', { filial }, true);
  const { data: produtos } = useFetchData<Produto>('/api/produtosview', { filial });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  // Guard sincrônico: `processing` (state React) atualiza assíncronamente,
  // então double-click rápido entra no handler 2× antes do disable pintar.
  // O ref tranca instantaneamente.
  const processingRef = useRef<string | null>(null);

  const enriched: EnrichedAp[] = aprovacoes.map(ap => {
    const req = requisicoes.find(r => r.id === ap.requisicao_estoque_id);
    return { ...ap, req, prod: req ? produtos.find(p => p.id === req.produto_id) : undefined };
  });

  // O erro que mais aparece aqui não é falha: é regra. O guard
  // `trg_requisicao_estoque_decisao_guard` levanta "Quem pede o material não
  // libera a própria requisição" na 2ª das três escritas — e o `catch {}` que
  // existia trocava essa frase por "Erro ao aprovar", fazendo a turma ler como
  // defeito do sistema justamente a lição que o fluxo existe pra ensinar.
  // A RPC repassa `error.message` intacto no throw, então basta não jogar
  // fora.
  const motivoDoErro = (err: unknown): string => {
    const msg = String((err as { message?: string })?.message ?? '').trim();
    return msg || 'erro inesperado';
  };

  // Aprovar e negar são a MESMA chamada, com decisão diferente. Até a migr.
  // 401 eram três escritas soltas daqui (aprovação → requisição → baixa) com
  // rollback escrito à mão no catch: dava conta de erro do banco, não de aba
  // fechada no meio. Quando isso acontecia sobrava requisição 'Aprovado' sem
  // baixa — o estoque não descia e o documento sumia desta tela, que só lista
  // Pendente. Agora ou tudo acontece, ou nada aconteceu.
  //
  // A conferência de saldo saiu daqui junto: ela vivia antes das escritas e
  // deixava uma janela entre conferir e baixar. Quem recusa saldo insuficiente
  // é a trigger de estoque, dentro da transação, e a mensagem dela chega pelo
  // mesmo caminho das outras.
  const decidir = async (ap: EnrichedAp, decisao: 'Aprovado' | 'Negado') => {
    if (processingRef.current === ap.id) return;
    if (decisao === 'Negado' && !obs[ap.id]?.trim()) {
      showToast('Informe uma observação para negar.', 'error', true);
      return;
    }
    if (!supabase) return;
    processingRef.current = ap.id;
    setProcessing(ap.id);
    try {
      const { data, error } = await supabase.rpc('liberar_requisicao_estoque', {
        p_aprovacao_id: ap.id,
        p_decisao:      decisao,
        p_observacao:   obs[ap.id] ?? '',
      });
      if (error) throw new Error(error.message);
      setAprovacoes(prev => prev.filter(a => a.id !== ap.id));
      showToast(
        decisao === 'Negado'
          ? 'Requisição negada.'
          : (data as any)?.baixou_estoque
            ? 'Material liberado e estoque baixado.'
            : 'Requisição aprovada.',
        'success', true);
    } catch (err: unknown) {
      // Sem sufixo sobre estado: a transação garante que nada ficou pela
      // metade, então não há o que tranquilizar.
      showToast(
        `Não foi possível ${decisao === 'Negado' ? 'negar' : 'liberar'}: ${motivoDoErro(err)}`,
        'error', true);
    } finally {
      setProcessing(null);
      processingRef.current = null;
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Liberar Requisições — {filial}</h2><p className="text-sm text-gray-400 mt-1">Material pedido pelas áreas — o que já existe na prateleira, e por isso não passa por Compras. Liberar dá baixa no estoque; quem pediu não libera a própria (migr. 284).</p></div>
      </div>
      {enriched.length === 0 ? <EmptyState message="Nenhuma aprovação pendente" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto main-scrollbar pb-6">
          {enriched.map(ap => (
            <motion.div key={ap.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-bold text-gray-200">{ap.prod?.nome ?? 'Produto não encontrado'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Qtd: <span className="text-gray-300 font-mono">{ap.req?.qtd ?? '—'}</span> · Destino: <span className="text-gray-300">{ap.req?.destino || '—'}</span></p>
                  <p className="text-xs text-gray-500">Solicitante: <span className="text-gray-300">{ap.req?.solicitante ?? '—'}</span></p>
                </div>
                <StatusBadge status={ap.status} />
              </div>
              {expanded === ap.id && (
                <textarea className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16" placeholder="Observação (obrigatória para negar)..."
                  value={obs[ap.id] ?? ''} onChange={e => setObs(o => ({ ...o, [ap.id]: e.target.value }))} />
              )}
              <div className="flex gap-2 justify-end">
                {expanded !== ap.id && (<button onClick={() => setExpanded(ap.id)} disabled={processing === ap.id} className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400 disabled:opacity-40">Adicionar obs.</button>)}
                <button onClick={() => decidir(ap, 'Negado')} disabled={processing === ap.id} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-500 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                  {processing === ap.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Negar
                </button>
                <button onClick={() => decidir(ap, 'Aprovado')} disabled={processing === ap.id} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
                  {processing === ap.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Aprovar
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export const AprovacoesEstoqueView = ({ showToast }: { showToast: (msg: string, type: string, persist?: boolean) => void; profile?: unknown }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A liberação de material do almoxarifado" />;
  return <AprovacoesEstoqueViewInner showToast={showToast} filial={filialAtiva} />;
};
