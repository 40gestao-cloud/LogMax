import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ParametrosPrecificacao } from '../lib/precificacao';

// Imposto, taxas e despesas da filial para o markup divisor (migr. 656).
// Uma leitura por tela: os três números mudam por mês, não por digitação.
// Sem a migração aplicada, `params` fica null e o cadastro segue sem sugestão.
export function useParametrosPrecificacao(filial: string | null | undefined) {
  const [params, setParams] = useState<ParametrosPrecificacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!supabase || !filial) { setParams(null); return; }
    setCarregando(true);
    const { data, error } = await supabase.rpc('parametros_precificacao', { p_filial: filial });
    if (error) {
      setParams(null);
      setErro(/parametros_precificacao|schema cache/i.test(error.message)
        ? 'A formação de preço ainda não foi liberada nesta turma (migração 656 pendente).'
        : error.message);
    } else {
      setParams(data as ParametrosPrecificacao);
      setErro(null);
    }
    setCarregando(false);
  }, [filial]);

  useEffect(() => { void carregar(); }, [carregar]);

  /** Null em qualquer campo devolve aquele parâmetro ao histórico. */
  const salvar = useCallback(async (manual: { rbt12: number | null; despesas_pct: number | null; variaveis_pct: number | null }) => {
    if (!supabase || !filial) return;
    const { data, error } = await supabase.rpc('salvar_parametros_precificacao', {
      p_filial: filial,
      p_rbt12_manual: manual.rbt12,
      p_despesas_pct_manual: manual.despesas_pct,
      p_taxas_pct_manual: null,  // migr. 666: ignorado — a taxa sai de Formas de Pagamento
      p_variaveis_pct_manual: manual.variaveis_pct,  // migr. 664
    });
    if (error) throw error;
    setParams(data as ParametrosPrecificacao);
  }, [filial]);

  /** Migr. 664: lucro desejado do serviço prestado (null limpa). */
  const salvarLucroServico = useCallback(async (pct: number | null) => {
    if (!supabase || !filial) return;
    const { data, error } = await supabase.rpc('salvar_lucro_servico', { p_filial: filial, p_pct: pct });
    if (error) throw error;
    setParams(data as ParametrosPrecificacao);
  }, [filial]);

  return { params, carregando, erro, recarregar: carregar, salvar, salvarLucroServico };
}
