import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Trophy, Star, Check, X, MessageSquare, Loader2, Search,
  Palette, ShoppingCart, Package, Users, UserCircle, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';

const OP_FILIAIS = ['SuperMax', 'MaxLook', 'TechMax'] as const;
type FilialOp = typeof OP_FILIAIS[number];

const FILIAL_COLOR: Record<FilialOp, string> = {
  SuperMax: 'text-sky-400 bg-sky-500/10 ring-sky-500/30',
  MaxLook:  'text-amber-300 bg-amber-400/10 ring-amber-400/30',
  TechMax:  'text-orange-400 bg-orange-500/10 ring-orange-500/30',
};

type ItemTipo =
  |'requisicao'|'cotacao'|'promocao'|'arte'|'campanha'
  |'pedido_venda'|'ferias'|'requerimento'
  |'cadastro_produto'|'cadastro_cliente'|'cadastro_fornecedor'
  |'cadastro_servico'|'cadastro_categoria';

type TipoConfig = {
  id: ItemTipo;
  label: string;
  endpoint: string;
  descField: string[];
  dateField: string;
  creative: boolean;
};

type GrupoConfig = {
  id: string;
  label: string;
  icon: any;
  tipos: TipoConfig[];
};

const GRUPOS: GrupoConfig[] = [
  {
    id: 'marketing', label: 'Marketing', icon: Palette,
    tipos: [
      { id: 'arte',     label: 'Artes',     endpoint: '/api/marketingartesview',     descField: ['titulo','nome','descricao'], dateField: 'created_at', creative: true },
      { id: 'promocao', label: 'Promoções', endpoint: '/api/marketingpromocoesview', descField: ['nome','titulo','descricao'], dateField: 'created_at', creative: true },
      { id: 'campanha', label: 'Campanhas', endpoint: '/api/marketingcampanhasview', descField: ['nome','titulo','descricao'], dateField: 'created_at', creative: true },
    ],
  },
  {
    id: 'vendas', label: 'Vendas', icon: ShoppingCart,
    tipos: [
      { id: 'pedido_venda', label: 'Pedidos de Venda', endpoint: '/api/pedidosvendaview', descField: ['cliente_nome','descricao','numero'], dateField: 'created_at', creative: false },
    ],
  },
  {
    id: 'compras', label: 'Compras', icon: Package,
    tipos: [
      { id: 'requisicao', label: 'Requisições', endpoint: '/api/requisicoesview', descField: ['descricao','item','titulo'], dateField: 'created_at', creative: false },
      { id: 'cotacao',    label: 'Cotações',    endpoint: '/api/cotacoesview',    descField: ['descricao','item','titulo'], dateField: 'created_at', creative: false },
    ],
  },
  {
    id: 'rh', label: 'RH', icon: UserCircle,
    tipos: [
      { id: 'ferias',       label: 'Férias',        endpoint: '/api/feriasview',    descField: ['funcionario_nome','colaborador_nome','descricao'], dateField: 'data_inicio', creative: false },
      { id: 'requerimento', label: 'Requerimentos', endpoint: 'requerimentos',      descField: ['titulo','descricao','assunto'],                     dateField: 'created_at',  creative: false },
    ],
  },
  {
    id: 'cadastros', label: 'Cadastros', icon: Users,
    tipos: [
      { id: 'cadastro_produto',    label: 'Produtos',    endpoint: '/api/produtosview',           descField: ['nome','descricao','codigo'],       dateField: 'created_at', creative: false },
      { id: 'cadastro_cliente',    label: 'Clientes',    endpoint: '/api/crmview-clientes',       descField: ['nome','razao_social','descricao'], dateField: 'created_at', creative: false },
      { id: 'cadastro_fornecedor', label: 'Fornecedores',endpoint: '/api/crmview-fornecedores',   descField: ['nome','razao_social','descricao'], dateField: 'created_at', creative: false },
      { id: 'cadastro_servico',    label: 'Serviços',    endpoint: '/api/servicosview',           descField: ['nome','descricao','codigo'],       dateField: 'created_at', creative: false },
      { id: 'cadastro_categoria',  label: 'Categorias',  endpoint: 'categorias_produto',          descField: ['nome','descricao'],                dateField: 'created_at', creative: false },
    ],
  },
];

