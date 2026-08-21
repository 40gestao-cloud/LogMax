import React, { useState, useEffect, useMemo } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, Trash2, CornerUpLeft, X } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbDelete } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, Pagination } from '../components/ui';
import { useFormValidation, idsDeProdutosPorTermo } from '../lib/viewUtils';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../contexts/ConfirmContext';
import type { UserProfile } from '../hooks/useUserProfile';

const MovimentacoesEstoqueViewInner = ({ showToast, filial, profile }: { showToast: any; filial: FilialOp; profile?: UserProfile | null }) => {
  const confirm = useConfirm();
  const { data: produtos } = useFetchData<any>('/api/produtosview', { filial });

  // Paginação server-side. Esta tabela é append-only e só cresce — carregar
  // tudo e filtrar no cliente já custava a base inteira a cada abertura.
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  // A busca é por PRODUTO e vale sobre a tabela toda, não só sobre a página:
  // resolvemos os ids no catálogo (já carregado acima) e mandamos `IN (...)`
  // para o servidor. `searchColumns` do hook só alcança colunas da própria
  // tabela, e o nome do produto mora em `produtos`.
  const produtoIds = useMemo(
    () => idsDeProdutosPorTermo(produtos, debouncedSearch),
    [produtos, debouncedSearch],
  );
  const extraFilter = debouncedSearch.trim() ? { filial, produto_id: produtoIds } : { filial };
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/movimentacoesestoqueview', extraFilter, true, { page },
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ produto_id: '', tipo: '' });
  const [extras, setExtras] = useState({ qtd: '', origem: '', destino: '' });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Devolução para correção (migr. 502) — só a direção. `role === 'admin'`
  // LITERAL, não `hasRole`/`auth_is_admin`: CEO e conselheiro são ALUNOS, e
  // devolver é ato de quem avalia. O banco repete a régua na RPC; isto aqui só
  // evita mostrar um botão que vai voltar 42501.
  const ehProfessor = profile?.role === 'admin';
  const [devolvendo, setDevolvendo] = useState<any | null>(null);
  const [motivoDevolucao, setMotivoDevolucao] = useState('');
  const [devolvendoSalvando, setDevolvendoSalvando] = useState(false);

  const handleDevolver = async () => {
    if (!devolvendo || !supabase) return;
    if (!motivoDevolucao.trim()) {
      showToast('Escreva o que está errado — é o que o aluno vai ler para corrigir.', 'error', true);
      return;
    }
    setDevolvendoSalvando(true);
    try {
      const { error } = await supabase.rpc('devolver_movimentacao_para_correcao', {
        p_movimentacao_id: devolvendo.id,
        p_motivo:          motivoDevolucao.trim(),
      });
      if (error) throw new Error(error.message);
      // A RPC inativa a linha; o saldo já estornou pelo gatilho da migr. 268.
      setData((prev: any[]) => prev.filter(d => d.id !== devolvendo.id));
      setDevolvendo(null);
      setMotivoDevolucao('');
      showToast(
        'Movimentação desfeita e devolvida. O saldo estornou e o produto ficou marcado como "precisa de correção" — quem fez a movimentação vê o motivo em Cadastros > Produtos.',
        'success', true);
    } catch (err: any) {
      showToast(`Não foi possível devolver: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setDevolvendoSalvando(false);
    }
  };

  const filtered = data.map((m: any) => ({ ...m, prod: produtos.find((p: any) => p.id === m.produto_id) }));

  const closeForm = () => { setShowForm(false); setForm({ produto_id: '', tipo: '' }); setExtras({ qtd: '', origem: '', destino: '' }); setErrors({}); };

  const handleSave = async () => {
    if (!validate()) return;
    const qtd = Number(extras.qtd) || 0;
    if (qtd <= 0) { showToast('Informe uma quantidade > 0.', 'error', true); return; }

    // Aviso amigável antes de tentar. A recusa de verdade é do banco: o trigger
    // (migr. 268) faz a transação inteira voltar atrás se o saldo ficaria
    // negativo. Antes ele truncava em zero com GREATEST() e a movimentação
    // registrava uma baixa que nunca aconteceu.
    const saldoLocal = Number(produtos.find((p: any) => p.id === form.produto_id)?.estoque ?? 0);
    if ((form.tipo === 'Saída' || form.tipo === 'Ajuste −') && qtd > saldoLocal) {
      showToast(`Saldo insuficiente: estoque atual ${saldoLocal} un. (baixa solicitada: ${qtd}).`, 'error', true);
      return;
    }

    setIsSaving(true);
    showToast("Registrando...", 'info', false);
    try {
      if (!supabase) throw new Error('Supabase não configurado');
      const { data: saved, error } = await supabase.rpc('movimentar_estoque', {
        p_produto_id: form.produto_id,
        p_tipo:       form.tipo,
        p_qtd:        qtd,
        p_origem:     extras.origem || null,
        p_destino:    extras.destino || null,
        p_filial:     filial,
      });
      if (error) throw new Error(error.message);
      const nova: any = Array.isArray(saved) ? saved[0] : saved;
      setData([nova, ...data]);
      showToast("Movimentação registrada!", 'success', true);
      closeForm();
    } catch (err: any) {
      showToast(`Erro ao registrar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
    finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    // O trigger agora reage a UPDATE/DELETE também, então inativar ESTORNA o
    // saldo. Antes não revertia nada e o texto mandava "fazer ajuste manual" —
    // usando justamente o Ajuste que somava quando devia subtrair.
    if (!await confirm('Inativar esta movimentação? O efeito dela no saldo de estoque será estornado.')) return;
    try {
      await dbDelete('/api/movimentacoesestoqueview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Movimentação inativada.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Movimentacoes] erro ao inativar:', err);
      showToast(`Erro ao inativar: ${msg}`, 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Movimentações de Estoque — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Entradas, saídas e ajustes de estoque.</p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Nova Movimentação</NeuButtonAccent>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Movimentação</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Produto *" error={errors.produto_id}>
                  <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.produto_id ? 'border border-red-500/40' : ''}`}
                    value={form.produto_id} onChange={e => { setForm(f => ({ ...f, produto_id: e.target.value })); clearError('produto_id'); }}>
                    <option value="">Selecione...</option>
                    {produtos.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </FormField>
                <FormField label="Tipo *" error={errors.tipo}>
                  <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.tipo ? 'border border-red-500/40' : ''}`}
                    value={form.tipo} onChange={e => { setForm(f => ({ ...f, tipo: e.target.value })); clearError('tipo'); }}>
                    <option value="">Selecione...</option>
                    {/* 'Ajuste' virou dois tipos com sinal (migr. 268). Sem
                        sinal, o trigger caía no ELSE e SOMAVA — ajustar para
                        corrigir contagem a menor aumentava o estoque. */}
                    {['Entrada', 'Saída', 'Ajuste +', 'Ajuste −'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>
                <FormField label="Quantidade">
                  <input type="number" className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.qtd}
                    onChange={e => setExtras(x => ({ ...x, qtd: e.target.value }))} placeholder="0" />
                </FormField>
                <FormField label="Origem">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.origem}
                    onChange={e => setExtras(x => ({ ...x, origem: e.target.value }))} placeholder="Ex: Fornecedor XYZ" />
                </FormField>
                <FormField label="Destino">
                  <input className="neu-input py-2 px-3 rounded-xl text-sm" value={extras.destino}
                    onChange={e => setExtras(x => ({ ...x, destino: e.target.value }))} placeholder="Ex: Almoxarifado A" />
                </FormField>
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
          <table className="w-full text-left border-collapse min-w-[540px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Data</th>
                <th className="pb-4 font-bold px-4">Produto</th>
                <th className="pb-4 font-bold px-4">Tipo</th>
                <th className="pb-4 font-bold px-4 text-right">Qtd</th>
                <th className="pb-4 font-bold px-4">Origem</th>
                <th className="pb-4 font-bold px-4">Destino</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (<tr><td colSpan={7}><LoadingSpinner /></td></tr>)
                : filtered.length === 0 ? (<tr><td colSpan={7}><EmptyState /></td></tr>)
                : (
                  <AnimatePresence>
                    {filtered.map((item: any) => (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{item.data || '—'}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-gray-200">{item.prod?.nome ?? '—'}</td>
                        <td className="py-3 px-4 text-xs">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.tipo === 'Entrada' ? 'bg-green-900/30 text-green-400'
                            : item.tipo === 'Saída' ? 'bg-red-950/50 text-red-500'
                            : item.tipo === 'Ajuste −' ? 'bg-orange-900/30 text-orange-400'
                            : 'bg-blue-900/30 text-blue-400'}`}>{item.tipo}</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-200 text-right">{item.qtd ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.origem || '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400">{item.destino || '—'}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <HistoricoOperacoes entidade="movimentacoes_estoque" entidadeId={item.id} titulo={`${item.tipo ?? 'Movimentação'} · ${item.data ?? ''}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                            {/* Devolver é diferente de excluir: as duas desfazem
                                o saldo, mas esta AVISA quem errou e deixa a
                                correção com ele. Só a direção vê (migr. 502). */}
                            {ehProfessor && item.ativo !== false && (
                              <button
                                onClick={() => { setDevolvendo(item); setMotivoDevolucao(''); }}
                                title="Desfazer e devolver para quem lançou corrigir"
                                className="neu-button py-1.5 px-3 rounded-lg text-xs font-bold text-amber-400 hover:bg-amber-400/10 transition-colors flex items-center gap-1"
                              >
                                <CornerUpLeft size={11} /> Devolver
                              </button>
                            )}
                            <button onClick={() => handleDelete(item.id)} title="Excluir" className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
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

      {/* Devolver para correção (migr. 502). Mesma ideia da cotação devolvida
          (migr. 467): quem decide não corrige o trabalho do outro — devolve
          com motivo, e quem errou conserta. É o que faz o erro virar aula. */}
      <AnimatePresence>
        {devolvendo && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !devolvendoSalvando && setDevolvendo(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-300">
                  Devolver para correção
                  <span className="text-accent ml-2">— {devolvendo.prod?.nome ?? 'produto'}</span>
                </h3>
                <button onClick={() => !devolvendoSalvando && setDevolvendo(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <div className="neu-inset rounded-xl p-3 border border-white/5">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">O que será desfeito</p>
                <p className="text-xs text-gray-200">
                  {devolvendo.tipo} de {devolvendo.qtd}
                  {devolvendo.origem ? <span className="text-gray-500"> · {devolvendo.origem}</span> : null}
                </p>
              </div>

              <FormField label="O que está errado? *">
                <textarea rows={3}
                  className="neu-input py-2 px-3 rounded-xl text-sm w-full resize-none"
                  value={motivoDevolucao}
                  onChange={e => setMotivoDevolucao(e.target.value)}
                  placeholder="Ex.: esta entrada duplicou o saldo de implantação — o produto já tinha entrado pelo recebimento." />
              </FormField>

              <p className="text-[11px] text-gray-500 leading-snug">
                A movimentação é desfeita e o saldo estorna. O produto fica marcado como
                <span className="text-amber-300 font-semibold"> precisa de correção</span>, com este motivo à
                vista em Cadastros &gt; Produtos — e a caneta fica com quem fez a movimentação
                (ou o gerente da unidade), não com a direção.
              </p>

              <div className="flex justify-end gap-2">
                <button onClick={() => setDevolvendo(null)} disabled={devolvendoSalvando}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleDevolver} isLoading={devolvendoSalvando}
                  disabled={!motivoDevolucao.trim()}>
                  <CornerUpLeft size={14} /> Devolver
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const MovimentacoesEstoqueView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <MovimentacoesEstoqueViewInner showToast={showToast} filial={filialAtiva} profile={profile} />;
};
