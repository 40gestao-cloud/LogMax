import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Target, X, Check, Clock, CheckCircle2, AlertCircle, BookOpen, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';

const STATUS_FLOW = ['Pendente', 'Em Andamento', 'Concluído', 'Cancelado'] as const;
type Status = typeof STATUS_FLOW[number];

const STATUS_STYLE: Record<Status, { badge: string; icon: React.ReactNode }> = {
  'Pendente':     { badge: 'bg-gray-500/10  text-gray-400  border-gray-500/20',   icon: <Clock size={9} /> },
  'Em Andamento': { badge: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20', icon: <AlertCircle size={9} /> },
  'Concluído':    { badge: 'bg-accent/10    text-accent    border-accent/20',     icon: <CheckCircle2 size={9} /> },
  'Cancelado':    { badge: 'bg-red-500/10   text-red-500   border-red-500/20',    icon: <X size={9} /> },
};

type PdiItem = {
  id: string;
  avaliacao_id: string;
  descricao: string;
  treinamento_id: string | null;
  prazo: string | null;
  status: Status;
  observacao: string | null;
  nome_criador: string | null;
  created_at: string;
};

type Treinamento = { id: string; nome: string; status: string };

/**
 * Seção de PDI dentro do card de avaliação. Carrega lazy (só na primeira
 * expansão) e gerencia seu próprio estado pra não inflar o componente pai.
 *
 * RBAC visual:
 *   • canEditar (avaliador ou admin/CEO) → adiciona, edita status e remove itens.
 *   • Demais (avaliado, gerente que só lê) → veem a lista e os badges.
 */
export const PDISection: React.FC<{
  avaliacaoId: string;
  canEditar: boolean;
  profile: any;
  treinamentos: Treinamento[];
  showToast?: any;
}> = ({ avaliacaoId, canEditar, profile, treinamentos, showToast }) => {
  const [itens, setItens] = useState<PdiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adicionando, setAdicionando] = useState(false);
  const [form, setForm] = useState({ descricao: '', prazo: '', treinamento_id: '', observacao: '' });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const treinamentosAtivos = treinamentos.filter(t => t.status !== 'Cancelado');
  const treinamentoNome = (id: string | null) => treinamentos.find(t => t.id === id)?.nome ?? '';

  const carregar = async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('pdi_itens')
      .select('*')
      .eq('avaliacao_id', avaliacaoId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[PDI] erro ao carregar:', error.message);
      showToast?.(`Erro ao carregar PDI: ${error.message}`, 'error');
    }
    setItens(data ?? []);
    setLoading(false);
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [avaliacaoId]);

  const resetForm = () => {
    setForm({ descricao: '', prazo: '', treinamento_id: '', observacao: '' });
    setAdicionando(false);
  };

  const handleAdd = async () => {
    if (!supabase) return;
    if (!form.descricao.trim()) { showToast?.('Descreva a meta.', 'error'); return; }
    setSaving(true);
    try {
      const payload: any = {
        avaliacao_id:   avaliacaoId,
        descricao:      form.descricao.trim(),
        prazo:          form.prazo || null,
        treinamento_id: form.treinamento_id || null,
        observacao:     form.observacao.trim() || null,
        status:         'Pendente',
        nome_criador:   profile?.nome ?? '',
        criado_por:     profile?.id ?? null,
      };
      const { data, error } = await supabase
        .from('pdi_itens')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setItens(prev => [data, ...prev]);
      showToast?.('Meta adicionada ao PDI.', 'success');
      resetForm();
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? 'tente novamente'}`, 'error');
    }
    setSaving(false);
  };

  const handleStatus = async (item: PdiItem, novoStatus: Status) => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from('pdi_itens')
        .update({ status: novoStatus })
        .eq('id', item.id)
        .select()
        .single();
      if (error) throw error;
      setItens(prev => prev.map(i => i.id === item.id ? data : i));
    } catch (err: any) {
      showToast?.(`Erro ao atualizar: ${err?.message ?? '—'}`, 'error');
    }
  };

  const handleDelete = async (item: PdiItem) => {
    if (!supabase) return;
    if (!await confirm('Remover esta meta do PDI?')) return;
    try {
      const { error } = await supabase.from('pdi_itens').delete().eq('id', item.id);
      if (error) throw error;
      setItens(prev => prev.filter(i => i.id !== item.id));
      showToast?.('Meta removida.', 'success');
    } catch (err: any) {
      showToast?.(`Erro: ${err?.message ?? '—'}`, 'error');
    }
  };

  return (
    <div className="pt-3 mt-3 border-t border-white/5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target size={12} className="text-accent" />
          <h5 className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Plano de Desenvolvimento</h5>
          {itens.length > 0 && (
            <span className="text-[10px] text-gray-500">· {itens.filter(i => i.status === 'Concluído').length}/{itens.length}</span>
          )}
        </div>
        {canEditar && !adicionando && (
          <button onClick={() => setAdicionando(true)}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-accent hover:underline">
            <Plus size={10} />Nova meta
          </button>
        )}
      </div>

      <AnimatePresence>
        {adicionando && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="neu-pressed rounded-xl p-3 mb-2 flex flex-col gap-2">
              <input
                type="text"
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: Melhorar oratória em reuniões de equipe"
                className="neu-input rounded-lg px-3 py-2 text-xs"
                autoFocus
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="date"
                  value={form.prazo}
                  onChange={e => setForm(f => ({ ...f, prazo: e.target.value }))}
                  className="neu-input rounded-lg px-3 py-2 text-xs"
                  title="Prazo (opcional)"
                />
                <select
                  value={form.treinamento_id}
                  onChange={e => setForm(f => ({ ...f, treinamento_id: e.target.value }))}
                  className="neu-input rounded-lg px-3 py-2 text-xs"
                  title="Treinamento vinculado (opcional)"
                >
                  <option value="">Sem treinamento</option>
                  {treinamentosAtivos.map(t => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={form.observacao}
                onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
                placeholder="Observação (opcional)"
                className="neu-input rounded-lg px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button onClick={resetForm}
                  className="text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-white px-3 py-1.5">
                  Cancelar
                </button>
                <button onClick={handleAdd} disabled={saving || !form.descricao.trim()}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 rounded-lg px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40">
                  <Check size={10} />{saving ? 'Salvando…' : 'Adicionar'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <p className="text-[10px] text-gray-600 text-center py-2">Carregando metas…</p>
      ) : itens.length === 0 ? (
        <p className="text-[10px] text-gray-600 italic">Nenhuma meta de desenvolvimento cadastrada ainda.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {itens.map(item => {
            const tStyle = STATUS_STYLE[item.status];
            const atrasado = item.prazo && new Date(item.prazo) < new Date() && item.status !== 'Concluído' && item.status !== 'Cancelado';
            return (
              <div key={item.id} className="neu-pressed rounded-lg p-2.5 group">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 leading-snug">{item.descricao}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${tStyle.badge}`}>
                        {tStyle.icon}{item.status}
                      </span>
                      {item.prazo && (
                        <span className={`text-[9px] font-mono ${atrasado ? 'text-red-400 font-bold' : 'text-gray-500'}`}>
                          {atrasado && '⚠ '}{item.prazo}
                        </span>
                      )}
                      {item.treinamento_id && (
                        <span className="inline-flex items-center gap-1 text-[9px] text-accent">
                          <BookOpen size={8} />{treinamentoNome(item.treinamento_id) || 'treinamento'}
                        </span>
                      )}
                      {item.observacao && (
                        <span className="text-[9px] text-gray-500 italic truncate max-w-[200px]" title={item.observacao}>· {item.observacao}</span>
                      )}
                    </div>
                  </div>
                  {canEditar && (
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <select
                        value={item.status}
                        onChange={e => handleStatus(item, e.target.value as Status)}
                        className="neu-input text-[9px] px-1.5 py-0.5 rounded-md uppercase font-bold tracking-wider"
                        title="Mudar status"
                      >
                        {STATUS_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => handleDelete(item)} title="Remover meta"
                        className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-red-400 transition-colors">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
