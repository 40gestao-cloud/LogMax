import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { FilialOp } from '../components/FilialSelector';

interface FilialContextValue {
  filialAtiva: FilialOp | null;
  setFilialAtiva: (f: FilialOp) => void;
  clearFilial: () => void;
}

const FilialContext = createContext<FilialContextValue>({
  filialAtiva: null,
  setFilialAtiva: () => {},
  clearFilial: () => {},
});

export function FilialProvider({ children }: { children: ReactNode }) {
  const [filialAtiva, setFilialAtivaState] = useState<FilialOp | null>(() => {
    try {
      const v = sessionStorage.getItem('logmax:filialAtiva');
      return (v === 'SuperMax' || v === 'MaxLook' || v === 'TechMax') ? v : null;
    } catch { return null; }
  });

  const setFilialAtiva = (f: FilialOp) => {
    setFilialAtivaState(f);
    try { sessionStorage.setItem('logmax:filialAtiva', f); } catch {}
  };

  const clearFilial = () => {
    setFilialAtivaState(null);
    try { sessionStorage.removeItem('logmax:filialAtiva'); } catch {}
  };

  return (
    <FilialContext.Provider value={{ filialAtiva, setFilialAtiva, clearFilial }}>
      {children}
    </FilialContext.Provider>
  );
}

export function useFilial() {
  return useContext(FilialContext);
}
