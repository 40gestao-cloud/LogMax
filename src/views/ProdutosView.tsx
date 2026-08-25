import React, { useState, useEffect, useRef, useMemo } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { MatrizConsolidado } from '../components/MatrizConsolidado';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, FileDown, Sheet, Tag, TrendingUp, AlertTriangle, Barcode, Check, AlertCircle, ImagePlus, X as XIcon, Loader2, Percent, Grid3x3, Upload, Lock, Pencil } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { ImportarProdutosModal } from '../components/ImportarProdutosModal';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge, FilialBadge, Pagination, ProdutoThumb } from '../components/ui';
import { SelectBusca, type SelectBuscaGrupo } from '../components/SelectBusca';
import type { UserProfile } from '../hooks/useUserProfile';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, exportToExcel, formatBRL, parseBRL, handleMoneyKeyDown, formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { normalizeEan13, drawEan13ToCanvas, downloadEan13LabelPdf, drawEtiquetasGridOnDoc, gerarEanInterno } from '../lib/barcode';
import { FILIAL_DEFAULT } from '../lib/filiais';
import {
  validarImagemProduto,
  uploadImagemProduto,
  avaliarResolucaoImagem,
  PRODUTO_IMAGEM_RES_IDEAL,
  removerImagemAntiga,
  PRODUTO_IMAGEM_ACCEPT,
  PRODUTO_IMAGEM_OUTPUT_MAX_LABEL,
  PRODUTO_IMAGEM_MAX_SLOTS,
} from '../lib/produtoImagem';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  UNIDADES_PRODUTO,
  unidadesDeProduto,
  UNIDADES_CONTEUDO,
  divergenciaDeConteudo,
  UNIDADES_FRACIONARIAS,
  temConteudoDeEmbalagem,
  normalizarUnidade,
  formatarConteudo,
  exemploProduto,
} from '../lib/unidades';
import { ATRIBUTOS_PRODUTO, rotuloVariante, atributosPadrao, rotuloAtributo, type AtributoDef } from '../lib/atributosProduto';
import { calcMarkup, calcMargem, precoPorMarkup, corDoMarkup, fmtPct, EXPLICA_MARKUP_MARGEM } from '../lib/precificacao';
import { TIPOS_PRODUTO, TIPO_LABEL, TIPO_AJUDA, normalizarTipo, ehVendavel, temEstoque, type TipoProduto } from '../lib/tipoProduto';
import { supabase } from '../lib/supabase';

/**
 * O custo vive em `produtos_custo`, tabela irmã com RLS própria (migração 262) —
 * `produtos` tem SELECT aberto a todo authenticated, então a coluna não podia
 * continuar lá. Leitura vem pela view `produtos_com_custo`; a escrita é este
 * upsert, feito depois do produto existir (a FK exige o produto_id).
 */
async function salvarPrecoCusto(produtoId: string, valor: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('produtos_custo')
    .upsert(
      // `origem: 'manual'` é obrigatório aqui (migr. 417): sem ele o ON CONFLICT
      // preserva o 'compra' gravado pelo último recebimento, e o custo digitado
      // à mão continuaria se apresentando como custo apurado da compra.
      { produto_id: produtoId, preco_custo: valor, origem: 'manual', updated_at: new Date().toISOString() },
      { onConflict: 'produto_id' },
    );
  if (error) throw new Error(`Produto salvo, mas o preço de custo não foi gravado: ${error.message}`);
}

// Régua única em src/lib/unidades.ts — a lista vivia duplicada aqui, no
// gerador de planilha e no PDV, e as três discordavam.
const UNIDADES = UNIDADES_PRODUTO;

const EMPTY_EXTRAS = {
  categoria:              '',
  categoria_id:           '' as string,
  subcategoria_id:        '' as string,
  preco_custo:            '',
  estoque:                '',
  estoque_minimo:         '',
  unidade:                'UN' as string,
  ean:                    '',
  fornecedor:             '',
  // Guarda a CHAVE; `fornecedor` acima continua com o nome porque a busca
  // trigram (migr. 028), o export e a ficha do catálogo leem da coluna de
  // texto. Migr. 488 — sugestão opcional, não pré-requisito.
  fornecedor_id:          '',
  marca:                  '',
  peso:                   '',
  // Medida do CONTEÚDO da embalagem, independente de `unidade` (que é a medida
  // do estoque). Arroz 5 KG em pacote: peso=5, peso_unidade=KG, unidade=UN.
  // Migr. 438 — antes o rótulo usava `unidade` e produzia "Peso / Volume (UN)".
  peso_unidade:           'KG' as string,
  filial:                 FILIAL_DEFAULT as string,
  tipo:                   'estoque_venda' as TipoProduto,
  patrimonio_numero:      '',
  patrimonio_responsavel: '',
  patrimonio_localizacao: '',
  // Migr. 511 — meses até depreciar 100% (linear, sem residual). Vazio =
  // não entra na depreciação do DRE (bem cadastrado só pra controle físico).
  patrimonio_vida_util_meses: '',
  elegivel_beneficios:    false,
  // Atributos por nicho (JSONB em produtos.atributos). Cada filial preenche
  // um subconjunto: MaxLook usa tamanho/cor/genero/colecao/material; TechMax
  // usa modelo/cor/memoria/tela/bateria/camera/garantia_dias/requer_imei.
  // SuperMax fica com objeto vazio (usa as colunas físicas que já tem).
  atributos:              {} as Record<string, any>,
};

// A ficha por nicho (tipo + tabela) vive em src/lib/atributosProduto.ts —
// o PDV exibe a mesma lista no modal de detalhes do produto, e duas cópias
// divergiriam no primeiro campo novo.

const parseNum = (v: string | number | undefined | null): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;


/**
 * Produto sem nenhum campo da ficha do nicho preenchido. Só conta para filial
 * que TEM ficha — não faz sentido acusar incompletude de uma seção que não
 * existe.
 */
const fichaVazia = (item: any, filial: string): boolean => {
  const defs = ATRIBUTOS_PRODUTO[filial] ?? [];
  if (defs.length === 0) return false;
  const atr = item?.atributos;
  if (!atr || typeof atr !== 'object') return true;
  return !defs.some(d => {
    const v = atr[d.key];
    return v !== undefined && v !== null && String(v).trim() !== '' && v !== false;
  });
};

const fmtBRL = (v: number) => `R$ ${formatBRL(v)}`;

// Sentinel do select "Item comprado". Produto nasce de uma compra; o cadastro
// sem pedido existe (saldo de abertura do primeiro dia, doação, item que a
// turma já tinha) mas é exceção, e exceção se escolhe com o nome dela na tela.
const SEM_COMPRA = '__sem_compra__';

// Prefixo do valor das requisições que ainda esperam o pedido sair (migr. 494).
// O outro grupo do mesmo select guarda a DESCRIÇÃO do item; aqui é preciso o id
// da requisição, porque é nela que o vínculo vai ser gravado.
const REQ_PREFIX = '__req__:';

// Sentinel do "Outro…" nos campos de lista da ficha (tamanho, cor).
const OUTRO = '__outro__';

// A conta vive em src/lib/precificacao.ts — estava duplicada aqui e no
// Catálogo, e as duas calculavam MARKUP sob o rótulo "Margem".

/**
 * Selo da grade. Mostra MARKUP, que é o que sempre mostrou — só o nome estava
 * errado. A margem real vai no title, porque a coluna não comporta as duas e
 * quem decide preço na listagem está olhando formação, não resultado.
 */
const MarkupBadge = ({ venda, custo }: { venda: string | number; custo: string | number }) => {
  const v  = parseNum(venda);
  const c  = parseNum(custo);
  const mk = calcMarkup(v, c);
  if (mk === null) return <span className="text-gray-600">—</span>;
  const mg = calcMargem(v, c);
  return (
    <span className={`font-bold tabular-nums ${corDoMarkup(mk)}`}
      title={`Markup ${fmtPct(mk)} (sobre o custo) · Margem ${fmtPct(mg)} (sobre a venda)`}>
      {fmtPct(mk)}
    </span>
  );
};

