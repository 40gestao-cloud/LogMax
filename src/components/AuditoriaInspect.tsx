import React, { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { useAuditoriaContext } from '../contexts/AuditoriaContext';
import { formatDataHoraBR } from '../lib/dates';

type Props = {
  criadoPor?: string | null;
  criadoEm?: string | null;
  atualizadoPor?: string | null;
  atualizadoEm?: string | null;
  /** Classe extra para alinhamento dentro da linha/card hospedeiro. */
  className?: string;
};

/**
 * Ícone de inspeção de auditoria. Mostra um popover com:
 *   - Criado por <nome> · <data/hora Acre>
 *   - Última alteração por <nome> · <data/hora Acre> (se diferente)
 *
 * Regras de visibilidade (resolvidas no AuditoriaContext via RPC):
 *   - admin / ceo  : sempre renderiza, com todos os nomes.
 *   - gerente      : renderiza apenas quando AMBOS os autores estão
 *                    no(s) setor(es) do gerente. Caso contrário, retorna
 *                    null pra não vazar informação fora do setor.
 *   - demais roles : não renderiza nunca.
 *
 * Linhas legadas (criado_por IS NULL) não renderizam o ícone — não há
 * autoria a inspecionar.
 */
export const AuditoriaInspect: React.FC<Props> = ({
  criadoPor,
  criadoEm,
  atualizadoPor,
  atualizadoEm,
  className,
}) => {
  const { usuarios, podeVerAuditoria } = useAuditoriaContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!podeVerAuditoria) return null;
  if (!criadoPor) return null; // linha legada — sem autoria a mostrar

  const criador = usuarios.get(criadoPor);
  const editor  = atualizadoPor ? usuarios.get(atualizadoPor) : null;

  // Gerente: regra de RBAC granular. Se algum dos autores está fora do
  // setor dele, o RPC já o omitiu do `usuarios` map. Nesse caso o ícone
  // não renderiza — gerente não tem permissão pra ver essa auditoria.
  // Admin/CEO recebem todos no map, então passa.
  if (!criador) return null;
  if (atualizadoPor && atualizadoPor !== criadoPor && !editor) return null;

  const mesmoAutor = !atualizadoPor || atualizadoPor === criadoPor;

  return (
    <div ref={containerRef} className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="w-8 h-8 rounded-lg neu-button flex items-center justify-center text-gray-400 hover:text-accent transition-colors"
        title="Inspecionar autoria"
        aria-label="Inspecionar autoria"
      >
        <History size={12} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-2 z-40 w-64 neu-flat rounded-xl border border-white/10 p-3 text-xs shadow-xl"
        >
          <p className="text-[9px] uppercase tracking-widest font-bold text-gray-500 mb-2">
            Auditoria
          </p>
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[10px] text-gray-500">Criado por</p>
              <p className="text-gray-200 font-semibold">{criador.nome}</p>
              {criadoEm && (
                <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">{formatDataHoraBR(criadoEm)}</p>
              )}
            </div>
            {!mesmoAutor && editor && (
              <div className="border-t border-white/5 pt-2">
                <p className="text-[10px] text-gray-500">Última alteração por</p>
                <p className="text-gray-200 font-semibold">{editor.nome}</p>
                {atualizadoEm && (
                  <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">{formatDataHoraBR(atualizadoEm)}</p>
                )}
              </div>
            )}
            {mesmoAutor && atualizadoEm && atualizadoEm !== criadoEm && (
              <div className="border-t border-white/5 pt-2">
                <p className="text-[10px] text-gray-500">Última alteração</p>
                <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">{formatDataHoraBR(atualizadoEm)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
