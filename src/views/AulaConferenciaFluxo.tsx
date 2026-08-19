// Conferência do fluxo — o que saiu torto na aula, por aluno.
//
// O «Painel de controle» ao lado conta quem FEZ cada tarefa. Esta aba conta
// COMO foi feito: campo em branco, etapa pulada, valor que não bate com a
// cotação, produto cadastrado sem nunca ter sido recebido.
//
// Tudo vem da RPC `auditar_fluxo_compras` (migr. 471), que aplica regra fixa —
// nada aqui é opinião de IA. Se um dia existir a camada de IA (ortografia,
// justificativa vaga), ela entra como uma seção SEPARADA e rotulada, porque
// misturar "o valor não bate" com "achei o nome estranho" faz o professor
// duvidar das duas.
//
// Recorte por SESSÃO de aula, não por data solta: a pergunta que o professor
// tem é "e a aula de hoje?", e a sessão já sabe quando começou e terminou.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, FileWarning, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from '../components/ui';
import { formatDataHoraBR } from '../lib/dates';

type Achado = {
  etapa: string;
  documento: string;
  documento_id: string;
  filial: string | null;
  responsavel: string;
  problema: string;
  detalhe: string;
  gravidade: 'alta' | 'media' | 'baixa';
  ocorrido_em: string;
};

type Sessao = { id: string; iniciada_em: string; encerrada_em: string | null; titulo: string | null };

const COR_GRAVIDADE: Record<string, string> = {
  alta:  'text-red-400 border-red-500/30 bg-red-500/5',
  media: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5',
  baixa: 'text-gray-400 border-white/10 bg-white/5',
};

const ORDEM_GRAVIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

interface Props {
  showToast: (msg: string, type?: string) => void;
}

