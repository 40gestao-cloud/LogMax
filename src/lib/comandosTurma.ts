// Comando remoto de recarga (migr. 564).
//
// O professor aperta um botão na máquina dele e a turma inteira recarrega. O
// que se faz aqui é mais forte do que o Ctrl+Shift+R do aluno: a tecla ignora o
// cache HTTP daquela aba, mas quem serve arquivo velho nesta casa é o service
// worker da PWA. Então a rotina apaga os caches, desregistra o SW e só depois
// recarrega — na volta, o registro acontece de novo, com a versão nova.

export type ComandoTurma = {
  id: string;
  tipo: 'recarregar';
  motivo: string | null;
  emitido_por_nome: string | null;
  created_at: string;
};

/**
 * Comando mais velho que isto é história, não ordem. Sem esta janela, a máquina
 * que passou o dia desligada obedeceria ao comando de ontem no boot de amanhã —
 * e o aluno levaria um reload sem contexto nenhum.
 */
export const VALIDADE_MS = 30 * 60 * 1000;

/** Segundos de aviso antes da recarga. Tempo de gravar o que está aberto. */
export const AVISO_S = 10;

const CHAVE_EXECUTADO = 'logmax:ultimoComandoRecarga';

export function jaExecutado(id: string): boolean {
  try { return localStorage.getItem(CHAVE_EXECUTADO) === id; } catch { return false; }
}

/** Marcado ANTES de recarregar: depois do reload não há código nosso rodando. */
export function marcarExecutado(id: string): void {
  try { localStorage.setItem(CHAVE_EXECUTADO, id); } catch { /* modo privado */ }
}

export function dentroDaValidade(comando: ComandoTurma): boolean {
  const t = Date.parse(comando.created_at);
  return Number.isFinite(t) && Date.now() - t < VALIDADE_MS;
}

/**
 * A recarga de verdade. Cada passo é opcional e falha em silêncio: navegador
 * sem `caches`, sem service worker ou em modo privado ainda tem de recarregar —
 * meia limpeza é melhor do que nenhuma, e ficar preso num `throw` seria pior
 * que servir arquivo velho.
 */
export async function executarRecarga(): Promise<void> {
  try {
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map(k => caches.delete(k)));
    }
  } catch { /* sem Cache Storage */ }

  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    // Desregistrar, e não `update()`: com o SW fora do caminho a navegação
    // seguinte vai à rede de verdade. O vite-plugin-pwa registra de novo no
    // load, então a PWA volta inteira — com a versão nova.
    if (regs?.length) await Promise.all(regs.map(r => r.unregister()));
  } catch { /* sem service worker */ }

  window.location.reload();
}
