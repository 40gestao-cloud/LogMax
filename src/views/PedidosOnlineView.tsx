import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, X, Check, Ban, ChevronDown, Store, Link2, ExternalLink, Package, Search, AlertTriangle, Settings, Trash2, Plus, Loader2 } from 'lucide-react';
import { MenuMais, ItemMenu, CABECALHO_TABELA } from '../components/MenuMais';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { useFetchData, dbUpdate, dbDelete } from '../hooks/useSupabaseData';
import { ehVendavel } from '../lib/tipoProduto';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent, CardContador, type TomContador, AbaComContador, type CorAba, ProdutoThumb } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';
import { formatBRL, parseBRL } from '../lib/viewUtils';
import { SelectBusca } from '../components/SelectBusca';
import { isGerencia } from '../lib/rbac';

// Fila da loja pública. O pedido chega de fora sem virar venda — quem vende é
// o aluno, aqui, e a venda nasce por `criar_venda_pdv` como qualquer outra
// (migração 293). Se o clique do comprador já fechasse a venda, a filial
// viraria espectadora de um sistema que vende sozinho.


// Formas que `criar_venda_pdv` conhece. A preferência declarada na loja é só
// um palpite do comprador — quem fecha escolhe a real.
// 'PIX' em caixa alta, igual ao PDV (`FORMAS` em PDVView) — é a MESMA coluna
// `vendas.forma_pagamento`, e ela não tem CHECK. Escrever 'Pix' aqui não daria
// erro nenhum: passaria a existir duas formas de pagamento com o mesmo nome no
// histórico, nos recibos e em qualquer agrupamento por forma.
const FORMAS_VENDA = ['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Fiado'] as const;

const brl = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Pedido = {
  id: string; codigo: string; filial: string;
  comprador_apelido: string; forma_desejada: string;
  cupom_codigo: string | null; cupom_desconto: number;
  total: number; total_final: number;
  status: string; venda_id: string | null;
  atendente_nome: string | null; atendido_em: string | null;
  motivo_cancelamento: string | null;
  cupom_ignorado: boolean | null;
  origem_pedidos_24h: number | null;
  indicacao: string | null; created_at: string;
};

// Formas que deixam conta a receber em aberto — sem cliente, a cobrança fica
// sem devedor. A RPC também barra (migr. 296); aqui é só para não deixar o
// aluno descobrir isso por mensagem de erro.
const EXIGE_CLIENTE = ['Fiado', 'Cartão Crédito'];

type AbaPO = 'fila' | 'confirmados' | 'cancelados' | 'vitrine';
type FiltroVitrine = 'todos' | 'na-loja' | 'fora' | 'sem-estoque';

const PedidosOnlineInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
  const confirm = useConfirm();
  // O `window.prompt` do navegador quebra a identidade visual e ainda anuncia
  // o domínio da Vercel no topo da caixa. O PromptProvider já existia para
  // isto — a tela é que não usava.
  const prompt = usePrompt();
  const { data: pedidos, setData, isLoading, reload, error: erroPedidos } =
    useFetchData<Pedido>('/api/pedidosonlineview', { filial }, true);
  const { data: itens } = useFetchData<any>('/api/pedidosonlineitensview', undefined, true);
  // '/api/crmview', não '/api/clientesview': esse segundo nome nunca existiu
  // no ENDPOINT_TABLE_MAP, então a lista de clientes vinha sempre vazia.
  const { data: clientes } = useFetchData<any>('/api/crmview', { filial });
  const { data: produtos, setData: setProdutos, reload: reloadProdutos } =
    useFetchData<any>('/api/produtosview', { filial });
  const { data: lojaCfg, setData: setLojaCfg } =
    useFetchData<any>('/api/lojaconfigview', { filial }, true, { orderBy: 'filial', ascending: true });

  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [aba, setAba] = useState<AbaPO>('fila');
  const [filtroVitrine, setFiltroVitrine] = useState<FiltroVitrine>('todos');
  const [buscaProd, setBuscaProd] = useState('');
  const [publicando, setPublicando] = useState<string | null>(null);
  const [atendendo, setAtendendo] = useState<Pedido | null>(null);
  const [forma, setForma] = useState<string>('PIX');
  const [parcelas, setParcelas] = useState(1);
  const [clienteId, setClienteId] = useState('');
  const [ignorarCupom, setIgnorarCupom] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);
  const [cfgForm, setCfgForm] = useState<Record<string, string>>({});

  const [excluindo, setExcluindo] = useState<string | null>(null);

  const cfg = lojaCfg?.[0];
  const podeAbrirFechar = profile?.role === 'admin' || profile?.role === 'ceo' || isGerencia(profile);
  // Excluir é da Matriz: some com registro, e gerente já tem 'Cancelar' — que
  // preserva o histórico e é o caminho certo para pedido real desistido.
  const podeExcluir = profile?.role === 'admin' || profile?.role === 'ceo';

  const itensPorPedido = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const i of itens ?? []) {
      if (!m.has(i.pedido_id)) m.set(i.pedido_id, []);
      m.get(i.pedido_id)!.push(i);
    }
    return m;
  }, [itens]);

  const clientesOpts = useMemo(() => groupCadastrosParaSelect(clientes ?? []), [clientes]);

  /**
   * Estoque que faltou desde que o pedido entrou na fila.
   *
   * O pedido NÃO reserva estoque — de propósito: reserva sem prazo entope o
   * estoque com pedido que ninguém vai buscar. O preço disso é que a
   * `criar_venda_pdv` pode recusar a venda inteira no clique do Confirmar.
   *
   * Então a conta é feita aqui, antes: o aluno abre a conversa com o comprador
   * já sabendo o que negociar, em vez de descobrir no meio do atendimento.
   *
   * `produtos` vem sem paginação (o hook só pagina quando recebe `page`), então
   * a comparação vê o catálogo inteiro da filial — se paginasse, produto fora
   * da página viraria "sem estoque" falso.
   */
  const faltaEstoque = useMemo(() => {
    const estoquePor = new Map<string, { nome: string; estoque: number }>();
    for (const pr of produtos ?? []) {
      estoquePor.set(pr.id, { nome: pr.nome, estoque: Number(pr.estoque ?? 0) });
    }
    const m = new Map<string, string[]>();
    for (const p of pedidos) {
      if (p.status !== 'Novo') continue;
      const faltas: string[] = [];
      for (const i of itensPorPedido.get(p.id) ?? []) {
        const pr = estoquePor.get(i.produto_id);
        // Produto sumiu do cadastro (inativado) ou não alcança a quantidade.
        if (!pr) { faltas.push(`${i.nome_produto} (saiu do catálogo)`); continue; }
        if (pr.estoque < Number(i.qtd)) {
          faltas.push(`${pr.nome} (pediu ${Number(i.qtd)}, tem ${pr.estoque})`);
        }
      }
      if (faltas.length) m.set(p.id, faltas);
    }
    return m;
  }, [pedidos, itensPorPedido, produtos]);

  const novos      = pedidos.filter(p => p.status === 'Novo');
  const confirmados = pedidos.filter(p => p.status === 'Confirmado');
  const emFila     = novos.reduce((s, p) => s + Number(p.total_final ?? 0), 0);

  /**
   * `loja_config` é uma linha por filial e a chave primária É a filial — não
   * existe coluna `id`. `dbUpdate` filtra por `.eq('id', …)` sempre, então
   * usá-lo aqui devolvia `column loja_config.id does not exist` e a loja não
   * abria de jeito nenhum.
   *
   * `maybeSingle` em vez de `single`: quando a RLS recusa, o UPDATE não é erro
   * — volta zero linha. Sem isso a mensagem seria sobre JSON, e não sobre
   * permissão, que é a informação de que quem clicou precisa.
   */
  const patchLojaCfg = async (patch: Record<string, any>) => {
    if (!supabase) throw new Error('Supabase não configurado');
    const { data, error } = await supabase
      .from('loja_config')
      .update(patch)
      .eq('filial', filial)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Sem permissão para alterar a loja desta filial (só gerente da filial, admin ou CEO).');
    return data;
  };

  const toggleLoja = async () => {
    if (!cfg) return;
    const novo = !cfg.aberta;
    if (novo && !await confirm(
      'Abrir a loja pública da ' + filial + '?\n\nO link passa a aceitar pedidos de qualquer pessoa que o receba. ' +
      'Feche quando a dinâmica terminar.')) return;
    try {
      const upd = await patchLojaCfg({ aberta: novo });
      setLojaCfg((prev: any[]) => prev.map((x: any) => x.filial === cfg.filial ? { ...x, ...upd } : x));
      showToast(novo ? 'Loja aberta — o link já aceita pedidos.' : 'Loja fechada.', 'success');
    } catch (err: any) {
      showToast(`Erro: ${err?.message ?? '—'}`, 'error', true);
    }
  };

  const abrirAtendimento = (p: Pedido) => {
    setAtendendo(p);
    // A preferência do comprador entra pré-selecionada quando existe forma
    // equivalente na venda; 'Boleto' não existe no PDV e cai em Fiado, que é
    // o que ele significa na prática (recebimento a prazo).
    setForma(p.forma_desejada === 'Boleto' ? 'Fiado' : (p.forma_desejada === 'Cartão' ? 'Cartão Crédito' : 'PIX'));
    setParcelas(1);
    setClienteId('');
    setIgnorarCupom(false);
  };

  const confirmarPedido = async () => {
    if (!atendendo || !supabase) return;

    if (EXIGE_CLIENTE.includes(forma) && !clienteId) {
      showToast(`${forma} gera conta a receber em aberto — escolha o cliente.`, 'error');
      return;
    }

    setSalvando(true);
    try {
      const { data, error } = await supabase.rpc('confirmar_pedido_online', {
        p_pedido_id:       atendendo.id,
        p_forma_pagamento: forma,
        p_cliente_id:      clienteId || null,
        p_parcelas:        forma === 'Cartão Crédito' ? parcelas : 1,
        p_ignorar_cupom:   ignorarCupom,
      });
      if (error) throw error;
      showToast(ignorarCupom
        ? `Pedido ${atendendo.codigo} virou venda pelo valor cheio — o cupom não foi aplicado.`
        : `Pedido ${atendendo.codigo} virou venda — estoque, conta a receber e nota já saíram.`, 'success');
      setAtendendo(null);
      // O estoque acabou de cair. Sem recarregar `produtos`, o aviso "sem
      // estoque" dos pedidos que continuam na fila fica olhando para o saldo
      // de antes desta venda — que é exatamente o número que o aluno usaria
      // para prometer o item ao próximo comprador.
      await Promise.all([reload(), reloadProdutos()]);
      void data;
    } catch (err: any) {
      // A mensagem do banco diz qual produto ficou sem estoque, ou que o
      // cupom expirou entre o pedido e agora. Engolir isso num 'Erro.' seco
      // deixaria o aluno sem saber o que negociar com o comprador.
      showToast(err?.message ?? 'Não foi possível confirmar.', 'error', true);
    }
    setSalvando(false);
  };

  const cancelarPedido = async (p: Pedido) => {
    const motivo = await prompt({
      message: `Cancelar o pedido ${p.codigo} de ${p.comprador_apelido}?\n\nMotivo (fica registrado):`,
      placeholder: 'Ex.: sem estoque, comprador desistiu',
      confirmLabel: 'Cancelar pedido',
      cancelLabel: 'Voltar',
      maxLength: 200,
    });
    if (motivo == null) return;
    if (!motivo.trim()) { showToast('Informe o motivo.', 'error'); return; }
    if (!supabase) return;
    try {
      const { error } = await supabase.rpc('cancelar_pedido_online', { p_pedido_id: p.id, p_motivo: motivo.trim() });
      if (error) throw error;
      setData((prev: any[]) => prev.map((x: any) => x.id === p.id ? { ...x, status: 'Cancelado', motivo_cancelamento: motivo.trim() } : x));
      showToast('Pedido cancelado.', 'success');
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao cancelar.', 'error', true);
    }
  };

  /**
   * Excluir pedido — existe para varrer pedido de teste, que a loja produz
   * bastante enquanto a turma experimenta o fluxo.
   *
   * Soft delete: `pedidos_online` está em TABLES_WITH_ATIVO, então some da
   * tela e continua no banco. Os itens não têm coluna `ativo`, mas também não
   * aparecem sozinhos — a tela só os alcança pelo pedido —, então não viram
   * órfão visível (ver feedback_soft_delete_cascade).
   *
   * Confirmado exige aviso mais duro: a venda, o estoque baixado e a conta a
   * receber são registros próprios e NÃO somem junto. Apagar o pedido some com
   * o rastro de onde a venda nasceu, não com a venda.
   */
  const excluirPedido = async (p: Pedido) => {
    const virouVenda = p.status === 'Confirmado' && !!p.venda_id;
    const aviso = virouVenda
      ? `Excluir o pedido ${p.codigo}?\n\nATENÇÃO: ele já virou venda. A venda, a baixa de estoque e a conta a receber CONTINUAM existindo — só o pedido sai da lista.\n\nPara desfazer o efeito financeiro, use Devoluções.`
      : `Excluir o pedido ${p.codigo} de ${p.comprador_apelido}?\n\nSai da lista. Nada mais é afetado.`;
    if (!await confirm(aviso)) return;

    setExcluindo(p.id);
    try {
      await dbDelete('/api/pedidosonlineview', p.id);
      setData((prev: any[]) => prev.filter((x: any) => x.id !== p.id));
      showToast(`Pedido ${p.codigo} excluído.`, 'success');
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao excluir.', 'error', true);
    } finally {
      setExcluindo(null);
    }
  };

  // Publicar na loja é `produtos.loja_online` — coluna própria desde a migr.
  // 294. NÃO é `vitrine_publica`, que é o carrossel da tela de login e é
  // decisão da Matriz: as duas telas respondem perguntas diferentes.
  const togglePublicado = async (p: any) => {
    setPublicando(p.id);
    try {
      const upd = await dbUpdate('/api/produtosview', p.id, { loja_online: !p.loja_online } as any);
      setProdutos((prev: any[]) => prev.map((x: any) =>
        x.id === p.id ? { ...x, ...(upd ?? { loja_online: !p.loja_online }) } : x));
      showToast(!p.loja_online ? `"${p.nome}" entrou na loja.` : `"${p.nome}" saiu da loja.`, 'success');
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao publicar.', 'error', true);
    }
    setPublicando(null);
  };

  // A loja vive em projeto Vercel próprio, então o LogMax não deduz a URL —
  // ela é cadastrada uma vez em `loja_config.url_publica`.
  const copiarLink = () => {
    const url = (cfg?.url_publica ?? '').trim();
    if (!url) {
      showToast('Cadastre o endereço da loja primeiro (botão "Endereço").', 'error');
      return;
    }
    navigator.clipboard?.writeText(url).then(
      () => showToast('Link da loja copiado.', 'success'),
      () => showToast(url, 'success', true),
    );
  };

  /**
   * Limites da loja. Existiam só como coluna: mudar a vazão de uma dinâmica
   * exigia SQL Editor, no meio da aula. São cinco números e uma frase, todos
   * de `loja_config` — e a régua de quem pode é a mesma do abrir/fechar
   * (`loja_config_write`: gerente da filial, admin ou CEO).
   */
  const abrirConfig = () => {
    if (!cfg) return;
    setCfgForm({
      mensagem_fechada:        cfg.mensagem_fechada ?? '',
      max_itens_pedido:        String(cfg.max_itens_pedido ?? 20),
      max_valor_pedido:        formatBRL(String(Number(cfg.max_valor_pedido ?? 0).toFixed(2))),
      max_pedidos_hora:        String(cfg.max_pedidos_hora ?? 300),
      max_pedidos_hora_origem: String(cfg.max_pedidos_hora_origem ?? 8),
    });
    setConfigAberta(true);
  };

  const salvarConfig = async () => {
    const inteiro = (v: string, min: number, max: number) => {
      const n = Number(String(v).replace(/\D/g, ''));
      return Number.isFinite(n) && n >= min && n <= max ? n : null;
    };
    const itens  = inteiro(cfgForm.max_itens_pedido, 1, 999);
    const hora   = inteiro(cfgForm.max_pedidos_hora, 1, 100000);
    const origem = inteiro(cfgForm.max_pedidos_hora_origem, 1, 100000);
    const valor  = parseBRL(cfgForm.max_valor_pedido ?? '');

    // Valida aqui porque a coluna é NOT NULL sem CHECK: um zero passaria e a
    // loja recusaria todo pedido com uma mensagem que não explica nada.
    if (itens === null)  { showToast('Itens por pedido: use um número de 1 a 999.', 'error'); return; }
    if (hora === null)   { showToast('Pedidos por hora (rede): use um número de 1 a 100000.', 'error'); return; }
    if (origem === null) { showToast('Pedidos por hora (dispositivo): use um número de 1 a 100000.', 'error'); return; }
    if (!(valor > 0))    { showToast('Valor máximo do pedido precisa ser maior que zero.', 'error'); return; }

    setSalvando(true);
    try {
      const upd = await patchLojaCfg({
        mensagem_fechada:        (cfgForm.mensagem_fechada ?? '').trim() || null,
        max_itens_pedido:        itens,
        max_valor_pedido:        valor,
        max_pedidos_hora:        hora,
        max_pedidos_hora_origem: origem,
      });
      setLojaCfg((prev: any[]) => prev.map((x: any) => x.filial === filial ? { ...x, ...upd } : x));
      showToast('Limites da loja atualizados.', 'success');
      setConfigAberta(false);
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao salvar os limites.', 'error', true);
    }
    setSalvando(false);
  };

  const definirUrl = async () => {
    if (!cfg) return;
    const atual = cfg.url_publica ?? '';
    const nova = await prompt({
      message:
        `Endereço público da loja da ${filial}:\n\n` +
        'É a URL do projeto Vercel da loja — ex.: https://maxlook-loja.vercel.app\n' +
        'Ela também precisa estar na env LOJA_ORIGINS deste LogMax.',
      defaultValue: atual,
      placeholder: 'https://…',
      confirmLabel: 'Salvar',
      maxLength: 200,
    });
    if (nova == null) return;
    const limpa = nova.trim().replace(/\/+$/, '');
    if (limpa && !/^https?:\/\//i.test(limpa)) {
      showToast('O endereço precisa começar com https://', 'error');
      return;
    }
    try {
      const upd = await patchLojaCfg({ url_publica: limpa || null });
      setLojaCfg((prev: any[]) => prev.map((x: any) =>
        x.filial === cfg.filial ? { ...x, ...upd } : x));
      showToast(limpa ? 'Endereço atualizado.' : 'Endereço removido.', 'success');
    } catch (err: any) {
      showToast(err?.message ?? 'Erro ao salvar o endereço.', 'error', true);
    }
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;

  // Patrimônio e material de uso e consumo não vão para a loja pública (migr.
  // 440): ficam fora da vitrine e também da conta "X de Y".
  const vendaveis = (produtos ?? []).filter((p: any) => ehVendavel(p.tipo));
  const publicados = vendaveis.filter((p: any) => p.loja_online);
  const semEstoque = publicados.filter((p: any) => Number(p.estoque ?? 0) <= 0).length;
  const cancelados = pedidos.filter(p => p.status === 'Cancelado');

  const kpis = [
    { tom: 'roxo' as TomContador,    label: 'Valor em fila', value: brl(emFila) },
    { tom: 'azul' as TomContador,    label: 'Na vitrine',    value: publicados.length, sub: semEstoque > 0 ? `${semEstoque} sem estoque` : undefined },
    { tom: (cfg?.aberta ? 'verde' : 'vermelho') as TomContador, label: 'Loja', value: cfg?.aberta ? 'Aberta' : 'Fechada' },
  ];

  const ABAS: { id: AbaPO; label: string; cor: CorAba; n: number; icon: any }[] = [
    { id: 'fila',        label: 'Na fila',     cor: 'amarelo',  n: novos.length,       icon: ShoppingCart },
    { id: 'confirmados', label: 'Confirmados', cor: 'verde',    n: confirmados.length, icon: Check },
    { id: 'cancelados',  label: 'Cancelados',  cor: 'vermelho', n: cancelados.length,  icon: Ban },
    { id: 'vitrine',     label: 'Vitrine',     cor: 'azul',     n: publicados.length,  icon: Package },
  ];

  const produtosFiltrados = vendaveis
    .filter((p: any) => {
      if (filtroVitrine === 'na-loja') return p.loja_online;
      if (filtroVitrine === 'fora') return !p.loja_online;
      if (filtroVitrine === 'sem-estoque') return Number(p.estoque ?? 0) <= 0;
      return true;
    })
    .filter((p: any) => {
      const q = buscaProd.trim().toLowerCase();
      if (!q) return true;
      return [p.nome, p.codigo, p.categoria].some((v: any) => String(v ?? '').toLowerCase().includes(q));
    })
    .sort((a: any, b: any) =>
      Number(b.loja_online) - Number(a.loja_online) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

  // 'Em Atendimento' existe no CHECK (migr. 293) sem ninguém gravar hoje; se
  // aparecer, fica na fila em vez de sumir de todas as abas.
  const listaPedidos = aba === 'confirmados' ? confirmados : aba === 'cancelados' ? cancelados
    : pedidos.filter(p => p.status === 'Novo' || p.status === 'Em Atendimento');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 pb-6">

      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos Online — {filial}</h2>
        <div className="flex gap-2 flex-wrap">
          {podeAbrirFechar && (
            <button onClick={definirUrl} className="btn-solido btn-solido--vermelho">
              <ExternalLink size={13} /> Endereço
            </button>
          )}
          <button onClick={copiarLink} className="btn-solido btn-solido--azul">
            <Link2 size={13} /> Copiar link
          </button>
          {podeAbrirFechar && cfg && (
            <button onClick={abrirConfig} className="btn-solido btn-solido--cinza">
              <Settings size={13} /> Limites
            </button>
          )}
          {podeAbrirFechar && cfg && (
            <button onClick={toggleLoja} className={`btn-solido ${cfg.aberta ? 'btn-solido--vermelho' : 'btn-solido--verde'}`}>
              <Store size={14} /> {cfg.aberta ? 'Fechar loja' : 'Abrir loja'}
            </button>
          )}
        </div>
      </div>

      {cfg && !cfg.aberta && (
        <div className="rounded-xl px-4 py-2.5 flex items-center gap-2 bg-yellow-500 text-black">
          <Store size={15} className="shrink-0" />
          <p className="text-xs font-bold">
            Loja fechada: o link responde, mas não aceita pedidos.{!podeAbrirFechar && ' Só gerente ou Matriz abre.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map(k => (
          <CardContador key={k.label} label={k.label} value={k.value} sub={k.sub} tom={k.tom} corFixa />
        ))}
      </div>

      <div className="flex gap-3 flex-wrap" role="tablist">
        {ABAS.map(a => (
          <AbaComContador key={a.id} label={a.label} n={a.n} cor={a.cor} icon={a.icon}
            ativa={aba === a.id} onClick={() => setAba(a.id)} alerta={a.id === 'fila' && a.n > 0} />
        ))}
      </div>

      {/* ── Vitrine ──────────────────────────────────────────────────────── */}
      {/* Produto cadastrado NÃO entra sozinho: alguém decide, item a item, o
          que vai para o público. `produtos.loja_online` (migr. 294) — não é a
          vitrine do login, que é da Matriz. */}
      {aba === 'vitrine' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" value={buscaProd} onChange={e => setBuscaProd(e.target.value)}
                placeholder="Buscar por nome, código ou categoria..."
                className="neu-input rounded-xl pl-9 pr-3 py-2.5 text-sm w-full" />
            </div>
            {([
              ['todos', `Todos (${vendaveis.length})`],
              ['na-loja', `Na loja (${publicados.length})`],
              ['fora', `Fora da loja (${vendaveis.length - publicados.length})`],
              ['sem-estoque', `Sem estoque (${vendaveis.filter((p: any) => Number(p.estoque ?? 0) <= 0).length})`],
            ] as const).map(([k, rot]) => (
              <button key={k} type="button" onClick={() => setFiltroVitrine(k)} aria-pressed={filtroVitrine === k}
                className={`py-2 px-3.5 rounded-xl text-xs font-bold border transition-colors ${filtroVitrine === k
                  ? 'bg-accent border-accent text-black' : 'neu-button border-transparent text-gray-400 hover:text-gray-200'}`}>
                {rot}
              </button>
            ))}
          </div>

          {produtosFiltrados.length === 0 ? (
            <EmptyState message="Nenhum produto neste filtro." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {produtosFiltrados.map((p: any) => {
                const semEst = Number(p.estoque ?? 0) <= 0;
                const naLoja = !!p.loja_online;
                return (
                  <div key={p.id}
                    className={`neu-flat rounded-2xl p-3 border flex items-center gap-3 transition-colors ${naLoja ? 'border-green-600/60' : 'border-white/5'}`}>
                    <ProdutoThumb url={p.imagem_url} size="sm" alt={p.nome} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-100 truncate" title={p.nome}>{p.nome}</p>
                      <p className="text-[11px] text-gray-500 truncate">{p.categoria ?? '—'}</p>
                      <p className="text-xs mt-0.5 flex items-center gap-2">
                        <span className="font-bold text-gray-200 tabular-nums">{brl(p.preco)}</span>
                        <span className={`tabular-nums ${semEst ? 'text-red-400 font-bold' : 'text-gray-500'}`}>
                          {Number(p.estoque ?? 0)} em estoque
                        </span>
                      </p>
                      {naLoja && (semEst || !p.imagem_url) && (
                        <p className="text-[10px] font-bold text-yellow-400 mt-0.5">
                          {semEst ? 'Não aparece: sem estoque' : 'Sem foto'}
                        </p>
                      )}
                    </div>
                    <button onClick={() => togglePublicado(p)} disabled={publicando === p.id}
                      title={naLoja ? 'Tirar da loja' : 'Publicar na loja'}
                      className={`shrink-0 btn-solido !px-3 !py-2 !text-[11px] ${naLoja ? 'btn-solido--verde' : 'btn-solido--cinza'}`}>
                      {publicando === p.id ? <Loader2 size={12} className="animate-spin" /> : naLoja ? <Check size={12} /> : <Plus size={12} />}
                      {naLoja ? 'Na loja' : 'Publicar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Pedidos ──────────────────────────────────────────────────────── */}
      {aba !== 'vitrine' && (
        // Consulta que falha e lista vazia são a mesma tela sem isto.
        erroPedidos ? (
          <div className="rounded-2xl p-4 border border-red-500/30 bg-red-500/5">
            <p className="text-xs font-bold text-red-400 flex items-center gap-1.5 mb-1">
              <AlertTriangle size={12} />Não foi possível carregar a fila
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed">{erroPedidos}</p>
          </div>
        ) : listaPedidos.length === 0 ? (
          <EmptyState message={aba === 'fila' ? 'Nenhum pedido esperando atendimento.' : aba === 'confirmados' ? 'Nenhum pedido confirmado ainda.' : 'Nenhum pedido cancelado.'} />
        ) : (
          <div className="neu-flat rounded-2xl p-4 sm:p-5 border border-white/5 overflow-x-auto main-scrollbar">
            <table className="tabela w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className={CABECALHO_TABELA}>
                  <th className="text-center">Comprador</th>
                  <th className="text-center w-24">Itens</th>
                  <th className="text-center w-36">Total</th>
                  <th className="text-center w-32">Pagamento</th>
                  <th className="text-center w-44">{aba === 'fila' ? 'Alertas' : aba === 'confirmados' ? 'Atendido por' : 'Motivo'}</th>
                  <th className="text-center w-px">Ações</th>
                </tr>
              </thead>
              <tbody>
                {listaPedidos.map((p: Pedido) => {
                  const its = itensPorPedido.get(p.id) ?? [];
                  const exp = !!aberto[p.id];
                  const alternar = () => setAberto(a => ({ ...a, [p.id]: !exp }));
                  return (
                    <React.Fragment key={p.id}>
                    <tr onClick={alternar}
                      className={`border-b border-accent/10 hover:bg-accent/[0.04] transition-colors align-middle cursor-pointer ${exp ? 'bg-accent/[0.04]' : ''}`}>
                      <td className="py-3 px-3 min-w-[13rem]">
                        <span className="font-credencial text-[10px] tracking-wider text-accent/80">{p.codigo}</span>
                        <span className="block text-sm font-semibold text-gray-100 truncate">{p.comprador_apelido}</span>
                        {(p.cupom_codigo || p.indicacao) && (
                          <span className="block text-[11px] text-gray-500 truncate">
                            {p.cupom_codigo && <>cupom <span className="text-accent">{p.cupom_codigo}</span></>}
                            {p.cupom_codigo && p.indicacao && ' · '}
                            {p.indicacao && <>indicado por {p.indicacao}</>}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center text-sm text-gray-300 tabular-nums">{its.length}</td>
                      <td className="py-3 px-3 text-center text-sm font-bold text-gray-100 tabular-nums whitespace-nowrap">{brl(p.total_final)}</td>
                      <td className="py-3 px-3 text-center text-xs text-gray-300">{p.forma_desejada}</td>
                      <td className="py-3 px-3 text-center">
                        {aba === 'fila' ? (
                          <div className="flex flex-col items-center gap-1">
                            {faltaEstoque.has(p.id) && (
                              <span title={`Estoque insuficiente agora: ${faltaEstoque.get(p.id)!.join(' · ')}. Confirmar assim será recusado.`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-600 text-white">
                                <AlertTriangle size={10} /> Sem estoque
                              </span>
                            )}
                            {/* Indício, não acusação: pode ser a mesma pessoa
                                comprando de novo, ou a rede da escola. */}
                            {Number(p.origem_pedidos_24h ?? 1) > 2 && (
                              <span title={`${p.origem_pedidos_24h} pedidos da mesma origem nas últimas 24h. Pode ser a rede da escola.`}
                                className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-yellow-400 text-black">
                                {p.origem_pedidos_24h}º da mesma origem
                              </span>
                            )}
                            {!faltaEstoque.has(p.id) && Number(p.origem_pedidos_24h ?? 1) <= 2 && <span className="text-xs text-gray-600">—</span>}
                          </div>
                        ) : aba === 'confirmados' ? (
                          <span className="text-xs text-gray-300">{p.atendente_nome ?? '—'}</span>
                        ) : (
                          <span className="text-xs text-gray-400 line-clamp-2" title={p.motivo_cancelamento ?? ''}>{p.motivo_cancelamento ?? '—'}</span>
                        )}
                      </td>
                      <td className="py-3 px-3" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-center items-center gap-1.5 flex-nowrap whitespace-nowrap">
                          {p.status === 'Novo' && (
                            <>
                              <button onClick={() => abrirAtendimento(p)} title="Atender — fechar a venda" aria-label="Atender pedido"
                                className="action-btn-verde"><Check size={14} /></button>
                              <button onClick={() => cancelarPedido(p)} title="Cancelar pedido" aria-label="Cancelar pedido"
                                className="action-btn-vermelho"><Ban size={13} /></button>
                            </>
                          )}
                          <button onClick={alternar} aria-expanded={exp}
                            title={exp ? 'Fechar os itens' : 'Ver os itens'} aria-label={exp ? 'Fechar os itens' : 'Ver os itens'}
                            className="action-btn-neutral">
                            <ChevronDown size={14} className={`transition-transform duration-200 ${exp ? 'rotate-180' : ''}`} />
                          </button>
                          {/* Vale para qualquer status: pedido de teste também é
                              atendido e confirmado enquanto a turma experimenta. */}
                          {podeExcluir && (
                            <MenuMais>
                              {fechar => (
                                <ItemMenu onClick={() => { fechar(); excluirPedido(p); }} disabled={excluindo === p.id}
                                  cor="text-red-400 hover:bg-red-500/10" icon={Trash2}>
                                  Excluir pedido
                                </ItemMenu>
                              )}
                            </MenuMais>
                          )}
                        </div>
                      </td>
                    </tr>
                    {exp && (
                      <tr className="border-b border-accent/10">
                        <td colSpan={6} className="px-3 pb-4 pt-1">
                          <div className="neu-pressed rounded-xl p-3 border border-white/5 flex flex-col gap-1.5">
                            {its.map((i: any) => (
                              <div key={i.id} className="flex items-center gap-3 text-sm">
                                <span className="flex-1 min-w-0 truncate text-gray-200">{i.nome_produto}</span>
                                <span className="w-16 text-right tabular-nums text-gray-400">{Number(i.qtd)}×</span>
                                <span className="w-28 text-right tabular-nums text-gray-400">{brl(i.preco_unitario)}</span>
                                <span className="w-28 text-right tabular-nums font-bold text-gray-100">{brl(i.subtotal)}</span>
                              </div>
                            ))}
                            {Number(p.cupom_desconto) > 0 && (
                              <p className={`text-xs text-right mt-1 font-bold ${p.cupom_ignorado ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                {p.cupom_ignorado
                                  ? `Cupom ${p.cupom_codigo} não aplicado — venda por ${brl(p.total)}`
                                  : `Cupom ${p.cupom_codigo}: −${brl(p.cupom_desconto)} sobre ${brl(p.total)}`}
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <AnimatePresence>
        {configAberta && cfg && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !salvando && setConfigAberta(false)}>
            <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-md max-h-[90vh] overflow-y-auto main-scrollbar">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                  <Settings size={14} className="text-accent" />Limites da loja — {filial}
                </h3>
                <button onClick={() => setConfigAberta(false)} disabled={salvando}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
              </div>

              <div className="flex flex-col gap-1.5 mb-4">
                <label htmlFor="cfg-msg" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Mensagem com a loja fechada</label>
                <input id="cfg-msg" type="text" maxLength={160} value={cfgForm.mensagem_fechada ?? ''}
                  onChange={e => setCfgForm(f => ({ ...f, mensagem_fechada: e.target.value }))}
                  placeholder="A loja está fechada no momento."
                  className="neu-input rounded-xl px-3 py-2.5 text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cfg-itens" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Itens por pedido</label>
                  <input id="cfg-itens" type="text" inputMode="numeric" value={cfgForm.max_itens_pedido ?? ''}
                    onChange={e => setCfgForm(f => ({ ...f, max_itens_pedido: e.target.value.replace(/\D/g, '') }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cfg-valor" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Valor máximo</label>
                  <input id="cfg-valor" type="text" inputMode="numeric" value={cfgForm.max_valor_pedido ?? ''}
                    onChange={e => setCfgForm(f => ({ ...f, max_valor_pedido: formatBRL(e.target.value) }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              </div>

              {/* Os dois tetos de vazão existem separados porque respondem
                  perguntas diferentes (migr. 300), e o texto tem de dizer isso:
                  quem apertar o de rede achando que aperta uma pessoa vai
                  travar a turma inteira. */}
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cfg-hora" title="A turma costuma sair pela mesma internet: este limite vale para a sala inteira." className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Pedidos/hora por rede</label>
                  <input id="cfg-hora" type="text" inputMode="numeric" value={cfgForm.max_pedidos_hora ?? ''}
                    onChange={e => setCfgForm(f => ({ ...f, max_pedidos_hora: e.target.value.replace(/\D/g, '') }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cfg-origem" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Pedidos/hora por dispositivo</label>
                  <input id="cfg-origem" type="text" inputMode="numeric" value={cfgForm.max_pedidos_hora_origem ?? ''}
                    onChange={e => setCfgForm(f => ({ ...f, max_pedidos_hora_origem: e.target.value.replace(/\D/g, '') }))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              </div>
              <div className="mb-5" />

              <div className="flex justify-end gap-2">
                <button onClick={() => setConfigAberta(false)} disabled={salvando}
                  className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                  Cancelar
                </button>
                <NeuButtonAccent variant="" onClick={salvarConfig} disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {atendendo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !salvando && setAtendendo(null)}>
            <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="neu-flat rounded-3xl p-6 border border-white/10 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                  <ShoppingCart size={14} className="text-accent" />Fechar venda — {atendendo.codigo}
                </h3>
                <button onClick={() => setAtendendo(null)} disabled={salvando}
                  className="w-7 h-7 neu-button rounded-lg flex items-center justify-center text-gray-500 hover:text-white"><X size={14} /></button>
              </div>

              {(() => { const t = ignorarCupom ? Number(atendendo.total) : Number(atendendo.total_final); return (
              <div className="neu-pressed rounded-xl p-3 text-xs text-gray-300 mb-4 leading-relaxed">
                <strong className="text-gray-100">{atendendo.comprador_apelido}</strong> — {brl(t)}
                {ignorarCupom && <span className="text-yellow-400"> (valor cheio, sem o cupom)</span>}
                <span className="text-gray-500"> · preferiu {atendendo.forma_desejada}</span>
              </div>
              ); })()}

              {/* O erro de estoque viria do banco no clique. Dito aqui, com o
                  nome do produto e os números, o aluno tem o que negociar em
                  vez de um "operação recusada". */}
              {faltaEstoque.has(atendendo.id) && (
                <div className="rounded-xl p-3 mb-4 border border-red-500/30 bg-red-500/5">
                  <p className="text-[11px] font-bold text-red-400 flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={12} />Estoque insuficiente agora
                  </p>
                  <ul className="text-[11px] text-gray-400 leading-relaxed list-disc pl-4">
                    {faltaEstoque.get(atendendo.id)!.map(f => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )}

              {/* Cupom expirado ou alterado depois do pedido faz a criar_venda_pdv
                  recusar a venda inteira, e sem esta saída o pedido ficava preso na
                  fila — só dava para cancelar. Cobrar o valor cheio é decisão de
                  quem atende, então o valor aparece antes do clique. */}
              {Number(atendendo.cupom_desconto) > 0 && (
                <label className="flex items-start gap-2.5 neu-pressed rounded-xl p-3 mb-4 cursor-pointer">
                  <input type="checkbox" checked={ignorarCupom} className="mt-0.5 accent-current"
                    onChange={e => setIgnorarCupom(e.target.checked)} />
                  <span className="text-[11px] text-gray-400 leading-relaxed">
                    <span className="text-gray-200 font-bold">Fechar sem o cupom {atendendo.cupom_codigo}</span><br />
                    Marque se o cupom expirou ou mudou desde o pedido. A venda sai por{' '}
                    <span className="text-gray-200 font-bold">{brl(atendendo.total)}</span> em vez de{' '}
                    {brl(atendendo.total_final)} — combine com o comprador antes.
                  </span>
                </label>
              )}

              <div className="flex flex-col gap-1.5 mb-4">
                <label htmlFor="po-forma" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Forma de pagamento *</label>
                <select id="po-forma" value={forma} onChange={e => setForma(e.target.value)}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  {FORMAS_VENDA.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              {forma === 'Cartão Crédito' && (
                <div className="flex flex-col gap-1.5 mb-4">
                  <label htmlFor="po-parc" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Parcelas</label>
                  <select id="po-parc" value={parcelas} onChange={e => setParcelas(Number(e.target.value))}
                    className="neu-input rounded-xl px-3 py-2.5 text-sm">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>
                        {n}× de {brl(Number(ignorarCupom ? atendendo.total : atendendo.total_final) / n)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5 mb-4">
                <label htmlFor="po-cli" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {EXIGE_CLIENTE.includes(forma) ? 'Cliente *' : 'Cliente (opcional)'}
                </label>
                <SelectBusca
                  id="po-cli"
                  value={clienteId}
                  onChange={v => setClienteId(v)}
                  placeholder={EXIGE_CLIENTE.includes(forma) ? 'Escolha o cliente' : 'Sem cliente cadastrado'}
                  permitirVazio={EXIGE_CLIENTE.includes(forma) ? undefined : 'Sem cliente cadastrado'}
                  grupos={clientesOpts.map((g: any) => ({
                    label: g.label,
                    opcoes: g.items.map((c: any) => ({
                      value: String(c.id), label: c.nome ?? '—',
                      sub: [c.cnpj || c.cpf, c.cidade].filter(Boolean).join(' · ') || null,
                    })),
                  }))}
                />
              </div>

              <div className="mb-5" />

              <div className="flex justify-end gap-2">
                <button onClick={() => setAtendendo(null)} disabled={salvando}
                  className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white">
                  Cancelar
                </button>
                <NeuButtonAccent variant="" onClick={confirmarPedido}
                  disabled={salvando || (EXIGE_CLIENTE.includes(forma) && !clienteId)}>
                  {salvando ? 'Fechando...' : 'Confirmar venda'}
                </NeuButtonAccent>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export const PedidosOnlineView = ({ showToast, profile }: any) => {
  const { filialAtiva } = useFilial();
  // Modo Matriz não tem loja: a vitrine, os limites e a fila são da unidade.
  // Devolver `null` aqui deixava a área de conteúdo vazia, sem dizer o que
  // fazer — quem chegasse pelo menu achava que a tela tinha quebrado.
  if (!filialAtiva) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <EmptyState message="A loja online é de cada unidade. Escolha SuperMax, MaxLook ou TechMax no seletor do topo para ver a fila de pedidos." />
      </div>
    );
  }
  return <PedidosOnlineInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