const TIPO_BY_ID = new Map<ItemTipo, TipoConfig>(
  GRUPOS.flatMap(g => g.tipos.map(t => [t.id, t] as const)),
);

type Competicao = {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  status: string;
};

type Avaliacao = {
  id: string;
  competicao_id: string;
  filial_avaliada: string;
  item_tipo: ItemTipo;
  item_id: string;
  avaliador_id: string;
  decisao: 'Aprovado'|'Reprovado'|null;
  nota: number | null;
  comentario: string | null;
};

type Filtro = 'todos' | 'pendentes' | 'avaliados';
type FilialFiltro = 'todas' | FilialOp;

function firstNonEmpty(row: any, fields: string[]): string {
  for (const f of fields) {
    const v = row?.[f];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return '—';
}

const FilialBadge = ({ filial }: { filial: string }) => {
  const cls = FILIAL_COLOR[filial as FilialOp] ?? 'text-gray-400 bg-gray-500/10 ring-gray-500/30';
  return (
    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ring-1 ${cls}`}>
      {filial}
    </span>
  );
};

// ──────────────────────────────────────────────────────────────────────
export function MatrizAvaliacoesView({ profile, showToast }: { profile: UserProfile; showToast: any }) {
  const podeAvaliar = profile.role === 'ceo' || isConselheiro(profile);
  const podeAcessar = profile.role === 'admin' || podeAvaliar;

  const [tipoAtivo, setTipoAtivo] = useState<ItemTipo>('arte');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [filialFiltro, setFilialFiltro] = useState<FilialFiltro>('todas');
  const [competicao, setCompeticao] = useState<Competicao | null>(null);
  const [loadingComp, setLoadingComp] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingComp(true);
      const { data } = await supabase
        .from('competicoes_matriz')
        .select('id,nome,data_inicio,data_fim,status')
        .eq('ativo', true)
        .eq('status', 'em_andamento')
        .maybeSingle();
      setCompeticao(data as any);
      setLoadingComp(false);
    })();
  }, []);

  if (!podeAcessar) {
    return <EmptyState message="⛔ Acesso restrito — Central de Avaliação Matriz é exclusiva de admin, CEO e conselheiros." />;
  }

  if (loadingComp) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  if (!competicao) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Avaliação — Matriz</h2>
          <p className="text-sm text-gray-400 mt-1">Julgamento paralelo do conselho durante a competição.</p>
        </div>
        <EmptyState message="🏆 Nenhuma competição em andamento — abra uma em Matriz → Competição para começar a avaliar itens das 3 filiais." />
      </motion.div>
    );
  }

  const tipoConfig = TIPO_BY_ID.get(tipoAtivo)!;
  const grupoAtivo = GRUPOS.find(g => g.tipos.some(t => t.id === tipoAtivo))!;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      {/* Cabeçalho da competição */}
      <div className="neu-flat rounded-2xl border border-accent/20 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl sm:text-2xl font-bold text-accent tracking-tight">Central de Avaliação — Matriz</h2>
            <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
              <Trophy size={12} className="text-amber-400" />
              <span className="font-mono font-bold text-gray-200">{competicao.nome}</span>
              <span className="text-gray-500">·</span>
              <span className="font-mono">{competicao.data_inicio} → {competicao.data_fim}</span>
            </div>
          </div>
          {!podeAvaliar && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg bg-gray-500/15 text-gray-400 border border-gray-500/30">
              Modo leitura
            </span>
          )}
        </div>
      </div>

      {/* Layout: sidebar interna + painel principal */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,260px)_1fr] gap-5">
        <SidebarTipos
          competicao={competicao}
          profile={profile}
          tipoAtivo={tipoAtivo}
          onSelectTipo={setTipoAtivo}
        />

        <PainelTipo
          key={`${tipoAtivo}-${filtro}-${filialFiltro}`}
          tipoConfig={tipoConfig}
          grupoLabel={grupoAtivo.label}
          competicao={competicao}
          profile={profile}
          podeAvaliar={podeAvaliar}
          showToast={showToast}
          filtro={filtro}
          onFiltroChange={setFiltro}
          filialFiltro={filialFiltro}
          onFilialFiltroChange={setFilialFiltro}
        />
      </div>
    </motion.div>
  );
}

// ── Sidebar com grupos e contagem ─────────────────────────────────────
function SidebarTipos({ competicao, profile, tipoAtivo, onSelectTipo }: {
  competicao: Competicao;
  profile: UserProfile;
  tipoAtivo: ItemTipo;
  onSelectTipo: (id: ItemTipo) => void;
}) {
  // Contadores por tipo: {total_no_periodo, avaliados_por_mim}
  const [contadores, setContadores] = useState<Record<string, { total: number; meus: number }>>({});
  const [loading, setLoading] = useState(true);

  const carregarContadores = useCallback(async () => {
    setLoading(true);
    // Todas as avaliações do usuário atual nesta competição, agrupadas por tipo
    const { data: minhasAvals } = await supabase
      .from('avaliacoes_matriz')
      .select('item_tipo,item_id')
      .eq('competicao_id', competicao.id)
      .eq('avaliador_id', profile.id)
      .eq('ativo', true);
    const meusPorTipo: Record<string, Set<string>> = {};
    (minhasAvals ?? []).forEach((a: any) => {
      if (!meusPorTipo[a.item_tipo]) meusPorTipo[a.item_tipo] = new Set();
      meusPorTipo[a.item_tipo].add(a.item_id);
    });

    // Conta itens em cada tabela dentro do período. Uma query por tipo (paralela).
    const ini = competicao.data_inicio;
    const fim = competicao.data_fim + 'T23:59:59.999';
    const tipos = GRUPOS.flatMap(g => g.tipos);
    const results = await Promise.all(tipos.map(async t => {
      const table = ENDPOINT_TO_TABLE[t.endpoint] ?? t.endpoint;
      const { data } = await supabase
        .from(table)
        .select('id,filial,' + t.dateField)
        .in('filial', OP_FILIAIS as unknown as string[])
        .gte(t.dateField, ini)
        .lte(t.dateField, fim);
      const rows = (data ?? []) as any[];
      return [t.id, rows] as const;
    }));

    const novos: Record<string, { total: number; meus: number }> = {};
    for (const [tipoId, rows] of results) {
      const total = rows.length;
      const meus = rows.filter(r => meusPorTipo[tipoId]?.has(r.id)).length;
      novos[tipoId] = { total, meus };
    }
    setContadores(novos);
    setLoading(false);
  }, [competicao.id, competicao.data_inicio, competicao.data_fim, profile.id]);

  useEffect(() => { carregarContadores(); }, [carregarContadores]);

  // Recarrega quando o usuário avaliar (via evento custom)
  useEffect(() => {
    const handler = () => carregarContadores();
    window.addEventListener('avaliacao-matriz:changed', handler);
    return () => window.removeEventListener('avaliacao-matriz:changed', handler);
  }, [carregarContadores]);

  return (
    <aside className="neu-flat rounded-2xl border border-accent/10 p-3 flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      {GRUPOS.map(grupo => {
        const Icon = grupo.icon;
        return (
          <div key={grupo.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2 mb-1">
              <Icon size={12} className="text-accent shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{grupo.label}</span>
            </div>
            {grupo.tipos.map(tipo => {
              const c = contadores[tipo.id];
              const total = c?.total ?? 0;
              const meus = c?.meus ?? 0;
              const pendentes = Math.max(0, total - meus);
              const isActive = tipoAtivo === tipo.id;
              return (
                <button
                  key={tipo.id}
                  onClick={() => onSelectTipo(tipo.id)}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-all ${
                    isActive
                      ? 'neu-pressed text-accent ring-1 ring-accent/40'
                      : 'text-gray-300 hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="truncate">{tipo.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {loading ? (
                      <Loader2 size={10} className="animate-spin text-gray-600" />
                    ) : total === 0 ? (
                      <span className="text-[9px] text-gray-600 font-mono">0</span>
                    ) : pendentes > 0 ? (
                      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30">
                        {pendentes}
                      </span>
                    ) : (
                      <Check size={11} className="text-emerald-400" />
                    )}
                    {isActive && <ChevronRight size={11} className="text-accent" />}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}

// Endpoint → nome da tabela (usado pra count queries no sidebar)
const ENDPOINT_TO_TABLE: Record<string, string> = {
  '/api/marketingartesview':       'marketing_artes',
  '/api/marketingpromocoesview':   'marketing_promocoes',
  '/api/marketingcampanhasview':   'marketing_campanhas',
  '/api/requisicoesview':          'requisicoes',
  '/api/cotacoesview':             'cotacoes',
  '/api/pedidosvendaview':         'pedidos_venda',
  '/api/feriasview':               'ferias',
  '/api/produtosview':             'produtos',
  '/api/crmview-clientes':         'clientes',
  '/api/crmview-fornecedores':     'fornecedores',
  '/api/servicosview':             'servicos',
};

// ── Painel principal do tipo ativo ────────────────────────────────────
function PainelTipo({ tipoConfig, grupoLabel, competicao, profile, podeAvaliar, showToast, filtro, onFiltroChange, filialFiltro, onFilialFiltroChange }: {
  tipoConfig: TipoConfig;
  grupoLabel: string;
  competicao: Competicao;
  profile: UserProfile;
  podeAvaliar: boolean;
  showToast: any;
  filtro: Filtro;
  onFiltroChange: (f: Filtro) => void;
  filialFiltro: FilialFiltro;
  onFilialFiltroChange: (f: FilialFiltro) => void;
}) {
  const { data: itens, isLoading: lItens } = useFetchData<any>(tipoConfig.endpoint);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [loadingAv, setLoadingAv] = useState(true);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());

  const carregarAvaliacoes = useCallback(async () => {
    setLoadingAv(true);
    const { data } = await supabase
      .from('avaliacoes_matriz')
      .select('id,competicao_id,filial_avaliada,item_tipo,item_id,avaliador_id,decisao,nota,comentario')
      .eq('competicao_id', competicao.id)
      .eq('item_tipo', tipoConfig.id)
      .eq('ativo', true);
    setAvaliacoes((data as any) ?? []);
    setLoadingAv(false);
  }, [competicao.id, tipoConfig.id]);

  useEffect(() => { carregarAvaliacoes(); }, [carregarAvaliacoes]);

  const itensNoPeriodo = useMemo(() => {
    const ini = new Date(competicao.data_inicio);
    const fim = new Date(competicao.data_fim);
    fim.setHours(23, 59, 59, 999);
    return itens.filter((r: any) => {
      const d = new Date(r[tipoConfig.dateField] ?? r.created_at);
      return d >= ini && d <= fim && OP_FILIAIS.includes(r.filial as FilialOp);
    });
  }, [itens, competicao, tipoConfig.dateField]);

  const avaliacoesPorItem = useMemo(() => {
    const idx: Record<string, Avaliacao[]> = {};
    for (const a of avaliacoes) {
      if (!idx[a.item_id]) idx[a.item_id] = [];
      idx[a.item_id].push(a);
    }
    return idx;
  }, [avaliacoes]);

  // Aplica filtros (filial + status)
  const itensFiltrados = useMemo(() => {
    const porFilial = filialFiltro === 'todas'
      ? itensNoPeriodo
      : itensNoPeriodo.filter((it: any) => it.filial === filialFiltro);
    if (filtro === 'todos') return porFilial;
    return porFilial.filter((it: any) => {
      const minha = avaliacoesPorItem[it.id]?.find(a => a.avaliador_id === profile.id);
      const jaAvaliei = !!minha && (minha.decisao !== null || minha.nota !== null || (minha.comentario ?? '').trim() !== '');
      return filtro === 'pendentes' ? !jaAvaliei : jaAvaliei;
    });
  }, [itensNoPeriodo, avaliacoesPorItem, profile.id, filtro, filialFiltro]);

  async function submeter(item: any, patch: Partial<{ decisao: 'Aprovado'|'Reprovado'|null; nota: number|null; comentario: string|null }>) {
    if (!podeAvaliar) return;
    const minha = avaliacoesPorItem[item.id]?.find(a => a.avaliador_id === profile.id);
    const decisao    = patch.decisao    !== undefined ? patch.decisao    : (minha?.decisao ?? null);
    const nota       = patch.nota       !== undefined ? patch.nota       : (minha?.nota ?? null);
    const comentario = patch.comentario !== undefined ? patch.comentario : (minha?.comentario ?? null);

    setSubmittingIds(s => new Set(s).add(item.id));
    const { error } = await supabase.rpc('avaliar_item_matriz', {
      p_competicao_id:   competicao.id,
      p_filial_avaliada: item.filial,
      p_item_tipo:       tipoConfig.id,
      p_item_id:         item.id,
      p_decisao:         decisao,
      p_nota:            nota,
      p_comentario:      comentario,
    });
    setSubmittingIds(s => { const n = new Set(s); n.delete(item.id); return n; });

    if (error) {
      showToast(error.message || 'Erro ao avaliar', 'error');
      return;
    }
    showToast('Avaliação registrada', 'success');
    carregarAvaliacoes();
    window.dispatchEvent(new Event('avaliacao-matriz:changed'));
  }

  const itensParaContagem = filialFiltro === 'todas'
    ? itensNoPeriodo
    : itensNoPeriodo.filter((it: any) => it.filial === filialFiltro);
  const total = itensParaContagem.length;
  const pendentes = itensParaContagem.filter((it: any) => {
    const minha = avaliacoesPorItem[it.id]?.find(a => a.avaliador_id === profile.id);
    return !minha || (minha.decisao === null && minha.nota === null && !(minha.comentario ?? '').trim());
  }).length;
  const feitos = total - pendentes;

  // Contagens por filial (independente do filtro atual — sempre mostra o total real)
  const porFilialCount = useMemo(() => {
    const out: Record<FilialOp, number> = { SuperMax: 0, MaxLook: 0, TechMax: 0 };
    for (const it of itensNoPeriodo) {
      const f = it.filial as FilialOp;
      if (out[f] !== undefined) out[f]++;
    }
    return out;
  }, [itensNoPeriodo]);

  return (
    <section className="flex flex-col gap-3 min-w-0">
      {/* Header do painel */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-black">{grupoLabel}</span>
            <h3 className="text-lg font-bold text-gray-100 truncate">{tipoConfig.label}</h3>
          </div>
          <div className="flex items-center gap-1 neu-pressed rounded-xl p-1">
            <FiltroBtn active={filtro === 'todos'}      onClick={() => onFiltroChange('todos')}      label="Todos"     count={total} />
            <FiltroBtn active={filtro === 'pendentes'}  onClick={() => onFiltroChange('pendentes')}  label="Pendentes" count={pendentes} tone="warn" />
            <FiltroBtn active={filtro === 'avaliados'}  onClick={() => onFiltroChange('avaliados')}  label="Avaliados" count={feitos}    tone="ok" />
          </div>
        </div>

        {/* Filtro por filial */}
        <div className="flex items-center gap-1 neu-pressed rounded-xl p-1 self-start flex-wrap">
          <FilialFiltroBtn active={filialFiltro === 'todas'}    onClick={() => onFilialFiltroChange('todas')}    label="Todas"    count={itensNoPeriodo.length} />
          <FilialFiltroBtn active={filialFiltro === 'SuperMax'} onClick={() => onFilialFiltroChange('SuperMax')} label="SuperMax" count={porFilialCount.SuperMax} filial="SuperMax" />
          <FilialFiltroBtn active={filialFiltro === 'MaxLook'}  onClick={() => onFilialFiltroChange('MaxLook')}  label="MaxLook"  count={porFilialCount.MaxLook}  filial="MaxLook" />
          <FilialFiltroBtn active={filialFiltro === 'TechMax'}  onClick={() => onFilialFiltroChange('TechMax')}  label="TechMax"  count={porFilialCount.TechMax}  filial="TechMax" />
        </div>
      </div>

      {/* Corpo */}
      {lItens || loadingAv ? (
        <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
      ) : itensFiltrados.length === 0 ? (
        <div className="neu-flat rounded-2xl border border-accent/10 p-10 flex flex-col items-center gap-2 text-center">
          <Search size={20} className="text-gray-600" />
          <p className="text-sm text-gray-400">
            {filialFiltro !== 'todas' && total === 0
              ? `Nenhum(a) ${tipoConfig.label.toLowerCase()} da filial ${filialFiltro} no período.`
              : filtro === 'pendentes'
              ? 'Nenhum item pendente — você já avaliou tudo aqui.'
              : filtro === 'avaliados'
              ? 'Você ainda não avaliou nenhum item aqui.'
              : `Nenhum(a) ${tipoConfig.label.toLowerCase()} nas 3 filiais dentro do período da competição.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {itensFiltrados.map((item: any) => (
            <ItemRow
              key={item.id}
              item={item}
              tipo={tipoConfig}
              avaliacoes={avaliacoesPorItem[item.id] ?? []}
              minhaId={profile.id}
              podeAvaliar={podeAvaliar}
              submitting={submittingIds.has(item.id)}
              onSubmit={patch => submeter(item, patch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const FILIAL_TONE: Record<FilialOp, string> = {
  SuperMax: 'bg-sky-500/20 text-sky-300',
  MaxLook:  'bg-amber-400/20 text-amber-200',
  TechMax:  'bg-orange-500/20 text-orange-300',
};

function FilialFiltroBtn({ active, onClick, label, count, filial }: {
  active: boolean; onClick: () => void; label: string; count: number; filial?: FilialOp;
}) {
  const badgeCls = filial ? FILIAL_TONE[filial] : 'bg-white/10 text-gray-300';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all ${
        active ? 'neu-button text-accent ring-1 ring-accent/30' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      <span>{label}</span>
      <span className={`text-[9px] font-mono font-black px-1.5 py-0.5 rounded-full ${badgeCls}`}>{count}</span>
    </button>
  );
}

function FiltroBtn({ active, onClick, label, count, tone }: {
  active: boolean; onClick: () => void; label: string; count: number; tone?: 'warn'|'ok';
}) {
  const toneCls = tone === 'warn'
    ? 'bg-amber-500/20 text-amber-300'
    : tone === 'ok'
    ? 'bg-emerald-500/20 text-emerald-300'
    : 'bg-white/10 text-gray-300';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all ${
        active ? 'neu-button text-accent ring-1 ring-accent/30' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      <span>{label}</span>
      <span className={`text-[9px] font-mono font-black px-1.5 py-0.5 rounded-full ${toneCls}`}>{count}</span>
    </button>
  );
}

// ── Linha de item ────────────────────────────────────────────────────
function ItemRow({ item, tipo, avaliacoes, minhaId, podeAvaliar, submitting, onSubmit }: {
  item: any;
  tipo: TipoConfig;
  avaliacoes: Avaliacao[];
  minhaId: string;
  podeAvaliar: boolean;
  submitting: boolean;
  onSubmit: (patch: Partial<{ decisao: 'Aprovado'|'Reprovado'|null; nota: number|null; comentario: string|null }>) => void;
}) {
  const minha = avaliacoes.find(a => a.avaliador_id === minhaId);
  const notas = avaliacoes.filter(a => a.nota !== null && a.nota !== undefined).map(a => Number(a.nota));
  const media = notas.length > 0 ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
  const nAprov = avaliacoes.filter(a => a.decisao === 'Aprovado').length;
  const nReprov = avaliacoes.filter(a => a.decisao === 'Reprovado').length;

  const [comentarioLocal, setComentarioLocal] = useState<string>(minha?.comentario ?? '');
  const [notaLocal, setNotaLocal] = useState<string>(minha?.nota != null ? String(minha.nota) : '');

  // Autosave por debounce — 800ms sem digitar dispara o RPC. Assim comentário
  // e nota não se perdem se o avaliador fecha a aba sem tirar foco do input.
  const comentarioDeb = useDebouncedValue(comentarioLocal, 800);
  const notaDeb       = useDebouncedValue(notaLocal, 800);
  const jaMontou = useRef(false);

  useEffect(() => {
    if (!jaMontou.current) { jaMontou.current = true; return; }
    const c = comentarioDeb.trim() === '' ? null : comentarioDeb.trim();
    if (c !== (minha?.comentario ?? null)) onSubmit({ comentario: c });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comentarioDeb]);

  useEffect(() => {
    if (!jaMontou.current) return;
    if (notaDeb === '') {
      if (minha?.nota != null) onSubmit({ nota: null });
      return;
    }
    const n = Number(notaDeb);
    if (Number.isFinite(n) && n >= 0 && n <= 10 && n !== minha?.nota) {
      onSubmit({ nota: n });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaDeb]);

  const descricao = firstNonEmpty(item, tipo.descField);
  const statusLocal = item.status ?? '—';

  return (
    <div className="neu-flat p-4 rounded-2xl border border-accent/10 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FilialBadge filial={item.filial} />
            <span className="text-[10px] font-mono uppercase text-gray-500">status local: <span className="text-gray-300">{statusLocal}</span></span>
          </div>
          <p className="text-sm font-bold text-gray-100 truncate">{descricao}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {tipo.creative && (
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-widest text-gray-500">Média conselho</span>
              <span className="text-lg font-black font-mono tabular-nums text-amber-300">
                {media !== null ? `${media.toFixed(1)} (${notas.length}/3)` : '— (0/3)'}
              </span>
            </div>
          )}
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Decisões</span>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-emerald-400">✓ {nAprov}</span>
              <span className="text-rose-400">✗ {nReprov}</span>
            </div>
          </div>
        </div>
      </div>

      {podeAvaliar && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-800">
          <button
            disabled={submitting}
            onClick={() => onSubmit({ decisao: minha?.decisao === 'Aprovado' ? null : 'Aprovado' })}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
              minha?.decisao === 'Aprovado'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'neu-button text-gray-300 hover:text-emerald-300'
            }`}
          >
            <Check size={13} /> Aprovar
          </button>
          <button
            disabled={submitting}
            onClick={() => onSubmit({ decisao: minha?.decisao === 'Reprovado' ? null : 'Reprovado' })}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
              minha?.decisao === 'Reprovado'
                ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40'
                : 'neu-button text-gray-300 hover:text-rose-300'
            }`}
          >
            <X size={13} /> Reprovar
          </button>

          {tipo.creative && (
            <div className="flex items-center gap-1.5">
              <Star size={13} className="text-amber-400" />
              <input
                type="number"
                min={0} max={10} step={0.5}
                value={notaLocal}
                onChange={e => setNotaLocal(e.target.value)}
                disabled={submitting}
                placeholder="0-10"
                className="neu-input w-16 py-1 px-2 text-xs font-mono rounded-lg text-gray-200"
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
            <MessageSquare size={13} className="text-gray-500" />
            <input
              type="text"
              value={comentarioLocal}
              onChange={e => setComentarioLocal(e.target.value)}
              disabled={submitting}
              placeholder="Comentário (salva sozinho)"
              className="neu-input flex-1 py-1 px-2 text-xs rounded-lg text-gray-200"
            />
          </div>

          {submitting && <Loader2 size={14} className="text-accent animate-spin shrink-0" />}
        </div>
      )}
    </div>
  );
}
