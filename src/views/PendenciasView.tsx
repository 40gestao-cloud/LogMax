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

import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, RefreshCw, Sparkles, FileDown, CheckCircle2, Clock, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authFetch } from '../lib/authFetch';
import { LoadingSpinner } from '../components/ui';
import { formatDataHoraBR } from '../lib/dates';
import { exportPendenciasPDF, type PendenciaLinha, type PendenciaLeitura } from '../lib/pendenciasPdf';
import type { UserProfile } from '../hooks/useUserProfile';

const UNIDADES = ['SuperMax', 'MaxLook', 'TechMax', 'Matriz'] as const;

const COR_GRAVIDADE: Record<string, string> = {
  alta:  'text-red-400 border-red-500/30 bg-red-500/5',
  media: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5',
  baixa: 'text-gray-400 border-white/10 bg-white/5',
};
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

  // Agrupado por quem tem a caneta: a pergunta do professor em aula é "quem
  // está segurando a fila?", e uma lista plana de 86 linhas não responde isso.
  const porResponsavel = useMemo(() => {
    const mapa = new Map<string, PendenciaLinha[]>();
    for (const l of linhas ?? []) {
      const chave = `${l.responsavel} · ${l.responsavel_papel}${filial ? '' : ` · ${l.filial ?? '—'}`}`;
      const g = mapa.get(chave) ?? [];
      g.push(l);
      mapa.set(chave, g);
    }
    return [...mapa.entries()].sort((a, b) => {
      const urg = (x: PendenciaLinha[]) => x.filter(i => i.gravidade === 'alta').length;
      if (urg(b[1]) !== urg(a[1])) return urg(b[1]) - urg(a[1]);
      return b[1].length - a[1].length;
    });
  }, [linhas, filial]);

  return (
    <div className="flex flex-col gap-5">
      {/* Controles */}
      <div className="neu-flat rounded-2xl p-4 border border-accent/15 flex flex-wrap items-end gap-3">
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

        <button
          type="button"
          onClick={levantar}
          disabled={loading}
          className="neu-button rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-accent flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {linhas ? 'Atualizar' : 'Levantar pendências'}
        </button>

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
          {/* Painel de números — apuração, não opinião */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              { label: 'Paradas', valor: String(resumo.total), cor: 'text-gray-100' },
              { label: 'Urgentes', valor: String(resumo.urgentes), cor: 'text-red-400' },
              { label: 'Atenção', valor: String(resumo.atencao), cor: 'text-yellow-400' },
              { label: 'A pagar parado', valor: BRL(resumo.aPagar), cor: 'text-red-300' },
              { label: 'A receber parado', valor: BRL(resumo.aReceber), cor: 'text-emerald-300' },
              { label: 'Há mais tempo', valor: `${resumo.maisAntiga}d`, cor: 'text-gray-100' },
            ].map(c => (
              <div key={c.label} className="neu-pressed rounded-xl p-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">{c.label}</div>
                <div className={`text-base font-black tabular-nums mt-0.5 ${c.cor}`}>{c.valor}</div>
              </div>
            ))}
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

          {/* A lista, agrupada por quem tem a caneta */}
          <div className="flex flex-col gap-3">
            {porResponsavel.map(([chave, itens]) => (
              <div key={chave} className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-4 py-3 bg-white/[0.03] border-b border-white/5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Users size={13} className="text-accent shrink-0" />
                    <span className="text-sm font-bold text-gray-100 truncate">{chave}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {itens.filter(i => i.gravidade === 'alta').length > 0 && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-red-300 bg-red-500/10 border border-red-500/30">
                        {itens.filter(i => i.gravidade === 'alta').length} urgente(s)
                      </span>
                    )}
                    <span className="text-[10px] text-gray-500 tabular-nums">{itens.length} parada(s)</span>
                  </div>
                </div>

                <div className="flex flex-col divide-y divide-white/5">
                  {itens.map(l => (
                    <div key={`${l.documento_id ?? l.documento}-${l.etapa}`} className="px-4 py-2.5 flex items-start gap-3">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0 ${COR_GRAVIDADE[l.gravidade]}`}>
                        {ROTULO_GRAVIDADE[l.gravidade] ?? l.gravidade}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-gray-200">{l.etapa}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {l.documento}
                          {!filial && ` · ${l.filial ?? '—'}`}
                          {' · '}{l.onde} · {l.acao}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {l.valor != null && Number(l.valor) > 0 && (
                          <div className="text-[12px] font-bold text-gray-200 tabular-nums">{BRL(l.valor)}</div>
                        )}
                        <div className="text-[10px] text-gray-500 flex items-center gap-1 justify-end">
                          <Clock size={10} /> {l.dias_parado}d
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
