import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Check } from 'lucide-react';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { EmptyState, StatusBadge } from '../components/ui';

export const AprovacoesEstoqueView = ({ showToast }: any) => {
  const { data: aprovacoes, setData: setAprovacoes } = useFetchData<any>('/api/minhasaprovacoesestoqueview', { status: 'Pendente' });
  const { data: requisicoes } = useFetchData<any>('/api/requisicoesestoqueview');
  const { data: produtos } = useFetchData<any>('/api/produtosview');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});

  const enriched = aprovacoes.map((ap: any) => {
    const req = requisicoes.find((r: any) => r.id === ap.requisicao_estoque_id);
    return { ...ap, req, prod: req ? produtos.find((p: any) => p.id === req.produto_id) : null };
  });

  const handleAprovar = async (ap: any) => {
    try {
      await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Aprovado', observacao: obs[ap.id] ?? '' });
      await dbUpdate('/api/requisicoesestoqueview', ap.requisicao_estoque_id, { status: 'Aprovada' });
      setAprovacoes((prev: any[]) => prev.filter(a => a.id !== ap.id));
      showToast("Requisição aprovada!", 'success', true);
    } catch { showToast("Erro ao aprovar.", 'error', true); }
  };

  const handleNegar = async (ap: any) => {
    if (!obs[ap.id]?.trim()) { showToast("Informe uma observação para negar.", 'error', true); return; }
    try {
      await dbUpdate('/api/minhasaprovacoesestoqueview', ap.id, { status: 'Negado', observacao: obs[ap.id] });
      await dbUpdate('/api/requisicoesestoqueview', ap.requisicao_estoque_id, { status: 'Negada' });
      setAprovacoes((prev: any[]) => prev.filter(a => a.id !== ap.id));
      showToast("Requisição negada.", 'success', true);
    } catch { showToast("Erro ao negar.", 'error', true); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div><h2 className="text-3xl font-bold text-gray-100 tracking-tight">Aprovações de Estoque</h2><p className="text-sm text-gray-400 mt-1">Analise e aprove ou negue requisições de estoque pendentes.</p></div>
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
                {expanded !== ap.id && (<button onClick={() => setExpanded(ap.id)} className="neu-button py-1.5 px-3 rounded-lg text-xs text-gray-400">Adicionar obs.</button>)}
                <button onClick={() => handleNegar(ap)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-red-400 hover:bg-red-900/20 border border-red-500/10"><X size={11} className="inline mr-1" />Negar</button>
                <button onClick={() => handleAprovar(ap)} className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-green-400 hover:bg-green-900/20 border border-green-500/10"><Check size={11} className="inline mr-1" />Aprovar</button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
