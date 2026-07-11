import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors, userHasSetor } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import { callLLM, type LLMMessage } from '../lib/llm.js';

type ChatMessage = { role: 'user' | 'assistant' | 'model'; content: string };

const SETOR_LABEL: Record<string, string> = {
  all:        'Administrativo (acesso global)',
  logistica:  'Logística',
  vendas:     'Vendas',
  financeiro: 'Financeiro',
  rh:         'Recursos Humanos',
  marketing:  'Marketing',
  ti:         'TI & Suporte',
};

const buildSystemPrompt = (setor: string, role: string) => `
Você é o assistente do LogMax, um ERP educacional usado por alunos no papel de
colaboradores, gerentes, CEO e admin de uma empresa fictícia.

O usuário atual é do setor **${SETOR_LABEL[setor] ?? setor}** com papel **${role}**.

Diretrizes:
- Responda em português brasileiro, direto e prático.
- Adapte o nível ao papel: gerente quer estratégia, colaborador quer passo a passo, CEO quer visão macro.
- Quando o pedido for de fórmula, dê a fórmula primeiro, depois um exemplo numérico curto.
- Quando o pedido for de mercado/estratégia, traga o conceito + 2–3 bullets de aplicação prática.
- Evite respostas longuíssimas — prefira clareza e listas a textão.
- Se a pergunta envolver dados internos do LogMax, deixe claro que você não tem acesso ao banco e oriente a consultar o módulo correspondente — exceto quando vier um bloco [DADOS DE CONTEXTO DO SISTEMA] na mensagem, que você deve usar como verdade.

Pesquisa na web (Google Search):
- Você tem acesso ao Google Search e DEVE usá-lo quando a resposta depender de informação externa e atual: cotações, taxas, alíquotas, legislação fiscal/trabalhista vigente, indicadores econômicos, notícias de mercado, preços médios, definições técnicas que mudam com o tempo.
- NÃO pesquise na web para perguntas conceituais clássicas (fórmulas contábeis, princípios de gestão, definições estáveis) — responda do seu conhecimento.
- NÃO pesquise por dados internos do LogMax — esses vêm pelo bloco [DADOS DE CONTEXTO DO SISTEMA] quando relevantes.
- Ao usar busca, mencione na resposta que a informação é atual ("consultando dados recentes…") para o usuário entender o contexto.
`.trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-chat');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    // Acesso ao MaxAI restrito a admin/CEO (visão global) e Financeiro.
    // UI gateia também, mas validar server-side previne uso direto do endpoint.
    const canUseMaxAI = userHasSetor(user, 'financeiro');
    if (!canUseMaxAI) {
      log.warn('access.denied', { user_id: user.id, role: user.role, setor: user.setor });
      return res.status(403).json({ error: 'MaxAI disponível apenas para Admin, CEO e Financeiro.' });
    }

    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim() && !process.env.OPENROUTER_API_KEY?.trim()) {
      log.error('config.missing_key', new Error('Nenhuma chave de IA configurada'));
      return res.status(500).json({ error: 'IA não configurada no servidor. Adicione GEMINI_API_KEY (e/ou GROQ_API_KEY / OPENROUTER_API_KEY) nas env vars do Vercel.' });
    }

    const { messages } = (req.body ?? {}) as { messages?: ChatMessage[] };
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages é obrigatório (array não vazio).' });
    }
    if (messages.length > 30) {
      return res.status(400).json({ error: 'Conversa muito longa. Reinicie o chat.' });
    }
    for (const m of messages) {
      if (typeof m?.content !== 'string' || !m.content.trim()) {
        return res.status(400).json({ error: 'Mensagem inválida.' });
      }
      if (m.content.length > 8000) {
        return res.status(400).json({ error: 'Mensagem muito longa (máx 8000 chars).' });
      }
    }

    // Normaliza 'model' (legado) → 'assistant' pro helper unificado.
    const llmMessages: LLMMessage[] = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
    }));

    // ─── LLM com fallback Gemini → OpenRouter ───────────────────────
    // Google Search grounding só roda no Gemini (geminiTools). Se cair pro
    // OpenRouter, perde fontes/queries mas mantém resposta.
    const llm = await callLLM({
      systemPrompt: buildSystemPrompt(user.setor, user.role),
      messages:     llmMessages,
      temperature:  0.6,
      maxOutputTokens: 1024,
      topP:         0.95,
      geminiTools:  [{ google_search: {} }],
    }, log);

    if (!llm.ok) {
      return res.status(llm.httpStatus).json({ error: llm.friendlyMessage });
    }

    // Extrai grounding só se veio do Gemini — OpenRouter não tem grounding.
    const sources: { uri: string; title: string }[] = [];
    const searchQueries: string[] = [];
    if (llm.provider === 'gemini' && llm.geminiRaw) {
      const grounding = llm.geminiRaw?.candidates?.[0]?.groundingMetadata;
      if (Array.isArray(grounding?.groundingChunks)) {
        const seen = new Set<string>();
        for (const chunk of grounding.groundingChunks) {
          const uri = chunk?.web?.uri;
          if (!uri || seen.has(uri)) continue;
          seen.add(uri);
          sources.push({ uri, title: chunk.web.title ?? uri });
          if (sources.length >= 6) break;
        }
      }
      if (Array.isArray(grounding?.webSearchQueries)) {
        searchQueries.push(...grounding.webSearchQueries.slice(0, 4));
      }
    }

    log.info('llm.ok', {
      user_id: user.id,
      provider: llm.provider,
      model: llm.modelUsed,
      chars_in: messages.reduce((s, m) => s + m.content.length, 0),
      chars_out: llm.text.length,
      grounded: sources.length > 0,
      sources_count: sources.length,
      search_queries: searchQueries,
    });
    return res.status(200).json({ reply: llm.text, sources, searchQueries });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
