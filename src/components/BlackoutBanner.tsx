// Aviso da simulação de perda de dados (migr. 339).
//
// A mensagem do aluno é escrita para assustar, e isso é deliberado: o objetivo
// da aula é ele sentir a perda, não ser tranquilizado. Uma versão anterior
// dizia "nada foi apagado" e entregava o final no primeiro parágrafo — a turma
// lia, dava de ombros e o exercício não acontecia.
//
// Por isso, aqui não há nota de rodapé dizendo que é exercício, nem pergunta
// reflexiva: sistema que caiu de verdade não faz pergunta didática. A condução
// é do professor, na voz dele, na hora que ele escolher.
//
// A direção vê outra faixa, e ela mostra exatamente o texto que a turma está
// lendo — quem conduz precisa saber o que foi dito em seu nome.

import { AlertTriangle, Eye } from 'lucide-react';

const PADRAO =
  'Falha no servidor de dados. Os lançamentos não foram recuperados: pedidos, vendas, contas, estoque e histórico não estão disponíveis. Não é possível registrar novas operações.';

export const BlackoutBanner = ({ ativo, mensagem, isento, por, desde }: {
  ativo: boolean;
  mensagem?: string | null;
  isento: boolean;
  por?: string | null;
  desde?: string | null;
}) => {
  if (!ativo) return null;

  const texto = mensagem?.trim() || PADRAO;

  if (isento) {
    return (
      <div className="shrink-0 mb-4 rounded-xl px-4 py-2.5 border border-accent/30 bg-accent/[0.06]">
        <p className="text-[11px] text-gray-300 flex items-center gap-2">
          <Eye size={13} className="text-accent shrink-0" />
          <span>
            <strong className="text-accent">Simulação de perda de dados ativa.</strong>{' '}
            A turma está com as telas vazias; você continua vendo tudo.
            {por && <span className="text-gray-500"> Ligada por {por}.</span>}
          </span>
        </p>
        <p className="text-[10px] text-gray-500 mt-1 pl-[21px] italic">
          Eles estão lendo: “{texto}”
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 mb-4 rounded-2xl p-4 border border-red-500/40 bg-red-500/[0.08]">
      <p className="text-xs font-black uppercase tracking-widest text-red-400 flex items-center gap-2 mb-1.5">
        <AlertTriangle size={14} />Atenção — falha no sistema
      </p>
      <p className="text-sm text-gray-200 leading-relaxed">
        {texto}
      </p>
    </div>
  );
};
