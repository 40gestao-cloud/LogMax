import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors, getAdminClient } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';

// Endpoint: Briefing Diário. Recebe `data` (default = hoje no Acre) e
// devolve um briefing com N tarefas propostas por setor baseadas no
// estado real do ERP.
//
// Reaproveita `gerar_painel_bi` pra ter o snapshot agregado. Pede pro
// Gemini transformar esse snapshot em pauta operacional acionável.
//
// Cache forte: 1 briefing ATIVO por data. Se já existe em rascunho_ia
// ou aprovado_*, devolve o existente (admin pode descartar pra gerar
// outro).

const DEFAULT_MODEL = 'gemini-2.5-flash';

const SETORES = ['empresa', 'compras', 'estoque', 'financeiro', 'rh', 'vendas', 'marketing'] as const;
const JANELAS_VALIDAS = [7, 15, 30] as const;
type Janela = typeof JANELAS_VALIDAS[number];

const SYSTEM_PROMPT = `
Você é o Diretor de Operações do LogMax preparando a pauta diária dos
setores. Recebe um snapshot do estado real do ERP (vendas, financeiro,
RH, estoque, marketing) e tem que devolver uma lista de tarefas
operacionais concretas pra cada setor.

Setores que recebem pauta:
- empresa     (questões macro: filiais, parâmetros, governança)
- compras     (cotações, pedidos, recebimento, fornecedores)
- estoque     (movimentações, inventário, vencimentos, requisições)
- financeiro  (contas, fluxo de caixa, aprovações de orçamento/cotação/promoção)
- rh          (folha, ponto, treinamentos, avaliações, afastamentos)
- vendas      (PDV, clientes, orçamentos, pedidos de venda)
- marketing   (campanhas, promoções, cupons, calendário editorial, posts por canal)

Diretrizes:
- Cada tarefa DEVE ter base em algum dado do JSON. Não invente.
- Cite NÚMEROS no contexto_origem ("3 produtos com estoque < 5", "R$ 2.450
  vencendo em 3 dias", "5 colaboradores sem avaliação no ciclo aberto").
- Títulos curtos e acionáveis ("Cotar reposição de itens críticos no
  TechMax"), descrições explicando o que fazer e por quê.
- Distribua: 2-4 tarefas por setor. Não force pauta vazia — se um setor
  está com tudo OK, devolve só 1-2 tarefas mais leves (manutenção,
  documentação, revisão).
- Pra marketing especificamente, foque em: campanhas vencendo, promoções
  sem arte aprovada, calendário com gaps na semana, posts atrasados de
  status "Agendado", cupons expirados. Marketing não recebe tarefa de
  estoque/financeiro — só de comunicação/conteúdo.
- Prioridade reflete urgência: Alta (algo vencendo/quebrando),
  Média (atenção da semana), Baixa (manutenção/follow-up).
- Prazos curtos: maioria em 1-3 dias, no máximo 7 dias.

Saída: APENAS um JSON válido no formato:
{
  "tarefas": [
    {
      "modulo": "compras",
      "titulo": "Cotar reposição de itens críticos no TechMax",
      "descricao": "3 produtos zerados ou abaixo do estoque mínimo. Abrir cotação com fornecedor habitual.",
      "prioridade": "Alta",
      "prazo_dias": 1,
      "contexto_origem": "3 produtos com estoque <= 5 no TechMax (Mouse Gamer, HD SSD 1TB, Cabo HDMI 2m)"
    },
    ...
  ]
}
modulo deve ser um de: ${SETORES.join(', ')}.
prioridade deve ser um de: Alta, Média, Baixa.
prazo_dias é integer 1-7.
Não envolva em markdown nem adicione texto antes/depois.
`.trim();

