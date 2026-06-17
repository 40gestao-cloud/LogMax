import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors, getAdminClient } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import { callLLM } from '../lib/llm.js';

// Endpoint dedicado pro Painel BI. Diferente de /api/ai-chat (chat
// multi-turno com Google Search) e /api/ai-legenda (copy curto):
// recebe uma agregação JSON já calculada via RPC e devolve um relatório
// executivo em Markdown.
//
// Cache: se o mesmo usuário pediu o mesmo período < 1h atrás, devolve
// o relatório existente sem chamar Gemini de novo (economia + rapidez).

const SYSTEM_PROMPT = `
Você atua como Diretor de Operações e BI do LogMax (holding com 3 marcas:
TechMax, SuperMax e MaxLook). Recebe uma agregação de dados consolidados
do período pedido (vendas, financeiro, RH, estoque, marketing) e tem que
devolver um relatório executivo objetivo, frio e acionável.

Diretrizes:
- Português brasileiro, tom executivo (CEO/diretoria), sem floreios.
- Use Markdown estruturado com títulos H2 (##) por seção e H3 (###)
  pra sub-tópicos quando precisar. Listas numeradas pra ações.
- Sempre cite NÚMEROS reais do payload (R$ X, Y%, Z dias). Não invente.
- Mencione variação vs. período anterior quando o payload trouxer
  (chave 'variacao_*_pct').
- Quando uma métrica não existir ou for zero, fale explicitamente
  ("Não houve vendas registradas no período") em vez de omitir.
- Identifique gargalos: relação faltas no RH × vendas no PDV, dívidas a
  pagar × receitas a receber, estoque parado × vendas concentradas em
  poucos itens, gasto de marketing × retorno em vendas.
- Termine com seção "## Ações imediatas" listando EXATAMENTE 3
  recomendações práticas e mensuráveis. Cada uma com responsável
  sugerido (Setor) e prazo (em dias).

Estrutura sugerida (não rígida):
  # Relatório Executivo — período DD/MM a DD/MM
  ## Resumo do período
  ## Vendas e faturamento por marca
  ## Saúde financeira
  ## Recursos humanos
  ## Estoque e produtos
  ## Marketing e campanhas
  ## Ações imediatas
`.trim();

const buildUserPrompt = (dados: any, inicio: string, fim: string): string => {
  return `Período: ${inicio} a ${fim}

DADOS CONSOLIDADOS (JSON):
\`\`\`json
${JSON.stringify(dados, null, 2)}
\`\`\`

Gere o relatório executivo em Markdown conforme as diretrizes do system prompt.`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-bi');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    // Painel BI restrito a Admin, CEO e Gerentes (qualquer setor).
    // RPC `gerar_painel_bi` também valida server-side.
    if (!['admin', 'ceo', 'gerente'].includes(user.role)) {
      log.warn('access.denied', { user_id: user.id, role: user.role });
      return res.status(403).json({ error: 'Painel BI disponível apenas para Admin, CEO e Gerentes.' });
    }

    const { inicio, fim } = (req.body ?? {}) as { inicio?: string; fim?: string };
    if (!inicio || !fim || !/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      return res.status(400).json({ error: 'Informe inicio e fim no formato YYYY-MM-DD.' });
    }
    if (fim < inicio) {
      return res.status(400).json({ error: 'Data fim não pode ser anterior à data início.' });
    }

    // callLLM() faz orquestração Gemini → OpenRouter; precisa de pelo
    // menos uma chave.
    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim() && !process.env.OPENROUTER_API_KEY?.trim()) {
      log.error('config.missing_key', new Error('Nenhuma chave de IA configurada'));
      return res.status(500).json({ error: 'IA não configurada no servidor.' });
    }

    const admin = getAdminClient(res);
    if (!admin) return;

    // ─── Cache: relatório do mesmo usuário, mesmo período, < 1h ────
    // Evita 2 cliques seguidos pagarem Gemini duas vezes. 1h é a janela
    // que faz sentido pra "atualizar a análise" sem ser muito agressivo.
    const { data: cacheHit, error: cacheErr } = await admin
      .from('relatorios_bi')
      .select('id, dados_json, markdown, created_at, modelo_ia, nome_gerador')
      .eq('gerado_por', user.id)
      .eq('periodo_inicio', inicio)
      .eq('periodo_fim', fim)
      .eq('ativo', true)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (!cacheErr && cacheHit && cacheHit.length > 0) {
      const hit = cacheHit[0];
      log.info('cache.hit', { user_id: user.id, relatorio_id: hit.id });
      return res.status(200).json({
        id:           hit.id,
        markdown:     hit.markdown,
        dados:        hit.dados_json,
        gerado_em:    hit.created_at,
        modelo:       hit.modelo_ia,
        from_cache:   true,
      });
    }

    // ─── Agregação local via RPC ────────────────────────────────────
    const { data: dados, error: rpcErr } = await admin.rpc('gerar_painel_bi', {
      p_inicio: inicio,
      p_fim:    fim,
    });
    if (rpcErr) {
      log.error('rpc.failed', rpcErr);
      return res.status(500).json({ error: `Erro ao agregar dados: ${rpcErr.message}` });
    }

    // ─── LLM com fallback Gemini → OpenRouter ───────────────────────
    const llm = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:   buildUserPrompt(dados, inicio, fim),
      // Temperatura baixa pra ser frio/factual. Tokens generosos
      // (relatório executivo pode chegar a 8-10k chars).
      temperature:     0.4,
      maxOutputTokens: 4096,
      topP:            0.9,
    }, log);

    if (!llm.ok) {
      return res.status(llm.httpStatus).json({ error: llm.friendlyMessage, finish: llm.finishReason });
    }
    const markdown = llm.text;

    // ─── Persiste no histórico ─────────────────────────────────────
    const { data: salvo, error: insErr } = await admin
      .from('relatorios_bi')
      .insert({
        periodo_inicio: inicio,
        periodo_fim:    fim,
        dados_json:     dados,
        markdown,
        gerado_por:     user.id,
        nome_gerador:   user.email?.split('@')[0] ?? null,
        modelo_ia:      `${llm.provider}:${llm.modelUsed}`,
      })
      .select('id, created_at')
      .single();

    if (insErr) {
      // Inserir é best-effort — se falhar, ainda devolvemos o relatório
      // pro usuário. Loga o erro pra debug.
      log.warn('persist.failed', { user_id: user.id, error_message: insErr.message });
    }

    log.info('llm.ok', {
      user_id: user.id,
      provider: llm.provider,
      model: llm.modelUsed,
      chars_out: markdown.length,
      relatorio_id: salvo?.id,
    });

    return res.status(200).json({
      id:        salvo?.id,
      markdown,
      dados,
      gerado_em: salvo?.created_at ?? new Date().toISOString(),
      modelo:    `${llm.provider}:${llm.modelUsed}`,
      from_cache: false,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
