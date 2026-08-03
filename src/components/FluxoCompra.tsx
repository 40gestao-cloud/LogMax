// Onde este documento está no caminho, e de quem é a bola agora.
//
// O aluno abre a tela, vê "Aprovado" e não sabe se aquilo significa que a
// compra está feita, se falta alguém agir, ou se é com ele. O status sozinho
// não conta isso — ele nomeia um ponto sem mostrar a linha. Daí a barra.
//
// Não simplifica o fluxo para "ficar mais fácil": as cinco etapas são as que a
// empresa tem, e cada uma diz o setor responsável. O que muda é que elas param
// de ser conhecimento oral do professor.
//
// A etapa vem de `etapaDaRequisicao` (src/lib/fluxoCompra.ts) — deriva do que a
// tela já tem, sem consulta nova.

import { Check } from 'lucide-react';
import { ETAPAS_COMPRA, type EtapaCompra } from '../lib/fluxoCompra';

export const FluxoCompra = ({ etapa, compact }: { etapa: EtapaCompra; compact?: boolean }) => {
  // Negado é fim de linha, não etapa: mostrar a régua com uma bolinha vermelha
  // no meio sugeriria que o documento ainda anda.
  if (etapa === 'negado') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-red-400">
        Negado — o solicitante pode abrir outra requisição
      </span>
    );
  }

  const idx = ETAPAS_COMPRA.findIndex(e => e.id === etapa);

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5" title={ETAPAS_COMPRA[idx]?.ajuda}>
        {ETAPAS_COMPRA.map((e, i) => (
          <span key={e.id}
            className={`w-1.5 h-1.5 rounded-full ${
              i < idx ? 'bg-accent/40' : i === idx ? 'bg-accent' : 'bg-white/10'
            }`}
          />
        ))}
        <span className="text-[10px] text-gray-500 whitespace-nowrap">
          {idx + 1} de {ETAPAS_COMPRA.length}
        </span>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-stretch gap-1">
      {ETAPAS_COMPRA.map((e, i) => {
        const feita  = i < idx;
        const atual  = i === idx;
        return (
          <div key={e.id}
            title={e.ajuda}
            className={`flex-1 min-w-[104px] rounded-xl px-2.5 py-2 border ${
              atual ? 'border-accent/40 bg-accent/10'
                    : feita ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                            : 'border-white/5 bg-white/[0.02]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {feita
                ? <Check size={10} className="text-emerald-400 shrink-0" />
                : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${atual ? 'bg-accent' : 'bg-white/15'}`} />}
              <span className={`text-[10px] font-black uppercase tracking-widest truncate ${
                atual ? 'text-accent' : feita ? 'text-emerald-400/80' : 'text-gray-600'
              }`}>
                {e.label}
              </span>
            </div>
            {/* Quem responde pela etapa é metade da resposta: sem isto o aluno
                sabe onde parou, mas continua sem saber a quem perguntar. */}
            <span className={`block text-[10px] mt-0.5 ${atual ? 'text-gray-300' : 'text-gray-600'}`}>
              {e.quem}
            </span>
          </div>
        );
      })}
    </div>
  );
};
