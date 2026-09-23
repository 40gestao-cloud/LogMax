import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { freshToken } from '../lib/authFetch';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { podeLerPorAutomacao } from '../lib/disjuntor';
import { SETOR_MODULES } from '../lib/sectorAccess';
import { allSetores } from '../lib/rbac';
import type { UserProfile } from './useUserProfile';

// ─────────────────────────────────────────────────────────────────────────────
// Que bolinha existe, de quem ela é, e o que a faz ficar velha.
//
// A CONTAGEM NÃO MORA MAIS AQUI. Quem conta é a RPC `contar_pendencias`
// (migr. 602): uma chamada devolve os 19 números de uma vez. Antes cada entry
// virava um `head:true count` próprio — 21 requisições por atualização, por
// máquina, e como a sala inteira ouve as mesmas tabelas, um INSERT de um aluno
// virava (turma) × 21. Medido na LogMax-ERP: 1,4 milhão de chamadas e 11.523 s
// de banco, catorze por cento de todo o tempo do servidor, para pintar bolinha
// de menu.
//
// Sobrou aqui o que é do front, e não do banco:
//   viewId       — a chave, no formato `${mod.id}-${slug-do-submenu}`
//                  (slug = label minúsculo, sem espaço e sem barra). É a MESMA
//                  chave que a RPC devolve.
//   modulo       — o gate: `SETOR_MODULES` decide se esta pessoa vê o submenu.
//                  'all' passa sempre (item de topo, fora de módulo).
//   listenTables — o que precisa mudar no banco para a bolinha estar velha.
//
// Para adicionar um badge: entry aqui + o número correspondente na RPC. Os dois
// lados usam a mesma chave, e é só isso que os amarra.
//
// A REGRA DE CADA FILA — que estado é "esperando alguém" — está escrita na
// migr. 602, junto do SQL que a executa. O que vale lembrar aqui, porque custou
// caro descobrir:
//
//   · Não existe atalho genérico por `status = 'Pendente'`. Cada fluxo tem o
//     SEU estado de espera: cotação parada no financeiro é 'Aguardando
//     Financeiro', orçamento pronto para faturar é 'Aprovado Financeiro',
//     pedido a separar é `separado_em IS NULL`. Contar por 'Pendente' pega
//     menos de um terço do que está realmente parado.
//   · `estoque-recebimentos` SOMA duas filas (a carga que não chegou e a
//     entrada lançada que ninguém confirmou) porque é o par que a faixa dentro
//     da tela mostra. Contar só a segunda escondia a que ninguém avisava.
//   · `requisicoes-aprovações` também soma duas: compra e material do
//     almoxarifado chegam na mesma caixa de decisão do gerente.
//   · `financeiro-aprovaçõesdepromoções` e `marketing-promoções` são a MESMA
//     fila vista dos dois lados (migr. 576/579) — a proposta espera o
//     Financeiro em 'Aguardando Aprovação' e o gerente em 'Em Análise'.
//     Contar só o primeiro deixava o gerente sem aviso do que esperava por ele.
//
// Por que NÃO incluir Contas a pagar/receber: são "dívidas em aberto", não
// "tarefa pendente pra mim" — o badge ficaria sempre alto e perderia o sentido
// de notificação. Escolha consciente.
//
// Empresa não tem badge: virou só parametrização (filiais, formas e condições
// de pagamento, projetos), e parametrização não tem fila.
//
// Havia aqui 6 entries `*-tarefas` (compras/estoque/financeiro/rh/vendas/
// empresa) apontando para submenus 'Tarefas' que não existem mais em módulo
// nenhum — sem rota, sem entrada de menu. O gate é por módulo, não por submenu
// existente, então elas seguiam disparando count + realtime a cada sessão para
// pintar bolinha em item invisível. Removidas 2026-07-28.
// ─────────────────────────────────────────────────────────────────────────────

type BadgeDef = {
  viewId: string;
  modulo: string;
  /** Tabelas cuja mudança deixa esta bolinha velha. Realtime não emite evento
   *  de view: `estoque-recebimentos` lê a `v_pedidos_a_receber` dentro da RPC,
   *  mas escuta as tabelas reais por trás dela. */
  listenTables: string[];
};

