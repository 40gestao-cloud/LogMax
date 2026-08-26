// Comandos globais — duas portas para a mesma lista (`src/lib/comandos.ts`):
// atalho de teclado e paleta (Ctrl+K).
//
// Houve uma terceira, por voz, removida em 26/08/2026 a pedido: o
// reconhecimento do Chrome ouvia e não devolvia comando utilizável, e uma porta
// que só funciona às vezes é pior que porta nenhuma.
//
// As duas vivem num componente só porque precisam da MESMA pergunta
// antes de agir: trocar de unidade (ou sair) no meio de uma venda apaga o
// carrinho, e a régua de "quando não interromper" já existe em
// `naoInterromper.ts` — é a mesma que segura o reload da PWA. Se cada porta
// tivesse o seu caminho, o atalho de teclado seria o que esqueceria de
// perguntar, que é justamente o mais fácil de apertar sem querer.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Command, AlertTriangle, CornerDownLeft } from 'lucide-react';
import type { FilialOp } from './FilialSelector';
import { listaDeComandos, filtrarComandos, casarComando, type Comando } from '../lib/comandos';
import { motivoDeAdiar } from '../lib/naoInterromper';

interface ComandosCtx {
  abrir: () => void;
}

const Ctx = createContext<ComandosCtx>({ abrir: () => {} });

export const useComandos = () => useContext(Ctx);

/** Botão de chrome do topbar. A paleta é invisível por natureza — sem uma
 *  porta visível, só descobre os comandos quem foi avisado. */
export function BotaoComandos() {
  const { abrir } = useComandos();
  return (
    <button
      onClick={abrir}
      title="Comandos (Ctrl+K)"
      aria-label="Abrir comandos"
      className="neu-button h-9 px-3 rounded-xl hidden sm:flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-accent transition-colors shrink-0"
    >
      <Command size={13} />
      <span className="hidden md:inline">Ctrl+K</span>
    </button>
  );
}

interface Props {
  /** Mesma régua do seletor pós-login: admin, CEO e conselheiro. */
  podeTrocarUnidade: boolean;
  activeView: string;
  onTrocarUnidade: (destino: FilialOp | 'Matriz') => void;
  onAbrirSeletor: () => void;
  onSair: () => void;
  children: React.ReactNode;
}

