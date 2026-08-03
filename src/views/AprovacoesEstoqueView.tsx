import React, { useState, useRef } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion } from 'motion/react';
import { X, Check, Loader2 } from 'lucide-react';
import { useFetchData, dbUpdate, dbInsert } from '../hooks/useSupabaseData';
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

  const handleAprovar = async (ap: EnrichedAp) => {
    if (processingRef.current === ap.id) return;
    processingRef.current = ap.id;
    setProcessing(ap.id);
    let aprovUpdated = false;
    try {
      // Consulta saldo ATUAL no banco (evita TOCTOU com dados em memória desatualizados)
      if (ap.req?.produto_id && ap.req?.qtd) {
        const { data: prodFresh } = await supabase!
          .from('produtos')
          .select('estoque')
          .eq('id', ap.req.produto_id)
          .single();
        const saldoAtual = Number(prodFresh?.estoque ?? 0);
        const qtdSolicitada = Number(ap.req.qtd);
        if (saldoAtual < qtdSolicitada) {
          showToast(`Saldo insuficiente: estoque atual é ${saldoAtual} un. (solicitado: ${qtdSolicitada}).`, 'error', true);
          return;
        }
      }
      await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Aprovado', observacao: obs[ap.id] ?? '' });
      aprovUpdated = true;
      await dbUpdate('/api/requisicoesestoqueview', ap.requisicao_estoque_id, { status: 'Aprovado' });
      if (ap.req?.produto_id && ap.req?.qtd) {
        const today = todayBR();
        try {
          await dbInsert('/api/movimentacoesestoqueview', {
            produto_id:            ap.req.produto_id,
            tipo:                  'Saída',
            qtd:                   Number(ap.req.qtd),
            origem:                'Requisição de Estoque',
            destino:               ap.req.destino || 'Solicitado',
            data:                  today,
            requisicao_estoque_id: ap.requisicao_estoque_id,
            filial,
          });
        } catch (movErr: unknown) {
          // 23505 = UNIQUE: já existe movimento pra essa requisição
          // (double-click, ou aprovação concorrente em outra aba).
          // Idempotência: trata como sucesso silencioso.
          const msg = String((movErr as { message?: string })?.message ?? '');
          const isDuplicate = msg.includes('uq_mov_estoque_por_requisicao_estoque')
                            || msg.includes('23505')
                            || /duplicate key value/i.test(msg);
          if (!isDuplicate) throw movErr;
        }
      }
      setAprovacoes(prev => prev.filter(a => a.id !== ap.id));
      showToast("Requisição aprovada e estoque atualizado!", 'success', true);
    } catch {
      if (aprovUpdated) {
        // Reverte AS DUAS pontas. Antes só a aprovação voltava para 'Pendente'
        // e a requisição ficava 'Aprovado' — estado que a tela de aprovações
        // não mostra e ninguém mais consegue destravar.
        try { await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Pendente', observacao: '' }); } catch {}
        try { await dbUpdate('/api/requisicoesestoqueview', ap.requisicao_estoque_id, { status: 'Pendente' }); } catch {}
      }
      showToast("Erro ao aprovar — rollback aplicado.", 'error', true);
    } finally {
      setProcessing(null);
      processingRef.current = null;
    }
  };

  const handleNegar = async (ap: EnrichedAp) => {
    if (processingRef.current === ap.id) return;
    if (!obs[ap.id]?.trim()) { showToast("Informe uma observação para negar.", 'error', true); return; }
    processingRef.current = ap.id;
    setProcessing(ap.id);
    let aprovUpdated = false;
    try {
      await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Negado', observacao: obs[ap.id] });
      aprovUpdated = true;
      await dbUpdate('/api/requisicoesestoqueview', ap.requisicao_estoque_id, { status: 'Negado' });
      setAprovacoes(prev => prev.filter(a => a.id !== ap.id));
      showToast("Requisição negada.", 'success', true);
    } catch {
      if (aprovUpdated) {
        try { await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Pendente', observacao: '' }); } catch {}
      }
      showToast("Erro ao negar — rollback aplicado.", 'error', true);
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
                <button onClick={() => handleNegar(ap)} disabled={processing === ap.id} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-500 hover:bg-red-900/20 border border-red-500/10 disabled:opacity-40 flex items-center gap-1">
                  {processing === ap.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Negar
                </button>
                <button onClick={() => handleAprovar(ap)} disabled={processing === ap.id} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-accent hover:bg-accent/10 border border-accent/20 disabled:opacity-40 flex items-center gap-1">
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
