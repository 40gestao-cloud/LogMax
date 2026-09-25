import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

// Ações raras da linha (reabrir, excluir) atrás de um "⋯", para não disputarem
// espaço com o status. Posição fixa: a tabela rola na horizontal e cortaria um
// menu absoluto nas últimas linhas.
export const MenuMais = ({ children }: { children: (fechar: () => void) => React.ReactNode }) => {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const fora = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null);
    };
    const fechar = () => setPos(null);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('keydown', esc);
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [pos]);
  return (
    <>
      <button ref={btn} title="Mais ações" aria-haspopup="menu" aria-expanded={!!pos}
        onClick={() => {
          if (pos) return setPos(null);
          const r = btn.current!.getBoundingClientRect();
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
        className="action-btn-mais">
        <MoreHorizontal size={15} strokeWidth={2.5} />
      </button>
      {/* Montado mesmo fechado (só escondido): um item pode ser dono de um
          modal — o Histórico é — e desmontar o menu ao fechar levaria o modal
          junto no mesmo clique que o abriu. */}
      <div ref={menu} style={pos ? { top: pos.top, right: pos.right } : undefined}
        className={`fixed z-50 min-w-[13rem] neu-flat rounded-xl border border-white/10 p-1.5 flex-col gap-0.5 shadow-xl ${pos ? 'flex' : 'hidden'}`}>
        {children(() => setPos(null))}
      </div>
    </>
  );
};

// Item de menu com rótulo — o mesmo formato do "Excluir (admin)".
export const ItemMenu = ({ onClick, disabled, cor, icon: Icon, children }: {
  onClick: () => void; disabled?: boolean; cor: string; icon: any; children: React.ReactNode;
}) => (
  <button onClick={onClick} disabled={disabled}
    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-50 ${cor}`}>
    <Icon size={13} /> {children}
  </button>
);

// Cabeçalho de tabela em faixa própria: fundo dourado leve, cantos
// arredondados e um traço entre as colunas. Vai no <tr> do <thead>.
export const CABECALHO_TABELA =
  '[&>th]:bg-accent/[0.08] text-[10px] text-accent/80 uppercase tracking-widest whitespace-nowrap ' +
  '[&>th]:py-3 [&>th]:px-3 [&>th]:font-bold [&>th+th]:border-l [&>th+th]:border-accent/15 ' +
  '[&>th:first-child]:rounded-l-xl [&>th:last-child]:rounded-r-xl';
