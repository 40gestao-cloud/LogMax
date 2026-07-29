import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, TABLES_WITH_ATIVO } from '../lib/supabase';
import { SETOR_MODULES } from '../lib/sectorAccess';
import { allSetores } from '../lib/rbac';
import type { UserProfile } from './useUserProfile';

// ─────────────────────────────────────────────────────────────────────────────
// Definições de badge por submódulo. Cada entry vira UMA query `count` quando
// o usuário tem acesso ao módulo (gate por SETOR_MODULES — mesma lógica do
// SidebarNav). Para adicionar um novo badge:
//   1. Crie a entry abaixo com viewId no formato `${mod.id}-${slug-do-submenu}`
//      (slug = label.toLowerCase().replace(/ /g, '').replace(/\//g, '')).
//   2. Aponte para a tabela e o filtro que define "pendente". Use o mesmo
//      status que a View do submódulo usa (não invente status novo).
//
// Por que `count: 'exact', head: true`? Não traz linhas — só o número. Sem isso,
// 14 submódulos × média de 50 linhas = 700 objetos baixados a cada navegação
// só pra renderizar 14 bolinhas verdes.
//
// Por que NÃO incluir Contas a pagar/receber? São "dívidas em aberto", não
// "tarefa pendente pra mim" — o badge ficaria sempre alto e perde o sentido
// de notificação. Mantemos esses fluxos sem badge por escolha consciente.
// ─────────────────────────────────────────────────────────────────────────────

type BadgeDef = {
  viewId: string;
  modulo: string;
  table: string;
  filters: Record<string, string>;
  select?: string;
  listenTables?: string[];
  // Coluna de filial na `table` (ou embedded via inner-join no `select`).
  // Quando o usuário está em modo filial (filialAtiva !== null), aplicamos
  // .eq(filialColumn, filialAtiva) para não contar pendências de outras filiais.
  // Em modo Matriz (filialAtiva === null), o filtro é ignorado — vê tudo.
  filialColumn?: string;
};

