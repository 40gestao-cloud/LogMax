import React, { useEffect, useState, useRef } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion } from 'motion/react';
import { X, Check, Loader2, RotateCcw } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { FiltroSolicitante, chaveSolicitante } from '../components/FiltroSolicitante';
import { supabase } from '../lib/supabase';
import { EmptyState, SelecioneUnidade, IdadeBadge } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { numeroRequisicao } from '../lib/documentos';
import { formatDataHoraBR } from '../lib/dates';
import { isConselheiro } from '../lib/rbac';
import type { UserProfile } from '../hooks/useUserProfile';
import type { AprovacaoEstoque, RequisicaoEstoque, Produto } from '../types/domain';

type EnrichedAp = AprovacaoEstoque & {
  req: RequisicaoEstoque | undefined;
  prod: Produto | undefined;
};

/** Qual pedaço da tela renderizar. Existe porque a mesma fila aparece em dois
 *  lugares: aqui, dentro de Estoque, e como aba de Requisições > Aprovações,
 *  onde o gerente decide tudo o que espera por ele num sítio só. Um componente
 *  só, para as duas telas não divergirem com o tempo. */
export type PedacoAprovacoesEstoque = 'ambos' | 'fila' | 'decididas';

export const AprovacoesEstoqueBloco = ({ showToast, profile, filial, mostrar = 'ambos', solicitante, onSolicitantes }: { showToast: (msg: string, type: string, persist?: boolean) => void; profile: UserProfile; filial: FilialOp; mostrar?: PedacoAprovacoesEstoque;
  /** Filtro por quem pediu, mandado de fora (aba de Requisições > Aprovações,
   *  onde um controle só vale para as quatro abas). Sozinha, esta tela tem o
   *  seu próprio seletor. */
  solicitante?: string | null;
  /** Os nomes da fila pendente, devolvidos para quem embute o bloco montar o
   *  seletor sem repetir a consulta de `requisicoes_estoque`. */
  onSolicitantes?: (nomes: string[]) => void }) => {
  const { data: aprovacoes, setData: setAprovacoes, isLoading: loadingAp, reload: reloadPendentes } = useFetchData<AprovacaoEstoque>('/api/minhasaprovacoesestoqueview', { status: 'Pendente', filial }, true);
  const { data: requisicoes, setData: setRequisicoes, isLoading: loadingReq, reload: reloadReq } = useFetchData<RequisicaoEstoque>('/api/requisicoesestoqueview', { filial }, true);
  const { data: produtos } = useFetchData<Produto>('/api/produtosview', { filial });
  // Decisões já tomadas — a lista de Pendente sozinha faz o card sumir no
  // clique, e com ele a chance de desfazer o engano do gerente.
  const { data: decididas, reload: reloadDecididas } = useFetchData<AprovacaoEstoque>('/api/minhasaprovacoesestoqueview', { status: ['Aprovado', 'Negado'], filial }, true);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [obs, setObs] = useState<Record<string, string>>({});
  const [solicLocal, setSolicLocal] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<string | null>(null);
  // Guard sincrônico: `processing` (state React) atualiza assíncronamente,
  // então double-click rápido entra no handler 2× antes do disable pintar.
  // O ref tranca instantaneamente.
  const processingRef = useRef<string | null>(null);

  // Aprovação sem requisição legível (2026-08-24, espelha AprovacoesComprasView).
  //
  // `requisicoes_estoque` também tem soft-delete: a lista vem filtrada por
  // `ativo=true`, então uma requisição inativada some da busca e a aprovação
  // que aponta para ela fica sem `req`. Antes disso virava "Produto não
  // encontrado" com Aprovar/Negar ativos — e a RPC recusava os dois, sem a
  // tela dizer por quê. Busca a linha por id antes de descartar; o que sobrar
  // órfão de verdade vira aviso, não card quebrado.
  const [avulsas, setAvulsas] = useState<Record<string, RequisicaoEstoque>>({});
  const [orfas, setOrfas] = useState(0);
  const faltantes = aprovacoes
    .filter(ap => !requisicoes.some(r => r.id === ap.requisicao_estoque_id) && !avulsas[ap.requisicao_estoque_id])
    .map(ap => ap.requisicao_estoque_id);
  const chaveFaltantes = faltantes.join(',');

  useEffect(() => {
    if (loadingAp || loadingReq || !chaveFaltantes || !supabase) { if (!chaveFaltantes) setOrfas(0); return; }
    let cancelado = false;
    (async () => {
      const ids = chaveFaltantes.split(',');
      const { data: rows, error } = await supabase!
        .from('requisicoes_estoque').select('*').in('id', ids).eq('ativo', true);
      if (cancelado) return;
      const achadas = (rows ?? []) as RequisicaoEstoque[];
      if (achadas.length) {
        setAvulsas(prev => ({ ...prev, ...Object.fromEntries(achadas.map(r => [r.id, r])) }));
      }
      setOrfas(error ? ids.length : ids.length - achadas.length);
    })();
    return () => { cancelado = true; };
  }, [chaveFaltantes, loadingAp, loadingReq]);

  // Quem devolveu, por nome (item 19 do plano — espelha AprovacoesComprasView,
  // inclusive o motivo de a RLS poder não entregar a linha: a policy de
  // `user_profiles` recusa o perfil da Matriz, que não tem filial. Id que não
  // resolveu vira '' — marca de "já tentei" — e a tela omite o "por fulano".
  const [nomesDevolucao, setNomesDevolucao] = useState<Record<string, string>>({});
  const idsCorrecao = [...new Set(
    requisicoes.map(r => (r as any).correcao_solicitada_por).filter(Boolean) as string[],
  )].filter(id => nomesDevolucao[id] === undefined);
  const chaveIdsCorrecao = idsCorrecao.join(',');
  useEffect(() => {
    if (!chaveIdsCorrecao || !supabase) return;
    let cancelado = false;
    (async () => {
      const ids = chaveIdsCorrecao.split(',');
      const { data: rows } = await supabase!
        .from('user_profiles').select('id,nome').in('id', ids);
      if (cancelado) return;
      const achados = Object.fromEntries(((rows ?? []) as any[]).map(r => [r.id, r.nome ?? '']));
      setNomesDevolucao(prev => ({
        ...prev,
        ...Object.fromEntries(ids.map(id => [id, achados[id] ?? ''])),
      }));
    })();
    return () => { cancelado = true; };
  }, [chaveIdsCorrecao]);

  const enriched: (EnrichedAp & { req: RequisicaoEstoque })[] = aprovacoes
    .map(ap => {
      const req = requisicoes.find(r => r.id === ap.requisicao_estoque_id) ?? avulsas[ap.requisicao_estoque_id];
      return { ...ap, req, prod: req ? produtos.find(p => p.id === req.produto_id) : undefined };
    })
    .filter((ap): ap is EnrichedAp & { req: RequisicaoEstoque } => ap.req !== undefined);

  // O erro que mais aparece aqui não é falha: é regra. O guard
  // `trg_requisicao_estoque_decisao_guard` levanta "Quem pede o material não
  // libera a própria requisição" na 2ª das três escritas — e o `catch {}` que
  // existia trocava essa frase por "Erro ao aprovar", fazendo a turma ler como
  // defeito do sistema justamente a lição que o fluxo existe pra ensinar.
  // A RPC repassa `error.message` intacto no throw, então basta não jogar
  // fora.
  const motivoDoErro = (err: unknown): string => {
    const msg = String((err as { message?: string })?.message ?? '').trim();
    return msg || 'erro inesperado';
  };

  // Aprovar e negar são a MESMA chamada, com decisão diferente. Até a migr.
  // 401 eram três escritas soltas daqui (aprovação → requisição → baixa) com
  // rollback escrito à mão no catch: dava conta de erro do banco, não de aba
  // fechada no meio. Quando isso acontecia sobrava requisição 'Aprovado' sem
  // baixa — o estoque não descia e o documento sumia desta tela, que só lista
  // Pendente. Agora ou tudo acontece, ou nada aconteceu.
  //
  // A conferência de saldo saiu daqui junto: ela vivia antes das escritas e
  // deixava uma janela entre conferir e baixar. Quem recusa saldo insuficiente
  // é a trigger de estoque, dentro da transação, e a mensagem dela chega pelo
  // mesmo caminho das outras.
  const decidir = async (ap: EnrichedAp, decisao: 'Aprovado' | 'Negado') => {
    if (processingRef.current === ap.id) return;
    if (decisao === 'Negado' && !obs[ap.id]?.trim()) {
      showToast('Informe uma observação para negar.', 'error', true);
      return;
    }
    if (!supabase) return;
    processingRef.current = ap.id;
    setProcessing(ap.id);
    try {
      const { data, error } = await supabase.rpc('liberar_requisicao_estoque', {
        p_aprovacao_id: ap.id,
        p_decisao:      decisao,
        p_observacao:   obs[ap.id] ?? '',
      });
      if (error) throw new Error(error.message);
      setAprovacoes(prev => prev.filter(a => a.id !== ap.id));
      showToast(
        decisao === 'Negado'
          ? 'Requisição negada.'
          : (data as any)?.baixou_estoque
            ? 'Material liberado e estoque baixado.'
            : 'Requisição aprovada.',
        'success', true);
    } catch (err: unknown) {
      // Sem sufixo sobre estado: a transação garante que nada ficou pela
      // metade, então não há o que tranquilizar.
      showToast(
        `Não foi possível ${decisao === 'Negado' ? 'negar' : 'liberar'}: ${motivoDoErro(err)}`,
        'error', true);
    } finally {
      setProcessing(null);
      processingRef.current = null;
    }
  };

  // Terceira saída, ao lado de Aprovar e Negar (migr. 522, espelha a 517).
  //
  // Negar é decisão de mérito — a unidade não vai receber isto, e o documento
  // se encerra. Devolver é para o pedido mal feito: quantidade errada,
  // destino impreciso. Volta para quem abriu, com o motivo, e o mesmo
  // documento retorna corrigido — sem virar requisição nova, que era o único
  // caminho que sobrava e a razão de a mesma peça aparecer duas vezes na fila.
  const devolverParaCorrecao = async (ap: EnrichedAp & { req: RequisicaoEstoque }) => {
    if (!supabase) return;
    const motivo = (obs[ap.id] ?? '').trim();
    if (!motivo) {
      showToast('Escreva na observação o que precisa ser corrigido — é isso que o solicitante vai ler.', 'error', true);
      return;
    }
    setProcessing(ap.id);
    try {
      const { error } = await supabase.rpc('devolver_requisicao_estoque_para_correcao', {
        p_aprovacao_id: ap.id,
        p_motivo:       motivo,
      });
      if (error) throw error;
      // O card sai da lista de decisão e passa a aparecer em "Devolvidas" —
      // a aprovação continua Pendente (nada foi decidido), só a requisição
      // muda de status.
      setRequisicoes(prev => prev.map(r => r.id === ap.req.id
        ? { ...r, status: 'Em correção', correcao_motivo: motivo } as RequisicaoEstoque
        : r));
      setAvulsas(prev => prev[ap.req.id]
        ? { ...prev, [ap.req.id]: { ...prev[ap.req.id], status: 'Em correção', correcao_motivo: motivo } as RequisicaoEstoque }
        : prev);
      showToast(
        `Devolvida para ${ap.req.solicitante || 'o solicitante'}. Ela fica travada aqui até ele reenviar corrigida, ` +
        'em Requisições → Do Setor.', 'info', true);
    } catch (err: unknown) {
      showToast(`Não foi possível devolver: ${motivoDoErro(err)}`, 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  // Devolver a decisão do gerente (RPC `reabrir_requisicao_estoque`).
  //
  // Vale para a requisição NEGADA. A liberada já tirou material da prateleira:
  // reabrir contaria a mesma saída duas vezes, e por isso o banco recusa — o
  // caminho ali é entrada de devolução em Movimentações. A tela diz isso em
  // vez de oferecer um botão que só vai dar erro.
  const podeDevolver = profile?.role === 'admin' || profile?.role === 'ceo' || isConselheiro(profile);
  const isProfessor = profile?.role === 'admin';

  const devolver = async (ap: AprovacaoEstoque, nome: string) => {
    if (!supabase) return;
    if (!await confirm(
      `Devolver a requisição de ${nome} para correção?\n\n` +
      `A decisão de ${ap.aprovador || 'quem decidiu'} é desfeita: a requisição volta para 'Pendente' ` +
      `e o card reaparece na fila do gerente, com o seu motivo à vista.`)) return;

    const motivo = await prompt({
      message: 'Por que está voltando? (o gerente lê isto antes de decidir de novo)',
      placeholder: 'Ex.: negou por engano, o material existe na prateleira',
      confirmLabel: 'Devolver',
      maxLength: 200,
    });
    if (motivo == null) return;

    setDevolvendo(ap.id);
    try {
      const { error } = await supabase.rpc('reabrir_requisicao_estoque', {
        p_id: ap.requisicao_estoque_id, p_motivo: motivo.trim() || null,
      });
      if (error) throw new Error(error.message);
      showToast('Devolvida — o gerente decide de novo, aqui mesmo, em Pendentes.', 'success', true);
      await Promise.all([reloadDecididas(), reloadPendentes(), reloadReq()]);
    } catch (err: unknown) {
      showToast(`Não foi possível devolver: ${motivoDoErro(err)}`, 'error', true);
    } finally {
      setDevolvendo(null);
    }
  };

  const veFila      = mostrar === 'ambos' || mostrar === 'fila';
  const veDecididas = mostrar === 'ambos' || mostrar === 'decididas';

  // Espelha a divisão de AprovacoesComprasView (2026-08-24): quem foi
  // devolvido some da fila de decisão — a aprovação continua Pendente, mas
  // decidir por baixo de quem está corrigindo é exatamente o que a 522
  // passou a recusar no banco. Aqui embaixo, sem botão nenhum: nada foi
  // decidido, só se aguarda o reenvio.
  // Filtro por solicitante (2026-09-01). Embutida em Aprovações, quem manda é
  // a tela de fora; sozinha, a fila tem o seu próprio seletor logo acima.
  const solicAtivo = mostrar === 'ambos' ? solicLocal : (solicitante ?? null);
  const casaSolicitante = (nome: unknown) =>
    solicAtivo === null || chaveSolicitante(nome) === solicAtivo;

  const paraDecidir = enriched.filter(ap => ap.req.status !== 'Em correção' && casaSolicitante(ap.req.solicitante));
  const devolvidas  = enriched.filter(ap => ap.req.status === 'Em correção' && casaSolicitante(ap.req.solicitante));
  const decididasVisiveis = decididas.filter(ap =>
    casaSolicitante(requisicoes.find(r => r.id === ap.requisicao_estoque_id)?.solicitante));

  // A fila pendente INTEIRA (sem o filtro aplicado) é o catálogo de nomes de
  // quem embute o bloco. Sai por efeito, comparando a lista já serializada:
  // avisar durante o render remontaria o pai a cada passada.
  const nomesFila = enriched
    .filter(ap => ap.req.status !== 'Em correção')
    .map(ap => String(ap.req.solicitante ?? ''));
  const chaveNomesFila = JSON.stringify(nomesFila);
  useEffect(() => {
    onSolicitantes?.(JSON.parse(chaveNomesFila) as string[]);
  }, [chaveNomesFila]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      // Nenhum pedaço trava a altura nem rola por dentro: a tela rola inteira,
      // no <main> do app. Com `h-full` e a fila rolando por conta própria,
      // cabeçalho e filtro comiam a altura e sobravam dois cards — o mesmo
      // defeito corrigido em Aprovações (AprovacoesComprasView).
      className={mostrar === 'ambos'
        ? 'flex flex-col gap-8'
        : mostrar === 'fila' ? 'flex flex-col gap-4' : 'flex flex-col gap-4 shrink-0'}>
      {mostrar === 'ambos' && (
        <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
          <div><h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Liberar Requisições — {filial}</h2></div>
        </div>
      )}
      {veFila && orfas > 0 && (
        <div className="neu-flat rounded-2xl p-4 border border-yellow-500/25 shrink-0">
          <p className="text-xs text-yellow-400 leading-relaxed">
            {orfas} aprovação(ões) pendente(s) sem requisição legível — a requisição foi inativada
            ou não é visível para o seu usuário. Elas não aparecem na lista abaixo e continuam
            travando o pedido de quem solicitou.
          </p>
        </div>
      )}
      {/* Cartão no formato do de Compra (2026-08-24) — mesma largura, mesmo
          cabeçalho com código e data, observação à vista em vez de escondida
          atrás de um botão. Trocar de aba não pode parecer trocar de sistema.
          Falta aqui o que `requisicoes_estoque` não tem — número sequencial
          e urgência não existem nesta tabela; o código curto (REQ-xxxxxx) é
          o que dá para nomear o documento numa conversa. */}
      {mostrar === 'ambos' && (
        <FiltroSolicitante
          valor={solicLocal}
          onChange={setSolicLocal}
          nomes={enriched.filter(ap => ap.req.status !== 'Em correção').map(ap => ap.req.solicitante)}
        />
      )}
      {veFila && (paraDecidir.length === 0 ? (
        <EmptyState message={solicAtivo !== null
          ? `Nada de ${solicAtivo} esperando liberação.`
          : 'Nenhum material esperando liberação'} />
      ) : (
        <div className="flex flex-col gap-4 pb-6">
          {paraDecidir.map(ap => (
            <motion.div key={ap.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="neu-flat rounded-2xl border border-white/5 p-5 flex flex-col gap-4">
              {/* `min-w-0` já existia aqui; `truncate` é o que faltava —
                  sem ele um nome de produto comprido quebrava em várias
                  linhas e empurrava a altura do card, em vez de cortar como o
                  resto da tela faz (o nome completo segue disponível no
                  Histórico, ao lado). Mesmo ajuste do card de Aprovações de
                  compra. */}
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-credencial text-gray-500 tracking-wider">{numeroRequisicao(ap.req)}</p>
                  <p className="text-sm font-bold text-gray-200 truncate">
                    {ap.prod?.nome ?? 'Produto não encontrado'}
                    {/* Material sai do estoque da casa: a marca é a do cadastro,
                        e quem autoriza a saída vê qual item está saindo. */}
                    {ap.prod?.marca && (
                      <span className="text-xs font-normal text-gray-400 ml-1.5">· {ap.prod.marca}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Solicitante: {ap.req.solicitante ?? '—'} · Qtd: {ap.req.qtd} · Destino: {ap.req.destino || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <HistoricoOperacoes entidade="requisicoes_estoque" entidadeId={ap.req.id}
                    titulo={`${numeroRequisicao(ap.req)} · ${ap.prod?.nome ?? 'material'}`}
                    criadoEm={ap.req.created_at} atualizadoEm={(ap.req as any).updated_at} />
                </div>
              </div>
              {ap.req.created_at && (
                <p className="text-[11px] text-gray-500 -mt-2 flex items-center gap-2">
                  Aberta em {formatDataHoraBR(ap.req.created_at)}
                  <IdadeBadge iso={ap.req.created_at} />
                </p>
              )}
              <p className="text-[11px] text-gray-500 leading-snug">
                <span className="text-gray-300 font-bold">Negar</span> é decisão de mérito — a unidade
                não vai receber isto, e o documento se encerra.{' '}
                <span className="text-amber-400/90 font-bold">Devolver</span> é para o pedido mal feito:
                quantidade errada, destino impreciso. Volta para quem abriu, com o motivo, e o mesmo
                documento retorna corrigido — sem virar requisição nova.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Observação <span className="text-red-500/70">(obrigatória para negar e para devolver)</span>
                </label>
                <textarea className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-16"
                  placeholder="Justificativa da decisão..."
                  value={obs[ap.id] ?? ''} onChange={e => setObs(o => ({ ...o, [ap.id]: e.target.value }))} />
              </div>
              <div className="flex flex-wrap gap-3 justify-end">
                <button
                  onClick={() => devolverParaCorrecao(ap)}
                  disabled={processing === ap.id}
                  title="O pedido está mal feito: volta para quem abriu, com o seu motivo, e não conta como negado."
                  className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-amber-400 hover:border-amber-400/20 border border-transparent transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {processing === ap.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Devolver p/ correção
                </button>
                <button onClick={() => decidir(ap, 'Negado')} disabled={processing === ap.id}
                  className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-red-500 hover:border-red-500/20 border border-transparent transition-all disabled:opacity-50 flex items-center gap-2">
                  {processing === ap.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Negar
                </button>
                <button onClick={() => decidir(ap, 'Aprovado')} disabled={processing === ap.id}
                  className="neu-button-accent py-2 px-6 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50">
                  {processing === ap.id ? <Loader2 size={14} className="animate-spin text-[#0A0A0A]" /> : <Check size={14} />}
                  Aprovar
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ))}

      {/* Devolvidas — mesmo tratamento do card `Em correção` em
          AprovacoesComprasView: sem botão, só o contexto. Quem corrige é quem
          abriu; a fila de decisão continua vazia até o reenvio. */}
      {veFila && devolvidas.length > 0 && (
        <div className="flex flex-col gap-3 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Devolvidas — esperando correção
          </p>
          {devolvidas.map(ap => (
            <div key={ap.id} className="neu-pressed rounded-xl p-3 border border-amber-400/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-credencial text-gray-500 tracking-wider">{numeroRequisicao(ap.req)}</p>
                  <p className="text-sm font-semibold text-gray-200 truncate">{ap.prod?.nome ?? 'Produto não encontrado'}</p>
                  <p className="text-xs text-gray-300 mt-1">{ap.req.correcao_motivo || 'Sem motivo registrado.'}</p>
                  {((ap.req as any).correcao_solicitada_em || (ap.req as any).correcao_solicitada_por) && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Devolvida
                      {nomesDevolucao[(ap.req as any).correcao_solicitada_por]
                        ? ` por ${nomesDevolucao[(ap.req as any).correcao_solicitada_por]}`
                        : ''}
                      {(ap.req as any).correcao_solicitada_em
                        ? ` em ${formatDataHoraBR((ap.req as any).correcao_solicitada_em)}`
                        : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] text-gray-500 text-right">
                    com {ap.req.solicitante || 'quem abriu'}
                  </span>
                  <IdadeBadge iso={(ap.req as any).correcao_solicitada_em} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Decisões já tomadas — só para a direção. */}
      {veDecididas && podeDevolver && decididasVisiveis.length > 0 && (
        <div className="neu-flat rounded-2xl p-5 border border-white/5 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            {mostrar === 'ambos' ? 'Decisões já tomadas' : 'Decisões já tomadas — material do estoque'}
          </p>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            Negada por engano volta para a fila do gerente com o seu motivo. Liberada não volta: o material
            já saiu da prateleira, e desfazer contaria a mesma saída duas vezes — o caminho é registrar a
            entrada de devolução em Estoque → Movimentações.
          </p>
          {/* Sem caixa rolando dentro da página — rolagem dentro de rolagem
              foi o que espremeu a lista para um card. São no máximo 15. */}
          <div className="flex flex-col gap-2">
            {decididasVisiveis.slice(0, 15).map(ap => {
              const req = requisicoes.find(r => r.id === ap.requisicao_estoque_id);
              const prod = req ? produtos.find(p => p.id === req.produto_id) : undefined;
              const nome = prod?.nome ?? 'material';
              const liberada = ap.status === 'Aprovado';
              const indo = devolvendo === ap.id;
              return (
                <div key={ap.id} className="neu-pressed rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${liberada
                        ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}`}>
                        {/* "Liberado" é o verbo do botão, não o nome do status
                            (item 21 do plano) — o valor gravado é 'Aprovado',
                            igual ao resto da régua de decisão. */}
                        {liberada ? 'Aprovado' : 'Negado'}
                      </span>
                      <span className="text-[11px] text-gray-500">Qtd: {req?.qtd ?? '—'}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-200 truncate">{nome}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      por {ap.aprovador || '—'}
                      {ap.observacao ? ` · ${ap.observacao}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {liberada ? (
                      <span className="text-[10px] text-gray-600 max-w-[10rem] text-right leading-tight">
                        material já saiu — devolução em Movimentações
                      </span>
                    ) : (
                      <button onClick={() => devolver(ap, nome)} disabled={indo}
                        title="Devolver para correção" className="action-btn-warning disabled:opacity-50">
                        {indo ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      </button>
                    )}
                    {isProfessor && (
                      <ExcluirAdmin
                        endpoint="/api/requisicoesestoqueview"
                        id={ap.requisicao_estoque_id}
                        rotulo={`a requisição de ${nome}`}
                        alternativa={liberada
                          ? 'registre a entrada de devolução em Estoque → Movimentações e abra uma requisição nova.'
                          : 'use o botão de devolver ao lado: ela volta para Pendente e o gerente decide de novo.'}
                        showToast={showToast}
                        onExcluido={() => { reloadDecididas(); reloadReq(); }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {decididasVisiveis.length > 15 && (
            <p className="text-[10px] text-gray-600 mt-3">
              Mostrando as 15 decisões mais recentes.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
};

export const AprovacoesEstoqueView = ({ showToast, profile }: { showToast: (msg: string, type: string, persist?: boolean) => void; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A liberação de material do almoxarifado" />;
  return <AprovacoesEstoqueBloco showToast={showToast} profile={profile} filial={filialAtiva} />;
};
