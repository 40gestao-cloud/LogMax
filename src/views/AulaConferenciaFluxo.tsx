// Conferência do fluxo — o que saiu torto na aula, por aluno.
//
// O «Painel de controle» ao lado conta quem FEZ cada tarefa. Esta aba conta
// COMO foi feito: campo em branco, etapa pulada, valor que não bate com a
// cotação, produto cadastrado sem nunca ter sido recebido.
//
// O relatório tem DUAS camadas, e elas nunca se misturam na tela:
//
//   1. «O que está errado» — RPC `auditar_fluxo_compras` (migr. 471). Regra
//      fixa, com número do documento. Verificável: se disser que o valor do
//      pedido não bate com o da cotação, o professor abre os dois e confere.
//   2. «O que parece descuidado» — RPC `coletar_textos_fluxo` (migr. 472) +
//      MaxAI (`/api/ai-aula-atividade`, modo conferencia). Ortografia,
//      justificativa que não justifica, categoria incoerente. É OPINIÃO, e
//      aparece rotulada como opinião, em bloco separado, com outra cor.
//
// A separação é a coisa mais importante desta tela. Misturar "o valor não bate"
// com "achei o nome estranho" faz o professor duvidar das duas — inclusive da
// que não erra. Por isso a camada 2 tem botão próprio: quem pede a opinião sabe
// que pediu uma opinião.
//
// Recorte por SESSÃO de aula, não por data solta: a pergunta que o professor
// tem é "e a aula de hoje?", e a sessão já sabe quando começou e terminou.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, FileWarning, CheckCircle2, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { authFetch } from '../lib/authFetch';
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

// Camada 2. Nunca tem `gravidade` — de propósito: opinião não se classifica em
// grave/leve, senão passa a parecer a mesma coisa que a regra fixa.
type AchadoIA = {
  etapa: string;
  documento: string;
  documento_id: string;
  filial: string | null;
  responsavel: string;
  campo: string;
  texto: string;
  tipo: 'ortografia' | 'vago' | 'incoerente' | 'duplicado' | 'outro';
  observacao: string;
  sugestao: string;
  confianca: 'alta' | 'media';
};

type Sessao = { id: string; iniciada_em: string; encerrada_em: string | null; titulo: string | null };

