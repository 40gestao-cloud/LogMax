import React, { useState, useEffect, useRef, useMemo } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { MatrizConsolidado } from '../components/MatrizConsolidado';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, FileDown, Sheet, AlertTriangle, Barcode, Grid3x3, Upload } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useColarImagemGlobal } from '../components/ColarImagem';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { ImportarProdutosModal } from '../components/ImportarProdutosModal';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge, FilialBadge, Pagination, ProdutoThumb } from '../components/ui';
import { SelectBusca, type SelectBuscaGrupo } from '../components/SelectBusca';
import type { UserProfile } from '../hooks/useUserProfile';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, exportToExcel, formatBRL, parseBRL, formatQtd, parseQtd, qtdBR, drawPdfHeader } from '../lib/viewUtils';
import { GOLD, BLACK, GRAY_INK, GOLD_TINT } from '../lib/pdfPalette';
import { normalizeEan13, drawEan13ToCanvas, downloadEan13LabelPdf, drawEtiquetasGridOnDoc } from '../lib/barcode';
import {
  validarImagemProduto,
  uploadImagemProduto,
  avaliarResolucaoImagem,
  removerImagemAntiga,
  PRODUTO_IMAGEM_MAX_SLOTS,
} from '../lib/produtoImagem';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  UNIDADES_PRODUTO,
  unidadesDeProduto,
  UNIDADES_FRACIONARIAS,
  temConteudoDeEmbalagem,
  normalizarUnidade,
  formatarConteudo,
  exemploProduto,
  embalagemDoProduto,
  rotuloEmbalagem,
} from '../lib/unidades';
import { ATRIBUTOS_PRODUTO, rotuloVariante, atributosPadrao } from '../lib/atributosProduto';
import { calcMarkup, calcMargem, precoPorMarkup, fmtPct, vendaAbaixoDoCusto } from '../lib/precificacao';
import { TIPOS_PRODUTO, TIPO_LABEL, TIPO_AJUDA, normalizarTipo, ehVendavel, temEstoque } from '../lib/tipoProduto';
import { supabase } from '../lib/supabase';
import { acompanharReservas, RESERVA_COLUNAS, type ReservaLinha } from '../lib/reservasTrabalho';
import { useReservaTrabalho } from '../hooks/useReservaTrabalho';
import { EMPTY_EXTRAS, parseNum, fmtBRL, SEM_COMPRA } from '../components/produtos/produtoFormComum';
import { MarkupBadge } from '../components/produtos/MarkupBadge';
import { EtiquetaPreviewModal } from '../components/produtos/EtiquetaPreviewModal';
import { SecaoIdentificacao } from '../components/produtos/SecaoIdentificacao';
import { SecaoEstoque } from '../components/produtos/SecaoEstoque';
import { SecaoPrecos } from '../components/produtos/SecaoPrecos';
import { SecaoEtiqueta } from '../components/produtos/SecaoEtiqueta';
import { SecaoImagens } from '../components/produtos/SecaoImagens';
import { lerCadastroDaCotacao, esquecerCadastroDaCotacao } from '../lib/cadastroDaCotacao';

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


// A ficha por nicho (tipo + tabela) vive em src/lib/atributosProduto.ts —
// o PDV exibe a mesma lista no modal de detalhes do produto, e duas cópias
// divergiriam no primeiro campo novo.



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



// Prefixo do valor das requisições que ainda esperam o pedido sair (migr. 494).
// O outro grupo do mesmo select guarda a DESCRIÇÃO do item; aqui é preciso o id
// da requisição, porque é nela que o vínculo vai ser gravado.
const REQ_PREFIX = '__req__:';


// A conta vive em src/lib/precificacao.ts — estava duplicada aqui e no
// Catálogo, e as duas calculavam MARKUP sob o rótulo "Margem".

