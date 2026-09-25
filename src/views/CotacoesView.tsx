import { CondicaoCompra } from '../components/CondicaoCompra';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Save, Check, X, ShoppingBag, MessageSquare, Send, Loader2, Search, GitCompare, Award, RotateCcw, Ban, CornerUpLeft, Pencil, AlertTriangle } from 'lucide-react';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useFetchData, dbInsert, dbUpdate } from '../hooks/useSupabaseData';
import { LoadingSpinner, EmptyState, FormField, NeuButtonAccent, StatusBadge, Pagination, SelecioneUnidade, FilaDeTrabalho, TextoModal, AbaComContador } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { todayBR } from '../lib/dates';
import { useFormValidation, formatBRL, parseBRL, handleMoneyKeyDown, qtdBR } from '../lib/viewUtils';
import { normalizarUnidade, pluralEmbalagem } from '../lib/unidades';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { numeroCotacao, numeroPedido, numeroRequisicao } from '../lib/documentos';
import { ehContratado } from '../lib/naturezaServico';
import { supabase } from '../lib/supabase';
import { notificarSetor } from '../lib/notificar';
import { acompanharReservas, RESERVA_COLUNAS, type ReservaLinha } from '../lib/reservasTrabalho';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { hasAnySetor, hasSetor, isConselheiro } from '../lib/rbac';
import { podeVerModulo } from '../lib/sectorAccess';
import type { UserProfile } from '../hooks/useUserProfile';
import { useConfirm } from '../contexts/ConfirmContext';
import { ExcluirAdmin } from '../components/ExcluirAdmin';
import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import { useFornecedorDesempenho, SeloDesempenho } from '../components/FornecedorDesempenho';
import { useReservaTrabalho } from '../hooks/useReservaTrabalho';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { pedirCadastroDaCotacao } from '../lib/cadastroDaCotacao';

// Status considerados "propostas vivas" para contagem de concorrentes.
// Cancelado/Negado são histórico — aparecem na comparação mas não contam.
// 'Em correção' (migr. 467) conta: a proposta voltou para quem a cadastrou,
// mas continua de pé — tratá-la como morta faria a requisição reaparecer como
// "sem nenhuma cotação" e o aluno cotaria de novo em cima da mesma coisa.
const STATUS_VIVOS = new Set(['Aguardando Financeiro', 'Em correção', 'Aprovado']);

// `date` do Postgres chega como 'YYYY-MM-DD' puro, sem hora: `new Date()` nele
// assume UTC e volta um dia no fuso do Acre. Vira dd/mm no texto, e a
// comparação entre prazo e necessidade é feita na string ISO, que já ordena.
const dataBR = (iso?: string | null) =>
  iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';

// Proposta vencida: comparação na string ISO, que já ordena (mesma razão do
// dataBR acima). O Financeiro não aprova depois desta data (migr. 583), então
// ela precisa saltar aos olhos antes do clique, não depois do erro.
const propostaVencida = (validade?: string | null): boolean =>
  !!validade && String(validade).slice(0, 10) < todayBR();

// MIGR 584. As condições que o banco aceita (CHECK em `cotacoes`), na ordem
// em que um comprador pensa: da que aperta o caixa para a que o alivia. É o
// mesmo vocabulário do orçamento de venda, visto do lado de quem compra — e é
// idêntico nas três lojas, porque comprar é processo da rede.
const CONDICOES_PAGAMENTO = ['À vista', '15 dias', '30 dias', '30/60', '30/60/90'] as const;

// Quantos títulos cada condição abre. Serve só para o aviso da tela; quem
// gera de verdade é `condicao_pagamento_dias` no banco.
const parcelasDaCondicao = (c: string): number =>
  c === '30/60' ? 2 : c === '30/60/90' ? 3 : 1;

// Data ISO daqui a N dias, no fuso da operação. Mesma disciplina do dataBR
// acima: a aritmética é feita em UTC ao meio-dia para o dia não escorregar.
const emDias = (n: number): string => {
  const [y, m, d] = todayBR().split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  base.setUTCDate(base.getUTCDate() + n);
  return base.toISOString().slice(0, 10);
};

// Preço unitário é RESULTADO, não entrada — e nem sempre cabe em centavos:
// fardo de 12 a R$ 100,00 dá 8,3333 por unidade. Mostrar 8,33 e depois
// reconstruir o total a partir desse número é como a tela chegava a dizer
// "8,33 × 60 = 500,00", conta que não fecha por R$ 0,20. Aqui ele só é
// exibido, com as casas que a divisão pedir (2 quando fecha, 4 quando não),
// e nunca volta para o total.
const precoUnitario = (total: number, qtd: number): string => {
  if (!(qtd > 0) || !Number.isFinite(total) || total <= 0) return '';
  const v = total / qtd;
  const exato = Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
  const casas = exato ? 2 : 4;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
};

// Validade padrão da proposta. 15 dias é o costume do mercado para cotação de
// material — e o ponto pedagógico é que a data nasce preenchida em vez de
// virar campo em branco que ninguém entende para que serve.
const VALIDADE_PADRAO_DIAS = 15;

// Congela as opções de um <select> enquanto ele está aberto.
//
// Esta tela ouve realtime de cinco tabelas e a turma inteira trabalha nela ao
// mesmo tempo: cada proposta salva por um colega e cada batimento de reserva
// (60s por aluno) provoca um re-render. Trocar o conteúdo dos <option> com o
// popup nativo aberto faz o Chrome repintar a lista embaixo do cursor.
//
// O congelamento é por REF, não por estado, de propósito: guardar num useState
// obrigaria um re-render no mousedown — isto é, no exato instante em que o
// popup está abrindo —, que é justamente o que se quer evitar. A ref não
// dispara render nenhum; ela só faz os renders que aconteceriam de qualquer
// jeito continuarem desenhando a lista que a pessoa está vendo.
function useOpcoesEstaveis<T>(valor: T) {
  const congelado = useRef<T | null>(null);
  const [, redesenhar] = useState(0);
  // Só congela se ainda não estiver congelado: tecla de navegação dentro do
  // popup aberto não pode re-fotografar a lista com dado novo.
  const congelar = () => { if (congelado.current === null) congelado.current = valor; };
  // Soltar pede UM render — com o popup já fechado, que é quando pintar de
  // novo não custa nada. Sem ele o DOM ficaria com a foto antiga até algum
  // outro estado mudar, e a lista voltaria desatualizada na próxima abertura.
  const soltar = () => {
    if (congelado.current === null) return;
    congelado.current = null;
    redesenhar(n => n + 1);
  };
  return {
    opcoes: congelado.current ?? valor,
    // Espalhar no <select>; o onChange do campo chama `soltar()`.
    handlers: { onMouseDown: congelar, onKeyDown: congelar, onBlur: soltar },
    soltar,
  };
}

