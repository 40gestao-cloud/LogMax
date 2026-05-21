import { useCallback, useState } from 'react';
import { useAuth } from './useAuth';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
};

/**
 * Chat efêmero com o Gemini via /api/ai-chat. Conversa fica em memória
 * — recarregar a página zera o histórico. Setor/role do usuário é
 * resolvido server-side pelo endpoint (não passamos no body).
 */
export function useGeminiChat() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setLoading]  = useState(false);
  const [error, setError]        = useState<string | null>(null);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || isLoading) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: clean,
      createdAt: Date.now(),
    };

    // Snapshot para o payload — useState é async, então não dá pra
    // ler `messages` logo após o setMessages e ainda ter o userMsg.
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Erro na IA.');
        // Remove a mensagem do usuário pra ele poder editar/reenviar.
        setMessages(prev => prev.filter(m => m.id !== userMsg.id));
        return;
      }

      const reply: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: json.reply ?? '',
        createdAt: Date.now(),
      };
      setMessages(prev => [...prev, reply]);
    } catch {
      setError('Erro de conexão com a IA.');
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
    } finally {
      setLoading(false);
    }
  }, [messages, isLoading, session?.access_token]);

  return { messages, isLoading, error, send, reset };
}
