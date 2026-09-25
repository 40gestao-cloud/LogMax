import React, { useEffect, useState } from 'react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ClipboardList, ThumbsDown, ThumbsUp, Loader2, RotateCcw, Package } from 'lucide-react';
import { useFetchData } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, UrgenciaBadge, SelecioneUnidade, IdadeBadge, AbaComContador } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { semelhancaDeItem } from '../lib/similaridadeItem';
import { qtdBR } from '../lib/viewUtils';
import { normalizarUnidade, pluralEmbalagem } from '../lib/unidades';
import { FluxoCompra } from '../components/FluxoCompra';
import { etapaDaRequisicao } from '../lib/fluxoCompra';
import { numeroRequisicao } from '../lib/documentos';
import { formatDataHoraBR } from '../lib/dates';
import type { UserProfile } from '../hooks/useUserProfile';
import { isConselheiro } from '../lib/rbac';
import type { AprovacaoCompras, AprovacaoEstoque, Requisicao } from '../types/domain';
import { AprovacoesEstoqueBloco } from './AprovacoesEstoqueView';
import { FiltroSolicitante, chaveSolicitante } from '../components/FiltroSolicitante';

type ShowToast = (msg: string, type: string, persist?: boolean) => void;

type EnrichedAp = AprovacaoCompras & { req: Requisicao };

