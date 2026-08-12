// O bloco de apoio da atividade, na tela.
//
// Mesma informação que o diagrama do professor mostra ao fim do trilho e que o
// PDF registra na última tabela: as telas que a aula abre sem serem etapas, e
// por que elas estão abertas. Vive num componente só porque aparece nos dois
// lados — na atividade que o aluno lê e na lista de publicadas do professor —
// e um texto que diverge entre as duas telas ensina duas aulas diferentes.
//
// Fora da numeração, de propósito: a lista de tarefas é a cadeia, e cadastrar
// não é a tarefa seguinte ao pagamento — é o cadastro de que a cadeia vive e
// para onde ela volta depois de fechada.

import React from 'react';
import { FolderPlus } from 'lucide-react';
import type { AtividadeApoio } from '../lib/aulaAtividade';

export const AtividadeApoioBloco: React.FC<{ apoio: AtividadeApoio }> = ({ apoio }) => (
  <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 p-3 flex gap-3">
    <div className="w-5 h-5 shrink-0 rounded-full border border-dashed border-white/25 flex items-center justify-center text-gray-500 mt-0.5">
      <FolderPlus size={10} />
    </div>
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-bold text-gray-300">
          Depois da última etapa — o cadastro que a cadeia usa
        </span>
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-600 border border-white/10 rounded-full px-1.5 py-0.5">
          Fora da numeração
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{apoio.nota}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {apoio.telas.map(t => (
          <span key={t} className="text-[10px] font-semibold rounded-lg px-2 py-0.5 border border-accent/40 text-accent/90">
            {t}
          </span>
        ))}
      </div>
    </div>
  </div>
);
