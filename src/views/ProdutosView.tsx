import React, { useState, useEffect, useRef, useMemo } from 'react';
import { todayBR } from '../lib/dates';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { MatrizConsolidado } from '../components/MatrizConsolidado';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Edit2, Trash2, Plus, Save, FileDown, Sheet, Tag, TrendingUp, AlertTriangle, Barcode, Check, AlertCircle, ImagePlus, X as XIcon, Loader2, Percent } from 'lucide-react';
import { AuditoriaInspect } from '../components/AuditoriaInspect';
import { BotaoModeloPlanilha } from '../components/BotaoModeloPlanilha';
import { useFetchData, dbInsert, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, ExportButton, NeuButtonAccent, StatusBadge, FilialBadge, Pagination, ProdutoThumb } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useFormValidation, exportToExcel, formatBRL, parseBRL, handleMoneyKeyDown, formatQtd, parseQtd, handleQtdKeyDown, qtdBR } from '../lib/viewUtils';
import { normalizeEan13, drawEan13ToCanvas, downloadEan13LabelPdf, drawEtiquetasGridOnDoc } from '../lib/barcode';
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
  UNIDADES_FRACIONARIAS,
  temConteudoDeEmbalagem,
  normalizarUnidade,
  formatarConteudo,
} from '../lib/unidades';
import { ATRIBUTOS_PRODUTO, type AtributoDef } from '../lib/atributosProduto';
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

