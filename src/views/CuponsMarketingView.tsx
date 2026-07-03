import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Edit3, Ticket, Copy, CheckCircle2, Search } from 'lucide-react';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { hasSetor } from '../lib/rbac';
import { FILIAIS_HOLDING } from '../lib/filiais';
import { useConfirm } from '../contexts/ConfirmContext';

type Tipo = 'percentual' | 'fixo';

type Cupom = {
  id: string;
  codigo: string;
  tipo: Tipo;
  valor: number;
  valor_minimo: number;
  desconto_maximo: number | null;
  validade_inicio: string | null;
  validade_fim: string;
  limite_uso: number | null;
  usos: number;
  filial: string | null;
  campanha_id: string | null;
  descricao: string | null;
  nome_criador: string | null;
  created_at: string;
};

type Campanha = { id: string; nome: string };

const EMPTY_FORM = {
  codigo: '',
  tipo: 'percentual' as Tipo,
  valor: '',
  valor_minimo: '',
  desconto_maximo: '',
  validade_inicio: '',
  validade_fim: '',
  limite_uso: '',
  filial: '',
  campanha_id: '',
  descricao: '',
};

const fmtBRL = (n: number) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Cupom é mais útil em UPPERCASE (convenção universal) — sanitiza acentos/espaços.
const sanitizeCodigo = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);