const buildUserPrompt = (snapshot: any, dataRef: string): string => {
  return `Data de referência: ${dataRef}

SNAPSHOT DO ERP (JSON):
\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`

Gere a pauta operacional do dia conforme as diretrizes do system prompt.`;
};

// Mesmo parser robusto que o ai-legenda usa. Aceita objeto direto,
// array no topo, JSON envolvido em markdown.
const extractJson = (raw: string): any | null => {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try { return JSON.parse(trimmed); } catch { /* fallback */ }
  const objStart = trimmed.indexOf('{');
  const objEnd   = trimmed.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(trimmed.slice(objStart, objEnd + 1)); } catch { /* fim */ }
  }
  return null;
};

// Normaliza tarefa: shape rigoroso, validações server-side.
const normalizarTarefa = (raw: any): any | null => {
  const modulo = String(raw?.modulo ?? '').trim().toLowerCase();
  if (!SETORES.includes(modulo as any)) return null;
  const titulo = String(raw?.titulo ?? '').trim();
  if (!titulo) return null;
  const descricao = String(raw?.descricao ?? '').trim();
  let prioridade = String(raw?.prioridade ?? 'Média').trim();
  if (!['Alta','Média','Baixa'].includes(prioridade)) prioridade = 'Média';
  let prazoDias = Number(raw?.prazo_dias ?? 3);
  if (!Number.isFinite(prazoDias) || prazoDias < 1 || prazoDias > 14) prazoDias = 3;
  const contexto = String(raw?.contexto_origem ?? raw?.contexto ?? '').trim();
  return {
    modulo,
    titulo:          titulo.slice(0, 200),
    descricao:       descricao.slice(0, 1000),
    prioridade,
    prazo_dias:      Math.round(prazoDias),
    contexto_origem: contexto.slice(0, 500),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-briefing');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    // Briefing é privilégio de Admin/CEO. Gerente NÃO gera briefing.
    if (!['admin','ceo'].includes(user.role)) {
      log.warn('access.denied', { user_id: user.id, role: user.role });
      return res.status(403).json({ error: 'Briefing Diário disponível apenas para Admin e CEO.' });
    }

    const { data, janela_dias } = (req.body ?? {}) as { data?: string; janela_dias?: number };
    // Default = hoje no fuso do Acre (UTC-5).
    const dataRef = data && /^\d{4}-\d{2}-\d{2}$/.test(data)
      ? data
      : new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Rio_Branco',
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());

    // Janela do snapshot: 7 (default), 15 ou 30. Qualquer outro valor cai
    // pro default — não devolvemos erro pra não atrapalhar a turma se um
    // cliente antigo enviar payload sem janela_dias.
    const janelaDias: Janela = JANELAS_VALIDAS.includes(janela_dias as Janela)
      ? (janela_dias as Janela)
      : 7;

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      log.error('config.missing_key', new Error('GEMINI_API_KEY ausente'));
      return res.status(500).json({ error: 'IA não configurada no servidor.' });
    }
    const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

    const admin = getAdminClient(res);
    if (!admin) return;

    // ─── Cache forte: 1 briefing ativo por (data, janela_dias) ─────
    // Trocar a janela sem descartar o briefing antigo gera um novo —
    // o UNIQUE parcial permite essas combinações em paralelo.
    const { data: existente, error: cacheErr } = await admin
      .from('briefings_diarios')
      .select('id, data_referencia, janela_dias, status, dados_snapshot, tarefas_propostas, total_propostas, total_aprovadas, gerado_por, nome_gerador, modelo_ia, created_at')
      .eq('data_referencia', dataRef)
      .eq('janela_dias', janelaDias)
      .eq('ativo', true)
      .neq('status', 'descartado')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!cacheErr && existente && existente.length > 0) {
      const hit = existente[0];
      log.info('cache.hit', { user_id: user.id, briefing_id: hit.id });
      return res.status(200).json({
        ...hit,
        from_cache: true,
      });
    }

    // ─── Snapshot via RPC do BI (janela configurável) ──────────────
    // Admin escolhe 7/15/30 dias na tela. Janelas maiores dão mais
    // contexto histórico mas custam mais tokens no Gemini.
    const inicioJanela = new Date(dataRef + 'T00:00:00');
    inicioJanela.setDate(inicioJanela.getDate() - janelaDias);
    const inicioStr = `${inicioJanela.getFullYear()}-${String(inicioJanela.getMonth()+1).padStart(2,'0')}-${String(inicioJanela.getDate()).padStart(2,'0')}`;

    const { data: snapshot, error: rpcErr } = await admin.rpc('gerar_painel_bi', {
      p_inicio: inicioStr,
      p_fim:    dataRef,
    });
    if (rpcErr) {
      log.error('rpc.failed', rpcErr);
      return res.status(500).json({ error: `Erro ao agregar dados: ${rpcErr.message}` });
    }

    // ─── Gemini ────────────────────────────────────────────────────
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(snapshot, dataRef) }] }],
        generationConfig: {
          temperature:      0.7,
          // 7 setores × 2-4 tarefas × título+descrição+contexto em PT-BR
          // estoura 3000 fácil. 8000 dá folga sem custo grande no flash.
          maxOutputTokens:  8000,
          topP:             0.95,
          responseMimeType: 'application/json',
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    const data2 = await upstream.json() as any;

    if (!upstream.ok) {
      log.warn('gemini.failed', {
        user_id: user.id, status: upstream.status,
        error_message: data2?.error?.message, model,
      });
      const friendly =
        upstream.status === 429 ? 'Limite de uso da IA atingido. Tente novamente em alguns minutos.'
        : upstream.status === 400 || upstream.status === 401 || upstream.status === 403
          ? 'Chave da IA inválida. Verifique GEMINI_API_KEY no Vercel.'
        : data2?.error?.message ?? 'Erro na IA.';
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: friendly });
    }

    const rawText: string =
      data2?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';

    if (!rawText.trim()) {
      const finish = data2?.candidates?.[0]?.finishReason;
      return res.status(502).json({
        error: finish === 'SAFETY'
          ? 'A IA recusou gerar o briefing (filtro de segurança).'
          : 'A IA não retornou conteúdo. Tente novamente.',
        finish,
      });
    }

    const parsed = extractJson(rawText);
    const tarefasRaw: any[] = Array.isArray(parsed?.tarefas) ? parsed.tarefas : [];
    if (tarefasRaw.length === 0) {
      const finish = data2?.candidates?.[0]?.finishReason;
      log.warn('gemini.empty_tarefas', {
        user_id: user.id, finish, parsed_ok: parsed !== null,
        raw_sample: rawText.slice(0, 300),
      });
      const friendly =
        finish === 'MAX_TOKENS' ? 'A IA estourou o limite de tamanho — tente uma janela menor (7 ou 15 dias).'
        : finish === 'SAFETY'   ? 'A IA recusou gerar o briefing (filtro de segurança).'
        : parsed === null       ? 'A IA devolveu JSON inválido. Tente novamente.'
        :                         'IA não devolveu tarefas. Tente novamente.';
      return res.status(502).json({ error: friendly, finish });
    }

    // Normaliza + filtra inválidas + adiciona flags de revisão.
    const tarefas = tarefasRaw
      .map(normalizarTarefa)
      .filter((t): t is any => t !== null)
      .map((t, idx) => ({ ...t, _id: `t-${idx}`, aprovada: false, descartada: false, editada: false }));

    if (tarefas.length === 0) {
      return res.status(502).json({ error: 'Nenhuma tarefa válida foi gerada. Tente novamente.' });
    }

    // ─── Persiste como rascunho_ia ────────────────────────────────
    const { data: salvo, error: insErr } = await admin
      .from('briefings_diarios')
      .insert({
        data_referencia:   dataRef,
        janela_dias:       janelaDias,
        status:            'rascunho_ia',
        dados_snapshot:    snapshot,
        tarefas_propostas: tarefas,
        total_propostas:   tarefas.length,
        total_aprovadas:   0,
        gerado_por:        user.id,
        nome_gerador:      user.email?.split('@')[0] ?? null,
        modelo_ia:         model,
      })
      .select('*')
      .single();

    if (insErr) {
      log.error('persist.failed', insErr);
      return res.status(500).json({ error: `Erro ao salvar briefing: ${insErr.message}` });
    }

    log.info('briefing.ok', { user_id: user.id, briefing_id: salvo.id, tarefas: tarefas.length });

    return res.status(200).json({
      ...salvo,
      from_cache: false,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
