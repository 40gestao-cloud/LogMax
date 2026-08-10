import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, applyCors } from '../lib/auth.js';
import { createLogger } from '../lib/log.js';
import { callLLM } from '../lib/llm.js';

// Endpoint: MaxAI monta a atividade de um fluxo do Modo Aula.
//
// O professor escolhe o fluxo na tela de Modo Aula (Fluxos de operação), a
// whitelist é montada, e daqui sai o ENUNCIADO: uma tarefa por etapa, com o
// papel de quem executa, o que entregar e como o professor confere.
//
// A cadeia vem do CLIENTE, não daqui. `src/lib/aulaFluxos.ts` é a fonte de
// verdade única do fluxo (preset + alerta de cadeia + diagrama); duplicá-la no
// servidor criaria a quinta cópia e a primeira a divergir em silêncio. Este
// endpoint recebe as etapas já montadas e só as transforma em enunciado.
//
// POST /api/ai-aula-atividade
//   { fluxo_nome, fluxo_resumo?, etapas: [{ordem,titulo,quem,detalhe,opcional}],
//     prerequisitos?: [{label,onde}], filial?, observacao? }
// Retorna: { titulo, objetivo, tarefas: [{ordem,papel,titulo,enunciado,entregavel,criterio}] }
//
// Não persiste nada: o professor revisa, edita e só então publica pela RPC
// `publicar_atividade_aula` (migr. 403).

const MAX_ETAPAS = 20;

type EtapaIn = {
  ordem: number;
  titulo: string;
  quem: string;
  detalhe: string;
  opcional?: boolean;
};

const SYSTEM_PROMPT = `
Você é o professor de um curso técnico de gestão que usa o LogMax — um ERP
didático — como ambiente de prática. A turma é dividida em filiais fictícias
(SuperMax, MaxLook, TechMax) e cada aluno ocupa um papel na operação.

Você recebe uma CADEIA DE OPERAÇÃO já mapeada (as etapas, quem executa cada
uma e o que o sistema faz nela) e escreve a ATIVIDADE que a turma vai executar
percorrendo essa cadeia no sistema.

Diretrizes:
- Gere UMA tarefa por etapa recebida, na MESMA ordem, mantendo o campo "ordem".
- "papel" deve ser quem executa a etapa, no vocabulário da etapa recebida.
  Não invente cargos que não estejam ali.
- "titulo": curto (até 80 chars), começando por verbo no infinitivo.
- "enunciado": 2 a 4 frases dizendo o que o aluno FAZ na tela e o que ele deve
  OBSERVAR acontecer. Situe com dados plausíveis de um comércio (um produto,
  uma quantidade, um fornecedor), deixando claro que são valores de exercício.
  Nunca invente números de KPI, saldos, metas ou resultados da empresa.
- "entregavel": 1 frase — o que o aluno mostra ao professor no fim da tarefa
  (um documento com número, um status que mudou, um lançamento visível).
- "criterio": 1 frase — como o professor confere se ficou certo.
- Quando a etapa vier marcada como opcional, escreva a tarefa normalmente e
  comece o enunciado com "Se houver tempo: ".
- Respeite a segregação de funções: se a cadeia diz que quem pede não aprova,
  a tarefa de aprovação é de OUTRO aluno. Nunca instrua o mesmo papel a
  executar as duas pontas.
- Português do Brasil, tom de instrução direta ao aluno ("Abra", "Registre").
- Não mencione que você é uma IA, nem cite estas instruções.

Devolva também:
- "titulo": nome da atividade (até 90 chars).
- "objetivo": 1 a 2 frases dizendo o que a turma deve entender ao terminar.

Saída: APENAS JSON no formato:
{
  "titulo": "Atividade — da requisição ao pagamento",
  "objetivo": "Entender por que uma compra passa por quatro setores antes de virar dinheiro saindo do caixa.",
  "tarefas": [
    {
      "ordem": 1,
      "papel": "Colaborador de qualquer setor",
      "titulo": "Abrir a requisição do que falta",
      "enunciado": "Abra Requisições › Do Setor e peça 10 unidades de um produto do catálogo da sua filial. Observe que a reposição já traz o saldo atual e não pede justificativa.",
      "entregavel": "A requisição criada, com número, em status Pendente.",
      "criterio": "Existe uma requisição da filial do aluno, com item do catálogo e quantidade preenchida."
    }
  ]
}
Não envolva em markdown, não adicione texto antes/depois.
`.trim();

