import type { Logger } from './log.js';

// Camada unificada de chamada a LLMs com fallback automático em cascata:
//   1. Gemini (primário) com retry em 503/429. Google Search grounding.
//   2. Cerebras (tier 2) — Wafer-scale, LLaMA 3.3 70B em <1s.
//   3. Mistral (tier 3) — bom PT-BR nativo, JSON mode confiável.
//   4. Groq (tier 4) — LPU rápida, free tier alto (~14k req/dia).
//   5. OpenRouter (tier 5) — agrega ~50 provedores, free tier baixo.
//
// Ordem escolhida pela combinação custo/qualidade/velocidade:
//   - Gemini primeiro: quota free maior, qualidade alta, grounding.
//   - Cerebras segundo: velocidade absurda (<1s), rate limit generoso.
//   - Mistral terceiro: qualidade em PT-BR, JSON mode robusto.
//   - Groq quarto: free tier alto, LPU rapida — recurso quando os 3 acima
//     furam.
//   - OpenRouter ultimo: backup do backup, cobertura ampla mas limites
//     baixos por modelo.
//
// Todos sao OpenAI-compativel (Cerebras/Mistral/Groq/OpenRouter expoem
// /chat/completions) exceto Gemini, adaptado em toGeminiContents.
//
// Os 4 endpoints de IA (ai-briefing, ai-bi, ai-chat, ai-legenda) usam
// esta camada. ai-chat passa `geminiTools` pra ativar Google Search no
// Gemini — se cair pra Groq/OpenRouter, perde grounding mas mantém
// resposta.

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

// Cadeia Cerebras (free tier). Wafer-scale = <1s pra 70B.
// Override via CEREBRAS_MODELS (CSV). Catalogo em inference.cerebras.ai.
const CEREBRAS_DEFAULT_MODELS = [
  'llama-3.3-70b',     // 70B, qualidade alta, ~1000 tok/s
  'llama3.1-8b',       // 8B, ultimo recurso ultra-rapido
];

// Cadeia Mistral (free tier). Bom PT-BR nativo.
// Override via MISTRAL_MODELS (CSV). Catalogo em docs.mistral.ai/getting-started/models.
const MISTRAL_DEFAULT_MODELS = [
  'mistral-small-latest',   // 22B, free tier, ótimo em PT-BR
  'open-mistral-nemo',      // 12B, backup mais leve
];

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
  // Gemini 2.5+ é "thinking" por padrão e os tokens de raciocínio consomem
  // o mesmo budget de maxOutputTokens. Em saídas estruturadas/curtas (JSON)
  // isso pode queimar o budget inteiro e devolver texto vazio com
  // finishReason=MAX_TOKENS. Passe 0 pra desativar o thinking nesses casos.
  // Só afeta o provedor Gemini; Groq/OpenRouter ignoram.
  geminiThinkingBudget?: number;
};

// Tipo único achatado (em vez de union discriminada) — o tsconfig do
// projeto não roda em strict mode, e isso quebra narrowing automático
// com `if (!llm.ok)`. Campos opcionais ficam undefined no caminho que
// não os usa.
export type LLMProvider = 'gemini' | 'cerebras' | 'mistral' | 'groq' | 'openrouter';

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
      ...(req.geminiThinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: req.geminiThinkingBudget } }
        : {}),
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

