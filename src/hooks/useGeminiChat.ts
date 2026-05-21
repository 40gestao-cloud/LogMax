import { useCallback, useState } from 'react';
import { useAuth } from './useAuth';
import type { AIContextSnapshot } from '../contexts/AIAssistantContext';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
};

// Orçamento de caracteres pro JSON do contexto. O endpoint rejeita
// mensagens > 8000 chars; deixamos folga pro wrapper + pergunta.
const CONTEXT_BUDGET = 5500;

/**
 * Trunca o payload de contexto pra caber no orçamento. Arrays perdem
 * itens pelo fim até passarem no limite; objetos não-array ficam como
 * string truncada. Anota `_truncated/_shown/_total` pra o modelo saber.
 */
function truncateContextData(data: unknown): unknown {
  const full = JSON.stringify(data ?? null);
  if (full.length <= CONTEXT_BUDGET) return data;

  if (Array.isArray(data)) {
    const arr = [...data];
    while (arr.length > 0 && JSON.stringify(arr).length > CONTEXT_BUDGET - 120) {
      arr.pop();
    }
    return { _truncated: true, _shown: arr.length, _total: data.length, items: arr };
  }
  return { _truncated: true, preview: full.slice(0, CONTEXT_BUDGET - 200) + '…[truncado]' };
}

/**
 * Embrulha o texto do usuário com o bloco de contexto, no formato
 * que o MaxAI deve interpretar. O texto original continua visível
 * na UI — só o payload da API recebe a versão expandida.
 */
function wrapWithContext(userText: string, ctx: AIContextSnapshot): string {
  const safeData = truncateContextData(ctx.data);
  const json = JSON.stringify(safeData);
  return (
    `[DADOS DE CONTEXTO DO SISTEMA (${ctx.label}) — Use isso para basear sua resposta: ${json}]\n\n` +
    `Pergunta do usuário: ${userText}`
  );
}

type Options = {
  /** Chamado no momento do envio pra capturar o contexto atual da tela. */
  getContextSnapshot?: () => AIContextSnapshot | null;
};

/**
 * Chat efêmero com o Gemini via /api/ai-chat. Conversa fica em memória
 * — recarregar a página zera o histórico. Setor/role do usuário é
 * resolvido server-side pelo endpoint (não passamos no body).
 */
export function useGeminiChat(opts?: Options) {
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

    // Captura contexto da tela atual no momento do envio (não no momento
    // do mount do hook). Injeta apenas na ÚLTIMA mensagem do usuário —
    // o histórico segue cru pra não inflar o consumo de tokens.
    const ctx = opts?.getContextSnapshot?.() ?? null;
    const payloadMessages = next.map((m, idx) => {
      const isLastUser = idx === next.length - 1 && m.role === 'user';
      return {
        role: m.role,
        content: isLastUser && ctx ? wrapWithContext(m.content, ctx) : m.content,
      };
    });

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ messages: payloadMessages }),
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
  }, [messages, isLoading, session?.access_token, opts?.getContextSnapshot]);

  return { messages, isLoading, error, send, reset };
}
