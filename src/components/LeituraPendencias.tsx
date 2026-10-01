import { Sparkles, Users, X } from 'lucide-react';
import type { PendenciaLeitura } from '../lib/pendenciasPdf';

// Leitura do MaxAI sobre as pendências (`/api/ai-aula-atividade`, modo
// `pendencias`, migr. 477). Bloco separado, cor separada e rótulo explícito:
// é opinião da IA, e os números da tela são do sistema, não dela.
//
// Usado pela tela Pendências (gerente e Modo Aula) e pela Mesa do Gestor.

export function LeituraPendencias({ leitura, modeloIA, lidasIA, total, onFechar }: {
  leitura: NonNullable<PendenciaLeitura>;
  modeloIA?: string;
  /** Quantas pendências a IA de fato leu (o prompt tem teto). */
  lidasIA?: number | null;
  /** Quantas pendências existem no recorte. */
  total?: number;
  onFechar?: () => void;
}) {
  return (
    <div className="neu-flat rounded-2xl p-4 border border-purple-500/30 border-dashed flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="text-purple-300" />
        <h4 className="text-[11px] font-black uppercase tracking-widest text-purple-300 flex-1">
          Por onde começar — leitura do MaxAI
        </h4>
        {onFechar && (
          <button type="button" onClick={onFechar} title="Fechar a leitura" aria-label="Fechar a leitura" className="modal-close-btn">
            <X size={14} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500 -mt-2">
        Opinião de {modeloIA || 'MaxAI'}
        {lidasIA != null && total != null && lidasIA < total && ` sobre ${lidasIA} das ${total} pendências`}
        . Os números da tela são do sistema, não dela.
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
  );
}
