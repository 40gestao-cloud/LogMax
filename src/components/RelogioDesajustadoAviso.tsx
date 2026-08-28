import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlarmClockOff, X } from 'lucide-react';
import {
  LIMITE_SESSAO_S, TOLERANCIA_S, descreveSkew, horaDoServidor, lerSkew,
} from '../lib/relogio';

// Aviso de relógio fora de hora. O porquê está no cabeçalho de
// src/lib/relogio.ts — em resumo: relógio adiantado além de ~59 min faz o
// token de sessão nascer vencido, o app renova em laço, o servidor corta por
// excesso de renovação e a pessoa volta para a tela de login sem entender
// nada. Não há conserto possível dentro do app: quem diz se o token expirou é
// o relógio do Windows. O que este componente faz é nomear a causa e dizer
// onde se acerta.
//
// Fica FORA da árvore autenticada (montado junto do PwaUpdatePrompt): a
// máquina com esse defeito passa a maior parte do tempo na tela de login, que
// é exatamente onde o aviso precisa aparecer.

/** O valor é reescrito a cada token novo; reler de vez em quando faz o aviso
 *  sumir sozinho depois de a máquina ser acertada. */
const INTERVALO_RELEITURA_MS = 30_000;

export function RelogioDesajustadoAviso() {
  const [skew, setSkew] = useState<number | null>(lerSkew);
  const [escondido, setEscondido] = useState(false);

  useEffect(() => {
    const reler = () => setSkew(lerSkew());
    const id = window.setInterval(reler, INTERVALO_RELEITURA_MS);
    window.addEventListener('focus', reler);
    return () => { window.clearInterval(id); window.removeEventListener('focus', reler); };
  }, []);

  const desajustado = skew !== null && Math.abs(skew) > TOLERANCIA_S;
  const derrubaSessao = skew !== null && skew > LIMITE_SESSAO_S;

  return (
    <AnimatePresence>
      {desajustado && !escondido && (
        <motion.div
          initial={{ y: -72, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -72, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          role="alert"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            // Acima do banner de atualização da PWA (9999): quando os dois
            // aparecem juntos, este é o que explica por que nada funciona.
            zIndex: 10000,
            background: 'linear-gradient(135deg, #B91C1C, #7F1D1D)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: '0 auto',
              padding: '0.65rem 1rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
            }}
          >
            <AlarmClockOff size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, fontSize: '0.78rem', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 800, letterSpacing: '0.02em' }}>
                O relógio deste computador está {descreveSkew(skew!)}
              </span>
              <span style={{ fontWeight: 600, opacity: 0.9 }}>
                {' '}(aqui marca {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                , o servidor marca {horaDoServidor(skew!)}).
              </span>
              <div style={{ fontWeight: 600, opacity: 0.92, marginTop: '0.2rem' }}>
                {derrubaSessao
                  ? 'É por isso que o sistema devolve você para a tela de login logo depois de entrar, e recusa o que você grava. '
                  : 'Horário de ponto e de lançamento sai errado enquanto ele não for acertado. '}
                Acerte em <strong>Configurações → Hora e idioma → Data e hora</strong>: fuso
                {' '}<strong>(UTC-05:00) Rio Branco</strong> e <strong>Sincronizar agora</strong>. Depois recarregue a página.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEscondido(true)}
              aria-label="Esconder aviso"
              title="Esconder o aviso. Ele volta enquanto o relógio estiver fora de hora."
              style={{
                width: 28,
                height: 28,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                opacity: 0.75,
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
