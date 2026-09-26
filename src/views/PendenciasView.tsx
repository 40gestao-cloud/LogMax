// Pendências — o que está parado, onde, e esperando quem (migr. 477).
//
// A Conferência responde "o que a turma fez errado hoje". Esta tela responde a
// outra pergunta, que não cabe no recorte de sessão de aula: "o que ficou para
// trás?". Por isso ela NÃO filtra por sessão — filtra por unidade, e o dado que
// importa é há quantos dias o documento está parado, o que atravessa aulas.
//
// Vive em DOIS lugares, e é o mesmo componente nos dois: item de primeiro nível
// na sidebar (é pergunta de qualquer terça-feira, não só de dia de aula) e aba
// ao lado da Conferência dentro do Modo Aula, que é onde a mão vai durante a
// aula. Uma tela, duas portas — como a Central de Avaliação já faz.
//
// Duas camadas, e a separação é a mesma da 471/472:
//
//   1. A LISTA — RPC `listar_pendencias`. Contagem, valor, dias e responsável
//      saem do SQL. Tudo verificável: o professor abre o documento e confere.
//   2. A LEITURA — `/api/ai-aula-atividade` no modo `pendencias`. Diz por onde
//      começar. É opinião, tem botão próprio e aparece rotulada.
//
// O PDF nasce das duas juntas, nessa ordem: números primeiro, opinião depois.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, RefreshCw, Sparkles, FileDown, CheckCircle2, Clock, Users, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authFetch } from '../lib/authFetch';
import { LoadingSpinner, CardContador } from '../components/ui';
import { formatDataHoraBR } from '../lib/dates';
import { exportPendenciasPDF, type PendenciaLinha, type PendenciaLeitura } from '../lib/pendenciasPdf';
import type { UserProfile } from '../hooks/useUserProfile';

const UNIDADES = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'] as const;

const COR_GRAVIDADE: Record<string, string> = {
  alta:  'bg-red-600 text-white',
  media: 'bg-amber-500 text-black',
  baixa: 'bg-zinc-700 text-zinc-200',
};
const ORDEM_GRAVIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

// Com centenas de linhas, a pergunta muda conforme o recorte: onde está
// parado (unidade), o que está parado (tipo) ou quem segura (responsável).
type Agrupamento = 'unidade' | 'tipo' | 'responsavel';
const AGRUPAMENTOS: { id: Agrupamento; label: string }[] = [
  { id: 'unidade', label: 'Unidade' },
  { id: 'tipo', label: 'Tipo' },
  { id: 'responsavel', label: 'Responsável' },
];
const ROTULO_GRAVIDADE: Record<string, string> = {
  alta: 'Urgente', media: 'Atenção', baixa: 'Na fila',
};

const BRL = (v: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  showToast: (msg: string, type?: string) => void;
  profile: UserProfile | null;
}