export function ComandosProvider({
  podeTrocarUnidade, activeView, onTrocarUnidade, onAbrirSeletor, onSair, children,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [indice, setIndice] = useState(0);
  const [pendente, setPendente] = useState<{ cmd: Comando; motivo: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef(activeView);
  viewRef.current = activeView;

  const comandos = useMemo(() => listaDeComandos(podeTrocarUnidade), [podeTrocarUnidade]);
  const visiveis = useMemo(() => filtrarComandos(busca, comandos), [busca, comandos]);

  const fechar = useCallback(() => {
    setAberto(false);
    setBusca('');
    setIndice(0);
  }, []);

  const rodar = useCallback((cmd: Comando) => {
    switch (cmd.acao.tipo) {
      case 'unidade': onTrocarUnidade(cmd.acao.destino); break;
      case 'seletor': onAbrirSeletor(); break;
      case 'sair': onSair(); break;
    }
  }, [onTrocarUnidade, onAbrirSeletor, onSair]);

  const executar = useCallback((cmd: Comando) => {
    fechar();
    // O foco tem de sair da paleta ANTES de perguntar: com o cursor na caixa de
    // busca, `digitandoAgora()` responde que a pessoa está a escrever e TODO
    // comando pediria confirmação — inclusive na tela vazia.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const motivo = motivoDeAdiar({ view: viewRef.current, ignorarOcioso: true });
    if (motivo) { setPendente({ cmd, motivo }); return; }
    rodar(cmd);
  }, [fechar, rodar]);

  const abrir = useCallback(() => {
    setPendente(null);
    setBusca('');
    setIndice(0);
    setAberto(true);
  }, []);

  // Atalhos globais. Alt+dígito lido por `code` além de `key`: em teclado ABNT2
  // com Alt pressionado o `key` de algumas teclas vem como caractere morto.
  useEffect(() => {
    const ATALHOS: Record<string, string> = {
      '0': 'seletor',
      '1': 'unidade:Matriz',
      '2': 'unidade:SuperMax',
      '3': 'unidade:MaxLook',
      '4': 'unidade:TechMax',
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        abrir();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); abrir(); return; }
      if (k === 'q') {
        const sair = comandos.find(c => c.id === 'sair');
        if (sair) { e.preventDefault(); executar(sair); }
        return;
      }
      const digito = e.code?.startsWith('Digit') ? e.code.slice(5) : e.key;
      const id = ATALHOS[digito];
      if (!id) return;
      // Sem privilégio o comando nem existe na lista, e a tecla não faz nada —
      // é a mesma régua do seletor, não uma segunda checagem para desencontrar.
      const cmd = comandos.find(c => c.id === id);
      if (!cmd) return;
      e.preventDefault();
      executar(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [comandos, executar, abrir]);

  useEffect(() => { if (aberto) inputRef.current?.focus(); }, [aberto]);
  useEffect(() => { setIndice(0); }, [busca]);

  const valor = useMemo<ComandosCtx>(() => ({ abrir }), [abrir]);

  return (
    <Ctx.Provider value={valor}>
      {children}

      {/* Sem AnimatePresence de propósito. Com ele, o overlay fechado ficava no
          DOM com opacidade 0 — invisível e por cima de tudo, engolindo TODO
          clique do app (medido: elementFromPoint no centro da tela devolvia o
          fundo do modal já fechado). Animação de entrada não precisa de
          AnimatePresence; a de saída não vale o risco de deixar fantasma. */}
      {aberto && (
          <motion.div
            key="paleta"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="fixed inset-0 z-[9998] flex items-start justify-center p-4 pt-[12vh]"
            onClick={fechar}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              onClick={e => e.stopPropagation()}
              // Fora da rede de "trabalho não gravado": esta caixa é busca, e
              // sem a marca ela própria travaria o comando que acabou de servir.
              data-trava-atualizacao="nao"
              role="dialog"
              aria-label="Comandos"
              className="relative w-full max-w-lg overflow-hidden"
              style={{
                background: 'rgba(10,10,10,0.88)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: '1rem',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset',
              }}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
                <Command size={16} className="text-accent shrink-0" />
                <input
                  ref={inputRef}
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); setIndice(i => Math.min(i + 1, visiveis.length - 1)); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setIndice(i => Math.max(i - 1, 0)); return; }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const cmd = visiveis[indice] ?? (casarComando(busca, comandos) || undefined);
                      if (cmd) executar(cmd);
                    }
                  }}
                  placeholder="Buscar comando… (ex.: supermax, sair)"
                  className="flex-1 bg-transparent text-sm text-gray-100 placeholder:text-gray-600 outline-none"
                />
              </div>

              <ul className="max-h-[46vh] overflow-y-auto main-scrollbar py-1">
                {visiveis.length === 0 && (
                  <li className="px-4 py-6 text-center text-xs text-gray-500">Nenhum comando com esse nome.</li>
                )}
                {visiveis.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setIndice(i)}
                      onClick={() => executar(c)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        i === indice ? 'bg-accent/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-gray-100 truncate">{c.label}</span>
                        <span className="block text-[11px] text-gray-500 truncate">{c.descricao}</span>
                      </div>
                      {i === indice && <CornerDownLeft size={13} className="text-accent shrink-0" />}
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-600 shrink-0">{c.atalho}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
      )}

      {pendente && (
          <motion.div
            key="confirma"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              role="alertdialog"
              aria-label="Confirmar comando"
              className="relative w-full max-w-md"
              style={{
                background: 'rgba(10,10,10,0.88)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: '1rem',
                padding: '1.5rem',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                <h3 className="text-sm font-bold text-amber-400 uppercase tracking-widest">Tem trabalho em curso</h3>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed">
                <span className="font-bold">{pendente.cmd.label}</span> agora vai descartar o que está nesta tela — {pendente.motivo}.
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setPendente(null)}
                  autoFocus
                  className="px-4 py-2 rounded-lg text-sm font-semibold neu-button text-gray-300 hover:text-accent transition-colors"
                >
                  Ficar aqui
                </button>
                <button
                  onClick={() => { const p = pendente; setPendente(null); rodar(p.cmd); }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors"
                >
                  Continuar assim mesmo
                </button>
              </div>
            </motion.div>
          </motion.div>
      )}
    </Ctx.Provider>
  );
}