const BADGE_DEFS: BadgeDef[] = [
  // ─── Compras ──────────────────────────────────────────────────────────────
  { viewId: 'compras-requisiçõesrecebidas', modulo: 'compras',    table: 'requisicoes',          filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'compras-cotações',         modulo: 'compras',    table: 'cotacoes',             filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'compras-pedidos',          modulo: 'compras',    table: 'pedidos',              filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'estoque-recebimentos',     modulo: 'estoque',    table: 'recebimentos',         filters: { status: 'Pendente' } },
  {
    viewId: 'empresa-aprovações',
    modulo: 'empresa',
    table: 'aprovacoes_compras',
    filters: { status: 'Pendente', 'requisicoes.ativo': 'true', 'requisicoes.status': 'Pendente' },
    select: '*,requisicoes!inner(id)',
    listenTables: ['aprovacoes_compras', 'requisicoes'],
    filialColumn: 'filial',
  },
  { viewId: 'compras-tarefas',          modulo: 'compras',    table: 'tarefas',              filters: { modulo: 'compras', status: 'Pendente' } },

  // ─── Estoque ──────────────────────────────────────────────────────────────
  {
    viewId: 'estoque-liberarrequisições',
    modulo: 'estoque',
    table: 'aprovacoes_estoque',
    filters: { status: 'Pendente', 'requisicoes_estoque.ativo': 'true', 'requisicoes_estoque.status': 'Pendente' },
    select: '*,requisicoes_estoque!inner(id)',
    listenTables: ['aprovacoes_estoque', 'requisicoes_estoque'],
    filialColumn: 'filial',
  },
  { viewId: 'estoque-requisiçõesrecebidas', modulo: 'estoque', table: 'requisicoes_estoque',  filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'estoque-expedição',        modulo: 'estoque',    table: 'expedicao',            filters: { status: 'Pendente' } },
  { viewId: 'estoque-tarefas',          modulo: 'estoque',    table: 'tarefas',              filters: { modulo: 'estoque', status: 'Pendente' } },

  // ─── Financeiro ───────────────────────────────────────────────────────────
  { viewId: 'financeiro-aprovaçõesdecotação',    modulo: 'financeiro', table: 'cotacoes',            filters: { status: 'Aguardando Financeiro' }, filialColumn: 'filial' },
  { viewId: 'financeiro-aprovaçõesdeorçamento',  modulo: 'financeiro', table: 'orcamentos',          filters: { status: 'Aguardando Financeiro' }, filialColumn: 'filial' },
  { viewId: 'financeiro-aprovaçõesdepromoções', modulo: 'financeiro', table: 'marketing_promocoes', filters: { status: 'Aguardando Aprovação' } },
  { viewId: 'financeiro-aprovaçõesdeconteúdo',  modulo: 'financeiro', table: 'marketing_tarefas',   filters: { status_link: 'Aguardando Aprovação' } },
  // Pedidos de Venda chega no Financeiro pra registrar pagamento. Conta
  // 'Aguardando Separação' como proxy de "pedido aberto" (visível também antes
  // da logística separar, porque cliente pode pagar primeiro).
  { viewId: 'financeiro-pedidosdevenda',         modulo: 'financeiro', table: 'pedidos_venda',       filters: { status: 'Aguardando Separação' }, filialColumn: 'filial' },
  { viewId: 'financeiro-tarefas',                modulo: 'financeiro', table: 'tarefas',             filters: { modulo: 'financeiro', status: 'Pendente' } },

  // ─── Metas (top-level, não faz parte de módulo — usa 'all' para passar no gate) ─
  // Badge = metas estratégicas ativas visíveis (RLS já limita ao setor).
  // Serve como "avisos" quando a Matriz lança meta nova.
  { viewId: 'metas',      modulo: 'all', table: 'metas_estrategicas', filters: { status: 'Em Produção' } },

  // ─── RH ───────────────────────────────────────────────────────────────────
  { viewId: 'rh-férias',  modulo: 'rh', table: 'ferias',  filters: { status: 'Solicitada' } },
  { viewId: 'rh-tarefas', modulo: 'rh', table: 'tarefas', filters: { modulo: 'rh', status: 'Pendente' } },

  // ─── Estoque (extra) ──────────────────────────────────────────────────────
  // Pedidos de Venda recém-chegados aguardando logística separar.
  { viewId: 'estoque-pedidosdevenda', modulo: 'estoque', table: 'pedidos_venda', filters: { status: 'Aguardando Separação' }, filialColumn: 'filial' },

  // ─── Vendas ───────────────────────────────────────────────────────────────
  { viewId: 'vendas-orçamentos',     modulo: 'vendas', table: 'orcamentos', filters: { status: 'Aprovado Financeiro' }, filialColumn: 'filial' },
  { viewId: 'vendas-clienteespecial', modulo: 'vendas', table: 'orcamentos', filters: { status: 'Enviado ao Cliente' }, filialColumn: 'filial' },
  { viewId: 'vendas-tarefas',         modulo: 'vendas', table: 'tarefas',    filters: { modulo: 'vendas', status: 'Pendente' } },

  // ─── Marketing ────────────────────────────────────────────────────────────
  { viewId: 'marketing-promoções', modulo: 'marketing', table: 'marketing_promocoes', filters: { status: 'Aguardando Aprovação' } },
  // 'Tarefas' do marketing usa a tabela própria marketing_tarefas — status_link
  // 'Aguardando Aprovação' já vira o badge 'financeiro-aprovaçõesdeconteúdo';
  // não duplicamos aqui pra não inflar dois badges com a mesma fila.

  // ─── TI ───────────────────────────────────────────────────────────────────
  // Desenvolvimento com IA: badge conta treinamentos ainda por acontecer.
  { viewId: 'ti-desenvolvimentocomia', modulo: 'ti', table: 'desenvolvimentos_ia', filters: { status: 'Agendado' } },

  // ─── Empresa (cadastro base, só Tarefas tem fluxo de pendência) ───────────
  { viewId: 'empresa-tarefas', modulo: 'empresa', table: 'tarefas', filters: { modulo: 'empresa', status: 'Pendente' } },
];

/**
 * Retorna `Record<viewId, count>` com a contagem de itens pendentes por
 * submódulo. Cada entry vira UM `head:true count` no Supabase — não traz
 * linhas, só o número.
 *
 * Disparos de query:
 *   - **Mount** / mudança de usuário: full fetch (todos os badges elegíveis).
 *   - **Realtime granular**: evento em UMA tabela → re-fetcha só os badges
 *     dessa tabela. Debounced em 500ms pra agrupar bursts.
 *   - **Window focus**: full fetch como fallback se realtime perdeu eventos
 *     durante sleep do device.
 *   - **Navegação (activeView)**: NÃO dispara fetch. Realtime + focus já
 *     cobrem; re-fetchar a cada clique de menu era overhead desnecessário.
 *
 * Gate por SETOR_MODULES: só dispara queries de submódulos visíveis ao
 * usuário, evitando bater em tabelas que a RLS bloquearia.
 * Erros (RLS / schema drift) devolvem `count = 0` (badge esconde) e logam
 * `console.warn` para visibilidade do dev.
 */
