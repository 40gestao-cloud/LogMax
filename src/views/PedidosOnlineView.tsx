import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, X, Check, Ban, ChevronDown, ChevronRight, Store, Link2, ExternalLink, Package, Search } from 'lucide-react';
import type { FilialOp } from '../components/FilialSelector';
import { useFilial } from '../contexts/FilialContext';
import { useFetchData, dbUpdate } from '../hooks/useSupabaseData';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState, NeuButtonAccent } from '../components/ui';
import { useConfirm } from '../contexts/ConfirmContext';
import { groupCadastrosParaSelect } from '../lib/cadastrosSelect';

// Fila da loja pública. O pedido chega de fora sem virar venda — quem vende é
// o aluno, aqui, e a venda nasce por `criar_venda_pdv` como qualquer outra
// (migração 293). Se o clique do comprador já fechasse a venda, a filial
// viraria espectadora de um sistema que vende sozinho.

const STATUS_CLS: Record<string, string> = {
  'Novo':           'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  'Em Atendimento': 'bg-blue-500/10   text-blue-400   border-blue-500/20',
  'Confirmado':     'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Cancelado':      'bg-red-500/10    text-red-400    border-red-500/20',
};

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

const PedidosOnlineInner = ({ showToast, profile, filial }: { showToast: any; profile: any; filial: FilialOp }) => {
  const confirm = useConfirm();
  const { data: pedidos, setData, isLoading, reload } =
    useFetchData<Pedido>('/api/pedidosonlineview', { filial }, true);
  const { data: itens } = useFetchData<any>('/api/pedidosonlineitensview', undefined, true);
  const { data: clientes } = useFetchData<any>('/api/clientesview', { filial });
  const { data: produtos, setData: setProdutos } = useFetchData<any>('/api/produtosview', { filial });
  const { data: lojaCfg, setData: setLojaCfg } =
    useFetchData<any>('/api/lojaconfigview', { filial }, true, { orderBy: 'filial', ascending: true });

  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [verCatalogo, setVerCatalogo] = useState(false);
  const [buscaProd, setBuscaProd] = useState('');
  const [publicando, setPublicando] = useState<string | null>(null);
  const [atendendo, setAtendendo] = useState<Pedido | null>(null);
  const [forma, setForma] = useState<string>('PIX');
  const [parcelas, setParcelas] = useState(1);
  const [clienteId, setClienteId] = useState('');
  const [ignorarCupom, setIgnorarCupom] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const cfg = lojaCfg?.[0];
  const podeAbrirFechar = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.role === 'gerente';

  const itensPorPedido = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const i of itens ?? []) {
      if (!m.has(i.pedido_id)) m.set(i.pedido_id, []);
      m.get(i.pedido_id)!.push(i);
    }
    return m;
  }, [itens]);

  const clientesOpts = useMemo(() => groupCadastrosParaSelect(clientes ?? []), [clientes]);

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
      await reload();
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
    const motivo = window.prompt(`Cancelar o pedido ${p.codigo} de ${p.comprador_apelido}?\n\nMotivo (fica registrado):`);
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

  const definirUrl = async () => {
    if (!cfg) return;
    const atual = cfg.url_publica ?? '';
    const nova = window.prompt(
      'Endereço público da loja da ' + filial + ':\n\n' +
      'É a URL do projeto Vercel da loja — ex.: https://maxlook-loja.vercel.app\n' +
      'Ela também precisa estar na env LOJA_ORIGINS deste LogMax.',
      atual,
    );
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

  const publicados = (produtos ?? []).filter((p: any) => p.loja_online);
  const semEstoque = publicados.filter((p: any) => Number(p.estoque ?? 0) <= 0).length;

  const kpis = [
    { label: 'Na fila',        value: novos.length,        warn: novos.length > 0 },
    { label: 'Valor em fila',  value: brl(emFila),         warn: false },
    { label: 'Confirmados',    value: confirmados.length,  warn: false },
    { label: 'Na vitrine',     value: publicados.length,   warn: publicados.length === 0 },
    { label: 'Loja',           value: cfg?.aberta ? 'Aberta' : 'Fechada', warn: !cfg?.aberta },
  ];

  const produtosFiltrados = (produtos ?? [])
    .filter((p: any) => {
      const q = buscaProd.trim().toLowerCase();
      if (!q) return true;
      return [p.nome, p.codigo, p.categoria].some((v: any) => String(v ?? '').toLowerCase().includes(q));
    })
    .sort((a: any, b: any) =>
      Number(b.loja_online) - Number(a.loja_online) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6 overflow-y-auto main-scrollbar pb-6">

      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Pedidos Online — {filial}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Pedidos vindos da loja pública. Eles <strong className="text-gray-300">não são vendas</strong> ainda —
            viram venda quando alguém daqui confirma, e aí seguem o caminho normal do PDV.
          </p>
        </div>
        <div className="flex gap-2">
          {podeAbrirFechar && (
            <button onClick={definirUrl}
              className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white flex items-center gap-2">
              <ExternalLink size={13} />Endereço
            </button>
          )}
          <button onClick={copiarLink}
            className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white flex items-center gap-2">
            <Link2 size={13} />Copiar link
          </button>
          {podeAbrirFechar && cfg && (
            <NeuButtonAccent variant="" onClick={toggleLoja}>
              <Store size={14} />{cfg.aberta ? 'Fechar loja' : 'Abrir loja'}
            </NeuButtonAccent>
          )}
        </div>
      </div>

      {cfg && !cfg.aberta && (
        <div className="neu-flat rounded-2xl p-4 border border-yellow-500/25 shrink-0">
          <p className="text-xs text-yellow-400 leading-relaxed">
            A loja está <strong>fechada</strong>: o link responde, mas não aceita pedidos novos.
            {podeAbrirFechar ? ' Abra quando a turma estiver pronta para atender.' : ' Só gerente ou Matriz abre.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 shrink-0">
        {kpis.map(k => (
          <div key={k.label} className="neu-flat rounded-2xl p-5 border border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-tight sm:tracking-widest font-bold mb-1 sm:mb-2">{k.label}</p>
            <p className={`text-2xl font-black ${k.warn ? 'text-yellow-400' : 'text-gray-100'} tabular-nums`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Vitrine da loja. Produto cadastrado NÃO entra sozinho: alguém decide
          o que vai para o público, item a item. Sem isso, qualquer cadastro
          de teste apareceria para gente de fora no instante em que fosse
          salvo. */}
      <div className="neu-flat rounded-3xl border border-white/5 shrink-0 overflow-hidden">
        <button onClick={() => setVerCatalogo(v => !v)}
          className="w-full flex items-center justify-between gap-3 p-5 hover:bg-white/[0.03] transition-colors">
          <div className="flex items-center gap-3 text-left">
            <Package size={16} className="text-accent shrink-0" />
            <div>
              <p className="text-sm font-bold text-gray-200">Publicar na loja online</p>
              <p className="text-[11px] text-gray-500">
                {publicados.length} de {(produtos ?? []).length} produto(s) publicado(s)
                {semEstoque > 0 && <span className="text-yellow-400"> · {semEstoque} sem estoque (não aparece)</span>}
              </p>
            </div>
          </div>
          {verCatalogo ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        </button>

        {verCatalogo && (
          <div className="px-5 pb-5">
            <p className="text-[11px] text-gray-500 leading-relaxed mb-4">
              Produto novo cadastrado no LogMax <strong className="text-gray-400">não entra na loja sozinho</strong> —
              publique aqui. Ele só aparece para o público se estiver publicado, ativo e com estoque acima de zero.
              Esta chave é da filial e não tem relação com a <strong className="text-gray-400">Vitrine da Tela
              de Login</strong>, que é da Matriz e alimenta o carrossel do login.
            </p>

            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" value={buscaProd} onChange={e => setBuscaProd(e.target.value)}
                placeholder="Buscar por nome, código ou categoria..."
                className="neu-input rounded-xl pl-9 pr-3 py-2.5 text-sm w-full" />
            </div>

            <div className="max-h-80 overflow-y-auto main-scrollbar flex flex-col gap-1.5">
              {produtosFiltrados.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">Nenhum produto encontrado.</p>
              ) : produtosFiltrados.map((p: any) => {
                const semEst = Number(p.estoque ?? 0) <= 0;
                return (
                  <div key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-200 truncate">{p.nome}</p>
                      <p className="text-[10px] text-gray-500">
                        {p.categoria ?? '—'} · {brl(p.preco)} · {Number(p.estoque ?? 0)} em estoque
                        {p.loja_online && semEst && <span className="text-yellow-400"> · não aparece sem estoque</span>}
                        {p.loja_online && !p.imagem_url && <span className="text-gray-600"> · sem foto</span>}
                      </p>
                    </div>
                    <button onClick={() => togglePublicado(p)} disabled={publicando === p.id}
                      className={`shrink-0 text-[10px] font-bold uppercase tracking-widest rounded-md px-2.5 py-1.5 border transition-colors disabled:opacity-40 ${
                        p.loja_online
                          ? 'text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10'
                          : 'text-gray-500 border-white/10 hover:text-gray-300 hover:border-white/20'
                      }`}>
                      {publicando === p.id ? '…' : p.loja_online ? 'Na loja' : 'Publicar'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="neu-flat rounded-3xl p-6 border border-white/5 shrink-0">
        {pedidos.length === 0 ? (
          <EmptyState message="Nenhum pedido pela loja online ainda." />
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence>
              {pedidos.map((p: Pedido) => {
                const its = itensPorPedido.get(p.id) ?? [];
                const exp = !!aberto[p.id];
                return (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3 p-4">
                      <button onClick={() => setAberto(a => ({ ...a, [p.id]: !exp }))}
                        className="text-gray-500 hover:text-white shrink-0" aria-label="Ver itens">
                        {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>

                      <span className="font-mono text-sm font-bold text-accent tracking-wider">{p.codigo}</span>

                      <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_CLS[p.status] ?? STATUS_CLS['Novo']}`}>
                        {p.status}
                      </span>

                      {/* Indício, não acusação — e o texto precisa deixar isso
                          claro, porque quem lê vai atender uma pessoa. Aba
                          anônima gera outro token, e a turma inteira pode
                          estar atrás do mesmo IP da escola. */}
                      {Number(p.origem_pedidos_24h ?? 1) > 2 && (
                        <span
                          title={`Já vieram ${p.origem_pedidos_24h} pedidos desta mesma origem nas últimas 24h. É indício, não prova: pode ser a mesma pessoa comprando de novo, ou a rede da escola.`}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                          {p.origem_pedidos_24h}º da mesma origem
                        </span>
                      )}

                      <div className="flex-1 min-w-[140px]">
                        <p className="text-sm font-semibold text-gray-200 truncate">{p.comprador_apelido}</p>
                        <p className="text-[10px] text-gray-500">
                          {its.length} item(ns) · prefere {p.forma_desejada}
                          {p.cupom_codigo && <> · cupom <span className="text-accent">{p.cupom_codigo}</span></>}
                          {p.indicacao && <> · indicado por <span className="text-gray-400">{p.indicacao}</span></>}
                        </p>
                      </div>

                      <span className="text-sm font-bold text-gray-100 tabular-nums">{brl(p.total_final)}</span>

                      {p.status === 'Novo' && (
                        <div className="flex gap-1.5">
                          <button onClick={() => abrirAtendimento(p)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400 border border-emerald-500/30 rounded-md px-2.5 py-1.5 hover:bg-emerald-500/10">
                            <Check size={11} />Atender
                          </button>
                          <button onClick={() => cancelarPedido(p)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-400 border border-red-500/30 rounded-md px-2.5 py-1.5 hover:bg-red-500/10">
                            <Ban size={11} />Cancelar
                          </button>
                        </div>
                      )}

                      {p.status === 'Confirmado' && (
                        <span className="text-[10px] text-gray-500">
                          por {p.atendente_nome ?? '—'}
                          {p.venda_id && <span className="ml-1 text-accent inline-flex items-center gap-0.5"><ExternalLink size={9} />venda</span>}
                        </span>
                      )}
                      {p.status === 'Cancelado' && p.motivo_cancelamento && (
                        <span className="text-[10px] text-gray-500 max-w-[220px] truncate" title={p.motivo_cancelamento}>
                          {p.motivo_cancelamento}
                        </span>
                      )}
                    </div>

                    {exp && (
                      <div className="px-4 pb-4 pl-12">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5">
                              <th className="pb-2 font-bold">Produto</th>
                              <th className="pb-2 font-bold text-right">Qtd</th>
                              <th className="pb-2 font-bold text-right">Unit.</th>
                              <th className="pb-2 font-bold text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {its.map((i: any) => (
                              <tr key={i.id} className="border-b border-white/5">
                                <td className="py-2 text-gray-300">{i.nome_produto}</td>
                                <td className="py-2 text-right font-mono text-gray-400">{Number(i.qtd)}</td>
                                <td className="py-2 text-right font-mono text-gray-400">{brl(i.preco_unitario)}</td>
                                <td className="py-2 text-right font-mono text-gray-200">{brl(i.subtotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {Number(p.cupom_desconto) > 0 && (
                          p.cupom_ignorado ? (
                            // O pedido guarda o que foi prometido; a venda diz o que
                            // foi cobrado. Sem esta linha a diferença viraria mistério.
                            <p className="text-[11px] text-yellow-400 mt-2 text-right">
                              Cupom {p.cupom_codigo} não foi aplicado — venda fechada por {brl(p.total)}
                            </p>
                          ) : (
                            <p className="text-[11px] text-emerald-400 mt-2 text-right">
                              Cupom {p.cupom_codigo}: −{brl(p.cupom_desconto)} sobre {brl(p.total)}
                            </p>
                          )
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

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
                <br />
                <span className="text-gray-500">Preferiu {atendendo.forma_desejada}. Você registra a forma real.</span>
              </div>
              ); })()}

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
                <select id="po-cli" value={clienteId} onChange={e => setClienteId(e.target.value)}
                  className="neu-input rounded-xl px-3 py-2.5 text-sm">
                  <option value="">
                    {EXIGE_CLIENTE.includes(forma) ? 'Escolha o cliente…' : 'Sem cliente cadastrado'}
                  </option>
                  {clientesOpts.map((g: any) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              <p className="text-[11px] text-gray-500 leading-relaxed mb-5">
                Confirmar cria a venda pelo mesmo caminho do PDV: baixa estoque, gera conta a receber
                e emite a nota. Se algum item tiver ficado sem estoque desde o pedido, a operação é
                recusada inteira e o pedido continua na fila.
                {EXIGE_CLIENTE.includes(forma) && (
                  <> <span className="text-yellow-400">{forma} deixa a conta em aberto, por isso o cliente
                  é obrigatório: sem ele a cobrança fica sem devedor.</span></>
                )}
              </p>

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
  if (!filialAtiva) return null;
  return <PedidosOnlineInner showToast={showToast} profile={profile} filial={filialAtiva} />;
};