const ProdutosViewInner = ({ showToast, filial, profile, onNavigate }: { showToast: any; filial: FilialOp; profile?: UserProfile | null; onNavigate?: (view: string) => void }) => {
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
  const { data: requisicoesDaFilial, setData: setRequisicoesDaFilial, isLoading: requisicoesCarregando } = useFetchData<any>('/api/requisicoesview', { filial });
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
        // `qtd` da requisição é sempre na unidade base, mesmo pedida em fardo
        // (migr. 589) — é o mesmo divisor que o pedido e a migr. 417 usam.
        const qtdReq   = Number(r.qtd ?? 0);
        const totalCot = Number(cot?.valor_total ?? 0);
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
          custoPrevisto: qtdReq > 0 && totalCot > 0 ? totalCot / qtdReq : null,
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
  // O formulário foi aberto pelo "Cadastrar produto" das Cotações: salvo e
  // amarrado, a tela devolve o comprador para lá, onde o pedido já está pronto.
  const voltarParaCotacoesRef = useRef(false);
  // Custo que a última origem escolhida pôs no campo — para a troca de origem
  // saber se o número é dela (troca) ou do aluno (fica).
  const custoAutoRef = useRef('');

  // Trava de trabalho (migr. 537) — nasce no exato momento que o usuário
  // descreveu: escolher a origem. `SEM_COMPRA` (implantação) não reserva —
  // não é um item que outro aluno possa disputar.
  const chaveOrigemReserva = itemCompradoSel && itemCompradoSel !== SEM_COMPRA
    ? (itemCompradoSel.startsWith(REQ_PREFIX)
        ? `req:${itemCompradoSel.slice(REQ_PREFIX.length)}`
        : `desc:${itemCompradoSel.trim().toLowerCase()}`)
    : null;
  const reservaOrigem = useReservaTrabalho('cadastro_produto', chaveOrigemReserva, filial);

  // Quem mais está cadastrando cada origem — para travar as opções do select
  // antes do clique. Recarrega por filial (não por origem, como na Cotação:
  // aqui o universo de origens é a filial inteira, não uma requisição só).
  const [reservasOrigem, setReservasOrigem] = useState<Record<string, { usuario_id: string; usuario_nome: string }>>({});
  useEffect(() => {
    if (!supabase || !filial) { setReservasOrigem({}); return; }
    // Evento, vencimento e janela de releitura moram em `acompanharReservas`:
    // renovação de colega não relê, e o cadeado vencido some pela conferência
    // local do prazo, sem F5.
    const acompanhamento = acompanharReservas<ReservaLinha>({
      nome: 'cadastro_produto_reservas',
      ler: async () => {
        // `expira_em > agora` é obrigatório: a reserva morre pelo relógio, e
        // relógio não emite evento. Sem este filtro, quem fechou o notebook
        // deixaria a origem travada na tela dos colegas para sempre — e travado
        // é mentira, porque o banco liberaria a reserva na hora.
        const { data, error } = await supabase!.from('trabalho_reservas')
          .select(RESERVA_COLUNAS)
          .eq('escopo', 'cadastro_produto')
          .eq('filial', filial)
          .gt('expira_em', new Date().toISOString());
        return error ? null : (data ?? []) as ReservaLinha[];
      },
      relevante: r => r.escopo === 'cadastro_produto' && r.filial === filial,
      aoMudar: linhas => {
        const mapa: Record<string, { usuario_id: string; usuario_nome: string }> = {};
        for (const r of linhas) mapa[String(r.chave)] = { usuario_id: r.usuario_id, usuario_nome: r.usuario_nome };
        setReservasOrigem(mapa);
      },
    });
    return () => acompanhamento.parar();
  }, [filial]);
  const chaveDeOrigem = (valor: string) => valor.startsWith(REQ_PREFIX)
    ? `req:${valor.slice(REQ_PREFIX.length)}` : `desc:${valor.trim().toLowerCase()}`;
  const origemTravadaPorOutro = (valor: string) => {
    const res = reservasOrigem[chaveDeOrigem(valor)];
    return !!res && res.usuario_id !== profile?.id;
  };

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

  // MIGR 594: a unidade de medida é o que dá sentido ao saldo. Com mercadoria
  // na prateleira, trocá-la reinterpretaria de uma vez o saldo, o mínimo, o
  // preço, o custo e todo o histórico — sem nenhum lançamento no meio. O saldo
  // vem do item aberto (`editItem`), não de `extras.estoque`, que é o campo da
  // tela e fica vazio na edição.
  const saldoAtual = editItem ? parseNum(editItem.estoque) : 0;
  const unidadeTravada = !!editItem && saldoAtual !== 0;
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
  //
  // Só enquanto o tipo tem estoque: trocar para Patrimônio esconde o campo de
  // origem (vide `origemOferecida`), mas a escolha feita antes ficava valendo
  // por baixo — o bem era gravado na requisição e o pedido dela passava a ser
  // recusado para sempre (migr. 515), porque o vínculo só se grava uma vez.
  const reqVinculo = useMemo(
    () => itemCompradoSel.startsWith(REQ_PREFIX) && temEstoque(extras.tipo)
      ? itensAguardandoPedido.find(i => i.id === itemCompradoSel.slice(REQ_PREFIX.length)) ?? null
      : null,
    [itemCompradoSel, itensAguardandoPedido, extras.tipo],
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

  // O campo "Saldo de Abertura" só existe fora do fluxo de compra: com o
  // produto vindo de pedido, quem enche o estoque é o Recebimento. A condição
  // vivia escrita à mão lá embaixo no JSX; virou const porque o `handleSave`
  // precisa da MESMA resposta para saber se o zero é erro do aluno (implantação
  // sem quantidade) ou o estado correto (mercadoria que ainda vai chegar).
  const mostraSaldoAbertura = !!editItem
    || itemCompradoSel === SEM_COMPRA
    || (!origemExigida && !reqVinculo && !veioDeCompra);

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
    // NOVO (migr. 537): opção já tomada por outro aluno vem travada, com o
    // nome do dono — o mesmo cadeado que a Cotação usa para requisição+
    // fornecedor, aqui por origem de compra.
    const rotuloTravado = (rotulo: string, valor: string) => {
      const res = reservasOrigem[chaveDeOrigem(valor)];
      return res && res.usuario_id !== profile?.id ? `🔒 ${rotulo} — ${res.usuario_nome} está cadastrando` : rotulo;
    };
    if (cotadas.length > 0) {
      grupos.push({
        label: `Cotação aprovada — travando o Gerar Pedido (${cotadas.length})`,
        opcoes: cotadas.map(i => ({
          value: `${REQ_PREFIX}${i.id}`, label: rotuloTravado(rotuloReq(i), `${REQ_PREFIX}${i.id}`),
          hint: i.fornecedor, disabled: origemTravadaPorOutro(`${REQ_PREFIX}${i.id}`),
        })),
      });
    }
    if (semCotacao.length > 0) {
      grupos.push({
        label: `Aguardando cotação (${semCotacao.length})`,
        opcoes: semCotacao.map(i => ({
          value: `${REQ_PREFIX}${i.id}`, label: rotuloTravado(rotuloReq(i), `${REQ_PREFIX}${i.id}`),
          hint: i.fornecedor, disabled: origemTravadaPorOutro(`${REQ_PREFIX}${i.id}`),
        })),
      });
    }
    // Item comprado mas ainda não recebido não aparece: a ficha do produto
    // (EAN, peso, validade) está na caixa que ainda não chegou.
    if (itensComprados.length > 0) {
      grupos.push({
        label: `Já chegou e não está no catálogo (${itensComprados.length})`,
        opcoes: itensComprados.map(i => ({
          value: i.descricao, label: rotuloTravado(i.descricao, i.descricao),
          hint: i.fornecedor, disabled: origemTravadaPorOutro(i.descricao),
        })),
      });
    }
    return grupos;
  }, [itensAguardandoPedido, itensComprados, emImplantacao, origemExigida, itemCompradoSel, reservasOrigem, profile?.id]);

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
      // A requisição oferece SERV (serviço) além das unidades de produto:
      // jogar isso no select do cadastro deixaria o campo em branco, com
      // valor que nenhuma opção representa.
      const unidade = extras.unidade === 'UN' && unidadesDeProduto(filial).includes(normalizarUnidade(req.unidade))
        ? normalizarUnidade(req.unidade) : extras.unidade;
      // Cotação aprovada = preço já decidido, e o Recebimento sobrescreve de
      // qualquer jeito (estoque zero, migr. 417). Só com a MESMA unidade: o
      // custo por KG da requisição num produto vendido por UN seria outro número.
      const custoCot = req.custoPrevisto != null && normalizarUnidade(req.unidade) === unidade
        ? formatBRL(req.custoPrevisto) : '';
      // Trocar de origem troca o custo que a origem anterior pôs; o que o
      // aluno digitou fica.
      const custoAnterior = custoAutoRef.current;
      custoAutoRef.current = custoCot;
      setExtras(x => {
        const preco_custo = !x.preco_custo || x.preco_custo === custoAnterior ? custoCot : x.preco_custo;
        return {
        ...x,
        unidade,
        preco_custo,
        fornecedor:    x.fornecedor    || req.fornecedor,
        fornecedor_id: x.fornecedor_id || req.fornecedor_id,
        // Migr. 526: a marca decidida na proposta aprovada. Sugestão, como o
        // fornecedor (migr. 488) — quem cadastra confirma, e o que já foi
        // digitado não se perde.
        marca:         x.marca         || req.marca,
        // Nada chegou ainda: o saldo entra pelo Recebimento.
        estoque: '',
        };
      });
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
  const exportCols = ['Código', 'Nome', 'Conteúdo', 'Compra em', 'Categoria', 'Fornecedor', 'P. Custo', 'P. Venda', 'Markup %', 'Margem %', 'Estoque', 'Un.', 'Est. Mín', 'EAN', 'Status'];
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
      rotuloEmbalagem(embalagemDoProduto(d), d.unidade),
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
  // PDF é a lista de preços: só o que se lê no papel. As 15 colunas do Excel
  // espremidas em A4 retrato viravam ruído, e as etiquetas têm botão próprio.
  const pdfCols = ['Nome', 'Categoria', 'P. Custo', 'P. Venda', 'Markup %'];
  const buildPdfRows = (rows: any[]) => rows.map((d: any) => {
    const mk = calcMarkup(parseNum(d.preco), parseNum(d.preco_custo));
    return [
      d.nome ?? '', d.categoria ?? '',
      d.preco_custo ? fmtBRL(parseNum(d.preco_custo)) : '',
      d.preco ? fmtBRL(parseNum(d.preco)) : '',
      mk !== null ? fmtPct(mk) : '',
    ];
  });
  const handleExportPDF = async () => {
    try {
      const todos = await fetchAllForExport();
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF();

      // Padrão dos relatórios da casa: faixa preta, filete dourado e LogMax
      // em dourado (`drawPdfHeader`, em viewUtils).
      drawPdfHeader(doc, 'Relatório Operacional', 'Catálogo de Produtos',
        `Gerado em: ${new Date().toLocaleString('pt-BR')}`);

      autoTable(doc, {
        startY: 40,
        head: [pdfCols],
        body: buildPdfRows(todos),
        theme: 'grid',
        headStyles: { fillColor: BLACK, textColor: GOLD, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { textColor: GRAY_INK, fontSize: 9 },
        alternateRowStyles: { fillColor: GOLD_TINT },
        columnStyles: {
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
        },
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
      // Exceção já registrada (migr. 601): reabrir o produto não pode cobrar de
      // novo a decisão que alguém já tomou.
      venda_abaixo_custo:     !!item.venda_abaixo_custo,
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
      embalagem_compra:       item.embalagem_compra ?? '',
      embalagem_qtd:          item.embalagem_qtd != null ? String(Number(item.embalagem_qtd)).replace('.', ',') : '',
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
    custoAutoRef.current = '';
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
    voltarParaCotacoesRef.current = false;
    custoAutoRef.current = '';
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

  // Chegou pelo "Cadastrar produto" das Cotações: abre o Novo já com a
  // requisição na origem, em vez de mandar o comprador procurá-la no select.
  // Espera as requisições carregarem — antes disso a lista vazia leria como
  // "essa requisição não espera mais cadastro".
  const [origemPedida, setOrigemPedida] = useState<string | null>(
    () => lerCadastroDaCotacao(filial, 'produto')?.requisicaoId ?? null);
  useEffect(() => {
    if (!origemPedida || requisicoesCarregando) return;
    esquecerCadastroDaCotacao();
    setOrigemPedida(null);
    const valor = `${REQ_PREFIX}${origemPedida}`;
    const req = itensAguardandoPedido.find(i => i.id === origemPedida);
    if (!req) {
      showToast('A requisição que veio das Cotações não está mais esperando cadastro — outra pessoa pode já ter cadastrado o produto. Volte às Cotações: se ela já estiver ligada, o pedido sai direto.', 'error', true);
      return;
    }
    if (origemTravadaPorOutro(valor)) {
      showToast(`${reservasOrigem[chaveDeOrigem(valor)]?.usuario_nome ?? 'Outra pessoa'} já está cadastrando o produto desta requisição. Espere terminar e volte às Cotações.`, 'error', true);
      return;
    }
    closeForm();
    setShowForm(true);
    escolherOrigem(valor);
    voltarParaCotacoesRef.current = true;
  }, [origemPedida, requisicoesCarregando, itensAguardandoPedido]); // eslint-disable-line react-hooks/exhaustive-deps

  // Upload de imagem: valida formato/tamanho bruto ANTES de decodificar.
  // Se aceito, faz upload para o bucket e guarda a URL pública no slot;
  // resolução baixa não bloqueia, só rende um aviso no slot.
  const handleImagemChange = (slotIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) enviarImagemSlot(slotIdx, file);
  };

  // Upload e Ctrl+V caem aqui: a imagem colada passa pela mesma validação e
  // compressão do arquivo escolhido.
  const enviarImagemSlot = async (slotIdx: number, file: File) => {
    const validacao = validarImagemProduto(file);
    if (!validacao.ok) {
      showToast(validacao.motivo, 'error', true);
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
    }
  };

  // Ctrl+V solto no formulário vai para o primeiro slot vazio — a capa, se
  // ainda não tiver. Com os três cheios não troca nenhum às cegas: para
  // substituir, cola-se na área do slot escolhido.
  useColarImagemGlobal(file => {
    const vazio = imagens.findIndex(u => !u);
    if (vazio < 0) {
      showToast('As três fotos já estão preenchidas. Para trocar uma, clique com o botão direito em "Colar" no slot desejado.', 'info', true);
      return;
    }
    enviarImagemSlot(vazio, file);
  }, showForm && imagemUploading === null);

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
    // O select já vem com a opção travada, mas o banco é quem decide de
    // verdade (migr. 537) — sem esta checagem no Salvar, o cadeado da tela é
    // decoração.
    if (reservaOrigem.travado) {
      showToast(`${reservaOrigem.dono?.usuario_nome} já está cadastrando este item agora.`, 'error', true);
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
      else if (!extras.peso_unidade)  ee.peso = 'Informe a medida (G, KG, ML, L ou UN)';
      // Espelha `chk_produtos_conteudo_un_redundante` (migr. 593): "1 UN
      // contém 6 UN" não descreve nada. Conteúdo contado só faz sentido
      // quando o estoque conta embalagens.
      else if (extras.peso_unidade === 'UN' && normalizarUnidade(extras.unidade) === 'UN') {
        ee.peso = 'A unidade de estoque já é UN — conte em UN só quando o estoque contar pacote ou caixa.';
      }
    }
    // Embalagem de compra: os dois campos ou nenhum (migr. 589). Nome sem fator
    // é rótulo que não converte nada; fator sem nome é número que a requisição
    // não sabe ler. Fardo com 1 não é embalagem — é a própria unidade.
    if (temEstoque(extras.tipo)) {
      const fatorEmb = parseQtd(extras.embalagem_qtd);
      if (extras.embalagem_compra && !extras.embalagem_qtd.trim()) {
        ee.embalagem_qtd = `Quantas ${extras.unidade || 'UN'} vêm em um ${extras.embalagem_compra.toLowerCase()}?`;
      } else if (extras.embalagem_compra && fatorEmb <= 1) {
        ee.embalagem_qtd = 'Tem de ser mais de 1 — embalagem com uma unidade é a própria unidade.';
      } else if (!extras.embalagem_compra && extras.embalagem_qtd.trim()) {
        ee.embalagem_qtd = 'Escolha a embalagem ao lado (fardo, caixa, pacote...).';
      }
    }
    // Categoria carrega o markup-alvo que sugere o preço de venda: não faz
    // sentido exigi-la de quem não vende.
    if (vendavel && !extras.categoria_id) ee.categoria_id = 'Selecione uma categoria';
    // Fornecedor NÃO é obrigatório (migr. 488): pós-480 o cadastro vem antes
    // da compra, e quem fornece é a cotação que decide comparando propostas.
    // Cobrar aqui só produzia nome escolhido no chute — o mesmo defeito que o
    // preço de custo obrigatório tinha.
    if (custoObrigatorio && !extras.preco_custo.trim()) ee.preco_custo = 'Obrigatório';
    // Custo acima do preço de venda. Em 15/09 a turma da contabilidade lançou os
    // dois campos trocados e o catálogo ficou vendendo com prejuízo por unidade —
    // o markup já ficava vermelho na tela e ninguém leu, porque vermelho aqui
    // também significa "markup baixo", que é normal. Bloquear é o que separa o
    // erro de digitação da promoção-isca: quem quer mesmo vender abaixo do custo
    // marca a caixa ao lado do preço, e a escolha fica gravada no produto.
    if (vendavel && !extras.venda_abaixo_custo
        && vendaAbaixoDoCusto(parseBRL(form.preco), parseBRL(extras.preco_custo))) {
      const mk = calcMarkup(parseBRL(form.preco), parseBRL(extras.preco_custo));
      ee.preco_custo = `Custo R$ ${formatBRL(parseBRL(extras.preco_custo))} acima do preço de venda `
        + `R$ ${formatBRL(parseBRL(form.preco))} — markup ${fmtPct(mk)}, prejuízo por unidade. `
        + 'Confira se os dois campos não estão trocados. Se a venda abaixo do custo for proposital, marque a caixa ao lado do preço de venda.';
    }
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

    // Produto nascendo sem saldo. Acontece de duas formas muito diferentes, e
    // só uma é erro:
    //
    //   - veio de compra/requisição → zero é o CERTO. O Recebimento é que dá
    //     entrada, e digitar aqui dobraria o estoque. Nem pergunta.
    //   - implantação, com o campo na tela e em branco → o aluno cadastrou a
    //     mercadoria que está na prateleira e não disse quanto tem. O item
    //     nasce morto: o PDV recusa ("Sem estoque"), não sai em requisição, e
    //     a turma só descobre na hora de vender.
    //
    // Em 28/08 metade do catálogo de uma turma estava assim. Não dá para
    // BLOQUEAR — cadastrar antes de comprar é a régua desde a migr. 480 —,
    // então o que cabe é a pergunta explícita, no momento em que ainda é
    // barato responder.
    if (!editItem && temEstoque(extras.tipo) && mostraSaldoAbertura && parseQtd(extras.estoque) <= 0) {
      const segue = await confirm(
        'Este produto vai nascer com 0 em estoque.\n\n'
        + 'Sem saldo ele aparece como "Sem estoque" no PDV, não pode ser vendido nem sair em requisição — '
        + 'até alguém dar entrada.\n\n'
        + 'Se a mercadoria JÁ está na prateleira, cancele e informe o Saldo de Abertura. '
        + 'Se ela ainda vai ser comprada, pode seguir: a quantidade entra pelo Recebimento.');
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
        // Só faz sentido em quem se vende, e só fica marcado enquanto o preço
        // estiver mesmo abaixo do custo: corrigiu o preço, a exceção se apaga
        // sozinha — senão ela sobrevive esquecida e libera o próximo erro.
        venda_abaixo_custo:     vendavel && extras.venda_abaixo_custo
                                 && vendaAbaixoDoCusto(parseBRL(form.preco), parseBRL(extras.preco_custo)),
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
        // Embalagem de compra (migr. 589), também em par. Patrimônio não tem:
        // freezer não vem em fardo, e a seção Estoque inteira some da tela.
        embalagem_compra:       temEstoque(extras.tipo) && extras.embalagem_compra ? extras.embalagem_compra : null,
        embalagem_qtd:          temEstoque(extras.tipo) && extras.embalagem_compra ? parseQtd(extras.embalagem_qtd) : null,
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
                    : voltarParaCotacoesRef.current && onNavigate
                      ? `Produto criado e vinculado à requisição ${reqVinculo.numero}. De volta às Cotações — ela já está na aba "Gerar pedidos", pronta para o pedido.`
                      : `Produto criado e vinculado à requisição ${reqVinculo.numero}. Em Compras > Cotações ela já aparece na aba "Gerar pedidos" — o Gerar Pedido não vai mais pedir o item do catálogo.`)
                : 'Produto criado com sucesso!',
          vinculoFalhou ? 'error' : 'success', true);
        // Veio do atalho das Cotações: o próximo passo é lá, então a tela leva.
        if (reqVinculo && !vinculoFalhou && voltarParaCotacoesRef.current && onNavigate) {
          onNavigate('compras-cotações');
        }
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
  const precoAbaixoDoCusto = ehVendavel(extras.tipo)
    && vendaAbaixoDoCusto(parseBRL(form.preco), parseBRL(extras.preco_custo));
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

  // Produto cuja etiqueta está aberta em pré-visualização. Guarda o item
  // inteiro (não o id): a lista pagina e recarrega por realtime, e o modal não
  // pode piscar porque a linha saiu da página enquanto estava aberto.
  const [etiquetaPreview, setEtiquetaPreview] = useState<any | null>(null);

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
            // Grava no catálogo: vidro amarelo, o de ação que pede atenção.
            className="btn-shimmer btn-shimmer--glass-yellow !py-2 !px-4 !rounded-xl !text-xs"
          >
            <Upload size={14} /> Importar planilha
          </button>
          {data.length > 0 && (
            <>
              <ExportButton
                label={selecionados.size > 0 ? `Etiquetas (${selecionados.size})` : 'Etiquetas'}
                onClick={handleExportEtiquetas}
                icon={Barcode}
                variante="etiqueta"
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

              <SecaoIdentificacao
                errors={errors}
                clearError={clearError}
                categoriasProduto={categoriasProduto}
                subcategoriasProduto={subcategoriasProduto}
                atrLivre={atrLivre}
                categoriasDaFilial={categoriasDaFilial}
                codigoReservado={codigoReservado}
                editItem={editItem}
                escolherOrigem={escolherOrigem}
                exProd={exProd}
                extras={extras}
                extrasErrors={extrasErrors}
                filial={filial}
                form={form}
                fornecedoresOrdenados={fornecedoresOrdenados}
                gruposOrigem={gruposOrigem}
                itemCompradoSel={itemCompradoSel}
                itensAguardandoPedido={itensAguardandoPedido}
                itensComprados={itensComprados}
                liberarCodigo={liberarCodigo}
                marcaDaCompra={marcaDaCompra}
                mostraPesoConteudo={mostraPesoConteudo}
                nomeDestravado={nomeDestravado}
                origemExigida={origemExigida}
                origemOferecida={origemOferecida}
                origemSemOpcoes={origemSemOpcoes}
                reservaOrigem={reservaOrigem}
                setAtrLivre={setAtrLivre}
                setCodigoReservado={setCodigoReservado}
                setExtras={setExtras}
                setExtrasErrors={setExtrasErrors}
                setForm={setForm}
                setNomeDestravado={setNomeDestravado}
                sugerindoCodigo={sugerindoCodigo}
                sugerirCodigo={sugerirCodigo}
              />

              <SecaoImagens
                enviarImagemSlot={enviarImagemSlot}
                extrasErrors={extrasErrors}
                form={form}
                handleImagemChange={handleImagemChange}
                handleRemoverImagem={handleRemoverImagem}
                imagemInputRefs={imagemInputRefs}
                imagemUploading={imagemUploading}
                imagens={imagens}
                imagensAviso={imagensAviso}
              />

              <SecaoEtiqueta
                downloadLabelFor={downloadLabelFor}
                eanNorm={eanNorm}
                eanPreviewRef={eanPreviewRef}
                extras={extras}
                form={form}
              />

              <SecaoPrecos
                custoDaCotacao={reqVinculo?.custoPrevisto != null
                  && extras.preco_custo !== ''
                  && extras.preco_custo === formatBRL(reqVinculo.custoPrevisto)}
                errors={errors}
                clearError={clearError}
                custoObrigatorio={custoObrigatorio}
                editItem={editItem}
                extras={extras}
                extrasErrors={extrasErrors}
                form={form}
                margemAoVivo={margemAoVivo}
                markupAoVivo={markupAoVivo}
                markupCategoria={markupCategoria}
                precoAbaixoDoCusto={precoAbaixoDoCusto}
                precoSugerido={precoSugerido}
                setExtras={setExtras}
                setExtrasErrors={setExtrasErrors}
                setForm={setForm}
              />

              <SecaoEstoque
                aplicarCorrecaoSaldo={aplicarCorrecaoSaldo}
                corrigindoSaldo={corrigindoSaldo}
                editItem={editItem}
                ehProfessor={ehProfessor}
                extras={extras}
                extrasErrors={extrasErrors}
                filial={filial}
                fracionario={fracionario}
                mostraPesoConteudo={mostraPesoConteudo}
                mostraSaldoAbertura={mostraSaldoAbertura}
                motivoSaldo={motivoSaldo}
                origemSemOpcoes={origemSemOpcoes}
                saldoAtual={saldoAtual}
                saldoCorrigido={saldoCorrigido}
                salvandoSaldo={salvandoSaldo}
                setCorrigindoSaldo={setCorrigindoSaldo}
                setExtras={setExtras}
                setExtrasErrors={setExtrasErrors}
                setMotivoSaldo={setMotivoSaldo}
                setSaldoCorrigido={setSaldoCorrigido}
                unidadeTravada={unidadeTravada}
              />

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
                {/* `whitespace-nowrap` em todo o cabeçalho: "P. Custo" e
                    "P. Venda" quebravam em duas linhas e empurravam a altura
                    do cabeçalho inteiro, deixando a grade com cara de
                    desalinhada antes mesmo da primeira linha de dado. */}
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest [&>th]:whitespace-nowrap">
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
                  {/* `w-full` no Nome, e só nele: com todas as outras colunas
                      em `whitespace-nowrap`, a largura sobrando da tabela era
                      repartida entre elas e virava rio branco no meio da grade
                      — o buraco entre Categoria e Filial. Mandando a coluna de
                      texto tomar 100%, as demais encolhem até o próprio
                      conteúdo e a sobra vai para onde ela é útil. */}
                  <th className="pb-4 font-bold px-4 w-full">Nome</th>
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
                    // Zero é estado PRÓPRIO, não "estoque baixo": produto sem
                    // saldo não vende, e antes ele saía como um "0" cinza no
                    // meio da coluna — indistinguível de um saldo qualquer para
                    // quem varre a lista. Sem `estoque_minimo` cadastrado, nem o
                    // alerta vermelho aparecia.
                    const semSaldo     = temEstoque(item.tipo) && estAtual <= 0;
                    const baixoEstoque = !semSaldo && estMin > 0 && estAtual <= estMin;
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
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 hidden sm:table-cell whitespace-nowrap">{item.codigo}</td>
                        {/* Nome é a única coluna que PODE quebrar — é texto de
                            verdade. Ganha piso de largura para não ser espremida
                            a três linhas pelas colunas numéricas ao lado. */}
                        <td className="py-4 px-4 min-w-[200px]">
                          <span className="sm:hidden text-[10px] font-mono text-gray-500 block">{item.codigo}</span>
                          {/* `flex-wrap`: com nome comprido os selos ficavam
                              espremidos na mesma linha, cada um com meia letra. */}
                          <p className="text-sm font-semibold text-gray-200 flex flex-wrap items-center gap-1.5">
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
                            // Embalagem de compra (migr. 589) na mesma linha:
                            // é o que responde "compro de quantos em quantos?"
                            // sem abrir o cadastro.
                            const emb = rotuloEmbalagem(embalagemDoProduto(item), item.unidade);
                            return (item.fornecedor || conteudo || emb) ? (
                              <p className="text-[10px] text-gray-600 mt-0.5">
                                {item.fornecedor}
                                {item.fornecedor && conteudo && ' • '}
                                {conteudo && (
                                  <span className={semMedida ? 'text-amber-500/80' : ''}
                                    title={semMedida ? 'Peso gravado sem medida (cadastro antigo) — abra o produto e informe se é G, KG, ML ou L.' : 'Conteúdo da embalagem'}>
                                    {conteudo}
                                  </span>
                                )}
                                {(item.fornecedor || conteudo) && emb && ' • '}
                                {emb && (
                                  <span className="text-gray-500" title="Embalagem em que o fornecedor vende — o estoque continua contando na unidade">
                                    {emb}
                                  </span>
                                )}
                              </p>
                            ) : null;
                          })()}
                        </td>
                        <td className="py-4 px-4 hidden lg:table-cell">
                          {item.categoria
                            // Sem `whitespace-nowrap` o selo quebrava no meio
                            // e "Limpeza Doméstica" lia como DOIS selos
                            // empilhados — categoria diferente, na leitura.
                            //
                            // Com nowrap e sem teto, porém, a categoria mais
                            // comprida da página ("Mercearia Seca e Despensa")
                            // esticava a COLUNA para todas as linhas — daí o
                            // vão entre Categoria e Filial. Teto de 150px e
                            // reticências: o nome inteiro fica no title.
                            ? <span title={item.categoria}
                                className="inline-block align-middle max-w-[150px] truncate whitespace-nowrap text-[10px] uppercase neu-pressed px-2 py-0.5 rounded text-gray-400 tracking-widest font-bold">{item.categoria}</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-4 px-4 text-center hidden md:table-cell"><FilialBadge filial={item.filial} /></td>
                        {/* `whitespace-nowrap` nos valores: sem ele o espaço de
                            "R$ 8,00" era ponto de quebra e a coluna saía com o
                            símbolo numa linha e o número na outra. */}
                        <td className="py-4 px-4 text-xs font-mono text-gray-400 text-right hidden md:table-cell whitespace-nowrap">
                          {item.preco_custo != null ? fmtBRL(parseNum(item.preco_custo)) : '—'}
                        </td>
                        <td className="py-4 px-4 text-xs font-mono text-gray-200 text-right whitespace-nowrap">
                          {item.preco != null ? fmtBRL(parseNum(item.preco)) : '—'}
                          {item.unidade && item.unidade !== 'UN' && (
                            <span className="text-[9px] text-gray-600 ml-0.5">/{item.unidade}</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-xs text-right hidden md:table-cell whitespace-nowrap">
                          <MarkupBadge venda={item.preco} custo={item.preco_custo} />
                        </td>
                        <td className="py-4 px-4 text-center whitespace-nowrap">
                          {/* Saldo e mínimo são leitura única ("30 de 30"): o
                              "/ 30" caindo para a linha de baixo lia como outro
                              número, e ainda desalinhava a altura da linha. */}
                          <div className="flex flex-nowrap items-center justify-center gap-1.5">
                            {(baixoEstoque || semSaldo) && <AlertTriangle size={11} className="text-red-500 shrink-0" />}
                            <span className={`text-xs font-bold tabular-nums ${baixoEstoque || semSaldo ? 'text-red-400' : 'text-gray-300'}`}>
                              {(() => {
                                const e = parseNum(item.estoque);
                                return Number.isInteger(e) ? e : e.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
                              })()}
                            </span>
                            {item.unidade && item.unidade !== 'UN' && (
                              <span className="text-[9px] text-gray-600">{item.unidade}</span>
                            )}
                            {semSaldo && (
                              <span className="text-[9px] font-bold text-red-400 uppercase tracking-wide whitespace-nowrap"
                                title="Sem saldo: o PDV recusa a venda deste item até um Recebimento ou Ajuste dar entrada.">
                                sem saldo
                              </span>
                            )}
                            {estMin > 0 && (
                              // Mínimo virou numeric(15,3) na migr. 438 — sem
                              // toLocaleString sairia "2.5" com ponto.
                              <span className="text-[10px] text-gray-600 whitespace-nowrap">
                                / {Number.isInteger(estMin) ? estMin : estMin.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center hidden sm:table-cell"><StatusBadge status={item.status} /></td>
                        <td className="py-4 px-4 text-right whitespace-nowrap">
                          {/* Sempre visíveis. Antes eram `opacity-0` até o
                              hover: no telemóvel, que não tem hover, as ações
                              simplesmente não existiam — e no desktop obrigava
                              a varrer o mouse pela coluna para descobrir que
                              havia botão ali. Ficam a 70% e acendem na linha
                              sob o cursor, que é o realce sem ser esconderijo.
                              A etiqueta (`data-vivo`) fica fora do esmaecimento:
                              dourado a 70% sobre o preto lia apagado. */}
                          <div className="flex flex-nowrap justify-end gap-2 [&>*]:transition-opacity [&>*:not([data-vivo])]:opacity-70 group-hover:[&>*]:opacity-100">
                            <HistoricoOperacoes entidade="produtos" entidadeId={item.id} titulo={item.nome} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                            {normalizeEan13(item.ean).valid && (
                              <button onClick={() => setEtiquetaPreview(item)} data-vivo
                                title="Ver etiqueta EAN-13"
                                className="btn-shimmer btn-shimmer--gold !p-0 w-8 h-8 justify-center">
                                <Barcode size={13} />
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

      <AnimatePresence>
        {etiquetaPreview && (
          <EtiquetaPreviewModal
            item={etiquetaPreview}
            onBaixar={() => downloadLabelFor(etiquetaPreview)}
            onClose={() => setEtiquetaPreview(null)}
          />
        )}
      </AnimatePresence>

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

export const ProdutosView = ({ showToast, profile, onNavigate }: any) => {
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
  return <ProdutosViewInner showToast={showToast} filial={filialAtiva} profile={profile} onNavigate={onNavigate} />;
};
