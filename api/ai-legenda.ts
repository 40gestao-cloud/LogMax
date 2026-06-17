import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import { callLLM } from '../lib/llm.js';

// Endpoint dedicado pra geração de copy/legenda de promoções via Gemini.
// Separado de /api/ai-chat porque:
//   • RBAC distinto — chat é admin/CEO/financeiro; legenda é marketing.
//   • Prompt é estruturado e JSON-only — sem tools, sem grounding, sem
//     conversa multi-turno. Mais simples e mais barato.
//   • Saída padronizada (3 variações) facilita a UI consumir sem parser.

interface LegendaPayload {
  produto?: string;
  tipo?: 'produto' | 'servico';
  preco_atual?: number;
  preco_promocional?: number;
  preco_custo?: number;
  data_inicio?: string;
  data_fim?: string;
  descricao?: string;
  canal?: string; // 'Instagram Feed' | 'Status' | 'WhatsApp' | 'Facebook' | ...
}

const SYSTEM_PROMPT = `
Você é o copywriter do Marketing do LogMax, um ERP educacional usado por
alunos de administração. Sua missão: gerar legendas curtas e diretas pra
divulgar promoções da empresa em redes sociais.

Diretrizes:
- Português brasileiro coloquial mas profissional. Sem gírias datadas.
- Tom: animado mas honesto. Sem clickbait, sem promessas vazias, sem ALL CAPS.
- Cada legenda tem até 280 caracteres (limite do post curto).
- Use no máximo 3 emojis por legenda — só onde reforçam a mensagem.
- Hashtags são opcionais, máximo 3 e relevantes (ex.: #promo #ofertadasemana).
- Destaque o desconto em % quando significativo (≥10%). Use cálculo direto: ((preço_atual - preço_promocional) / preço_atual) × 100.
- Se vier período, mencione o prazo de forma natural ("até dia X" ou "só essa semana").
- Se vier canal, ajuste o tom: Instagram Feed é mais visual, Status é direto, WhatsApp é conversacional.

Saída: APENAS um JSON válido no formato exato:
{
  "legendas": [
    { "tom": "direto",      "texto": "..." },
    { "tom": "emocional",   "texto": "..." },
    { "tom": "informativo", "texto": "..." }
  ]
}
Nada antes nem depois do JSON. Não envolva em markdown.
`.trim();

const formatBRL = (n: number) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const buildUserPrompt = (p: LegendaPayload): string => {
  const lines: string[] = [];
  lines.push(`Item: ${p.produto ?? '—'}${p.tipo === 'servico' ? ' (serviço)' : ''}`);
  if (p.preco_atual)        lines.push(`Preço normal: ${formatBRL(p.preco_atual)}`);
  if (p.preco_promocional)  lines.push(`Preço promocional: ${formatBRL(p.preco_promocional)}`);
  if (p.preco_atual && p.preco_promocional && p.preco_atual > p.preco_promocional) {
    const pct = ((p.preco_atual - p.preco_promocional) / p.preco_atual) * 100;
    lines.push(`Desconto: ${pct.toFixed(0)}%`);
  }
  if (p.data_inicio || p.data_fim) {
    lines.push(`Período: ${p.data_inicio ?? '—'} a ${p.data_fim ?? '—'}`);
  }
  if (p.descricao) lines.push(`Briefing extra: ${p.descricao}`);
  if (p.canal)     lines.push(`Canal: ${p.canal}`);
  lines.push('');
  lines.push('Gere 3 legendas (direto, emocional, informativo) no formato JSON especificado.');
  return lines.join('\n');
};

// Gemini às vezes envolve o JSON em ```json ... ```, adiciona "Aqui está"
// antes, ou devolve array direto `[...]` em vez de `{ legendas: [...] }`.
// Tentamos parse direto primeiro; se falhar, extraímos o maior bloco que
// pareça JSON válido (array OU objeto). Devolve null se não rolar.
const extractJsonBlock = (raw: string): any | null => {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try { return JSON.parse(trimmed); } catch { /* fallback abaixo */ }

  // Junta candidatos (array e/ou objeto) e tenta cada um. Escolhe o que
  // começa primeiro no texto pra preservar a intenção do modelo.
  const candidates: { start: number; text: string }[] = [];
  const arrStart = trimmed.indexOf('[');
  const arrEnd   = trimmed.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    candidates.push({ start: arrStart, text: trimmed.slice(arrStart, arrEnd + 1) });
  }
  const objStart = trimmed.indexOf('{');
  const objEnd   = trimmed.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    candidates.push({ start: objStart, text: trimmed.slice(objStart, objEnd + 1) });
  }
  candidates.sort((a, b) => a.start - b.start);

  for (const c of candidates) {
    try { return JSON.parse(c.text); } catch { /* tenta próximo */ }
  }
  return null;
};

