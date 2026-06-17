import type { Logger } from './log.js';

// Camada unificada de chamada a LLMs com fallback automático:
//   1. Gemini (primário) com retry em 503/429.
//   2. OpenRouter (fallback) com cadeia de modelos free.
//
// Por que: o Gemini free entra em "modelo sobrecarregado" em picos de
// demanda. OpenRouter agrega ~50 provedores numa única API OpenAI-
// compatível e aceita lista de modelos numa única chamada — failover
// interno é automático, sem orquestração extra do nosso lado.
//
// Modelos free do OpenRouter (limite ~50 req/dia por modelo, mas
// rotativo entre vários): cobre o uso didático do LogMax sem custo.
//
// Os 4 endpoints de IA (ai-briefing, ai-bi, ai-chat, ai-legenda) usam
// esta camada. ai-chat passa `geminiTools` pra ativar Google Search no
// Gemini — se cair pro OpenRouter, perde grounding mas mantém resposta.

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

// Cadeia de modelos free no OpenRouter. Override via OPENROUTER_MODELS
// (CSV) se quiser priorizar outros. OpenRouter tenta na ordem e cai pro
// próximo automaticamente.
//
// IMPORTANTE: lista de free models do OpenRouter rotaciona com frequência.
// Verificar em https://openrouter.ai/models?max_price=0 e atualizar se
// começar a falhar. Conferido pela última vez em 2026-06-16.
const OPENROUTER_DEFAULT_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',  // 70B reliável, bom em PT-BR
  'openai/gpt-oss-120b:free',                // 120B open-source da OpenAI
  'qwen/qwen3-next-80b-a3b-instruct:free',   // Qwen3 MoE 80B multilíngue
  'nvidia/nemotron-3-super-120b-a12b:free',  // Nemotron 120B reasoning
];

const RETRY_DELAYS_MS = [1500, 3500];

export type LLMMessage = { role: 'user' | 'assistant'; content: string };

export type LLMRequest = {
  systemPrompt: string;
  // Single-shot: passe userPrompt. Multi-turn (chat): passe messages.
  userPrompt?: string;
  messages?: LLMMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  jsonMode?: boolean;
  // Tools só são honradas pelo Gemini (ex: { google_search: {} }).
  // OpenRouter ignora — fallback perde grounding mas mantém resposta.
  geminiTools?: any[];
};

// Tipo único achatado (em vez de union discriminada) — o tsconfig do
// projeto não roda em strict mode, e isso quebra narrowing automático
// com `if (!llm.ok)`. Campos opcionais ficam undefined no caminho que
// não os usa.
export type LLMResult = {
  ok: boolean;
  // Quando ok=true:
  text: string;
  provider: 'gemini' | 'openrouter' | null;
  modelUsed: string;
  finishReason?: string;
  // Resposta crua do Gemini — só preenchido quando provider==='gemini'.
  // Usado por ai-chat pra extrair groundingMetadata (fontes do Google Search).
  geminiRaw?: any;
  // Quando ok=false:
  httpStatus: number;
  friendlyMessage: string;
};

const okResult = (
  text: string,
  provider: 'gemini' | 'openrouter',
  modelUsed: string,
  finishReason?: string,
  geminiRaw?: any,
): LLMResult => ({
  ok: true, text, provider, modelUsed, finishReason, geminiRaw,
  httpStatus: 200, friendlyMessage: '',
});

const failResult = (
  httpStatus: number,
  friendlyMessage: string,
  finishReason?: string,
): LLMResult => ({
  ok: false, text: '', provider: null, modelUsed: '', finishReason,
  httpStatus, friendlyMessage,
});

// ─────────────────────────────────────────────
// Conversão de formato
// ─────────────────────────────────────────────

const toGeminiContents = (req: LLMRequest) => {
  if (req.messages && req.messages.length > 0) {
    return req.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }],
    }));
  }
  return [{ role: 'user', parts: [{ text: req.userPrompt ?? '' }] }];
};

const toOpenAIMessages = (req: LLMRequest) => {
  const out: { role: string; content: string }[] = [];
  if (req.systemPrompt) out.push({ role: 'system', content: req.systemPrompt });
  if (req.messages && req.messages.length > 0) {
    for (const m of req.messages) out.push({ role: m.role, content: m.content });
  } else if (req.userPrompt) {
    out.push({ role: 'user', content: req.userPrompt });
  }
  return out;
};

// ─────────────────────────────────────────────
// Chamadas individuais (uma tentativa)
// ─────────────────────────────────────────────

