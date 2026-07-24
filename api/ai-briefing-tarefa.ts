import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors, getAdminClient } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import { callLLM } from '../lib/llm.js';

// Endpoint: MaxAI Briefing por tarefa da Matriz. Admin/CEO abre uma
// tarefa da Competição de Conselho (ex: Apresentação Profissional) e
// pede pra IA propor sub-tarefas nos outros 6 tipos que ajudem a
// alcançar a tarefa principal.
//
// POST /api/ai-briefing-tarefa { tarefa_id: uuid }
// Retorna: { sugestoes: [{ tipo, nome, descricao, justificativa }, ...] }
//
// Não persiste — o cliente escolhe quais aprovar e chama
// criar_matriz_tarefa(..., p_origem='briefing_ia') pra cada aprovação.

const TIPOS = [
  'tarefa_treinamento_vendas','tarefa_treinamento_ia','tarefa_apresentacao',
  'tarefa_rh','tarefa_marketing','tarefa_financeiro','tarefa_logistica',
] as const;
type Tipo = typeof TIPOS[number];

const TIPO_LABEL: Record<Tipo, string> = {
  tarefa_apresentacao:        'Apresentação Profissional',
  tarefa_treinamento_ia:      'Desenvolvimento com IA',
  tarefa_rh:                  'Recursos Humanos',
  tarefa_financeiro:          'Financeiro',
  tarefa_logistica:           'Logística',
  tarefa_marketing:           'Marketing',
  tarefa_treinamento_vendas:  'Vendas e Atendimento',
};

const SYSTEM_PROMPT = `
Você é o Diretor de Estratégia do LogMax analisando uma tarefa principal
da Competição de Conselho da Matriz. A partir dela, sua função é sugerir
sub-tarefas nos OUTROS tipos de tarefa que ajudem as filiais (SuperMax,
MaxLook, TechMax) a alcançar/entregar bem a tarefa principal.

Tipos possíveis (sempre um destes exatos, snake_case):
- tarefa_apresentacao         (Apresentação Profissional)
- tarefa_treinamento_ia       (Desenvolvimento com IA)
- tarefa_rh                   (Recursos Humanos)
- tarefa_financeiro           (Financeiro)
- tarefa_logistica            (Logística)
- tarefa_marketing            (Marketing)
- tarefa_treinamento_vendas   (Vendas e Atendimento)

Diretrizes:
- NÃO proponha nada no MESMO tipo da tarefa principal — o objetivo é
  desdobrar a tarefa nos OUTROS 6 tipos.
- Gere UMA sugestão por tipo restante (total 6 sugestões).
- Cada sugestão precisa apoiar concretamente a tarefa principal, não
  ser genérica ("melhorar processos"). Cite conexão específica.
- Nomes curtos (ate 90 chars), acionáveis, começando por verbo
  ("Treinar equipe em pitch", "Reservar orçamento para material").
- Descrição: 1-3 frases explicando o que fazer, sem inventar números
  ou dados que não estejam no contexto.
- Justificativa: 1 frase conectando a sugestão à tarefa principal.

Saída: APENAS JSON no formato:
{
  "sugestoes": [
    {
      "tipo": "tarefa_rh",
      "nome": "Alinhar RH sobre disponibilidade dos participantes",
      "descricao": "Consultar RH pra confirmar quais colaboradores estarão liberados nas datas da apresentação e ajustar escala se preciso.",
      "justificativa": "Sem disponibilidade confirmada, participantes chave podem faltar no dia."
    }
  ]
}
Não envolva em markdown, não adicione texto antes/depois.
`.trim();

const buildUserPrompt = (tarefa: { tipo: string; nome: string; descricao: string | null }): string => {
  const outros = TIPOS.filter(t => t !== tarefa.tipo);
  const outrosStr = outros.map(t => `- ${t} (${TIPO_LABEL[t]})`).join('\n');
  return `TAREFA PRINCIPAL:
Tipo: ${tarefa.tipo} (${TIPO_LABEL[tarefa.tipo as Tipo] ?? tarefa.tipo})
Nome: ${tarefa.nome}
Descrição: ${tarefa.descricao ?? '(sem descrição)'}

TIPOS RESTANTES onde você deve propor sub-tarefas (uma por tipo):
${outrosStr}

Gere 6 sugestões conforme diretrizes do system prompt.`;
};

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

