// "Onde eu estou nesta cadeia, e qual é o próximo passo?"
//
// O problema, dito pelo professor em 2026-09-15: a turma não segura a ordem
// Requisição → Cotação → Cadastro do produto → Pedido → Recebimento. Cada tela
// faz bem a sua parte e nenhuma diz de onde o documento veio nem para onde vai,
// então o aluno abre Recebimentos, não vê nada, e conclui que o sistema está
// quebrado — quando falta alguém marcar o pedido "em entrega".
//
// A cadeia já estava escrita em `src/lib/aulaFluxos.ts`: é de lá que sai o
// diagrama que o professor projeta e o preset do Modo Aula. Esta faixa lê a
// MESMA lista — se fosse uma segunda cópia, as duas divergiriam na primeira
// mudança e a tela passaria a ensinar o que a projeção desmente.
//
// ── Três estados, e por quê ────────────────────────────────────────────────
//
// Medido no dev com a janela em 1280x800, que é o tamanho das máquinas da
// turma:
//   fechada   34px  (4% da tela)  — só a linha: etapa, quem faz, próxima
//   resumo   ~130px (16%)         — anterior · atual · próxima + pré-requisitos
//   completa  404px (51%)         — a cadeia inteira e a nota de apoio
//
// A versão completa como padrão empurrava o título da tela para 565px: meio
// ecrã de moldura permanente, que é exatamente a mobília que ninguém lê.
//
// O padrão é FECHADA, decidido com esses números na mão: em 34px a linha única
// já responde "em que etapa estou, quem faz, qual é a próxima" — que é o que
// trava a turma — sem comer a tela de trabalho o dia inteiro. Quem quiser mais
// abre, e a escolha fica gravada naquela máquina.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowLeft, ArrowRight, Info } from 'lucide-react';
import { AULA_FLUXOS, type AulaEtapa, type AulaFluxo } from '../lib/aulaFluxos';

type Estado = 'fechada' | 'resumo' | 'completa';

const CHAVE_ESTADO = 'logmax:faixa-fluxo';

type Posicao = {
  fluxo: AulaFluxo;
  etapa: AulaEtapa;
  /** 1-based, contando só as etapas numeradas (opcionais entram na conta). */
  indice: number;
  total: number;
  anterior: AulaEtapa | null;
  proxima: AulaEtapa | null;
};

/**
 * Onde esta tela está nas cadeias. Uma tela pode estar em mais de uma —
 * `requisicoes-dosetor` abre tanto a compra quanto o material do almoxarifado,
 * e é justamente o contraste entre as duas que a aula quer mostrar.
 */
export function posicoesDaView(view: string): Posicao[] {
  const achadas: Posicao[] = [];
  for (const fluxo of AULA_FLUXOS) {
    const i = fluxo.etapas.findIndex(e => e.view === view);
    if (i < 0) continue;
    achadas.push({
      fluxo,
      etapa: fluxo.etapas[i],
      indice: i + 1,
      total: fluxo.etapas.length,
      anterior: i > 0 ? fluxo.etapas[i - 1] : null,
      proxima: i < fluxo.etapas.length - 1 ? fluxo.etapas[i + 1] : null,
    });
  }
  return achadas;
}

/** Cadeias que se apoiam nesta tela sem numerá-la (Cadastros, por exemplo). */
export function fluxosQueSeApoiamEm(view: string): AulaFluxo[] {
  return AULA_FLUXOS.filter(f => (f.viewsApoio ?? []).includes(view)
    || f.prerequisitos.some(p => p.view === view));
}

/**
 * Nomes de cadeia numa frase que se lê. Cadastros é apoio de CINCO fluxos, e
 * juntá-los com "e" produzia "Compra e Material do almoxarifado e Venda no PDV
 * e Orçamento vira pedido e sai da loja e Promoção aprovada chega ao PDV" —
 * uma linha que ninguém termina de ler.
 */
function resumirNomes(fluxos: AulaFluxo[]): string {
  const nomes = fluxos.map(f => f.nome.split('—')[0].trim());
  if (nomes.length <= 3) return nomes.join(', ');
  return `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}`;
}

/**
 * Uma etapa na lista: número, título, quem executa — e leva até ela.
 *
 * A primeira versão era um `button` com cara de texto corrido. O professor viu
 * na aula o que isso produz: "o aluno nem sabe que pode clicar ali". Botão que
 * não se anuncia é botão que não existe — e aqui ele é a resposta ao "e
 * agora?", justamente o que a faixa veio resolver.
 *
 * Então a linha clicável usa o mesmo `neu-button` do resto do chrome, ganha
 * seta de direção (para trás em Antes, para frente em Depois) e um "abrir" à
 * direita. A etapa ATUAL fica com `neu-pressed` e cursor normal: ela não é
 * destino, é onde a pessoa está — e fingir que é clicável ensinaria errado.
 */
