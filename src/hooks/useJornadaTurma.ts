import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PONTO_HORARIOS } from '../lib/pontoHorarios';

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
  /** true = confirmado no banco; false = caiu no env deste site. */
  configurado: boolean;
};

const DO_ENV: JornadaTurma = {
  entrada: PONTO_HORARIOS.entrada,
  retorno: PONTO_HORARIOS.retorno,
  saida:   PONTO_HORARIOS.saida,
  tolerancia_min: 1,
  configurado: false,
};

export function useJornadaTurma(): JornadaTurma {
  const [jornada, setJornada] = useState<JornadaTurma>(DO_ENV);

  useEffect(() => {
    let cancelou = false;
    (async () => {
      if (!supabase) return;
      const { data } = await supabase
        .from('ponto_jornada')
        .select('entrada,retorno,saida,tolerancia_min,configurado')
        .maybeSingle();
      if (cancelou || !data?.configurado) return;
      setJornada(data as JornadaTurma);
    })();
    return () => { cancelou = true; };
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
