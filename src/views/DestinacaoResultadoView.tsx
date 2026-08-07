import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Landmark, PiggyBank, Scale, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingSpinner, FilialBadge } from '../components/ui';
import { formatBRL, parseBRL, handleMoneyKeyDown } from '../lib/viewUtils';
import { isConselho } from '../lib/rbac';
import { FILIAIS_OP } from './AvaliacoesView';
import type { UserProfile } from '../hooks/useUserProfile';

// Destinação do resultado (migração 381) — fecha o trio com Orçamento (378)
// e Prestação de Contas (379): a verba é dada, o gasto é explicado, e o que
// sobrou tem destino decidido.
//
// O lucro NÃO é digitado: vem de `apurar_resultado_periodo`, que soma contas
// recebidas menos contas pagas no período (regime de caixa, por `pago_em`).
// A tela só distribui esse número entre reserva, reinvestimento e
// distribuição — e a soma tem de fechar, senão a RPC recusa.
//
// Reserva e reinvestimento não movem dinheiro: são classificação do que fica
// no caixa da unidade. Só a distribuição transfere, da filial para a Matriz.

type Destinacao = {
  id: string;
  filial: string;
  periodo_inicio: string;
  periodo_fim: string;
  lucro_apurado: number;
  valor_reserva: number;
  valor_reinvestido: number;
  valor_distribuido: number;
  justificativa: string | null;
  deliberado_por_nome: string | null;
  deliberado_em: string;
};

type Banco = { id: string; banco: string | null; conta: string | null; filial: string | null; saldo: number | null };

const brDate = (d: string) => d.split('-').reverse().join('/');
const rotulo = (b: Banco) => b.banco || b.conta || '—';