const BADGE_DEFS: BadgeDef[] = [
  // ─── Compras ──────────────────────────────────────────────────────────────
  { viewId: 'compras-requisiçõesdecompra', modulo: 'compras', listenTables: ['requisicoes'] },
  { viewId: 'compras-cotações',            modulo: 'compras', listenTables: ['cotacoes'] },
  { viewId: 'compras-pedidos',             modulo: 'compras', listenTables: ['pedidos'] },

  // ─── Requisições ──────────────────────────────────────────────────────────
  // Caixa de decisão do gerente. Mora no módulo Requisições desde que ele
  // deixou de ser submenu de Empresa.
  { viewId: 'requisicoes-aprovações', modulo: 'requisicoes',
    listenTables: ['aprovacoes_compras', 'requisicoes', 'aprovacoes_estoque', 'requisicoes_estoque'] },

  // ─── Estoque ──────────────────────────────────────────────────────────────
  // Duas portas para a mesma fila do almoxarifado: esta e a de Requisições.
  { viewId: 'estoque-liberarrequisições',    modulo: 'estoque',
    listenTables: ['aprovacoes_estoque', 'requisicoes_estoque'] },
  { viewId: 'estoque-recebimentos',          modulo: 'estoque', listenTables: ['recebimentos', 'pedidos'] },
  { viewId: 'estoque-requisiçõesdematerial', modulo: 'estoque', listenTables: ['requisicoes_estoque'] },
  { viewId: 'estoque-expedição',             modulo: 'estoque', listenTables: ['expedicao'] },
  { viewId: 'estoque-pedidosdevenda',        modulo: 'estoque', listenTables: ['pedidos_venda'] },

  // ─── Financeiro ───────────────────────────────────────────────────────────
  { viewId: 'financeiro-aprovaçõesdecotação',   modulo: 'financeiro', listenTables: ['cotacoes'] },
  { viewId: 'financeiro-aprovaçõesdeorçamento', modulo: 'financeiro', listenTables: ['orcamentos'] },
  { viewId: 'financeiro-aprovaçõesdepromoções', modulo: 'financeiro', listenTables: ['marketing_promocoes'] },
  { viewId: 'financeiro-aprovaçõesdeconteúdo',  modulo: 'financeiro', listenTables: ['marketing_tarefas'] },
  { viewId: 'financeiro-pedidosdevenda',        modulo: 'financeiro', listenTables: ['pedidos_venda'] },

  // ─── Vendas ───────────────────────────────────────────────────────────────
  // 'vendas-clienteespecial' saiu daqui junto com o submenu: Cliente Especial
  // é tela da Matriz, e em Matriz a sidebar não lista módulos operacionais —
  // o badge não tinha onde aparecer.
  { viewId: 'vendas-orçamentos', modulo: 'vendas', listenTables: ['orcamentos'] },

  // ─── Marketing ────────────────────────────────────────────────────────────
  // 'Tarefas' do marketing não entra: o status_link 'Aguardando Aprovação' já
  // vira 'financeiro-aprovaçõesdeconteúdo', e dois badges para a mesma fila
  // inflam a conta da sala.
  { viewId: 'marketing-promoções', modulo: 'marketing', listenTables: ['marketing_promocoes'] },

  // ─── RH ───────────────────────────────────────────────────────────────────
  { viewId: 'rh-férias', modulo: 'rh', listenTables: ['ferias'] },

  // ─── Metas (top-level, fora de módulo — 'all' para passar no gate) ────────
  // Serve como "avisos" quando a Matriz lança meta nova.
  { viewId: 'metas', modulo: 'all', listenTables: ['metas_estrategicas'] },

  // ─── TI ───────────────────────────────────────────────────────────────────
  // Desenvolvimento com IA: treinamentos ainda por acontecer.
  { viewId: 'ti-desenvolvimentocomia', modulo: 'ti', listenTables: ['desenvolvimentos_ia'] },
];