// Chamada OpenAI-compat generica. Cerebras/Mistral/Groq compartilham corpo
// identico — muda so o endpoint e (opcionalmente) headers extras.
async function callOpenAICompatOnce(
  req: LLMRequest,
  model: string,
  apiKey: string,
  endpoint: string,
): Promise<{ status: number; data: any }> {
  const body = {
    model,
    messages: toOpenAIMessages(req),
    temperature: req.temperature     ?? 0.7,
    max_tokens:  req.maxOutputTokens ?? 4000,
    top_p:       req.topP            ?? 0.95,
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const resp = await fetch(endpoint, {
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

const callCerebrasOnce = (req: LLMRequest, model: string, apiKey: string) =>
  callOpenAICompatOnce(req, model, apiKey, 'https://api.cerebras.ai/v1/chat/completions');

const callMistralOnce = (req: LLMRequest, model: string, apiKey: string) =>
  callOpenAICompatOnce(req, model, apiKey, 'https://api.mistral.ai/v1/chat/completions');

const callGroqOnce = (req: LLMRequest, model: string, apiKey: string) =>
  callOpenAICompatOnce(req, model, apiKey, 'https://api.groq.com/openai/v1/chat/completions');

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
// Orquestração: Gemini → Cerebras → Mistral → Groq → OpenRouter
// ─────────────────────────────────────────────

// Parse env var CSV, fallback pro default se vazio.
function envList(name: string, fallback: string[]): string[] {
  const parsed = (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

type GeminiOutcome =
  | { kind: 'ok'; result: LLMResult }
  | { kind: 'stash'; result: LLMResult }        // MAX_TOKENS em jsonMode: guarda pra ultimo recurso
  | { kind: 'skip'; lastStatus: number }         // vai pro fallback
  | { kind: 'fail'; result: LLMResult };         // SAFETY/RECITATION — nao adianta tentar outros

// Uma tentativa Gemini + parse. Sem retry loop — o caller decide.
async function attemptGemini(req: LLMRequest, model: string, apiKey: string, log: Logger): Promise<GeminiOutcome | { kind: 'retry'; status: number }> {
  try {
    const { status, data } = await callGeminiOnce(req, model, apiKey);
    if (status >= 200 && status < 300) {
      const text: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
      const finish = data?.candidates?.[0]?.finishReason;

      if (!text.trim() && (finish === 'SAFETY' || finish === 'RECITATION')) {
        return { kind: 'fail', result: failResult(
          502,
          finish === 'SAFETY'
            ? 'A IA recusou gerar a resposta (filtro de segurança).'
            : 'A IA detectou conteúdo protegido. Reformule e tente novamente.',
          finish,
        )};
      }
      if (!text.trim()) {
        log.warn('gemini.empty_no_finish', { finish, model });
        return { kind: 'skip', lastStatus: status };
      }
      if (finish === 'MAX_TOKENS' && req.jsonMode) {
        log.warn('gemini.truncated_json', { model });
        return { kind: 'stash', result: okResult(text, 'gemini', model, finish, data) };
      }
      return { kind: 'ok', result: okResult(text, 'gemini', model, finish, data) };
    }
    // Nao-2xx: caller decide retry vs skip.
    return { kind: 'retry', status };
  } catch (err: any) {
    log.warn('gemini.exception', { error: err?.message });
    return { kind: 'skip', lastStatus: 0 };
  }
}

// Loop de retry do Gemini (503/429 com backoff). Retorna resultado final ou
// stashed pra fallback.
async function runGemini(req: LLMRequest, model: string, apiKey: string, log: Logger): Promise<{ outcome: GeminiOutcome; lastStatus: number; lastMsg?: string }> {
  let lastStatus = 0;
  let lastMsg: string | undefined;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    const r = await attemptGemini(req, model, apiKey, log);
    if (r.kind !== 'retry') {
      if (r.kind === 'skip') lastStatus = r.lastStatus;
      return { outcome: r as GeminiOutcome, lastStatus, lastMsg };
    }
    lastStatus = r.status;
    const isAuth = r.status === 400 || r.status === 401 || r.status === 403;
    const isOverload = r.status === 503 || r.status === 429;
    if (isAuth) {
      log.warn('gemini.auth_error', { status: r.status });
      return { outcome: { kind: 'skip', lastStatus: r.status }, lastStatus, lastMsg };
    }
    if (isOverload && i < RETRY_DELAYS_MS.length) {
      log.warn('gemini.retry', { status: r.status, attempt: i + 1 });
      await new Promise(res => setTimeout(res, RETRY_DELAYS_MS[i]));
      continue;
    }
    log.warn('gemini.failed', { status: r.status });
    return { outcome: { kind: 'skip', lastStatus: r.status }, lastStatus, lastMsg };
  }
  return { outcome: { kind: 'skip', lastStatus }, lastStatus, lastMsg };
}

// Runner OpenAI-compat generico. Itera modelos: 2xx com texto → ok; 401/403
// aborta (chave invalida); resto tenta proximo modelo.
async function runOpenAICompat(
  provider: LLMProvider,
  callOnce: (req: LLMRequest, model: string, apiKey: string) => Promise<{ status: number; data: any }>,
  req: LLMRequest,
  models: string[],
  apiKey: string,
  log: Logger,
): Promise<LLMResult | null> {
  let lastStatus = 0;
  for (const model of models) {
    try {
      const { status, data } = await callOnce(req, model, apiKey);
      lastStatus = status;
      if (status >= 200 && status < 300) {
        const text: string = data?.choices?.[0]?.message?.content ?? '';
        const finish = data?.choices?.[0]?.finish_reason;
        if (text.trim()) {
          log.info(`${provider}.ok`, { model, finish });
          return okResult(text, provider, model, finish);
        }
        log.warn(`${provider}.empty`, { model, finish });
        continue;
      }
      log.warn(`${provider}.failed`, { model, status, msg: data?.error?.message ?? data?.message });
      if (status === 401 || status === 403) break;
    } catch (err: any) {
      log.warn(`${provider}.exception`, { model, error: err?.message });
    }
  }
  log.warn(`${provider}.exhausted`, { lastStatus });
  return null;
}

const runCerebras = (req: LLMRequest, models: string[], apiKey: string, log: Logger) =>
  runOpenAICompat('cerebras', callCerebrasOnce, req, models, apiKey, log);

const runMistral = (req: LLMRequest, models: string[], apiKey: string, log: Logger) =>
  runOpenAICompat('mistral', callMistralOnce, req, models, apiKey, log);

const runGroq = (req: LLMRequest, models: string[], apiKey: string, log: Logger) =>
  runOpenAICompat('groq', callGroqOnce, req, models, apiKey, log);

// OpenRouter: uma unica chamada com array de models (failover interno).
async function runOpenRouter(req: LLMRequest, models: string[], apiKey: string, log: Logger): Promise<LLMResult | null> {
  try {
    const { status, data } = await callOpenRouterOnce(req, models, apiKey);
    if (status >= 200 && status < 300) {
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      const finish = data?.choices?.[0]?.finish_reason;
      const modelUsed = data?.model ?? models[0] ?? 'openrouter';
      if (text.trim()) {
        log.info('openrouter.ok', { modelUsed, finish });
        return okResult(text, 'openrouter', modelUsed, finish);
      }
      log.warn('openrouter.empty', { finish, modelUsed });
      return null;
    }
    log.warn('openrouter.failed', { status, msg: data?.error?.message ?? data?.message });
    return null;
  } catch (err: any) {
    log.error('openrouter.exception', err);
    return null;
  }
}

// Constroi a mensagem de falha final quando nenhum provedor entregou.
function buildFinalFailure(
  hasAnyKey: boolean,
  onlyGeminiKey: boolean,
  lastGeminiStatus: number,
): LLMResult {
  if (!hasAnyKey) return failResult(500, 'Nenhum provedor de IA configurado no servidor.');
  if (onlyGeminiKey && (lastGeminiStatus === 503 || lastGeminiStatus === 429)) {
    return failResult(
      lastGeminiStatus,
      lastGeminiStatus === 503
        ? 'Modelo de IA está com alta demanda agora. Aguarde 1-2 minutos e tente de novo. (Configure CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY para fallback automático.)'
        : 'Limite de uso da IA atingido. Tente novamente em alguns minutos.',
    );
  }
  if (lastGeminiStatus === 400 || lastGeminiStatus === 401 || lastGeminiStatus === 403) {
    return failResult(502, 'Chave da IA inválida. Verifique GEMINI_API_KEY/CEREBRAS_API_KEY/MISTRAL_API_KEY/GROQ_API_KEY/OPENROUTER_API_KEY no Vercel.');
  }
  return failResult(503, 'Todos os provedores de IA estão indisponíveis no momento. Tente em alguns minutos.');
}

export async function callLLM(req: LLMRequest, log: Logger): Promise<LLMResult> {
  const geminiKey     = process.env.GEMINI_API_KEY?.trim();
  const cerebrasKey   = process.env.CEREBRAS_API_KEY?.trim();
  const mistralKey    = process.env.MISTRAL_API_KEY?.trim();
  const groqKey       = process.env.GROQ_API_KEY?.trim();
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const geminiModel   = (process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL).trim();
  const cerebrasModels = envList('CEREBRAS_MODELS', CEREBRAS_DEFAULT_MODELS);
  const mistralModels  = envList('MISTRAL_MODELS',  MISTRAL_DEFAULT_MODELS);
  const groqModels     = envList('GROQ_MODELS',     GROQ_DEFAULT_MODELS);
  const orModels       = envList('OPENROUTER_MODELS', OPENROUTER_DEFAULT_MODELS);

  // Resposta parcial do Gemini truncada por MAX_TOKENS em modo JSON: usada
  // como ultimo recurso se todos os fallbacks falharem (endpoint tenta
  // parsear parcial via extractJsonBlock).
  let stashedGemini: LLMResult | null = null;
  let lastGeminiStatus = 0;

  if (geminiKey) {
    const { outcome, lastStatus } = await runGemini(req, geminiModel, geminiKey, log);
    lastGeminiStatus = lastStatus;
    if (outcome.kind === 'ok' || outcome.kind === 'fail') return outcome.result;
    if (outcome.kind === 'stash') stashedGemini = outcome.result;
  }

  if (cerebrasKey) {
    const r = await runCerebras(req, cerebrasModels, cerebrasKey, log);
    if (r) return r;
  }

  if (mistralKey) {
    const r = await runMistral(req, mistralModels, mistralKey, log);
    if (r) return r;
  }

  if (groqKey) {
    const r = await runGroq(req, groqModels, groqKey, log);
    if (r) return r;
  }

  if (openrouterKey) {
    const r = await runOpenRouter(req, orModels, openrouterKey, log);
    if (r) return r;
  }

  if (stashedGemini) {
    log.warn('llm.fallback_to_truncated_gemini', { model: geminiModel });
    return stashedGemini;
  }

  const hasAnyKey = Boolean(geminiKey || cerebrasKey || mistralKey || groqKey || openrouterKey);
  const onlyGemini = Boolean(geminiKey && !cerebrasKey && !mistralKey && !groqKey && !openrouterKey);
  return buildFinalFailure(hasAnyKey, onlyGemini, lastGeminiStatus);
}
