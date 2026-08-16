import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDLE_MS, AVISO_MS,
  isDispositivoCompartilhado, marcarAtividade, lerUltimaAtividade,
  garantirInicioSessao, cruzouFimDoTurno,
  type MotivoSaida,
} from '../lib/sessaoGuard';

/**
 * Logout automático por inatividade (camada 1) e por fim de turno (camada 3).
 * Ver o cabeçalho de `src/lib/sessaoGuard.ts` para o porquê das três camadas.
 *
 * `mousemove` fica FORA da lista de propósito: mouse tremendo na mesa não é
 * presença. Só ato intencional conta.
 */
const EVENTOS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/** Escrever em localStorage a cada evento seria desperdício; 30s basta. */
const GRAVA_A_CADA_MS = 30_000;

interface Opcoes {
  /** Só conta ociosidade com alguém logado. */
  enabled: boolean;
  onExpirar: (motivo: MotivoSaida) => void;
}

interface Retorno {
  /** Epoch (ms) em que a sessão cai, ou null quando o aviso não está ativo. */
  expiraEm: number | null;
  /** "Continuar conectado" — zera a ociosidade e fecha o aviso. */
  continuar: () => void;
}

export function useIdleLogout({ enabled, onExpirar }: Opcoes): Retorno {
  const [expiraEm, setExpiraEm] = useState<number | null>(null);

  const ultimaRef   = useRef(Date.now());
  const gravadoRef  = useRef(0);
  const expirouRef  = useRef(false);
  // O aviso na tela congela a contagem: enquanto ele está aberto, só os botões
  // dele decidem. Sem isso, um clique no backdrop cancelaria o aviso em
  // silêncio e o usuário nunca entenderia o que aconteceu.
  const avisandoRef = useRef(false);

  // onExpirar vem de closures recriadas a cada render do App (signOut e
  // clearFilial não são memoizados). O ref evita remontar todos os listeners a
  // cada render.
  const onExpirarRef = useRef(onExpirar);
  useEffect(() => { onExpirarRef.current = onExpirar; }, [onExpirar]);

  const registrar = useCallback((forcar = false) => {
    if (avisandoRef.current) return;
    const agora = Date.now();
    ultimaRef.current = agora;
    if (forcar || agora - gravadoRef.current >= GRAVA_A_CADA_MS) {
      gravadoRef.current = agora;
      marcarAtividade(agora);
    }
  }, []);

  const continuar = useCallback(() => {
    avisandoRef.current = false;
    setExpiraEm(null);
    registrar(true);
  }, [registrar]);

  useEffect(() => {
    if (!enabled) {
      avisandoRef.current = false;
      expirouRef.current = false;
      setExpiraEm(null);
      return;
    }

    const compartilhado = isDispositivoCompartilhado();
    const agoraInicial = Date.now();
    ultimaRef.current = agoraInicial;
    gravadoRef.current = agoraInicial;
    marcarAtividade(agoraInicial);
    garantirInicioSessao(agoraInicial);
    expirouRef.current = false;

    const expirar = (motivo: MotivoSaida) => {
      if (expirouRef.current) return;
      expirouRef.current = true;
      avisandoRef.current = false;
      setExpiraEm(null);
      onExpirarRef.current(motivo);
    };

    const tick = () => {
      const agora = Date.now();

      // Camada 3 — o turno da turma acabou. Só em máquina compartilhada: no
      // celular do aluno isso derrubaria a sessão todo fim de aula.
      if (compartilhado && cruzouFimDoTurno(garantirInicioSessao(), agora)) {
        expirar('fim-turno');
        return;
      }

      const ocioso = agora - ultimaRef.current;
      if (ocioso >= IDLE_MS) {
        expirar('inatividade');
        return;
      }

      // O prazo é fixo enquanto não houver atividade, então o setState só muda
      // de valor na entrada e na saída do aviso — o App não re-renderiza a cada
      // segundo. A contagem regressiva é responsabilidade do modal.
      if (ocioso >= IDLE_MS - AVISO_MS) {
        avisandoRef.current = true;
        setExpiraEm(ultimaRef.current + IDLE_MS);
      }
    };

    const id = setInterval(tick, 1000);
    const opts = { passive: true, capture: true } as const;
    const aoInteragir = () => registrar();
    EVENTOS.forEach(ev => window.addEventListener(ev, aoInteragir, opts));

    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      if (compartilhado) {
        // Máquina de lab: tempo com a aba escondida CONTA como ociosidade.
        // Reavalia na hora em vez de esperar o próximo tick (timers de aba em
        // segundo plano são throttled pelo navegador).
        tick();
        return;
      }
      // Dispositivo pessoal: o app em segundo plano no celular não é abandono.
      // Zerar aqui é o que faz "o celular continuar lembrando o login".
      registrar(true);
    };
    document.addEventListener('visibilitychange', aoVoltar);

    // Duas abas abertas: atividade numa mantém a outra viva.
    const aoStorage = (e: StorageEvent) => {
      if (e.key !== null && !e.key.endsWith(':ultimaAtividade')) return;
      const remota = lerUltimaAtividade();
      if (remota !== null && remota > ultimaRef.current) {
        ultimaRef.current = remota;
        avisandoRef.current = false;
        setExpiraEm(null);
      }
    };
    window.addEventListener('storage', aoStorage);

    return () => {
      clearInterval(id);
      EVENTOS.forEach(ev => window.removeEventListener(ev, aoInteragir, opts));
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('storage', aoStorage);
    };
  }, [enabled, registrar]);

  return { expiraEm, continuar };
}