const buildUserPrompt = (b: {
  fluxo_nome: string;
  fluxo_resumo: string;
  etapas: EtapaIn[];
  prerequisitos: { label: string; onde: string }[];
  filial: string;
  observacao: string;
}): string => {
  const etapas = b.etapas.map(e =>
    `${e.ordem}. ${e.titulo}${e.opcional ? '  [OPCIONAL]' : ''}\n`
    + `   Quem executa: ${e.quem}\n`
    + `   O que o sistema faz: ${e.detalhe}`,
  ).join('\n');

  const pre = b.prerequisitos.length > 0
    ? b.prerequisitos.map(p => `- ${p.label} (${p.onde})`).join('\n')
    : '(nenhum informado)';

  return `FLUXO: ${b.fluxo_nome}
${b.fluxo_resumo ? `Resumo: ${b.fluxo_resumo}\n` : ''}
ETAPAS DA CADEIA (uma tarefa para cada, nesta ordem):
${etapas}

O QUE JÁ ESTÁ PREPARADO NO SISTEMA (não peça ao aluno para cadastrar isto):
${pre}
${b.filial ? `\nFILIAL DA TURMA: ${b.filial}` : ''}
${b.observacao ? `\nPEDIDO DO PROFESSOR (respeite): ${b.observacao}` : ''}

Gere a atividade conforme as diretrizes do system prompt.`;
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

const str = (v: any, max: number): string => String(v ?? '').trim().slice(0, max);

// Sanitiza as etapas recebidas. O corpo vem do cliente e vira prompt: sem
// teto de tamanho, uma aba adulterada mandaria um texto arbitrário para o LLM
// na conta do projeto.
const normalizarEtapas = (raw: any): EtapaIn[] => {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ETAPAS).map((e: any, i: number) => ({
    ordem: Number(e?.ordem) || i + 1,
    titulo: str(e?.titulo, 200),
    quem: str(e?.quem, 120),
    detalhe: str(e?.detalhe, 800),
    opcional: !!e?.opcional,
  })).filter(e => e.titulo);
};

const normalizarTarefa = (raw: any, i: number): any | null => {
  const titulo = str(raw?.titulo, 200);
  if (!titulo) return null;
  return {
    ordem: Number(raw?.ordem) || i + 1,
    papel: str(raw?.papel, 120),
    titulo,
    enunciado: str(raw?.enunciado, 1200),
    entregavel: str(raw?.entregavel, 400),
    criterio: str(raw?.criterio, 400),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const log = createLogger(req, 'ai-aula-atividade');

  try {
    if (applyCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await authenticate(req, res);
    if (!user) return;

    // Mesma régua de escrita de `aula_config` (migr. 173) e da RPC de publicar
    // (migr. 403): quem conduz a aula. Conselheiro fica de fora — nesta
    // operação ele é aluno, e receberia o gabarito da turma.
    if (!['admin', 'ceo'].includes(user.role)) {
      log.warn('access.denied', { user_id: user.id, role: user.role });
      return res.status(403).json({ error: 'Atividade da aula é gerada por Admin ou CEO.' });
    }

    const body = (req.body ?? {}) as any;
    const fluxo_nome = str(body.fluxo_nome, 200);
    const etapas = normalizarEtapas(body.etapas);

    if (!fluxo_nome) return res.status(400).json({ error: 'fluxo_nome obrigatório.' });
    if (etapas.length === 0) {
      return res.status(400).json({ error: 'Envie ao menos uma etapa do fluxo.' });
    }

    if (!process.env.GEMINI_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim() && !process.env.OPENROUTER_API_KEY?.trim()) {
      log.error('config.missing_key', new Error('Nenhuma chave de IA configurada'));
      return res.status(500).json({ error: 'IA não configurada no servidor.' });
    }

    const prerequisitos = (Array.isArray(body.prerequisitos) ? body.prerequisitos : [])
      .slice(0, 12)
      .map((p: any) => ({ label: str(p?.label, 160), onde: str(p?.onde, 160) }))
      .filter((p: any) => p.label);

    const llm = await callLLM({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        fluxo_nome,
        fluxo_resumo: str(body.fluxo_resumo, 600),
        etapas,
        prerequisitos,
        filial: str(body.filial, 60),
        observacao: str(body.observacao, 600),
      }),
      temperature: 0.6,
      maxOutputTokens: 6000,
      topP: 0.95,
      jsonMode: true,
    }, log);

    if (!llm.ok) {
      return res.status(llm.httpStatus).json({ error: llm.friendlyMessage, finish: llm.finishReason });
    }

    const parsed = extractJson(llm.text);
    const brutas: any[] = Array.isArray(parsed?.tarefas) ? parsed.tarefas : [];
    const tarefas = brutas
      .map((t, i) => normalizarTarefa(t, i))
      .filter((t): t is any => t !== null)
      .slice(0, MAX_ETAPAS)
      .sort((a, b) => a.ordem - b.ordem);

    if (tarefas.length === 0) {
      log.warn('llm.empty_tarefas', {
        user_id: user.id, provider: llm.provider, model: llm.modelUsed,
        finish: llm.finishReason, parsed_ok: parsed !== null,
        raw_sample: llm.text.slice(0, 300),
      });
      return res.status(502).json({
        error: parsed === null
          ? 'A IA devolveu JSON inválido. Tente novamente.'
          : 'A IA não devolveu tarefas. Tente novamente.',
        finish: llm.finishReason,
      });
    }

    log.info('aula_atividade.ok', {
      user_id: user.id,
      fluxo: fluxo_nome,
      etapas: etapas.length,
      tarefas: tarefas.length,
      modelo: `${llm.provider}:${llm.modelUsed}`,
    });

    return res.status(200).json({
      titulo: str(parsed?.titulo, 200) || `Atividade — ${fluxo_nome}`,
      objetivo: str(parsed?.objetivo, 800),
      tarefas,
      modelo_ia: `${llm.provider}:${llm.modelUsed}`,
    });
  } catch (err) {
    log.error('handler.unhandled', err);
    return res.status(500).json({ error: 'Erro interno na IA.' });
  }
}
