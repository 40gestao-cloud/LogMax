import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Save, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, FormField, NeuButtonAccent } from '../components/ui';
import { fetchJurosConfig, invalidateJurosCache } from '../lib/juros';

// Configuração de juros + multa que se aplica a todas as contas a receber e a
// pagar vencidas. Editável apenas por Financeiro (admin/CEO passam via RLS).
// O cálculo é didático — ambiente educacional, sem compliance bancário.

export const ConfigJurosView = ({ showToast }: any) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    juros_dia_pct: '0,0333',
    multa_pct:     '2,0000',
    carencia_dias: '0',
    ativo:         true,
  });

  useEffect(() => {
    fetchJurosConfig(true).then(cfg => {
      if (cfg) {
        setForm({
          juros_dia_pct: String(cfg.juros_dia_pct).replace('.', ','),
          multa_pct:     String(cfg.multa_pct).replace('.', ','),
          carencia_dias: String(cfg.carencia_dias),
          ativo:         cfg.ativo,
        });
      }
      setLoading(false);
    });
  }, []);

  const parseNum = (s: string) => Number(s.replace(',', '.')) || 0;

  const handleSave = async () => {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from('financeiro_config').update({
      juros_dia_pct: parseNum(form.juros_dia_pct),
      multa_pct:     parseNum(form.multa_pct),
      carencia_dias: Number(form.carencia_dias) || 0,
      ativo:         form.ativo,
      updated_at:    new Date().toISOString(),
    }).eq('id', 1);
    setSaving(false);
    if (error) {
      showToast(`Erro ao salvar: ${error.message}`, 'error', true);
      return;
    }
    invalidateJurosCache();
    showToast('Política de juros atualizada.', 'success', true);
  };

  // Simulação rápida: R$ 1.000 vencido há 30 dias com a config atual.
  const simulacao = (() => {
    const valor = 1000;
    const juros = parseNum(form.juros_dia_pct);
    const multa = parseNum(form.multa_pct);
    const dias = Math.max(0, 30 - (Number(form.carencia_dias) || 0));
    const valorMulta = +(valor * multa / 100).toFixed(2);
    const valorJuros = +(valor * juros / 100 * dias).toFixed(2);
    return { valor, valorMulta, valorJuros, total: valor + valorMulta + valorJuros };
  })();

  if (loading) return <LoadingSpinner />;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Juros & Multa</h2>
      </div>

      <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Juros ao dia (%)">
            <input
              type="text"
              inputMode="decimal"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={form.juros_dia_pct}
              onChange={e => setForm(f => ({ ...f, juros_dia_pct: e.target.value }))}
              placeholder="0,0333"
            />
          </FormField>
          <FormField label="Multa fixa (%)">
            <input
              type="text"
              inputMode="decimal"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={form.multa_pct}
              onChange={e => setForm(f => ({ ...f, multa_pct: e.target.value }))}
              placeholder="2,0"
            />
          </FormField>
          <FormField label="Carência (dias)">
            <input
              type="number"
              min="0"
              className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums"
              value={form.carencia_dias}
              onChange={e => setForm(f => ({ ...f, carencia_dias: e.target.value }))}
              placeholder="0"
            />
          </FormField>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.ativo}
            onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))}
            className="accent-current"
          />
          <span className="text-sm text-gray-200">Aplicar juros e multa em contas vencidas</span>
        </label>

        <div className="flex justify-end">
          <NeuButtonAccent onClick={handleSave} isLoading={saving}><Save size={14} /> Salvar política</NeuButtonAccent>
        </div>
      </div>

      <div
        className="neu-pressed rounded-2xl p-5 flex flex-col gap-2"
        style={{
          background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)',
        }}
      >
        <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase tracking-widest">
          <Info size={14} /> Simulação rápida
        </div>
        <p className="text-xs text-gray-400">Uma conta de R$ 1.000 vencida há 30 dias (descontando carência):</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
          <Cell label="Valor original" valor={simulacao.valor} />
          <Cell label="Multa" valor={simulacao.valorMulta} accent="red" />
          <Cell label="Juros" valor={simulacao.valorJuros} accent="red" />
          <Cell label="Total a pagar" valor={simulacao.total} accent="accent" />
        </div>
      </div>
    </motion.div>
  );
};

const Cell = ({ label, valor, accent }: { label: string; valor: number; accent?: 'red' | 'accent' }) => (
  <div className="neu-pressed rounded-xl p-3">
    <div className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">{label}</div>
    <div className={`text-sm font-bold tabular-nums mt-1 ${accent === 'red' ? 'text-red-400' : accent === 'accent' ? 'text-accent' : 'text-gray-200'}`}>
      R$ {valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </div>
  </div>
);
