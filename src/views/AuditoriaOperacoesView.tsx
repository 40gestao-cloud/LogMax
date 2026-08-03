// Auditoria — a aula inteira num lugar só.
//
// As fases 1 e 2 puseram a trilha em cada documento (migr. 331/332), e isso
// responde "o que aconteceu com ESTE pedido". Falta a pergunta que aparece
// quando a dúvida ainda não tem endereço: "o que andou acontecendo aqui?".
// Sem esta tela, responder isso exige abrir documento por documento até
// encontrar o que quebrou.
//
// Quem lê é a RLS quem decide (`historico_select`): gerente enxerga a própria
// unidade, Matriz enxerga tudo. A tela não repete essa régua — repetir criaria
// duas fontes da verdade que divergem no primeiro ajuste de RBAC.
//
// O menu é role-gated (admin/CEO/conselheiro/gerente). O colaborador continua
// com o histórico dentro de cada documento, que é o que resolve a dúvida dele
// sobre o próprio trabalho; a visão agregada da unidade — incluindo folha e
// contas — é de quem responde pela unidade.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Search, RefreshCw, Sheet, History } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { HistoricoOperacoes } from '../components/HistoricoOperacoes';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatDataHoraBR, todayBR } from '../lib/dates';
import { exportToExcel } from '../lib/viewUtils';

const PAGE = 60;

// Nome do documento como a pessoa o chama no corredor, não o nome da tabela.
const ENTIDADE_LABEL: Record<string, string> = {
  requisicoes: 'Requisição de compra',
  requisicoes_estoque: 'Requisição de material',
  aprovacoes_compras: 'Aprovação de compra',
  aprovacoes_estoque: 'Liberação de material',
  cotacoes: 'Cotação',
  pedidos: 'Pedido de compra',
  recebimentos: 'Recebimento',
  contas_pagar: 'Conta a pagar',
  contas_receber: 'Conta a receber',
  vendas: 'Venda',
  devolucoes: 'Devolução',
  orcamentos: 'Orçamento',
  pedidos_venda: 'Pedido de venda',
  expedicao: 'Expedição',
  notas_emitidas: 'Nota emitida',
  notas_recebidas: 'Nota recebida',
  controle_caixa: 'Caixa',
  folha_pagamento: 'Folha de pagamento',
};

const COR_EVENTO: Record<string, string> = {
  Criado:    'text-emerald-400 border-emerald-500/30',
  Status:    'text-accent border-accent/30',
  Alterado:  'text-yellow-400 border-yellow-500/30',
  Inativado: 'text-red-400 border-red-500/30',
};

type Linha = {
  id: string; entidade: string; entidade_id: string; filial: string | null;
  evento: string; de: string | null; para: string | null; detalhe: string | null;
  ator_nome: string | null; ator_setor: string | null; created_at: string;
};

// Recortes de tempo em dias. 'Hoje' usa a data do Acre — com o dia do
// navegador, às 19h locais o filtro pularia para amanhã e esconderia o que
// acabou de acontecer.
const PERIODOS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7',    label: '7 dias' },
  { id: '30',   label: '30 dias' },
  { id: 'tudo', label: 'Tudo' },
] as const;