// Normaliza o parsed pra sempre ter shape [{ tom, texto }, ...].
// Aceita: array direto, { legendas }, { results }, { data }, ou
// primeiro array que encontrar nas propriedades.
const extractLegendas = (parsed: any): any[] => {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.legendas)) return parsed.legendas;
    if (Array.isArray(parsed.results))  return parsed.results;
    if (Array.isArray(parsed.data))     return parsed.data;
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-legenda');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    // Geração de copy é privilégio de Marketing + admin/CEO. Endpoint
    // separado do /api/ai-chat (que exige financeiro) justamente porque
    // são públicos-alvo diferentes.
    const canUse =
      user.role === 'admin' || user.role === 'ceo' || user.setor === 'marketing';
    if (!canUse) {
      log.warn('access.denied', { user_id: user.id, role: user.role, setor: user.setor });
      return res.status(403).json({ error: 'Geração de legenda disponível apenas para Marketing, Admin e CEO.' });
    }

    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.OPENROUTER_API_KEY?.trim()) {
      log.error('config.missing_key', new Error('GEMINI_API_KEY e OPENROUTER_API_KEY ausentes'));
      return res.status(500).json({ error: 'IA não configurada no servidor.' });
    }

    const payload = (req.body ?? {}) as LegendaPayload;
    if (!payload.produto || typeof payload.produto !== 'string' || !payload.produto.trim()) {
      return res.status(400).json({ error: 'Informe o produto/serviço da promoção.' });
    }

    // ─── LLM com fallback Gemini → OpenRouter ───────────────────────
    const llm = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:   buildUserPrompt(payload),
      // Temperatura média (varia legendas sem inventar produto) + budget
      // generoso de tokens (3 legendas + envelope JSON cabem em ~1k tokens,
      // mas margem evita truncamento que quebra JSON).
      temperature:     0.85,
      maxOutputTokens: 1500,
      topP:            0.95,
      jsonMode:        true,
    }, log);

    if (!llm.ok) {
      return res.status(llm.httpStatus).json({ error: llm.friendlyMessage, finish: llm.finishReason });
    }
    const rawText = llm.text;

    const parsed = extractJsonBlock(rawText);
    const legendasRaw = extractLegendas(parsed);

    if (legendasRaw.length === 0) {
      // Diagnóstico completo no log do Vercel + amostra do cru no payload
      // pra que o usuário tenha pista do que aconteceu (truncado? bloqueado?).
      log.warn('llm.parse_failed', {
        user_id:    user.id,
        provider:   llm.provider,
        model:      llm.modelUsed,
        finish:     llm.finishReason,
        raw_len:    rawText.length,
        raw_sample: rawText.slice(0, 400),
      });
      let mensagem = 'IA devolveu formato inesperado. Tente novamente.';
      if (llm.finishReason === 'MAX_TOKENS' || llm.finishReason === 'length') {
        mensagem = 'A IA estourou o limite de tamanho. Tente novamente — pode acontecer em produtos com nome muito longo.';
      } else if (llm.finishReason === 'RECITATION') {
        mensagem = 'A IA detectou conteúdo protegido. Tente novamente.';
      }
      return res.status(502).json({ error: mensagem, finish: llm.finishReason });
    }

    // Normaliza: garante shape { tom, texto }. Aceita variações de nome
    // (caption/text/legenda) que Gemini às vezes prefere sem schema.
    const legendas = legendasRaw
      .map((l: any) => {
        const tom = typeof l?.tom === 'string'   ? l.tom
                  : typeof l?.tone === 'string'  ? l.tone
                  : typeof l?.estilo === 'string' ? l.estilo
                  : 'sugestão';
        const texto = typeof l?.texto === 'string'   ? l.texto
                    : typeof l?.text === 'string'    ? l.text
                    : typeof l?.caption === 'string' ? l.caption
                    : typeof l?.legenda === 'string' ? l.legenda
                    : typeof l === 'string'          ? l
                    : '';
        return { tom: String(tom).trim(), texto: String(texto).trim() };
      })
      .filter((l: any) => l.texto.length > 0)
      .slice(0, 3);

    if (legendas.length === 0) {
      log.warn('gemini.empty_after_normalize', {
        user_id: user.id,
        raw_sample: rawText.slice(0, 200),
      });
      return res.status(502).json({ error: 'IA devolveu legendas vazias. Tente novamente.' });
    }

    log.info('llm.ok', {
      user_id: user.id,
      provider: llm.provider,
      model: llm.modelUsed,
      legendas_count: legendas.length,
      chars_out: rawText.length,
    });
    return res.status(200).json({ legendas });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