export function useSidebarBadges(
  profile: UserProfile | null,
  filialAtiva: string | null = null,
): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});

  // Chave estável dos setores — usada como dep dos effects. JSON.stringify
  // pra não disparar quando setores_extras vira nova referência mesma lista.
  const setoresKey = profile ? JSON.stringify(allSetores(profile)) : '';

  // Profile mais recente fica em ref pra que callbacks dos channels enxerguem
  // o valor atual sem precisar re-subscribe a cada mudança de profile.
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const filialAtivaRef = useRef(filialAtiva);
  useEffect(() => { filialAtivaRef.current = filialAtiva; }, [filialAtiva]);

  // ReqId monotônico: descarta respostas obsoletas (ex.: profile mudou no meio
  // do Promise.all). Sem isto, fetchBadges antigo poderia sobrescrever o novo.
  const reqIdRef = useRef(0);

  /**
   * Conta os badges elegíveis. Se `onlyTables` for passado, conta SÓ os
   * badges cujas tabelas estão no set (fetch parcial — usado pelo realtime).
   * Sem `onlyTables`: full fetch (mount, focus, mudança de usuário).
   */
  const fetchBadges = useCallback(async (onlyTables?: Set<string>) => {
    const p = profileRef.current;
    if (!p || !supabase) {
      if (!onlyTables) setBadges({});
      return;
    }
    const myId = ++reqIdRef.current;

    const allowedModulos = new Set(
      allSetores(p).flatMap(s => SETOR_MODULES[String(s)] ?? []),
    );
    let eligible = BADGE_DEFS.filter(def => def.modulo === 'all' || allowedModulos.has(def.modulo));
    if (onlyTables) {
      // Considera listenTables (default = [table]) — assim mudanças na tabela
      // pai (via inner-join) também disparam re-fetch do badge filho.
      eligible = eligible.filter(def =>
        (def.listenTables ?? [def.table]).some(t => onlyTables.has(t)),
      );
    }
    if (eligible.length === 0) return;

    const results = await Promise.all(eligible.map(async def => {
      try {
        let q = supabase!
          .from(def.table)
          .select(def.select ?? '*', { count: 'exact', head: true });
        if (TABLES_WITH_ATIVO.has(def.table)) {
          q = q.eq('ativo', true);
        }
        for (const [col, val] of Object.entries(def.filters)) {
          q = q.eq(col, val);
        }
        // Filial-aware: em modo filial, só conta pendências da filial ativa.
        // Em modo Matriz (filialAtiva=null), vê tudo.
        const fAtiva = filialAtivaRef.current;
        if (def.filialColumn && fAtiva) {
          q = q.eq(def.filialColumn, fAtiva);
        }
        const { count, error } = await q;
        if (error) {
          console.warn(`[useSidebarBadges] ${def.viewId} (${def.table}):`, error.message);
          return [def.viewId, 0] as const;
        }
        return [def.viewId, count ?? 0] as const;
      } catch (err: any) {
        console.warn(`[useSidebarBadges] ${def.viewId} (${def.table}) threw:`, err?.message ?? err);
        return [def.viewId, 0] as const;
      }
    }));

    if (myId !== reqIdRef.current) return; // resposta obsoleta — ignora

    // Fetch parcial: merge no estado existente (preserva badges de outras
    // tabelas). Fetch full: substitui o objeto inteiro (badges que sumiram
    // do gate por mudança de usuário também somem).
    if (onlyTables) {
      setBadges(prev => {
        const next = { ...prev };
        for (const [id, n] of results) next[id] = n;
        return next;
      });
    } else {
      const next: Record<string, number> = {};
      for (const [id, n] of results) next[id] = n;
      setBadges(next);
    }
  }, []);

  // Effect 1: full fetch ao montar / mudar de usuário. Sem dep em activeView
  // — navegação não dispara queries (realtime cuida das mudanças).
  useEffect(() => {
    fetchBadges();
  }, [profile?.id, setoresKey, filialAtiva, fetchBadges]);

  // Effect 2: subscriptions Realtime. Cada evento conhece sua tabela e
  // dispara fetch SÓ dos badges dessa tabela (granularidade fina). Debounce
  // por tabela agrupa bursts (ex.: trigger que insere em cascata).
  useEffect(() => {
    if (!profile || !supabase) return;

    const allowedModulos = new Set(
      allSetores(profile).flatMap(s => SETOR_MODULES[String(s)] ?? []),
    );
    const tables = Array.from(new Set(
      BADGE_DEFS
        .filter(def => def.modulo === 'all' || allowedModulos.has(def.modulo))
        .flatMap(d => d.listenTables ?? [d.table]),
    ));

    // Set acumula tabelas alteradas dentro da janela de debounce. Sem ele,
    // 2 eventos em tabelas diferentes em < 500ms perderiam o primeiro.
    const pendingTables = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerFor = (table: string) => {
      pendingTables.add(table);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const batch = new Set(pendingTables);
        pendingTables.clear();
        fetchBadges(batch);
      }, 500);
    };

    const channels = tables.map(table => {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      return supabase!
        .channel(`badges-${table}-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => triggerFor(table))
        .subscribe();
    });

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      channels.forEach(c => supabase!.removeChannel(c));
    };
  }, [profile?.id, setoresKey, fetchBadges]);

  // Effect 3: fallback — re-fetcha quando o tab/window recupera foco. Cobre
  // o caso de realtime ter desconectado durante sleep do device (mobile/laptop
  // fechado), em que eventos foram perdidos e os badges ficaram stale.
  useEffect(() => {
    const onFocus = () => { fetchBadges(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchBadges();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchBadges]);

  return badges;
}
