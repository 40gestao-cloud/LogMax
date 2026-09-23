import type React from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { FormField } from '../ui';
import { formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../../lib/viewUtils';
import { EMBALAGENS_COMPRA, UNIDADES_FRACIONARIAS, normalizarUnidade, rotuloUnidade, unidadesDeProduto } from '../../lib/unidades';
import { ehVendavel, temEstoque } from '../../lib/tipoProduto';
import { type ExtrasProduto } from './produtoFormComum';

// Estoque: unidade, saldo (abertura ou correção do professor), mínimo, embalagem de compra e benefícios.
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoEstoque({
  aplicarCorrecaoSaldo, corrigindoSaldo, editItem, ehProfessor, extras, extrasErrors, filial, fracionario, mostraPesoConteudo, mostraSaldoAbertura, motivoSaldo, origemSemOpcoes, saldoAtual, saldoCorrigido, salvandoSaldo, setCorrigindoSaldo, setExtras, setExtrasErrors, setMotivoSaldo, setSaldoCorrigido, unidadeTravada,
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
  origemSemOpcoes: boolean;
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
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Estoque</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            {unidadeTravada && (
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                Travada porque há <span className="font-bold text-gray-400">{qtdBR(saldoAtual)} {normalizarUnidade(extras.unidade)}</span> em
                estoque: trocar a medida faria esse número virar outra coisa sem entrada nem saída que
                explicasse. Para mudar, zere o saldo por um ajuste em{' '}
                <span className="text-gray-400">Estoque &gt; Movimentações</span>, troque aqui, e reentre o saldo na medida nova.
              </p>
            )}
            {!unidadeTravada && ['PCT', 'CX', 'PC'].includes(normalizarUnidade(extras.unidade)) && (
              <p className="text-[10px] text-amber-500/90 mt-1 leading-snug flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  O estoque vai contar <span className="font-bold">{normalizarUnidade(extras.unidade)}</span>, e é
                  isso que o caixa vende ao cliente — a embalagem fechada. Se a loja vende avulso, a
                  Unidade é <span className="font-bold">UN</span>, e o pacote do fornecedor vai em{' '}
                  <span className="font-bold">Compra em</span>, aqui do lado.
                </span>
              </p>
            )}
          </FormField>
          {/* Embalagem de COMPRA (migr. 589) — a terceira medida do
              produto, e a que faltava: "arroz 1 kg, 30 no fardo".

              Não é a unidade de estoque (esta aqui do lado) nem o
              conteúdo da embalagem de venda (o Peso / Volume lá em
              cima). É como o FORNECEDOR vende. Sem ela, quem comprava
              por fardo punha o estoque em PCT — e aí o PDV passava a
              vender fardo ao cliente e o custo unitário ficava 30×
              maior. */}
          <FormField label="Compra em (embalagem do fornecedor)" error={extrasErrors.embalagem_qtd}>
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
            <p className="text-[10px] text-gray-500 mt-1 leading-snug">
              {extras.embalagem_compra && parseQtd(extras.embalagem_qtd) > 1 ? (
                <>
                  A requisição vai poder pedir <span className="font-bold text-gray-400">em {extras.embalagem_compra.toLowerCase()}</span>:
                  20 = <span className="text-accent font-bold">{qtdBR(20 * parseQtd(extras.embalagem_qtd))} {extras.unidade || 'UN'}</span> no estoque.
                </>
              ) : (
                <>Como o fornecedor vende — <span className="text-gray-400">fardo com 30</span>. O estoque continua contando em {extras.unidade || 'UN'}.</>
              )}
            </p>
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
              <div className="md:col-span-2 lg:col-span-3 neu-pressed rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                  Como este produto fica
                </p>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {temEmb && (
                    <>1 <span className="font-bold text-accent">{extras.embalagem_compra}</span> ={' '}
                    <span className="font-bold">{qtdBR(fator)} {un}</span> — é assim que o fornecedor entrega.<br /></>
                  )}
                  {temConteudo && (
                    <>1 <span className="font-bold text-accent">{un}</span> ={' '}
                    <span className="font-bold">{qtdBR(conte)} {extras.peso_unidade}</span> — é o que vem dentro
                    de cada uma.<br /></>
                  )}
                  {temEmb && temConteudo && extras.peso_unidade === 'UN' && (
                    <>Logo, 1 {extras.embalagem_compra} traz{' '}
                    <span className="font-bold text-accent">{qtdBR(fator * conte)} UN</span> no total.<br /></>
                  )}
                  <span className="text-gray-500">
                    O estoque conta em <span className="font-bold text-gray-400">{un}</span>, e é em {un} que
                    o caixa vende.{temEmb && (
                      <> O {extras.embalagem_compra.toLowerCase()} <span className="font-bold text-gray-400">não entra no
                      saldo</span>: ele é convertido no recebimento, e daí em diante o estoque fala em {un}.</>
                    )}
                  </span>
                </p>
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
            ) : (
              // Implantação não é compra: entra mercadoria e não sai
              // dinheiro. Dizer isso aqui é o que impede o campo de
              // virar atalho para "comprar" sem fornecedor nem conta.
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                O que já está na prateleira hoje. Gera uma Entrada de implantação —
                <span className="text-gray-400"> não cria conta a pagar</span>. Compra de verdade
                entra por <span className="font-bold text-gray-400">Compras → Recebimentos</span>.
              </p>
            )}
          </FormField>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                Saldo inicial
              </span>
              {/* Dizia só por que o campo NÃO está aqui, e o professor
                  leu as duas telas como um círculo: "para confirmar o
                  recebimento preciso do produto, e o saldo do produto
                  depende do recebimento". Não é círculo, é fila — mas
                  quem lê precisa ver a fila inteira, com o passo em que
                  está. Salvar com zero é o certo, e é isso que faltava
                  estar escrito.
                  `origemSemOpcoes` muda o texto: aqui não há "salve
                  assim mesmo" — o botão está desabilitado e o painel
                  âmbar acima já apontou o caminho (abrir a requisição).
                  Repetir "salve assim mesmo" contradiria os dois. */}
              <div className="neu-pressed py-2.5 px-3 rounded-xl text-[11px] text-gray-400 border border-white/5 leading-snug flex flex-col gap-1.5">
                {origemSemOpcoes ? (
                  <span>
                    Sem uma origem escolhida, não há como salvar — o saldo deste produto
                    nasceria de lugar nenhum. Abra a requisição de compra eventual primeiro.
                  </span>
                ) : (
                <span>
                  <span className="font-bold text-gray-300">Salve assim mesmo.</span> Este produto
                  nasce com saldo <span className="font-bold text-gray-300">zero</span> — e é o certo:
                  digitar aqui contaria a mesma mercadoria duas vezes.
                </span>
                )}
                <span className="text-gray-500">
                  A ordem é: <span className="text-gray-400">a carga chega</span> →
                  <span className="text-gray-400"> registra o recebimento</span> →
                  <span className="text-accent font-bold"> cadastra o produto (você está aqui)</span> →
                  <span className="text-gray-400"> volta em Estoque &gt; Recebimentos e clica Confirmar</span>.
                  É o Confirmar que dá entrada na quantidade, com documento e custo.
                </span>
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

        {/* MaxBank Benefícios só faz sentido no SuperMax (só supermercado
            tem itens elegíveis a vale-alimentação). Fora dele, escondido. */}
        {ehVendavel(extras.tipo) && filial === 'SuperMax' && (
          <label className="flex items-center gap-3 cursor-pointer neu-flat rounded-xl px-4 py-3 border border-white/5 mt-4">
            <input type="checkbox" checked={extras.elegivel_beneficios}
              onChange={e => setExtras(x => ({ ...x, elegivel_beneficios: e.target.checked }))}
              className="accent-accent w-4 h-4" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-gray-200">Aceita MaxBank Benefícios</span>
              <span className="text-[10px] text-gray-500">Colaborador pode pagar este item com saldo de benefícios no PDV.</span>
            </div>
          </label>
        )}
      </div>
      )}
    </>
  );
}
