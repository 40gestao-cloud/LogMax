import type { Logger } from './log.js';

// Camada unificada de chamada a LLMs com fallback automático em cascata:
//   1. Gemini (primário) com retry em 503/429.
//   2. Groq (tier 2) — LPU rápida, free tier alto (~14k req/dia).
//   3. OpenRouter (tier 3) — agrega ~50 provedores, free tier baixo.
//
// Ordem escolhida pela combinação custo/qualidade/velocidade:
//   - Gemini primeiro: quota free maior, qualidade alta, Google Search
//     grounding em ai-chat.
//   - Groq segundo: free tier ~14k req/dia (vs 50/dia/modelo no OR), e
//     LPU é ~3x mais rápido que GPU. Cai aqui quando Gemini está fora.
//   - OpenRouter por último: backup do backup, cobertura ampla mas
//     limites baixos.
//
// Os 3 provedores são OpenAI-compatíveis (Groq e OpenRouter expõem
// /chat/completions) ou são adaptados na hora (Gemini usa formato
// próprio em toGeminiContents).
//
// Os 4 endpoints de IA (ai-briefing, ai-bi, ai-chat, ai-legenda) usam
// esta camada. ai-chat passa `geminiTools` pra ativar Google Search no
// Gemini — se cair pra Groq/OpenRouter, perde grounding mas mantém
// resposta.

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

// Cadeia Groq (free tier). Tenta na ordem; se 429/erro, vai pro próximo.
// Override via GROQ_MODELS (CSV). Lista válida em console.groq.com.
const GROQ_DEFAULT_MODELS = [
  'llama-3.3-70b-versatile',   // 70B, qualidade alta, bom em PT-BR
  'llama-3.1-8b-instant',      // 8B, último recurso ultra-rápido
];

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
export type LLMProvider = 'gemini' | 'groq' | 'openrouter';

export type LLMResult = {
  ok: boolean;
  // Quando ok=true:
  text: string;
  provider: LLMProvider | null;
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
  provider: LLMProvider,
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

async function callGroqOnce(
  req: LLMRequest,
  model: string,
  apiKey: string,
): Promise<{ status: number; data: any }> {
  const body = {
    // Groq não suporta array `models` como OpenRouter — um modelo por chamada.
    model,
    messages: toOpenAIMessages(req),
    temperature: req.temperature     ?? 0.7,
    max_tokens:  req.maxOutputTokens ?? 4000,
    top_p:       req.topP            ?? 0.95,
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
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
  const groqKey       = process.env.GROQ_API_KEY?.trim();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const geminiModel   = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  const groqModelsEnv = (process.env.GROQ_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const groqModels = groqModelsEnv.length > 0 ? groqModelsEnv : GROQ_DEFAULT_MODELS;
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

  // ─── 2. Tier 2: Groq (LPU rápida, free tier alto) ────────────
  // Itera modelos sequencialmente. 429 num modelo = tenta o próximo
  // (cota Groq é por modelo). 4xx permanente = sai.
  if (groqKey) {
    let lastGroqStatus = 0;
    for (const model of groqModels) {
      try {
        const { status, data } = await callGroqOnce(req, model, groqKey);
        lastGroqStatus = status;

        if (status >= 200 && status < 300) {
          const text: string = data?.choices?.[0]?.message?.content ?? '';
          const finish = data?.choices?.[0]?.finish_reason;
          if (text.trim()) {
            log.info('groq.ok', { model, finish });
            return okResult(text, 'groq', model, finish);
          }
          log.warn('groq.empty', { model, finish });
          continue;
        }

        log.warn('groq.failed', {
          model, status, msg: data?.error?.message ?? data?.message,
        });
        // Auth/permissão: sai (vai pro OpenRouter).
        if (status === 401 || status === 403) break;
        // Rate-limit naquele modelo específico: tenta próximo.
        if (status === 429) continue;
        // 4xx genérico: provavelmente erro permanente (modelo deprecado etc.).
        if (status >= 400 && status < 500) continue;
        // 5xx: também tenta próximo modelo.
      } catch (err: any) {
        log.warn('groq.exception', { model, error: err?.message });
        // Erro de rede: tenta próximo.
        continue;
      }
    }
    log.warn('groq.exhausted', { lastGroqStatus });
  }

  // ─── 3. Tier 3: OpenRouter com cadeia de modelos ─────────────
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

  // ─── 4. Todos os provedores falharam ─────────────────────────
  const noKeys = !geminiKey && !groqKey && !openrouterKey;
  if (noKeys) {
    return failResult(500, 'Nenhum provedor de IA configurado no servidor.');
  }

  // Mensagem específica pro caso mais comum: Gemini sobrecarregado +
  // nenhum fallback configurado.
  if (!groqKey && !openrouterKey && (lastGeminiStatus === 503 || lastGeminiStatus === 429)) {
    return failResult(
      lastGeminiStatus,
      lastGeminiStatus === 503
        ? 'Modelo de IA está com alta demanda agora. Aguarde 1-2 minutos e tente de novo. (Configure GROQ_API_KEY ou OPENROUTER_API_KEY para fallback automático.)'
        : 'Limite de uso da IA atingido. Tente novamente em alguns minutos.',
    );
  }

  if (lastGeminiStatus === 400 || lastGeminiStatus === 401 || lastGeminiStatus === 403) {
    return failResult(
      502,
      'Chave da IA inválida. Verifique GEMINI_API_KEY/GROQ_API_KEY/OPENROUTER_API_KEY no Vercel.',
    );
  }

  return failResult(
    503,
    'Todos os provedores de IA estão indisponíveis no momento. Tente em alguns minutos.',
  );
}
