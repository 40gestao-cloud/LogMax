import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, Save, FileDown, Receipt, ShoppingBag, Wrench } from 'lucide-react';
import { useFilial } from '../contexts/FilialContext';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge } from '../components/ui';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown, gerarNotaEmitidaPDF } from '../lib/viewUtils';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { hasSetor } from '../lib/rbac';
import { todayBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';

type NotaEmitida = {
  id: string;
  filial: string;
  numero: number;
  serie: string;
  tipo: 'NF Produto' | 'NFS-e Serviço' | 'Recibo Simples';
  origem: 'pdv' | 'servico_manual' | 'avulso';
  cliente_id: string | null;
  cliente_nome: string | null;
  valor_total: number;
  descricao: string;
  data_emissao: string;
  venda_id: string | null;
  conta_receber_id: string | null;
  created_at: string;
  ativo: boolean;
};

const TIPOS_POR_NICHO: Record<string, NotaEmitida['tipo']> = {
  SuperMax: 'NF Produto',
  MaxLook:  'NF Produto',
  TechMax:  'NFS-e Serviço',
};

const TIPO_ICON: Record<NotaEmitida['tipo'], any> = {
  'NF Produto': ShoppingBag,
  'NFS-e Serviço': Wrench,
  'Recibo Simples': Receipt,
};

const NotasEmitidasViewInner = ({ showToast, filial, profile }: {
  showToast: any;
  filial: string;
  profile: UserProfile;
}) => {
  const { data, setData, isLoading, reload } = useFetchData<NotaEmitida>('/api/notasemitidasview', { filial });
  const { data: clientes } = useFetchData<any>('/api/crmview-clientes', { filial });

  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'todos' | NotaEmitida['tipo']>('todos');
  const [form, setForm] = useState({ descricao: '' });
  const [extras, setExtras] = useState({
    tipo: TIPOS_POR_NICHO[filial] ?? 'Recibo Simples' as NotaEmitida['tipo'],
    cliente_id: '',
    valor_total: '',
    data_emissao: todayBR(),
  });
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  const podeEmitir = hasSetor(profile, 'vendas') || hasSetor(profile, 'financeiro')
    || profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente';

  const clienteMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const c of clientes) m[c.id] = c;
    return m;
  }, [clientes]);

  const filtered = data.filter(n => {
    if (filtroTipo !== 'todos' && n.tipo !== filtroTipo) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return [String(n.numero), n.descricao, n.cliente_nome, n.tipo]
      .some(v => v?.toLowerCase().includes(q));
  });

  const totalFiltrado = filtered.reduce((s, n) => s + Number(n.valor_total ?? 0), 0);

  const resetExtras = () => setExtras({
    tipo: TIPOS_POR_NICHO[filial] ?? 'Recibo Simples',
    cliente_id: '',
    valor_total: '',
    data_emissao: todayBR(),
  });

  const closeForm = () => {
    setShowForm(false);
    setForm({ descricao: '' });
    resetExtras();
    setErrors({});
  };

  const handleEmitir = async () => {
    if (!validate()) return;
    if (!supabase) { showToast('Supabase não configurado.', 'error', true); return; }
    setIsSaving(true);
    showToast('Emitindo nota...', 'info', false);
    try {
      const cliente = extras.cliente_id ? clienteMap[extras.cliente_id] : null;
      const valor = parseBRL(extras.valor_total);
      if (!valor || valor <= 0) {
        showToast('Valor obrigatório maior que zero.', 'error', true);
        setIsSaving(false);
        return;
      }
      const { data: nova, error } = await supabase.rpc('emitir_nota', {
        p_filial: filial,
        p_tipo: extras.tipo,
        p_origem: 'servico_manual',
        p_cliente_id: extras.cliente_id || null,
        p_cliente_nome: cliente?.nome ?? null,
        p_valor_total: valor,
        p_descricao: form.descricao,
        p_venda_id: null,
        p_conta_receber_id: null,
        p_data_emissao: extras.data_emissao,
        p_serie: '001',
      });
      if (error) throw error;
      const linha = Array.isArray(nova) ? nova[0] : nova;
      setData([linha as NotaEmitida, ...data]);
      showToast(`Nota ${String(linha.numero).padStart(6, '0')} emitida!`, 'success', true);
      // Baixa o PDF na sequência
      await gerarNotaEmitidaPDF({
        numero: linha.numero,
        serie: linha.serie,
        tipo: linha.tipo,
        filial: linha.filial,
        cliente_nome: linha.cliente_nome,
        descricao: linha.descricao,
        valor_total: Number(linha.valor_total),
        data_emissao: linha.data_emissao,
        origem: linha.origem,
      });
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error('[NotasEmitidas] erro ao emitir:', err);
      showToast(`Erro ao emitir: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  const baixarPDF = async (n: NotaEmitida) => {
    try {
      await gerarNotaEmitidaPDF({
        numero: n.numero,
        serie: n.serie,
        tipo: n.tipo,
        filial: n.filial,
        cliente_nome: n.cliente_nome,
        descricao: n.descricao,
        valor_total: Number(n.valor_total),
        data_emissao: n.data_emissao,
        origem: n.origem,
      });
    } catch (err: any) {
      showToast('Falha ao gerar PDF.', 'error', true);
      console.error(err);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Notas Emitidas</h2>
          <p className="text-sm text-gray-400 mt-1">
            Faturamento da <span className="text-accent">{filial}</span>: PDV emite automaticamente,
            {' '}serviços prestados você lança aqui.
          </p>
        </div>
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar por número, cliente..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-64"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {podeEmitir && (
            <NeuButtonAccent onClick={() => setShowForm(v => !v)}><Plus size={16} /> Emitir</NeuButtonAccent>
          )}
        </div>
      </div>

      {/* Chips de filtro por tipo */}
      <div className="flex gap-2 flex-wrap">
        {(['todos', 'NF Produto', 'NFS-e Serviço', 'Recibo Simples'] as const).map(t => (
          <button key={t}
            onClick={() => setFiltroTipo(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              filtroTipo === t
                ? 'bg-accent text-white border-accent'
                : 'bg-white/5 text-gray-400 border-white/10 hover:text-gray-200'
            }`}>
            {t === 'todos' ? 'Todos' : t}
          </button>
        ))}
        <div className="ml-auto text-xs text-gray-400 flex items-center gap-2">
          <span>{filtered.length} nota{filtered.length !== 1 && 's'}</span>
          <span className="text-gray-600">·</span>
          <span className="font-mono text-accent">R$ {formatBRL(totalFiltrado)}</span>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Emitir nova nota manualmente</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Tipo *">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.tipo}
                    onChange={e => setExtras(x => ({ ...x, tipo: e.target.value as any }))}>
                    <option value="NF Produto">NF Produto</option>
                    <option value="NFS-e Serviço">NFS-e Serviço</option>
                    <option value="Recibo Simples">Recibo Simples</option>
                  </select>
                </FormField>
                <FormField label="Cliente">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.cliente_id}
                    onChange={e => setExtras(x => ({ ...x, cliente_id: e.target.value }))}>
                    <option value="">Consumidor final</option>
                    {groupCadastrosParaSelect(clientes).map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </FormField>
                <FormField label="Valor Total (R$) *">
                  <input type="text" inputMode="numeric"
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.valor_total}
                    onChange={e => setExtras(x => ({ ...x, valor_total: formatBRL(e.target.value) }))}
                    onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                </FormField>
                <FormField label="Descrição *" error={errors.descricao}>
                  <textarea rows={3}
                    className={`neu-input py-2 px-3 rounded-xl text-sm resize-none ${errors.descricao ? 'border border-red-500/40' : ''}`}
                    value={form.descricao}
                    onChange={e => { setForm({ descricao: e.target.value }); clearError('descricao'); }}
                    placeholder={extras.tipo === 'NFS-e Serviço'
                      ? 'Ex: Manutenção preventiva de notebook Dell + troca de SSD 480GB'
                      : 'Ex: Venda de 3 unidades do produto X'} />
                </FormField>
                <FormField label="Data de emissão">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={extras.data_emissao}
                    onChange={e => setExtras(x => ({ ...x, data_emissao: e.target.value }))} />
                </FormField>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleEmitir} isLoading={isSaving}><Save size={14} /> Emitir e Baixar PDF</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
        <div className="overflow-x-auto main-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="pb-4 font-bold px-4">Nº / Série</th>
                <th className="pb-4 font-bold px-4">Tipo</th>
                <th className="pb-4 font-bold px-4">Cliente / Descrição</th>
                <th className="pb-4 font-bold px-4">Data</th>
                <th className="pb-4 font-bold px-4">Origem</th>
                <th className="pb-4 font-bold px-4 text-right">Valor</th>
                <th className="pb-4 font-bold px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7}><LoadingSpinner /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7}><EmptyState /></td></tr>
              ) : (
                <AnimatePresence>
                  {filtered.map(n => {
                    const Icon = TIPO_ICON[n.tipo];
                    return (
                      <motion.tr key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4">
                          <div className="text-sm font-mono font-bold text-gray-100">{String(n.numero).padStart(6, '0')}</div>
                          <div className="text-[10px] text-gray-500">Série {n.serie}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/10 text-accent border border-accent/20">
                            <Icon size={11} /> {n.tipo}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 max-w-md">
                          <div className="font-semibold text-gray-200">{n.cliente_nome ?? 'Consumidor final'}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{n.descricao}</div>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400">{n.data_emissao}</td>
                        <td className="py-3 px-4">
                          <StatusBadge status={n.origem === 'pdv' ? 'PDV' : n.origem === 'servico_manual' ? 'Serviço' : 'Avulso'} />
                        </td>
                        <td className="py-3 px-4 text-xs font-mono font-bold text-accent text-right">
                          R$ {formatBRL(Number(n.valor_total ?? 0))}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button onClick={() => baixarPDF(n)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                            <FileDown size={11} /> PDF
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

export const NotasEmitidasView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return null;
  return <NotasEmitidasViewInner showToast={showToast} filial={filialAtiva} profile={profile} />;
};
