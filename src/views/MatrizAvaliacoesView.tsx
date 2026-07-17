import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Star, Check, X, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFetchData } from '../hooks/useSupabaseData';
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
  descField: string[];  // fallback chain: primeiro campo não vazio
  dateField: string;
  creative: boolean;   // recebe nota 0-10
};

const TIPOS: TipoConfig[] = [
  { id: 'arte',         label: 'Artes',            endpoint: '/api/marketingartesview',     descField: ['titulo','nome','descricao'], dateField: 'created_at', creative: true  },
  { id: 'promocao',     label: 'Promoções',        endpoint: '/api/marketingpromocoesview', descField: ['nome','titulo','descricao'], dateField: 'created_at', creative: true  },
  { id: 'campanha',     label: 'Campanhas',        endpoint: '/api/marketingcampanhasview', descField: ['nome','titulo','descricao'], dateField: 'created_at', creative: true  },
  { id: 'requisicao',   label: 'Requisições',      endpoint: '/api/requisicoesview',        descField: ['descricao','item','titulo'], dateField: 'created_at', creative: false },
  { id: 'cotacao',      label: 'Cotações',         endpoint: '/api/cotacoesview',           descField: ['descricao','item','titulo'], dateField: 'created_at', creative: false },
  { id: 'pedido_venda', label: 'Pedidos de Venda', endpoint: '/api/pedidosvendaview',       descField: ['cliente_nome','descricao','numero'], dateField: 'created_at', creative: false },
  { id: 'ferias',       label: 'Férias',           endpoint: '/api/feriasview',             descField: ['funcionario_nome','colaborador_nome','descricao'], dateField: 'data_inicio', creative: false },
  { id: 'requerimento', label: 'Requerimentos',    endpoint: 'requerimentos',               descField: ['titulo','descricao','assunto'], dateField: 'created_at', creative: false },

  // Cadastros — só entram na fila se criados dentro do período da competição
  { id: 'cadastro_produto',    label: 'Cadastros: Produtos',    endpoint: '/api/produtosview',           descField: ['nome','descricao','codigo'],       dateField: 'created_at', creative: false },
  { id: 'cadastro_cliente',    label: 'Cadastros: Clientes',    endpoint: '/api/crmview-clientes',       descField: ['nome','razao_social','descricao'], dateField: 'created_at', creative: false },
  { id: 'cadastro_fornecedor', label: 'Cadastros: Fornecedores',endpoint: '/api/crmview-fornecedores',   descField: ['nome','razao_social','descricao'], dateField: 'created_at', creative: false },
  { id: 'cadastro_servico',    label: 'Cadastros: Serviços',    endpoint: '/api/servicosview',           descField: ['nome','descricao','codigo'],       dateField: 'created_at', creative: false },
  { id: 'cadastro_categoria',  label: 'Cadastros: Categorias',  endpoint: 'categorias_produto',          descField: ['nome','descricao'],                dateField: 'created_at', creative: false },
];

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

  const [tab, setTab] = useState<ItemTipo>('arte');
  const [competicao, setCompeticao] = useState<Competicao | null>(null);
  const [loadingComp, setLoadingComp] = useState(true);

  // Carrega competição em andamento
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

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Central de Avaliação — Matriz</h2>
        <p className="text-sm text-gray-400 mt-1">
          <Trophy className="inline w-4 h-4 text-amber-400 mr-1" />
          {competicao.nome} — <span className="font-mono text-accent">{competicao.data_inicio}</span> a <span className="font-mono text-accent">{competicao.data_fim}</span>
        </p>
        {!podeAvaliar && (
          <p className="text-xs text-gray-500 mt-2 italic">
            Você tem acesso de leitura. Apenas CEO e conselheiros pontuam.
          </p>
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TIPOS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs font-bold px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
              tab === t.id
                ? 'neu-pressed text-accent ring-1 ring-accent/40'
                : 'neu-button text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AbaAvaliacao
        key={tab}
        tipo={TIPOS.find(t => t.id === tab)!}
        competicao={competicao}
        profile={profile}
        podeAvaliar={podeAvaliar}
        showToast={showToast}
      />
    </motion.div>
  );
}

// ── Aba por tipo ─────────────────────────────────────────────────────
function AbaAvaliacao({ tipo, competicao, profile, podeAvaliar, showToast }: {
  tipo: TipoConfig;
  competicao: Competicao;
  profile: UserProfile;
  podeAvaliar: boolean;
  showToast: any;
}) {
  const { data: itens, isLoading: lItens } = useFetchData<any>(tipo.endpoint);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [loadingAv, setLoadingAv] = useState(true);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());

  const carregarAvaliacoes = useCallback(async () => {
    setLoadingAv(true);
    const { data } = await supabase
      .from('avaliacoes_matriz')
      .select('id,competicao_id,filial_avaliada,item_tipo,item_id,avaliador_id,decisao,nota,comentario')
      .eq('competicao_id', competicao.id)
      .eq('item_tipo', tipo.id)
      .eq('ativo', true);
    setAvaliacoes((data as any) ?? []);
    setLoadingAv(false);
  }, [competicao.id, tipo.id]);

  useEffect(() => { carregarAvaliacoes(); }, [carregarAvaliacoes]);

  // Filtra itens: dentro do período + filial em ['SuperMax','MaxLook','TechMax']
  const itensNoPeriodo = useMemo(() => {
    const ini = new Date(competicao.data_inicio);
    const fim = new Date(competicao.data_fim);
    fim.setHours(23, 59, 59, 999);
    return itens.filter((r: any) => {
      const d = new Date(r[tipo.dateField] ?? r.created_at);
      return d >= ini && d <= fim && OP_FILIAIS.includes(r.filial as FilialOp);
    });
  }, [itens, competicao, tipo.dateField]);

  // Índice avaliações por item_id
  const avaliacoesPorItem = useMemo(() => {
    const idx: Record<string, Avaliacao[]> = {};
    for (const a of avaliacoes) {
      if (!idx[a.item_id]) idx[a.item_id] = [];
      idx[a.item_id].push(a);
    }
    return idx;
  }, [avaliacoes]);

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
      p_item_tipo:       tipo.id,
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
  }

  if (lItens || loadingAv) return <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>;

  if (itensNoPeriodo.length === 0) {
    return <EmptyState message={`📭 Nada para avaliar — nenhum(a) ${tipo.label.toLowerCase()} nas 3 filiais dentro do período da competição.`} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {itensNoPeriodo.map((item: any) => (
        <ItemRow
          key={item.id}
          item={item}
          tipo={tipo}
          avaliacoes={avaliacoesPorItem[item.id] ?? []}
          minhaId={profile.id}
          podeAvaliar={podeAvaliar}
          submitting={submittingIds.has(item.id)}
          onSubmit={patch => submeter(item, patch)}
        />
      ))}
    </div>
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
                onBlur={() => {
                  const n = notaLocal === '' ? null : Number(notaLocal);
                  if (n === null || (n >= 0 && n <= 10 && n !== minha?.nota)) onSubmit({ nota: n });
                }}
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
              onBlur={() => {
                const c = comentarioLocal.trim() === '' ? null : comentarioLocal.trim();
                if (c !== (minha?.comentario ?? null)) onSubmit({ comentario: c });
              }}
              disabled={submitting}
              placeholder="Comentário (opcional)"
              className="neu-input flex-1 py-1 px-2 text-xs rounded-lg text-gray-200"
            />
          </div>

          {submitting && <Loader2 size={14} className="text-accent animate-spin shrink-0" />}
        </div>
      )}
    </div>
  );
}
