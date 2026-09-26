import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PONTO_HORARIOS, CHAVE_SAIDA_TURMA } from '../lib/pontoHorarios';

// Horário-alvo da turma. Desde a migr. 350 ele mora em `ponto_jornada` (uma
// linha por projeto) porque o placar da competição precisa de um alvo que não
// dependa de quem abriu a tela — env do cliente valia coisas diferentes em
// máquinas diferentes.
//
// O env (VITE_PONTO_*) continua sendo o fallback: enquanto ninguém confirma o
// horário no banco, as telas seguem exibindo o que sempre exibiram. Quem lê
// isto vê `configurado` pra saber qual das duas fontes está valendo.
export type JornadaTurma = {
  entrada: string;
  retorno: string;
  saida: string;
  tolerancia_min: number;
  /** Dias com aula, 0=dom..6=sáb (migr. 376). Vazio = calendário desligado. */
  dias_semana: number[];
  /** true = confirmado no banco; false = caiu no env deste site. */
  configurado: boolean;
};

const DO_ENV: JornadaTurma = {
  entrada: PONTO_HORARIOS.entrada,
  retorno: PONTO_HORARIOS.retorno,
  saida:   PONTO_HORARIOS.saida,
  tolerancia_min: 1,
  dias_semana: [],
  configurado: false,
};

/** Disparado por quem grava a jornada, para as outras telas abertas relerem. */
export const EVENTO_JORNADA_ATUALIZADA = 'logmax:jornada-atualizada';

/**
 * Jornada diária da turma, em horas (saída − entrada).
 *
 * O expediente aqui é de ~4h, não 8 — é turma de docência. A folha derivava
 * tudo de 8h/220h até a migr. 290: falta acertava por acaso (dois erros que se
 * cancelavam), atraso descontava metade e hora extra nunca disparava.
 */
export function horasDaJornada(j: Pick<JornadaTurma, 'entrada' | 'saida'>): number {
  const min = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  return Math.max((min(j.saida) - min(j.entrada)) / 60, 0);
}

export function useJornadaTurma(): JornadaTurma {
  const [jornada, setJornada] = useState<JornadaTurma>(DO_ENV);

  useEffect(() => {
    let cancelou = false;
    const carregar = async () => {
      if (!supabase) return;
      const { data } = await supabase
        .from('ponto_jornada')
        .select('entrada,retorno,saida,tolerancia_min,dias_semana,configurado')
        .maybeSingle();
      if (cancelou || !data) return;
      const dias = ((data as any).dias_semana ?? []) as number[];
      if (!data.configurado) { setJornada({ ...DO_ENV, dias_semana: dias }); return; }
      setJornada({ ...(data as any), dias_semana: dias } as JornadaTurma);
      try { localStorage.setItem(CHAVE_SAIDA_TURMA, data.saida); } catch { /* sem storage */ }
    };
    carregar();
    window.addEventListener(EVENTO_JORNADA_ATUALIZADA, carregar);
    return () => { cancelou = true; window.removeEventListener(EVENTO_JORNADA_ATUALIZADA, carregar); };
  }, []);

  return jornada;
}

/**
 * Data do último APAGAR TUDO (migr. 505). Ponto anterior a ela é da turma
 * passada: a folha não conta e o lançamento manual não reescreve — o banco
 * recusa. A tela lê a mesma chave para não oferecer um botão que vai falhar.
 *
 * `null` = projeto que nunca resetou, ou leitura ainda em voo. Nos dois casos
 * o comportamento é o de sempre, que é o lado seguro de errar.
 */
export function usePontoCorteTurma(): string | null {
  const [corte, setCorte] = useState<string | null>(null);

  useEffect(() => {
    let cancelou = false;
    (async () => {
      if (!supabase) return;
      // `configuracoes` não tem `created_at`, então nada de useFetchData aqui:
      // o ORDER BY padrão dele devolveria 400 e a tela ficaria sem o corte.
      const { data } = await supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', 'ponto_corte_turma')
        .maybeSingle();
      if (cancelou) return;
      const v = (data?.valor ?? '').trim();
      setCorte(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    })();
    return () => { cancelou = true; };
  }, []);

  return corte;
}

/**
 * Dias com aula entre `inicio` e `fim` (YYYY-MM-DD), pela mesma função que o
 * placar usa (`dias_letivos_periodo`, migr. 376): dias da semana da turma,
 * menos feriado, mais reposição.
 *
 * `null` = a turma não definiu os dias de aula (ou a leitura está em voo) —
 * quem chama decide o que vale nesse caso.
 */
export function useDiasLetivos(inicio: string, fim: string, jornada: JornadaTurma): Set<string> | null {
  const [dias, setDias] = useState<Set<string> | null>(null);
  const temCalendario = jornada.dias_semana.length > 0;
  const chaveDias = jornada.dias_semana.join(',');

  useEffect(() => {
    let cancelou = false;
    if (!temCalendario || !supabase) { setDias(null); return; }
    const carregar = async () => {
      const { data, error } = await supabase!.rpc('dias_letivos_periodo', { p_inicio: inicio, p_fim: fim });
      if (cancelou || error) return;
      setDias(new Set(((data ?? []) as any[]).map(d => String(typeof d === 'object' ? Object.values(d)[0] : d))));
    };
    carregar();
    window.addEventListener(EVENTO_JORNADA_ATUALIZADA, carregar);
    return () => { cancelou = true; window.removeEventListener(EVENTO_JORNADA_ATUALIZADA, carregar); };
  }, [inicio, fim, temCalendario, chaveDias]);

  return dias;
}
