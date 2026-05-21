import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Send, Loader2, RotateCcw, AlertCircle, Eye } from 'lucide-react';
import { useGeminiChat } from '../hooks/useGeminiChat';
import { useCurrentAIContext } from '../contexts/AIAssistantContext';

const SUGESTOES = [
  'Como calcular o ponto de equilíbrio?',
  'O que é margem de contribuição?',
  'Estratégias para reduzir ruptura de estoque',
  'Como interpretar o índice de turnover?',
];

export const AIAssistantFAB = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  // Lê o contexto registrado pela view atual. Como `useCurrentAIContext`
  // retorna o estado live, embrulhamos num getter pra capturar o valor
  // exatamente no momento do envio (não no momento do hook).
  const currentContext = useCurrentAIContext();
  const ctxRef = useRef(currentContext);
  useEffect(() => { ctxRef.current = currentContext; }, [currentContext]);
  const { messages, isLoading, error, send, reset } = useGeminiChat({
    getContextSnapshot: () => ctxRef.current,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Esc fecha (padrão da casa — PontoFAB, AccentPicker)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Auto-scroll para a última mensagem
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, isLoading]);

  // Foco automático no campo quando abre
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    send(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra linha.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        whileTap={{ scale: 0.92 }}
        aria-label="Abrir assistente de IA"
        title="Assistente LogMax"
        className="fixed bottom-6 left-6 z-40 w-14 h-14 rounded-full neu-flat border border-accent/30 flex items-center justify-center text-accent hover:text-white hover:border-accent/60 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        style={{ background: 'var(--color-card-bg)' }}
      >
        <Sparkles size={22} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-end p-0 sm:p-6 bg-black/60 backdrop-blur-sm"
            onClick={close}
          >
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 30, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.97 }}
              onClick={e => e.stopPropagation()}
              className="w-full sm:w-[440px] h-[85vh] sm:h-[640px] sm:max-h-[85vh] neu-flat sm:rounded-3xl rounded-t-3xl border border-white/10 flex flex-col overflow-hidden"
              style={{ background: 'var(--color-bg-base)' }}
            >
              {/* Header */}
              <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-white/5">
                <div className="w-10 h-10 rounded-2xl neu-pressed flex items-center justify-center text-accent">
                  <Sparkles size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-100">MaxAI</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">Powered by Gemini</p>
                </div>
                {messages.length > 0 && (
                  <button
                    onClick={reset}
                    title="Limpar conversa"
                    className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  onClick={close}
                  aria-label="Fechar"
                  className="w-8 h-8 neu-button rounded-lg flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Conversa */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 flex flex-col gap-3">
                {messages.length === 0 && !isLoading && (
                  <div className="flex flex-col items-center justify-center text-center gap-3 mt-4">
                    <div className="w-16 h-16 rounded-full neu-pressed flex items-center justify-center text-accent">
                      <Sparkles size={26} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-200">Pergunte qualquer coisa</p>
                      <p className="text-[11px] text-gray-500 mt-1 max-w-[280px]">
                        Conceitos de mercado, fórmulas, estratégias ou dúvidas sobre o LogMax.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 w-full mt-3">
                      {SUGESTOES.map(s => (
                        <button
                          key={s}
                          onClick={() => { setInput(s); inputRef.current?.focus(); }}
                          className="neu-button rounded-xl px-3 py-2 text-xs text-left text-gray-400 hover:text-accent transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map(m => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        m.role === 'user'
                          ? 'bg-accent/15 text-gray-100 border border-accent/30'
                          : 'neu-flat text-gray-200 border border-white/5'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="neu-flat rounded-2xl px-3.5 py-2.5 border border-white/5 flex items-center gap-2 text-gray-400 text-xs">
                      <Loader2 size={12} className="animate-spin" /> pensando…
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Chip de contexto da tela atual */}
              {currentContext && (
                <div className="shrink-0 px-4 pt-2 -mb-1">
                  <div
                    className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20"
                    title="MaxAI tem acesso aos dados desta tela"
                  >
                    <Eye size={10} /> Vendo: {currentContext.label}
                  </div>
                </div>
              )}

              {/* Input */}
              <div className="shrink-0 border-t border-white/5 p-3 flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Pergunte algo..."
                  rows={1}
                  disabled={isLoading}
                  className="neu-input flex-1 rounded-xl px-3 py-2.5 text-sm resize-none max-h-32 disabled:opacity-60"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  aria-label="Enviar"
                  className="w-10 h-10 rounded-xl neu-button-accent flex items-center justify-center text-black disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