// Janela, não debounce — e por que ela é tão larga aqui.
//
// Com 500ms reiniciando a cada evento, um único INSERT fazia TODAS as máquinas
// da turma contarem juntas meio segundo depois: a manada inteira no mesmo
// instante. Em 15/09 isso somou ~4 mil contagens em 10 minutos na
// logmax-contabilidade e a API respondeu 504 por seis minutos, login incluído.
// O primeiro evento abre a janela e os seguintes entram no mesmo lote sem
// empurrar o prazo — senão uma sala que escreve sem parar nunca deixaria o
// badge atualizar. Some o sorteio por máquina e o número chega até 10s depois:
// é bolinha de menu, não saldo de caixa.
const REALTIME_JANELA_MS = 4_000;
const REALTIME_JITTER_MS = 6_000;
const FOCO_INTERVALO_MIN_MS = 60_000;

/**
 * Retorna `Record<viewId, count>` com o tamanho de cada fila que vira bolinha
 * na sidebar.
 *
 * Uma chamada à RPC `contar_pendencias` (migr. 602) devolve o quadro inteiro.
 * Era uma requisição por badge — até 21 por atualização, por máquina.
 *
 * Quando conta:
 *   - **Mount** / mudança de usuário ou de filial ativa.
 *   - **Realtime**: mudança em qualquer tabela ouvida, num canal só, com
 *     janela de 4s + até 6s sorteados por máquina — para agrupar rajadas e não
 *     pôr a turma inteira contando no mesmo instante.
 *   - **Volta ao foco da aba**: no máximo uma vez por minuto, para cobrir o
 *     realtime que caiu enquanto a máquina dormia.
 *   - **Navegação**: NÃO conta. Realtime e foco já cobrem; recontar a cada
 *     clique de menu era gasto sem resposta nova.
 *
 * O gate de `SETOR_MODULES` decide QUAIS badges são desenhados. A RPC é
 * SECURITY INVOKER, então o número já vem recortado pela RLS de quem chamou —
 * o gate aqui é sobre o menu, não sobre o dado.
 *
 * Erro (RLS, schema drift, RPC ausente antes da migração rodar) devolve quadro
 * vazio, as bolinhas somem e o motivo sai no `console.warn`.
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

  // Última contagem achou a sessão perdida. Decide se o retorno do login
  // (Effect 4) precisa recontar.
  const semSessaoRef = useRef(false);

  /**
   * Conta. O `_tabelasQueMudaram` chega do realtime e não é usado para
   * recortar nada: agora que o quadro inteiro custa UMA chamada, contar só
   * parte dele não economiza ida ao servidor — e contar tudo tira do caminho
   * a classe de bug em que a bolinha A ficava velha porque quem mudou foi a
   * tabela B. Fica no argumento porque o `assinarRealtime` o entrega, e
   * porque é o que se olha quando alguém for investigar o que disparou isto.
   */
  const fetchBadges = useCallback(async (_tabelasQueMudaram?: Set<string>) => {
    const p = profileRef.current;
    if (!p || !supabase) {
      setBadges({});
      return;
    }
    const myId = ++reqIdRef.current;

    // Sem sessão não conta. Depois dos 504 de login de 15/09, máquina com a
    // sessão perdida seguia consultando como anon e colhendo 401 em série.
    if (!(await freshToken())) {
      semSessaoRef.current = true;
      if (myId === reqIdRef.current) setBadges({});
      return;
    }
    semSessaoRef.current = false;

    // Em modo Matriz (filialAtiva === null) a RPC recebe NULL e conta tudo o
    // que a RLS deixa ver; em modo filial, só a unidade ativa.
    const { data, error } = await supabase.rpc('contar_pendencias', {
      p_filial: filialAtivaRef.current,
    });

    if (myId !== reqIdRef.current) return; // resposta obsoleta — ignora

    if (error) {
      console.warn('[useSidebarBadges] contar_pendencias:', error.message);
      setBadges({});
      return;
    }

    // O gate é do MENU: a RPC devolve todas as chaves, e aqui ficam só as dos
    // submódulos que esta pessoa enxerga. Chave que a RPC não trouxe (versão
    // do banco mais velha que a do app) vira 0 em vez de `undefined`, senão a
    // bolinha ficaria pendurada no último número conhecido.
    const contagens = (data ?? {}) as Record<string, unknown>;
    const allowedModulos = new Set(
      allSetores(p).flatMap(s => SETOR_MODULES[String(s)] ?? []),
    );
    const quadro: Record<string, number> = {};
    for (const def of BADGE_DEFS) {
      if (def.modulo !== 'all' && !allowedModulos.has(def.modulo)) continue;
      const n = Number(contagens[def.viewId]);
      quadro[def.viewId] = Number.isFinite(n) ? n : 0;
    }
    setBadges(quadro);
  }, []);

  // Effect 1: full fetch ao montar / mudar de usuário. Sem dep em activeView
  // — navegação não dispara queries (realtime cuida das mudanças).
  useEffect(() => {
    fetchBadges();
  }, [profile?.id, setoresKey, filialAtiva, fetchBadges]);

  // Effect 2: realtime das tabelas que alimentam badge.
  //
  // UM canal com N assinaturas, e não N canais. Antes era um `supabase.channel`
  // por tabela — quinze deles por máquina, só para as bolinhas do menu, antes
  // de a pessoa abrir qualquer tela. Cada canal é um join no servidor de
  // realtime e um registro de assinatura que ele confere a cada mudança; o
  // `.on()` aceita várias tabelas no mesmo canal e entrega o mesmo evento.
  //
  // A janela e o sorteio continuam os mesmos (4s + até 6s por máquina) —
  // agora vindos do `assinarRealtime`, que é onde essa régua mora desde
  // 15/09. Vêm junto duas coisas que a versão caseira não tinha: não conta
  // sem sessão (antes a máquina deslogada seguia colhendo 401) e relê na
  // reconexão do websocket (o que mudou com o socket fora não é reenviado).
  useEffect(() => {
    if (!profile || !supabase) return;

    const allowedModulos = new Set(
      allSetores(profile).flatMap(s => SETOR_MODULES[String(s)] ?? []),
    );
    const tables = Array.from(new Set(
      BADGE_DEFS
        .filter(def => def.modulo === 'all' || allowedModulos.has(def.modulo))
        .flatMap(d => d.listenTables),
    ));
    if (tables.length === 0) return;

    return assinarRealtime({
      nome: 'badges',
      alvos: tables,
      janelaMs: REALTIME_JANELA_MS,
      jitterMs: REALTIME_JITTER_MS,
      // O lote diz QUAIS tabelas mudaram: só os badges dessas são recontados.
      aoMudar: tabelas => { void fetchBadges(tabelas); },
    });
  }, [profile?.id, setoresKey, fetchBadges]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 3: fallback — re-fetcha quando o tab/window recupera foco. Cobre
  // o caso de realtime ter desconectado durante sleep do device (mobile/laptop
  // fechado), em que eventos foram perdidos e os badges ficaram stale.
  //
  // Com intervalo mínimo. `focus` e `visibilitychange` disparam os dois na
  // mesma volta à aba, e o aluno alterna de janela o tempo todo (MaxPOS,
  // planilha, MaxID) — cada Alt+Tab refazia a contagem completa. O fallback só
  // precisa cobrir o realtime que caiu, e isso não muda em menos de um minuto.
  const ultimoFocoRef = useRef(0);
  useEffect(() => {
    const refazer = () => {
      const agora = Date.now();
      if (agora - ultimoFocoRef.current < FOCO_INTERVALO_MIN_MS) return;
      // Disjuntor aberto: não conta, e não marca o relógio — assim o primeiro
      // Alt+Tab depois de ele fechar conta de novo, em vez de esperar mais um
      // minuto. Aqui não há o que guardar: bolinha de menu velha é o menor dos
      // problemas de uma sala que está sem resposta, e a releitura do realtime
      // (que guarda) cobre o que mudou nesse meio-tempo.
      if (!podeLerPorAutomacao()) return;
      ultimoFocoRef.current = agora;
      fetchBadges();
    };
    const onFocus = () => { refazer(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refazer();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchBadges]);

  // Effect 4: a sessão manda. Saiu (ou o refresh falhou de vez) → badges
  // somem na hora, sem esperar a próxima contagem descobrir. Voltou depois de
  // uma queda → conta de novo.
  //
  // Só recontar se a sessão TINHA caído: TOKEN_REFRESHED chega de hora em hora
  // em toda máquina, e SIGNED_IN o supabase-js também emite quando a aba volta
  // ao foco — recontar em todos furaria o intervalo mínimo do Effect 3.
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        semSessaoRef.current = true;
        ++reqIdRef.current;
        setBadges({});
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && semSessaoRef.current) {
        void fetchBadges();
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchBadges]);

  return badges;
}
