import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Save, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, FormField, NeuButtonAccent } from '../components/ui';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { useFilial } from '../contexts/FilialContext';
import type { UserProfile } from '../hooks/useUserProfile';

// Alçada de aprovação de cotações por filial (migração 204).
// Só admin/CEO acessam.
type Alcada = {
  id?: string;
  filial: string;
  valor_limite_financeiro: number;
};

const FILIAIS_OPERACIONAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;

export const AlcadasView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const podeEditar = profile.role === 'admin' || profile.role === 'ceo';
  // Operando dentro de uma unidade, só a alçada dela aparece. O painel com as
  // três é do modo Matriz — configurar limite de aprovação da MaxLook estando
  // na SuperMax é ato de outra unidade.
  const { filialAtiva } = useFilial();
  const filiaisVisiveis = filialAtiva
    ? FILIAIS_OPERACIONAIS.filter(f => f === filialAtiva)
    : [...FILIAIS_OPERACIONAIS];

  const [alcadas, setAlcadas] = useState<Record<string, Alcada>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingFilial, setSavingFilial] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('alcadas_compra')
      .select('id, filial, valor_limite_financeiro')
      .eq('ativo', true);
    if (error) {
      showToast(`Erro ao carregar alçadas: ${error.message}`, 'error', true);
      setLoading(false);
      return;
    }
    const map: Record<string, Alcada> = {};
    const inputMap: Record<string, string> = {};
    (rows ?? []).forEach((r: any) => {
      map[r.filial] = { id: r.id, filial: r.filial, valor_limite_financeiro: Number(r.valor_limite_financeiro ?? 0) };
      inputMap[r.filial] = formatBRL(Number(r.valor_limite_financeiro ?? 0));
    });
    // Filiais operacionais que ainda não têm registro — permite criar do zero.
    FILIAIS_OPERACIONAIS.forEach(f => {
      if (!map[f]) {
        map[f] = { filial: f, valor_limite_financeiro: 1000 };
        inputMap[f] = '1.000,00';
      }
    });
    setAlcadas(map);
    setInputs(inputMap);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (filial: string) => {
    if (!supabase) return;
    const valor = parseBRL(inputs[filial] ?? '0');
    if (!(valor >= 0)) {
      showToast('Informe um valor válido.', 'error', true);
      return;
    }
    setSavingFilial(filial);
    try {
      const existente = alcadas[filial];
      if (existente.id) {
        const { error } = await supabase
          .from('alcadas_compra')
          .update({ valor_limite_financeiro: valor, atualizado_por: profile.id, updated_at: new Date().toISOString() })
          .eq('id', existente.id);
        if (error) throw new Error(error.message);
      } else {
        const { data: novo, error } = await supabase
          .from('alcadas_compra')
          .insert({ filial, valor_limite_financeiro: valor, criado_por: profile.id })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        setAlcadas(prev => ({ ...prev, [filial]: { ...prev[filial], id: (novo as any)?.id } }));
      }
      setAlcadas(prev => ({ ...prev, [filial]: { ...prev[filial], valor_limite_financeiro: valor } }));
      showToast(`Alçada de ${filial} salva.`, 'success', true);
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSavingFilial(null);
    }
  };

  if (!podeEditar) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-center">
        <AlertTriangle size={40} className="text-yellow-400/70" />
        <h2 className="text-lg font-bold text-gray-200">Sem permissão</h2>
        <p className="text-sm text-gray-500 max-w-md">Alçadas são configuradas apenas por admin ou CEO.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
          <ShieldCheck size={26} /> Alçadas de Aprovação
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Define quem aprova cotações por faixa de valor em cada filial.
        </p>
      </div>

      <div className="neu-flat rounded-2xl p-5 border border-white/5 text-xs text-gray-400">
        <p className="mb-2 font-bold text-gray-300 uppercase text-[10px] tracking-widest">Regra vigente</p>
        <ul className="space-y-1 list-disc list-inside">
          <li><span className="text-cyan-300 font-bold">Valor ≤ limite</span> — Financeiro decide (fluxo diário).</li>
          <li><span className="text-amber-300 font-bold">Valor &gt; limite</span> — Gerente da filial decide (compras maiores).</li>
          <li><span className="text-gray-200 font-bold">Admin / CEO</span> — sempre podem, override total.</li>
        </ul>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filiaisVisiveis.map(filial => (
            <div key={filial} className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-bold text-gray-200">{filial}</h3>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                  {alcadas[filial]?.id ? 'Configurado' : 'Padrão'}
                </span>
              </div>
              <FormField label="Limite Financeiro (R$)">
                <input
                  type="text"
                  inputMode="numeric"
                  className="neu-input py-2 px-3 rounded-xl text-sm text-right font-mono"
                  value={inputs[filial] ?? ''}
                  onChange={e => setInputs(prev => ({ ...prev, [filial]: formatBRL(e.target.value) }))}
                  placeholder="0,00"
                />
              </FormField>
              <p className="text-[10px] text-gray-500">
                Até <span className="text-cyan-300 font-mono">R$ {inputs[filial] || '0,00'}</span> vai pro Financeiro; acima disso pro Gerente.
              </p>
              <NeuButtonAccent onClick={() => salvar(filial)} isLoading={savingFilial === filial}>
                <Save size={14} /> Salvar
              </NeuButtonAccent>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};
