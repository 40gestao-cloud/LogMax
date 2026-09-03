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
  // Colunas que precisam estar vazias (`.is(col, null)`) e valores a excluir
  // (`.neq`). Existem porque nem toda fila se define por um status: "pedido a
  // separar" é `separado_em IS NULL`, e contar por status daria número
  // diferente do que a tela mostra — badge e lista têm de responder à mesma
  // pergunta, senão a bolinha vira mentira.
  isNull?: string[];
  neq?: Record<string, string>;
  // Vários valores aceitos na mesma coluna (`.in`). Existe porque uma fila pode
  // ter mais de um estado em aberto: a promoção espera o Financeiro em
  // 'Aguardando Aprovação' e o gerente em 'Em Análise', e a mesma tela mostra
  // os dois. Contar só um deixaria o gerente sem aviso do que espera por ele.
  inList?: Record<string, string[]>;
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
  { viewId: 'compras-requisiçõesdecompra', modulo: 'compras',    table: 'requisicoes',          filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'compras-cotações',         modulo: 'compras',    table: 'cotacoes',             filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'compras-pedidos',          modulo: 'compras',    table: 'pedidos',              filters: { status: 'Pendente' }, filialColumn: 'filial' },
  // Recebimentos tem DUAS filas e a bolinha soma as duas — é o mesmo par que a
  // faixa de fila de trabalho mostra dentro da tela. A primeira é a carga que
  // ainda não chegou ao sistema; a segunda, a entrada lançada que ninguém
  // confirmou. Contar só a segunda escondia justamente a que ninguém avisava.
  //
  // As DUAS precisam de `filialColumn` — só a de pedidos tinha. Sem ela o
  // `count` não filtra a unidade e a RLS é a única régua: quem enxerga mais de
  // uma filial (admin, CEO, conselheiro) via na TechMax os 14 recebimentos por
  // confirmar do SuperMax. O aluno confirmava tudo o que a tela mostrava e o
  // número no menu não baixava — "confirmei e continua aparecendo". A faixa
  // dentro da tela sempre filtrou pela filial; era o menu que discordava dela.
  { viewId: 'estoque-recebimentos',     modulo: 'estoque',    table: 'recebimentos',         filters: { status: 'Pendente' }, filialColumn: 'filial' },
  // A segunda fila lê a view da migr. 530 e não a tabela: "em entrega e sem
  // recebido_em" também pega o pedido cuja carga JÁ foi toda lançada e só
  // espera conferência — e esse já está contado na primeira fila. A view põe o
  // saldo na régua, que é a mesma coisa que a faixa dentro da tela pergunta.
  // `listenTables` volta a nomear as tabelas reais: realtime não emite evento
  // de view.
  { viewId: 'estoque-recebimentos',     modulo: 'estoque',    table: 'v_pedidos_a_receber',  filters: {}, filialColumn: 'filial', listenTables: ['pedidos', 'recebimentos'] },

  // ─── Requisições ──────────────────────────────────────────────────────────
  // Caixa de decisão do gerente. Mora no módulo Requisições desde que ele
  // deixou de ser submenu de Empresa.
  {
    viewId: 'requisicoes-aprovações',
    modulo: 'requisicoes',
    table: 'aprovacoes_compras',
    filters: { status: 'Pendente', 'requisicoes.ativo': 'true', 'requisicoes.status': 'Pendente' },
    select: '*,requisicoes!inner(id)',
    listenTables: ['aprovacoes_compras', 'requisicoes'],
    filialColumn: 'filial',
  },
  // A mesma tela também é a porta do material do almoxarifado (aba "Material
  // do estoque"), então o número no menu tem de contar os dois documentos —
  // senão a aba mostra fila e o menu diz que não há nada. O badge de
  // 'estoque-liberarrequisições' continua: são duas portas para a mesma fila.
  {
    viewId: 'requisicoes-aprovações',
    modulo: 'requisicoes',
    table: 'aprovacoes_estoque',
    filters: { status: 'Pendente', 'requisicoes_estoque.ativo': 'true', 'requisicoes_estoque.status': 'Pendente' },
    select: '*,requisicoes_estoque!inner(id)',
    listenTables: ['aprovacoes_estoque', 'requisicoes_estoque'],
    filialColumn: 'filial',
  },

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
  { viewId: 'estoque-requisiçõesdematerial', modulo: 'estoque', table: 'requisicoes_estoque',  filters: { status: 'Pendente' }, filialColumn: 'filial' },
  { viewId: 'estoque-expedição',        modulo: 'estoque',    table: 'expedicao',            filters: { status: 'Pendente' }, filialColumn: 'filial' },

  // ─── Financeiro ───────────────────────────────────────────────────────────
  { viewId: 'financeiro-aprovaçõesdecotação',    modulo: 'financeiro', table: 'cotacoes',            filters: { status: 'Aguardando Financeiro' }, filialColumn: 'filial' },
  { viewId: 'financeiro-aprovaçõesdeorçamento',  modulo: 'financeiro', table: 'orcamentos',          filters: { status: 'Aguardando Financeiro' }, filialColumn: 'filial' },
  // MIGR 576/579: a fila da oferta tem DOIS estados em aberto — 'Aguardando
  // Aprovação' espera o Financeiro, 'Em Análise' espera o gerente da filial. A
  // tela mostra os dois; contar só o primeiro deixava o gerente sem nenhum
  // aviso de que havia oferta esperando a liberação dele.
  { viewId: 'financeiro-aprovaçõesdepromoções', modulo: 'financeiro', table: 'marketing_promocoes', filters: {}, inList: { status: ['Aguardando Aprovação', 'Em Análise'] }, filialColumn: 'filial' },
  { viewId: 'financeiro-aprovaçõesdeconteúdo',  modulo: 'financeiro', table: 'marketing_tarefas',   filters: { status_link: 'Aguardando Aprovação' }, filialColumn: 'filial' },
  // Pedidos de Venda chega no Financeiro pra registrar pagamento: conta o que
  // ainda não foi recebido. Mesmo recorte que PedidosVendaView mode="financeiro".
  { viewId: 'financeiro-pedidosdevenda',         modulo: 'financeiro', table: 'pedidos_venda',       filters: {}, isNull: ['pago_em'], neq: { status: 'Cancelado' }, filialColumn: 'filial' },

  // ─── Metas (top-level, não faz parte de módulo — usa 'all' para passar no gate) ─
  // Badge = metas estratégicas ativas visíveis (RLS já limita ao setor).
  // Serve como "avisos" quando a Matriz lança meta nova.
  { viewId: 'metas',      modulo: 'all', table: 'metas_estrategicas', filters: { status: 'Em Produção' } },

  // ─── RH ───────────────────────────────────────────────────────────────────
  { viewId: 'rh-férias',  modulo: 'rh', table: 'ferias',  filters: { status: 'Solicitada' }, filialColumn: 'filial' },

  // ─── Estoque (extra) ──────────────────────────────────────────────────────
  // Pedidos aguardando a logística separar. Mesmo recorte que
  // PedidosVendaView mode="estoque".
  { viewId: 'estoque-pedidosdevenda', modulo: 'estoque', table: 'pedidos_venda', filters: {}, isNull: ['separado_em'], neq: { status: 'Cancelado' }, filialColumn: 'filial' },

  // ─── Vendas ───────────────────────────────────────────────────────────────
  { viewId: 'vendas-orçamentos',     modulo: 'vendas', table: 'orcamentos', filters: { status: 'Aprovado Financeiro' }, filialColumn: 'filial' },
  // 'vendas-clienteespecial' saiu daqui junto com o submenu: Cliente Especial
  // é tela da Matriz, e em Matriz a sidebar não lista módulos operacionais —
  // o badge não tinha onde aparecer.

  // ─── Marketing ────────────────────────────────────────────────────────────
  // Mesma régua do lado do marketing: a proposta segue "em curso" enquanto não
  // for liberada, reprovada ou expirar.
  { viewId: 'marketing-promoções', modulo: 'marketing', table: 'marketing_promocoes', filters: {}, inList: { status: ['Aguardando Aprovação', 'Em Análise'] }, filialColumn: 'filial' },
  // 'Tarefas' do marketing usa a tabela própria marketing_tarefas — status_link
  // 'Aguardando Aprovação' já vira o badge 'financeiro-aprovaçõesdeconteúdo';
  // não duplicamos aqui pra não inflar dois badges com a mesma fila.

  // ─── TI ───────────────────────────────────────────────────────────────────
  // Desenvolvimento com IA: badge conta treinamentos ainda por acontecer.
  { viewId: 'ti-desenvolvimentocomia', modulo: 'ti', table: 'desenvolvimentos_ia', filters: { status: 'Agendado' } },

  // Empresa não tem badge: virou só parametrização (filiais, formas e
  // condições de pagamento, projetos), e parametrização não tem fila.
  //
  // Havia aqui 6 entries `*-tarefas` (compras/estoque/financeiro/rh/vendas/
  // empresa) apontando para submenus 'Tarefas' que não existem mais em módulo
  // nenhum — sem rota, sem entrada de menu. O gate abaixo é por módulo, não
  // por submenu existente, então elas seguiam disparando count + realtime a
  // cada sessão para pintar bolinha em item invisível. Removidas 2026-07-28.
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
      //
      // O alvo é o viewId, não a def: quando um badge soma mais de uma fonte
      // (Recebimentos = recebimentos + pedidos em entrega), refazer só a fonte
      // que mudou daria um total pela metade. Recalcula o grupo inteiro.
      const viewsAlvo = new Set(
        BADGE_DEFS
          .filter(def => (def.listenTables ?? [def.table]).some(t => onlyTables.has(t)))
          .map(def => def.viewId),
      );
      eligible = eligible.filter(def => viewsAlvo.has(def.viewId));
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
        for (const col of def.isNull ?? []) {
          q = q.is(col, null);
        }
        for (const [col, val] of Object.entries(def.neq ?? {})) {
          q = q.neq(col, val);
        }
        for (const [col, vals] of Object.entries(def.inList ?? {})) {
          q = q.in(col, vals);
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
    // Soma as fontes DENTRO deste lote antes de gravar. Acumular sobre o
    // estado anterior contaria em dobro a cada realtime.
    const somado: Record<string, number> = {};
    for (const [id, n] of results) somado[id] = (somado[id] ?? 0) + n;

    if (onlyTables) {
      setBadges(prev => ({ ...prev, ...somado }));
    } else {
      setBadges(somado);
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
