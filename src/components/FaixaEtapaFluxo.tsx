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
// Fica fechada numa linha, porque o aluno passa o dia inteiro nestas telas e
// um bloco de texto permanente vira mobília que ninguém lê. Aberta, mostra a
// cadeia inteira numerada, quem executa cada etapa e o que ela exige de
// cadastro — e cada etapa é clicável, que é a resposta prática ao "e agora?".

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight, Info } from 'lucide-react';
import { AULA_FLUXOS, type AulaEtapa, type AulaFluxo } from '../lib/aulaFluxos';

const CHAVE_ABERTA = 'logmax:faixa-fluxo-aberta';

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

export function FaixaEtapaFluxo({ activeView, onNavigate }: {
  activeView: string;
  onNavigate: (view: string) => void;
}) {
  const [aberta, setAberta] = useState<boolean>(() => {
    try { return localStorage.getItem(CHAVE_ABERTA) === '1'; } catch { return false; }
  });

  const posicoes = useMemo(() => posicoesDaView(activeView), [activeView]);
  const apoios   = useMemo(() => fluxosQueSeApoiamEm(activeView), [activeView]);

  // Tela fora de qualquer cadeia não ganha faixa: a maior parte do ERP não é
  // fluxo, e uma faixa que aparece em tudo deixa de significar alguma coisa.
  if (posicoes.length === 0 && apoios.length === 0) return null;

  const alternar = () => {
    setAberta(v => {
      try { localStorage.setItem(CHAVE_ABERTA, v ? '0' : '1'); } catch { /* modo privado */ }
      return !v;
    });
  };

  const principal = posicoes[0] ?? null;

  return (
    <div className="px-3 sm:px-4 pt-3">
      <div className="neu-flat rounded-2xl border border-white/5 overflow-hidden">
        <button type="button" onClick={alternar}
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
              <span className="text-accent font-bold">Apoio da cadeia</span>
              {' — '}esta tela prepara o que {apoios.map(f => f.nome.split('—')[0].trim()).join(' e ')} consome.
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
                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-600">
                  {pos.fluxo.nome}
                </p>

                <ol className="space-y-1">
                  {pos.fluxo.etapas.map((e, i) => {
                    const atual = e.view === activeView;
                    return (
                      <li key={`${pos.fluxo.id}-${e.view}-${i}`}>
                        <button type="button"
                          onClick={() => { if (e.view && !atual) onNavigate(e.view); }}
                          disabled={!e.view || atual}
                          className={`w-full text-left flex items-start gap-2 rounded-lg px-2 py-1 text-[11px] leading-snug
                            ${atual ? 'neu-pressed text-accent' : 'text-gray-400 hover:text-gray-200'}`}>
                          <span className={`shrink-0 tabular-nums font-bold ${atual ? 'text-accent' : 'text-gray-600'}`}>
                            {i + 1}.
                          </span>
                          <span className="min-w-0">
                            <span className={atual ? 'font-bold' : ''}>{e.titulo}</span>
                            {e.opcional && <span className="text-gray-600"> (opcional)</span>}
                            <span className="text-gray-600"> — {e.quem}</span>
                            {atual && (
                              <span className="block text-gray-400 mt-0.5">{e.detalhe}</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>

                {/* O que a cadeia exige de cadastro. É aqui que mora a dúvida
                    que mais trava a turma: cotação sem fornecedor cadastrado e
                    pedido sem produto no catálogo (migr. 480). */}
                {pos.fluxo.prerequisitos.some(p => p.view) && (
                  <p className="text-[10px] text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Info size={11} className="text-gray-600" /> Antes de começar, precisa existir:
                    {pos.fluxo.prerequisitos.filter(p => p.view).map(p => (
                      <button key={p.id} type="button" onClick={() => onNavigate(p.view!)}
                        className="text-accent hover:underline">
                        {p.label} ({p.onde})
                      </button>
                    ))}
                  </p>
                )}

                {pos.fluxo.notaApoio && (
                  <p className="text-[10px] text-gray-500 leading-snug">{pos.fluxo.notaApoio}</p>
                )}
              </div>
            ))}

            {posicoes.length === 0 && apoios.map(f => (
              <div key={f.id} className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-600">{f.nome}</p>
                <p className="text-[11px] text-gray-400 leading-snug">{f.notaApoio ?? f.resumo}</p>
                {/* Etapa pode não ter tela própria (`view` vazio) — aí o texto
                    fica, o botão não: link morto ensina a desconfiar da faixa. */}
                {f.etapas[0]?.view ? (
                  <button type="button" onClick={() => onNavigate(f.etapas[0].view)}
                    className="text-[10px] text-accent hover:underline">
                    Começa em: {f.etapas[0].titulo}
                  </button>
                ) : (
                  <p className="text-[10px] text-gray-500">Começa em: {f.etapas[0]?.titulo}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