export const CuponsMarketingView = ({ showToast, profile }: any) => {
  const { data: cupons, setData, isLoading } = useFetchData<Cupom>('/api/marketingcuponsview');
  const confirm = useConfirm();
  const { data: campanhas } = useFetchData<Campanha>('/api/marketingcampanhasview');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Cupom | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [searchCup, setSearchCup] = useState('');

  const canCRUD = hasSetor(profile, 'marketing');

  const campanhasAtivasMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of campanhas ?? []) m[c.id] = c.nome;
    return m;
  }, [campanhas]);
  const cuponsFiltrados = searchCup
    ? (cupons ?? []).filter((c: any) =>
        (c.codigo ?? '').toLowerCase().includes(searchCup.toLowerCase()) ||
        (c.descricao ?? '').toLowerCase().includes(searchCup.toLowerCase()))
    : (cupons ?? []);

  const resetForm = () => { setForm(EMPTY_FORM); setEditing(null); setShowForm(false); };

  const openEdit = (c: Cupom) => {
    setEditing(c);
    setForm({
      codigo:          c.codigo,
      tipo:            c.tipo,
      valor:           c.tipo === 'percentual'
                          ? String(c.valor).replace('.', ',')
                          : (c.valor ? formatBRL(c.valor) : ''),
      valor_minimo:    c.valor_minimo ? formatBRL(c.valor_minimo) : '',
      desconto_maximo: c.desconto_maximo != null ? formatBRL(c.desconto_maximo) : '',
      validade_inicio: c.validade_inicio ?? '',
      validade_fim:    c.validade_fim,
      limite_uso:      c.limite_uso != null ? String(c.limite_uso) : '',
      filial:          c.filial ?? '',
      campanha_id:     c.campanha_id ?? '',
      descricao:       c.descricao ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    const codigo = sanitizeCodigo(form.codigo);
    if (!codigo)                { showToast('Informe o código do cupom.', 'error'); return; }
    if (!form.validade_fim)     { showToast('Informe a validade final.', 'error'); return; }

    // Percentual usa vírgula decimal direto; fixo usa parseBRL.
    const valorNum = form.tipo === 'percentual'
      ? Number(String(form.valor).replace(',', '.'))
      : parseBRL(form.valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      showToast('Valor inválido.', 'error'); return;
    }
    if (form.tipo === 'percentual' && valorNum > 100) {
      showToast('Percentual não pode passar de 100%.', 'error'); return;
    }

    setSaving(true);
    try {
      const payload: any = {
        codigo,
        tipo:            form.tipo,
        valor:           valorNum,
        valor_minimo:    parseBRL(form.valor_minimo || '0'),
        desconto_maximo: form.desconto_maximo ? parseBRL(form.desconto_maximo) : null,
        validade_inicio: form.validade_inicio || null,
        validade_fim:    form.validade_fim,
        limite_uso:      form.limite_uso ? Number(form.limite_uso) : null,
        filial:          form.filial || null,
        campanha_id:     form.campanha_id || null,
        descricao:       form.descricao.trim() || null,
      };

      if (editing) {
        const updated = await dbUpdate('/api/marketingcuponsview', editing.id, payload);
        setData((prev: any[]) => prev.map((x: any) => x.id === editing.id ? { ...x, ...updated } : x));
        showToast('Cupom atualizado.', 'success');
      } else {
        payload.nome_criador = profile?.nome ?? '';
        payload.criado_por   = profile?.id ?? null;
        const created = await dbInsert('/api/marketingcuponsview', payload);
        setData((prev: any[]) => [created, ...prev]);
        showToast('Cupom criado.', 'success');
      }
      resetForm();
    } catch (err: any) {
      console.error('[Cupons] salvar:', err);
      // Conflito de UNIQUE = código duplicado.
      const msg = /unique|duplicate/i.test(err?.message ?? '')
        ? 'Código já existe — escolha outro.'
        : (err?.message ?? 'tente novamente');
      showToast(`Erro ao salvar: ${msg}`, 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (c: Cupom) => {
    if (!await confirm(`Inativar o cupom "${c.codigo}"?`)) return;
    try {
      await dbDelete('/api/marketingcuponsview', c.id);
      setData((prev: any[]) => prev.filter((x: any) => x.id !== c.id));
      showToast('Cupom inativado.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error');
    }
  };

  const copyCodigo = async (codigo: string) => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopied(codigo);
      setTimeout(() => setCopied(c => c === codigo ? null : c), 1500);
    } catch {
      showToast('Não consegui copiar — copie manualmente.', 'error');
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  const today = new Date().toISOString().slice(0, 10);
  const ativos = cupons.filter((c: any) => c.validade_fim >= today).length;
  const expirados = cupons.length - ativos;
  const usosTotais = cupons.reduce((s: number, c: any) => s + Number(c.usos || 0), 0);

  const kpis = [
    { label: 'Total de Cupons', value: String(cupons.length) },
    { label: 'Em Vigor',        value: String(ativos) },
    { label: 'Expirados',       value: String(expirados) },
    { label: 'Usos Totais',     value: String(usosTotais) },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Cupons</h2>
        <p className="text-sm text-gray-400 mt-1">
          Códigos promocionais aplicáveis no PDV. Use cupom percentual ou valor fixo, com limite de usos e validade.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {kpis.map((k) => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className="text-2xl font-black text-gray-100 tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={searchCup}
            onChange={e => setSearchCup(e.target.value)}
            placeholder="Buscar cupom…"
            className="neu-input rounded-xl pl-8 pr-3 py-2 text-sm w-[200px]"
          />
        </div>
        {canCRUD && (
          <NeuButtonAccent variant="" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={14} />Novo Cupom
          </NeuButtonAccent>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-gray-300">{editing ? 'Editar Cupom' : 'Novo Cupom'}</h3>
              <button onClick={resetForm} className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-codigo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Código *</label>
                <input id="cup-codigo" type="text" value={form.codigo}
                  onChange={e => setForm(f => ({ ...f, codigo: sanitizeCodigo(e.target.value) }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm font-mono uppercase tracking-wider"
                  placeholder="VERAO10" disabled={!!editing}
                  title={editing ? 'Código não pode ser editado depois de criado.' : 'Maiúsculas, números, _ ou -'}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-tipo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Tipo *</label>
                <select id="cup-tipo" value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as Tipo, valor: '', desconto_maximo: '' }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="percentual">Percentual (%)</option>
                  <option value="fixo">Valor fixo (R$)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-valor" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  Valor * {form.tipo === 'percentual' ? '(0–100)' : '(R$)'}
                </label>
                <input id="cup-valor" type="text" inputMode={form.tipo === 'percentual' ? 'decimal' : 'numeric'}
                  value={form.valor}
                  onChange={e => setForm(f => ({
                    ...f,
                    valor: form.tipo === 'percentual'
                      ? e.target.value.replace(/[^0-9,]/g, '').slice(0, 6)
                      : formatBRL(e.target.value),
                  }))}
                  onKeyDown={form.tipo === 'fixo' ? handleMoneyKeyDown : undefined}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm"
                  placeholder={form.tipo === 'percentual' ? '10' : '0,00'} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-valor-minimo" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Compra mínima (R$)</label>
                <input id="cup-valor-minimo" type="text" inputMode="numeric" value={form.valor_minimo}
                  onChange={e => setForm(f => ({ ...f, valor_minimo: formatBRL(e.target.value) }))}
                  onKeyDown={handleMoneyKeyDown}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="0,00 = sem mínimo" />
              </div>
              {form.tipo === 'percentual' && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cup-desconto-max" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Teto do desconto (R$)</label>
                  <input id="cup-desconto-max" type="text" inputMode="numeric" value={form.desconto_maximo}
                    onChange={e => setForm(f => ({ ...f, desconto_maximo: formatBRL(e.target.value) }))}
                    onKeyDown={handleMoneyKeyDown}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="vazio = sem teto" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-limite" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Limite de usos</label>
                <input id="cup-limite" type="text" inputMode="numeric" value={form.limite_uso}
                  onChange={e => setForm(f => ({ ...f, limite_uso: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" placeholder="vazio = ilimitado" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-validade-ini" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Validade — Início</label>
                <input id="cup-validade-ini" type="date" value={form.validade_inicio}
                  onChange={e => setForm(f => ({ ...f, validade_inicio: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-validade-fim" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Validade — Fim *</label>
                <input id="cup-validade-fim" type="date" value={form.validade_fim}
                  onChange={e => setForm(f => ({ ...f, validade_fim: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-filial" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Filial</label>
                <select id="cup-filial" value={form.filial}
                  onChange={e => setForm(f => ({ ...f, filial: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Todas</option>
                  {FILIAIS_HOLDING.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cup-campanha" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Campanha</label>
                <select id="cup-campanha" value={form.campanha_id}
                  onChange={e => setForm(f => ({ ...f, campanha_id: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">Sem campanha</option>
                  {(campanhas ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 lg:col-span-3">
                <label htmlFor="cup-descricao" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Descrição</label>
                <input id="cup-descricao" type="text" value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm"
                  placeholder="Ex: 10% off na primeira compra do mês" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetForm} className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                Cancelar
              </button>
              <NeuButtonAccent variant="" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : (editing ? 'Salvar' : 'Criar Cupom')}
              </NeuButtonAccent>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {cupons.length === 0 ? <EmptyState message="Nenhum cupom criado ainda" /> : (
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4">Código</th>
                  <th className="pb-4 font-bold px-4">Tipo</th>
                  <th className="pb-4 font-bold px-4 text-right">Valor</th>
                  <th className="pb-4 font-bold px-4 text-right">Mín. compra</th>
                  <th className="pb-4 font-bold px-4">Validade</th>
                  <th className="pb-4 font-bold px-4 text-right">Usos / Limite</th>
                  <th className="pb-4 font-bold px-4">Filial</th>
                  <th className="pb-4 font-bold px-4">Campanha</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {cuponsFiltrados.length === 0
                    ? <tr><td colSpan={9} className="py-8 text-center text-sm text-gray-600 italic">Nenhum cupom encontrado para "{searchCup}"</td></tr>
                    : cuponsFiltrados.map((c: any) => {
                    const expirado = c.validade_fim < today;
                    const esgotado = c.limite_uso != null && c.usos >= c.limite_uso;
                    return (
                      <motion.tr key={c.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                        <td className="py-3 px-4">
                          <button onClick={() => copyCodigo(c.codigo)}
                            className="inline-flex items-center gap-1.5 text-sm font-mono font-bold text-accent hover:text-accent/80 transition-colors"
                            title="Copiar código">
                            <Ticket size={11} />{c.codigo}
                            {copied === c.codigo ? <CheckCircle2 size={10} /> : <Copy size={10} className="opacity-50" />}
                          </button>
                          {c.descricao && <p className="text-[10px] text-gray-500 max-w-[220px] truncate" title={c.descricao}>{c.descricao}</p>}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400">
                          {c.tipo === 'percentual' ? 'Percentual' : 'Valor fixo'}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-100 text-right tabular-nums">
                          {c.tipo === 'percentual'
                            ? `${Number(c.valor).toLocaleString('pt-BR')}%`
                            : fmtBRL(c.valor)}
                          {c.desconto_maximo && (
                            <p className="text-[9px] text-gray-500">teto {fmtBRL(c.desconto_maximo)}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-gray-400 text-right tabular-nums">
                          {c.valor_minimo > 0 ? fmtBRL(c.valor_minimo) : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">
                          {c.validade_inicio ? `${c.validade_inicio} → ` : 'até '}{c.validade_fim}
                          {expirado && <span className="ml-1.5 text-[9px] font-bold text-red-400 uppercase">expirado</span>}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-right tabular-nums">
                          <span className={esgotado ? 'text-red-400 font-bold' : 'text-gray-300'}>
                            {c.usos}{c.limite_uso != null ? ` / ${c.limite_uso}` : ''}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-400">{c.filial ?? 'Todas'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400 max-w-[160px] truncate">
                          {c.campanha_id ? (campanhasAtivasMap[c.campanha_id] ?? '—') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canCRUD && (
                              <>
                                <button onClick={() => openEdit(c)} title="Editar" className="action-btn-edit">
                                  <Edit3 size={12} />
                                </button>
                                <button onClick={() => handleDelete(c)} title="Inativar" className="action-btn-delete">
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};
