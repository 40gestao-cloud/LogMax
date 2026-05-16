import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Check, Loader2 } from 'lucide-react';
import { useFetchData, dbUpdate, dbInsert } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { EmptyState, StatusBadge } from '../components/ui';
import { useWhatsApp } from '../hooks/useWhatsApp';

export const AprovacoesEstoqueView = ({ showToast }: any) => {
  const { data: aprovacoes, setData: setAprovacoes } = useFetchData<any>('/api/minhasaprovacoesestoqueview', { status: 'Pendente' });
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const { notify: wppNotify } = useWhatsApp();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  const enriched = aprovacoes.map((ap: any) => {
    const req = requisicoes.find((r: any) => r.id === ap.requisicao_estoque_id);
    return { ...ap, req, prod: req ? produtos.find((p: any) => p.id === req.produto_id) : null };
  });

  const handleAprovar = async (ap: any) => {
    if (processing) return;
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
        const today = new Date().toISOString().slice(0, 10);
        await dbInsert('/api/movimentacoesestoqueview', {
          produto_id: ap.req.produto_id,
          tipo: 'Saída',
          qtd: Number(ap.req.qtd),
          origem: 'Requisição de Estoque',
          destino: ap.req.destino || 'Solicitado',
          data: today,
        });
      }
      setAprovacoes((prev: any[]) => prev.filter(a => a.id !== ap.id));
      showToast("Requisição aprovada e estoque atualizado!", 'success', true);
      wppNotify(`📤 *LogMax — Requisição de Estoque aprovada*\n📦 Produto: ${ap.prod?.nome ?? '—'}\n🔢 Qtd: ${ap.req?.qtd ?? '—'}\n🏭 Destino: ${ap.req?.destino ?? '—'}`);
    } catch {
      if (aprovUpdated) {
        try { await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Pendente', observacao: '' }); } catch {}
      }
      showToast("Erro ao aprovar — rollback aplicado.", 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleNegar = async (ap: any) => {
    if (processing) return;
    if (!obs[ap.id]?.trim()) { showToast("Informe uma observação para negar.", 'error', true); return; }
    setProcessing(ap.id);
    let aprovUpdated = false;
    try {
      await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Negado', observacao: obs[ap.id] });
      aprovUpdated = true;
      await dbUpdate('/api/requisicoesestoqueview', ap.requisicao_estoque_id, { status: 'Negado' });
      setAprovacoes((prev: any[]) => prev.filter(a => a.id !== ap.id));
      showToast("Requisição negada.", 'success', true);
    } catch {
      if (aprovUpdated) {
        try { await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Pendente', observacao: '' }); } catch {}
      }
      showToast("Erro ao negar — rollback aplicado.", 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações de Estoque</h2><p className="text-sm text-gray-400 mt-1">Analise e aprove ou negue requisições de estoque pendentes.</p></div>
      {enriched.length === 0 ? <EmptyState message="Nenhuma aprovação pendente" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto main-scrollbar pb-6">
          {enriched.map((ap: any) => (
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