function LinhaEtapa({ etapa, numero, atual, rotulo, activeView, onNavigate }: {
  etapa: AulaEtapa;
  numero: number;
  atual?: boolean;
  rotulo?: string;
  activeView: string;
  onNavigate: (view: string) => void;
}) {
  const podeIr = !!etapa.view && etapa.view !== activeView;
  const Seta = rotulo === 'Antes' ? ArrowLeft : ArrowRight;

  return (
    <button type="button"
      onClick={() => { if (podeIr) onNavigate(etapa.view); }}
      disabled={!podeIr}
      title={podeIr ? `Ir para ${etapa.titulo}` : undefined}
      className={`w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 text-[11px] leading-snug transition-colors
        ${atual
          ? 'neu-pressed text-accent cursor-default'
          : podeIr
            ? 'neu-button text-gray-300 hover:text-accent cursor-pointer'
            : 'text-gray-500 cursor-default'}`}>
      <span className={`shrink-0 flex items-center gap-1 font-bold ${atual ? 'text-accent' : 'text-gray-500'}`}>
        {rotulo && !atual && <Seta size={11} />}
        <span className="tabular-nums">{rotulo ? `${rotulo}:` : `${numero}.`}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={atual ? 'font-bold' : 'font-semibold'}>{etapa.titulo}</span>
        {etapa.opcional && <span className="text-gray-600"> (opcional)</span>}
        <span className="text-gray-600"> — {etapa.quem}</span>
        {atual && <span className="block text-gray-400 mt-0.5 font-normal">{etapa.detalhe}</span>}
      </span>
      {/* O convite dito com todas as letras. Sem ele, a seta sozinha ainda se
          lê como enfeite de lista. */}
      {podeIr && (
        <span className="shrink-0 self-center text-[10px] text-accent font-bold hidden sm:inline">
          abrir ›
        </span>
      )}
      {atual && (
        <span className="shrink-0 self-center text-[10px] text-gray-600 hidden sm:inline">
          você está aqui
        </span>
      )}
    </button>
  );
}

