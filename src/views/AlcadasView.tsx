import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Save, ShieldCheck, AlertTriangle, Landmark, UserCog, Crown, Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, FormField, NeuButtonAccent, SecaoFormulario, CardContador, type CorAba } from '../components/ui';
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
const COR_UNIDADE: Record<string, CorAba> = { SuperMax: 'azul', MaxLook: 'dourado', TechMax: 'laranja' };

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
      <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight flex items-center gap-2">
        <ShieldCheck size={26} /> Alçadas de Aprovação
      </h2>

      {/* A regra em três selos, no lugar da lista explicativa: quem decide a
          cotação conforme o valor. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 mr-1">Quem decide a cotação</span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 text-white">
          <Landmark size={13} /> Até o limite · Financeiro
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-black">
          <UserCog size={13} /> Acima do limite · Gerente da unidade
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-600 text-white">
          <Crown size={13} /> Admin e CEO · sempre
        </span>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filiaisVisiveis.map(filial => {
            const salvo = alcadas[filial]?.valor_limite_financeiro ?? 0;
            const digitado = parseBRL(inputs[filial] ?? '0');
            const alterado = Math.abs((digitado || 0) - salvo) > 0.004 || !alcadas[filial]?.id;
            return (
              <SecaoFormulario key={filial} titulo={filial} icon={Building2} cor={COR_UNIDADE[filial]}
                extra={alcadas[filial]?.id ? 'Configurado' : 'Padrão — ainda não salvo'}>
                <div className="flex flex-col gap-4">
                  <CardContador label="Limite do Financeiro" value={`R$ ${formatBRL(salvo)}`} tom="azul" />

                  {/* A régua da unidade: à esquerda do limite, Financeiro; à direita, Gerente. */}
                  <div className="flex rounded-xl overflow-hidden text-[11px] font-bold">
                    <div className="flex-1 bg-cyan-600 text-white px-3 py-2 text-center">
                      até R$ {inputs[filial] || '0,00'} · Financeiro
                    </div>
                    <div className="flex-1 bg-amber-500 text-black px-3 py-2 text-center">
                      acima · Gerente
                    </div>
                  </div>

                  <FormField label="Novo limite (R$)">
                    <input
                      type="text"
                      inputMode="numeric"
                      className="neu-input py-2 px-3 rounded-xl text-sm text-right font-mono tabular-nums"
                      value={inputs[filial] ?? ''}
                      onChange={e => setInputs(prev => ({ ...prev, [filial]: formatBRL(e.target.value) }))}
                      placeholder="0,00"
                    />
                  </FormField>

                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-[11px] font-bold ${alterado ? 'text-amber-400' : 'text-gray-600'}`}>
                      {alterado ? 'Alteração não salva' : 'Sem alterações'}
                    </span>
                    <NeuButtonAccent onClick={() => salvar(filial)} isLoading={savingFilial === filial} disabled={!alterado}>
                      <Save size={14} /> Salvar
                    </NeuButtonAccent>
                  </div>
                </div>
              </SecaoFormulario>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
