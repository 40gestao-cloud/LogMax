import React from 'react';
import { CRITERIOS, CATEGORIA_LABEL, NOTAS, NOTA_DEFAULT, type CriteriosSet } from '../lib/avaliacaoCriterios';

export function CriteriosAvaliacaoForm({
  notas, setNotas, criteriosSet, categoriaLabel,
}: {
  notas: Record<string, number>;
  setNotas: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  criteriosSet?: CriteriosSet;
  categoriaLabel?: Record<string, string>;
}) {
  const cs = criteriosSet ?? CRITERIOS;
  const cl = categoriaLabel ?? CATEGORIA_LABEL;
  return (
    <>
      {(Object.keys(cs)).map(cat => (
        <div key={cat}>
          <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">
            {cl[cat] ?? cat}
          </h4>
          <div className="flex flex-col gap-3">
            {cs[cat].map(c => {
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

export function notasIniciais(criteriosSet?: CriteriosSet): Record<string, number> {
  const cs = criteriosSet ?? CRITERIOS;
  const init: Record<string, number> = {};
  Object.keys(cs).forEach(cat => {
    cs[cat].forEach(c => { init[`${cat}::${c}`] = NOTA_DEFAULT; });
  });
  return init;
}