const normalizarSugestao = (raw: any, tipoOriginal: string): any | null => {
  const tipo = String(raw?.tipo ?? '').trim();
  if (!TIPOS.includes(tipo as Tipo)) return null;
  if (tipo === tipoOriginal) return null;
  const nome = String(raw?.nome ?? '').trim();
  if (!nome) return null;
  const descricao = String(raw?.descricao ?? '').trim();
  const justificativa = String(raw?.justificativa ?? '').trim();
  return {
    tipo,
    nome: nome.slice(0, 200),
    descricao: descricao.slice(0, 1000),
    justificativa: justificativa.slice(0, 500),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-briefing-tarefa');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    if (!['admin','ceo'].includes(user.role)) {
      log.warn('access.denied', { user_id: user.id, role: user.role });
      return res.status(403).json({ error: 'MaxAI Briefing disponível apenas para Admin e CEO.' });
    }

    const { tarefa_id } = (req.body ?? {}) as { tarefa_id?: string };
    if (!tarefa_id || typeof tarefa_id !== 'string') {
      return res.status(400).json({ error: 'tarefa_id obrigatório.' });
    }

    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim() && !process.env.OPENROUTER_API_KEY?.trim()) {
      log.error('config.missing_key', new Error('Nenhuma chave de IA configurada'));
      return res.status(500).json({ error: 'IA não configurada no servidor.' });
    }

    const admin = getAdminClient(res);
    if (!admin) return;

    const { data: tarefa, error: fetchErr } = await admin
      .from('matriz_tarefas')
      .select('id, tipo, nome, descricao')
      .eq('id', tarefa_id)
      .eq('ativo', true)
      .maybeSingle();

    if (fetchErr) {
      log.error('fetch.tarefa', fetchErr);
      return res.status(500).json({ error: `Erro ao buscar tarefa: ${fetchErr.message}` });
    }
    if (!tarefa) {
      return res.status(404).json({ error: 'Tarefa não encontrada ou inativa.' });
    }

    const llm = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:   buildUserPrompt(tarefa as any),
      temperature:  0.7,
      maxOutputTokens: 4000,
      topP:         0.95,
      jsonMode:     true,
    }, log);

    if (!llm.ok) {
      return res.status(llm.httpStatus).json({ error: llm.friendlyMessage, finish: llm.finishReason });
    }

    const parsed = extractJson(llm.text);
    const sugRaw: any[] = Array.isArray(parsed?.sugestoes) ? parsed.sugestoes : [];
    if (sugRaw.length === 0) {
      log.warn('llm.empty_sugestoes', {
        user_id: user.id, provider: llm.provider, model: llm.modelUsed,
        finish: llm.finishReason, parsed_ok: parsed !== null,
        raw_sample: llm.text.slice(0, 300),
      });
      const friendly = parsed === null
        ? 'A IA devolveu JSON inválido. Tente novamente.'
        : 'IA não devolveu sugestões. Tente novamente.';
      return res.status(502).json({ error: friendly, finish: llm.finishReason });
    }

    const sugestoes = sugRaw
      .map(s => normalizarSugestao(s, tarefa.tipo))
      .filter((s): s is any => s !== null);

    // Dedup por tipo (fica só a primeira sugestão de cada tipo).
    const vistos = new Set<string>();
    const unicas = sugestoes.filter(s => {
      if (vistos.has(s.tipo)) return false;
      vistos.add(s.tipo);
      return true;
    });

    if (unicas.length === 0) {
      return res.status(502).json({ error: 'Nenhuma sugestão válida foi gerada. Tente novamente.' });
    }

    log.info('briefing_tarefa.ok', {
      user_id: user.id,
      tarefa_id,
      tipo_origem: tarefa.tipo,
      sugestoes: unicas.length,
      modelo: `${llm.provider}:${llm.modelUsed}`,
    });

    return res.status(200).json({
      tarefa_id,
      tipo_origem: tarefa.tipo,
      nome_origem: tarefa.nome,
      sugestoes: unicas,
      modelo_ia: `${llm.provider}:${llm.modelUsed}`,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
