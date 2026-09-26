// Histórico das aulas dadas (migr. 406).
//
// `aula_config` é linha única e é sobrescrita a cada save: a aula de ontem
// deixava de existir no instante em que a de hoje era montada. Este painel lê
// as sessões que a trigger registra — ligar abre, desligar fecha — e responde
// o que o professor pergunta ao preparar a próxima: que cadeia a turma já
// percorreu, quando, e por quanto tempo.
//
// Os FLUXOS não vêm do banco. A sessão guarda os módulos e submenus que
// estavam ligados; o nome da cadeia é derivado aqui, da mesma `AULA_FLUXOS`
// que monta a aula. Gravar o nome no banco congelaria uma lista que muda com
// deploy, e o histórico passaria a citar fluxo que não existe mais.
//
// Atividades publicadas e tarefas marcadas no período também são derivadas:
// as duas tabelas já têm timestamp, e contar por intervalo é mais barato que
// manter um contador que pode divergir do fato.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History, Clock, Workflow, Pencil, Check, X, RefreshCw, ClipboardList, ClipboardCheck, Radio, Link2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { assinarRealtime } from '../lib/realtimeAgrupado';
import { LoadingSpinner, EmptyState } from '../components/ui';
import { AULA_FLUXOS, etapaCoberta, etapasObrigatorias } from '../lib/aulaFluxos';
import { AULA_MODULOS } from '../lib/aulaModulos';

type Sessao = {
  id: string;
  iniciada_em: string;
  encerrada_em: string | null;
  nome_iniciou: string | null;
  nome_encerrou: string | null;
  config_inicial: any;
  config_final: any;
  ajustes: number;
  titulo: string | null;
  observacao: string | null;
  /** Sessão anterior da mesma aula (migr. 408). NULL = a aula começa aqui. */
  continua_de: string | null;
};
type Marco = { quando: string };

interface Props {
  showToast: (msg: string, type?: string) => void;
}

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Rio_Branco',
  });

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco',
  });

