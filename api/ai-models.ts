import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

/**
 * Diagnóstico: lista modelos Gemini que a chave configurada consegue usar
 * para generateContent. Útil quando /api/ai-chat retorna 404/limit:0 e
 * é preciso saber quais nomes válidos passar via GEMINI_MODEL.
 *
 * GET /api/ai-models  (Bearer Supabase obrigatório)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-models');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ausente.' });

    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
    });
    const data = await upstream.json() as any;

    if (!upstream.ok) {
      log.warn('list.failed', {
        user_id: user.id,
        status: upstream.status,
        error: data?.error?.message,
      });
      return res.status(upstream.status).json({ error: data?.error?.message ?? 'Erro ao listar modelos.' });
    }

    const models = (data?.models ?? [])
      .filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m: any) => ({
        name: (m.name as string).replace(/^models\//, ''),
        displayName: m.displayName,
        inputTokenLimit:  m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
      }));

    return res.status(200).json({
      current: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
      models,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