// `mode` existe pelo mesmo motivo que existe em OrcamentosView: a tela é
// alcançável por duas portas de menu — Compras → Cotações e Financeiro →
// Aprovações de Cotação — e sem o modo as duas abriam exatamente a mesma
// coisa. Para colaborador passava despercebido (cada setor só enxerga a sua
// porta), mas admin, CEO e gerente veem as duas entradas e caíam no mesmo
// lugar, com o menu prometendo ferramentas diferentes.
//
// 'financeiro' é a fila de decisão: só o que está aguardando o Financeiro, sem
// o formulário de coleta. 'compras' (default) é a bancada de trabalho inteira.
const CotacoesViewInner = ({ showToast, profile, filial, mode, onNavigate }: { showToast: any; profile: UserProfile; filial: FilialOp; mode?: 'compras' | 'financeiro'; onNavigate?: (view: string) => void }) => {
  const modoFinanceiro = mode === 'financeiro';
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => { setPage(0); }, [debouncedSearch]);
  // Busca é feita client-side em `enriched` (nome do produto vem de requisicoes.item,
  // que é tabela diferente). useFetchData só sabe fazer ilike em colunas da própria
  // tabela, então qualquer searchColumns aqui filtra a coisa errada.
  // Realtime nas três listas. Esta tela é o encontro de dois setores: Compras
  // digita a proposta e o Financeiro decide, cada um na sua máquina. Sem
  // realtime, o Financeiro só via a cotação depois de recarregar — e a
  // requisição recém-aprovada pelo gerente não entrava no dropdown de nova
  // cotação, o que lia como "o sistema perdeu meu pedido".
  const { data, setData, isLoading, totalCount, reload } = useFetchData<any>(
    '/api/cotacoesview', { filial }, true,
    { page }
  );
  const { data: requisicoes, setData: setRequisicoes, isLoading: requisicoesCarregando } = useFetchData<any>('/api/requisicoesview', { filial }, true);
  // `isLoading` importa aqui: durante o carregamento a lista chega vazia, e
  // sem distinguir os dois casos a tela anunciaria "nenhum fornecedor
  // cadastrado" por um instante toda vez que abrisse.
  const { data: fornecedores, isLoading: fornecedoresCarregando } = useFetchData<any>('/api/crmview-fornecedores', { filial });
  // Catálogo da unidade: é aqui que o comprador amarra o texto livre da
  // requisição a um item de verdade (migr. 480). Realtime porque o produto
  // pode estar sendo cadastrado noutra tela, agora, exatamente para este
  // pedido sair.
  const { data: produtos, isLoading: produtosCarregando } = useFetchData<any>('/api/produtosview', { filial }, true);
  // Patrimônio fica fora: bem de uso não entra pelo pedido de compra (migr.
  // 515), então oferecê-lo no select ou como sugestão é oferecer a recusa.
  const produtosOrdenados = useMemo(
    () => produtos.filter((p: any) => p.tipo !== 'patrimonio').sort((a: any, b: any) =>
      String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [produtos],
  );
  // Catálogo de SERVIÇOS (migr. 499). Serviço é a outra categoria de item do
  // pedido — manutenção, frete, licença, dedetização —, e sem ela a requisição
  // de unidade SV chegava aqui sem saída: o select de produto não tinha o que
  // mostrar e o único caminho era cadastrar "Manutenção do ar" como mercadoria.
  //
  // Sem filtro de filial no fetch, de propósito: `servicos.filial` é NULÁVEL, e
  // serviço sem unidade vale para todas (o que a holding contrata). Um `.eq`
  // aqui sumiria justamente com esses — o filtro é feito abaixo, com a mesma
  // régua que a RPC aplica.
  // Escopo de unidade: `auth_pode_filial()` deixa admin, CEO e conselheiro
  // passarem em todas as filiais, então a RLS sozinha não basta — quem opera
  // dentro de uma unidade via catálogo/cadastro de outra.
  const { data: servicos } = useFetchData<any>('/api/servicosview', filial ? { filial } : undefined, true);
  const servicosOrdenados = useMemo(
    () => servicos
      // Só o CONTRATADO (migr. 516). O catálogo de venda mora na mesma tabela,
      // e sem este filtro quem precisa comprar dedetização abre a lista e vê
      // "Troca de tela — R$ 150", que é o que a loja vende. A RPC recusa de
      // qualquer jeito; aqui é não oferecer o que vai ser recusado.
      .filter((s: any) => ehContratado(s.natureza))
      .filter((s: any) => (s.filial == null || s.filial === filial)
                       && (s.status ?? 'Ativo') !== 'Inativo')
      .sort((a: any, b: any) =>
        String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR')),
    [servicos, filial],
  );

  // Pontualidade por fornecedor (migr. 421). Vive ao lado do preço porque é
  // aqui que a escolha é feita — no relatório, chegaria tarde.
  const { desempenho, desempenhoDisponivel } = useFornecedorDesempenho(filial);
  // Lista SEM paginação, só para agrupar propostas concorrentes por requisição.
  // `data` traz 50 linhas; usá-la para isso fazia o contador de propostas, o
  // modal de comparação e o cancelamento automático ignorarem toda proposta
  // que tivesse caído na página seguinte.
  const { data: todasCotacoes, setData: setTodasCotacoes, isLoading: todasCotacoesCarregando } = useFetchData<any>('/api/cotacoesview', { filial }, true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  // Feedback do Financeiro é parágrafo, não frase: modal de leitura em vez do
  // alert() do navegador, que vinha cinza e com o domínio no título.
  const [feedbackAberto, setFeedbackAberto] = useState<string | null>(null);
  const [reabrindoCot, setReabrindoCot] = useState<string | null>(null);
  const podeReabrirDoc = profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile);
  // form.fornecedor_tipo permite os 2 selects (PF/PJ) compartilharem fornecedor_id
  // mantendo apenas um ativo de cada vez. Valores espelham pessoa_tipo do CRM.
  const [form, setForm] = useState({ requisicao_id: '', fornecedor_id: '', fornecedor_tipo: '' as '' | 'Empresa' | 'Pessoa Física' });
  const [extras, setExtras] = useState({ valor_fonte: '', valor_total: '', prazo_entrega: '', validade: '', marca: '', observacao: '', condicao_pagamento: 'À vista' });
  // `useFormValidation` só cobre `form` (requisição e fornecedor) — era por
  // isso que valor e validade passavam em branco. Estes campos têm régua
  // própria: valor precisa ser positivo, validade precisa existir e estar viva.
  const [errosExtras, setErrosExtras] = useState<{ valor_total?: string; validade?: string }>({});
  const { errors, validate, clearError, setErrors } = useFormValidation(form);

  // Trava de trabalho (migr. 537) — chave é requisição+fornecedor, não a
  // requisição inteira: dois alunos cotando fornecedores DIFERENTES para o
  // mesmo item seguem em paralelo (é a comparação de preço que a tela existe
  // para fazer); a chave composta só impede os dois cotando o MESMO
  // fornecedor, que é trabalho repetido.
  const chaveReserva = form.requisicao_id && form.fornecedor_id
    ? `${form.requisicao_id}:${form.fornecedor_id}` : null;
  const reserva = useReservaTrabalho('cotacao', chaveReserva, filial);

  // Quem mais está cotando cada fornecedor NESTA requisição — para travar as
  // opções do select antes do clique, não só depois. Consulta simples (não é
  // o hook de cima, que só cuida da chave ATIVA) e realtime por requisição.
  const [reservasDaReq, setReservasDaReq] = useState<Record<string, { usuario_id: string; usuario_nome: string }>>({});
  useEffect(() => {
    if (!supabase || !form.requisicao_id) { setReservasDaReq({}); return; }
    const prefixo = `${form.requisicao_id}:`;
    // Evento, vencimento e janela de releitura moram em `acompanharReservas`:
    // renovação de colega não relê, e o cadeado vencido some pela conferência
    // local do prazo, sem F5.
    const acompanhamento = acompanharReservas<ReservaLinha>({
      nome: 'cotacao_reservas',
      ler: async () => {
        // `expira_em > agora` é obrigatório: a reserva morre pelo relógio, e
        // relógio não emite evento. Sem este filtro, quem fechou o notebook
        // deixaria o fornecedor travado na tela dos colegas para sempre — e
        // travado é mentira, porque o banco liberaria a reserva na hora.
        const { data, error } = await supabase!.from('trabalho_reservas')
          .select(RESERVA_COLUNAS)
          .eq('escopo', 'cotacao')
          .like('chave', `${prefixo}%`)
          .gt('expira_em', new Date().toISOString());
        return error ? null : (data ?? []) as ReservaLinha[];
      },
      relevante: r => r.escopo === 'cotacao' && String(r.chave ?? '').startsWith(prefixo),
      aoMudar: linhas => {
        const mapa: Record<string, { usuario_id: string; usuario_nome: string }> = {};
        for (const r of linhas) {
          mapa[String(r.chave).slice(prefixo.length)] = { usuario_id: r.usuario_id, usuario_nome: r.usuario_nome };
        }
        setReservasDaReq(mapa);
      },
    });
    return () => acompanhamento.parar();
  }, [form.requisicao_id]);

  // A requisição do formulário aberto. O `data_necessidade` dela é o alvo do
  // prazo que o fornecedor promete — sem ele na tela, a data da proposta era
  // digitada no escuro e lia como repetição do campo da requisição.
  const reqSelecionada = useMemo(
    () => requisicoes.find((r: any) => r.id === form.requisicao_id),
    [requisicoes, form.requisicao_id],
  );
  // Quantidade da requisição — é ela que transforma preço unitário em proposta.
  // O fornecedor cota "R$ 4,50 a unidade"; quem digitava só o total fazia a
  // conta de cabeça e errava (e a comparação entre propostas de quantidades
  // iguais deixava de bater). Sem requisição escolhida ainda não há por quanto
  // multiplicar: aí o total volta a ser digitado direto.
  const qtdReq = Number(reqSelecionada?.qtd ?? 0);
  const temQtd = Number.isFinite(qtdReq) && qtdReq > 0;
  const unidadeReq = normalizarUnidade(reqSelecionada?.unidade);

  // "3 CAIXAS" ao lado da quantidade em unidade — sem isso a lista mostrava
  // "Qtd: 600" e quem cota não sabia se eram 600 unidades soltas ou 20 fardos.
  const rotuloQtdReq = (r: any): string => {
    const qtdE = Number(r?.qtd_embalagens ?? 0);
    const nome = String(r?.embalagem_nome ?? '').trim();
    if (qtdE > 0 && nome) {
      return `${qtdBR(qtdE)} ${pluralEmbalagem(nome, qtdE)} — ${qtdBR(r.qtd)} ${normalizarUnidade(r.unidade)}`;
    }
    return `Qtd: ${r.qtd}`;
  };

  // MIGR 589: a requisição pedida em fardo carrega em QUE fardo foi pedida.
  //
  // É aqui que a embalagem mais importa, e onde ela era mais invisível: o
  // fornecedor cota "R$ 135,00 o fardo", o comprador digitava 135 num campo
  // que significa preço unitário, e a comparação entre propostas passava a
  // comparar fardo com unidade — dois preços que diferem por 30×. O custo
  // carimbado na venda (DRE, migr. 425) vinha do mesmo número.
  //
  // O fator é o da REQUISIÇÃO, não o do cadastro: se o produto mudou de fardo
  // desde então, o que está sendo cotado é o que foi pedido.
  const embReq = useMemo(() => {
    const nome  = String(reqSelecionada?.embalagem_nome ?? '').trim().toUpperCase();
    const fator = Number(reqSelecionada?.embalagem_fator ?? 0);
    const qtdE  = Number(reqSelecionada?.qtd_embalagens ?? 0);
    return nome !== '' && fator > 1 && qtdE > 0 ? { nome, fator, qtd: qtdE } : null;
  }, [reqSelecionada]);

  // UMA fonte de preço por proposta — a medida em que o fornecedor dá o número.
  //
  // Antes eram três campos editáveis que se reescreviam a cada tecla, e isso
  // não fechava: `formatBRL` arredonda para o centavo, então fardo de 12 a
  // R$ 100,00 virava unitário 8,33 (real 8,3333). O total nascia certo em
  // R$ 500,00 vindo do fardo, mas ENCOSTAR no campo de unitário reescrevia o
  // total para 8,33 × 60 = 499,80 e ninguém era avisado. O custo errado seguia
  // para o pedido e para o DRE (migr. 425).
  //
  // Agora só a fonte é digitada; o total sai da multiplicação, e o unitário é
  // resultado exibido, nunca entrada. Com embalagem fechada (migr. 589) a fonte
  // é o preço do fardo, que é como o fornecedor fala ao telefone; sem ela, é o
  // preço da unidade. Sem requisição escolhida não há por quanto multiplicar —
  // aí o total volta a ser digitado direto.
  const fonte = useMemo(() => {
    if (embReq) return { label: `Valor por ${embReq.nome} (R$)`, mult: embReq.qtd };
    if (temQtd) return { label: `Valor Unitário (R$ / ${unidadeReq})`, mult: qtdReq };
    return null;
  }, [embReq, temQtd, qtdReq, unidadeReq]);

  const setFonte = (v: string) => setExtras(x => {
    const f = formatBRL(v);
    return { ...x, valor_fonte: f, valor_total: fonte ? formatBRL(parseBRL(f) * fonte.mult) : x.valor_total };
  });
  // Total continua editável porque frete e desconto fechado entram nele — mas
  // digitar aqui não volta para a fonte: o preço de tabela do fornecedor
  // continua sendo o que ele disse, e a diferença aparece anunciada.
  const setTotal = (v: string) => setExtras(x => ({ ...x, valor_total: formatBRL(v) }));

  const totalBase = fonte ? parseBRL(extras.valor_fonte) * fonte.mult : 0;
  // Tolerância = meio centavo por multiplicando, que é o arredondamento máximo
  // que a própria fonte carrega. Sem isso, reabrir uma proposta cuja divisão
  // não fecha exata acenderia o aviso de "ajustado à mão" por 1 centavo.
  const ajusteTotal = totalBase > 0 ? parseBRL(extras.valor_total) - totalBase : 0;
  const temAjuste = !!fonte && totalBase > 0 && Math.abs(ajusteTotal) > fonte.mult * 0.005 + 1e-9;

  // MIGR 582: a requisição eventual agora diz a marca pedida. Ela entra
  // preenchida na proposta porque o caso comum é cotar o que foi pedido — e
  // continua editável, porque o fornecedor pode oferecer outra e é isso que a
  // comparação entre propostas precisa mostrar.
  useEffect(() => {
    const pedida = String(reqSelecionada?.marca ?? '').trim();
    if (!pedida) return;
    setExtras(x => (x.marca ? x : { ...x, marca: pedida }));
  }, [reqSelecionada]);

  // Trocar de requisição troca a quantidade E a medida: "R$ 135,00" que era o
  // preço de um fardo de 30 não é preço de nada na requisição seguinte. Antes
  // o total era recalculado e o preço por embalagem ficava parado, com o
  // número da requisição anterior sob o rótulo da nova. Preço de proposta não
  // se aproveita de uma requisição para outra — limpa.
  useEffect(() => {
    setExtras(x => (x.valor_fonte || x.valor_total ? { ...x, valor_fonte: '', valor_total: '' } : x));
  }, [form.requisicao_id]);

  // Prazo prometido depois da data em que o item é necessário: não é erro de
  // preenchimento (o fornecedor pode mesmo não dar conta), é informação de
  // decisão — o preço menor não compensa a entrega atrasada.
  const prazoEstoura = !!(reqSelecionada?.data_necessidade && extras.prazo_entrega
    && extras.prazo_entrega > reqSelecionada.data_necessidade);

  // Fornecedor habitual do produto (migr. 488) entra pré-selecionado: o cadastro
  // deixou de exigir a escolha, mas quando ela existe não faz sentido pedir de
  // novo. Continua trocável — cotar é justamente comparar.
  useEffect(() => {
    if (!form.requisicao_id || form.fornecedor_id) return;
    const prodId = reqSelecionada?.produto_id;
    if (!prodId) return;
    const sugerido = produtos.find((p: any) => p.id === prodId)?.fornecedor_id;
    if (!sugerido) return;
    const forn = fornecedores.find((f: any) => f.id === sugerido);
    if (!forn) return;
    setForm(f => ({
      ...f,
      fornecedor_id: forn.id,
      fornecedor_tipo: (forn.pessoa_tipo ?? 'Empresa') === 'Pessoa Física' ? 'Pessoa Física' : 'Empresa',
    }));
  }, [form.requisicao_id, form.fornecedor_id, reqSelecionada, produtos, fornecedores]);

  // Marca da proposta (migr. 526). Só na compra EVENTUAL: ali o produto ainda
  // não existe e a marca é o que o fornecedor está oferecendo — dois
  // fornecedores podem propor marcas diferentes para o mesmo pedido, e é isso
  // que a comparação de propostas precisa mostrar. Na reposição a marca é do
  // produto do catálogo, e o gatilho do banco zera este campo.
  // `!!reqSelecionada` e não só `form.requisicao_id`: entre escolher a
  // requisição e a lista chegar, `reqSelecionada` é undefined — e tratar isso
  // como eventual mostraria o campo de marca numa reposição, para o gatilho
  // apagar o que foi digitado.
  const ehEventual = !!reqSelecionada && !reqSelecionada.produto_id;
  const produtoDaReq = useMemo(
    () => produtos.find((p: any) => p.id === reqSelecionada?.produto_id),
    [produtos, reqSelecionada]);
  // Sugestão a partir do que a unidade já cadastrou — não fecha a lista (nem
  // toda compra eventual é de marca que já existe), só evita "Foxton" virar
  // "foxton" na segunda vez.
  const marcasConhecidas = useMemo(() => {
    const set = new Set<string>();
    for (const p of produtos as any[]) {
      const m = String(p?.marca ?? '').trim();
      if (m) set.add(m);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos]);

  // Decisão Financeiro: modal de aprovar/reprovar/devolver.
  const [decisao, setDecisao] = useState<{ cot: any; tipo: 'aprovar' | 'reprovar' | 'devolver' } | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [decidindo, setDecidindo] = useState(false);

  // Correção (migr. 467): quem cadastrou arruma o que o decisor apontou.
  // Fornecedor e requisição ficam de fora — trocar fornecedor é outra
  // proposta, não correção desta.
  const [correcao, setCorrecao] = useState<any | null>(null);
  const [correcaoForm, setCorrecaoForm] = useState({ valor_fonte: '', valor_total: '', prazo_entrega: '', validade: '', marca: '', observacao: '', condicao_pagamento: 'À vista' });

  // Mesma régua do formulário de nova cotação: a quantidade é da requisição, e
  // é ela que liga unitário e total. Aqui a requisição não muda (trocar de
  // requisição seria outra proposta), então a quantidade é fixa enquanto o
  // modal está aberto. `req` vem do enriched; a busca na lista é a rede para a
  // proposta cujo join ainda não chegou.
  const qtdCorrecao = useMemo(() => {
    if (!correcao) return 0;
    const req = correcao.req ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id);
    const n = Number(req?.qtd ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [correcao, requisicoes]);
  // O item é da REQUISIÇÃO, não da proposta. Em 23/09 a gerente devolveu a
  // cotação por "erro na especificação do gênero do produto", a aluna escreveu
  // o nome certo na Observação (o único campo de texto do modal) e a cotação
  // foi aprovada com o item antigo — na requisição, na cotação e na sugestão
  // de cadastro. O modal passa a mostrar o item e dizer onde ele se corrige.
  const reqCorrecao = useMemo(() => {
    if (!correcao) return null;
    return correcao.req ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id) ?? null;
  }, [correcao, requisicoes]);
  const unidadeCorrecao = useMemo(() => {
    if (!correcao) return '';
    const req = correcao.req ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id);
    return normalizarUnidade(req?.unidade);
  }, [correcao, requisicoes]);
  // Migr. 589: mesma leitura do formulário de nova proposta. Corrigir preço de
  // fardo dividindo de cabeça é onde o erro voltaria pela porta dos fundos.
  const embCorrecao = useMemo(() => {
    if (!correcao) return null;
    const req = correcao.req ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id);
    const nome  = String(req?.embalagem_nome ?? '').trim().toUpperCase();
    const fator = Number(req?.embalagem_fator ?? 0);
    const qtdE  = Number(req?.qtd_embalagens ?? 0);
    return nome !== '' && fator > 1 && qtdE > 0 ? { nome, fator, qtd: qtdE } : null;
  }, [correcao, requisicoes]);

  // Mesma régua do formulário de nova proposta: uma fonte só. Aqui a
  // assimetria era pior — `setCorrecaoTotal` atualizava o unitário e deixava o
  // preço por embalagem parado na tela, de modo que corrigir o total exibia um
  // preço de fardo que não correspondia a proposta nenhuma.
  const fonteCorrecao = useMemo(() => {
    if (embCorrecao) return { label: `Valor por ${embCorrecao.nome} (R$)`, mult: embCorrecao.qtd };
    if (qtdCorrecao > 0) return { label: `Valor Unitário (R$ / ${unidadeCorrecao})`, mult: qtdCorrecao };
    return null;
  }, [embCorrecao, qtdCorrecao, unidadeCorrecao]);

  const setCorrecaoFonte = (v: string) => setCorrecaoForm(x => {
    const f = formatBRL(v);
    return { ...x, valor_fonte: f, valor_total: fonteCorrecao ? formatBRL(parseBRL(f) * fonteCorrecao.mult) : x.valor_total };
  });
  const setCorrecaoTotal = (v: string) => setCorrecaoForm(x => ({ ...x, valor_total: formatBRL(v) }));

  const totalBaseCorrecao = fonteCorrecao ? parseBRL(correcaoForm.valor_fonte) * fonteCorrecao.mult : 0;
  const ajusteCorrecao = totalBaseCorrecao > 0 ? parseBRL(correcaoForm.valor_total) - totalBaseCorrecao : 0;
  const temAjusteCorrecao = !!fonteCorrecao && totalBaseCorrecao > 0
    && Math.abs(ajusteCorrecao) > fonteCorrecao.mult * 0.005 + 1e-9;
  const [reenviando, setReenviando] = useState(false);

  // RBAC: Compras (e Logística, que opera junto no módulo de Compras — igual
  // recebimentos/movimentações) cria/envia/gera pedido; Financeiro / gerente
  // da filial / admin/CEO aprova.
  // Gerente vê/faz tudo da própria filial — inclui aprovar cotação —, e o
  // RLS já libera via auth_gerente_da (migr. 20260713i). Antes o frontend
  // exigia gerente COM setor financeiro pra decidir, o que travava gerentes
  // "puros" que a régua canônica manda liberar.
  const isCompras    = hasAnySetor(profile, 'compras', 'logistica') || profile.role === 'gerente';
  const isFinanceiro = hasSetor(profile, 'financeiro');
  const podeDecidir  =
    profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile) ||
    profile.role === 'gerente' || isFinanceiro;

  // Alçada de aprovação por valor (migr. 204). Buscada 1x por filial.
  // Regra: valor <= limite → Financeiro decide; valor > limite → Gerente
  // da filial decide. Admin/CEO sempre podem (override total).
  const [alcadaLimite, setAlcadaLimite] = useState<number | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('alcadas_compra')
      .select('valor_limite_financeiro')
      .eq('filial', filial)
      .eq('ativo', true)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (cancelled) return;
        if (error) {
          // Migração 204 pendente → degrada pro fluxo antigo (todos podem).
          console.warn('[Cotacoes] alçada indisponível:', error.message);
          setAlcadaLimite(null);
          return;
        }
        setAlcadaLimite(row ? Number(row.valor_limite_financeiro ?? 0) : null);
      });
    return () => { cancelled = true; };
  }, [filial]);

  // Quem decide esta cotação. REGRA ÚNICA: o valor manda.
  //
  // Antes havia dois sistemas em paralelo — a alçada por valor e uma régua por
  // role — com um terceiro caminho de fallback quando `alcadas_compra` não
  // respondia (`return podeDecidir`, que liberava praticamente todo mundo).
  // Três respostas possíveis para "quem aprova isto?" é o que faz um controle
  // deixar de ser controle. Agora: alçada não configurada = limite infinito =
  // Financeiro decide. Um caminho só.
  const limiteEfetivo = alcadaLimite ?? Number.POSITIVE_INFINITY;

  const podeDecidirCotacao = (cot: any): boolean => {
    // Admin/CEO/conselheiro: override total. É a saída quando não há outro
    // aprovador possível na filial.
    if (profile.role === 'admin' || profile.role === 'ceo' || isConselheiro(profile)) return true;
    // Segregação de funções: quem cadastrou a proposta não a aprova.
    if (cot.criado_por && cot.criado_por === profile.id) return false;
    return Number(cot.valor_total ?? 0) <= limiteEfetivo
      ? isFinanceiro               // dentro da alçada → Financeiro
      : profile.role === 'gerente'; // acima da alçada → Gerente da filial
  };

  // Quem corrige a proposta devolvida: quem a cadastrou, ou Compras/Logística
  // da filial (o colaborador pode ter sido desligado no meio). Mesma régua da
  // RPC `reenviar_cotacao_corrigida` — o guard de verdade está lá.
  const podeCorrigir = (cot: any): boolean =>
    cot.criado_por === profile.id || hasAnySetor(profile, 'compras', 'logistica');

  const alcadaLabel = (cot: any): { label: string; color: string } => (
    Number(cot.valor_total ?? 0) <= limiteEfetivo
      ? { label: 'Financeiro',  color: 'text-cyan-300 border-cyan-400/20' }
      : { label: 'Gerente/CEO', color: 'text-amber-300 border-amber-400/20' }
  );

  // IDs de cotações que já têm pedido gerado — é o que esconde o botão
  // "Gerar Pedido" da linha. Precisa dizer EXATAMENTE o que a RPC diz, e
  // precisa acompanhar o banco em tempo real:
  //
  //  • Filtra igual à RPC (`ativo AND status <> 'Cancelado'`). Sem o `neq`,
  //    pedido cancelado escondia o botão para sempre — e cancelar existe
  //    justamente para poder recomeçar a compra (migr. 544).
  //  • Escopo de filial explícito: `auth_pode_filial` deixa admin/CEO passar
  //    em todas as unidades, então sem o `.eq` a lista viria da rede inteira.
  //  • ERRO NÃO ZERA A LISTA. Antes, qualquer falha na leitura caía em
  //    `rows ?? []` e o conjunto virava vazio — ou seja, TODA cotação aprovada
  //    voltava a exibir "Gerar Pedido", e o aluno só descobria clicando.
  const [cotacoesComPedido, setCotacoesComPedido] = useState<Set<string>>(new Set());
  // Antes da primeira leitura o conjunto vazio diz "nenhuma tem pedido" — e o
  // painel de prontas mostraria, por um instante, aprovadas já atendidas.
  const [pedidosLidos, setPedidosLidos] = useState(false);
  const carregarCotacoesComPedido = useCallback(async () => {
    if (!supabase) return;
    const { data: rows, error } = await supabase
      .from('pedidos')
      .select('cotacao_id')
      .eq('filial', filial)
      .eq('ativo', true)
      .neq('status', 'Cancelado');
    if (error) {
      console.warn('[Cotacoes] não consegui ler os pedidos já gerados:', error.message);
      return;
    }
    setPedidosLidos(true);
    setCotacoesComPedido(new Set<string>(
      (rows ?? [])
        .map((p: any) => p.cotacao_id)
        .filter((id: any): id is string => Boolean(id))
    ));
  }, [filial]);

  useEffect(() => { carregarCotacoesComPedido(); }, [carregarCotacoesComPedido, data]);

  // Gerar pedido não mexe em `cotacoes`, então a lista da turma inteira ficava
  // congelada no que era verdade quando a página abriu: o colega gerava o
  // pedido às 20:59 e a tela dos outros seguia oferecendo "Gerar Pedido" da
  // mesma cotação — o clique só devolvia "Esta cotação já tem pedido gerado".
  // `pedidos` está na publicação de realtime; é ele que tem de avisar.
  //
  // Nome de canal único por instância: a tela vive em dois modos (Compras e
  // Financeiro) e `supabase.channel(nome)` devolve o canal já assinado quando
  // o nome se repete — o segundo `.on()` estoura e o realtime morre calado.
  useEffect(() => {
    // A releitura na reconexão do websocket (ponto cego: o que mudou com o
    // socket fora não é reenviado, e sem ela quem fechou a tampa do notebook
    // volta com o botão de um pedido que já existe) agora vem do
    // `assinarRealtime`, junto com a janela sorteada.
    return assinarRealtime({
      nome: 'cotacoes-pedidos',
      alvos: ['pedidos'],
      aoMudar: () => { carregarCotacoesComPedido(); },
    });
  }, [carregarCotacoesComPedido]);

  const requisicoesAprovadas = useMemo(
    () => requisicoes.filter((r: any) => r.status === 'Aprovado'),
    [requisicoes]);

  // O que está parado esperando alguém desta tela. Conta sobre `todasCotacoes`
  // (sem paginação): trabalho na página 2 é trabalho igual, e um contador que
  // só enxerga a página 1 mente para menos.
  const aguardandoFinanceiro = todasCotacoes.filter((c: any) => c.status === 'Aguardando Financeiro').length;
  const aprovadasSemPedido = todasCotacoes.filter(
    (c: any) => c.status === 'Aprovado' && !cotacoesComPedido.has(c.id)).length;
  // Requisição aprovada segue 'Aprovado' até virar pedido, então ter cotação
  // viva não a tira da lista — contar todas inflaria a fila com trabalho já
  // feito. Só entra quem ainda não recebeu nenhuma proposta em pé.
  const comCotacaoViva = new Set(
    todasCotacoes
      .filter((c: any) => STATUS_VIVOS.has(c.status))
      .map((c: any) => c.requisicao_id));
  const semNenhumaCotacao = requisicoesAprovadas.filter((r: any) => !comCotacaoViva.has(r.id)).length;
  // Devolvida para correção é trabalho parado na mão de Compras — sem esta
  // linha a proposta sai da fila do Financeiro e não entra em fila nenhuma.
  const emCorrecao = todasCotacoes.filter((c: any) => c.status === 'Em correção').length;
  const filaDaTela = modoFinanceiro
    ? [{ label: 'cotação(ões) aguardando sua decisão', count: aguardandoFinanceiro, hint: 'aprovar libera Compras a gerar o pedido' }]
    : [
        { label: 'requisição(ões) aprovada(s) sem cotação', count: semNenhumaCotacao, hint: 'use "Nova cotação" para pedir preço ao fornecedor' },
        { label: 'cotação(ões) devolvida(s) para correção', count: emCorrecao, hint: 'clique em "Corrigir" na linha para ajustar e reenviar' },
        { label: 'cotação(ões) aprovada(s) sem pedido', count: aprovadasSemPedido, hint: 'estão na aba "Gerar pedidos"' },
      ];

  // Requisições aprovadas da filial selecionada, ordenadas por item.
  const requisicoesAprovadaOrdenadas = useMemo(() =>
    [...requisicoesAprovadas].sort((a, b) => String(a.item ?? '').localeCompare(String(b.item ?? ''), 'pt-BR', { sensitivity: 'base' })),
    [requisicoesAprovadas]
  );

  // Fornecedores divididos em PJ / PF, cada lista agrupada por filial.
  // CRMView grava pessoa_tipo como 'Empresa' / 'Pessoa Física' (não 'PJ'/'PF') —
  // filtramos pelos valores reais do banco e tratamos NULL como Empresa.
  const agruparFornecedoresPorFilial = (tipo: 'Empresa' | 'Pessoa Física') => {
    const filtrados = fornecedores.filter((f: any) => (f.pessoa_tipo ?? 'Empresa') === tipo);
    return groupCadastrosParaSelect(filtrados).map(g => ({
      // groupCadastrosParaSelect retorna label "Empresa — TechMax". Aqui só queremos
      // a filial (pessoa_tipo já está separada na nossa caixa).
      label: g.label.replace(/^(Empresa|Pessoa Física)\s*—\s*/, ''),
      items: g.items,
    }));
  };
  const fornecedoresPJ = useMemo(() => agruparFornecedoresPorFilial('Empresa'), [fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps
  const fornecedoresPF = useMemo(() => agruparFornecedoresPorFilial('Pessoa Física'), [fornecedores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cotação é preço DE ALGUÉM: sem fornecedor na unidade os dois selects
  // abrem vazios e não há como salvar. Antes a tela deixava o aluno preencher
  // requisição, itens e valores para só então travar na validação, sem dizer
  // o que estava faltando nem onde resolver.
  const semFornecedor = !fornecedoresCarregando && fornecedores.length === 0;
  const temPJ = fornecedoresPJ.some(g => g.items.length > 0);
  const temPF = fornecedoresPF.some(g => g.items.length > 0);
  // O atalho só é oferecido a quem tem o módulo Cadastros no menu — mandar
  // para uma view fora da régua abriria a tela negada. As duas condições são
  // separadas de propósito: sem o módulo a mensagem manda pedir à Logística,
  // e não faria sentido dizer isso a quem TEM acesso e só está numa rota que
  // não passou `onNavigate`.
  const temAcessoCadastros = podeVerModulo(profile, 'cadastros');
  const podeCadastrarFornecedor = temAcessoCadastros && !!onNavigate;
  const irParaFornecedores = () => onNavigate?.('cadastros-fornecedores');

  const enriched = data.map((c: any) => ({
    ...c,
    req: requisicoes.find((r: any) => r.id === c.requisicao_id),
    forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
  }));

  // Agrupa cotações por requisição para mostrar propostas concorrentes.
  // Boa prática de compras: coletar >=3 propostas por requisição antes de
  // aprovar. Trata Cancelado/Negado como propostas históricas — aparecem
  // no modal de comparação, mas não contam pro aviso soft.
  const propostasPorRequisicao = useMemo(() => {
    const map = new Map<string, any[]>();
    todasCotacoes.forEach((c: any) => {
      if (!c.requisicao_id) return;
      const arr = map.get(c.requisicao_id) ?? [];
      arr.push({
        ...c,
        req: requisicoes.find((r: any) => r.id === c.requisicao_id),
        forn: fornecedores.find((f: any) => f.id === c.fornecedor_id),
      });
      map.set(c.requisicao_id, arr);
    });
    return map;
  }, [todasCotacoes, requisicoes, fornecedores]);
  const contarVivos = (reqId: string) =>
    (propostasPorRequisicao.get(reqId) ?? []).filter((c: any) => STATUS_VIVOS.has(c.status)).length;

  // Fornecedores que JÁ têm proposta viva nesta requisição (migr. 538). É
  // situação diferente do cadeado da 537: aquele é "alguém está digitando
  // agora" e passa em 3 minutos; este é definitivo — o banco recusa o INSERT.
  // Mostrar antes do clique evita o aluno preencher a proposta inteira para
  // levar o erro no Salvar.
  const fornecedoresJaCotados = useMemo(() => {
    const map = new Map<string, string>();
    if (!form.requisicao_id) return map;
    for (const c of propostasPorRequisicao.get(form.requisicao_id) ?? []) {
      if (c.fornecedor_id && STATUS_VIVOS.has(c.status)) {
        map.set(c.fornecedor_id, numeroCotacao(c));
      }
    }
    return map;
  }, [propostasPorRequisicao, form.requisicao_id]);

  // A lista de "Nova cotação" não pode ser só "toda requisição aprovada":
  // cotar não é ato único (a régua é 3 propostas), então a requisição
  // continua 'Aprovado' depois da 1ª proposta e voltava para o dropdown
  // exatamente igual às que ninguém tocou. O aluno relia a lista inteira sem
  // ter como saber o que ainda faltava.
  //
  // Em vez de sumir com o item — o que impediria a 2ª e a 3ª proposta —, o
  // dropdown separa em dois grupos e diz quantas propostas já foram. Quem já
  // teve cotação aprovada sai de circulação (`disabled`): o próximo passo
  // dela é gerar o pedido, não cotar de novo.
  const requisicoesParaCotar = useMemo(() => {
    const anotadas = requisicoesAprovadaOrdenadas.map((r: any) => {
      const propostas = propostasPorRequisicao.get(r.id) ?? [];
      return {
        r,
        vivas: propostas.filter((c: any) => STATUS_VIVOS.has(c.status)).length,
        aprovada: propostas.some((c: any) => c.status === 'Aprovado'),
      };
    });
    return {
      pendentes: anotadas.filter(a => a.vivas === 0),
      cotadas:   anotadas.filter(a => a.vivas > 0),
    };
  }, [requisicoesAprovadaOrdenadas, propostasPorRequisicao]);

  // Snapshots estáveis para os três selects do formulário (ver
  // `useOpcoesEstaveis`). Fornecedor leva junto as duas travas porque elas é
  // que mudam o texto do <option> — congelar só o array de nomes deixaria o
  // rótulo "🔒 fulano está cotando" aparecendo e sumindo com o popup aberto.
  const selReq = useOpcoesEstaveis(requisicoesParaCotar);
  const opcoesPJ = useMemo(
    () => ({ grupos: fornecedoresPJ, jaCotados: fornecedoresJaCotados, reservas: reservasDaReq }),
    [fornecedoresPJ, fornecedoresJaCotados, reservasDaReq]);
  const opcoesPF = useMemo(
    () => ({ grupos: fornecedoresPF, jaCotados: fornecedoresJaCotados, reservas: reservasDaReq }),
    [fornecedoresPF, fornecedoresJaCotados, reservasDaReq]);
  const selPJ = useOpcoesEstaveis(opcoesPJ);
  const selPF = useOpcoesEstaveis(opcoesPF);

  // Modal de comparação — chave = requisicao_id.
  const [comparando, setComparando] = useState<string | null>(null);
  const propostasDoModal = useMemo(() => {
    if (!comparando) return [];
    const lista = propostasPorRequisicao.get(comparando) ?? [];
    // Menor preço primeiro (proposta candidata a vencedora).
    return [...lista].sort((a, b) => Number(a.valor_total ?? 0) - Number(b.valor_total ?? 0));
  }, [comparando, propostasPorRequisicao]);
  const menorPrecoDoModal = useMemo(() => {
    const vivos = propostasDoModal.filter((c: any) => STATUS_VIVOS.has(c.status));
    if (vivos.length === 0) return null;
    return Math.min(...vivos.map((c: any) => Number(c.valor_total ?? 0)));
  }, [propostasDoModal]);

  const enrichedFiltered = useMemo(() => {
    // Na porta do Financeiro a tela é caixa de entrada, não catálogo: mostra
    // só o que espera decisão dele — o mesmo status que alimenta o badge.
    const base = modoFinanceiro
      ? enriched.filter((c: any) => c.status === 'Aguardando Financeiro')
      : enriched;
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c: any) => {
      const item = String(c.req?.item ?? '').toLowerCase();
      const forn = String(c.forn?.nome ?? '').toLowerCase();
      const status = String(c.status ?? '').toLowerCase();
      const obs = String(c.observacao ?? '').toLowerCase();
      return item.includes(q) || forn.includes(q) || status.includes(q) || obs.includes(q);
    });
  }, [enriched, debouncedSearch, modoFinanceiro]);

  // Esta tela lê cotação por dois fetches: `data` é a página da tabela e
  // `todasCotacoes` (sem paginação) é o que alimenta os contadores da fila, o
  // agrupamento por requisição, o modal de comparação e — o que doía — o grupo
  // "Já cotadas" do dropdown de Nova Cotação. Escrever só em `data` deixava o
  // dropdown mentindo até o realtime chegar: a proposta acabava de ser salva e
  // a requisição continuava listada em "Ainda sem cotação". Toda escrita
  // otimista passa por aqui para as duas listas andarem juntas.
  const inserirCotacaoLocal = (nova: any) => {
    setData((prev: any[]) => [nova, ...prev]);
    setTodasCotacoes((prev: any[]) => [nova, ...prev]);
  };
  const atualizarCotacaoLocal = (fn: (c: any) => any) => {
    setData((prev: any[]) => prev.map(fn));
    setTodasCotacoes((prev: any[]) => prev.map(fn));
  };

  const closeForm = () => {
    setShowForm(false);
    setForm({ requisicao_id: '', fornecedor_id: '', fornecedor_tipo: '' });
    setExtras({ valor_fonte: '', valor_total: '', prazo_entrega: '', validade: '', marca: '', observacao: '', condicao_pagamento: 'À vista' });
    setErrors({});
    setErrosExtras({});
  };

  // Compras cria a cotação → vai direto para 'Aguardando Financeiro' e notifica.
  const handleSave = async () => {
    if (!validate()) return;
    // MIGR 583. Preço e validade são a proposta: sem preço não há o que
    // comparar, e sem validade não se sabe até quando o que foi comparado
    // continua valendo. O banco recusa os dois casos — a tela avisa antes.
    const erros: { valor_total?: string; validade?: string } = {};
    if (!(parseBRL(extras.valor_total) > 0)) {
      erros.valor_total = 'Informe o valor da proposta.';
    }
    if (!extras.validade) {
      erros.validade = 'Diga até quando este preço vale.';
    } else if (extras.validade < todayBR()) {
      erros.validade = 'Esta data já passou — a proposta nasceria vencida.';
    }
    setErrosExtras(erros);
    if (Object.keys(erros).length > 0) {
      showToast('Confira o valor e a validade da proposta.', 'error');
      return;
    }
    // O select já vem com a opção travada, mas o banco é quem decide de
    // verdade: sem esta checagem no Salvar, o cadeado da tela é decoração.
    if (reserva.travado) {
      showToast(`${reserva.dono?.usuario_nome} já está cotando este fornecedor para esta requisição.`, 'error');
      return;
    }
    // Aviso soft: recomendado ter >=3 propostas por requisição antes do envio.
    // Bloqueio hard atrapalharia compra urgente; então só confirma.
    const vivosAtuais = contarVivos(form.requisicao_id);
    if (vivosAtuais < 2) {
      const ordinal = vivosAtuais === 0 ? '1ª' : '2ª';
      const ok = await confirm(
        `Esta será a ${ordinal} proposta para esta requisição. Boa prática de compras é coletar pelo menos 3 propostas antes de enviar ao Financeiro. Deseja enviar assim mesmo?`
      );
      if (!ok) return;
    }
    setIsSaving(true);
    showToast('Enviando cotação ao Financeiro...', 'info', false);
    try {
      const fornNome = fornecedores.find((f: any) => f.id === form.fornecedor_id)?.nome ?? 'fornecedor';
      const reqItem  = requisicoes.find((r: any) => r.id === form.requisicao_id)?.item ?? 'item';
      const valorNum = parseBRL(extras.valor_total);
      const saved = await dbInsert('/api/cotacoesview', {
        requisicao_id: form.requisicao_id,
        fornecedor_id: form.fornecedor_id,
        valor_total: valorNum,
        prazo_entrega: extras.prazo_entrega,
        validade: extras.validade || null,
        // Reposição manda null: o gatilho zeraria de qualquer jeito, e enviar
        // texto daria a impressão de que foi gravado.
        marca: ehEventual ? (extras.marca.trim() || null) : null,
        // O que veio junto do preço (migr. 583): frete, garantia, instalação.
        observacao: extras.observacao.trim() || null,
        // MIGR 584: é daqui que saem os vencimentos dos títulos quando a
        // proposta virar pedido.
        condicao_pagamento: extras.condicao_pagamento,
        status: 'Aguardando Financeiro',
        filial,
      });
      inserirCotacaoLocal(saved ?? { id: Date.now(), ...form, ...extras, status: 'Aguardando Financeiro' });
      closeForm();
      showToast('Cotação enviada. O Financeiro decide em Financeiro → Aprovações de cotação; enquanto isso dá para cadastrar outra proposta para a mesma requisição.', 'success', true);

      // Notifica setor financeiro.
      await notificarSetor({
        setor:     'financeiro',
        tipo:      'aprovacao_pendente',
        titulo:    'Nova cotação aguardando aprovação',
        mensagem:  `${reqItem} — ${fornNome} (R$ ${formatBRL(valorNum)})`,
        // Destino do FINANCEIRO. Apontava para 'compras-cotações', módulo que
        // SETOR_MODULES.financeiro não inclui — o clique no sino não abria nada.
        link_view: 'financeiro-aprovaçõesdecotação',
        urgencia:  'Média',
        ref_id:    (saved as any)?.id,
        filial,
      });
    } catch (err: any) {
      const msg = err?.message ?? err?.error_description ?? String(err);
      console.error('[Cotacoes] erro ao salvar:', err);
      showToast(`Erro ao salvar: ${msg}`, 'error', true);
    } finally {
      setIsSaving(false);
    }
  };

  // Financeiro decide (aprovar OU reprovar com feedback).
  const handleConfirmDecisao = async () => {
    if (!decisao) return;
    const { cot, tipo } = decisao;
    const feedback = feedbackInput.trim();

    if (tipo !== 'aprovar' && !feedback) {
      showToast(tipo === 'reprovar'
        ? 'Feedback é obrigatório para reprovar.'
        : 'Diga o que corrigir — é o que Compras lê para arrumar a proposta.', 'error', true);
      return;
    }

    // Devolver não é decisão sobre a compra, é devolver o papel para quem o
    // preencheu: a proposta continua viva, não cancela concorrente nenhuma e
    // ninguém vira aprovador dela por ter apontado o erro (migr. 467).
    if (tipo === 'devolver') {
      if (!supabase) return;
      setDecidindo(true);
      try {
        const { error } = await supabase.rpc('devolver_cotacao_para_correcao', {
          p_cotacao_id: cot.id,
          p_motivo:     feedback,
        });
        if (error) throw error;
        atualizarCotacaoLocal(c => c.id === cot.id
          ? { ...c, status: 'Em correção', feedback, aprovado_por: null, aprovado_em: null }
          : c);

        const reqItem  = cot.req?.item ?? requisicoes.find((r: any) => r.id === cot.requisicao_id)?.item ?? 'cotação';
        const fornNome = cot.forn?.nome ?? fornecedores.find((f: any) => f.id === cot.fornecedor_id)?.nome ?? 'fornecedor';
        await notificarSetor({
          setor:     'logistica',
          tipo:      'reprovado',
          titulo:    'Cotação devolvida para correção',
          mensagem:  `${reqItem} — ${fornNome}`,
          link_view: 'compras-cotações',
          urgencia:  'Alta',
          ref_id:    cot.id,
          filial:    cot.filial ?? filial,
          motivo:    feedback,
        });

        showToast('Cotação devolvida. Compras corrige e reenvia — a proposta não foi recusada.', 'success', true);
        setDecisao(null);
        setFeedbackInput('');
      } catch (err: any) {
        showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
      } finally {
        setDecidindo(false);
      }
      return;
    }

    setDecidindo(true);
    try {
      const novoStatus = tipo === 'aprovar' ? 'Aprovado' : 'Negado';

      // Decisão e cancelamento das concorrentes numa transação só (migr. 334).
      // Eram um UPDATE mais um laço de UPDATEs com `catch {}` vazio: bastava um
      // falhar para a proposta concorrente seguir 'Aguardando Financeiro' e
      // aprovável — o Financeiro decidindo duas vezes a mesma compra. O banco
      // também varre todas as propostas, não só as da página carregada.
      if (!supabase) return;
      const { data: res, error } = await supabase.rpc('decidir_cotacao', {
        p_cotacao_id: cot.id,
        p_decisao:    novoStatus,
        p_feedback:   feedback || null,
      });
      if (error) throw error;

      const canceladas = Number((res as any)?.canceladas ?? 0);
      const updates: any = {
        status:       novoStatus,
        feedback:     feedback || null,
        aprovado_por: profile.id,
        aprovado_em:  new Date().toISOString(),
      };
      atualizarCotacaoLocal(c => {
        if (c.id === cot.id) return { ...c, ...updates };
        if (tipo === 'aprovar' && cot.requisicao_id &&
            c.requisicao_id === cot.requisicao_id && c.status === 'Aguardando Financeiro') {
          return { ...c, status: 'Cancelado' };
        }
        return c;
      });

      // Notifica Compras — no setor 'logistica': nenhum perfil tem o setor
      // 'compras'; o módulo pende da logística (SETOR_MODULES) e o Modo Aula
      // concede os dois. Mandado a 'compras', o aviso fora da aula não chegava
      // a ninguém.
      const reqItem = cot.req?.item ?? requisicoes.find((r: any) => r.id === cot.requisicao_id)?.item ?? 'cotação';
      const fornNome = cot.forn?.nome ?? fornecedores.find((f: any) => f.id === cot.fornecedor_id)?.nome ?? 'fornecedor';
      await notificarSetor({
        setor:     'logistica',
        tipo:      tipo === 'aprovar' ? 'aprovado' : 'reprovado',
        titulo:    tipo === 'aprovar'
                     ? 'Cotação aprovada pelo Financeiro'
                     : 'Cotação reprovada pelo Financeiro',
        mensagem:  `${reqItem} — ${fornNome}`,
        link_view: 'compras-cotações',
        urgencia:  tipo === 'aprovar' ? 'Média' : 'Alta',
        ref_id:    cot.id,
        filial:    cot.filial ?? filial,
        motivo:    tipo === 'reprovar' ? feedback : undefined,
      });

      showToast(tipo === 'aprovar'
        ? (canceladas > 0
            ? `Cotação aprovada e ${canceladas} proposta(s) concorrente(s) cancelada(s). Compras agora gera o pedido pelo botão "Gerar pedido", na linha da cotação.`
            : 'Cotação aprovada. Compras agora gera o pedido pelo botão "Gerar pedido", na linha da cotação.')
        : 'Cotação reprovada. Compras vê o motivo e cota de novo em Compras → Cotações.', 'success', true);
      setDecisao(null);
      setFeedbackInput('');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setDecidindo(false);
    }
  };

  // Compras: cria o pedido depois que o Financeiro aprovou.
  //
  // Tudo acontece dentro da RPC `gerar_pedido_de_cotacao` (migr. 266): ela checa
  // duplicidade por cotação E por requisição, insere o pedido e baixa a
  // requisição para 'Atendida' no mesmo COMMIT. Antes isso era insert solto no
  // cliente com guard só por cotação — foi assim que uma requisição de 24
  // unidades virou 2 pedidos e 2 contas a pagar em produção.
  // O modal "Qual item do catálogo?" saiu em 24/09. Escolher o item num select
  // era onde o erro nascia — "Carregador de Tomada USB-C 20W" saiu como Power
  // Bank porque os dois têm "Carregador" no nome e a régua da migr. 596
  // deixou. Agora o vínculo é fato, nunca escolha: produto pelo cadastro com
  // "Origem deste cadastro" (migr. 494), produto ou serviço pelo NOME IDÊNTICO
  // ao da requisição (migr. 627/628). Ver `prontasParaPedido`.
  /** A requisição pediu serviço? A unidade SV é a declaração (src/lib/unidades.ts). */
  const pediuServico = (cot: any) =>
    String(cot?.req?.unidade ?? '').trim().toUpperCase() === 'SV';

  // ── Prontas para pedido ────────────────────────────────────────────────
  // A fila que o SAP chama de requisições atribuídas (ME57) e o Protheus
  // juntou no Novo Fluxo de Compras: só o que já foi aprovado e ainda não
  // virou pedido, com o item do catálogo à mostra NA LINHA. Antes as aprovadas
  // ficavam misturadas na lista geral, com o mesmo botão amarelo estivessem
  // amarradas ou não — o comprador só descobria qual abria o modal clicando,
  // e para saber se o produto já tinha sido cadastrado ia olhar em Produtos.
  //
  // Só dois estados de trabalho, sem palpite no meio (24/09):
  //  • ligado       — a requisição aponta para o catálogo (reposição, cadastro
  //                   com "Origem deste cadastro", ou item com o NOME IDÊNTICO
  //                   ao da requisição): o pedido sai direto, e entra no lote.
  //  • sem_cadastro — o produto não existe: o atalho abre o cadastro com a
  //                   origem já escolhida, e o vínculo nasce lá (migr. 494).
  //  • bloqueado    — o banco vai recusar (produto inativo ou patrimônio,
  //                   nome duplicado no catálogo, requisição inativada). A
  //                   linha diz o conserto, sem botão de gerar.
  //
  // Existiu um terceiro, "É este?", que sugeria o item com palavra em comum.
  // Durou um dia: "Carregador de Tomada USB-C 20W" virou pedido de Power Bank
  // na mão do professor, porque os dois têm "Carregador". Palpite na tela de
  // quem compra é o que produz o item trocado — o vínculo tem de ser um fato.
  //
  // Nome idêntico conta como fato: comparação sem acento, caixa, espaço e
  // pontuação ("5G- Samsung" = "5G - Samsung"), e só quando há UM produto com
  // esse nome — dois iguais são duplicata, e escolher um seria palpite de novo.
  const normNome = (t: string) => String(t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  type EstadoPronta = 'ligado' | 'sem_cadastro' | 'bloqueado';
  // Enquanto as leituras não chegam, "sem cadastro" e "sem pedido" são o
  // vazio falando — o painel espera para não piscar a linha errada.
  const prontasCarregando = !pedidosLidos || requisicoesCarregando || produtosCarregando || todasCotacoesCarregando;
  const prontasParaPedido = useMemo(() => {
    if (prontasCarregando) return [];
    const ordem: Record<EstadoPronta, number> = { ligado: 0, sem_cadastro: 1, bloqueado: 2 };
    const porNome = (lista: any[], nome: string) => {
      const n = normNome(nome);
      return n ? lista.filter((p: any) => normNome(p.nome ?? '') === n) : [];
    };
    return todasCotacoes
      .filter((c: any) => c.ativo !== false && c.status === 'Aprovado' && !cotacoesComPedido.has(c.id))
      .map((c: any) => {
        const req = requisicoes.find((r: any) => r.id === c.requisicao_id);
        const forn = fornecedores.find((f: any) => f.id === c.fornecedor_id);
        const cot = { ...c, req, forn };
        const servico = pediuServico(cot) || !!req?.servico_id;
        let estado: EstadoPronta = 'sem_cadastro';
        let alvo: any = null;
        let motivo = '';
        // Vínculo que a tela manda junto quando ele vem do nome idêntico — o
        // gravado na requisição a RPC já lê sozinha.
        let vinculo: { produtoId?: string; servicoId?: string } | undefined;
        if (!req) {
          estado = 'bloqueado';
          motivo = 'A requisição de origem não está mais ativa — fale com o professor antes de comprar';
        } else if (req.produto_id) {
          alvo = produtos.find((p: any) => p.id === req.produto_id) ?? null;
          estado = alvo && alvo.tipo !== 'patrimonio' ? 'ligado' : 'bloqueado';
          motivo = !alvo
            ? 'O produto ligado a esta requisição foi inativado — reative-o em Cadastros > Produtos'
            : alvo.tipo === 'patrimonio'
              ? `"${alvo.nome}" está como Patrimônio — corrija o Tipo em Cadastros > Produtos`
              : '';
        } else if (req.servico_id) {
          alvo = servicos.find((sv: any) => sv.id === req.servico_id) ?? null;
          estado = alvo ? 'ligado' : 'bloqueado';
          if (!alvo) motivo = 'O serviço ligado a esta requisição foi inativado — reative-o em Cadastros > Serviços';
        } else {
          const iguais = porNome(servico ? servicosOrdenados : produtosOrdenados, req.item ?? '');
          if (iguais.length === 1) {
            estado = 'ligado';
            alvo = iguais[0];
            vinculo = servico ? { servicoId: alvo.id } : { produtoId: alvo.id };
          } else if (iguais.length > 1) {
            estado = 'bloqueado';
            motivo = `Há ${iguais.length} ${servico ? 'serviços' : 'produtos'} com o nome "${iguais[0].nome}" no catálogo — inative o duplicado em Cadastros > ${servico ? 'Serviços' : 'Produtos'}`;
          }
        }
        return { cot, servico, estado, alvo, motivo, vinculo };
      })
      .sort((a, b) => ordem[a.estado as EstadoPronta] - ordem[b.estado as EstadoPronta]
        || String(a.cot.req?.item ?? '').localeCompare(String(b.cot.req?.item ?? ''), 'pt-BR'));
  }, [prontasCarregando, todasCotacoes, cotacoesComPedido, requisicoes, fornecedores, produtos, servicos, produtosOrdenados, servicosOrdenados]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duas abas na porta de Compras (24/09). Com o painel em cima e a lista
  // geral embaixo, a mesma cotação aparecia duas vezes, as duas dizendo
  // "Cadastrar produto" — para o aluno, lista duplicada. Agora cada coisa tem
  // um lugar: "Gerar pedidos" é o trabalho (aprovadas sem pedido); "Cotações"
  // é o acompanhamento de todas as propostas, e lá a aprovada só aponta para
  // cá. A aba inicial é decidida UMA vez, quando as leituras chegam: trocar
  // sozinha depois (ao gerar o último pedido, por exemplo) tiraria a tela de
  // baixo do clique.
  const mostraAbas = !modoFinanceiro && isCompras;
  const [abaEscolhida, setAbaEscolhida] = useState<'gerar' | 'cotacoes' | null>(null);
  useEffect(() => {
    if (!mostraAbas || abaEscolhida || prontasCarregando) return;
    setAbaEscolhida(prontasParaPedido.length > 0 ? 'gerar' : 'cotacoes');
  }, [mostraAbas, abaEscolhida, prontasCarregando, prontasParaPedido.length]);
  const abaAtiva = mostraAbas ? abaEscolhida : 'cotacoes';

  // A busca do topo vale para as duas abas.
  const prontasVisiveis = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return prontasParaPedido;
    return prontasParaPedido.filter(p =>
      String(p.cot.req?.item ?? '').toLowerCase().includes(q)
      || String(p.cot.forn?.nome ?? '').toLowerCase().includes(q)
      || String(p.alvo?.nome ?? '').toLowerCase().includes(q)
      || numeroCotacao(p.cot).toLowerCase().includes(q));
  }, [prontasParaPedido, debouncedSearch]);

  // Seleção do lote — só linhas ligadas. Recortada a cada render pelo que
  // ainda está na fila: o pedido que o colega gerou sai da seleção sozinho.
  const [selLote, setSelLote] = useState<Set<string>>(new Set());
  const idsLigados = prontasVisiveis.filter(p => p.estado === 'ligado').map(p => p.cot.id);
  const selecionadas = idsLigados.filter(id => selLote.has(id));
  const alternarLote = (id: string) => setSelLote(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const [gerandoLote, setGerandoLote] = useState(false);

  // "Cadastrar produto/serviço" da fila: abre o cadastro já com a requisição.
  // Produto nasce com ela na origem (migr. 494); serviço nasce contratado e
  // com o nome dela, que é o que o pedido reconhece (migr. 628). Salvo, o
  // cadastro devolve o comprador para cá.
  const podeCadastrarDaFila = temAcessoCadastros && !!onNavigate;
  const cadastrarDaFila = (cot: any, servico: boolean) => {
    if (!onNavigate || !cot.requisicao_id) return;
    pedirCadastroDaCotacao(servico ? 'servico' : 'produto', cot.requisicao_id, filial, String(cot.req?.item ?? ''));
    onNavigate(servico ? 'cadastros-serviços' : 'cadastros-produtos');
  };

  // O que acontece na tela depois que a RPC devolve o pedido — o mesmo para
  // o clique na linha e para o lote.
  const registrarPedidoGerado = (cotacao: any) => {
    setCotacoesComPedido(prev => new Set(prev).add(cotacao.id));
    // A requisição saiu de 'Aprovado' — tira do dropdown de Nova Cotação sem
    // esperar o próximo fetch.
    if (cotacao.requisicao_id) {
      setRequisicoes((prev: any[]) =>
        prev.map(r => r.id === cotacao.requisicao_id ? { ...r, status: 'Atendida' } : r));
    }
    setSelLote(prev => { const n = new Set(prev); n.delete(cotacao.id); return n; });
  };

  // Um pedido por cotação, como sempre (a RPC é 1:1); o lote só poupa os
  // cliques. Em série de propósito: são poucas linhas, e N chamadas paralelas
  // da turma inteira é o que enche o pool (incidente de 15/09).
  const handleGerarLote = async () => {
    if (!supabase || selecionadas.length === 0) return;
    const alvo = prontasParaPedido.filter(p => selecionadas.includes(p.cot.id));
    // A confirmação mostra o item do CATÁLOGO, que é o que entra no pedido.
    if (!await confirm(
      `Gerar ${alvo.length} pedido(s) de compra?\n\n` +
      alvo.map(({ cot: c, alvo: item }) =>
        `• ${item?.nome ?? c.req?.item ?? numeroCotacao(c)} — ${c.forn?.nome ?? 'fornecedor'}`).join('\n'))) return;
    setGerandoLote(true);
    const gerados: string[] = [];
    const falhas: string[] = [];
    try {
      for (const { cot, vinculo } of alvo) {
        const { data: pedido, error } = await supabase.rpc('gerar_pedido_de_cotacao', {
          p_cotacao_id: cot.id,
          p_produto_id: vinculo?.produtoId ?? null,
          p_servico_id: vinculo?.servicoId ?? null,
        });
        if (error) { falhas.push(`${cot.req?.item ?? numeroCotacao(cot)}: ${error.message}`); continue; }
        registrarPedidoGerado(cot);
        const novo: any = Array.isArray(pedido) ? pedido[0] : pedido;
        gerados.push(numeroPedido(novo));
      }
    } finally {
      setGerandoLote(false);
    }
    // Falha de "já tem pedido" é tela atrasada: relê para a linha sumir.
    if (falhas.length > 0) await carregarCotacoesComPedido();
    if (gerados.length > 0) {
      showToast(
        `${gerados.length} pedido(s) gerado(s): ${gerados.join(', ')}. As contas a pagar nasceram junto. ` +
        'Marque "em entrega" em Compras → Pedidos para avisar o Estoque.' +
        (falhas.length > 0 ? ` Não saíram: ${falhas.join(' · ')}` : ''),
        falhas.length > 0 ? 'error' : 'success', true);
    } else if (falhas.length > 0) {
      showToast(`Nenhum pedido gerado. ${falhas.join(' · ')}`, 'error', true);
    }
  };

  const handleGerarPedido = async (
    cotacao: any,
    vinculo?: { produtoId?: string; servicoId?: string },
  ) => {
    if (!supabase) return;
    // Compra eventual nasce de texto livre — quem pede não conhece o catálogo,
    // e isso é realista. O que não era realista é ninguém normalizar depois: o
    // item chegava na doca sem código e o conferente é que cadastrava. Em ERP
    // real o código existe ANTES do pedido, e quem amarra é o comprador.
    // A RPC recusa de qualquer jeito (migr. 480/499); isto aqui é só perguntar
    // antes, em vez de deixar o erro estourar depois do clique.
    const jaVinculada = !!(cotacao.req?.produto_id || cotacao.req?.servico_id);
    if (!jaVinculada && !vinculo?.produtoId && !vinculo?.servicoId) {
      const servico = pediuServico(cotacao);
      if (podeCadastrarDaFila) {
        cadastrarDaFila(cotacao, servico);
      } else {
        showToast(`${servico ? 'O serviço' : 'O produto'} desta requisição ainda não foi cadastrado. O cadastro fica em Cadastros, fora do seu acesso — peça à Logística.`, 'error', true);
      }
      return;
    }
    setGenerating(cotacao.id);
    try {
      const { data: pedido, error } = await supabase.rpc('gerar_pedido_de_cotacao', {
        p_cotacao_id: cotacao.id,
        p_produto_id: vinculo?.produtoId ?? null,
        p_servico_id: vinculo?.servicoId ?? null,
      });
      if (error) throw new Error(error.message);
      registrarPedidoGerado(cotacao);
      const novo: any = Array.isArray(pedido) ? pedido[0] : pedido;
      // Serviço não chega em caixa: o que fecha o pedido é o aceite da execução,
      // e é ele que libera o pagamento. Mandar o aluno avisar o Estoque de uma
      // dedetização seria mandá-lo esperar uma carga que não vem.
      // MIGR 584: dizer quantos títulos nasceram fecha o ciclo na cabeça de
      // quem comprou — a condição que ele negociou virou dívida com data.
      const nParc = parcelasDaCondicao(String(novo?.condicao_pagamento ?? ''));
      const contas = nParc > 1
        ? `com ${nParc} parcelas no contas a pagar (${novo.condicao_pagamento})`
        : 'com a conta a pagar';
      showToast(
        novo?.servico_id
          ? `${numeroPedido(novo)} gerado, ${contas}. Serviço não entra em estoque: quando for executado, registre o aceite em Estoque → Recebimentos — é ele que libera o pagamento.`
          : `${numeroPedido(novo)} gerado, ${contas}. Marque "em entrega" em Compras → Pedidos para avisar o Estoque.`,
        'success', true);
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      // "Já tem pedido" quer dizer que esta tela estava atrasada em relação ao
      // banco — quase sempre porque o colega gerou o pedido na máquina dele.
      // Relê antes de reclamar: o botão some junto com o aviso, em vez de
      // continuar ali convidando ao mesmo clique.
      if (/já tem pedido|já foi atendida/i.test(msg)) {
        await carregarCotacoesComPedido();
        showToast(
          `${msg} Esta tela estava desatualizada — provavelmente outra pessoa gerou o pedido antes. A lista já foi atualizada; o pedido está em Compras > Pedidos.`,
          'error', true);
      } else {
        showToast(`Falha ao gerar pedido: ${msg || 'verifique o console'}`, 'error', true);
      }
    } finally {
      setGenerating(null);
    }
  };

  // Compras corrige o que foi devolvido e devolve para a fila do Financeiro.
  // A RPC guarda a régua (só quem cadastrou ou Compras da filial, e só em
  // 'Em correção'); aqui é só o formulário.
  const abrirCorrecao = (cot: any) => {
    setCorrecao(cot);
    // A fonte nasce da divisão porque o banco só guarda o total: é o preço que
    // a proposta devolvida de fato praticou, não o de tabela. O total gravado
    // entra intocado — recompor a fonte arredonda, e é o total que vale.
    const req = cot.req ?? requisicoes.find((r: any) => r.id === cot.requisicao_id);
    const qtd = Number(req?.qtd ?? 0);
    const total = Number(cot.valor_total ?? 0);
    // Migr. 589: com embalagem fechada, a fonte é o preço do fardo.
    const multFonte = Number(req?.qtd_embalagens ?? 0) > 0 && Number(req?.embalagem_fator ?? 0) > 1
      ? Number(req.qtd_embalagens)
      : (Number.isFinite(qtd) && qtd > 0 ? qtd : 0);
    setCorrecaoForm({
      valor_fonte:   multFonte > 0 ? formatBRL(total / multFonte) : '',
      valor_total:   formatBRL(total),
      prazo_entrega: cot.prazo_entrega ?? '',
      // Proposta devolvida costuma voltar com a validade já vencida — e o
      // banco recusa reenviar assim (migr. 583). Sugere a data nova em vez de
      // deixar o aluno bater no erro para descobrir.
      validade:      (cot.validade && String(cot.validade) >= todayBR())
                       ? cot.validade : emDias(VALIDADE_PADRAO_DIAS),
      marca:         cot.marca ?? '',
      observacao:    cot.observacao ?? '',
      condicao_pagamento: cot.condicao_pagamento ?? 'À vista',
    });
  };

  const handleReenviarCorrigida = async () => {
    if (!correcao || !supabase) return;
    const valorNum = parseBRL(correcaoForm.valor_total);
    if (!(valorNum > 0)) {
      showToast('Informe o valor da proposta.', 'error', true);
      return;
    }
    // Reenviar é revalidar: o banco recusa devolver ao Financeiro uma proposta
    // com a validade vencida (migr. 583), e o erro cru não diria o porquê.
    if (!correcaoForm.validade) {
      showToast('Diga até quando este preço vale.', 'error', true);
      return;
    }
    if (correcaoForm.validade < todayBR()) {
      showToast('A validade informada já passou. Confirme com o fornecedor até quando o preço vale.', 'error', true);
      return;
    }
    setReenviando(true);
    try {
      const { error } = await supabase.rpc('reenviar_cotacao_corrigida', {
        p_cotacao_id:    correcao.id,
        p_valor_total:   valorNum,
        p_prazo_entrega: correcaoForm.prazo_entrega || null,
        p_validade:      correcaoForm.validade || null,
        // Migr. 526: branco LIMPA. "Tirei a marca da proposta" é correção
        // legítima, e guardar o valor antigo diria que deu certo sem ter dado.
        p_marca:         correcaoForm.marca.trim() || null,
        p_observacao:    correcaoForm.observacao.trim() || null,
        p_condicao_pagamento: correcaoForm.condicao_pagamento || null,
      });
      if (error) throw error;
      atualizarCotacaoLocal(c => c.id === correcao.id
        ? { ...c, status: 'Aguardando Financeiro', feedback: null,
            valor_total: valorNum, prazo_entrega: correcaoForm.prazo_entrega || c.prazo_entrega,
            validade: correcaoForm.validade || null,
            marca: correcaoForm.marca.trim() || null,
            observacao: correcaoForm.observacao.trim() || null,
            condicao_pagamento: correcaoForm.condicao_pagamento }
        : c);

      const reqItem  = correcao.req?.item ?? requisicoes.find((r: any) => r.id === correcao.requisicao_id)?.item ?? 'item';
      const fornNome = correcao.forn?.nome ?? fornecedores.find((f: any) => f.id === correcao.fornecedor_id)?.nome ?? 'fornecedor';
      await notificarSetor({
        setor:     'financeiro',
        tipo:      'aprovacao_pendente',
        titulo:    'Cotação corrigida voltou para decisão',
        mensagem:  `${reqItem} — ${fornNome} (R$ ${formatBRL(valorNum)})`,
        link_view: 'financeiro-aprovaçõesdecotação',
        urgencia:  'Média',
        ref_id:    correcao.id,
        filial:    correcao.filial ?? filial,
      });

      showToast('Cotação corrigida e reenviada — está de volta na fila do Financeiro.', 'success', true);
      setCorrecao(null);
    } catch (err: any) {
      showToast(`Erro ao reenviar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    } finally {
      setReenviando(false);
    }
  };

  const handleCancelar = async (id: string) => {
    if (!await confirm('Cancelar esta cotação?')) return;
    try {
      const updated = await dbUpdate('/api/cotacoesview', id, { status: 'Cancelado' });
      atualizarCotacaoLocal(c => c.id === id ? (updated ?? { ...c, status: 'Cancelado' }) : c);
      showToast('Cotação cancelada.', 'info', true);
    } catch (err: any) {
      showToast(`Erro ao cancelar: ${err?.message ?? 'verifique o console'}`, 'error', true);
    }
  };

  // Inativar cotação saiu (migr. 340): apagar a proposta some com o preço que o
  // fornecedor deu e com o motivo da recusa — o material da aula sobre compras.
  // Cancelar continua sendo o caminho normal; reabrir existe para o engano.
  const handleReabrirCot = async (cot: any) => {
    if (!supabase) return;
    if (!await confirm(
      `Reabrir a cotação ${numeroCotacao(cot)}?\n\n` +
      'Ela volta para "Aguardando Financeiro" e entra de novo na fila de decisão.')) return;
    setReabrindoCot(cot.id);
    try {
      const { error } = await supabase.rpc('reabrir_cotacao', { p_id: cot.id, p_motivo: null });
      if (error) throw error;
      showToast('Cotação reaberta — está de volta na fila do Financeiro.', 'success', true);
      await reload();
    } catch (err: any) {
      showToast(err?.message ?? 'Não foi possível reabrir.', 'error', true);
    } finally {
      setReabrindoCot(null);
    }
  };

  // Os botões de uma cotação aprovada sem pedido, na aba "Gerar pedidos".
  const botoesDaPronta = (pronta: typeof prontasParaPedido[number]) => {
    const { cot, servico, estado, vinculo } = pronta;
    const ocupada = generating === cot.id || gerandoLote;
    const rotulo = (t: string) => <span>{t}</span>;
    const base = 'btn-solido !h-8 !py-0 !px-3 !rounded-lg !text-[11px] justify-center';
    if (estado === 'ligado') {
      return (
        <button type="button" onClick={() => handleGerarPedido(cot, vinculo)} disabled={ocupada}
          title="Gerar o pedido de compra desta cotação"
          className={`${base} btn-solido--verde`}>
          {generating === cot.id ? <Loader2 size={12} className="animate-spin" /> : <ShoppingBag size={12} />}
          {rotulo('Gerar pedido')}
        </button>
      );
    }
    if (estado !== 'sem_cadastro') return null;
    if (!podeCadastrarDaFila) {
      return (
        <span className="text-[10px] text-gray-500 max-w-[11rem] leading-tight whitespace-normal">
          Cadastro fora do seu acesso — peça à Logística.
        </span>
      );
    }
    return (
      <>
        <button type="button" onClick={() => cadastrarDaFila(cot, servico)}
          title={servico
            ? 'Abrir o cadastro de serviço já como contratado e com o nome desta requisição — salvo, você volta para cá'
            : 'Abrir o cadastro já com esta requisição na origem — salvo, o produto fica ligado e você volta para cá'}
          className={`${base} btn-solido--dourado`}>
          <Plus size={12} /> {rotulo(servico ? 'Cadastrar serviço' : 'Cadastrar produto')}
        </button>
      </>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-8">
      {/* Uma vez só, na raiz: o formulário de nova proposta e o modal de
          correção apontam os dois para este `list` (migr. 526). Dentro do
          formulário, ele sumia junto com ele e o modal ficava sem sugestão. */}
      <datalist id="marcas-conhecidas">
        {marcasConhecidas.map(m => <option key={m} value={m} />)}
      </datalist>
      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">
            {modoFinanceiro ? 'Aprovações de Cotação' : 'Cotações'} — {filial}
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar..."
              className="neu-input py-2.5 pl-10 pr-4 rounded-xl text-sm w-full sm:w-52"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {isCompras && !modoFinanceiro && (
            <NeuButtonAccent onClick={() => {
              const abrindo = !showForm;
              closeForm();
              setShowForm(abrindo);
              if (abrindo) setExtras(x => ({ ...x, validade: emDias(VALIDADE_PADRAO_DIAS) }));
            }}>
              <Plus size={16} /> Nova Cotação
            </NeuButtonAccent>
          )}
        </div>
      </div>

      <FilaDeTrabalho itens={filaDaTela} />

      {/* Abas da porta de Compras — ver o comentário de `abaEscolhida`. Na
          ordem do trabalho: primeiro se cota, depois se gera o pedido. Cada
          aba tem cara própria e nenhuma fica apagada — com as duas em cinza,
          a inativa lia como botão desabilitado. A ativa ganha um traço
          embaixo, e a quantidade fica num card ao lado. */}
      {mostraAbas && (
        <div className="flex gap-3 flex-wrap shrink-0" role="tablist">
          {([
            { id: 'cotacoes' as const, label: 'Cotações', n: totalCount ?? todasCotacoes.length, cor: 'navy' as const,
              dica: 'Todas as propostas: aguardando o Financeiro, devolvidas, aprovadas e o histórico' },
            { id: 'gerar' as const, label: 'Gerar pedidos', n: prontasParaPedido.length, cor: 'verdeEscuro' as const,
              dica: 'Cotações aprovadas que ainda não viraram pedido' },
          ]).map(a => (
            <AbaComContador key={a.id} label={a.label} n={a.n} cor={a.cor} title={a.dica}
              ativa={abaAtiva === a.id} onClick={() => setAbaEscolhida(a.id)} />
          ))}
        </div>
      )}

      {mostraAbas && abaAtiva === null && <LoadingSpinner />}

      {/* Gerar pedidos — a bancada do comprador. Ver o comentário de
          `prontasParaPedido`. */}
      {abaAtiva === 'gerar' && prontasVisiveis.length === 0 && (
        <EmptyState message={debouncedSearch.trim()
          ? 'Nenhuma cotação esperando pedido bate com a busca'
          : 'Nenhuma cotação aprovada esperando pedido. Quando o Financeiro aprovar uma proposta, ela aparece aqui.'} />
      )}
      {abaAtiva === 'gerar' && prontasVisiveis.length > 0 && (
        <div className="neu-flat rounded-3xl p-4 sm:p-6 border border-white/5 shrink-0 flex flex-col gap-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2">
              <ShoppingBag size={15} className="text-green-500" />
              Aprovadas esperando o pedido
              <span className="text-[11px] font-bold text-green-400">({prontasVisiveis.length})</span>
            </h3>
            {idsLigados.length > 0 && (
              <button type="button" onClick={handleGerarLote}
                disabled={selecionadas.length === 0 || gerandoLote || !!generating}
                title={selecionadas.length === 0 ? 'Marque as cotações cadastradas que vão virar pedido' : undefined}
                className="btn-solido btn-solido--verde-escuro">
                {gerandoLote ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />}
                Gerar {selecionadas.length > 0 ? selecionadas.length : ''} pedido{selecionadas.length === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto main-scrollbar">
            {/* Mesma régua das outras listas: a seleção abre a linha, o item
                é o texto principal, e "Catálogo" diz se o pedido já pode sair
                (cadastrado) ou se falta o cadastro do produto. */}
            <table className="tabela col-guia w-full text-left border-collapse">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="w-px">
                    {idsLigados.length > 0 && (
                      <input type="checkbox" className="accent-black w-4 h-4 cursor-pointer align-middle"
                        aria-label="Selecionar todas as cadastradas"
                        title={selecionadas.length === idsLigados.length ? 'Limpar seleção' : `Selecionar as ${idsLigados.length} cadastradas`}
                        checked={idsLigados.length > 0 && selecionadas.length === idsLigados.length}
                        disabled={gerandoLote}
                        onChange={() => setSelLote(selecionadas.length === idsLigados.length ? new Set() : new Set(idsLigados))} />
                    )}
                  </th>
                  <th className="text-center">Item</th>
                  <th className="text-center hidden md:table-cell w-52">Fornecedor</th>
                  <th className="text-center w-28">Qtd</th>
                  <th className="text-center w-32">Valor</th>
                  <th className="text-center hidden lg:table-cell w-56">Catálogo</th>
                  <th className="text-center w-px">Ação</th>
                </tr>
              </thead>
              <tbody>
                {prontasVisiveis.map(pronta => {
                  const { cot, servico, estado, alvo, motivo } = pronta;
                  const ocupada = generating === cot.id || gerandoLote;
                  const req = cot.req;
                  return (
                    <tr key={cot.id}>
                      <td className="py-3 px-3">
                        {estado === 'ligado' && (
                          <input type="checkbox" className="accent-green-600 w-4 h-4 cursor-pointer align-middle"
                            aria-label={`Incluir ${req?.item ?? numeroCotacao(cot)} no lote`}
                            checked={selLote.has(cot.id)} disabled={ocupada}
                            onChange={() => alternarLote(cot.id)} />
                        )}
                      </td>
                      <td className="py-3 px-3 min-w-[14rem]">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-credencial text-[10px] tracking-wider whitespace-nowrap">
                          <span className="text-accent/70">{numeroCotacao(cot)}</span>
                          {req && <span className="text-gray-600">← {numeroRequisicao(req)}</span>}
                        </span>
                        <span className="block text-sm font-semibold text-gray-100 leading-snug mt-1 line-clamp-2 break-words" title={req?.item ?? ''}>
                          {req?.item ?? '—'}
                          {cot.marca && <span className="text-xs text-gray-500 font-normal"> · {cot.marca}</span>}
                        </span>
                        <span className="md:hidden block text-[11px] text-gray-500 mt-0.5 truncate">{cot.forn?.nome ?? '—'}</span>
                      </td>
                      <td className="py-3 px-3 hidden md:table-cell">
                        <span className="block text-xs text-gray-300 line-clamp-2 max-w-[12rem] mx-auto" title={cot.forn?.nome ?? ''}>
                          {cot.forn?.nome ?? '—'}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {req ? (
                          <>
                            <span className="text-sm font-semibold text-gray-200 tabular-nums">{qtdBR(req.qtd)}</span>
                            <span className="text-[10px] text-gray-500 ml-1 uppercase">{normalizarUnidade(req.unidade)}</span>
                            {Number(req.qtd_embalagens ?? 0) > 0 && req.embalagem_nome && (
                              <span className="block text-[10px] text-gray-500 leading-tight">
                                {qtdBR(req.qtd_embalagens)} {pluralEmbalagem(req.embalagem_nome, Number(req.qtd_embalagens)).toLowerCase()}
                              </span>
                            )}
                          </>
                        ) : <span className="text-xs text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="block text-sm font-semibold text-gray-100 tabular-nums">R$ {formatBRL(Number(cot.valor_total ?? 0))}</span>
                        <CondicaoCompra condicao={cot.condicao_pagamento} />
                      </td>
                      <td className="py-3 px-3 hidden lg:table-cell">
                        {/* Etiqueta no formato das de situação: o nome do
                            produto ligado quase sempre repete o do Item, então
                            ele fica no title e a célula mostra o código. */}
                        {estado === 'ligado' && (
                          <span className="inline-flex flex-col items-center gap-1" title={alvo?.nome ? `Vai para o pedido como: ${alvo.nome}` : undefined}>
                            <span className="px-2.5 py-1 rounded-md text-[10px] uppercase tracking-widest font-bold bg-green-600 text-white">Cadastrado</span>
                            {alvo?.codigo && <span className="font-mono text-[10px] text-gray-400">cód. {alvo.codigo}</span>}
                          </span>
                        )}
                        {estado === 'sem_cadastro' && (
                          <span className="px-2.5 py-1 rounded-md text-[10px] uppercase tracking-widest font-bold bg-red-600 text-white"
                            title={servico ? 'Serviço ainda não cadastrado — cadastre para gerar o pedido' : 'Produto ainda não cadastrado — cadastre para gerar o pedido'}>
                            Sem cadastro
                          </span>
                        )}
                        {estado === 'bloqueado' && (
                          <span className="inline-flex flex-col items-center gap-1 max-w-[14rem]" title={motivo ?? undefined}>
                            <span className="px-2.5 py-1 rounded-md text-[10px] uppercase tracking-widest font-bold bg-zinc-600 text-white">Bloqueado</span>
                            <span className="text-[10px] text-gray-400 leading-snug line-clamp-2">{motivo}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex justify-center items-center gap-1.5 whitespace-nowrap">
                          {botoesDaPronta(pronta)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showForm && isCompras && !modoFinanceiro && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shrink-0">
            <div className="neu-flat rounded-2xl p-6 border border-white/5 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-gray-200">Nova Cotação</h3>
              <p className="text-[11px] text-gray-500 -mt-2">
                Ao salvar, a cotação será enviada ao <span className="text-cyan-400 font-bold">Financeiro</span> para aprovação.
              </p>
              {semFornecedor ? (
                <div className="neu-pressed rounded-2xl p-6 border border-yellow-500/30 flex flex-col items-center text-center gap-3">
                  <AlertTriangle size={22} className="text-yellow-400" />
                  <p className="text-sm font-bold text-yellow-400">
                    Nenhum fornecedor cadastrado nesta unidade.
                  </p>
                  <p className="text-xs text-gray-400 max-w-md leading-relaxed">
                    Cotação é o preço que um fornecedor informa, então só dá para abrir uma
                    depois que existir pelo menos um fornecedor cadastrado — pessoa jurídica
                    (PJ) ou pessoa física (PF).
                  </p>
                  {podeCadastrarFornecedor ? (
                    // Botão de ação de verdade (mesmo peso visual de "Nova
                    // Cotação"), não um `neu-button` apagado: aqui ele é a
                    // única saída da tela, e um botão discreto no meio de
                    // texto explicativo lê como mais uma linha do aviso.
                    <div className="mt-2">
                      <NeuButtonAccent onClick={irParaFornecedores}>
                        <Plus size={16} /> Cadastrar fornecedor
                      </NeuButtonAccent>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-500 mt-1">
                      O cadastro fica em <span className="font-bold text-gray-400">Cadastros › Fornecedores</span>
                      {temAcessoCadastros ? '.' : ', fora do seu acesso — peça à Logística.'}
                    </p>
                  )}
                </div>
              ) : requisicoesAprovadaOrdenadas.length === 0 ? (
                <p className="text-sm text-yellow-400/80 text-center py-4">Nenhuma requisição aprovada disponível. Aprove uma requisição primeiro.</p>
              ) : (
                <>
                  {/* Fila zerada some do FilaDeTrabalho, então sem esta linha a
                      tela ficava idêntica com tudo cotado e com nada cotado. */}
                  {requisicoesParaCotar.pendentes.length === 0 && (
                    <p className="text-[11px] text-emerald-400/80 -mt-2">
                      Todas as requisições aprovadas já têm proposta. Escolha uma de "Já cotadas" só se for
                      acrescentar outra proposta concorrente.
                    </p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField label="Requisição *" error={errors.requisicao_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.requisicao_id ? 'border border-red-500/40' : ''}`}
                        {...selReq.handlers}
                        value={form.requisicao_id} onChange={e => { selReq.soltar(); setForm(f => ({ ...f, requisicao_id: e.target.value })); clearError('requisicao_id'); }}>
                        <option value="">Selecione...</option>
                        {selReq.opcoes.pendentes.length > 0 && (
                          <optgroup label={`Ainda sem cotação (${selReq.opcoes.pendentes.length})`}>
                            {selReq.opcoes.pendentes.map(({ r }) => (
                              <option key={r.id} value={r.id}>{r.item} ({rotuloQtdReq(r)})</option>
                            ))}
                          </optgroup>
                        )}
                        {selReq.opcoes.cotadas.length > 0 && (
                          <optgroup label={`Já cotadas (${selReq.opcoes.cotadas.length})`}>
                            {selReq.opcoes.cotadas.map(({ r, vivas, aprovada }) => (
                              <option key={r.id} value={r.id} disabled={aprovada}>
                                {r.item} ({rotuloQtdReq(r)}) — {vivas} proposta{vivas === 1 ? '' : 's'}
                                {aprovada ? ' · aprovada, gere o pedido' : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor PJ" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        {...selPJ.handlers}
                        value={form.fornecedor_tipo === 'Empresa' ? form.fornecedor_id : ''}
                        onChange={e => { selPJ.soltar(); setForm(f => ({ ...f, fornecedor_id: e.target.value, fornecedor_tipo: e.target.value ? 'Empresa' : '' })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione um fornecedor PJ...</option>
                        {selPJ.opcoes.grupos.map(g => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((f: any) => {
                              // Duas travas diferentes, e a ordem importa: a
                              // proposta que já existe é definitiva (o banco
                              // recusa, migr. 538); a reserva é transitória
                              // (passa em 3 min, migr. 537).
                              const jaCotado = selPJ.opcoes.jaCotados.get(f.id);
                              const res = selPJ.opcoes.reservas[f.id];
                              const travado = !!res && res.usuario_id !== profile.id;
                              const rotulo = jaCotado
                                ? `✓ ${f.nome} — já cotado nesta requisição (${jaCotado})`
                                : travado
                                  ? `🔒 ${f.nome} — ${res.usuario_nome} está cotando`
                                  : f.nome;
                              return (
                                <option key={f.id} value={f.id} disabled={!!jaCotado || travado}>
                                  {rotulo}
                                </option>
                              );
                            })}
                          </optgroup>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Fornecedor PF" error={errors.fornecedor_id}>
                      <select className={`neu-input py-2 px-3 rounded-xl text-sm ${errors.fornecedor_id ? 'border border-red-500/40' : ''}`}
                        {...selPF.handlers}
                        value={form.fornecedor_tipo === 'Pessoa Física' ? form.fornecedor_id : ''}
                        onChange={e => { selPF.soltar(); setForm(f => ({ ...f, fornecedor_id: e.target.value, fornecedor_tipo: e.target.value ? 'Pessoa Física' : '' })); clearError('fornecedor_id'); }}>
                        <option value="">Selecione um fornecedor PF...</option>
                        {selPF.opcoes.grupos.map(g => (
                          <optgroup key={g.label} label={g.label}>
                            {g.items.map((f: any) => {
                              // Duas travas diferentes, e a ordem importa: a
                              // proposta que já existe é definitiva (o banco
                              // recusa, migr. 538); a reserva é transitória
                              // (passa em 3 min, migr. 537).
                              const jaCotado = selPF.opcoes.jaCotados.get(f.id);
                              const res = selPF.opcoes.reservas[f.id];
                              const travado = !!res && res.usuario_id !== profile.id;
                              const rotulo = jaCotado
                                ? `✓ ${f.nome} — já cotado nesta requisição (${jaCotado})`
                                : travado
                                  ? `🔒 ${f.nome} — ${res.usuario_nome} está cotando`
                                  : f.nome;
                              return (
                                <option key={f.id} value={f.id} disabled={!!jaCotado || travado}>
                                  {rotulo}
                                </option>
                              );
                            })}
                          </optgroup>
                        ))}
                      </select>
                    </FormField>
                    {/* Atalho permanente: a lista pode ter fornecedor e ainda
                        assim faltar justo o que o aluno precisa cotar, e o
                        caminho de volta (sair da tela, achar Cadastros, voltar
                        e refazer o formulário) custa o formulário inteiro. */}
                    {podeCadastrarFornecedor && (
                      <div className="md:col-span-3 -mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                        {!temPJ && <span className="text-[11px] text-yellow-400/90">Nenhum fornecedor PJ cadastrado.</span>}
                        {!temPF && <span className="text-[11px] text-yellow-400/90">Nenhum fornecedor PF cadastrado.</span>}
                        <span className="text-[11px] text-gray-500">Falta o fornecedor na lista?</span>
                        {/* Contorno e fundo: como texto sublinhado no meio da
                            frase, isto lia como nota de rodapé e o aluno
                            passava batido. */}
                        <button type="button" onClick={irParaFornecedores}
                          className="neu-button rounded-xl py-1.5 px-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-accent border border-accent/30 hover:bg-accent/10 transition-colors">
                          <Plus size={12} /> Cadastrar fornecedor
                        </button>
                      </div>
                    )}
                    {reserva.travado && (
                      <p className="text-[11px] text-yellow-400 md:col-span-3 -mt-2">
                        🔒 {reserva.dono?.usuario_nome} já está cotando este fornecedor para esta requisição agora.
                        Escolha outro fornecedor ou espere.
                      </p>
                    )}
                    {/* Histórico de quem foi escolhido, ainda no formulário: o
                        prazo prometido abaixo vale o que o fornecedor costuma
                        cumprir. */}
                    {desempenhoDisponivel && form.fornecedor_id && (
                      <div className="flex flex-col gap-1 justify-end pb-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                          Histórico de entrega
                        </span>
                        <SeloDesempenho d={desempenho[form.fornecedor_id]} />
                      </div>
                    )}
                    {/* Quantidade não é digitada aqui: ela é da requisição.
                        Mostrar em cinza tira a conta da cabeça do comprador e
                        deixa claro sobre quantas unidades o preço incide. */}
                    {reqSelecionada && (
                      <FormField label="Quantidade solicitada">
                        <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300 tabular-nums">
                          {temQtd ? `${qtdBR(qtdReq)} ${unidadeReq}` : '—'}
                          {/* Migr. 589: em que embalagem o setor pediu. O
                              fornecedor fala nessa medida, e é ela que o
                              comprador tem na frente ao telefone. */}
                          {embReq && (
                            <span className="block text-[10px] text-accent/90 mt-0.5">
                              {qtdBR(embReq.qtd)} {pluralEmbalagem(embReq.nome, embReq.qtd)} de {qtdBR(embReq.fator)} {unidadeReq}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Quem pediu definiu a medida. Cotar é dar preço para esta quantidade — não para outra.
                        </p>
                      </FormField>
                    )}
                    {/* O ÚNICO campo de preço que se digita, na medida em que o
                        fornecedor fala: "R$ 135,00 o fardo" com embalagem
                        fechada (migr. 589), "R$ 4,50 a unidade" sem ela. O
                        resto é conta, e conta não se digita. */}
                    {fonte && (
                      <FormField label={fonte.label}>
                        <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                          value={extras.valor_fonte}
                          onChange={e => { setFonte(e.target.value); setErrosExtras(x => ({ ...x, valor_total: undefined })); }}
                          onKeyDown={handleMoneyKeyDown}
                          placeholder="0,00" />
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          {/* Sem adjetivo: "caixa" é feminino e "fardo" masculino. */}
                          {embReq
                            ? `O que o fornecedor cobra por 1 ${embReq.nome} de ${qtdBR(embReq.fator)} ${unidadeReq}. O total sai daqui × ${qtdBR(embReq.qtd)}.`
                            : `O preço de uma ${unidadeReq}. O total sai daqui × ${qtdBR(qtdReq)}.`}
                        </p>
                      </FormField>
                    )}
                    {/* Unitário só aparece quando NÃO é a fonte — senão seria o
                        mesmo campo duas vezes. É leitura: sai do total, com as
                        casas que a divisão pedir, e é o número que compara duas
                        propostas de embalagens diferentes. */}
                    {embReq && (
                      <FormField label={`Valor Unitário (R$ / ${unidadeReq})`}>
                        <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300 tabular-nums">
                          {precoUnitario(parseBRL(extras.valor_total), qtdReq) || '—'}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Resultado, não campo: o total dividido por {qtdBR(qtdReq)} {unidadeReq}. É assim que duas propostas se comparam.
                        </p>
                      </FormField>
                    )}
                    <FormField label="Valor Total (R$) *" error={errosExtras.valor_total}>
                      <input type="text" inputMode="numeric"
                        className={`neu-input py-2 px-3 rounded-xl text-sm ${errosExtras.valor_total ? 'border border-red-500/40' : ''}`}
                        value={extras.valor_total}
                        onChange={e => { setTotal(e.target.value); setErrosExtras(x => ({ ...x, valor_total: undefined })); }}
                        onKeyDown={handleMoneyKeyDown}
                        placeholder="0,00" />
                      {/* Mexer no total é legítimo (frete, desconto fechado),
                          mas deixa de ser a conta da fonte — e isso tem de
                          estar dito na tela, não descoberto depois no pedido. */}
                      {temAjuste ? (
                        <p className="text-[10px] text-amber-400 mt-1 leading-relaxed">
                          Ajustado à mão: a conta dava R$ {formatBRL(totalBase)} ({extras.valor_fonte} × {qtdBR(fonte!.mult)}),
                          {' '}{ajusteTotal > 0 ? 'com R$ ' : 'menos R$ '}{formatBRL(Math.abs(ajusteTotal))}{ajusteTotal > 0 ? ' a mais' : ''}.
                          {' '}Frete ou desconto fechado entram assim — na prática o total sai a
                          {' '}R$ {precoUnitario(parseBRL(extras.valor_total), qtdReq)} por {unidadeReq}.
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          {fonte
                            ? 'Calculado pela quantidade da requisição. É este valor que vai ao Financeiro — frete ou desconto fechado você digita aqui.'
                            : 'Escolha a requisição para o total ser calculado pela quantidade.'}
                        </p>
                      )}
                    </FormField>
                    <FormField label="Prazo de Entrega">
                      <input type="date" className={`neu-input py-2 px-3 rounded-xl text-sm ${prazoEstoura ? 'border border-red-500/40' : ''}`}
                        value={extras.prazo_entrega} onChange={e => setExtras(x => ({ ...x, prazo_entrega: e.target.value }))} />
                      {/* Duas datas parecidas viram uma só na cabeça de quem
                          preenche se o alvo não estiver à vista. A da
                          requisição é a DEMANDA (quando eu preciso); esta é a
                          OFERTA (quando o fornecedor promete). Comparar as duas
                          é metade do critério de compra — a outra é o preço. */}
                      {reqSelecionada?.data_necessidade ? (
                        <p className={`text-[10px] mt-1 leading-relaxed ${prazoEstoura ? 'text-red-400' : 'text-gray-500'}`}>
                          {prazoEstoura
                            ? `Entrega depois do necessário (${dataBR(reqSelecionada.data_necessidade)}). Dá para enviar assim mesmo — o Financeiro decide se o preço compensa o atraso.`
                            : `A requisição precisa do item até ${dataBR(reqSelecionada.data_necessidade)}.`}
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Quando o fornecedor promete entregar — não é a data em que a requisição precisa do item.
                        </p>
                      )}
                    </FormField>
                    <FormField label="Validade da Proposta *" error={errosExtras.validade}>
                      <input type="date" min={todayBR()}
                        className={`neu-input py-2 px-3 rounded-xl text-sm ${errosExtras.validade ? 'border border-red-500/40' : ''}`}
                        value={extras.validade}
                        onChange={e => { setExtras(x => ({ ...x, validade: e.target.value })); setErrosExtras(x => ({ ...x, validade: undefined })); }} />
                      {/* Preço de fornecedor vence. Depois desta data o
                          Financeiro não aprova (migr. 583) — a saída é devolver
                          para Compras revalidar, que é o que se faz na rua. */}
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        Até quando o fornecedor garante este preço. Passou disso, o Financeiro devolve para revalidar.
                      </p>
                    </FormField>
                    {/* MIGR 584. Prazo é negociação, não detalhe: duas
                        propostas de mesmo valor não são a mesma compra se uma
                        é à vista e a outra é 30/60/90. Daqui saem os
                        vencimentos dos títulos no contas a pagar. */}
                    <FormField label="Condição de pagamento *">
                      <select className="neu-input py-2 px-3 rounded-xl text-sm"
                        value={extras.condicao_pagamento}
                        onChange={e => setExtras(x => ({ ...x, condicao_pagamento: e.target.value }))}>
                        {CONDICOES_PAGAMENTO.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        {(() => {
                          const n = parcelasDaCondicao(extras.condicao_pagamento);
                          const base = extras.prazo_entrega
                            ? `a partir da entrega (${dataBR(extras.prazo_entrega)})`
                            : 'a partir da entrega prevista';
                          return extras.condicao_pagamento === 'À vista'
                            ? `Vira 1 título vencendo ${base}.`
                            : `Vira ${n} ${n > 1 ? 'títulos' : 'título'} no contas a pagar, contados ${base}.`;
                        })()}
                      </p>
                    </FormField>
                    {/* Marca (migr. 526). Na eventual é campo da proposta; na
                        reposição é o que o catálogo já diz, em cinza. */}
                    {form.requisicao_id && (ehEventual ? (
                      <FormField label="Marca oferecida">
                        <input list="marcas-conhecidas" className="neu-input py-2 px-3 rounded-xl text-sm"
                          value={extras.marca}
                          onChange={e => setExtras(x => ({ ...x, marca: e.target.value }))}
                          placeholder="Ex.: Foxton" />
                        {reqSelecionada?.marca && (
                          <p className="text-[10px] text-cyan-400/80 mt-1 leading-relaxed">
                            Marca pedida na requisição: <span className="font-bold">{reqSelecionada.marca}</span>.
                            Propor outra é legítimo — só deixe explícito aqui, porque é isso que o Financeiro compara.
                          </p>
                        )}
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Compra eventual: o item ainda não está no catálogo, e a marca faz parte do que
                          está sendo oferecido. Quem cadastrar o produto depois recebe esta marca já
                          preenchida — se esta for a proposta aprovada.
                        </p>
                      </FormField>
                    ) : (
                      <FormField label="Marca">
                        <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">
                          {produtoDaReq?.marca || '—'}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                          Reposição: a marca é a do produto do catálogo. Proposta de outra marca não é a
                          mesma compra — é outro item, e pede outra requisição.
                        </p>
                      </FormField>
                    ))}
                    {/* MIGR 583. Proposta real não é só um número: vem com
                        frete, garantia, prazo de troca. Sem lugar para isso, o
                        aluno comparava dois preços fingindo que as condições
                        eram iguais — e é aqui que a diferença dos três nichos
                        aparece sem precisar de campo por nicho. */}
                    <FormField label="Condições / observações do fornecedor">
                      <textarea maxLength={240}
                        className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-[42px] md:col-span-2"
                        value={extras.observacao}
                        onChange={e => setExtras(x => ({ ...x, observacao: e.target.value }))}
                        placeholder="Ex.: frete incluso; garantia de 12 meses; troca em até 7 dias" />
                      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                        O que veio junto do preço. Duas propostas com o mesmo valor podem não ser a mesma compra.
                      </p>
                    </FormField>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeForm} className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">Cancelar</button>
                    <NeuButtonAccent onClick={handleSave} isLoading={isSaving}>
                      <Send size={14} /> Enviar ao Financeiro
                    </NeuButtonAccent>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {abaAtiva !== 'cotacoes' ? null : isLoading ? <LoadingSpinner /> : enrichedFiltered.length === 0 ? <EmptyState message="Nenhuma cotação encontrada" /> : (
        <div className="neu-flat rounded-3xl p-4 sm:p-6 border border-white/5 flex flex-col mb-6">
          <div className="overflow-x-auto main-scrollbar">
            {/* Sete colunas. Prazo de entrega e validade dividem uma célula
                (as duas são datas da proposta); o feedback do Financeiro saiu
                da coluna própria, quase sempre vazia, e virou o balão nas ações. */}
            <table className="tabela w-full text-left border-collapse">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Item</th>
                  <th className="text-center w-56">Fornecedor</th>
                  <th className="text-center w-28">Qtd</th>
                  <th className="text-center w-32">Valor</th>
                  <th className="text-center w-36">Prazos</th>
                  <th className="text-center w-36">Situação</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {enrichedFiltered.map((item: any) => {
                    const vivo = STATUS_VIVOS.has(item.status);
                    const vencida = vivo && propostaVencida(item.validade);
                    const atrasa = !!(item.prazo_entrega && item.req?.data_necessidade && item.prazo_entrega > item.req.data_necessidade);
                    const nPropostas = item.requisicao_id ? (propostasPorRequisicao.get(item.requisicao_id) ?? []).length : 0;
                    // Compras cancela enquanto a proposta está viva e sem decisão —
                    // inclui a devolvida, senão a que nasceu errada ficaria presa.
                    const podeCancelar = ['Aguardando Financeiro', 'Em correção'].includes(item.status) && isCompras;
                    const temMenu = podeCancelar || profile.role === 'admin' || (podeReabrirDoc && ['Negado', 'Cancelado'].includes(item.status));
                    return (
                    <motion.tr key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      className="border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle">
                      <td className="py-3 px-3 min-w-[14rem]">
                        {/* A cotação tem número próprio e cita a requisição de
                            onde nasceu: as duas pontas da conversa entre Compras
                            e Financeiro numa linha só. */}
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-credencial text-[10px] tracking-wider whitespace-nowrap">
                          <span className="text-accent/70">{numeroCotacao(item)}</span>
                          {item.req && <span className="text-gray-600">← {numeroRequisicao(item.req)}</span>}
                        </span>
                        <span className="block text-sm font-semibold text-gray-100 leading-snug mt-1 line-clamp-2 break-words" title={item.req?.item ?? ''}>
                          {item.req?.item ?? '—'}
                          {/* Migr. 526: sem isto, duas propostas de marcas
                              diferentes apareciam como o mesmo item. */}
                          {item.marca && <span className="text-xs text-gray-500 font-normal"> · {item.marca}</span>}
                        </span>
                        {nPropostas > 1 && (
                          <button
                            onClick={() => setComparando(item.requisicao_id)}
                            title="Comparar propostas concorrentes"
                            className="mt-1.5 neu-button px-2 py-0.5 rounded-full text-[10px] font-bold text-cyan-300 hover:bg-cyan-400/10 border border-cyan-400/20 inline-flex items-center gap-1"
                          >
                            <GitCompare size={10} /> {nPropostas} propostas
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="block text-xs text-gray-300 line-clamp-2 max-w-[13rem] mx-auto" title={item.forn?.nome ?? ''}>
                          {item.forn?.nome ?? '—'}
                        </span>
                        {desempenhoDisponivel && item.fornecedor_id && (
                          <span className="flex justify-center mt-0.5">
                            <SeloDesempenho d={desempenho[item.fornecedor_id]} compacto />
                          </span>
                        )}
                        {item.observacao && (
                          <span className="block text-[10px] text-gray-500 truncate max-w-[13rem] mx-auto" title={item.observacao}>
                            {item.observacao}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {item.req ? (
                          <>
                            <span className="text-sm font-semibold text-gray-200 tabular-nums">{qtdBR(item.req.qtd)}</span>
                            <span className="text-[10px] text-gray-500 ml-1 uppercase">{normalizarUnidade(item.req.unidade)}</span>
                            {Number(item.req.qtd_embalagens ?? 0) > 0 && item.req.embalagem_nome && (
                              <span className="block text-[10px] text-gray-500 leading-tight">
                                {qtdBR(item.req.qtd_embalagens)} {pluralEmbalagem(item.req.embalagem_nome, Number(item.req.qtd_embalagens)).toLowerCase()}
                              </span>
                            )}
                          </>
                        ) : <span className="text-xs text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="block text-sm font-semibold text-gray-100 tabular-nums">R$ {formatBRL(Number(item.valor_total ?? 0))}</span>
                        {/* Preço sem prazo é meia informação: o Financeiro
                            decide com os dois na mesma célula. */}
                        {item.condicao_pagamento && (
                          <CondicaoCompra condicao={item.condicao_pagamento} />
                        )}
                      </td>
                      {/* Entrega em vermelho quando passa da data em que a
                          requisição precisa do item: é o que separa a proposta
                          barata da proposta útil. Validade vencida em vermelho
                          porque o Financeiro não aprova depois dela (migr. 583). */}
                      <td className="py-3 px-3 text-center whitespace-nowrap text-[11px] leading-relaxed">
                        <span className="block"
                          title={item.req?.data_necessidade ? `Necessário até ${dataBR(item.req.data_necessidade)}` : undefined}>
                          <span className="text-gray-500">Entrega </span>
                          <span className={`font-mono ${atrasa ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                            {item.prazo_entrega ? dataBR(item.prazo_entrega).slice(0, 5) : '—'}
                          </span>
                        </span>
                        <span className="block"
                          title={vencida ? 'Preço vencido: o Financeiro não aprova. Devolva para Compras revalidar.' : undefined}>
                          <span className="text-gray-500">{vencida ? 'Venceu ' : 'Vale até '}</span>
                          <span className={`font-mono ${vencida ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                            {item.validade ? dataBR(item.validade).slice(0, 5) : '—'}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <StatusBadge status={item.status} solido />
                        {item.status === 'Aguardando Financeiro' && (() => {
                          const a = alcadaLabel(item);
                          return (
                            <span className={`block w-fit mx-auto mt-1 px-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest border ${a.color}`}
                              title={alcadaLimite !== null ? `Alçada: limite Financeiro R$ ${formatBRL(alcadaLimite)}` : 'Alçada não configurada'}>
                              {a.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-3">
                        {/* Abaixo de 2xl os botões de decisão viram só o ícone,
                            com o mesmo `title` — três rótulos somam mais largura
                            do que a coluna merece. */}
                        <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                          {item.status === 'Aguardando Financeiro' && podeDecidirCotacao(item) && (
                            <>
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'aprovar' }); setFeedbackInput(''); }}
                                title="Aprovar a proposta"
                                className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-emerald-400 hover:bg-emerald-400/10">
                                <Check size={12} /> <span className="hidden 2xl:inline">Aprovar</span>
                              </button>
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'reprovar' }); setFeedbackInput(''); }}
                                title="Reprovar a proposta"
                                className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-red-400 hover:bg-red-400/10">
                                <X size={12} /> <span className="hidden 2xl:inline">Reprovar</span>
                              </button>
                              {/* Erro de digitação não é recusa do fornecedor:
                                  devolve para quem cadastrou em vez de matar a
                                  proposta (migr. 467). */}
                              <button onClick={() => { setDecisao({ cot: item, tipo: 'devolver' }); setFeedbackInput(''); }}
                                title="Devolver para Compras corrigir — a proposta continua viva"
                                className="neu-button rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 h-8 w-8 2xl:w-auto 2xl:px-3 justify-center transition-colors text-amber-400 hover:bg-amber-400/10">
                                <CornerUpLeft size={12} /> <span className="hidden 2xl:inline">Devolver</span>
                              </button>
                            </>
                          )}
                          {item.status === 'Em correção' && podeCorrigir(item) && (
                            <button onClick={() => abrirCorrecao(item)}
                              title="Corrigir e reenviar ao Financeiro"
                              className="action-btn-laranja">
                              <Pencil size={13} />
                            </button>
                          )}
                          {/* Compras: cancelar enquanto a proposta está viva e
                              sem decisão — inclui a devolvida, senão a que
                              nasceu errada ficaria presa em correção. */}
                            <MenuMais>
                              {fechar => (
                                <>
                                  {/* O que o Financeiro escreveu — era uma coluna
                                      inteira, quase sempre vazia; na correção,
                                      o próprio modal já mostra. */}
                                  {item.feedback && (
                                    <ItemMenu onClick={() => { fechar(); setFeedbackAberto(item.feedback); }}
                                      cor="text-gray-200 hover:bg-white/5" icon={MessageSquare}>
                                      Ver feedback do Financeiro
                                    </ItemMenu>
                                  )}
                                  <HistoricoOperacoes variante="menu" onAbrir={fechar} entidade="cotacoes" entidadeId={item.id} titulo={`${numeroCotacao(item)} · ${item.req?.item ?? 'Cotação'}`} criadoEm={item.created_at} atualizadoEm={item.updated_at} />
                                  {podeCancelar && (
                                    <ItemMenu onClick={() => { fechar(); handleCancelar(item.id); }}
                                      cor="text-amber-400 hover:bg-amber-500/10" icon={Ban}>
                                      Cancelar envio
                                    </ItemMenu>
                                  )}
                                  {/* Reabrir — só a direção, e só no que já saiu da fila */}
                                  {podeReabrirDoc && ['Negado', 'Cancelado'].includes(item.status) && (
                                    <ItemMenu onClick={() => { fechar(); handleReabrirCot(item); }} disabled={reabrindoCot === item.id}
                                      cor="text-amber-400 hover:bg-amber-500/10" icon={RotateCcw}>
                                      Reabrir para o Financeiro
                                    </ItemMenu>
                                  )}
                                  {profile.role === 'admin' && (
                                    <ExcluirAdmin variante="menu" endpoint="/api/cotacoesview" id={item.id}
                                      rotulo={numeroCotacao(item)} showToast={showToast}
                                      alternativa="cancele a cotação — ela sai da fila e o preço do fornecedor fica registrado."
                                      onExcluido={() => reload()} />
                                  )}
                                </>
                              )}
                            </MenuMais>
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

      {/* Modal de comparação de propostas concorrentes (mesma requisição) */}
      <AnimatePresence>
        {comparando && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
            onClick={() => setComparando(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-gray-300">
                    Comparar propostas
                    <span className="text-accent ml-2">
                      — {requisicoes.find((r: any) => r.id === comparando)?.item ?? 'requisição'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {propostasDoModal.length} proposta(s) registrada(s). A menor entre as vivas está destacada —
                    confira a coluna de entrega antes de decidir só pelo preço.
                    {/* O alvo do prazo fica no cabeçalho da comparação, não só
                        na linha: é aqui que a escolha é feita. */}
                    {(() => {
                      const dn = requisicoes.find((r: any) => r.id === comparando)?.data_necessidade;
                      return dn ? <> Necessário até <span className="text-gray-300 font-bold">{dataBR(dn)}</span> — prazo em vermelho não chega a tempo.</> : null;
                    })()}
                  </p>
                </div>
                <button onClick={() => setComparando(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>

              {/* Modal tem altura travada em 85vh: aqui o scroll interno é o
                  certo, diferente da lista da página. */}
              <div className="overflow-auto main-scrollbar flex-1">
                <table className="tabela w-full text-left border-collapse">
                  <thead>
                    <tr className={CABECALHO_TABELA}>
                      <th className="pb-3 font-bold px-3">Fornecedor</th>
                      {/* Migr. 526: comparar preço sem ver a marca é comparar
                          coisas diferentes como se fossem a mesma. */}
                      <th className="pb-3 font-bold px-3">Marca</th>
                      <th className="pb-3 font-bold px-3 text-right">Valor</th>
                      <th className="pb-3 font-bold px-3">Pagamento</th>
                      <th className="pb-3 font-bold px-3">Entrega no prazo</th>
                      <th className="pb-3 font-bold px-3">Prazo</th>
                      <th className="pb-3 font-bold px-3">Validade</th>
                      <th className="pb-3 font-bold px-3 text-center">Status</th>
                      {podeDecidir && <th className="pb-3 font-bold px-3 text-right">Ação</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {propostasDoModal.map((c: any) => {
                      const isVivo = STATUS_VIVOS.has(c.status);
                      const isMenor = isVivo && menorPrecoDoModal !== null && Number(c.valor_total ?? 0) === menorPrecoDoModal;
                      return (
                        <tr key={c.id}
                          className={`border-b border-accent/10 ${isMenor ? 'bg-emerald-400/5' : ''} ${!isVivo ? 'opacity-50' : ''}`}>
                          <td className="py-2.5 px-3 text-xs text-gray-200">
                            <div className="flex items-center gap-1.5">
                              {isMenor && <span title="Menor preço"><Award size={12} className="text-emerald-400 shrink-0" /></span>}
                              {c.forn?.nome ?? '—'}
                            </div>
                            {/* O menor preço pode ser o mais caro: frete e
                                garantia entram aqui, e é isto que separa duas
                                propostas de mesmo valor (migr. 583). */}
                            {c.observacao && (
                              <span className="block text-[10px] text-gray-500 mt-0.5 max-w-[16rem]">{c.observacao}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-300">
                            {c.marca || <span className="text-gray-600">—</span>}
                          </td>
                          <td className={`py-2.5 px-3 text-xs font-mono text-right tabular-nums ${isMenor ? 'text-emerald-300 font-bold' : 'text-gray-200'}`}>
                            R$ {formatBRL(Number(c.valor_total ?? 0))}
                          </td>
                          {/* O menor preço à vista pode custar mais caro que o
                              maior em 30/60/90 — quem paga a diferença é o
                              caixa da unidade. */}
                          <td className="py-2.5 px-3 text-xs text-gray-300">
                            {c.condicao_pagamento || <span className="text-gray-600">—</span>}
                          </td>
                          <td className="py-2.5 px-3">
                            {desempenhoDisponivel && c.fornecedor_id
                              ? <SeloDesempenho d={desempenho[c.fornecedor_id]} />
                              : <span className="text-[10px] text-gray-600">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-400">
                            {c.prazo_entrega ? (
                              <span className={c.req?.data_necessidade && c.prazo_entrega > c.req.data_necessidade
                                ? 'text-red-400' : ''}>
                                {dataBR(c.prazo_entrega)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-xs font-mono">
                            {c.validade ? (
                              <span className={propostaVencida(c.validade) && STATUS_VIVOS.has(c.status)
                                ? 'text-red-400 font-bold' : 'text-gray-500'}>
                                {dataBR(c.validade)}
                                {propostaVencida(c.validade) && STATUS_VIVOS.has(c.status) && ' · vencida'}
                              </span>
                            ) : <span className="text-gray-500">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center"><StatusBadge status={c.status} solido /></td>
                          {podeDecidir && (
                            <td className="py-2.5 px-3 text-right">
                              {c.status === 'Aguardando Financeiro' && podeDecidirCotacao(c) && (
                                <button
                                  onClick={() => {
                                    setComparando(null);
                                    setDecisao({ cot: c, tipo: 'aprovar' });
                                    setFeedbackInput('');
                                  }}
                                  className="neu-button py-1 px-2.5 rounded-lg text-[11px] font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors inline-flex items-center gap-1"
                                >
                                  <Check size={10} /> Aprovar
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end mt-4 shrink-0">
                <button onClick={() => setComparando(null)}
                  className="neu-button py-2 px-5 rounded-xl text-sm text-gray-400">
                  Fechar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de decisão do Financeiro */}
      <AnimatePresence>
        {decisao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !decidindo && setDecisao(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  {decisao.tipo === 'aprovar' ? 'Aprovar cotação'
                    : decisao.tipo === 'reprovar' ? 'Reprovar cotação'
                    : 'Devolver para correção'}
                  <span className="text-accent ml-2">— {decisao.cot.forn?.nome ?? 'fornecedor'}</span>
                </h3>
                <button onClick={() => !decidindo && setDecisao(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                {decisao.tipo === 'aprovar'
                  ? 'Aprovar enviará a cotação para o setor de Compras para gerar o pedido. Cotações concorrentes da mesma requisição serão automaticamente canceladas.'
                  : decisao.tipo === 'reprovar'
                  ? 'Informe o motivo da reprovação. O setor de Compras será notificado para ajustar e criar uma nova cotação.'
                  : 'A proposta volta para quem a cadastrou, que corrige e reenvia — nada é recusado e nenhuma concorrente é cancelada. Use quando o problema é o preenchimento (valor digitado errado, prazo em branco), não a oferta do fornecedor.'}
              </p>

              {decisao.tipo === 'devolver' && (() => {
                const req = decisao.cot.req ?? requisicoes.find((r: any) => r.id === decisao.cot.requisicao_id);
                return (
                  <div className="neu-inset rounded-xl p-3 mb-4 border border-amber-400/15 text-xs text-gray-300">
                    <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">Erro no item?</p>
                    O item <b>{req?.item ?? '—'}</b> é da requisição {req ? numeroRequisicao(req) : ''}, não desta
                    proposta — quem corrige a cotação não consegue mudar o nome, a marca pedida nem a quantidade.
                    Se o erro é no item, <b>reprove</b> esta cotação e peça a correção em Compras → Requisições de
                    Compra (Compras ou o gerente); depois cota-se de novo.
                  </div>
                );
              })()}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="cot-feedback" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {decisao.tipo === 'reprovar' ? 'Motivo da reprovação *'
                    : decisao.tipo === 'devolver' ? 'O que corrigir *'
                    : 'Observação (opcional)'}
                </label>
                <textarea id="cot-feedback" rows={3}
                  value={feedbackInput} onChange={e => setFeedbackInput(e.target.value)}
                  placeholder={decisao.tipo === 'reprovar'
                    ? 'Ex.: valor acima do orçamento previsto para este trimestre.'
                    : decisao.tipo === 'devolver'
                    ? 'Ex.: o valor está R$ 1.200,00 e a proposta do fornecedor é R$ 120,00 — confira a vírgula.'
                    : 'Ex.: prazo conforme combinado, fornecedor confiável.'}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setDecisao(null)} disabled={decidindo}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleConfirmDecisao} disabled={decidindo}>
                  {decidindo
                    ? 'Salvando...'
                    : decisao.tipo === 'aprovar' ? 'Confirmar aprovação'
                    : decisao.tipo === 'reprovar' ? 'Confirmar reprovação'
                    : 'Devolver para correção'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de correção — Compras arruma o que foi devolvido */}
      <AnimatePresence>
        {correcao && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !reenviando && setCorrecao(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-lg">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-300">
                  Corrigir e reenviar
                  <span className="text-accent ml-2">— {correcao.forn?.nome ?? 'fornecedor'}</span>
                </h3>
                <button onClick={() => !reenviando && setCorrecao(null)}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              {correcao.feedback && (
                <div className="neu-inset rounded-xl p-3 mb-4 border border-amber-400/15">
                  <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">O que pediram para corrigir</p>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{correcao.feedback}</p>
                </div>
              )}

              <p className="text-xs text-gray-500 mb-4">
                Fornecedor e requisição não mudam aqui: trocar de fornecedor é outra proposta, não
                correção desta. Ao reenviar, a cotação volta para a fila do Financeiro.
              </p>

              {reqCorrecao && (
                <div className="mb-4">
                  <FormField label={`Item — da requisição ${numeroRequisicao(reqCorrecao)}`}>
                    <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300">
                      {reqCorrecao.item}{reqCorrecao.marca ? ` · ${reqCorrecao.marca}` : ''}
                    </div>
                  </FormField>
                  <p className="text-[10px] text-gray-500 mt-1">
                    O nome do item não se corrige aqui, nem na observação: ele é da requisição, e é o que
                    segue para o pedido e para o cadastro do produto. Se pediram para mudar o item, fale com
                    Compras ou o gerente — a correção é em Compras → Requisições de Compra, com esta cotação
                    cancelada antes.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {qtdCorrecao > 0 && (
                  <FormField label="Quantidade solicitada">
                    <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300 tabular-nums">
                      {`${qtdBR(qtdCorrecao)} ${unidadeCorrecao}`}
                      {embCorrecao && (
                        <span className="block text-[10px] text-accent/90 mt-0.5">
                          {qtdBR(embCorrecao.qtd)} {pluralEmbalagem(embCorrecao.nome, embCorrecao.qtd)} de {qtdBR(embCorrecao.fator)} {unidadeCorrecao}
                        </span>
                      )}
                    </div>
                  </FormField>
                )}
                {/* Migr. 589: o preço na medida em que o fornecedor fala — e o
                    único campo de preço digitável. */}
                {fonteCorrecao && (
                  <FormField label={fonteCorrecao.label}>
                    <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={correcaoForm.valor_fonte}
                      onChange={e => setCorrecaoFonte(e.target.value)}
                      onKeyDown={handleMoneyKeyDown}
                      placeholder="0,00" />
                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                      {embCorrecao
                        ? `Por 1 ${embCorrecao.nome} de ${qtdBR(embCorrecao.fator)} ${unidadeCorrecao}. O total sai daqui × ${qtdBR(embCorrecao.qtd)}.`
                        : `O preço de uma ${unidadeCorrecao}. O total sai daqui × ${qtdBR(qtdCorrecao)}.`}
                    </p>
                  </FormField>
                )}
                {embCorrecao && (
                  <FormField label={`Valor Unitário (R$ / ${unidadeCorrecao})`}>
                    <div className="neu-pressed py-2 px-3 rounded-xl text-sm text-gray-300 tabular-nums">
                      {precoUnitario(parseBRL(correcaoForm.valor_total), qtdCorrecao) || '—'}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                      Resultado, não campo: o total dividido por {qtdBR(qtdCorrecao)} {unidadeCorrecao}.
                    </p>
                  </FormField>
                )}
                <FormField label="Valor Total (R$)">
                  <input type="text" inputMode="numeric" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.valor_total}
                    onChange={e => setCorrecaoTotal(e.target.value)}
                    onKeyDown={handleMoneyKeyDown}
                    placeholder="0,00" />
                  {temAjusteCorrecao ? (
                    <p className="text-[10px] text-amber-400 mt-1 leading-relaxed">
                      Ajustado à mão: a conta dava R$ {formatBRL(totalBaseCorrecao)} ({correcaoForm.valor_fonte} × {qtdBR(fonteCorrecao!.mult)}),
                      {' '}{ajusteCorrecao > 0 ? 'com R$ ' : 'menos R$ '}{formatBRL(Math.abs(ajusteCorrecao))}{ajusteCorrecao > 0 ? ' a mais' : ''}.
                      {' '}Na prática o total sai a R$ {precoUnitario(parseBRL(correcaoForm.valor_total), qtdCorrecao)} por {unidadeCorrecao}.
                    </p>
                  ) : qtdCorrecao > 0 && (
                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                      É este valor que volta ao Financeiro. Frete ou desconto fechado você digita aqui.
                    </p>
                  )}
                </FormField>
                <FormField label="Prazo de Entrega">
                  <input type="date" className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.prazo_entrega}
                    onChange={e => setCorrecaoForm(x => ({ ...x, prazo_entrega: e.target.value }))} />
                </FormField>
                <FormField label="Validade da Proposta *">
                  <input type="date" min={todayBR()}
                    className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.validade}
                    onChange={e => setCorrecaoForm(x => ({ ...x, validade: e.target.value }))} />
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                    Reenviar é revalidar: confirme com o fornecedor até quando o preço vale.
                  </p>
                </FormField>
                {/* Migr. 526: só na eventual. Na reposição o campo nem existe
                    na proposta — a marca é do produto do catálogo. */}
                {!correcao.req?.produto_id && (
                  <FormField label="Marca oferecida">
                    <input list="marcas-conhecidas" className="neu-input py-2 px-3 rounded-xl text-sm"
                      value={correcaoForm.marca}
                      onChange={e => setCorrecaoForm(x => ({ ...x, marca: e.target.value }))}
                      placeholder="Ex.: Foxton" />
                  </FormField>
                )}
                <FormField label="Condição de pagamento *">
                  <select className="neu-input py-2 px-3 rounded-xl text-sm"
                    value={correcaoForm.condicao_pagamento}
                    onChange={e => setCorrecaoForm(x => ({ ...x, condicao_pagamento: e.target.value }))}>
                    {CONDICOES_PAGAMENTO.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormField>
                <div className="sm:col-span-3">
                  <FormField label="Condições / observações do fornecedor">
                    <textarea maxLength={240}
                      className="neu-input py-2 px-3 rounded-xl text-sm resize-none h-[42px] w-full"
                      value={correcaoForm.observacao}
                      onChange={e => setCorrecaoForm(x => ({ ...x, observacao: e.target.value }))}
                      placeholder="Ex.: frete incluso; garantia de 12 meses" />
                  </FormField>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setCorrecao(null)} disabled={reenviando}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest neu-button text-gray-400 hover:text-gray-200 disabled:opacity-50">
                  Cancelar
                </button>
                <NeuButtonAccent onClick={handleReenviarCorrigida} isLoading={reenviando}>
                  <Send size={14} /> Reenviar ao Financeiro
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {feedbackAberto && (
        <TextoModal titulo="Feedback do Financeiro" texto={feedbackAberto}
          onClose={() => setFeedbackAberto(null)} />
      )}
    </motion.div>
  );
};

export const CotacoesView = ({ showToast, profile, mode, onNavigate }: { showToast: any; profile: UserProfile; mode?: 'compras' | 'financeiro'; onNavigate?: (view: string) => void }) => {
  const { filialAtiva } = useFilial();
  if (!filialAtiva) return <SelecioneUnidade oQue="A cotação com fornecedores" />;
  return <CotacoesViewInner showToast={showToast} profile={profile} filial={filialAtiva} mode={mode} onNavigate={onNavigate} />;
};
