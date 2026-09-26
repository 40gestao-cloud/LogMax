import type React from 'react';
import { AlertTriangle, ClipboardCheck, FilePlus2, IdCard, Lock, Pencil, Tag } from 'lucide-react';
import { FormField, SecaoFormulario } from '../ui';
import { SelectBusca, type SelectBuscaGrupo } from '../SelectBusca';
import { formatQtd, handleQtdKeyDown } from '../../lib/viewUtils';
import { gerarEanInterno } from '../../lib/barcode';
import { UNIDADES_CONTEUDO, divergenciaDeConteudo, temConteudoDeEmbalagem, normalizarUnidade, type ExemploProduto } from '../../lib/unidades';
import { ATRIBUTOS_PRODUTO, rotuloAtributo } from '../../lib/atributosProduto';
import { ehVendavel } from '../../lib/tipoProduto';
import type { useReservaTrabalho } from '../../hooks/useReservaTrabalho';
import type { ItemAguardandoPedido, ItemComprado } from './produtoFormComum';
import { OUTRO, SEM_COMPRA, type FormProduto, type ExtrasProduto } from './produtoFormComum';

// Identificação: origem (com/sem requisição), nome, código, EAN, categoria, marca, embalagem, fornecedor e a ficha do nicho.
// Seção do formulário de ProdutosView: o estado é da view e desce com o
// mesmo nome que tem lá.
export function SecaoIdentificacao({
  errors, clearError, categoriasProduto, subcategoriasProduto, atrLivre, categoriasDaFilial, codigoReservado, emImplantacao, escolherOrigem, exProd, extras, extrasErrors, filial, form, fornecedoresOrdenados, gruposOrigem, itemCompradoSel, itensComprados, liberarCodigo, modoOrigem, mostraPesoConteudo, nomeDestravado, origemExigida, origemOferecida, origemSemOpcoes, reqsProntas, reservaOrigem, setAtrLivre, setCodigoReservado, setExtras, setExtrasErrors, setForm, setModoOrigem, setNomeDestravado, sugerindoCodigo, sugerirCodigo,
}: {
  errors: Partial<Record<keyof FormProduto, string>>;
  clearError: (key: keyof FormProduto) => void;
  categoriasProduto: any[];
  subcategoriasProduto: any[];
  atrLivre: Set<string>;
  categoriasDaFilial: any[];
  codigoReservado: string | null;
  emImplantacao: boolean;
  escolherOrigem: (desc: string) => void;
  exProd: ExemploProduto;
  extras: ExtrasProduto;
  extrasErrors: Record<string, string>;
  filial: string;
  form: FormProduto;
  fornecedoresOrdenados: any[];
  gruposOrigem: SelectBuscaGrupo[];
  itemCompradoSel: string;
  itensComprados: ItemComprado[];
  liberarCodigo: (codigo: string | null) => void;
  modoOrigem: '' | 'com' | 'sem';
  mostraPesoConteudo: boolean;
  nomeDestravado: boolean;
  origemExigida: boolean;
  origemOferecida: boolean;
  origemSemOpcoes: boolean;
  reqsProntas: ItemAguardandoPedido[];
  reservaOrigem: ReturnType<typeof useReservaTrabalho>;
  setAtrLivre: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCodigoReservado: React.Dispatch<React.SetStateAction<string | null>>;
  setExtras: React.Dispatch<React.SetStateAction<ExtrasProduto>>;
  setExtrasErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setForm: React.Dispatch<React.SetStateAction<FormProduto>>;
  setModoOrigem: React.Dispatch<React.SetStateAction<'' | 'com' | 'sem'>>;
  setNomeDestravado: React.Dispatch<React.SetStateAction<boolean>>;
  sugerindoCodigo: boolean;
  sugerirCodigo: () => void | Promise<void>;
}) {
  // O item escolhido manda no modo — o "Cadastrar produto" das Cotações chega
  // com a requisição já posta, sem passar pelos botões.
  const modo = itemCompradoSel === SEM_COMPRA ? 'sem' : itemCompradoSel ? 'com' : modoOrigem;
  const comDisponivel = reqsProntas.length + itensComprados.length > 0;
  // Mercadoria sem requisição só existe na implantação da unidade.
  const semDisponivel = !origemExigida || emImplantacao;
  const mostraNome = !origemOferecida || modo === 'sem' || (modo === 'com' && !!itemCompradoSel);
  const nomeTravado = !!itemCompradoSel && itemCompradoSel !== SEM_COMPRA && !nomeDestravado;

  const escolherCom = () => {
    if (itemCompradoSel === SEM_COMPRA) escolherOrigem('');
    setExtrasErrors(ev => ({ ...ev, origem_compra: '' }));
    setModoOrigem('com');
  };
  const escolherSem = () => {
    if (itemCompradoSel && itemCompradoSel !== SEM_COMPRA) setForm(f => ({ ...f, nome: '' }));
    escolherOrigem(origemExigida ? SEM_COMPRA : '');
    setModoOrigem('sem');
  };

  return (
    <>
      <SecaoFormulario titulo="Identificação" icon={IdCard} cor="vermelho">

        {origemOferecida && (
          <div className="mb-5">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">
              Origem deste cadastro{origemExigida ? ' *' : ''}
            </p>
            {origemSemOpcoes ? (
              <div className="neu-pressed rounded-xl p-3 border border-amber-400/20 text-[11px] text-amber-300/90 leading-snug">
                Nenhuma requisição com cotação aprovada está esperando cadastro. Abra uma em{' '}
                <span className="font-bold">Requisições &gt; Do Setor &gt; Compra eventual</span>.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Estado "disponível, mas ainda não escolhido" é neutro de
                    propósito: com cor própria (azul/roxo) mesmo sem clicar,
                    os dois botões pareciam já escolhidos, e o aluno não sabia
                    que precisava clicar para a lista aparecer. A cor só entra
                    de verdade — preenchida — depois do clique. */}
                <button type="button" onClick={escolherCom} disabled={!comDisponivel}
                  className={`rounded-xl px-4 py-3 border flex items-center gap-3 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    modo === 'com'
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'border-white/10 text-gray-400 hover:border-blue-500/40 hover:text-blue-400 hover:bg-blue-500/5'}`}>
                  <ClipboardCheck size={20} className="shrink-0" />
                  <span className="flex flex-col">
                    <span className="text-sm font-bold">Cadastro com requisição</span>
                    <span className={`text-[11px] ${modo === 'com' ? 'text-blue-100' : 'text-gray-500'}`}>
                      {comDisponivel ? `${reqsProntas.length + itensComprados.length} sem cadastro` : 'Nenhum sem cadastro'}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={escolherSem} disabled={!semDisponivel}
                  title={semDisponivel ? undefined : 'Fora da implantação, mercadoria nova entra por requisição.'}
                  className={`rounded-xl px-4 py-3 border flex items-center gap-3 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    modo === 'sem'
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'border-white/10 text-gray-400 hover:border-purple-500/40 hover:text-purple-400 hover:bg-purple-500/5'}`}>
                  <FilePlus2 size={20} className="shrink-0" />
                  <span className="flex flex-col">
                    <span className="text-sm font-bold">Cadastro sem requisição</span>
                    <span className={`text-[11px] ${modo === 'sem' ? 'text-purple-100' : 'text-gray-500'}`}>
                      {!semDisponivel ? 'Só na implantação da unidade'
                        : origemExigida ? 'Saldo de implantação' : 'Digitar o nome do produto'}
                    </span>
                  </span>
                </button>
              </div>
            )}
            {modo === 'com' && comDisponivel && (
              <div className="mt-3 lg:w-1/2">
                <SelectBusca
                  value={itemCompradoSel}
                  onChange={escolherOrigem}
                  grupos={gruposOrigem}
                  placeholder="Escolha o produto sem cadastro"
                  vazioTexto="Nada encontrado com esse texto."
                  error={extrasErrors.origem_compra}
                  abrirAoMontar={!itemCompradoSel}
                />
              </div>
            )}
            {extrasErrors.origem_compra && modo !== 'com' && (
              <p className="text-[11px] text-red-400 mt-1">{extrasErrors.origem_compra}</p>
            )}
            {reservaOrigem.travado && (
              <p className="text-[11px] text-yellow-400 mt-1">
                🔒 {reservaOrigem.dono?.usuario_nome} já está cadastrando este item agora. Escolha
                outra origem ou espere.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {mostraNome && (
            <div className="sm:col-span-2">
              <FormField label="Nome do produto *" error={errors.nome}>
                {/* Travado quando a requisição preencheu: o nome do catálogo é o
                    que sai na etiqueta e no PDV, e "Refinar" destrava. */}
                {nomeTravado ? (
                  <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-200 flex items-center gap-2">
                    <Lock size={13} className="text-gray-500 shrink-0" />
                    <span className="truncate">{form.nome || '—'}</span>
                    <button type="button" onClick={() => setNomeDestravado(true)}
                      className="ml-auto shrink-0 flex items-center gap-1 text-[10px] font-bold text-accent hover:opacity-80">
                      <Pencil size={11} /> Refinar nome
                    </button>
                  </div>
                ) : (
                  <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                    value={form.nome} autoFocus={modo === 'sem'}
                    onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
                    placeholder={`Ex: ${exProd.nome}`} />
                )}
              </FormField>
            </div>
          )}
          <FormField label="Código *" error={errors.codigo}>
            <div className="flex gap-2">
              <input className={`neu-input py-2 px-3 rounded-xl text-sm flex-1 min-w-0 font-credencial ${errors.codigo ? 'border border-red-500/40' : ''}`}
                value={form.codigo} onChange={e => {
                  // Digitou por cima do número gerado: a reserva volta para a fila.
                  if (codigoReservado && e.target.value !== codigoReservado) {
                    liberarCodigo(codigoReservado);
                    setCodigoReservado(null);
                  }
                  setForm(f => ({ ...f, codigo: e.target.value }));
                  clearError('codigo');
                }}
                placeholder="Ex: 001" />
              <button type="button" onClick={sugerirCodigo} disabled={sugerindoCodigo}
                title={`Reservar o próximo código da ${filial}`}
                className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0 disabled:opacity-50">
                {sugerindoCodigo ? '…' : 'Gerar'}
              </button>
            </div>
          </FormField>
          {/* Só mercadoria passa pelo leitor do caixa. */}
          {ehVendavel(extras.tipo) && (
          <FormField label="Cód. Barras EAN *" error={extrasErrors.ean}>
            <div className="flex gap-2">
              <input className={`neu-input py-2 px-3 rounded-xl text-sm font-credencial flex-1 min-w-0 ${extrasErrors.ean ? 'border border-red-500/40' : ''}`}
                value={extras.ean}
                onChange={e => { setExtras(x => ({ ...x, ean: e.target.value })); setExtrasErrors(ev => ({ ...ev, ean: '' })); }}
                placeholder="12 ou 13 dígitos" inputMode="numeric" />
              <button type="button"
                onClick={() => { setExtras(x => ({ ...x, ean: gerarEanInterno() })); setExtrasErrors(ev => ({ ...ev, ean: '' })); }}
                title="Gerar código interno da loja (prefixo 2)"
                className="neu-button py-2 px-3 rounded-xl text-[11px] font-bold text-gray-400 hover:text-accent shrink-0">
                Gerar
              </button>
            </div>
          </FormField>
          )}
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
              <>
                <select className={`neu-input py-2 px-3 rounded-xl text-sm opacity-60 ${extrasErrors.categoria_id ? 'border border-red-500/40' : ''}`}
                  value="" disabled>
                  <option value="">— Nenhuma categoria cadastrada —</option>
                </select>
                <p className="text-[10px] text-amber-400/90 mt-1 leading-snug">
                  Cadastre antes em <span className="font-semibold">Cadastros → Categorias</span>.
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
          {/* A validação só cobra marca de mercadoria com embalagem (migr. 438). */}
          <FormField
            label={ehVendavel(extras.tipo) && temConteudoDeEmbalagem(extras.unidade) ? 'Marca *' : 'Marca'}
            error={extrasErrors.marca}>
            <input className={`neu-input py-2 px-3 rounded-xl text-sm ${extrasErrors.marca ? 'border border-red-500/40' : ''}`}
              value={extras.marca}
              onChange={e => { setExtras(x => ({ ...x, marca: e.target.value })); setExtrasErrors(ev => ({ ...ev, marca: '' })); }}
              placeholder={`Ex: ${exProd.marca}`} />
          </FormField>
          {/* Conteúdo da embalagem (migr. 438): só supermercado, e só fora do granel. */}
          {mostraPesoConteudo && (
            <FormField label={ehVendavel(extras.tipo) ? "Peso / Volume por embalagem *" : "Peso / Volume por embalagem"} error={extrasErrors.peso}>
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
                    // "1 UN contém N UN" é ruído (migr. 593).
                    .filter(u => !(u === 'UN' && normalizarUnidade(extras.unidade) === 'UN'))
                    .map(u => <option key={u} value={u}>{u === 'UN' ? 'UN (contagem)' : u}</option>)}
                </select>
              </div>
              {(() => {
                const aviso = divergenciaDeConteudo(form.nome, extras.peso, extras.peso_unidade);
                return aviso ? (
                  <p className="text-[10px] text-amber-500 mt-1 leading-snug flex items-start gap-1">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{aviso}</span>
                  </p>
                ) : null;
              })()}
            </FormField>
          )}
          <FormField label="Fornecedor *" error={extrasErrors.fornecedor_id}>
            <SelectBusca
              value={extras.fornecedor_id}
              onChange={id => {
                const nome = fornecedoresOrdenados.find((f: any) => f.id === id)?.nome ?? '';
                setExtras(x => ({ ...x, fornecedor_id: id, fornecedor: nome }));
                setExtrasErrors(ev => ({ ...ev, fornecedor_id: '' }));
              }}
              placeholder="Escolha o fornecedor"
              opcoes={fornecedoresOrdenados.map((f: any) => ({
                value: String(f.id), label: f.nome ?? '—',
                sub: [f.cnpj || f.cpf, f.cidade].filter(Boolean).join(' · ') || null,
              }))}
            />
          </FormField>
        </div>
      </SecaoFormulario>

        {/* ── Atributos por nicho (JSONB em produtos.atributos) ──────
            Seção própria: cada filial mostra os campos definidos em
            ATRIBUTOS_PRODUTO (conservação, peça, ficha técnica). */}
        {ehVendavel(extras.tipo) && (ATRIBUTOS_PRODUTO[filial] ?? []).length > 0 && (
          <SecaoFormulario icon={Tag} cor="verde"
            titulo={filial === 'MaxLook' ? 'Detalhes da peça'
              : filial === 'SuperMax' ? 'Conservação'
              : 'Ficha técnica'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          </SecaoFormulario>
        )}
    </>
  );
}
