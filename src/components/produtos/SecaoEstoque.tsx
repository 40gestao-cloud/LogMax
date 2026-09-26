import type React from 'react';
import { Boxes, Pencil, Utensils } from 'lucide-react';
import { FormField, SecaoFormulario } from '../ui';
import { formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../../lib/viewUtils';
import { EMBALAGENS_COMPRA, UNIDADES_FRACIONARIAS, normalizarUnidade, rotuloUnidade, unidadesDeProduto } from '../../lib/unidades';
import { ehVendavel, temEstoque } from '../../lib/tipoProduto';
import { type ExtrasProduto } from './produtoFormComum';

// Estoque: unidade, saldo (abertura ou correção do professor), mínimo, embalagem de compra e benefícios.
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoEstoque({
  aplicarCorrecaoSaldo, corrigindoSaldo, editItem, ehProfessor, extras, extrasErrors, filial, fracionario, mostraPesoConteudo, mostraSaldoAbertura, motivoSaldo, origemEscolhida, saldoAtual, saldoCorrigido, salvandoSaldo, setCorrigindoSaldo, setExtras, setExtrasErrors, setMotivoSaldo, setSaldoCorrigido, unidadeTravada,
}: {
  aplicarCorrecaoSaldo: () => void | Promise<void>;
  corrigindoSaldo: boolean;
  editItem: any;
  ehProfessor: boolean;
  extras: ExtrasProduto;
  extrasErrors: Record<string, string>;
  filial: string;
  fracionario: boolean;
  mostraPesoConteudo: boolean;
  mostraSaldoAbertura: boolean;
  motivoSaldo: string;
  origemEscolhida: boolean;
  saldoAtual: number;
  saldoCorrigido: string;
  salvandoSaldo: boolean;
  setCorrigindoSaldo: React.Dispatch<React.SetStateAction<boolean>>;
  setExtras: React.Dispatch<React.SetStateAction<ExtrasProduto>>;
  setExtrasErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMotivoSaldo: React.Dispatch<React.SetStateAction<string>>;
  setSaldoCorrigido: React.Dispatch<React.SetStateAction<string>>;
  unidadeTravada: boolean;
}) {
  return (
    <>
      {/* Estoque. Patrimônio não tem saldo: um freezer não se repõe,
          não tem estoque mínimo e não gera movimentação. A seção inteira
          sai da tela em vez de pedir zeros (migr. 440). */}
      {temEstoque(extras.tipo) && (
      <>
      <SecaoFormulario titulo="Estoque" icon={Boxes} cor="azul">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField label="Unidade">
            <select className={`neu-input py-2 px-3 rounded-xl text-sm ${unidadeTravada ? 'opacity-60 cursor-not-allowed' : ''}`}
              disabled={unidadeTravada}
              title={unidadeTravada
                ? `Há ${qtdBR(saldoAtual)} ${normalizarUnidade(extras.unidade)} em estoque. A unidade dá sentido a esse número — zere o saldo antes de trocá-la.`
                : undefined}
              value={extras.unidade}
              onChange={e => setExtras(x => {
                const u = e.target.value;
                // Trocar a unidade muda o que os outros campos aceitam.
                // Sem remascarar, "12,5" digitado em KG sobrevive à troca
                // para UN e vira meia caixa no save.
                const frac = UNIDADES_FRACIONARIAS.has(normalizarUnidade(u));
                return {
                  ...x,
                  unidade:        u,
                  estoque:        formatQtd(x.estoque, frac),
                  estoque_minimo: formatQtd(x.estoque_minimo, frac),
                };
              })}>
              {/* Régua única (src/lib/unidades.ts): KG/L/M só em mercearia.
                  Esta era a última das cinco cópias da lista. */}
              {/* Sigla + nome: "PC" e "PCT" são peça e pacote, e a
                  diferença não se lê em duas letras. O valor gravado
                  continua sendo a sigla. */}
              {unidadesDeProduto(filial).map(u => <option key={u} value={u}>{rotuloUnidade(u)}</option>)}
            </select>
            {/* O ERRO QUE ESTA FRASE EVITA JÁ ESTÁ NO CATÁLOGO.
                "Açúcar Cristal 1 (kg) 30 UN" está cadastrado com
                unidade PCT: o aluno usou a unidade de ESTOQUE para
                dizer "fardo de 30", porque não havia onde dizer isso.
                Aí o estoque conta fardos, o PDV vende o fardo inteiro
                ao cliente e o "30" fica no nome, onde não soma. */}
            {/* MIGR 594: a trava é do banco; aqui ela aparece ANTES,
                com a saída. Deixar o seletor aberto para o save
                estourar seria ensinar pelo erro — e o erro chega
                depois de a pessoa ter preenchido a tela inteira. */}
          </FormField>
          {/* Embalagem de COMPRA (migr. 589) — a terceira medida do
              produto, e a que faltava: "arroz 1 kg, 30 no fardo".

              Não é a unidade de estoque (esta aqui do lado) nem o
              conteúdo da embalagem de venda (o Peso / Volume lá em
              cima). É como o FORNECEDOR vende. Sem ela, quem comprava
              por fardo punha o estoque em PCT — e aí o PDV passava a
              vender fardo ao cliente e o custo unitário ficava 30×
              maior. */}
          <FormField label="Embalagem de compra" error={extrasErrors.embalagem_qtd}>
            <div className={`neu-input flex items-center rounded-xl text-sm overflow-hidden ${extrasErrors.embalagem_qtd ? 'border border-red-500/40' : ''}`}>
              <select
                className="bg-transparent text-xs font-bold text-accent px-2 py-2 border-r border-white/5 outline-none shrink-0"
                value={extras.embalagem_compra}
                onChange={e => {
                  const v = e.target.value;
                  // Tirar a embalagem tira o fator junto: fator órfão é
                  // o que o CHECK do banco recusa, e guardá-lo na tela
                  // só faria o erro aparecer no save.
                  setExtras(x => ({ ...x, embalagem_compra: v, embalagem_qtd: v ? x.embalagem_qtd : '' }));
                  setExtrasErrors(ev => ({ ...ev, embalagem_qtd: '' }));
                }}
                title="Como o fornecedor vende este item — nada a ver com a unidade de estoque">
                <option value="">— Unidade solta —</option>
                {EMBALAGENS_COMPRA.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <input
                className="flex-1 bg-transparent py-2 px-3 outline-none tabular-nums disabled:opacity-40"
                value={extras.embalagem_qtd} inputMode="decimal"
                disabled={!extras.embalagem_compra}
                onChange={e => {
                  // Fracionário segue a unidade de estoque: saco de café
                  // com 60 KG é legítimo; fardo com 30,5 UN não.
                  setExtras(x => ({ ...x, embalagem_qtd: formatQtd(e.target.value, fracionario) }));
                  setExtrasErrors(ev => ({ ...ev, embalagem_qtd: '' }));
                }}
                onKeyDown={handleQtdKeyDown(fracionario)}
                placeholder={extras.embalagem_compra ? `Quantas ${extras.unidade || 'UN'}?` : '—'} />
            </div>
          </FormField>
          {/* AS TRÊS MEDIDAS NUMA FRASE SÓ.
              Separadas, cada campo está certo e o conjunto continua
              confuso — foi a pergunta que abriu esta correção: "e onde
              aparece quantas unidades vêm no pacote?". Aqui a cadeia
              inteira aparece com os números que a pessoa acabou de
              digitar, que é o único jeito de ela conferir se o que
              escreveu é o que quis dizer. */}
          {(() => {
            const un    = normalizarUnidade(extras.unidade);
            const fator = parseQtd(extras.embalagem_qtd);
            const temEmb = !!extras.embalagem_compra && fator > 1;
            const conte = parseQtd(extras.peso);
            const temConteudo = mostraPesoConteudo && conte > 0 && !!extras.peso_unidade;
            if (!temEmb && !temConteudo) return null;
            return (
              <div className="sm:col-span-2 lg:col-span-4 neu-pressed rounded-xl px-3 py-2 text-xs text-gray-300 flex flex-wrap gap-x-5 gap-y-1">
                {temEmb && (
                  <span>1 <span className="font-bold text-accent">{extras.embalagem_compra}</span> = <span className="font-bold">{qtdBR(fator)} {un}</span></span>
                )}
                {temConteudo && (
                  <span>1 <span className="font-bold text-accent">{un}</span> = <span className="font-bold">{qtdBR(conte)} {extras.peso_unidade}</span></span>
                )}
                {temEmb && temConteudo && extras.peso_unidade === 'UN' && (
                  <span>1 {extras.embalagem_compra} = <span className="font-bold text-accent">{qtdBR(fator * conte)} UN</span></span>
                )}
              </div>
            );
          })()}
          {/* Quantidade é `type=text inputMode=decimal`, não `type=number`
              (migr. 438): o teclado pt-BR digita vírgula e o número
              nativo descarta o valor inteiro quando ela chega. A máscara
              só aceita fração se a unidade for fracionária — meio pacote
              não existe, meio quilo existe. */}
          {/* Saldo de abertura só existe fora do fluxo de compra. Com o
              produto vindo de um pedido, o saldo entra pelo Recebimento
              — digitar aqui geraria uma Entrada de implantação que soma
              com a do recebimento, e o estoque vai ao dobro. É o mesmo
              erro que a migr. 438 removeu ao tirar "Quantidade Comprada"
              do cadastro, entrando por outra porta. */}
          {mostraSaldoAbertura ? (
          <FormField label={editItem ? `Estoque Atual (${extras.unidade})` : `Saldo de Abertura (${extras.unidade})`}>
            <input
              type="text" inputMode="decimal"
              className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${editItem ? 'opacity-60 cursor-not-allowed' : ''}`}
              value={extras.estoque}
              onChange={e => setExtras(x => ({ ...x, estoque: formatQtd(e.target.value, fracionario) }))}
              onKeyDown={handleQtdKeyDown(fracionario)}
              placeholder="0"
              disabled={!!editItem}
              readOnly={!!editItem}
              title={editItem ? 'Saldo só altera via Recebimentos / Movimentações de Estoque.' : 'Saldo de abertura — gera movimentação de Entrada.'}
            />
            {editItem ? (
              // A direção corrige o que o aluno errou — sem reescrever
              // `estoque` na mão. Ver `aplicarCorrecaoSaldo`: o número
              // digitado vira um Ajuste da diferença, então o saldo
              // chega onde o professor quer E a razão continua fechando.
              ehProfessor ? (
                <div className="mt-1 flex flex-col gap-2">
                  {!corrigindoSaldo ? (
                    <>
                      <p className="text-[10px] text-gray-500">Saldo controlado por Movimentações / Recebimentos.</p>
                      <button type="button"
                        onClick={() => {
                          setCorrigindoSaldo(true);
                          setSaldoCorrigido(formatQtd(String(editItem.estoque ?? 0), fracionario));
                          setMotivoSaldo('');
                        }}
                        className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-accent hover:bg-accent/10 transition-colors self-start flex items-center gap-1.5">
                        <Pencil size={11} /> Corrigir saldo
                      </button>
                    </>
                  ) : (
                    <div className="neu-pressed rounded-xl p-3 border border-accent/25 flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Saldo correto ({extras.unidade})
                      </span>
                      <input
                        type="text" inputMode="decimal"
                        className="neu-input py-2 px-3 rounded-xl text-sm tabular-nums w-full"
                        value={saldoCorrigido}
                        onChange={e => setSaldoCorrigido(formatQtd(e.target.value, fracionario))}
                        onKeyDown={handleQtdKeyDown(fracionario)}
                        placeholder="0" />
                      <input
                        className="neu-input py-2 px-3 rounded-xl text-xs w-full"
                        value={motivoSaldo}
                        onChange={e => setMotivoSaldo(e.target.value)}
                        placeholder="Motivo — ex.: aluno lançou saldo de implantação em duplicidade" />
                      <p className="text-[10px] text-gray-500 leading-snug">
                        Não reescreve o saldo: lança a <span className="text-gray-400 font-semibold">diferença</span> como
                        Ajuste em Estoque &gt; Movimentações, com este motivo. O estoque bate com a razão e a
                        correção fica no histórico, com autor e data.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <button type="button" disabled={salvandoSaldo}
                          onClick={() => { setCorrigindoSaldo(false); setSaldoCorrigido(''); setMotivoSaldo(''); }}
                          className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-gray-400 disabled:opacity-50">
                          Cancelar
                        </button>
                        <button type="button" onClick={aplicarCorrecaoSaldo} disabled={salvandoSaldo}
                          className="neu-button-accent py-1.5 px-3 rounded-lg text-[11px] font-bold disabled:opacity-50">
                          {salvandoSaldo ? 'Aplicando...' : 'Aplicar correção'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
              <p className="text-[10px] text-gray-500 mt-1">Saldo controlado por Movimentações / Recebimentos.</p>
              )
            ) : null}
          </FormField>
          ) : origemEscolhida && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                Saldo inicial
              </span>
              <div className="neu-pressed py-2.5 px-3 rounded-xl text-[11px] text-gray-400 border border-white/5 leading-snug">
                <span className="font-bold text-gray-300">Salve assim mesmo.</span> O produto nasce com
                saldo <span className="font-bold text-gray-300">zero</span> — a quantidade entra quando o
                recebimento for confirmado em <span className="text-gray-300">Estoque &gt; Recebimentos</span>.
              </div>
            </div>
          )}
          <FormField label={`Estoque Mínimo (${extras.unidade}) *`} error={extrasErrors.estoque_minimo}>
            <input type="text" inputMode="decimal"
              className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${extrasErrors.estoque_minimo ? 'border border-red-500/40' : ''}`}
              value={extras.estoque_minimo}
              onChange={e => { setExtras(x => ({ ...x, estoque_minimo: formatQtd(e.target.value, fracionario) })); setExtrasErrors(ev => ({ ...ev, estoque_minimo: '' })); }}
              onKeyDown={handleQtdKeyDown(fracionario)}
              placeholder="0" />
          </FormField>
        </div>
      </SecaoFormulario>

        {/* MaxBank Benefícios só faz sentido no SuperMax (só supermercado
            tem itens elegíveis a vale-alimentação). Fora dele, escondido. */}
        {ehVendavel(extras.tipo) && filial === 'SuperMax' && (
          <SecaoFormulario titulo="Vale Alimentação / Refeição" icon={Utensils} cor="amarelo">
            <label className="flex items-center gap-3 cursor-pointer neu-flat rounded-xl px-4 py-3 border border-white/5">
              <input type="checkbox" checked={extras.elegivel_beneficios}
                onChange={e => setExtras(x => ({ ...x, elegivel_beneficios: e.target.checked }))}
                className="accent-accent w-4 h-4" />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-gray-200">Aceita MaxBank Benefícios</span>
                <span className="text-[10px] text-gray-500">Colaborador pode pagar este item com saldo de vale alimentação/refeição no PDV.</span>
              </div>
            </label>
          </SecaoFormulario>
        )}
      </>
      )}
    </>
  );
}
