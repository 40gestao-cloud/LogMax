import React from 'react';
import { Users, X } from 'lucide-react';

// Filtro por quem abriu o documento (2026-09-01).
//
// A tela de Aprovações mistura, em cada aba, tudo o que a unidade pediu. O
// gerente que quer conferir o que UMA pessoa mandou — e quantas vezes — tinha
// de ler a fila inteira card a card. Aqui ele escolhe o nome e a fila encolhe.
//
// A contagem ao lado do nome sai da lista que a tela passa em `nomes`, e cada
// tela escolhe o recorte que responde à pergunta de quem está ali: em
// Aprovações é a aba ATIVA ("quantas ele tem esperando aqui?"); em Requisições
// é a fila inteira da unidade ("quantas ele já pediu").
//
// Régua da casa: catálogo fechado em `<select>`, nunca campo livre — nome
// digitado à mão não casa com o que está gravado (vide
// feedback_input_livre_evitar).

export const SEM_SOLICITANTE = '—';

/** Chave de comparação: o nome cru, aparado; vazio vira o rótulo de "sem nome". */
export const chaveSolicitante = (nome: unknown): string =>
  String(nome ?? '').replace(/\s+/g, ' ').trim() || SEM_SOLICITANTE;

export const FiltroSolicitante = ({ nomes, valor, onChange }: {
  /** Um item por documento da aba ativa (nomes repetem — é isso que vira contagem). */
  nomes: unknown[];
  valor: string | null;
  onChange: (v: string | null) => void;
}) => {
  const contagem = new Map<string, number>();
  for (const n of nomes) {
    const k = chaveSolicitante(n);
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  // O nome escolhido some da lista quando a aba não tem nada dele. Some da
  // lista, mas continua valendo — então entra com zero, e o vazio da tela fica
  // explicado em vez de parecer defeito.
  if (valor !== null && !contagem.has(valor)) contagem.set(valor, 0);

  const opcoes = [...contagem.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
  const total = nomes.length;

  if (opcoes.length === 0 && valor === null) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap shrink-0">
      <Users size={14} className="text-gray-500 shrink-0" />
      <select
        className="neu-input py-2 px-3 rounded-xl text-sm max-w-full"
        value={valor ?? ''}
        onChange={e => onChange(e.target.value || null)}
      >
        <option value="">Todos os solicitantes ({total})</option>
        {opcoes.map(([nome, n]) => (
          <option key={nome} value={nome}>{nome} ({n})</option>
        ))}
      </select>
      {valor !== null && (
        <button onClick={() => onChange(null)} title="Limpar filtro"
          className="neu-button rounded-xl p-2 text-gray-400 hover:text-gray-200">
          <X size={14} />
        </button>
      )}
    </div>
  );
};
