import { useRolarAteFormulario } from '../hooks/useRolarAteFormulario';
import { MenuMais, ItemMenu } from '../components/MenuMais';
import React, { useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Save, RotateCcw } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, SelecioneUnidade } from '../components/ui';
import { useFormValidation } from '../lib/viewUtils';
import { useConfirm } from '../contexts/ConfirmContext';
import { FiltroSolicitante, chaveSolicitante } from '../components/FiltroSolicitante';
import { ExcluirAdmin } from '../components/ExcluirAdmin';

const RequisicoesEstoqueViewInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
  const { data, setData, isLoading } = useFetchData<any>('/api/requisicoesestoqueview', { filial }, true);
  const confirm = useConfirm();
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });
  const [isSaving, setIsSaving] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ produto_id: '' });
  const [extras, setExtras] = useState({ qtd: '1', destino: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const enriched = data.map((r: any) => ({ ...r, prod: produtos.find((p: any) => p.id === r.produto_id) }));
  const porBusca = enriched.filter((r: any) =>
    [r.solicitante, r.status, r.destino, r.prod?.nome].some((v: any) => v?.toLowerCase().includes(search.toLowerCase()))
  );
  // Filtro por solicitante (2026-09-01), o mesmo de Requisições e Aprovações.
  // Vem DEPOIS da busca: assim a contagem ao lado de cada nome é sempre a do
  // que a tabela está mostrando, e não um número que a busca já descartou.
  const [solicitante, setSolicitante] = useState<string | null>(null);
  const filtered = porBusca.filter((r: any) =>
    solicitante === null || chaveSolicitante(r.solicitante) === solicitante);

  const closeForm = () => { setEditItem(null); setForm({ produto_id: '' }); setExtras({ qtd: '1', destino: '' }); setErrors({}); };
  const openEdit = (item: any) => { setEditItem(item); setForm({ produto_id: item.produto_id ?? '' }); setExtras({ qtd: String(item.qtd ?? 1), destino: item.destino ?? '' }); setErrors({}); };

  // Só edição. A criação saiu desta tela (migr. 284) e mora em
  // Requisições → Do Setor: quem precisa do material é quem pede, e o
  // Estoque atende. O almoxarife corrigindo quantidade continua valendo.
  const handleSave = async () => {
    if (!validate() || !editItem) return;
    setIsSaving(true);
    showToast("Salvando...", 'info', false);
    try {
      const payload = { ...form, qtd: Number(extras.qtd) || 1, destino: extras.destino };
      const updated = await dbUpdate('/api/requisicoesestoqueview', editItem.id, payload);
      setData((prev: any[]) => prev.map(d => d.id === editItem.id ? (updated ?? { ...d, ...payload }) : d));
      showToast("Requisição atualizada!", 'success', true);
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[RequisicoesEstoque] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally { setIsSaving(false); }
  };

  // Excluir saiu (migr. 340): o pedido de material é o rastro de quem tirou o
  // que da prateleira. Reabrir devolve para a fila do Estoque — e o banco
  // recusa se o material já saiu, porque reabrir contaria a baixa duas vezes.
  const handleReabrir = async (item: any) => {
    if (!supabase) return;
    if (!await confirm('Reabrir esta requisição de material?\n\nEla volta para Pendente, na fila do Estoque.')) return;
    try {
      const { error } = await supabase.rpc('reabrir_requisicao_estoque', { p_id: item.id, p_motivo: null });
      if (error) throw error;
      showToast('Requisição de material reaberta.', 'success', true);
      window.location.reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível reabrir.', 'error', true);
    }
  };

  const isFormOpen = !!editItem;

  const formEdicaoRef = useRolarAteFormulario(isFormOpen, editItem?.id);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Requisições de Material — {filial}</h2>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input type="text" placeholder="Buscar..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <FiltroSolicitante nomes={porBusca.map((r: any) => r.solicitante)} valor={solicitante} onChange={setSolicitante} />
        </div>
      </div>
      <AnimatePresence>
        {isFormOpen && (
          <motion.div ref={formEdicaoRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Editar Requisição</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Produto *" error={errors.produto_id}>
                  <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`} value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}>
                    <option value="">Selecione...</option>
                    {produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </FormField>
                <FormField label="Solicitante">
                  <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">
                    {editItem?.solicitante ?? '—'}
                    {editItem?.setor_solicitante && (
                      <span className="text-[10px] text-gray-500 ml-2 uppercase tracking-widest">{editItem.setor_solicitante}</span>
                    )}
                  </div>
                </FormField>
                <FormField label="Quantidade">
                  <input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd} onChange={e => setExtras(x => ({ ...x, qtd: e.target.value }))} placeholder="1" />
                </FormField>
                <FormField label="Destino">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.destino} onChange={e => setExtras(x => ({ ...x, destino: e.target.value }))} placeholder="Ex: Setor de Produção" />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> Atualizar</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="tabela w-full text-left border-collapse">
            <thead><tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest"><th className="pb-4 font-bold px-4">Produto</th><th className="pb-4 font-bold px-4 text-right">Qtd</th><th className="pb-4 font-bold px-4">Destino</th><th className="pb-4 font-bold px-4">Solicitante</th><th className="pb-4 font-bold px-4 text-center">Status</th><th className="pb-4 font-bold px-4 text-right">Ações</th></tr></thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={6}><LoadingSpinner /></td></tr>) : filtered.length === 0 ? (<tr><td colSpan={6}><EmptyState message={solicitante !== null
                ? `Nenhuma requisição de material de ${solicitante}${search ? ' com esta busca' : ''}.`
                : undefined} /></td></tr>) : (
                <AnimatePresence>
                  {filtered.map((item: any) => (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.destino || '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{item.solicitante}</td>
                      <td className="py-3 px-4 text-center"><StatusBadge status={item.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-center items-center gap-1.5">
                          {item.status === 'Pendente' && (
                            <button onClick={() => openEdit(item)} title="Editar" className="action-btn-edit"><Edit2 size={12} /></button>
                          )}
                            <MenuMais>
                              {fechar => (
                                <>
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="requisicoes_estoque" entidadeId={item.id} titulo={item.prod?.nome ?? 'Requisição de estoque'} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                  {item.status === 'Negado' && (
                                    <ItemMenu onClick={() => { fechar(); handleReabrir(item); }}
                                      cor="text-amber-400 hover:bg-amber-500/10" icon={RotateCcw}>
                                      Reabrir para o Estoque
                                    </ItemMenu>
                                  )}
                                  {profile?.role === 'admin' && (
                                    <ExcluirAdmin variante="menu" endpoint="/api/requisicoesestoqueview" id={item.id}
                                      rotulo={`pedido de material de ${item.solicitante ?? 'origem desconhecida'}`}
                                      showToast={showToast}
                                      alternativa="negue a requisição: ela sai da fila e o solicitante vê o motivo."
                                      onExcluido={() => window.location.reload()} />
                                  )}
                                </>
                              )}
                            </MenuMais>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

export const RequisicoesEstoqueView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A requisição de material do almoxarifado" />;
  return <RequisicoesEstoqueViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