const ROTULO_TIPO: Record<string, string> = {
  ortografia: 'Escrita',
  vago: 'Vago',
  incoerente: 'Incoerente',
  duplicado: 'Repetido',
  outro: 'Leitura',
};

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
  const [leitura, setLeitura] = useState<AchadoIA[] | null>(null);
  const [loadingIA, setLoadingIA] = useState(false);
  const [modeloIA, setModeloIA] = useState<string>('');
  // Quantos textos a IA leu de quantos existiam. Vira aviso quando não deu para
  // ler tudo — sem isso o professor lê o silêncio como "está tudo certo".
  const [lidosIA, setLidosIA] = useState<{ analisados: number; coletados: number } | null>(null);
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

  // Camada 2 — separada de propósito, e num botão próprio. Custa quota de IA,
  // demora alguns segundos e devolve opinião: não pode sair junto com a
  // conferência objetiva como se fosse a mesma resposta.
  const pedirLeitura = useCallback(async () => {
    if (!sessaoId) return;
    setLoadingIA(true);
    try {
      const resp = await authFetch('/api/ai-aula-atividade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: 'conferencia', sessao_id: sessaoId }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        showToast(json?.error || 'A IA não conseguiu ler os textos da aula.', 'error');
        return;
      }
      const lista = (json.achados ?? []) as AchadoIA[];
      setLeitura(lista);
      setModeloIA(String(json.modelo_ia ?? ''));
      setLidosIA({
        analisados: Number(json.itens_analisados ?? 0),
        coletados: Number(json.itens_coletados ?? json.itens_analisados ?? 0),
      });
      if (json.itens_analisados === 0) {
        showToast('Nenhum texto escrito nesta aula para a IA ler.', 'info');
      } else if (lista.length === 0) {
        showToast(`A IA leu ${json.itens_analisados} textos e não achou nada a apontar.`, 'success');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao falar com a IA.', 'error');
    } finally {
      setLoadingIA(false);
    }
  }, [sessaoId, showToast]);

  // As duas camadas se encontram AQUI, e só aqui: no agrupamento por aluno.
  // Cada uma continua na sua lista dentro do grupo — o professor lê "o que
  // está errado" e "o que parece descuidado" um embaixo do outro, sabendo qual
  // é qual.
  const porAluno = useMemo(() => {
    const mapa = new Map<string, { regra: Achado[]; ia: AchadoIA[] }>();
    const grupo = (nome: string) => {
      const g = mapa.get(nome) ?? { regra: [], ia: [] };
      mapa.set(nome, g);
      return g;
    };
    for (const a of achados ?? []) grupo(a.responsavel).regra.push(a);
    for (const a of leitura ?? []) grupo(a.responsavel).ia.push(a);

    // Quem tem problema grave primeiro; depois quem tem mais. A leitura da IA
    // não promove ninguém no topo da lista: opinião não define urgência.
    return [...mapa.entries()].sort((x, y) => {
      const gx = Math.min(...x[1].regra.map(a => ORDEM_GRAVIDADE[a.gravidade] ?? 3), 3);
      const gy = Math.min(...y[1].regra.map(a => ORDEM_GRAVIDADE[a.gravidade] ?? 3), 3);
      if (gx !== gy) return gx - gy;
      return (y[1].regra.length + y[1].ia.length) - (x[1].regra.length + x[1].ia.length);
    });
  }, [achados, leitura]);

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
            Cadastro de Produto. <span className="text-gray-300 font-bold">Conferir</span> aplica
            regras fixas — campo em branco, etapa pulada, valor que não bate.{' '}
            <span className="text-gray-300 font-bold">Leitura da IA</span> é opinião sobre o que
            a turma escreveu. Serve para conversar com a turma, não para dar nota.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button type="button" onClick={conferir} disabled={loading || !sessaoId}
            className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Conferir
          </button>
          <button type="button" onClick={pedirLeitura} disabled={loadingIA || !sessaoId}
            className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-purple-300 transition-colors border border-purple-500/20 flex items-center gap-1.5 disabled:opacity-50">
            <Sparkles size={11} className={loadingIA ? 'animate-pulse' : ''} /> Leitura da IA
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sessaoId}
          onChange={e => {
            setSessaoId(e.target.value);
            setAchados(null); setLeitura(null); setLidosIA(null);
          }}
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

        {/* Contagem da IA fica NA MESMA linha mas em outra cor e com outro
            verbo: "observações", não "graves". Não soma com as de cima. */}
        {leitura && leitura.length > 0 && (
          <span className="px-2 py-1 rounded-full border text-purple-300 border-purple-500/30 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
            <Sparkles size={10} /> {leitura.length} observaç{leitura.length > 1 ? 'ões' : 'ão'} da IA
          </span>
        )}
      </div>

      {erro && (
        <p className="text-[11px] text-red-400 leading-relaxed flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          {erro}
        </p>
      )}

      {lidosIA && lidosIA.coletados > lidosIA.analisados && (
        <p className="text-[11px] text-purple-300/80 leading-relaxed flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          A aula gerou {lidosIA.coletados} textos e a IA leu {lidosIA.analisados}, repartidos
          entre todos os alunos — ninguém ficou de fora, mas quem escreveu mais teve parte do
          texto não lida. A conferência por regra, ao lado, leu tudo.
        </p>
      )}

      {loading ? <LoadingSpinner /> : achados === null && leitura === null ? (
        <p className="text-xs text-gray-500 py-8 text-center leading-relaxed">
          Escolha a aula e clique em <span className="text-gray-300 font-bold">Conferir</span>.<br />
          <span className="text-[11px] text-gray-600">
            A conferência lê os documentos criados dentro da sessão escolhida.
          </span>
        </p>
      ) : porAluno.length === 0 ? (
        <p className="text-xs text-emerald-400 py-8 text-center leading-relaxed flex flex-col items-center gap-2">
          <CheckCircle2 size={20} />
          Nenhuma inconsistência nesta aula.
          <span className="text-[11px] text-gray-500">
            {sessaoAtual && !sessaoAtual.encerrada_em
              ? 'A aula está em curso — vale conferir de novo mais para o fim.'
              : achados !== null && leitura !== null
                ? 'Nem as regras nem a leitura da IA encontraram o que apontar.'
                : 'As regras não encontraram campo em branco nem etapa pulada.'}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {porAluno.map(([aluno, grupo]) => {
            const { regra, ia } = grupo;
            const graves = regra.filter(a => a.gravidade === 'alta').length;
            const estaAberto = aberto === aluno;
            return (
              <div key={aluno} className="neu-pressed rounded-2xl border border-white/5 overflow-hidden">
                <button
                  onClick={() => setAberto(estaAberto ? null : aluno)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-200 truncate">{aluno}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">
                      {regra.length} ocorrência{regra.length === 1 ? '' : 's'}
                      {graves > 0 && <span className="text-red-400"> · {graves} grave{graves > 1 ? 's' : ''}</span>}
                      {ia.length > 0 && (
                        <span className="text-purple-300"> · {ia.length} da IA</span>
                      )}
                    </p>
                  </div>
                  <ChevronDown size={14}
                    className={`shrink-0 text-gray-500 transition-transform ${estaAberto ? 'rotate-180' : ''}`} />
                </button>

                {estaAberto && (
                  <div className="px-4 pb-3 flex flex-col gap-3">
                    {/* ── Camada 1: o que ESTÁ errado ───────────────────── */}
                    {regra.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                          O que está errado
                        </p>
                        {regra
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

                    {/* ── Camada 2: o que PARECE descuidado ──────────────
                        Borda tracejada e roxo em tudo. O professor precisa
                        conseguir dizer, de relance e a três metros do
                        projetor, que este bloco é opinião. */}
                    {ia.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-purple-300 flex items-center gap-1.5">
                          <Sparkles size={10} /> O que parece descuidado — leitura da IA
                        </p>
                        {ia.map((a, i) => (
                          <div key={`ia-${a.documento_id}-${a.campo}-${i}`}
                            className="rounded-xl p-3 border border-dashed border-purple-500/30 bg-purple-500/5 flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[10px] font-black uppercase tracking-widest text-purple-300">
                                {a.etapa} · {a.documento} · {a.campo}
                              </span>
                              <span className="text-[10px] uppercase tracking-widest text-purple-400/70">
                                {ROTULO_TIPO[a.tipo] ?? 'Leitura'}
                                {a.confianca === 'media' && ' · em dúvida'}
                              </span>
                            </div>
                            {/* O texto do aluno, literal. Sem ele o professor
                                não tem como discordar da IA. */}
                            <p className="text-xs text-gray-300 font-mono break-words">“{a.texto}”</p>
                            <p className="text-[11px] text-gray-300 leading-relaxed">{a.observacao}</p>
                            {a.sugestao && (
                              <p className="text-[11px] text-purple-200/80 leading-relaxed">
                                Sugestão: {a.sugestao}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-gray-500 leading-relaxed shrink-0">
        <span className="text-gray-400 font-bold">O que está errado</span> é regra fixa e não
        julga intenção: "Cadastrado fora do fluxo", por exemplo, é o esperado quando a
        atividade da aula era montar catálogo.{' '}
        <span className="text-purple-300 font-bold">O que parece descuidado</span> é leitura de
        IA sobre o texto que o aluno escreveu — pode errar, e o texto original vem junto
        justamente para você discordar dela.
        {modeloIA && <span className="text-gray-600"> Modelo: {modeloIA}.</span>}
      </p>
    </div>
  );
};