export const AulaConferenciaFluxo: React.FC<Props> = ({ showToast }) => {
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [sessaoId, setSessaoId] = useState<string>('');
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Aluno aberto na lista. Uma turma de 45 gera dezenas de linhas; abrir tudo
  // de uma vez transforma a tela num paredão que ninguém lê.
  const [aberto, setAberto] = useState<string | null>(null);

  const carregarSessoes = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('aula_sessoes')
      .select('id,iniciada_em,encerrada_em,titulo')
      .order('iniciada_em', { ascending: false })
      .limit(20);
    const lista = (data ?? []) as Sessao[];
    setSessoes(lista);
    // Sessão em curso primeiro; senão a última encerrada. O professor quase
    // sempre quer a aula que está acontecendo.
    if (!sessaoId && lista.length) {
      setSessaoId(lista.find(s => !s.encerrada_em)?.id ?? lista[0].id);
    }
  }, [sessaoId]);

  useEffect(() => { void carregarSessoes(); }, [carregarSessoes]);

  const conferir = useCallback(async () => {
    if (!supabase || !sessaoId) return;
    setLoading(true);
    setErro(null);
    const { data, error } = await supabase.rpc('auditar_fluxo_compras', { p_sessao_id: sessaoId });
    setLoading(false);
    if (error) {
      // Erro de permissão é o caso comum (quem não é professor não passa do
      // guard), e dizer isso evita caça a defeito que não existe.
      setErro(error.message);
      setAchados([]);
      showToast('Não foi possível conferir o fluxo.', 'error');
      return;
    }
    setAchados((data ?? []) as Achado[]);
  }, [sessaoId, showToast]);

  const porAluno = useMemo(() => {
    const mapa = new Map<string, Achado[]>();
    for (const a of achados ?? []) {
      const lista = mapa.get(a.responsavel) ?? [];
      lista.push(a);
      mapa.set(a.responsavel, lista);
    }
    // Quem tem problema grave primeiro; depois quem tem mais.
    return [...mapa.entries()].sort((x, y) => {
      const gx = Math.min(...x[1].map(a => ORDEM_GRAVIDADE[a.gravidade] ?? 3));
      const gy = Math.min(...y[1].map(a => ORDEM_GRAVIDADE[a.gravidade] ?? 3));
      return gx !== gy ? gx - gy : y[1].length - x[1].length;
    });
  }, [achados]);

  const totais = useMemo(() => {
    const t = { alta: 0, media: 0, baixa: 0 };
    for (const a of achados ?? []) t[a.gravidade] = (t[a.gravidade] ?? 0) + 1;
    return t;
  }, [achados]);

  const sessaoAtual = sessoes.find(s => s.id === sessaoId);

  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileWarning size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Conferência do fluxo</h3>
          </div>
          <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
            O que saiu torto no caminho Requisição → Cotação → Pedido → Recebimento →
            Cadastro de Produto. São regras fixas, não opinião: campo em branco, etapa
            pulada, valor que não bate. Serve para conversar com a turma, não para dar nota.
          </p>
        </div>
        <button type="button" onClick={conferir} disabled={loading || !sessaoId}
          className="shrink-0 neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Conferir
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sessaoId}
          onChange={e => { setSessaoId(e.target.value); setAchados(null); }}
          className="neu-pressed rounded-xl px-3 py-2 text-xs text-gray-200 border border-white/5 min-w-[16rem]">
          {sessoes.length === 0 && <option value="">Nenhuma sessão de aula registrada</option>}
          {sessoes.map(s => (
            <option key={s.id} value={s.id}>
              {s.encerrada_em ? '' : '● '}
              {s.titulo || 'Aula'} — {formatDataHoraBR(s.iniciada_em)}
              {s.encerrada_em ? '' : ' (em curso)'}
            </option>
          ))}
        </select>

        {achados && achados.length > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
            {totais.alta > 0 && <span className="px-2 py-1 rounded-full border text-red-400 border-red-500/30">{totais.alta} grave</span>}
            {totais.media > 0 && <span className="px-2 py-1 rounded-full border text-yellow-400 border-yellow-500/30">{totais.media} atenção</span>}
            {totais.baixa > 0 && <span className="px-2 py-1 rounded-full border text-gray-400 border-white/10">{totais.baixa} leve</span>}
          </div>
        )}
      </div>

      {erro && (
        <p className="text-[11px] text-red-400 leading-relaxed flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          {erro}
        </p>
      )}

      {loading ? <LoadingSpinner /> : achados === null ? (
        <p className="text-xs text-gray-500 py-8 text-center leading-relaxed">
          Escolha a aula e clique em <span className="text-gray-300 font-bold">Conferir</span>.<br />
          <span className="text-[11px] text-gray-600">
            A conferência lê os documentos criados dentro da sessão escolhida.
          </span>
        </p>
      ) : achados.length === 0 ? (
        <p className="text-xs text-emerald-400 py-8 text-center leading-relaxed flex flex-col items-center gap-2">
          <CheckCircle2 size={20} />
          Nenhuma inconsistência nesta aula.
          <span className="text-[11px] text-gray-500">
            {sessaoAtual && !sessaoAtual.encerrada_em
              ? 'A aula está em curso — vale conferir de novo mais para o fim.'
              : 'As regras não encontraram campo em branco nem etapa pulada.'}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {porAluno.map(([aluno, lista]) => {
            const graves = lista.filter(a => a.gravidade === 'alta').length;
            const estaAberto = aberto === aluno;
            return (
              <div key={aluno} className="neu-pressed rounded-2xl border border-white/5 overflow-hidden">
                <button
                  onClick={() => setAberto(estaAberto ? null : aluno)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-200 truncate">{aluno}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">
                      {lista.length} ocorrência{lista.length > 1 ? 's' : ''}
                      {graves > 0 && <span className="text-red-400"> · {graves} grave{graves > 1 ? 's' : ''}</span>}
                    </p>
                  </div>
                  <ChevronDown size={14}
                    className={`shrink-0 text-gray-500 transition-transform ${estaAberto ? 'rotate-180' : ''}`} />
                </button>

                {estaAberto && (
                  <div className="px-4 pb-3 flex flex-col gap-2">
                    {lista
                      .slice()
                      .sort((a, b) => (ORDEM_GRAVIDADE[a.gravidade] ?? 3) - (ORDEM_GRAVIDADE[b.gravidade] ?? 3))
                      .map((a, i) => (
                        <div key={`${a.documento_id}-${a.problema}-${i}`}
                          className={`rounded-xl p-3 border flex flex-col gap-1 ${COR_GRAVIDADE[a.gravidade] ?? ''}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              {a.etapa} · {a.documento}
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">
                              {formatDataHoraBR(a.ocorrido_em)}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-gray-100">{a.problema}</p>
                          <p className="text-[11px] text-gray-400 leading-relaxed">{a.detalhe}</p>
                          {a.filial && (
                            <p className="text-[10px] text-gray-600 uppercase tracking-widest">{a.filial}</p>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-gray-500 leading-relaxed shrink-0">
        A lista aponta o que a regra encontrou — não julga intenção. "Cadastrado fora do
        fluxo", por exemplo, é o esperado quando a atividade da aula era montar catálogo.
      </p>
    </div>
  );
};