async function callGeminiOnce(
  req: LLMRequest,
  model: string,
  apiKey: string,
): Promise<{ status: number; data: any }> {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body: any = {
    systemInstruction: { parts: [{ text: req.systemPrompt }] },
    contents: toGeminiContents(req),
    generationConfig: {
      temperature:     req.temperature     ?? 0.7,
      maxOutputTokens: req.maxOutputTokens ?? 4000,
      topP:            req.topP            ?? 0.95,
      ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };
  if (req.geminiTools) body.tools = req.geminiTools;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await resp.json() as any;
  return { status: resp.status, data };
}

async function callOpenRouterOnce(
  req: LLMRequest,
  models: string[],
  apiKey: string,
): Promise<{ status: number; data: any }> {
  const body = {
    // OpenRouter aceita array `models` e faz failover interno automático.
    models,
    messages: toOpenAIMessages(req),
    temperature: req.temperature     ?? 0.7,
    max_tokens:  req.maxOutputTokens ?? 4000,
    top_p:       req.topP            ?? 0.95,
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${apiKey}`,
      // Headers opcionais que aparecem no ranking público do OpenRouter.
      // Sem efeito funcional, só identificam a origem das chamadas.
      'HTTP-Referer':   process.env.VITE_APP_URL || 'https://logmax.vercel.app',
      'X-Title':        'LogMax ERP',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json() as any;
  return { status: resp.status, data };
}

// ─────────────────────────────────────────────
// Orquestração: Gemini → OpenRouter
// ─────────────────────────────────────────────

export async function callLLM(req: LLMRequest, log: Logger): Promise<LLMResult> {
  const geminiKey     = process.env.GEMINI_API_KEY?.trim();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const geminiModel   = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  const openrouterModels = (process.env.OPENROUTER_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const orModels = openrouterModels.length > 0 ? openrouterModels : OPENROUTER_DEFAULT_MODELS;

  // ─── 1. Gemini com retry em 503/429 ──────────────────────────
  let lastGeminiStatus = 0;
  let lastGeminiMsg: string | undefined;
  if (geminiKey) {
    for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
      try {
        const { status, data } = await callGeminiOnce(req, geminiModel, geminiKey);

        if (status >= 200 && status < 300) {
          const text: string =
            data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
          const finish = data?.candidates?.[0]?.finishReason;

          // SAFETY/RECITATION com texto vazio é decisão do modelo — não
          // tentar fallback porque outros provedores provavelmente farão o
          // mesmo. Já MAX_TOKENS com texto parcial é considerado sucesso
          // (endpoint decide se parseou JSON ou não).
          if (!text.trim() && (finish === 'SAFETY' || finish === 'RECITATION')) {
            return failResult(
              502,
              finish === 'SAFETY'
                ? 'A IA recusou gerar a resposta (filtro de segurança).'
                : 'A IA detectou conteúdo protegido. Reformule e tente novamente.',
              finish,
            );
          }

          // Texto vazio sem motivo claro → tenta fallback.
          if (!text.trim()) {
            log.warn('gemini.empty_no_finish', { finish, model: geminiModel });
            break;
          }

          return okResult(text, 'gemini', geminiModel, finish, data);
        }

        lastGeminiStatus = status;
        lastGeminiMsg = data?.error?.message;

        const isAuthErr  = status === 400 || status === 401 || status === 403;
        const isOverload = status === 503 || status === 429;

        // Erro de auth: chave inválida. Vai direto pro fallback (OpenRouter
        // pode ter chave OK) sem queimar retries.
        if (isAuthErr) {
          log.warn('gemini.auth_error', { status, msg: lastGeminiMsg });
          break;
        }

        // Sobrecarga transitória: retry com backoff.
        if (isOverload && i < RETRY_DELAYS_MS.length) {
          log.warn('gemini.retry', { status, attempt: i + 1 });
          await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[i]));
          continue;
        }

        // Esgotou retries ou outro erro (5xx, 4xx) → cai pro fallback.
        log.warn('gemini.failed', { status, msg: lastGeminiMsg });
        break;
      } catch (err: any) {
        log.warn('gemini.exception', { error: err?.message });
        break;
      }
    }
  }

  // ─── 2. Fallback: OpenRouter com cadeia de modelos ───────────
  if (openrouterKey) {
    try {
      const { status, data } = await callOpenRouterOnce(req, orModels, openrouterKey);

      if (status >= 200 && status < 300) {
        const text: string = data?.choices?.[0]?.message?.content ?? '';
        const finish = data?.choices?.[0]?.finish_reason;
        const modelUsed = data?.model ?? orModels[0] ?? 'openrouter';

        if (text.trim()) {
          log.info('openrouter.ok', { modelUsed, finish });
          return okResult(text, 'openrouter', modelUsed, finish);
        }
        log.warn('openrouter.empty', { finish, modelUsed });
      } else {
        log.warn('openrouter.failed', {
          status, msg: data?.error?.message ?? data?.message,
        });
      }
    } catch (err: any) {
      log.error('openrouter.exception', err);
    }
  }

  // ─── 3. Todos os provedores falharam ─────────────────────────
  const noKeys = !geminiKey && !openrouterKey;
  if (noKeys) {
    return failResult(500, 'Nenhum provedor de IA configurado no servidor.');
  }

  // Mensagens específicas pro caso mais comum: Gemini sobrecarregado +
  // sem OpenRouter configurado.
  if (!openrouterKey && (lastGeminiStatus === 503 || lastGeminiStatus === 429)) {
    return failResult(
      lastGeminiStatus,
      lastGeminiStatus === 503
        ? 'Modelo de IA está com alta demanda agora. Aguarde 1-2 minutos e tente de novo. (Configure OPENROUTER_API_KEY para fallback automático.)'
        : 'Limite de uso da IA atingido. Tente novamente em alguns minutos.',
    );
  }

  if (lastGeminiStatus === 400 || lastGeminiStatus === 401 || lastGeminiStatus === 403) {
    return failResult(
      502,
      'Chave da IA inválida. Verifique GEMINI_API_KEY/OPENROUTER_API_KEY no Vercel.',
    );
  }

  return failResult(
    503,
    'Todos os provedores de IA estão indisponíveis no momento. Tente em alguns minutos.',
  );
}
