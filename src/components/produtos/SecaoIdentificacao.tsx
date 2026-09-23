import type React from 'react';
import { AlertTriangle, Lock, Pencil, Tag } from 'lucide-react';
import { FormField } from '../ui';
import { SelectBusca, type SelectBuscaGrupo } from '../SelectBusca';
import { formatQtd, handleQtdKeyDown } from '../../lib/viewUtils';
import { gerarEanInterno } from '../../lib/barcode';
import { UNIDADES_CONTEUDO, divergenciaDeConteudo, temConteudoDeEmbalagem, normalizarUnidade, type ExemploProduto } from '../../lib/unidades';
import { ATRIBUTOS_PRODUTO, rotuloAtributo } from '../../lib/atributosProduto';
import { ehVendavel, temEstoque } from '../../lib/tipoProduto';
import type { useReservaTrabalho } from '../../hooks/useReservaTrabalho';
import type { ItemAguardandoPedido, ItemComprado } from './produtoFormComum';
import { OUTRO, SEM_COMPRA, type FormProduto, type ExtrasProduto } from './produtoFormComum';

// Identificação: origem (compra/requisição), código, nome, EAN, categoria, marca, fornecedor, embalagem e a ficha do nicho.
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoIdentificacao({
  errors, clearError, categoriasProduto, subcategoriasProduto, atrLivre, categoriasDaFilial, codigoReservado, editItem, escolherOrigem, exProd, extras, extrasErrors, filial, form, fornecedoresOrdenados, gruposOrigem, itemCompradoSel, itensAguardandoPedido, itensComprados, liberarCodigo, marcaDaCompra, mostraPesoConteudo, nomeDestravado, origemExigida, origemOferecida, origemSemOpcoes, reservaOrigem, setAtrLivre, setCodigoReservado, setExtras, setExtrasErrors, setForm, setNomeDestravado, sugerindoCodigo, sugerirCodigo,
}: {
  errors: Partial<Record<keyof FormProduto, string>>;
  clearError: (key: keyof FormProduto) => void;
  categoriasProduto: any[];
  subcategoriasProduto: any[];
  atrLivre: Set<string>;
  categoriasDaFilial: any[];
  codigoReservado: string | null;
  editItem: any;
  escolherOrigem: (desc: string) => void;
  exProd: ExemploProduto;
  extras: ExtrasProduto;
  extrasErrors: Record<string, string>;
  filial: string;
  form: FormProduto;
  fornecedoresOrdenados: any[];
  gruposOrigem: SelectBuscaGrupo[];
  itemCompradoSel: string;
  itensAguardandoPedido: ItemAguardandoPedido[];
  itensComprados: ItemComprado[];
  liberarCodigo: (codigo: string | null) => void;
  marcaDaCompra: string;
  mostraPesoConteudo: boolean;
  nomeDestravado: boolean;
  origemExigida: boolean;
  origemOferecida: boolean;
  origemSemOpcoes: boolean;
  reservaOrigem: ReturnType<typeof useReservaTrabalho>;
  setAtrLivre: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCodigoReservado: React.Dispatch<React.SetStateAction<string | null>>;
  setExtras: React.Dispatch<React.SetStateAction<ExtrasProduto>>;
  setExtrasErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setForm: React.Dispatch<React.SetStateAction<FormProduto>>;
  setNomeDestravado: React.Dispatch<React.SetStateAction<boolean>>;
  sugerindoCodigo: boolean;
  sugerirCodigo: () => void | Promise<void>;
}) {
  return (
    <>
      {/* Identificação */}
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Identificação</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormField label="Código *" error={errors.codigo}>
            <div className="flex gap-2">
              <input className={`neu-input py-2 px-3 rounded-xl text-sm flex-1 min-w-0 font-credencial ${errors.codigo ? 'border border-red-500/40' : ''}`}
                value={form.codigo} onChange={e => {
                  // Digitou por cima do número gerado: a reserva não é
                  // mais dele, volta para a fila na hora.
                  if (codigoReservado && e.target.value !== codigoReservado) {
                    liberarCodigo(codigoReservado);
                    setCodigoReservado(null);
                  }
                  setForm(f => ({ ...f, codigo: e.target.value }));
                  clearError('codigo');
                }}
                placeholder="Ex: 001" />
              {/* Código à mão foi como "ML-004" e "ML-31" passaram a
                  conviver na mesma coluna — o problema que a migr. 265
                  teve de contornar com `codigo_seq`. Sugerir o próximo
                  é mais barato que ordenar o que já saiu torto. */}
              <button type="button" onClick={sugerirCodigo} disabled={sugerindoCodigo}
                title={`Reservar o próximo código da ${filial}`}
                className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0 disabled:opacity-50">
                {sugerindoCodigo ? '…' : 'Gerar'}
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {codigoReservado === form.codigo && codigoReservado
                ? <>O <span className="font-credencial text-accent">{codigoReservado}</span> está reservado para você — quem clicar em Gerar agora recebe o próximo. A reserva cai se você fechar o formulário sem salvar.</>
                : <>Código único dentro da <span className="font-mono text-accent">{filial}</span>. Filiais diferentes podem usar o mesmo código.</>}
            </p>
          </FormField>
          {/* A ordem canônica virou a da migr. 480: o produto é
              cadastrado ANTES da compra, porque é o código dele que
              entra no pedido. Cadastro antecipado é a REGRA, e a tela
              chamava isso de exceção.

              O campo sobrevive à inversão porque continua respondendo a
              outra pergunta: existe carga na doca esperando o Confirmar
              cujo item não está no catálogo? Se existe, cadastrar do
              zero cria o segundo cadastro do mesmo produto — e escolher
              da lista traz nome, fornecedor e custo já fechados no
              pedido, em vez de grafia nova e custo chutado.

              A lista se esvazia sozinha: pedido novo já nasce amarrado
              ao catálogo (`produto_id`) e nem aparece aqui. O que resta
              é o passivo de antes da 480. (Era um <datalist> no campo de
              nome, que não reabria depois de escolher — datalist filtra
              as opções pelo texto digitado.) */}
          {origemExigida && origemSemOpcoes && (
            // O beco que a régua acima fecharia sem avisar: nada para
            // escolher, e "cadastro por conta própria" não é mais saída
            // fora da implantação. A tela aponta o caminho em vez de
            // oferecer um select vazio, e o Salvar fica desabilitado.
            <FormField label="Origem deste cadastro *">
              <div className="neu-pressed rounded-xl p-3 border border-amber-400/20 text-[11px] text-amber-300/90 leading-snug">
                Nenhuma requisição de compra eventual está esperando este cadastro, e a unidade já
                tem recebimento confirmado — isto não é implantação. Mercadoria nova entra pelo
                pedido: abra uma requisição em{' '}
                <span className="font-bold">Requisições &gt; Do Setor &gt; Compra eventual</span>,
                espere a cotação ser aprovada, e volte aqui — o item aparece nesta lista.
              </div>
            </FormField>
          )}
          {!editItem && !temEstoque(extras.tipo) && itensAguardandoPedido.length > 0 && (
            <FormField label="Origem deste cadastro">
              <div className="neu-pressed rounded-xl p-3 border border-white/5 text-[11px] text-gray-400 leading-snug">
                Bem de uso não entra pelo fluxo de compra: ele não tem saldo, e o Confirmar do
                recebimento daria entrada de mercadoria num item que nunca vai ter saldo. A
                aquisição se registra em <span className="font-bold">Financeiro &gt; Contas a Pagar</span>,
                marcando a conta como imobilizado — o bem aparece em Financeiro &gt; Patrimônio, com
                vida útil e depreciação. Se isto aqui é mercadoria ou material de consumo, corrija o
                Tipo acima e a lista de requisições volta.
              </div>
            </FormField>
          )}
          {origemOferecida && !origemSemOpcoes && gruposOrigem.length > 0 && (
            <FormField label={origemExigida ? 'Origem deste cadastro *' : 'Origem deste cadastro'}
              error={extrasErrors.origem_compra}>
              <SelectBusca
                value={itemCompradoSel}
                onChange={escolherOrigem}
                grupos={gruposOrigem}
                placeholder="Buscar requisição ou item já chegado..."
                vazioTexto="Nada encontrado com esse texto."
                error={extrasErrors.origem_compra}
              />
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                O normal é <span className="text-gray-400">cadastrar antes de comprar</span> — é o código
                daqui que entra no pedido.
                {itensAguardandoPedido.length > 0 && (
                  <> As requisições paradas esperam exatamente isto: escolher uma amarra este
                  cadastro a ela, e o <span className="text-gray-400">Gerar Pedido</span> em Compras &gt; Cotações
                  passa direto, sem perguntar o item do catálogo.</>
                )}
                {itensComprados.length > 0 && (
                  <> A lista &quot;já chegou&quot; são item(ns) que entraram no Recebimento antes de ter
                  cadastro: escolher um traz nome, fornecedor e custo do pedido, em vez de criar um
                  segundo cadastro do mesmo produto.</>
                )}
                {!origemExigida && (
                  <span className="block mt-1">
                    Aqui é <span className="text-gray-400">opcional</span>: item de uso e consumo e bem
                    também entram por implantação, montagem da unidade ou doação. Deixe em branco se
                    este cadastro não está atendendo nenhuma requisição.
                  </span>
                )}
              </p>
              {reservaOrigem.travado && (
                <p className="text-[11px] text-yellow-400 mt-1">
                  🔒 {reservaOrigem.dono?.usuario_nome} já está cadastrando este item agora. Escolha
                  outra origem ou espere.
                </p>
              )}
            </FormField>
          )}
          <FormField label="Nome do produto *" error={errors.nome}>
            {/* Travado quando a origem preencheu, até "Refinar nome"
                destravar. O texto da requisição é a necessidade escrita
                em português; o nome do catálogo é a identificação do
                item — são coisas diferentes, e é o segundo que sai na
                etiqueta e no PDV. */}
            {itemCompradoSel && itemCompradoSel !== SEM_COMPRA && !nomeDestravado ? (
              <div className="flex flex-col gap-1.5">
                <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-200 flex items-center gap-2">
                  <Lock size={13} className="text-gray-500 shrink-0" />
                  <span className="truncate">{form.nome || '—'}</span>
                  <button type="button" onClick={() => setNomeDestravado(true)}
                    className="ml-auto shrink-0 flex items-center gap-1 text-[10px] font-bold text-accent hover:opacity-80">
                    <Pencil size={11} /> Refinar nome
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 leading-snug">
                  Veio da requisição — refine para o nome comercial do item (marca e gramatura) se
                  souber. É este nome que sai na etiqueta e no PDV.
                </p>
              </div>
            ) : (
            <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
              value={form.nome}
              onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
              placeholder={`Ex: ${exProd.nome}`} />
            )}
          </FormField>
          <FormField label={ehVendavel(extras.tipo) ? 'Categoria *' : 'Categoria'} error={extrasErrors.categoria_id}>
            {categoriasDaFilial.length > 0 ? (
              <select className={`neu-input py-2 px-3 rounded-xl text-sm ${extrasErrors.categoria_id ? 'border border-red-500/40' : ''}`}
                value={extras.categoria_id}
                onChange={e => {
                  const cat = categoriasProduto.find((c: any) => c.id === e.target.value);
                  setExtras(x => ({ ...x, categoria_id: e.target.value, categoria: cat?.nome ?? '', subcategoria_id: '' }));
                  setExtrasErrors(ev => ({ ...ev, categoria_id: '' }));
                }}>
                <option value="">— Selecione —</option>
                {categoriasDaFilial.filter((c: any) => c.ativo).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>
                ))}
              </select>
            ) : (
              // Era um input livre, e ele levava a um beco: o produto
              // nascia com `categoria_id` nulo — sem markup-alvo, sem a
              // sugestão de preço — e, em mercadoria, a validação exige
              // categoria_id, então o salvar era barrado apontando para
              // um select que nem estava na tela. A dependência passa a
              // ser dita em voz alta.
              <>
                <select className={`neu-input py-2 px-3 rounded-xl text-sm opacity-60 ${extrasErrors.categoria_id ? 'border border-red-500/40' : ''}`}
                  value="" disabled>
                  <option value="">— Nenhuma categoria cadastrada —</option>
                </select>
                <p className="text-[10px] text-amber-400/90 mt-1 leading-snug">
                  A <span className="font-bold">{filial}</span> ainda não tem categoria. Cadastre em{' '}
                  <span className="text-gray-300 font-semibold">Cadastros → Categorias</span> antes do produto —
                  é a categoria que carrega o markup-alvo usado para sugerir o preço de venda.
                </p>
              </>
            )}
          </FormField>
          {extras.categoria_id && (() => {
            const subs = subcategoriasProduto.filter((s: any) => s.categoria_id === extras.categoria_id && s.ativo);
            return subs.length > 0 ? (
              <FormField label="Subcategoria">
                <select className="neu-input py-2 px-3 rounded-xl text-sm"
                  value={extras.subcategoria_id}
                  onChange={e => setExtras(x => ({ ...x, subcategoria_id: e.target.value }))}>
                  <option value="">— Sem subcategoria —</option>
                  {subs.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.icone} {s.nome}</option>
                  ))}
                </select>
              </FormField>
            ) : null;
          })()}
          {/* Só mercadoria tem código de barras. Patrimônio se
              identifica pela plaqueta e material de consumo sai por
              requisição — nenhum dos dois passa pelo leitor do caixa, e
              o campo em branco na tela deles só sugeria que faltava
              preencher alguma coisa. */}
          {ehVendavel(extras.tipo) && (
          <FormField label="Cód. Barras EAN *" error={extrasErrors.ean}>
            <div className="flex gap-2">
              <input className={`neu-input py-2 px-3 rounded-xl text-sm font-credencial flex-1 min-w-0 ${extrasErrors.ean ? 'border border-red-500/40' : ''}`}
                value={extras.ean}
                onChange={e => { setExtras(x => ({ ...x, ean: e.target.value })); setExtrasErrors(ev => ({ ...ev, ean: '' })); }}
                placeholder="Ex: 7891234567890 (12 ou 13 dígitos)" inputMode="numeric" />
              {/* Sem o código do fabricante, o aluno inventava dígitos e
                  o verificador não fechava. O interno é legítimo:
                  prefixo 2 é o que a GS1 reserva para a loja. */}
              <button type="button"
                onClick={() => { setExtras(x => ({ ...x, ean: gerarEanInterno() })); setExtrasErrors(ev => ({ ...ev, ean: '' })); }}
                title="Gerar código interno da loja (prefixo 2)"
                className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0">
                Gerar
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1 leading-snug">
              É o que o PDV lê no caixa, e não se repete dentro da unidade. Produto registrado no Brasil
              começa com <span className="font-mono text-gray-400">789</span> ou{' '}
              <span className="font-mono text-gray-400">790</span>; importado tem o prefixo do país de
              origem. Não tem o código do fabricante? Use “Gerar” — sai um interno da loja, prefixo{' '}
              <span className="font-mono text-gray-400">2</span>.
            </p>
          </FormField>
          )}
          {/* Sem asterisco desde a migr. 488. O produto é cadastrado
              ANTES da compra (migr. 480) — nesse momento ninguém sabe
              quem vai fornecer, porque é a cotação que decide comparando
              propostas. Exigir aqui só rendia nome escolhido no chute,
              igual ao preço de custo que a 480 já tinha soltado. O que
              for escolhido vira sugestão: a Cotação abre com ele
              pré-selecionado, e o comprador troca se a proposta melhor
              vier de outro. */}
          <FormField label="Fornecedor habitual">
            <select className="neu-input py-2 px-3 rounded-xl text-sm"
              value={extras.fornecedor_id}
              onChange={e => {
                const id = e.target.value;
                const nome = fornecedoresOrdenados.find((f: any) => f.id === id)?.nome ?? '';
                setExtras(x => ({ ...x, fornecedor_id: id, fornecedor: nome }));
              }}>
              <option value="">— Ainda não sei (define na cotação) —</option>
              {fornecedoresOrdenados.map((f: any) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
              Opcional. Serve de sugestão na cotação — quem fornece de fato
              sai da proposta aprovada, não daqui.
            </p>
          </FormField>
          {/* O asterisco seguia a validação de longe: ela só cobra
              marca de mercadoria com embalagem (migr. 438), mas o
              rótulo pedia sempre — inclusive no granel da mercearia,
              onde banana não tem rótulo, e no patrimônio. */}
          <FormField
            label={ehVendavel(extras.tipo) && temConteudoDeEmbalagem(extras.unidade) ? 'Marca *' : 'Marca'}
            error={extrasErrors.marca}>
            <input className={`neu-input py-2 px-3 rounded-xl text-sm ${extrasErrors.marca ? 'border border-red-500/40' : ''}`}
              value={extras.marca}
              onChange={e => { setExtras(x => ({ ...x, marca: e.target.value })); setExtrasErrors(ev => ({ ...ev, marca: '' })); }}
              placeholder={`Ex: ${exProd.marca}`} />
            {/* Migr. 526: dizer DE ONDE veio é o que separa sugestão de
                dado que apareceu sozinho — e o aluno precisa saber que
                pode discordar da proposta se o que chegou foi outro. */}
            {marcaDaCompra && extras.marca.trim() === marcaDaCompra && (
              <p className="text-[10px] text-cyan-400/80 mt-1 leading-relaxed">
                Veio da proposta aprovada desta compra. Se o que chegou é de outra marca,
                corrija aqui — o cadastro é o que vale daqui para a frente.
              </p>
            )}
          </FormField>
          {/* Peso/Volume é o CONTEÚDO da embalagem, e tem medida própria
              (migr. 438). Antes o sufixo era `extras.unidade` — a medida
              do estoque — então arroz de 5 kg vendido em pacote lia
              "Peso / Volume (UN)" e não havia como dizer "5 KG, 50 UN".

              Só aparece em supermercado, e só quando a embalagem tem
              conteúdo: item vendido a granel (KG/L) já É a medida, e
              pedir peso dele era o que enchia a coluna de `1`. */}
          {mostraPesoConteudo && (
            <FormField label="Peso / Volume por embalagem *" error={extrasErrors.peso}>
              <div className={`neu-input flex items-center rounded-xl text-sm overflow-hidden ${extrasErrors.peso ? 'border border-red-500/40' : ''}`}>
                <input className="flex-1 bg-transparent py-2 pl-3 pr-2 outline-none"
                  value={extras.peso} inputMode="decimal"
                  onChange={e => { setExtras(x => ({ ...x, peso: formatQtd(e.target.value, true) })); setExtrasErrors(ev => ({ ...ev, peso: '' })); }}
                  onKeyDown={handleQtdKeyDown(true)}
                  placeholder="Ex: 5" />
                <select
                  className="bg-transparent text-xs font-bold text-accent px-2 py-2 border-l border-white/5 outline-none shrink-0"
                  value={extras.peso_unidade}
                  onChange={e => { setExtras(x => ({ ...x, peso_unidade: e.target.value })); setExtrasErrors(ev => ({ ...ev, peso: '' })); }}
                  title="Medida do conteúdo da embalagem — nada a ver com a unidade de estoque">
                  <option value="">— ? —</option>
                  {UNIDADES_CONTEUDO
                    // "1 UN contém N UN" é ruído (migr. 593). A opção
                    // some em vez de virar erro depois de digitada.
                    .filter(u => !(u === 'UN' && normalizarUnidade(extras.unidade) === 'UN'))
                    .map(u => <option key={u} value={u}>{u === 'UN' ? 'UN (contagem)' : u}</option>)}
                </select>
              </div>
              {/* O nome do produto costuma trazer a medida ("Arroz 1kg").
                  Quando ela discorda do que foi preenchido, um dos dois
                  está errado — e perguntar agora custa menos que
                  descobrir no preço por quilo. Aviso, não bloqueio: o
                  nome é texto livre e a leitura dele erra. */}
              {(() => {
                const aviso = divergenciaDeConteudo(form.nome, extras.peso, extras.peso_unidade);
                return aviso ? (
                  <p className="text-[10px] text-amber-500 mt-1 leading-snug flex items-start gap-1">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{aviso}</span>
                  </p>
                ) : null;
              })()}
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                O que vem dentro de <span className="font-bold text-gray-400">UMA {extras.unidade || 'UN'}</span> —
                {' '}<span className="text-gray-400">5 KG</span> de arroz, ou{' '}
                <span className="text-gray-400">6 UN</span> num pacote de sabonete. Não é quanto o
                fornecedor entrega: isso é <span className="font-bold text-gray-400">Compra em</span>, lá em Estoque.
              </p>
            </FormField>
          )}
        </div>

        {/* ── Atributos por nicho (JSONB em produtos.atributos) ──────
            Só aparece em MaxLook (moda) e TechMax (eletrônico). Cada
            filial mostra os campos definidos em ATRIBUTOS_PRODUTO. */}
        {ehVendavel(extras.tipo) && (ATRIBUTOS_PRODUTO[filial] ?? []).length > 0 && (
          <div className="mt-6 pt-6 border-t border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Tag size={12} className="text-accent" />
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                {filial === 'MaxLook' ? 'Detalhes da peça (Boutique)'
                  : filial === 'SuperMax' ? 'Conservação (Mercearia)'
                  : 'Ficha técnica (Loja & Assistência)'}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(ATRIBUTOS_PRODUTO[filial] ?? []).map((d) => {
                // Campo dependente some quando o pai não está na
                // resposta que o libera — era assim que "Validade
                // (dias)" ficava aberto para detergente. `dependeDeValor`
                // existe porque o pai deixou de ser checkbox: em
                // perecível a resposta é 'Sim', não `true`.
                if (d.dependeDe) {
                  const pai = extras.atributos?.[d.dependeDe];
                  const libera = d.dependeDeValor !== undefined
                    ? String(pai ?? '') === d.dependeDeValor
                    : pai === true;
                  if (!libera) return null;
                }

                const errKey = `atr_${d.key}`;
                const err = extrasErrors[errKey];
                const val = extras.atributos?.[d.key] ?? '';
                const setAtr = (v: any) => {
                  setExtras(x => ({ ...x, atributos: { ...(x.atributos ?? {}), [d.key]: v } }));
                  setExtrasErrors(ev => ({ ...ev, [errKey]: '' }));
                };
                if (d.type === 'bool') {
                  return (
                    <label key={d.key}
                      className={`flex items-center gap-3 cursor-pointer neu-flat rounded-xl px-4 py-3 border border-white/5 ${d.wide ? 'sm:col-span-2' : ''}`}>
                      <input type="checkbox" checked={!!val}
                        onChange={e => {
                          const marcado = e.target.checked;
                          setExtras(x => {
                            const atrs = { ...(x.atributos ?? {}), [d.key]: marcado };
                            // Desmarcar o pai apaga os filhos: deixar
                            // "Validade: 5" gravado num item que não é
                            // mais perecível põe o iogurte fantasma na
                            // fila de vencimento.
                            if (!marcado) {
                              for (const f of (ATRIBUTOS_PRODUTO[filial] ?? [])) {
                                if (f.dependeDe === d.key) delete atrs[f.key];
                              }
                            }
                            return { ...x, atributos: atrs };
                          });
                          setExtrasErrors(ev => ({ ...ev, [errKey]: '' }));
                        }}
                        className="accent-accent w-4 h-4" />
                      <span className="text-xs font-bold text-gray-200">{d.label}</span>
                    </label>
                  );
                }
                if (d.type === 'textarea') {
                  return (
                    <div key={d.key} className={d.wide ? 'sm:col-span-2' : ''}>
                      <FormField label={rotuloAtributo(d)} error={err}>
                        <textarea rows={3}
                          className={`neu-input py-2 px-3 rounded-xl text-sm resize-none ${err ? 'border border-red-500/40' : ''}`}
                          value={String(val)} onChange={e => setAtr(e.target.value)}
                          placeholder={d.placeholder} />
                      </FormField>
                    </div>
                  );
                }
                if (d.type === 'select' && d.options) {
                  // `livre`: a lista cobre o comum e "Outro" abre um
                  // campo para o resto. Fechar de vez travaria a peça
                  // importada; deixar livre multiplica grafia — e é
                  // grafia que fabrica variante duplicada na grade.
                  const v = String(val);
                  const naLista = (d.options as readonly string[]).includes(v);
                  const emOutro = !!d.livre && (atrLivre.has(d.key) || (v !== '' && !naLista));
                  return (
                    <div key={d.key} className={d.wide ? 'sm:col-span-2' : ''}>
                      <FormField label={rotuloAtributo(d)} error={err}>
                        <select className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
                          value={emOutro ? OUTRO : v}
                          onChange={e => {
                            if (e.target.value === OUTRO) {
                              setAtrLivre(prev => new Set(prev).add(d.key));
                              setAtr('');
                              return;
                            }
                            setAtrLivre(prev => {
                              const n = new Set(prev); n.delete(d.key); return n;
                            });
                            const novo = e.target.value;
                            // Pai de campos dependentes: mudar a
                            // resposta apaga os filhos. Deixar
                            // "Validade: 5" num item que passou a não
                            // ser perecível põe o iogurte fantasma na
                            // fila de vencimento — mesmo motivo do
                            // checkbox, agora no select.
                            setExtras(x => {
                              const atrs = { ...(x.atributos ?? {}), [d.key]: novo };
                              for (const f of (ATRIBUTOS_PRODUTO[filial] ?? [])) {
                                if (f.dependeDe === d.key
                                    && String(novo) !== (f.dependeDeValor ?? '')) {
                                  delete atrs[f.key];
                                }
                              }
                              return { ...x, atributos: atrs };
                            });
                            setExtrasErrors(ev => ({ ...ev, [errKey]: '' }));
                          }}>
                          <option value="">— Selecione —</option>
                          {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          {d.livre && <option value={OUTRO}>Outro…</option>}
                        </select>
                        {emOutro && (
                          <input autoFocus
                            className={`neu-input py-2 px-3 rounded-xl text-sm mt-2 ${err ? 'border border-red-500/40' : ''}`}
                            value={v} onChange={e => setAtr(e.target.value)}
                            placeholder={d.placeholder ?? 'Digite o valor'} />
                        )}
                      </FormField>
                      {d.dica && <span className="text-[10px] text-gray-500 block mt-1">{d.dica}</span>}
                    </div>
                  );
                }
                return (
                  <div key={d.key} className={d.wide ? 'sm:col-span-2' : ''}>
                    <FormField label={rotuloAtributo(d)} error={err}>
                      <input className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
                        value={String(val)} inputMode={d.soDigitos ? 'numeric' : undefined}
                        onChange={e => setAtr(d.soDigitos ? e.target.value.replace(/\D/g, '') : e.target.value)}
                        placeholder={d.placeholder} />
                    </FormField>
                    {d.dica && <span className="text-[10px] text-gray-500 block mt-1">{d.dica}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