export const PendenciasView: React.FC<Props> = ({ showToast, profile }) => {
  // Migr. 527: o professor atravessa as unidades; o gerente vê a dele. O
  // seletor nasce travado na unidade do gerente porque a RPC recusa qualquer
  // outra — deixar o select aberto seria oferecer um caminho que dá 42501.
  const ehGerente = profile?.role === 'gerente';
  const minhaFilial = String(profile?.filial ?? '');
  const [filial, setFilial] = useState<string>(ehGerente ? minhaFilial : '');
  const [linhas, setLinhas] = useState<PendenciaLinha[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [leitura, setLeitura] = useState<PendenciaLeitura>(null);
  const [loadingIA, setLoadingIA] = useState(false);
  const [modeloIA, setModeloIA] = useState('');
  const [lidasIA, setLidasIA] = useState<number | null>(null);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [agrupar, setAgrupar] = useState<Agrupamento>(ehGerente ? 'tipo' : 'unidade');
  const [gravidade, setGravidade] = useState<string>('');
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const levantar = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setErro(null);
    // Trocar de unidade invalida a leitura: opinião sobre a SuperMax embaixo da
    // lista da TechMax seria pior que não ter opinião nenhuma.
    setLeitura(null);
    setLidasIA(null);
    const { data, error } = await supabase.rpc('listar_pendencias', {
      p_filial: filial || null,
    });
    setLoading(false);
    if (error) {
      setErro(error.message);
      setLinhas([]);
      showToast('Não foi possível levantar as pendências.', 'error');
      return;
    }
    setLinhas((data ?? []) as PendenciaLinha[]);
  }, [filial, showToast]);

  // Abre já levantada: a tela existe para mostrar o que está parado.
  useEffect(() => { void levantar(); }, [levantar]);

  const pedirLeitura = useCallback(async () => {
    setLoadingIA(true);
    try {
      const resp = await authFetch('/api/ai-aula-atividade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'pendencias', filial: filial || null }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        showToast(json?.error || 'A IA não conseguiu ler as pendências.', 'error');
        return;
      }
      if (!json.leitura) {
        showToast('Nada parado para a IA ler.', 'info');
        return;
      }
      setLeitura(json.leitura as PendenciaLeitura);
      setModeloIA(String(json.modelo_ia ?? ''));
      setLidasIA(Number(json.itens_analisados ?? 0));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao falar com a IA.', 'error');
    } finally {
      setLoadingIA(false);
    }
  }, [filial, showToast]);

  const baixarPdf = useCallback(async () => {
    if (!linhas?.length) return;
    setGerandoPdf(true);
    try {
      const escopo = filial || 'todas-as-unidades';
      await exportPendenciasPDF(
        {
          filial: filial || null,
          geradoEm: formatDataHoraBR(new Date().toISOString()),
          linhas,
          leitura,
          modeloIA: modeloIA || 'MaxAI',
          lidasPelaIA: lidasIA,
        },
        `pendencias-${escopo.toLowerCase().replace(/\s+/g, '-')}`,
        'download',
        profile,
        showToast as any,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao gerar o PDF.', 'error');
    } finally {
      setGerandoPdf(false);
    }
  }, [linhas, leitura, filial, modeloIA, lidasIA, profile, showToast]);

  // Números da tela saem daqui — das linhas do SQL, nunca do texto da IA.
  //
  // Dinheiro NÃO se soma tudo junto. Uma versão anterior mostrava "valor
  // envolvido" somando conta a pagar (dívida), conta a receber (crédito),
  // pedido (compromisso de compra) e o troco do caixa. O número ficava enorme
  // e não significava nada — e número que parece autoridade sem significar
  // nada é pior que número nenhum. Agora são dois totais, cada um de uma
  // natureza só, e o resto continua no valor de cada linha.
  const resumo = useMemo(() => {
    const l = linhas ?? [];
    const somaDe = (etapaInclui: string) => l
      .filter(x => x.etapa.startsWith(etapaInclui))
      .reduce((t, x) => t + (Number(x.valor) || 0), 0);
    return {
      total: l.length,
      urgentes: l.filter(x => x.gravidade === 'alta').length,
      atencao: l.filter(x => x.gravidade === 'media').length,
      aPagar: somaDe('Conta a pagar'),
      aReceber: somaDe('Conta a receber'),
      maisAntiga: l.reduce((m, x) => Math.max(m, x.dias_parado || 0), 0),
    };
  }, [linhas]);

  const chaveDe = useCallback((l: PendenciaLinha) => {
    if (agrupar === 'unidade') return l.filial ?? 'Sem unidade';
    if (agrupar === 'tipo') return l.etapa;
    return `${l.responsavel} · ${l.responsavel_papel}${filial ? '' : ` · ${l.filial ?? '—'}`}`;
  }, [agrupar, filial]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, PendenciaLinha[]>();
    for (const l of linhas ?? []) {
      if (gravidade && l.gravidade !== gravidade) continue;
      const k = chaveDe(l);
      const g = mapa.get(k) ?? [];
      g.push(l);
      mapa.set(k, g);
    }
    const urg = (x: PendenciaLinha[]) => x.filter(i => i.gravidade === 'alta').length;
    return [...mapa.entries()]
      .map(([k, itens]) => [k, [...itens].sort((a, b) =>
        (ORDEM_GRAVIDADE[a.gravidade] ?? 9) - (ORDEM_GRAVIDADE[b.gravidade] ?? 9) || b.dias_parado - a.dias_parado)] as const)
      .sort((a, b) => urg(b[1]) - urg(a[1]) || b[1].length - a[1].length);
  }, [linhas, gravidade, chaveDe]);

  return (
    <div className="flex flex-col gap-5">
      {/* Controles */}
      <div className="neu-flat rounded-2xl p-4 border border-white/5 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Unidade</label>
          {ehGerente ? (
            <div className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 min-w-52">
              {minhaFilial || '—'}
            </div>
          ) : (
            <select
              value={filial}
              onChange={e => setFilial(e.target.value)}
              className="neu-pressed rounded-xl px-3 py-2.5 text-sm text-gray-100 bg-transparent outline-none min-w-52"
            >
              <option value="">Todas as unidades</option>
              {UNIDADES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Agrupar por</span>
          <div className="flex gap-1 neu-pressed rounded-xl p-1 border border-white/5" role="radiogroup">
            {AGRUPAMENTOS.filter(g => !(ehGerente && g.id === 'unidade')).map(g => (
              <button key={g.id} type="button" role="radio" aria-checked={agrupar === g.id}
                onClick={() => { setAgrupar(g.id); setAbertos({}); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  agrupar === g.id ? 'bg-accent text-[var(--color-accent-text)]' : 'text-gray-400 hover:text-gray-200'}`}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <button type="button" onClick={levantar} disabled={loading} title="Atualizar"
          className="neu-button w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-accent disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <span className="flex-1" />

        {!!linhas?.length && (
          <>
            <button
              type="button"
              onClick={pedirLeitura}
              disabled={loadingIA}
              className="neu-button rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-purple-300 border border-purple-500/30 flex items-center gap-2 disabled:opacity-50"
            >
              <Sparkles size={13} className={loadingIA ? 'animate-pulse' : ''} />
              {loadingIA ? 'Lendo…' : 'Pedir leitura da IA'}
            </button>

            <button
              type="button"
              onClick={baixarPdf}
              disabled={gerandoPdf}
              className="btn-solido btn-solido--vermelho"
            >
              <FileDown size={13} />
              {gerandoPdf ? 'Gerando…' : 'Baixar PDF'}
            </button>
          </>
        )}
      </div>

      {erro && (
        <div className="neu-flat rounded-2xl p-4 border border-red-500/30 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {loading && <LoadingSpinner />}

      {linhas && linhas.length === 0 && !loading && (
        <div className="neu-flat rounded-2xl p-6 border border-emerald-500/20 flex items-center gap-3 text-sm text-emerald-300">
          <CheckCircle2 size={16} />
          Nada parado {filial ? `em ${filial}` : 'em nenhuma unidade'}. A fila está limpa.
        </div>
      )}

      {!!linhas?.length && (
        <>
          {/* Números do SQL, nunca da IA. Clicar em Urgentes/Atenção filtra a lista. */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <CardContador label="Paradas" value={resumo.total}
              onClick={() => setGravidade('')} ativo={gravidade === ''} />
            <CardContador label="Urgentes" value={resumo.urgentes} tom="vermelho"
              onClick={() => setGravidade(g => g === 'alta' ? '' : 'alta')} ativo={gravidade === 'alta'} />
            <CardContador label="Atenção" value={resumo.atencao} tom="amarelo"
              onClick={() => setGravidade(g => g === 'media' ? '' : 'media')} ativo={gravidade === 'media'} />
            <CardContador label="A pagar parado" value={BRL(resumo.aPagar)} tom="laranja" />
            <CardContador label="A receber parado" value={BRL(resumo.aReceber)} tom="verde" />
            <CardContador label="Há mais tempo" value={`${resumo.maisAntiga} dias`} />
          </div>

          {/* Leitura da IA — bloco separado, cor separada, rótulo explícito */}
          {leitura && (
            <div className="neu-flat rounded-2xl p-4 border border-purple-500/30 border-dashed flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-purple-300" />
                <h4 className="text-[11px] font-black uppercase tracking-widest text-purple-300">
                  Por onde começar — leitura da IA
                </h4>
              </div>
              <p className="text-[10px] text-gray-500 -mt-2">
                Opinião de {modeloIA || 'MaxAI'}
                {lidasIA != null && lidasIA < resumo.total && ` sobre ${lidasIA} das ${resumo.total} pendências`}
                . Os números acima são do sistema, não dela.
              </p>

              {leitura.resumo && (
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{leitura.resumo}</p>
              )}

              {leitura.prioridades.map((p, i) => (
                <div key={i} className="neu-pressed rounded-xl p-3">
                  <div className="text-sm font-bold text-gray-100">{i + 1}. {p.titulo}</div>
                  {p.porque && <p className="text-[11px] text-gray-400 mt-1">{p.porque}</p>}
                  {p.quem && (
                    <p className="text-[11px] text-purple-300 mt-1 flex items-center gap-1.5">
                      <Users size={11} /> {p.quem}
                    </p>
                  )}
                </div>
              ))}

              {!!leitura.padroes.length && (
                <div className="pt-1 border-t border-white/5">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">O que se repete</div>
                  <ul className="flex flex-col gap-1">
                    {leitura.padroes.map((t, i) => (
                      <li key={i} className="text-[11px] text-gray-400">• {t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Grupos recolhidos: 300 linhas abertas de uma vez não se leem. */}
          <div className="flex flex-col gap-2">
            {grupos.length === 0 && (
              <p className="text-sm text-gray-500 px-1">Nada com esse filtro.</p>
            )}
            {grupos.map(([chave, itens], idx) => {
              const aberto = abertos[chave] ?? (grupos.length === 1 && idx === 0);
              const urgentes = itens.filter(i => i.gravidade === 'alta').length;
              const atencao = itens.filter(i => i.gravidade === 'media').length;
              const maisVelho = itens.reduce((m, i) => Math.max(m, i.dias_parado || 0), 0);
              return (
                <div key={chave} className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
                  <button type="button" onClick={() => setAbertos(a => ({ ...a, [chave]: !aberto }))}
                    aria-expanded={aberto}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.03] transition-colors">
                    {agrupar === 'responsavel' && <Users size={14} className="text-accent shrink-0" />}
                    <span className="flex-1 min-w-0 text-sm font-bold text-gray-100 truncate">{chave}</span>
                    <span className="hidden sm:flex items-center gap-1 text-[11px] text-gray-500 shrink-0">
                      <Clock size={11} /> até {maisVelho}d
                    </span>
                    {urgentes > 0 && (
                      <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black bg-red-600 text-white tabular-nums">{urgentes} urgente(s)</span>
                    )}
                    {atencao > 0 && (
                      <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500 text-black tabular-nums">{atencao} atenção</span>
                    )}
                    <span className="shrink-0 min-w-8 text-center px-2 py-0.5 rounded-md text-xs font-black bg-white/10 text-gray-200 tabular-nums">{itens.length}</span>
                    <ChevronDown size={16} className={`shrink-0 text-gray-500 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                  </button>

                  {aberto && (
                    <div className="flex flex-col divide-y divide-white/5 border-t border-white/5">
                      {itens.map(l => (
                        <div key={`${l.documento_id ?? l.documento}-${l.etapa}`} className="px-4 py-2.5 flex items-center gap-3">
                          <span className={`w-16 text-center text-[9px] font-black uppercase tracking-widest py-1 rounded-md shrink-0 ${COR_GRAVIDADE[l.gravidade] ?? ''}`}>
                            {ROTULO_GRAVIDADE[l.gravidade] ?? l.gravidade}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-gray-200 truncate">
                              {agrupar === 'tipo' ? l.documento : <>{l.etapa} <span className="text-gray-500">· {l.documento}</span></>}
                            </p>
                            <p className="text-[11px] text-gray-500 truncate">
                              {agrupar !== 'unidade' && !filial && `${l.filial ?? '—'} · `}
                              {agrupar !== 'responsavel' && `${l.responsavel} · `}
                              {l.acao} <span className="text-gray-600">em {l.onde}</span>
                            </p>
                          </div>
                          {l.valor != null && Number(l.valor) > 0 && (
                            <span className="text-[12px] font-bold text-gray-200 tabular-nums shrink-0">{BRL(l.valor)}</span>
                          )}
                          <span className={`w-12 text-right text-[11px] tabular-nums shrink-0 ${l.dias_parado >= 7 ? 'text-red-400 font-bold' : 'text-gray-500'}`}>
                            {l.dias_parado}d
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