const ProdutosViewInner = ({ showToast, filial }: { showToast: any; filial: FilialOp }) => {
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data: categoriasProduto }  = useFetchData<any>('categorias_produto');
  const { data: subcategoriasProduto } = useFetchData<any>('subcategorias_produto');
  const { data: fornecedoresList } = useFetchData<any>('/api/crmview-fornecedores', { filial });

  const fornecedoresOrdenados = useMemo(
    () => [...fornecedoresList].sort((a: any, b: any) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
    [fornecedoresList]
  );


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

  const [isSaving, setIsSaving]   = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [editItem, setEditItem]   = useState<any | null>(null);
  const [form, setForm]   = useState({ codigo: '', nome: '', preco: '' });
  const [extras, setExtras] = useState(EMPTY_EXTRAS);

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
        nome:   p.nome,
        ean:    p.ean,
        codigo: p.codigo,
        preco:  p.preco != null ? parseNum(p.preco) : null,
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
          nome:   p.nome,
          ean:    p.ean,
          codigo: p.codigo,
          preco:  p.preco != null ? parseNum(p.preco) : null,
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
      elegivel_beneficios:    !!item.elegivel_beneficios,
      atributos:              (item.atributos && typeof item.atributos === 'object') ? item.atributos : {},
    });
    const imagensItem = [item.imagem_url ?? '', item.imagem_url_2 ?? '', item.imagem_url_3 ?? ''];
    setImagens(imagensItem);
    setImagensAnteriores(imagensItem);
    setImagensAviso(Array(PRODUTO_IMAGEM_MAX_SLOTS).fill(null));
    setErrors({});
    setShowForm(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditItem(null);
    setForm({ codigo: '', nome: '', preco: '' });
    setExtras({ ...EMPTY_EXTRAS, filial });
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
    if (!extras.fornecedor)          ee.fornecedor    = 'Selecione um fornecedor';
    if (!extras.preco_custo.trim())  ee.preco_custo   = 'Obrigatório';
    // Patrimônio não tem ponto de reposição — não se repõe um freezer.
    if (temEstoque(extras.tipo) && extras.estoque_minimo === '') {
      ee.estoque_minimo = 'Obrigatório';
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
      const paiMarcado = dependente && extras.atributos?.[d.dependeDe!] === true;
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
      const custoValor   = extras.preco_custo !== '' ? parseBRL(extras.preco_custo) : 0;
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
        ean:                    extras.ean,
        fornecedor:             extras.fornecedor,
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
              ? { ...(updated ?? { ...d, ...basePayload }), preco_custo: custoValor }
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
        if (novoId) await salvarPrecoCusto(novoId, custoValor);
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
        if (saved) { saved.estoque = saldoFinal; saved.preco_custo = custoValor; }
        // Patrimônio não entra na grade: o filtro server-side (`tipo neq
        // patrimonio`) o excluiria no reload. Empurrar para `data` fazia o item
        // aparecer, o aluno ler "criado com sucesso" e o produto evaporar no F5.
        if (!isPatrimonio) {
          setData([saved ?? { id: Date.now(), ...insertPayload, estoque: saldoFinal, preco_custo: custoValor }, ...data]);
        }
        showToast(
          isPatrimonio
            ? 'Patrimônio cadastrado! Ele não aparece nesta lista — está em Financeiro > Patrimônio.'
            : 'Produto criado com sucesso!',
          'success', true);
      }
      closeForm();
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Produtos] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
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

  const downloadLabelFor = async (item: { ean?: string; nome?: string; codigo?: string; preco?: any }) => {
    try {
      await downloadEan13LabelPdf({
        ean: item.ean ?? '',
        nome: item.nome,
        codigo: item.codigo,
        preco: item.preco != null ? parseNum(item.preco) : null,
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

              {/* Identificação */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Identificação</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField label="Código *" error={errors.codigo}>
                    <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.codigo ? 'border border-red-500/40' : ''}`}
                      value={form.codigo} onChange={e => { setForm(f => ({ ...f, codigo: e.target.value })); clearError('codigo'); }}
                      placeholder="Ex: 001" />
                    <p className="text-[10px] text-gray-500 mt-1">
                      Código único dentro da <span className="font-mono text-accent">{filial}</span>. Filiais diferentes podem usar o mesmo código.
                    </p>
                  </FormField>
                  <FormField label="Nome do produto *" error={errors.nome}>
                    <input className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.nome ? 'border border-red-500/40' : ''}`}
                      value={form.nome} onChange={e => { setForm(f => ({ ...f, nome: e.target.value })); clearError('nome'); }}
                      placeholder="Ex: Parafuso M6" />
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
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.categoria} onChange={e => setExtras(x => ({ ...x, categoria: e.target.value }))}
                        placeholder="Ex: Fixadores, Eletrônicos" />
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
                  <FormField label="Cód. Barras EAN">
                    <input className="neu-input py-2 px-3 rounded-xl text-sm font-mono"
                      value={extras.ean} onChange={e => setExtras(x => ({ ...x, ean: e.target.value }))}
                      placeholder="Ex: 7891234567890 (12 ou 13 dígitos)" inputMode="numeric" />
                  </FormField>
                  <FormField label="Fornecedor *" error={extrasErrors.fornecedor}>
                    <select className={`neu-input py-2 px-3 rounded-xl text-sm ${extrasErrors.fornecedor ? 'border border-red-500/40' : ''}`}
                      value={extras.fornecedor}
                      onChange={e => { setExtras(x => ({ ...x, fornecedor: e.target.value })); setExtrasErrors(ev => ({ ...ev, fornecedor: '' })); }}>
                      <option value="">— Selecione —</option>
                      {fornecedoresOrdenados.map((f: any) => (
                        <option key={f.id} value={f.nome}>{f.nome}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Marca *" error={extrasErrors.marca}>
                    <input className={`neu-input py-2 px-3 rounded-xl text-sm ${extrasErrors.marca ? 'border border-red-500/40' : ''}`}
                      value={extras.marca}
                      onChange={e => { setExtras(x => ({ ...x, marca: e.target.value })); setExtrasErrors(ev => ({ ...ev, marca: '' })); }}
                      placeholder="Ex: Samsung, Nestlé, 3M" />
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
                        // Campo dependente some quando o pai está desmarcado —
                        // era assim que "Validade (dias)" ficava aberto para
                        // detergente.
                        if (d.dependeDe && extras.atributos?.[d.dependeDe] !== true) return null;

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
                              <FormField label={d.label} error={err}>
                                <textarea rows={3}
                                  className={`neu-input py-2 px-3 rounded-xl text-sm resize-none ${err ? 'border border-red-500/40' : ''}`}
                                  value={String(val)} onChange={e => setAtr(e.target.value)}
                                  placeholder={d.placeholder} />
                              </FormField>
                            </div>
                          );
                        }
                        if (d.type === 'select' && d.options) {
                          return (
                            <div key={d.key} className={d.wide ? 'sm:col-span-2' : ''}>
                              <FormField label={d.label} error={err}>
                                <select className={`neu-input py-2 px-3 rounded-xl text-sm ${err ? 'border border-red-500/40' : ''}`}
                                  value={String(val)} onChange={e => setAtr(e.target.value)}>
                                  <option value="">— Selecione —</option>
                                  {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </FormField>
                              {d.dica && <span className="text-[10px] text-gray-500 block mt-1">{d.dica}</span>}
                            </div>
                          );
                        }
                        return (
                          <div key={d.key} className={d.wide ? 'sm:col-span-2' : ''}>
                            <FormField label={d.reqSe ? `${d.label} *` : d.label} error={err}>
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
                  <ImagePlus size={12} /> Imagens do produto (até {PRODUTO_IMAGEM_MAX_SLOTS})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {imagens.map((url, slotIdx) => (
                    <div key={slotIdx} className="neu-pressed rounded-2xl p-3 border border-white/5 flex flex-col items-center gap-2">
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
                <p className="text-[11px] text-gray-500 leading-snug mt-2">
                  Aceita <span className="font-bold text-gray-300">JPG, PNG ou WEBP</span> — cada foto é comprimida
                  automaticamente para WebP até <span className="font-bold text-gray-300">{PRODUTO_IMAGEM_OUTPUT_MAX_LABEL}</span>,
                  então pode enviar direto da câmera. Use imagens de pelo menos{' '}
                  <span className="font-bold text-gray-300">{PRODUTO_IMAGEM_RES_IDEAL} px</span> no menor lado: miniatura
                  baixada da web fica borrada, porque o sistema reduz mas nunca amplia. A capa é a que aparece no PDV, Catálogo e vitrine; sem imagem, o produto exibe um ícone padrão.
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
                      onChange={e => setExtras(x => ({ ...x, tipo: normalizarTipo(e.target.value) }))}>
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
                        placeholder="Ex: Igor Neri" />
                    </FormField>
                    <FormField label="Localização">
                      <input className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.patrimonio_localizacao}
                        onChange={e => setExtras(x => ({ ...x, patrimonio_localizacao: e.target.value }))}
                        placeholder="Ex: Sala TI - Rio Branco" />
                    </FormField>
                  </div>
                )}
              </div>

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
                      : 'Preço de Custo (R$) *'}
                    error={extrasErrors.preco_custo}>
                    <input type="text" inputMode="numeric"
                      className={`neu-input py-2 px-3 rounded-xl text-sm tabular-nums ${extrasErrors.preco_custo ? 'border border-red-500/40' : ''}`}
                      value={extras.preco_custo}
                      onChange={e => { setExtras(x => ({ ...x, preco_custo: formatBRL(e.target.value) })); setExtrasErrors(ev => ({ ...ev, preco_custo: '' })); }}
                      onKeyDown={handleMoneyKeyDown} placeholder="0,00" />
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
                      <p className="text-[10px] text-gray-500 mt-1">Saldo controlado por Movimentações / Recebimentos.</p>
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
                <NeuButtonAccent onClick={handleSave} isLoading={isSaving}><Save size={14} /> {editItem ? 'Atualizar' : 'Salvar'}</NeuButtonAccent>
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
                            <AuditoriaInspect criadoPor={item.criado_por} criadoEm={item.created_at} atualizadoPor={item.atualizado_por} atualizadoEm={item.updated_at} />
                            {normalizeEan13(item.ean).valid && (
                              <button onClick={() => downloadLabelFor(item)}
                                title="Baixar etiqueta EAN-13 em PDF"
                                className="action-btn-neutral">
                                <Barcode size={12} />
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
    </motion.div>
  );
};

export const ProdutosView = ({ showToast }: any) => {
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
  return <ProdutosViewInner showToast={showToast} filial={filialAtiva} />;
};
