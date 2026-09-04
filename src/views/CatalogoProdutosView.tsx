import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Package, Tag, Barcode, Building2, Boxes, AlertCircle, TrendingUp, Lock, Copy, Award, ClipboardList } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { ehVendavel } from '../lib/tipoProduto';
import { ATRIBUTOS_PRODUTO, rotuloParaCliente } from '../lib/atributosProduto';
import { calcMarkup, calcMargem, corDoMarkup, fmtPct } from '../lib/precificacao';
import {
  LoadingSpinner,
  EmptyState,
  FilialBadge,
  ProdutoThumb,
  Pagination,
} from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatBRL } from '../lib/viewUtils';
import { FILIAIS_HOLDING } from '../lib/filiais';
import { hasSetor, isConselheiro } from '../lib/rbac';
import { useFilial } from '../contexts/FilialContext';
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
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch, filialFiltro, categoriaFiltro]);

  const { data, isLoading, totalCount, reload } = useFetchData<any>(
    // Lê pela view mascarada: preco_custo vem NULL para quem não é
    // financeiro/marketing/logística (migração 262). O gate visual
    // `podeVerCusto` abaixo continua valendo — agora com respaldo no servidor.
    '/api/produtoscomcustoview',
    filialFiltro === 'todas' ? undefined : { filial: filialFiltro },
    false,
    {
      page,
      searchTerm: debouncedSearch,
      searchColumns: ['nome', 'codigo', 'categoria', 'ean', 'fornecedor'],
      orderBy: 'codigo',
      ascending: false,
    }
  );

  const podeVerCusto =
    profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile)
    || hasSetor(profile, 'financeiro') || hasSetor(profile, 'marketing');

  // Catálogo = só itens vendáveis ativos. Patrimônio (tipo='patrimonio') é gestão
  // contábil, não pertence ao catálogo público.
  // Ordem: agrupar por filial (FILIAIS_HOLDING fixa a ordem) e dentro de cada
  // filial mostrar codigo DESC com `numeric: true` (ML-10 > ML-9).
  const filialRank = (f?: string) => {
    const idx = (FILIAIS_HOLDING as readonly string[]).indexOf(f ?? '');
    return idx === -1 ? FILIAIS_HOLDING.length : idx;
  };
  const produtosVisiveis = useMemo(
    () => data.filter((p: any) =>
      (p.status === 'Ativo' || !p.status) &&
      ehVendavel(p.tipo) &&
      (categoriaFiltro === 'todas' || p.categoria === categoriaFiltro)
    ).slice().sort((a: any, b: any) => {
      const ra = filialRank(a.filial);
      const rb = filialRank(b.filial);
      if (ra !== rb) return ra - rb;
      return String(b.codigo ?? '').localeCompare(String(a.codigo ?? ''), 'pt-BR', { numeric: true });
    }),
    [data, categoriaFiltro]
  );

  // Categorias do filtro saem só dos itens que o catálogo realmente mostra —
  // senão categoria exclusiva de patrimônio ou de material de consumo aparece
  // no dropdown e, ao ser escolhida, devolve lista vazia (o filtro de tipo
  // acima já removeu os itens).
  const categorias = useMemo(() => {
    const set = new Set<string>();
    data.forEach((p: any) => {
      if (!ehVendavel(p.tipo)) return;
      if (p.categoria) set.add(p.categoria);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [data]);

  const estoqueBadge = (p: any) => {
    const est = Number(p.estoque ?? 0);
    const min = Number(p.estoque_minimo ?? 0);
    if (est <= 0) return { label: 'Esgotado', cls: 'text-red-500', bg: 'bg-red-500/10' };
    if (min > 0 && est <= min) return { label: 'Estoque baixo', cls: 'text-yellow-500', bg: 'bg-yellow-500/10' };
    return { label: 'Em estoque', cls: 'text-emerald-400', bg: 'bg-emerald-500/10' };
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Catálogo de Produtos</h2>
          <p className="text-sm text-gray-400 mt-1">Vitrine consultiva — toque num produto para ver imagem, ficha e preço.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center shrink-0">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar por nome, código, categoria, EAN..."
            className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
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
      </div>

      {/* Grid de cards */}
      {isLoading ? (
        <LoadingSpinner />
      ) : produtosVisiveis.length === 0 ? (
        <EmptyState message="Nenhum produto encontrado com os filtros atuais." />
      ) : (
        <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {produtosVisiveis.map((p: any) => {
              const badge = estoqueBadge(p);
              return (
                <motion.button
                  key={p.id}
                  onClick={() => setSelecionado(p)}
                  whileTap={{ scale: 0.97 }}
                  className="neu-button rounded-2xl p-3 flex flex-col gap-2 text-left transition-all border border-transparent hover:border-accent/30"
                >
                  <div className="flex justify-center">
                    <ProdutoThumb url={p.imagem_url} size="md" alt={p.nome} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    {p.filial && <FilialBadge filial={p.filial} />}
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">
                      {p.codigo || '—'}
                    </span>
                    <span className="text-sm font-bold text-gray-200 leading-tight line-clamp-2">
                      {p.nome}
                    </span>
                    {p.marca && (
                      <span className="text-[10px] text-gray-500 flex items-center gap-1 truncate">
                        <Award size={9} className="shrink-0" /> {p.marca}
                      </span>
                    )}
                  </div>
                  <div className="flex items-end justify-between mt-auto pt-1">
                    <span className="text-base font-black text-accent tabular-nums">
                      R$ {formatBRL(Number(p.preco ?? 0))}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badge.bg} ${badge.cls} uppercase tracking-wider`}>
                      {badge.label}
                    </span>
                  </div>
                </motion.button>
              );
            })}
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
              className="neu-flat rounded-3xl w-full max-w-2xl p-6 flex flex-col gap-5 border border-white/5 relative max-h-[90vh] overflow-y-auto main-scrollbar"
              style={{ background: 'var(--color-bg-base)' }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setSelecionado(null)}
                className="absolute top-4 right-4 w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                aria-label="Fechar"
              >
                <X size={14} />
              </button>

              <div className="flex flex-col sm:flex-row gap-5 items-start">
                <div className="shrink-0 mx-auto sm:mx-0 flex flex-col items-center gap-2">
                  <ProdutoThumb url={imagemAtiva} size="lg" alt={selecionado.nome} />
                  {[selecionado.imagem_url, selecionado.imagem_url_2, selecionado.imagem_url_3].filter(Boolean).length > 1 && (
                    <div className="flex gap-1.5">
                      {[selecionado.imagem_url, selecionado.imagem_url_2, selecionado.imagem_url_3]
                        .filter(Boolean)
                        .map((url: string, i: number) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setImagemAtiva(url)}
                            className={`rounded-lg overflow-hidden border transition-colors ${imagemAtiva === url ? 'border-accent' : 'border-white/10 opacity-70 hover:opacity-100'}`}
                          >
                            <ProdutoThumb url={url} size="xs" alt={`${selecionado.nome} — foto ${i + 1}`} />
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
