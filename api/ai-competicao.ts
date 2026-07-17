import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors, getAdminClient } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import { callLLM } from '../lib/llm.js';

// Endpoint da Fase 2: análise IA do placar da competição.
// Reaproveita calcular_placar_competicao e envia o JSON ranked pra
// LLM opinar sobre concordância/discordância com o resultado automático.
// Persiste em competicoes_matriz.analise_ia pra caching (não gera de
// novo se já tem análise).

const SYSTEM_PROMPT = `
Você atua como Diretor Executivo do LogMax revisando o resultado de
uma competição inter-filiais (SuperMax, MaxLook, TechMax). Recebe o
placar CALCULADO automaticamente por ranking 3-2-1 por dimensão
(Logística, Financeiro, RH, Vendas, Marketing) com pesos configurados
no criar. Sua tarefa é analisar friamente se esse resultado faz sentido.

Diretrizes:
- Português brasileiro, tom executivo (CEO/conselho), sem floreios.
- Use Markdown com H2 e listas curtas.
- SEMPRE cite os números do payload (pontos, valores) quando defender
  uma posição.
- Se concordar com o vencedor automático, explique EM QUE dimensões ele
  foi decisivo.
- Se discordar, explique com base em quais dimensões você acha que
  outra filial deveria vencer.
- Considere se algum resultado por dimensão parece distorcido (ex.:
  taxa=0 porque não há dados, empate técnico, peso desproporcional).
- Termine com "## Recomendação" em 1-2 frases: "concordo com X" ou
  "sugiro reavaliar em favor de Y".
`.trim();

const buildUserPrompt = (placar: any): string => {
  return `Placar consolidado da competição:

\`\`\`json
${JSON.stringify(placar, null, 2)}
\`\`\`

Analise conforme diretrizes.`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-competicao');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    // Mesma pool de eleitores: admin/CEO/conselheiro (puro ou gerente+is_conselheiro).
    const eleitor = ['admin','ceo','conselheiro'].includes(user.role) || !!user.is_conselheiro;
    if (!eleitor) {
      log.warn('access.denied', { user_id: user.id, role: user.role });
      return res.status(403).json({ error: 'Análise IA de competição restrita ao conselho.' });
    }

    const { competicao_id, forcar } = (req.body ?? {}) as { competicao_id?: string; forcar?: boolean };
    if (!competicao_id || !/^[0-9a-f-]{36}$/i.test(competicao_id)) {
      return res.status(400).json({ error: 'competicao_id inválido.' });
    }

    if (!process.env.GEMINI_API_KEY?.trim()
        && !process.env.GROQ_API_KEY?.trim()
        && !process.env.OPENROUTER_API_KEY?.trim()) {
      log.error('config.missing_key', new Error('Nenhuma chave de IA configurada'));
      return res.status(500).json({ error: 'IA não configurada no servidor.' });
    }

    const admin = getAdminClient(res);
    if (!admin) return;

    // Cache: se já tem análise e não veio forcar=true, devolve a existente.
    const { data: comp, error: compErr } = await admin
      .from('competicoes_matriz')
      .select('id, nome, status, analise_ia')
      .eq('id', competicao_id)
      .eq('ativo', true)
      .single();
    if (compErr || !comp) {
      return res.status(404).json({ error: 'Competição não encontrada.' });
    }

    if (comp.analise_ia && !forcar) {
      return res.status(200).json({ analise: comp.analise_ia, from_cache: true });
    }

    // Placar via RPC — mesma lógica que a view usa.
    const { data: placar, error: placarErr } = await admin.rpc('calcular_placar_competicao', {
      p_competicao_id: competicao_id,
    });
    if (placarErr) {
      log.error('rpc.failed', placarErr);
      return res.status(500).json({ error: `Erro ao calcular placar: ${placarErr.message}` });
    }

    const llm = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:   buildUserPrompt(placar),
      temperature:     0.4,
      maxOutputTokens: 2048,
      topP:            0.9,
    }, log);

    if (!llm.ok) {
      return res.status(llm.httpStatus).json({ error: llm.friendlyMessage, finish: llm.finishReason });
    }

    const analise = llm.text;

    // Persiste no registro da competição — best-effort.
    const { error: updErr } = await admin
      .from('competicoes_matriz')
      .update({ analise_ia: analise, updated_at: new Date().toISOString() })
      .eq('id', competicao_id);
    if (updErr) {
      log.warn('persist.failed', { competicao_id, error_message: updErr.message });
    }

    log.info('llm.ok', { user_id: user.id, provider: llm.provider, model: llm.modelUsed, chars_out: analise.length });

    return res.status(200).json({
      analise,
      modelo:     `${llm.provider}:${llm.modelUsed}`,
      from_cache: false,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
