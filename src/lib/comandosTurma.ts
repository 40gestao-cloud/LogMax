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

/** Teto do atraso aleatório antes de recarregar (ver `executarRecarga`). */
const JITTER_MAX_MS = 4000;

/** Quanto se espera pela prova de que a rede responde, antes de purgar. */
const TIMEOUT_SONDA_MS = 4000;

/**
 * A rede está mesmo de pé para servir o app?
 *
 * `navigator.onLine` não serve: ele diz que há uma interface ativa, não que o
 * servidor responde — no laboratório, o wi-fi conectado com a internet caída é
 * o caso comum, e é exatamente o que não pode passar por aqui.
 */
async function appAlcancavel(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), TIMEOUT_SONDA_MS);
    // `cache: 'reload'` força ir à rede em vez de aceitar resposta guardada.
    const r = await fetch(`${location.origin}/?_recarga=${Date.now()}`, {
      method: 'HEAD',
      cache:  'reload',
      signal: ctrl.signal,
    });
    clearTimeout(id);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * A recarga de verdade.
 *
 * Duas travas que a primeira versão não tinha, e que uma revisão apanhou:
 *
 * 1. **Só purga se a rede responder.** Apagar o Cache Storage e desregistrar o
 *    service worker de uma máquina offline a deixa sem NADA para servir: a
 *    navegação seguinte vai à rede, falha, e o aluno fica com a página de erro
 *    do navegador até a internet voltar — pior do que a versão velha que ele
 *    tinha. Sem prova de rede, recarrega e pronto: o SW continua no lugar.
 *
 * 2. **Atraso aleatório de até 4 s.** Sem cache, cada estação rebaixa o
 *    precache inteiro (~10 MB). Trinta máquinas recarregando no mesmo segundo,
 *    por causa da contagem sincronizada, são ~300 MB de pico no link do
 *    laboratório — e as últimas caem no caso 1. Espalhar os pedidos custa
 *    segundos e evita a avalanche. O botão "Recarregar agora" passa 0: quem
 *    clicou está olhando para a tela.
 *
 * Cada passo falha em silêncio: navegador sem `caches`, sem service worker ou
 * em modo privado ainda tem de recarregar.
 */
export async function executarRecarga(jitterMaxMs = JITTER_MAX_MS): Promise<void> {
  if (jitterMaxMs > 0) {
    await new Promise(r => setTimeout(r, Math.random() * jitterMaxMs));
  }

  if (await appAlcancavel()) {
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
  }

  window.location.reload();
}