export const AuditoriaOperacoesView = ({ showToast }: { showToast?: any }) => {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [periodo, setPeriodo] = useState<typeof PERIODOS[number]['id']>('hoje');
  const [entidade, setEntidade] = useState('');
  const [ator, setAtor] = useState('');
  const [evento, setEvento] = useState('');
  const [busca, setBusca] = useState('');
  const buscaDeb = useDebouncedValue(busca, 300);

  useEffect(() => { setPage(0); }, [periodo, entidade, ator, evento, buscaDeb]);

  const desde = useMemo(() => {
    if (periodo === 'tudo') return null;
    if (periodo === 'hoje') return `${todayBR()}T00:00:00`;
    const d = new Date();
    d.setDate(d.getDate() - Number(periodo));
    return d.toISOString();
  }, [periodo]);

  const carregar = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setErro(null);
    let q = supabase
      .from('historico_operacoes')
      .select('id, entidade, entidade_id, filial, evento, de, para, detalhe, ator_nome, ator_setor, created_at',
              { count: 'exact' })
      .order('created_at', { ascending: false });

    if (desde)    q = q.gte('created_at', desde);
    if (entidade) q = q.eq('entidade', entidade);
    if (evento)   q = q.eq('evento', evento);
    if (ator)     q = q.eq('ator_nome', ator);
    // Busca no que é texto livre: o detalhe da mudança e o status de destino.
    if (buscaDeb.trim()) {
      const t = buscaDeb.trim().replace(/[%,()]/g, '');
      q = q.or(`detalhe.ilike.%${t}%,para.ilike.%${t}%,ator_nome.ilike.%${t}%`);
    }

    const { data, error, count } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { setErro(error.message); setLinhas([]); }
    else { setLinhas((data ?? []) as Linha[]); setTotal(count ?? null); }
    setLoading(false);
  }, [desde, entidade, evento, ator, buscaDeb, page]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Lista de pessoas para o filtro. Sai do próprio histórico, não de
  // `user_profiles`: quem nunca operou não precisa aparecer, e quem operou e
  // saiu da empresa precisa continuar aparecendo.
  const [atores, setAtores] = useState<string[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let cancelado = false;
    (async () => {
      const { data } = await supabase!
        .from('historico_operacoes')
        .select('ator_nome')
        .not('ator_nome', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      if (cancelado) return;
      setAtores([...new Set((data ?? []).map((r: any) => r.ator_nome as string))].sort(
        (a, b) => a.localeCompare(b, 'pt-BR')));
    })();
    return () => { cancelado = true; };
  }, [desde]);

  // Exporta o que está na tela, não a tabela inteira: quem exporta acabou de
  // filtrar, e mandar 40 mil linhas para o Excel desfaz o filtro que ele fez.
  const exportar = async () => {
    if (linhas.length === 0) { showToast?.('Nada para exportar nesta página.', 'error'); return; }
    try {
      await exportToExcel(
        'Auditoria',
        ['Data/hora', 'Documento', 'Referência', 'Unidade', 'Evento', 'De', 'Para', 'Detalhe', 'Quem', 'Setor'],
        linhas.map(l => [
          formatDataHoraBR(l.created_at),
          ENTIDADE_LABEL[l.entidade] ?? l.entidade,
          String(l.entidade_id).slice(-6).toUpperCase(),
          l.filial ?? '—',
          l.evento,
          l.de ?? '—',
          l.para ?? '—',
          l.detalhe ?? '—',
          l.ator_nome ?? '—',
          l.ator_setor ?? '—',
        ]),
        `logmax-auditoria-${todayBR()}`,
      );
    } catch (err: any) {
      showToast?.(err?.message ?? 'Falha ao gerar Excel.', 'error', true);
    }
  };

  const temMais = total !== null && (page + 1) * PAGE < total;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full gap-6">

      <div className="flex flex-wrap justify-between items-start gap-3 shrink-0">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-accent tracking-tight">Auditoria</h2>
          <p className="text-sm text-gray-400 mt-1">
            Tudo que foi feito nos documentos, em ordem. Serve para a dúvida que ainda não tem
            endereço — quem mexeu, quando, e o que mudou.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void carregar()} disabled={loading}
            className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Atualizar
          </button>
          <button onClick={exportar}
            className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white flex items-center gap-2">
            <Sheet size={13} />Excel
          </button>
        </div>
      </div>

      <div className="neu-flat rounded-2xl p-4 border border-white/5 shrink-0 flex flex-wrap gap-3 items-end">
        <div className="flex gap-1.5">
          {PERIODOS.map(p => (
            <button key={p.id} onClick={() => setPeriodo(p.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors ${
                periodo === p.id ? 'neu-pressed text-accent' : 'neu-button text-gray-500 hover:text-gray-300'
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="aud-doc" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Documento</label>
          <select id="aud-doc" value={entidade} onChange={e => setEntidade(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm">
            <option value="">Todos</option>
            {Object.entries(ENTIDADE_LABEL)
              .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="aud-quem" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Quem</label>
          <select id="aud-quem" value={ator} onChange={e => setAtor(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm">
            <option value="">Todos</option>
            {atores.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="aud-evento" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Evento</label>
          <select id="aud-evento" value={evento} onChange={e => setEvento(e.target.value)}
            className="neu-input rounded-xl px-3 py-2 text-sm">
            <option value="">Todos</option>
            {['Criado', 'Status', 'Alterado', 'Inativado'].map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label htmlFor="aud-busca" className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Busca</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input id="aud-busca" type="text" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Status, mudança ou pessoa..."
              className="neu-input rounded-xl pl-9 pr-3 py-2 text-sm w-full" />
          </div>
        </div>
      </div>

      {loading && linhas.length === 0 ? <LoadingSpinner /> : erro ? (
        <EmptyState message="Auditoria" error={erro} />
      ) : linhas.length === 0 ? (
        <EmptyState message={periodo === 'hoje'
          ? 'Nada registrado hoje. Troque o período para ver o que já aconteceu.'
          : 'Nenhum registro para estes filtros.'} />
      ) : (
        <div className="neu-flat rounded-3xl p-6 border border-white/5 flex flex-col flex-1 min-h-0 mb-6">
          <div className="overflow-auto main-scrollbar flex-1">
            <table className="w-full text-left border-collapse min-w-[860px]">
              <thead>
                <tr className="border-b border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                  <th className="pb-4 font-bold px-3">Quando</th>
                  <th className="pb-4 font-bold px-3">Documento</th>
                  <th className="pb-4 font-bold px-3">Evento</th>
                  <th className="pb-4 font-bold px-3">O que mudou</th>
                  <th className="pb-4 font-bold px-3">Quem</th>
                  <th className="pb-4 font-bold px-3 text-right">Trilha</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-3 text-[11px] font-mono text-gray-500 whitespace-nowrap">
                      {formatDataHoraBR(l.created_at)}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs font-semibold text-gray-200">
                        {ENTIDADE_LABEL[l.entidade] ?? l.entidade}
                      </span>
                      <span className="block text-[10px] font-mono text-gray-600">
                        {String(l.entidade_id).slice(-6).toUpperCase()}
                        {l.filial && <span className="uppercase tracking-widest"> · {l.filial}</span>}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${COR_EVENTO[l.evento] ?? 'text-gray-400 border-white/10'}`}>
                        {l.evento}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-300 max-w-[280px]">
                      {(l.de || l.para) && (
                        <span className="block">
                          {l.de ? <><span className="text-gray-500">{l.de}</span> → </> : null}
                          <span className="font-bold text-gray-100">{l.para ?? '—'}</span>
                        </span>
                      )}
                      {l.detalhe && (
                        <span className="block text-[10px] text-gray-500 line-clamp-2" title={l.detalhe}>
                          {l.detalhe}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-300">
                      {l.ator_nome ?? '—'}
                      {l.ator_setor && (
                        <span className="block text-[10px] text-gray-600 uppercase tracking-widest">{l.ator_setor}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {/* Da linha solta para a história do documento inteiro,
                          que é o passo seguinte natural de quem está caçando
                          o que deu errado. */}
                      <HistoricoOperacoes entidade={l.entidade} entidadeId={l.entidade_id}
                        titulo={`${ENTIDADE_LABEL[l.entidade] ?? l.entidade} ${String(l.entidade_id).slice(-6).toUpperCase()}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 pt-4 shrink-0">
            <span className="text-[11px] text-gray-500">
              {total !== null && (
                <>Mostrando {page * PAGE + 1}–{page * PAGE + linhas.length} de {total} registro(s)</>
              )}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}
                className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white disabled:opacity-40">
                Anterior
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={!temMais || loading}
                className="neu-button rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white disabled:opacity-40">
                Próxima
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-600 leading-relaxed shrink-0 -mt-2 flex items-start gap-1.5">
        <History size={11} className="shrink-0 mt-0.5" />
        A trilha é append-only: ninguém edita nem apaga pela aplicação, inclusive quem está lendo
        esta tela. Gerente vê a própria unidade; a Matriz vê todas.
      </p>
    </motion.div>
  );
};
