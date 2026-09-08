// Campo de quantidade que sabe contar em embalagem fechada (migr. 589).
//
// A mesma pergunta aparece em três telas do ciclo de compra — "quantos?" — e em
// cada uma o aluno pode responder em unidade de estoque ou em fardo:
//
//   Requisições (reposição)  quantos fardos repor        → linha do catálogo
//   Estoque > Recebimentos   quantos fardos chegaram     → este componente
//   Compras > Sugestões      quantos fardos comprar      → este componente
//
// A conversão em si mora em `src/lib/unidades.ts`, que é a régua única. O que
// está aqui é só a forma de perguntar: uma chave UN|FARDO e a conta à vista
// embaixo, porque é ela que o aluno precisa aprender a fazer — ver "= 600 UN"
// antes de enviar é o que evita pedir 20 quando se queria 20 fardos.
//
// O valor que sai daqui (`onChange`) é SEMPRE o que foi digitado, na medida
// escolhida. Converter é responsabilidade de quem grava — e as três telas
// gravam na unidade de estoque, que é a língua que o resto do sistema fala.
import { FormField } from './ui';
import { formatQtd, handleQtdKeyDown, qtdBR, parseQtd } from '../lib/viewUtils';
import {
  normalizarUnidade, pluralEmbalagem, UNIDADES_FRACIONARIAS,
  type EmbalagemCompra,
} from '../lib/unidades';

export const QuantidadeEmbalagem = ({
  label, unidade, embalagem, emEmbalagem, onModo, value, onChange, error, ajuda,
}: {
  label: string;
  unidade: string | null | undefined;
  /** null = o produto só se compra avulso; a chave nem aparece. */
  embalagem: EmbalagemCompra | null;
  emEmbalagem: boolean;
  onModo: (emEmbalagem: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  ajuda?: string;
}) => {
  const un = normalizarUnidade(unidade);
  const ativo = !!embalagem && emEmbalagem;
  // Embalagem fechada não se parte: o fornecedor não abre o fardo, e a RPC da
  // requisição recusa 2,5 pela mesma razão. Fora dela, quem manda é a unidade.
  const frac = ativo ? false : UNIDADES_FRACIONARIAS.has(un);
  const digitado = parseQtd(value);
  const emEstoque = ativo ? digitado * embalagem!.fator : digitado;

  return (
    <FormField
      label={`${label}${ativo ? ` (${pluralEmbalagem(embalagem!.nome, 2)})` : un ? ` (${un})` : ''}`}
      error={error}
    >
      <div className="flex items-center gap-2">
        <input
          type="text" inputMode="decimal"
          className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums flex-1 min-w-0 ${error ? 'border border-red-500/40' : ''}`}
          value={value}
          onChange={e => onChange(formatQtd(e.target.value, frac))}
          onKeyDown={handleQtdKeyDown(frac)}
          placeholder="0"
        />
        {embalagem && (
          <div className="neu-pressed rounded-lg p-0.5 flex text-[9px] font-bold uppercase tracking-wider shrink-0">
            {[{ modo: false, txt: un }, { modo: true, txt: embalagem.nome }].map(op => (
              <button key={String(op.modo)} type="button"
                onClick={() => {
                  onModo(op.modo);
                  // Trocar de medida remascara o que já estava digitado: "2,5"
                  // em KG não sobrevive à virada para fardo.
                  onChange(formatQtd(value, op.modo ? false : UNIDADES_FRACIONARIAS.has(un)));
                }}
                title={op.modo
                  ? `Contar em ${embalagem.nome.toLowerCase()} — ${qtdBR(embalagem.fator)} ${un} em cada`
                  : `Contar na unidade de estoque (${un})`}
                className={`px-2 py-1 rounded transition-colors ${
                  op.modo === ativo ? 'bg-accent text-black' : 'text-gray-500 hover:text-gray-300'
                }`}>
                {op.txt}
              </button>
            ))}
          </div>
        )}
      </div>
      {ativo && digitado > 0 && (
        <p className="text-[10px] text-accent/90 mt-1 tabular-nums">
          {qtdBR(digitado)} {pluralEmbalagem(embalagem!.nome, digitado)} × {qtdBR(embalagem!.fator)} ={' '}
          <span className="font-bold">{qtdBR(emEstoque)} {un}</span>
        </p>
      )}
      {ajuda && <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">{ajuda}</p>}
    </FormField>
  );
};

/** A quantidade na unidade de estoque — o que as telas gravam. */
export const qtdEmEstoque = (
  value: string, embalagem: EmbalagemCompra | null, emEmbalagem: boolean,
): number => {
  const n = parseQtd(value);
  return embalagem && emEmbalagem ? n * embalagem.fator : n;
};