const ProdutosViewInner = ({ showToast, filial, profile }: { showToast: any; filial: FilialOp; profile?: UserProfile | null }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  // Escopo de unidade: `auth_pode_filial()` deixa admin, CEO e conselheiro
  // passarem em todas as filiais, então a RLS sozinha não basta — quem opera
  // dentro de uma unidade via catálogo/cadastro de outra.
  const { data: categoriasProduto }  = useFetchData<any>('categorias_produto', filial ? { filial } : undefined);
  const { data: subcategoriasProduto } = useFetchData<any>('subcategorias_produto');
  const { data: fornecedoresList } = useFetchData<any>('/api/crmview-fornecedores', { filial });

  const fornecedoresOrdenados = useMemo(
    () => [...fornecedoresList].sort((a: any, b: any) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
    [fornecedoresList]
  );

  // Itens que a unidade comprou e que ainda não existem no catálogo.
  //
  // O pedido nasce da requisição com `item_descricao` em texto livre e nunca
  // aponta para `produtos` — por isso o Recebimento tem o "➕ Produto novo".
  // Aqui é a outra ponta do mesmo buraco: quem cadastra pelo módulo de
  // Cadastros redigitava o nome que já foi escrito três vezes (requisição,
  // cotação, pedido), com grafia nova em cada uma, e o catálogo terminava com
  // "Cabo HDMI 2m" e "cabo hdmi 2 metros" como produtos diferentes.
  //
  // É SUGESTÃO, não lista fechada: o catálogo inicial da turma nasce antes de
  // qualquer compra (saldo de abertura), e material de consumo e patrimônio
  // entram sem pedido. Fechar aqui travaria o primeiro cadastro do curso.
  const { data: pedidosDaFilial } = useFetchData<any>('/api/pedidosview', { filial });
  // A carga precisa ter CHEGADO. Pedido gerado é compromisso de compra, não
  // mercadoria na mão: pode ser cancelado, pode não vir, e — o que decide — o
  // codigo de barras, o peso da embalagem e a validade estao na CAIXA. Cadastrar
  // antes da chegada obriga a inventar EAN interno para um produto que traz o
  // do fabricante impresso, e ninguem volta para corrigir.
  const { data: recebimentosDaFilial } = useFetchData<any>('/api/recebimentosview', { filial });

  // A outra ponta, que faltava (migr. 494): o item da compra EVENTUAL que ainda
  // NÃO virou pedido. A lista de cima (`itensComprados`) só enxerga o que já
  // chegou na doca — passivo de antes da 480. Depois da 480 o caminho normal é o
  // oposto: a requisição em texto livre para na frente do Gerar Pedido esperando
  // um código de catálogo que ninguém criou ainda. Este é o momento de criar, e
  // é aqui que o vínculo tem de nascer — senão o comprador redigita o nome, salva
  // um produto que não sabe de qual requisição está falando, e volta para a
  // cotação para procurá-lo num select.
  const { data: requisicoesDaFilial, setData: setRequisicoesDaFilial } = useFetchData<any>('/api/requisicoesview', { filial });
  const { data: cotacoesDaFilial }    = useFetchData<any>('/api/cotacoesview', { filial });



  const { data, setData, isLoading, totalCount, reload, error } = useFetchData<any>(
    // Leitura pela view mascarada (migr. 262). Escrita segue em
    // '/api/produtosview' + salvarPrecoCusto() — view não aceita INSERT/UPDATE.
    '/api/produtoscomcustoview',
    // Patrimônio não entra em Cadastros > Produtos: esses itens são geridos em
    // Financeiro > Patrimônio, que lê a mesma tabela com `tipo: 'patrimonio'`.
    // O filtro é server-side de propósito — se fosse `.filter()` no array,
    // totalCount e a paginação continuariam contando os 19 itens escondidos.
    { filial, tipo: { neq: 'patrimonio' } },
    false,
    {
      page,
      searchTerm: debouncedSearch,
      searchColumns: ['nome', 'codigo', 'categoria', 'ean', 'fornecedor'],
      // codigo_seq = parte numérica do código (coluna gerada, migr. 265).
      // Ordenar pelo texto embaralhava a lista, porque o padding é
      // inconsistente na base (ML-004 convive com ML-31) — e como a paginação
      // é server-side, a ordem errada movia produtos entre páginas.
      orderBy: 'codigo_seq',
      ascending: false,
    }
  );

  // Nomes do catálogo INTEIRO da filial, não só da página carregada. `data` é
  // paginado no servidor (50 por vez) e ainda por cima filtrado pela busca:
  // comparar contra ele fazia um item já cadastrado na página 2 continuar
  // aparecendo como "a cadastrar", e o aluno cadastrava de novo — a duplicata
  // que a lista existia para evitar.
  const [nomesCatalogo, setNomesCatalogo] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!supabase) return;
    let cancelado = false;
    supabase.from('produtos').select('nome').eq('filial', filial).eq('ativo', true)
      .then(({ data: rows }) => {
        if (cancelado) return;
        setNomesCatalogo(new Set(
          (rows ?? []).map((r: any) => String(r.nome ?? '').trim().toLowerCase()).filter(Boolean),
        ));
      });
    return () => { cancelado = true; };
    // `data.length` na dependência: recarrega a régua quando um produto novo é
    // cadastrado nesta mesma tela, sem esperar um F5.
  }, [filial, data.length]);

  // Import da planilha (2026-08-19). O modelo era só ida desde 04/08: a turma
  // montava no Excel e redigitava no LogMax. Com o catálogo nascendo do zero na
  // implantação — 56 itens só numa turma — a volta digitada era o gargalo.
  const [importando, setImportando] = useState(false);
  // Códigos do catálogo INTEIRO, não da página: `data` é paginado no servidor, e
  // conferir repetido contra ele deixaria passar o código que está na página 2.
  // Mesmo motivo do `nomesCatalogo` acima.
  const [codigosCatalogo, setCodigosCatalogo] = useState<string[]>([]);
  useEffect(() => {
    if (!supabase || !importando) return;
    let cancelado = false;
    supabase.from('produtos').select('codigo').eq('filial', filial).eq('ativo', true)
      .then(({ data: rows }) => {
        if (cancelado) return;
        setCodigosCatalogo((rows ?? []).map((r: any) => String(r.codigo ?? '')).filter(Boolean));
      });
    return () => { cancelado = true; };
  }, [filial, importando]);

  const itensComprados = useMemo(() => {
    const jaNoCatalogo = nomesCatalogo;
    const vistos = new Set<string>();
    // Pedidos cuja carga já foi lançada no Recebimento. Registrar o recebimento
    // não exige o produto (a tabela só guarda pedido e quantidade) — quem exige
    // é o Confirmar, que baixa o estoque. A ordem da aula fica: chegou →
    // registra → cadastra o produto → confirma a entrada.
    const chegaram = new Set(
      recebimentosDaFilial
        .filter((r: any) => r.ativo !== false)
        .map((r: any) => r.pedido_id)
        .filter(Boolean),
    );
    return pedidosDaFilial
      // Pedido cancelado não vira cadastro: sugerir o item dele seria mandar a
      // turma cadastrar o que a unidade decidiu não comprar.
      .filter((p: any) => p.status !== 'Cancelado')
      // Pedido que JÁ aponta para um produto não tem o que cadastrar. A lista
      // comparava só o texto do pedido com os nomes do catálogo, e texto de
      // requisição quase nunca é igual ao nome cadastrado ("Detergente Ypê
      // 500ml" x "DETERGENTE YPÊ NEUTRO 500ML") — então o item amarrado pela
      // migr. 480 continuava aparecendo como "a cadastrar", e quem seguia a
      // sugestão criava a duplicata que a lista existe para evitar.
      .filter((p: any) => !p.produto_id)
      // Serviço não se cadastra como produto (migr. 499). O pedido de
      // dedetização tem `produto_id` nulo pela mesma razão que o de mercadoria
      // tem — mas por ele apontar para `servicos`. Sem esta linha, a lista
      // mandava cadastrar "Manutenção do ar-condicionado" como mercadoria de
      // estoque, que é exatamente o beco que a 499 fechou.
      .filter((p: any) => !p.servico_id)
      .filter((p: any) => chegaram.has(p.id))
      .map((p: any) => {
        // Colapsa espaco em branco interno: 25 das 57 descricoes da turma de
        // Contabilidade trazem um TAB entre o produto e a marca — heranca de
        // quem montou a requisicao colando de planilha. Sem normalizar, o TAB
        // ia inteiro para `produtos.nome`: some na tela, aparece na etiqueta e
        // no PDV, e ninguem consegue redigitar aquele nome numa busca.
        const desc = String(p.item_descricao ?? '').replace(/\s+/g, ' ').trim();
        const qtd  = Number(p.item_qtd ?? 0);
        const val  = Number(p.valor_total ?? 0);
        // Migr. 526: a marca da proposta que virou ESTE pedido. Só a compra
        // eventual tem — na reposição o produto já existe e não passa por aqui.
        const cotDoPedido = (cotacoesDaFilial as any[]).find((c: any) => c.id === p.cotacao_id);
        return {
          descricao: desc,
          marca: String(cotDoPedido?.marca ?? '').trim(),
          fornecedor: fornecedoresList.find((f: any) => f.id === p.fornecedor_id)?.nome ?? '',
          fornecedor_id: p.fornecedor_id ?? '',
          // Custo unitário do próprio pedido — a mesma conta que a migr. 417 faz
          // no recebimento. Melhor que o número inventado que o campo exige.
          custo: qtd > 0 && val > 0 ? val / qtd : null,
        };
      })
      .filter(i => {
        const k = i.descricao.toLowerCase();
        if (!k || jaNoCatalogo.has(k) || vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  }, [pedidosDaFilial, recebimentosDaFilial, cotacoesDaFilial, fornecedoresList, nomesCatalogo]);

  // Requisições de texto livre esperando um código de catálogo (migr. 494).
  //
  // Régua: viva (ativa, não Atendida nem Negada), sem `produto_id` e com nome
  // que ainda não existe no catálogo. Esse último filtro é o mesmo do grupo de
  // cima e pela mesma razão — se o item já está cadastrado, o que falta é
  // amarrar, não cadastrar de novo, e isso se faz no próprio Gerar Pedido.
  //
  // A cotação aprovada entra junto porque muda a urgência da linha: essa é a
  // requisição que está PARADA na frente do Gerar Pedido agora. Ela também traz
  // o fornecedor, que é a única coisa já decidida a esta altura.
  const itensAguardandoPedido = useMemo(() => {
    const cotPorReq = new Map<string, any>();
    for (const c of cotacoesDaFilial as any[]) {
      if (c.ativo === false || c.status !== 'Aprovado' || !c.requisicao_id) continue;
      cotPorReq.set(c.requisicao_id, c);
    }
    return (requisicoesDaFilial as any[])
      .filter(r => r.ativo !== false)
      .filter(r => !r.produto_id)
      // Requisição de serviço não espera código de PRODUTO (migr. 499): ela
      // espera o serviço do catálogo, e quem a amarra é Compras no Gerar
      // Pedido. `servico_id` cobre a já amarrada; a unidade SV cobre a que
      // ainda não passou por lá — que é justamente a que apareceria aqui.
      .filter(r => !r.servico_id)
      .filter(r => String(r.unidade ?? '').trim().toUpperCase() !== 'SV')
      // 'Em correção' (migr. 517) sai junto: o documento voltou para quem o
      // abriu e o TEXTO DO ITEM pode mudar. Cadastrar produto a partir dele
      // amarraria o catálogo a um pedido que ainda vai ser reescrito.
      .filter(r => !['Atendida', 'Negado', 'Em correção'].includes(r.status))
      .map(r => {
        // Mesmo colapso de espaço em branco do grupo de cima: requisição colada
        // de planilha traz TAB entre o produto e a marca, e o TAB ia inteiro
        // para `produtos.nome`.
        const desc = String(r.item ?? '').replace(/\s+/g, ' ').trim();
        const cot  = cotPorReq.get(r.id);
        return {
          id: r.id,
          descricao: desc,
          numero: r.numero ?? `#${String(r.id).slice(-6).toUpperCase()}`,
          qtd: Number(r.qtd ?? 0),
          unidade: r.unidade ?? '',
          cotada: !!cot,
          // Migr. 526: só da cotação APROVADA — que é a única que `cotPorReq`
          // guarda. Sugerir a marca de uma proposta reprovada seria pior que o
          // texto livre que este campo tinha antes.
          marca: String(cot?.marca ?? '').trim(),
          fornecedor: cot ? (fornecedoresList.find((f: any) => f.id === cot.fornecedor_id)?.nome ?? '') : '',
          fornecedor_id: cot?.fornecedor_id ?? '',
        };
      })
      .filter(i => i.descricao && !nomesCatalogo.has(i.descricao.toLowerCase()))
      // A prioridade de "cotada primeiro" não morreu — virou o rótulo do grupo
      // no select com busca (mais legível que posição numa lista de 46). Aqui
      // dentro, alfabética pura: é isso que faz achar "Sardinha" rápido.
      .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  }, [requisicoesDaFilial, cotacoesDaFilial, fornecedoresList, nomesCatalogo]);
  // Seleção para etiquetas. Guarda o produto inteiro (Map), não só o id: a
  // listagem é paginada no servidor, então um item escolhido na página 1 some
  // de `data` ao navegar para a página 2 — sem o snapshot não dá para gerar a
  // etiqueta dele no fim. É isso que permite "pesquisar, marcar, pesquisar de
  // novo, marcar mais" e baixar tudo de uma vez.
  const [selecionados, setSelecionados] = useState<Map<string, any>>(new Map());

  const toggleSelecionado = (item: any) => {
    setSelecionados(prev => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  };

  // Exemplo de produto do nicho para os placeholders do formulário. Ferragem e
  // mercearia na tela de uma boutique confundem quem cadastra — o exemplo
  // existe para tirar dúvida, não para criar uma.
  const exProd = exemploProduto(filial);

  // Grade de variantes (migr. 445). Existe onde a ficha do nicho tem tamanho E
  // cor — hoje só a MaxLook, mas a régua é a ficha, não o nome da filial: se um
  // dia a TechMax ganhar cor, a grade aparece lá sem ninguém mexer aqui.
  const temGrade = useMemo(() => {
    const keys = (ATRIBUTOS_PRODUTO[filial] ?? []).map(d => d.key);
    return keys.includes('tamanho') && keys.includes('cor');
  }, [filial]);
  // Código interno: o clique JÁ RESERVA o número (migr. 481). Antes isto era um
  // `select max(codigo_seq)` daqui mesmo — e o maior só mudava quando alguém
  // SALVAVA. Com a turma cadastrando junto, os cinco da unidade ficavam com 001
  // na tela ao mesmo tempo e descobriam o conflito no fim do preenchimento.
  // A RPC serializa por filial, conta olhando também as reservas vivas e grava
  // a nossa antes de responder.
  const [sugerindoCodigo, setSugerindoCodigo] = useState(false);
  // Número que está reservado em nome deste usuário. Precisa ser devolvido
  // quando o cadastro termina, é abandonado, ou o operador digita outro por
  // cima — senão o número fica fora da fila até a reserva vencer.
  const [codigoReservado, setCodigoReservado] = useState<string | null>(null);

  // Best-effort: falhar em devolver não pode atrapalhar salvar nem fechar o
  // formulário. O prazo da reserva cobre o que escapar daqui.
  const liberarCodigo = (codigo: string | null) => {
    if (!supabase || !codigo) return;
    supabase.rpc('liberar_codigo_produto', { p_filial: filial, p_codigo: codigo })
      .then(undefined, () => {});
  };

  const sugerirCodigo = async () => {
    if (!supabase) return;
    setSugerindoCodigo(true);
    try {
      // `p_codigo_atual` (migr. 498): se já temos um número reservado, a RPC
      // devolve o MESMO e renova o prazo — reclicar não queima a sequência. Sem
      // ele, um segundo cadastro aberto em paralelo recebia o número do
      // primeiro, e uma das duas telas não salvava.
      const { data: codigo, error } = await supabase.rpc('reservar_codigo_produto', {
        p_filial: filial,
        p_codigo_atual: codigoReservado,
      });
      if (error) {
        showToast(error.message || 'Não foi possível reservar um código agora.', 'error', true);
        return;
      }
      // Sem prefixo: o código é só o número, sequencial dentro da filial.
      setCodigoReservado(String(codigo));
      setForm(f => ({ ...f, codigo: String(codigo) }));
      clearError('codigo');
    } finally {
      setSugerindoCodigo(false);
    }
  };

  // Item de compra escolhido como origem do cadastro. Estado próprio porque o
  // select precisa voltar para o vazio quando o formulário fecha — senão o
  // próximo cadastro abre com a escolha do anterior.
  const [itemCompradoSel, setItemCompradoSel] = useState('');

  // Nome vem travado quando a origem preencheu — o texto da requisição é a
  // NECESSIDADE escrita em português ("Sardinha em Óleo 125g"), o do catálogo é
  // a IDENTIFICAÇÃO do item ("SARDINHA EM ÓLEO GOMES DA COSTA 125G"). São
  // coisas diferentes de propósito. Travar sem saída congelaria na etiqueta e
  // no PDV o texto colado de planilha; "Refinar nome" destrava para quem sabe
  // o nome comercial, sem convidar quem não sabe a inventar um do zero.
  const [nomeDestravado, setNomeDestravado] = useState(false);

  // Correção de saldo pela direção (o professor). `role === 'admin'` literal,
  // não `auth_is_admin()`: essa função inclui CEO e conselheiro, que são
  // ALUNOS — dar a eles o poder de reescrever saldo seria dar a régua a quem
  // ela existe para avaliar.
  const ehProfessor = profile?.role === 'admin';
  const [corrigindoSaldo, setCorrigindoSaldo]   = useState(false);
  const [saldoCorrigido, setSaldoCorrigido]     = useState('');
  const [motivoSaldo, setMotivoSaldo]           = useState('');
  const [salvandoSaldo, setSalvandoSaldo]       = useState(false);


  // Campos da ficha em modo "Outro": o valor digitado não está na lista, mas o
  // select precisa continuar mostrando "Outro…" enquanto o campo está vazio.
  const [atrLivre, setAtrLivre] = useState<Set<string>>(new Set());

  const [gradeItem, setGradeItem]     = useState<any | null>(null);
  const [gradeTamanhos, setGradeTam]  = useState('');
  const [gradeCores, setGradeCores]   = useState('');
  const [gradeSalvando, setGradeSalv] = useState(false);

  const abrirGrade = (item: any) => {
    setGradeItem(item);
    // A variante que o produto já é entra pré-marcada: a grade se abre A PARTIR
    // dela, e deixá-la de fora faria a primeira geração parecer que perdeu uma
    // combinação.
    setGradeTam(String(item?.atributos?.tamanho ?? '').trim());
    setGradeCores(String(item?.atributos?.cor ?? '').trim());
  };

  const gerarGrade = async () => {
    if (!supabase || !gradeItem) return;
    const tamanhos = gradeTamanhos.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    const cores    = gradeCores.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    if (tamanhos.length === 0 || cores.length === 0) {
      showToast('Informe ao menos um tamanho e uma cor.', 'error', true);
      return;
    }
    setGradeSalv(true);
    try {
      const { data: res, error } = await supabase.rpc('gerar_grade_variantes', {
        p_produto_id: gradeItem.id,
        p_tamanhos:   tamanhos,
        p_cores:      cores,
      });
      if (error) { showToast(error.message, 'error', true); return; }
      const criadas = Number((res as any)?.criadas ?? 0);
      setGradeItem(null);
      await reload();
      showToast(
        criadas === 0
          ? 'A grade já estava completa — nenhuma variante nova.'
          : `${criadas} variante(s) criada(s). Cada uma nasce com saldo zero e sem EAN: a entrada é por Compras → Recebimentos.`,
        'success', true,
      );
    } finally {
      setGradeSalv(false);
    }
  };

  const [isSaving, setIsSaving]   = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [editItem, setEditItem]   = useState<any | null>(null);
  const [form, setForm]   = useState({ codigo: '', nome: '', preco: '' });
  const [extras, setExtras] = useState(() => ({
    ...EMPTY_EXTRAS, filial, atributos: atributosPadrao(filial),
  }));

  // As duas medidas do produto, que o formulário confundia (migr. 438):
  //
  //   `fracionario`        → o estoque anda em fração (KG, L, M...). Manda nos
  //                          campos de quantidade: 12,5 KG é saldo legítimo, e
  //                          `produtos.estoque` é numeric(15,3) desde a 079.
  //   `mostraPesoConteudo` → a embalagem tem conteúdo a declarar. Granel não
  //                          tem: a unidade de estoque já é a medida.
  const fracionario = UNIDADES_FRACIONARIAS.has(normalizarUnidade(extras.unidade));
  const mostraPesoConteudo = filial === 'SuperMax'
    && temEstoque(extras.tipo)
    && temConteudoDeEmbalagem(extras.unidade);

  // A unidade nunca teve um recebimento de verdade (Concluído ou Parcial)?
  // Então ela está na janela de IMPLANTAÇÃO — o momento único em que existe
  // mercadoria na prateleira sem ter passado por um pedido deste sistema.
  // Fora dela, "cadastro por conta própria" deixou de ser opção (abaixo,
  // `origemSemOpcoes`): mercadoria nova entra pela fila normal, e o saldo
  // sempre vem de um Confirmar.
  const emImplantacao = useMemo(
    () => !recebimentosDaFilial.some((r: any) =>
      r.ativo !== false && ['Concluído', 'Parcial'].includes(r.status)),
    [recebimentosDaFilial],
  );

  // Este produto veio de uma compra que já chegou? É o que decide se existe
  // custo para declarar.
  //
  // A requisição esperando o pedido (migr. 494) NÃO conta como compra recebida:
  // ali a mercadoria não chegou, não há custo apurado e não há saldo a lançar. O
  // que existe é o vínculo a gravar depois do INSERT.
  // Migr. 526: a marca que a origem escolhida traz — da requisição esperando
  // pedido ou do pedido já recebido, nos dois casos vinda da cotação aprovada.
  const marcaDaCompra = useMemo(() => {
    if (!itemCompradoSel || itemCompradoSel === SEM_COMPRA) return '';
    if (itemCompradoSel.startsWith(REQ_PREFIX)) {
      const id = itemCompradoSel.slice(REQ_PREFIX.length);
      return itensAguardandoPedido.find(i => i.id === id)?.marca ?? '';
    }
    return itensComprados.find(i => i.descricao === itemCompradoSel)?.marca ?? '';
  }, [itemCompradoSel, itensAguardandoPedido, itensComprados]);

  const veioDeCompra = !!itemCompradoSel
    && itemCompradoSel !== SEM_COMPRA
    && !itemCompradoSel.startsWith(REQ_PREFIX);

  // Requisição escolhida como origem — é ela que recebe o `produto_id` assim que
  // o produto existir.
  const reqVinculo = useMemo(
    () => itemCompradoSel.startsWith(REQ_PREFIX)
      ? itensAguardandoPedido.find(i => i.id === itemCompradoSel.slice(REQ_PREFIX.length)) ?? null
      : null,
    [itemCompradoSel, itensAguardandoPedido],
  );

  // Mercadoria para revenda SEMPRE exige origem — mesmo quando as duas listas
  // estão vazias. "Cadastro por conta própria" deixou de ser saída: fora da
  // janela de implantação, todo item novo do catálogo nasce de uma requisição
  // que passou por Compras, senão o texto da requisição fica solto e ninguém
  // percebe que pulou a fila (era exatamente o furo que os alunos achavam:
  // a opção "não veio de compra" sempre disponível).
  //
  // Patrimônio e consumo não são EXIGIDOS: eles entram no catálogo por outras
  // portas legítimas (saldo de implantação, montagem da filial, bem que já
  // estava na casa), e cobrar origem ali fecharia caminho que nada tem de
  // errado.
  const origemExigida = !editItem && ehVendavel(extras.tipo);

  // Mas OFERECIDO para tudo que TEM SALDO — mercadoria e uso e consumo.
  //
  // Exigir e oferecer eram a mesma coisa, e isso tinha um preço: a compra
  // eventual de material de consumo — papelaria, limpeza, embalagem — não via o
  // campo, então o vínculo da migr. 494 não nascia aqui. O comprador cadastrava
  // o produto, voltava para Compras > Cotações e o Gerar Pedido continuava
  // perguntando o item do catálogo — exatamente a fricção que a 494 existe para
  // matar, sobrevivendo por um tipo de produto.
  //
  // Patrimônio fica FORA, e a régua é `temEstoque`: o que não tem saldo não
  // entra pelo fluxo de compra. Bem de uso tem duas portas próprias — conta a
  // pagar marcada como imobilizado e a montagem da unidade (migr. 510/511) —, e
  // o pedido recusa apontar para ele desde a migr. 515. Oferecer o vínculo aqui
  // seria construir o beco: cadastro salvo, requisição amarrada, e a recusa só
  // aparecendo na frente do Gerar Pedido.
  const origemOferecida = !editItem && temEstoque(extras.tipo);

  // A régua acima criaria um beco se não houvesse NADA para escolher: nenhuma
  // requisição esperando, nenhum item já chegado, e a unidade não está mais em
  // implantação. Aqui a tela não empurra para um select vazio — mostra o
  // caminho certo (abrir a requisição) e trava o Salvar.
  const origemSemOpcoes = origemExigida
    && itensComprados.length === 0
    && itensAguardandoPedido.length === 0
    && !emImplantacao;

  // Grupos do SelectBusca de origem. A prioridade que a ordenação antiga
  // carregava ("cotada primeiro") virou rótulo de grupo — mais legível que
  // posição numa lista de dezenas — e o fornecedor entra como `hint`: é ele
  // que faz achar "Sardinha" buscando por "Gomes da Costa".
  const gruposOrigem = useMemo((): SelectBuscaGrupo[] => {
    const cotadas    = itensAguardandoPedido.filter(i => i.cotada);
    const semCotacao = itensAguardandoPedido.filter(i => !i.cotada);
    const rotuloReq = (i: typeof itensAguardandoPedido[number]) =>
      `${i.descricao}${i.qtd > 0 ? ` · ${qtdBR(i.qtd)} ${normalizarUnidade(i.unidade)}` : ''} · ${i.numero}`;
    const grupos: SelectBuscaGrupo[] = [];
    // Só existe NA janela de implantação: a unidade ainda não tem nenhum
    // recebimento Concluído ou Parcial. Fora dela, "cadastro por conta
    // própria" reabriria o beco que a régua do item F existe para fechar.
    // Só onde a origem é EXIGIDA: para consumo e patrimônio o campo é opcional,
    // e "não escolhi nada" já diz o mesmo que "saldo de implantação" — a opção
    // ali seria um segundo jeito de dizer a mesma coisa.
    if (emImplantacao && (origemExigida || itemCompradoSel === SEM_COMPRA)) {
      grupos.push({
        label: 'Implantação',
        opcoes: [{ value: SEM_COMPRA, label: 'Saldo de implantação (a unidade está começando agora)' }],
      });
    }
    if (cotadas.length > 0) {
      grupos.push({
        label: `Cotação aprovada — travando o Gerar Pedido (${cotadas.length})`,
        opcoes: cotadas.map(i => ({ value: `${REQ_PREFIX}${i.id}`, label: rotuloReq(i), hint: i.fornecedor })),
      });
    }
    if (semCotacao.length > 0) {
      grupos.push({
        label: `Aguardando cotação (${semCotacao.length})`,
        opcoes: semCotacao.map(i => ({ value: `${REQ_PREFIX}${i.id}`, label: rotuloReq(i), hint: i.fornecedor })),
      });
    }
    // Item comprado mas ainda não recebido não aparece: a ficha do produto
    // (EAN, peso, validade) está na caixa que ainda não chegou.
    if (itensComprados.length > 0) {
      grupos.push({
        label: `Já chegou e não está no catálogo (${itensComprados.length})`,
        opcoes: itensComprados.map(i => ({ value: i.descricao, label: i.descricao, hint: i.fornecedor })),
      });
    }
    return grupos;
  }, [itensAguardandoPedido, itensComprados, emImplantacao, origemExigida, itemCompradoSel]);

  // Escolha no SelectBusca de origem. Mesma lógica de antes (era o onChange
  // inline do <select>): requisição traz nome/unidade/fornecedor sem custo (a
  // proposta é preço negociado, não apurado); item já chegado traz nome,
  // fornecedor e o custo do próprio pedido. Nos dois casos o saldo fica vazio —
  // ele vem do Confirmar, nunca daqui.
  const escolherOrigem = (desc: string) => {
    setItemCompradoSel(desc);
    setNomeDestravado(false);
    setExtrasErrors(ev => ({ ...ev, origem_compra: '' }));
    if (!desc || desc === SEM_COMPRA) return;
    if (desc.startsWith(REQ_PREFIX)) {
      const req = itensAguardandoPedido.find(i => i.id === desc.slice(REQ_PREFIX.length));
      if (!req) return;
      setForm(f => ({ ...f, nome: req.descricao }));
      clearError('nome');
      setExtras(x => ({
        ...x,
        // A requisição oferece SERV (serviço) além das unidades de produto:
        // jogar isso no select do cadastro deixaria o campo em branco, com
        // valor que nenhuma opção representa.
        unidade: x.unidade === 'UN' && unidadesDeProduto(filial).includes(normalizarUnidade(req.unidade))
          ? normalizarUnidade(req.unidade) : x.unidade,
        fornecedor:    x.fornecedor    || req.fornecedor,
        fornecedor_id: x.fornecedor_id || req.fornecedor_id,
        // Migr. 526: a marca decidida na proposta aprovada. Sugestão, como o
        // fornecedor (migr. 488) — quem cadastra confirma, e o que já foi
        // digitado não se perde.
        marca:         x.marca         || req.marca,
        // Nada chegou ainda: o saldo entra pelo Recebimento.
        estoque: '',
      }));
      return;
    }
    const comprado = itensComprados.find(i => i.descricao === desc);
    if (!comprado) return;
    setForm(f => ({ ...f, nome: comprado.descricao }));
    clearError('nome');
    // Só preenche o que está vazio: quem já digitou o fornecedor não perde o
    // que digitou.
    setExtras(x => ({
      ...x,
      fornecedor:    x.fornecedor    || comprado.fornecedor,
      fornecedor_id: x.fornecedor_id || comprado.fornecedor_id,
      marca:         x.marca         || comprado.marca,
      preco_custo: x.preco_custo || (comprado.custo != null ? formatBRL(comprado.custo) : ''),
      // O saldo passa a vir do recebimento; o que estava digitado aqui iria
      // junto, escondido, e dobraria a entrada.
      estoque: '',
    }));
  };

  // Custo obrigatório: só quando alguém REALMENTE sabe o número.
  //
  // A migr. 480 inverteu a ordem do fluxo — o produto passa a existir antes do
  // pedido, porque é o código que entra na compra. No cadastro antecipado de
  // mercadoria não há custo nenhum a declarar: a cotação ainda não aconteceu.
  // Exigir ali só produzia número inventado, e número inventado em preço de
  // custo vira markup falso na tela e CMV errado no DRE. O custo de verdade é
  // apurado por média ponderada no recebimento (migr. 417) e sobrescreve o que
  // estiver aqui.
  //
  // Continua obrigatório onde o valor é conhecido: patrimônio e consumo (é o
  // que se pagou), item que veio de uma compra recebida (o número vem
  // preenchido do pedido) e edição de produto já existente.
  // `editItem` sozinho era demais: produto criado antecipadamente nasce SEM
  // ficha de custo, e abrir para corrigir o nome passava a exigir um numero que
  // continua nao existindo — de volta ao chute que esta regra veio tirar. Só se
  // cobra na edicao quando o custo JA foi apurado: aí apagá-lo seria perder
  // informacao boa.
  const custoJaApurado = !!editItem
    && editItem.preco_custo != null && Number(editItem.preco_custo) > 0;
  // `!reqVinculo`: consumo e patrimônio pagam o valor de aquisição, e por isso o
  // custo é obrigatório neles — mas quando o cadastro está atendendo uma
  // requisição que AINDA espera o pedido, esse valor não existe. A cotação pode
  // nem ter acontecido, e o que houver é proposta, não custo apurado. Cobrar ali
  // é pedir número inventado, que é o mesmo motivo pelo qual a mercadoria já
  // estava fora (migr. 480/417).
  const custoObrigatorio = (!ehVendavel(extras.tipo) && !reqVinculo) || custoJaApurado || veioDeCompra;

  // A RLS de `categorias_produto` é `auth_pode_filial(filial)` — admin/CEO
  // satisfaz para as três, então sem este filtro o select do produto oferece o
  // catálogo inteiro da holding a quem opera a demo. Era inofensivo enquanto
  // categoria era só rótulo; virou preço errado quando ela passou a carregar a
  // markup-alvo. A categoria já gravada entra mesmo se for de outra filial,
  // senão editar um produto legado esvaziaria o campo em silêncio.
  const categoriasDaFilial = useMemo(
    () => categoriasProduto.filter((c: any) =>
      (c.filial == null || c.filial === filial) || c.id === extras.categoria_id),
    [categoriasProduto, filial, extras.categoria_id],
  );

  // Markup da categoria (migr. 360). A coluna se chama `margem_alvo` por
  // legado, mas o COMMENT dela no banco já diz "Markup-alvo" — e é markup que
  // ela guarda. O rótulo da tela agora concorda com o banco.
  const markupCategoria = useMemo(() => {
    const cat = categoriasProduto.find((c: any) => c.id === extras.categoria_id);
    const m = cat?.margem_alvo;
    return m == null || Number(m) <= 0 ? null : Number(m);
  }, [categoriasProduto, extras.categoria_id]);

  const precoSugerido = useMemo(() => {
    if (markupCategoria === null) return null;
    const custo = parseBRL(extras.preco_custo);
    if (!custo || custo <= 0) return null;
    return precoPorMarkup(custo, markupCategoria);
  }, [markupCategoria, extras.preco_custo]);
  // `validate` fica de fora: ele cobra toda chave de `form`, e `preco` deixou de
  // ser obrigatório para item que não se vende (migr. 440). A checagem base vive
  // em handleSave.
  const { errors, clearError, setErrors } = useFormValidation(form);
  const [extrasErrors, setExtrasErrors] = useState<Record<string, string>>({});

  // Imagens do produto — até PRODUTO_IMAGEM_MAX_SLOTS (capa + extras).
  // `imagens[i]` é a URL já persistida no bucket; `imagensAnteriores[i]`
  // guarda a referência original para apagarmos do Storage quando o usuário
  // troca/remove a imagem em modo edição. Índice 0 = capa (coluna
  // imagem_url, usada em PDV/Catálogo/Vitrine); 1/2 = imagem_url_2/3.
  const [imagens, setImagens] = useState<string[]>(() => Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(''));
  const [imagensAnteriores, setImagensAnteriores] = useState<string[]>(() => Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(''));
  const [imagemUploading, setImagemUploading] = useState<number | null>(null);
  // Aviso de resolução baixa por slot (não bloqueia o upload — só explica por
  // que aquela foto vai sair borrada na Vitrine).
  const [imagensAviso, setImagensAviso] = useState<(string | null)[]>(() => Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(null));
  const imagemInputRefs = useRef<(HTMLInputElement | null)[]>(Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(null));

  // Pesquisa e ordenação são server-side (codigo_seq DESC). Este sort só
  // reaplica o mesmo critério na página recebida — mantém a ordem estável se
  // um item for editado em memória. Não agrupa por filial: esta tela sempre
  // opera dentro de UMA filial (Matriz cai em MatrizConsolidado).
  const ordenarPorCodigoDesc = (rows: any[]) => [...rows].sort((a: any, b: any) => {
    const sa = Number(a.codigo_seq ?? 0);
    const sb = Number(b.codigo_seq ?? 0);
    if (sa !== sb) return sb - sa;
    return String(b.codigo ?? '').localeCompare(String(a.codigo ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
  });
  const filtered = ordenarPorCodigoDesc(data);

  // Exportação NÃO pode sair da página visível: `data` traz só 50 linhas
  // (paginação server-side). Refaz a query com os mesmos filtros e sem range,
  // igual ao padrão de ContasPagarView/ContasReceberView.
  const fetchAllForExport = async (): Promise<any[]> => {
    if (!supabase) return filtered;
    let q = supabase
      .from('produtos_com_custo')
      .select('*')
      .eq('ativo', true)
      .eq('filial', filial)
      .neq('tipo', 'patrimonio')
      .order('codigo_seq', { ascending: false });
    const termo = debouncedSearch.trim();
    if (termo) {
      // Mesmo escape do useFetchData: vírgula/parêntesis/asterisco têm
      // significado especial no `or()` do PostgREST.
      const safe = termo.replace(/[,()*]/g, ' ');
      q = q.or(['nome', 'codigo', 'categoria', 'ean', 'fornecedor'].map(c => `${c}.ilike.%${safe}%`).join(','));
    }
    const { data: rows, error: err } = await q;
    if (err) throw new Error(err.message);
    return ordenarPorCodigoDesc(rows ?? []);
  };

  // "Conteúdo" sai com a medida junto ("5 KG"). A coluna antiga não existia, e
  // o peso solto na planilha reproduziria fora do sistema a ambiguidade que a
  // migr. 438 acabou de fechar dentro dele.
  // Markup E margem: a planilha tem espaço para as duas, e é onde a turma
  // compara linha a linha. Antes saía uma coluna "Margem" com valor de markup.
  const exportCols = ['Código', 'Nome', 'Conteúdo', 'Categoria', 'Fornecedor', 'P. Custo', 'P. Venda', 'Markup %', 'Margem %', 'Estoque', 'Un.', 'Est. Mín', 'EAN', 'Status'];
  const buildExportRows = (rows: any[]) => rows.map((d: any) => {
    const mk = calcMarkup(parseNum(d.preco), parseNum(d.preco_custo));
    const mg = calcMargem(parseNum(d.preco), parseNum(d.preco_custo));
    const qtd = (v: any) => {
      const n = parseNum(v);
      return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    };
    return [
      d.codigo ?? '', d.nome ?? '',
      formatarConteudo(d.peso, d.peso_unidade),
      d.categoria ?? '', d.fornecedor ?? '',
      d.preco_custo ? fmtBRL(parseNum(d.preco_custo)) : '',
      d.preco ? fmtBRL(parseNum(d.preco)) : '',
      mk !== null ? fmtPct(mk) : '',
      mg !== null ? fmtPct(mg) : '',
      qtd(d.estoque), normalizarUnidade(d.unidade),
      qtd(d.estoque_minimo),
      d.ean ?? '', d.status ?? '',
    ];
  });
  // PDF combinado: tabela com todos os campos (igual ao Excel) + páginas de
  // etiquetas EAN-13 escaneáveis ao final, uma para cada produto com EAN válido.
  const handleExportPDF = async () => {
    try {
      const todos = await fetchAllForExport();
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF();

      doc.setFillColor(10, 10, 10);
      doc.rect(0, 0, 210, 32, 'F');
      doc.setTextColor(16, 185, 129);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('LogMax', 14, 14);
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text('Relatório Operacional', 14, 21);
      doc.setFontSize(11);
      doc.setTextColor(220, 220, 220);
      doc.text('Catálogo de Produtos', 14, 29);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 210 - 14, 29, { align: 'right' });

      autoTable(doc, {
        startY: 38,
        head: [exportCols],
        body: buildExportRows(todos),
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [10, 10, 10], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { textColor: [60, 60, 60], fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 245] },
      });

      const etiquetaInput = todos.map((p: any) => ({
        nome:     p.nome,
        ean:      p.ean,
        codigo:   p.codigo,
        preco:    p.preco != null ? parseNum(p.preco) : null,
        // Sem tamanho/cor, as 6 etiquetas de uma grade saem iguais (migr. 445).
        variante: rotuloVariante(p),
      }));
      drawEtiquetasGridOnDoc(doc, etiquetaInput, {
        titulo: 'Etiquetas EAN-13 — Produtos',
        startOnNewPage: true,
      });

      doc.save('logmax-produtos.pdf');
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gerar PDF.', 'error', true);
    }
  };
  const handleExportExcel = async () => {
    try {
      const todos = await fetchAllForExport();
      exportToExcel('Produtos', exportCols, buildExportRows(todos), 'logmax-produtos');
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gerar Excel.', 'error', true);
    }
  };

  // PDF só de etiquetas. Sem seleção, sai a página atual da listagem (o
  // comportamento antigo do botão PDF); com seleção, saem exatamente os itens
  // marcados, inclusive os de páginas/buscas anteriores.
  const handleExportEtiquetas = async () => {
    const alvo = selecionados.size > 0 ? Array.from(selecionados.values()) : filtered;
    if (alvo.length === 0) {
      showToast('Nada para gerar etiqueta.', 'error', true);
      return;
    }
    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      const desenhadas = drawEtiquetasGridOnDoc(
        doc,
        alvo.map((p: any) => ({
          nome:     p.nome,
          ean:      p.ean,
          codigo:   p.codigo,
          preco:    p.preco != null ? parseNum(p.preco) : null,
          variante: rotuloVariante(p),
        })),
        {
          titulo: selecionados.size > 0
            ? `Etiquetas EAN-13 — ${alvo.length} selecionado(s)`
            : 'Etiquetas EAN-13 — Produtos',
        },
      );
      // drawEtiquetasGridOnDoc descarta quem não tem EAN-13 válido e devolve
      // quantas desenhou. Zero = PDF em branco; avisa em vez de baixar vazio.
      if (desenhadas === 0) {
        showToast('Nenhum dos itens tem EAN-13 válido para etiqueta.', 'error', true);
        return;
      }
      doc.save(selecionados.size > 0 ? 'logmax-etiquetas-selecao.pdf' : 'logmax-etiquetas.pdf');
      if (desenhadas < alvo.length) {
        showToast(`${desenhadas} etiqueta(s) gerada(s). ${alvo.length - desenhadas} sem EAN-13 válido.`, 'info', true);
      } else {
        showToast(`${desenhadas} etiqueta(s) gerada(s).`, 'success', true);
      }
    } catch (err: any) {
      showToast(err?.message || 'Falha ao gerar etiquetas.', 'error', true);
    }
  };

  const openEdit = (item: any) => {
    // Sair de um cadastro novo para editar outro produto abandona o número
    // gerado tanto quanto fechar o formulário.
    liberarCodigo(codigoReservado);
    setCodigoReservado(null);
    setEditItem(item);
    setForm({
      codigo: item.codigo ?? '',
      nome:   item.nome   ?? '',
      preco:  item.preco != null && item.preco !== '' ? formatBRL(Number(item.preco)) : '',
    });
    setExtras({
      categoria:              item.categoria      ?? '',
      categoria_id:           item.categoria_id   ?? '',
      subcategoria_id:        item.subcategoria_id ?? '',
      preco_custo:            item.preco_custo != null && item.preco_custo !== '' ? formatBRL(Number(item.preco_custo)) : '',
      // numeric chega com escala fixa ("12.500"); `Number()` derruba o padding e
      // a máscara devolve a vírgula. Sem isso o campo mostrava 12.500 e o
      // operador lia doze mil e quinhentos.
      estoque:                item.estoque        != null ? qtdBR(item.estoque)        : '',
      estoque_minimo:         item.estoque_minimo != null ? qtdBR(item.estoque_minimo) : '',
      unidade:                item.unidade ?? 'UN',
      ean:                    item.ean            ?? '',
      fornecedor:             item.fornecedor     ?? '',
      // Linha anterior à 488 não tem a chave, só o nome: resolve pelo cadastro
      // da unidade para o select não abrir em branco no primeiro edit.
      fornecedor_id:          item.fornecedor_id
        ?? fornecedoresList.find((f: any) => f.nome === item.fornecedor)?.id
        ?? '',
      marca:                  item.marca          ?? '',
      // `Number()` derruba o zero-padding que o numeric(10,3) devolve ("5.000"
       // → 5); a vírgula é a que o operador digitou.
      peso:                   item.peso != null   ? String(Number(item.peso)).replace('.', ',') : '',
      // Vazio de propósito quando o banco não sabe: são as linhas herdadas em
      // que peso foi gravado sem medida (migr. 438 não adivinha g vs kg). O
      // select mostra "— Selecione —" e a validação cobra na primeira edição.
      peso_unidade:           item.peso_unidade ?? '',
      filial:                 filial,
      // `normalizarTipo`, não o ternário que estava aqui: ele mapeava tudo que
      // não fosse 'patrimonio' para 'estoque_venda', então abrir um item de
      // consumo para editar o RECLASSIFICAVA como mercadoria em silêncio — e
      // salvar o mandava para o PDV.
      tipo:                   normalizarTipo(item.tipo),
      patrimonio_numero:      item.patrimonio_numero      ?? '',
      patrimonio_responsavel: item.patrimonio_responsavel ?? '',
      patrimonio_localizacao: item.patrimonio_localizacao ?? '',
      patrimonio_vida_util_meses: item.patrimonio_vida_util_meses != null ? String(item.patrimonio_vida_util_meses) : '',
      elegivel_beneficios:    !!item.elegivel_beneficios,
      atributos:              (item.atributos && typeof item.atributos === 'object') ? item.atributos : {},
    });
    const imagensItem = [item.imagem_url ?? '', item.imagem_url_2 ?? '', item.imagem_url_3 ?? ''];
    setImagens(imagensItem);
    setImagensAnteriores(imagensItem);
    setImagensAviso(Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(null));
    setErrors({});
    setItemCompradoSel('');
    setNomeDestravado(false);
    // Trocar de produto com o painel de correção aberto aplicaria o número
    // digitado para o anterior no saldo do novo.
    setCorrigindoSaldo(false);
    setSaldoCorrigido('');
    setMotivoSaldo('');
    setAtrLivre(new Set());
    setShowForm(false);
  };

  const closeForm = () => {
    // Devolve o número para a fila. Desistir do cadastro não pode custar um
    // código do catálogo aos colegas — e quem clicar "Gerar" em seguida pega
    // este mesmo, sem esperar os 30 minutos do prazo da reserva.
    liberarCodigo(codigoReservado);
    setCodigoReservado(null);
    setShowForm(false);
    setEditItem(null);
    setItemCompradoSel('');
    setNomeDestravado(false);
    setCorrigindoSaldo(false);
    setSaldoCorrigido('');
    setMotivoSaldo('');
    setAtrLivre(new Set());
    setForm({ codigo: '', nome: '', preco: '' });
    // `atributosPadrao`: o cadastro novo nasce com o que a lei já responde —
    // hoje só a garantia de 90 dias da TechMax.
    setExtras({ ...EMPTY_EXTRAS, filial, atributos: atributosPadrao(filial) });
    setImagens(Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(''));
    setImagensAnteriores(Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(''));
    setImagensAviso(Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(null));
    setErrors({});
    setExtrasErrors({});
    imagemInputRefs.current.forEach(ref => { if (ref) ref.value = ''; });
  };

  // Upload de imagem: valida formato/tamanho bruto ANTES de decodificar.
  // Se aceito, faz upload para o bucket e guarda a URL pública no slot;
  // resolução baixa não bloqueia, só rende um aviso no slot.
  const handleImagemChange = async (slotIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validacao = validarImagemProduto(file);
    if (!validacao.ok) {
      showToast(validacao.motivo, 'error', true);
      e.target.value = '';
      return;
    }
    setImagemUploading(slotIdx);
    try {
      const aviso = await avaliarResolucaoImagem(file);
      const url = await uploadImagemProduto(file, editItem?.id, slotIdx + 1);
      setImagens(prev => prev.map((u, i) => i === slotIdx ? url : u));
      setImagensAviso(prev => prev.map((a, i) => i === slotIdx ? aviso : a));
      // A cobrança da capa some assim que ela chega — erro que fica na tela
      // depois de resolvido ensina o aluno a ignorar erro.
      if (slotIdx === 0) setExtrasErrors(ev => ({ ...ev, imagens: '' }));
      showToast(aviso ? 'Imagem carregada — mas a resolução é baixa.' : 'Imagem carregada!', aviso ? 'info' : 'success', true);
    } catch (err: any) {
      console.error('[Produtos] erro upload imagem:', err);
      showToast(err?.message ?? 'Falha ao enviar imagem.', 'error', true);
    } finally {
      setImagemUploading(null);
      e.target.value = '';
    }
  };

  const handleRemoverImagem = (slotIdx: number) => {
    setImagens(prev => prev.map((u, i) => i === slotIdx ? '' : u));
    setImagensAviso(prev => prev.map((a, i) => i === slotIdx ? null : a));
  };

  // Correção de saldo pela direção — via AJUSTE, não escrevendo `estoque`.
  //
  // O campo continua travado de propósito, e a trava é do banco
  // (`fn_block_estoque_manual` reverte em silêncio qualquer UPDATE direto).
  // Não foi frouxidão: `produtos.estoque` tem de ser SEMPRE igual à soma das
  // movimentações ativas — é a invariante que a migr. 268 chamou de "estoque
  // razão único", e é dela que vivem o inventário, o CMV e a conferência.
  // Escrever o número na mão faria saldo e razão divergirem sem deixar rastro.
  //
  // Então o professor digita o número CERTO (que é a ergonomia pedida) e o
  // sistema grava a DIFERENÇA como 'Ajuste +' / 'Ajuste −', com o motivo. O
  // saldo chega onde ele quer, a razão continua fechando, e a correção aparece
  // no histórico com autor e data — que é o que uma correção de professor
  // precisa ter para virar material de aula.
  const aplicarCorrecaoSaldo = async () => {
    if (!editItem || !supabase) return;
    const atual    = Number(editItem.estoque ?? 0);
    const desejado = parseQtd(saldoCorrigido);
    if (!Number.isFinite(desejado) || desejado < 0) {
      showToast('Informe o saldo correto (zero ou mais).', 'error', true);
      return;
    }
    if (!motivoSaldo.trim()) {
      showToast('Escreva o motivo da correção — é o que explica o ajuste no histórico.', 'error', true);
      return;
    }
    // Tolerância de meia milésima: `estoque` é numeric(15,3) e a comparação
    // exata acusa diferença de nada em item fracionário (mesma régua do teto
    // de recebimento).
    const diferenca = desejado - atual;
    if (Math.abs(diferenca) <= 0.0005) {
      showToast('O saldo já é esse — nada a corrigir.', 'info', true);
      return;
    }
    setSalvandoSaldo(true);
    try {
      const { error } = await supabase.rpc('movimentar_estoque', {
        p_produto_id: editItem.id,
        p_tipo:       diferenca > 0 ? 'Ajuste +' : 'Ajuste −',
        p_qtd:        Math.abs(diferenca),
        p_origem:     `Correção da direção — ${motivoSaldo.trim()}`,
        p_destino:    null,
        p_filial:     filial,
      });
      if (error) throw new Error(error.message);
      // Espelha na grade e no formulário sem esperar reload — o saldo mudou
      // no banco pelo trigger, e `editItem` é o que o painel lê.
      setEditItem((prev: any) => prev ? { ...prev, estoque: desejado } : prev);
      setExtras(x => ({ ...x, estoque: formatQtd(String(desejado), fracionario) }));
      setData((prev: any[]) => prev.map(d => d.id === editItem.id ? { ...d, estoque: desejado } : d));
      setCorrigindoSaldo(false);
      setSaldoCorrigido('');
      setMotivoSaldo('');
      showToast(
        `Saldo corrigido para ${qtdBR(desejado)} ${extras.unidade} — lançado como ${diferenca > 0 ? 'Ajuste +' : 'Ajuste −'} de ${qtdBR(Math.abs(diferenca))} em Estoque > Movimentações, com o motivo.`,
        'success', true);
    } catch (err: any) {
      showToast(`Não foi possível corrigir: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setSalvandoSaldo(false);
    }
  };

  // Encerrar a correção devolvida pela direção (migr. 502).
  //
  // Quem tem a caneta é o RESPONSÁVEL (quem fez a movimentação devolvida), o
  // gerente da unidade ou a direção — o colega de setor não, porque o ponto do
  // exercício é quem errou corrigir. A régua real está na RPC; aqui é só para
  // não mostrar um botão que voltaria 42501.
  const podeEncerrarCorrecao = !!editItem?.correcao_pendente && (
    editItem.correcao_responsavel_id === profile?.id
    || (profile?.role === 'gerente' && profile?.filial === filial)
    || profile?.role === 'admin'
  );
  const [encerrandoCorrecao, setEncerrandoCorrecao] = useState(false);

  const encerrarCorrecao = async () => {
    if (!editItem || !supabase) return;
    setEncerrandoCorrecao(true);
    try {
      const { error } = await supabase.rpc('concluir_correcao_produto', {
        p_produto_id: editItem.id,
      });
      if (error) throw new Error(error.message);
      const limpo = {
        correcao_pendente: false, correcao_motivo: null,
        correcao_solicitada_por: null, correcao_solicitada_em: null,
        correcao_responsavel_id: null,
      };
      setEditItem((prev: any) => prev ? { ...prev, ...limpo } : prev);
      setData((prev: any[]) => prev.map(d => d.id === editItem.id ? { ...d, ...limpo } : d));
      showToast('Correção encerrada — o produto saiu da lista de pendências.', 'success', true);
    } catch (err: any) {
      showToast(`Não foi possível encerrar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setEncerrandoCorrecao(false);
    }
  };

  const handleSave = async () => {
    // `validate()` do useFormValidation cobra TODA chave de `form`, e `preco` é
    // uma delas — era isso que forçava o aluno a inventar um preço de venda para
    // resma de papel e para freezer. A régua passou a depender do tipo (migr.
    // 440), então a checagem base é escrita aqui.
    const vendavel = ehVendavel(extras.tipo);
    const eb: Record<string, string> = {};
    if (!form.codigo.trim())            eb.codigo = 'Campo obrigatório';
    if (!form.nome.trim())              eb.nome   = 'Campo obrigatório';
    if (vendavel && !form.preco.trim()) eb.preco  = 'Campo obrigatório';
    if (Object.keys(eb).length) {
      setErrors(eb);
      showToast('Preencha todos os campos obrigatórios.', 'error', true);
      return;
    }
    setErrors({});

    // Validação de campos obrigatórios extras (não gerenciados por useFormValidation)
    const ee: Record<string, string> = {};
    // Marca só se cobra de embalagem fechada de revenda. Hortifruti não tem
    // marca — banana, tomate, alface —, e o campo obrigatório só produzia
    // "Diversos" em 61% do catálogo da mercearia. Mesma régua do peso (438):
    // quem é vendido a granel não tem rótulo para declarar.
    if (vendavel && temConteudoDeEmbalagem(extras.unidade) && !extras.marca.trim()) {
      ee.marca = 'Obrigatório';
    }
    // Conteúdo da embalagem: cobrado só de quem tem embalagem (migr. 438).
    // Antes era obrigatório em toda a SuperMax, inclusive no granel — e é por
    // isso que a coluna acumulou `1` como valor mais comum.
    if (mostraPesoConteudo) {
      if (!extras.peso.trim())        ee.peso = 'Obrigatório';
      // Número sem medida é o defeito que a 438 veio desfazer: não deixa nascer
      // um valor novo sem unidade, mesmo que exista dado herdado assim.
      else if (!extras.peso_unidade)  ee.peso = 'Informe a medida (G, KG, ML ou L)';
    }
    // Categoria carrega o markup-alvo que sugere o preço de venda: não faz
    // sentido exigi-la de quem não vende.
    if (vendavel && !extras.categoria_id) ee.categoria_id = 'Selecione uma categoria';
    // Fornecedor NÃO é obrigatório (migr. 488): pós-480 o cadastro vem antes
    // da compra, e quem fornece é a cotação que decide comparando propostas.
    // Cobrar aqui só produzia nome escolhido no chute — o mesmo defeito que o
    // preço de custo obrigatório tinha.
    if (custoObrigatorio && !extras.preco_custo.trim()) ee.preco_custo = 'Obrigatório';
    // Patrimônio não tem ponto de reposição — não se repõe um freezer.
    if (temEstoque(extras.tipo) && extras.estoque_minimo === '') {
      ee.estoque_minimo = 'Obrigatório';
    }
    // Foto de capa obrigatória. Vale para os três tipos: a capa é o que o PDV,
    // o Catálogo, a vitrine e a conferência do recebimento mostram, e produto
    // sem foto vira uma lista de nomes parecidos em que ninguém confere se
    // pegou o item certo. É a CAPA, e não "uma das três": gravar só um extra
    // deixa `imagem_url` nulo e a lista continua com o ícone padrão.
    if (!(imagens[0] ?? '').trim()) {
      ee.imagens = 'Adicione a foto de capa — é ela que aparece no PDV, no Catálogo e na vitrine.';
    }
    // A pergunta não é mais "de qual compra veio", e sim "já chegou ou ainda
    // vai ser comprado" — a migr. 480 fez do cadastro antecipado a regra. O
    // campo continua obrigatório enquanto houver carga recebida fora do
    // catálogo, porque é aí que mora a duplicata: cadastrar do zero um item que
    // está na doca esperando o Confirmar cria o segundo cadastro do mesmo
    // produto. Editar produto existente não passa por aqui.
    // `origemSemOpcoes` (defesa em profundidade — o botão já vem desabilitado,
    // mas o F12 não passa pela UI): sem nenhuma opção real, o erro tem de
    // apontar para fora da tela, não para um select que não tem o que oferecer.
    if (origemSemOpcoes) {
      ee.origem_compra = 'Nenhuma requisição está esperando este cadastro. Abra uma em Requisições > Do Setor > Compra eventual.';
    } else if (origemExigida && !itemCompradoSel) {
      ee.origem_compra = emImplantacao
        ? 'Escolha a requisição que este cadastro atende, um dos itens que já chegaram — ou "saldo de implantação".'
        : 'Escolha a requisição que este cadastro atende, ou um dos itens que já chegaram.';
    }

    // EAN só entra se for EAN. Dígito verificador errado não é "quase certo":
    // a etiqueta é descartada em silêncio na hora de imprimir e o leitor do PDV
    // nunca acha o produto — o erro aparece dias depois, longe de onde foi
    // cometido.
    const eanDigitado = extras.ean.replace(/\D/g, '');
    // Mercadoria sem código de barras é digitação à mão na fila do caixa —
    // exatamente a etapa que o PDV existe para eliminar. Patrimônio e material
    // de consumo não passam pelo caixa e seguem opcionais. Mesma régua da
    // migr. 443, que é quem barra de verdade.
    if (vendavel && eanDigitado.length === 0) {
      ee.ean = 'Obrigatório em mercadoria — use “Gerar” se não houver o do fabricante.';
    }
    if (eanDigitado.length > 0) {
      const n = normalizeEan13(extras.ean);
      if (!n.valid) {
        ee.ean = eanDigitado.length === 13
          ? 'Dígito verificador não confere — confira o número.'
          : `EAN-13 tem 12 ou 13 dígitos (você digitou ${eanDigitado.length}).`;
      }
    }
    // Ficha do nicho só se cobra de mercadoria. Era bloqueio duro: cadastrar um
    // manequim como patrimônio na MaxLook exigia Tamanho, Cor e Gênero, porque
    // este loop nunca olhou o tipo.
    const atrDefs = vendavel ? (ATRIBUTOS_PRODUTO[filial] ?? []) : [];
    for (const d of atrDefs) {
      // `reqSe`: obrigatório só quando o pai está marcado. Perecível sem prazo
      // devolve o cálculo da validade para a digitação à mão no recebimento —
      // que é exatamente o que a ficha existe para evitar.
      const dependente = !!d.dependeDe;
      const paiValor   = dependente ? extras.atributos?.[d.dependeDe!] : undefined;
      const paiMarcado = dependente && (d.dependeDeValor !== undefined
        ? String(paiValor ?? '') === d.dependeDeValor
        : paiValor === true);
      const exigido = d.req || (d.reqSe && paiMarcado);
      if (!exigido) continue;
      if (dependente && !paiMarcado) continue;
      const v = extras.atributos?.[d.key];
      if (v === undefined || v === null || String(v).trim() === '') {
        ee[`atr_${d.key}`] = 'Obrigatório';
      }
    }
    if (Object.keys(ee).length) {
      setExtrasErrors(ee);
      showToast('Preencha todos os campos obrigatórios.', 'error', true);
      return;
    }
    setExtrasErrors({});

    // Vender abaixo do custo salvava calado, e o prejuízo só aparecia no DRE
    // semanas depois, como lucro bruto negativo que ninguém sabe de onde veio.
    // Avisa e deixa seguir: queima de estoque e isca de vitrine existem, e são
    // decisão de quem vende — o que não pode é ser sem querer.
    const custoNum = parseBRL(extras.preco_custo);
    const vendaNum = parseBRL(form.preco);
    if (vendavel && custoNum > 0 && vendaNum > 0 && vendaNum < custoNum) {
      const segue = await confirm(
        `O preço de venda (R$ ${formatBRL(vendaNum)}) está abaixo do custo (R$ ${formatBRL(custoNum)}).\n\n`
        + `Cada unidade vendida dá um prejuízo de R$ ${formatBRL(custoNum - vendaNum)}, e isso entra no DRE `
        + 'como lucro bruto negativo.\n\nÉ intencional (queima de estoque, isca de vitrine)?');
      if (!segue) return;
    }

    setIsSaving(true);
    showToast(editItem ? 'Atualizando produto...' : 'Salvando produto...', 'info', false);
    try {
      // parseQtd, não parseInt: `produtos.estoque` e `movimentacoes_estoque.qtd`
      // são numeric(15,3) desde a migr. 079 justamente para a mercearia receber
      // 12,5 KG. O parseInt daqui truncava para 12 sem avisar ninguém.
      const estoqueInicial = parseQtd(extras.estoque);
      // payload base — nunca inclui `estoque` no UPDATE (read-only após criação;
      // saldo só muda via movimentacoes_estoque). Trigger SQL também trava.
      const isPatrimonio = extras.tipo === 'patrimonio';
      // `null` quando em branco, não 0: o cadastro antecipado ainda não tem
      // custo, e zero na grade se lê como "custa zero" em vez de "ninguém
      // apurou ainda".
      const custoInformado = extras.preco_custo.trim() !== '';
      const custoValor   = custoInformado ? parseBRL(extras.preco_custo) : 0;
      const custoNaGrade = custoInformado ? custoValor : null;
      const basePayload = {
        ...form,
        // Zero, não o que sobrou digitado: se o aluno preencheu o preço e
        // depois trocou o tipo para consumo, persistir o valor deixaria a resma
        // com etiqueta de venda. A coluna é NOT NULL DEFAULT 0.
        preco:                  vendavel ? parseBRL(form.preco) : 0,
        categoria:              extras.categoria,
        // preco_custo saiu daqui: vai para produtos_custo via salvarPrecoCusto().
        // numeric(15,3) desde a migr. 438 — mínimo de 2,5 KG é legítimo numa
        // mercearia, e o integer anterior o arredondava.
        estoque_minimo:         parseQtd(extras.estoque_minimo),
        unidade:                extras.unidade || 'UN',
        // Normalizado: quem digita os 12 dígitos do fornecedor tem o dígito
        // verificador calculado e gravado. Guardar o que foi digitado deixava o
        // banco com EAN de 12 dígitos que a etiqueta e o scanner não aceitam.
        // Fora de mercadoria o campo nem aparece: um EAN que sobrou de quando o
        // item era mercadoria iria junto, e código de barras de patrimônio
        // acabaria lido no caixa.
        ean:                    vendavel && eanDigitado ? normalizeEan13(extras.ean).value : '',
        fornecedor:             extras.fornecedor,
        fornecedor_id:          extras.fornecedor_id || null,
        marca:                  extras.marca || null,
        // Conteúdo da embalagem viaja em par: valor + medida, ou nada. Granel
        // limpa os dois — se o aluno digitou 5 KG e depois trocou a unidade de
        // estoque para KG, o "5 KG por embalagem" deixou de existir e ficaria
        // mentindo na ficha. O CHECK chk_produtos_peso_unidade_orfa (migr. 438)
        // barra unidade sem valor no banco; aqui a regra é a mesma, antes.
        peso:                   mostraPesoConteudo && extras.peso !== '' ? parseQtd(extras.peso) : null,
        peso_unidade:           mostraPesoConteudo && extras.peso !== '' ? (extras.peso_unidade || null) : null,
        filial:                 filial,
        categoria_id:           extras.categoria_id || null,
        subcategoria_id:        extras.subcategoria_id || null,
        imagem_url:             imagens[0] || null,
        imagem_url_2:           imagens[1] || null,
        imagem_url_3:           imagens[2] || null,
        tipo:                   extras.tipo,
        // Campos de patrimônio só viajam quando tipo='patrimonio' — limpa quando
        // o produto vira (ou volta a ser) estoque/venda.
        patrimonio_numero:      isPatrimonio ? (extras.patrimonio_numero      || null) : null,
        patrimonio_responsavel: isPatrimonio ? (extras.patrimonio_responsavel || null) : null,
        patrimonio_localizacao: isPatrimonio ? (extras.patrimonio_localizacao || null) : null,
        patrimonio_vida_util_meses: isPatrimonio && extras.patrimonio_vida_util_meses
          ? Number(extras.patrimonio_vida_util_meses) : null,
        // Patrimônio não vai pro PDV, então força elegivel_beneficios=false.
        // Elegível benefícios só se aplica ao SuperMax (supermercado) — MaxLook
        // e TechMax não têm itens elegíveis por natureza (roupa, eletrônico).
        elegivel_beneficios:    !vendavel || filial !== 'SuperMax' ? false : !!extras.elegivel_beneficios,
        // Atributos JSONB por nicho (só campos declarados em ATRIBUTOS_PRODUTO
        // pra filial atual — evita salvar lixo se o operador trocou de filial
        // no meio do fluxo).
        atributos: (() => {
          const defs = vendavel ? (ATRIBUTOS_PRODUTO[filial] ?? []) : [];
          const out: Record<string, any> = {};
          for (const d of defs) {
            const v = extras.atributos?.[d.key];
            if (v === undefined || v === null || v === '') continue;
            out[d.key] = d.type === 'bool' ? !!v : v;
          }
          return out;
        })(),
      };
      if (editItem) {
        const updated = await dbUpdate('/api/produtosview', editItem.id, basePayload);
        await salvarPrecoCusto(editItem.id, custoValor);
        // Virou patrimônio: sai desta listagem, que filtra `tipo neq patrimonio`
        // no servidor. Antes ele continuava na grade até o próximo reload e
        // então desaparecia sem explicação.
        if (isPatrimonio) {
          setData((prev: any[]) => prev.filter(d => d.id !== editItem.id));
        } else {
          // `updated` vem de `produtos` e não traz preco_custo — reinjeta o valor
          // salvo para a grade refletir a edição sem esperar um reload.
          setData((prev: any[]) => prev.map(d =>
            d.id === editItem.id
              ? { ...(updated ?? { ...d, ...basePayload }), preco_custo: custoNaGrade }
              : d));
        }
        // Best-effort cleanup: se alguma imagem foi trocada ou removida,
        // apaga a antiga do bucket. Falha aqui não bloqueia o sucesso do UPDATE.
        imagensAnteriores.forEach((urlAntiga, i) => {
          if (urlAntiga && urlAntiga !== imagens[i]) {
            removerImagemAntiga(urlAntiga).catch(() => {});
          }
        });
        showToast(
          isPatrimonio
            ? 'Item atualizado como Patrimônio — ele sai desta lista e passa a ser gerido em Financeiro > Patrimônio.'
            : 'Produto atualizado!',
          'success', true);
      } else {
        // Cria com estoque = 0 e gera UMA movimentação de Entrada (Saldo
        // Inicial) se o operador informou abertura > 0. O trigger
        // fn_atualiza_estoque_produto soma a quantidade ao saldo.
        //
        // Havia um segundo campo aqui, "Quantidade Comprada", que gerava outra
        // Entrada com origem 'Compra inicial'. Duas coisas erradas de uma vez:
        // quem entendia "comprei 50 para abrir" preenchia os dois e ficava com
        // 100 no saldo; e a tal compra não gerava conta a pagar nem apuração de
        // custo — o oposto do fluxo de Recebimentos que a migr. 417 tornou
        // obrigatório para todo o resto do sistema. Compra entra por Compras.
        const insertPayload = { ...basePayload, estoque: 0, status: 'Ativo' };
        const saved = await dbInsert<any>('/api/produtosview', insertPayload);
        const novoId = saved?.id;
        // Campo em branco (cadastro antecipado) não vira ficha de custo: gravar
        // zero com `origem: 'manual'` diria que alguém apurou e chegou a zero.
        // Sem linha, `custo_origem` fica nulo e a tela mostra "—" até o
        // recebimento apurar — que é a verdade.
        if (novoId && extras.preco_custo.trim() !== '') await salvarPrecoCusto(novoId, custoValor);
        // O vínculo com a requisição (migr. 494). Falhar aqui não desfaz o
        // cadastro — o produto existe e é bom —, mas o comprador precisa saber,
        // senão volta para Cotações e reencontra o modal do catálogo sem
        // entender por quê. Vai por RPC porque `requisicoes` é escrita do setor
        // solicitante: a função toca UMA coluna, e só quando ela está nula.
        let vinculoFalhou = '';
        if (novoId && reqVinculo && supabase) {
          const { error: vincErr } = await supabase.rpc('vincular_produto_requisicao', {
            p_requisicao_id: reqVinculo.id,
            p_produto_id:    novoId,
          });
          if (vincErr) {
            console.error('[Produtos] falha ao vincular requisição:', vincErr);
            vinculoFalhou = vincErr.message ?? 'motivo não informado';
          } else {
            // Tira a requisição da lista sem esperar refetch: sem isto ela
            // continua oferecida no próximo cadastro, e a segunda tentativa
            // morre no "já aponta para um produto" — erro que o aluno lê como
            // defeito da tela.
            setRequisicoesDaFilial((prev: any[]) =>
              prev.map(r => r.id === reqVinculo.id ? { ...r, produto_id: novoId } : r));
          }
        }
        const hoje = todayBR();
        let saldoFinal = 0;
        if (novoId && estoqueInicial > 0) {
          try {
            await dbInsert('/api/movimentacoesestoqueview', {
              produto_id: novoId,
              tipo:       'Entrada',
              qtd:        estoqueInicial,
              origem:     'Saldo Inicial de Implantação',
              destino:    'Almoxarifado',
              data:       hoje,
              filial:     basePayload.filial,
            });
            saldoFinal += estoqueInicial;
          } catch (movErr: any) {
            console.warn('[Produtos] Falha ao registrar saldo inicial:', movErr?.message ?? movErr);
            showToast('Produto criado, mas saldo inicial não foi registrado. Verifique movimentações.', 'error', true);
          }
        }
        if (saved) { saved.estoque = saldoFinal; saved.preco_custo = custoNaGrade; }
        // Patrimônio não entra na grade: o filtro server-side (`tipo neq
        // patrimonio`) o excluiria no reload. Empurrar para `data` fazia o item
        // aparecer, o aluno ler "criado com sucesso" e o produto evaporar no F5.
        if (!isPatrimonio) {
          setData([saved ?? { id: Date.now(), ...insertPayload, estoque: saldoFinal, preco_custo: custoNaGrade }, ...data]);
        }
        // Veio de item comprado: o cadastro é o MEIO do fluxo, não o fim. Sem
        // dizer para onde ir agora, o aluno fecha a tela achando que terminou —
        // e o recebimento fica pendente, esperando um Confirmar que ninguém
        // sabe que falta.
        showToast(
          isPatrimonio
            ? 'Patrimônio cadastrado! Ele não aparece nesta lista — está em Financeiro > Patrimônio.'
            : veioDeCompra
              ? 'Produto criado com saldo zero. Agora volte em Estoque > Recebimentos e clique em Confirmar na linha deste pedido — é lá que a quantidade entra no estoque.'
              : reqVinculo
                // Mesma lógica do texto acima: o cadastro é o meio do fluxo. Aqui
                // o próximo passo é o pedido, que agora sai sem perguntar nada.
                ? (vinculoFalhou
                    ? `Produto criado, mas a requisição ${reqVinculo.numero} não ficou vinculada (${vinculoFalhou}). Em Compras > Cotações, o Gerar Pedido ainda vai pedir o item do catálogo — escolha este produto lá.`
                    : `Produto criado e vinculado à requisição ${reqVinculo.numero}. Agora é só ir em Compras > Cotações e clicar em Gerar Pedido — ele não vai mais pedir o item do catálogo.`)
                : 'Produto criado com sucesso!',
          vinculoFalhou ? 'error' : 'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Produtos] erro ao salvar:', err);
      // A reserva do "Gerar" (migr. 481) fecha o caminho comum, mas não o
      // código digitado à mão nem a reserva que venceu durante o preenchimento.
      // Quem cai aqui merece saber o que fazer, não a mensagem do Postgres.
      if (/duplicate key|23505/i.test(msg) && /codigo/i.test(msg)) {
        setErrors(e => ({ ...e, codigo: 'Já existe produto com este código nesta unidade' }));
        showToast(`O código ${form.codigo} já foi usado nesta unidade. Clique em "Gerar" para pegar o próximo livre — o resto do formulário continua preenchido.`, 'error', true);
      } else {
        showToast(`Erro ao salvar: ${msg}`, 'error', true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('Excluir este produto?')) return;
    try {
      await dbDelete('/api/produtosview', id);
      setData((prev: any[]) => prev.filter(d => d.id !== id));
      showToast('Produto excluído.', 'success', true);
    } catch (err: any) {
      const msg = err?.message ?? 'verifique o console';
      console.error('[Produtos] erro ao excluir:', err);
      showToast(`Erro ao excluir: ${msg}`, 'error', true);
    }
  };

  // Margem calculada ao vivo no formulário (parseBRL desempacota a máscara)
  const markupAoVivo = calcMarkup(parseBRL(form.preco), parseBRL(extras.preco_custo));
  const margemAoVivo = calcMargem(parseBRL(form.preco), parseBRL(extras.preco_custo));
  const isFormOpen = showForm || !!editItem;

  // ── Devolver o número quando o cadastro é abandonado ───────────────────────
  //
  // `closeForm` já devolve no Cancelar e no Salvar. O que escapava era o
  // abandono sem clique: trocar de módulo (desmonta a view), fechar a aba,
  // recarregar a PWA. Nesses casos o número ficava fora da fila até vencer a
  // reserva — e, com o heartbeat renovando de 10 em 10 minutos, uma aba
  // esquecida aberta segurava o número indefinidamente.
  //
  // O ref existe porque o cleanup do efeito lê o valor no momento em que a tela
  // morre, não o da renderização em que o efeito foi criado.
  const codigoReservadoRef = useRef<string | null>(null);
  useEffect(() => { codigoReservadoRef.current = codigoReservado; }, [codigoReservado]);

  // Token capturado enquanto o formulário está aberto: no `pagehide` não dá
  // para esperar `getSession()` — é assíncrono, e a aba já foi.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFormOpen || !supabase) return;
    supabase.auth.getSession().then(({ data }) => { tokenRef.current = data.session?.access_token ?? null; });
  }, [isFormOpen]);

  useEffect(() => {
    // `fetch` com keepalive, e não a RPC do supabase-js: a requisição do
    // cliente é cancelada junto com a aba, e é justamente no fechar que o
    // número precisa voltar.
    const devolverNoUnload = () => {
      const codigo = codigoReservadoRef.current;
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      if (!codigo || !url || !key || !tokenRef.current) return;
      fetch(`${url}/rest/v1/rpc/liberar_codigo_produto`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ p_filial: filial, p_codigo: codigo }),
      }).catch(() => {});
    };
    // `pagehide` e não `beforeunload`: no iOS o segundo não dispara, e é tablet
    // que a turma usa.
    window.addEventListener('pagehide', devolverNoUnload);
    return () => {
      window.removeEventListener('pagehide', devolverNoUnload);
      // Saiu da tela (trocou de módulo ou de unidade) com o formulário aberto:
      // aqui a chamada normal ainda tem tempo de completar.
      liberarCodigo(codigoReservadoRef.current);
    };
  }, [filial]);

  // O formulário fica ACIMA da tabela. Clicar em editar numa linha do fim da
  // lista abria o form fora da viewport, e o operador tinha de rolar até o topo
  // para descobrir que alguma coisa havia acontecido. Mesmo padrão de
  // Funcionários, Metas e Folha. `editItem?.id` na dependência cobre trocar de
  // produto com o form já aberto.
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isFormOpen) return;
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formRef.current?.querySelector<HTMLInputElement>('input, select')?.focus();
    });
  }, [isFormOpen, editItem?.id]);

  // Heartbeat da reserva de código (migr. 498). A reserva vale 30 minutos, e a
  // ficha longa (grade da MaxLook, garantia/IMEI da TechMax) leva mais que isso
  // quando o aluno é interrompido no meio — aí o número já era de outro e o
  // Salvar morria num 23505 que ninguém liga ao tempo parado. A cada 10 minutos
  // o formulário aberto renova o prazo do número que já tem; a RPC devolve o
  // mesmo código, então nada muda na tela.
  useEffect(() => {
    if (!isFormOpen || !codigoReservado || !supabase) return;
    const sb = supabase;
    const id = setInterval(() => {
      sb.rpc('reservar_codigo_produto', { p_filial: filial, p_codigo_atual: codigoReservado })
        .then(undefined, () => {});   // best-effort: falhar aqui não atrapalha o cadastro
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [isFormOpen, codigoReservado, filial]);

  // EAN-13 — preview ao vivo
  const eanNorm = normalizeEan13(extras.ean);
  const eanPreviewRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!isFormOpen) return;
    const canvas = eanPreviewRef.current;
    if (!canvas) return;
    if (eanNorm.valid) {
      try { drawEan13ToCanvas(canvas, eanNorm.value, { moduleWidth: 2, barHeight: 56 }); }
      catch { /* ignora — pattern inválido */ }
    } else {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [isFormOpen, eanNorm.value, eanNorm.valid]);

  const downloadLabelFor = async (item: { ean?: string; nome?: string; codigo?: string; preco?: any; atributos?: any }) => {
    try {
      await downloadEan13LabelPdf({
        ean: item.ean ?? '',
        nome: item.nome,
        codigo: item.codigo,
        preco: item.preco != null ? parseNum(item.preco) : null,
        variante: rotuloVariante(item),
        filename: `etiqueta-${item.codigo || normalizeEan13(item.ean).value}`,
      });
      showToast('Etiqueta gerada!', 'success', true);
    } catch (err: any) {
      showToast(err?.message || 'EAN-13 inválido para gerar etiqueta.', 'error', true);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Produtos — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">Gerencie o portfólio de itens do estoque e suas informações.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center w-full sm:w-auto">
          <BotaoModeloPlanilha entidade="produtos" filial={filial} showToast={showToast} />
          <button
            type="button"
            onClick={() => setImportando(true)}
            title="Ler um arquivo preenchido e cadastrar em lote"
            className="neu-button py-2 px-4 rounded-xl text-xs font-bold text-gray-300 hover:text-accent transition-colors flex items-center gap-2"
          >
            <Upload size={14} /> Importar planilha
          </button>
          {data.length > 0 && (
            <>
              <ExportButton
                label={selecionados.size > 0 ? `Etiquetas (${selecionados.size})` : 'Etiquetas'}
                onClick={handleExportEtiquetas}
                icon={Barcode}
              />
              {selecionados.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelecionados(new Map())}
                  className="text-[11px] text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
                  title="Desmarcar todos os produtos selecionados"
                >
                  limpar seleção
                </button>
              )}
              <ExportButton label="PDF"   onClick={handleExportPDF}   icon={FileDown} />
              <ExportButton label="Excel" onClick={handleExportExcel} icon={Sheet} />
            </>
          )}
          <div className="relative flex-1 sm:flex-none">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="Buscar produto..." className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <NeuButtonAccent onClick={() => { closeForm(); setShowForm(v => !v); }}><Plus size={16} /> Novo</NeuButtonAccent>
        </div>
      </div>

      {/* Formulário */}
      <AnimatePresence>
        {isFormOpen && (
          <motion.div ref={formRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-5">
              <h3 className="text-sm font-bold text-gray-200">{editItem ? 'Editar Produto' : 'Novo Produto'}</h3>

              {/* Correção devolvida pela direção (migr. 502). Primeira coisa do
                  formulário porque é a razão de o aluno estar nesta tela: sem o
                  motivo à vista, "corrija o produto" não diz o que corrigir. */}
              {editItem?.correcao_pendente && (
                <div className="neu-pressed rounded-xl p-4 border border-amber-400/30 flex flex-col gap-2">
                  <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">
                    Precisa de correção
                  </span>
                  <p className="text-xs text-gray-200 leading-relaxed">{editItem.correcao_motivo}</p>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    A direção desfez uma movimentação deste produto — o saldo já foi estornado.
                    Corrija o que está apontado acima e salve. Quando estiver certo, encerre a
                    pendência no botão ao lado.
                  </p>
                  {podeEncerrarCorrecao ? (
                    <button type="button" onClick={encerrarCorrecao} disabled={encerrandoCorrecao}
                      className="neu-button py-1.5 px-3 rounded-lg text-[11px] font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors self-start disabled:opacity-50">
                      {encerrandoCorrecao ? 'Encerrando...' : 'Correção concluída'}
                    </button>
                  ) : (
                    // Não é falta de permissão de tela: é segregação. Quem
                    // encerra é quem fez, o gerente da unidade ou a direção.
                    <p className="text-[10px] text-gray-500 leading-snug">
                      Quem encerra esta pendência é quem fez a movimentação, o gerente da unidade
                      ou a direção.
                    </p>
                  )}
                </div>
              )}

              {/* A leitura circular já apareceu em sala: "para confirmar o
                  recebimento preciso do produto, e o produto depende do
                  recebimento". Não é círculo, é fila — mas só dentro do painel
                  de saldo isso não bastava. Aqui em cima, sempre visível, com o
                  passo atual marcado. */}
              {(origemExigida || reqVinculo) && (
                <div className="neu-pressed rounded-xl px-4 py-2.5 border border-white/5 text-[10px] text-gray-500 leading-relaxed">
                  Requisição → Aprovação → Cotação → Aprovação da cotação →{' '}
                  <span className="text-accent font-bold">Cadastro (você está aqui)</span> →
                  Gerar Pedido → Em Entrega → Recebimento → Confirmar
                </div>
              )}

              {/* Tipo = DESTINO do item (migr. 440). É a primeira pergunta do
                  cadastro, não a última: ela decide o que o resto do formulário
                  ainda faz sentido perguntar. Antes eram dois valores e material
                  de consumo não cabia em nenhum — resma de papel virava
                  mercadoria e ia para o caixa. */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Classificação</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Tipo *">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={extras.tipo}
                      onChange={e => {
                        const t = normalizarTipo(e.target.value);
                        setExtras(x => ({ ...x, tipo: t }));
                        // Virou bem de uso: a origem escolhida deixa de existir
                        // (migr. 515). Deixá-la pendurada faria o Salvar chamar
                        // `vincular_produto_requisicao` só para receber a recusa
                        // e avisar, depois de gravar, que o vínculo não saiu.
                        if (!temEstoque(t) && itemCompradoSel) {
                          setItemCompradoSel('');
                          setNomeDestravado(false);
                          setExtrasErrors(ev => ({ ...ev, origem_compra: '' }));
                        }
                      }}>
                      {TIPOS_PRODUTO.map(t => (
                        <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                      {/* Patrimônio é criado SÓ aqui — Financeiro > Patrimônio é
                          só leitura —, mas a listagem filtra `tipo neq
                          patrimonio` no servidor. Dizer antes do clique, não
                          depois do sumiço. */}
                      {extras.tipo === 'patrimonio' && (
                        <span className="text-amber-400/90 font-bold">Não aparece nesta lista. </span>
                      )}
                      {TIPO_AJUDA[extras.tipo]}
                    </p>
                  </FormField>
                </div>
                {extras.tipo === 'patrimonio' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 p-4 rounded-2xl neu-pressed border border-accent/20">
                    <FormField label="Nº de Patrimônio (tag)">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm font-mono"
                        value={extras.patrimonio_numero}
                        onChange={e => setExtras(x => ({ ...x, patrimonio_numero: e.target.value }))}
                        placeholder="Ex: TAG-2026-001" />
                    </FormField>
                    <FormField label="Responsável">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.patrimonio_responsavel}
                        onChange={e => setExtras(x => ({ ...x, patrimonio_responsavel: e.target.value }))}
                        placeholder="Ex: Ana Clara Campos" />
                    </FormField>
                    <FormField label="Localização">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.patrimonio_localizacao}
                        onChange={e => setExtras(x => ({ ...x, patrimonio_localizacao: e.target.value }))}
                        placeholder="Ex: Sala TI - Rio Branco" />
                    </FormField>
                    <FormField label="Vida útil (meses)">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm" type="number" min="1"
                        value={extras.patrimonio_vida_util_meses}
                        onChange={e => setExtras(x => ({ ...x, patrimonio_vida_util_meses: e.target.value }))}
                        placeholder="Ex: 60 (5 anos)" />
                      <p className="text-[10px] text-gray-500 mt-1">Vazio = não entra na depreciação do DRE.</p>
                    </FormField>
                  </div>
                )}
              </div>

              {/* Identificação */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Identificação</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Código *" error={errors.codigo}>
                    <div className="flex gap-2">
                      <input className={`neu-input py-2 px-3 rounded-xl text-sm flex-1 min-w-0 font-mono ${errors.codigo ? 'border border-red-500/40' : ''}`}
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
                        ? <>O <span className="font-mono text-accent">{codigoReservado}</span> está reservado para você — quem clicar em Gerar agora recebe o próximo. A reserva cai se você fechar o formulário sem salvar.</>
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
                      <input className={`neu-input py-2 px-3 rounded-xl text-sm font-mono flex-1 min-w-0 ${extrasErrors.ean ? 'border border-red-500/40' : ''}`}
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
                          {UNIDADES_CONTEUDO.map(u => <option key={u} value={u}>{u}</option>)}
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
                        O que vem dentro de uma embalagem — <span className="text-gray-400">5 KG</span> de arroz.
                        Quantas embalagens entram no estoque é a <span className="font-bold text-gray-400">Unidade</span> ({extras.unidade || 'UN'}), lá em Estoque.
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

              {/* Imagens do produto — capa + até 2 extras */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                  <ImagePlus size={12} /> Imagens do produto (até {PRODUTO_IMAGEM_MAX_SLOTS}) — capa obrigatória *
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {imagens.map((url, slotIdx) => (
                    <div key={slotIdx}
                      className={`neu-pressed rounded-2xl p-3 border flex flex-col items-center gap-2 ${
                        slotIdx === 0 && extrasErrors.imagens ? 'border-red-500/40' : 'border-white/5'
                      }`}>
                      <ProdutoThumb url={url} size="lg" alt={slotIdx === 0 ? (form.nome || 'Produto') : `${form.nome || 'Produto'} — foto ${slotIdx + 1}`} />
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                        {slotIdx === 0 ? 'Capa' : `Extra ${slotIdx}`}
                      </span>
                      <input
                        ref={el => { imagemInputRefs.current[slotIdx] = el; }}
                        type="file"
                        accept={PRODUTO_IMAGEM_ACCEPT}
                        onChange={e => handleImagemChange(slotIdx, e)}
                        className="hidden"
                      />
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => imagemInputRefs.current[slotIdx]?.click()}
                          disabled={imagemUploading === slotIdx}
                          className="neu-button py-1.5 px-3 rounded-xl text-[11px] font-bold text-gray-300 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {imagemUploading === slotIdx
                            ? <><Loader2 size={11} className="animate-spin" /> Enviando...</>
                            : <><ImagePlus size={11} /> {url ? 'Trocar' : 'Selecionar'}</>}
                        </button>
                        {url && imagemUploading !== slotIdx && (
                          <button
                            type="button"
                            onClick={() => handleRemoverImagem(slotIdx)}
                            className="neu-button py-1.5 px-2 rounded-xl text-[11px] font-bold text-gray-500 hover:text-red-500 transition-colors flex items-center gap-1"
                          >
                            <XIcon size={10} /> Remover
                          </button>
                        )}
                      </div>
                      {imagensAviso[slotIdx] && (
                        <p className="text-[10px] text-amber-400/90 leading-snug text-center flex items-start gap-1">
                          <AlertTriangle size={11} className="shrink-0 mt-px" />
                          <span>{imagensAviso[slotIdx]}</span>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {extrasErrors.imagens && (
                  <p className="text-[11px] text-red-400 mt-2 flex items-start gap-1">
                    <AlertTriangle size={12} className="shrink-0 mt-px" />
                    <span>{extrasErrors.imagens}</span>
                  </p>
                )}
                <p className="text-[11px] text-gray-500 leading-snug mt-2">
                  Aceita <span className="font-bold text-gray-300">JPG, PNG ou WEBP</span> — cada foto é comprimida
                  automaticamente para WebP até <span className="font-bold text-gray-300">{PRODUTO_IMAGEM_OUTPUT_MAX_LABEL}</span>,
                  então pode enviar direto da câmera. Use imagens de pelo menos{' '}
                  <span className="font-bold text-gray-300">{PRODUTO_IMAGEM_RES_IDEAL} px</span> no menor lado: miniatura
                  baixada da web fica borrada, porque o sistema reduz mas nunca amplia. A capa é a que aparece no PDV, Catálogo e vitrine — e por isso é obrigatória; as duas extras são opcionais.
                </p>
              </div>

              {/* Etiqueta EAN-13 */}
              {extras.ean.replace(/\D/g, '').length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                    <Barcode size={12} /> Etiqueta EAN-13
                  </p>
                  <div className="neu-pressed rounded-2xl p-4 border border-white/5 flex flex-col sm:flex-row items-center gap-4">
                    <div className="bg-white p-3 rounded-lg flex items-center justify-center min-h-[88px]">
                      {eanNorm.valid ? (
                        <canvas ref={eanPreviewRef} />
                      ) : (
                        <span className="text-[11px] text-gray-500 font-mono px-6 text-center">
                          Informe 12 ou 13 dígitos para visualizar
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2 w-full">
                      {eanNorm.valid ? (
                        <div className="flex items-center gap-2 text-emerald-400 text-xs">
                          <Check size={14} />
                          <span className="font-bold">EAN-13 válido:</span>
                          <span className="font-mono">{eanNorm.value}</span>
                          {eanNorm.autoCompleted && (
                            <span className="text-[10px] text-gray-500">(dígito verificador calculado)</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-yellow-400 text-xs">
                          <AlertCircle size={14} />
                          <span>
                            {eanNorm.digits.length === 13
                              ? 'Dígito verificador inválido — confira os números.'
                              : `Faltam ${Math.max(0, 12 - eanNorm.digits.length)} dígito(s) para validar.`}
                          </span>
                        </div>
                      )}
                      <p className="text-[11px] text-gray-500">
                        Imprima em adesivo 80×50 mm. O código é escaneável por qualquer leitor de código de barras compatível com EAN-13.
                      </p>
                      <div className="flex justify-start">
                        <NeuButtonAccent
                          onClick={() => downloadLabelFor({ ean: extras.ean, nome: form.nome, codigo: form.codigo, preco: parseBRL(form.preco) })}
                          disabled={!eanNorm.valid || !form.nome.trim()}
                        >
                          <FileDown size={14} /> Baixar etiqueta PDF
                        </NeuButtonAccent>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Preços. Quem não vende tem só o lado do custo: o que a empresa
                  pagou. Preço de venda e margem saem da tela em vez de pedir um
                  número inventado (migr. 440). */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">
                  {ehVendavel(extras.tipo) ? 'Preços' : 'Valor de aquisição'}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField
                    label={extras.tipo === 'patrimonio' ? 'Valor de Aquisição (R$) *'
                      : extras.tipo === 'consumo'       ? 'Custo Unitário (R$) *'
                      : `Preço de Custo (R$)${custoObrigatorio ? ' *' : ''}`}
                    error={extrasErrors.preco_custo}>
                    <input type="text" inputMode="numeric"
                      className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${extrasErrors.preco_custo ? 'border border-red-500/40' : ''}`}
                      value={extras.preco_custo}
                      onChange={e => { setExtras(x => ({ ...x, preco_custo: formatBRL(e.target.value) })); setExtrasErrors(ev => ({ ...ev, preco_custo: '' })); }}
                      onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                    {/* Cadastro antecipado: a cotação ainda não aconteceu, e o
                        campo deixa de cobrar um número que ninguém tem. Dizer
                        isso na tela é o que impede o aluno de inventar um. */}
                    {!custoObrigatorio && (
                      <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                        Pode ficar em branco: você ainda vai cotar. O custo real é apurado no{' '}
                        <span className="text-gray-400 font-bold">Recebimento</span>, por média ponderada — e
                        é ele que vale no DRE.
                      </p>
                    )}
                    {/* Custo apurado pela compra (migr. 417). Editar aqui é
                        permitido — mas o próximo recebimento deste produto
                        recalcula a média ponderada e assume de volta. */}
                    {editItem?.custo_origem === 'compra' && (
                      <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                        Média ponderada apurada no recebimento
                        {editItem?.custo_ultima_compra_em ? ` de ${new Date(`${editItem.custo_ultima_compra_em}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
                        {editItem?.custo_ultima_compra_valor != null
                          ? ` — última compra a R$ ${fmtBRL(parseNum(editItem.custo_ultima_compra_valor))} a unidade`
                          : ''}.
                      </p>
                    )}
                  </FormField>
                  {ehVendavel(extras.tipo) && (
                  <FormField label={`Preço de Venda (R$${extras.unidade && extras.unidade !== 'UN' ? ` / ${extras.unidade}` : ''}) *`} error={errors.preco}>
                    <input type="text" inputMode="numeric" className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${errors.preco ? 'border border-red-500/40' : ''}`}
                      value={form.preco} onChange={e => { setForm(f => ({ ...f, preco: formatBRL(e.target.value) })); clearError('preco'); }}
                      onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
                    {/* Markup da categoria (migr. 360). Sugere, não impõe: o
                        preço continua editável, e é a diferença entre o
                        sugerido e o praticado que rende a conversa em aula. */}
                    {precoSugerido !== null && (
                      <button type="button"
                        onClick={() => { setForm(f => ({ ...f, preco: formatBRL(precoSugerido) })); clearError('preco'); }}
                        className="text-[10px] text-accent hover:underline mt-1 text-left block">
                        Sugerido pelo markup de {markupCategoria}%: <strong>R$ {formatBRL(precoSugerido)}</strong> — clique para usar
                      </button>
                    )}
                    {extras.unidade && extras.unidade !== 'UN' && (
                      <p className="text-[10px] text-gray-500 mt-1">
                        Vendido por <span className="font-bold text-accent">{extras.unidade}</span> — no PDV, o caixa digita a quantidade fracionária ao pesar.
                      </p>
                    )}
                  </FormField>
                  )}
                  {/* As DUAS contas, lado a lado. Antes havia uma só, rotulada
                      "Margem de Lucro" e calculando markup — custo 10 e venda 20
                      exibiam 100%, e a margem real é 50%. Mostrar as duas juntas
                      é mais barato que escolher uma: são perguntas diferentes, e
                      é a diferença entre elas que o curso quer ensinar.

                      A cor fica no markup, com a régua de sempre e os mesmos
                      valores — margem saudável depende do ramo, e inventar um
                      corte único para as três filiais ensinaria outro erro. */}
                  {ehVendavel(extras.tipo) && (
                  <div className="flex flex-col gap-1.5">
                    {/* Calculado read-only, sem input — span em vez de label */}
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      Markup <span className="normal-case tracking-normal text-gray-600 font-medium">(sobre o custo)</span>
                    </span>
                    <div className={`neu-pressed py-2 px-3 rounded-xl text-sm flex items-center gap-2 border border-white/5 ${corDoMarkup(markupAoVivo)}`}>
                      <TrendingUp size={13} className="shrink-0 opacity-60" />
                      <span className="font-bold tabular-nums">{fmtPct(markupAoVivo)}</span>
                      {markupAoVivo !== null && markupAoVivo < 10 && (
                        <span className="text-[10px] text-red-400/70 ml-auto">Markup baixo</span>
                      )}
                    </div>
                  </div>
                  )}
                  {ehVendavel(extras.tipo) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      Margem <span className="normal-case tracking-normal text-gray-600 font-medium">(sobre a venda)</span>
                    </span>
                    <div className="neu-pressed py-2 px-3 rounded-xl text-sm flex items-center gap-2 border border-white/5 text-gray-300">
                      <Percent size={13} className="shrink-0 opacity-60" />
                      <span className="font-bold tabular-nums">{fmtPct(margemAoVivo)}</span>
                      <span className="text-[10px] text-gray-600 ml-auto">é a do DRE</span>
                    </div>
                  </div>
                  )}
                </div>
                {ehVendavel(extras.tipo) && (
                  <p className="text-[10px] text-gray-500 mt-2 leading-snug">{EXPLICA_MARKUP_MARGEM}</p>
                )}
              </div>

              {/* Estoque. Patrimônio não tem saldo: um freezer não se repõe,
                  não tem estoque mínimo e não gera movimentação. A seção inteira
                  sai da tela em vez de pedir zeros (migr. 440). */}
              {temEstoque(extras.tipo) && (
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Estoque</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Unidade">
                    <select className="neu-input py-2 px-3 rounded-xl text-sm"
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
                      {unidadesDeProduto(filial).map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </FormField>
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
                  {(editItem || itemCompradoSel === SEM_COMPRA
                    || (!origemExigida && !reqVinculo && !veioDeCompra)) ? (
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

              <div className="flex gap-3 justify-end">
                <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving} disabled={origemSemOpcoes}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabela */}
      {isLoading ? <LoadingSpinner /> : (error || filtered.length === 0) ? <EmptyState error={error} /> : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            <table className="w-full text-left border-collapse md:min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-4 w-10">
                    <input
                      type="checkbox"
                      className="accent-emerald-500 cursor-pointer"
                      title="Selecionar todos desta página"
                      checked={filtered.length > 0 && filtered.every((p: any) => selecionados.has(p.id))}
                      onChange={e => {
                        const marcar = e.target.checked;
                        setSelecionados(prev => {
                          const next = new Map(prev);
                          // Só mexe nos itens da página atual — o que foi
                          // marcado em outra busca/página continua marcado.
                          filtered.forEach((p: any) => {
                            if (marcar) next.set(p.id, p);
                            else next.delete(p.id);
                          });
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th className="pb-4 font-bold px-4 w-14">Foto</th>
                  <th className="pb-4 font-bold px-4 hidden sm:table-cell">Código</th>
                  <th className="pb-4 font-bold px-4">Nome</th>
                  <th className="pb-4 font-bold px-4 hidden lg:table-cell">Categoria</th>
                  <th className="pb-4 font-bold px-4 text-center hidden md:table-cell">Filial</th>
                  <th className="pb-4 font-bold px-4 text-right hidden md:table-cell">P. Custo</th>
                  <th className="pb-4 font-bold px-4 text-right">P. Venda</th>
                  <th className="pb-4 font-bold px-4 text-right hidden md:table-cell"
                      title="Markup: quanto foi acrescentado ao custo. A margem sobre a venda aparece ao passar o mouse no valor.">Markup</th>
                  <th className="pb-4 font-bold px-4 text-center">Estoque</th>
                  <th className="pb-4 font-bold px-4 text-center hidden sm:table-cell">Status</th>
                  <th className="pb-4 font-bold px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map((item: any) => {
                    const estAtual = parseNum(item.estoque);
                    const estMin   = parseNum(item.estoque_minimo);
                    const baixoEstoque = estMin > 0 && estAtual <= estMin;
                    return (
                      <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className={`border-b border-white/5 hover:bg-white/5 transition-colors group ${selecionados.has(item.id) ? 'bg-emerald-500/5' : ''}`}>
                        <td className="py-4 px-4">
                          <input
                            type="checkbox"
                            className="accent-emerald-500 cursor-pointer"
                            checked={selecionados.has(item.id)}
                            onChange={() => toggleSelecionado(item)}
                            title="Selecionar para etiqueta"
                          />
                        </td>
                        <td className="py-4 px-4">
                          <ProdutoThumb url={item.imagem_url} size="xs" alt={item.nome} />
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 hidden sm:table-cell">{item.codigo}</td>
                        <td className="py-4 px-4">
                          <span className="sm:hidden text-[10px] font-mono text-gray-500 block">{item.codigo}</span>
                          <p className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
                            {item.nome}
                            {/* Devolvido pela direção (migr. 502). Primeiro selo
                                da linha de propósito: é o único que pede ação de
                                alguém, e quem abre esta lista precisa achá-lo sem
                                entrar produto a produto. */}
                            {item.correcao_pendente && (
                              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-600/30"
                                title={item.correcao_motivo ?? 'A direção devolveu uma movimentação deste produto para correção.'}>
                                Corrigir
                              </span>
                            )}
                            {/* Consumo divide a lista com mercadoria — ambos
                                têm estoque e ambos se repõem. Sem o selo, "Papel
                                A4" e "Arroz 5kg" são indistinguíveis na grade, e
                                a diferença é justamente não ir para o caixa. */}
                            {normalizarTipo(item.tipo) === 'consumo' && (
                              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-400 border border-sky-600/30"
                                title="Material de uso e consumo — não vai para o PDV. Sai por Estoque > Requisições de Material.">
                                Consumo
                              </span>
                            )}
                            {item.elegivel_beneficios && (
                              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-600/30" title="Aceita MaxBank Benefícios">
                                Benef
                              </span>
                            )}
                            {/* A ficha do nicho é opcional, mas incompleta em
                                silêncio não ajuda ninguém: o aviso na lista
                                substitui o campo obrigatório que travaria 149
                                cadastros de uma vez. */}
                            {fichaVazia(item, filial) && (
                              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-600/30"
                                title={`Ficha de ${filial} incompleta — abra o produto para preencher.`}>
                                Ficha
                              </span>
                            )}
                          </p>
                          {/* Conteúdo da embalagem ao lado do fornecedor: é onde
                              o passivo da migr. 438 fica visível — quem tem peso
                              sem medida aparece como "5 (unidade não informada)"
                              até alguém abrir e escolher entre G e KG. */}
                          {(() => {
                            const conteudo = formatarConteudo(item.peso, item.peso_unidade);
                            const semMedida = !!conteudo && !item.peso_unidade;
                            return (item.fornecedor || conteudo) ? (
                              <p className="text-[10px] text-gray-600 mt-0.5">
                                {item.fornecedor}
                                {item.fornecedor && conteudo && ' • '}
                                {conteudo && (
                                  <span className={semMedida ? 'text-amber-500/80' : ''}
                                    title={semMedida ? 'Peso gravado sem medida (cadastro antigo) — abra o produto e informe se é G, KG, ML ou L.' : 'Conteúdo da embalagem'}>
                                    {conteudo}
                                  </span>
                                )}
                              </p>
                            ) : null;
                          })()}
                        </td>
                        <td className="py-4 px-4 hidden lg:table-cell">
                          {item.categoria
                            ? <span className="text-[10px] uppercase neu-pressed px-2 py-0.5 rounded text-gray-400 tracking-widest font-bold">{item.categoria}</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-4 px-4 text-center hidden md:table-cell"><FilialBadge filial={item.filial} /></td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 text-right hidden md:table-cell">
                          {item.preco_custo != null ? fmtBRL(parseNum(item.preco_custo)) : '—'}
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-200 text-right">
                          {item.preco != null ? fmtBRL(parseNum(item.preco)) : '—'}
                          {item.unidade && item.unidade !== 'UN' && (
                            <span className="text-[9px] text-gray-600 ml-0.5">/{item.unidade}</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-xs text-right hidden md:table-cell">
                          <MarkupBadge venda={item.preco} custo={item.preco_custo} />
                        </td>
                        <td className="py-4 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {baixoEstoque && <AlertTriangle size={11} className="text-red-500 shrink-0" />}
                            <span className={`text-xs font-bold tabular-nums ${baixoEstoque ? 'text-red-400' : 'text-gray-300'}`}>
                              {(() => {
                                const e = parseNum(item.estoque);
                                return Number.isInteger(e) ? e : e.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
                              })()}
                            </span>
                            {item.unidade && item.unidade !== 'UN' && (
                              <span className="text-[9px] text-gray-600">{item.unidade}</span>
                            )}
                            {estMin > 0 && (
                              // Mínimo virou numeric(15,3) na migr. 438 — sem
                              // toLocaleString sairia "2.5" com ponto.
                              <span className="text-[10px] text-gray-600">
                                / {Number.isInteger(estMin) ? estMin : estMin.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center hidden sm:table-cell"><StatusBadge status={item.status} /></td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <HistoricoOperacoes entidade="produtos" entidadeId={item.id} titulo={item.nome} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                            {normalizeEan13(item.ean).valid && (
                              <button onClick={() => downloadLabelFor(item)}
                                title="Baixar etiqueta EAN-13 em PDF"
                                className="action-btn-neutral">
                                <Barcode size={12} />
                              </button>
                            )}
                            {/* Grade de variantes (migr. 445). Só onde tamanho e
                                cor existem na ficha — abrir grade de saco de
                                arroz não quer dizer nada. */}
                            {temGrade && ehVendavel(item.tipo) && (
                              <button onClick={() => abrirGrade(item)}
                                title="Abrir grade de tamanhos e cores"
                                className="action-btn-neutral">
                                <Grid3x3 size={12} />
                              </button>
                            )}
                            <button onClick={() => openEdit(item)} className="action-btn-edit"><Edit2 size={12} /></button>
                            <button onClick={() => handleDelete(item.id)} className="action-btn-delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalCount={totalCount}
            isLoading={isLoading}
            onPrev={() => setPage(p => Math.max(0, p - 1))}
            onNext={() => setPage(p => p + 1)}
            onReload={reload}
          />
        </div>
      )}

      {/* Grade de variantes (migr. 445) — o cadastro do modelo abre os
          tamanhos × cores de uma vez, em vez de seis cadastros à mão. */}
      <AnimatePresence>
        {gradeItem && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !gradeSalvando && setGradeItem(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg flex flex-col gap-4"
            >
              <div>
                <h3 className="text-sm font-bold text-gray-200">Grade de tamanhos e cores</h3>
                <p className="text-[11px] text-gray-500 mt-1">
                  A partir de <span className="text-gray-300 font-semibold">{gradeItem.nome}</span>.
                  Cada combinação vira uma variante com código próprio, herdando preço, custo, categoria e fotos.
                </p>
              </div>

              <FormField label="Tamanhos">
                <input className="neu-input py-2 px-3 rounded-xl text-sm"
                  value={gradeTamanhos} onChange={e => setGradeTam(e.target.value)}
                  placeholder="P, M, G, GG" />
                <p className="text-[10px] text-gray-500 mt-1">Separe por vírgula. Numeração também vale: 38, 40, 42.</p>
              </FormField>

              <FormField label="Cores">
                <input className="neu-input py-2 px-3 rounded-xl text-sm"
                  value={gradeCores} onChange={e => setGradeCores(e.target.value)}
                  placeholder="Preto, Branco" />
              </FormField>

              {(() => {
                const t = gradeTamanhos.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).length;
                const c = gradeCores.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).length;
                return (
                  <p className="text-[11px] text-gray-400">
                    {t * c > 0
                      ? <><span className="text-accent font-bold">{t * c}</span> combinação(ões). O que já existe não é recriado.</>
                      : 'Informe tamanhos e cores para ver quantas variantes serão abertas.'}
                  </p>
                );
              })()}

              <p className="text-[10px] text-gray-600 leading-snug">
                Cada variante nasce com <span className="text-gray-400">saldo zero</span> e{' '}
                <span className="text-gray-400">sem EAN</span>: mercadoria entra por Compras → Recebimentos, e
                código de barras repetido faria o PDV vender o tamanho errado.
              </p>

              <div className="flex gap-2 justify-end">
                <button onClick={() => setGradeItem(null)} disabled={gradeSalvando}
                  className="neu-button py-2 px-4 rounded-xl text-xs text-gray-400">Cancelar</button>
                <button onClick={gerarGrade} disabled={gradeSalvando}
                  className="neu-button-accent py-2 px-4 rounded-xl text-xs font-bold disabled:opacity-50">
                  {gradeSalvando ? 'Abrindo…' : 'Abrir grade'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importando && (
          <ImportarProdutosModal
            filial={filial}
            showToast={showToast}
            contexto={{
              categorias: categoriasDaFilial.map((c: any) => ({ id: c.id, nome: c.nome })),
              subcategorias: subcategoriasProduto.map((sc: any) => ({
                id: sc.id, nome: sc.nome, categoria_id: sc.categoria_id,
              })),
              fornecedores: fornecedoresList.map((f: any) => f.nome).filter(Boolean),
              codigosExistentes: codigosCatalogo,
              nomesExistentes: [...nomesCatalogo],
            }}
            onFechar={() => setImportando(false)}
            onImportou={() => { reload(); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const ProdutosView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) {
    return (
      <MatrizConsolidado
        titulo="Produtos"
        descricao="Visão consolidada dos produtos nas 3 filiais."
        endpoint="/api/produtosview"
        colunas={[
          { key: 'codigo', label: 'Código', render: r => <span className="font-mono text-xs text-accent">{r.codigo ?? '—'}</span> },
          { key: 'nome', label: 'Nome', render: r => <span className="font-semibold text-gray-100">{r.nome ?? '—'}</span> },
          { key: 'tipo', label: 'Tipo' },
          { key: 'preco_venda', label: 'Preço venda', render: r => r.preco_venda != null ? `R$ ${Number(r.preco_venda).toFixed(2).replace('.', ',')}` : '—' },
          { key: 'estoque_atual', label: 'Estoque' },
          { key: 'status', label: 'Status' },
        ]}
        ordenarPor={(a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''))}
      />
    );
  }
  return <ProdutosViewInner showToast={showToast} filial={filialAtiva} profile={profile} />;
};
