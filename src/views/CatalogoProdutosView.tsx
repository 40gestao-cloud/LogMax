import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Package, Tag, Barcode, Building2, Boxes, AlertCircle, TrendingUp, Lock, Copy, Award, ClipboardList, ArrowUpDown, FilterX } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { ATRIBUTOS_PRODUTO, rotuloParaCliente } from '../lib/atributosProduto';
import { calcMarkup, calcMargem, corDoMarkup, fmtPct } from '../lib/precificacao';
import {
  LoadingSpinner,
  EmptyState,
  FilialBadge,
  ImagemProduto,
  Pagination,
} from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatBRL } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';
import { hasSetor, isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
import { PAGE_SIZE } from '../hooks/useSupabaseData';
import type { UserProfile } from '../hooks/useUserProfile';

// Markup e margem vêm de src/lib/precificacao.ts — esta era a segunda cópia
// da fórmula, e ela calculava markup sob o rótulo "Margem".

// Catálogo é vitrine read-only para todos os setores. CRUD continua em
// Empresa → Produtos (ProdutosView). Bloco financeiro (custo + markup/margem) é
// gated por admin/CEO/financeiro/marketing — demais setores só veem preço de venda.
// Rótulo legível de cada chave de `produtos.atributos`. Derivado da ficha, não
// copiado dela: era um mapa escrito à mão aqui, com a justificativa de "evitar
// dependência circular entre views" — justificativa que venceu quando a ficha
// saiu de ProdutosView para `src/lib/atributosProduto.ts`, que é lib e não
// importa view nenhuma.
//
// E a cópia já tinha ficado para trás: faltavam `perecivel`, `validade_dias` e
// `armazenagem` (a ficha da mercearia inteira), que apareciam em caixa baixa
// pelo fallback, e faltaria `estado` no dia em que ele entrasse na TechMax.
// É a mesma duplicação que o modelo de planilha tinha e deixou de ter.
const ATRIBUTO_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(ATRIBUTOS_PRODUTO)
    .flat()
    .map(d => [d.key, rotuloParaCliente(d.label)]),
);

