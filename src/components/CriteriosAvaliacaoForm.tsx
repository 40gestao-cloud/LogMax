import React from 'react';
import { CRITERIOS, CategoriaCriterio, NOTAS, NOTA_DEFAULT, CATEGORIA_LABEL } from '../lib/avaliacaoCriterios';

// Grade de notas por critério (0-10), usada tanto no módulo Avaliações
// (ciclo) quanto na avaliação pontual de participantes de treinamento
// (TI & Desenvolvimento com IA). Compartilhado para os dois fluxos não
// divergirem visualmente.
export function CriteriosAvaliacaoForm({
  notas, setNotas,
}: {
  notas: Record<string, number>;
  setNotas: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  return (
    <>
      {(Object.keys(CRITERIOS) as CategoriaCriterio[]).map(cat => (
        <div key={cat}>
          <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">
            {CATEGORIA_LABEL[cat]}
          </h4>
          <div className="flex flex-col gap-3">
            {CRITERIOS[cat].map(c => {
              const key = `${cat}::${c}`;
              const nota = notas[key];
              return (
                <div key={key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-sm text-gray-300 flex-1">{c}</span>
                  <div className="flex flex-wrap gap-1">
                    {NOTAS.map(n => (
                      <button
                        key={n}
                        onClick={() => setNotas(prev => ({ ...prev, [key]: n }))}
                        className="w-8 h-8 rounded-lg font-bold text-xs transition-all"
                        style={
                          n === nota
                            ? { background: 'var(--color-accent)', color: 'var(--color-accent-text)' }
                            : { background: 'var(--color-bg-base)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.05)' }
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function notasIniciais(): Record<string, number> {
  const init: Record<string, number> = {};
  (Object.keys(CRITERIOS) as CategoriaCriterio[]).forEach(cat => {
    CRITERIOS[cat].forEach(c => { init[`${cat}::${c}`] = NOTA_DEFAULT; });
  });
  return init;
}