const AprovacoesComprasViewInner = ({ showToast, profile, filial }: { showToast: ShowToast; profile: UserProfile; filial: FilialOp }) => {
  const { data: aprovacoes, setData: setAprovacoes, isLoading: loadingAp, reload: reloadPendentes } = useFetchData<AprovacaoCompras>('/api/minhasaprovacoesview', { status: 'Pendente', filial }, true);
  const { data: requisicoes, setData: setRequisicoes, isLoading: loadingReq, reload: reloadReq } = useFetchData<Requisicao>('/api/requisicoesview', { filial }, true);
  // As decisões já tomadas. A tela só listava 'Pendente', então o card sumia no
  // instante em que o gerente clicava — e o erro dele virava impasse, porque a
  // volta só existia em Requisições, outra tela, outro menu.
  const { data: decididas, reload: reloadDecididas } = useFetchData<AprovacaoCompras>('/api/minhasaprovacoesview', { status: ['Aprovado', 'Negado'], filial }, true);
  // Só para o número da pílula: quem decide precisa ver que há material
  // esperando SEM ter de clicar na aba. A fila em si é renderizada pelo
  // componente de Estoque, que traz os seus próprios dados.
  const { data: filaMaterial } = useFetchData<AprovacaoEstoque>('/api/minhasaprovacoesestoqueview', { status: 'Pendente', filial }, true);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [processing, setProcessing] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Decisão tomada aberta para ver os detalhes (a aba da direção).
  const [decisaoAberta, setDecisaoAberta] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});

  const isLoading = loadingAp || loadingReq;

  // A lista de requisições vem sem paginação e limitada pelo servidor. Quando
  // a requisição de uma aprovação pendente não vem nela, buscamos a linha pelo
  // id em vez de descartar a aprovação — que era o que acontecia antes: o
  // `filter` abaixo removia o card em silêncio, a requisição ficava Pendente
  // para sempre e a tela dizia "nenhuma aprovação pendente". Falha de leitura
  // não pode se parecer com fila vazia.
  const [avulsas, setAvulsas] = useState<Record<string, Requisicao>>({});
  const [orfas, setOrfas] = useState(0);
  const faltantes = aprovacoes
    .filter(ap => !requisicoes.some(r => r.id === ap.requisicao_id) && !avulsas[ap.requisicao_id])
    .map(ap => ap.requisicao_id);
  const chaveFaltantes = faltantes.join(',');

  useEffect(() => {
    if (loadingAp || loadingReq || !chaveFaltantes || !supabase) { if (!chaveFaltantes) setOrfas(0); return; }
    let cancelado = false;
    (async () => {
      const ids = chaveFaltantes.split(',');
      const { data: rows, error } = await supabase!
        .from('requisicoes').select('*').in('id', ids).eq('ativo', true);
      if (cancelado) return;
      const achadas = (rows ?? []) as Requisicao[];
      if (achadas.length) {
        setAvulsas(prev => ({ ...prev, ...Object.fromEntries(achadas.map(r => [r.id, r])) }));
      }
      // Sobrou aprovação sem requisição legível: ou a requisição foi inativada
      // sem levar a aprovação junto, ou a RLS não a entrega a quem decide. Os
      // dois casos precisam aparecer, não sumir.
      setOrfas(error ? ids.length : ids.length - achadas.length);
    })();
    return () => { cancelado = true; };
  }, [chaveFaltantes, loadingAp, loadingReq]);

  // Quem devolveu, por nome (item 19 do plano de requisições). A coluna
  // `correcao_solicitada_por` guarda o uuid de quem devolveu desde a migr.
  // 517; a aba "Devolvidas" mostrava o motivo sem dizer quem pediu nem quando.
  //
  // O nome pode não vir: a policy de `user_profiles` é
  // `id = auth.uid() OR auth_is_admin() OR auth_pode_filial(filial)`, e
  // `auth_pode_filial` compara `auth_user_filial() = p_filial` — com o perfil
  // da Matriz, que não tem filial, a comparação é NULL e a linha não é
  // entregue. Ou seja: o gerente NÃO lê o nome do professor que devolveu.
  // Por isso o id resolvido vira string vazia em vez de ficar num "…"
  // eterno, e a tela omite o "por fulano" mantendo a data.
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
      // Os que a RLS não entregou entram como '' — marca de "já tentei",
      // que impede o efeito de repetir a consulta a cada render.
      setNomesDevolucao(prev => ({
        ...prev,
        ...Object.fromEntries(ids.map(id => [id, achados[id] ?? ''])),
      }));
    })();
    return () => { cancelado = true; };
  }, [chaveIdsCorrecao]);

  // De onde veio o pedido (2026-08-24).
  //
  // O gerente decidia sem saber se estava olhando uma reposição de catálogo ou
  // um item escrito à mão — e são conferências diferentes. Na Reposição, o que
  // justifica é o saldo, que o sistema fotografou; se o saldo está longe do
  // mínimo, a reposição não se sustenta. Na Eventual, quem justifica é o texto
  // do solicitante, e é ali que mora o pedido mal feito.
  //
  // Requisição de MATERIAL (almoxarifado) não chega nesta tela — ela tem
  // aprovação própria em Estoque. O rótulo existe para deixar isso explícito
  // para quem procura por ela aqui.
  const tipoDaReq = (req: Requisicao) => {
    if ((req as any).servico_id) {
      return { label: 'Serviço', cor: 'bg-sky-500/15 text-sky-400' };
    }
    return req.tipo_requisicao === 'Reposição'
      ? { label: 'Reposição', cor: 'bg-emerald-500/15 text-emerald-400' }
      // NULL é requisição anterior à migr. 358, quando só havia um caminho.
      : { label: req.tipo_requisicao ?? 'Compra', cor: 'bg-purple-500/15 text-purple-400' };
  };

  // Outras requisições VIVAS do mesmo item na mesma unidade (2026-08-24).
  //
  // É o que o gerente pediu para enxergar: ele devolve uma para correção e
  // chega outra igual, com número diferente, e a tela não dizia que as duas
  // falavam do mesmo item. Não é duplicação do sistema — é documento novo,
  // aberto por quem não achou o caminho da correção (às vezes um colega do
  // autor). Sem este aviso, o gerente aprova as duas e a unidade compra duas
  // vezes.
  // Duas chaves, código primeiro. `produto_id` é o código — a Reposição sempre
  // o traz, e a Eventual passa a trazer quando Compras amarra o item ao
  // catálogo. Texto só onde nenhum dos dois lados tem código: a Eventual recém
  // aberta, onde o texto é tudo o que existe.
  const irmasVivas = (req: Requisicao): Requisicao[] => {
    const norm = (t: any) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const vivas = requisicoes.filter(o =>
      o.id !== req.id
      && (o as any).ativo !== false
      && o.filial === req.filial
      && ['Pendente', 'Aprovado', 'Em correção'].includes(String(o.status)));

    const pid = (req as any).produto_id;
    if (pid) {
      const porCodigo = vivas.filter(o => (o as any).produto_id === pid);
      if (porCodigo.length > 0) return porCodigo;
    }
    const k = norm(req.item);
    if (!k) return [];
    // Igualdade de string não basta: a marca no fim muda a string inteira e
    // continua sendo o mesmo item. Régua em src/lib/similaridadeItem.ts.
    return vivas.filter(o => !(o as any).produto_id && semelhancaDeItem(o.item, req.item) !== 'nao');
  };

  const enriched: EnrichedAp[] = aprovacoes
    .map(ap => ({ ...ap, req: requisicoes.find(r => r.id === ap.requisicao_id) ?? avulsas[ap.requisicao_id] }))
    .filter((ap): ap is EnrichedAp => ap.req !== undefined);

  // Autoridade (migr. 282): quem decide é o gerente da filial ou a Matriz —
  // e nunca quem abriu a requisição. Compras executa a compra, não a aprova.
  const isMatriz = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  const podeDecidir = (ap: EnrichedAp): boolean => {
    if (isMatriz) return true;
    if (ap.req.criado_por && ap.req.criado_por === profile.id) return false;
    return profile.role === 'gerente';
  };

  // Decisão da requisição: uma RPC, uma transação (migr. 282).
  //
  // Eram dois `UPDATE` soltos (aprovação, depois requisição) com rollback
  // best-effort no `catch` — o P6 do gabarito. E a cascata do Negado cancelava
  // cotação por cotação, num laço, sem transação nenhuma. Agora aprovação,
  // requisição e cascata caem juntas ou não caem.
  //
  // A autoridade também mudou: quem decide é o gerente da filial (ou a
  // Matriz), nunca quem abriu a requisição. O banco recusa o resto.
  const decidir = async (ap: EnrichedAp, decisao: 'Aprovado' | 'Negado') => {
    if (decisao === 'Negado' && !(obs[ap.id] ?? '').trim()) {
      showToast("Informe a justificativa para negar.", 'error', true);
      return;
    }
    if (!supabase) return;
    setProcessing(ap.id);
    try {
      const { data, error } = await supabase.rpc('decidir_requisicao_compra', {
        p_aprovacao_id: ap.id,
        p_decisao:      decisao,
        p_observacao:   obs[ap.id] ?? '',
      });
      if (error) {
        showToast(error.message, 'error', true);
        return;
      }
      const canceladas = Number((data as any)?.cotacoes_canceladas ?? 0);
      setAprovacoes(prev => prev.filter(a => a.id !== ap.id));
      // A mensagem diz o passo seguinte, não só que deu certo: aprovar aqui
      // não compra nada — alguém em Compras ainda precisa cotar.
      showToast(
        decisao === 'Aprovado'
          ? 'Requisição aprovada. Compras já pode cotar em Compras → Cotações.'
          : canceladas > 0
            ? `Requisição negada (${canceladas} cotação(ões) cancelada(s)). O solicitante vê o motivo em Requisições → Do setor.`
            : 'Requisição negada. O solicitante vê o motivo em Requisições → Do setor.',
        decisao === 'Aprovado' ? 'success' : 'info', true,
      );
    } catch (err: any) {
      showToast(`Erro ao decidir: ${err?.message ?? err}`, 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  const handleAprovar = (ap: EnrichedAp) => decidir(ap, 'Aprovado');
  const handleNegar   = (ap: EnrichedAp) => decidir(ap, 'Negado');

  // Terceira saída do gerente (migr. 517), ao lado de Aprovar e Negar.
  //
  // Negar é decisão de MÉRITO — "não vamos comprar isto" — e é terminal: o
  // solicitante não edita a requisição (a policy só entrega UPDATE a compras e
  // ao gerente) nem a reenvia. Quem errava a quantidade ou a justificativa não
  // tinha caminho: abria outra requisição e perdia o fio do documento, ou
  // chamava a direção para usar `reabrir_requisicao`, que é ferramenta de
  // professor. Em aula errar é a regra, e um fluxo onde o erro só se conserta
  // por fora do fluxo não ensina o fluxo.
  //
  // Devolver não decide a aprovação: ela segue 'Pendente'. Nada foi julgado —
  // o documento só saiu da mesa, e volta para ela quando o solicitante corrigir.
  const devolverParaCorrecao = async (ap: EnrichedAp) => {
    if (!supabase) return;
    const motivo = (obs[ap.id] ?? '').trim();
    if (!motivo) {
      showToast('Escreva na observação o que precisa ser corrigido — é isso que o solicitante vai ler.', 'error', true);
      return;
    }
    setProcessing(ap.id);
    try {
      const { error } = await supabase.rpc('devolver_requisicao_para_correcao', {
        p_aprovacao_id: ap.id,
        p_motivo:       motivo,
      });
      if (error) throw error;
      // O card NÃO some: a aprovação continua 'Pendente' (nada foi decidido), e
      // some-agora-volta-no-reload seria pior que ficar. Ele fica travado, com o
      // motivo à vista — o gerente enxerga o que mandou consertar.
      setRequisicoes(prev => prev.map(r => r.id === ap.req.id
        ? { ...r, status: 'Em correção', correcao_motivo: motivo } as Requisicao
        : r));
      setAvulsas(prev => prev[ap.req.id]
        ? { ...prev, [ap.req.id]: { ...prev[ap.req.id], status: 'Em correção', correcao_motivo: motivo } as Requisicao }
        : prev);
      showToast(
        `${numeroRequisicao(ap.req)} devolvida para ${ap.req.solicitante || 'o solicitante'}. `
        + 'Ela fica travada aqui até ele reenviar corrigida, em Requisições → Do Setor.', 'info', true);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível devolver.', 'error', true);
    } finally {
      setProcessing(null);
    }
  };

  // Devolver a decisão do gerente (migr. 330/340, RPC `reabrir_requisicao`).
  //
  // A régua já existia no banco — 'Só a direção reabre uma requisição' — mas o
  // botão morava em Requisições. Quem trabalha nesta tela via o erro do gerente
  // e não tinha como desfazer; em aula isso trava a cadeia inteira, porque a
  // requisição fica 'Aprovado' errada e Compras cota em cima dela.
  //
  // Devolver, não editar: a requisição volta para 'Pendente' e a aprovação
  // volta para a fila do gerente, com o motivo à vista. A alçada continua
  // sendo dele — a direção desfaz a decisão, não decide no lugar.
  const podeDevolver = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  // Excluir é só do professor: `auth_is_admin()` inclui CEO e conselheiro, que
  // aqui são alunos. Destruir documento não é atribuição de aluno.
  const isProfessor = profile.role === 'admin';

  const devolver = async (ap: AprovacaoCompras, req: Requisicao | undefined) => {
    if (!supabase) return;
    const rotulo = req ? numeroRequisicao(req) : `#${String(ap.requisicao_id).slice(-6).toUpperCase()}`;
    if (!await confirm(
      `Devolver ${rotulo} para correção?\n\n` +
      `A decisão de ${ap.aprovador || 'quem aprovou'} é desfeita: a requisição volta para 'Pendente' ` +
      `e o card reaparece na fila de aprovação do gerente, com o seu motivo à vista.\n\n` +
      `Se já existe cotação ou pedido em cima dela, o banco recusa e diz o que resolver antes.`)) return;

    const motivo = await prompt({
      message: 'Por que está voltando? (o gerente lê isto antes de decidir de novo)',
      placeholder: 'Ex.: aprovou 50 onde a requisição pedia 5',
      confirmLabel: 'Devolver',
      maxLength: 200,
    });
    if (motivo == null) return;

    setDevolvendo(ap.id);
    try {
      const { data: res, error } = await supabase.rpc('reabrir_requisicao', {
        p_id: ap.requisicao_id, p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      showToast((res as any)?.restaurada
        ? 'Requisição restaurada e devolvida — está na fila do gerente.'
        : 'Devolvida — o gerente decide de novo, aqui mesmo, em Pendentes.', 'success', true);
      await Promise.all([reloadDecididas(), reloadPendentes(), reloadReq()]);
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível devolver.', 'error', true);
    } finally {
      setDevolvendo(null);
    }
  };

  // ── Abas por situação (2026-08-24) ──────────────────────────────
  //
  // A tela empilhava tudo: a fila de decisão em cima, com a altura que sobrava,
  // e embaixo um bloco fixo de decisões já tomadas com rolagem própria. Sobrava
  // uma faixa de dois cards para o que é o trabalho da tela. Pior: o que o
  // gerente devolveu continuava na MESMA lista do que ele ainda precisa
  // decidir — só que sem botão, porque a bola está com o solicitante.
  //
  // Devolvida não é fila de decisão: é acompanhamento. Por isso sai da fila e
  // ganha aba própria.
  // ── Filtro por solicitante (2026-09-01) ─────────────────────────
  //
  // Um controle só, valendo para as quatro abas — inclusive a de material, que
  // é desenhada pelo bloco de Estoque e recebe o nome escolhido por prop. O
  // gerente escolhe a pessoa uma vez e passeia pelas filas dela.
  const [solicitante, setSolicitante] = useState<string | null>(null);
  const casaSolicitante = (nome: unknown) =>
    solicitante === null || chaveSolicitante(nome) === solicitante;

  const paraDecidirTodas = enriched.filter(ap => ap.req.status !== 'Em correção');
  const devolvidasTodas = enriched.filter(ap => ap.req.status === 'Em correção');
  const paraDecidir = paraDecidirTodas.filter(ap => casaSolicitante(ap.req.solicitante));
  const devolvidas = devolvidasTodas.filter(ap => casaSolicitante(ap.req.solicitante));
  // A decisão já tomada guarda só o id da requisição; o nome vem da linha
  // correspondente. Quando ela não é legível (inativada ou fora da RLS) o
  // documento cai no grupo "sem solicitante" do filtro em vez de sumir.
  // A ficha da requisição — os campos, a fotografia do estoque (reposição) e a
  // justificativa. Função porque são dois lugares que precisam mostrar a MESMA
  // coisa: o card de quem vai decidir e a decisão já tomada, aberta pela
  // direção para conferir o que foi aprovado ou negado.
  const fichaDaRequisicao = (req: any) => (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Origem', val: tipoDaReq(req).label },
          { label: 'Solicitante', val: req.solicitante || '—' },
          { label: 'Setor', val: req.setor_solicitante || '—' },
          { label: 'Centro de Custo', val: req.centro_custo || '—' },
          { label: 'Urgência', val: req.urgencia ?? 'Normal' },
          { label: 'Quantidade', val: `${qtdBR(req.qtd)} ${normalizarUnidade(req.unidade)}`.trim() },
          // Migr. 589: o fator é o do DIA DO PEDIDO — o
          // cadastro pode ter mudado desde então.
          ...(req.embalagem_nome && req.qtd_embalagens != null ? [{
            label: 'Pedido em embalagem',
            val: `${qtdBR(req.qtd_embalagens)} ${pluralEmbalagem(req.embalagem_nome, Number(req.qtd_embalagens))} de ${qtdBR(req.embalagem_fator)} ${normalizarUnidade(req.unidade)}`,
          }] : []),
          // Vazio não é omissão: é o solicitante dizendo que
          // serve qualquer marca. O gerente decide sabendo.
          { label: 'Marca', val: req.marca || 'Qualquer marca' },
          { label: 'Necessário até', val: req.data_necessidade ?? '—' },
          { label: 'Aberta em', val: req.data ?? '—' },
        ].map(({ label, val }) => (
          <div key={label} className="neu-pressed p-3 rounded-xl">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">{label}</span>
            <span className="text-xs text-gray-200 font-semibold capitalize">{val}</span>
          </div>
        ))}
      </div>

      {/* Na Reposição isto ocupa o lugar da justificativa: é a
          fotografia do estoque no instante do pedido (migr.
          358), e não depende de ninguém ter escrito bem. É
          também a conferência que o gerente precisa fazer —
          saldo acima do mínimo é reposição sem motivo. */}
      {req.saldo_no_pedido != null && (
        <div className="neu-pressed p-3 rounded-xl">
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">
            Saldo quando foi pedido
          </span>
          <span className="text-xs text-gray-300">
            <strong className={Number(req.minimo_no_pedido) > 0 && Number(req.saldo_no_pedido) <= Number(req.minimo_no_pedido)
              ? 'text-red-400' : 'text-gray-200'}>
              {req.saldo_no_pedido}
            </strong>
            {req.minimo_no_pedido != null && Number(req.minimo_no_pedido) > 0 && (
              <> em estoque, para um mínimo de <strong className="text-gray-200">{req.minimo_no_pedido}</strong></>
            )}
            {' '}{req.unidade ?? ''}
          </span>
        </div>
      )}

      {/* A justificativa é o que se lê para decidir — por isso
          vem antes dos botões, não escondida num tooltip. */}
      {req.justificativa && (
        <div className="neu-pressed p-3 rounded-xl">
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold block mb-1">Justificativa do solicitante</span>
          <span className="text-xs text-gray-200">{req.justificativa}</span>
        </div>
      )}
    </>
  );

  const reqDaDecisao = (ap: AprovacaoCompras) =>
    requisicoes.find(r => r.id === ap.requisicao_id) ?? avulsas[ap.requisicao_id];
  const decididasFiltradas = decididas.filter(ap => casaSolicitante(reqDaDecisao(ap)?.solicitante));
  // Os nomes da fila de material vêm do próprio bloco de Estoque, que já os
  // tem carregados — a alternativa era esta tela buscar `requisicoes_estoque`
  // de novo, uma consulta idêntica à do filho só para montar a lista.
  const [nomesMaterial, setNomesMaterial] = useState<string[]>([]);

  const ABAS = [
    // "Compra" nomeava o assunto, não a pendência: numa tela de aprovações
    // toda linha é uma requisição de compra, então o rótulo não dizia nada ao
    // gerente sobre o que falta ali. Agora as duas primeiras abas nomeiam o
    // verbo que se espera dele — aprovar a compra, liberar o material.
    //
    // `cor` (AbaComContador, ui.tsx), escolhida pelo professor em 24/09:
    // amarelo o que espera a decisão, roxo a outra fila (material do
    // estoque), vermelho o que voltou, verde o que já foi decidido.
    { key: 'decidir' as const, label: 'Compras a aprovar', n: paraDecidir.length, cor: 'amarelo' as const },
    // Material do almoxarifado (2026-08-24). São dois documentos diferentes e
    // duas decisões diferentes — comprar não é entregar o que já está na
    // prateleira, e liberar material dá baixa no estoque na hora. Mas quem
    // decide os dois é a MESMA pessoa, e ela procurava a segunda fila em
    // Estoque > Liberar Requisições, um módulo adiante. Aba, não mistura: os
    // cards continuam com o vocabulário e os botões de cada fluxo.
    // O número aqui é o total da fila, sem o filtro por solicitante: o nome de
    // quem pediu está em `requisicoes_estoque`, que só o bloco de Estoque
    // carrega. Dentro da aba a fila obedece ao filtro.
    { key: 'material' as const, label: 'Material a liberar', n: filaMaterial.length, cor: 'roxo' as const },
    { key: 'devolvidas' as const, label: 'Devolvidas', n: devolvidas.length, cor: 'vermelho' as const },
    // Desfazer decisão é da direção (migr. 282): o gerente não reabre o que
    // decidiu. Sem essa autoridade, a aba nem existe.
    ...(podeDevolver ? [{ key: 'decididas' as const, label: 'Decisões tomadas', n: decididasFiltradas.length, cor: 'verde' as const }] : []),
  ];
  type AbaKey = 'decidir' | 'material' | 'devolvidas' | 'decididas';
  const [aba, setAba] = useState<AbaKey | null>(null);
  const abaAtiva: AbaKey = aba && ABAS.some(a => a.key === aba) ? aba : 'decidir';
  const visiveis = abaAtiva === 'devolvidas' ? devolvidas : paraDecidir;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-full gap-8">
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Aprovações — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Tudo o que espera a sua decisão, num sítio só. Em <span className="text-gray-300 font-semibold">Compras a aprovar</span>,
            aprovar não compra nada — libera Compras para cotar fornecedores. Em{' '}
            <span className="text-gray-300 font-semibold">Material a liberar</span>, liberar entrega o que já
            está na prateleira e baixa o saldo na hora.
          </p>
        </div>
      </div>

      {orfas > 0 && (
        <div className="neu-flat rounded-2xl p-4 border border-yellow-500/25 shrink-0">
          <p className="text-xs text-yellow-400 leading-relaxed">
            {orfas} aprovação(ões) pendente(s) sem requisição legível — a requisição foi inativada
            ou não é visível para o seu usuário. Elas não aparecem na lista abaixo e continuam
            travando o pedido de quem solicitou.
          </p>
        </div>
      )}

      {isLoading ? <LoadingSpinner /> : (
      <>
      {/* Abas de fila no padrão AbaComContador (as mesmas de Requisições > Do
          Setor e de Cotações). */}
      <div className="flex gap-3 flex-wrap shrink-0" role="tablist">
        {ABAS.map(a => (
          <AbaComContador key={a.key} label={a.label} n={a.n} cor={a.cor}
            ativa={a.key === abaAtiva} onClick={() => setAba(a.key)}
            icon={a.key === 'devolvidas' ? RotateCcw : a.key === 'material' ? Package : undefined} />
        ))}
      </div>

      {/* Quem pediu — o mesmo controle para as quatro abas. A contagem ao lado
          de cada nome é da aba aberta: é ela que responde "quantas ele tem
          esperando aqui". */}
      <FiltroSolicitante
        valor={solicitante}
        onChange={setSolicitante}
        nomes={
          abaAtiva === 'decidir'    ? paraDecidirTodas.map(ap => ap.req.solicitante)
          : abaAtiva === 'devolvidas' ? devolvidasTodas.map(ap => ap.req.solicitante)
          : abaAtiva === 'decididas'  ? decididas.map(ap => reqDaDecisao(ap)?.solicitante)
          : nomesMaterial
        }
      />

      {abaAtiva === 'material' && (
        <AprovacoesEstoqueBloco showToast={showToast} profile={profile} filial={filial} mostrar="fila" solicitante={solicitante} onSolicitantes={setNomesMaterial} />
      )}

      {(abaAtiva === 'decidir' || abaAtiva === 'devolvidas') && (visiveis.length === 0 ? (
        <EmptyState message={solicitante !== null
          ? `Nada de ${solicitante} nesta aba. Troque o solicitante ou volte para "Todos".`
          : abaAtiva === 'devolvidas'
          ? 'Nada devolvido para correção — o que você mandar consertar fica aqui até o solicitante reenviar.'
          : 'Nenhuma aprovação pendente'} />
      ) : (
        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto main-scrollbar pr-2 pb-6">
          {visiveis.map(ap => {
            const req = ap.req;
            const isExpanded = expanded === ap.id;
            const isProcessing = processing === ap.id;
            return (
              <motion.div key={ap.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="neu-flat rounded-2xl border border-white/5">
                <button
                  onClick={() => setExpanded(isExpanded ? null : ap.id)}
                  className="w-full p-5 flex items-center justify-between gap-3 flex-wrap hover:bg-white/[0.02] transition-colors"
                >
                  {/* `min-w-0` é o que falta ao flex item para poder encolher
                      abaixo do próprio conteúdo — sem ele, um nome de item
                      comprido (que é a regra, não a exceção, num catálogo)
                      empurrava os badges e a seta de expandir para fora da
                      tela em mobile. `truncate` no nome evita a quebra feia; o
                      nome completo já está na ficha, dentro do card expandido. */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 neu-circle flex items-center justify-center bg-accent/5 shrink-0">
                      <ClipboardList size={18} className="text-accent" />
                    </div>
                    <div className="text-left min-w-0">
                      <p className="text-[10px] font-credencial text-gray-500 tracking-wider">{numeroRequisicao(req)}</p>
                      <p className="text-sm font-bold text-gray-200 truncate">
                        {req.item}
                        {/* MIGR 582. Sem a marca o gerente aprova "papel A4"
                            sem saber se está autorizando o de R$ 18 ou o de
                            R$ 35 — e é ele que responde pelo orçamento. */}
                        {req.marca && (
                          <span className="text-xs font-normal text-gray-400 ml-1.5">· {req.marca}</span>
                        )}
                      </p>
                      {/* Migr. 589: "600" e "20 fardos" são a mesma compra
                          contada de dois jeitos, e o gerente decide melhor
                          vendo o jeito em que o setor pediu. */}
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        Solicitante: {req.solicitante} · Qtd: {qtdBR(req.qtd)} {normalizarUnidade(req.unidade)}
                        {req.embalagem_nome && req.qtd_embalagens != null
                          && ` (${qtdBR(req.qtd_embalagens)} ${pluralEmbalagem(req.embalagem_nome, Number(req.qtd_embalagens))})`}
                        {' · '}{req.data}
                      </p>
                    </div>
                  </div>
                  {/* `flex-wrap` no botão pai (acima) deixa este bloco cair
                      para uma segunda linha em vez de espremer o nome do item
                      até sumir — mobile ganha duas linhas, desktop continua
                      numa só porque a largura sobra. */}
                  <div className="flex items-center gap-3 shrink-0 ml-auto">
                    {/* Devolvida conta a partir de quando voltou pro solicitante,
                        não de quando a requisição nasceu — é ali que o relógio da
                        fila do gerente recomeça a contar. */}
                    <IdadeBadge iso={abaAtiva === 'devolvidas' ? (req as any).correcao_solicitada_em : req.data} />
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${tipoDaReq(req).cor}`}>
                      {tipoDaReq(req).label}
                    </span>
                    <UrgenciaBadge urgencia={req.urgencia ?? 'Normal'} />
                    <ChevronDown size={16} className={`text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="px-5 pb-5 flex flex-col gap-4 border-t border-white/5 pt-4">
                        {/* Antes de decidir, dá para ver o que já aconteceu com
                            este documento — inclusive se ele voltou para cá
                            porque Compras corrigiu o item depois de aprovado. */}
                        <div className="flex items-center gap-2">
                          <HistoricoOperacoes entidade="requisicoes" entidadeId={req.id} titulo={`${numeroRequisicao(req)} · ${req.item}`} criadoEm={req.created_at} atualizadoEm={req.updated_at} />
                          <span className="text-[10px] text-gray-500">Histórico desta requisição</span>
                        </div>
                        {/* A decisão fica mais fácil quando se vê o que ela
                            destrava: aprovar aqui não compra, libera a cotação. */}
                        <FluxoCompra etapa={etapaDaRequisicao(req.status)} />
                        {fichaDaRequisicao(req)}
                        {irmasVivas(req).length > 0 && (
                          <div className="neu-pressed p-3 rounded-xl border border-amber-400/20">
                            <span className="text-[10px] text-amber-300/90 uppercase tracking-widest font-bold block mb-1">
                              Atenção: mesmo item em outro documento
                            </span>
                            <div className="flex flex-col gap-0.5">
                              {irmasVivas(req).map(o => (
                                <span key={o.id} className="text-xs text-gray-300">
                                  <span className="font-credencial text-gray-400">{numeroRequisicao(o)}</span>
                                  {' — '}
                                  <span className={o.status === 'Em correção' ? 'text-amber-300 font-bold' : ''}>
                                    {o.status === 'Em correção' ? 'devolvida para correção' : String(o.status).toLowerCase()}
                                  </span>
                                  {o.solicitante ? `, de ${o.solicitante}` : ''}
                                  {semelhancaDeItem(o.item, req.item) !== 'igual' && (
                                    <span className="block text-[11px] text-gray-500 pl-1">
                                      escrito lá como “{String(o.item ?? '').replace(/\s+/g, ' ').trim()}”
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                            <span className="block text-[11px] text-gray-500 mt-2 leading-snug">
                              São documentos diferentes para o mesmo item — ou para um muito parecido, quando
                              a grafia não bate. Aprovar os dois compra duas vezes; e se um deles está
                              devolvido, o certo é esperar a correção dele e negar este.
                            </span>
                          </div>
                        )}
                        {req.status === 'Em correção' ? (
                          <div className="neu-pressed p-3 rounded-xl border border-amber-400/20">
                            <span className="text-[10px] text-amber-300/90 uppercase tracking-widest font-bold block mb-1">
                              Devolvida — está com o solicitante
                            </span>
                            <span className="text-xs text-gray-300">
                              {(req as any).correcao_motivo || 'Aguardando correção.'}
                            </span>
                            {((req as any).correcao_solicitada_em || (req as any).correcao_solicitada_por) && (
                              <span className="block text-[11px] text-gray-400 mt-1">
                                Devolvida
                                {nomesDevolucao[(req as any).correcao_solicitada_por]
                                  ? ` por ${nomesDevolucao[(req as any).correcao_solicitada_por]}`
                                  : ''}
                                {(req as any).correcao_solicitada_em
                                  ? ` em ${formatDataHoraBR((req as any).correcao_solicitada_em)}`
                                  : ''}
                              </span>
                            )}
                            <span className="block text-[11px] text-gray-500 mt-2 leading-snug">
                              Nada foi decidido: quando {req.solicitante || 'o solicitante'} reenviar em
                              Requisições &gt; Do Setor, este mesmo card volta a aceitar Aprovar ou Negar.
                            </span>
                          </div>
                        ) : !podeDecidir(ap) ? (
                          <div className="neu-pressed p-3 rounded-xl text-xs text-gray-400">
                            {ap.req.criado_por === profile.id
                              ? 'Você abriu esta requisição — quem decide é o gerente da filial.'
                              : 'Requisição de compra é decidida pelo gerente da filial (ou pela Matriz).'}
                          </div>
                        ) : (
                        <>
                        <p className="text-[11px] text-gray-500 leading-snug">
                          <span className="text-gray-300 font-bold">Negar</span> é decisão de mérito — a unidade
                          não vai comprar isto, e o documento se encerra.{' '}
                          <span className="text-amber-400/90 font-bold">Devolver</span> é para o pedido mal feito:
                          quantidade errada, item impreciso, justificativa que não explica. Volta para quem abriu,
                          com o seu motivo, e o mesmo documento retorna corrigido — sem virar requisição nova.
                        </p>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            Observação <span className="text-red-500/70">(obrigatória para negar e para devolver)</span>
                          </label>
                          <textarea
                            className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-20"
                            placeholder="Justificativa da decisão..."
                            value={obs[ap.id] ?? ''}
                            onChange={e => setObs(prev => ({ ...prev, [ap.id]: e.target.value }))}
                          />
                        </div>
                        <div className="flex flex-wrap gap-3 justify-end">
                          {/* Entre Negar e Aprovar de propósito: as três saídas
                              são do mesmo momento de decisão, e a do meio é a
                              que o gerente mais vai usar em aula. */}
                          <button
                            onClick={() => devolverParaCorrecao(ap)}
                            disabled={isProcessing}
                            title="O pedido está mal feito: volta para quem abriu, com o seu motivo, e não conta como negado."
                            className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-amber-400 hover:border-amber-400/20 border border-transparent transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            Devolver p/ correção
                          </button>
                          <button
                            onClick={() => handleNegar(ap)}
                            disabled={isProcessing}
                            className="neu-button py-2 px-5 rounded-xl text-sm font-bold text-red-500 hover:border-red-500/20 border border-transparent transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <ThumbsDown size={14} />}
                            Negar
                          </button>
                          <button
                            onClick={() => handleAprovar(ap)}
                            disabled={isProcessing}
                            className="neu-button-accent py-2 px-6 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                          >
                            {isProcessing ? <Loader2 size={14} className="animate-spin text-[#0A0A0A]" /> : <ThumbsUp size={14} />}
                            Aprovar
                          </button>
                        </div>
                        </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      ))}

      {/* Decisões já tomadas — só para a direção. O gerente não desfaz a
          própria decisão: se pudesse, aprovar deixaria de ser um ato.
          A aba rola como UMA página. Antes cada bloco rolava por dentro, com
          altura própria: dois `flex-1` dividindo a sobra e uma `max-h` no meio,
          o que deixava cada lista com espaço para um card. Rolagem dentro de
          rolagem é o mesmo defeito que as abas vieram resolver. */}
      {abaAtiva === 'decididas' && (
        <div className="flex-1 min-h-0 overflow-y-auto main-scrollbar pr-2 pb-6 flex flex-col gap-6">
        <div className="neu-flat rounded-2xl p-5 border border-white/5 flex flex-col shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Decisões já tomadas</p>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            Erro de gerente não precisa travar a aula: devolver desfaz a decisão e o card volta para a
            fila dele com o seu motivo. Excluir é o último recurso — some com o documento e com a
            correspondência dele nas outras telas.
          </p>
          {decididasFiltradas.length === 0 && (
            <p className="text-xs text-gray-600">
              {solicitante === null
                ? 'Nenhuma decisão tomada nesta unidade ainda.'
                : `Nenhuma decisão tomada sobre requisições de ${solicitante}.`}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {decididasFiltradas.slice(0, 15).map(ap => {
              const req = requisicoes.find(r => r.id === ap.requisicao_id) ?? avulsas[ap.requisicao_id];
              const negado = ap.status === 'Negado';
              const indo = devolvendo === ap.id;
              const aberta = decisaoAberta === ap.id;
              return (
                <div key={ap.id} className="neu-pressed rounded-xl">
                <div className="p-3 flex items-center justify-between gap-3">
                  {/* A linha inteira abre a ficha — os botões ficam fora dela,
                      para devolver não abrir junto. Requisição excluída não
                      tem ficha para mostrar. */}
                  <button type="button" disabled={!req}
                    onClick={() => setDecisaoAberta(aberta ? null : ap.id)}
                    title={req ? (aberta ? 'Fechar os detalhes' : 'Ver os detalhes da requisição') : undefined}
                    className="min-w-0 flex-1 text-left flex items-center gap-3 enabled:cursor-pointer group/dec">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-credencial text-gray-500 tracking-wider">
                        {req ? numeroRequisicao(req) : `#${String(ap.requisicao_id).slice(-6).toUpperCase()}`}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${negado
                        ? 'text-red-400 border-red-500/30' : 'text-green-400 border-green-500/30'}`}>
                        {ap.status}
                      </span>
                      {!req && <span className="text-[10px] text-yellow-500/80">requisição excluída — devolver restaura</span>}
                    </div>
                    <p className="text-sm font-semibold text-gray-200 truncate">{req?.item ?? '—'}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      por {ap.aprovador || '—'}
                      {ap.observacao ? ` · ${ap.observacao}` : ''}
                    </p>
                  </div>
                  {req && (
                    <ChevronDown size={16} className={`shrink-0 text-gray-500 group-hover/dec:text-gray-300 transition-transform duration-200 ${aberta ? 'rotate-180' : ''}`} />
                  )}
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => devolver(ap, req)} disabled={indo}
                      title="Devolver para correção" className="action-btn-warning disabled:opacity-50">
                      {indo ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    </button>
                    {isProfessor && (
                      <ExcluirAdmin
                        endpoint="/api/requisicoesview"
                        id={ap.requisicao_id}
                        rotulo={`a requisição ${req ? numeroRequisicao(req) : ''}`.trim()}
                        alternativa="use o botão de devolver ao lado: ela volta para Pendente e o gerente decide de novo."
                        showToast={showToast}
                        onExcluido={() => { reloadDecididas(); reloadReq(); }}
                      />
                    )}
                  </div>
                </div>
                <AnimatePresence>
                  {aberta && req && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="px-3 pb-3 flex flex-col gap-3 border-t border-white/5 pt-3">
                        {/* A decisão primeiro: é o que se veio conferir. A
                            observação aparece inteira — na linha ela é cortada. */}
                        <div className={`p-3 rounded-xl border ${negado ? 'border-red-500/25 bg-red-500/5' : 'border-green-500/25 bg-green-500/5'}`}>
                          <span className={`text-[10px] uppercase tracking-widest font-bold block mb-1 ${negado ? 'text-red-400' : 'text-green-400'}`}>
                            {negado ? 'Negada' : 'Aprovada'}
                            {ap.aprovador ? ` por ${ap.aprovador}` : ''}
                            {ap.created_at ? ` em ${formatDataHoraBR(ap.created_at)}` : ''}
                          </span>
                          <span className="text-xs text-gray-200">
                            {ap.observacao || (negado ? 'Sem motivo registrado.' : 'Sem observação.')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <HistoricoOperacoes entidade="requisicoes" entidadeId={req.id} titulo={`${numeroRequisicao(req)} · ${req.item}`} criadoEm={req.created_at} atualizadoEm={req.updated_at} />
                          <span className="text-[10px] text-gray-500">Histórico desta requisição</span>
                        </div>
                        {/* Onde a compra está agora — aprovar não compra, então
                            a pergunta seguinte é quase sempre "e depois?". */}
                        <FluxoCompra etapa={etapaDaRequisicao(req.status)} />
                        {fichaDaRequisicao(req)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              );
            })}
          </div>
          {decididasFiltradas.length > 15 && (
            <p className="text-[10px] text-gray-600 mt-3">
              Mostrando as 15 decisões mais recentes. As anteriores continuam em Compras → Requisições.
            </p>
          )}
        </div>

        {/* E o outro documento, logo abaixo: quem desfaz uma decisão vem
            procurar a outra no mesmo lugar. Liberação de material não volta —
            o material já saiu da prateleira —, e o bloco explica isso onde a
            pergunta nasce. */}
        <AprovacoesEstoqueBloco showToast={showToast} profile={profile} filial={filial} mostrar="decididas" solicitante={solicitante} />
        </div>
      )}
      </>
      )}
    </motion.div>
  );
};

export const AprovacoesComprasView = ({ showToast, profile }: { showToast: ShowToast; profile: UserProfile }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A decisão sobre uma requisição de compra" />;
  return <AprovacoesComprasViewInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
