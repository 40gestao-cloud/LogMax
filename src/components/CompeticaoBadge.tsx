import React, { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Chip informativo mostrado no topo das views Matriz (RH/Financeiro/
// Logística/Marketing/Operações). Não altera filtros das views — só
// lembra o admin/CEO que existe uma competição rolando.

type CompActiva = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: 'em_andamento'|'aguardando_encerramento'|'encerrada';
};

const diasEntre = (a: string, b: string) => {
  const d1 = new Date(a + 'T00:00:00'); const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
};

const isoToday = () => new Date().toISOString().slice(0, 10);

export function CompeticaoBadge() {
  const [comp, setComp] = useState<CompActiva | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('competicoes_matriz')
        .select('id, nome, data_inicio, data_fim, status')
        .eq('ativo', true)
        .in('status', ['em_andamento','aguardando_encerramento'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) setComp(data[0] as CompActiva);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!comp) return null;

  const diasRest = diasEntre(isoToday(), comp.data_fim);
  const emAndamento = comp.status === 'em_andamento';
  const label = emAndamento
    ? (diasRest > 0 ? `${diasRest} dia${diasRest === 1 ? '' : 's'} restantes`
        : diasRest === 0 ? 'último dia' : 'período expirado')
    : 'aguardando encerramento';

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] uppercase tracking-widest font-bold ${
      emAndamento
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
    }`}>
      <Trophy size={11} />
      <span className="truncate">{comp.nome}</span>
      <span className="opacity-70">·</span>
      <span>{label}</span>
    </div>
  );
}
