import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X, Sparkles } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { motivoDeAdiar } from '../lib/naoInterromper';
import { viewAtual } from '../lib/viewAtual';

// Intervalo entre verificações de nova versão. O navegador só checa o SW por
// conta própria na navegação e a cada ~24h — numa PWA instalada, que a turma
// deixa aberta a manhã inteira, isso é tempo demais para um fix chegar.
const INTERVALO_CHECAGEM_MS = 30 * 60 * 1000;

// De quanto em quanto tempo se reconfere se já dá para recarregar. Curto: o
// objetivo é entrar no primeiro respiro, não no próximo quarto de hora.
const INTERVALO_TENTATIVA_MS = 5000;

/**
 * Registra o service worker do PWA e aplica a versão nova NUM MOMENTO SEGURO.
 *
 * ─── Por que não é mais o 'autoUpdate' puro ─────────────────────────────────
 *
 * De 10/08 a 24/08 o `registerType` era 'autoUpdate': versão nova assumia e a
 * página recarregava sozinha, na hora. O motivo era bom — com 'prompt', a
 * correção só alcançava quem clicasse no banner, e numa sala de aula ninguém
 * lê banner; metade da turma ficou com o service worker antigo.
 *
 * O preço, porém, cai sempre no mesmo sítio: o reload é instantâneo e apaga o
 * que está em memória. O aluno no meio de uma venda perde o carrinho; quem
 * está preenchendo um lote de requisições perde as linhas; a contagem de
 * inventário volta ao zero. E não há aviso nenhum: a tela simplesmente pisca e
 * volta vazia, o que a turma lê como "o sistema apagou o meu trabalho".
 *
 * As duas coisas são conciliáveis, porque a versão nova quase nunca precisa
 * entrar NESTE segundo — precisa entrar hoje, sem ninguém clicar em nada.
 * Então: continua automático, mas espera o primeiro momento seguro (régua em
 * src/lib/naoInterromper.ts — telas de operação, campo em foco, trabalho não
 * gravado declarado pela tela, e uns segundos de silêncio). Aba escondida é o
 * melhor momento de todos e dispensa o silêncio.
 *
 * O banner continua, agora com outro papel: enquanto está adiado, ele DIZ que
 * está adiado e por quê, e oferece o botão para quem quiser atualizar já.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Checagem periódica + ao voltar para a aba. Sem isto, a versão nova só
      // seria descoberta na próxima navegação — e uma PWA instalada quase não
      // navega.
      const checar = () => { registration.update().catch(() => { /* offline */ }); };
      setInterval(checar, INTERVALO_CHECAGEM_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checar();
      });
    },
    onRegisterError(err) {
      console.warn('[PWA] Erro ao registar service worker:', err);
    },
  });

  const [updating, setUpdating] = useState(false);
  const [adiadoPor, setAdiadoPor] = useState<string | null>(null);
  // Esconder é só do banner. `needRefresh` fica de pé: se o X desligasse a
  // fila, fechar o aviso significaria "nunca mais atualize" — que é o defeito
  // do 'prompt' que a 10/08 tentou resolver.
  const [escondido, setEscondido] = useState(false);
  // O reload é irreversível e pode ser chamado por três caminhos (tentativa
  // periódica, aba escondida, clique). O ref garante que só um passa.
  const aplicandoRef = useRef(false);

  const aplicar = useCallback(() => {
    if (aplicandoRef.current) return;
    aplicandoRef.current = true;
    setUpdating(true);
    // updateServiceWorker(true) só recarrega se o evento `controllerchange`
    // disparar. Em alguns estados (SW waiting preso, primeira visita após
    // registro, dev) isso não acontece e a chamada fica silenciosa. Disparamos
    // o skip-waiting e, em paralelo, agendamos um reload de fallback.
    try { updateServiceWorker(true); } catch (e) { console.warn('[PWA] update falhou:', e); }
    setTimeout(() => window.location.reload(), 1500);
  }, [updateServiceWorker]);

  useEffect(() => {
    if (!needRefresh) return;

    const tentar = (ignorarOcioso = false) => {
      const motivo = motivoDeAdiar({ view: viewAtual(), ignorarOcioso });
      if (motivo) { setAdiadoPor(motivo); return; }
      setAdiadoPor(null);
      aplicar();
    };

    tentar();
    const t = window.setInterval(() => tentar(), INTERVALO_TENTATIVA_MS);
    // Aba escondida: a pessoa foi para outro sítio, e este é o momento mais
    // seguro que existe — ela volta com a versão nova já carregada. O relógio
    // de ociosidade não vale aqui (ninguém interage numa aba que não vê), mas
    // as travas de trabalho não gravado continuam valendo.
    const onVis = () => { if (document.visibilityState === 'hidden') tentar(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [needRefresh, aplicar]);

  return (
    <AnimatePresence>
      {needRefresh && adiadoPor && !escondido && (
        <motion.div
          initial={{ y: -64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -64, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
            color: 'var(--color-accent-text)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: '0 auto',
              padding: '0.6rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <Sparkles size={16} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, flex: 1, letterSpacing: '0.02em' }}>
              Nova versão pronta — entra sozinha quando você terminar
              <span style={{ fontWeight: 600, opacity: 0.85 }}> ({adiadoPor}).</span>
            </span>
            <button
              type="button"
              onClick={aplicar}
              disabled={updating}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'rgba(0,0,0,0.18)',
                color: 'inherit',
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: '0.6rem',
                padding: '0.4rem 0.8rem',
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.05em',
                cursor: updating ? 'wait' : 'pointer',
                opacity: updating ? 0.7 : 1,
              }}
            >
              <RefreshCw size={12} className={updating ? 'animate-spin' : ''} />
              {updating ? 'Atualizando...' : 'Atualizar agora'}
            </button>
            <button
              type="button"
              onClick={() => setEscondido(true)}
              aria-label="Esconder aviso"
              title="Esconder o aviso. A versão nova entra sozinha no primeiro momento seguro."
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                opacity: 0.7,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
