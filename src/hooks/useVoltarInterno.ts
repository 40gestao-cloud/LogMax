import { createContext, useContext, useEffect, useRef } from 'react';

// Passo de volta que pertence à tela aberta, e não à pilha de telas: fechar o
// PDF do Max Show, voltar à lista de propostas, fechar um formulário. O botão
// Voltar do topo e o gesto de voltar do celular consomem primeiro o passo mais
// recente daqui; só com a pilha vazia é que saem da tela.
export type EmpilharVoltar = (passo: () => void) => () => void;

export const VoltarInternoContext = createContext<EmpilharVoltar>(() => () => {});

/** Enquanto `ativo`, o Voltar chama `fechar` em vez de sair da tela. */
export function useVoltarInterno(ativo: boolean, fechar: () => void) {
  const empilhar = useContext(VoltarInternoContext);
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    if (!ativo) return;
    return empilhar(() => fecharRef.current());
  }, [ativo, empilhar]);
}
