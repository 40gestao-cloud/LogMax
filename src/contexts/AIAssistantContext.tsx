import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AIContextSnapshot = {
  /** Rótulo curto exibido ao usuário (ex.: "Histórico de Vendas") */
  label: string;
  /** Payload JSON-serializável que o MaxAI usa pra responder. */
  data: unknown;
};

type CtxValue = {
  context: AIContextSnapshot | null;
  setContext: (v: AIContextSnapshot | null) => void;
};

const AIAssistantCtx = createContext<CtxValue>({ context: null, setContext: () => {} });

export const AIAssistantProvider = ({ children }: { children: React.ReactNode }) => {
  const [context, setContext] = useState<AIContextSnapshot | null>(null);
  const value = useMemo(() => ({ context, setContext }), [context]);
  return <AIAssistantCtx.Provider value={value}>{children}</AIAssistantCtx.Provider>;
};

/**
 * Hook para uma view registrar dados de contexto que o MaxAI deve enxergar.
 * O snapshot é registrado enquanto a view está montada e limpo no unmount —
 * navegar pra outra view automaticamente troca o contexto.
 *
 * Uso típico:
 *   const { data: vendas } = useFetchData('/api/vendasview');
 *   useAIContext({ label: 'Vendas Recentes', data: vendas.slice(0, 50) });
 *
 * Dedup: usa JSON.stringify como signature pra não re-registrar a cada
 * render quando o caller passa um literal novo com mesmos dados.
 */
export function useAIContext(snapshot: AIContextSnapshot | null | undefined) {
  const { setContext } = useContext(AIAssistantCtx);
  // Signature estável — útil pra evitar setState em loop quando o caller
  // passa `{...vendas.slice(0,50)}` (nova referência a cada render).
  const sig = useMemo(() => JSON.stringify(snapshot ?? null), [snapshot]);
  useEffect(() => {
    setContext(snapshot ?? null);
    return () => setContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}

/** Lido pelo FAB — não usar em views. */
export function useCurrentAIContext() {
  return useContext(AIAssistantCtx).context;
}
