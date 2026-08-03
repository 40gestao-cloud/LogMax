// Aviso da simulação de perda de dados (migr. 339).
//
// Sem este aviso a função não ensina nada: o aluno abre a tela vazia, conclui
// que o sistema quebrou e vai reclamar — e a aula vira suporte técnico. É a
// moldura que transforma tela vazia em pergunta.
//
// A direção vê outra faixa, discreta: ela continua enxergando tudo, e precisa
// lembrar disso ao olhar a tela de um aluno.

import { AlertTriangle, Eye } from 'lucide-react';

const PADRAO =
  'Os lançamentos não estão acessíveis. Nada foi apagado — mas, neste momento, você não consegue provar isso pelo sistema.';

export const BlackoutBanner = ({ ativo, mensagem, isento, por, desde }: {
  ativo: boolean;
  mensagem?: string | null;
  isento: boolean;
  por?: string | null;
  desde?: string | null;
}) => {
  if (!ativo) return null;

  if (isento) {
    return (
      <div className="shrink-0 mb-4 rounded-xl px-4 py-2 border border-accent/30 bg-accent/[0.06] flex items-center gap-2">
        <Eye size={13} className="text-accent shrink-0" />
        <p className="text-[11px] text-gray-300">
          <strong className="text-accent">Simulação de perda de dados ativa.</strong>{' '}
          A turma está com as telas vazias; você continua vendo tudo.
          {por && <span className="text-gray-500"> Ligada por {por}.</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 mb-4 rounded-2xl p-4 border border-red-500/30 bg-red-500/[0.06]">
      <p className="text-xs font-black uppercase tracking-widest text-red-400 flex items-center gap-2 mb-1.5">
        <AlertTriangle size={14} />Dados indisponíveis — simulação em aula
      </p>
      <p className="text-xs text-gray-300 leading-relaxed">
        {mensagem?.trim() || PADRAO}
      </p>
      {/* A pergunta é a aula. A tela vazia sozinha só produz frustração. */}
      <p className="text-[11px] text-gray-400 leading-relaxed mt-2">
        Enquanto durar: o que você conseguiria responder sobre a sua unidade sem abrir o sistema?
        Quanto se deve a cada fornecedor, o que está para chegar, quanto entrou hoje no caixa.
        Anote o que lembrar — quando os dados voltarem, compare.
      </p>
      <p className="text-[10px] text-gray-600 mt-2">
        Exercício conduzido pela direção{por ? ` (${por})` : ''}
        {desde ? ` desde ${new Date(desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' })}` : ''}.
        Nenhum registro foi apagado.
      </p>
    </div>
  );
};
