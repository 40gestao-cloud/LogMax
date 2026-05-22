import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

// Modelo Gemini default — 2.5-flash é o GA atual com free tier; 1.5 foi
// deprecated no v1beta e 2.0-flash vem com limit:0 em alguns projetos
// novos do AI Studio. Para listar modelos disponíveis para a chave,
// chame GET /api/ai-models. Override via env GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-2.5-flash';

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
    const canUseMaxAI =
      user.role === 'admin' || user.role === 'ceo' || user.setor === 'financeiro';
    if (!canUseMaxAI) {
      log.warn('access.denied', { user_id: user.id, role: user.role, setor: user.setor });
      return res.status(403).json({ error: 'MaxAI disponível apenas para Admin, CEO e Financeiro.' });
    }

    // .trim() defensivo: copiar do AI Studio às vezes traz espaço/quebra-linha
    // que invalida silenciosamente a chave do lado do Google.
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      log.error('config.missing_key', new Error('GEMINI_API_KEY ausente'));
      return res.status(500).json({ error: 'IA não configurada no servidor. Adicione GEMINI_API_KEY nas env vars do Vercel.' });
    }
    const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

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

    // Gemini espera role: 'user' | 'model'. Mapeamos 'assistant' → 'model'.
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }],
    }));

    // Header em vez de query string: evita logar a chave em access logs
    // e é o método recomendado pelo Google.
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt(user.setor, user.role) }] },
        contents,
        // Google Search nativo (grounding): o modelo decide sozinho quando
        // pesquisar. Vem com cota gratuita generosa no AI Studio e adiciona
        // citações em groundingMetadata.groundingChunks da resposta.
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 1024,
          topP: 0.95,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    const data = await upstream.json() as any;

    if (!upstream.ok) {
      // Inclui o erro cru do Google no log pra diagnóstico (a key não é logada)
      log.warn('gemini.failed', {
        user_id: user.id,
        status: upstream.status,
        error_kind: data?.error?.status,
        error_message: data?.error?.message,
        key_len: apiKey.length,
        key_prefix: apiKey.slice(0, 4),
        model,
      });
      const isAuthErr = upstream.status === 400 || upstream.status === 401 || upstream.status === 403;
      const friendly =
        upstream.status === 429 ? 'Limite de uso da IA atingido. Tente novamente em alguns minutos.'
        : isAuthErr ? 'Chave da IA inválida ou sem permissão. Verifique a env var GEMINI_API_KEY no Vercel e refaça o deploy.'
        : data?.error?.message ?? 'Erro na IA.';
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: friendly });
    }

    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';

    // Quando o modelo usa Google Search, vem groundingMetadata com fontes.
    // Dedupe por URI e limita a 6 — o suficiente pra UI sem virar parede de links.
    const grounding = data?.candidates?.[0]?.groundingMetadata;
    const sources: { uri: string; title: string }[] = [];
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
    const searchQueries: string[] = Array.isArray(grounding?.webSearchQueries)
      ? grounding.webSearchQueries.slice(0, 4)
      : [];

    if (!text.trim()) {
      const finish = data?.candidates?.[0]?.finishReason;
      log.info('gemini.empty', { user_id: user.id, finish });
      return res.status(200).json({
        reply: finish === 'SAFETY'
          ? 'Não consigo responder a essa pergunta. Tente reformular.'
          : 'A IA não retornou resposta. Tente novamente.',
        finishReason: finish,
      });
    }

    log.info('gemini.ok', {
      user_id: user.id,
      chars_in: messages.reduce((s, m) => s + m.content.length, 0),
      chars_out: text.length,
      grounded: sources.length > 0,
      sources_count: sources.length,
      search_queries: searchQueries,
    });
    return res.status(200).json({ reply: text, sources, searchQueries });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
