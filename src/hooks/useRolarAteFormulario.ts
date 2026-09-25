import { useEffect, useRef } from 'react';

// Formulário que abre dentro da página (não em modal) nasce no topo da tela,
// e o clique em "Editar" costuma vir de uma linha lá embaixo: sem isto, o
// aluno clicava e nada parecia acontecer. Rola até o formulário e põe o cursor
// no primeiro campo. `chave` (o id em edição) faz rolar de novo quando se
// clica em editar outra linha com o formulário já aberto.
export function useRolarAteFormulario<T extends HTMLElement = HTMLDivElement>(aberto: boolean, chave?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!aberto) return;
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
        ?.focus({ preventScroll: true });
    });
  }, [aberto, chave]);
  return ref;
}
