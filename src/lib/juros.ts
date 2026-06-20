import { supabase } from './supabase';

// Espelho client-side da função SQL `calcular_valor_atualizado`. Mesma lógica:
// juros simples por dia de atraso + multa fixa após carência. Plataforma é
// didática — não tem ambição de compliance bancário, é pra alunos verem
// como o cálculo evolui dia a dia.

export type JurosConfig = {
  juros_dia_pct: number;
  multa_pct: number;
  carencia_dias: number;
  ativo: boolean;
};

export type JurosBreakdown = {
  valor_original: number;
  dias_atraso:    number;
  multa:          number;
  juros:          number;
  total:          number;
  vencido:        boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcularJuros(
  valor: number | null | undefined,
  vencimento: string | null | undefined,
  status: string | null | undefined,
  cfg: JurosConfig | null,
  hoje: Date = new Date(),
): JurosBreakdown {
  const v = Number(valor || 0);
  if (!cfg || !cfg.ativo || status === 'Pago' || !vencimento) {
    return { valor_original: v, dias_atraso: 0, multa: 0, juros: 0, total: v, vencido: false };
  }
  // Trabalha em data, ignorando horas. Vencimento é tipo `date` no banco.
  const venc = new Date(vencimento + 'T00:00:00');
  const hojeData = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.max(0, Math.floor((hojeData.getTime() - venc.getTime()) / 86400000));

  if (dias <= cfg.carencia_dias) {
    return { valor_original: v, dias_atraso: dias, multa: 0, juros: 0, total: v, vencido: dias > 0 };
  }

  const multa = round2(v * cfg.multa_pct / 100);
  const juros = round2(v * cfg.juros_dia_pct / 100 * (dias - cfg.carencia_dias));
  const total = round2(v + multa + juros);
  return { valor_original: v, dias_atraso: dias, multa, juros, total, vencido: true };
}

let cachedConfig: JurosConfig | null | undefined; // undefined = nunca buscou
let inflight: Promise<JurosConfig | null> | null = null;

export async function fetchJurosConfig(force = false): Promise<JurosConfig | null> {
  if (!force && cachedConfig !== undefined) return cachedConfig;
  if (inflight) return inflight;
  if (!supabase) { cachedConfig = null; return null; }

  inflight = (async () => {
    try {
      const { data, error } = await supabase!
        .from('financeiro_config')
        .select('juros_dia_pct, multa_pct, carencia_dias, ativo')
        .eq('id', 1)
        .single();
      cachedConfig = error || !data ? null : (data as JurosConfig);
      return cachedConfig;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function invalidateJurosCache() { cachedConfig = undefined; }

export const formatBRL = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