export function DestinacaoResultadoView({
  profile,
  showToast,
}: {
  profile: UserProfile | null;
  showToast: (msg: string, t?: string) => void;
}) {
  // Deliberar a destinação do lucro é ato de Conselho (migr. 387): o CEO
  // fica de fora, como em orçamento e prestação de contas. Quem barra de
  // verdade é `deliberar_destinacao_resultado`.
  const conselho = isConselho(profile);

  const [historico, setHistorico] = useState<Destinacao[]>([]);
  const [bancos, setBancos]       = useState<Banco[]>([]);
  const [loading, setLoading]     = useState(true);
  const [salvando, setSalvando]   = useState(false);

  const ano = new Date().getFullYear();
  const [filial, setFilial]   = useState<string>(FILIAIS_OP[0]);
  const [inicio, setInicio]   = useState(`${ano}-01-01`);
  const [fim, setFim]         = useState(`${ano}-12-31`);
  const [apuracao, setApuracao] = useState<{ receitas: number; despesas: number; lucro: number } | null>(null);

  const [reserva, setReserva]           = useState('');
  const [reinvestido, setReinvestido]   = useState('');
  const [distribuido, setDistribuido]   = useState('');
  const [origem, setOrigem]             = useState('');
  const [destino, setDestino]           = useState('');
  const [justificativa, setJustificativa] = useState('');

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [{ data: dests }, { data: bcs }] = await Promise.all([
      supabase.from('destinacoes_resultado')
        .select('id, filial, periodo_inicio, periodo_fim, lucro_apurado, valor_reserva, valor_reinvestido, valor_distribuido, justificativa, deliberado_por_nome, deliberado_em')
        .eq('ativo', true)
        .order('deliberado_em', { ascending: false }),
      supabase.from('caixa_bancos')
        .select('id, banco, conta, filial, saldo')
        .eq('ativo', true)
        .order('filial'),
    ]);
    setHistorico((dests ?? []) as Destinacao[]);
    setBancos((bcs ?? []) as Banco[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const apurar = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('apurar_resultado_periodo', {
      p_filial: filial, p_inicio: inicio, p_fim: fim,
    });
    if (error) { showToast(`Erro na apuração: ${error.message}`, 'error'); return; }
    const linha = Array.isArray(data) ? data[0] : data;
    setApuracao(linha ? {
      receitas: Number(linha.receitas), despesas: Number(linha.despesas), lucro: Number(linha.lucro),
    } : null);
    // Pré-preenche tudo como reinvestimento: é o default conservador, e
    // obriga quem quer distribuir a mover o número de propósito.
    if (linha && Number(linha.lucro) > 0) {
      setReserva(''); setDistribuido('');
      setReinvestido(formatBRL(Number(linha.lucro)));
    }
  }, [filial, inicio, fim, showToast]);

  const soma = parseBRL(reserva) + parseBRL(reinvestido) + parseBRL(distribuido);
  const fecha = apuracao ? Math.abs(soma - apuracao.lucro) <= 0.01 : false;

  const bancosFilial = useMemo(() => bancos.filter(b => b.filial === filial), [bancos, filial]);
  const bancosMatriz = useMemo(() => bancos.filter(b => b.filial === 'Matriz'), [bancos]);

  const deliberar = async () => {
    if (!supabase) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc('deliberar_destinacao_resultado', {
      p_filial: filial,
      p_inicio: inicio,
      p_fim: fim,
      p_valor_reserva: parseBRL(reserva),
      p_valor_reinvestido: parseBRL(reinvestido),
      p_valor_distribuido: parseBRL(distribuido),
      p_banco_origem_id: origem || null,
      p_banco_destino_id: destino || null,
      p_justificativa: justificativa || null,
    });
    setSalvando(false);
    if (error) { showToast(`Erro: ${error.message}`, 'error'); return; }
    const d = data as any;
    showToast(
      `Destinação deliberada. Distribuído à Matriz: R$ ${formatBRL(Number(d?.distribuido ?? 0))}.`,
      'success',
    );
    setApuracao(null); setReserva(''); setReinvestido(''); setDistribuido('');
    setOrigem(''); setDestino(''); setJustificativa('');
    carregar();
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Destinação do Resultado</h1>
        <p className="text-sm text-gray-400 mt-1">
          Apurado o resultado do período, decida quanto vira reserva, quanto reinveste e
          quanto é distribuído à Matriz. Todo o lucro precisa ter destino.
        </p>
      </div>

      {conselho && (
        <div className="neu-card p-4 space-y-4">
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Unidade</label>
              <select value={filial} onChange={e => { setFilial(e.target.value); setApuracao(null); }}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                {FILIAIS_OP.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Início</label>
              <input type="date" value={inicio} onChange={e => { setInicio(e.target.value); setApuracao(null); }}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Fim</label>
              <input type="date" value={fim} onChange={e => { setFim(e.target.value); setApuracao(null); }}
                className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={apurar}
                className="neu-button w-full px-3 py-2 rounded-xl text-sm text-accent font-medium flex items-center justify-center gap-2">
                <Scale size={14} /> Apurar
              </button>
            </div>
          </div>

          {apuracao && (
            <>
              <div className="grid sm:grid-cols-3 gap-3">
                <Cartao titulo="Receitas recebidas" valor={apuracao.receitas} tom="text-gray-200" />
                <Cartao titulo="Despesas pagas"     valor={apuracao.despesas} tom="text-gray-200" />
                <Cartao titulo="Resultado"          valor={apuracao.lucro}
                  tom={apuracao.lucro >= 0 ? 'text-green-400' : 'text-red-400'} />
              </div>

              {apuracao.lucro <= 0 ? (
                <div className="text-sm text-red-400">
                  Sem lucro no período — não há resultado a destinar.
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <CampoValor icone={<PiggyBank size={14} />} titulo="Reserva"
                      valor={reserva} set={setReserva} dica="Piso definido pelo Conselho em Capital." />
                    <CampoValor icone={<TrendingUp size={14} />} titulo="Reinvestimento"
                      valor={reinvestido} set={setReinvestido} dica="Fica no caixa da unidade." />
                    <CampoValor icone={<Landmark size={14} />} titulo="Distribuição à Matriz"
                      valor={distribuido} set={setDistribuido} dica="Único que move dinheiro." />
                  </div>

                  <div className={`text-sm ${fecha ? 'text-green-400' : 'text-yellow-400'}`}>
                    Destinado R$ {formatBRL(soma)} de R$ {formatBRL(apuracao.lucro)}
                    {!fecha && ' — a soma precisa fechar com o resultado.'}
                  </div>

                  {parseBRL(distribuido) > 0 && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Sai da conta ({filial})</label>
                        <select value={origem} onChange={e => setOrigem(e.target.value)}
                          className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                          <option value="">Selecione…</option>
                          {bancosFilial.map(b => (
                            <option key={b.id} value={b.id}>{rotulo(b)} — saldo {formatBRL(Number(b.saldo ?? 0))}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Entra na conta (Matriz)</label>
                        <select value={destino} onChange={e => setDestino(e.target.value)}
                          className="neu-input w-full px-3 py-2 rounded-xl text-sm">
                          <option value="">Selecione…</option>
                          {bancosMatriz.map(b => (
                            <option key={b.id} value={b.id}>{rotulo(b)} — saldo {formatBRL(Number(b.saldo ?? 0))}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Justificativa</label>
                    <textarea rows={2} value={justificativa} onChange={e => setJustificativa(e.target.value)}
                      placeholder="Por que este é o melhor destino para o resultado do período."
                      className="neu-input w-full px-3 py-2 rounded-xl text-sm" />
                  </div>

                  <button onClick={deliberar} disabled={salvando || !fecha}
                    className="neu-button px-4 py-2 rounded-xl text-sm text-accent font-medium disabled:opacity-50">
                    Deliberar destinação
                  </button>
                  <p className="text-xs text-gray-500">
                    A decisão é ata: não se edita. Para refazer, delibere outro período.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="text-sm font-medium text-gray-300">Decisões anteriores</div>
        {historico.length === 0 ? (
          <EmptyState message="Nenhuma destinação deliberada ainda." />
        ) : historico.map(d => (
          <div key={d.id} className="neu-card p-4 space-y-2">
            <div className="flex items-center gap-3">
              <FilialBadge filial={d.filial} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-100">
                  Resultado de R$ {formatBRL(Number(d.lucro_apurado))}
                </div>
                <div className="text-xs text-gray-500">
                  {brDate(d.periodo_inicio)} — {brDate(d.periodo_fim)} · {d.deliberado_por_nome ?? '—'}
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-sm">
              <Linha rotulo="Reserva"        valor={Number(d.valor_reserva)} />
              <Linha rotulo="Reinvestimento" valor={Number(d.valor_reinvestido)} />
              <Linha rotulo="Distribuído"    valor={Number(d.valor_distribuido)} />
            </div>
            {d.justificativa && <div className="text-xs text-gray-400">{d.justificativa}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cartao({ titulo, valor, tom }: { titulo: string; valor: number; tom: string }) {
  return (
    <div className="bg-black/20 rounded-xl p-3">
      <div className="text-xs uppercase tracking-wider font-bold text-gray-500">{titulo}</div>
      <div className={`text-lg font-bold tabular-nums ${tom}`}>R$ {formatBRL(valor)}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="bg-black/20 rounded-xl p-2">
      <div className="text-xs text-gray-500">{rotulo}</div>
      <div className="text-gray-200 tabular-nums">R$ {formatBRL(valor)}</div>
    </div>
  );
}

function CampoValor({
  icone, titulo, valor, set, dica,
}: {
  icone: ReactNode; titulo: string; valor: string;
  set: (v: string) => void; dica: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">{icone} {titulo}</label>
      <input type="text" inputMode="numeric" value={valor}
        onKeyDown={handleMoneyKeyDown}
        onChange={e => set(formatBRL(e.target.value))}
        placeholder="0,00"
        className="neu-input w-full px-3 py-2 rounded-xl text-sm text-right" />
      <div className="text-[11px] text-gray-600 mt-1">{dica}</div>
    </div>
  );
}