const formatAtributoValor = (v: any): string => {
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

// Régua canônica de filial no Catálogo:
//  - Admin/CEO em modo Matriz (filialAtiva=null) → vê as 3 unidades.
//  - Admin/CEO com filial escolhida no topbar → só produtos daquela filial.
//  - Gerente/colaborador → travado na própria filial (independente do topbar).
// A prioridade é: filialAtiva do topbar > profile.filial > 'todas' (só Matriz).
const ORDENS = {
  recentes:   { label: 'Mais recentes',  orderBy: 'codigo', ascending: false },
  nome:       { label: 'Nome (A–Z)',     orderBy: 'nome',   ascending: true },
  menorPreco: { label: 'Menor preço',    orderBy: 'preco',  ascending: true },
  maiorPreco: { label: 'Maior preço',    orderBy: 'preco',  ascending: false },
} as const;
type Ordem = keyof typeof ORDENS;

// Situação do estoque em cor cheia (mesma régua do StatusBadge): o selo fica
// em cima da foto, e o translúcido sumia contra ela.
const estoqueBadge = (p: any) => {
  const est = Number(p.estoque ?? 0);
  const min = Number(p.estoque_minimo ?? 0);
  if (est <= 0) return { label: 'Esgotado', cls: 'bg-red-600 text-white' };
  if (min > 0 && est <= min) return { label: 'Estoque baixo', cls: 'bg-orange-600 text-white' };
  return { label: 'Em estoque', cls: 'bg-green-600 text-white' };
};

const isMatrizViewer = (profile: UserProfile) =>
  !profile.filial || profile.filial === 'Matriz';

export const CatalogoProdutosView = ({ showToast, profile }: { showToast: any; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  // Só libera o seletor "Todas" quando o usuário é Matriz E está no modo
  // Matriz (sem filial escolhida no topbar). Se admin/CEO escolheu uma
  // filial, o Catálogo passa a ser da unidade — sem opção de escapar.
  const podeVerTodasFiliais = isMatrizViewer(profile) && !filialAtiva;
  const filialEscopo: string =
    filialAtiva ? filialAtiva
    : isMatrizViewer(profile) ? 'todas'
    : (profile.filial as string);
  const [filialFiltro, setFilialFiltro] = useState<string>(filialEscopo);
  // Ressincroniza quando o topbar troca de filial (admin alternando entre
  // unidades) — sem isso o filtro fica preso na escolha inicial.
  useEffect(() => { setFilialFiltro(filialEscopo); }, [filialEscopo]);
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('todas');
  const [selecionado, setSelecionado] = useState<any | null>(null);
  // Modal de detalhes: qual das até 3 imagens do produto está em destaque.
  // Reseta pra capa toda vez que um produto diferente é aberto.
  const [imagemAtiva, setImagemAtiva] = useState<string | null>(null);
  useEffect(() => { setImagemAtiva(selecionado?.imagem_url ?? null); }, [selecionado?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ordem, setOrdem] = useState<Ordem>('recentes');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, filialFiltro, categoriaFiltro, ordem]);

  // Tipo, status e categoria vão para o servidor. Eram filtrados no array da
  // página já carregada: a página vinha com menos cards que o tamanho dela e o
  // "1–50 de 80" contava linhas que a tela não mostrava. As duas colunas são
  // NOT NULL com default ('estoque_venda', 'Ativo'), então não há legado nulo.
  const filtros = useMemo(() => ({
    tipo: 'estoque_venda',
    status: 'Ativo',
    ...(filialFiltro !== 'todas' ? { filial: filialFiltro } : {}),
    ...(categoriaFiltro !== 'todas' ? { categoria: categoriaFiltro } : {}),
  }), [filialFiltro, categoriaFiltro]);

  const { data, isLoading, totalCount, reload } = useFetchData<any>(
    // Lê pela view mascarada: preco_custo vem NULL para quem não é
    // financeiro/marketing/logística (migração 262). O gate visual
    // `podeVerCusto` abaixo continua valendo — agora com respaldo no servidor.
    '/api/produtoscomcustoview',
    filtros,
    false,
    {
      page,
      searchTerm: debouncedSearch,
      searchColumns: ['nome', 'codigo', 'categoria', 'ean', 'fornecedor', 'marca'],
      orderBy: ORDENS[ordem].orderBy,
      ascending: ORDENS[ordem].ascending,
    }
  );

  const podeVerCusto =
    profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile)
    || hasSetor(profile, 'financeiro') || hasSetor(profile, 'marketing');

  // Categorias do filtro: leitura própria, só da coluna, no escopo da unidade.
  // Saíam da página carregada — categoria que só existia na página 2 não
  // aparecia no seletor.
  const [categorias, setCategorias] = useState<string[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let vivo = true;
    let q = supabase.from('produtos_com_custo').select('categoria')
      .eq('tipo', 'estoque_venda').eq('status', 'Ativo').not('categoria', 'is', null);
    if (filialFiltro !== 'todas') q = q.eq('filial', filialFiltro);
    q.then(({ data: rows }) => {
      if (!vivo || !rows) return;
      const set = new Set<string>(rows.map((r: any) => String(r.categoria)).filter(Boolean));
      setCategorias(Array.from(set).sort((x, y) => x.localeCompare(y, 'pt-BR')));
    });
    return () => { vivo = false; };
  }, [filialFiltro]);
  // Categoria escolhida que não existe na unidade nova volta para "todas".
  useEffect(() => {
    if (categoriaFiltro !== 'todas' && categorias.length > 0 && !categorias.includes(categoriaFiltro)) {
      setCategoriaFiltro('todas');
    }
  }, [categorias]); // eslint-disable-line react-hooks/exhaustive-deps

  const mostrarFilial = filialFiltro === 'todas';
  const temFiltro = search.trim() !== '' || categoriaFiltro !== 'todas' || ordem !== 'recentes';
  const limparFiltros = () => { setSearch(''); setCategoriaFiltro('todas'); setOrdem('recentes'); };

  const imagensDo = (p: any): string[] =>
    [p?.imagem_url, p?.imagem_url_2, p?.imagem_url_3].filter(Boolean);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-5 overflow-y-auto main-scrollbar pb-6">
      <div className="flex flex-col gap-1 shrink-0">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Catálogo de Produtos</h2>
        <p className="text-sm text-gray-500">
          {totalCount === null
            ? 'Carregando produtos…'
            : `${totalCount} ${totalCount === 1 ? 'produto à venda' : 'produtos à venda'} · ${mostrarFilial ? 'todas as unidades' : filialFiltro}`}
        </p>
      </div>

      {/* Filtros */}
      <div className="neu-flat rounded-2xl p-3 border border-white/5 flex flex-wrap gap-2.5 items-center shrink-0">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar por nome, código, marca, categoria, EAN..."
            className="neu-input py-2.5 pl-10 pr-9 rounded-xl text-sm w-full"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200">
              <X size={14} />
            </button>
          )}
        </div>
        {podeVerTodasFiliais ? (
          <select
            value={filialFiltro}
            onChange={e => setFilialFiltro(e.target.value)}
            className="neu-input py-2.5 px-3 rounded-xl text-sm"
            aria-label="Filtrar por unidade"
          >
            <option value="todas">Todas as unidades</option>
            {FILIAIS_HOLDING.filter(f => f !== 'Matriz').map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        ) : (
          <div className="neu-pressed py-2.5 px-3 rounded-xl text-sm text-gray-400 flex items-center gap-2 border border-white/5">
            <Building2 size={13} className="text-gray-500" />
            <span>Unidade: <span className="font-bold text-accent">{filialFiltro}</span></span>
          </div>
        )}
        <select
          value={categoriaFiltro}
          onChange={e => setCategoriaFiltro(e.target.value)}
          className="neu-input py-2.5 px-3 rounded-xl text-sm"
          aria-label="Filtrar por categoria"
        >
          <option value="todas">Todas as categorias</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative">
          <ArrowUpDown size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <select
            value={ordem}
            onChange={e => setOrdem(e.target.value as Ordem)}
            className="neu-input py-2.5 pl-8 pr-3 rounded-xl text-sm"
            aria-label="Ordenar"
          >
            {(Object.keys(ORDENS) as Ordem[]).map(k => <option key={k} value={k}>{ORDENS[k].label}</option>)}
          </select>
        </div>
        {temFiltro && (
          <button type="button" onClick={limparFiltros}
            className="text-xs font-bold text-gray-400 hover:text-accent flex items-center gap-1.5 px-2 py-2">
            <FilterX size={13} /> Limpar
          </button>
        )}
      </div>

      {/* Grade de cards */}
      {isLoading && data.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4 shrink-0" aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="neu-flat rounded-2xl overflow-hidden border border-white/5 animate-pulse">
              <div className="aspect-square bg-white/[0.04]" />
              <div className="p-3 flex flex-col gap-2">
                <div className="h-2.5 w-1/3 rounded bg-white/[0.06]" />
                <div className="h-3.5 w-4/5 rounded bg-white/[0.06]" />
                <div className="h-4 w-1/2 rounded bg-white/[0.06] mt-2" />
              </div>
            </div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState message="Nenhum produto encontrado com os filtros atuais." />
      ) : (
        <div className={`flex flex-col gap-4 shrink-0 transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
            {data.map((p: any) => {
              const badge = estoqueBadge(p);
              const n = imagensDo(p).length;
              return (
                <motion.button
                  key={p.id}
                  type="button"
                  onClick={() => setSelecionado(p)}
                  whileTap={{ scale: 0.98 }}
                  className="group neu-flat rounded-2xl overflow-hidden flex flex-col text-left border border-white/5 hover:border-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="relative aspect-square overflow-hidden neu-pressed flex items-center justify-center text-gray-600">
                    <Package size={34} strokeWidth={1.25} className="absolute" />
                    {p.imagem_url && (
                      <ImagemProduto url={p.imagem_url} alt={p.nome}
                        className="relative w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    )}
                    <span className={`absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shadow ${badge.cls}`}>
                      {badge.label}
                    </span>
                    {mostrarFilial && p.filial && (
                      <span className="absolute top-2 left-2"><FilialBadge filial={p.filial} /></span>
                    )}
                    {n > 1 && (
                      <span className="absolute bottom-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white">
                        {n} fotos
                      </span>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-1 flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">
                      {p.codigo || '—'}{p.marca ? ` · ${p.marca}` : ''}
                    </span>
                    <span className="text-sm font-bold text-gray-200 leading-snug line-clamp-2 min-h-[2.5rem]" title={p.nome}>
                      {p.nome}
                    </span>
                    {p.categoria && (
                      <span className="text-[10px] text-gray-500 flex items-center gap-1 truncate">
                        <Tag size={9} className="shrink-0" /> {p.categoria}
                      </span>
                    )}
                    <span className="text-lg font-black text-accent tabular-nums mt-auto pt-1">
                      R$ {formatBRL(Number(p.preco ?? 0))}
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
          <div className="neu-flat rounded-2xl px-4 pb-3 border border-white/5">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={totalCount}
              isLoading={isLoading}
              onPrev={() => setPage(p => Math.max(0, p - 1))}
              onNext={() => setPage(p => p + 1)}
              onReload={reload}
            />
          </div>
        </div>
      )}

      {/* Modal de detalhes */}
      <AnimatePresence>
        {selecionado && (
          <motion.div
            key="catalogo-modal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
            onClick={() => setSelecionado(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              className="neu-flat rounded-3xl w-full max-w-3xl p-6 flex flex-col gap-5 border border-white/5 relative max-h-[90vh] overflow-y-auto main-scrollbar"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setSelecionado(null)}
                className="absolute top-4 right-4 z-10 w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                aria-label="Fechar"
              >
                <X size={14} />
              </button>

              <div className="flex flex-col sm:flex-row gap-5 items-start">
                {/* Foto grande: aqui vale a original (é onde se olha o detalhe);
                    as miniaturas de troca usam a versão leve. */}
                <div className="w-full sm:w-64 shrink-0 flex flex-col gap-2">
                  <div className="relative aspect-square rounded-2xl overflow-hidden neu-pressed border border-white/5 flex items-center justify-center text-gray-600">
                    <Package size={40} strokeWidth={1.25} className="absolute" />
                    {imagemAtiva && (
                      <ImagemProduto key={imagemAtiva} url={imagemAtiva} original alt={selecionado.nome}
                        className="relative w-full h-full object-cover" />
                    )}
                  </div>
                  {imagensDo(selecionado).length > 1 && (
                    <div className="flex gap-2">
                      {imagensDo(selecionado).map((url, i) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setImagemAtiva(url)}
                          aria-label={`Ver foto ${i + 1}`}
                          className={`w-14 h-14 rounded-lg overflow-hidden border-2 neu-pressed transition ${imagemAtiva === url ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'}`}
                        >
                          <ImagemProduto url={url} alt={`${selecionado.nome} — foto ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  {selecionado.filial && <FilialBadge filial={selecionado.filial} />}
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    {selecionado.codigo || '—'}
                  </span>
                  <div className="flex items-start gap-2">
                    <h3 className="text-xl font-bold text-gray-100 leading-tight flex-1 min-w-0">{selecionado.nome}</h3>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(selecionado.nome ?? '');
                          showToast?.('Nome copiado!', 'success', true);
                        } catch {
                          showToast?.('Não foi possível copiar.', 'error', true);
                        }
                      }}
                      className="action-btn-neutral shrink-0 mt-0.5"
                      title="Copiar nome"
                      aria-label="Copiar nome do produto"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  {selecionado.categoria && (
                    <span className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Tag size={11} /> {selecionado.categoria}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Preço de venda</span>
                  <span className="text-lg font-black text-accent tabular-nums">
                    R$ {formatBRL(Number(selecionado.preco ?? 0))}
                  </span>
                </div>
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Estoque</span>
                  <span className="text-lg font-black text-gray-200 tabular-nums flex items-center gap-1.5">
                    <Boxes size={14} className="text-gray-500" />
                    {Number(selecionado.estoque ?? 0)}
                  </span>
                  {Number(selecionado.estoque_minimo ?? 0) > 0 && (
                    <span className="text-[10px] text-gray-500">mín. {selecionado.estoque_minimo}</span>
                  )}
                </div>
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">EAN</span>
                  <span className="text-sm font-credencial text-gray-300 flex items-center gap-1.5 truncate">
                    <Barcode size={12} className="text-gray-500 shrink-0" />
                    {selecionado.ean || '—'}
                  </span>
                </div>
                {selecionado.fornecedor && (
                  <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1 col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Fornecedor</span>
                    <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5 truncate">
                      <Building2 size={12} className="text-gray-500 shrink-0" />
                      {selecionado.fornecedor}
                    </span>
                  </div>
                )}
                {selecionado.marca && (
                  <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Marca</span>
                    <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5 truncate">
                      <Award size={12} className="text-gray-500 shrink-0" />
                      {selecionado.marca}
                    </span>
                  </div>
                )}
                <div className="neu-pressed rounded-xl p-3 flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Status</span>
                  <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5">
                    <Package size={12} className="text-gray-500" />
                    {selecionado.status ?? 'Ativo'}
                  </span>
                </div>
              </div>

              {/* Ficha técnica — atributos JSONB por nicho (MaxLook: tamanho/cor/gênero...;
                  TechMax: modelo/memória/tela/bateria...). SuperMax raramente
                  preenche, então o bloco só renderiza se houver algum atributo. */}
              {selecionado.atributos && typeof selecionado.atributos === 'object' && Object.keys(selecionado.atributos).length > 0 && (
                <div className="neu-pressed rounded-xl p-4 flex flex-col gap-3 border border-white/5">
                  <div className="flex items-center gap-2">
                    <ClipboardList size={11} className="text-accent" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Ficha Técnica</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(selecionado.atributos)
                      .filter(([, v]) => v !== null && v !== undefined && v !== '')
                      // Texto livre ocupa a linha inteira e não é truncado — a
                      // célula de 1/3 cortaria justamente a informação que só
                      // existe porque não coube nos campos fixos.
                      .map(([k, v]) => k === 'informacoes_adicionais' ? (
                        <div key={k} className="col-span-full flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            {ATRIBUTO_LABEL[k] ?? k.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                            {formatAtributoValor(v)}
                          </span>
                        </div>
                      ) : (
                        <div key={k} className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            {ATRIBUTO_LABEL[k] ?? k.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm font-bold text-gray-200 truncate">
                            {formatAtributoValor(v)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Bloco sensível: custo + margem só para admin/CEO/financeiro */}
              {podeVerCusto && (
                <div className="rounded-xl p-4 flex flex-col gap-3 border" style={{
                  borderColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                  background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
                }}>
                  <div className="flex items-center gap-2">
                    <Lock size={11} className="text-accent" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Visão Financeira</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Preço de custo</span>
                      <span className="text-base font-bold text-gray-200 tabular-nums">
                        R$ {formatBRL(Number(selecionado.preco_custo ?? 0))}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {/* Markup em destaque (é o que sempre esteve aqui, com o
                          nome errado) e a margem logo abaixo, menor: quem abre
                          a ficha no Catálogo está conferindo preço, não fechando
                          o resultado do mês. */}
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Markup</span>
                      {(() => {
                        const v  = Number(selecionado.preco ?? 0);
                        const c  = Number(selecionado.preco_custo ?? 0);
                        const mk = calcMarkup(v, c);
                        if (mk === null) return <span className="text-base font-bold text-gray-600">—</span>;
                        return (
                          <>
                            <span className={`text-base font-bold tabular-nums flex items-center gap-1 ${corDoMarkup(mk)}`}
                              title="Markup: quanto foi acrescentado ao custo para chegar ao preço.">
                              <TrendingUp size={13} />
                              {fmtPct(mk)}
                            </span>
                            <span className="text-[10px] text-gray-500 tabular-nums"
                              title="Margem: quanto sobra da venda. É a conta do DRE.">
                              margem {fmtPct(calcMargem(v, c))}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {!podeVerCusto && (
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <AlertCircle size={11} />
                  <span>Informações de custo, markup e margem ficam disponíveis para Financeiro, Marketing, admin e CEO.</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