/** Duração em linguagem de aula: "1h40", "35 min". */
const duracao = (inicio: string, fim: string | null): string => {
  const ms = (fim ? new Date(fim).getTime() : Date.now()) - new Date(inicio).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`;
};

const listaDe = (cfg: any, campo: string): string[] =>
  Array.isArray(cfg?.[campo]) ? cfg[campo] : [];

/** Fluxos que a whitelist daquela sessão fechava por inteiro. */
const fluxosDa = (cfg: any): string[] => {
  const modulos = listaDe(cfg, 'modulos');
  const submenus = listaDe(cfg, 'submenus');
  return AULA_FLUXOS
    .filter(f => {
      const obrig = etapasObrigatorias(f);
      return obrig.length > 0 && obrig.every(e => etapaCoberta(e, modulos, submenus));
    })
    .map(f => f.nome.split('—')[0].trim());
};

const rotuloModulo = (id: string) => AULA_MODULOS.find(m => m.id === id)?.label ?? id;

export const AulaHistorico: React.FC<Props> = ({ showToast }) => {
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [atividades, setAtividades] = useState<Marco[]>([]);
  const [marcacoes, setMarcacoes] = useState<Marco[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunhoTitulo, setRascunhoTitulo] = useState('');
  const [rascunhoObs, setRascunhoObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async (silencioso = false) => {
    if (!supabase) { setLoading(false); return; }
    if (!silencioso) setLoading(true);

    // 40 sessões cobrem um semestre com folga, e o painel é de consulta —
    // paginar seria complexidade para um problema que não chega nesta escala.
    const { data: ss } = await supabase.from('aula_sessoes')
      .select('id,iniciada_em,encerrada_em,nome_iniciou,nome_encerrou,config_inicial,config_final,ajustes,titulo,observacao,continua_de')
      .order('iniciada_em', { ascending: false })
      .limit(40);

    const lista = (ss ?? []) as Sessao[];
    setSessoes(lista);

    if (lista.length === 0) {
      setAtividades([]); setMarcacoes([]); setLoading(false);
      return;
    }

    // Piso de data antes de contar. Sem ele estas duas consultas traziam a
    // tabela inteira só para somar por intervalo — e `aula_tarefas_realizadas`
    // cresce por aluno × tarefa × atividade, o que numa turma de trinta vira
    // milhares de linhas em poucas semanas. Nada anterior à sessão mais antiga
    // da página pode cair dentro de sessão nenhuma que esta tela desenha.
    const piso = lista[lista.length - 1].iniciada_em;
    const [{ data: ativs }, { data: marks }] = await Promise.all([
      supabase.from('aula_atividades').select('created_at').gte('created_at', piso),
      supabase.from('aula_tarefas_realizadas').select('marcado_em').gte('marcado_em', piso),
    ]);

    setAtividades((ativs ?? []).map((a: any) => ({ quando: a.created_at })));
    setMarcacoes((marks ?? []).map((m: any) => ({ quando: m.marcado_em })));
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // A sessão em curso aparece e some com o interruptor, que é o mesmo gesto
  // que o professor dá na frente da turma.
  useEffect(() => {
    return assinarRealtime({
      nome: 'aula-historico',
      alvos: ['aula_sessoes'],
      aoMudar: () => { carregar(true); },
    });
  }, [carregar]);

  // Quantos marcos caíram dentro de cada sessão. Uma passada por sessão sobre
  // duas listas pequenas — o alternativo seria uma consulta por sessão.
  const contarNoPeriodo = (lista: Marco[], s: Sessao) => {
    const ini = new Date(s.iniciada_em).getTime();
    const fim = s.encerrada_em ? new Date(s.encerrada_em).getTime() : Date.now();
    return lista.reduce((n, m) => {
      const t = new Date(m.quando).getTime();
      return n + (t >= ini && t <= fim ? 1 : 0);
    }, 0);
  };

  const linhas = useMemo(() => sessoes.map(s => {
    // A config final é o retrato mais fiel do que a aula foi: numa aula que
    // começa em Compras e migra para Estoque, o início conta metade.
    const cfg = s.config_final ?? s.config_inicial;
    return {
      s,
      emCurso: !s.encerrada_em,
      fluxos: fluxosDa(cfg),
      modulos: listaDe(cfg, 'modulos'),
      nAtividades: contarNoPeriodo(atividades, s),
      nMarcacoes: contarNoPeriodo(marcacoes, s),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sessoes, atividades, marcacoes]);

  // Correntes: uma aula é a sequência de encontros ligados por `continua_de`.
  // A raiz é quem não continua ninguém; o resto pendura nela em ordem de
  // tempo. Ficam agrupadas para o histórico não mostrar três linhas soltas
  // onde houve uma aula de três dias.
  //
  // `porId` só enxerga as 40 sessões da página: um encontro cuja raiz caiu
  // fora do limite não tem como se agrupar e é desenhado como aula própria.
  // Preferível a esconder o encontro ou a buscar a corrente inteira só para
  // rotular uma linha que o professor já vê como recente.
  const correntes = useMemo(() => {
    const porId = new Map(linhas.map(l => [l.s.id, l]));
    const filhos = new Map<string, string[]>();
    for (const l of linhas) {
      const pai = l.s.continua_de;
      if (pai && porId.has(pai)) filhos.set(pai, [...(filhos.get(pai) ?? []), l.s.id]);
    }

    const raizes = linhas.filter(l => !l.s.continua_de || !porId.has(l.s.continua_de));

    return raizes.map(raiz => {
      const encontros: typeof linhas = [];
      // Descida iterativa com teto: a RPC já impede ciclo, mas a tela não
      // pode depender disso para não travar o navegador.
      let atual: string | undefined = raiz.s.id;
      while (atual && encontros.length < 100) {
        const l = porId.get(atual);
        if (!l) break;
        encontros.push(l);
        atual = (filhos.get(atual) ?? [])[0];
      }
      return {
        raiz,
        encontros,
        // O título mora na raiz — renomear o primeiro encontro renomeia a aula
        // inteira, que é o que se espera de quem digitou o nome uma vez.
        titulo: raiz.s.titulo,
        emCurso: encontros.some(e => e.emCurso),
      };
    // A ordem é a do último encontro: uma aula retomada hoje volta ao topo,
    // em vez de ficar enterrada na data em que começou.
    }).sort((a, b) =>
      new Date(b.encontros[b.encontros.length - 1].s.iniciada_em).getTime() -
      new Date(a.encontros[a.encontros.length - 1].s.iniciada_em).getTime());
  }, [linhas]);

  /** Candidatas a "anterior": qualquer sessão que começou antes e ainda não é continuada. */
  const anterioresPara = (s: Sessao) => {
    const jaContinuadas = new Set(sessoes.map(x => x.continua_de).filter(Boolean) as string[]);
    return sessoes.filter(x =>
      x.id !== s.id &&
      new Date(x.iniciada_em).getTime() < new Date(s.iniciada_em).getTime() &&
      (!jaContinuadas.has(x.id) || x.id === s.continua_de));
  };

  const vincular = async (sessaoId: string, continuaDe: string | null) => {
    if (!supabase) return;
    const { error } = await supabase.rpc('vincular_sessao_aula', {
      p_sessao_id: sessaoId,
      p_continua_de: continuaDe,
    });
    if (error) { showToast(error.message || 'Não foi possível encadear as aulas.', 'error'); return; }
    showToast(continuaDe ? 'Encontro ligado à aula anterior.' : 'Encontro desvinculado.', 'success');
    carregar(true);
  };

  const abrirEdicao = (s: Sessao) => {
    setEditando(s.id);
    setRascunhoTitulo(s.titulo ?? '');
    setRascunhoObs(s.observacao ?? '');
  };

  const salvarNome = async (id: string) => {
    if (!supabase) return;
    setSalvando(true);
    const { error } = await supabase.rpc('nomear_sessao_aula', {
      p_sessao_id: id,
      p_titulo: rascunhoTitulo,
      p_observacao: rascunhoObs,
    });
    setSalvando(false);
    if (error) { showToast(error.message || 'Não foi possível nomear a aula.', 'error'); return; }
    setEditando(null);
    carregar(true);
  };

  return (
    <div className="neu-flat rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <History size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-gray-200">Histórico de aulas</h3>
          </div>
        </div>
        <button type="button" onClick={() => carregar()} disabled={loading}
          className="shrink-0 neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-accent transition-colors border border-white/5 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><LoadingSpinner /></div>
      ) : correntes.length === 0 ? (
        <EmptyState message="Nenhuma aula registrada ainda. A primeira linha nasce quando você ligar o Modo Aula." />
      ) : (
        <div className="flex flex-col gap-4">
          {correntes.map(corrente => (
          <div key={corrente.raiz.s.id} className="flex flex-col gap-2">
            {/* Cabeçalho da aula. Só aparece quando houve mais de um encontro:
                numa aula de um dia só, ele seria uma moldura em volta de nada. */}
            {corrente.encontros.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap px-1">
                <Link2 size={12} className="text-accent shrink-0" />
                <span className="text-xs font-black text-gray-100">
                  {corrente.titulo ?? 'Aula em vários encontros'}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  {corrente.encontros.length} encontros ·{' '}
                  {fmtData(corrente.encontros[0].s.iniciada_em)} a{' '}
                  {fmtData(corrente.encontros[corrente.encontros.length - 1].s.iniciada_em)}
                </span>
              </div>
            )}

          {corrente.encontros.map(({ s, emCurso, fluxos, modulos, nAtividades, nMarcacoes }, idx) => (
            <div key={s.id}
              className={`rounded-2xl border p-4 flex flex-col gap-3 ${
                emCurso ? 'border-accent/40 bg-accent/5' : 'border-white/5'} ${
                corrente.encontros.length > 1 ? 'ml-3 border-l-2 border-l-accent/25' : ''}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {corrente.encontros.length > 1 && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-accent border border-accent/30">
                        Encontro {idx + 1}
                      </span>
                    )}
                    {emCurso ? (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 flex items-center gap-1">
                        <Radio size={9} /> Em curso
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        {fmtData(s.iniciada_em)}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                      <Clock size={10} />
                      {fmtHora(s.iniciada_em)}
                      {s.encerrada_em ? `–${fmtHora(s.encerrada_em)}` : ''}
                      {' · '}{duracao(s.iniciada_em, s.encerrada_em)}
                    </span>
                    {s.ajustes > 0 && (
                      <span title="Quantas vezes a whitelist mudou com a aula no ar"
                        className="text-[9px] font-black uppercase tracking-widest text-gray-600 border border-white/10 rounded-full px-1.5 py-0.5">
                        {s.ajustes} ajuste{s.ajustes === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {/* Numa corrente o nome da aula está no cabeçalho — repeti-lo
                      em cada encontro faria três títulos iguais empilhados. */}
                  {corrente.encontros.length === 1 && (
                    <h4 className="text-sm font-black text-gray-100">
                      {s.titulo ?? (fluxos.length > 0 ? fluxos.join(' + ') : 'Aula sem fluxo completo')}
                    </h4>
                  )}

                  {/* Fluxos e módulos: o fluxo é a leitura de quem prepara a
                      próxima aula, o módulo é o detalhe de quem quer repetir a
                      configuração exata. */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    {fluxos.map(f => (
                      <span key={f} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/25 flex items-center gap-1">
                        <Workflow size={9} /> {f}
                      </span>
                    ))}
                    {modulos.length === 0 ? (
                      <span className="text-[10px] text-gray-600 italic">Nenhum módulo liberado</span>
                    ) : (
                      modulos.map(m => (
                        <span key={m} className="text-[10px] text-gray-500 px-2 py-0.5 rounded-full border border-white/10">
                          {rotuloModulo(m)}
                        </span>
                      ))
                    )}
                  </div>

                  <p className="text-[10px] text-gray-600 mt-1">
                    Ligada por {s.nome_iniciou ?? '—'}
                    {s.encerrada_em && s.nome_encerrou && s.nome_encerrou !== s.nome_iniciou
                      ? `, desligada por ${s.nome_encerrou}` : ''}
                    {' · '}
                    <span className="inline-flex items-center gap-1"><ClipboardList size={9} /> {nAtividades} atividade{nAtividades === 1 ? '' : 's'}</span>
                    {' · '}
                    <span className="inline-flex items-center gap-1"><ClipboardCheck size={9} /> {nMarcacoes} tarefa{nMarcacoes === 1 ? '' : 's'} marcada{nMarcacoes === 1 ? '' : 's'}</span>
                  </p>

                  {s.observacao && editando !== s.id && (
                    <p className="text-[11px] text-gray-400 mt-1 border-l-2 border-white/10 pl-2 leading-relaxed">
                      {s.observacao}
                    </p>
                  )}
                </div>

                {/* Nomear só faz sentido na raiz: o título é da AULA, e o
                    cabeçalho da corrente lê dali. */}
                {editando !== s.id && idx === 0 && (
                  <button type="button" onClick={() => abrirEdicao(s)}
                    title="Nomear esta aula"
                    className="neu-button w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-accent shrink-0">
                    <Pencil size={12} />
                  </button>
                )}
              </div>

              {/* Encadeamento. Fica em toda sessão que tem alguma anterior
                  disponível, porque a decisão ("isto continua a terça") só
                  existe depois do encontro, não antes. */}
              {anterioresPara(s).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap border-t border-white/5 pt-2">
                  <Link2 size={11} className="text-gray-600 shrink-0" />
                  <span className="text-[10px] uppercase tracking-widest font-bold text-gray-600">
                    Continua de
                  </span>
                  <select
                    value={s.continua_de ?? ''}
                    onChange={e => void vincular(s.id, e.target.value || null)}
                    className="neu-input rounded-lg px-2 py-1 text-[11px] max-w-[20rem]"
                  >
                    <option value="">— começa aqui —</option>
                    {anterioresPara(s).map(x => (
                      <option key={x.id} value={x.id}>
                        {fmtData(x.iniciada_em)} · {x.titulo ?? (fluxosDa(x.config_final ?? x.config_inicial).join(' + ') || 'sem fluxo completo')}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* O nome não é pedido ao ligar: no começo da aula ninguém sabe
                  ainda o que ela foi. Depois, olhando a linha, sai sozinho. */}
              {editando === s.id && (
                <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
                  <input
                    type="text"
                    value={rascunhoTitulo}
                    onChange={e => setRascunhoTitulo(e.target.value)}
                    maxLength={120}
                    placeholder="Como chamar esta aula — ex.: Compra completa, turma da tarde"
                    className="neu-input rounded-xl px-3 py-2 text-sm"
                  />
                  <textarea
                    value={rascunhoObs}
                    onChange={e => setRascunhoObs(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="O que funcionou, onde a turma travou (opcional)"
                    className="neu-input rounded-xl px-3 py-2 text-sm resize-y"
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void salvarNome(s.id)} disabled={salvando}
                      className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-accent border border-accent/30 hover:bg-accent/10 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                      <Check size={12} /> {salvando ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button type="button" onClick={() => setEditando(null)}
                      className="neu-button px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 flex items-center gap-1.5">
                      <X size={12} /> Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          </div>
          ))}
        </div>
      )}
    </div>
  );
};
