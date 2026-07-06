import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { FilialOp } from '../components/FilialSelector';

// Estados possíveis da sessão de filial:
//  - filialAtiva=null,  escolheu=false → não escolheu ainda; App mostra o seletor.
//  - filialAtiva=X,     escolheu=true  → operando dentro de uma unidade específica.
//  - filialAtiva=null,  escolheu=true  → modo Matriz (consolidado das 3 unidades).
// Persistimos no sessionStorage com sentinel 'MATRIZ' pra distinguir Matriz
// (escolha explícita pelo consolidado) de "ainda não escolhi".
const STORAGE_KEY = 'logmax:filialAtiva';
const MATRIZ_SENTINEL = 'MATRIZ';

interface FilialContextValue {
  filialAtiva: FilialOp | null;
  escolheu: boolean;
  setFilialAtiva: (f: FilialOp) => void;
  escolherMatriz: () => void;
  clearFilial: () => void;
}

const FilialContext = createContext<FilialContextValue>({
  filialAtiva: null,
  escolheu: false,
  setFilialAtiva: () => {},
  escolherMatriz: () => {},
  clearFilial: () => {},
});

export function FilialProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ filialAtiva: FilialOp | null; escolheu: boolean }>(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY);
      if (v === 'SuperMax' || v === 'MaxLook' || v === 'TechMax') {
        return { filialAtiva: v, escolheu: true };
      }
      if (v === MATRIZ_SENTINEL) {
        return { filialAtiva: null, escolheu: true };
      }
      return { filialAtiva: null, escolheu: false };
    } catch { return { filialAtiva: null, escolheu: false }; }
  });

  const setFilialAtiva = (f: FilialOp) => {
    setState({ filialAtiva: f, escolheu: true });
    try { sessionStorage.setItem(STORAGE_KEY, f); } catch {}
  };

  const escolherMatriz = () => {
    setState({ filialAtiva: null, escolheu: true });
    try { sessionStorage.setItem(STORAGE_KEY, MATRIZ_SENTINEL); } catch {}
  };

  const clearFilial = () => {
    setState({ filialAtiva: null, escolheu: false });
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return (
    <FilialContext.Provider value={{
      filialAtiva: state.filialAtiva,
      escolheu: state.escolheu,
      setFilialAtiva,
      escolherMatriz,
      clearFilial,
    }}>
      {children}
    </FilialContext.Provider>
  );
}

export function useFilial() {
  return useContext(FilialContext);
}
