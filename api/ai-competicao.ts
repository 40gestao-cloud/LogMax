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
uma competição inter-filiais (SuperMax, MaxLook, TechMax). Escala
interna é 0-100, mas trate como nota 0-10 na análise (divida por 10).
Sua tarefa é analisar friamente se esse resultado faz sentido.

Como o campo "media" de cada filial é composto (migr. 349/350):
- 80% de "media_conselho" — média das notas 0-10 que o conselho
  (CEO + conselheiros) deu aos participantes das Tarefas da Matriz,
  agrupada pela filial de cada participante, × 10.
- 20% de "frequencia.taxa" (0 a 1) × 100 — frequência MEDIDA no ponto
  eletrônico do período, não votada: presença pontual vale o dia,
  presença com atraso vale meio, falta zera, e dia justificado fica
  fora do denominador.
- "frequencia.entrou" = false significa que a filial não tem ponto
  lançado no período: a parcela não entra e "media" repete
  "media_conselho". Diga isso quando for o caso, em vez de tratar
  como desempenho.
- "atraso_conta" = false no topo significa que o horário da turma
  ainda não foi confirmado e nenhum atraso está descontando.

Diretrizes:
- Português brasileiro, tom executivo (CEO/conselho), sem floreios.
- Use Markdown com H2 e listas curtas.
- SEMPRE cite os números do payload (médias, quantidade de notas) quando
  defender uma posição.
- Considere se alguma filial tem MUITO POUCAS notas — média baseada em
  poucas amostras é frágil.
- Separe o que é julgamento do conselho do que é frequência medida: se
  uma filial vence pela frequência com média do conselho pior (ou o
  contrário), diga isso explicitamente.
- Se concordar com o vencedor automático, explique se a vantagem foi
  robusta ou apertada.
- Se discordar, aponte a filial que você acha que deveria vencer e o
  motivo (ex.: outra tem mais notas mas média próxima).
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