export function FaixaEtapaFluxo({ activeView, onNavigate }: {
  activeView: string;
  onNavigate: (view: string) => void;
}) {
  const [estado, setEstado] = useState<Estado>(() => {
    // Ausência = primeira visita: começa FECHADA (decisão do professor depois
    // de ver a medição). Fechada a faixa não é muda — a linha única já diz a
    // etapa, quem executa e qual é a próxima, que são as perguntas que travam
    // a turma; o resumo e a cadeia inteira ficam a um e a dois cliques.
    try {
      const v = localStorage.getItem(CHAVE_ESTADO);
      return v === 'resumo' || v === 'completa' ? v : 'fechada';
    } catch { return 'fechada'; }
  });
  const aberta = estado !== 'fechada';

  const gravar = (novo: Estado) => {
    setEstado(novo);
    try { localStorage.setItem(CHAVE_ESTADO, novo); } catch { /* modo privado */ }
  };

  const posicoes = useMemo(() => posicoesDaView(activeView), [activeView]);
  const apoios   = useMemo(() => fluxosQueSeApoiamEm(activeView), [activeView]);

  // Tela fora de qualquer cadeia não ganha faixa: a maior parte do ERP não é
  // fluxo, e uma faixa que aparece em tudo deixa de significar alguma coisa.
  if (posicoes.length === 0 && apoios.length === 0) return null;

  const principal = posicoes[0] ?? null;

  return (
    <div className="px-3 sm:px-4 pt-3">
      <div className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
        <button type="button" onClick={() => gravar(aberta ? 'fechada' : 'resumo')}
          className="w-full flex items-center gap-2 px-3 py-2 text-left">
          {aberta ? <ChevronDown size={14} className="text-accent shrink-0" />
                  : <ChevronRight size={14} className="text-accent shrink-0" />}

          {principal ? (
            <span className="flex-1 min-w-0 text-[11px] sm:text-xs text-gray-300 truncate">
              <span className="text-accent font-bold">
                {principal.fluxo.nome.split('—')[0].trim()} · etapa {principal.indice} de {principal.total}
              </span>
              {' — '}{principal.etapa.titulo}
              <span className="text-gray-500"> · quem faz: {principal.etapa.quem}</span>
            </span>
          ) : (
            <span className="flex-1 min-w-0 text-[11px] sm:text-xs text-gray-300 truncate">
              <span className="text-accent font-bold">Apoio das cadeias</span>
              {' — '}o que se cadastra aqui é o que {resumirNomes(apoios)} consomem.
            </span>
          )}

          {principal?.proxima && (
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-gray-500 shrink-0">
              depois <ArrowRight size={11} /> {principal.proxima.titulo}
            </span>
          )}
        </button>

        {aberta && (
          <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-3">
            {posicoes.map(pos => (
              <div key={pos.fluxo.id} className="space-y-2">
                {/* No resumo o nome da cadeia já está na linha de cima, a um
                    palmo daqui — repetido, só ocupava altura. Volta no nível
                    completo, onde separa uma cadeia da outra. */}
                {(estado === 'completa' || posicoes.length > 1) && (
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-600">
                    {pos.fluxo.nome}
                  </p>
                )}

                {estado === 'resumo' ? (
                  <div className="space-y-1">
                    {pos.anterior && (
                      <LinhaEtapa etapa={pos.anterior} numero={pos.indice - 1} rotulo="Antes"
                        activeView={activeView} onNavigate={onNavigate} />
                    )}
                    <LinhaEtapa etapa={pos.etapa} numero={pos.indice} rotulo="Agora" atual
                      activeView={activeView} onNavigate={onNavigate} />
                    {pos.proxima && (
                      <LinhaEtapa etapa={pos.proxima} numero={pos.indice + 1} rotulo="Depois"
                        activeView={activeView} onNavigate={onNavigate} />
                    )}
                  </div>
                ) : (
                  <ol className="space-y-1">
                    {pos.fluxo.etapas.map((e, i) => (
                      <li key={`${pos.fluxo.id}-${e.view}-${i}`}>
                        <LinhaEtapa etapa={e} numero={i + 1} atual={e.view === activeView}
                          activeView={activeView} onNavigate={onNavigate} />
                      </li>
                    ))}
                  </ol>
                )}

                {/* O que a cadeia exige de cadastro. É aqui que mora a dúvida
                    que mais trava a turma: cotação sem fornecedor cadastrado e
                    pedido sem produto no catálogo (migr. 480). Fica nos dois
                    níveis — é o que destrava quem está parado agora. */}
                {pos.fluxo.prerequisitos.some(p => p.view) && (
                  <div className="text-[10px] text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="flex items-center gap-1">
                      <Info size={11} className="text-gray-600" /> Antes de começar, precisa existir:
                    </span>
                    {/* Chip, não texto colorido: estes levam para a tela que
                        destrava quem está parado, e precisam parecer botão. */}
                    {pos.fluxo.prerequisitos.filter(p => p.view).map(p => (
                      <button key={p.id} type="button" onClick={() => onNavigate(p.view!)}
                        title={`Ir para ${p.onde}`}
                        className="neu-button rounded-lg px-2 py-0.5 text-accent hover:text-accent font-bold">
                        {p.label} ›
                      </button>
                    ))}
                  </div>
                )}

                {/* Prosa longa só no nível completo: é ela que fazia a faixa
                    ocupar meia tela. */}
                {estado === 'completa' && pos.fluxo.notaApoio && (
                  <p className="text-[10px] text-gray-500 leading-snug">{pos.fluxo.notaApoio}</p>
                )}
              </div>
            ))}

            {/* Tela de apoio (Cadastros). No resumo é uma linha por cadeia com
                o ponto de partida — a prosa de cinco fluxos levava a faixa a
                470px aqui, mais alta que na própria cadeia. */}
            {posicoes.length === 0 && (
              <div className="space-y-1">
                {apoios.map(f => (
                  <div key={f.id}>
                    {f.etapas[0]?.view ? (
                      <button type="button" onClick={() => onNavigate(f.etapas[0].view)}
                        title={`Ir para ${f.etapas[0].titulo}`}
                        className="neu-button w-full text-left flex items-center gap-2 text-[11px] text-gray-300 hover:text-accent rounded-lg px-2 py-1.5 transition-colors">
                        <ArrowRight size={11} className="shrink-0 text-gray-500" />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{f.nome.split('—')[0].trim()}</span>
                          <span className="text-gray-600"> — começa em: {f.etapas[0].titulo}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-accent font-bold hidden sm:inline">abrir ›</span>
                      </button>
                    ) : (
                      <p className="text-[11px] text-gray-500 px-2 py-1">{f.nome}</p>
                    )}
                    {estado === 'completa' && f.notaApoio && (
                      <p className="text-[10px] text-gray-500 leading-snug px-2">{f.notaApoio}</p>
                    )}
                  </div>
                ))}
                <button type="button"
                  onClick={() => gravar(estado === 'completa' ? 'resumo' : 'completa')}
                  className="text-[10px] text-accent hover:underline px-2">
                  {estado === 'completa' ? 'mostrar só o essencial' : 'por que esta tela importa para cada cadeia'}
                </button>
              </div>
            )}

            {posicoes.length > 0 && (
              <button type="button"
                onClick={() => gravar(estado === 'completa' ? 'resumo' : 'completa')}
                className="text-[10px] text-accent hover:underline">
                {estado === 'completa'
                  ? 'mostrar só o essencial'
                  : `ver a cadeia inteira (${principal?.total} etapas)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
